#!/usr/bin/env node
// Browser check for step Q: "Keep all" and "Undo all" for the agent's pictures, at 1280, 390 and 1920 px; and how bold words (steps P and S)
// work and look. It also runs against the live site after a deploy: it sends only test data, through this browser.
// Start the Worker and a headless Chrome first (docs/build/step-q-keep-all-images.md says how), then:
// node scripts/smoke-keep-all.mjs <base URL> <Chrome debugging port> [folder for screenshots]
// It plays the agent over fetch to /mcp and the person with real clicks over CDP. Its traffic goes to the base URL and the debugging port.
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const PORT = process.argv[3] || "9222";
const SHOTS = process.argv[4] || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "ok" : "FAIL"} ${label}${extra !== "" && !ok ? ` (${extra})` : ""}`);
  if (!ok) failures++;
};

/* ---------- One Chrome page over CDP ---------- */
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const cdp = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { cdp.addEventListener("open", resolve); cdp.addEventListener("error", reject); });
let nextId = 0;
const waiting = new Map();
cdp.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  // "Leave this page?" after the script changed: yes, or the reload would wait for it for ever.
  if (m.method === "Page.javascriptDialogOpening") cdp.send(JSON.stringify({ id: ++nextId, method: "Page.handleJavaScriptDialog", params: { accept: true }, sessionId: m.sessionId }));
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

async function openPage(width, height, sameAs = null) {
  const { browserContextId } = sameAs ? { browserContextId: sameAs.contextId } : await send("Target.createBrowserContext"); // its own storage: a fresh person
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = {
    contextId: browserContextId,
    targetId,
    send: (method, params) => send(method, params, sessionId),
    async eval(expression) {
      const r = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async until(expression, label, ms = 8000) {
      const end = Date.now() + ms;
      for (;;) {
        if (await page.eval(expression)) return true;
        if (Date.now() > end) { check(false, `timed out: ${label}`); return false; }
        await sleep(60);
      }
    },
    // A real press at the middle of the element, after bringing it into view.
    async click(selector) {
      const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error(`nothing to press: ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 });
    },
    async shot(name) {
      if (!SHOTS) return;
      mkdirSync(SHOTS, { recursive: true });
      await sleep(500); // the bars animate in
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, "base64"));
    },
    close: () => send("Target.disposeBrowserContext", { browserContextId }),
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  return page;
}

/* ---------- The agent ---------- */
let rpcId = 0;
async function mcp(token, name, args) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  const text = body?.result?.content?.[0]?.text ?? "";
  if (body?.result?.isError || body?.error) throw new Error(`${name}: ${text || JSON.stringify(body.error)}`);
  return text;
}
const drawing = (n) => `<svg viewBox="0 0 260 140"><circle cx="${40 + n * 20}" cy="70" r="30"/></svg>`;

// A fresh person with the demo open, and the agent connected to their tab.
async function openDemo(width, height) {
  const { token } = await (await fetch(`${BASE}/api/agent-token`, { method: "POST" })).json();
  const page = await openPage(width, height);
  await page.send("Page.navigate", { url: `${BASE}/` });
  await page.until(`document.readyState === "complete"`, "the page loads");
  await page.eval(`localStorage.setItem("script-editor:agent", JSON.stringify({ token: ${JSON.stringify(token)}, createdAt: Date.now() }))`);
  await page.send("Page.reload");
  await sleep(300);
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the start screen");
  await page.click("#emptySample");
  await page.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the demo's shots");
  const agent = (name, args) => mcp(token, name, args);
  for (let i = 0; ; i++) {
    try { await agent("get_script", {}); break; } catch (e) { if (i > 40) throw e; await sleep(150); }
  }
  return { page, agent };
}
const clickAt = async (page, { x, y }) => { for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const pressKey = async (page, key, code, vk, text) => { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, ...(type === "keyDown" && text ? { text } : {}) }); };

// A press on the bar: it sits at the top of the page, so the person scrolls up to it.
async function pressBar(page, which) {
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  await page.click(`#imagesAll .${which}`);
}
// The bar is part of the page's flow, above the text: on every kind of edit the caret's line stays clear of it.
async function noCover(page, tag) {
  const barRect = `document.querySelector("#imagesAll .change__bar").getBoundingClientRect()`;
  check((await page.eval(`getComputedStyle(document.querySelector("#imagesAll")).position`)) === "static", `${tag}: the bar is in the page's flow, not sticky and not floating`);
  const textClear = `${barRect}.bottom <= document.querySelector(".sheet").getBoundingClientRect().top`;
  const caretClear = `(() => { const b = ${barRect}, s = getSelection(), r = s.rangeCount && s.getRangeAt(0).getClientRects()[0] || s.anchorNode?.parentElement?.getBoundingClientRect(); return !!r && (r.bottom <= b.top || r.top >= b.bottom); })()`;
  for (const top of [0, 300, 900]) {
    await page.eval(`scrollTo({ top: ${top}, behavior: "instant" })`);
    await sleep(40);
    check(await page.eval(textClear), `${tag}: the bar is above all the text, scrolled to ${top}`);
  }
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  const spot = await page.eval(`(() => { const s = document.querySelector(".sheet").getBoundingClientRect(); for (const l of document.querySelectorAll("#script .line")) { const b = l.getBoundingClientRect(); for (let y = b.top + 4; y < Math.min(b.bottom, innerHeight - 20); y += 6) { const r = document.caretRangeFromPoint(s.left + 6, y), n = r?.startContainer; if (n?.nodeType === 3 && n.textContent.trim().length > 10 && !n.parentElement.closest(".broll-tags")) return { x: s.left + 6, y }; } } return null; })()`);
  check(!!spot, `${tag}: a line of text to click on`);
  if (!spot) return;
  await clickAt(page, spot);
  await sleep(150);
  check(await page.eval(caretClear), `${tag}: a click: the caret's line is clear of the bar`);
  const edits = [
    ["typing", () => pressKey(page, "x", "KeyX", 88, "x")],
    ["undo", () => page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 }).then(() => page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 }))],
    ["Enter", () => pressKey(page, "Enter", "Enter", 13, "\r")],
    ["Backspace joining two lines", () => pressKey(page, "Backspace", "Backspace", 8)],
    ["an arrow key", () => pressKey(page, "ArrowUp", "ArrowUp", 38)],
  ];
  for (const [what, edit] of edits) {
    await edit();
    await sleep(120);
    check(await page.eval(caretClear), `${tag}: ${what}: the caret's line is clear of the bar`);
  }
  check((await page.eval(`getComputedStyle(document.querySelector("#slashMenu")).position`)) === "fixed", `${tag}: the "/" menu keeps its own place: the bar's styles lost no other rule`);
  await page.eval(`getSelection().removeAllRanges()`);
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
}

// A word in the first paragraph that fits on screen, for a real double-click.
const wordSpot = `(() => { const l = [...document.querySelectorAll("#script .line__text, #script .line")].find((x) => x.textContent.includes("A blank page.")), w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const at = n.textContent.indexOf("deadline"); if (at < 0) continue; const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + 8); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } return null; })()`;
const doubleClick = async (page, at) => { for (const clickCount of [1, 2]) for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount }); await sleep(250); };

