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

test("one paragraph: blank lines in an answer become one space; it stays in its block, marked and undoable", () => {
  const doc = script(), p = paras(doc)[0];
  const original = D.serialize(doc);
  const ask = answered(doc, p.id, "We start here.", D.cleanAnswer({ scope: "selection" }, { kind: "add", text: "\n\nA new paragraph." }));
  assert.equal(ask.answer.text, " A new paragraph.");
  const res = landIn(doc, [ask], ask, 1);
  assert.ok(res.mark && C.isMarked(ask), "marked, with Undo");
  assert.equal(text(doc, p.id), "We start here. A new paragraph. Then we go on.");
  assert.equal(doc.blocks.length, script().blocks.length, "no new block");
  C.undo(doc, ask);
  assert.equal(D.serialize(doc), original);
  // Several blank lines in the middle become one space; single line breaks stay.
  assert.equal(D.cleanAnswer({ scope: "selection" }, { kind: "replace", text: "One.\r\n\r\n \n\nTwo\nthree." }).text, "One. Two\nthree.");
  const two = answered(doc, p.id, "start here", D.cleanAnswer({ scope: "selection" }, { kind: "replace", text: "go\nslowly" }));
  landIn(doc, [two], two, 2);
  assert.equal(text(doc, p.id), "We go\nslowly. Then we go on.");
  assert.ok(C.isMarked(two));
  assert.equal(D.blockById(doc, p.id).type, "para");
});

test("one paragraph: an answer that would change the block's type goes in on one line, without the marks at its start", () => {
  const cases = [
    ["We start here.", "## Big news.", "Big news. Then we go on."],
    ["We start here.", "- one\n- two", "one - two Then we go on."],
    ["We start here.", "# A title", "A title Then we go on."],
    ["We start here. Then we go on.", "[ON SCREEN: a map]", "ON SCREEN: a map"],
    ["We start here.", "1. First", "First Then we go on."],
    ["We start here.", "## 2.5 million.", "2.5 million. Then we go on."],
    ["We start here.", "## #1 tip.", "#1 tip. Then we go on."],
  ];
  for (const [quote, given, want] of cases) {
    const doc = script(), p = paras(doc)[0];
    const ask = answered(doc, p.id, quote, { kind: "replace", text: given });
    assert.ok(C.fits(doc, ask, ask.answer), given);
    landIn(doc, [ask], ask, 1);
    assert.equal(text(doc, p.id), want, given);
    assert.equal(D.blockById(doc, p.id).type, "para", given);
    assert.ok(C.isMarked(ask), given);
    assert.equal(D.parse(D.serialize(doc)).blocks.length, script().blocks.length, given);
  }
  // In a heading a line break becomes a space.
  const doc = script(), head = doc.blocks.find((b) => b.type === "heading");
  const ask = answered(doc, head.id, "Hook", { kind: "replace", text: "Hook\nand more" });
  landIn(doc, [ask], ask, 1);
  assert.deepEqual([text(doc, head.id), D.blockById(doc, head.id).type, C.isMarked(ask)], ["1 · Hook and more", "heading", true]);
  // A note that would lose its brackets can't keep its type: refused, nothing changes.
  const doc2 = script(), note = doc2.blocks.find((b) => b.type === "note");
  const was = D.serialize(doc2);
  const bad = answered(doc2, note.id, "a note]", { kind: "replace", text: "x" });
  assert.equal(C.fits(doc2, bad, bad.answer), false);
  assert.equal(C.land(doc2, bad), null);
  assert.equal(D.serialize(doc2), was);
  // A text of only marks has nothing left: refused too.
  const doc3 = script(), p3 = paras(doc3)[0];
  const marks = answered(doc3, p3.id, "We start here.", { kind: "replace", text: "## " });
  assert.equal(C.land(doc3, marks), null);
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
  const shared = shareAsks([ask], doc);
  assert.equal(shared.length, 1, "a marked change is shared like an open ask");
  assert.ok(C.isMarked(shared[0]));
  assert.deepEqual(shared[0].change.ctx, { index: 2, before: "We ", after: ". Then we go on." });
  // The guest's copy has it at its exact place.
  const guest = D.cloneDoc(doc);
  const shown = fitAsks(structuredClone(shared), guest);
  assert.deepEqual([shown[0].start, shown[0].end], [3, 8]);
  // The guest typed in front of it: the host's place no longer matches, but the guest's own copy of the mark
  // followed that typing exactly, so it stays there.
  const beforeTyping = C.blocksOf(guest);
  D.setContent(guest, p.id, "Yes. " + text(doc, p.id));
  C.follow(shown, beforeTyping, C.blocksOf(guest));
  assert.equal(fitAsks(structuredClone(shared), guest).length, 0, "not guessed from the text alone");
  const placed = fitAsks(structuredClone(shared), guest, shown);
  assert.deepEqual([placed[0].start, placed[0].end], [8, 13]);
  const forAna = agentCaret(placed, guest, (a) => mayAct(a, { id: "a-ana" }));
  const forBen = agentCaret(placed, guest, (a) => mayAct(a, { id: "a-ben" }));
  assert.deepEqual([forAna.undo, forBen.undo], [true, false], "Ben sees the mark and the caret, without Undo");
  assert.ok(guestMayAct(ask, "undo", "a-ana"));
  assert.ok(!guestMayAct(ask, "undo", "a-ben"));
  // Undone by the host for Ana: no longer shared.
  C.undo(doc, ask);
  assert.equal(shareAsks([ask], doc).length, 0);
  assert.ok(!guestMayAct(ask, "undo", "a-ana"));
  // A change the guest's copy doesn't have is left out there.
  const other = answered(doc, p.id, "go on", { kind: "replace", text: "carry on" });
  landIn(doc, [other], other, 6);
  assert.equal(fitAsks(shareAsks([other], doc), script()).length, 0);
});

