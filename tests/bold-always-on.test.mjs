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

test("the colours live by B on the selection bar, not in the file name's menu", () => {
  const html = file("public/index.html");
  for (const gone of ["data-cue-set", 'id="boldOwn"', "Bold marking", "Camera action", "Bold words in the prompter file", "experimental", 'id="cueGroup"', "Bold style"]) assert.ok(!html.includes(gone), gone);
  const menu = html.slice(html.indexOf('id="scriptMenu"'), html.indexOf('id="viewSwitch"'));
  assert.ok(!menu.includes('type="color"'), "no colour fields in the menu");
  const bar = html.slice(html.indexOf('<div class="edit-bar" id="editBar"'), html.indexOf('<div class="slash-menu"'));
  const pop = bar.slice(bar.indexOf('id="boldPop"'), bar.indexOf('id="askForm"'));
  for (const kept of ['id="boldFg"', 'id="boldBg"', 'id="boldReset"', 'id="boldSample"', 'popover="manual"']) assert.ok(pop.includes(kept), kept);
  assert.match(bar, /id="boldBtn"[^>]*aria-controls="boldPop"/);
  assert.match(bar, /id="boldBtn"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(file("public/app.js"), /cues\(\)|data-cue-set|set_cue_settings|get_cue_settings|cueGroup/);
});

test("the ready-made colours are all #rrggbb, so each one is saved and shown", () => {
  for (const kind of ["color", "background"]) {
    assert.ok(Q.BOLD_SWATCHES[kind].length >= 4, kind);
    for (const s of Q.BOLD_SWATCHES[kind]) {
      assert.ok(s.name && s.light?.name, `${kind} ${s.hex} has a name for screen readers in both modes`);
      assert.deepEqual(Q.boldStyle({ [kind]: s.hex })[kind], s.hex, s.name);
      assert.match(s.light.hex, /^#[0-9a-f]{6}$/);
    }
  }
});

// WCAG contrast of two #rrggbb colours.
const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((n, x, i) => n + x * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PAGE = { dark: "#080721", light: "#fafafa" }, ORANGE = { dark: "#fb401e", light: "#b53707" };

test("a ready-made colour reads in both modes: each mode shows its own partner of it", () => {
  for (const mode of ["dark", "light"]) {
    for (const s of Q.BOLD_SWATCHES.color) {
      const shown = Q.boldShown({ color: s.hex, background: null }, mode).color;
      assert.ok(contrast(shown, PAGE[mode]) >= 3, `${mode}: ${s.name} text on the page: ${contrast(shown, PAGE[mode]).toFixed(2)}`);
    }
    for (const s of Q.BOLD_SWATCHES.background) {
      const shown = Q.boldShown({ color: null, background: s.hex }, mode).background;
      assert.ok(contrast(shown, ORANGE[mode]) >= 3, `${mode}: the default orange on ${s.name}: ${contrast(shown, ORANGE[mode]).toFixed(2)}`);
    }
  }
});

test("only the ready-made colours change with the mode; your own colours and nothing chosen stay as they are", () => {
  const yellow = Q.BOLD_SWATCHES.color.find((s) => s.name === "Yellow");
  assert.deepEqual(Q.boldShown({ color: yellow.hex, background: null }, "dark"), { color: yellow.hex, background: null });
  assert.deepEqual(Q.boldShown({ color: yellow.hex.toUpperCase(), background: null }, "light"), { color: yellow.light.hex, background: null });
  assert.deepEqual(Q.boldShown({ color: "#112233", background: "#ddeeff" }, "light"), { color: "#112233", background: "#ddeeff" });
  assert.deepEqual(Q.boldShown({ color: null, background: null }, "light"), { color: null, background: null });
});

test("a background saved by the first build of step U counts as its swatch now", () => {
  assert.equal(Q.boldShown({ color: null, background: "#3c3990" }, "light").background, "#dedcff");
  assert.equal(Q.boldShown({ color: null, background: "#3C3990" }, "dark").background, "#34317f");
  for (const s of Q.BOLD_SWATCHES.background) for (const old of s.was ?? []) {
    assert.equal(Q.boldSwatch("background", old), s, old);
    assert.ok(contrast(Q.boldShown({ color: null, background: old }, "light").background, ORANGE.light) >= 3, old);
  }
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