// Bold is always on (step S): the B button shows, it marks the word and the word shows bold.
async function runBold(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(width, height);
  const text = async () => JSON.parse(await agent("get_script", {})).markdown;
  const at = await page.eval(wordSpot);
  check(!!at, `${tag}: a word to select`);
  await doubleClick(page, at);
  check(await page.until(`!document.querySelector("#editBar").hidden`, "the selection bar"), `${tag}: selecting a word shows the selection bar`);
  await page.eval(`getSelection().removeAllRanges()`);
  await sleep(150);
  await doubleClick(page, await page.eval(wordSpot));
  const word = await page.eval(`getSelection().toString().trim()`);
  check(await page.until(`!document.querySelector("#boldBtn").hidden`, "the B button"), `${tag}: the B button shows`);
  await page.click("#boldBtn");
  await sleep(250);
  check((await text()).includes(`**${word}**`), `${tag}: B marks the word in the text`, word);
  await page.eval(`getSelection().removeAllRanges()`);
  await sleep(150);
  const weight = await page.eval(`(() => { const c = [...document.querySelectorAll("#script [data-cue], #script [data-cue] *")].map((e) => Number(getComputedStyle(e).fontWeight)); return c.length ? Math.max(...c) : 0; })()`);
  check(weight >= 600, `${tag}: the marked word shows bold`, weight);
  // A paste that breaks the bold stretch inside an open ask's range cancels the ask: it doesn't move onto other words.
  const paraOf = `[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("page."))`;
  const pick = (from, to) => `(() => { const el = ${paraOf}, w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) nodes.push(n); const point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }; const r = document.createRange(); r.setStart(...point(${from})); r.setEnd(...point(${to})); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`;
  const line = () => page.eval(`${paraOf}.textContent`);
  const opening = (await line()).indexOf("**");
  await page.eval(pick(opening, opening + word.length + 10));
  await sleep(300);
  await page.click(`#editBar [data-act="shorter"]`);
  check(await page.until(`!!${paraOf}.querySelector("[data-ask]")`, "an ask over the bold word"), `${tag}: an ask sits over the bold word`);
  await page.eval(pick(opening + 3, opening + 4));
  await page.eval(`(() => { const d = new DataTransfer(); d.setData("text/plain", "=*"); document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })); })()`);
  check(await page.until(`!${paraOf}.querySelector("[data-ask]")`, "the ask cancelled"), `${tag}: a paste that breaks the bold stretch inside the ask cancels it`);
  // Also when its words come again later in the line: it is cancelled, not moved onto the later copy by a search.
  await page.eval(`(() => { const el = ${paraOf}; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text: " **go on** and go on" });
  await sleep(300);
  const copy = (await line()).lastIndexOf("**go on**") + 2;
  await page.eval(pick(copy, copy + 5));
  await sleep(300);
  await page.click(`#editBar [data-act="shorter"]`);
  check(await page.until(`!!${paraOf}.querySelector("[data-ask]")`, "an ask on the repeated words"), `${tag}: an ask sits on the first of two repeated phrases`);
  await page.eval(pick(copy + 4, copy + 5));
  await page.eval(`(() => { const d = new DataTransfer(); d.setData("text/plain", "=*"); document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })); })()`);
  check(await page.until(`!${paraOf}.querySelector("[data-ask]")`, "the repeated ask cancelled"), `${tag}: that paste cancels it, it doesn't jump to the later copy`);
  // An ask already answered with a note closes the same way: the agent is told it was cancelled.
  await page.eval(`(() => { const el = ${paraOf}; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text: " **note this**" });
  await sleep(300);
  const reached = (await line()).lastIndexOf("**note this**");
  await page.eval(pick(reached, reached + 13));
  await sleep(300);
  await page.click(`#editBar [data-act="shorter"]`);
  await page.until(`!!${paraOf}.querySelector("[data-ask]")`, "an ask to answer");
  const taken = JSON.parse(await agent("wait_for_asks", { waitSeconds: 0 })).asks.at(-1);
  await agent("answer_ask", { askId: taken.id, kind: "note", text: "A note." });
  await page.eval(pick(reached + 3, reached + 4));
  await page.eval(`(() => { const d = new DataTransfer(); d.setData("text/plain", "=*"); document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })); })()`);
  await sleep(300);
  const closed = JSON.parse(await agent("list_asks", {})).asks.find((x) => x.id === taken.id)?.status;
  check(closed === "cancelled", `${tag}: an answered ask closes as cancelled`, closed);
  await page.close();
}

// Real word-deleting keys next to a bold stretch: marks the deletion put back aren't hit, so no stray "**" stays. One Ctrl+Z
// brings each back. `S` goes at the end of the demo's first line.
async function runBoldKeys(width, height) {
  const tag = `${width} px`, S = "Say **big word** now okay.";
  const { page, agent } = await openDemo(width, height);
  const marked = (t) => t.replace(/(?<![\p{L}\p{N}*])\*\*[^\s*](?:[^*\n]*[^\s*])?\*\*(?![\p{L}\p{N}*])/gu, "");
  const lineOf = async () => JSON.parse(await agent("get_script", {})).markdown.split("\n").find((l) => l.includes("A blank page."));
  const paraOf = `[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank page."))`;
  const pick = (from, to = from) => `(() => { const el = ${paraOf}, w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) nodes.push(n); const point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }; const r = document.createRange(); r.setStart(...point(${from})); r.setEnd(...point(${to})); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`;
  const press = async (key, code, vk, modifiers = 0) => { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(250); };
  const CTRL = 2, back = ["Backspace", "Backspace", 8], del = ["Delete", "Delete", 46];
  await page.eval(`(() => { const el = ${paraOf}; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text: ` ${S}` });
  await sleep(400);
  const whole = await lineOf(), base = whole.length - S.length, at = (i) => base + i;
  const tail = async () => (await lineOf()).slice(base);
  const cases = [
    { name: "Ctrl+Backspace after the space before now", from: 17, keys: [...back, CTRL], want: "Say **big** now okay." },
    { name: "Backspace after that space", from: 17, keys: back },
    { name: "Ctrl+Backspace right after the closing marks", from: 16, keys: [...back, CTRL] },
    { name: "Backspace right after the closing marks", from: 16, keys: back },
    { name: "Backspace inside the bold words", from: 12, keys: back },
    { name: "Ctrl+Backspace inside the bold words", from: 12, keys: [...back, CTRL] },
    { name: "Delete right before the opening marks", from: 4, keys: del },
    { name: "Ctrl+Delete right before the opening marks", from: 4, keys: [...del, CTRL] },
    { name: "Delete right after the closing marks", from: 16, keys: del },
    { name: "Ctrl+Delete right after the closing marks", from: 16, keys: [...del, CTRL] },
    { name: "Ctrl+Delete inside the bold words", from: 10, keys: [...del, CTRL] },
    { name: "a selection across the closing marks, deleted", from: 10, to: 19, keys: back },
    { name: "a selection across the opening marks, deleted", from: 0, to: 8, keys: back },
    { name: "a selection over the whole stretch, deleted", from: 4, to: 16, keys: back },
  ];
  for (const c of cases) {
    const before = await lineOf();
    await page.eval(pick(at(c.from), at(c.to ?? c.from)));
    await sleep(250);
    await press(...c.keys);
    const got = await tail();
    if (c.want) check(got === c.want, `${tag}: ${c.name}`, got);
    check(!marked(got).includes("*"), `${tag}: ${c.name}: no stray marks`, got);
    check(got.replace(/\*/g, "").length <= S.replace(/\*/g, "").length && got !== S, `${tag}: ${c.name}: the deletion happened`, got);
    await page.eval(`${paraOf}.focus()`);
    await press("z", "KeyZ", 90, CTRL);
    check((await lineOf()) === before, `${tag}: ${c.name}: one Ctrl+Z brings it back`, await tail());
  }
  await page.close();
}

// The file name's menu on a short window (fleet #31 item 2): with a long recent list it is taller than the
// window, so it scrolls inside itself and its last row (the colours) can be reached; it never runs off the bottom.
async function runMenuHeight(width, height) {
  const tag = `${width}x${height}`;
  const { page } = await openDemo(width, height);
  // A full recent list: scripts kept in the browser are listed by name, so a dozen files make a long one.
  await page.eval(`(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("scripts", { create: true }); for (let i = 1; i <= 12; i++) { const w = await (await dir.getFileHandle("Recent script " + i + ".md", { create: true })).createWritable(); await w.write("# Recent " + i + "\\n\\nWords.\\n"); await w.close(); } })()`);
  await page.eval(`getSelection().removeAllRanges()`);
  await page.click("#docInfo");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await page.until(`document.querySelectorAll("#scriptList .scripts__row").length >= 12`, "a long recent list");
  await sleep(400);
  const menu = `document.querySelector("#scriptMenu")`;
  const box = () => page.eval(`(() => { const m = ${menu}, r = m.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, scrolls: m.scrollHeight > m.clientHeight + 1, overflowY: getComputedStyle(m).overflowY }; })()`);
  const b = await box();
  check(b.bottom <= b.h + 0.5 && b.top >= -0.5, `${tag}: the menu stays inside the window`, JSON.stringify(b));
  check(await page.eval(`${menu}.scrollWidth <= ${menu}.clientWidth`), `${tag}: it never scrolls sideways`);
  check(b.scrolls && b.overflowY === "auto", `${tag}: it scrolls inside itself when it is taller than the window`, JSON.stringify(b));
  // With the pointer over the recent list, the wheel carries on to the menu once the list ends.
  await page.eval(`${menu}.scrollTop = 0`);
  const over = await page.eval(`(() => { const r = document.querySelector("#scriptList").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(r.height, innerHeight - r.y) / 2 }; })()`);
  for (let i = 0; i < 14; i++) { await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: over.x, y: over.y, deltaX: 0, deltaY: 300 }); await sleep(120); }
  await sleep(300);
  const wheeled = await page.eval(`(() => { const m = ${menu}.getBoundingClientRect(), r = document.querySelector("#boldFg").getBoundingClientRect(); return { fgBottom: r.bottom, menuBottom: m.bottom, top: ${menu}.scrollTop }; })()`);
  check(wheeled.top > 0 && wheeled.fgBottom <= wheeled.menuBottom + 0.5, `${tag}: the wheel over the recent list reaches the colours below it`, JSON.stringify(wheeled));
  await page.eval(`${menu}.scrollTop = ${menu}.scrollHeight`);
  await sleep(200);
  const last = await page.eval(`(() => { const m = ${menu}.getBoundingClientRect(), r = document.querySelector("#boldFg").getBoundingClientRect(); return { fgBottom: r.bottom, menuBottom: m.bottom, fgTop: r.top, menuTop: m.top, h: r.height }; })()`);
  check(last.fgBottom <= last.menuBottom + 0.5 && last.fgTop >= last.menuTop && last.h > 0, `${tag}: scrolled down, the font colour input is in view`, JSON.stringify(last));
  await pressKey(page, "Escape", "Escape", 27);
  await page.close();
}

// A line that would read as another kind of block without its marks keeps them: no words may leave the saved script or the
// exports. With real keys, on a list, heading, quote and numbered line, and with words after the marks.
async function runBoldKinds(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(width, height);
  const script = async () => JSON.parse(await agent("get_script", {}));
  const press = async (key, code, vk, modifiers = 0, text) => { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers, ...(text && type === "keyDown" ? { text } : {}) }); await sleep(250); };
  const CTRL = 2, SHIFT = 8;
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  const first = `[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank page."))`;
  const caretIn = (para) => page.eval(`(() => { const el = ${para}, sel = getSelection(), r = document.createRange(); if (!el || !sel.focusNode || !el.contains(sel.focusNode)) return -1; r.setStart(el, 0); r.setEnd(sel.focusNode, sel.focusOffset); return r.toString().length; })()`);
  for (const line of ["**- item two**", "**# Plan**", "**## Plan**", "**> x y**", "**1. x y**", "**- item two** more"]) {
    // A line of its own under the demo's first line.
    await page.eval(`(() => { const el = ${first}; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
    await sleep(150);
    await press("Enter", "Enter", 13, 0, "\r");
    await page.send("Input.insertText", { text: line });
    await sleep(350);
    const para = `[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith(${JSON.stringify(line)}))`;
    const pick = (from, to = from) => `(() => { const el = ${para}, w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) nodes.push(n); const point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }; const r = document.createRange(); r.setStart(...point(${from})); r.setEnd(...point(${to})); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`;
    const has = async () => (await script()).markdown.split("\n").includes(line);
    const start = await script();
    check(start.markdown.split("\n").includes(line), `${tag}: ${line}: a paragraph holding it`);
    check(await page.eval(`!!${para}?.querySelector(".md-cue")`), `${tag}: ${line}: it shows bold`);
    const plain = line.replace(/\*\*/g, "");
    const same = async (what) => {
      const now = await script();
      check(!now.markdown.split("\n").includes(plain), `${tag}: ${line}: ${what}: it doesn't turn into ${plain}`, now.markdown.split("\n").find((l) => l.includes(plain.slice(0, 4))));
      check(now.words === start.words, `${tag}: ${line}: ${what}: no spoken word leaves the counts`, now.words);
      // At the very start of a line, Backspace may join it to the line above, as it always does; Ctrl+Z takes that back.
      if (now.markdown !== start.markdown) {
        await page.eval(`${first}.focus()`);
        await press("z", "KeyZ", 90, CTRL);
        check(await has(), `${tag}: ${line}: ${what}: one Ctrl+Z brings it back`);
      }
      check(await page.eval(`!!${para}`), `${tag}: ${line}: ${what}: it is still a paragraph`);
    };
    for (const [what, from, keys] of [
      ["Backspace at the start of its words", 2, ["Backspace", "Backspace", 8]],
      ["Delete at the start of the line", 0, ["Delete", "Delete", 46]],
      ["Ctrl+Backspace at the start of its words", 2, ["Backspace", "Backspace", 8, CTRL]],
      ["Enter inside its last word", line.indexOf("**", 2) - 1, ["Enter", "Enter", 13, 0, "\r"]],
      ["Shift+Enter inside its last word", line.indexOf("**", 2) - 1, ["Enter", "Enter", 13, SHIFT, "\r"]],
    ]) {
      await page.eval(pick(from));
      await sleep(250);
      await press(...keys);
      await same(what);
      // A refused edit leaves the caret where it was, never between the two asterisks.
      if (keys[0] === "Delete" && !keys[3]) check((await caretIn(para)) === 0, `${tag}: ${line}: ${what}: the caret stays`, await caretIn(para));
      if (keys[0] === "Backspace" && (await page.eval(`!!${para}`))) check((await caretIn(para)) !== 1, `${tag}: ${line}: ${what}: the caret isn't between the asterisks`, await caretIn(para));
    }
    // Ordinary typing in it still works, and one Ctrl+Z takes it back.
    await page.eval(pick(line.indexOf("**", 2)));
    await sleep(250);
    await page.send("Input.insertText", { text: "z" });
    await sleep(300);
    check((await script()).words >= start.words && !(await has()), `${tag}: ${line}: typing in its words works`);
    await page.eval(`${para.replace(JSON.stringify(line), JSON.stringify(line.slice(0, 4)))}?.focus()`);
    await press("z", "KeyZ", 90, CTRL);
    check(await has(), `${tag}: ${line}: one Ctrl+Z takes the typing back`);
    // Enter right after the line's mark, and just before the space after it ("**1.| x y**"): the parts joined without their
    // marks would read as a list or a heading, so it is refused (nothing changes); otherwise it splits. No word leaves either way.
    for (const [what, at, keys] of [
      ["Enter right after its mark", line.indexOf(" ") + 1, ["Enter", "Enter", 13, 0, "\r"]],
      ["Enter just before the space", line.indexOf(" "), ["Enter", "Enter", 13, 0, "\r"]],
      ["Shift+Enter just before the space", line.indexOf(" "), ["Enter", "Enter", 13, SHIFT, "\r"]],
    ]) {
      await page.eval(pick(at));
      await sleep(250);
      await press(...keys);
      const split = await script();
      check(split.words === start.words, `${tag}: ${line}: ${what}: no spoken word leaves the counts`, split.words);
      if (what.includes("just before")) check(split.markdown === start.markdown, `${tag}: ${line}: ${what}: refused, nothing changes`, split.markdown.split("\n").filter((l) => l.includes("item") || l.includes("Plan") || l.includes("x y")).join(" | "));
      if (split.markdown !== start.markdown) {
        await page.eval(`${first}.focus()`);
        await press("z", "KeyZ", 90, CTRL);
      }
      check(await has(), `${tag}: ${line}: ${what}: refused, or one Ctrl+Z takes it back`);
    }
  }
  // The other edits: each new line goes under the demo's first line.
  const addLine = async (line, under = first) => {
    await page.eval(`(() => { const el = ${under}; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
    await sleep(150);
    await press("Enter", "Enter", 13, 0, "\r");
    await page.send("Input.insertText", { text: line });
    await sleep(350);
    return `[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith(${JSON.stringify(line)}))`;
  };
  const placeIn = (para, from, to = from) => page.eval(`(() => { const el = ${para}, w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) nodes.push(n); const point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }; const r = document.createRange(); r.setStart(...point(${from})); r.setEnd(...point(${to})); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  const undoOnce = async () => { await page.eval(`${first}.focus()`); await press("z", "KeyZ", 90, CTRL); };
  const lines = async () => (await script()).markdown.split("\n");

  // A paste with a blank line over a bold word: it splits into paragraphs, nothing is dropped.
  const paste1 = await addLine("**big word** now");
  const before1 = await script();
  await placeIn(paste1, 6, 10);
  await sleep(250);
  await page.eval(`(() => { const d = new DataTransfer(); d.setData("text/plain", "a\\n\\nb"); document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })); })()`);
  await sleep(350);
  const after1 = await lines();
  check(after1.includes("big a") && after1.includes("b now"), `${tag}: a paste with a blank line over a bold word goes in as two paragraphs`, after1.filter((l) => l.includes("big") || l.includes(" now")).join(" | "));
  await undoOnce();
  check((await script()).markdown === before1.markdown, `${tag}: one Ctrl+Z takes that paste back`);

  // Pasting a list on purpose over the start of a bold stretch: it goes in.
  await placeIn(paste1, 0, 7);
  await sleep(250);
  await page.eval(`(() => { const d = new DataTransfer(); d.setData("text/plain", "- item"); document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })); })()`);
  await sleep(350);
  check((await lines()).some((l) => l.startsWith("- item")), `${tag}: a list pasted on purpose goes in`, (await lines()).find((l) => l.includes("item")));
  await undoOnce();
  check((await script()).markdown === before1.markdown, `${tag}: one Ctrl+Z takes it back`);

  // Enter over a selection inside a bold list-like line: neither part reads as a list, but joined they would ("- y z").
  const over = await addLine("**-x y** z");
  const beforeOver = await script();
  await placeIn(over, 3, 4);
  await sleep(250);
  await press("Enter", "Enter", 13, 0, "\r");
  const afterOver = await script();
  check(afterOver.markdown === beforeOver.markdown && afterOver.words === beforeOver.words, `${tag}: Enter over a selection inside a bold list-like line is refused, no word leaves`, (await lines()).find((l) => l.includes("y")));
  if (afterOver.markdown !== beforeOver.markdown) await undoOnce();

  // Joining a line onto a bold list-like line would make it a list: refused, both stay bold, no literal marks.
  const upper = await addLine("**- a**");
  const lower = await addLine("**b**", upper);
  const before2 = await script();
  await placeIn(lower, 0);
  await sleep(250);
  await press("Backspace", "Backspace", 8);
  const after2 = await script();
  check(after2.markdown === before2.markdown, `${tag}: joining onto a bold list-like line is refused`, after2.markdown.split("\n").find((l) => l.includes("- a")));
  check(!after2.markdown.includes("****"), `${tag}: no literal marks from that join`);
  check(await page.eval(`!!${upper}?.querySelector(".md-cue") && !!${lower}?.querySelector(".md-cue")`), `${tag}: both lines stay bold`);
  // An ordinary join still works, and a word against the bold joins it.
  const upper3 = await addLine("**big** x");
  const lower3 = await addLine("**y** z", upper3);
  await placeIn(lower3, 0);
  await sleep(250);
  await press("Backspace", "Backspace", 8);
  check((await lines()).includes("**big** **xy** z"), `${tag}: an ordinary join still works`, (await lines()).find((l) => l.includes("big")));
  await undoOnce();
  check((await lines()).includes("**big** x") && (await lines()).includes("**y** z"), `${tag}: one Ctrl+Z takes the join back`);

  // Typing "1. " in front of a bold word: the person asked for a list, and the space isn't swallowed.
  const typed = await addLine("**word** x");
  const before4 = await script();
  await placeIn(typed, 0);
  await sleep(250);
  for (const [k, c, v] of [["1", "Digit1", 49], [".", "Period", 190], [" ", "Space", 32]]) await press(k, c, v, 0, k);
  check((await lines()).includes("1. **word** x"), `${tag}: typing 1. and a space in front of a bold word`, (await lines()).find((l) => l.includes("word** x")));
  await undoOnce();
  check((await script()).markdown === before4.markdown, `${tag}: one Ctrl+Z takes that typing back`);

  await page.close();
}

// What leaves the editor: B and Ctrl+B mark and unmark, and the exports strip the "**".
async function runExports(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(width, height);
  const text = async () => JSON.parse(await agent("get_script", {})).markdown;
  await page.eval(`(() => { const make = URL.createObjectURL.bind(URL); window.__blobs = []; URL.createObjectURL = (b) => { window.__blobs.push(b); return make(b); }; })()`);
  const exported = async (kind) => {
    await page.eval(`window.__blobs.length = 0; document.querySelector('[data-export="${kind}"]').click()`);
    await page.until(`window.__blobs.length === 1`, `the ${kind} export`);
    return page.eval(`window.__blobs[0].text()`);
  };
  await doubleClick(page, await page.eval(wordSpot));
  const word = await page.eval(`getSelection().toString().trim()`);
  await page.until(`!document.querySelector("#boldBtn").hidden`, "the B button");
  await page.click("#boldBtn");
  await sleep(250);
  check((await text()).includes(`**${word}**`), `${tag}: B marks the word`, word);
  const ctrlB = async () => { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "b", code: "KeyB", modifiers: 2, windowsVirtualKeyCode: 66 }); await sleep(250); };
  await page.eval(`getSelection().removeAllRanges()`);
  await doubleClick(page, await page.eval(wordSpot));
  await ctrlB();
  check(!(await text()).includes(`**${word}**`), `${tag}: Ctrl+B takes it off`);
  await page.eval(`getSelection().removeAllRanges()`);
  await doubleClick(page, await page.eval(wordSpot));
  await ctrlB();
  check((await text()).includes(`**${word}**`) && (await page.eval(`document.querySelectorAll("#script [data-cue]").length`)) === 1, `${tag}: Ctrl+B puts it back, and it shows`);
  await page.eval(`getSelection().removeAllRanges()`);
  for (const kind of ["camera", "prompter"]) {
    const out = await exported(kind);
    check(out.includes(word) && !out.includes(`**${word}**`), `${tag}: the ${kind} export strips the stars`);
  }
  await page.close();
}

// How bold looks (step S): orange and bold by default, in the prompter's orange in dark mode; the menu holds only the colours,
// and they can be chosen and reset. An older "off" switch left in the browser means nothing and goes away.
async function runBoldLook(width, height) {
  const tag = `${width} px look`;
  const { page, agent } = await openDemo(width, height);
  await page.eval(`(() => { for (const [k, v] of [["cues", { on: false, export: "show" }], ["cues:Some name.md", { on: false }], ["cuesish", { kept: true }], ["boldStyle", { own: false, color: "#112233" }]]) localStorage.setItem("script-editor:" + k, JSON.stringify(v)); })()`);
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await page.send("Page.reload");
  await sleep(300);
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the start screen again");
  await page.click("#emptySample");
  await page.until(`!!document.querySelector("#script .block")`, "the script again");
  check((await page.eval(`localStorage.getItem("script-editor:cues")`)) === null && (await page.eval(`localStorage.getItem("script-editor:cues:Some name.md")`)) === null, `${tag}: the old switches left in the browser are gone`);
  check((await page.eval(`localStorage.getItem("script-editor:cuesish")`)) !== null, `${tag}: another key with a like name stays`);
  for (let i = 0; ; i++) { try { await agent("get_script", {}); break; } catch (e) { if (i > 40) throw e; await sleep(150); } }
  const words = `document.querySelector("#script [data-cue] .md-link__words")`;
  const look = () => page.eval(`(() => { const c = getComputedStyle(${words}); return { color: c.color, weight: Number(c.fontWeight), background: c.backgroundColor }; })()`);
  await doubleClick(page, await page.eval(wordSpot));
  const word = await page.eval(`getSelection().toString().trim()`);
  await page.until(`!document.querySelector("#boldBtn").hidden`, "the B button");
  await page.click("#boldBtn");
  await page.until(`!!${words}`, "the bold word");
  await page.eval(`getSelection().removeAllRanges()`);
  await sleep(250);
  const dark = await look();
  check(dark.weight === 800, `${tag}: the word is bold`, JSON.stringify(dark));
  const probe = (colour) => page.eval(`(() => { const a = document.createElement("span"); a.style.color = "${colour}"; document.body.append(a); const c = getComputedStyle(a).color; a.remove(); return c; })()`);
  const orange = await probe("oklch(65% 0.227 32.3)");
  check(dark.color === orange, `${tag}: dark mode: the word has the prompter's orange`, `${dark.color} ${orange}`);
  check(dark.background === "rgba(0, 0, 0, 0)", `${tag}: no background by default`, dark.background);
  const said = await agent("get_script", {});
  check(JSON.parse(said).cues?.some((c) => c.quote === word), `${tag}: the agent sees the bold word`, word);
  check((await page.eval(`document.querySelectorAll("#cueGroup .menu-action").length`)) === 0, `${tag}: the menu has no bold switches`);
  await page.click("#docInfo");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await sleep(400);
  await page.shot("bold-menu");
  check(await page.eval(`!!document.querySelector("#boldFg").offsetParent && !!document.querySelector("#boldBg").offsetParent && document.querySelector("#boldReset").hidden`), `${tag}: the menu shows the two colours, no Reset yet`);
  const shown = () => page.eval(`document.querySelector("#boldFg").value + " " + document.querySelector("#boldBg").value`);
  check((await shown()) === "#fb401e #080721", `${tag}: dark mode: the fields show the orange and the page's colour`, await shown());
  await page.eval(`(() => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }; set("#boldFg", "#112233"); set("#boldBg", "#ddeeff"); })()`);
  const own = await look();
  check(own.color === "rgb(17, 34, 51)" && own.background === "rgb(221, 238, 255)", `${tag}: the person's own colours show at once`, JSON.stringify(own));
  check(!(await page.eval(`document.querySelector("#boldReset").hidden`)), `${tag}: Reset shows once a colour is chosen`);
  // Another tab of this browser follows, and is not redrawn.
  const other = await openPage(width, height, page);
  await other.send("Page.navigate", { url: `${BASE}/` });
  await other.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the second tab");
  await other.click("#emptySample");
  await other.until(`!!document.querySelector("#script .block")`, "the second tab's script");
  const scriptStyle = (prop) => other.eval(`document.querySelector("#script").style.getPropertyValue("${prop}")`);
  await other.until(`document.querySelector("#script").style.getPropertyValue("--bold-fg") === "#112233"`, "the colour in the second tab");
  check((await scriptStyle("--bold-bg")) === "#ddeeff", `${tag}: another tab opened now has the colours`);
  await page.click("#boldReset");
  await sleep(100);
  check(await other.until(`document.querySelector("#script").style.getPropertyValue("--bold-fg") === ""`, "Reset in the second tab"), `${tag}: Reset reaches another tab`);
  await send("Target.closeTarget", { targetId: other.targetId });
  const back = await look();
  check(back.color === dark.color && back.background === dark.background, `${tag}: Reset brings the orange back`, JSON.stringify(back));
  await pressKey(page, "Escape", "Escape", 27);
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await sleep(150);
  const light = await look();
  const lightOrange = await probe("oklch(52% 0.17 37)");
  await page.click("#docInfo");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await sleep(300);
  check((await shown()) === "#b53707 #fafafa", `${tag}: light mode: the fields show the orange and the page's colour`, await shown());
  await pressKey(page, "Escape", "Escape", 27);
  await sleep(150);
  check(light.color === lightOrange && light.weight === 800, `${tag}: light mode: a darker orange that reads on white`, `${JSON.stringify(light)} ${lightOrange}`);
  // A new title renames the script: its name changes and nothing on the page is redrawn.
  const name = `document.querySelector(".doc__name").textContent`, demoName = await page.eval(name);
  await page.send("Page.bringToFront");
  for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "s", code: "KeyS", modifiers: 2, windowsVirtualKeyCode: 83 });
  await page.until(`${name} !== ${JSON.stringify(demoName)}`, "the name after saving the demo into the browser", 10000);
  await sleep(300);
  const before = await page.eval(name);
  await page.eval(`scrollTo({ top: 0, behavior: "instant" }); window.__word = document.querySelector("#script [data-cue]");`);
  const titleAt = await page.eval(`(() => { const r = document.createRange(), w = document.createTreeWalker(document.querySelector("#script"), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent.includes("How to Write")) { r.selectNodeContents(n); const b = r.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; } return null; })()`);
  await clickAt(page, titleAt);
  await sleep(150);
  await page.eval(`(() => { const n = getSelection().anchorNode; getSelection().collapse(n, n.textContent.length); window.__caret = [getSelection().anchorNode]; })()`);
  await pressKey(page, "q", "KeyQ", 81, "q");
  await page.until(`${name} !== ${JSON.stringify(before)}`, "the name after the title change", 10000);
  check(await page.eval(`window.__word.isConnected && window.__word === document.querySelector("#script [data-cue]") && getSelection().anchorNode === window.__caret[0]`), `${tag}: a rename redraws nothing: the word and the caret stay`);
  await page.close();
  // A colour chosen before bold's settings went: it stays when "own" was on.
  const { page: older } = await openDemo(width, height);
  await older.eval(`localStorage.setItem("script-editor:boldStyle", JSON.stringify({ own: true, color: "#112233" }))`);
  await older.send("Page.reload");
  await sleep(300);
  await older.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the start screen");
  await older.click("#emptySample");
  await older.until(`!!document.querySelector("#script .block")`, "the script");
  await doubleClick(older, await older.eval(wordSpot));
  await older.until(`!document.querySelector("#boldBtn").hidden`, "the B button");
  await older.click("#boldBtn");
  await older.until(`!!document.querySelector("#script [data-cue]")`, "the bold word");
  check((await older.eval(`getComputedStyle(document.querySelector("#script [data-cue] .md-link__words")).color`)) === "rgb(17, 34, 51)", `${tag}: an older colour choice stays when "own" was on`);
  await older.close();
}

