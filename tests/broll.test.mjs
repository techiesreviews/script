import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, contentOf, blockById, setContent, cloneDoc, checkAnswer, ACTIONS } from "../public/doc.js";
import {
  parseBroll, parseOver, matchShots, matchOver, spokenBlocks, touchShots, scriptOrder, forAgent,
  sanitizeSvg, setSketch, checkSketch, normalize, SKETCH_MAX, exportBroll, exportStoryboard, boardHeadState,
  addShot, updateShot, removeShot, nextShotId, overFor, newList,
  quoteSelection, checkBrollAnswer, applyBrollChange, applyBrollChanges, changesToKeep, settleBroll, brollAskAllowed,
  applyBrollChangesReport, dropGone, askForAgent, cleanSketches, isImage, cleanSketch, sketchHtml, withoutPictures, withoutPictureLines, IMAGE_MAX, removeSketch, pictureRoom, noRoomMessage, sketchResult, SKETCH_LIST_CHANGED, sketchAnswer,
} from "../public/broll.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const SCRIPT = read("../public/samples/demo-good-script.md");
const DEMO = read("../public/samples/demo-good-script-broll.md");
const starts = (doc, ids) => ids.map((id) => contentOf(blockById(doc, id)).slice(0, 24));

/* A made-up script and list in the shape of a real one: "…" inside quotes, "through" ranges,
   a "Screen recordings (silent B-roll)" table, "Slide or motion plate", and a row that matches nothing. */
const SHAPE_SCRIPT = `# Made-up video

## 1 · Hook (0:00–0:30)

A storm warning. A broken gutter. And a neighbour asking: "Is our roof safe?"

Last spring the shed roof was completely flat after one night.

## 2 · The repair (0:30–2:00)

It took about two working days to dry out, and then another three days to fix the beams.

Let me walk you through what actually happened. Step one: the leak.

Step two: the patch held for a week.

Step three: it failed, right after you installing it.

It's a list.

## Notes

Not spoken: a line that also says It's a list.
`;
const SHAPE_LIST = `# Video 01 · B-roll list

B-roll is laid over your voice. "Over" says which spoken line it covers.

| # | What to show | Over (A-roll line) | How to make it |
| --- | --- | --- | --- |
| B1 | Three messages popping up | "A storm warning. A broken gutter…" | Mock-up screenshots or slide |
| B2 | A flat shed roof | "the shed roof was completely flat" | Staged photo |
| B3 | Calendar with days crossed out | "about two working days… another three days" | Slide or motion graphic |
| B4 | Five-step timeline | "Let me walk you through what actually happened…" through "you installing it." | Motion plate, no real names |
| B5 | A plain list on paper | "It's a list." | Slide; can reuse a frame from Screen 1 |
| B6 | Something cut from the script | "This line was cut…" | Slide |
| B7 | **Bold** \`code\` and a \\| pipe | "Is our roof safe?" | Slide or motion plate |

## Screen recordings (silent B-roll)

Record these without talking.

| # | What to record | Over (A-roll line) |
| --- | --- | --- |
| S1 | The weather app, then the gutter list | "Step two: the patch held…" through "Step three" |
`;

test("parses the demo list: 10 shots, 3 motion plates, 2 screen recordings, 10 sketches", () => {
  const { shots, sketches } = parseBroll(DEMO);
  assert.deepEqual(shots.map((s) => s.id), ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "S1", "S2"]);
  assert.deepEqual(shots.filter((s) => s.kind === "motion").map((s) => s.id), ["B3", "B4", "B8"]);
  assert.deepEqual(shots.filter((s) => s.kind === "screen").map((s) => s.id), ["S1", "S2"]);
  assert.equal(shots[3].over, '"A script is not read…" through "…show it on screen."');
  assert.equal(shots[8].how, "");
  assert.deepEqual(Object.keys(sketches).sort(), ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "S1", "S2"]);
  for (const svg of Object.values(sketches)) assert.match(svg, /^<svg viewBox="0 0 260 140">.+<\/svg>$/);
});

test("every demo shot is found on the demo script's lines, the range covers three lines", () => {
  const doc = parse(SCRIPT);
  const { shots } = parseBroll(DEMO);
  matchShots(doc, shots);
  for (const s of shots) assert.ok(s.blockIds.length, `${s.id} is not found`);
  const by = Object.fromEntries(shots.map((s) => [s.id, s]));
  assert.deepEqual(starts(doc, by.B4.blockIds), ["A script is not read. It", "So use short sentences, ", "And when something is ha"]);
  assert.deepEqual(starts(doc, by.B3.blockIds), ['Not "In this video I wil']); // quotes inside the quote
  assert.deepEqual(by.B5.blockIds, [by.B4.blockIds[2]]); // found inside a line, not at its start
  assert.deepEqual(scriptOrder(doc, shots).map((s) => s.id), ["B1", "B2", "B3", "B4", "B5", "S1", "B7", "S2", "B6", "B8"]);
  assert.deepEqual(Object.keys(forAgent(by.B4)), ["id", "what", "over", "how", "kind", "blockIds", "check"]);
});

test("a real list's shape: … inside quotes, through ranges, screen table, motion detection, not found", () => {
  const doc = parse(SHAPE_SCRIPT);
  const { shots } = parseBroll(SHAPE_LIST);
  matchShots(doc, shots);
  const by = Object.fromEntries(shots.map((s) => [s.id, s]));
  assert.deepEqual(shots.map((s) => [s.id, s.kind]), [["B1", "broll"], ["B2", "broll"], ["B3", "motion"], ["B4", "motion"], ["B5", "broll"], ["B6", "broll"], ["B7", "motion"], ["S1", "screen"]]);
  assert.equal(by.B7.what, "Bold code and a | pipe");
  assert.deepEqual(starts(doc, by.B1.blockIds), ["A storm warning. A broke"]);
  assert.deepEqual(starts(doc, by.B2.blockIds), ["Last spring the shed roo"]);
  assert.deepEqual(starts(doc, by.B3.blockIds), ["It took about two workin"]);
  assert.deepEqual(starts(doc, by.B4.blockIds), ["Let me walk you through ", "Step two: the patch held", "Step three: it failed, r"]);
  assert.deepEqual(starts(doc, by.B5.blockIds), ["It's a list."]); // spoken block only, not the notes
  assert.deepEqual(by.B6.blockIds, []);
  assert.deepEqual(starts(doc, by.B7.blockIds), ["A storm warning. A broke"]);
  assert.deepEqual(starts(doc, by.S1.blockIds), ["Step two: the patch held", "Step three: it failed, r"]);
});

test("Over parsing and matching ignore quotes, …, case and punctuation, and match whole words", () => {
  assert.deepEqual(parseOver('"Let me walk you…" through "you installing it."'), { from: ["let me walk you"], to: ["you installing it"] });
  assert.deepEqual(parseOver("“about two working days… another three days”"), { from: ["about two working days", "another three days"], to: null });
  assert.deepEqual(parseOver("no quotes at all"), { from: ["no quotes at all"], to: null });
  assert.deepEqual(parseOver(""), { from: [], to: null });
  assert.equal(normalize("It’s A Test… isn't it?"), "its a test isnt it");
  const doc = parse("## 1 · A\n\nItems are here.\n\nIt is here.\n");
  const list = spokenBlocks(doc);
  assert.deepEqual(matchOver(list, '"it"'), [list[1].id]); // "it" is not the start of "items"
  assert.deepEqual(matchOver(list, '"IT IS, here!"'), [list[1].id]);
  assert.deepEqual(matchOver(list, '"here" through "nowhere"'), [list[0].id]); // a missing end covers the first line
});

test("a change in a covered line flags its shot; other lines do not", () => {
  const doc = parse(SCRIPT);
  const { shots } = parseBroll(DEMO);
  matchShots(doc, shots);
  const by = Object.fromEntries(shots.map((s) => [s.id, s]));
  assert.deepEqual(touchShots(doc, shots), []);
  const before = cloneDoc(doc);
  const mid = by.B4.blockIds[1];
  setContent(doc, mid, contentOf(blockById(doc, mid)).replace("short sentences", "tiny sentences"));
  assert.deepEqual(touchShots(doc, shots), ["B4"]);
  assert.equal(by.B4.check, true);
  assert.equal(by.B5.check, undefined);
  // Undo brings the old text back: that is a change too, and the flag stays.
  by.B4.check = false;
  const undone = cloneDoc(before);
  assert.deepEqual(touchShots(undone, shots), ["B4"]);
  // A line outside every shot changes nothing.
  const free = undone.blocks.find((b) => b.type === "para" && !shots.some((s) => s.blockIds.includes(b.id)));
  setContent(undone, free.id, "Changed.");
  assert.deepEqual(touchShots(undone, shots), []);
});

