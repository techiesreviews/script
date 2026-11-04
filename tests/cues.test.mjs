// Cue marking (fleet issue #14, Lex 2026-11-04): a cue is "==words==" in a spoken paragraph. Optional and off by
// default; Ctrl/Cmd+B toggles it on the selected words; the agent lists, marks and unmarks cues; a rewrite keeps a
// cue only when its words survive; the prompter export strips cues unless the export setting says show.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../public/doc.js";
import * as C from "../public/changes.js";
import * as Q from "../public/cues.js";
import * as L from "../public/links.js";
import * as B from "../public/broll.js";
import { checkArgs, TOOLS, INSTRUCTIONS } from "../worker/mcp.js";

// Bold marking on for this file, unless a test says otherwise (Bold marking off: `whileOff`).
Q.readCuesWhen(() => true);
const whileOff = (fn) => { Q.readCuesWhen(() => false); try { return fn(); } finally { Q.readCuesWhen(() => true); } };
const sel = (content, words) => { const s = content.indexOf(words); return [s, s + words.length]; };

test("settings: off by default, highlight only, export strips; a script's own settings win over the person's", () => {
  assert.deepEqual(Q.CUE_DEFAULTS, { on: false, action: "highlight", export: "strip" });
  assert.deepEqual(Q.cueSettings(null, null), Q.CUE_DEFAULTS);
  assert.deepEqual(Q.cueSettings({ on: true }, null), { on: true, action: "highlight", export: "strip" });
  assert.deepEqual(Q.cueSettings({ on: true, export: "show" }, { on: false }), { on: false, action: "highlight", export: "show" });
  // Stored values that are not one of the choices are ignored.
  assert.deepEqual(Q.cueSettings({ on: "yes", action: "fly", export: 3 }, { bogus: 1 }), Q.CUE_DEFAULTS);
  assert.equal(Q.checkSettings({ on: true }), "");
  assert.match(Q.checkSettings({}), /at least one/);
  assert.match(Q.checkSettings({ on: "yes" }), /on must be true or false/);
  assert.match(Q.checkSettings({ action: "zoom" }), /action must be highlight or camera/);
  assert.match(Q.checkSettings({ export: "maybe" }), /export must be strip or show/);
  assert.match(Q.checkSettings({ on: true, colour: "red" }), /Unknown setting: colour/);
});

test("format: ==words== in a line; no brackets, = or line breaks inside; a letter or digit; not inside a link", () => {
  const c = "We ==start here== and [==go==](https://example.com) a == b == c, ===x=== and == ==.";
  const cues = Q.textCues(c);
  assert.deepEqual(cues.map((x) => x.label), ["start here"]);
  assert.deepEqual(cues[0], { start: 3, end: 17, words: { start: 5, end: 15 }, label: "start here", cue: true });
  assert.deepEqual(Q.textCues("==a\nb== ==[x]== ==1==").map((x) => x.label), ["1"]);
  assert.equal(Q.stripCues("We ==start here== now."), "We start here now.");
  // What is spoken and counted: the words, never the marks.
  assert.equal(Q.spokenWords("Say ==this== and [that](https://x.example)."), "Say this and that.");
  const doc = D.parse("# T\n\n## Intro\n\nSay ==this one== now.\n");
  assert.equal(D.stats(doc).words, 4);
  assert.equal(D.exportCamera(doc).includes("=="), false);
});

test("toggle: marks the selected words, a second toggle takes the marks off, the words stay", () => {
  const c = "We start here. Then we go on.";
  const on = Q.toggleCue(c, ...sel(c, "start here"));
  assert.deepEqual(on, { content: "We ==start here==. Then we go on.", start: 5, end: 15, cue: true, from: 3, to: 13 });
  const off = Q.toggleCue(on.content, on.start, on.end);
  assert.deepEqual(off, { content: c, start: 3, end: 13, cue: false, from: 3, to: 17 });
  // The whole cue selected with its marks showing (caret inside it) takes it off too.
  assert.equal(Q.toggleCue(on.content, 3, 17).content, c);
  // A part of the cue's words, inside it: the cue goes.
  assert.equal(Q.toggleCue(on.content, 5, 10).content, c);
  // Spaces at the ends of the selection stay outside the cue.
  assert.equal(Q.toggleCue(c, 2, 13).content, "We ==start here==. Then we go on.");
});

test("toggle: half a cue or across two joins into one cue; refuses links, line breaks and no words", () => {
  const c = "We ==start== here and ==go== on.";
  // From inside one cue to past it: one cue over both.
  const half = Q.toggleCue(c, c.indexOf("tart"), c.indexOf("here") + 4);
  assert.equal(half.content, "We ==start here== and ==go== on.");
  assert.equal(half.cue, true);
  // Across two cues.
  assert.equal(Q.toggleCue(c, c.indexOf("start"), c.indexOf("go") + 2).content, "We ==start here and go== on.");
  // A link in the way: nothing changes (null).
  const l = "Use [Claude](https://claude.ai) today.";
  assert.equal(Q.toggleCue(l, 0, l.length), null);
  assert.equal(Q.toggleCue("one\ntwo", 0, 7), null);
  assert.equal(Q.toggleCue("a , b", 2, 3), null);
  assert.equal(Q.toggleCue("a = b", 0, 5), null);
  assert.equal(Q.toggleCue("abc", 1, 1), null);
  assert.equal(Q.cueSelected(c, c.indexOf("start"), c.indexOf("start") + 5), true);
  assert.equal(Q.cueSelected(c, c.indexOf("here"), c.indexOf("here") + 4), false);
});

test("export: the prompter file strips cues unless the export setting says show", () => {
  const doc = D.parse("# T\n\n## Intro\n\nWe ==start here==. Then we go on.\n");
  assert.equal(D.exportPrompter(doc).includes("=="), false);
  assert.match(D.exportPrompter(doc), /We start here\./);
  assert.match(D.exportPrompter(doc, { cues: "show" }), /We ==start here==\./);
  assert.equal(D.exportPrompter(doc, { cues: "strip" }), D.exportPrompter(doc));
});

const script = () => D.parse("# Title\n\n## 1 · Hook\n\nWe start here. Then we go on and on.\n\nA ==second== line, we go.\n\n[ON SCREEN: start here]\n");
const paras = (doc) => doc.blocks.filter((b) => b.type === "para");

test("agent: list_cues lists each cue with its id, section and the words around it", () => {
  const doc = script();
  const [, p2] = paras(doc);
  assert.deepEqual(C.listCues(doc), [{ cueId: `${p2.id}:1:second`, quote: "second", section: "1 · Hook", before: "A ", after: " line, we go." }]);
});

