import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../public/doc.js";
import { readBlocks, applyToDoc, docFromSnapshot, docMeta, validAttrs, validBlocks, guestAsk, guestId, mayAct, shareAsks, fitAsks, agentCaret } from "../public/together-adapter.js";
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
  // The block after a removed or changed one is checked again (the review's example).
  const withHeading = [b("a", "para", ""), b("h", "heading", "\n\n", "## "), b("p", "para", "\n")];
  assert.ok(validBlocks(withHeading));
  assert.ok(!validBlocks([b("a", "para", ""), b("p", "para", "\n")], withHeading), "heading removed: p would merge into a");
  assert.ok(!validBlocks([b("a", "para", ""), b("h", "para", "\n\n"), b("p", "para", "\n")], withHeading), "heading turned into a para");
  // Spaces at the end of a separator would become the next block's text: "  ## x" reads back as a para.
  assert.ok(!validBlocks([b("a", "para", ""), b("h", "heading", "\n\n  ", "## ")]));
  assert.ok(!validBlocks([b("a", "para", ""), b("p", "para", "\n\n ")]));
  // Any run of spaces after the hashes, as D.prefixOf reads it.
  const nine = D.parse("#         Wide title\n\nText.\n");
  assert.equal(D.prefixOf(nine.blocks[0]), "#         ");
  assert.ok(validBlocks(readBlocks(nine)));
  const odd = [b("a", "raw", ""), b("p", "para", "\n")];
  assert.ok(validBlocks([...odd, b("n", "para", "\n\n")], odd));
  assert.ok(!validBlocks([...odd, b("n", "para", "")], odd));
});

test("adapter: a "/" command is held back from the others for the host and guests alike, until it is text", () => {
  const cmd = { id: "b1", start: 4, end: 7, query: "ho" };
  assert.equal(D.slashHold({ open: true }), true);
  assert.equal(D.slashHold({ focused: true, cmd, matches: 1 }), true, "about to open the menu");
  assert.equal(D.slashHold({ guest: true, focused: true, cmd, matches: 1 }), true, "guests too (step D2)");
  assert.equal(D.slashHold({ focused: true, cmd, matches: 0 }), false, "no part matches: it is text");
  assert.equal(D.slashHold({ focused: false, cmd, matches: 1 }), false, "the person left the script");
  assert.equal(D.slashHold({ focused: true, cmd, dismissed: { id: "b1", start: 4 }, matches: 1 }), false, "dismissed with Escape");
  assert.equal(D.slashHold({ focused: true, cmd: null }), false);
});

/* ---------- Asks in a shared script (step D2) ---------- */
const script = () => D.parse("# Title\n\n## 1 · Hook\n\nWe start here. Then we go on.\n\n[ON SCREEN: a note]\n");
const paraOf = (doc) => doc.blocks.find((b) => b.type === "para");

test("adapter: the host takes a guest's ask only when it fits its script", () => {
  const doc = script(), p = paraOf(doc);
  const ok = guestAsk(doc, { blockId: p.id, start: 3, end: 8, quote: "start", action: "simpler" });
  assert.deepEqual(ok, { blockId: p.id, start: 3, end: 8, action: "simpler" });
  // The guest's place may be a little off (its own typing not in yet): the quote is found nearby.
  assert.deepEqual(guestAsk(doc, { blockId: p.id, start: 0, quote: "start", action: "shorter" }), { blockId: p.id, start: 3, end: 8, action: "shorter" });
  assert.deepEqual(guestAsk(doc, { blockId: p.id, start: 3, quote: "start", action: "ask", instruction: "  Make it funny " }).instruction, "Make it funny");
  assert.equal(guestAsk(doc, { blockId: p.id, start: 3, quote: "start", action: "ask", instruction: " " }), null, "an empty Ask");
  assert.equal(guestAsk(doc, { blockId: p.id, start: 3, quote: "gone", action: "simpler" }), null, "a quote not in the script");
  assert.equal(guestAsk(doc, { blockId: "nope", start: 3, quote: "start", action: "simpler" }), null);
  for (const action of ["voice", "plan", "sketch", "eval"]) assert.equal(guestAsk(doc, { blockId: p.id, start: 3, quote: "start", action }), null, action);
  assert.ok(guestAsk(doc, { blockId: p.id, start: 3, quote: "start", action: "broll" }), "Suggest B-roll on a spoken line");
  const note = doc.blocks.find((b) => b.type === "note");
  assert.equal(guestAsk(doc, { blockId: note.id, start: 1, quote: "ON SCREEN", action: "broll" }), null, "no B-roll on a note");
});

test("adapter: only the person who asked, and the host, may Keep or Undo", () => {
  const ask = { by: { id: guestId("abc123abc123"), name: "Ana" } };
  assert.ok(mayAct(ask, { host: true, id: "someone" }));
  assert.ok(mayAct(ask, { id: guestId("abc123abc123") }));
  assert.ok(!mayAct(ask, { id: guestId("other") }));
  assert.ok(!mayAct({ by: { id: "lex" } }, { id: "" }));
});

test("adapter: a guest places the host's asks in its own copy, and the agent's caret follows them", () => {
  const doc = script(), p = paraOf(doc);
  const now = new Date("2026-10-28T12:00:00Z");
  const a1 = D.makeAsk(doc, { blockId: p.id, start: 3, end: 8, action: "simpler", by: { id: "lex", name: "Lex" }, now });
  const a2 = D.makeAsk(doc, { blockId: p.id, start: 15, end: 29, action: "shorter", by: { id: guestId("abc123abc123"), name: "Ana" }, now });
  const done = { ...D.makeAsk(doc, { blockId: p.id, start: 0, end: 2, action: "facts", by: { id: "lex" }, now }), status: "kept" };
  const shared = shareAsks([a1, a2, done]);
  assert.deepEqual(shared.map((a) => a.id), [a1.id, a2.id], "only open asks are shared");
  assert.notEqual(shared[0], a1, "copies");
  // The guest typed in front of the quotes: they are found again.
  const guest = D.cloneDoc(doc);
  D.setContent(guest, p.id, "Yes. " + D.contentOf(p));
  const placed = fitAsks(shareAsks([a1, a2]), guest);
  assert.deepEqual(placed.map((a) => [a.start, a.end]), [[8, 13], [20, 34]]);
  D.setContent(guest, p.id, "Something else.");
  assert.equal(fitAsks(shareAsks([a1, a2]), guest).length, 0, "asks whose text is gone are left out");
  // The agent's caret: none while waiting, at the end of the text while taken, at the change while answered.
  assert.equal(agentCaret([a1], doc), null);
  a1.status = "taken"; a1.takenBy = { id: "agent:claude-code", name: "Claude Code" };
  assert.deepEqual(agentCaret([a1, a2], doc), { pid: "agent", kind: "agent", name: "Claude Code (agent)", colour: 0, blockId: p.id, offset: 8 });
  a2.status = "answered"; a2.answer = { kind: "replace", text: "Go on." }; a2.answeredBy = { id: "agent:x", name: "Claude" };
  assert.equal(agentCaret([a1, a2], doc).offset, 8, "the ask it works on wins");
  a1.status = "kept";
  assert.deepEqual([agentCaret([a1, a2], doc).offset, agentCaret([a1, a2], doc).name], [29, "Claude (agent)"]);
  a2.status = "undone";
  assert.equal(agentCaret([a1, a2], doc), null, "gone after Keep or Undo");
  a2.status = "answered"; a2.answer = { kind: "broll", changes: [] };
  assert.equal(agentCaret([a2], doc), null, "B-roll suggestions live beside the lines");
});
