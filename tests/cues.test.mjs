// Cue marking (fleet issue #14, Lex 2026-11-04): a cue is "**words**" in a spoken paragraph. Optional and off by
// default; Ctrl/Cmd+B toggles it on the selected words; the agent lists, marks and unmarks cues; a rewrite keeps a
// cue only when its words survive; the prompter export strips cues unless the export setting says show.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../public/doc.js";
import * as C from "../public/changes.js";
import * as Q from "../public/cues.js";
import * as L from "../public/links.js";
import * as B from "../public/broll.js";
import { diff } from "../public/together/ops.js";
import { checkArgs, TOOLS, INSTRUCTIONS } from "../worker/mcp.js";

// Bold marking on for this file, unless a test says otherwise (Bold marking off: `whileOff`).
Q.readCuesWhen(() => true);
const whileOff = (fn) => { Q.readCuesWhen(() => false); try { return fn(); } finally { Q.readCuesWhen(() => true); } };
const sel = (content, words) => { const s = content.indexOf(words); return [s, s + words.length]; };

const keptText = (...args) => { const r = L.keepHidden(...args); return r && { content: r.content, caret: r.caret }; };
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

test("format: **words** in a line; no brackets, * or line breaks inside; a letter or digit; not inside a link", () => {
  const c = "We **start here** and [**go**](https://example.com) a ** b ** c, ===x=== and ** **.";
  const cues = Q.textCues(c);
  assert.deepEqual(cues.map((x) => x.label), ["start here"]);
  assert.deepEqual(cues[0], { start: 3, end: 17, words: { start: 5, end: 15 }, label: "start here", cue: true });
  assert.deepEqual(Q.textCues("**a\nb** **[x]** **1**").map((x) => x.label), ["1"]);
  assert.equal(Q.stripCues("We **start here** now."), "We start here now.");
  // What is spoken and counted: the words, never the marks.
  assert.equal(Q.spokenWords("Say **this** and [that](https://x.example)."), "Say this and that.");
  const doc = D.parse("# T\n\n## Intro\n\nSay **this one** now.\n");
  assert.equal(D.stats(doc).words, 4);
  assert.equal(D.exportCamera(doc).includes("**"), false);
});

test("toggle: marks the selected words, a second toggle takes the marks off, the words stay", () => {
  const c = "We start here. Then we go on.";
  const on = Q.toggleCue(c, ...sel(c, "start here"));
  assert.deepEqual(on, { content: "We **start here**. Then we go on.", start: 5, end: 15, cue: true, from: 3, to: 13 });
  const off = Q.toggleCue(on.content, on.start, on.end);
  assert.deepEqual(off, { content: c, start: 3, end: 13, cue: false, from: 3, to: 17 });
  // The whole cue selected with its marks showing (caret inside it) takes it off too.
  assert.equal(Q.toggleCue(on.content, 3, 17).content, c);
  // A part of the cue's words, inside it: the cue goes.
  assert.equal(Q.toggleCue(on.content, 5, 10).content, c);
  // Spaces at the ends of the selection stay outside the cue.
  assert.equal(Q.toggleCue(c, 2, 13).content, "We **start here**. Then we go on.");
});

test("toggle: half a cue or across two joins into one cue; refuses links, line breaks and no words", () => {
  const c = "We **start** here and **go** on.";
  // From inside one cue to past it: one cue over both.
  const half = Q.toggleCue(c, c.indexOf("tart"), c.indexOf("here") + 4);
  assert.equal(half.content, "We **start here** and **go** on.");
  assert.equal(half.cue, true);
  // Across two cues.
  assert.equal(Q.toggleCue(c, c.indexOf("start"), c.indexOf("go") + 2).content, "We **start here and go** on.");
  // A link in the way: nothing changes (null).
  const l = "Use [Claude](https://claude.ai) today.";
  assert.equal(Q.toggleCue(l, 0, l.length), null);
  assert.equal(Q.toggleCue("one\ntwo", 0, 7), null);
  assert.equal(Q.toggleCue("a , b", 2, 3), null);
  assert.equal(Q.toggleCue("a * b", 0, 5), null);
  assert.equal(Q.toggleCue("abc", 1, 1), null);
  assert.equal(Q.cueSelected(c, c.indexOf("start"), c.indexOf("start") + 5), true);
  assert.equal(Q.cueSelected(c, c.indexOf("here"), c.indexOf("here") + 4), false);
});

test("export: the prompter file strips cues unless the export setting says show", () => {
  const doc = D.parse("# T\n\n## Intro\n\nWe **start here**. Then we go on.\n");
  assert.equal(D.exportPrompter(doc).replace(/^### \*\*.*\*\*$/m, "").includes("**"), false);
  assert.match(D.exportPrompter(doc), /We start here\./);
  assert.match(D.exportPrompter(doc, { cues: "show" }), /We \*\*start here\*\*\./);
  assert.equal(D.exportPrompter(doc, { cues: "strip" }), D.exportPrompter(doc));
});

const script = () => D.parse("# Title\n\n## 1 · Hook\n\nWe start here. Then we go on and on.\n\nA **second** line, we go.\n\n[ON SCREEN: start here]\n");
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
  assert.deepEqual(plan.segments.map((s) => [s.id, s.content]), [[p1.id, "We **start here**. Then we **go** on and on."], [p2.id, "A **second** line, we **go**."]]);
  assert.deepEqual(plan.segments[0].cues, [{ quote: "start here" }, { quote: "go" }]);
  assert.deepEqual(plan.skipped, [
    { quote: "second", why: "already a cue" },
    { quote: "ON SCREEN", why: "in a heading or reminder, where cues don't go" },
    { quote: "nowhere", why: "not found word for word in the spoken text" },
    { quote: "a [b]", why: "cue words hold no brackets, * signs or line breaks" },
    { quote: "an", why: "not found word for word in the spoken text" },
  ]);
  // occurrence counts every whole-word match in reading order; the second "go" is in the second paragraph.
  assert.equal(plan.segments[1].from, plan.segments[1].content.indexOf("**go**"));
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
  assert.equal(D.contentOf(p1), "We **start here**. Then we go on and on.");
  assert.equal(parts.length, 1);
  const a = parts[0].ask;
  assert.equal(C.isMarked(a), true);
  assert.deepEqual([a.action, a.status, a.answeredBy, a.answer], ["cue", "kept", by, { kind: "cue", cues: [{ quote: "start here" }] }]);
  assert.deepEqual(C.markRange(a), { start: 3, end: 17 });
  C.undo(doc, a);
  assert.equal(D.contentOf(p1), "We start here. Then we go on and on.");
});

test("rewrite: a cue stays when its words survive the agent's new text; else it is dropped and the agent is told", () => {
  assert.deepEqual(Q.keepCues("We **start here** now", "So we start here today"), { text: "So we **start here** today", dropped: 0 });
  assert.deepEqual(Q.keepCues("We **start here** now", "So we **start here** today"), { text: "So we **start here** today", dropped: 0 });
  assert.deepEqual(Q.keepCues("We **start here** and **go**", "We begin and go"), { text: "We begin and **go**", dropped: 1 });
  assert.deepEqual(Q.keepCues("plain text", "new text"), { text: "new text", dropped: 0 });
  const doc = D.parse("# T\n\n## A\n\nWe **start here** now. Then on.\n");
  const p = paras(doc)[0];
  const q = "We **start here** now.";
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
  assert.match(INSTRUCTIONS, /\*\*words\*\*/);
  assert.match(INSTRUCTIONS, /off by default/);
});

