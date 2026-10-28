import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, contentOf, blockById, setContent, cloneDoc, checkAnswer, ACTIONS } from "../public/doc.js";
import {
  parseBroll, parseOver, matchShots, matchOver, spokenBlocks, touchShots, scriptOrder, forAgent,
  sanitizeSvg, setSketch, checkSketch, normalize, SKETCH_MAX,
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
