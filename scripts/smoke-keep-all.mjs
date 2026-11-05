#!/usr/bin/env node
// Browser check for step Q: "Keep all" and "Undo all" for the agent's pictures, at 1280, 390 and 1920 px; and that bold marking (step P)
// stays off until it is switched on. It also runs against the live site after a deploy: it sends only test data, through this browser.
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

// Bold marking (step P) is off by default: no B button and Ctrl+B does nothing; switched on, B marks and shows bold.
async function runBold(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(width, height);
  const text = async () => JSON.parse(await agent("get_script", {})).markdown;
  const before = await text();
  const at = await page.eval(wordSpot);
  check(!!at, `${tag}: a word to select`);
  await doubleClick(page, at);
  check(await page.until(`!document.querySelector("#editBar").hidden`, "the selection bar"), `${tag}: selecting a word shows the selection bar`);
  check(await page.eval(`document.querySelector("#boldBtn").hidden`), `${tag}: Bold marking off (the default): no B button`);
  const ctrlB = async () => { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "b", code: "KeyB", modifiers: 2, windowsVirtualKeyCode: 66 }); await sleep(200); };
  await ctrlB();
  check((await text()) === before && (await page.eval(`document.querySelectorAll("#script [data-cue]").length`)) === 0, `${tag}: Bold marking off: Ctrl+B changes nothing`);
  await page.eval(`getSelection().removeAllRanges()`);
  await page.click("#docInfo");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await sleep(400); // it animates open
  await page.click(`#cueGroup [data-cue-set="on"]`);
  check(await page.until(`document.querySelector('#cueGroup [data-cue-set="on"]').getAttribute("aria-pressed") === "true"`, "Bold marking on"), `${tag}: Bold marking can be switched on in the file-name menu`);
  await pressKey(page, "Escape", "Escape", 27);
  await sleep(150);
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  await doubleClick(page, await page.eval(wordSpot));
  const word = await page.eval(`getSelection().toString().trim()`);
  check(await page.until(`!document.querySelector("#boldBtn").hidden`, "the B button"), `${tag}: Bold marking on: the B button shows`);
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
  const line = () => page.eval(`[...document.querySelectorAll('#script .block[data-type="para"]')].map((x) => x.dataset.id)[0] && ${paraOf}.textContent`);
  const opening = (await line()).indexOf("**");
  await page.eval(pick(opening, opening + word.length + 10));
  await sleep(300);
  await page.click(`#editBar [data-act="shorter"]`);
  check(await page.until(`!!${paraOf}.querySelector("[data-ask]")`, "an ask over the bold word"), `${tag}: an ask sits over the bold word`);
  await page.eval(pick(opening + 3, opening + 4));
  await page.eval(`(() => { const d = new DataTransfer(); d.setData("text/plain", "=*"); document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })); })()`);
  check(await page.until(`!${paraOf}.querySelector("[data-ask]")`, "the ask cancelled"), `${tag}: a paste that breaks the bold stretch inside the ask cancels it`);
  await page.close();
}