test("agent: mark_cue marks the first free whole-word occurrence; skips what it can't mark, with the reason", () => {
  const doc = script();
  const [p1, p2] = paras(doc);
  const plan = C.planCues(doc, "mark", [{ quote: "go" }, { quote: "go", occurrence: 2 }, { quote: "second" }, { quote: "start here" }, { quote: "ON SCREEN" }, { quote: "nowhere" }, { quote: "a [b]" }, { quote: "an" }]);
  assert.deepEqual(plan.segments.map((s) => [s.id, s.content]), [[p1.id, "We ==start here==. Then we ==go== on and on."], [p2.id, "A ==second== line, we ==go==."]]);
  assert.deepEqual(plan.segments[0].cues, [{ quote: "start here" }, { quote: "go" }]);
  assert.deepEqual(plan.skipped, [
    { quote: "second", why: "already a cue" },
    { quote: "ON SCREEN", why: "in a heading or reminder, where cues don't go" },
    { quote: "nowhere", why: "not found word for word in the spoken text" },
    { quote: "a [b]", why: "cue words hold no brackets, = signs or line breaks" },
    { quote: "an", why: "not found word for word in the spoken text" },
  ]);
  // occurrence counts every whole-word match in reading order; the second "go" is in the second paragraph.
  assert.equal(plan.segments[1].from, plan.segments[1].content.indexOf("==go=="));
});

test("agent: mark_cue stays out of open asks; unmark_cue by quote or cueId keeps the words", () => {
  const doc = script();
  const [p1, p2] = paras(doc);
  const ask = D.makeAsk(doc, { blockId: p1.id, start: 3, end: 13, action: "simpler", by: { id: "lex", name: "Lex" } });
  const busy = C.planCues(doc, "mark", [{ quote: "start here" }], { asks: [ask] });
  assert.deepEqual(busy, { segments: [], skipped: [{ quote: "start here", why: "under an open ask or change" }] });
  const un = C.planCues(doc, "unmark", [{ cueId: `${p2.id}:1:second` }, { quote: "go" }, { cueId: "nope:1" }]);
  assert.deepEqual(un.segments.map((s) => s.content), ["A second line, we go."]);
  assert.deepEqual(un.skipped, [{ quote: "go", why: "no cue with these words" }, { quote: "nope:1", why: "no cue with this cueId" }]);
});

test("agent: landed cues are marked changes with Undo on the agent's name tag; Undo puts the text back", () => {
  const doc = script();
  const [p1] = paras(doc);
  const by = { id: "agent:claude-code", name: "Claude Code" };
  const plan = C.planCues(doc, "mark", [{ quote: "start here" }]);
  const parts = C.landCues(doc, plan, "mark", by, 1000);
  assert.equal(D.contentOf(p1), "We ==start here==. Then we go on and on.");
  assert.equal(parts.length, 1);
  const a = parts[0].ask;
  assert.equal(C.isMarked(a), true);
  assert.deepEqual([a.action, a.status, a.answeredBy, a.answer], ["cue", "kept", by, { kind: "cue", cues: [{ quote: "start here" }] }]);
  assert.deepEqual(C.markRange(a), { start: 3, end: 17 });
  C.undo(doc, a);
  assert.equal(D.contentOf(p1), "We start here. Then we go on and on.");
});

test("rewrite: a cue stays when its words survive the agent's new text; else it is dropped and the agent is told", () => {
  assert.deepEqual(Q.keepCues("We ==start here== now", "So we start here today"), { text: "So we ==start here== today", dropped: 0 });
  assert.deepEqual(Q.keepCues("We ==start here== now", "So we ==start here== today"), { text: "So we ==start here== today", dropped: 0 });
  assert.deepEqual(Q.keepCues("We ==start here== and ==go==", "We begin and go"), { text: "We begin and ==go==", dropped: 1 });
  assert.deepEqual(Q.keepCues("plain text", "new text"), { text: "new text", dropped: 0 });
  const doc = D.parse("# T\n\n## A\n\nWe ==start here== now. Then on.\n");
  const p = paras(doc)[0];
  const q = "We ==start here== now.";
  const ask = D.makeAsk(doc, { blockId: p.id, start: 0, end: q.length, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "We begin now." }, answeredBy: { id: "agent:x", name: "X" } });
  const res = C.land(doc, ask, 1);
  assert.equal(D.contentOf(p), "We begin now. Then on.");
  assert.equal(res.cuesDropped, 1);
  assert.match(C.answerResult("replace", { cuesDropped: 1 }), /removed 1 cue/);
  assert.doesNotMatch(C.answerResult("replace"), /cue/);
});

test("MCP: list_cues, mark_cue, unmark_cue and the cue settings, with their checks", () => {
  const names = TOOLS.map((t) => t.name);
  for (const n of ["list_cues", "mark_cue", "unmark_cue", "get_cue_settings", "set_cue_settings"]) assert.ok(names.includes(n), n);
  assert.equal(TOOLS.find((t) => t.name === "list_cues").annotations.readOnlyHint, true);
  assert.equal(TOOLS.find((t) => t.name === "get_cue_settings").annotations.readOnlyHint, true);
  assert.equal(checkArgs("mark_cue", { cues: [{ quote: "start here" }] }), "");
  assert.equal(checkArgs("mark_cue", { cues: [{ quote: "go", occurrence: 2 }] }), "");
  assert.match(checkArgs("mark_cue", { cues: [] }), /cues must be a list/);
  assert.match(checkArgs("mark_cue", { cues: Array(31).fill({ quote: "a" }) }), /At most 30/);
  assert.match(checkArgs("mark_cue", { cues: [{ quote: "" }] }), /needs quote/);
  assert.match(checkArgs("mark_cue", { cues: [{ quote: "a", occurrence: 0 }] }), /occurrence/);
  assert.match(checkArgs("mark_cue", { cues: [{ quote: "a", url: "x" }] }), /unknown field url/);
  assert.equal(checkArgs("unmark_cue", { cues: [{ cueId: "abc:1" }] }), "");
  assert.match(checkArgs("unmark_cue", { cues: [{}] }), /quote or cueId/);
  assert.match(checkArgs("unmark_cue", { cues: [{ quote: "a", cueId: "b:1" }] }), /not both/);
  assert.equal(checkArgs("set_cue_settings", { on: true, forScript: true }), "");
  assert.match(checkArgs("set_cue_settings", { action: "zoom" }), /action must be/);
  assert.match(checkArgs("set_cue_settings", { forScript: true }), /at least one/);
  assert.match(INSTRUCTIONS, /==words==/);
  assert.match(INSTRUCTIONS, /off by default/);
});

test("review: no stray == marks: a quote across a line break or next to an = sign is skipped, with the reason", () => {
  const doc = D.parse("# T\n\n## A\n\nWe start\nhere now, x=go and go=y.\n");
  const plan = C.planCues(doc, "mark", [{ quote: "start here" }, { quote: "go" }]);
  assert.deepEqual(plan.segments, []);
  assert.deepEqual(plan.skipped, [{ quote: "start here", why: "spans a line break" }, { quote: "go", why: "next to an = sign" }]);
  // A rewrite that splits the cue's words over two lines drops the cue instead of leaving broken marks.
  assert.deepEqual(Q.keepCues("We ==start here== now", "So we start\nhere today"), { text: "So we start\nhere today", dropped: 1 });
  // A cue never ends before a combining mark (half a letter).
  assert.deepEqual(C.planCues(D.parse("# T\n\n## A\n\nनमस्ते दोस्त\n"), "mark", [{ quote: "नमस" }]).segments, []);
});

