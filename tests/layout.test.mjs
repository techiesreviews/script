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
