#!/usr/bin/env node
// TOOLS-470: select across paragraphs with the mouse. Start a local Worker (wrangler dev) and a headless Chrome through
// kit bg, then run: node scripts/smoke-select-across.mjs http://127.0.0.1:<port> <Chrome debugging port>.
// Headless Chrome reports no mouse unless told: start it with
// --blink-settings=primaryPointerType=4,primaryHoverType=2,availablePointerTypes=4,availableHoverTypes=2
// so the hover styles apply (the mouse-over check refuses to run without them).
// Each case has a private browser context, disposed afterwards. It opens only the demo script and its own made-up
// B-roll list; it never connects an agent or opens a person's scripts.
// Checked with real input: a mouse drag from one paragraph into another (Input.dispatchMouseEvent with buttons: 1 while
// held), Ctrl+C, Delete, typing (Input.insertText) and Ctrl+Z, at 1280 px and 390 px.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { setMaxListeners } from "node:events";
const BASE = process.argv[2];
const PORT = process.argv[3];
assert.ok(BASE && ["127.0.0.1", "localhost"].includes(new URL(BASE).hostname), "Use a local copy only");
assert.ok(PORT, "Supply the local Chrome debugging port");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const cdp = new WebSocket(version.webSocketDebuggerUrl);
setMaxListeners(64, cdp);
await new Promise((resolve, reject) => { cdp.addEventListener("open", resolve); cdp.addEventListener("error", reject); });
let nextId = 0;
const waiting = new Map();
cdp.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (!m.id || !waiting.has(m.id)) return;
  const { resolve, reject } = waiting.get(m.id);
  waiting.delete(m.id);
  if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Chrome didn't answer ${method}`)); }, 20000);
  waiting.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  cdp.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