test("review: links never land inside a cue; a rewrite whose cues would change the block keeps the text without them", () => {
  assert.deepEqual(L.planLinks([{ id: "p", content: "We ==go== now", from: 0, to: 13, cues: [[3, 9]] }], [{ quote: "go", url: "https://example.com" }]).skipped, [{ quote: "go", why: "inside a cue, where links don't go" }]);
  const doc = D.parse("# T\n\n## A\n\nWe ==start== now and ==go== on.\n");
  const p = paras(doc)[0];
  const ask = D.makeAsk(doc, { blockId: p.id, start: 0, end: D.contentOf(p).length, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "We start now and ==go== on." }, answeredBy: { id: "agent:x", name: "X" } });
  const res = C.land(doc, ask, 1);
  assert.equal(D.contentOf(p), "We ==start== now and ==go== on.");
  assert.equal(res.cuesDropped, 0);
});

test("review 2: Ctrl+B never cuts into an open ask; the toggle says which stretch it changes", () => {
  const doc = D.parse("# T\n\n## A\n\nWe start here now.\n");
  const p = paras(doc)[0], c = D.contentOf(p);
  const ask = D.makeAsk(doc, { blockId: p.id, start: 3, end: 17, action: "simpler", by: { id: "lex", name: "Lex" } });
  const res = Q.toggleCue(c, ...sel(c, "start"));
  assert.deepEqual([res.from, res.to], [3, 8]);
  assert.equal(C.cueBlocked([ask], p.id, res.from, res.to), true);
  assert.equal(C.cueBlocked([ask], p.id, 0, 2), false);
  assert.equal(C.cueBlocked([{ ...ask, status: "cancelled" }], p.id, res.from, res.to), false);
});

test("review 2: a rewrite over half a cue takes the whole cue in, so no stray == is left; duplicates count", () => {
  const doc = D.parse("# T\n\n## A\n\nWe ==start here== now.\n");
  const p = paras(doc)[0], c = D.contentOf(p);
  const [s, e] = sel(c, "here== now");
  const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "there now" }, answeredBy: { id: "agent:x", name: "X" } });
  const res = C.land(doc, ask, 1);
  assert.equal(D.contentOf(p), "We start there now.");
  assert.equal(res.cuesDropped, 1);
  C.setMark(ask, res.mark);
  assert.equal(C.undo(doc, ask).blockId, p.id);
  assert.equal(D.contentOf(p), c);
  // An add right inside a cue goes after the cue.
  const add = D.makeAsk(doc, { blockId: p.id, start: c.indexOf("here"), end: c.indexOf("here") + 4, action: "explain", by: { id: "lex", name: "Lex" } });
  Object.assign(add, { status: "answered", answer: { kind: "add", text: "and more" }, answeredBy: { id: "agent:x", name: "X" } });
  C.land(doc, add, 2);
  assert.equal(Q.textCues(D.contentOf(p)).length, 1);
  assert.equal(D.contentOf(p).replace(/==[^=]+==/g, "").includes("=="), false);
  assert.deepEqual(Q.keepCues("==go== and ==go==", "We go and go"), { text: "We ==go== and ==go==", dropped: 0 });
  assert.deepEqual(Q.keepCues("==go== and ==go==", "We ==go== now"), { text: "We ==go== now", dropped: 1 });
});

test("review 3: Ctrl+B next to an = sign changes nothing; a cueId names its words, so a moved cue is not removed by mistake", () => {
  assert.equal(Q.toggleCue("==go==now", 6, 9), null);
  assert.equal(Q.toggleCue("x=go", 2, 4), null);
  const doc = script();
  const [, p2] = paras(doc);
  assert.equal(C.listCues(doc)[0].cueId, `${p2.id}:1:second`);
  D.setContent(doc, p2.id, "A ==new== and ==second== line, we go.");
  assert.deepEqual(C.planCues(doc, "unmark", [{ cueId: `${p2.id}:1:second` }]).skipped, [{ quote: `${p2.id}:1:second`, why: "this cue has changed; call list_cues again" }]);
  assert.deepEqual(C.planCues(doc, "unmark", [{ cueId: `${p2.id}:2:second` }]).segments.map((s) => s.content), ["A ==new== and second line, we go."]);
});

test("Lex's decision 6: a rewrite reaching into a cue keeps it only if its words survive, and the agent is told", () => {
  const land = (quote, text) => {
    const doc = D.parse("# T\n\n## A\n\nWe ==start here== now.\n");
    const p = paras(doc)[0], [s, e] = sel(D.contentOf(p), quote);
    const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
    Object.assign(ask, { status: "answered", answer: { kind: "replace", text }, answeredBy: { id: "agent:x", name: "X" } });
    const res = C.land(doc, ask, 1);
    return [D.contentOf(p), res.cuesDropped];
  };
  assert.deepEqual(land("start here", "begin"), ["We begin now.", 1]);
  assert.deepEqual(land("here", "there"), ["We start there now.", 1]);
  assert.deepEqual(land("start here", "start here today"), ["We ==start here== today now.", 0]);
  assert.deepEqual(Q.widenOverCues("We ==start here== now.", 11, 15), { start: 3, end: 17, before: "start ", after: "" });
});

test("review 5: with cue marking off, a dropped cue is reported without asking the agent to mark it again", () => {
  assert.match(C.answerResult("replace", { cuesDropped: 1, cuesOn: true }), /mark_cue/);
  assert.doesNotMatch(C.answerResult("replace", { cuesDropped: 1, cuesOn: false }), /mark_cue/);
  assert.match(C.answerResult("replace", { cuesDropped: 1, cuesOn: false }), /removed 1 cue/);
});

test("lead fixes: Ctrl+B takes off a cue the agent just marked; a shown cue never splits across prompter lines", () => {
  const doc = script();
  const [p1, p2] = paras(doc);
  const by = { id: "agent:x", name: "X" };
  const parts = C.landCues(doc, C.planCues(doc, "mark", [{ quote: "start here" }]), "mark", by, 1);
  const asks = parts.map((p) => p.ask);
  assert.equal(C.isMarked(asks[0]), true);
  const c = D.contentOf(p1), res = Q.toggleCue(c, ...sel(c, "start here"));
  assert.equal(res.cue, false);
  assert.equal(C.cueBlocked(asks, p1.id, res.from, res.to), false);
  // Open asks still block the person's toggle.
  const open = D.makeAsk(doc, { blockId: p2.id, start: 4, end: 10, action: "simpler", by: { id: "lex", name: "Lex" } });
  assert.equal(C.cueBlocked([open], p2.id, 2, 12), true);
  const md = D.exportPrompter(D.parse("# T\n\n## A\n\nWe ==stop. Then go== on. Next one.\n"), { cues: "show" });
  assert.match(md, /^We ==stop\. Then go== on\.$/m);
  assert.match(md, /^Next one\.$/m);
});

