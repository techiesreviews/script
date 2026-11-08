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

// The selection bar's text input: type into it, and send with Enter.
async function barSend(page, text) {
  await page.click("#askInput");
  await page.send("Input.insertText", { text });
  await sleep(80);
  await pressKey(page, "Enter", "Enter", 13, "\r");
}

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
  await barSend(page, "shorter");
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
  await barSend(page, "shorter");
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
  await barSend(page, "shorter");
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

// The link icon and bold links (Lex 2026-11-07): right after B; on plain words it turns the input into an address field
// (placeholder https://, no explainer, no Apply or Remove buttons); Enter links, Escape goes back; a full address shows the
// words linked and the icon on; on a link it shows a broken chain with the address on hover, and a click removes it; one
// Ctrl+Z each. Bold on a link and a link in bold. Part link, part plain: grey.
async function runLinkIcon(width, height) {
  const tag = `${width} px link`, S = "Then try the free plan of WP Activity Log yourself.", URL = "https://wordpress.org/plugins/";
  const { page, agent } = await openDemo(width, height);
  const lineOf = async () => JSON.parse(await agent("get_script", {})).markdown.split("\n").find((l) => l.includes("A blank page."));
  const paraOf = `[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank page."))`;
  const pick = (from, to) => `(() => { const el = ${paraOf}, w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) nodes.push(n); const point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }; const r = document.createRange(); r.setStart(...point(${from})); r.setEnd(...point(${to})); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event("selectionchange")); })()`;
  const CTRL = 2;
  const press = async (key, code, vk, modifiers = 0) => { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers, ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}) }); await sleep(250); };
  const select = async (words) => {
    await page.eval(`getSelection().removeAllRanges()`);
    await sleep(150);
    const line = await lineOf(), i = line.lastIndexOf(words);
    await page.eval(pick(i, i + words.length));
    await sleep(350);
    return page.until(`!document.querySelector("#editBar").hidden && !document.querySelector("#linkBtn").hidden`, `the bar over "${words}"`);
  };
  const btn = (expr) => page.eval(`(() => { const b = document.querySelector("#linkBtn"); return ${expr}; })()`);
  await page.eval(`(() => { const el = ${paraOf}; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text: ` ${S}` });
  await sleep(400);
  const plain = await lineOf();
  check(plain.endsWith(S), `${tag}: the test line is in`);

  check(await select("WP Activity Log"), `${tag}: selecting words shows the bar with the link icon`);
  const place = await page.eval(`(() => { const b = document.querySelector("#boldBtn").getBoundingClientRect(), l = document.querySelector("#linkBtn").getBoundingClientRect(); return { gap: l.left - b.right, top: Math.abs(l.top - b.top) }; })()`);
  check(place.gap >= 0 && place.gap <= 8 && place.top < 2, `${tag}: the link icon sits right after B`, JSON.stringify(place));
  check((await btn(`!b.disabled && b.getAttribute("aria-pressed") === "false" && b.dataset.icon === "link"`)), `${tag}: on plain words the icon is a chain, off`);
  const buttonsBefore = await page.eval(`[...document.querySelectorAll("#editBar button")].filter((x) => x.offsetParent && !x.hidden).length`);
  await page.click("#linkBtn");
  await sleep(200);
  check(await page.eval(`document.activeElement === document.querySelector("#askInput") && document.querySelector("#askInput").placeholder === "https://" && document.querySelector("#askInput").value === ""`), `${tag}: the input becomes an address field (https://)`);
  check((await page.eval(`[...document.querySelectorAll("#editBar button")].filter((x) => x.offsetParent && !x.hidden).length`)) === buttonsBefore, `${tag}: no Apply or Remove buttons appear`);
  check(!(await page.eval(`[...document.querySelectorAll("#editBar :not(.edit-bar__sr)")].filter((x) => x.offsetParent && !x.closest(".edit-bar__sr")).map((x) => [...x.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join("")).join(" ")`)).match(/enter|escape|apply|remove|paste|address/i), `${tag}: no explainer text`);
  await page.send("Input.insertText", { text: "https://wordpress" });
  await sleep(150);
  check((await btn(`b.getAttribute("aria-pressed") === "false"`)) && !(await page.eval(`!!CSS.highlights?.has("link-preview")`)), `${tag}: half an address: not linked yet`);
  await page.send("Input.insertText", { text: ".org/plugins/" });
  await sleep(150);
  check(await btn(`b.getAttribute("aria-pressed") === "true"`), `${tag}: a full address: the icon shows on`);
  check(await page.eval(`!!CSS.highlights?.has("link-preview")`), `${tag}: a full address: the words show linked`);
  await page.shot(`link-${width}-typing`);
  check((await lineOf()) === plain, `${tag}: nothing is in the text before Enter`);
  await press("Escape", "Escape", 27);
  check((await lineOf()) === plain, `${tag}: Escape cancels: the text is unchanged`);
  check(await page.eval(`!document.querySelector("#editBar").hidden && document.querySelector("#askInput").placeholder !== "https://" && !CSS.highlights?.has("link-preview")`), `${tag}: Escape goes back to asking, the bar stays`);
  await page.click("#linkBtn");
  await sleep(150);
  await page.send("Input.insertText", { text: URL });
  await sleep(100);
  await press("Enter", "Enter", 13);
  const linked = await lineOf();
  check(linked.endsWith(`Then try the free plan of [WP Activity Log](${URL}) yourself.`), `${tag}: Enter links the words`, linked.slice(-90));
  check(await btn(`b.dataset.icon === "unlink" && b.getAttribute("aria-pressed") === "true" && b.dataset.tip === ${JSON.stringify(URL)}`), `${tag}: on a link the icon is a broken chain holding the address`);
  check(await page.eval(`document.querySelector("#askInput").placeholder !== "https://"`), `${tag}: after Enter the input asks again`);
  // The address on hover: headless Chrome has no hovering pointer, so the hover rule is read from the styles, and the same
  // look is checked for real on keyboard focus.
  const hoverRule = await page.eval(`[...document.styleSheets].flatMap((sh) => [...sh.cssRules]).some((r) => r.media && /hover: hover/.test(r.media.mediaText) && [...r.cssRules].some((x) => /edit-bar__button--link:hover::after/.test(x.selectorText) && x.style.visibility === "visible"))`);
  await page.eval(`document.querySelector("#linkBtn").focus()`);
  await sleep(100);
  const tip = await page.eval(`(() => { const s = getComputedStyle(document.querySelector("#linkBtn"), "::after"); return { v: s.visibility, c: s.content, f: document.querySelector("#linkBtn").matches(":focus-visible") }; })()`);
  check(hoverRule && tip.v === "visible" && tip.c.includes("wordpress.org"), `${tag}: the address shows on hover and on keyboard focus`, JSON.stringify({ hoverRule, ...tip }));
  await page.shot(`link-${width}-linked`);
  await page.eval(`document.querySelector("#askInput").focus()`);
  // A click removes the link: words stay; Ctrl+Z brings it back.
  await page.click("#linkBtn");
  await sleep(250);
  check((await lineOf()) === plain, `${tag}: a click on the broken chain removes the link, the words stay`);
  await page.eval(`${paraOf}.focus()`);
  await press("z", "KeyZ", 90, CTRL);
  check((await lineOf()) === linked, `${tag}: Ctrl+Z brings the link back`);
  // Bold on the whole link: a whole bold link; it shows bold and keeps its underline.
  await select("WP Activity Log");
  await page.click("#boldBtn");
  await sleep(250);
  check((await lineOf()).endsWith(`of **[WP Activity Log](${URL})** yourself.`), `${tag}: B on a link's words makes a whole bold link`, (await lineOf()).slice(-80));
  await page.eval(`getSelection().removeAllRanges()`);
  await sleep(200);
  const look = await page.eval(`(() => { const w = ${paraOf}.querySelector("[data-cue] .md-link[data-href] .md-link__words"); if (!w) return null; const s = getComputedStyle(w); return { weight: Number(s.fontWeight), line: getComputedStyle(w).textDecorationLine }; })()`);
  check(!!look && look.weight >= 600 && look.line.includes("underline"), `${tag}: a bold link shows bold and underlined`, JSON.stringify(look));
  await page.shot(`link-${width}-bold-link`);
  // Typing inside a whole bold link keeps its Markdown.
  {
    const line = await lineOf(), i = line.lastIndexOf("Activity") + 4;
    await page.eval(pick(i, i));
    await sleep(200);
    await page.send("Input.insertText", { text: "x" });
    await sleep(300);
    check((await lineOf()).endsWith(`of **[WP Actixvity Log](${URL})** yourself.`), `${tag}: typing inside a bold link keeps its marks`, (await lineOf()).slice(-80));
    await page.eval(`${paraOf}.focus()`);
    await press("z", "KeyZ", 90, CTRL);
    check((await lineOf()).endsWith(`of **[WP Activity Log](${URL})** yourself.`), `${tag}: Ctrl+Z takes the typing back`, (await lineOf()).slice(-80));
  }
  check(await select("WP Activity Log") && await btn(`b.dataset.icon === "unlink"`) && await page.eval(`document.querySelector("#boldBtn").getAttribute("aria-pressed") === "true"`), `${tag}: on a bold link both B and the link icon show on`);
  // Part link, part plain: grey.
  {
    const line = await lineOf(), i = line.lastIndexOf("of **["), j = line.indexOf("WP", i) + 2;
    await page.eval(`getSelection().removeAllRanges()`);
    await sleep(150);
    await page.eval(pick(i, j));
    await sleep(350);
    await page.until(`!document.querySelector("#editBar").hidden`, "the bar over part link, part plain");
  }
  check(await btn(`b.disabled`), `${tag}: part link, part plain: the link icon is grey`);
  // A link inside bold words.
  await select("the free plan");
  await page.click("#boldBtn");
  await sleep(250);
  await select("free");
  await page.click("#linkBtn");
  await sleep(150);
  await page.send("Input.insertText", { text: "https://example.com/free" });
  await press("Enter", "Enter", 13);
  check((await lineOf()).includes("try **the [free](https://example.com/free) plan** of"), `${tag}: a link inside bold words`, (await lineOf()).slice(-120));
  // B in the address field that makes the words part link, part not: the field has nothing left to link and closes.
  {
    const line = await lineOf(), i = line.lastIndexOf("plan**"), j = line.indexOf(" of", i) + 3;
    await page.eval(`getSelection().removeAllRanges()`);
    await sleep(150);
    await page.eval(pick(i, j));
    await sleep(350);
    await page.until(`!document.querySelector("#editBar").hidden && !document.querySelector("#linkBtn").disabled`, "the bar over plan of");
  }
  await page.click("#linkBtn");
  await sleep(150);
  await page.send("Input.insertText", { text: "https://example.com/plan" });
  await press("b", "KeyB", 66, CTRL);
  check((await lineOf()).includes("try **the [free](https://example.com/free) plan of** "), `${tag}: Ctrl+B joins the bold over the link`, (await lineOf()).slice(-120));
  check(await page.eval(`document.querySelector("#askField").dataset.mode !== "link" && document.querySelector("#askInput").value === "" && document.querySelector("#askInput").placeholder !== "https://" && document.querySelector("#linkBtn").disabled`), `${tag}: the words are part link now: the address field closes, the icon is grey`);
  await page.eval(`${paraOf}.focus()`);
  await press("z", "KeyZ", 90, CTRL);
  check((await lineOf()).includes("try **the [free](https://example.com/free) plan** of"), `${tag}: Ctrl+Z takes that bold back`, (await lineOf()).slice(-120));
  // A long address goes in whole (the asking input stops at 500 characters).
  {
    const long = "https://example.com/?q=" + "a".repeat(577);
    await select("yourself");
    await page.click("#linkBtn");
    await sleep(150);
    await page.send("Input.insertText", { text: long });
    await sleep(100);
    check((await page.eval(`document.querySelector("#askInput").value.length`)) === 600, `${tag}: a 600-character address fits in the field`);
    await press("Enter", "Enter", 13);
    check((await lineOf()).includes(`[yourself](${long})`), `${tag}: the whole long address goes in`);
    check(await page.eval(`document.querySelector("#askInput").maxLength === 500`), `${tag}: the asking input is back to 500 characters`);
    await page.eval(`${paraOf}.focus()`);
    await press("z", "KeyZ", 90, CTRL);
  }
  // Ctrl+B in the address field bolds the words and keeps what is typed; Enter then links the bold words.
  await select("yourself");
  await page.click("#linkBtn");
  await sleep(150);
  await page.send("Input.insertText", { text: "https://example.com/you" });
  await sleep(100);
  await press("b", "KeyB", 66, CTRL);
  check((await lineOf()).includes("**yourself**") && await page.eval(`document.querySelector("#askInput").value === "https://example.com/you" && document.querySelector("#askInput").placeholder === "https://" && document.querySelector("#askField").dataset.mode === "link"`), `${tag}: Ctrl+B in the address field bolds and keeps the address`, (await lineOf()).slice(-60));
  await press("Enter", "Enter", 13);
  check((await lineOf()).includes("**[yourself](https://example.com/you)**"), `${tag}: Enter then links the bold words: a whole bold link`, (await lineOf()).slice(-60));
  for (let i = 0; i < 2; i++) { await page.eval(`${paraOf}.focus()`); await press("z", "KeyZ", 90, CTRL); }
  // Undo walks back one change at a time, the words never change.
  for (let i = 0; i < 4; i++) { await page.eval(`${paraOf}.focus()`); await press("z", "KeyZ", 90, CTRL); }
  check((await lineOf()) === plain, `${tag}: the last four Ctrl+Z go back to the plain line`, (await lineOf()).slice(-80));
  await page.close();
}

// A guest links and unlinks words too; the host's script has it, and the guest's own Ctrl+Z brings it back.
async function runLinkGuest(width, height) {
  const tag = `${width} px link guest`, URL = "https://example.com/deadline";
  const { page, agent } = await openDemo(1280, 800);
  await page.eval(`Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__link = t; } } })`);
  await page.click("#shareBtn");
  await page.until(`!!window.__link`, "the share link");
  const guest = await openPage(width, height);
  await guest.send("Page.navigate", { url: await page.eval(`window.__link`) });
  await guest.until(`!document.querySelector("#joinForm").hidden`, "the Join form");
  await guest.eval(`document.querySelector("#joinName").value = "Guest"`);
  await guest.click("#joinForm button");
  await guest.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the guest's script", 12000);
  await guest.send("Page.bringToFront");
  const md = async () => JSON.parse(await agent("get_script", {})).markdown;
  const before = await md();
  await guest.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  await doubleClick(guest, await guest.eval(wordSpot));
  check(await guest.until(`!document.querySelector("#editBar").hidden && !document.querySelector("#linkBtn").hidden`, "the guest's bar"), `${tag}: the guest sees the link icon`);
  await guest.click("#linkBtn");
  await sleep(150);
  await guest.send("Input.insertText", { text: URL });
  await pressKey(guest, "Enter", "Enter", 13, "\r");
  let now = "";
  for (let i = 0; i < 40 && !now.includes(`[deadline](${URL})`); i++) { now = await md(); await sleep(100); }
  check(now.includes(`[deadline](${URL})`), `${tag}: the guest's link reaches the host's script`);
  await guest.click("#linkBtn");
  for (let i = 0; i < 40 && now !== before; i++) { now = await md(); await sleep(100); }
  check(now === before, `${tag}: the guest's click on the broken chain removes it everywhere`);
  await guest.eval(`[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank page.")).focus()`);
  for (const type of ["keyDown", "keyUp"]) await guest.send("Input.dispatchKeyEvent", { type, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
  for (let i = 0; i < 40 && !now.includes(`[deadline](${URL})`); i++) { now = await md(); await sleep(100); }
  check(now.includes(`[deadline](${URL})`), `${tag}: the guest's Ctrl+Z brings the link back`);
  await guest.close();
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
  // Without the bold colours (step U) the menu can fit a short phone window whole: then nothing needs to scroll.
  const fitsWhole = !b.scrolls && (await page.eval(`(() => { const m = ${menu}.getBoundingClientRect(), r = document.querySelector("#menuNew").getBoundingClientRect(); return r.bottom <= m.bottom + 0.5 && r.height > 0; })()`));
  check(b.overflowY === "auto" && (b.scrolls || fitsWhole), `${tag}: it scrolls inside itself when it is taller than the window, or shows all of it`, JSON.stringify(b));
  if (fitsWhole) { await pressKey(page, "Escape", "Escape", 27); await page.close(); return; }
  // With the pointer over the recent list, the wheel carries on to the menu once the list ends.
  await page.eval(`${menu}.scrollTop = 0`);
  const over = await page.eval(`(() => { const r = document.querySelector("#scriptList").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(r.height, innerHeight - r.y) / 2 }; })()`);
  for (let i = 0; i < 14; i++) { await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: over.x, y: over.y, deltaX: 0, deltaY: 300 }); await sleep(120); }
  await sleep(300);
  // The bold colours moved to B on the selection bar (Lex 2026-11-07): New script is the menu's last item now.
  const wheeled = await page.eval(`(() => { const m = ${menu}.getBoundingClientRect(), r = document.querySelector("#menuNew").getBoundingClientRect(); return { fgBottom: r.bottom, menuBottom: m.bottom, top: ${menu}.scrollTop }; })()`);
  check(wheeled.top > 0 && wheeled.fgBottom <= wheeled.menuBottom + 0.5, `${tag}: the wheel over the recent list reaches New script below it`, JSON.stringify(wheeled));
  await page.eval(`${menu}.scrollTop = ${menu}.scrollHeight`);
  await sleep(200);
  const last = await page.eval(`(() => { const m = ${menu}.getBoundingClientRect(), r = document.querySelector("#menuNew").getBoundingClientRect(); return { fgBottom: r.bottom, menuBottom: m.bottom, fgTop: r.top, menuTop: m.top, h: r.height }; })()`);
  check(last.fgBottom <= last.menuBottom + 0.5 && last.fgTop >= last.menuTop && last.h > 0, `${tag}: scrolled down, New script is in view`, JSON.stringify(last));
  check(await page.eval(`${menu}.querySelectorAll('input[type="color"]').length === 0`), `${tag}: the menu holds no colour fields`);
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

// The slim bar (step T): only the input and B; typed commands with a grey ghost; what Enter sends; what the bar never does.
async function runSlimBar(width, height) {
  const tag = `${width}x${height}`;
  const { page, agent } = await openDemo(width, height);
  const script = async () => JSON.parse(await agent("get_script", {})).markdown;
  const start = await script();
  const barOpen = `!document.querySelector("#editBar").hidden`;
  const value = `document.querySelector("#askInput").value`;
  const ghost = `document.querySelector("#askGhost b").textContent`;
  const tabOn = `document.querySelector("#askTab").dataset.on === "true"`;
  const newAsks = async () => JSON.parse(await agent("wait_for_asks", { waitSeconds: 0 })).asks;
  const selectWord = async () => {
    await page.eval(`getSelection().removeAllRanges()`);
    await sleep(200);
    await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
    await doubleClick(page, await page.eval(wordSpot));
    await page.until(barOpen, "the selection bar");
    await sleep(200);
  };
  const type = async (text) => { await page.click("#askInput"); await page.send("Input.insertText", { text }); await sleep(100); };
  const closeBar = async () => { await pressKey(page, "Escape", "Escape", 27); await sleep(150); };

  await selectWord();
  check((await page.eval(`document.querySelector("#ebLabel").textContent`)) === "1 word", `${tag}: one word selected: the bar says 1 word`);
  check(await page.eval(`[...document.querySelectorAll(".edit-bar__controls > button")].map((b) => b.id).join() === "boldBtn,linkBtn"`), `${tag}: the bar's only buttons outside the input are B and the link icon (step V)`);
  // Before the input in reading order: on its left, or (on a phone, where the field keeps its 200 px) on the row above.
  check(await page.eval(`(() => { const f = document.querySelector("#askForm").getBoundingClientRect(), b = document.querySelector("#boldBtn").getBoundingClientRect(), l = document.querySelector("#linkBtn").getBoundingClientRect(); const before = (x) => f.left > x.left || f.top >= x.bottom; return before(b) && before(l) && l.left > b.left; })()`), `${tag}: B, then the link icon, sit before the input`);
  check(await page.eval(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), `${tag}: no sideways scroll`);

  // The ghost, and the Tab key that never changes the input's size.
  const inputBox = `(() => { const r = document.querySelector("#askInput").getBoundingClientRect(); return r.width + "x" + r.height; })()`;
  const sizeBefore = await page.eval(inputBox);
  await page.click("#askInput");
  await page.shot(`${width}-bar-empty`);
  check((await page.eval(`document.querySelector("#askForm .edit-bar__send").disabled`)), `${tag}: Send is off with nothing typed`);
  await pressKey(page, "Enter", "Enter", 13, "\r");
  await sleep(150);
  check((await page.eval(barOpen)) && (await script()) === start && !(await newAsks()).length, `${tag}: Enter with an empty input does nothing`);
  await page.send("Input.insertText", { text: "s" });
  await sleep(120);
  check((await page.eval(ghost)) === "horter" && (await page.eval(tabOn)), `${tag}: typing s: the ghost shows the rest of Shorter and the Tab key shows`, await page.eval(ghost));
  await page.shot(`${width}-bar-ghost`);
  check((await page.eval(inputBox)) === sizeBefore, `${tag}: the Tab key doesn't change the input's size`, `${sizeBefore} ${await page.eval(inputBox)}`);
  const aligned = await page.eval(`(() => { const m = document.createElement("canvas").getContext("2d"), i = document.querySelector("#askInput"), c = getComputedStyle(i); m.font = c.font; const b = document.querySelector("#askGhost b").getBoundingClientRect(), left = i.getBoundingClientRect().left + parseFloat(c.paddingLeft) + m.measureText(i.value).width; return Math.abs(b.left - left); })()`);
  check(aligned <= 1.5, `${tag}: the ghost starts right after the typed letters`, aligned);
  const live = `document.querySelector("#askLive").textContent`;
  await sleep(500);
  check(/Shorter, 1 of 3/.test(await page.eval(live)), `${tag}: the suggestion is read out`, await page.eval(live));
  await pressKey(page, "ArrowDown", "ArrowDown", 40);
  await sleep(80);
  check((await page.eval(ghost)) === "impler", `${tag}: Down switches the suggestion`, await page.eval(ghost));
  await sleep(500);
  check(/Simpler, 2 of 3/.test(await page.eval(live)), `${tag}: the new suggestion is read out`, await page.eval(live));
  await pressKey(page, "ArrowUp", "ArrowUp", 38);
  await sleep(80);
  await pressKey(page, "Tab", "Tab", 9);
  await sleep(100);
  check((await page.eval(value)) === "Shorter" && (await page.eval(`document.activeElement.id`)) === "askInput", `${tag}: Tab takes the ghost and stays in the input`, await page.eval(value));
  check(!(await page.eval(tabOn)) && (await page.eval(inputBox)) === sizeBefore, `${tag}: after Tab: no ghost, same size`);
  check(/Accepted: Shorter/.test(await page.eval(live)), `${tag}: what Tab took is read out`, await page.eval(live));
  // The Tab key can be pressed too (no Tab key on a phone).
  await page.eval(`(() => { const i = document.querySelector("#askInput"); i.value = "si"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(80);
  await page.click("#askTab");
  await sleep(100);
  check((await page.eval(value)) === "Simpler" && (await page.eval(`document.activeElement.id`)) === "askInput", `${tag}: pressing the Tab key takes the ghost`, await page.eval(value));
  await closeBar();
  check(!(await page.eval(barOpen)) && (await script()) === start, `${tag}: Escape closes and changes no text`);

  // Enter sends: each command makes the same ask its button made, and the input shows the sending.
  const sent = [["shorter", "shorter"], ["Simpler", "simpler"], ["sound like me", "like"], ["b-roll", "broll"]];
  for (const [typed, action] of sent) {
    await selectWord();
    const word = await page.eval(`document.querySelector("#ebLabel").textContent`);
    await type(typed);
    await pressKey(page, "Enter", "Enter", 13, "\r");
    if (typed === "shorter") {
      check(await page.eval(`document.querySelector("#askField").dataset.state === "sending" && getComputedStyle(document.querySelector("#askSending")).display !== "none"`), `${tag}: the input shows the sending, no toast`);
      await page.shot(`${width}-bar-sending`);
    }
    const asks = await newAsks();
    check(asks.length === 1 && asks[0].action === action && asks[0].quote === "deadline", `${tag}: ${typed}: makes the ${action} ask on the selected word`, JSON.stringify(asks.map((a) => [a.action, a.quote])) + word);
    check(asks[0]?.instruction === (await page.eval(`import("/doc.js").then((D) => D.ACTIONS[${JSON.stringify(action)}].instruction)`)), `${tag}: ${typed}: the same words go to the agent as before`);
    await page.until(`document.querySelector("#editBar").hidden`, "the bar closing after sending");
    check((await script()) === start, `${tag}: ${typed}: no text changed`);
    await page.eval(`document.querySelector("#script .ask-chip__x")?.click()`);
    await sleep(150);
  }
  // A free ask goes as typed, also from the Send button, and comes back as a suggestion next time.
  await selectWord();
  await type("  Make it funnier ");
  await page.click("#askForm .edit-bar__send");
  const free = await newAsks();
  check(free.length === 1 && free[0].action === "ask" && free[0].instruction === "Make it funnier", `${tag}: a free ask goes as typed`, JSON.stringify(free.map((a) => a.instruction)));
  await page.until(`document.querySelector("#editBar").hidden`, "the bar closing");
  await page.eval(`document.querySelector("#script .ask-chip__x")?.click()`);
  await sleep(150);
  await selectWord();
  await type("mak");
  check((await page.eval(ghost)) === "e it funnier", `${tag}: an earlier ask comes back as a suggestion`, await page.eval(ghost));
  // A short ask that only starts like a command is sent as typed: Enter sends the text, not the ghost.
  await pressKey(page, "Enter", "Enter", 13, "\r");
  const short = await newAsks();
  check(short[0]?.action === "ask" && short[0]?.instruction === "mak", `${tag}: Enter sends what is typed, not the ghost`);
  await page.until(`document.querySelector("#editBar").hidden`, "the bar closing");
  await page.eval(`document.querySelector("#script .ask-chip__x")?.click()`);
  await sleep(150);

  // More: the menu with what it held, one of which asks.
  await selectWord();
  await type("more");
  await pressKey(page, "Enter", "Enter", 13, "\r");
  check(await page.until(`document.querySelector("#moreMenu").matches(":popover-open")`, "the More menu"), `${tag}: more opens the menu`);
  await sleep(150);
  check((await page.eval(`document.activeElement.dataset.act`)) === "explain", `${tag}: the menu takes the focus`, await page.eval(`document.activeElement.outerHTML.slice(0, 120) + " items " + document.querySelectorAll("#moreMenu .menu-action").length`));
  await page.shot(`${width}-bar-more`);
  await pressKey(page, "Escape", "Escape", 27);
  await sleep(100);
  check((await page.eval(barOpen)) && (await page.eval(`document.activeElement.id`)) === "askInput" && (await page.eval(value)) === "more", `${tag}: Escape closes only the menu and keeps what is typed`);
  await pressKey(page, "Enter", "Enter", 13, "\r");
  await page.until(`document.querySelector("#moreMenu").matches(":popover-open")`, "the More menu again");
  await sleep(150);
  await pressKey(page, "ArrowDown", "ArrowDown", 40);
  await sleep(100);
  await pressKey(page, "Enter", "Enter", 13, "\r");
  const facts = await newAsks();
  check(facts[0]?.action === "facts", `${tag}: a menu item makes its ask`, JSON.stringify(facts.map((a) => a.action)));
  await page.until(`document.querySelector("#editBar").hidden`, "the bar closing");
  await page.eval(`document.querySelector("#script .ask-chip__x")?.click()`);
  await sleep(150);

  // Add B-roll opens its card, as the menu item did.
  await selectWord();
  await type("add b-roll");
  await pressKey(page, "Enter", "Enter", 13, "\r");
  check(await page.until(`!document.querySelector("#shotCard").hidden`, "the Add B-roll card"), `${tag}: add b-roll opens the card`);
  check((await page.eval(`document.activeElement.id`)) === "scWhat", `${tag}: the card takes the focus`);
  await closeBar();

  // Over words that aren't spoken: B-roll turns Send off and sends nothing.
  const heading = `[...document.querySelectorAll('#script .block')].find((x) => x.dataset.type !== "para" && x.textContent.trim().length > 4)`;
  await page.eval(`getSelection().removeAllRanges()`);
  await sleep(150);
  await page.eval(`(() => { const el = ${heading}, w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (/\\p{L}{3,}/u.test(n.data)) break; const m = n.data.match(/\\p{L}{3,}/u), r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); el.scrollIntoView({ block: "center" }); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  check(await page.until(barOpen, "the bar over a heading"), `${tag}: a heading shows the bar`);
  await sleep(200);
  check(await page.eval(`document.querySelector("#boldBtn").hidden`), `${tag}: no B over a heading`);
  await type("b-roll");
  check(await page.eval(`document.querySelector("#askForm .edit-bar__send").disabled && document.querySelector("#askInput").getAttribute("aria-invalid") === "true"`), `${tag}: b-roll over a heading: Send is off`);
  await pressKey(page, "Enter", "Enter", 13, "\r");
  await sleep(120);
  check((await page.eval(barOpen)) && (await page.eval(value)) === "b-roll" && !(await newAsks()).length, `${tag}: Enter there sends nothing and keeps the words`);
  check((await page.eval(`document.querySelector("#askLive").textContent`)) === "B-roll needs spoken words.", `${tag}: screen readers hear why`, await page.eval(`document.querySelector("#askLive").textContent`));
  await page.eval(`localStorage.setItem("script-editor:askHistory", JSON.stringify(["b-roll ideas"]))`);
  await page.eval(`document.querySelector("#askInput").dispatchEvent(new Event("input", { bubbles: true }))`);
  await sleep(80);
  check(!(await page.eval(tabOn)), `${tag}: an earlier ask offers nothing while the command can't run`);
  await page.eval(`localStorage.removeItem("script-editor:askHistory")`);
  await closeBar();

  // A new selection during the sending ends it: the bar is ready for the new words.
  await selectWord();
  await type("shorter");
  await pressKey(page, "Enter", "Enter", 13, "\r");
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("Most of us")), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n = w.nextNode(), r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 4); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  check(await page.until(`document.querySelector("#askField").dataset.state === "idle" && !document.querySelector("#editBar").hidden && !document.querySelector("#askInput").readOnly && !document.querySelector("#boldBtn").disabled && document.querySelector("#ebLabel").textContent === "1 word"`, "the bar for the new words", 2000), `${tag}: a new selection while sending: the bar is ready for it`);
  await newAsks();
  await page.eval(`getSelection().removeAllRanges()`);
  await closeBar();
  await page.eval(`document.querySelector("#script .ask-chip__x")?.click()`);
  await sleep(150);

  // A phone keyboard composes each word: the ghost shows during that, and an Enter that ends it sends nothing.
  await selectWord();
  await page.click("#askInput");
  await page.send("Input.imeSetComposition", { text: "sh", selectionStart: 2, selectionEnd: 2 });
  await sleep(120);
  check((await page.eval(ghost)) === "orter" && (await page.eval(tabOn)), `${tag}: while composing: the ghost and the Tab key show`, await page.eval(ghost));
  for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, ...(type === "keyDown" ? { text: "\r" } : {}) });
  await sleep(120);
  check((await page.eval(barOpen)) && !(await newAsks()).length, `${tag}: an Enter that ends a composition sends nothing`);
  await page.click("#askTab");
  await sleep(120);
  check((await page.eval(value)) === "Shorter", `${tag}: the Tab key takes the ghost during a composition`, await page.eval(value));
  await pressKey(page, "Enter", "Enter", 13, "\r");
  const composed = await newAsks();
  check(composed[0]?.action === "shorter", `${tag}: then a normal Enter sends it`, JSON.stringify(composed.map((a) => a.action)));
  await page.until(`document.querySelector("#editBar").hidden`, "the bar closing");
  await page.eval(`document.querySelector("#script .ask-chip__x")?.click()`);
  await sleep(150);

  // The on-screen keyboard: the bar stays above it, and moves to the top rather than sit on the words.
  if (width < 640) {
    await selectWord();
    await page.eval(`(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); scrollBy({ top: r.top - 350, behavior: "instant" }); })()`);
    await sleep(150);
    await page.eval(`(() => { Object.defineProperty(visualViewport, "height", { value: 400, configurable: true }); visualViewport.dispatchEvent(new Event("resize")); })()`);
    await sleep(100);
    const lifted = await page.eval(`[document.querySelector("#editBar").style.getPropertyValue("--bar-lift"), document.querySelector("#editBar").dataset.dock].join()`);
    check(lifted === `${height - 400}px,top`, `${tag}: with a keyboard up the bar lifts and docks at the top`, lifted);
    await page.eval(`(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event("resize")); })()`);
    await sleep(100);
    check((await page.eval(`document.querySelector("#editBar").dataset.dock`)) === "bottom", `${tag}: without it the bar is back at the bottom`);
    check((await page.eval(`document.querySelector("#askField").getBoundingClientRect().width`)) >= 200, `${tag}: the input keeps at least 200 px with B showing`, await page.eval(`document.querySelector("#askField").getBoundingClientRect().width`));
    await closeBar();
  }

  // A tablet: with the keyboard up the bar stays where it can be seen.
  if (width >= 640) {
    await selectWord();
    await page.eval(`(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); scrollBy({ top: r.top - 380, behavior: "instant" }); Object.defineProperty(visualViewport, "height", { value: 420, configurable: true }); visualViewport.dispatchEvent(new Event("resize")); })()`);
    await sleep(150);
    const seen = await page.eval(`(() => { const b = document.querySelector("#editBar").getBoundingClientRect(), w = getSelection().getRangeAt(0).getBoundingClientRect(); return { fits: b.bottom <= 420, clear: b.bottom <= w.top || b.top >= w.bottom, top: b.top, bottom: b.bottom, wordBottom: w.bottom }; })()`);
    check(seen.fits, `${tag}: keyboard up on a wide screen: the bar is above it`, JSON.stringify(seen));
    check(seen.clear, `${tag}: and not on the words`, JSON.stringify(seen));
    await page.eval(`(() => { Object.defineProperty(visualViewport, "offsetTop", { value: 100, configurable: true }); visualViewport.dispatchEvent(new Event("scroll")); })()`);
    await sleep(100);
    const panned = await page.eval(`(() => { const b = document.querySelector("#editBar").getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; })()`);
    check(panned.top >= 100 && panned.bottom <= 520 && panned.top >= seen.wordBottom, `${tag}: the page panned by the keyboard: the bar is in what is seen, below the words`, JSON.stringify({ ...panned, seen }));
    await page.eval(`delete visualViewport.offsetTop`);
    await page.eval(`(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event("resize")); })()`);
    await closeBar();
  }

  // Part of the selected words bolded while typing: they are still there, so the ask goes on them.
  await page.eval(`getSelection().removeAllRanges()`);
  await sleep(150);
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("Most of us")), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n = w.nextNode(), from = n.data.indexOf("Most"), r = document.createRange(); r.setStart(n, from); r.setEnd(n, from + 7); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  await page.until(barOpen, "the bar on two words");
  await sleep(200);
  await type("warmer");
  await agent("mark_cue", { cues: [{ quote: "Most" }] });
  await sleep(300);
  check((await script()).includes("**Most** of us"), `${tag}: bold on part of the words: the agent's bold is there`);
  check(!(await page.eval(ghost)).includes("gone") && !(await page.eval(`document.querySelector("#askForm .edit-bar__send").disabled`)), `${tag}: bold on part of the words: they aren't gone`, await page.eval(ghost));
  // The bold comes off again: still there.
  await agent("unmark_cue", { cues: [{ quote: "Most" }] });
  await sleep(300);
  check(!(await page.eval(ghost)).includes("gone") && !(await page.eval(`document.querySelector("#askForm .edit-bar__send").disabled`)), `${tag}: the bold off again: they still aren't gone`, await page.eval(ghost));
  // Bold again, part of the words: the ask goes while they cross its edge.
  await agent("mark_cue", { cues: [{ quote: "Most" }] });
  await sleep(300);
  check((await script()).includes("**Most** of us"), `${tag}: bold again: the agent's bold is there`);
  await pressKey(page, "Enter", "Enter", 13, "\r");
  const parted = await newAsks();
  check(parted[0]?.instruction === "warmer" && parted[0]?.quote.includes("Most") && parted[0]?.quote.includes("of"), `${tag}: and the ask goes on them`, JSON.stringify(parted.map((x) => x.quote)));
  await page.until(`document.querySelector("#editBar").hidden`, "the bar closing");
  await page.eval(`document.querySelector("#script .ask-chip__x")?.click()`);
  await sleep(150);
  await agent("set_script", { markdown: start });
  await sleep(300);

  // Repeated words: the second copy stays the second, as bold goes on and off.
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank page.")); el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text: " Twice over. Twice over." });
  await sleep(350);
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("Twice over.")), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) nodes.push(n); const t = nodes.map((x) => x.data).join(""), from = t.lastIndexOf("Twice over"), point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }, r = document.createRange(); r.setStart(...point(from)); r.setEnd(...point(from + 10)); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  await page.until(barOpen, "the bar on the second copy");
  await sleep(200);
  await type("warmer");
  await agent("mark_cue", { cues: [{ quote: "Twice", occurrence: 2 }] });
  await sleep(300);
  check((await script()).includes("**Twice** over."), `${tag}: repeated words: the agent's bold is there`);
  await agent("unmark_cue", { cues: [{ quote: "Twice" }] });
  await sleep(300);
  await pressKey(page, "Enter", "Enter", 13, "\r");
  const repeated = await newAsks();
  const before = await page.eval(`(() => { const d = document.querySelector("#script [data-ask]"), r = document.createRange(); r.setStart(d.closest(".block"), 0); r.setEndBefore(d); return r.toString(); })()`);
  check(repeated[0]?.instruction === "warmer" && before.includes("Twice over."), `${tag}: repeated words: the ask stays on the second copy`, before.slice(-40));
  await page.until(`document.querySelector("#editBar").hidden`, "the bar closing");
  await page.eval(`document.querySelector("#script .ask-chip__x")?.click()`);
  await sleep(150);
  await agent("set_script", { markdown: start });
  await sleep(300);

  // A mark before the words moves another copy onto their old offset: the ask stays on its own copy.
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank page.")); el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text: " zed the the the" });
  await sleep(350);
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("zed the")), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) nodes.push(n); const t = nodes.map((x) => x.data).join(""), from = t.lastIndexOf("the"), point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }, r = document.createRange(); r.setStart(...point(from)); r.setEnd(...point(from + 3)); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  await page.until(barOpen, "the bar on the last copy");
  await sleep(200);
  await type("warmer");
  await agent("mark_cue", { cues: [{ quote: "zed" }] });
  await sleep(300);
  check((await script()).includes("**zed** the the the"), `${tag}: a mark before the words: the agent's bold is there`);
  await pressKey(page, "Enter", "Enter", 13, "\r");
  await newAsks();
  const after = await page.eval(`(() => { const d = [...document.querySelectorAll("#script [data-ask]")].at(-1), r = document.createRange(); r.setStart(d.closest(".block"), 0); r.setEndBefore(d); return r.toString(); })()`);
  check(after.endsWith("the the the"), `${tag}: a mark before the words: the ask stays on the last copy`, after.slice(-30));
  await page.until(`document.querySelector("#editBar").hidden`, "the bar closing");
  await page.eval(`document.querySelector("#script .ask-chip__x")?.click()`);
  await sleep(150);
  await agent("set_script", { markdown: start });
  await sleep(300);

  // A redraw of the line while typing: the words stay marked.
  await selectWord();
  await type("x");
  const markedWord = `CSS.highlights.has("bar-selection") && [...CSS.highlights.get("bar-selection")][0].toString() === "deadline"`;
  await agent("mark_cue", { cues: [{ quote: "until you say it" }] });
  await sleep(300);
  check(await page.eval(markedWord), `${tag}: a redraw of the line while typing: the selected word stays marked`);
  // Marks before it move it: the mark goes with it.
  await agent("mark_cue", { cues: [{ quote: "A blank page" }] });
  await sleep(300);
  check(await page.eval(markedWord), `${tag}: words moved by a redraw: the mark stays on the selected word`);
  check((await page.eval(value)) === "x" && (await page.eval(barOpen)), `${tag}: and what is typed stays`);
  // The agent bolds the selected word: B follows.
  await agent("mark_cue", { cues: [{ quote: "deadline" }] });
  await sleep(300);
  check((await page.eval(`document.querySelector("#boldBtn").getAttribute("aria-pressed")`)) === "true", `${tag}: the agent bolds the selected word: B shows pressed`);
  await closeBar();
  await agent("unmark_cue", { cues: [{ quote: "until you say it" }, { quote: "A blank page" }, { quote: "deadline" }] });
  await sleep(200);

  // A mouse selecting: the bar waits for the release, so it never comes under the pointer.
  await page.eval(`getSelection().removeAllRanges(); scrollTo({ top: 0, behavior: "instant" })`);
  await sleep(200);
  if (width >= 640) {
    const at = await page.eval(wordSpot);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, button: "none" });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1, buttons: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x + 40, y: at.y + 30, button: "left", buttons: 1 });
    await sleep(350);
    check(await page.eval(`document.querySelector("#editBar").hidden`), `${tag}: a pause in a drag: no bar yet`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x + 60, y: at.y + 90, button: "left", buttons: 1 });
    await sleep(350);
    check(await page.eval(`document.querySelector("#editBar").hidden && getSelection().toString().length > 20`), `${tag}: the drag carries on over the lines below`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x + 60, y: at.y + 90, button: "left", clickCount: 1 });
    check(await page.until(barOpen, "the bar after the release", 1500), `${tag}: the bar comes on release`);
    await closeBar();
    await page.eval(`getSelection().removeAllRanges()`);
    await sleep(200);
    // The same when the press moves the focus: from another paragraph, and from the bar's input.
    const dragFrom = async (name) => {
      const spot = await page.eval(wordSpot);
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...spot, button: "none" });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...spot, button: "left", clickCount: 1, buttons: 1 });
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: spot.x + 50, y: spot.y + 32, button: "left", buttons: 1 });
      await sleep(350);
      check(await page.eval(`document.querySelector("#editBar").hidden`), `${tag}: ${name}: no bar in the middle of the drag`);
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: spot.x + 50, y: spot.y + 32, button: "left", clickCount: 1 });
      check(await page.until(barOpen, "the bar after the release", 1500), `${tag}: ${name}: the bar comes on release`);
    };
    await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("Most of us")); el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToStart(); })()`);
    await sleep(200);
    await dragFrom("the caret in another paragraph");
    await page.click("#askInput");
    await sleep(120);
    await dragFrom("the focus in the bar's input");
    await closeBar();
    await page.eval(`getSelection().removeAllRanges()`);
    await sleep(200);
    // From the page's margin, into the text.
    const margin = await page.eval(`(() => { const r = document.querySelector("#script .block[data-type='para']").getBoundingClientRect(); return { x: r.left - 12, y: r.top + 8 }; })()`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...margin, button: "none" });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...margin, button: "left", clickCount: 1, buttons: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: margin.x + 120, y: margin.y + 34, button: "left", buttons: 1 });
    await sleep(350);
    check(await page.eval(`document.querySelector("#editBar").hidden`), `${tag}: a drag from the margin: no bar in the middle of it`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: margin.x + 120, y: margin.y + 34, button: "left", clickCount: 1 });
    await sleep(250);
    await closeBar();
    await page.eval(`getSelection().removeAllRanges()`);
    await sleep(200);
  }

  // A press that has nothing to do with the text: a closed bar stays closed.
  await selectWord();
  await closeBar();
  await page.click('#viewSwitch [data-view="script"]');
  await sleep(350);
  check(!(await page.eval(barOpen)), `${tag}: a toolbar button doesn't bring a closed bar back`);
  await page.eval(`getSelection().removeAllRanges()`);
  await sleep(200);

  // B over a bold edge, with an ask typed: the words are the same words, so the input stays ready.
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank page.")); el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text: " **big word** now" });
  await sleep(350);
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("big word")), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) nodes.push(n); const t = nodes.map((x) => x.data).join(""), from = t.indexOf("word**"), to = t.indexOf(" now", from) + 4, point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }, r = document.createRange(); r.setStart(...point(from)); r.setEnd(...point(to)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  await page.until(barOpen, "the bar over a bold edge");
  await sleep(200);
  await type("say it warmer");
  check((await page.eval(`document.querySelector("#ebLabel").textContent`)) === "2 words", `${tag}: the bar counts the 2 words selected over a bold edge`);
  await page.click("#boldBtn");
  await sleep(250);
  check((await script()).includes("**big word now**"), `${tag}: B over a bold edge joins it`);
  check((await page.eval(`document.querySelector("#ebLabel").textContent`)) === "3 words", `${tag}: and the bar counts the 3 words B marked`, await page.eval(`document.querySelector("#ebLabel").textContent`));
  check(!(await page.eval(`document.querySelector("#askForm .edit-bar__send").disabled`)) && (await page.eval(value)) === "say it warmer", `${tag}: and the input stays ready`);
  await closeBar();
  await agent("set_script", { markdown: start });
  await sleep(300);

  // The selected words stay marked while the focus is in the bar.
  await selectWord();
  await page.click("#askInput");
  await sleep(100);
  check(await page.eval(`CSS.highlights.has("bar-selection") && [...CSS.highlights.get("bar-selection")][0].toString() === "deadline"`), `${tag}: typing: the selected word stays marked`);
  await page.send("Input.insertText", { text: "x" });
  await page.click("#boldBtn");
  await sleep(200);
  check((await script()).includes("**deadline**") && (await page.eval(value)) === "x" && (await page.eval(barOpen)), `${tag}: B from the input marks the word and keeps what is typed`);
  check(await page.eval(`[...CSS.highlights.get("bar-selection")][0].toString().includes("deadline")`), `${tag}: the word stays marked after B`);
  // The pointer is still on B, so its colours are open (step U): the first Escape closes them, the next the bar.
  if (await page.eval(popOpen)) {
    await closeBar();
    check((await page.eval(barOpen)) && !(await page.eval(popOpen)), `${tag}: Escape closes B's colours first and keeps the bar`);
  }
  await closeBar();
  check(!(await page.eval(`CSS.highlights.has("bar-selection")`)), `${tag}: closing the bar takes the mark away`);
  await page.close();
}

