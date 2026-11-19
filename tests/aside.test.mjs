import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// TOOLS-358: while the person writes one script, their agent works on others. A script left while the agent still
// works in it is kept aside (public/aside.js): the agent's answer lands there, and the file-name menu says so.
// The scripts here are made up.
const Doc = await import("../public/doc.js");
const Changes = await import("../public/changes.js");
const Aside = await import("../public/aside.js");

const BREAD = "# Bread at home\n\n## 1 · Hook (0:00–0:10)\n\nGood bread needs four things: flour, water, salt and time.\n\n## 2 · The mix (0:10–0:30)\n\nThen you cover the bowl with a plate and you simply leave it alone for the whole night. That is all there is to it.\n";
const WALK = "# A walk before breakfast\n\n## 1 · Hook\n\nWhat if the best part of your day is over before breakfast?\n";
const me = { id: "me", name: "You" };
const agent = { id: "agent:claude", name: "Claude" };

function askOn(doc, quote, action = "shorter") {
  const b = doc.blocks.find((x) => Doc.contentOf(x).includes(quote));
  const start = Doc.contentOf(b).indexOf(quote);
  const ask = Doc.makeAsk(doc, { blockId: b.id, start, end: start + quote.length, action, by: me });
  ask.status = "taken";
  return ask;
}
function leaveBread(asks = null) {
  const doc = Doc.parse(BREAD);
  const list = asks ? asks(doc) : [askOn(doc, "Then you cover the bowl with a plate and you simply leave it alone for the whole night.")];
  return Aside.leave({ handle: { name: "bread.md" }, name: "bread.md", browser: true, doc, asks: list, undo: [], redo: [], savedText: BREAD, fileModified: 5, place: { y: 120, caret: null } });
}
const answerTo = (s, ask, args) => Doc.checkAnswer(ask, args, s.doc).answer;

test("aside: a script is kept aside only while its agent works in it or it holds a change not seen yet", () => {
  const doc = Doc.parse(BREAD);
  const base = { handle: { name: "bread.md" }, name: "bread.md", doc, undo: [], redo: [], savedText: BREAD, fileModified: 0, place: null };
  assert.equal(Aside.leave({ ...base, asks: [] }), null, "nothing going on");
  assert.equal(Aside.leave({ ...base, handle: null, asks: [askOn(doc, "flour")] }), null, "no file to write the answer to");
  const broll = askOn(doc, "flour", "broll");
  assert.equal(Aside.leave({ ...base, asks: [broll] }), null, "B-roll asks stay with the open script");
  const waiting = askOn(doc, "flour");
  waiting.status = "waiting";
  const s = Aside.leave({ ...base, asks: [waiting] });
  assert.equal(Aside.status(s), "working");
  assert.equal(Aside.status(Aside.leave({ ...base, asks: [], unseen: ["x"] })), "done");
});

test("aside: the agent's replace lands in the script kept aside, lightly marked, as one undo step; the open script is not touched", () => {
  const open = Doc.parse(WALK), openBefore = Doc.serialize(open);
  const s = leaveBread();
  const ask = s.asks[0];
  const clean = answerTo(s, ask, { kind: "replace", text: "Cover the bowl and leave it overnight." });
  const r = Aside.answer(s, ask, clean, agent, 1_000);
  assert.deepEqual({ ok: r.ok, landed: r.landed }, { ok: true, landed: true });
  assert.match(Doc.serialize(s.doc), /Cover the bowl and leave it overnight\. That is all there is to it\./);
  assert.ok(Changes.isMarked(ask), "lightly marked, with Undo on the agent's tag once the person is back");
  assert.equal(ask.answeredBy.name, "Claude");
  assert.equal(s.undo.length, 1);
  assert.deepEqual(s.undo[0].land, { id: ask.id, status: "undone" });
  assert.equal(Doc.serialize(s.undo[0].doc), BREAD, "the undo step holds the script from before");
  assert.deepEqual(s.redo, []);
  assert.equal(Aside.status(s), "done");
  assert.deepEqual([...s.unseen], [ask.id]);
  assert.equal(Doc.serialize(open), openBefore, "nothing moves in the open script");
  // Undo on the agent's tag, once the person is back, puts the old words back.
  assert.ok(Changes.undo(s.doc, ask));
  assert.equal(Doc.serialize(s.doc), BREAD);
});