test("shared: a guest's copy with the same text elsewhere shows no mark rather than a wrong one", () => {
  const doc = script(), [p, q] = paras(doc);
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin" });
  landIn(doc, [ask], ask, 5);
  const shared = shareAsks([ask], doc);
  // The guest's copy doesn't have the change yet, but has "begin" in the same block and in another one.
  const guest = D.cloneDoc(script());
  guest.blocks.forEach((b, i) => { b.id = doc.blocks[i].id; });
  D.setContent(guest, p.id, "Let us begin. We start here. Then we go on.");
  D.setContent(guest, q.id, "We begin. Then we go on.");
  assert.equal(fitAsks(structuredClone(shared), guest).length, 0);
  // Its block gone in the guest's copy: no mark either, even where the same words and context are elsewhere.
  const gone = D.cloneDoc(doc);
  gone.blocks.forEach((b) => { if (b.id === p.id) b.id = "other"; });
  assert.equal(fitAsks(structuredClone(shared), gone).length, 0);
  // Without its place written down (an old host), no mark.
  const bare = structuredClone(shared);
  delete bare[0].change.ctx;
  assert.equal(fitAsks(bare, D.cloneDoc(doc)).length, 0);
});

test("after a reload: a marked change kept with the draft comes back only at its exact place", () => {
  const doc = script(), p = paras(doc)[0];
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin" });
  landIn(doc, [ask], ask, 1);
  const [saved] = JSON.parse(JSON.stringify(C.withContext([ask], doc)));
  const reopened = D.parse(D.serialize(doc)); // ids are new
  assert.ok(C.place(saved, reopened, { byIndex: true }));
  const b = paras(reopened)[0];
  assert.deepEqual([saved.blockId, saved.start, saved.end], [b.id, 3, 8]);
  C.undo(reopened, saved);
  assert.equal(D.serialize(reopened), D.serialize(script()));
});

test("after a reload: with the same short text earlier, Undo changes back only the agent's copy", () => {
  const doc = D.parse("# Title\n\nWe go now. Then we go on.\n\nA line to go.\n");
  const p = paras(doc)[0];
  const ask = answered(doc, p.id, "Then we go on.", { kind: "replace", text: "go" });
  landIn(doc, [ask], ask, 1);
  assert.equal(text(doc, p.id), "We go now. go");
  const [saved] = JSON.parse(JSON.stringify(C.withContext([ask], doc)));
  const reopened = D.parse(D.serialize(doc));
  assert.ok(C.place(saved, reopened, { byIndex: true }));
  assert.deepEqual([saved.start, saved.end], [11, 13], "the agent's copy, not the earlier \"go\"");
  C.undo(reopened, saved);
  assert.equal(D.serialize(reopened), "# Title\n\nWe go now. Then we go on.\n\nA line to go.\n");
});

test("after Discard: a file that lacks the agent's text shows no mark; an old draft without its place neither", () => {
  const doc = script(), p = paras(doc)[0];
  const ask = answered(doc, p.id, "Then we go on.", { kind: "replace", text: "go" });
  landIn(doc, [ask], ask, 1);
  const [saved] = JSON.parse(JSON.stringify(C.withContext([ask], doc)));
  // The file on disk is the script from before the change: it has "go" in the same block, but not the agent's.
  const file = script();
  assert.equal(C.place(structuredClone(saved), file, { byIndex: true }), false);
  // A file whose blocks moved: the block at the change's place is another one.
  const moved = D.parse("# Title\n\nA new first line.\n\n## 1 · Hook\n\nWe start here. go\n");
  assert.equal(C.place(structuredClone(saved), moved, { byIndex: true }), false);
  // The file that has it (saved before the reload): placed.
  assert.ok(C.place(structuredClone(saved), D.parse(D.serialize(doc)), { byIndex: true }));
  const old = structuredClone(saved);
  delete old.change.ctx;
  assert.equal(C.place(old, D.parse(D.serialize(doc)), { byIndex: true }), false, "never guessed");
  assert.equal(old.change, undefined, "no Undo either");
});