// Narrow phones: the field stays at least 200 px while it can (B takes a row of its own).
async function runNarrowBar(width, height) {
  const tag = `${width}x${height}`;
  const { page } = await openDemo(width, height);
  await doubleClick(page, await page.eval(wordSpot));
  await page.until(`!document.querySelector("#editBar").hidden`, "the selection bar");
  await sleep(200);
  check(await page.eval(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), `${tag}: no sideways scroll`);
  const field = await page.eval(`document.querySelector("#askField").getBoundingClientRect().width`);
  check(field >= (width >= 360 ? 200 : 180), `${tag}: the field is wide enough`, field);
  await page.click("#askInput");
  await page.shot(`${width}-bar-narrow`);
  await page.close();
}

// Where the bar goes (Lex's screenshots: the old one sat on the paragraph above): not on the selected words nor on the line
// above them, on a tall window, a short one and a phone. Only where neither fits may it cover the line above.
async function runBarPlace(width, height) {
  const tag = `${width}x${height}`;
  const { page } = await openDemo(width, height);
  const lines = `[...document.querySelectorAll('#script .block[data-type="para"]')].filter((x) => x.textContent.trim().split(/\\s+/).length > 8)`;
  const selectIn = (index, scrollTo) => page.eval(`(() => { const el = ${lines}[${index}]; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const n = w.nextNode(); const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, Math.min(n.data.length, 20)); ${scrollTo}; const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  const report = () => page.eval(`(() => { const s = getSelection().getRangeAt(0), rs = [...s.getClientRects()].filter((x) => x.width > 0), first = rs[0], last = rs.at(-1), b = document.querySelector("#editBar").getBoundingClientRect(), lh = parseFloat(getComputedStyle(s.startContainer.parentElement).lineHeight); const clear = (t, bm) => b.bottom <= t || b.top >= bm; return { words: clear(first.top, last.bottom), above: clear(first.top - lh, first.top), inWindow: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth, top: b.top, first: first.top, h: b.height, vh: innerHeight, topBar: document.querySelector(".top").getBoundingClientRect().bottom, room: first.top - document.querySelector(".top").getBoundingClientRect().bottom }; })()`);
  const count = await page.eval(`${lines}.length`);
  for (const [name, index, pos] of [["top of the window", 1, `el.scrollIntoView({ block: "start" }); scrollBy({ top: -80, behavior: "instant" })`], ["middle", 2, `el.scrollIntoView({ block: "center" })`], ["bottom of the window", 3, `el.scrollIntoView({ block: "end" })`]]) {
    await page.eval(`getSelection().removeAllRanges()`);
    await sleep(180);
    await selectIn(Math.min(index, count - 1), pos);
    await page.until(`!document.querySelector("#editBar").hidden`, "the selection bar");
    await sleep(250);
    const r = await report();
    check(r.words, `${tag}: ${name}: the bar is not on the selected words`, JSON.stringify(r));
    check(r.inWindow, `${tag}: ${name}: the bar is inside the window`, JSON.stringify(r));
    // The line above is kept clear wherever there is room for that.
    if (r.h + 8 + 8 + 30 <= Math.max(r.room, r.vh - r.first - 30)) check(r.above, `${tag}: ${name}: the bar is not on the line above`, JSON.stringify(r));
    await page.shot(`${width}x${height}-place-${name.split(" ").at(-1)}`);
  }
  await page.close();
}

// A guest's bar (step T): the same commands; Suggest B-roll and asks reach the host's agent, adding a shot stays the host's.
async function runSlimGuest(width, height) {
  const tag = `${width} px guest`;
  const { page, agent } = await openDemo(1280, 800);
  await page.eval(`Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__link = t; } } })`);
  await page.click("#shareBtn");
  await page.until(`!!window.__link`, "the share link");
  const guest = await openPage(width, height);
  await guest.send("Page.navigate", { url: await page.eval(`window.__link`) });
  await guest.until(`!document.querySelector("#joinForm").hidden`, "the Join form");
  await guest.eval(`document.querySelector("#joinName").value = "Guest"`);
  await guest.click("#joinForm button");
  await guest.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the guest's script", 12000);
  await guest.send("Page.bringToFront");
  for (const [typed, action] of [["b-roll", "broll"], ["shorter", "shorter"], ["Say it warmer", "ask"]]) {
    await guest.eval(`getSelection().removeAllRanges()`);
    await sleep(200);
    await guest.eval(`scrollTo({ top: 0, behavior: "instant" })`);
    await doubleClick(guest, await guest.eval(wordSpot));
    await guest.until(`!document.querySelector("#editBar").hidden`, "the guest's bar");
    await sleep(200);
    await barSend(guest, typed);
    let asks = [];
    for (let i = 0; i < 40 && !asks.length; i++) { asks = JSON.parse(await agent("wait_for_asks", { waitSeconds: 0 })).asks; if (!asks.length) await sleep(100); }
    check(asks[0]?.action === action && asks[0]?.quote === "deadline", `${tag}: ${typed}: reaches the host's agent as ${action}`, JSON.stringify(asks.map((a) => [a.action, a.quote])));
    if (action === "ask") check(asks[0]?.instruction === typed, `${tag}: a free ask goes as typed`);
    await guest.until(`document.querySelector("#editBar").hidden`, "the guest's bar closing");
    await guest.eval(`document.querySelector("#script .ask-chip__x")?.click()`);
    await sleep(300);
  }
  await guest.eval(`getSelection().removeAllRanges()`);
  await sleep(200);
  await doubleClick(guest, await guest.eval(wordSpot));
  await guest.until(`!document.querySelector("#editBar").hidden`, "the guest's bar");
  await sleep(200);
  await guest.click("#askInput");
  await guest.send("Input.insertText", { text: "add b-roll" });
  await sleep(200);
  check((await guest.eval(`document.querySelector("#askForm .edit-bar__send").disabled`)) && (await guest.eval(`document.querySelector("#askLive").textContent`)) === "Only the host can add B-roll.", `${tag}: add b-roll stays the host's`);
  await pressKey(guest, "Escape", "Escape", 27);
  await guest.eval(`getSelection().removeAllRanges()`);
  await sleep(200);
  // The host types an ask while the guest deletes the selected word: as before, Enter closes the bar and no ask goes.
  {
    await page.send("Page.bringToFront");
    await doubleClick(page, await page.eval(wordSpot));
    await page.until(`!document.querySelector("#editBar").hidden`, "the host's bar");
    await sleep(200);
    await page.click("#askInput");
    await page.send("Input.insertText", { text: "make it warmer" });
    await sleep(100);
    const history = await page.eval(`localStorage.getItem("script-editor:askHistory")`);
    await guest.send("Page.bringToFront");
    await doubleClick(guest, await guest.eval(wordSpot));
    await sleep(200);
    await pressKey(guest, "Backspace", "Backspace", 8);
    await page.until(`!document.querySelector("#script").textContent.includes("deadline")`, "the word gone on the host's page");
    await page.send("Page.bringToFront");
    await pressKey(page, "Enter", "Enter", 13, "\r");
    await sleep(200);
    check((await page.eval(`document.querySelector("#editBar").hidden`)) && !JSON.parse(await agent("wait_for_asks", { waitSeconds: 0 })).asks.length, `${tag}: the selected word deleted while typing: no ask goes`);
    check((await page.eval(`localStorage.getItem("script-editor:askHistory")`)) === history, `${tag}: and it isn't kept as an earlier ask`);
  }
  await guest.close();
  await page.close();
}