test("lead fixes: mark_cue in two paragraphs at once; unmark_cue stays out of an open ask over the cue", () => {
  const doc = script();
  const [p1, p2] = paras(doc);
  const plan = C.planCues(doc, "mark", [{ quote: "start here" }, { quote: "line" }]);
  const parts = C.landCues(doc, plan, "mark", { id: "agent:x", name: "X" }, 1);
  assert.deepEqual(parts.map((p) => p.blockId), [p1.id, p2.id]);
  assert.equal(parts.every((p) => C.isMarked(p.ask)), true);
  const doc2 = script(), q2 = paras(doc2)[1], c2 = D.contentOf(q2);
  const over = D.makeAsk(doc2, { blockId: q2.id, start: c2.indexOf("==second=="), end: c2.indexOf("==second==") + 10, action: "simpler", by: { id: "lex", name: "Lex" } });
  assert.deepEqual(C.planCues(doc2, "unmark", [{ quote: "second" }], { asks: [over] }), { segments: [], skipped: [{ quote: "second", why: "under an open ask or change" }] });
});

test("PR 8 fixes: the cue tools don't treat the agent's highlighted changes as busy; open asks still count", () => {
  const doc = D.parse("# T\n\n## A\n\nWe ==start here== now. Then on.\n");
  const p = paras(doc)[0], q = "We ==start here== now.";
  const ask = D.makeAsk(doc, { blockId: p.id, start: 0, end: q.length, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "We begin now." }, answeredBy: { id: "agent:x", name: "X" } });
  const res = C.land(doc, ask, 1);
  C.setMark(ask, res.mark);
  assert.equal(res.cuesDropped, 1);
  assert.equal(C.isMarked(ask), true);
  // Told it may mark again, the agent can: on the rewritten words, still highlighted.
  const again = C.planCues(doc, "mark", [{ quote: "begin" }], { asks: [ask] });
  assert.deepEqual(again.segments.map((s) => s.content), ["We ==begin== now. Then on."]);
  // And it can take off a cue it just marked.
  const parts = C.landCues(doc, again, "mark", { id: "agent:x", name: "X" }, 2);
  assert.deepEqual(C.planCues(doc, "unmark", [{ quote: "begin" }], { asks: [ask, parts[0].ask] }).segments.map((s) => s.content), ["We begin now. Then on."]);
});

test("a letter or digit touching both sides of the marks means ordinary text, so it stays as it is", () => {
  assert.deepEqual(Q.textCues("if a==3 and b==4"), []);
  assert.equal(Q.stripCues("if a==3 and b==4"), "if a==3 and b==4");
  assert.deepEqual(Q.textCues("x==go==y").map((c) => c.label), []);
  // Only the opening decides: a letter right after the closing marks stays bold (typing right after a bold word).
  assert.deepEqual(Q.textCues("x==go== y ==go==z").map((c) => c.label), ["go"]);
  assert.deepEqual(Q.textCues("(==go==), ==on==.").map((c) => c.label), ["go", "on"]);
  const doc = D.parse("# T\n\n## A\n\nIf a==3 and b==4 we stop.\n");
  assert.match(D.exportCamera(doc), /If a==3 and b==4 we stop/);
  assert.match(D.exportPrompter(doc), /If a==3 and b==4 we stop/);
});