test("no empty undo step: a land or Undo that can't happen changes nothing", () => {
  const doc = script(), p = paras(doc)[0];
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin" });
  D.setContent(doc, p.id, "We stop. Then we go on.");
  const was = D.serialize(doc);
  assert.equal(C.land(doc, ask), null);
  assert.equal(D.serialize(doc), was);
  const doc2 = script(), q = paras(doc2)[0];
  const ok = answered(doc2, q.id, "start here", { kind: "replace", text: "begin" });
  landIn(doc2, [ok], ok, 1);
  ok.end = ok.start + 2; // its text is no longer exactly there
  const was2 = D.serialize(doc2);
  assert.equal(C.undo(doc2, ok), null);
  assert.equal(D.serialize(doc2), was2);
});

test("a change of only spaces gets no mark", () => {
  const ask = { scope: "selection", status: "kept", blockId: "b", start: 0, end: 1, change: { text: " ", removed: "", at: 1 } };
  assert.equal(C.isMarked(ask), false);
  assert.equal(C.newestMarked([ask]), null);
});

test("Ctrl/Cmd+Z of a landing: undone; redo: kept, unmarked; Ctrl/Cmd+Z of a tag Undo: kept, unmarked", () => {
  const doc = script(), p = paras(doc)[0];
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin" });
  landIn(doc, [ask], ask, 1);
  // The landing step, undone.
  let step = C.landStep([ask], { id: ask.id, status: "undone" });
  assert.deepEqual(step.back, { id: ask.id, status: "kept" }, "redo says kept");
  assert.equal(step.closed, ask);
  assert.deepEqual([ask.status, ask.change], ["undone", undefined]);
  // Redone: kept, without a mark (Ctrl/Cmd+Z owns it now).
  step = C.landStep([ask], step.back);
  assert.deepEqual(step.back, { id: ask.id, status: "undone" });
  assert.deepEqual([ask.status, C.isMarked(ask)], ["kept", false]);
  // A tag Undo, then Ctrl/Cmd+Z of it: kept again, unmarked.
  const two = answered(doc, paras(doc)[1].id, "second", { kind: "replace", text: "next" });
  landIn(doc, [two], two, 2);
  C.undo(doc, two);
  step = C.landStep([ask, two], { id: two.id, status: "kept" });
  assert.deepEqual([two.status, C.isMarked(two), step.back.status], ["kept", false, "undone"]);
  // A step whose ask is in the same state, or gone, or open again, changes nothing.
  assert.equal(C.landStep([two], { id: two.id, status: "kept" }).closed, null);
  assert.deepEqual(C.landStep([], { id: "x", status: "kept" }), { back: null, closed: null });
  assert.deepEqual(C.landStep([ask], null), { back: null, closed: null });
});

test("the tab's answer_ask result says what happened, per kind", () => {
  assert.equal(C.answerResult("replace"), "Done: the change is in the text now. The person can undo it.");
  assert.equal(C.answerResult("add"), "Done: the change is in the text now. The person can undo it.");
  assert.equal(C.answerResult("note"), "Shown to the person.");
  assert.equal(C.answerResult("marks"), "Shown to the person. They choose Keep or Undo.");
});

// Step M: the mark goes away by itself, once scrolled past or 60 minutes after the change went in.
const MIN = 60 * 1000;
test("step M: a mark ends 60 minutes after it went in; the ask stays kept and the text untouched", () => {
  const doc = script(), p = paras(doc)[0];
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin" });
  const t0 = Date.UTC(2026, 9, 30, 9);
  landIn(doc, [ask], ask, t0);
  assert.equal(C.MARK_MS, 60 * MIN);
  assert.ok(!C.markExpired(ask, t0 + 59 * MIN));
  assert.deepEqual(C.endExpired([ask], t0 + 59 * MIN), [], "59 minutes: still marked");
  assert.ok(C.isMarked(ask));
  assert.ok(C.markExpired(ask, t0 + 61 * MIN));
  const after = D.serialize(doc);
  assert.deepEqual(C.endExpired([ask], t0 + 61 * MIN), [ask], "61 minutes: it says which ended");
  assert.ok(!C.isMarked(ask));
  assert.equal(ask.status, "kept", "list_asks still says kept");
  assert.equal(ask.change, undefined);
  assert.equal(D.serialize(doc), after, "the text is untouched");
  assert.equal(C.undo(doc, ask), null, "its Undo is gone with it");
  assert.equal(D.serialize(doc), after);
});