// A script's own bold settings follow it to a new name: its name changes and nothing on the page is redrawn, so the caret,
// a selection, the scroll position and any text being typed stay as they are. The person's own setting stays off.
async function runRename(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(width, height);
  const name = `document.querySelector(".doc__name").textContent`;
  const drawn = `document.querySelectorAll("#script [data-cue]").length`;
  const onInMenu = `document.querySelector('#cueGroup [data-cue-set="on"]').getAttribute("aria-pressed") === "true"`;
  check((await page.eval(`localStorage.getItem("script-editor:cues")`)) === null, `${tag}: the person's own bold setting is off`);
  await agent("set_cue_settings", { on: true, forScript: true });
  await page.until(onInMenu, "the script's own bold on");
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  await doubleClick(page, await page.eval(wordSpot));
  await page.until(`!document.querySelector("#boldBtn").hidden`, "the B button to mark a word");
  await page.click("#boldBtn");
  await page.until(`${drawn} === 1`, "the marked word");
  await page.eval(`getSelection().removeAllRanges()`);
  // The same element before and after shows that nothing was redrawn.
  const hold = () => page.eval(`(() => { window.__word = document.querySelector("#script [data-cue]"); window.__title = [...document.querySelectorAll("#script .block, #script [data-id]")].find((e) => e.textContent.includes("How to Write")); })()`);
  const kept = async (what, was, extra = "") => {
    check(await page.until(`${name} !== ${JSON.stringify(was)}`, `${what}: the new name`, 10000), `${tag}: ${what}: the name changes`);
    await sleep(300);
    check((await page.eval(drawn)) === 1 && (await page.eval(onInMenu)), `${tag}: ${what}: the script keeps its own bold setting`);
    check(await page.eval(`window.__word?.isConnected && window.__word === document.querySelector("#script [data-cue]") && !!window.__title?.isConnected`), `${tag}: ${what}: nothing on the page is redrawn`);
    check((await page.eval(`localStorage.getItem("script-editor:cues")`)) === null, `${tag}: ${what}: the person's own setting is untouched`);
    if (extra) check(await page.eval(extra.test), `${tag}: ${what}: ${extra.label}`);
  };

  // The demo saved into the browser takes the title's name.
  let was = await page.eval(name);
  await hold();
  for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "s", code: "KeyS", modifiers: 2, windowsVirtualKeyCode: 83 });
  await kept("saved into the browser", was);

  // A script in the browser follows its title, with a word selected meanwhile.
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  was = await page.eval(name);
  const title = await page.eval(`(() => { const r = document.createRange(), w = document.createTreeWalker(document.querySelector("#script"), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent.includes("How to Write")) { r.selectNodeContents(n); const b = r.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; } return null; })()`);
  await clickAt(page, title);
  await sleep(150);
  await page.eval(`(() => { const n = getSelection().anchorNode; getSelection().collapse(n, n.textContent.length); })()`);
  await pressKey(page, "z", "KeyZ", 90, "z");
  await sleep(100);
  await hold();
  await doubleClick(page, await page.eval(wordSpot));
  const chosen = await page.eval(`getSelection().toString().trim()`);
  await kept("the title changed", was, { label: "the selected word stays selected", test: `getSelection().toString().trim() === ${JSON.stringify(chosen)} && ${JSON.stringify(chosen)} !== ""` });
  check(!(await page.eval(`document.querySelector("#boldBtn").hidden`)), `${tag}: the B button is still there after the rename`);
  await page.eval(`getSelection().removeAllRanges()`);

  // Storage full during a rename: the page stays as it is, and the settings aren't lost from the old name.
  was = await page.eval(name);
  await page.eval(`(() => { window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).startsWith("script-editor:cues:")) throw new Error("full"); return window.__setItem.call(this, k, v); }; })()`);
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  const titleAgain = await page.eval(`(() => { const r = document.createRange(), w = document.createTreeWalker(document.querySelector("#script"), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent.includes("How to Write")) { r.selectNodeContents(n); const b = r.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; } return null; })()`);
  await clickAt(page, titleAgain);
  await sleep(150);
  await page.eval(`(() => { const n = getSelection().anchorNode; getSelection().collapse(n, n.textContent.length); })()`);
  await pressKey(page, "y", "KeyY", 89, "y");
  await sleep(100);
  await hold();
  await kept("the title changed with storage full", was);
  check((await page.eval(`localStorage.getItem(${JSON.stringify(`script-editor:cues:${was}`)})`)) !== null, `${tag}: storage full: the settings stay under the old name`);
  await doubleClick(page, await page.eval(wordSpot));
  check(await page.until(`!document.querySelector("#boldBtn").hidden`, "the B button with storage full"), `${tag}: storage full: bold is still on for this script, the B button shows`);
  await page.eval(`Storage.prototype.setItem = window.__setItem`);
  await page.eval(`getSelection().removeAllRanges()`);

  // Save as: the file's name.
  was = await page.eval(name);
  await hold();
  await page.eval(`scrollTo({ top: 120, behavior: "instant" })`);
  await sleep(300); // on a phone the section chip's own scrollIntoView settles first
  const yWas = await page.eval(`scrollY`);
  await page.eval(`window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle("saved-as.md", { create: true })`);
  await page.eval(`document.querySelector("#saveAsAction").click()`);
  await kept("Save as", was, { label: "the page stays where it was scrolled to", test: `scrollY === ${yWas}` });

  await page.close();
}