test("the sanitiser keeps line drawings and drops scripts, handlers, links and styles", () => {
  const dirty = `<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" width="900" onload="alert(1)" style="x">
    <script>alert(1)</script><style>* { fill: red }</style><!-- note -->
    <g class="s" transform="translate(2,3) rotate(4)" onclick="x()"><rect class="s evil o" x="1" y="2" width="3" height="4" rx="1" style="fill:red" fill="red"/></g>
    <a href="javascript:alert(1)"><circle cx="1" cy="1" r="3"/></a>
    <foreignObject><div>hi</div></foreignObject><image href="x.png"/><use href="#a"/>
    <path d="javascript:alert(1)" class="mv"/><path d="M0 0L1 1" transform="url(#x)"/>
    <text x="1" y="2" text-anchor="middle" font-size="99">a &lt;b&gt; &amp; “c”<tspan>gone</tspan></text>
    <polyline points="1,2 3,4"/><line x1="0" y1="0" x2="1" y2="1" class="l"/><ellipse cx="1" cy="1" rx="1" ry="2"/><polygon points="0,0 1,1 0,1"/>
  </svg>`;
  const clean = sanitizeSvg(dirty);
  assert.equal(clean,
    '<svg viewBox="0 0 260 140"><g class="s" transform="translate(2,3) rotate(4)"><rect class="s o" x="1" y="2" width="3" height="4" rx="1"/></g>'
    + '<path class="mv"/><path d="M0 0L1 1"/><text x="1" y="2" text-anchor="middle">a &lt;b&gt; &amp; “c”</text>'
    + '<polyline points="1,2 3,4"/><line x1="0" y1="0" x2="1" y2="1" class="l"/><ellipse cx="1" cy="1" rx="1" ry="2"/><polygon points="0,0 1,1 0,1"/></svg>');
  for (const bad of ["script", "style", "onload", "onclick", "href", "foreignObject", "image", "use", "javascript", "xmlns", "fill="]) assert.ok(!clean.includes(bad), bad);
  assert.equal(sanitizeSvg("<svg><script>x</script></svg>"), "");
  assert.equal(sanitizeSvg("not markup"), "");
  assert.equal(sanitizeSvg('<svg><rect x="1" y="1" width="2" height="2"/>'), '<svg viewBox="0 0 260 140"><rect x="1" y="1" width="2" height="2"/></svg>');
  assert.equal(sanitizeSvg('<rect x="1"/><svg x="1" viewBox="0 0 1 1"><circle r="1"/></svg>'), '<svg viewBox="0 0 260 140"><rect x="1"/><svg x="1" viewBox="0 0 1 1"><circle r="1"/></svg></svg>');
  assert.equal(sanitizeSvg(`<svg><rect x="1"/></svg>`.padEnd(SKETCH_MAX * 2 + 1, " ")), "");
});