test("step M: a mark without its time (an old draft) counts its 60 minutes from when the tab read it", () => {
  const doc = script(), p = paras(doc)[0];
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin" });
  landIn(doc, [ask], ask, 1);
  delete ask.change.at;
  const read = Date.UTC(2026, 9, 30, 12);
  assert.deepEqual(C.endExpired([ask], read), [], "not ended when read");
  assert.equal(ask.change.at, read, "its time is when the tab read it");
  assert.deepEqual(C.endExpired([ask], read + 59 * MIN), []);
  assert.deepEqual(C.endExpired([ask], read + 61 * MIN), [ask]);
  // markExpired alone takes the time it was read.
  const old = { ...answered(doc, p.id, "go on", { kind: "replace", text: "go" }), status: "kept", change: { text: "go", removed: "go on" } };
  assert.ok(!C.markExpired(old, read + 59 * MIN, read));
  assert.ok(C.markExpired(old, read + 61 * MIN, read));
});

test("step M: read past only once it was on screen and its last line is above the middle", () => {
  const view = { top: 56, bottom: 856 }; // the middle is at 456
  assert.ok(!C.readPast({ top: 500, bottom: 540 }, view, true), "below the middle: stays");
  assert.ok(!C.readPast({ top: 420, bottom: 456 }, view, true), "its last line on the middle: stays");
  assert.ok(!C.readPast({ top: 400, bottom: 480 }, view, true), "its last line still below the middle: stays");
  assert.ok(C.readPast({ top: 300, bottom: 340 }, view, true), "above the middle: read past");
  assert.ok(C.readPast({ top: -400, bottom: -360 }, view, true), "scrolled off the top after it was seen: read past");
  assert.ok(!C.readPast({ top: -400, bottom: -360 }, view, false), "never on screen: stays");
  assert.ok(!C.readPast({ top: 300, bottom: 340 }, view, false));
});

test("step M: after an end the agent's caret moves to the next newest mark, then leaves", () => {
  const doc = script(), [p, q] = paras(doc);
  const host = (a) => mayAct(a, { host: true });
  const first = answered(doc, p.id, "start here", { kind: "replace", text: "begin" });
  const second = answered(doc, q.id, "second", { kind: "replace", text: "next" });
  const asks = [first, second];
  landIn(doc, asks, first, 10 * MIN);
  landIn(doc, asks, second, 40 * MIN);
  assert.equal(C.newestMarked(asks), second);
  // Scrolled past alone: the newest ends for good.
  delete second.change;
  assert.equal(C.newestMarked(asks), first);
  assert.equal(agentCaret(asks, doc, host).askId, first.id);
  assert.deepEqual(C.endExpired(asks, 71 * MIN), [first], "the older one's 60 minutes");
  assert.equal(C.newestMarked(asks), null);
  assert.equal(agentCaret(asks, doc, host), null, "it leaves");
  assert.deepEqual(asks.map((a) => a.status), ["kept", "kept"]);
});

test("step M: in a shared script a guest's scroll past ends the mark for that guest only", () => {
  const doc = script(), [p, q] = paras(doc);
  const ana = { id: "a-ana", name: "Ana" };
  const older = answered(doc, q.id, "second", { kind: "replace", text: "next" }, ana);
  const ask = answered(doc, p.id, "start here", { kind: "replace", text: "begin" }, ana);
  const hostAsks = [older, ask];
  landIn(doc, hostAsks, older, 1);
  landIn(doc, hostAsks, ask, 2);
  const guest = D.cloneDoc(doc);
  const shown = fitAsks(shareAsks(hostAsks, doc), guest);
  const passed = new Set([ask.id]); // Ana scrolled past the newest
  const seen = C.seenAsks(shown, passed);
  assert.ok(!C.isMarked(seen.find((a) => a.id === ask.id)), "gone on Ana's screen");
  assert.ok(C.isMarked(shown.find((a) => a.id === ask.id)), "her copy of the asks keeps it");
  assert.equal(agentCaret(seen, guest, (a) => mayAct(a, { id: "a-ana" })).askId, older.id, "her agent's caret moves to the older one");
  assert.ok(C.isMarked(ask), "the host's ask is still marked");
  assert.equal(shareAsks(hostAsks, doc).length, 2, "and still shared with everyone");
  assert.equal(agentCaret(hostAsks, doc, (a) => mayAct(a, { host: true })).askId, ask.id, "the host still sees it, with Undo");
  assert.equal(C.seenAsks(shown, new Set()), shown, "nothing ended here: the same list");
});
