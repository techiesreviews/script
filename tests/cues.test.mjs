// Cue marking (fleet issue #14, Lex 2026-11-04): a cue is "==words==" in a spoken paragraph. Optional and off by
// default; Ctrl/Cmd+B toggles it on the selected words; the agent lists, marks and unmarks cues; a rewrite keeps a
// cue only when its words survive; the prompter export strips cues unless the export setting says show.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../public/doc.js";
import * as C from "../public/changes.js";
import * as Q from "../public/cues.js";
import * as L from "../public/links.js";
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
  assert.deepEqual(on, { content: "We ==start here==. Then we go on.", start: 5, end: 15, cue: true });
  const off = Q.toggleCue(on.content, on.start, on.end);
  assert.deepEqual(off, { content: c, start: 3, end: 13, cue: false });
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
  assert.deepEqual(C.listCues(doc), [{ cueId: `${p2.id}:1`, quote: "second", section: "1 · Hook", before: "A ", after: " line, we go." }]);
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
  const un = C.planCues(doc, "unmark", [{ cueId: `${p2.id}:1` }, { quote: "go" }, { cueId: "nope:1" }]);
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
