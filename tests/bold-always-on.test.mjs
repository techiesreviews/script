// Bold is always on (Lex, 2026-11-06): no switch to turn it off and no bold settings but the colours; by default the
// words show orange and bold, like the prompter. This file never says "cues are read": they must be, from the start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Q from "../public/cues.js";
import * as D from "../public/doc.js";
import { TOOLS, INSTRUCTIONS, checkArgs } from "../worker/mcp.js";

const file = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("bold words are read from the start, with no switch", () => {
  assert.deepEqual(Q.textCues("a **big** word").map((c) => c.label), ["big"]);
  assert.equal(Q.stripCues("a **big** word"), "a big word");
  for (const gone of ["readCuesWhen", "cueSettings", "checkSettings", "settingsOutcome", "CUE_DEFAULTS"]) assert.equal(Q[gone], undefined, gone);
});

test("the prompter file holds plain words: it can't show ** yet", () => {
  const doc = D.parse("# T\n\n## A\n\nWe **start here**.\n");
  assert.match(D.exportPrompter(doc), /We start here\./);
  assert.doesNotMatch(D.exportPrompter(doc), /\*\*start/);
});

test("colours: by default none of the person's own; only #rrggbb gets through; an older choice stays", () => {
  assert.deepEqual(Q.boldStyle(null), { color: null, background: null });
  assert.deepEqual(Q.boldStyle({ color: "#112233" }), { color: "#112233", background: null });
  assert.deepEqual(Q.boldStyle({ color: "url(x)", background: "red;}" }), { color: null, background: null });
  assert.deepEqual(Q.boldStyle({ own: true, color: "#112233", background: "#445566" }), { color: "#112233", background: "#445566" });
  assert.deepEqual(Q.boldStyle({ own: false, color: "#112233", background: "#445566" }), { color: null, background: null });
});

test("the menu keeps only the colours", () => {
  const html = file("public/index.html");
  for (const gone of ["data-cue-set", 'id="boldOwn"', "Bold marking", "Camera action", "Bold words in the prompter file", "experimental"]) assert.ok(!html.includes(gone), gone);
  for (const kept of ['id="boldFg"', 'id="boldBg"', "Bold style"]) assert.ok(html.includes(kept), kept);
  assert.doesNotMatch(file("public/app.js"), /cues\(\)|data-cue-set|set_cue_settings|get_cue_settings/);
});

test("by default the words are orange and bold, in the prompter's orange in dark mode", () => {
  const css = file("public/app.css");
  assert.match(css, /--bold-ink: light-dark\(oklch\(52% 0\.17 37\), oklch\(65% 0\.227 32\.3\)\);/);
  const rule = css.match(/\.md-cue \.md-link__words \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /color: var\(--bold-fg, var\(--bold-ink\)\)/);
  assert.match(rule, /background: var\(--bold-bg, transparent\)/);
  assert.match(rule, /font-weight: 800/);
  assert.doesNotMatch(css, /data-bold-own/);
});

test("the agent has no bold settings and hears that bold is always on", () => {
  const names = TOOLS.map((t) => t.name);
  for (const gone of ["get_cue_settings", "set_cue_settings"]) assert.ok(!names.includes(gone), gone);
  for (const kept of ["list_cues", "mark_cue", "unmark_cue"]) assert.ok(names.includes(kept), kept);
  const said = INSTRUCTIONS + TOOLS.map((t) => t.description).join(" ");
  assert.doesNotMatch(said, /cue_settings|off by default|cue marking is on|settings in force/);
  assert.equal(checkArgs("list_cues", {}), "");
});
