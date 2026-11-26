#!/usr/bin/env node
// TOOLS-470: select across paragraphs with the mouse. Start a local Worker (wrangler dev) and a headless Chrome through
// kit bg, then run: node scripts/smoke-select-across.mjs http://127.0.0.1:<port> <Chrome debugging port>.
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
    await undo(page);
    await page.until(`window.__scriptEditor.markdown() === ${JSON.stringify(original)}`, "one Undo takes back the composed text and the span's delete");
    assert.ok((await spanState(page)).on, "the span is selected again");
    results.push(`${width}px composed text: met — "é" replaced three paragraphs; one Undo put the words and the span back`);

    // 10. A click ends the span; the editor goes on as before.
    await page.click("#script .block[data-type=para]");
    assert.ok(!(await spanState(page)).on, "a click clears the span");
    assert.deepEqual(page.log, [], "no browser errors");
    await mkdir(".scratch/tools-470-shots", { recursive: true });
    await drag(page, [P1, "Why"], [P3, "Today:"]);
    const png = await page.send("Page.captureScreenshot", { format: "png" });
    await writeFile(`.scratch/tools-470-shots/${width}.png`, Buffer.from(png.data, "base64"));
  } catch (error) {
    console.log(`DIAGNOSTIC ${width}px: ${JSON.stringify(await spanState(page).catch(() => null))} log=${JSON.stringify(page.log)}`);
    throw error;
  } finally {
    await page.close();
  }
}
for (const line of results) console.log(`PROOF ${line}`);
console.log(`RESULT: ok tools-470-browser ${results.length}/18 checks at 1280 and 390 px`);
} catch (error) {
  for (const line of results) console.log(`PROOF ${line}`);
  console.log(`RESULT: fail tools-470-browser ${error.message.split("\n")[0]}`);
  process.exitCode = 1;
} finally { cdp.close(); }