test("PR 8 fixes: marking a cue flags no B-roll shot; the Over text never holds the marks", () => {
  const doc = D.parse("# T\n\n## A\n\nWe start here now and go on.\n");
  const p = paras(doc)[0];
  const sig = B.coverText(doc, [p.id]);
  D.setContent(doc, p.id, "We ==start here== now and go on.");
  assert.equal(B.coverText(doc, [p.id]), sig);
  const shots = [{ id: "B1", blockIds: [p.id], sig }];
  assert.deepEqual(B.touchShots(doc, shots), []);
  const n = D.contentOf(p);
  const over = (s, e) => B.overFor(doc, [{ id: p.id, start: s, end: e }]);
  assert.doesNotMatch(over(n.indexOf("==start"), n.indexOf("now") + 3), /=/);
  // A selection that starts inside the cue takes the whole cue, so no lone marks.
  assert.match(over(n.indexOf("here"), n.indexOf("now") + 3), /^"start here now/);
});

test("PR 8 fixes: link lines are off limits for mark_cue and Ctrl+B; a closed cue's marks survive a deletion", () => {
  const text = "Read this.\n- Docs: https://example.com/guide";
  const doc = D.parse(`# T\n\n## A\n\n${text}\n`);
  const plan = C.planCues(doc, "mark", [{ quote: "guide" }]);
  assert.deepEqual(plan, { segments: [], skipped: [{ quote: "guide", why: "inside a link" }] });
  const i = text.indexOf("guide");
  assert.equal(Q.toggleCue(text, i, i + 5), null);
  assert.deepEqual(Q.textCues("Read.\n- Docs: https://example.com/==guide=="), []);
  // Backspace next to a closed cue: Chromium takes the hidden "==" with the character; it is put back.
  const old = "Say ==go== now", closed = Q.textCues(old);
  assert.deepEqual(L.keepHidden(old, "Say ==go now", closed, 8), { content: "Say ==go== now", caret: 10 });
  assert.deepEqual(L.keepHidden("Say ==go==", "Say ", Q.textCues("Say ==go=="), 4), null);
});

test("bold style: plain bold by default, own colours only as a valid choice, kept per person", () => {
  assert.deepEqual(Q.boldStyle(null), Q.BOLD_DEFAULTS);
  assert.equal(Q.BOLD_DEFAULTS.own, false);
  assert.deepEqual(Q.boldStyle({ own: true, background: "#112233", color: "#ABCDEF" }), { own: true, background: "#112233", color: "#ABCDEF" });
  // Anything else falls back, so nothing odd reaches the page's CSS.
  assert.deepEqual(Q.boldStyle({ own: "yes", background: "red;}", color: "url(x)" }), Q.BOLD_DEFAULTS);
});

test("agent settings: what the person and the agent are told says where the setting went", () => {
  const say = (o) => Q.settingsOutcome({ words: "", forScript: false, hadOwn: false, stored: true, ...o });
  assert.deepEqual(say({ words: "turned bold marking on" }), { banner: "turned bold marking on", message: "Done: the person sees the change, with Undo." });
  assert.equal(say({ words: "turned bold marking on", forScript: true }).banner, "turned bold marking on for this script");
  // A fresh browser, { on: false }: nothing the person sees changed, and no script has settings of its own.
  assert.deepEqual(say({}), { banner: null, message: "Those settings were in force already: nothing changed." });
  assert.deepEqual(say({ stored: false, hadOwn: true }), { banner: null, message: "Those settings were in force already: nothing changed." });
  // { on: true, forScript: true } while the person's is on already: the script now has its own.
  assert.match(say({ forScript: true }).banner, /gave this script its own bold settings/);
  assert.match(say({ forScript: true }).message, /now has its own settings/);
  assert.match(say({ forScript: true, hadOwn: true }).banner, /changed this script's bold settings/);
  assert.match(say({ hadOwn: true }).banner, /your own bold settings; this script keeps its own/);
  assert.match(say({ hadOwn: true }).message, /pass forScript: true/);
});

test("Sounds like me: a quote read without the marks is found across a cue's edge, covering the whole cue", () => {
  const doc = D.parse("# T\n\n## A\n\nWe ==start here== now. Then on.\n");
  const p = paras(doc)[0], id = p.id;
  assert.deepEqual(D.findQuote(doc, "We start here now"), { blockId: id, start: 0, end: 21, quote: "We ==start here== now" });
  // Only what was quoted: the rewrite step keeps the cue's other words.
  assert.deepEqual(D.findQuote(doc, "We start"), { blockId: id, start: 0, end: 10, quote: "We ==start" });
  assert.deepEqual(D.findQuote(doc, "here now"), { blockId: id, start: 11, end: 21, quote: "here== now" });
  // Word for word in the text: as before, without a new quote.
  assert.deepEqual(D.findQuote(doc, "Then on"), { blockId: id, start: 23, end: 30 });
  assert.equal(D.findQuote(doc, "We begin"), null);
  const ask = { id: "v", scope: "script", action: "voice", status: "waiting" };
  assert.equal(D.checkAnswer(ask, { askId: "v", kind: "marks", marks: [{ quote: "We start here now", why: "stiff", rewrite: "Start." }] }, doc).error, undefined);
});

test("Ctrl+B changes nothing where taking the marks off would change the kind of block", () => {
  const doc = D.parse("# T\n\n## A\n\nWe ==start here== now.\n\n==- item two==\n");
  const [p1, p2] = paras(doc), c2 = D.contentOf(p2);
  assert.equal(p2.type, "para");
  const off = Q.toggleCue(c2, 2, c2.length - 2);
  assert.equal(off.content, "- item two");
  assert.equal(C.canToggleCue([], p2.id, p2.type, off), false);
  const fine = Q.toggleCue(D.contentOf(p1), 5, 15);
  assert.equal(fine.content, "We start here now.");
  assert.equal(C.canToggleCue([], p1.id, p1.type, fine), true);
  const open = D.makeAsk(doc, { blockId: p1.id, start: 3, end: 17, action: "simpler", by: { id: "lex", name: "Lex" } });
  assert.equal(C.canToggleCue([open], p1.id, p1.type, fine), false);
});

test("edit bar: with the B button showing, the text input stays at least 200 px wide and the bar wraps; off, as before", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../public/app.css", import.meta.url), "utf8");
  assert.match(css, /\.edit-bar__controls:has\(#boldBtn:not\(\[hidden\]\)\) \{ flex-wrap: wrap; \}/);
  assert.match(css, /\.edit-bar__controls:has\(#boldBtn:not\(\[hidden\]\)\) \.edit-bar__ask \{ flex: 1 1 200px; min-inline-size: 200px;/);
});

test("last round: a rewrite widened over a cue never turns the paragraph into a list; link and cue side by side leave no marks", () => {
  const doc = D.parse("# T\n\n## A\n\n==start here== now.\n");
  const p = paras(doc)[0], [s, e] = sel(D.contentOf(p), "start");
  const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "- first" }, answeredBy: { id: "agent:x", name: "X" } });
  const res = C.land(doc, ask, 1);
  assert.equal(p.type, "para");
  assert.equal(D.contentOf(p), "first here now.");
  assert.equal(res.cuesDropped, 1);
  assert.ok(res.mark, "the change keeps its mark and Undo");
  assert.equal(Q.spokenWords("==a==[b](https://x.example)"), "ab");
  const two = D.parse("# T\n\n## A\n\n==a==[b](https://x.example) now.\n");
  assert.equal(D.exportCamera(two).includes("="), false);
});

test("last round: set_cue_settings says where the change really goes", () => {
  const t = TOOLS.find((x) => x.name === "set_cue_settings");
  assert.match(t.description, /Without forScript: the script's own settings if it has them, else the person's\./);
  assert.match(t.description, /forScript: false always sets the person's/);
  assert.doesNotMatch(t.description, /\(else for the person\)/);
});

test("Sounds like me: a rewrite of a quote over part of a cue never deletes the cue's other spoken words", () => {
  const land = (quote, text) => {
    const doc = D.parse("# T\n\n## A\n\nWe ==start here== now.\n");
    const p = paras(doc)[0], f = D.findQuote(doc, quote);
    const r = D.reanchor(f, D.contentOf(p));
    assert.deepEqual([r.start, r.end], [f.start, f.end], "the mark finds its place again");
    const ask = D.makeAsk(doc, { blockId: p.id, start: r.start, end: r.end, action: "voice", by: { id: "lex", name: "Lex" } });
    Object.assign(ask, { status: "answered", answer: { kind: "replace", text }, answeredBy: { id: "agent:x", name: "X" } });
    const res = C.land(doc, ask, 1);
    return [D.contentOf(p), res.cuesDropped];
  };
  assert.deepEqual(land("We start", "We begin"), ["We begin here now.", 1]);
  assert.deepEqual(land("here now", "there today"), ["We start there today.", 1]);
  assert.deepEqual(land("We start here", "We start here today"), ["We ==start here== today now.", 0]);
  assert.deepEqual(land("We start here now", "We go"), ["We go.", 1]);
});

test("typing next to a bold word: it stays bold and the marks never reach the exports", () => {
  for (const [typed, spoken] of [["Say ==go==s now.", "Say gos now."], ["Say ==go==now.", "Say gonow."], ["Say ==g o== now.", "Say g o now."]]) {
    assert.equal(Q.textCues(typed).length, 1, typed);
    assert.equal(Q.stripCues(typed), spoken);
    const doc = D.parse(`# T\n\n## A\n\n${typed}\n`);
    assert.doesNotMatch(D.exportCamera(doc), /=/, typed);
    assert.doesNotMatch(D.exportPrompter(doc), /=/, typed);
    assert.equal(D.stats(doc).words, D.countWords(spoken));
  }
  // It can still be taken off, with its words kept.
  assert.equal(Q.toggleCue("Say ==go==now.", 6, 8).content, "Say gonow.");
  // A B-roll shot over the line asks for a check only because a word changed, never because of the marks.
  const doc = D.parse("# T\n\n## A\n\nSay go now.\n");
  const p = paras(doc)[0], sig = B.coverText(doc, [p.id]);
  D.setContent(doc, p.id, "Say ==go== now.");
  assert.equal(B.coverText(doc, [p.id]), sig);
  D.setContent(doc, p.id, "Say ==go==now.");
  assert.notEqual(B.coverText(doc, [p.id]), sig);
});

test("an AI answer: a lone == it copied from the asked text goes; ordinary text and whole cues stay", () => {
  assert.equal(Q.dropLoneMarks("here== today"), "here today");
  assert.equal(Q.dropLoneMarks("==here today"), "here today");
  assert.equal(Q.dropLoneMarks("==go== and here=="), "==go== and here");
  assert.equal(Q.dropLoneMarks("a==3 and b==4"), "a==3 and b==4");
  assert.equal(Q.dropLoneMarks("if x == y"), "if x == y");
  const land = (doc, quote, kind, text) => {
    const p = paras(doc)[0], [s, e] = sel(D.contentOf(p), quote);
    const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
    Object.assign(ask, { status: "answered", answer: { kind, text }, answeredBy: { id: "agent:x", name: "X" } });
    C.land(doc, ask, 1);
    return D.contentOf(p);
  };
  const bold = () => D.parse("# T\n\n## A\n\nWe ==start here== now.\n");
  assert.equal(land(bold(), "here== now", "replace", "here== today"), "We ==start here== today.");
  assert.equal(land(bold(), "==start here==", "add", "and here== too"), "We ==start here== and here too now.");
  // No marks in what was asked about: the AI's text goes in as it wrote it.
  assert.equal(land(D.parse("# T\n\n## A\n\nWe start now.\n"), "start", "replace", "check a== b"), "We check a== b now.");
});

const CODE = 'if name=="Lex" or id=="7"';
test("Bold marking off: nothing reads == anywhere; the exports and counts are byte for byte as before bold", () => whileOff(() => {
  const md = `# T\n\n## A\n\n${CODE}\n\nWe ==go. Then on== ok.\n\nA ==== B and ==bold== here.\n`;
  const doc = D.parse(md);
  const [p1, p2, p3] = paras(doc);
  const pro = D.exportPrompter(doc), cam = D.exportCamera(doc);
  assert.ok(pro.includes(`\n${CODE}\n`), "the prompter file keeps the comparison");
  assert.ok(cam.includes(CODE), "the camera script keeps the comparison");
  // Sentences split where they did before bold, even inside ==…==.
  assert.ok(pro.includes("\nWe ==go.\nThen on== ok.\n"));
  assert.ok(pro.includes("\nA ==== B and ==bold== here.\n"));
  assert.ok(cam.includes("A ==== B and ==bold== here."));
  assert.equal(D.exportPrompter(doc, { cues: "show" }), pro);
  assert.equal(D.exportPrompter(doc, { cues: "strip" }), pro);
  // The pieces under them read nothing either.
  assert.deepEqual(Q.textCues(D.contentOf(p3)), []);
  assert.equal(Q.stripCues(D.contentOf(p3)), D.contentOf(p3));
  assert.equal(Q.spokenWords(D.contentOf(p1)), CODE);
  assert.ok(B.coverText(doc, [p3.id]).includes("==bold=="));
  assert.match(B.overFor(doc, [{ id: p3.id, start: 0, end: D.contentOf(p3).length }]), /====/);
  assert.equal(D.stats(doc).words, D.countWords(CODE) + D.countWords(D.contentOf(p2)) + D.countWords(D.contentOf(p3)));
  assert.deepEqual(C.listCues(doc), []);
  assert.deepEqual(C.planCues(doc, "unmark", [{ quote: "bold" }]).segments, []);
  assert.equal(D.findQuote(doc, "and bold here"), null);
  assert.equal(Q.dropLoneMarks("here== today"), "here== today");
  // Only what an edit empties goes, at edit time, for everyone; a comparison's text never does.
  assert.equal(Q.settleMarks("a==b==c", "a====c", 3), null);
  assert.equal(Q.settleMarks("==go== x", "==go==s x", 7), null);
  // A rewrite and a link go in as they did before bold.
  const c3 = D.contentOf(p3), [s, e] = sel(c3, "==bold");
  const ask = D.makeAsk(doc, { blockId: p3.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "big== x" }, answeredBy: { id: "agent:x", name: "X" } });
  const res = C.land(doc, ask, 1);
  assert.equal(D.contentOf(p3), "A ==== B and big== x== here.");
  assert.equal(res.cuesDropped, 0);
  const links = C.planFor(D.parse("# T\n\n## A\n\nUse ==go== now.\n"), { id: "x", scope: "script" }, { links: [{ quote: "go", url: "https://example.com" }] });
  assert.equal(links.segments[0].content, "Use ==[go](https://example.com)== now.");
}));

test("Bold marking on: an opening == right after a letter, digit or comparison sign is plain text; earlier cases hold", () => {
  for (const t of [CODE, "a==3 and b==4", "x==go== now", "7==go== now", "a<==go== now", "a>==go== now", "a!==go== now", "a===go== now", "<==go==", "!==go=="]) {
    assert.deepEqual(Q.textCues(t), [], t);
    assert.equal(Q.stripCues(t), t);
  }
  assert.deepEqual(Q.textCues("==go==s now, (==on==), \"==up==\"").map((c) => c.label), ["go", "on", "up"]);
  const doc = D.parse(`# T\n\n## A\n\n${CODE}\n\nSay ==go== now.\n`);
  assert.ok(D.exportPrompter(doc).includes(`\n${CODE}\n`));
  assert.ok(D.exportCamera(doc).includes(CODE));
  assert.ok(D.exportCamera(doc).includes("Say go now."));
  // The AI's own comparison stays even when the asked text held marks; a lone mark it copied goes.
  assert.equal(Q.dropLoneMarks(CODE), CODE);
  assert.equal(Q.dropLoneMarks("here== today"), "here today");
  assert.equal(Q.dropLoneMarks("here==."), "here.");
});

test("Bold marking on: an edit that breaks a bold stretch settles it, with no stray marks; an edit that doesn't changes nothing", () => {
  const settle = (old, now, caret) => { const r = Q.settleMarks(old, now, caret); return r && [r.content, r.caret]; };
  // All its words deleted: the marks go.
  assert.deepEqual(settle("We ==a== now", "We ==== now", 5), ["We  now", 3]);
  assert.deepEqual(settle("==a==", "====", 2), ["", 0]);
  assert.deepEqual(settle("==a b== x", "== == x", 3), ["  x", 1]);
  // Spaces at its edges move outside.
  assert.deepEqual(settle("==A blank== x", "== blank== x", 2), [" ==blank== x", 0]);
  assert.deepEqual(settle("==A b== x", "==A == x", 4), ["==A==  x", 6]);
  // A letter typed or joined right before it: it joins the bold word, so the typing goes on inside.
  assert.deepEqual(settle("==go== now", "x==go== now", 1), ["==xgo== now", 3]);
  assert.deepEqual(settle("foo ==go== now", "foo==go== now", 3), ["==foogo== now", 5]);
  assert.deepEqual(settle("abc\n==go== x", "abc==go== x", 3), ["==abcgo== x", 5]);
  // A sign right before it, an = inside it, a line break in it, or an edit that takes one mark: the marks go, the words stay.
  assert.deepEqual(settle("==go== x", "<==go== x", 1), ["<go x", 1]);
  assert.deepEqual(settle("==go== x", "==g=o== x", 4), ["g=o x", 2]);
  assert.deepEqual(settle("==a b== x", "==a\n b== x", 4), ["a\n b x", 2]);
  assert.deepEqual(settle("We ==start here== now", "We here== now", 3), ["We here now", 3]);
  assert.deepEqual(settle("We ==start here== now", "We ==start now", 10), ["We start now", 8]);
  assert.deepEqual(settle("==go== x", "=go== x", 1), ["go x", 0]);
  assert.deepEqual(settle("==a== ==b==", "==a====b==", 5), ["ab", 1]);
  // Nothing to settle: typing right after it, deleting the space after it, typing inside it, elsewhere, or no bold at all.
  for (const [old, now] of [["==go== now", "==go==s now"], ["==go== now", "==go==now"], ["==go== now", "==gxo== now"], ["==go== now", "==go== nowx"], ["a==b", "a== b"], ["plain", "plainer"]]) {
    assert.equal(Q.settleMarks(old, now, 1), null, now);
  }
});

test("review: the mirror of the comparison bug, the AI's own comparisons, and rewrites that wouldn't read back", () => {
  for (const t of ['if "Lex"==name or "7"==id', "f(x)==3 and g(y)==4", "a[1]==b and c[2]==d"]) {
    assert.deepEqual(Q.textCues(t), [], t);
    assert.ok(D.exportCamera(D.parse(`# T\n\n## A\n\n${t}\n`)).includes(t), t);
  }
  assert.deepEqual(Q.textCues('"==up==" and (==on==), and ==go==s').map((c) => c.label), ["up", "on", "go"]);
  for (const t of ["a !== b", "a <== b", "a >== b", "f(x)==3", 'say "a"==b', "x[1]==2"]) assert.equal(Q.dropLoneMarks(t), t);
  assert.equal(Q.dropLoneMarks("here== today"), "here today");
  // A cue whose words would come right after a comparison sign can't read back as a cue: it goes, and the agent is told.
  assert.deepEqual(Q.keepCues("==go==", "Stop!go now"), { text: "Stop!go now", dropped: 1 });
  assert.deepEqual(Q.keepCues("==go==", "We go now"), { text: "We ==go== now", dropped: 0 });
});

test("review: turning Bold marking off or on flags no B-roll shot", () => {
  const doc = D.parse("# T\n\n## A\n\nSay ==go== now.\n");
  const p = paras(doc)[0], shots = [{ id: "B1", blockIds: [p.id] }];
  B.refreshSigs(doc, shots);
  whileOff(() => {
    B.refreshSigs(doc, shots);
    assert.deepEqual(B.touchShots(doc, shots), [], "off: nothing flagged");
    assert.equal(shots[0].check, undefined);
  });
  B.refreshSigs(doc, shots);
  assert.deepEqual(B.touchShots(doc, shots), [], "on again: nothing flagged");
  D.setContent(doc, p.id, "Say ==go== later.");
  assert.deepEqual(B.touchShots(doc, shots), ["B1"], "a changed word still asks for a check");
});

test("typing a word in front of a bold word: it joins while typed, and stays plain once its space is typed", () => {
  const run = (old, now, caret, typedBefore) => { const r = Q.settleMarks(old, now, caret, { typedBefore }); return r && [r.content, r.caret, r.typedBefore ?? null]; };
  assert.deepEqual(run("==go== now", "b==go== now", 1, null), ["==bgo== now", 3, 3]);
  assert.deepEqual(run("==bgo== now", "==bigo== now", 4, 3), ["==bigo== now", 4, 4]);
  assert.deepEqual(run("==bigo== now", "==biggo== now", 5, 4), ["==biggo== now", 5, 5]);
  assert.deepEqual(run("==biggo== now", "==big go== now", 6, 5), ["big ==go== now", 4, null]);
  // A typo in the word typed: Backspace keeps track.
  assert.deepEqual(run("==biggo== now", "==bigo== now", 4, 5), ["==bigo== now", 4, 4]);
  // A space typed anywhere else in a bold word stays in it, and a word joined by deleting a space isn't "typing".
  assert.equal(Q.settleMarks("==big go==", "==big  go==", 6), null);
  assert.equal(Q.settleMarks("==biggo==", "==big go==", 6), null);
  assert.equal(Q.settleMarks("foo ==go==", "foo==go==", 3).typedBefore ?? null, null);
  // A word typed mid-line, after other words.
  assert.deepEqual(run("Say ==go== now", "Say x==go== now", 5, null), ["Say ==xgo== now", 7, 7]);
  assert.deepEqual(run("Say ==xgo== now", "Say ==x go== now", 8, 7), ["Say x ==go== now", 6, null]);
});

test("an opening == after a closing bracket or closing quote is plain text; after an opening quote or bracket it is bold", () => {
  for (const t of ['f(x)=="a" or g(x)=="b"', '"Lex"==name or id=="7"', "a[1]==b and c[2]==d", "x)==go== now", "x]==go== now", "don't==go== now", "say ”==go== now", "it’==go== now", 'say "a"==go== now']) {
    assert.deepEqual(Q.textCues(t), [], t);
    assert.ok(D.exportCamera(D.parse(`# T\n\n## A\n\n${t}\n`)).includes(t), t);
    assert.ok(D.exportPrompter(D.parse(`# T\n\n## A\n\n${t}\n`)).includes(t), t);
  }
  assert.deepEqual(Q.textCues('"==up==" (==on==) [==in==] say "==it==" “==so==” \'==ok==\' .==go==').map((c) => c.label), ["up", "on", "in", "it", "so", "ok", "go"]);
  // A comparison next to a real bold word doesn't hide it.
  assert.deepEqual(Q.textCues('"a"==b and ==go== now').map((c) => c.label), ["go"]);
});

test("the settling follows the same rule: no literal marks after a join next to a quote or bracket", () => {
  assert.equal(Q.settleMarks('"foo ==go==s', '"foo==go==s', 4).content, '"==foogo==s');
  assert.equal(Q.settleMarks('x"foo ==go== y', 'x"foo==go== y', 5).content, 'x"foogo y');
  assert.equal(Q.settleMarks("==go== y", ")==go== y", 1).content, ")go y");
  assert.equal(Q.settleMarks('==go== y', '’==go== y', 1).content, "’go y");
  for (const [old, now, caret] of [['"foo ==go==s', '"foo==go==s', 4], ['x"foo ==go== y', 'x"foo==go== y', 5], ["==go== y", ")==go== y", 1]]) {
    const out = Q.settleMarks(old, now, caret).content;
    assert.equal(out.replace(/==/g, "").length + Q.textCues(out).length * 4, out.length, `every mark in ${out} reads as a cue`);
  }
});

test("emptying a bold stretch takes its marks at edit time for everyone, even with Bold marking off (a guest's default)", () => {
  const both = (old, now, caret, want) => {
    assert.deepEqual(Q.settleMarks(old, now, caret)?.content, want, `on: ${now}`);
    whileOff(() => assert.deepEqual(Q.settleMarks(old, now, caret)?.content, want, `off: ${now}`));
  };
  both("We ==a== now", "We ==== now", 5, "We  now");
  both("==a==", "====", 2, "");
  both("We ==a b== now", "We ==== now", 5, "We  now");
  whileOff(() => {
    assert.deepEqual(Q.settleMarks("We ==a== now", "We ==== now", 5), { content: "We  now", caret: 3, typedBefore: null });
    // Comparisons, typing, paste and text that held no words stay byte for byte.
    assert.equal(Q.settleMarks("a==b==c", "a====c", 3), null);
    assert.equal(Q.settleMarks("a)==b== c", "a)==== c", 4), null);
    assert.equal(Q.settleMarks("x ==b===", "x =====", 4), null);
    assert.equal(Q.settleMarks("We ==a\nb== now", "We ==== now", 5), null);
    // Spaces next to the marks: never a bold stretch, a spaced comparison.
    assert.equal(Q.settleMarks("a == b == c", "a ==== c", 4), null);
    assert.equal(Q.settleMarks("a == == c", "a ==== c", 4), null);
    assert.equal(Q.settleMarks("We ==== now", "We ===== now", 6), null);
    assert.equal(Q.settleMarks("We ==a== now", "We ==b== now", 6), null);
    assert.equal(Q.settleMarks("We ==a== now", "We ==a= now", 6), null);
    // And nothing is read while it is off.
    assert.deepEqual(Q.textCues("We ==a== now"), []);
  });
});

test("an open ask follows when a word is typed before a bold word; its answer keeps what was typed", () => {
  const r = D.reanchor({ start: 4, quote: "==go== now" }, "Say ==xgo== now");
  assert.deepEqual(r, { start: 7, end: 15, quote: "go== now" });
  // The nearest copy.
  assert.equal(D.reanchor({ start: 20, quote: "==go== x" }, "==ago== x and ==bgo== x").start, 17);
  // The words themselves gone: the ask's text is gone, as before.
  assert.equal(D.reanchor({ start: 4, quote: "==go== now" }, "Say ==ab== now"), null);
  // With Bold marking off, == is plain text, so the old search alone decides.
  whileOff(() => assert.equal(D.reanchor({ start: 4, quote: "==go== now" }, "Say ==xgo== now"), null));
  const doc = D.parse("# T\n\n## A\n\nSay ==go== now.\n");
  const p = paras(doc)[0], [s, e] = sel(D.contentOf(p), "==go== now");
  const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
  D.setContent(doc, p.id, Q.settleMarks(D.contentOf(p), "Say x==go== now.", 5).content);
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "go later" }, answeredBy: { id: "agent:x", name: "X" } });
  assert.ok(C.land(doc, ask, 1));
  assert.equal(D.contentOf(p), "Say ==xgo== later.", "the typed letter stays, and the bold words survive");
  // The B-roll matcher reads a bold word with a letter against it as the words it is.
  const b = D.parse("# T\n\n## A\n\nSay ==go==s now.\n");
  assert.deepEqual(B.matchOver(B.spokenBlocks(b), '"Say gos now."'), [paras(b)[0].id]);
});

