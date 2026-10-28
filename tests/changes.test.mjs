// Step F: the agent's replace and add answers go straight into the text, lightly marked, with Undo on its name tag.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../public/doc.js";
import * as C from "../public/changes.js";
import { agentCaret, shareAsks, fitAsks, guestMayAct, mayAct, readBlocks } from "../public/together-adapter.js";
import { diff } from "../public/together/ops.js";

const script = () => D.parse("# Title\n\n## 1 · Hook\n\nWe start here. Then we go on.\n\nA second line.\n\n[ON SCREEN: a note]\n");
const paras = (doc) => doc.blocks.filter((b) => b.type === "para");
const text = (doc, id) => D.contentOf(D.blockById(doc, id));
const answered = (doc, blockId, quote, answer, by = { id: "lex", name: "Lex" }) => {
  const start = text(doc, blockId).indexOf(quote);
  const ask = D.makeAsk(doc, { blockId, start, end: start + quote.length, action: "simpler", by });
  return Object.assign(ask, { status: "answered", answer, answeredBy: { id: "agent:claude-code", name: "Claude Code" } });
};
// What the editor does: apply, let the other marks follow this change, then mark it.
function landIn(doc, asks, ask, now) {
  const before = C.blocksOf(doc);
  const res = C.land(doc, ask, now);
  if (res) { C.follow(asks, before, C.blocksOf(doc)); C.setMark(ask, res.mark); }
  return res;
}
// An edit by the person, and the marks following it.
function edit(doc, asks, id, content, caret = null) {
  const before = C.blocksOf(doc);
  D.setContent(doc, id, content);
  return C.follow(asks, before, C.blocksOf(doc), { caret });
}

test("straight in: replace puts the new text in place, as one change, and marks exactly it", () => {
  const doc = script(), p = paras(doc)[0];
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin right here" });
  const before = readBlocks(doc);
  const res = landIn(doc, [ask], ask, 1000);
  assert.equal(text(doc, p.id), "We begin right here. Then we go on.");
  assert.equal(ask.status, "kept", "the agent's list_asks says kept at once");
  assert.deepEqual([ask.start, ask.end], [3, 19]);
  assert.deepEqual(ask.change, { text: "begin right here", removed: "start here", at: 1000 });
  assert.ok(C.isMarked(ask));
  assert.equal(diff(before, readBlocks(doc)).length, 1, "one change (one undo step, one operation for the room)");
  assert.equal(res.delta, 6);
});

test("straight in: add goes after the quote with its spaces, and Undo takes exactly that out again", () => {
  const doc = script(), p = paras(doc)[0];
  const original = D.serialize(doc);
  const ask = answered(doc, p.id, "start here.", { kind: "add", text: "It is easy." });
  landIn(doc, [ask], ask, 1);
  assert.equal(text(doc, p.id), "We start here. It is easy. Then we go on.");
  assert.equal(ask.change.text, " It is easy.", "the space it brought is part of the change");
  assert.deepEqual(C.markRange(ask), { start: 15, end: 26 }, "the tint leaves the space out");
  const back = C.undo(doc, ask);
  assert.deepEqual(back, { blockId: p.id, at: 26, delta: -12 });
  assert.equal(D.serialize(doc), original, "the exact text comes back");
  // In the middle of a word run, add brings a space on each side, and Undo takes both.
  const mid = answered(doc, p.id, "We start", { kind: "add", text: "really" });
  landIn(doc, [mid], mid, 2);
  assert.equal(text(doc, p.id), "We start really here. Then we go on.");
  assert.equal(mid.change.text, " really");
  C.undo(doc, mid);
  assert.equal(D.serialize(doc), original, "the exact text comes back");
  assert.equal(ask.status, "undone");
  assert.ok(!C.isMarked(ask));
  assert.equal(C.undo(doc, ask), null, "only once");
});

test("straight in: replace undone gives back the exact text; refused when the quote changed", () => {
  const doc = script(), p = paras(doc)[0];
  const original = D.serialize(doc);
  const ask = answered(doc, p.id, "Then we go on.", { kind: "replace", text: "Next." });
  landIn(doc, [ask], ask, 1);
  assert.equal(text(doc, p.id), "We start here. Next.");
  C.undo(doc, ask);
  assert.equal(D.serialize(doc), original);
  // The quote was edited away before the answer came: nothing changes and the ask stays as it was.
  const late = answered(doc, p.id, "start here", { kind: "replace", text: "x" });
  D.setContent(doc, p.id, "We begin. Then we go on.");
  const was = D.serialize(doc);
  assert.equal(C.land(doc, late), null);
  assert.equal(D.serialize(doc), was);
  assert.equal(late.status, "answered");
});