test("review: links never land inside a cue; a rewrite whose cues would change the block keeps the text without them", () => {
  assert.deepEqual(L.planLinks([{ id: "p", content: "We **go** now", from: 0, to: 13, cues: [[3, 9]] }], [{ quote: "go", url: "https://example.com" }]).skipped, [{ quote: "go", why: "inside a cue, where links don't go" }]);
  const doc = D.parse("# T\n\n## A\n\nWe **start** now and **go** on.\n");
  const p = paras(doc)[0];
  const ask = D.makeAsk(doc, { blockId: p.id, start: 0, end: D.contentOf(p).length, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "We start now and **go** on." }, answeredBy: { id: "agent:x", name: "X" } });
  const res = C.land(doc, ask, 1);
  assert.equal(D.contentOf(p), "We **start** now and **go** on.");
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

test("review 2: a rewrite over half a cue takes the whole cue in, so no stray ** is left; duplicates count", () => {
  const doc = D.parse("# T\n\n## A\n\nWe **start here** now.\n");
  const p = paras(doc)[0], c = D.contentOf(p);
  const [s, e] = sel(c, "here** now");
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
  assert.equal(D.contentOf(p).replace(/\*\*[^*]+\*\*/g, "").includes("**"), false);
  assert.deepEqual(Q.keepCues("**go** and **go**", "We go and go"), { text: "We **go** and **go**", dropped: 0 });
  assert.deepEqual(Q.keepCues("**go** and **go**", "We **go** now"), { text: "We **go** now", dropped: 1 });
});

test("Lex's decision 6: a rewrite reaching into a cue keeps it only if its words survive, and the agent is told", () => {
  const land = (quote, text) => {
    const doc = D.parse("# T\n\n## A\n\nWe **start here** now.\n");
    const p = paras(doc)[0], [s, e] = sel(D.contentOf(p), quote);
    const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
    Object.assign(ask, { status: "answered", answer: { kind: "replace", text }, answeredBy: { id: "agent:x", name: "X" } });
    const res = C.land(doc, ask, 1);
    return [D.contentOf(p), res.cuesDropped];
  };
  assert.deepEqual(land("start here", "begin"), ["We begin now.", 1]);
  assert.deepEqual(land("here", "there"), ["We start there now.", 1]);
  assert.deepEqual(land("start here", "start here today"), ["We **start here** today now.", 0]);
  assert.deepEqual(Q.widenOverCues("We **start here** now.", 11, 15), { start: 3, end: 17, before: "start ", after: "" });
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
  const md = D.exportPrompter(D.parse("# T\n\n## A\n\nWe **stop. Then go** on. Next one.\n"), { cues: "show" });
  assert.match(md, /^We \*\*stop\. Then go\*\* on\.$/m);
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
  const over = D.makeAsk(doc2, { blockId: q2.id, start: c2.indexOf("**second**"), end: c2.indexOf("**second**") + 10, action: "simpler", by: { id: "lex", name: "Lex" } });
  assert.deepEqual(C.planCues(doc2, "unmark", [{ quote: "second" }], { asks: [over] }), { segments: [], skipped: [{ quote: "second", why: "under an open ask or change" }] });
});

test("PR 8 fixes: the cue tools don't treat the agent's highlighted changes as busy; open asks still count", () => {
  const doc = D.parse("# T\n\n## A\n\nWe **start here** now. Then on.\n");
  const p = paras(doc)[0], q = "We **start here** now.";
  const ask = D.makeAsk(doc, { blockId: p.id, start: 0, end: q.length, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "We begin now." }, answeredBy: { id: "agent:x", name: "X" } });
  const res = C.land(doc, ask, 1);
  C.setMark(ask, res.mark);
  assert.equal(res.cuesDropped, 1);
  assert.equal(C.isMarked(ask), true);
  // Told it may mark again, the agent can: on the rewritten words, still highlighted.
  const again = C.planCues(doc, "mark", [{ quote: "begin" }], { asks: [ask] });
  assert.deepEqual(again.segments.map((s) => s.content), ["We **begin** now. Then on."]);
  // And it can take off a cue it just marked.
  const parts = C.landCues(doc, again, "mark", { id: "agent:x", name: "X" }, 2);
  assert.deepEqual(C.planCues(doc, "unmark", [{ quote: "begin" }], { asks: [ask, parts[0].ask] }).segments.map((s) => s.content), ["We begin now. Then on."]);
});

test("PR 8 fixes: marking a cue flags no B-roll shot; the Over text never holds the marks", () => {
  const doc = D.parse("# T\n\n## A\n\nWe start here now and go on.\n");
  const p = paras(doc)[0];
  const sig = B.coverText(doc, [p.id]);
  D.setContent(doc, p.id, "We **start here** now and go on.");
  assert.equal(B.coverText(doc, [p.id]), sig);
  const shots = [{ id: "B1", blockIds: [p.id], sig }];
  assert.deepEqual(B.touchShots(doc, shots), []);
  const n = D.contentOf(p);
  const over = (s, e) => B.overFor(doc, [{ id: p.id, start: s, end: e }]);
  assert.doesNotMatch(over(n.indexOf("**start"), n.indexOf("now") + 3), /\*/);
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
  assert.deepEqual(Q.textCues("Read.\n- Docs: https://example.com/**guide**"), []);
  // Backspace next to a closed cue: Chromium takes the hidden "**" with the character; it is put back.
  const old = "Say **go** now", closed = Q.textCues(old);
  assert.deepEqual(keptText(old, "Say **go now", closed, 8), { content: "Say **go** now", caret: 10 });
  assert.deepEqual(keptText("Say **go**", "Say ", Q.textCues("Say **go**"), 4), null);
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
  const doc = D.parse("# T\n\n## A\n\nWe **start here** now. Then on.\n");
  const p = paras(doc)[0], id = p.id;
  assert.deepEqual(D.findQuote(doc, "We start here now"), { blockId: id, start: 0, end: 21, quote: "We **start here** now" });
  // Only what was quoted: the rewrite step keeps the cue's other words.
  assert.deepEqual(D.findQuote(doc, "We start"), { blockId: id, start: 0, end: 10, quote: "We **start" });
  assert.deepEqual(D.findQuote(doc, "here now"), { blockId: id, start: 11, end: 21, quote: "here** now" });
  // Word for word in the text: as before, without a new quote.
  assert.deepEqual(D.findQuote(doc, "Then on"), { blockId: id, start: 23, end: 30 });
  assert.equal(D.findQuote(doc, "We begin"), null);
  const ask = { id: "v", scope: "script", action: "voice", status: "waiting" };
  assert.equal(D.checkAnswer(ask, { askId: "v", kind: "marks", marks: [{ quote: "We start here now", why: "stiff", rewrite: "Start." }] }, doc).error, undefined);
});

test("Ctrl+B changes nothing where taking the marks off would change the kind of block", () => {
  const doc = D.parse("# T\n\n## A\n\nWe **start here** now.\n\n**- item two**\n");
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
  const doc = D.parse("# T\n\n## A\n\n**start here** now.\n");
  const p = paras(doc)[0], [s, e] = sel(D.contentOf(p), "start");
  const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "- first" }, answeredBy: { id: "agent:x", name: "X" } });
  const res = C.land(doc, ask, 1);
  assert.equal(p.type, "para");
  assert.equal(D.contentOf(p), "first here now.");
  assert.equal(res.cuesDropped, 1);
  assert.ok(res.mark, "the change keeps its mark and Undo");
  assert.equal(Q.spokenWords("**a**[b](https://x.example)"), "ab");
  const two = D.parse("# T\n\n## A\n\n**a**[b](https://x.example) now.\n");
  assert.equal(D.exportCamera(two).includes("*"), false);
});