test("mark_cue checks each quote on its own: one that can't read as a cue doesn't stop the others in its paragraph", () => {
  const doc = D.parse("# T\n\n## A\n\nIs 5>4 true and we go on.\n");
  const plan = C.planCues(doc, "mark", [{ quote: "4" }, { quote: "go" }]);
  assert.deepEqual(plan.segments.map((x) => x.content), ["Is 5>4 true and we ==go== on."]);
  assert.deepEqual(plan.skipped, [{ quote: "4", why: "would not read as a cue there" }]);
});

test("a comparison with a space before its first == stays plain; several bold words end before a letter, digit or stray quote", () => {
  for (const t of ['name =="Lex" or id=="7"', "if a ==3 or b==4", "if x ==1 and y==2 ok", "a ==b c==d", "say ==two words==s", "say ==two words==7", 'say ==two words=="x']) {
    assert.deepEqual(Q.textCues(t), [], t);
    const doc = D.parse(`# T\n\n## A\n\n${t}\n`);
    assert.ok(D.exportCamera(doc).includes(t), t);
    assert.ok(D.exportPrompter(doc).includes(t), t);
  }
  // One word keeps its letter typed right after it; quoted words stay bold, and so do words before a space or punctuation.
  assert.deepEqual(Q.textCues('==go==s, "==two words==" and \'==more words==\', ==new words==. “==curly words==”').map((c) => c.label), ["go", "two words", "more words", "new words", "curly words"]);
});