async function openPage(width, height) {
  const { browserContextId } = await send("Target.createBrowserContext");
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = {
    send: (method, params) => send(method, params, sessionId),
    async eval(expression) {
      const r = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async until(expression, label, ms = 15000) {
      const end = Date.now() + ms;
      for (;;) {
        if (await page.eval(expression).catch(() => false)) return true;
        if (Date.now() > end) throw new Error(`timed out: ${label}`);
        await sleep(60);
      }
    },
    async click(selector) {
      const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error(`nothing to press: ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...box, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
    },
    async key(key, code, keyCode, { modifiers = 0, commands } = {}) {
      for (const type of ["rawKeyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, modifiers, ...(type === "rawKeyDown" && commands ? { commands } : {}) });
    },
    close: () => send("Target.disposeBrowserContext", { browserContextId }),
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  page.log = [];
  cdp.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") page.log.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    if (m.method === "Runtime.exceptionThrown") page.log.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  return page;
}

// The screen point just inside the first letter of `word` in the block whose text holds `needle` (decorations such as
// shot frames are left out). The block is scrolled into view first when `scroll` is set.
const pointJs = (needle, word, scroll = false) => `(() => {
  const el = [...document.querySelectorAll("#script .block")].find((e) => e.textContent.includes(${JSON.stringify(needle)}));
  if (!el) return null;
  ${scroll ? `el.scrollIntoView({ block: "start" }); scrollBy(0, -90);` : ""}
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement.closest("[data-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const i = n.data.indexOf(${JSON.stringify(word)});
    if (i < 0) continue;
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
    const box = r.getClientRects()[0];
    return { x: box.left + 1, y: box.top + box.height / 2 };
  }
  return null;
})()`;

async function drag(page, from, to) {
  const a = await page.eval(pointJs(from[0], from[1], true));
  const b = await page.eval(pointJs(to[0], to[1]));
  assert.ok(a && b, `points to drag between: ${from} → ${to}`);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...a, buttons: 0 });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...a, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) {
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + (b.x - a.x) * i / 10, y: a.y + (b.y - a.y) * i / 10, button: "left", buttons: 1 });
    await sleep(25);
  }
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...b, button: "left", buttons: 0, clickCount: 1 });
  await sleep(80);
}

const md = (page) => page.eval(`window.__scriptEditor.markdown()`);
const shot = (page, id) => page.eval(`window.__scriptEditor.broll().find((s) => s.id === ${JSON.stringify(id)})`);
const undo = (page) => page.key("z", "KeyZ", 90, { modifiers: 2 });
const spanState = (page) => page.eval(`(() => {
  const h = globalThis.CSS?.highlights?.get("span-selection");
  return { on: document.querySelector("#script").hasAttribute("data-span"), ranges: h ? h.size : 0, text: h ? [...h].map((r) => r.toString()).join(" | ") : "", bar: !document.querySelector("#editBar").hidden };
})()`);

const P1 = "A blank page. A deadline.", P2 = "Most of us write a video", P3 = "Hi, I'm Sam";
const COPIED = "Why does it sound so stiff on camera?\n\nMost of us write a video like a blog post. Long sentences. Big words. Then we wonder why nobody stays past the first minute.\n\nHi, I'm Sam, and on this demo channel we make video a little less scary. ";

const results = [];
try {
for (const width of [1280, 390]) {
  const page = await openPage(width, 1000);
  try {
    await page.send("Page.navigate", { url: BASE });
    await page.until(`!!window.__scriptEditor && !!document.querySelector("#emptySample")`, "the start screen");
    await page.click("#emptySample");
    await page.until(`document.querySelectorAll(".shot-frame").length >= 6`, "the demo's shots");
    await page.eval(`window.__copied = null; window.addEventListener("copy", (e) => { window.__copied = e.clipboardData.getData("text/plain"); })`);
    const original = await md(page), b2 = await shot(page, "B2");

    // 1. Drag-select from the first paragraph into the third: the span is drawn across all three, no edit bar.
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    const s = await spanState(page);
    assert.ok(s.on && s.ranges === 3, `a span over three paragraphs is drawn: ${JSON.stringify(s)}`);
    assert.equal(s.bar, false, "no edit bar for a span");
    results.push(`${width}px drag-select: met — three paragraphs highlighted ("${s.text.slice(0, 40)}…")`);

    // 2. Copy: the words only, a blank line between paragraphs, no shot labels.
    await page.key("c", "KeyC", 67, { modifiers: 2, commands: ["copy"] });
    await page.until(`window.__copied !== null`, "copy event");
    assert.equal(await page.eval(`window.__copied`), COPIED, "copy gives the words with blank lines between");
    results.push(`${width}px copy: met — ${JSON.stringify(COPIED.slice(0, 50))}… with blank lines, no shot labels`);

    // 2b. A press on the page's scrollbar, with the left or the middle button, keeps the span: Ctrl+C still copies it
    // (TOOLS-482). A middle press in the text still ends it (step 11: on Linux it pastes there).
    const bar = await page.eval(`({ x: innerWidth - 4, y: innerHeight / 2, gutter: innerWidth - document.documentElement.clientWidth })`);
    assert.ok(bar.gutter > 4, `the page shows a scrollbar to press: ${JSON.stringify(bar)}`);
    for (const [button, buttons] of [["left", 1], ["middle", 4]]) {
      for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: bar.x, y: bar.y, button, buttons: type === "mousePressed" ? buttons : 0, clickCount: 1 });
      await sleep(80);
      const after = await spanState(page);
      assert.ok(after.on && after.ranges === 3, `a ${button} press on the scrollbar keeps the span: ${JSON.stringify(after)}`);
    }
    // Dragging the scrollbar's thumb scrolls the page and keeps the span too.
    const thumb = await page.eval(`({ x: innerWidth - 4, y: (scrollY + innerHeight / 2) / document.documentElement.scrollHeight * innerHeight, at: scrollY })`);
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: thumb.x, y: thumb.y, button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 3; i++) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: thumb.x, y: thumb.y + 20 * i, button: "left", buttons: 1 });
      await sleep(25);
    }
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: thumb.x, y: thumb.y + 60, button: "left", buttons: 0, clickCount: 1 });
    await sleep(80);
    const dragged = await page.eval(`scrollY`), afterDrag = await spanState(page);
    assert.ok(dragged > thumb.at, `dragging the scrollbar scrolled the page: ${thumb.at} → ${dragged}`);
    assert.ok(afterDrag.on && afterDrag.ranges === 3, `dragging the scrollbar keeps the span: ${JSON.stringify(afterDrag)}`);
    assert.equal(await md(page), original, "a press on the scrollbar changes no words");
    await page.eval(`window.__copied = null`);
    await page.key("c", "KeyC", 67, { modifiers: 2, commands: ["copy"] });
    await page.until(`window.__copied !== null`, "copy event after the scrollbar press");
    assert.equal(await page.eval(`window.__copied`), COPIED, "Ctrl+C after the scrollbar press copies the span");
    results.push(`${width}px scrollbar press: met — a left and a middle press at innerWidth-4 (on the ${bar.gutter}px scrollbar) kept the span, and so did dragging it (the page scrolled ${thumb.at} → ${dragged}); Ctrl+C still copied it`);

    // 3. Delete: the ends join; B2 (on the middle paragraph) moves to the join and says so; the text is saved as one.
    await page.key("Delete", "Delete", 46);
    await page.until(`!window.__scriptEditor.markdown().includes(${JSON.stringify(P2)})`, "the middle paragraph went");
    const joined = await md(page);
    assert.match(joined, /until you say it out loud\. Today: how to write a script/, "the two ends joined into one paragraph");
    assert.ok(!(await spanState(page)).on, "the span is gone after the delete");
    await page.until(`(() => { const s = window.__scriptEditor.broll().find((x) => x.id === "B2"); return s && s.over !== ${JSON.stringify(b2.over)}; })()`, "B2's Over follows it");
    const moved = await shot(page, "B2");
    const note = await page.eval(`(() => { const f = [...document.querySelectorAll(".shot-frame[data-moved]")]; return f.map((x) => x.querySelector(".moved-note")?.textContent).join(); })()`);
    assert.equal(note, "Moved here", "the moved shot says so");
    const where = await page.eval(`(() => { const f = document.querySelector(".shot-frame[data-moved]"); return f?.closest(".line")?.querySelector(".block")?.textContent.includes("A blank page"); })()`); // a frame sits beside its block, in the line
    assert.ok(where, "the moved shot shows on the joined paragraph");
    results.push(`${width}px delete: met — ends joined, B2 moved to the joined paragraph ("Moved here"), Over ${JSON.stringify(b2.over)} → ${JSON.stringify(moved.over)}`);

    // 4. Undo puts it all back: the words, B2's Over, the span drawn again.
    await undo(page);
    await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "Undo puts the words back");
    await page.until(`window.__scriptEditor.broll().find((x) => x.id === "B2").over === ${JSON.stringify(b2.over)}`, "Undo puts B2's Over back");
    assert.equal(await page.eval(`document.querySelectorAll(".shot-frame[data-moved]").length`), 0, "no Moved here after Undo");
    assert.ok((await spanState(page)).on, "Undo selects the span again");
    results.push(`${width}px undo: met — words and B2's Over back as they were, the span selected again`);

    // 5. Type over the span (selected again by Undo).
    await page.send("Input.insertText", { text: "Short. " });
    await page.until(`window.__scriptEditor.markdown().includes("out loud. Short. Today:")`, "typing replaces the span");
    await page.send("Input.insertText", { text: "More" });
    await page.until(`window.__scriptEditor.markdown().includes("out loud. Short. MoreToday:")`, "typing goes on at the caret");
    await undo(page);
    await undo(page);
    await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "Undo takes the typing back");
    results.push(`${width}px type-over: met — "Short. " replaced three paragraphs, the caret went on at the join, Undo took it back`);

    // 6. A section title selected with the text around it goes with it.
    await page.key("Escape", "Escape", 27);
    await drag(page, [P3, "how to know"], ["Your viewer doesn't care", "They care"]);
    assert.ok((await spanState(page)).on, "a span across a section title");
    await page.key("Backspace", "Backspace", 8);
    await page.until(`!window.__scriptEditor.markdown().includes("## 2 · Start with the problem")`, "the section title went");
    assert.match(await md(page), /how to write a script that sounds like you, and They care about their problem\./);
    await undo(page);
    await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "Undo puts the section title back");
    results.push(`${width}px section title: met — selected and deleted with the text around it; Undo put it back`);

    // 7. From the title: the notes folded away under it are never part of the span (copy leaves them out).
    await page.key("Escape", "Escape", 27);
    await page.eval(`window.__copied = null`);
    await drag(page, ["DEMO ·", "How"], [P1, "Why"]);
    assert.ok((await spanState(page)).on, "a span from the title");
    await page.key("c", "KeyC", 67, { modifiers: 2, commands: ["copy"] });
    await page.until(`window.__copied !== null`, "copy event");
    const fromTitle = await page.eval(`window.__copied`);
    assert.ok(!/Channel|How to read this/.test(fromTitle), `the folded notes are not copied: ${JSON.stringify(fromTitle.slice(0, 80))}`);
    assert.match(fromTitle, /^1 · Hook[^]*until you say it out loud\. $/, "the copy starts at the first section and ends where the drag did (before \"Why\")");
    results.push(`${width}px from the title: met — folded notes left out, copy ${JSON.stringify(fromTitle.slice(0, 40))}…`);

    // 8. A paste with only a picture on the clipboard (a screenshot) leaves the span and the words as they were.
    await page.key("Escape", "Escape", 27);
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    await page.eval(`(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", { type: "image/png" }));
      (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    })()`);
    await sleep(200);
    assert.equal(await md(page), original, "an image-only paste changes no words");
    assert.ok((await spanState(page)).on, "the span is still selected after an image-only paste");
    results.push(`${width}px picture paste: met — words unchanged, the span still selected`);

    // 9. Composed text (an accent typed with a dead key or an input method) over the span: one Undo takes it all back.
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Process", code: "KeyE", windowsVirtualKeyCode: 229 });
    await page.send("Input.imeSetComposition", { text: "é", selectionStart: 1, selectionEnd: 1 });
    await page.send("Input.insertText", { text: "é" });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "e", code: "KeyE", windowsVirtualKeyCode: 69 });
    await page.until(`window.__scriptEditor.markdown().includes("out loud. éToday:")`, "composed text replaces the span");
    // Text that comes after the composition ended, with no key pressed (an input method's next word): a step of its own.
    await page.send("Input.insertText", { text: "z" });
    await page.until(`window.__scriptEditor.markdown().includes("out loud. ézToday:")`, "text after the composition");
    await undo(page);
    await page.until(`window.__scriptEditor.markdown().includes("out loud. éToday:")`, "one Undo takes back only the text after the composition");
    await undo(page);
    await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "one Undo takes back the composed text and the span's delete");
    assert.ok((await spanState(page)).on, "the span is selected again");
    results.push(`${width}px composed text: met — "é" replaced three paragraphs; one Undo put the words and the span back`);

    // 10. A drag that slips a little past its paragraph, into the gap before the next one, stays inside its paragraph.
    await page.key("Escape", "Escape", 27);
    {
      const a = await page.eval(pointJs(P1, "Why", true));
      const below = await page.eval(`(() => { const el = [...document.querySelectorAll("#script .block")].find((e) => e.textContent.includes(${JSON.stringify(P1)})); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 12 }; })()`);
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...a, buttons: 0 });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...a, button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 8; i++) { await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + (below.x - a.x) * i / 8, y: a.y + (below.y - a.y) * i / 8, button: "left", buttons: 1 }); await sleep(25); }
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...below, button: "left", buttons: 0, clickCount: 1 });
      await sleep(80);
    }
    assert.ok(!(await spanState(page)).on, "a drag into the gap below its paragraph is no span");
    assert.ok(await page.eval(`getSelection().toString().startsWith("Why does it sound")`), "the browser's own selection in the paragraph stays");
    results.push(`${width}px gap below: met — a drag 12 px past the paragraph stays the paragraph's own selection`);
    // A press inside the browser's own selection would drag that text away instead of starting a new selection.
    await page.eval(`getSelection().collapseToStart()`);

    // 11. Right and middle click: a spelling fix from the right-click menu ends the span and changes only its word;
    // a middle click (a paste of the primary selection on Linux) ends the span first.
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    assert.ok((await spanState(page)).on, "the drag before the right-click drew the span");
    const inSpan = await page.eval(pointJs(P2, "Long"));
    for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...inSpan, button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1 });
    assert.ok((await spanState(page)).on, "a right-click inside the span keeps it (the menu's Copy)");
    await page.eval(`document.activeElement.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertReplacementText", data: "Fixed", bubbles: true, cancelable: true }))`);
    await sleep(100);
    assert.equal(await md(page), original, "a spelling fix does not replace the span");
    assert.ok(!(await spanState(page)).on, "a spelling fix ends the span");
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...inSpan, button: "middle", buttons: type === "mousePressed" ? 4 : 0, clickCount: 1 });
    assert.ok(!(await spanState(page)).on, "a middle click ends the span");
    // On Linux the middle click then pastes the browser's own selection where it was pressed, as it does anywhere; the
    // span's words all stay.
    {
      // Only something put in: once the common start and end are set aside, nothing of the script is left over.
      const now = await md(page);
      let a = 0;
      while (a < original.length && now[a] === original[a]) a++;
      let z = 0;
      while (z < original.length - a && now[now.length - 1 - z] === original[original.length - 1 - z]) z++;
      assert.equal(original.length - a - z, 0, `a middle click never takes the span's words: ${JSON.stringify(now.slice(a - 40, now.length - z + 40))}`);
    }
    if ((await md(page)) !== original) await undo(page);
    await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "Undo takes back the middle click's paste");
    results.push(`${width}px right and middle click: met — a spelling fix and a middle click never replace the span`);

    // 12. A composition cancelled with nothing typed: the span's delete is its own step, later typing another.
    await page.key("Escape", "Escape", 27);
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Dead", code: "Quote", windowsVirtualKeyCode: 222 });
    await page.until(`window.__scriptEditor.markdown().includes("out loud. Today:")`, "the dead key deleted the span");
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Dead", code: "Quote", windowsVirtualKeyCode: 222 });
    await page.key("x", "KeyX", 88, { commands: [] });
    await page.send("Input.insertText", { text: "x" });
    await page.until(`window.__scriptEditor.markdown().includes("out loud. xToday:")`, "typing after the cancelled composition");
    await undo(page);
    await page.until(`window.__scriptEditor.markdown().includes("out loud. Today:")`, "one Undo takes back only the later typing");
    await undo(page);
    await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "the next Undo puts the span back");
    results.push(`${width}px cancelled composition: met — later typing is its own Undo step`);

    // 13. Ctrl+Backspace deletes the span; Ctrl+B (bold) does nothing to it.
    await page.key("Escape", "Escape", 27);
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    await page.key("b", "KeyB", 66, { modifiers: 2 });
    assert.equal(await md(page), original, "Ctrl+B leaves the span's words");
    await page.key("Backspace", "Backspace", 8, { modifiers: 2 });
    await page.until(`window.__scriptEditor.markdown().includes("out loud. Today:")`, "Ctrl+Backspace deletes the span");
    await undo(page);
    await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "Undo after Ctrl+Backspace");
    results.push(`${width}px Ctrl keys: met — Ctrl+Backspace deletes the span, Ctrl+B leaves it`);

    // 14. Cut and Enter (coverage asked for in review): cut copies and deletes; Enter splits at the join.
    await page.key("Escape", "Escape", 27);
    // The editor's cut handler stops the event, so what it puts on the clipboard is recorded as it writes it.
    await page.eval(`window.__cut = null; window.addEventListener("cut", (e) => { const dt = e.clipboardData, set = dt.setData.bind(dt); dt.setData = (type, value) => { window.__cut = value; set(type, value); }; }, { capture: true, once: true })`);
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    await page.key("x", "KeyX", 88, { modifiers: 2, commands: ["cut"] });
    await page.until(`window.__scriptEditor.markdown().includes("out loud. Today:")`, "cut deletes the span");
    assert.equal(await page.eval(`window.__cut`), COPIED, "cut gives the same words as copy");
    await undo(page);
    await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "Undo after cut");
    await page.key("Escape", "Escape", 27);
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    await page.key("Enter", "Enter", 13);
    await page.until(`window.__scriptEditor.markdown().includes("out loud. \\n\\nToday:")`, "Enter splits at the join");
    await undo(page);
    await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "Undo after Enter");
    results.push(`${width}px cut and Enter: met — cut copied and deleted, Enter split at the join, each one Undo`);

    // 14b. Copy, cut and paste while typing in the shot card are the field's, never the span's (release review R1-3).
    // A failed shot save opens the card from code while a span is drawn: nothing pressed in the script ends the span.
    await page.key("Escape", "Escape", 27);
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    assert.ok((await spanState(page)).on, "a span is drawn before the shot card opens");
    await page.eval(`(() => { document.querySelector("#shotCard").hidden = false; const f = document.querySelector("#scWhat"); f.value = "Typed words"; f.focus(); f.select(); return true; })()`);
    assert.ok((await spanState(page)).on, "the span is still drawn while the shot card's field has the focus");
    await page.eval(`window.__copied = null; true`);
    await page.key("c", "KeyC", 67, { modifiers: 2, commands: ["copy"] });
    await page.until(`window.__copied !== null`, "copy event in the shot card");
    assert.notEqual(await page.eval(`window.__copied`), COPIED, "Ctrl+C in the shot card does not copy the script");
    await page.key("x", "KeyX", 88, { modifiers: 2, commands: ["cut"] });
    await page.until(`document.querySelector("#scWhat").value === ""`, "Ctrl+X cuts the field's words");
    assert.equal(await md(page), original, "Ctrl+X in the shot card leaves the script");
    await page.key("v", "KeyV", 86, { modifiers: 2, commands: ["paste"] });
    await page.until(`document.querySelector("#scWhat").value === "Typed words"`, "Ctrl+V pastes into the field");
    assert.equal(await md(page), original, "Ctrl+V in the shot card leaves the script");
    // Closed with the focus left nowhere (on the page itself), Ctrl+C copies the span again.
    await page.eval(`document.querySelector("#shotCard").hidden = true; document.activeElement.blur(); window.__copied = null; true`);
    await page.key("c", "KeyC", 67, { modifiers: 2, commands: ["copy"] });
    await page.until(`window.__copied !== null`, "copy event after the shot card closed");
    assert.equal(await page.eval(`window.__copied`), COPIED, "Ctrl+C after the shot card closed copies the span");
    await page.eval(`document.querySelector("#script [contenteditable]").focus(); true`);
    await page.key("Escape", "Escape", 27);
    assert.ok(!(await spanState(page)).on, "Escape in the script ends the span");
    results.push(`${width}px copy, cut and paste in the shot card: met — the field got them, the script stayed as it was; once the card closed, Ctrl+C copied the span again`);

    // 15. Held near the window's end, a drag scrolls the page on and the selection grows with it; letting go stops both.
    await page.key("Escape", "Escape", 27);
    {
      const a = await page.eval(pointJs(P1, "Why", true));
      const low = await page.eval(`({ x: innerWidth / 2, y: innerHeight - 6 })`);
      const top = await page.eval(`scrollY`), before = (await spanState(page)).ranges;
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...a, buttons: 0 });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...a, button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 8; i++) { await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + (low.x - a.x) * i / 8, y: a.y + (low.y - a.y) * i / 8, button: "left", buttons: 1 }); await sleep(25); }
      const held = (await spanState(page)).ranges;
      await sleep(1200);
      const grown = await spanState(page), scrolled = await page.eval(`scrollY`);
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...low, button: "left", buttons: 0, clickCount: 1 });
      const let_go = await page.eval(`scrollY`);
      await sleep(400);
      assert.equal(before, 0, "no span before the drag");
      assert.ok(scrolled > top + 100, `the page scrolled on while the mouse was held near the window's end (${top} → ${scrolled})`);
      assert.ok(grown.on && grown.ranges > held, `the selection grew with the page (${held} → ${grown.ranges} blocks)`);
      assert.equal(await page.eval(`scrollY`), let_go, "letting go stops the scrolling");
      results.push(`${width}px drag near the window's end: met — the page scrolled ${Math.round(scrolled - top)} px and the selection grew from ${held} to ${grown.ranges} blocks; letting go stopped it`);
      await page.key("Escape", "Escape", 27);
      await page.eval(`scrollTo(0, 0)`);
    }

    // 16. The agent changes a block the span covers (bolds an earlier word of its first paragraph): the span ends, so
    // Copy and Delete never reach words it did not cover.
    {
      const index = await page.eval(`[...document.querySelectorAll("#script .block")].findIndex((el) => el.textContent.startsWith(${JSON.stringify(P1)}))`);
      const askId = await page.eval(`window.__scriptEditor.ask(${index}, 2, 7, "simpler")`);
      assert.ok(askId, "an ask on the first paragraph's second word");
      assert.equal(await page.eval(`window.__scriptEditor.asks().find((a) => a.id === ${JSON.stringify(askId)}).quote`), "blank", "the ask is on \"blank\"");
      await page.key("Escape", "Escape", 27);
      // The ask's label shows inside the paragraph, after "blank": the drag finds the paragraph by its later words.
      await drag(page, ["page. A deadline.", "Why"], [P3, "Today:"]);
      assert.ok((await spanState(page)).on, "the span is drawn before the agent's change");
      assert.ok(await page.eval(`window.__scriptEditor.answer(${JSON.stringify(askId)}, { kind: "replace", text: "**blank**" })`), "the agent's change goes in");
      await page.until(`window.__scriptEditor.markdown().includes("A **blank** page")`, "the agent's bold");
      assert.ok(!(await spanState(page)).on, "the agent's change to a block the span covers ends the span");
      await page.eval(`window.__copied = null`);
      await page.key("c", "KeyC", 67, { modifiers: 2, commands: ["copy"] });
      await sleep(150);
      assert.ok(!(await page.eval(`window.__copied`)), "Copy gives no words of the old span");
      await page.key("Delete", "Delete", 46);
      await sleep(150);
      const after = await md(page);
      assert.ok(after.includes(P2) && after.includes("A **blank** page. A deadline."), "Delete takes no words of the old span");
      for (let i = 0; i < 4 && (await md(page)) !== original; i++) { await undo(page); await sleep(150); }
      assert.equal(await md(page), original, "Undo takes the agent's change back");
      results.push(`${width}px agent's change: met — bolding a word in the first paragraph ended the span; Copy and Delete took nothing of it`);
    }

    // 16b. An open ask and a "Sounds like me" mark on words after the span, in its last paragraph: Delete takes them to
    // the joined paragraph, one Undo puts them back on their words, still open; Redo and Undo again do the same (TOOLS-483).
    {
      const p3 = await page.eval(`[...document.querySelectorAll("#script .block")].findIndex((el) => el.textContent.startsWith(${JSON.stringify(P3)}))`);
      const content = await page.eval(`window.__scriptEditor.markdown().split("\\n").find((l) => l.startsWith(${JSON.stringify(P3)}))`);
      const at = content.indexOf("sounds like you");
      const askId = await page.eval(`window.__scriptEditor.ask(${p3}, ${at}, ${at + "sounds like you".length}, "simpler")`);
      assert.ok(askId, "an ask on \"sounds like you\" in the third paragraph");
      await page.key("Escape", "Escape", 27);
      const voiceId = await page.eval(`window.__scriptEditor.voiceCheck()`);
      assert.ok(voiceId && await page.eval(`window.__scriptEditor.answer(${JSON.stringify(voiceId)}, { kind: "marks", marks: [{ quote: "before you press record", why: "test" }] })`), "a Sounds like me mark on \"before you press record\"");
      const anchors = () => page.eval(`(() => {
        const asks = window.__scriptEditor.asks(), a = asks.find((x) => x.id === ${JSON.stringify(askId)}), v = asks.find((x) => x.id === ${JSON.stringify(voiceId)});
        const m = v.answer.marks[0], text = (id) => [...document.querySelectorAll("#script .block")].find((el) => el.dataset.id === id)?.textContent || "";
        return { ask: a.status, askIn: text(a.blockId).slice(0, 12), askWords: a.quote, mark: m.state, markIn: text(m.blockId).slice(0, 12) };
      })()`);
      const before = await anchors();
      assert.deepEqual(before, { ask: "waiting", askIn: "Hi, I'm Sam,", askWords: "sounds like you", mark: "open", markIn: "Hi, I'm Sam," }, "both on the third paragraph");
      await drag(page, [P1, "Why"], [P3, "Today:"]);
      assert.ok((await spanState(page)).on, "the span is drawn");
      const withMarks = await md(page);
      await page.key("Delete", "Delete", 46);
      await page.until(`!window.__scriptEditor.markdown().includes(${JSON.stringify(P2)})`, "the span went");
      const joined = await anchors();
      assert.deepEqual(joined, { ...before, askIn: "A blank page", markIn: "A blank page" }, "both follow their words to the joined paragraph");
      await undo(page);
      await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(withMarks)}`, "Undo puts the words back");
      assert.deepEqual(await anchors(), before, "after Undo the ask is still open and both are back on the third paragraph");
      await page.key("y", "KeyY", 89, { modifiers: 2 });
      await page.until(`!window.__scriptEditor.markdown().includes(${JSON.stringify(P2)})`, "Redo deletes the span again");
      assert.deepEqual(await anchors(), joined, "after Redo both are on the joined paragraph, still open");
      await undo(page);
      await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(withMarks)}`, "Undo again puts the words back");
      assert.deepEqual(await anchors(), before, "after the second Undo both are open on the third paragraph");
      await page.key("Escape", "Escape", 27);
      results.push(`${width}px asks after the span: met — an ask on "sounds like you" and a Sounds like me mark stayed open through Delete, Undo, Redo and Undo, each time on its words`);
    }

    // 16c. The agent changes the first paragraph while the mouse is still held in a drag: the span ends and the drag with
    // it, so moving on or letting go draws nothing from old offsets; held near the window's end, the editor's scrolling
    // stops too (no span is drawn again while it would scroll on).
    {
      const index = await page.eval(`[...document.querySelectorAll("#script .block")].findIndex((el) => el.textContent.startsWith(${JSON.stringify(P1)}))`);
      const held = async (to, label) => {
        const askId = await page.eval(`window.__scriptEditor.ask(${index}, 2, 7, "simpler")`);
        assert.ok(askId, `an ask on "blank" (${label})`);
        await page.key("Escape", "Escape", 27);
        await page.eval(`scrollTo(0, 0)`);
        const a = await page.eval(pointJs("page. A deadline.", "Why", true));
        const b = typeof to === "string" ? await page.eval(pointJs(P3, to)) : await page.eval(`({ x: innerWidth / 2, y: innerHeight - 6 })`);
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...a, buttons: 0 });
        await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...a, button: "left", buttons: 1, clickCount: 1 });
        for (let i = 1; i <= 8; i++) { await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8, button: "left", buttons: 1 }); await sleep(25); }
        assert.ok((await spanState(page)).on, `the span is drawn while the mouse is held (${label})`);
        assert.ok(await page.eval(`window.__scriptEditor.answer(${JSON.stringify(askId)}, { kind: "replace", text: "**blank**" })`), `the agent's change goes in (${label})`);
        await page.until(`window.__scriptEditor.markdown().includes("A **blank** page")`, "the agent's bold");
        await sleep(100);
        const y0 = await page.eval(`scrollY`);
        for (let i = 1; i <= 4; i++) { await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x - 10 * i, y: b.y - 2 * i, button: "left", buttons: 1 }); await sleep(25); }
        await sleep(400);
        const moved = await spanState(page), y1 = await page.eval(`scrollY`);
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x - 40, y: b.y - 8, button: "left", buttons: 0, clickCount: 1 });
        await sleep(100);
        const released = await spanState(page);
        assert.ok(!moved.on && !moved.ranges, `no span comes back while the mouse moves on (${label}): ${JSON.stringify(moved)}`);
        assert.ok(!released.on && !released.ranges, `no span after letting go (${label}): ${JSON.stringify(released)}`);
        for (let i = 0; i < 4 && (await md(page)) !== original; i++) { await undo(page); await sleep(150); }
        assert.equal(await md(page), original, `Undo takes the agent's change back (${label})`);
        return typeof to === "string" ? "moving on and letting go drew no span" : `held there 0.5 s more (the page went ${y0} → ${y1}, the browser's own scrolling of its selection in the first paragraph) and let go, no span came back`;
      };
      const plain = await held("Today:", "held drag");
      const scrolling = await held(null, "held near the window's end");
      await page.eval(`scrollTo(0, 0)`);
      results.push(`${width}px agent's change during a held drag: met — the span ended at once; ${plain}; near the window's end ${scrolling}`);
    }

    // 17. A moved shot keeps its orange frame while the mouse is over it (TOOLS-477).
    {
      assert.ok(await page.eval(`matchMedia("(hover: hover) and (pointer: fine)").matches`), "Chrome reports a mouse (see the flags at the top)");
      await drag(page, [P1, "Why"], [P3, "Today:"]);
      await page.key("Delete", "Delete", 46);
      await page.until(`!!document.querySelector(".shot-frame[data-moved]")`, "a moved shot");
      const box = await page.eval(`(() => { const el = document.querySelector(".shot-frame[data-moved] .shot-frame__jump"); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...box, buttons: 0 });
      await page.until(`document.querySelector(".shot-frame[data-moved] .shot-frame__jump").matches(":hover")`, "the mouse over the moved shot");
      const frame = await page.eval(`getComputedStyle(document.querySelector(".shot-frame[data-moved] .frame__img")).boxShadow`);
      const accent = await page.eval(`(() => { const d = document.createElement("i"); d.style.color = "var(--accent)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`);
      assert.ok(frame.includes(accent) && /\b2px\b/.test(frame), `the moved shot keeps its orange frame on mouse-over: ${frame}`);
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, buttons: 0 });
      await undo(page);
      await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "Undo after the hover check");
      results.push(`${width}px moved shot on mouse-over: met — the orange frame stays (${frame})`);
    }

    // 18. A click ends the span; the editor goes on as before.
    await page.click("#script .block[data-type=para]");
    assert.ok(!(await spanState(page)).on, "a click clears the span");
    assert.deepEqual(page.log, [], "no browser errors");
    await mkdir(".scratch/tools-470-shots", { recursive: true });
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    const png = await page.send("Page.captureScreenshot", { format: "png" });
    await writeFile(`.scratch/tools-470-shots/${width}.png`, Buffer.from(png.data, "base64"));
    await page.click("#script .block[data-type=para]");

    // 18b. Linking another B-roll list ends "Moved here" (TOOLS-482): the demo's list again, through the file field.
    // Undo then puts the words back (that list's shots are left alone), so B2 shows again on its own paragraph.
    {
      await drag(page, [P1, "Why"], [P3, "Today:"]);
      await page.key("Delete", "Delete", 46);
      await page.until(`!!document.querySelector(".shot-frame[data-moved]")`, "a moved shot before linking a list");
      const { root } = await page.send("DOM.getDocument");
      const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#brollInput" });
      const list = new URL("../public/samples/demo-good-script-broll.md", import.meta.url).pathname;
      await page.send("DOM.setFileInputFiles", { nodeId, files: [list] });
      await page.until(`window.__scriptEditor.broll().find((x) => x.id === "B2")?.over === ${JSON.stringify(b2.over)}`, "the list linked again: B2 back on its Over from the file");
      await undo(page);
      await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "Undo puts the words back after the list was linked again");
      await page.until(`document.querySelectorAll(".shot-frame").length >= 6`, "B2 shows again on its paragraph");
      await sleep(300);
      assert.equal(await page.eval(`document.querySelectorAll(".shot-frame[data-moved], .moved-note").length`), 0, "no Moved here after another list is linked");
      results.push(`${width}px list linked again: met — after a span delete moved B2 ("Moved here"), the demo's list was linked through the file field and Undo put the words back: B2 shows on its paragraph with no "Moved here"`);
    }

    // 19. In a shared script the selection stays inside one paragraph, as before (Lex, 2026-11-26, TOOLS-477): one
    // Undo there could not take back an edit across paragraphs. Host and guest alike.
    {
      await page.eval(`Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__link = t; } } }); true`);
      // A span drawn before the room starts (Share pressed with no pointer press, as from the keyboard) ends there: the
      // next Delete takes no words of it.
      await drag(page, [P1, "Why"], [P3, "Today:"]);
      assert.ok((await spanState(page)).on, "the span is drawn before sharing");
      await page.eval(`document.querySelector("#shareBtn").click(); true`);
      const shared = await spanState(page);
      assert.ok(!shared.on && shared.ranges === 0, `host: the span goes off the screen when Share is pressed: ${JSON.stringify(shared)}`);
      await page.until(`!!window.__link`, "the share link");
      await page.key("Delete", "Delete", 46);
      await sleep(200);
      const s0 = await spanState(page), t0 = await md(page);
      assert.ok(!s0.on && s0.ranges === 0, `host: a span from before sharing ends: ${JSON.stringify(s0)}`);
      assert.ok(t0.includes(P2) && t0.includes(P3), "host: Delete after sharing leaves the other paragraphs");
      const guest = await openPage(width, 1000);
      try {
        await guest.send("Page.navigate", { url: await page.eval(`window.__link`) });
        await guest.until(`!document.querySelector("#joinForm").hidden`, "the Join form");
        await guest.eval(`document.querySelector("#joinName").value = "Guest"; true`);
        await guest.click("#joinForm button");
        await guest.until(`document.querySelector("#script").textContent.includes(${JSON.stringify(P3)})`, "the guest's script", 12000);
        // Each Delete takes only words of the first paragraph (the guest's from "deadline" on), so the host finds that
        // paragraph by its start and starts at an earlier word of it.
        for (const [who, tab, word] of [["guest", guest, "deadline"], ["host", page, "blank"]]) {
          await tab.send("Page.bringToFront");
          await drag(tab, ["A blank page.", word], [P3, "Today:"]);
          const s = await spanState(tab);
          assert.ok(!s.on && s.ranges === 0, `${who}: no selection across paragraphs in a shared script: ${JSON.stringify(s)}`);
          await tab.key("Delete", "Delete", 46);
          await sleep(200);
          const text = await md(tab);
          assert.ok(text.includes(P2) && text.includes(P3), `${who}: Delete leaves the other paragraphs`);
          assert.deepEqual(tab.log, [], `${who}: no browser errors`);
        }
        results.push(`${width}px shared script: met — a span from before sharing ends; guest and host drags stay inside one paragraph; Delete leaves the other paragraphs`);
      } finally {
        await guest.close();
      }
      // Once sharing stops, the host selects across paragraphs again.
      await page.send("Page.bringToFront");
      await page.eval(`document.querySelector("#stopShare").click(); true`);
      await page.until(`document.querySelector("#stopShare").hidden`, "sharing stopped");
      await drag(page, [P2, "Most"], [P3, "Today:"]);
      const back = await spanState(page);
      assert.ok(back.on && back.ranges === 2,`host: after sharing stops the span is drawn again: ${JSON.stringify(back)}`);
      await page.key("Escape", "Escape", 27);
      results.push(`${width}px after sharing: met — once sharing stops, a drag selects across paragraphs again`);
    }

  } catch (error) {
    console.log(`DIAGNOSTIC ${width}px: ${JSON.stringify(await spanState(page).catch(() => null))} log=${JSON.stringify(page.log)}`);
    throw error;
  } finally {
    await page.close();
  }
}
for (const line of results) console.log(`PROOF ${line}`);
console.log(`RESULT: ok tools-470-browser ${results.length}/48 checks at 1280 and 390 px`);
} catch (error) {
  for (const line of results) console.log(`PROOF ${line}`);
  console.log(`RESULT: fail tools-470-browser ${error.message.split("\n")[0]}`);
  process.exitCode = 1;
} finally { cdp.close(); }