// Follow-ups of the bold work (TOOLS-50, TOOLS-52): an open ask on part of a bold stretch (no "**" shows), and a guest's
// selection while a host's ask arrives on the same line.
const firstPara = `[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank"))`;
// A selection of a word's letters in the first paragraph, by its text offsets (the text pieces an ask cuts it into do not matter).
const selectWords = (words, nth = 0) => `(() => { const el = ${firstPara}, w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n, text = ""; while ((n = w.nextNode())) if (!n.parentElement.closest("[data-skip], [contenteditable='false']")) { nodes.push(n); text += n.data; } let from = -1; for (let i = 0; i <= ${nth}; i++) from = text.indexOf(${JSON.stringify(words)}, from + 1); if (from < 0) throw new Error("not in the line: ${words}"); const point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }; const r = document.createRange(); r.setStart(...point(from)); r.setEnd(...point(from + ${words.length})); el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`;
const typeAtEnd = async (page, text) => {
  await page.eval(`(() => { const el = ${firstPara}; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text });
  await sleep(300);
};
async function runAskInBold(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(width, height);
  await typeAtEnd(page, " Say **big word now** okay.");
  const shown = () => page.eval(`${firstPara}.innerText`);
  check((await shown()).includes("Say big word now okay.") && !(await shown()).includes("**"), `${tag}: a bold stretch shows no ** to start with`);
  await page.eval(selectWords("word"));
  await sleep(300);
  await barSend(page, "shorter");
  check(await page.until(`!!${firstPara}.querySelector("[data-ask]")`, "an ask on part of the bold stretch"), `${tag}: an ask sits on part of a bold stretch`);
  await sleep(200);
  const seen = await shown();
  check(!seen.includes("**"), `${tag}: with an ask on part of a bold stretch no ** shows`, seen.slice(-60));
  check(await page.eval(`(() => { const w = document.createTreeWalker(${firstPara}, NodeFilter.SHOW_TEXT), seen = []; let n; while ((n = w.nextNode())) if (["big", "word", "now"].includes(n.data.trim())) seen.push(Number(getComputedStyle(n.parentElement).fontWeight)); return seen.length === 3 && seen.every((x) => x >= 600); })()`), `${tag}: and all its words still show bold`);
  check((await agent("get_script", {}).then((t) => JSON.parse(t).markdown)).includes("Say **big word now** okay."), `${tag}: the text keeps its marks`);
  // Typing in the line and a click in it leave the text as it was.
  await page.eval(`(() => { const el = ${firstPara}; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text: "!" });
  await sleep(300);
  check((await agent("get_script", {}).then((t) => JSON.parse(t).markdown)).includes("Say **big word now** okay.!"), `${tag}: typing after it works`);
  await page.close();
}

async function runGuestSelection(width, height) {
  const tag = `${width} px`;
  const { page, agent } = await openDemo(1280, 800);
  await page.eval(`Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__link = t; } } })`);
  await page.click("#shareBtn");
  await page.until(`!!window.__link`, "the share link");
  const guest = await openPage(width, height);
  await guest.send("Page.navigate", { url: await page.eval(`window.__link`) });
  await guest.until(`!document.querySelector("#joinForm").hidden`, "the Join form");
  await guest.eval(`document.querySelector("#joinName").value = "Guest"`);
  await guest.click("#joinForm button");
  await guest.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the guest's script", 12000);
  await guest.send("Page.bringToFront");
  await guest.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  await doubleClick(guest, await guest.eval(wordSpot));
  check(await guest.until(`!document.querySelector("#editBar").hidden`, "the guest's bar"), `${tag}: the guest selects a word and the bar opens`);
  const mine = await guest.eval(`getSelection().toString().trim()`);
  // The host asks about other words on that same line; the ask reaches the guest and redraws the line.
  await page.eval(selectWords("blank"));
  await sleep(300);
  await barSend(page, "shorter");
  check(await page.until(`!!${firstPara}.querySelector("[data-ask]")`, "the host's ask"), `${tag}: the host asks about other words on the line`);
  check(await guest.until(`!!${firstPara}.querySelector("[data-ask]")`, "the ask reaches the guest", 12000), `${tag}: the host's ask reaches the guest`);
  await sleep(400);
  check((await guest.eval(`getSelection().toString().trim()`)) === mine && mine.length > 0, `${tag}: the guest's selection is still there after the host's ask arrived`, await guest.eval(`getSelection().toString()`));
  check(await guest.eval(`!document.querySelector("#editBar").hidden`), `${tag}: and the guest's bar is still open`);
  // Typing the ask still goes through for the guest.
  await barSend(guest, "warmer");
  let asks = [];
  for (let i = 0; i < 40 && asks.length < 2; i++) { asks = JSON.parse(await agent("wait_for_asks", { waitSeconds: 0 })).asks; if (asks.length < 2) await sleep(100); }
  check(asks.some((a) => a.instruction === "warmer" && a.quote === mine), `${tag}: the guest's ask on its own words reaches the agent`, JSON.stringify(asks.map((a) => [a.instruction, a.quote])));
  await guest.close();
  await page.close();
}

// A phone page panned by the on-screen keyboard (step T follow-up): the bar's first free spot below the top bar is the lower of
// the top bar's end and the pan, not their sum. The visual viewport is faked, so a pan the keyboard would make can be tried here.
async function runBarPanned(width, height) {
  const tag = `${width}x${height} panned`;
  const { page } = await openDemo(width, height);
  const spot = (offsetTop) => page.eval(`(() => {
    const fake = Object.assign(new EventTarget(), { offsetTop: ${offsetTop}, offsetLeft: 0, height: ${height} - ${offsetTop}, width: ${width}, scale: 1 });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => fake });
    const top = document.querySelector(".top").getBoundingClientRect().bottom;
    getSelection().removeAllRanges();
    return top;
  })()`);
  for (const pan of [30, 100]) {
    const top = await spot(pan);
    await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
    await sleep(150);
    await doubleClick(page, await page.eval(wordSpot));
    await page.until(`!document.querySelector("#editBar").hidden`, "the bar");
    await sleep(250);
    const got = await page.eval(`parseFloat(document.querySelector("#editBar").style.getPropertyValue("--bar-y"))`);
    check(got === Math.max(top, pan) + 8, `${tag}: panned ${pan}px: the bar's first spot is 8 px under the lower of the top bar (${Math.round(top)}) and the pan`, got);
    await page.eval(`getSelection().removeAllRanges()`);
    await sleep(250);
  }
  await page.close();
}

// How bold looks (step S): orange and bold by default, in the prompter's orange in dark mode; the menu holds only the colours,
// and they can be chosen. An older "off" switch left in the browser means nothing and goes away.
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
  await page.click("#docInfo");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  check(await page.eval(`document.querySelectorAll('#scriptMenu input[type="color"]').length === 0 && !document.querySelector("#cueGroup")`), `${tag}: the menu has no bold colours or switches`);
  await pressKey(page, "Escape", "Escape", 27);
  const shown = () => page.eval(`document.querySelector("#boldFg").value + " " + document.querySelector("#boldBg").value`);
  const hoverOpen = async () => {
    await doubleClick(page, await page.eval(wordSpot));
    await page.until(`!document.querySelector("#editBar").hidden && !document.querySelector("#boldBtn").hidden`, "the B button");
    await hoverOn(page, "#boldBtn");
    await page.until(popOpen, "the bold colours on hover");
  };
  await hoverOpen();
  await page.shot("bold-pop-dark");
  check((await shown()) === "#fb401e #080721", `${tag}: dark mode: the fields show the orange and the page's colour`, await shown());
  await pressKey(page, "Escape", "Escape", 27);
  await pressKey(page, "Escape", "Escape", 27);
  await page.eval(`getSelection().removeAllRanges()`);
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await sleep(150);
  const light = await look();
  const lightOrange = await probe("oklch(52% 0.17 37)");
  await hoverOpen();
  check((await shown()) === "#b53707 #fafafa", `${tag}: light mode: the fields show the orange and the page's colour`, await shown());
  await pressKey(page, "Escape", "Escape", 27);
  await pressKey(page, "Escape", "Escape", 27);
  await page.eval(`getSelection().removeAllRanges()`);
  await sleep(150);
  check(light.color === lightOrange && light.weight === 800, `${tag}: light mode: a darker orange that reads on white`, `${JSON.stringify(light)} ${lightOrange}`);
  await page.eval(`(() => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }; set("#boldFg", "#112233"); set("#boldBg", "#ddeeff"); })()`);
  const own = await look();
  check(own.color === "rgb(17, 34, 51)" && own.background === "rgb(221, 238, 255)", `${tag}: the person's own colours show at once`, JSON.stringify(own));
  // Another tab of this browser follows, and is not redrawn.
  const other = await openPage(width, height, page);
  await other.send("Page.navigate", { url: `${BASE}/` });
  await other.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the second tab");
  await other.click("#emptySample");
  await other.until(`!!document.querySelector("#script .block")`, "the second tab's script");
  const scriptStyle = (prop) => other.eval(`document.querySelector("#script").style.getPropertyValue("${prop}")`);
  await other.until(`document.querySelector("#script").style.getPropertyValue("--bold-fg") === "#112233"`, "the colour in the second tab");
  check((await scriptStyle("--bold-bg")) === "#ddeeff", `${tag}: another tab opened now has the colours`);
  await send("Target.closeTarget", { targetId: other.targetId });
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
/* ---------- The bold colours by B (Lex 2026-11-07, Variant A) ---------- */
const popOpen = `document.querySelector("#boldPop").matches(":popover-open")`;
// The mouse over an element's middle, with no button held: a hover.
async function hoverOn(page, selector) {
  const at = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, button: "none" });
  return at;
}
const tapAt = async (page, { x, y }) => {
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(120);
};
const centre = (page, selector) => page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
// The popover: on screen, and off the selected words (the bar keeps their range while the page's selection may be gone).
const popPlace = (page) => page.eval(`(() => { const p = document.querySelector("#boldPop").getBoundingClientRect(), s = getSelection(), r = s.rangeCount ? [...s.getRangeAt(0).getClientRects()].filter((x) => x.width > 0) : []; const v = visualViewport; return { onScreen: p.top >= 0 && p.left >= 0 && p.bottom <= v.height + v.offsetTop + 0.5 && p.right <= document.documentElement.clientWidth + 0.5, offWords: r.length > 0 && r.every((w) => p.bottom <= w.top || p.top >= w.bottom || p.right <= w.left || p.left >= w.right), words: r.length, pop: [p.top, p.bottom, p.left, p.right].map(Math.round) }; })()`);
const barBox = (page) => page.eval(`(() => { const r = document.querySelector("#editBar").getBoundingClientRect(); return [r.top, r.left, r.width, r.height].map(Math.round).join(); })()`);