test("typing right after several bold words, or deleting the space after them, joins them: no literal marks", () => {
  const settle = (old, now, caret) => { const r = Q.settleMarks(old, now, caret); return r && [r.content, r.caret]; };
  assert.deepEqual(settle("==A blank== page", "==A blank==s page", 12), ["==A blanks== page", 10]);
  assert.deepEqual(settle("==A blank== page", "==A blank==page", 11), ["==A blankpage== ".trimEnd(), 9]);
  // A quote typed right after them would read as a comparison: the marks go, the words stay.
  assert.deepEqual(settle("==A b== x", '==A b==" x', 8), ['A b" x', 4]);
  // A word right after, then an = sign: no way to read it as bold.
  assert.equal(Q.settleMarks("==A b== c=d", "==A b==c=d", 7).content, "A bc=d");
  // Nothing to do for one word, a space or punctuation after them.
  for (const [old, now, caret] of [["==go== x", "==go==s x", 7], ["==A b== x", "==A b==. x", 8], ["==A b== x", "==A b==  x", 8]]) assert.equal(Q.settleMarks(old, now, caret), null, now);
  // The rewrite rule reads the same: words that survive only against a letter stay plain and are counted.
  assert.deepEqual(Q.keepCues("==A blank==", "A blanks here"), { text: "A blanks here", dropped: 1 });
});