test("straight in: notes, the script-wide marks and B-roll don't go into the text", () => {
  const doc = script(), p = paras(doc)[0];
  const was = D.serialize(doc);
  const note = answered(doc, p.id, "start here", { kind: "note", text: "Fine.", tone: "ok" });
  assert.ok(!C.goesStraightIn(note, note.answer));
  assert.equal(C.land(doc, note), null);
  const voice = Object.assign(D.makeAsk(doc, { scope: "script", action: "voice", by: { id: "lex" } }), { status: "answered", answer: { kind: "marks", marks: [] } });
  assert.ok(!C.goesStraightIn(voice, { kind: "replace", text: "x" }), "script scope never");
  const broll = answered(doc, p.id, "start here", { kind: "broll", changes: [] });
  assert.equal(C.land(doc, broll), null);
  assert.equal(D.serialize(doc), was);
  assert.equal(note.status, "answered");
});

test("straight in: an answer that makes new paragraphs still goes in, unmarked", () => {
  const doc = script(), p = paras(doc)[0];
  const ask = answered(doc, p.id, "We start here.", { kind: "add", text: "\n\nA new paragraph." });
  const res = landIn(doc, [ask], ask, 1);
  assert.equal(res.mark, null);
  assert.equal(ask.status, "kept");
  assert.ok(!C.isMarked(ask));
  assert.ok(D.serialize(doc).includes("We start here.\n\nA new paragraph. Then we go on."));
});

test("marks: follow edits before them, stay outside typing at their edges, vanish on an edit inside", () => {
  const doc = script(), [p, q] = paras(doc);
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin" });
  const asks = [ask];
  landIn(doc, asks, ask, 1);
  assert.equal(text(doc, p.id), "We begin. Then we go on.");
  // Typing before it, in the same line: it moves.
  assert.deepEqual([...edit(doc, asks, p.id, "So we begin. Then we go on.", { blockId: p.id, offset: 3 })], [p.id]);
  assert.deepEqual([ask.start, ask.end], [6, 11]);
  // Another line, and typing right after it: it stays as it is.
  assert.equal(edit(doc, asks, q.id, "A second line, changed.").size, 0);
  edit(doc, asks, p.id, "So we begin now. Then we go on.", { blockId: p.id, offset: 15 });
  assert.deepEqual([ask.start, ask.end, C.isMarked(ask)], [6, 11, true]);
  // Typing right before it, at its first letter (the caret says where the edit really was).
  edit(doc, asks, p.id, "So we bbegin now. Then we go on.", { blockId: p.id, offset: 7 });
  assert.deepEqual([ask.start, ask.end, C.isMarked(ask)], [7, 12, true]);
  // An edit inside it: the mark (and its Undo) goes; the ask stays kept.
  edit(doc, asks, p.id, "So we bbeGin now. Then we go on.", { blockId: p.id, offset: 10 });
  assert.ok(!C.isMarked(ask));
  assert.equal(ask.status, "kept");
  assert.equal(C.undo(doc, ask), null, "no Undo once it was edited");
});

test("marks: follow Enter before them into the new line, and a join back", () => {
  const doc = script(), p = paras(doc)[0];
  const ask = answered(doc, p.id, "Then we go on.", { kind: "replace", text: "Next, more." });
  const asks = [ask];
  landIn(doc, asks, ask, 1);
  let before = C.blocksOf(doc);
  const next = D.splitBlock(doc, p.id, 15);
  C.follow(asks, before, C.blocksOf(doc));
  assert.deepEqual([ask.blockId, ask.start, ask.end], [next.id, 0, 11]);
  before = C.blocksOf(doc);
  D.mergeWithPrevious(doc, next.id);
  C.follow(asks, before, C.blocksOf(doc));
  assert.deepEqual([ask.blockId, ask.start, ask.end, C.isMarked(ask)], [p.id, 15, 26, true]);
  assert.equal(text(doc, p.id).slice(ask.start, ask.end), "Next, more.");
});

