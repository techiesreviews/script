import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../public/doc.js";
import { readBlocks, applyToDoc, docFromSnapshot, docMeta, validAttrs, validBlocks, guestAsk, mayAct, shareAsks, fitAsks, agentCaret, overlappingAsks, guestMayAct, scriptAdapter, createAskDesk } from "../public/together-adapter.js";
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

test('adapter: a "/" command is held back from the others for the host and guests alike, until it is text', () => {
  const cmd = { id: "b1", start: 4, end: 7, query: "ho" };
  assert.equal(D.slashHold({ open: true }), true);
  assert.equal(D.slashHold({ focused: true, cmd, matches: 1 }), true, "about to open the menu");
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
  const ask = { by: { id: "a-ana", name: "Ana" } };
  assert.ok(mayAct(ask, { host: true, id: "someone" }));
  assert.ok(mayAct(ask, { id: "a-ana" }));
  assert.ok(!mayAct(ask, { id: "a-ben" }));
  assert.ok(!mayAct({ by: { id: "lex" } }, { id: "" }));
});

test("adapter: the host's check of a guest's Keep, Undo or dismiss", () => {
  const own = (status, answer) => ({ scope: "selection", by: { id: "a-ana" }, status, ...(answer ? { answer } : {}) });
  const text = { kind: "replace", text: "x" };
  assert.ok(guestMayAct(own("answered", text), "keep", "a-ana"));
  assert.ok(!guestMayAct(own("answered", text), "keep", "a-ben"), "another guest's ask");
  assert.ok(!guestMayAct(own("answered", text), "keep", ""), "no asker id");
  assert.ok(!guestMayAct(own("answered", { kind: "broll", changes: [] }), "undo", "a-ana"), "an answered B-roll ask stays with the host");
  assert.ok(!guestMayAct(own("waiting"), "keep", "a-ana"), "Keep needs an answer");
  assert.ok(guestMayAct(own("taken"), "undo", "a-ana"));
  assert.ok(guestMayAct(own("taken"), "dismiss", "a-ana"));
  assert.ok(!guestMayAct(own("kept", text), "undo", "a-ana"), "already done");
  // A change that went straight in (step F) can be undone by the guest who asked while it is marked, nothing else.
  const marked = { ...own("kept", text), change: { text: "x", removed: "y", at: 1 } };
  assert.ok(guestMayAct(marked, "undo", "a-ana"));
  assert.ok(!guestMayAct(marked, "undo", "a-ben"), "not by another guest");
  assert.ok(!guestMayAct(marked, "keep", "a-ana"));
  assert.ok(!guestMayAct(marked, "dismiss", "a-ana"));
  assert.ok(!guestMayAct({ ...marked, status: "undone" }, "undo", "a-ana"), "undone already");
  assert.ok(!guestMayAct({ ...own("answered", text), scope: "script" }, "keep", "a-ana"));
  assert.ok(!guestMayAct(own("answered", text), "eval", "a-ana"));
});

test("adapter: a guest's ask over someone else's answer leaves it alone; its own older ask gives way", () => {
  const doc = script(), p = paraOf(doc);
  const hosts = { ...D.makeAsk(doc, { blockId: p.id, start: 3, end: 8, action: "simpler", by: { id: "lex" } }), status: "answered", answer: { kind: "replace", text: "begin" } };
  const anas = D.makeAsk(doc, { blockId: p.id, start: 0, end: 5, action: "shorter", by: { id: "a-ana" } });
  const bens = D.makeAsk(doc, { blockId: p.id, start: 20, end: 25, action: "facts", by: { id: "a-ben" } });
  const asks = [hosts, anas, bens];
  assert.deepEqual(overlappingAsks(asks, { blockId: p.id, start: 2, end: 9 }, "a-ana").map((a) => a.id), [anas.id], "Ana's new ask closes only her own");
  assert.deepEqual(overlappingAsks(asks, { blockId: p.id, start: 2, end: 9 }, "a-ben").map((a) => a.id), [], "Ben's closes none of the others'");
  assert.deepEqual(overlappingAsks(asks, { blockId: p.id, start: 2, end: 9 }).map((a) => a.id), [hosts.id, anas.id], "the host's own ask wins as before");
  assert.equal(hosts.status, "answered");
});

test("adapter: the snapshot carries the B-roll list, and a guest's load passes it on", () => {
  const doc = script();
  const broll = { status: "ok", name: "list.md", text: "| # | What |", flags: { B1: true } };
  const meta = docMeta(doc, "x.md", broll);
  assert.deepEqual(meta.broll, broll);
  assert.equal(docMeta(doc, "x.md").broll, undefined);
  const loads = [];
  const adapter = scriptAdapter({ loadGuest: (d, name, b) => loads.push({ d, name, b }) });
  adapter.load({ blocks: readBlocks(doc), meta });
  assert.equal(loads[0].name, "x.md");
  assert.deepEqual(loads[0].b, broll);
  assert.equal(D.serialize(loads[0].d), D.serialize(doc));
});