test("last round: set_cue_settings says where the change really goes", () => {
  const t = TOOLS.find((x) => x.name === "set_cue_settings");
  assert.match(t.description, /Without forScript: the script's own settings if it has them, else the person's\./);
  assert.match(t.description, /forScript: false always sets the person's/);
  assert.doesNotMatch(t.description, /\(else for the person\)/);
});

test("Sounds like me: a rewrite of a quote over part of a cue never deletes the cue's other spoken words", () => {
  const land = (quote, text) => {
    const doc = D.parse("# T\n\n## A\n\nWe **start here** now.\n");
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
  assert.deepEqual(land("We start here", "We start here today"), ["We **start here** today now.", 0]);
  assert.deepEqual(land("We start here now", "We go"), ["We go.", 1]);
});

const plainLines = ['if name=="Lex" or id=="7"', 'name =="Lex",id=="7"', "if a ==1&&b==2", 'f(x)=="a" or g(x)=="b"', '"Lex"==name or id=="7"', "We ==start here== now", "a == b == c", "**kwargs and more", "a**b and c**d", "2**3 and 4**5", "f(**a, **b)", "a ** b ** c", "x**go** now", "**go**s now", "**go now", "go** now", "** go ** now", "***go*** now", "**a*b** now", "****"];
const allWords = (t) => t.replace(/\*/g, "");
test("Bold marking off: nothing reads ** anywhere; the exports and counts are byte for byte as before bold", () => whileOff(() => {
  const bold = "Say **bold** here and **two words** there.";
  const doc = D.parse(`# T\n\n## A\n\nif name=="Lex" or id=="7"\n\na**b and **kwargs\n\nWe **go. Then on** ok.\n\n${bold}\n`);
  const [p1, p2, p3, p4] = paras(doc);
  const pro = D.exportPrompter(doc), cam = D.exportCamera(doc);
  for (const t of ['if name=="Lex" or id=="7"', "a**b and **kwargs", bold]) {
    assert.ok(pro.includes(`\n${t}\n`), t);
    assert.ok(cam.includes(t), t);
  }
  // Sentences split where they did before bold, even inside **…**.
  assert.ok(pro.includes("\nWe **go.\nThen on** ok.\n"));
  assert.ok(pro.includes("### **A**"), "the prompter's own heading marks stay");
  assert.equal(D.exportPrompter(doc, { cues: "show" }), pro);
  assert.equal(D.exportPrompter(doc, { cues: "strip" }), pro);
  for (const t of plainLines) { assert.deepEqual(Q.textCues(t), [], t); assert.equal(Q.stripCues(t), t); }
  assert.deepEqual(Q.textCues(bold), []);
  assert.equal(Q.spokenWords(D.contentOf(p4)), bold);
  assert.match(B.overFor(doc, [{ id: p4.id, start: 0, end: bold.length }]), /\*\*bold\*\*/);
  assert.equal(D.stats(doc).words, [p1, p2, p3, p4].reduce((n, b) => n + D.countWords(D.contentOf(b)), 0));
  assert.deepEqual(C.listCues(doc), []);
  assert.deepEqual(C.planCues(doc, "unmark", [{ quote: "bold" }]).segments, []);
  assert.equal(D.findQuote(doc, "Say bold here"), null);
  assert.equal(Q.dropLoneMarks("here** today"), "here** today");
  // A rewrite and a link go in as they did before bold.
  const [s, e] = sel(bold, "**bold");
  const ask = D.makeAsk(doc, { blockId: p4.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "big** x" }, answeredBy: { id: "agent:x", name: "X" } });
  const res = C.land(doc, ask, 1);
  assert.equal(D.contentOf(p4), "Say big** x** here and **two words** there.");
  assert.equal(res.cuesDropped, 0);
  const links = C.planFor(D.parse("# T\n\n## A\n\nUse **go** now.\n"), { id: "x", scope: "script" }, { links: [{ quote: "go", url: "https://example.com" }] });
  assert.equal(links.segments[0].content, "Use **[go](https://example.com)** now.");
}));

test("Bold marking on: a ** pair is bold only at word boundaries with no space inside its edges; no == is ever read", () => {
  for (const t of plainLines) {
    assert.deepEqual(Q.textCues(t), [], t);
    const doc = D.parse(`# T\n\n## A\n\n${t} end\n`);
    assert.ok(D.exportCamera(doc).includes(t === "****" ? "" : t), t);
  }
  const ok = ["**go** now", "(**go**), now", '"**go**" now', "say **two words**.", "**go!** now", "**go**: now", "**don't** now", "‘**go**’ now", "**A** and **B**", "**3 x 2** now"];
  assert.deepEqual(ok.map((t) => Q.textCues(t).map((c) => c.label).join("|")), ["go", "go", "go", "two words", "go!", "go", "don't", "go", "A|B", "3 x 2"]);
  const doc = D.parse('# T\n\n## A\n\nif name=="Lex" or id=="7"\n\nSay **go** now.\n');
  assert.ok(D.exportPrompter(doc).includes('\nif name=="Lex" or id=="7"\n'));
  assert.ok(D.exportPrompter(doc).includes("\nSay go now.\n"));
  assert.ok(D.exportPrompter(doc).includes("### **A**"), "the prompter's own heading marks stay");
  assert.ok(D.exportPrompter(doc, { cues: "show" }).includes("\nSay **go** now.\n"));
  assert.ok(D.exportCamera(doc).includes("Say go now."));
});

test("an edit that breaks a bold stretch settles it, with no stray marks and no spoken word lost", () => {
  const settle = (old, now, caret) => { const r = Q.settleMarks(old, now, caret); return r && [r.content, r.caret]; };
  // All its words deleted: the marks go, even a whole line of them, which would read as a rule.
  assert.deepEqual(settle("We **a** now", "We **** now", 5), ["We  now", 3]);
  assert.deepEqual(settle("**a**", "****", 2), ["", 0]);
  assert.deepEqual(settle("**a b** x", "** ** x", 3), ["  x", 1]);
  // Spaces at its edges move outside.
  assert.deepEqual(settle("**A blank** x", "** blank** x", 2), [" **blank** x", 0]);
  assert.deepEqual(settle("**A b** x", "**A ** x", 4), ["**A**  x", 6]);
  // A word right before or right after it joins it: typed, or the space between deleted.
  assert.deepEqual(settle("**go** now", "x**go** now", 1), ["**xgo** now", 3]);
  assert.deepEqual(settle("foo **go** now", "foo**go** now", 3), ["**foogo** now", 5]);
  assert.deepEqual(settle("abc\n**go** x", "abc**go** x", 3), ["**abcgo** x", 5]);
  assert.deepEqual(settle("**go** now", "**go**s now", 7), ["**gos** now", 5]);
  assert.deepEqual(settle("**A blank** page's", "**A blank**page's", 11), ["**A blankpage**'s", 9]);
  // A * in it or next to it, a line break in it, or an edit that takes one mark: the marks go, the words stay.
  assert.deepEqual(settle("**go** x", "**g*o** x", 4), ["g*o x", 2]);
  assert.deepEqual(settle("**go** x", "***go** x", 1), ["*go x", 1]);
  assert.deepEqual(settle("**a b** x", "**a\n b** x", 4), ["a\n b x", 2]);
  assert.deepEqual(settle("We **start here** now", "We here** now", 3), ["We here now", 3]);
  assert.deepEqual(settle("We **start here** now", "We **start now", 10), ["We start now", 8]);
  assert.deepEqual(settle("**go** x", "*go** x", 1), ["go x", 0]);
  assert.deepEqual(settle("**a** **b**", "**a****b**", 5), ["ab", 1]);
  // Nothing to settle: punctuation next to it, typing inside it, elsewhere, or no bold at all.
  for (const [old, now, caret] of [["**go** now", "**go**, now", 7], ["**go** now", "(**go** now", 1], ["**go** now", "**gxo** now", 4], ["**go** now", "**go** nowx", 10], ["a**b", "a** b", 3], ["plain", "plainer", 7]]) {
    assert.equal(Q.settleMarks(old, now, caret), null, now);
  }
});

test("every small edit next to bold words leaves only marks that read as bold, and every spoken word", () => {
  const samples = ["We **start here** now.", "**go** and **on**, then.", 'Say "**two words**" x', "**A**", "a **b** c **d e** f"];
  const inserts = ["x", "7", " ", ".", '"', "\n"];
  const check = (old, now, caret) => {
    const r = Q.settleMarks(old, now, caret), out = r ? r.content : now;
    const cues = Q.textCues(out);
    const lit = [...out.matchAll(/\*/g)].filter((m) => !cues.some((c) => m.index === c.start || m.index === c.start + 1 || m.index === c.end - 2 || m.index === c.end - 1));
    assert.equal(lit.length, 0, `${JSON.stringify(old)} -> ${JSON.stringify(now)} -> ${JSON.stringify(out)}`);
    assert.equal(allWords(out), allWords(now), `${JSON.stringify(now)} keeps its words`);
    if (r?.caret != null) assert.ok(r.caret >= 0 && r.caret <= out.length);
  };
  for (const old of samples) {
    for (let i = 0; i <= old.length; i++) for (const x of inserts) check(old, old.slice(0, i) + x + old.slice(i), i + x.length);
    for (let i = 0; i < old.length; i++) for (let n = 1; i + n <= old.length; n++) check(old, old.slice(0, i) + old.slice(i + n), i);
  }
});

test("typing a word in front of a bold word: it joins while typed, and stays plain once its space is typed", () => {
  const run = (old, now, caret, typedBefore) => { const r = Q.settleMarks(old, now, caret, { typedBefore }); return r && [r.content, r.caret, r.typedBefore ?? null]; };
  assert.deepEqual(run("**go** now", "b**go** now", 1, null), ["**bgo** now", 3, 3]);
  assert.deepEqual(run("**bgo** now", "**bigo** now", 4, 3), ["**bigo** now", 4, 4]);
  assert.deepEqual(run("**bigo** now", "**biggo** now", 5, 4), ["**biggo** now", 5, 5]);
  assert.deepEqual(run("**biggo** now", "**big go** now", 6, 5), ["big **go** now", 4, null]);
  assert.deepEqual(run("**biggo** now", "**bigo** now", 4, 5), ["**bigo** now", 4, 4]);
  assert.equal(Q.settleMarks("**biggo**", "**big go**", 6), null);
  assert.equal(Q.settleMarks("foo **go**", "foo**go**", 3).typedBefore ?? null, null);
  assert.deepEqual(run("Say **go** now", "Say x**go** now", 5, null), ["Say **xgo** now", 7, 7]);
  assert.deepEqual(run("Say **xgo** now", "Say **x go** now", 8, 7), ["Say x **go** now", 6, null]);
});

test("emptying a bold stretch takes its marks at edit time for everyone, even with Bold marking off (a guest's default)", () => {
  const both = (old, now, caret, want) => {
    assert.deepEqual(Q.settleMarks(old, now, caret)?.content, want, `on: ${now}`);
    whileOff(() => assert.deepEqual(Q.settleMarks(old, now, caret)?.content, want, `off: ${now}`));
  };
  both("We **a** now", "We **** now", 5, "We  now");
  both("**a**", "****", 2, "");
  both("We **a b** now", "We **** now", 5, "We  now");
  whileOff(() => {
    assert.equal(Q.settleMarks("We **a** now", "We **** now", 5).caret, 3);
    // Anything that was never a stretch, and any other edit, stays byte for byte.
    assert.equal(Q.settleMarks("a**b**c", "a****c", 3), null);
    assert.equal(Q.settleMarks("if x **1 and y**2", "if x ****2", 7), null);
    assert.equal(Q.settleMarks("a ** b ** c", "a **** c", 4), null);
    assert.equal(Q.settleMarks("We **a\nb** now", "We **** now", 5), null);
    assert.equal(Q.settleMarks("We **** now", "We ***** now", 6), null);
    assert.equal(Q.settleMarks("We **a** now", "We **b** now", 6), null);
    assert.equal(Q.settleMarks("We **a** now", "We **a* now", 6), null);
    assert.equal(Q.settleMarks("We **a** now", "We **a** nowx", 13), null);
    assert.deepEqual(Q.textCues("We **a** now"), []);
  });
});

test("asks are anchored by offsets through mark changes: they follow, and never jump into another word", () => {
  // The offsets through a settled edit: outside the edit they follow exactly; an ask the edit touched is not moved.
  const r = Q.settleMarks("Say **go** now", "Say x**go** now", 5);
  assert.equal(r.content, "Say **xgo** now");
  const over = r.follow(4, 14);
  assert.deepEqual(over, { start: 7, end: 15 });
  assert.equal(r.content.slice(over.start, over.end), "go** now");
  assert.deepEqual(r.follow(0, 3), { start: 0, end: 3 });
  assert.equal(r.follow(0, 8), null, "the edit fell inside this ask");
  // Toggling marks: the second of two repeated words stays the second.
  const c = "We no no go.";
  const t = Q.toggleCue(c, 0, 2), m = Q.marksMap(c, t.content), i = c.lastIndexOf("no");
  assert.equal(t.content.slice(m(i), m(i + 2)), "no");
  assert.equal(m(i), t.content.lastIndexOf("no"));
  // The old search no longer follows marks at all: a deleted bold word's ask can't land in another word.
  assert.equal(D.reanchor({ start: 0, quote: "**go**" }, "We **algo** now"), null);
  assert.equal(D.reanchor({ start: 0, quote: "**go** now" }, " **stop** and forgo now"), null);
  // Its answer keeps what was typed, and Lex's decision 6 holds: the words survive, so it stays bold.
  const doc2 = D.parse("# T\n\n## A\n\nSay **go** now.\n"), p2 = paras(doc2)[0], [s, e] = sel(D.contentOf(p2), "**go** now");
  const ask = D.makeAsk(doc2, { blockId: p2.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
  const r2 = Q.settleMarks(D.contentOf(p2), "Say x**go** now.", 5), a2 = r2.follow(ask.start, ask.end);
  D.setContent(doc2, p2.id, r2.content);
  Object.assign(ask, a2, { quote: r2.content.slice(a2.start, a2.end), status: "answered", answer: { kind: "replace", text: "go later" }, answeredBy: { id: "agent:x", name: "X" } });
  assert.ok(C.land(doc2, ask, 1));
  assert.equal(D.contentOf(p2), "Say **xgo** later.");
});

test("marks never change a B-roll shot's check, whatever anyone's setting says; a changed word does", () => {
  const doc = D.parse("# T\n\n## A\n\nSay go now.\n");
  const p = paras(doc)[0], shots = [{ id: "B1", blockIds: [p.id] }];
  B.touchShots(doc, shots);
  // A guest with bold on marks a word in a host with it off, and the other way round.
  whileOff(() => {
    D.setContent(doc, p.id, "Say **go** now.");
    assert.deepEqual(B.touchShots(doc, shots), []);
  });
  assert.deepEqual(B.touchShots(doc, shots), [], "turning it on flags nothing");
  D.setContent(doc, p.id, "Say go now.");
  assert.deepEqual(B.touchShots(doc, shots), []);
  D.setContent(doc, p.id, "Say go later.");
  assert.deepEqual(B.touchShots(doc, shots), ["B1"]);
  const b = D.parse("# T\n\n## A\n\nSay **go** now.\n");
  assert.deepEqual(B.matchOver(B.spokenBlocks(b), '"Say go now."'), [paras(b)[0].id]);
  // With bold on, the Over text never holds marks; with it off it reads the line byte for byte, like every export.
  assert.match(B.overFor(b, [{ id: paras(b)[0].id, start: 0, end: D.contentOf(paras(b)[0]).length }]), /^"Say go now/);
  whileOff(() => assert.match(B.overFor(b, [{ id: paras(b)[0].id, start: 0, end: D.contentOf(paras(b)[0]).length }]), /^"Say \*\*go\*\* now/));
});

test("mark_cue checks each quote on its own; a quote across a line break, or with * in it, is skipped with the reason", () => {
  const doc = D.parse("# T\n\n## A\n\nIs 5*4 true and we go on.\n");
  const plan = C.planCues(doc, "mark", [{ quote: "4" }, { quote: "go" }, { quote: "a*b" }]);
  assert.deepEqual(plan.segments.map((x) => x.content), ["Is 5*4 true and we **go** on."]);
  assert.deepEqual(plan.skipped, [{ quote: "4", why: "would not read as a cue there" }, { quote: "a*b", why: "cue words hold no brackets, * signs or line breaks" }]);
  const two = D.parse("# T\n\n## A\n\nWe start\nhere now.\n");
  assert.deepEqual(C.planCues(two, "mark", [{ quote: "start here" }]), { segments: [], skipped: [{ quote: "start here", why: "spans a line break" }] });
  assert.equal(Q.toggleCue("**go**now", 6, 9), null);
  assert.equal(Q.toggleCue("x*go", 2, 4), null);
  const three = script(), [, b2] = paras(three);
  assert.equal(C.listCues(three)[0].cueId, `${b2.id}:1:second`);
  D.setContent(three, b2.id, "A **new** and **second** line, we go.");
  assert.deepEqual(C.planCues(three, "unmark", [{ cueId: `${b2.id}:1:second` }]).skipped, [{ quote: `${b2.id}:1:second`, why: "this cue has changed; call list_cues again" }]);
  assert.deepEqual(C.planCues(three, "unmark", [{ cueId: `${b2.id}:2:second` }]).segments.map((x) => x.content), ["A **new** and second line, we go."]);
});

test("an AI answer: a lone ** it copied from the asked text goes; ordinary text and whole bold words stay", () => {
  for (const [t, want] of [["here** today", "here today"], ["**here today", "here today"], ["**go** and here**", "**go** and here"], ["Halt!** now", "Halt! now"]]) assert.equal(Q.dropLoneMarks(t), want);
  for (const t of ["a**b", "2**3 and 4**5", "a ** b", "**go** now", 'if name=="Lex"']) assert.equal(Q.dropLoneMarks(t), t);
  const land = (doc, quote, kind, text) => {
    const p = paras(doc)[0], [s, e] = sel(D.contentOf(p), quote);
    const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
    Object.assign(ask, { status: "answered", answer: { kind, text }, answeredBy: { id: "agent:x", name: "X" } });
    C.land(doc, ask, 1);
    return D.contentOf(p);
  };
  const bold = () => D.parse("# T\n\n## A\n\nWe **start here** now.\n");
  assert.equal(land(bold(), "here** now", "replace", "here** today"), "We **start here** today.");
  assert.equal(land(bold(), "**start here**", "add", "and here** too"), "We **start here** and here too now.");
  // No marks in what was asked about: the AI's text goes in as it wrote it.
  assert.equal(land(D.parse("# T\n\n## A\n\nWe start now.\n"), "start", "replace", "check a** b"), "We check a** b now.");
  // A rewrite that would put a cue where it can't read back drops it and says so.
  assert.deepEqual(Q.keepCues("**go**", "Stop*go now"), { text: "Stop*go now", dropped: 1 });
  assert.deepEqual(Q.keepCues("**go**", "We go now"), { text: "We **go** now", dropped: 0 });
  // Words split over two lines can't be one cue: it goes, no broken marks.
  assert.deepEqual(Q.keepCues("We **start here** now", "So we start\nhere today"), { text: "So we start\nhere today", dropped: 1 });
  // Going back and forth, a mark moves its ask no further than its own characters.
  const m = Q.marksMap("**no**, no", "no, no"), back = Q.marksMap("no, no", "**no**, no");
  assert.deepEqual([m(8), m(10)], [4, 6]);
  assert.deepEqual([back(4), back(6)], [8, 10]);
});

test("an AI rewrite keeps ** in ordinary text: only an ask that reaches a real bold stretch loses a lone mark", () => {
  const land = (text, quote, answer) => {
    const doc = D.parse(`# T\n\n## A\n\n${text}\n`), p = paras(doc)[0], [s, e] = sel(text, quote);
    const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
    Object.assign(ask, { status: "answered", answer: { kind: "replace", text: answer }, answeredBy: { id: "agent:x", name: "X" } });
    C.land(doc, ask, 1);
    return D.contentOf(p);
  };
  assert.equal(land("Pass **kwargs here and go.", "**kwargs here", "**kwargs now"), "Pass **kwargs now and go.");
  assert.equal(land("Use a**b here.", "a**b here", "a**b now"), "Use a**b now.");
  assert.equal(land("Use **go here and **on there.", "**go here", "**go now"), "Use **go now and **on there.");
  // An ask that does reach bold words still loses what it copied alone, also over half of them.
  assert.equal(land("We **start here** now.", "here** now", "here** today"), "We **start here** today.");
  assert.equal(land("Pass **kwargs and **go** now.", "**go** now", "go** later"), "Pass **kwargs and **go** later.");
});

test("emptying a stretch over several selections leaves no **** either, with Bold marking off too", () => {
  const inner = "two words here", start = "We **", end = "** now", full = start + inner + end;
  const step = (text, from, to) => {
    const now = text.slice(0, from) + text.slice(to), r = Q.settleMarks(text, now, from);
    return r ? r.content : now;
  };
  const run = () => {
    for (let k = 1; k < inner.length; k++) {
      // The first part, then the rest; the last part, then the rest.
      const a = step(full, start.length, start.length + k);
      const fromA = a.indexOf(inner.slice(k).trim(), 3);
      const restA = a.slice(fromA).replace(/\*\*.*$/s, "");
      const doneA = step(a, fromA, fromA + restA.length);
      const b = step(full, start.length + k, start.length + inner.length);
      const firstB = b.indexOf(inner.slice(0, k).trim(), 3);
      const restB = b.slice(firstB).replace(/\*\*.*$/s, "");
      const doneB = step(b, firstB, firstB + restB.length);
      for (const t of [doneA, doneB]) {
        assert.ok(!t.includes("*"), JSON.stringify(t));
        assert.ok(t.startsWith("We ") && t.endsWith(" now"), JSON.stringify(t));
      }
    }
  };
  run();
  whileOff(run);
  whileOff(() => {
    assert.equal(Q.settleMarks("We **two ** now", "We **** now", 5)?.content, "We  now");
    assert.equal(Q.settleMarks("We ** words** now", "We **** now", 5)?.content, "We  now");
    // Only spaces left between the marks: nothing to empty, so it stays as it is.
    assert.equal(Q.settleMarks("We ** ** now", "We **** now", 5), null);
    // Text that was never one: no words at an edge on either side, or a word or * outside the marks, or a link.
    for (const [old, now, caret] of [["a ** b ** c", "a **** c", 4], ["x**two ** y", "x**** y", 3], ["We **two **y", "We ****y", 5], ["We ***two ** y", "We ***** y", 6], ["We **[a](https://x.example)** y", "We **** y", 5]]) {
      assert.equal(Q.settleMarks(old, now, caret), null, old);
    }
  });
  // With other bold words in the paragraph, it reads the same.
  assert.equal(Q.settleMarks("**x** and **two ** now", "**x** and **** now", 12)?.content, "**x** and  now");
});

test("a host's asks follow a guest's marks by offsets: each room edit moves them, and they stay on their own word", () => {
  const before = "We no no no", after = "We **no** no no", ask = { start: 6, end: 8 };
  const ops = diff([{ id: "p", text: before, attrs: { type: "para" } }], [{ id: "p", text: after, attrs: { type: "para" } }]);
  let at = ask;
  for (const op of ops) at = C.followTextOp(at, op) ?? at;
  assert.deepEqual(at, { start: 10, end: 12 });
  assert.equal(after.slice(at.start, at.end), "no");
  assert.equal(after.slice(at.start - 7, at.start), "**no** ", "the second no, not the first");
  assert.deepEqual(D.reanchor({ ...at, quote: "no" }, after), at);
  // Taking the bold off again, the same way back.
  let back = at;
  for (const op of diff([{ id: "p", text: after, attrs: { type: "para" } }], [{ id: "p", text: before, attrs: { type: "para" } }])) back = C.followTextOp(back, op) ?? back;
  assert.deepEqual(back, ask);
  // Before it, typed right at its edges, or inside it: nothing moves by offsets here.
  const op = (a, del, ins) => ({ type: "text", blockId: "p", at: a, del, ins });
  assert.equal(C.followTextOp({ start: 6, end: 8 }, op(8, 0, "x")), null, "typed right after it");
  assert.deepEqual(C.followTextOp({ start: 6, end: 8 }, op(6, 0, "x")), { start: 7, end: 9 }, "typed right before it");
  assert.equal(C.followTextOp({ start: 6, end: 8 }, op(7, 0, "x")), null, "inside it: the old rules decide");
  assert.equal(C.followTextOp({ start: 6, end: 8 }, { type: "split", blockId: "p", at: 2, newId: "q" }), null);
});

test("a range follows the marks to its own words: its end never slides past a closing mark", () => {
  const r = Q.marksRange("no x", "**no** x");
  assert.deepEqual(r(0, 2), { start: 2, end: 4 });
  assert.deepEqual(r(3, 4), { start: 7, end: 8 });
  const back = Q.marksRange("**no** x", "no x");
  assert.deepEqual(back(2, 4), { start: 0, end: 2 });
  assert.deepEqual(back(0, 6), { start: 0, end: 2 });
  assert.deepEqual(back(0, 8), { start: 0, end: 4 });
  const wide = Q.marksRange("We go now", "We **go now**");
  assert.deepEqual(wide(3, 5), { start: 5, end: 7 });
  assert.deepEqual(wide(6, 9), { start: 8, end: 11 });
  // An empty range stays empty.
  assert.deepEqual(r(2, 2), { start: 6, end: 6 });
  // Through a settled edit: the ask on A stays on A when a later word goes.
  assert.deepEqual(Q.settleMarks("**A b** x", "**A ** x", 4).follow(2, 3), { start: 2, end: 3 });
});

test("a cue never ends before a combining mark, and whole words count them", () => {
  assert.deepEqual(C.planCues(D.parse("# T\n\n## A\n\nनमस्ते दोस्त\n"), "mark", [{ quote: "नमस" }]).segments, []);
  assert.deepEqual(Q.textCues("**नमस**्ते"), []);
});

test("emptying a stretch looks past spaces at one inner edge, on a line of its own too, with Bold marking off; outer words first is the written limit", () => {
  const old2 = "We ** words** more";
  const run = (...edits) => {
    let t = edits.shift();
    for (const words of edits) {
      const i = t.indexOf(words), now = t.slice(0, i) + t.slice(i + words.length), r = Q.settleMarks(t, now, i);
      t = r ? r.content : now;
    }
    return t;
  };
  whileOff(() => {
    assert.equal(run("We **two words** now", "two", "words"), "We   now");
    assert.equal(run("We **two words** now", "words", "two"), "We   now");
    assert.equal(run("We **two words here** now", "two", "words here"), "We   now");
    assert.equal(run("**a b**", "a", "b"), " ");
    assert.equal(run("**a b**", "b", "a"), " ");
    // A whole paragraph stays a paragraph at every step.
    const doc = D.parse("# T\n\n## A\n\n**a b**\n\nNext.\n"), p = paras(doc)[0];
    for (const [now, caret] of [["** b**", 2], ["** **", 3]]) {
      const old = D.contentOf(p), r = Q.settleMarks(old, now, caret);
      D.setContent(doc, p.id, r ? r.content : now);
      assert.equal(doc.blocks.find((b) => b.id === p.id)?.type, "para", now);
    }
    assert.equal(D.contentOf(p).includes("*"), false);
    // Still byte for byte: spaces on both inner edges, a word or * outside the marks, a link, a line break, other edits.
    for (const [old, now, caret] of [
      ["a ** b ** c", "a **  ** c", 5], ["a ** b ** c", "a **** c", 4], ["x** b** y", "x** ** y", 4], ["We ** b**y", "We ** **y", 6],
      ["We *** b** y", "We *** ** y", 7], ["We ** [a](https://x.example)** y", "We ** ** y", 6], ["We **a\n b** y", "We **a\n ** y", 8],
      ["We ** b** y", "We ** b**", 9], ["We ** b** y", "We ** c** y", 7],
      // A space deleted between marks that hold only spaces: never a stretch, so a comparison's signs stay.
      ["a **  ** c", "a ** ** c", 5], ["a ** ** c", "a **** c", 4],
    ]) assert.equal(Q.settleMarks(old, now, caret), null, `${old} -> ${now}`);
    // The limit: deleting the outer words first spaces both edges, which reads like "a ** b ** c", so the marks stay.
    assert.equal(run("We **one two three** now", "one", "three", "two"), "We **  ** now");
    // The caret lands where the words were, and a range after them follows.
    const gone = Q.settleMarks("We ** words more", "We ** more", 6);
    assert.equal(gone, null, "no closing marks: nothing to take");
    const empt = Q.settleMarks("We ** words** more", "We ** ** more", 6);
    assert.equal(empt.content, "We   more");
    assert.equal(empt.caret, 4);
    assert.deepEqual(empt.follow(old2.indexOf("more"), old2.length), { start: 5, end: 9 });
  });
  // The same with Bold marking on, where the first edit already moved the space out.
  assert.equal(run("We **two words** now", "two", "words").includes("*"), false);
});

test("a paste that breaks a bold stretch inside an open ask's range doesn't move the ask: it is cancelled", () => {
  const old = "We **go** now and more", pasted = `${old.slice(0, 6)}=*${old.slice(7)}`;
  const r = Q.settleMarks(old, pasted, 8);
  assert.equal(r.content, "We g=* now and more");
  assert.equal(r.follow(3, 12), null, "the paste fell inside this ask");
  // One wholly after the paste follows its own words.
  const after = r.follow(old.indexOf("more"), old.length);
  assert.equal(r.content.slice(after.start, after.end), "more");
  // Its quote is gone from the text, so it is cancelled rather than moved onto other words.
  assert.equal(D.reanchor({ start: 3, quote: old.slice(3, 12) }, r.content), null);
});

test("looking past spaces never takes a mark that belongs to a real stretch the edit didn't touch", () => {
  const cases = [["**a!** b** x", "**a!** ** x", 7], ["a **b **(c)** d", "a ** **(c)** d", 4]];
  for (const [old, now, caret] of cases) {
    assert.equal(Q.settleMarks(old, now, caret), null, `on: ${old}`);
    whileOff(() => assert.equal(Q.settleMarks(old, now, caret), null, `off: ${old}`));
  }
  // The stretch being emptied still loses its own marks, beside a real one.
  assert.equal(Q.settleMarks("**a!** **two ** x", "**a!** **** x", 9)?.content, "**a!**  x");
  whileOff(() => assert.equal(Q.settleMarks("**a!** **two ** x", "**a!** **** x", 9)?.content, "**a!**  x"));
});

test("marks the deletion put back aren't hit: Ctrl+Backspace next to a bold stretch leaves no stray marks", () => {
  // keepHidden puts back the hidden marks, then settleMarks is told what was really deleted.
  const chain = (old, typed, caret) => {
    const f = L.keepHidden(old, typed, Q.textCues(old), caret);
    assert.ok(f, "hidden marks were lost");
    const r = Q.settleMarks(old, f.content, f.caret, { deleted: f.gone });
    return r ? [r.content, r.caret] : [f.content, f.caret];
  };
  const old = "Say **big word** now okay.";
  assert.deepEqual(L.keepHidden(old, "Say **big now okay.", Q.textCues(old), 10).gone, [[10, 14], [16, 17]]);
  // Ctrl+Backspace after the space before "now": it takes "word", the hidden marks and the space.
  assert.deepEqual(chain(old, "Say **big now okay.", 10), ["Say **big** now okay.", 12]);
  // Right after the closing marks: "word" and the hidden marks.
  assert.deepEqual(chain(old, "Say **big  now okay.", 10)[0], "Say **big**  now okay.");
  // Ctrl+Delete from before the opening marks: the hidden marks and "big".
  assert.equal(chain(old, "Say  word** now okay.", 4)[0], "Say  **word** now okay.");
  // A one-word stretch deleted whole goes as a whole, as it was seen.
  assert.equal(L.keepHidden("Say **big** now", "Say now", Q.textCues("Say **big** now"), 4), null);
  assert.equal(Q.settleMarks("Say **big** now", "Say now", 4)?.content ?? "Say now", "Say now");
  // Two stretches, with a space left between them: only the one reached changes.
  assert.equal(chain("**a b**  **c d** x", "**a  **c d** x", 4)[0], "**a**  **c d** x");
  // The only space between them deleted, so they touch: both lose their marks, no stray marks and no other word lost.
  assert.equal(chain("**a b** **c d** x", "**a **c d** x", 4)[0], "a c d x");
  // Whatever it leaves, every mark still reads as bold and no word is lost.
  const ask = Q.settleMarks(old, "Say **big **now okay.", 10, { deleted: [[10, 14], [16, 17]] });
  const after = ask.follow(old.indexOf("now"), old.indexOf("now") + 3);
  assert.equal(ask.content.slice(after.start, after.end), "now");
  assert.equal(ask.follow(6, 12), null, "the deletion fell inside this ask");
  assert.equal(Q.settleMarks(old, "Say **big **now okay.", 10, { deleted: [[10, 14], [16, 17]], typedBefore: 3 }).typedBefore ?? null, null);
});

test("set_cue_settings says so when the browser couldn't store the change", () => {
  const out = Q.settingsOutcome({ saved: false, words: "", forScript: false, hadOwn: false, stored: false });
  assert.equal(out.banner, null);
  assert.match(out.message, /could not be saved/i);
  assert.doesNotMatch(out.message, /in force already/);
  assert.match(Q.settingsOutcome({ saved: true, words: "", forScript: false, hadOwn: false, stored: false }).message, /in force already/);
  assert.match(Q.settingsOutcome({ words: "", forScript: false, hadOwn: false, stored: false }).message, /in force already/);
});

test("a line whose bold words would read as another kind of block without their marks: settleMarks shows it, keepsType refuses", () => {
  for (const [line, caret] of [["**- item two**", 2], ["**# Plan**", 2], ["**> x y**", 2], ["**1. x y**", 2], ["**- item two** more", 2]]) {
    const now = line.slice(0, caret - 1) + line.slice(caret);
    const r = Q.settleMarks(line, now, caret - 1);
    assert.ok(r, line);
    assert.equal(C.keepsType(r.content, "para"), false, `${line} -> ${r.content}`);
    assert.equal(C.keepsType(line, "para"), true, line);
  }
  // Ordinary bold words: the same edit is fine.
  const r = Q.settleMarks("**big word** now", "*big word** now", 1);
  assert.equal(C.keepsType(r.content, "para"), true);
});

test("an AI rewrite in a heading treats ** as plain text: it stays, and no cue is reported removed", () => {
  const land = (md, quote, text, kind = "replace") => {
    const doc = D.parse(md), b = doc.blocks.find((x) => x.type === "heading"), c = D.contentOf(b), [s, e] = sel(c, quote);
    const ask = D.makeAsk(doc, { blockId: b.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
    Object.assign(ask, { status: "answered", answer: { kind, text }, answeredBy: { id: "agent:x", name: "X" } });
    const res = C.land(doc, ask, 1);
    return [D.contentOf(b), res.cuesDropped];
  };
  assert.deepEqual(land("# T\n\n## **Plan** now\n\nWords.\n", "Plan", "Goal"), ["**Goal** now", 0]);
  assert.deepEqual(land("# T\n\n## **Plan** now\n\nWords.\n", "**Plan** now", "Goal now"), ["Goal now", 0]);
  assert.deepEqual(land("# T\n\n## **Plan** now\n\nWords.\n", "**Plan**", "more", "add")[1], 0);
  assert.doesNotMatch(C.answerResult("replace", { cuesDropped: 0 }), /cue/);
  // Paragraphs keep the rule.
  const doc = D.parse("# T\n\n## A\n\nWe **start here** now.\n"), p = paras(doc)[0], [s, e] = sel(D.contentOf(p), "**start here**");
  const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "begin" }, answeredBy: { id: "agent:x", name: "X" } });
  assert.equal(C.land(doc, ask, 1).cuesDropped, 1);
});

test("a quote read without the marks is only looked for across bold in paragraphs", () => {
  const doc = D.parse("# T\n\n## **Plan** now\n\nWords.\n");
  assert.equal(D.findQuote(doc, "Plan now"), null);
  assert.equal(D.findQuote(D.parse("# T\n\n## A\n\n**Plan** now\n"), "Plan now").quote, "Plan** now");
});

test("only settling that changes how the text reads is refused: a paste or edit that does it on purpose goes in", () => {
  const changes = C.settlingChangesKind;
  // Losing the marks would turn the line into something else.
  for (const [now, settled] of [["*- item two**", "- item two"], ["*# Plan**", "# Plan"], ["*> x y**", "> x y"], ["*1. x y**", "1. x y"], ["*- item two** more", "- item two more"], ["**- a****b**", "- ab"]]) {
    assert.equal(changes(now, settled), true, settled);
  }
  // A paste with a blank line reads as two paragraphs with or without marks; a list pasted on purpose is a list either way.
  for (const [now, settled] of [["**big a\n\nb** now", "big a\n\nb now"], ["**big worder\n\nnext**", "**big worder**\n\nnext"], ["- item** now", "- item now"], ["****", ""], ["We **** now", "We  now"], ["**big word** now", "big word now"]]) {
    assert.equal(changes(now, settled), false, settled);
  }
});

test("the setting says it is experimental, with its known limits in one plain line", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const features = await readFile(new URL("../docs/features.md", import.meta.url), "utf8");
  const limits = "Rare edits next to bold lines can leave marks as text; shared scripts have edge cases; the prompter doesn't show inline ** yet.";
  assert.ok(html.includes("Bold marking (experimental)"));
  assert.ok(html.includes(limits));
  assert.ok(features.includes("Bold marking (experimental)"));
  assert.ok(features.includes(limits));
});

test("quoteSelection (B-roll): a quote across a bold edge is found, mapped back to the text with its marks", () => {
  const doc = D.parse("# Title\n\n## Part\n\nSay **big word** now okay.\n\nA **second** line here.\n");
  const para = (i) => D.contentOf(D.outline(doc).sections.flatMap((s) => s.blocks).filter((b) => b.type === "para")[i]);
  const t0 = para(0);
  // Bold on: across the opening and across the closing edge, the whole stretch, and across two paragraphs.
  for (const [quote, want] of [["Say big", "Say **big"], ["word now", "word** now"], ["big word", "big word"], ["Say big word now okay.", t0]]) {
    const sel = B.quoteSelection(doc, quote);
    assert.equal(sel.length, 1, quote);
    assert.equal(t0.slice(sel[0].start, sel[0].end), want, quote);
  }
  const two = B.quoteSelection(doc, "now okay. A second");
  assert.equal(two.length, 2);
  assert.equal(t0.slice(two[0].start, two[0].end), "now okay.");
  assert.equal(para(1).slice(two[1].start, two[1].end), "A **second");
  // Each is a selection overFor can use, and the shot matches the same paragraphs again.
  const across = B.quoteSelection(doc, "Say big");
  assert.deepEqual(B.matchOver(B.spokenBlocks(doc), B.overFor(doc, across)), [across[0].id]);
  // The agent's answer: an add with such a quote is accepted and its Over matches the same paragraph.
  const answered = B.checkBrollAnswer({ id: "a1", scope: "selection", action: "broll", status: "taken" }, { changes: [{ op: "add", kind: "broll", what: "x", quote: "Say big" }] }, { doc });
  assert.ok(!answered.error, answered.error);
  assert.deepEqual(B.matchOver(B.spokenBlocks(doc), answered.answer.changes[0].over), [across[0].id]);
  // A whole word only, as before; an exact match on the marks is still found first.
  assert.deepEqual(B.quoteSelection(doc, "ig word"), []);
  assert.equal(B.quoteSelection(doc, "**big word**").length, 1);
  // Bold off: the marks are plain text, so the spoken-text quote is not found (nothing changes from before bold).
  whileOff(() => assert.deepEqual(B.quoteSelection(doc, "Say big"), []));
  // Bold in one paragraph only, and a quote across two bold stretches.
  const mixed = D.parse("# Title\n\n## Part\n\nPlain line here.\n\nA **second** line\n\n**one** and **two** end\n");
  const paras = D.outline(mixed).sections.flatMap((s) => s.blocks).filter((b) => b.type === "para");
  const at = (i) => D.contentOf(paras[i]);
  const half = B.quoteSelection(mixed, "here. A second");
  assert.equal(half.length, 2);
  assert.equal(at(0).slice(half[0].start, half[0].end), "here.");
  assert.equal(at(1).slice(half[1].start, half[1].end), "A **second");
  const twice = B.quoteSelection(mixed, "one and two");
  assert.equal(twice.length, 1);
  assert.equal(at(2).slice(twice[0].start, twice[0].end), "one** and **two");
  // A quote found as written wins, as before bold: "now okay" lands on the plain copy, not on the one hidden by marks.
  const twin = D.parse("# T\n\n## P\n\nSay **now** okay.\n\nLater now okay again.\n");
  const hit = B.quoteSelection(twin, "now okay");
  assert.equal(hit.length, 1);
  assert.equal(D.contentOf(D.blockById(twin, hit[0].id)), "Later now okay again.");
});

test("a stretch alone on its line, emptied outer words first: the last words going take the marks, no ** ** rule line is left (fleet #29)", () => {
  for (const on of [false, true]) {
    Q.readCuesWhen(() => on);
    // "one two three" -> delete "one" -> delete "three" -> delete "two"; each step is one edit. (With bold on, the first
    // deletion moves the space outside the marks, so it never gets here.)
    let text = on ? "** two **" : "**one two three**";
    for (const word of on ? ["two"] : ["one", "three", "two"]) {
      const i = text.indexOf(word), now = text.slice(0, i) + text.slice(i + word.length);
      const settled = Q.settleMarks(text, now, i);
      if (word === "two") {
        assert.equal(settled?.content, "  ", `bold ${on}: the marks go with the last words`);
        assert.equal(D.parse(settled.content).blocks.some((b) => b.type === "raw"), false);
      } else assert.equal(settled, null, `bold ${on}: ${word} leaves the marks as they were (documented limit)`);
      text = settled?.content ?? now;
    }
    assert.equal(text, "  ");
    // Not alone on its line: "a ** b ** c" is still not a stretch, the edit keeps every byte.
    assert.equal(Q.settleMarks("a ** two ** c", "a **  ** c", 5), null);
    assert.equal(Q.settleMarks("x\n** two **\ny", "x\n**  **\ny", 6)?.content, "x\n  \ny", "alone on a line of its own inside a paragraph");
  }
  Q.readCuesWhen(() => true);
});

test("a room edit inside a range, by offsets (textOpInside): inside or across it, not before, after or at its edges", () => {
  const op = (at, del, ins = "") => ({ type: "text", blockId: "p", at, del, ins });
  const r = { start: 6, end: 8 };
  assert.equal(C.textOpInside(r, op(7, 0, "x")), true, "typed inside");
  assert.equal(C.textOpInside(r, op(6, 1)), true, "a letter deleted from it");
  assert.equal(C.textOpInside(r, op(5, 2)), true, "deleted across its start");
  assert.equal(C.textOpInside(r, op(7, 3)), true, "deleted across its end");
  assert.equal(C.textOpInside(r, op(6, 0, "x")), false, "typed right before it");
  assert.equal(C.textOpInside(r, op(8, 0, "x")), false, "typed right after it");
  assert.equal(C.textOpInside(r, op(2, 3)), false, "deleted before it");
  assert.equal(C.textOpInside(r, op(8, 2)), false, "deleted after it");
  assert.equal(C.textOpInside(r, { type: "split", blockId: "p", at: 7 }), false);
});

test("followRoomEdit: a host's ask goes through a guest's edit with bold on: closed when the edit fell inside, kept when it only spans its words", () => {
  const op = (at, del, ins = "") => ({ type: "text", blockId: "p", at, del, ins });
  const ask = (start, end) => ({ start, end });
  // The ask on "two" in "**one two three**" (offsets 6..9).
  const text = "**one two three**", two = ask(6, 9);
  assert.deepEqual(C.followRoomEdit(two, op(0, 0, "x"), text), { start: 7, end: 10 }, "typed before it");
  assert.deepEqual(C.followRoomEdit(two, op(12, 0, "x"), text), { start: 6, end: 9 }, "typed after it");
  assert.equal(C.followRoomEdit(two, op(7, 0, "x"), text), null, "typed inside it");
  assert.equal(C.followRoomEdit(two, op(8, 3), text), null, "deleted across its end");
  assert.equal(C.followRoomEdit(two, { type: "split", blockId: "p", at: 7, newId: "q" }, text), null, "a split inside it");
  assert.deepEqual(C.followRoomEdit(two, { type: "split", blockId: "p", at: 3, newId: "q" }, text), { start: 6, end: 9 }, "a split before it is for moveAsks");
  // One op from the first changed character to the last: "**one two three**" -> "one two three" (a guest deleted a "*").
  assert.deepEqual(C.followRoomEdit(two, op(0, 17, "one two three"), text), { start: 4, end: 7 }, "its characters were kept side by side: follow them");
  // Several edits sent as one: an edit before it and one after it, its own word untouched.
  assert.deepEqual(C.followRoomEdit(ask(3, 5), op(0, 22, "we! no and then there"), "so no and then no more"), { start: 4, end: 6 }, "edits around an untouched word");
  // Its own word gone, another copy of it later in the same edit: never moved onto the copy.
  assert.equal(C.followRoomEdit(ask(3, 5), op(0, 22, "we and then no more!"), "so no and then no more"), null, "the ask's word was deleted");
  assert.equal(C.followRoomEdit(ask(3, 5), op(0, 22, "we and then no more!"), null), null, "no text from before: closed");
  assert.equal(C.followRoomEdit(two, op(0, 17, "one and three"), text), null, "the words changed");
  // A whole line pasted over: the ask's letters turn up inside a longer word, which is not its word any more.
  assert.equal(C.followRoomEdit(ask(3, 5), op(0, 10, "take note"), "so no more"), null, "no grew into a longer word");
  // A combining mark counts as part of a word, as in cues.js: "no" + mark is another word.
  assert.equal(C.followRoomEdit(ask(3, 5), op(0, 10, "we no\u0301 more!"), "so no more"), null, "a combining mark grew into the word");
  // Bold off on the host: the old rules (followTextOp), and a null for an edit inside, which leaves the search to decide.
  assert.equal(C.followTextOp(two, op(7, 0, "x")), null);
});

test("alignChars: where each character of the old text is in the new, by the longest run kept in order", () => {
  assert.deepEqual(C.alignChars("abc", "abc"), [0, 1, 2]);
  assert.deepEqual(C.alignChars("a**b**c", "abc"), [0, -1, -1, 1, -1, -1, 2]);
  assert.deepEqual(C.alignChars("no x no", "x no"), [-1, -1, -1, 0, 1, 2, 3], "the end is kept first: the first copy is the one that went");
  assert.deepEqual(C.alignChars("", "xy"), []);
  assert.equal(C.alignChars("a".repeat(600) + "x", "b".repeat(600) + "y"), null, "too big to line up");
});

test("a lone stretch with spaces around it on its line also loses its marks with its last words (no rule line)", () => {
  Q.readCuesWhen(() => false);
  for (const [old, now, at, want] of [["** two ** ", "**  ** ", 3, "   "], [" ** two **", " **  **", 4, "   "], ["\t** two **  ", "\t**  **  ", 4, "\t    "]]) {
    const s = Q.settleMarks(old, now, at);
    assert.equal(s?.content, want, JSON.stringify(old));
    assert.equal(D.parse(s.content).blocks.some((b) => b.type === "raw"), false);
  }
  // Text on the line around it: still not a stretch to settle.
  assert.equal(Q.settleMarks("x ** two ** y", "x **  ** y", 5), null);
  Q.readCuesWhen(() => true);
});