// Bold's own rules with real keys: an edit that would turn a bold line into another kind of block is refused and the marks stay
// (the line keeps its words in the spoken text); a stretch alone on its line, its words deleted outer ones first, leaves no marks.
async function runBoldRefuses(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(width, height);
  const script = async () => JSON.parse(await agent("get_script", {}));
  const press = async (key, code, vk, modifiers = 0, text) => { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers, ...(text && type === "keyDown" ? { text } : {}) }); await sleep(250); };
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  const first = `[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank page."))`;
  const addLine = async (line) => {
    await page.eval(`(() => { const el = ${first}; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
    await sleep(150);
    await press("Enter", "Enter", 13, 0, "\r");
    await page.send("Input.insertText", { text: line });
    await sleep(350);
  };
  const pickIn = (line, from, to) => `(() => { const el = [...document.querySelectorAll('#script .block')].find((x) => x.textContent === ${JSON.stringify(line)}); if (!el) throw new Error("the line is not there: " + ${JSON.stringify(line)}); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) nodes.push(n); const point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }; const r = document.createRange(); r.setStart(...point(${from})); r.setEnd(...point(${to})); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`;
  for (const [line, word, how] of [["**Note** - more", "Note", "Backspace"], ["**y**- z", "y", "Backspace"], ["**Memo** - less", "Memo", "paste"]]) {
    await addLine(line);
    const words = (await script()).words;
    check((await script()).markdown.split("\n").includes(line), `${tag}: ${line}: it is in the script`);
    const from = how === "paste" ? 0 : line.indexOf(word), to = line.indexOf(word) + word.length;
    await page.eval(pickIn(line, from, to));
    await sleep(250);
    if (how === "paste") {
      await page.eval(`(() => { const d = new DataTransfer(); d.setData("text/plain", "**"); document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })); })()`);
      await sleep(300);
    } else await press("Backspace", "Backspace", 8);
    const now = await script();
    check(now.markdown.split("\n").includes(line) && now.words === words, `${tag}: ${line}: ${how} over ${word} is refused, the line stays as it was`, now.markdown.split("\n").filter((l) => /more|less|- z/.test(l)).join(" | "));
  }
  await addLine("**one two three**");
  const wordsBefore = (await script()).words;
  for (const word of ["one", "three", "two"]) {
    const line = (await script()).markdown.split("\n").find((l) => l.includes(word) && /^\s*\*\*/.test(l) && !/Note|Memo|\*\*y/.test(l));
    const from = line.indexOf(word);
    await page.eval(pickIn(line, from, from + word.length));
    await sleep(250);
    await press("Backspace", "Backspace", 8);
  }
  const after = await script();
  check(!after.markdown.split("\n").some((l) => /^\s*\*\*\s*\*\*\s*$/.test(l) || /\*\*(one|two|three)/.test(l)), `${tag}: a stretch alone on its line, outer words deleted first: no marks left`, after.markdown.split("\n").filter((l) => /^\s*\*\*/.test(l)).join(" | "));
  check(after.words === wordsBefore - 3, `${tag}: only those three words went`, `${after.words} ${wordsBefore}`);
  await page.close();
}

// Very wide: the same rules, and the storyboard's bar lines up with the storyboard.
async function runWide(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(width, height);
  const hasBar = `!!document.querySelector("#imagesAll .keep")`;
  await agent("sketch_shot", { shotId: "B1", svg: drawing(1) });
  await page.until(`!!document.querySelector('#script .frame__img[data-pending]')`, "the first picture");
  // The selection bar follows the text down when the row comes, so it can't sit on the selected words.
  await doubleClick(page, await page.eval(wordSpot));
  await page.until(`!document.querySelector("#editBar").hidden`, "the selection bar");
  const barGap = `document.querySelector("#editBar").getBoundingClientRect().top - getSelection().getRangeAt(0).getClientRects()[0].top`;
  const gapWas = await page.eval(barGap);
  await agent("sketch_shot", { shotId: "B2", svg: drawing(2) });
  await page.until(hasBar, "the bar over the script");
  const gapNow = await page.eval(barGap);
  check(Math.abs(gapNow - gapWas) <= 1, `${tag}: the selection bar follows the text down when the row comes`, `${gapWas} ${gapNow}`);
  await page.eval(`getSelection().removeAllRanges()`);
  await noCover(page, tag);
  await pressBar(page, "undo");
  await page.until(`!${hasBar} && !document.querySelector('#script .frame__bar .keep')`, "after Undo all");
  check(!(await page.eval(`!!document.querySelector('#script .frame__img[data-pending]')`)), `${tag}: Undo all takes both pictures away`);
  await page.click(`#viewSwitch [data-view="board"]`);
  await page.until(`!document.querySelector("#board").hidden`, "the storyboard");
  await agent("sketch_shot", { shotId: "B1", svg: drawing(1) });
  await agent("sketch_shot", { shotId: "B2", svg: drawing(2) });
  await page.until(hasBar, "the bar");
  await sleep(500); // the bar animates in, sideways
  const r = await page.eval(`(() => { const a = document.querySelector("#imagesAll .change__bar").getBoundingClientRect(), g = document.querySelector("#board .board__grid").getBoundingClientRect(); return { bar: a.right, grid: g.right }; })()`);
  check(Math.abs(r.bar - r.grid) <= 1, `${width} px: the storyboard's bar ends where the storyboard ends`, JSON.stringify(r));
  await page.shot(`${width}-board`);
  await pressBar(page, "keep");
  await page.until(`!${hasBar} && !document.querySelector('#board .frame__bar .keep')`, "after Keep all");
  check(await page.eval(`document.querySelector('#board .frame[data-b="B2"] .frame__img').innerHTML.includes('cx="80"')`), `${tag}: Keep all puts them in`);
  await page.close();
}