test("a lone mark after a bold stretch ending in ! goes; a real comparison stays", () => {
  for (const [t, want] of [["Halt!== now", "Halt! now"], ["Halt!==", "Halt!"], ["Stop?== now", "Stop? now"], ["Go>==.", "Go>."]]) assert.equal(Q.dropLoneMarks(t), want);
  for (const t of ["a !== b", "a <== b", "!== b", "a!==b", "a<==3", "x >== 2"]) assert.equal(Q.dropLoneMarks(t), t);
  const doc = D.parse("# T\n\n## A\n\nSay ==Stop!== now.\n");
  const p = paras(doc)[0], [s, e] = sel(D.contentOf(p), "==Stop!== now");
  const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "Halt!== now" }, answeredBy: { id: "agent:x", name: "X" } });
  C.land(doc, ask, 1);
  assert.equal(D.contentOf(p), "Say Halt! now.");
});

test("an ask follows a bold word only: it never lands in the middle of other words", () => {
  assert.equal(D.reanchor({ start: 0, quote: "==go== now" }, " ==stop== and forgo now"), null);
  assert.equal(D.reanchor({ start: 0, quote: "==go== now" }, "we go now"), null);
  assert.deepEqual(D.reanchor({ start: 0, quote: "==go== now" }, "forgo now and ==xgo== now"), { start: 17, end: 25, quote: "go== now" });
  assert.deepEqual(D.findQuote(D.parse("# T\n\n## A\n\nforgo now\n\nWe ==go== now.\n"), "We go now").quote, "We ==go== now");
});