test("aside: other open asks and earlier marks in the same paragraph follow the change", () => {
  const s = leaveBread((doc) => [askOn(doc, "That is all there is to it."), askOn(doc, "Then you cover the bowl with a plate")]);
  const [later, first] = s.asks;
  Aside.answer(s, later, answerTo(s, later, { kind: "replace", text: "That's all." }), agent, 1_000);
  assert.ok(Changes.isMarked(later));
  assert.equal(Aside.status(s), "working", "one ask is still being worked on");
  const r = Aside.answer(s, first, answerTo(s, first, { kind: "replace", text: "Cover the bowl" }), agent, 2_000);
  assert.ok(r.landed);
  const content = Doc.contentOf(Doc.blockById(s.doc, later.blockId));
  assert.equal(content.slice(later.start, later.end), "That's all.", "the earlier mark moved with the second change");
  assert.ok(Changes.isMarked(later) && Changes.isMarked(first));
  assert.equal(Aside.status(s), "done");
  assert.equal(s.undo.length, 2);
  assert.equal(Aside.firstUnseen(s), first.id, "the change nearest the top is where the script opens");
});

test("aside: an ask whose text is gone is cancelled, and a note waits beside its text", () => {
  const s = leaveBread((doc) => [askOn(doc, "flour, water, salt", "explain"), askOn(doc, "leave it alone")]);
  const [note, gone] = s.asks;
  const block = Doc.blockById(s.doc, gone.blockId);
  Doc.setContent(s.doc, block.id, "Rest the dough.");
  const goneAnswer = Doc.checkAnswer(gone, { kind: "replace", text: "Leave it." }, s.doc).answer;
  assert.equal(Aside.answer(s, gone, goneAnswer, agent, 1_000).ok, false);
  assert.equal(gone.status, "cancelled");
  assert.equal(Aside.status(s), "working");
  const r = Aside.answer(s, note, answerTo(s, note, { kind: "note", text: "Four ingredients, nothing else." }), agent, 1_000);
  assert.deepEqual({ ok: r.ok, landed: r.landed }, { ok: true, landed: false });
  assert.equal(note.status, "answered");
  assert.equal(Aside.status(s), "done");
  assert.equal(s.undo.length, 0, "a note changes no text");
});

test("aside: seen changes clear the dot; an ask the agent has not seen is offered, a taken one again after two minutes", () => {
  const s = leaveBread((doc) => [askOn(doc, "flour"), askOn(doc, "salt")]);
  s.asks[0].status = "waiting";
  s.asks[1].takenAt = new Date(0).toISOString();
  const now = 60_000;
  assert.deepEqual(Aside.pending([s], now, 120_000).map((x) => x.ask.id), [s.asks[0].id]);
  assert.deepEqual(Aside.pending([s], 200_000, 120_000).map((x) => x.ask.id), s.asks.map((a) => a.id));
  assert.equal(Aside.findAsk([s], s.asks[1].id).aside, s);
  assert.equal(Aside.findAsk([s], "nope"), null);
  s.unseen.add("x");
  Aside.seen(s, ["x"]);
  assert.equal(s.unseen.size, 0);
});

test("aside: each script keeps its caret by line and offset, also when it is read from its file again", () => {
  const doc = Doc.parse(BREAD);
  const b = doc.blocks[4];
  const place = Aside.caretPlace(doc, { id: b.id, offset: 7 });
  assert.deepEqual(place, { index: 4, offset: 7 });
  const again = Doc.parse(BREAD);
  assert.deepEqual(Aside.caretAt(again, place), { id: again.blocks[4].id, offset: 7 });
  assert.equal(Aside.caretAt(again, { index: 99, offset: 1 }), null);
  assert.deepEqual(Aside.caretAt(again, { index: 0, offset: 999 }), { id: again.blocks[0].id, offset: Doc.contentOf(again.blocks[0]).length });
  assert.equal(Aside.caretPlace(doc, null), null);
  assert.equal(Aside.caretPlace(doc, { id: "gone", offset: 1 }), null);
});

// The look follows the prototype Lex approved (tools-356-several-scripts.html, final state).
test("aside: the done dot is bigger than the not-saved dot and sits at the file name's corner; the menu row says it in words", () => {
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(css, /\.ai-dot \{[^}]*inline-size: 0\.62rem;[^}]*background: var\(--accent\)/);
  assert.match(css, /\.doc__title \.ai-dot \{[^}]*translate: 0 -0\.38rem;/);
  assert.match(css, /\.save-state\[data-state="dirty"\] \{ inline-size: 7px;/);
  assert.match(html, /<span class="doc__title"><span class="doc__name" id="fileName"><\/span><span data-icon="chevron"><\/span><span class="ai-dot" id="aiDot" role="img" aria-label="AI done in another script" hidden><\/span><\/span>/);
  assert.match(app, /"AI working"/);
  assert.match(app, /"AI done"/);
  assert.match(css, /prefers-reduced-motion: no-preference\) \{[^}]*\.scripts__spin \{ animation/);
});
