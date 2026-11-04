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
  const p = paras(doc)[0], c = D.contentOf(p), q = "We ==start here== now.";
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
  assert.ok(c);
});

test("PR 8 fixes: a letter or digit right outside == is not a cue, so ordinary text stays as it is", () => {
  assert.deepEqual(Q.textCues("if a==3 and b==4"), []);
  assert.equal(Q.stripCues("if a==3 and b==4"), "if a==3 and b==4");
  assert.deepEqual(Q.textCues("x==go== y ==go==z").map((c) => c.label), []);
  assert.deepEqual(Q.textCues("(==go==), ==on==.").map((c) => c.label), ["go", "on"]);
  const doc = D.parse("# T\n\n## A\n\nIf a==3 and b==4 we stop.\n");
  assert.match(D.exportCamera(doc), /If a==3 and b==4 we stop/);
  assert.match(D.exportPrompter(doc), /If a==3 and b==4 we stop/);
});

test("PR 8 fixes: marking a cue flags no B-roll shot; the Over text never holds the marks", () => {
  const doc = D.parse("# T\n\n## A\n\nWe start here now and go on.\n");
  const p = paras(doc)[0], c = D.contentOf(p);
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
  assert.ok(c);
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
  assert.deepEqual(D.findQuote(doc, "We start"), { blockId: id, start: 0, end: 17, quote: "We ==start here==" });
  assert.deepEqual(D.findQuote(doc, "here now"), { blockId: id, start: 3, end: 21, quote: "==start here== now" });
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