async function run(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(width, height);

  const bar = `document.querySelector("#imagesAll")`;
  const noBar = `!${bar}.firstChild`;
  const shown = () => page.eval(`${noBar} ? "" : ${bar}.querySelector(".change__what").textContent`);
  const barIs = (text, label) => page.until(`(${noBar} ? "" : ${bar}.querySelector(".change__what").textContent) === ${JSON.stringify(text)}`, label);
  const waitingCount = `document.querySelectorAll('#script .frame__bar .keep').length`;
  const pendingPic = (id) => `!!document.querySelector('#script .shot-frame__jump[data-b="${id}"] .frame__img[data-pending]')`;
  const picOf = (id) => page.eval(`document.querySelector('#script .shot-frame__jump[data-b="${id}"] .frame__img')?.innerHTML || ""`);

  // Pictures come in: the buttons appear only at the second one.
  await agent("sketch_shot", { shotId: "B1", svg: drawing(1) });
  await page.until(pendingPic("B1"), "the first drawing waits");
  check((await shown()) === "", `${tag}: one picture waiting, no Keep all`);
  // A menu over the text follows it down when the row comes, so it can't sit on the words being edited.
  const menuSpot = await page.eval(wordSpot);
  check(!!menuSpot, `${tag}: a paragraph to open the menus on`);
  await clickAt(page, menuSpot);
  await sleep(150);
  await page.eval(`(() => { const n = getSelection().anchorNode; getSelection().collapse(n, n.textContent.length); })()`);
  await pressKey(page, " ", "Space", 32, " ");
  await pressKey(page, "/", "Slash", 191, "/");
  const slashOpen = await page.until(`!document.querySelector("#slashMenu").hidden`, "the / menu", 2000);
  const slashGap = `document.querySelector("#slashMenu").getBoundingClientRect().top - getSelection().getRangeAt(0).getClientRects()[0].bottom`;
  await sleep(300); // it animates open
  const gapWas = await page.eval(slashGap);
  await agent("sketch_shot", { shotId: "B2", svg: drawing(2) });
  check(await barIs("2 images", "two pictures"), `${tag}: two pictures waiting, Keep all shows`);
  const gapNow = await page.eval(slashGap);
  check(slashOpen && Math.abs(gapNow - gapWas) <= 1, `${tag}: the "/" menu follows the text down when the row comes`, `${gapWas} ${gapNow}`);
  await pressKey(page, "Escape", "Escape", 27);
  await pressKey(page, "Backspace", "Backspace", 8);
  await pressKey(page, "Backspace", "Backspace", 8);
  await page.eval(`getSelection().removeAllRanges()`);
  check(await page.eval(`scrollY === 0 && ${bar}.querySelector(".change__bar").getBoundingClientRect().bottom <= document.querySelector("#script .line").getBoundingClientRect().top`), `${tag}: at the top of the page the bar has its own row, above the text`);
  check((await page.eval(`${bar}.querySelector(".keep").textContent`)) === "Keep all", `${tag}: the button says Keep all`);
  check((await page.eval(`${bar}.querySelector(".undo").textContent`)) === "Undo all", `${tag}: the button says Undo all`);
  await page.eval(`${bar}.querySelector(".keep").focus()`);
  await agent("sketch_shot", { shotId: "B3", svg: drawing(3) });
  check(await barIs("3 images", "three pictures"), `${tag}: the count follows`);
  check(await page.eval(`document.activeElement === ${bar}.querySelector(".keep") && document.activeElement.getAttribute("aria-label") === "Keep all 3 images"`), `${tag}: the keyboard stays on Keep all when another picture comes, and its label follows`);

  // It fits, in its own row at the top of the page.
  const fit = () => page.eval(`(() => { const r = ${bar}.querySelector(".change__bar").getBoundingClientRect(), t = document.querySelector(".top").getBoundingClientRect(), l = document.querySelector(".toc").getBoundingClientRect(), stuck = getComputedStyle(document.querySelector(".toc")).position === "sticky"; return { left: r.left, right: r.right, top: r.top, under: r.top >= (stuck ? l.bottom : t.bottom), wide: document.documentElement.scrollWidth, view: innerWidth }; })()`);
  const f = await fit();
  check(f.left >= 0 && f.right <= f.view && f.wide <= f.view, `${tag}: it fits the width, nothing scrolls sideways`, JSON.stringify(f));
  check(f.under, `${tag}: it is under the top bar and the section list`, JSON.stringify(f));
  await page.shot(`${width}-script-top`);
  const press = await page.eval(`(() => { const r = ${bar}.querySelector(".keep").getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("button")?.dataset.act || ""; })()`);
  check(press === "keep-all", `${tag}: nothing covers the button`, press);

  // The bar never covers the words being edited, on any kind of edit.
  await noCover(page, tag);

  // Scrolled down it has gone with the page.
  await page.eval(`scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" })`);
  await sleep(120);
  check(await page.eval(`${bar}.querySelector(".change__bar").getBoundingClientRect().bottom <= document.querySelector(".top").getBoundingClientRect().bottom`), `${tag}: at the end of the script it has scrolled away with the page`);
  await page.shot(`${width}-script-end`);
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);

  // Large text: the whole bar can still be reached.
  await page.eval(`document.documentElement.style.fontSize = "200%"`);
  await sleep(100);
  const big = await page.eval(`(() => { const parts = [...${bar}.querySelectorAll(".change__what, button")].map((e) => e.getBoundingClientRect()); return { left: Math.min(...parts.map((r) => r.left)), right: Math.max(...parts.map((r) => r.right)), view: document.documentElement.clientWidth }; })()`);
  check(big.left >= 0 && big.right <= big.view, `${tag}: with large text every part of the bar is on screen`, JSON.stringify(big));
  await page.shot(`${width}-large-text`);
  await page.eval(`document.documentElement.style.fontSize = ""`);
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  await sleep(100);

  // Single Keep and Undo still work and count down.
  await page.click(`#script .frame__bar .keep[data-b="B1"]`);
  check(await barIs("2 images", "after one Keep"), `${tag}: one kept by itself, the count goes down`);
  const lineAt = `document.querySelector("#script .line").getBoundingClientRect().top + scrollY`;
  const lineWas = await page.eval(lineAt);
  await page.click(`#script .frame__bar .undo[data-b="B2"]`);
  await page.until(`${noBar}`, "after one Undo");
  check((await shown()) === "", `${tag}: one picture left, Keep all goes`);
  const lineNow = await page.eval(lineAt);
  check(lineNow === lineWas, `${tag}: the text doesn't jump when the bar goes`, `${lineWas} ${lineNow}`);
  await page.click(`#script .frame__bar .undo[data-b="B3"]`);
  await page.until(`${waitingCount} === 0`, "the last one undone");

  // Undo all: every waiting picture goes, what the shot had stays.
  const before = await picOf("B4");
  for (const id of ["B4", "B5", "B6"]) await agent("sketch_shot", { shotId: id, svg: drawing(Number(id[1])) });
  await barIs("3 images", "three again");
  await pressBar(page, "undo");
  await page.until(`${waitingCount} === 0 && ${noBar}`, "after Undo all");
  check(!(await page.eval(pendingPic("B4"))) && (await picOf("B4")) === before, `${tag}: Undo all takes the pictures away, the shot's earlier sketch stays`);

  // Keep all: every waiting picture is written; the caret stays; one Ctrl+Z does not take them out (like a single Keep).
  for (const id of ["B4", "B5", "B6"]) await agent("sketch_shot", { shotId: id, svg: drawing(Number(id[1]) + 3) });
  await barIs("3 images", "three again");
  await page.eval(`(() => { const t = document.querySelector("#script p, #script [data-id]"); getSelection().collapse(t.firstChild?.nodeType === 3 ? t.firstChild : t, 1); })()`);
  const caret = `(() => { const s = getSelection(); return s.anchorNode?.textContent?.slice(0, 20) + " @" + s.anchorOffset; })()`;
  const at = await page.eval(caret);
  await pressBar(page, "keep");
  await page.until(`${waitingCount} === 0 && ${noBar}`, "after Keep all");
  check((await page.eval(caret)) === at, `${tag}: the caret stays where it was`);
  const kept = await Promise.all(["B4", "B5", "B6"].map(picOf));
  check(kept.every((p, i) => p.includes(`cx="${40 + (i + 7) * 20}"`)), `${tag}: Keep all puts all three in`, kept.join(" ").slice(0, 200));
  const listed = () => agent("get_script", {});
  check((await listed()).includes("B4"), `${tag}: the agent still reads the list`);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
  await sleep(150);
  check((await picOf("B5")).includes(`cx="${40 + 8 * 20}"`), `${tag}: Ctrl+Z after Keep all leaves the pictures in, as after a single Keep`);

  // A write that fails: each picture says so, the bar comes back, and Keep all can try again.
  for (const id of ["B4", "B5"]) await agent("sketch_shot", { shotId: id, svg: drawing(Number(id[1]) + 5) });
  await barIs("2 images", "two to fail");
  await page.eval(`(() => { window.__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new Error("no room"); }; })()`);
  await pressBar(page, "keep");
  check(await page.until(`document.querySelectorAll('#script .frame__problem').length === 2 && !!${bar}.firstChild`, "the failed writes"), `${tag}: a failed write shows Not saved on each picture and the bar comes back`);
  await page.eval(`IDBObjectStore.prototype.put = window.__put`);
  await pressBar(page, "keep");
  await page.until(`${waitingCount} === 0 && ${noBar}`, "the second try");
  check((await picOf("B5")).includes(`cx="${40 + 10 * 20}"`) && (await page.eval(`document.querySelectorAll('#script .frame__problem').length`)) === 0, `${tag}: Keep all again puts them in`);
  await agent("sketch_shot", { shotId: "B5", svg: drawing(8) });
  await page.until(pendingPic("B5"), "B5 once more");
  await page.click(`#script .frame__bar .keep[data-b="B5"]`);
  await page.until(`${waitingCount} === 0`, "B5 kept");

  // Pictures put in at once carry only Undo; they count too.
  const png = await page.eval(`(() => { const c = document.createElement("canvas"); c.width = 400; c.height = 220; const g = c.getContext("2d"); g.fillStyle = "#274"; g.fillRect(0, 0, 400, 220); return c.toDataURL("image/png").split(",")[1]; })()`);
  const put = async (shotId) => {
    const info = JSON.parse(await agent("upload_image", {}));
    const res = await fetch(info.url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: Buffer.from(png, "base64") });
    const { imageId } = await res.json();
    await agent("sketch_shot", { shotId, imageId });
  };
  const marks = `document.querySelectorAll('#script [data-act="mark-undo"]').length`;
  const b7 = await picOf("B7"), b8 = await picOf("B8");
  await put("B7");
  await page.until(`${marks} === 1`, "one picture in at once");
  check((await shown()) === "", `${tag}: one picture in at once, no Keep all`);
  await put("B8");
  check(await barIs("2 images", "two in at once"), `${tag}: two pictures in at once, Keep all shows`);
  await page.shot(`${width}-pictures`);
  await pressBar(page, "undo");
  await page.until(`${marks} === 0 && ${noBar}`, "after Undo all of pictures");
  check((await picOf("B7")) === b7 && (await picOf("B8")) === b8, `${tag}: Undo all puts back what those shots had`);
  await put("B7");
  await put("B8");
  await barIs("2 images", "two in at once again");
  await pressBar(page, "keep");
  await page.until(`${marks} === 0 && ${noBar}`, "after Keep all of pictures");
  const stays = await picOf("B7");
  check(stays.includes("<img") && !(await page.eval(pendingPic("B7"))), `${tag}: Keep all leaves the pictures in, without their mark and Undo`);
  check(await page.eval(`!!document.querySelector('#script .shot-frame__jump[data-b="B7"]').closest(".shot-frame[data-drag]")`), `${tag}: the shot can be dragged again`);

  // A mix, with a suggestion that has no picture: that one keeps its own Keep and Undo.
  await agent("answer_broll", { changes: [
    { op: "add", kind: "broll", what: "New shot one", how: "Stock", quote: "So, three things.", sketch: drawing(1) },
    { op: "add", kind: "broll", what: "New shot two", how: "Stock", quote: "A backup is a spare key.", sketch: drawing(2) },
    { op: "update", id: "B1", what: "New words for B1" },
  ] });
  await agent("sketch_shot", { shotId: "S1", svg: drawing(9) });
  check(await barIs("3 images", "mix"), `${tag}: suggested adds and a waiting picture count together; words without a picture do not`);
  await page.shot(`${width}-mix`);
  const sugg = `document.querySelectorAll('#script .shot-frame[data-suggested]').length`;
  await pressBar(page, "keep");
  await page.until(`${sugg} === 0 && ${waitingCount} === 0 && ${noBar}`, "after Keep all of the mix");
  check(await page.eval(`document.querySelector('#script .suggest[data-op="update"] .keep') !== null`), `${tag}: the suggestion without a picture still waits`);
  check((await picOf("S1")).includes(`cx="${40 + 9 * 20}"`), `${tag}: the mix's waiting picture is in`);
  const script = await listed();
  check(script.includes("New shot one") && script.includes("New shot two"), `${tag}: the mix's suggested adds are in the list`);
  await page.click(`#script .suggest[data-op="update"] .undo`);

  // The storyboard: the same buttons, clear of the storyboard's own bar.
  await page.click(`#viewSwitch [data-view="board"]`);
  await page.until(`!document.querySelector("#board").hidden`, "the storyboard");
  await agent("sketch_shot", { shotId: "B1", svg: drawing(2) });
  await agent("sketch_shot", { shotId: "B2", svg: drawing(3) });
  check(await barIs("2 images", "storyboard"), `${tag}: Keep all shows in the storyboard`);
  const clear = await page.eval(`(() => { const a = ${bar}.querySelector(".change__bar").getBoundingClientRect(), b = document.querySelector(".board__bar").getBoundingClientRect(); return { a: a.bottom, b: b.top, wide: document.documentElement.scrollWidth, view: innerWidth }; })()`);
  check(clear.a <= clear.b + 1 && clear.wide <= clear.view, `${tag}: it is clear of the storyboard's bar`, JSON.stringify(clear));
  await page.shot(`${width}-board`);
  // By keyboard: the focus doesn't fall back to the top of the page when the bar goes.
  await page.eval(`${bar}.querySelector(".keep").focus()`);
  for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
  await page.until(`${noBar} && !document.querySelector('#board .frame__bar .keep')`, "after Keep all in the storyboard");
  check(await page.eval(`document.activeElement === document.querySelector('#viewSwitch [aria-pressed="true"]')`), `${tag}: Keep all by keyboard leaves the focus on the view switch`);
  check(await page.eval(`document.querySelector('#board .frame[data-b="B2"] .frame__img').innerHTML.includes('cx="100"')`), `${tag}: Keep all in the storyboard puts them in`);
  await page.click(`#viewSwitch [data-view="script"]`);

  // The storyboard's frames stay put from two pictures to one and to none; the empty row goes with the view.
  await page.click(`#viewSwitch [data-view="board"]`);
  await page.until(`!document.querySelector("#board").hidden`, "the storyboard again");
  await agent("sketch_shot", { shotId: "B1", svg: drawing(7) });
  await agent("sketch_shot", { shotId: "B2", svg: drawing(8) });
  await barIs("2 images", "two for the jump check");
  const frameAt = `document.querySelector("#board .board__grid").getBoundingClientRect().top + scrollY`;
  const frameWas = await page.eval(frameAt);
  await page.click(`#board .frame__bar .undo[data-b="B1"]`);
  await page.until(`${noBar}`, "two to one");
  const frameNow = await page.eval(frameAt);
  check(frameNow === frameWas, `${tag}: the frames don't jump when two pictures become one`, `${frameWas} ${frameNow}`);
  await page.click(`#board .frame__bar .undo[data-b="B2"]`);
  await page.until(`!document.querySelector('#board .frame__bar .keep')`, "one to none");
  check((await page.eval(frameAt)) === frameWas, `${tag}: nor when the last one goes`);
  await page.click(`#viewSwitch [data-view="script"]`);
  await page.until(`document.querySelector("#board").hidden`, "back to the script");
  check(await page.eval(`${bar}.hidden`), `${tag}: the empty row goes with the view`);

  // Back from the storyboard the text is where it was, though the row went while the person was away.
  await agent("sketch_shot", { shotId: "B1", svg: drawing(2) });
  await agent("sketch_shot", { shotId: "B2", svg: drawing(3) });
  await barIs("2 images", "two for the way back");
  await page.eval(`scrollTo({ top: 300, behavior: "instant" })`);
  await sleep(60);
  const screenAt = `document.querySelector("#script .line").getBoundingClientRect().top`;
  const screenWas = await page.eval(screenAt);
  await page.eval(`document.querySelector('#viewSwitch [data-view="board"]').click()`); // no scrolling to the button first
  await page.until(`!document.querySelector("#board").hidden`, "the storyboard for the way back");
  await pressBar(page, "keep");
  await page.until(`${noBar} && !document.querySelector('#board .frame__bar .keep')`, "Keep all for the way back");
  await page.eval(`document.querySelector('#viewSwitch [data-view="script"]').click()`);
  await page.until(`document.querySelector("#board").hidden`, "the script again");
  await sleep(100);
  const screenNow = await page.eval(screenAt);
  // On a phone width the section chip's own scrollIntoView (renderToc, not this feature) nudges the page by about 8 px.
  check(Math.abs(screenNow - screenWas) <= (width < 500 ? 9 : 1), `${tag}: back from the storyboard, the text is where it was`, `${screenWas} ${screenNow}`);
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);

  // Back to the very top after the row came while away: the page is at the top, the whole bar in sight.
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  await page.until(`${bar}.hidden`, "no row before leaving");
  await page.eval(`document.querySelector('#viewSwitch [data-view="board"]').click()`);
  await page.until(`!document.querySelector("#board").hidden`, "the storyboard, row to come");
  await agent("sketch_shot", { shotId: "B1", svg: drawing(4) });
  await agent("sketch_shot", { shotId: "B2", svg: drawing(5) });
  await barIs("2 images", "the row while away");
  await page.eval(`document.querySelector('#viewSwitch [data-view="script"]').click()`);
  await page.until(`document.querySelector("#board").hidden`, "the script, row come");
  await sleep(100);
  const topBack = await fit();
  check((await page.eval(`scrollY`)) === 0 && topBack.under, `${tag}: back to the very top, the whole bar is in sight`, JSON.stringify(topBack));
  await pressBar(page, "undo");
  await page.until(`${noBar}`, "after Undo all at the top");

  // Only what is in sight counts: a shot whose line is gone over the script, a shot the filter hides in the storyboard.
  const text = JSON.parse(await listed()).markdown;
  check(text.includes("So, three things."), `${tag}: the line for B8 is in the script`);
  await agent("set_script", { markdown: text.replace("So, three things.", "") });
  await page.until(`!document.querySelector('#script .shot-frame__jump[data-b="B8"]')`, "B8 without a line");
  for (const id of ["B7", "B8", "S2"]) await agent("sketch_shot", { shotId: id, svg: drawing(4) });
  check(await barIs("2 images", "script count"), `${tag}: over the script, a picture for a shot without a line doesn't count`);
  await page.click(`#viewSwitch [data-view="board"]`);
  check(await barIs("3 images", "board count"), `${tag}: in the storyboard, where that shot is listed, it does`);
  await page.click(`#board [data-filter="screen"]`);
  await page.until(`${noBar}`, "a filter leaves one");
  check((await shown()) === "", `${tag}: a filter that leaves one picture in sight takes the bar away`);
  await page.click(`#board [data-filter="all"]`);
  await barIs("3 images", "all again");
  await pressBar(page, "undo");
  await page.until(`${noBar} && !document.querySelector('#board .frame__bar .keep')`, "after Undo all in the storyboard");
  await page.click(`#viewSwitch [data-view="script"]`);
  await agent("set_script", { markdown: text });

  // Kept means written: they are there when the demo is opened again after a reload (its list is kept in the browser).
  await page.until(`${noBar}`, "the last write");
  await sleep(300);
  await page.send("Page.reload");
  await sleep(300);
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the start screen after a reload");
  await page.click("#emptySample");
  await page.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the script after a reload", 12000);
  check((await picOf("B6")).includes(`cx="${40 + 9 * 20}"`) && (await picOf("B2")).includes('cx="100"'), `${tag}: pictures kept with Keep all are there after a reload`);
  check((await shown()) === "", `${tag}: nothing waits after a reload`);

  // A guest in a shared script sees the pictures but no bar: the host keeps or undoes them.
  if (width > 500) {
    await page.eval(`Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__link = t; } } })`);
    await page.click("#shareBtn");
    await page.until(`!!window.__link`, "the share link");
    const link = await page.eval(`window.__link`);
    const guest = await openPage(width, height);
    await guest.send("Page.navigate", { url: link });
    await guest.until(`!document.querySelector("#joinForm").hidden`, "the Join form");
    await guest.eval(`document.querySelector("#joinName").value = "Guest"`);
    await guest.click("#joinForm button");
    await guest.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the guest's script", 12000);
    await agent("sketch_shot", { shotId: "B1", svg: drawing(5) });
    await agent("sketch_shot", { shotId: "B2", svg: drawing(6) });
    check(await barIs("2 images", "the host"), `${tag}: the host has the bar`);
    check(await guest.until(`document.querySelectorAll("#script .frame__img[data-pending]").length >= 2`, "the guest sees the pictures", 12000), `${tag}: the guest sees the pictures`);
    check(await guest.eval(`document.querySelector("#imagesAll").hidden`), `${tag}: the guest has no bar`);
    // The guest marks a repeated word: the host's open ask stays on its own word, by offsets, not the nearest copy.
    const paraOf = `[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank page."))`;
    await page.eval(`(() => { const el = ${paraOf}; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
    await page.send("Input.insertText", { text: " no no no" });
    check(await guest.until(`${paraOf}.textContent.endsWith("no no no")`, "the guest gets the words"), `${tag}: the guest gets the words`);
    // The words from the end of the line, across the text pieces an ask's mark cuts it into.
    const pick = (fromEnd, len = 2) => `(() => { const el = ${paraOf}, w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n, total = 0; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) { nodes.push(n); total += n.data.length; } const point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }; const from = total - ${fromEnd}, r = document.createRange(); r.setStart(...point(from)); r.setEnd(...point(from + ${len})); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`;
    await page.eval(pick(5));
    await sleep(300);
    await page.click(`#editBar [data-act="shorter"]`);
    check(await page.until(`!!${paraOf}.querySelector("[data-ask]")`, "the host's ask"), `${tag}: the host has an ask on the second word`);
    // The ask reaches the guest over the network and redraws the line, so the guest selects once it has arrived.
    check(await guest.until(`!!${paraOf}.querySelector("[data-ask]")`, "the host's ask reaches the guest"), `${tag}: the host's ask reaches the guest`);
    await sleep(300);
    await guest.eval(pick(8));
    check(await guest.until(`!document.querySelector("#boldBtn").hidden && !document.querySelector("#boldBtn").disabled`, "the guest's B button"), `${tag}: the guest has the B button`);
    await guest.click("#boldBtn");
    check(await page.until(`${paraOf}.textContent.includes("**no** ")`, "the guest's bold reaches the host"), `${tag}: the guest's bold reaches the host as text`);
    check(await page.eval(`(() => { const el = ${paraOf}, d = el.querySelector("[data-ask]"), r = document.createRange(); r.setStart(el, 0); r.setEndBefore(d); return r.toString().endsWith("**no** ") && d.textContent.startsWith("no"); })()`), `${tag}: the host's ask stays on its own word`);
    // A guest typing inside the host's ask closes it; the ask does not jump to a later copy of its words (fleet #29).
    await sleep(300);
    await guest.eval(`(() => { const el = ${paraOf}, t = el.querySelector("[data-ask]")?.firstChild; if (!t) throw new Error("no ask text on the guest's page"); el.focus(); getSelection().setBaseAndExtent(t, 1, t, 1); })()`);
    await sleep(200);
    await guest.send("Input.insertText", { text: "x" });
    check(await page.until(`!${paraOf}.querySelector("[data-ask]")`, "the ask closed", 8000), `${tag}: a guest typing inside the host's ask closes it, it does not jump to another copy of its words`);
    // A guest's Enter inside a new ask of the host's closes it too (a split), and no ask is left on another "no".
    await page.eval(pick(2));
    await sleep(300);
    await page.click(`#editBar [data-act="shorter"]`);
    check(await page.until(`!!${paraOf}.querySelector("[data-ask]")`, "the host's second ask"), `${tag}: the host has a second ask on the last word`);
    check(await guest.until(`!!${paraOf}.querySelector("[data-ask]")`, "the second ask reaches the guest"), `${tag}: the second ask reaches the guest`);
    await sleep(300);
    await guest.eval(`(() => { const el = ${paraOf}, t = el.querySelector("[data-ask]")?.firstChild; if (!t) throw new Error("no ask text on the guest's page"); el.focus(); getSelection().setBaseAndExtent(t, 1, t, 1); })()`);
    await sleep(200);
    await pressKey(guest, "Enter", "Enter", 13, "\r");
    const closedAfterEnter = await page.until(`![...document.querySelectorAll('#script .block[data-type="para"] [data-ask]')].length`, "the ask closed after Enter", 8000);
    check(closedAfterEnter, `${tag}: a guest pressing Enter inside the host's ask closes it, no ask jumps to another copy`, closedAfterEnter ? "" : JSON.stringify({ host: await page.eval(`[...document.querySelectorAll('#script .block[data-type="para"] [data-ask]')].map((x) => x.parentElement.textContent.slice(-60) + " / " + x.outerHTML.slice(0, 200))`), guest: await guest.eval(`[...document.querySelectorAll("#script .block")].filter((x) => x.textContent.includes("no")).map((x) => x.textContent.slice(-40))`) }));
    // The guest's page follows the host's: the closed asks are gone there too.
    check(await guest.until(`![...document.querySelectorAll('#script .block[data-type="para"] [data-ask]')].length`, "the asks closed on the guest's page"), `${tag}: the closed asks are gone on the guest's page too`);
    await guest.close();
  }
  await page.close();
}