// Undo on the agent's settings line still works once the script has a new name, and another tab isn't redrawn by the rename.
async function runUndoAndTabs(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(width, height);
  const name = `document.querySelector(".doc__name").textContent`;
  const onInMenu = `document.querySelector('#cueGroup [data-cue-set="on"]').getAttribute("aria-pressed") === "true"`;
  const pressUndo = () => page.eval(`[...document.querySelectorAll("#banner button")].find((b) => b.textContent.includes("Undo")).click()`);
  const key = (n) => `script-editor:cues:${n}`;
  const saveKeys = async () => { await page.send("Page.bringToFront"); for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "s", code: "KeyS", modifiers: 2, windowsVirtualKeyCode: 83 }); };

  await agent("set_cue_settings", { on: true, forScript: true });
  await page.until(onInMenu, "the script's own bold on");
  const was = await page.eval(name);
  await saveKeys();
  await page.until(`${name} !== ${JSON.stringify(was)}`, "the name after saving", 10000);
  await sleep(300);

  // Undo after the rename: the settings go back under the script's new name.
  const named = await page.eval(name);
  await page.until(`[...document.querySelectorAll("#banner button")].some((b) => b.textContent.includes("Undo"))`, "the Undo line after saving");
  await pressUndo();
  check(await page.until(`!(${onInMenu})`, "bold off after Undo"), `${tag}: Undo after a rename turns the script's bold off again`);
  check((await page.eval(`localStorage.getItem(${JSON.stringify(key(named))})`)) === null, `${tag}: Undo after a rename leaves no settings under the new name`);

  // A change on top of settings the script already had: Undo brings those back, under the newest name.
  await agent("set_cue_settings", { on: true, forScript: true });
  await page.until(onInMenu, "bold on again");
  await agent("set_cue_settings", { action: "camera", forScript: true });
  const before = await page.eval(name);
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  const titleAt = await page.eval(`(() => { const r = document.createRange(), w = document.createTreeWalker(document.querySelector("#script"), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent.includes("How to Write")) { r.selectNodeContents(n); const b = r.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; } return null; })()`);
  await page.send("Page.bringToFront");
  await clickAt(page, titleAt);
  await sleep(150);
  await page.eval(`(() => { const n = getSelection().anchorNode; getSelection().collapse(n, n.textContent.length); })()`);
  await pressKey(page, "q", "KeyQ", 81, "q");
  await page.until(`${name} !== ${JSON.stringify(before)}`, "the name after the title change", 10000);
  const after = await page.eval(name);
  await pressUndo();
  await sleep(200);
  const stored = JSON.parse((await page.eval(`localStorage.getItem(${JSON.stringify(key(after))})`)) || "{}");
  check(stored.on === true && stored.action !== "camera", `${tag}: Undo after a rename brings back the settings the script had`, JSON.stringify(stored));
  check((await page.eval(`localStorage.getItem(${JSON.stringify(key(before))})`)) === null, `${tag}: Undo writes nothing under the old name`);

  // Last, as a second tab takes over the agent's connection: it stays as it is when the first tab renames.
  const other = await openPage(width, height, page);
  await other.send("Page.navigate", { url: `${BASE}/` });
  await other.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the second tab");
  await other.click("#emptySample");
  await other.until(`document.querySelectorAll("#script .line").length >= 8`, "the second tab's script");
  await other.eval(`window.__line = document.querySelector("#script .line")`);
  const third = await page.eval(name);
  await page.eval(`window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle("saved-tabs.md", { create: true })`);
  await page.eval(`document.querySelector("#saveAsAction").click()`);
  const moved = await page.until(`${name} !== ${JSON.stringify(third)}`, "the name in the first tab", 10000);
  await sleep(400);
  check(moved && (await page.eval(`localStorage.getItem("script-editor:cues:saved-tabs.md")`)) !== null && (await other.eval(`window.__line.isConnected`)), `${tag}: a rename with own settings in one tab doesn't redraw another tab`);
  await send("Target.closeTarget", { targetId: other.targetId });
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
    await guest.eval(`localStorage.setItem("script-editor:cues", JSON.stringify({ on: true }))`); // this guest has Bold marking on
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
    await guest.eval(pick(8));
    check(await guest.until(`!document.querySelector("#boldBtn").hidden && !document.querySelector("#boldBtn").disabled`, "the guest's B button"), `${tag}: the guest with Bold marking on has the B button`);
    await guest.click("#boldBtn");
    check(await page.until(`${paraOf}.textContent.includes("**no** ")`, "the guest's bold reaches the host"), `${tag}: the guest's bold reaches the host as text`);
    check(await page.eval(`(() => { const el = ${paraOf}, d = el.querySelector("[data-ask]"), r = document.createRange(); r.setStart(el, 0); r.setEndBefore(d); return r.toString().endsWith("**no** ") && d.textContent.startsWith("no"); })()`), `${tag}: the host's ask stays on its own word`);
    await guest.close();
  }
  await page.close();
}

try {
  await run(1280, 800);
  await run(390, 760);
  await runWide(1920, 1000);
  await runBold(1280, 800);
  await runBold(390, 760);
  await runRename(1280, 800);
  await runRename(390, 760);
  await runUndoAndTabs(1280, 800);
} catch (e) {
  check(false, `stopped: ${e.message}`);
}
cdp.close();
console.log(failures ? `RESULT: fail ${failures} checks` : "RESULT: ok");
process.exit(failures ? 1 : 0);