test("adapter: a guest places the host's asks in its own copy, and the agent's caret follows them", () => {
  const doc = script(), p = paraOf(doc);
  const now = new Date("2026-10-28T12:00:00Z");
  const a1 = D.makeAsk(doc, { blockId: p.id, start: 3, end: 8, action: "simpler", by: { id: "lex", name: "Lex" }, now });
  const a2 = D.makeAsk(doc, { blockId: p.id, start: 15, end: 29, action: "shorter", by: { id: "a-ana", name: "Ana" }, now });
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
  // Named and drawn as its model, no "(agent)" (Lex, 2026-10-28); old asks named "Claude Code" map too.
  assert.deepEqual(agentCaret([a1, a2], doc), { pid: "agent", kind: "agent", name: "Claude", icon: "ai-claude", colour: null, blockId: p.id, offset: 8, undo: false, askId: a1.id });
  a2.status = "answered"; a2.answer = { kind: "replace", text: "Go on." }; a2.answeredBy = { id: "agent:x", name: "Codex" };
  assert.equal(agentCaret([a1, a2], doc).offset, 8, "the ask it works on wins");
  a1.status = "kept";
  assert.deepEqual([agentCaret([a1, a2], doc).offset, agentCaret([a1, a2], doc).name, agentCaret([a1, a2], doc).icon], [29, "Codex", "ai-openai"]);
  a2.answeredBy = { id: "agent:my-tool", name: "My Tool" };
  assert.deepEqual([agentCaret([a1, a2], doc).name, agentCaret([a1, a2], doc).icon], ["My Tool", "ai-sparkle"], "an unknown agent keeps its name, with the sparkle");
  a2.answeredBy = null;
  assert.deepEqual([agentCaret([a1, a2], doc).name, agentCaret([a1, a2], doc).icon], ["Agent", "ai-sparkle"]);
  a2.answeredBy = { id: "agent:codex", name: "Codex" };
  a2.status = "undone";
  assert.equal(agentCaret([a1, a2], doc), null, "gone after Keep or Undo");
  a2.status = "answered"; a2.answer = { kind: "broll", changes: [] };
  assert.equal(agentCaret([a2], doc), null, "B-roll suggestions live beside the lines");
});

test("adapter: the host's ask desk answers every ref, and a repeat gets the same answer, done once", () => {
  const doc = script(), p = paraOf(doc);
  const asks = [], sent = [], acts = [];
  const people = new Map([["g1", { asker: "a-ana", name: "Ana" }], ["g2", { name: "No secret" }]]);
  const desk = createAskDesk({
    people: () => people, sendTo: (pid, m) => sent.push([pid, m]), doc: () => doc, asks: () => asks,
    add: (spec, by) => asks.push({ ...D.makeAsk(doc, { ...spec, by }) }), act: (id, act, asker) => acts.push([id, act, asker]),
  });
  const gone = { type: "ask", from: "g1", ref: "r1", ask: { blockId: p.id, start: 0, quote: "not here", action: "simpler" } };
  desk(gone);
  desk(gone); // sent again after the room was away
  assert.deepEqual(sent, [["g1", { type: "ask-refused", ref: "r1", reason: "changed" }], ["g1", { type: "ask-refused", ref: "r1", reason: "changed" }]], "the refusal is answered again, not turned into ack");
  const ok = { type: "ask", from: "g1", ref: "r2", ask: { blockId: p.id, start: 3, quote: "start", action: "simpler" } };
  desk(ok);
  desk(ok);
  assert.equal(asks.length, 1, "done once");
  assert.deepEqual(sent.slice(2).map(([, m]) => m.type), ["ask-ack", "ask-ack"]);
  desk({ type: "ask", from: "g1", ref: "r3", id: asks[0].id, act: "undo" });
  assert.deepEqual(acts, [[asks[0].id, "undo", "a-ana"]]);
  // A tab without a secret (no asker id) hears back too, and nothing is done.
  desk({ type: "ask", from: "g2", ref: "r1", ask: ok.ask });
  assert.deepEqual(sent.at(-1), ["g2", { type: "ask-refused", ref: "r1", reason: "unknown" }]);
  assert.equal(asks.length, 1);
  desk({ type: "ask", from: "g1", ask: ok.ask });
  assert.equal(sent.length, 6, "a message without a ref gets no answer");
});

test("shareAsks: guests get waiting pictures without the image (step K); the host's asks stay as they are", () => {
  const pic = "data:image/jpeg;base64,/9j/AA==";
  const svg = '<svg viewBox="0 0 260 140"><path class="s" d="M0 0L9 9"/></svg>';
  const sketch = { id: "s1", scope: "broll", action: "sketch", status: "answered", shots: [{ id: "B1" }, { id: "B2" }], answer: { kind: "sketches", sketches: { B1: pic, B2: svg }, done: {} } };
  const add = { id: "p1", scope: "broll", action: "plan", status: "answered", answer: { kind: "broll", changes: [{ op: "add", kind: "broll", what: "x", over: "y", sketch: pic, state: "open" }] } };
  const before = JSON.stringify([sketch, add]);
  const shared = shareAsks([sketch, add], D.parse("# T\n\nHello.\n"));
  assert.ok(!JSON.stringify(shared).includes("data:"));
  assert.deepEqual(shared[0].answer.sketches, { B2: svg });
  assert.deepEqual(shared[0].answer.done, {}, "the shot waits for its sketch again");
  assert.equal(JSON.stringify([sketch, add]), before);
});