const only = process.env.SMOKE_ONLY;
try {
  if (only === "guest") {
    await run(1280, 800);
  } else if (only === "menu") {
    await runMenuHeight(1280, 420);
    await runMenuHeight(390, 480);
  } else if (only === "refusals") {
    await runBoldRefuses(1280, 800);
    await runBoldKinds(1280, 800);
  } else if (only === "look") {
    await runBoldLook(1280, 800);
  } else if (only === "exports") {
    await runExports(1280, 800);
    await runExports(390, 760);
  } else {
    await run(1280, 800);
    await run(390, 760);
    await runWide(1920, 1000);
    await runBold(1280, 800);
    await runBold(390, 760);
    await runBoldKeys(1280, 800);
    await runBoldKeys(390, 760);
    await runBoldLook(1280, 800);
    await runBoldRefuses(1280, 800);
    await runBoldKinds(1280, 800);
    await runMenuHeight(1280, 420);
    await runMenuHeight(390, 480);
    await runExports(1280, 800);
    await runExports(390, 760);
  }
} catch (e) {
  check(false, `stopped: ${e.message}`, e.stack?.split("\n").slice(1, 3).join(" "));
}
cdp.close();
console.log(failures ? `RESULT: fail ${failures} checks` : "RESULT: ok");
process.exit(failures ? 1 : 0);