test("the agent's caret: at the newest marked change with Undo; Undo moves it to the one before, then it leaves", () => {
  const doc = script(), [p, q] = paras(doc);
  const host = (a) => mayAct(a, { host: true });
  const first = answered(doc, p.id, "start here", { kind: "replace", text: "begin" });
  const second = answered(doc, q.id, "second", { kind: "replace", text: "next" });
  const asks = [first, second];
  landIn(doc, asks, first, 1);
  landIn(doc, asks, second, 2);
  let c = agentCaret(asks, doc, host);
  assert.deepEqual([c.blockId, c.offset, c.undo, c.askId, c.name], [q.id, 6, true, second.id, "Claude"]);
  assert.equal(agentCaret(asks, doc).undo, false, "no Undo without the right to it");
  C.undo(doc, D.blockById(doc, q.id) && asks.find((a) => a.id === c.askId));
  assert.equal(text(doc, q.id), "A second line.");
  c = agentCaret(asks, doc, host);
  assert.deepEqual([c.blockId, c.offset, c.askId], [p.id, 8, first.id]);
  C.undo(doc, first);
  assert.equal(agentCaret(asks, doc, host), null, "it leaves when no change is marked");
  assert.deepEqual(asks.map((a) => a.status), ["undone", "undone"]);
  // While the agent works on another ask, its caret is there, without Undo.
  const third = answered(doc, p.id, "start here", { kind: "replace", text: "go" });
  landIn(doc, asks, third, 3);
  const working = { ...D.makeAsk(doc, { blockId: q.id, start: 0, end: 1, action: "shorter", by: { id: "lex" } }), status: "taken", takenBy: { id: "agent:codex", name: "Codex" } };
  c = agentCaret([...asks, third, working], doc, host);
  assert.deepEqual([c.blockId, c.undo, c.askId], [q.id, false, working.id]);
});

test("shared: a guest's asked change is shared marked, undone by that guest or the host, not by another guest", () => {
  const doc = script(), p = paras(doc)[0];
  const ana = { id: "a-ana", name: "Ana" };
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin" }, ana);
  landIn(doc, [ask], ask, 5);
  const shared = shareAsks([ask]);
  assert.equal(shared.length, 1, "a marked change is shared like an open ask");
  assert.ok(C.isMarked(shared[0]));
  // The guest typed in front of it: the mark is found again by its text.
  const guest = D.cloneDoc(doc);
  D.setContent(guest, p.id, "Yes. " + text(doc, p.id));
  const placed = fitAsks(shared, guest);
  assert.deepEqual([placed[0].start, placed[0].end], [8, 13]);
  const forAna = agentCaret(placed, guest, (a) => mayAct(a, { id: "a-ana" }));
  const forBen = agentCaret(placed, guest, (a) => mayAct(a, { id: "a-ben" }));
  assert.deepEqual([forAna.undo, forBen.undo], [true, false], "Ben sees the mark and the caret, without Undo");
  assert.ok(guestMayAct(ask, "undo", "a-ana"));
  assert.ok(!guestMayAct(ask, "undo", "a-ben"));
  // Undone by the host for Ana: no longer shared.
  C.undo(doc, ask);
  assert.equal(shareAsks([ask]).length, 0);
  assert.ok(!guestMayAct(ask, "undo", "a-ana"));
  // A change the guest's copy doesn't have is left out there.
  const other = answered(doc, p.id, "go on", { kind: "replace", text: "carry on" });
  landIn(doc, [other], other, 6);
  assert.equal(fitAsks(shareAsks([other]), script()).length, 0);
});

test("after a reload: a marked change kept with the draft is found again by its text", () => {
  const doc = script(), p = paras(doc)[0];
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin" });
  landIn(doc, [ask], ask, 1);
  const saved = JSON.parse(JSON.stringify(ask));
  const reopened = D.parse(D.serialize(doc)); // ids are new
  assert.ok(C.place(saved, reopened));
  const b = paras(reopened)[0];
  assert.deepEqual([saved.blockId, saved.start, saved.end], [b.id, 3, 8]);
  C.undo(reopened, saved);
  assert.equal(D.serialize(reopened), D.serialize(script()));
});
