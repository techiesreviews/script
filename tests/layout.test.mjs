import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Script/Storyboard switch is centred on the full top bar, so it must sit between the name and the actions, not inside them.
test("the view switch is its own column of the top bar", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const top = html.slice(html.indexOf('<header class="top">'), html.indexOf("</header>"));
  const doc = top.indexOf('id="docInfo"'), sw = top.indexOf('id="viewSwitch"'), end = top.indexOf('class="top__end"');
  assert.ok(doc >= 0 && sw > doc && end > sw, "order: name, switch, actions");
  assert.ok(!top.slice(end).includes('id="viewSwitch"'), "the switch is not inside the actions");
});

// The voice and agent labels are hidden visually on narrow screens but must keep their accessible name.
test("the voice and agent labels stay readable for screen readers", () => {
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  const block = (q) => { const at = css.indexOf(`@container app (${q}) {\n`); assert.ok(at >= 0, `no @container block for ${q}`); return css.slice(at, css.indexOf("\n}\n", at) + 3); };
  const at68 = block("width < 68rem");
  assert.match(at68, /\.voice-btn \.lbl, \.agent-btn \.lbl \{[^}]*clip-path: inset\(50%\)/);
  assert.doesNotMatch(at68, /\.lbl \{[^}]*display: none/);
  assert.match(block("width < 36rem"), /\.tb:not\(\.voice-btn, \.agent-btn\) \.lbl \{ display: none; \}/);
  assert.match(css, /\.agent-btn\[data-state="on"\] \.lbl \{ max-inline-size: 7rem;/);
  assert.doesNotMatch(css, /^\.agent-btn \.lbl \{ max-inline-size/m);
});