async function runBoldPop(width, height) {
  const tag = `${width}x${height} colours`;
  const { page } = await openDemo(width, height);
  const phone = width < 640;
  const stored = () => page.eval(`JSON.parse(localStorage.getItem("script-editor:boldStyle"))`);
  const cueLook = () => page.eval(`(() => { const w = document.querySelector("#script [data-cue] .md-link__words"); if (!w) return null; const c = getComputedStyle(w); return { color: c.color, background: c.backgroundColor }; })()`);
  const sampleLook = () => page.eval(`(() => { const c = getComputedStyle(document.querySelector("#boldSample b")); return { color: c.color, background: c.backgroundColor, weight: Number(c.fontWeight) }; })()`);
  const orange = await page.eval(`(() => { const a = document.createElement("span"); a.style.color = "oklch(52% 0.17 37)"; document.body.append(a); const c = getComputedStyle(a).color; a.remove(); return c; })()`);
  const selectWord = async () => {
    await page.eval(`getSelection().removeAllRanges()`);
    await sleep(200);
    await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
    await doubleClick(page, await page.eval(wordSpot));
    await page.until(`!document.querySelector("#editBar").hidden && !document.querySelector("#boldBtn").hidden`, "the selection bar with B");
    await sleep(250);
  };
  check(await page.eval(`!${popOpen} && document.querySelector("#boldBtn").getAttribute("aria-expanded") === "false"`), `${tag}: the colours are closed at first`);
  check(await page.eval(`!document.querySelector("#boldBtn").title`), `${tag}: B has no tooltip to sit on the colours`);

  if (!phone) {
    await selectWord();
    const before = await barBox(page);
    await hoverOn(page, "#boldBtn");
    await page.until(popOpen, "the colours on hovering B", 1500);
    await sleep(200);
    await page.shot(`${width}-bold-pop`);
    check(await page.eval(`document.querySelector("#boldBtn").getAttribute("aria-expanded") === "true"`), `${tag}: B says the colours are open`);
    check((await barBox(page)) === before, `${tag}: the bar keeps its size and place`, `${before} ${await barBox(page)}`);
    const at = await popPlace(page);
    check(at.onScreen && at.offWords, `${tag}: the colours are on screen and off the selected words`, JSON.stringify(at));
    check(await page.eval(`(() => { const p = document.querySelector("#boldPop").getBoundingClientRect(), b = document.querySelector("#boldBtn").getBoundingClientRect(); return !["below", "above"].includes(document.querySelector("#boldPop").dataset.side) || Math.abs(p.left - b.left) <= 1; })()`), `${tag}: lined up with B when under or over the bar`);
    // A real hand: the pointer moves from B to the middle of the colours in steps, over half a second.
    {
      const from = await centre(page, "#boldBtn"), to = await centre(page, "#boldPop");
      for (let i = 1; i <= 10; i++) { await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10, button: "none" }); await sleep(50); }
      await sleep(300);
      check(await page.eval(popOpen), `${tag}: the pointer moving from B to the colours (${await page.eval(`document.querySelector("#boldPop").dataset.side`)}) reaches them open`);
      // Resting on the input for a while, then off the bar into the page: they close.
      await hoverOn(page, "#askInput");
      await sleep(900);
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: height - 4, button: "none" });
      await page.until(`!${popOpen}`, "the colours closing after resting on the bar, then leaving it", 1500);
      await hoverOn(page, "#boldBtn");
      await page.until(popOpen, "the colours on B again", 1500);
    }
    if (height <= 420) {
      await page.eval(`document.documentElement.style.fontSize = "250%"`);
      await page.eval(`dispatchEvent(new Event("resize"))`);
      await sleep(100);
      const tall = await page.eval(`(() => { const p = document.querySelector("#boldPop"), r = p.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, scrolls: p.scrollHeight > p.clientHeight }; })()`);
      check(tall.top >= 0 && tall.bottom <= tall.h + 0.5 && tall.scrolls, `${tag}: large text in a short window: the colours fit what is seen and scroll inside`, JSON.stringify(tall));
      await page.eval(`document.documentElement.style.fontSize = ""`);
      await page.eval(`dispatchEvent(new Event("resize"))`);
      await sleep(100);
    }
    check((await page.eval(`document.querySelectorAll("#boldPop .bold-pop__swatch").length`)) === 12 && (await page.eval(`document.querySelector("#boldReset").disabled`)), `${tag}: the colours, None and a Reset that is off while nothing is chosen`);
    const sample = await sampleLook();
    check(sample.color === orange && sample.weight === 800, `${tag}: the sample word shows the default orange and bold`, JSON.stringify(sample));
    // A colour from the row: saved, shown on the sample at once; the words stay selected.
    await page.click(`#boldPop [data-kind="color"] [data-hex="#fbd530"]`);
    await sleep(120);
    check((await stored())?.color === "#fbd530", `${tag}: the picked text colour is saved`, JSON.stringify(await stored()));
    check((await sampleLook()).color === "rgb(138, 101, 0)", `${tag}: the sample shows it at once, as its light-mode partner`);
    check(await page.eval(`document.querySelector('#boldPop [data-hex="#fbd530"]').getAttribute("aria-pressed") === "true" && document.querySelector("#boldReset").disabled === false`), `${tag}: the swatch shows it is picked; Reset comes on`);
    check(await page.eval(`${popOpen} && !document.querySelector("#editBar").hidden && getSelection().toString().trim() === "deadline"`), `${tag}: the colours and the bar stay open, the word stays selected`, await page.eval(`getSelection().toString()`));
    // Picking with the mouse takes no focus (the bar's presses never do), so the pointer leaving still closes them.
    check(!(await page.eval(`document.querySelector("#boldPop").contains(document.activeElement)`)), `${tag}: a picked swatch takes no focus`, await page.eval(`document.activeElement?.outerHTML.slice(0, 80)`));
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: height - 4, button: "none" });
    await page.until(`!${popOpen}`, "the colours closing when the pointer leaves after a pick", 1500);
    check(await page.eval(`!document.querySelector("#editBar").hidden`), `${tag}: after a pick the pointer leaves: the colours close, the bar stays`);
    await hoverOn(page, "#boldBtn");
    await page.until(popOpen, "the colours again after the pick", 1500);
    await page.click(`#boldPop [data-kind="background"] [data-hex="#34317f"]`);
    await sleep(120);
    // Clicking B still bolds, as before.
    await page.click("#boldBtn");
    await page.until(`!!document.querySelector("#script [data-cue]")`, "the bold word after clicking B");
    const look = await cueLook();
    check(look?.color === "rgb(138, 101, 0)" && look?.background === "rgb(222, 220, 255)", `${tag}: clicking B bolds the word, in the picked colours (light mode: their partners)`, JSON.stringify(look));
    // Night: the same choice shows the night colours, so the words read in both modes.
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await sleep(150);
    const night = await cueLook();
    check(night?.color === "rgb(251, 213, 48)" && night?.background === "rgb(52, 49, 127)", `${tag}: dark mode shows the night colours of the same choice`, JSON.stringify(night));
    check(await page.eval(`document.querySelector('#boldPop [data-hex="#f3f4fc"]').getAttribute("aria-label") === "White"`), `${tag}: dark mode: the swatches carry their night names`);
    await page.send("Emulation.setEmulatedMedia", { features: [] });
    await sleep(150);
    check(await page.eval(`document.querySelector('#boldPop [data-hex="#f3f4fc"]').getAttribute("aria-label") === "Black"`), `${tag}: light mode: White's partner is Black, readable on white`);
    // The own colour field.
    await page.eval(`(() => { const e = document.querySelector("#boldFg"); e.value = "#112233"; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(80);
    check((await cueLook())?.color === "rgb(17, 34, 51)" && (await page.eval(`document.querySelector('#boldPop [data-kind="color"] .bold-pop__custom').dataset.on === "true"`)), `${tag}: your own colour shows at once and marks the + circle`);
    // Reset: back to orange, no background, nothing saved.
    // Bolding can move the bar from under the pointer, which closes the colours: hover B again.
    await hoverOn(page, "#boldBtn");
    await page.until(popOpen, "the colours before Reset", 1500);
    await page.click("#boldReset");
    await sleep(120);
    check((await page.eval(`localStorage.getItem("script-editor:boldStyle")`)) === null, `${tag}: Reset clears the saved choice`);
    const reset = await cueLook();
    check(reset?.color === orange && reset?.background === "rgba(0, 0, 0, 0)", `${tag}: Reset: orange again, no background`, JSON.stringify(reset));
    check(await page.eval(`document.querySelector("#boldReset").disabled && document.querySelector('#boldPop [data-kind="color"] .bold-pop__swatch--default').getAttribute("aria-pressed") === "true"`), `${tag}: Reset goes off; the default orange shows as picked`);
    // The + by mouse (step U follow-up): a pick through it leaves the focus on the colour field, which must not hold the
    // colours open once its picker is closed: the pointer leaving still closes them.
    await page.click("#boldFg");
    await page.eval(`(() => { const e = document.querySelector("#boldFg"); e.value = "#334455"; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: height - 4, button: "none" });
    check(await page.until(`!${popOpen}`, "the colours closing after a pick through the + by mouse", 1500), `${tag}: after a mouse pick through the +, the pointer leaving closes the colours`);
    check(await page.eval(`!document.querySelector("#editBar").hidden`), `${tag}: and the bar stays open`);
    await hoverOn(page, "#boldBtn");
    await page.until(popOpen, "the colours before Reset", 1500);
    await page.click("#boldReset");
    await sleep(120);
    // The pointer leaves: they close; the bar stays.
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: height - 4, button: "none" });
    await page.until(`!${popOpen}`, "the colours closing when the pointer leaves", 1500);
    check(await page.eval(`!document.querySelector("#editBar").hidden && document.querySelector("#boldBtn").getAttribute("aria-expanded") === "false"`), `${tag}: the pointer leaves: the colours close, the bar stays`);
    // Escape closes them first, then the bar.
    await hoverOn(page, "#boldBtn");
    await page.until(popOpen, "the colours again", 1500);
    await pressKey(page, "Escape", "Escape", 27);
    await sleep(100);
    check(await page.eval(`!${popOpen} && !document.querySelector("#editBar").hidden`), `${tag}: Escape closes the colours and keeps the bar`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: height - 4, button: "none" });
    // The keyboard: Shift+Tab from the input onto B opens them; Tab goes into them; Escape goes back to B.
    await selectWord();
    await page.click("#askInput");
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
    await sleep(100);
    // Shift+Tab from the input lands on Reset, the popover's last item, before B: back once more to B.
    const focused = () => page.eval(`document.activeElement?.id || document.activeElement?.className || ""`);
    if ((await focused()) !== "boldBtn") for (let i = 0; i < 16 && (await focused()) !== "boldBtn"; i++) {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
    }
    await sleep(150);
    check((await focused()) === "boldBtn" && (await page.eval(popOpen)), `${tag}: keyboard focus on B opens the colours`, await focused());
    await pressKey(page, "Tab", "Tab", 9);
    await sleep(100);
    check((await page.eval(`document.querySelector("#boldPop").contains(document.activeElement)`)) && (await page.eval(popOpen)), `${tag}: Tab goes into the colours, which stay open`, await focused());
    await pressKey(page, "ArrowRight", "ArrowRight", 39);
    await sleep(60);
    check(await page.eval(`document.activeElement?.dataset.hex === "#fbd530" && document.activeElement.tabIndex === 0`), `${tag}: the arrow keys move along a row`, await focused());
    await pressKey(page, "End", "End", 35);
    await sleep(40);
    check((await focused()) === "boldFg", `${tag}: End goes to the row's own colour field`, await focused());
    await pressKey(page, "ArrowRight", "ArrowRight", 39);
    await sleep(40);
    check(await page.eval(`document.activeElement?.classList.contains("bold-pop__swatch--default")`), `${tag}: past the end the arrows wrap to the row's start`, await focused());
    await pressKey(page, "ArrowLeft", "ArrowLeft", 37);
    await sleep(40);
    check((await focused()) === "boldFg", `${tag}: ArrowLeft at the start wraps to the row's end`, await focused());
    await pressKey(page, "Home", "Home", 36);
    await sleep(40);
    check(await page.eval(`document.activeElement?.classList.contains("bold-pop__swatch--default") && document.activeElement.tabIndex === 0`), `${tag}: Home returns to the start`, await focused());
    // Each row is one stop: from B, Tab reaches the input in a few presses.
    let presses = 1;
    for (; presses < 10 && (await focused()) !== "askInput"; presses++) { await pressKey(page, "Tab", "Tab", 9); await sleep(40); }
    check((await focused()) === "askInput" && presses <= 4, `${tag}: from B, Tab reaches the input in at most 4 presses`, presses);
    await sleep(900); // 700 ms when they sit away from B
    check(!(await page.eval(popOpen)), `${tag}: the focus leaving closes the colours`);
    // The link icon sits between B and the input (step V): Shift+Tab reaches it first, then B.
    const backTab = async () => { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 }); await sleep(150); };
    await backTab();
    check((await focused()) === "linkBtn" && !(await page.eval(popOpen)), `${tag}: one Shift+Tab from the input lands on the link icon`, await focused());
    await backTab();
    check((await focused()) === "boldBtn" && (await page.eval(popOpen)), `${tag}: a second Shift+Tab lands on B and opens them`, await focused());
    await pressKey(page, "Tab", "Tab", 9);
    await sleep(100);
    await pressKey(page, "Escape", "Escape", 27);
    await sleep(100);
    check((await focused()) === "boldBtn" && !(await page.eval(popOpen)) && (await page.eval(`!document.querySelector("#editBar").hidden`)), `${tag}: Escape closes them, the focus goes back to B, the bar stays`, await focused());
    await pressKey(page, "Escape", "Escape", 27);
  } else {
    // A phone: a tap on B bolds and opens the colours; a tap elsewhere closes them.
    await selectWord();
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const before = await barBox(page);
    await tapAt(page, await centre(page, "#boldBtn"));
    await page.until(`!!document.querySelector("#script [data-cue]")`, "the bold word after a tap on B");
    await page.until(popOpen, "the colours after a tap on B", 1500);
    await sleep(200);
    await page.shot(`${width}-bold-pop`);
    check((await barBox(page)) === before, `${tag}: the bar keeps its size and place`, `${before} ${await barBox(page)}`);
    const at = await popPlace(page);
    check(at.onScreen && at.offWords, `${tag}: the colours are on screen and off the selected words`, JSON.stringify(at));
    check(await page.eval(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), `${tag}: no sideways scroll`);
    // Every colour, "None" and the + (the colour input) is at least as big as the bar's own buttons on a touch screen: 44 px.
    const sw = await page.eval(`(() => { const sizes = [...document.querySelectorAll("#boldPop .bold-pop__swatch, #boldPop .bold-pop__custom")].map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }); return { n: sizes.length, least: Math.min(...sizes) }; })()`);
    check(sw.n === 14 && sw.least >= 43.5, `${tag}: all ${sw.n} colours and both + buttons are big enough for a thumb`, JSON.stringify(sw));
    await tapAt(page, await centre(page, `#boldPop [data-kind="color"] [data-hex="#5edb81"]`));
    check((await stored())?.color === "#5edb81" && (await cueLook())?.color === "rgb(31, 122, 60)", `${tag}: a tapped colour shows on the bold word at once (light mode: its partner)`, JSON.stringify(await cueLook()));
    check(await page.eval(popOpen), `${tag}: they stay open after picking`);
    await tapAt(page, await centre(page, "#boldReset"));
    check((await page.eval(`localStorage.getItem("script-editor:boldStyle")`)) === null && (await cueLook())?.color === orange, `${tag}: Reset by tap`);
    await tapAt(page, await centre(page, "#askInput"));
    check(!(await page.eval(popOpen)), `${tag}: a tap elsewhere closes the colours`);
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
  await page.close();
}

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
    await barSend(page, "shorter");
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
    await barSend(page, "shorter");
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
  } else if (only === "followups") {
    await runAskInBold(1280, 800);
    await runAskInBold(390, 760);
    await runGuestSelection(1280, 800);
    await runBarPanned(390, 760);
  } else if (only === "menu") {
    await runMenuHeight(1280, 420);
    await runMenuHeight(390, 480);
  } else if (only === "refusals") {
    await runBoldRefuses(1280, 800);
    await runBoldKinds(1280, 800);
  } else if (only === "slim") {
    await runSlimBar(1280, 800);
    await runSlimBar(390, 760);
    await runBarPlace(1280, 800);
    await runBarPlace(1280, 420);
    await runBarPlace(390, 760);
    await runSlimGuest(1280, 800);
    await runSlimGuest(390, 760);
    await runSlimGuest(320, 640);
    await runNarrowBar(360, 740);
    await runNarrowBar(320, 640);
  } else if (only === "look") {
    await runBoldLook(1280, 800);
    await runBoldPop(1280, 800);
    await runBoldPop(1280, 420);
    await runBoldPop(390, 760);
    await runBoldPop(320, 640);
  } else if (only === "linkguest") {
    await runLinkGuest(1280, 800);
  } else if (only === "link") {
    await runLinkIcon(1280, 800);
    await runLinkIcon(390, 760);
    await runLinkGuest(1280, 800);
    await runLinkGuest(390, 760);
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
    await runLinkIcon(1280, 800);
    await runLinkIcon(390, 760);
    await runLinkGuest(1280, 800);
    await runLinkGuest(390, 760);
    await runSlimBar(1280, 800);
    await runSlimBar(390, 760);
    await runBarPlace(1280, 800);
    await runBarPlace(1280, 420);
    await runBarPlace(390, 760);
    await runSlimGuest(1280, 800);
    await runSlimGuest(390, 760);
    await runSlimGuest(320, 640);
    await runNarrowBar(360, 740);
    await runNarrowBar(320, 640);
    await runBoldLook(1280, 800);
    await runBoldPop(1280, 800);
    await runBoldPop(1280, 420);
    await runBoldPop(390, 760);
    await runBoldPop(320, 640);
    await runBoldRefuses(1280, 800);
    await runBoldKinds(1280, 800);
    await runAskInBold(1280, 800);
    await runAskInBold(390, 760);
    await runGuestSelection(1280, 800);
    await runBarPanned(390, 760);
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
