import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../public/doc.js";
import { readBlocks, applyToDoc, docFromSnapshot, docMeta, validAttrs } from "../public/together-adapter.js";
import { diff, validOps } from "../public/together/ops.js";

const sample = readFileSync(new URL("../public/samples/demo-good-script.md", import.meta.url), "utf8");
const copy = (doc) => D.cloneDoc(doc);

// What a guest receives in a snapshot gives back the host's file byte for byte.
test("adapter: a snapshot rebuilds the script exactly, LF and CRLF", () => {
  for (const text of [sample, sample.replace(/\n/g, "\r\n"), "# T\n\n## 1 · Hook\n\nHello.\n\n\n"]) {
    const doc = D.parse(text);
    const back = docFromSnapshot({ blocks: readBlocks(doc), meta: docMeta(doc, "x.md") });
    assert.equal(D.serialize(back), text);
    assert.deepEqual(back.blocks.map((b) => b.id), doc.blocks.map((b) => b.id));
  }
});

// Every way the editor changes a script comes out as operations that rebuild it on the other side.
test("adapter: edits made with doc.js travel as operations and give the same file", () => {
  for (const eol of ["\n", "\r\n"]) {
    const host = D.parse(sample.replace(/\n/g, eol));
    const guest = copy(host);
    const paras = host.blocks.filter((b) => b.type === "para");
    const steps = [
      (d) => D.setContent(d, paras[0].id, D.contentOf(D.blockById(d, paras[0].id)) + " More words."),
      (d) => D.splitBlock(d, paras[1].id, 10),
      (d) => D.mergeWithPrevious(d, paras[3].id),
      (d) => D.setContent(d, paras[2].id, "## Now a heading"),
      (d) => D.insertPart(d, paras[4].id, "hook"),
      (d) => D.removeBlock(d, d.blocks[0].id),
      (d) => D.setContent(d, paras[5].id, "One.\n\nTwo after a blank line."),
    ];
    for (const step of steps) {
      const before = readBlocks(host);
      step(host);
      const ops = diff(before, readBlocks(host));
      assert.ok(validOps(ops, validAttrs), JSON.stringify(ops));
      applyToDoc(guest, JSON.parse(JSON.stringify(ops)));
      assert.equal(D.serialize(guest), D.serialize(host));
      assert.deepEqual(readBlocks(guest), readBlocks(host));
    }
  }
});

test("adapter: attrs from someone else can't put text outside the blocks", () => {
  assert.ok(validAttrs({ type: "heading", sep: "\n\n", prefix: "## " }, false));
  assert.ok(validAttrs({ type: "para" }, true));
  assert.ok(!validAttrs({ type: "para" }, false));
  assert.ok(!validAttrs({ type: "para", sep: "\n\nhidden text\n\n", prefix: "" }, false));
  assert.ok(!validAttrs({ type: "script", sep: "\n\n", prefix: "" }, false));
  assert.ok(!validAttrs({ type: "para", sep: "\n\n", prefix: "<b>" }, false));
  assert.ok(!validAttrs({ type: "para", sep: "\n\n", prefix: "", extra: 1 }, false));
});
