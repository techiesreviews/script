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

// Step E: the shorter edit bar. Its controls, its two menus, and the phone rule that keeps every accessible name.
test("the edit bar: Shorter, Simpler, Sound like me, More ▾, B-roll ▾ (or a guest's Suggest B-roll) and Ask", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  const barHtml = html.slice(html.indexOf('<div class="edit-bar" id="editBar"'), html.indexOf('<div class="slash-menu"'));
  const order = ['data-act="shorter"', 'data-act="simpler"', 'data-act="like"', 'id="moreBtn"', 'id="brollBtn"', 'id="suggestBroll"', 'id="askForm"'].map((k) => barHtml.indexOf(k));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `order: ${order}`);
  assert.match(barHtml, /<button[^>]*id="suggestBroll"[^>]*hidden/);
  const menu = (id) => barHtml.slice(barHtml.indexOf(`id="${id}"`), barHtml.indexOf("</div>", barHtml.indexOf(`id="${id}"`)));
  assert.deepEqual([...menu("moreMenu").matchAll(/data-act="(\w+)"/g)].map((m) => m[1]), ["explain", "facts"]);
  assert.match(menu("brollMenu"), /id="addBroll"/);
  assert.match(menu("brollMenu"), /data-act="broll"/);
  for (const [btn, target] of [["moreBtn", "moreMenu"], ["brollBtn", "brollMenu"]]) {
    const tag = barHtml.match(new RegExp(`<button[^>]*id="${btn}"[^>]*>`))[0];
    for (const attr of [`popovertarget="${target}"`, 'aria-haspopup="menu"', "aria-expanded="]) assert.ok(tag.includes(attr), `${btn} ${attr}`);
  }
  assert.doesNotMatch(html + css, /edit-bar__sep/);
  const phone = css.slice(css.indexOf("@media (width < 40rem) {\n  .edit-bar {"), css.indexOf("\n}\n", css.indexOf("@media (width < 40rem) {\n  .edit-bar {")));
  assert.match(phone, /\.edit-bar__button--voice \.edit-bar__text, #suggestBroll \.edit-bar__text \{ position: absolute;[^}]*clip-path: inset\(50%\)/);
  assert.doesNotMatch(phone, /edit-bar__text \{[^}]*display: none/);
  assert.match(css, /\.edit-bar__ask input:focus \{ inline-size: min\(12rem, var\(--ask-max, 12rem\)\); \}/);
});
