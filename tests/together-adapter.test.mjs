import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../public/doc.js";
import { readBlocks, applyToDoc, docFromSnapshot, docMeta, validAttrs, validBlocks } from "../public/together-adapter.js";
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
      assert.ok(validBlocks(readBlocks(host), before), "the editor's own edits pass the host's check");
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
  // The "# " / "## " marker belongs to its type.
  assert.ok(!validAttrs({ type: "para", sep: "\n\n", prefix: "## " }, false));
  assert.ok(!validAttrs({ type: "heading", sep: "\n\n", prefix: "" }, false));
  assert.ok(!validAttrs({ type: "title", sep: "", prefix: "## " }, false));
  assert.ok(validAttrs({ type: "title", sep: "", prefix: "# " }, false));
});

test("adapter: blocks from someone else keep a blank line between them, so the file reads back the same", () => {
  const b = (id, type, sep, prefix = "") => ({ id, text: "x", attrs: { type, sep, prefix } });
  for (const text of [sample, sample.replace(/\n/g, "\r\n"), "## Heading\nText right under it\n"]) assert.ok(validBlocks(readBlocks(D.parse(text))));
  assert.ok(validBlocks([b("t", "title", "", "# "), b("p", "para", "\n\n")]));
  assert.ok(validBlocks([b("h", "heading", "\n", "## "), b("p", "para", "\n")]), "a heading may be followed by a single line break");
  assert.ok(!validBlocks([b("a", "para", ""), b("p", "para", "")]), "no separator: two paras would read back as one");
  assert.ok(!validBlocks([b("a", "para", ""), b("p", "para", "\n")]));
  assert.ok(!validBlocks([b("a", "para", "x")]));
  // Only new or changed blocks are checked, so a host file outside the rules never blocks a guest.
  const odd = [b("a", "raw", ""), b("p", "para", "\n")];
  assert.ok(validBlocks([...odd, b("n", "para", "\n\n")], odd));
  assert.ok(!validBlocks([...odd, b("n", "para", "")], odd));
});

test("adapter: a D1 guest's \"/\" is never held back; a host's command is, until it is text", () => {
  const cmd = { id: "b1", start: 4, end: 7, query: "ho" };
  assert.equal(D.slashHold({ guest: true, open: true, focused: true, cmd, matches: 3 }), false);
  assert.equal(D.slashHold({ guest: true, focused: true, cmd, matches: 3 }), false);
  assert.equal(D.slashHold({ open: true }), true);
  assert.equal(D.slashHold({ focused: true, cmd, matches: 1 }), true, "about to open the menu");
  assert.equal(D.slashHold({ focused: true, cmd, matches: 0 }), false, "no part matches: it is text");
  assert.equal(D.slashHold({ focused: false, cmd, matches: 1 }), false, "the person left the script");
  assert.equal(D.slashHold({ focused: true, cmd, dismissed: { id: "b1", start: 4 }, matches: 1 }), false, "dismissed with Escape");
  assert.equal(D.slashHold({ focused: true, cmd: null }), false);
});