test("the Sketches section: replace a sketch, add one, create the section, keep the line endings", () => {
  const svg = '<svg viewBox="0 0 260 140"><rect class="s" x="1" y="1" width="9" height="9"/></svg>';
  // Add to an existing section followed by another heading.
  const mid = "# List\n\n| # | What to show | Over |\n| --- | --- | --- |\n| B1 | A | \"x\" |\n| B2 | B | \"y\" |\n\n## Sketches\n\n```svg B1\n<svg viewBox=\"0 0 260 140\"><circle r=\"2\"/></svg>\n```\n\n## Later\n\nKeep me.\n";
  const added = setSketch(mid, "B2", svg);
  assert.equal(added, mid.replace("```\n\n## Later", "```\n\n```svg B2\n<svg viewBox=\"0 0 260 140\">\n<rect class=\"s\" x=\"1\" y=\"1\" width=\"9\" height=\"9\"/>\n</svg>\n```\n\n## Later"));
  assert.deepEqual(Object.keys(parseBroll(added).sketches), ["B1", "B2"]);
  assert.equal(parseBroll(added).sketches.B2, svg);
  // Replace in place.
  const replaced = setSketch(added, "B1", svg);
  assert.equal(parseBroll(replaced).sketches.B1, svg);
  assert.equal(replaced.match(/```svg B1/g).length, 1);
  assert.ok(replaced.endsWith("## Later\n\nKeep me.\n"));
  // No section yet: it is added at the end. CRLF files stay CRLF.
  const plain = "# List\r\n\r\n| # | What to show | Over |\r\n| --- | --- | --- |\r\n| B1 | A | \"x\" |\r\n";
  const made = setSketch(plain, "B1", svg);
  assert.ok(made.startsWith(plain));
  assert.ok(!/[^\r]\n/.test(made));
  assert.match(made, /\r\n\r\n## Sketches\r\n\r\n```svg B1\r\n<svg viewBox="0 0 260 140">\r\n<rect[^]*\r\n```\r\n$/);
  assert.equal(parseBroll(made).shots.length, 1);
  assert.equal(parseBroll(made).sketches.B1, svg);
  // An empty section at the end of the file.
  assert.equal(setSketch("## Sketches\n", "S1", svg), `## Sketches\n\n\`\`\`svg S1\n${svg.replace(/></g, ">\n<")}\n\`\`\`\n`);
  // The demo list's own sketches survive a rewrite of one of them.
  const demo = setSketch(DEMO, "B3", svg);
  assert.equal(Object.keys(parseBroll(demo).sketches).length, 10);
  assert.equal(parseBroll(demo).sketches.B3, svg);
  assert.equal(parseBroll(demo).shots.length, 10);
});

test("sketch asks: checkSketch limits, and answer_ask refuses them", () => {
  const ask = { id: "a1", scope: "broll", action: "sketch", status: "taken", shots: [{ id: "B4" }, { id: "S1" }] };
  const ok = '<svg viewBox="0 0 260 140"><path class="s" d="M1 1L9 9"/></svg>';
  assert.match(checkSketch(null, {}).error, /Unknown ask/);
  assert.match(checkSketch({ ...ask, scope: "selection" }, { shotId: "B4", svg: ok }).error, /answer_ask/);
  assert.match(checkSketch({ ...ask, status: "kept" }, { shotId: "B4", svg: ok }).error, /finished/);
  assert.match(checkSketch(ask, { shotId: "B9", svg: ok }).error, /B4, S1/);
  assert.match(checkSketch(ask, { shotId: "B4", svg: " " }).error, /required/);
  assert.match(checkSketch(ask, { shotId: "B4", svg: ok.padEnd(SKETCH_MAX + 1, " ") }).error, /longer than 8192/);
  assert.match(checkSketch(ask, { shotId: "B4", svg: "<svg><script>x</script></svg>" }).error, /Nothing drawable/);
  assert.deepEqual(checkSketch(ask, { shotId: "B4", svg: ok.padEnd(SKETCH_MAX, " ") }), { svg: ok });
  assert.deepEqual(checkSketch({ ...ask, status: "answered" }, { shotId: "S1", svg: ok }), { svg: ok });
  assert.match(checkAnswer(ask, { kind: "note", text: "x" }, parse("x")).error, /sketch_shot/);
  assert.match(ACTIONS.sketch.instruction, /0 0 260 140/);
  assert.match(ACTIONS.sketch.instruction, /sketch_shot/);
});

test("a finished shot does not reopen, and shot ids fit sketch fences", () => {
  const ask = { scope: "broll", status: "answered", shots: [{ id: "B1" }], answer: { done: { B1: "undone" } } };
  assert.match(checkSketch(ask, { shotId: "B1", svg: '<svg viewBox="0 0 260 140"><path class="s" d="M0 0L10 10"/></svg>' }).error, /finished \(undone\)/);
  const list = parseBroll("| # | What to show | Over (A-roll line) | How to make it |\n| --- | --- | --- | --- |\n| Screen 1 with a very long name here | x | \"y\" | Slide |\n");
  const id = list.shots[0].id;
  assert.ok(!/\s/.test(id) && id.length <= 20, id);
});

/* ---------- Export: the B-roll list and the storyboard ---------- */
const shape = (shots) => shots.map(({ id, what, over, how, kind }) => ({ id, what, over, how, kind }));

test("B-roll export round trip: script order, a Kind column, the Sketches section, parsed back the same", () => {
  const doc = parse(SCRIPT);
  const { shots, sketches } = parseBroll(DEMO);
  matchShots(doc, shots);
  shots.find((s) => s.id === "B6").check = true;
  const ordered = scriptOrder(doc, shots);
  const md = exportBroll(ordered, sketches, { title: "How to Write a Good Video Script" });
  assert.match(md, /^# How to Write a Good Video Script · B-roll list\n/);
  assert.match(md, /\n\| # \| Kind \| What to show \| Over \(A-roll line\) \| How to make it \| Check \|\n/);
  assert.match(md, /\n\| B6 \| B-roll \| [^\n]*\| Check \|\n/);
  assert.match(md, /\n\| S1 \| Screen recording \| /);
  assert.match(md, /\n## Sketches\n\n```svg B1\n<svg viewBox="0 0 260 140">\n/);
  const back = parseBroll(md);
  assert.deepEqual(shape(back.shots), shape(ordered));
  assert.deepEqual(back.shots.map((s) => s.id), ["B1", "B2", "B3", "B4", "B5", "S1", "B7", "S2", "B6", "B8"]);
  assert.deepEqual(back.sketches, sketches);
  // Linked again, every shot still finds its lines.
  matchShots(doc, back.shots);
  assert.deepEqual(back.shots.map((s) => s.blockIds), ordered.map((s) => s.blockIds));
});

test("B-roll export keeps pipes, kinds the How text would not give, unmatched shots last, and no empty Sketches", () => {
  const doc = parse(SHAPE_SCRIPT);
  const { shots } = parseBroll(SHAPE_LIST);
  matchShots(doc, shots);
  const ordered = scriptOrder(doc, shots);
  assert.equal(ordered.at(-1).id, "B6"); // "Not found in the script" goes last
  const md = exportBroll(ordered, {}, { title: "Screen | tips" });
  assert.doesNotMatch(md, /## Sketches/);
  assert.match(md, /a \\\| pipe/);
  const back = parseBroll(md);
  assert.deepEqual(shape(back.shots), shape(ordered));
  // A Kind column wins over a "screen" heading and the How text.
  const kinds = parseBroll("# Screen things\n\n| # | Kind | What to show | Over (A-roll line) | How to make it |\n| --- | --- | --- | --- | --- |\n| M1 | B-roll | x | \"y\" | Motion plate |\n| M2 | Motion plate | x | \"y\" | Slide |\n");
  assert.deepEqual(kinds.shots.map((s) => s.kind), ["broll", "motion"]);
});

test("storyboard export: one self-contained page, every shot in order, sketches sanitised, no scripts", () => {
  const doc = parse(SHAPE_SCRIPT);
  const { shots } = parseBroll(SHAPE_LIST);
  matchShots(doc, shots);
  const ordered = scriptOrder(doc, shots);
  const evil = '<svg viewBox="0 0 260 140" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect class="s" x="1" y="1" width="9" height="9"/></a>'
    + '<path class="o" d="M0 0L9 9" style="stroke:red" onclick="x()"/><foreignObject><img src=x onerror=alert(4)></foreignObject></svg>';
  const sketches = { B1: evil, B4: '<svg viewBox="0 0 260 140"><path class="mv" d="M10 10L90 90"/><text x="5" y="20">Step &lt;1&gt;</text></svg>' };
  const html = exportStoryboard(ordered, sketches, { title: 'Made-up <video> & "more"' });
  assert.match(html, /^<!doctype html>\n<html lang="en">/);
  assert.match(html, /<title>Made-up &lt;video&gt; &amp; &quot;more&quot; · Storyboard<\/title>/);
  assert.match(html, /@page \{ size: A4;/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script|<link|<img|<a |<iframe|<foreignObject|\son\w+=|href=|javascript:|style="|src=/i);
  assert.match(html, /<path class="o" d="M0 0L9 9"\/>/); // the drawable part of the bad sketch is kept
  assert.match(html, /<text x="5" y="20">Step &lt;1&gt;<\/text>/);
  // Every shot, in script order, with its id, kind, what and Over; the unmatched one last under its heading.
  const ids = [...html.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(ids, ordered.map((s) => s.id));
  const esc = (t) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  for (const s of ordered) {
    assert.ok(html.includes(esc(s.what)), s.id);
    assert.ok(html.includes(`Over: ${esc(s.over)}`), s.id);
  }
  assert.match(html, /<h2>Not found in the script<\/h2>\n<ol><li class="missing">[^\n]*<b>B6<\/b>/);
  assert.match(html, /<span class="kind screen">Screen recording<\/span>/);
  assert.equal((html.match(/class="img empty"/g) || []).length, ordered.length - 2);
});

test("B-roll export: extra sketches go last and survive a re-parse; an id with a space is left out", () => {
  const doc = parse(SCRIPT);
  const { shots, sketches } = parseBroll(DEMO);
  matchShots(doc, shots);
  const svg = '<svg viewBox="0 0 260 140"><circle class="o" cx="130" cy="70" r="20"/></svg>';
  const md = exportBroll(scriptOrder(doc, shots), { ...sketches, Z9: svg, "bad id": svg });
  const fences = [...md.matchAll(/^```svg (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(fences, ["B1", "B2", "B3", "B4", "B5", "S1", "B7", "S2", "B6", "B8", "Z9"]);
  assert.doesNotMatch(md, /bad id/);
  const back = parseBroll(md);
  assert.equal(back.sketches.Z9, svg);
  assert.deepEqual(Object.keys(back.sketches).sort(), [...Object.keys(sketches), "Z9"].sort());
});

test("an empty or unknown Kind cell falls back to the heading and the How text", () => {
  const md = "## Screen recordings\n\n| # | Kind | What to record | Over (A-roll line) | How to make it |\n| --- | --- | --- | --- | --- |\n"
    + "| S1 |  | x | \"y\" | Capture |\n| S2 | Photo | x | \"y\" | Capture |\n| S3 | Motion plate | x | \"y\" | Capture |\n\n"
    + "## Main\n\n| # | Kind | What to show | Over (A-roll line) | How to make it |\n| --- | --- | --- | --- | --- |\n"
    + "| B1 |  | x | \"y\" | Motion plate |\n| B2 | Photo | x | \"y\" | Motion graphic |\n| B3 | Photo | x | \"y\" | Stock clip |\n";
  assert.deepEqual(parseBroll(md).shots.map((s) => [s.id, s.kind]), [["S1", "screen"], ["S2", "screen"], ["S3", "motion"], ["B1", "motion"], ["B2", "motion"], ["B3", "broll"]]);
});

test("the storyboard header offers Unlink whenever a list is linked, also when it can't be read", () => {
  const link = { name: "list.md", handle: {} };
  const none = { link: false, file: false, note: false, allow: false, ask: false, saveAs: false };
  for (const status of ["ok", "loading", "error", "permission"]) assert.equal(boardHeadState(link, status).file, true, status);
  assert.deepEqual(boardHeadState(link, "error"), { ...none, file: true, note: true });
  assert.deepEqual(boardHeadState(link, "permission"), { ...none, file: true, allow: true });
  assert.deepEqual(boardHeadState(link, "ok"), { ...none, file: true, ask: true });
  assert.deepEqual(boardHeadState(link, "loading"), { ...none, file: true });
  for (const [l, st] of [[null, "none"], [null, "ok"], [link, "none"]]) assert.deepEqual(boardHeadState(l, st), { ...none, link: true });
  // A list kept in the browser (the demo, or no file handle): "Not saved to a file · Save as…".
  assert.deepEqual(boardHeadState({ demo: true, name: "demo.md" }, "ok"), { ...none, file: true, ask: true, saveAs: true });
  assert.equal(boardHeadState({ name: "x.md", draft: true }, "loading").saveAs, false);
});

/* ---------- Step C3: shots added, changed and removed in the editor ---------- */
const rowRe = (id) => new RegExp(`^\\| ${id} \\|.*\\n`, "m");

test("addShot: one new row in the main table or Screen recordings; the rest of the file is unchanged byte for byte", () => {
  const b9 = addShot(DEMO, { id: "B9", kind: "broll", what: "A | pipe", over: '"So, three things."', how: "" });
  assert.match(b9, /\n\| B8 \|[^\n]*\n\| B9 \| A \\\| pipe \| "So, three things\." \|  \|\n/);
  assert.equal(b9.replace(rowRe("B9"), ""), DEMO);
  assert.deepEqual(parseBroll(b9).shots.find((s) => s.id === "B9"), { id: "B9", what: "A | pipe", over: '"So, three things."', how: "", kind: "broll" });
  const s3 = addShot(DEMO, { id: "S3", kind: "screen", what: "Typing", over: '"So, three things."', how: "ignored" });
  assert.match(s3, /\n\| S2 \|[^\n]*\n\| S3 \| Typing \| "So, three things\." \|\n/);
  assert.equal(s3.replace(rowRe("S3"), ""), DEMO);
  assert.equal(parseBroll(s3).shots.at(-1).kind, "screen");
  // Motion plate without How: written so it reads back as motion.
  const m = addShot(DEMO, { id: "B9", kind: "motion", what: "Map", over: '"x"', how: "" });
  assert.equal(parseBroll(m).shots.find((s) => s.id === "B9").kind, "motion");
  assert.match(m, /\| B9 \| Map \| "x" \| Motion plate \|/);
  // CRLF files stay CRLF.
  const crlf = DEMO.replace(/\n/g, "\r\n");
  assert.equal(addShot(crlf, { id: "B9", kind: "broll", what: "x", over: '"y"' }).replace(/^\| B9 \|.*\r\n/m, ""), crlf);
});

test("addShot: creates Screen recordings before Sketches, or a main table, when missing", () => {
  const list = "# List\n\nNotes stay.\n\n| # | What to show | Over (A-roll line) | How to make it |\n| --- | --- | --- | --- |\n| B1 | x | \"y\" | Slide |\n\n## Sketches\n\n```svg B1\n<svg viewBox=\"0 0 260 140\">\n<path class=\"s\" d=\"M0 0L9 9\"/>\n</svg>\n```\n";
  const out = addShot(list, { id: "S1", kind: "screen", what: "Rec", over: '"z"' });
  assert.equal(out, list.replace("\n## Sketches", "\n## Screen recordings\n\n| # | What to record | Over (A-roll line) |\n| --- | --- | --- |\n| S1 | Rec | \"z\" |\n\n## Sketches"));
  assert.deepEqual(parseBroll(out).shots.map((s) => [s.id, s.kind]), [["B1", "broll"], ["S1", "screen"]]);
  assert.deepEqual(Object.keys(parseBroll(out).sketches), ["B1"]);
  const bare = "# Only notes\n\nNothing here yet.\n";
  const made = addShot(bare, { id: "B1", kind: "broll", what: "x", over: '"y"', how: "Stock" });
  assert.equal(made, "# Only notes\n\nNothing here yet.\n\n| # | What to show | Over (A-roll line) | How to make it |\n| --- | --- | --- | --- |\n| B1 | x | \"y\" | Stock |\n");
  // A new list has both tables; shots go into the right one.
  const fresh = addShot(addShot(newList("My | video"), { id: "B1", kind: "broll", what: "a", over: '"b"' }), { id: "S1", kind: "screen", what: "c", over: '"d"' });
  assert.match(fresh, /^# My \\\| video · B-roll list\n/);
  assert.deepEqual(parseBroll(fresh).shots.map((s) => [s.id, s.kind]), [["B1", "broll"], ["S1", "screen"]]);
  // A list with a Kind column (an export) keeps every kind in its one table.
  const exported = exportBroll(parseBroll(DEMO).shots, {});
  const withS = addShot(exported, { id: "S3", kind: "screen", what: "x", over: '"y"' });
  assert.doesNotMatch(withS, /## Screen recordings/);
  assert.match(withS, /\| S3 \| Screen recording \| x \| "y" \|  \|  \|\n$/);
});

test("updateShot changes the row in place; removeShot takes the row and its sketch; other lines stay the same", () => {
  const up = updateShot(DEMO, "B2", { what: "A new | description", how: "Screen capture" });
  assert.equal(up.split("\n").filter((l, i) => l !== DEMO.split("\n")[i]).length, 1);
  assert.match(up, /\n\| B2 \| A new \\\| description \| "Most of us write a video like a blog post\." \| Screen capture \|\n/);
  assert.equal(parseBroll(up).shots[1].what, "A new | description");
  assert.equal(updateShot(DEMO, "B2", { what: parseBroll(DEMO).shots[1].what }), DEMO); // nothing changed, nothing written
  assert.equal(updateShot(DEMO, "Z1", { what: "x" }), DEMO);
  // Kind changes: motion → B-roll drops the written default; B-roll → screen moves the row to Screen recordings.
  const m = addShot(DEMO, { id: "B9", kind: "motion", what: "Map", over: '"x"' });
  assert.equal(parseBroll(updateShot(m, "B9", { kind: "broll" })).shots.find((s) => s.id === "B9").kind, "broll");
  const moved = updateShot(DEMO, "B1", { kind: "screen" });
  assert.deepEqual(parseBroll(moved).shots.map((s) => s.id), ["B2", "B3", "B4", "B5", "B6", "B7", "B8", "S1", "S2", "B1"]);
  assert.equal(parseBroll(moved).shots.at(-1).kind, "screen");
  // With a Kind column the kind changes in place.
  const exported = exportBroll(parseBroll(DEMO).shots, {});
  assert.match(updateShot(exported, "B1", { kind: "motion" }), /\n\| B1 \| Motion plate \| /);
  // Remove: the row and the sketch block (with the blank line before it) go; everything else is byte for byte the same.
  const fence = /\n\n```svg B4\n[\s\S]*?\n```/;
  const gone = removeShot(DEMO, "B4");
  assert.equal(gone, DEMO.replace(rowRe("B4"), "").replace(fence, ""));
  assert.ok(!("B4" in parseBroll(gone).sketches));
  assert.equal(parseBroll(gone).shots.length, 9);
  assert.equal(removeShot(DEMO.replace(/\n/g, "\r\n"), "B4"), gone.replace(/\n/g, "\r\n"));
});

test("next free id: B<n> for B-roll and motion, S<n> for screen, after the highest in use", () => {
  const { shots, sketches } = parseBroll(DEMO);
  assert.equal(nextShotId(shots, "broll"), "B9");
  assert.equal(nextShotId(shots, "motion"), "B9");
  assert.equal(nextShotId(shots, "screen"), "S3");
  assert.equal(nextShotId([], "broll"), "B1");
  assert.equal(nextShotId(shots.filter((s) => s.id !== "B8"), "broll", { ...sketches, B12: "<svg/>" }), "B13");
});

test("Over from a selection matches back to the same blocks: one block, several blocks, a quote found earlier first", () => {
  const doc = parse(SCRIPT);
  const list = spokenBlocks(doc);
  const at = (i) => ({ id: list[i].id, text: contentOf(blockById(doc, list[i].id)) });
  // One block, a long selection from its start: the first 8 words and "…".
  const b = at(0);
  const one = overFor(doc, [{ id: b.id, start: 0, end: b.text.length }]);
  assert.equal(one, `"${b.text.split(/\s+/).slice(0, 8).join(" ")}…"`);
  assert.deepEqual(matchOver(list, one), [b.id]);
  // A short selection inside a line: just those words, no "…".
  const mid = b.text.indexOf("deadline");
  assert.equal(overFor(doc, [{ id: b.id, start: mid, end: mid + "deadline".length }]), '"deadline."');
  // Several blocks: a range from the first words to the last block's first words.
  const c = at(1), d = at(3);
  const range = overFor(doc, [{ id: c.id, start: 0, end: c.text.length }, { id: at(2).id, start: 0, end: 5 }, { id: d.id, start: 0, end: 3 }]);
  assert.match(range, /^"[^"]+…" through "[^"]+"$/);
  assert.deepEqual(matchOver(list, range), [c.id, at(2).id, d.id]);
  // A quote that would first match an earlier line takes more words.
  const tricky = parse("# T\n\n## 1 · A (0:00–0:10)\n\nWe fixed the roof and then we fixed the roof again.\n\nLater that day we fixed the roof again with new tiles.\n\nStep two is hard and we did it in the end.\n\nThen a break.\n\nStep two is hard and we did it anyway, said the team.\n");
  const tl = spokenBlocks(tricky);
  const second = contentOf(blockById(tricky, tl[1].id));
  const s0 = second.indexOf("we fixed");
  const q = overFor(tricky, [{ id: tl[1].id, start: s0, end: s0 + "we fixed the roof again".length }]);
  assert.equal(q, '"we fixed the roof again with…"');
  assert.deepEqual(matchOver(tl, q), [tl[1].id]);
  const r = overFor(tricky, [{ id: tl[2].id, start: 0, end: 10 }, { id: tl[3].id, start: 0, end: 4 }, { id: tl[4].id, start: 0, end: 4 }]);
  assert.match(r, / through "Step two is hard and we did it anyway,…"$/);
  assert.deepEqual(matchOver(tl, r), [tl[2].id, tl[3].id, tl[4].id]);
});

/* ---------- Step C3 review: kinds, ids and untouched cells survive ---------- */
const kindOfId = (md, id) => parseBroll(md).shots.find((s) => s.id === id)?.kind;

test("the chosen kind survives a How: Motion plate: <how>, and a Kind column for a B-roll whose How says motion", () => {
  const m = addShot(DEMO, { id: "B9", kind: "motion", what: "Map", over: '"x"', how: "After Effects" });
  assert.equal(kindOfId(m, "B9"), "motion");
  assert.match(m, /\| B9 \| Map \| "x" \| Motion plate: After Effects \|/);
  assert.equal(m.replace(rowRe("B9"), ""), DEMO);
  // B1 is a B-roll with a How ("Stock clip or a staged desk shot"): switched to motion it reads back as motion, and back.
  const up = updateShot(DEMO, "B1", { kind: "motion" });
  assert.equal(kindOfId(up, "B1"), "motion");
  assert.match(up, /\| B1 \|[^\n]*\| Motion plate: Stock clip or a staged desk shot \|/);
  const back = updateShot(up, "B1", { kind: "broll" });
  assert.equal(kindOfId(back, "B1"), "broll");
  assert.equal(back, DEMO);
  // A B-roll whose How says "slow motion": the main table gets a Kind column; every row keeps its kind.
  const before = parseBroll(DEMO).shots.map((s) => [s.id, s.kind]);
  const slow = addShot(DEMO, { id: "B9", kind: "broll", what: "Rain", over: '"x"', how: "slow motion stock" });
  assert.equal(kindOfId(slow, "B9"), "broll");
  assert.deepEqual(parseBroll(slow).shots.filter((s) => s.id !== "B9").map((s) => [s.id, s.kind]), before);
  assert.match(slow, /\n\| # \| Kind \| What to show \| Over \(A-roll line\) \| How to make it \|\n\| --- \| --- \| --- \| --- \| --- \|\n\| B1 \| B-roll \| Blank page/);
  assert.match(slow, /\| B3 \| Motion plate \| /);
  assert.equal(slow.slice(slow.indexOf("## Screen recordings")), DEMO.slice(DEMO.indexOf("## Screen recordings"))); // the rest stays
  const slowUp = updateShot(DEMO, "B6", { how: "Slow motion pan over the checklist" });
  assert.equal(kindOfId(slowUp, "B6"), "broll");
  assert.deepEqual(parseBroll(slowUp).shots.filter((s) => s.id !== "B6").map((s) => [s.id, s.kind]), before.filter(([id]) => id !== "B6"));
  // A title that says "Screen" does not turn the main table into screen recordings.
  assert.equal(kindOfId(addShot(newList("Screen tips"), { id: "B1", kind: "broll", what: "a", over: '"b"' }), "B1"), "broll");
});

test("an edit keeps untouched cells byte for byte, also in a CRLF file", () => {
  const list = "| # | What to show | Over (A-roll line) | How to make it |\n| --- | --- | --- | --- |\n| B1 |  old   | \"A \\| b\" and **bold**  | Slide  |\n";
  const out = updateShot(list, "B1", { what: "new" });
  assert.equal(out, "| # | What to show | Over (A-roll line) | How to make it |\n| --- | --- | --- | --- |\n| B1 | new | \"A \\| b\" and **bold**  | Slide  |\n");
  const crlf = DEMO.replace(/\n/g, "\r\n");
  const changed = updateShot(crlf, "B5", { what: "A spare key on a ring" });
  const a = crlf.split("\r\n"), b = changed.split("\r\n");
  assert.equal(a.length, b.length);
  assert.deepEqual(b.map((l, i) => (l === a[i] ? null : i)).filter((i) => i != null).length, 1);
  assert.match(changed, /\r\n\| B5 \| A spare key on a ring \| "A backup is a spare key\." \| Slide \|\r\n/);
});

test("a row is never written without an id: a table without an id column gets a standard table next to it", () => {
  const list = "| What to show | Over |\n| --- | --- |\n| a | \"b\" |\n";
  const out = addShot(list, { id: "B1", kind: "broll", what: "c", over: '"d"' });
  assert.ok(out.startsWith(list));
  assert.deepEqual(parseBroll(out).shots.map((s) => s.id), ["#1", "B1"]);
  const screen = addShot(out, { id: "S1", kind: "screen", what: "e", over: '"f"' });
  assert.deepEqual(parseBroll(screen).shots.map((s) => [s.id, s.kind]), [["#1", "broll"], ["B1", "broll"], ["S1", "screen"]]);
});

test("moving a shot to Screen recordings and back; a screen recording's How cell is kept on save", () => {
  const there = updateShot(DEMO, "B1", { kind: "screen" });
  const back = updateShot(there, "B1", { kind: "broll" });
  const shots = parseBroll(back).shots;
  assert.deepEqual(shots.map((s) => s.id), ["B2", "B3", "B4", "B5", "B6", "B7", "B8", "B1", "S1", "S2"]);
  assert.equal(shots.find((s) => s.id === "B1").kind, "broll");
  const screenRows = (md) => md.slice(md.indexOf("## Screen recordings"), md.indexOf("## Sketches"));
  assert.equal(screenRows(back), screenRows(DEMO));
  // An exported list (Kind column) where S1 has a How: saving the card (how undefined) leaves it.
  const demo = parseBroll(DEMO).shots.map((s) => (s.id === "S1" ? { ...s, how: "Phone timer, silent" } : s));
  const exported = exportBroll(demo, {});
  const saved = updateShot(exported, "S1", { what: "x", how: undefined, kind: "screen" });
  assert.match(saved, /\n\| S1 \| Screen recording \| x \| "AI helps you write faster\." \| Phone timer, silent \|  \|\n/);
  assert.equal(parseBroll(saved).shots.find((s) => s.id === "S1").how, "Phone timer, silent");
});

test("a motion plate keeps its kind in a table without a How column", () => {
  const t = "| # | What to show | Over |\n| --- | --- | --- |\n| B1 | a | \"b\" |\n";
  assert.equal(kindOfId(addShot(t, { id: "B2", kind: "motion", what: "m", over: '"x"' }), "B2"), "motion");
  assert.equal(kindOfId(updateShot(t, "B1", { kind: "motion" }), "B1"), "motion");
  const slow = addShot(t, { id: "B2", kind: "broll", what: "c", over: '"d"', how: "slow motion" });
  assert.ok(slow.includes('| B1 | a | "b" |'), "B1's line stays as it was");
  assert.equal(kindOfId(slow, "B2"), "broll");
});

test("a motion plate switched to a screen recording moves table and leaves the main table as it was", () => {
  const withMap = addShot(DEMO, { id: "B9", kind: "motion", what: "Map", over: '"x"', how: "After Effects" });
  const moved = updateShot(withMap, "B9", { kind: "screen" });
  assert.equal(kindOfId(moved, "B9"), "screen");
  const main = (md) => md.slice(0, md.indexOf("## Screen recordings"));
  assert.equal(main(moved), main(DEMO));
});

test("a # title ends a ## Screen recordings section for the tables after it", () => {
  const md = "## Screen recordings\n\n| # | What to record | Over |\n| --- | --- | --- |\n| S1 | a | \"b\" |\n\n# Part two\n\n| # | What to show | Over |\n| --- | --- | --- |\n| B1 | c | \"d\" |\n";
  assert.equal(kindOfId(md, "S1"), "screen");
  assert.equal(kindOfId(md, "B1"), "broll");
  const s2 = addShot(md, { id: "S2", kind: "screen", what: "e", over: '"f"' });
  assert.ok(s2.indexOf("| S2 |") < s2.indexOf("# Part two"), "S2 goes into the screen table");
});

test("a new Kind column is filled in for every row", () => {
  const t = "| # | What to show | Over |\n| --- | --- | --- |\n| B1 | a | \"b\" |\n";
  const added = addShot(t, { id: "B2", kind: "motion", what: "m", over: '"x"' });
  assert.ok(added.startsWith("| # | Kind | What to show | Over |"));
  assert.ok(added.includes('| B1 | B-roll | a | "b" |'));
  assert.equal(kindOfId(added, "B1"), "broll");
});

/* ---------- Step C4: the agent suggests B-roll ---------- */
const brollAsk = (over = {}) => ({ id: "a1", scope: "selection", action: "broll", status: "taken", ...over });

test("quoteSelection finds a quote across lines, word for word, and overFor turns it into a matching Over", () => {
  const doc = parse(SCRIPT);
  const list = spokenBlocks(doc);
  const t = (i) => contentOf(blockById(doc, list[i].id));
  // The end of one line and the start of the next, joined by a space or a line break.
  const tail = t(0).split(" ").slice(-3).join(" "), head = t(1).split(" ").slice(0, 4).join(" ");
  for (const quote of [`${tail} ${head}`, `${tail}\n\n${head}`, `  ${tail}\n${head} `]) {
    const sel = quoteSelection(doc, quote);
    assert.deepEqual(sel.map((s) => s.id), [list[0].id, list[1].id]);
    assert.equal(t(0).slice(sel[0].start, sel[0].end), tail);
    assert.equal(t(1).slice(sel[1].start, sel[1].end), head);
    assert.deepEqual(matchOver(list, overFor(doc, sel)), [list[0].id, list[1].id]);
  }
  const one = quoteSelection(doc, "A backup is a spare key.");
  assert.equal(one.length, 1);
  assert.deepEqual(matchOver(list, overFor(doc, one)), [one[0].id]);
  assert.deepEqual(quoteSelection(doc, "A backup is a spare lock."), []);
  assert.deepEqual(quoteSelection(doc, "Before recording"), []); // only spoken paras
  assert.deepEqual(quoteSelection(doc, "  "), []);
});

test("checkBrollAnswer: which asks, ids, quotes, screen with how, limits; adds get an Over", () => {
  const doc = parse(SCRIPT);
  const { shots } = parseBroll(DEMO);
  matchShots(doc, shots);
  const ctx = { doc, shots };
  const add = { op: "add", kind: "broll", what: "A spare key", how: "Macro shot", quote: "A backup is a spare key.", why: "Makes the idea visible" };
  const ok = checkBrollAnswer(brollAsk(), { changes: [add, { op: "update", id: "B2", what: "A long post scrolls by" }, { op: "remove", id: "B7" }], message: " Three ideas " }, ctx);
  assert.equal(ok.error, undefined);
  assert.equal(ok.answer.kind, "broll");
  assert.equal(ok.answer.message, "Three ideas");
  assert.deepEqual(ok.answer.changes.map((c) => [c.op, c.state]), [["add", "open"], ["update", "open"], ["remove", "open"]]);
  assert.deepEqual(matchOver(spokenBlocks(doc), ok.answer.changes[0].over), quoteSelection(doc, add.quote).map((s) => s.id));
  for (const a of [brollAsk(), brollAsk({ action: "ask" }), brollAsk({ scope: "broll", action: "plan", status: "waiting" })]) assert.ok(brollAskAllowed(a) && checkBrollAnswer(a, { changes: [add] }, ctx).answer);
  for (const [ask, args, re] of [
    [null, { changes: [add] }, /Unknown ask/],
    [brollAsk({ action: "simpler" }), { changes: [add] }, /answer_ask/],
    [brollAsk({ scope: "broll", action: "sketch" }), { changes: [add] }, /sketch_shot/],
    [brollAsk({ status: "kept" }), { changes: [add] }, /finished \(kept\)/],
    [brollAsk(), { changes: [] }, /1 to 20/],
    [brollAsk(), { changes: Array(21).fill(add) }, /At most 20/],
    [brollAsk(), { changes: [add], message: "x".repeat(201) }, /message is longer than 200/],
    [brollAsk(), { changes: [{ ...add, what: "x".repeat(201) }] }, /what is longer than 200/],
    [brollAsk(), { changes: [{ ...add, how: "x".repeat(121) }] }, /how is longer than 120/],
    [brollAsk(), { changes: [{ ...add, why: "x".repeat(161) }] }, /why is longer than 160/],
    [brollAsk(), { changes: [{ ...add, quote: "Not in the script at all." }] }, /not in the spoken text word for word/],
    [brollAsk(), { changes: [{ ...add, kind: "screen" }] }, /screen recording has no how/],
    [brollAsk(), { changes: [{ op: "update", id: "S1", how: "Phone" }] }, /screen recording has no how/],
    [brollAsk(), { changes: [{ op: "update", id: "B1", kind: "screen", how: "Phone" }] }, /screen recording has no how/],
    [brollAsk(), { changes: [{ op: "update", id: "B99", what: "x" }] }, /unknown shot id "B99". Shot ids: B1, B2/],
    [brollAsk(), { changes: [{ op: "remove", id: "Z1" }] }, /unknown shot id/],
    [brollAsk(), { changes: [{ op: "update", id: "B1" }] }, /needs what, how or kind/],
    [brollAsk(), { changes: [{ op: "add", kind: "broll", quote: add.quote }] }, /needs what/],
  ]) assert.match(checkBrollAnswer(ask, args, ctx).error, re);
  // No list yet: adds only.
  assert.match(checkBrollAnswer(brollAsk(), { changes: [{ op: "remove", id: "B1" }] }, { doc, shots: [] }).error, /Shot ids: none yet/);
  // answer_ask refuses a Suggest B-roll ask; sketch_shot refuses a plan ask.
  assert.match(checkAnswer(brollAsk({ quote: "x" }), { kind: "replace", text: "y" }, doc).error, /answer_broll/);
  assert.match(checkAnswer({ scope: "broll", action: "plan", status: "taken" }, { kind: "note", text: "y" }, doc).error, /answer_broll/);
  assert.match(checkSketch({ scope: "broll", action: "plan", status: "taken", shots: [{ id: "B4" }] }, { shotId: "B4", svg: '<svg viewBox="0 0 260 140"><path class="s" d="M0 0L9 9"/></svg>' }).error, /answer_broll/);
  // Step I: an add may bring its sketch, cleaned; updates and removals may not.
  const svg = '<svg viewBox="0 0 260 140"><path class="s" d="M0 0L9 9"/><script>x</script></svg>';
  const drawn = checkBrollAnswer(brollAsk(), { changes: [{ ...add, sketch: svg }] }, ctx).answer.changes[0];
  assert.equal(drawn.sketch, sanitizeSvg(svg));
  assert.doesNotMatch(drawn.sketch, /script/);
  assert.equal("sketch" in checkBrollAnswer(brollAsk(), { changes: [{ ...add, sketch: "  " }] }, ctx).answer.changes[0], false);
  for (const [args, re] of [
    [{ changes: [{ op: "update", id: "B2", what: "x", sketch: svg }] }, /sketch goes with an add.*sketch_shot/],
    [{ changes: [{ ...add, sketch: 7 }] }, /sketch must be text/],
    [{ changes: [{ ...add, sketch: "x".repeat(8193) }] }, /longer than 8192/],
    [{ changes: [{ ...add, sketch: "<p>hello</p>" }] }, /nothing drawable/],
  ]) assert.match(checkBrollAnswer(brollAsk(), args, ctx).error, re);
  // The agent's own suggestion (asked for in its chat) is a taken plan ask of its own.
  assert.ok(checkBrollAnswer(brollAsk({ scope: "broll", action: "plan", status: "taken", own: true }), { changes: [add] }, ctx).answer);
  assert.match(ACTIONS.broll.instruction, /1–3/);
  assert.match(ACTIONS.plan.instruction, /at most 20/);
});

test("Keep gives the same file as the C3 functions; Keep all is one write in order; Undo writes nothing", () => {
  const doc = parse(SCRIPT);
  const { shots } = parseBroll(DEMO);
  matchShots(doc, shots);
  const ctx = { doc, shots };
  const { answer } = checkBrollAnswer(brollAsk(), { changes: [
    { op: "add", kind: "motion", what: "Map", how: "After Effects", quote: "A backup is a spare key." },
    { op: "update", id: "B2", what: "A long post scrolls by", kind: "motion" },
    { op: "remove", id: "B7", why: "Repeats S1" },
    { op: "add", kind: "screen", what: "Typing", quote: "So, three things." },
  ] }, ctx);
  const [add, up, rm, screen] = answer.changes;
  assert.equal(applyBrollChange(DEMO, add), addShot(DEMO, { id: "B9", kind: "motion", what: "Map", how: "After Effects", over: add.over }));
  assert.equal(applyBrollChange(DEMO, up), updateShot(DEMO, "B2", { what: "A long post scrolls by", kind: "motion" }));
  assert.equal(applyBrollChange(DEMO, rm), removeShot(DEMO, "B7"));
  // Step I: a kept add keeps its sketch under its new id.
  const svg = '<svg viewBox="0 0 260 140"><path class="s" d="M0 0L9 9"/></svg>';
  const drawn = applyBrollChange(DEMO, { ...add, sketch: svg });
  assert.equal(drawn, setSketch(applyBrollChange(DEMO, add), "B9", svg));
  assert.equal(parseBroll(drawn).sketches.B9, svg);
  // A sketch from a changed draft is cleaned before it is written; one that cleans to nothing adds no fence.
  const dirty = '<svg viewBox="0 0 260 140"><script>x</script><path class="s" d="M0 0L9 9" onload="x()"/></svg>\n```';
  assert.equal(applyBrollChange(DEMO, { ...add, sketch: dirty }), drawn);
  assert.equal(applyBrollChange(DEMO, { ...add, sketch: "<p>```</p>" }), applyBrollChange(DEMO, add));
  // cleanSketches: where asks come in from a draft or the room.
  const ask = cleanSketches({ answer: { kind: "sketches", sketches: { B1: dirty, B2: "<p>x</p>" }, done: {} } });
  assert.deepEqual(ask.answer.sketches, { B1: svg });
  const sug = cleanSketches({ answer: { kind: "broll", changes: [{ op: "add", sketch: dirty }, { op: "add", sketch: "<b>x</b>" }, { op: "remove", id: "B1" }] } });
  assert.deepEqual(sug.answer.changes.map((c) => c.sketch ?? null), [svg, null, null]);
  assert.equal(cleanSketches(null), null);
  // Keep all: one write with every change in order; the adds get B9 and S3 at that moment.
  const all = applyBrollChanges(DEMO, changesToKeep(answer, [0, 1, 2, 3]));
  const step = [add, up, rm, screen].reduce((md, c) => applyBrollChange(md, c), DEMO);
  assert.equal(all, step);
  const back = parseBroll(all);
  assert.deepEqual(back.shots.map((s) => s.id), ["B1", "B2", "B3", "B4", "B5", "B6", "B8", "B9", "S1", "S2", "S3"]);
  assert.equal(back.shots.find((s) => s.id === "B9").kind, "motion");
  assert.equal(back.shots.find((s) => s.id === "B2").kind, "motion");
  assert.ok(!("B7" in back.sketches));
  // Undo: the change is done without a write; a later Keep of it writes nothing either.
  up.state = "undone";
  assert.deepEqual(changesToKeep(answer, [1]), []);
  assert.equal(applyBrollChanges(DEMO, changesToKeep(answer, [1])), DEMO);
  assert.equal(settleBroll(answer), null);
  for (const c of answer.changes) if (c.state === "open") c.state = "kept";
  assert.equal(settleBroll(answer), "kept");
  assert.equal(settleBroll({ changes: [{ state: "undone" }] }), "undone");
});

/* ---------- Step C4 review: gone shots, whole words, what the agent sees ---------- */
test("changes for a shot that is gone: one change per shot, not kept when it can't apply, and dropped as undone", () => {
  const doc = parse(SCRIPT);
  const { shots } = parseBroll(DEMO);
  matchShots(doc, shots);
  assert.match(checkBrollAnswer(brollAsk(), { changes: [{ op: "remove", id: "B7" }, { op: "update", id: "B7", what: "x" }] }, { doc, shots }).error, /Change 2: B7 already has a change in this answer/);
  // The shot was removed before Keep: the update applies to nothing, so it is reported as not applied.
  const without = removeShot(DEMO, "B7");
  const up = { op: "update", id: "B7", what: "x", state: "open" };
  const add = { op: "add", kind: "broll", what: "Key", over: '"A backup is a spare key."', how: "", state: "open" };
  const r = applyBrollChangesReport(without, [up, add, { op: "remove", id: "B1", state: "open" }]);
  assert.deepEqual(r.applied, [false, true, true]);
  assert.equal(r.markdown, removeShot(addShot(without, { id: "B9", kind: "broll", what: "Key", over: add.over, how: "" }), "B1"));
  assert.equal(applyBrollChangesReport(without, [up]).markdown, without);
  assert.equal(applyBrollChanges(without, [up]), without);
  // Gone shots: their open update or remove becomes undone, so the ask can settle; adds and kept ones stay.
  const answer = { kind: "broll", changes: [{ ...up }, { ...add }, { op: "remove", id: "B2", state: "kept" }, { op: "remove", id: "B3", state: "open" }] };
  assert.equal(dropGone(answer, parseBroll(without).shots, (i) => i === 3), 1);
  assert.deepEqual(answer.changes.map((c) => c.state), ["undone", "open", "kept", "open"]);
  answer.changes[1].state = "undone";
  answer.changes[3].state = "kept";
  assert.equal(settleBroll(answer), "kept");
});

test("a quote must start and end on whole words; regex characters in the text are plain text", () => {
  const doc = parse(SCRIPT);
  assert.deepEqual(quoteSelection(doc, "ackup is a spare key."), []);
  assert.deepEqual(quoteSelection(doc, "A backup is a spare ke"), []);
  assert.equal(quoteSelection(doc, "A backup is a spare key").length, 1); // stops before the full stop: fine
  const { shots } = parseBroll(DEMO);
  assert.match(checkBrollAnswer(brollAsk(), { changes: [{ op: "add", kind: "broll", what: "Key", quote: "are key." }] }, { doc, shots }).error, /not in the spoken text/);
  const money = parse("# T\n\n## 1 · A (0:00–0:10)\n\nIt costs $5 (or less). [Really?] Yes.*+ ^done|\n\nNext line.\n");
  const list = spokenBlocks(money);
  for (const quote of ["It costs $5 (or less).", "(or less). [Really?] Yes.*+ ^done|", "$5"]) {
    const sel = quoteSelection(money, quote);
    assert.equal(sel.length, 1, quote);
    assert.equal(contentOf(blockById(money, sel[0].id)).slice(sel[0].start, sel[0].end), quote);
    assert.deepEqual(matchOver(list, overFor(money, sel)), [list[0].id], quote);
  }
});

test("what the agent sees: a plan ask gets the spoken text and the B-roll; a sketch ask only its shots", () => {
  const { shots } = parseBroll(DEMO);
  const ctx = { spokenText: "Spoken words.", shots, voiceGuide: "Short and warm." };
  const plan = askForAgent({ id: "p", scope: "broll", action: "plan", instruction: "Plan", createdAt: "t" }, ctx);
  assert.deepEqual(Object.keys(plan), ["id", "scope", "action", "instruction", "createdAt", "spokenText", "broll"]);
  assert.equal(plan.spokenText, "Spoken words.");
  assert.deepEqual(plan.broll.map((s) => s.id), shots.map((s) => s.id));
  assert.deepEqual(Object.keys(plan.broll[0]), ["id", "what", "over", "how", "kind", "blockIds", "check"]);
  const sketch = askForAgent({ id: "s", scope: "broll", action: "sketch", instruction: "Draw", createdAt: "t", shots: [{ id: "B4" }] }, ctx);
  assert.deepEqual(Object.keys(sketch), ["id", "scope", "action", "instruction", "createdAt", "shots"]);
  const sel = askForAgent({ id: "a", scope: "selection", action: "broll", instruction: "Suggest", createdAt: "t", quote: "q", context: "c", section: "1" }, ctx);
  assert.deepEqual([sel.quote, sel.context, sel.section, sel.spokenText, sel.broll, sel.voiceGuide], ["q", "c", "1", undefined, undefined, undefined]);
  assert.equal(askForAgent({ id: "v", scope: "script", action: "voice" }, ctx).voiceGuide, "Short and warm.");
  assert.equal(askForAgent({ id: "l", scope: "selection", action: "like" }, { ...ctx, voiceGuide: "" }).voiceGuide, undefined);
});

test("pictures as sketches (step K): read, written, replacing line drawings, exported; bad data refused", () => {
  const pic = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
  const svg = '<svg viewBox="0 0 260 140"><path class="s" d="M0 0L9 9"/></svg>';
  assert.equal(isImage(pic), true);
  for (const bad of ["data:image/gif;base64,R0lGOD", "data:image/png;base64,ab cd", "data:text/html;base64,PGI+", `data:image/png;base64,${"A".repeat(IMAGE_MAX)}`, "javascript:x"]) {
    assert.equal(isImage(bad), false, bad.slice(0, 30));
  }
  assert.equal(cleanSketch(pic), pic);
  assert.equal(cleanSketch("data:image/svg+xml;base64,PHN2Zz4="), "");
  assert.equal(cleanSketch(svg), svg);
  // Written as one Markdown image line under ## Sketches, read back; it replaces a line drawing and the other way round.
  const withSvg = setSketch(DEMO, "B1", svg);
  const withPic = setSketch(withSvg, "B1", pic);
  assert.equal(parseBroll(withPic).sketches.B1, pic);
  assert.ok(withPic.includes(`![B1](${pic})`));
  assert.ok(!/```svg B1/.test(withPic));
  const back = setSketch(withPic, "B1", svg);
  assert.equal(back, withSvg);
  // A picture line with a bad address is not a sketch; removing the shot takes its picture along.
  assert.equal(parseBroll(`${DEMO}\n## Sketches\n\n![Z9](data:text/html;base64,PGI+)\n`).sketches.Z9, undefined);
  assert.ok(!removeShot(withPic, "B1").includes("![B1]"));
  // HTML: an img with its label; exports keep it.
  assert.equal(sketchHtml(pic, "Sketch B1"), `<img src="${pic}" alt="Sketch B1" decoding="async">`);
  assert.equal(sketchHtml("data:image/gif;base64,R0lGOD", "x"), "");
  const { shots } = parseBroll(withPic);
  assert.ok(exportBroll(shots, { B1: pic }).includes(`![B1](${pic})`));
  assert.equal(parseBroll(exportBroll(shots, { B1: pic })).sketches.B1, pic);
  assert.ok(exportStoryboard(shots, { B1: pic }).includes(`<img src="${pic}" alt="Sketch B1"`));
  // Answers: a sketch ask and an add may carry a picture.
  assert.equal(checkSketch({ scope: "broll", action: "sketch", status: "taken", shots: [{ id: "B1" }] }, { shotId: "B1", svg: pic }).svg, pic);
  assert.match(checkSketch({ scope: "broll", action: "sketch", status: "taken", shots: [{ id: "B1" }] }, { shotId: "B1", svg: "data:image/gif;base64,R0lGOD" }).error, /picture can't be used/);
  // Drafts and guests get asks without waiting pictures; large lists without picture lines.
  const sk = withoutPictures({ answer: { kind: "sketches", sketches: { B1: pic, B2: svg }, done: {} } });
  assert.deepEqual([sk.answer.sketches, sk.answer.done], [{ B2: svg }, {}]);
  const sug = withoutPictures({ answer: { kind: "broll", changes: [{ op: "add", sketch: pic }, { op: "add", sketch: svg }] } });
  assert.deepEqual(sug.answer.changes.map((c) => c.sketch ?? null), [null, svg]);
  const plain = { answer: { kind: "broll", changes: [{ op: "add" }] } };
  assert.equal(withoutPictures(plain), plain);
  assert.equal(withoutPictureLines(withPic), withPic.replace(`![B1](${pic})\n`, ""));
  const crlf = withPic.replace(/\n/g, "\r\n");
  assert.equal(withoutPictureLines(crlf), crlf.replace(`![B1](${pic})\r\n`, ""));
  // Both kinds for one id: one sketch is left, in the first one's place.
  const both = `${withSvg}\n![B1](${pic})\n`;
  const one = setSketch(both, "B1", pic);
  assert.equal((one.match(/B1\]\(|```svg B1/g) || []).length, 1);
  assert.equal(parseBroll(one).sketches.B1, pic);
  // A new shot with a picture: one image line under the new id; an svg fence of another shot stays.
  const doc = parse(SCRIPT);
  const { shots: listed } = parseBroll(DEMO);
  matchShots(doc, listed);
  const ctx = { doc, shots: listed };
  const add = { op: "add", kind: "broll", what: "A spare key", quote: "A backup is a spare key." };
  const big = `data:image/jpeg;base64,${"A".repeat(20_000)}`;
  const taken = checkBrollAnswer(brollAsk(), { changes: [{ ...add, sketch: big }] }, ctx);
  assert.equal(taken.answer.changes[0].sketch, big, "a picture may be longer than a line drawing");
  assert.match(checkBrollAnswer(brollAsk(), { changes: [{ ...add, sketch: `data:image/jpeg;base64,${"A".repeat(IMAGE_MAX)}` }] }, ctx).error, /longer than 400000/);
  const kept = applyBrollChange(DEMO, taken.answer.changes[0]);
  assert.equal((kept.match(/^!\[B9\]\(/gm) || []).length, 1);
  assert.equal(parseBroll(kept).sketches.B9, big);
  assert.equal(parseBroll(kept).sketches.B1, parseBroll(DEMO).sketches.B1);
});

test("waiting pictures (step K2): only unused ones hold a place; the refusal says how many are free and when one runs out", () => {
  const opts = { max: 24, uploadMs: 15 * 60_000, pictureMs: 30 * 60_000 };
  const now = Date.UTC(2026, 9, 29, 15, 0);
  assert.deepEqual(pictureRoom([], now, opts), { free: 24, waiting: 0, oldest: 0 });
  // A received picture runs out 30 minutes after it came, a file still to come 15 minutes after its address.
  const list = [{ at: now - 20 * 60_000, data: "data:image/jpeg;base64,AA==" }, { at: now - 10 * 60_000, data: "" }, { at: now - 29 * 60_000, data: "", busy: true }];
  assert.deepEqual(pictureRoom(list, now, opts), { free: 21, waiting: 3, oldest: now + 5 * 60_000 });
  const full = Array.from({ length: 24 }, (_, i) => ({ at: now - (24 - i) * 60_000, data: "data:image/jpeg;base64,AA==" }));
  const room = pictureRoom(full, now, opts);
  assert.equal(room.free, 0);
  const msg = noRoomMessage(room, 24, now);
  assert.match(msg, /^0 of 24 places for pictures are free: 24 pictures are sent but not used yet\./);
  assert.match(msg, /each use frees its place at once/);
  assert.match(msg, /runs out in 6 minutes \(2026-10-29T15:06:00\.000Z\)/);
  assert.doesNotMatch(msg, /At most 12/);
});

test("removeSketch (step K2): a shot's sketch of either kind goes, its row and other sketches stay", () => {
  const pic = "data:image/jpeg;base64,/9j/AA==";
  const svg = '<svg viewBox="0 0 260 140"><path class="s" d="M0 0L9 9"/></svg>';
  const withPic = setSketch(DEMO, "B2", pic);
  const gone = removeSketch(withPic, "B2");
  assert.equal(parseBroll(gone).sketches.B2, undefined);
  assert.deepEqual(parseBroll(gone).shots, parseBroll(withPic).shots);
  assert.equal(parseBroll(gone).sketches.B1, parseBroll(DEMO).sketches.B1);
  assert.equal(removeSketch(setSketch(DEMO, "B2", svg), "B2"), removeSketch(DEMO, "B2"));
  assert.equal(removeSketch(DEMO, "Z9"), DEMO);
  const crlf = withPic.replace(/\n/g, "\r\n");
  assert.equal(removeSketch(crlf, "B2"), gone.replace(/\n/g, "\r\n"));
});

test("sketch_shot's answers (step K2): each outcome says what happened, with the shots still asked for", () => {
  assert.match(sketchResult("shown"), /They choose Keep or Undo\.$/);
  assert.match(sketchResult("in"), /^Put into the B-roll list at once.*the person can undo it\.$/);
  assert.match(sketchResult("waits"), /could not be written just now.*Keep or Undo\.$/);
  assert.match(sketchResult("writing"), /being written.*list_asks shows when it is in/);
  for (const o of ["shown", "in", "waits", "writing"]) {
    assert.equal(sketchResult(o, ["B2", "B3"]), `${sketchResult(o)} They also asked for sketches of B2, B3.`);
    assert.equal(sketchResult(o, []), sketchResult(o));
  }
  assert.match(SKETCH_LIST_CHANGED, /changed meanwhile.*imageId still works/);
});

test("sketchAnswer (step K2): the write's outcome, or after the time limit the 'writing' answer with the outcome to come", async () => {
  assert.deepEqual(await sketchAnswer(Promise.resolve("in"), ["B2"], 50), { result: sketchResult("in", ["B2"]) });
  assert.deepEqual(await sketchAnswer(Promise.resolve("waits"), [], 50), { result: sketchResult("waits") });
  assert.deepEqual(await sketchAnswer(Promise.resolve("changed"), [], 50), { error: SKETCH_LIST_CHANGED });
  let done;
  const slow = new Promise((res) => { done = res; });
  const answer = await sketchAnswer(slow, ["B3"], 20);
  assert.equal(answer.result, sketchResult("writing", ["B3"]));
  assert.equal(answer.later, slow, "the outcome to come travels with the answer");
  done("changed");
  assert.equal(await answer.later, "changed");
});
