#!/usr/bin/env node
// SE-01 / TOOLS-376: local throwaway scripts only. Start a local static server and a headless Chrome through kit bg,
// then run: node scripts/smoke-broll-undo.mjs http://127.0.0.1:<port> <Chrome debugging port>.
// Each run has a private browser context, disposed afterwards. It never connects an agent or opens existing scripts.
import assert from "node:assert/strict";
import { setMaxListeners } from "node:events";
const BASE = process.argv[2];
const PORT = process.argv[3];
assert.ok(BASE && ["127.0.0.1", "localhost"].includes(new URL(BASE).hostname), "Use a local copy only");
assert.ok(PORT, "Supply the local Chrome debugging port");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, label) => assert.ok(ok, label);
const COLLECT = `window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective));`;
const BROLL_FILES = /\/broll(?:-app)?\.js/;
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const cdp = new WebSocket(version.webSocketDebuggerUrl);
setMaxListeners(64, cdp); // one listener per page this check opens
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

async function openPage(width, height, { failBroll = false, holdBroll = false } = {}) {
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
    async until(expression, label, ms = 8000) {
      const end = Date.now() + ms;
      for (;;) {
        // A page still navigating has no elements yet: keep waiting.
        if (await page.eval(expression).catch(() => false)) return true;
        if (Date.now() > end) { check(false, `timed out: ${label}`); return false; }
        await sleep(60);
      }
    },
    // `late`: ms between finding the spot and pressing it, as a slow machine or a busy page would take.
    async click(selector, { late = 0 } = {}) {
      const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error(`nothing to press: ${selector}`);
      if (late) await sleep(late);
      for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 });
    },
    async key(key, code, keyCode, text) {
      for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, ...(type === "keyDown" && text ? { text } : {}) });
    },
    // Every B-roll file the page asked for, with the answer's status.
    broll: [],
    asked: [],
    held: [],
    release: () => Promise.all(page.held.splice(0).map((requestId) => page.send("Fetch.continueRequest", { requestId }))),
    close: () => send("Target.disposeBrowserContext", { browserContextId }),
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Network.enable");
  // The B-roll module's request refused, as a network blip or a server that can't send it would.
  // Or held until the check lets it go (page.release()).
  if (failBroll || holdBroll) await page.send("Fetch.enable", { patterns: [{ urlPattern: "*broll-app.js*" }] });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: COLLECT });
  page.log = [];
  cdp.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.sessionId !== sessionId) return;
    if (m.method === "Log.entryAdded" && /Content Security Policy|Refused to/i.test(m.params.entry.text)) page.log.push(m.params.entry.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") page.log.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    if (m.method === "Runtime.exceptionThrown") page.log.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Network.responseReceived" && BROLL_FILES.test(m.params.response.url)) page.broll.push({ url: new URL(m.params.response.url).pathname, status: m.params.response.status });
    if (m.method === "Network.requestWillBeSent" && BROLL_FILES.test(m.params.request.url)) page.asked.push(new URL(m.params.request.url).pathname);
    if (m.method === "Page.javascriptDialogOpening") page.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    if (m.method === "Fetch.requestPaused" && holdBroll) page.held.push(m.params.requestId);
    else if (m.method === "Fetch.requestPaused") page.send("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "Failed" }).catch(() => {});
  });
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  return page;
}

const page = await openPage(1440, 1000);
try {
  await page.send("Page.navigate", { url: BASE });
  await page.until(`!!window.__scriptEditor`, "editor loaded");
  await page.click("#emptyNew");
  await page.until(`!document.querySelector("#layout").hidden`, "throwaway script opened");
  await page.send("Input.insertText", { text: "Disposable SE-01" });
  await page.key("Enter", "Enter", 13, "\r");
  for (const text of ["First spoken paragraph.", "Second spoken paragraph.", "Third spoken paragraph."]) {
    await page.send("Input.insertText", { text });
    await page.key("Enter", "Enter", 13, "\r");
  }
  await page.eval(`(() => {
    const el = document.querySelector('#script .block[data-type="para"]');
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  })()`);
  await page.until(`!document.querySelector("#editBar").hidden`, "selection bar");
  await page.click("#askInput");
  await page.send("Input.insertText", { text: "add b-roll" });
  await page.key("Enter", "Enter", 13, "\r");
  await page.until(`!document.querySelector("#shotCard").hidden`, "add shot card");
  await page.send("Input.insertText", { text: "Throwaway shot" });
  await page.key("Enter", "Enter", 13, "\r");
  await page.until(`document.querySelector(".shot-frame__jump")`, "shot added");
  const original = await page.eval(`window.__scriptEditor.broll()[0]`);
  await page.eval(`(() => {
    const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find(e => e.textContent.includes("Third spoken"));
    el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  })()`);
  await page.send("Input.insertText", { text: " UNDO-SENTINEL-A" });
  const typed = await page.eval(`window.__scriptEditor.markdown()`);
  assert.match(typed, /UNDO-SENTINEL-A/);
  const positions = await page.eval(`(() => {
    const shot = document.querySelector(".shot-frame__jump").getBoundingClientRect();
    const para = [...document.querySelectorAll('#script .block[data-type="para"]')].find(e => e.textContent.includes("Second spoken")).getBoundingClientRect();
    return { from: { x: shot.x + shot.width / 2, y: shot.y + shot.height / 2 }, to: { x: para.x + 100, y: para.y + para.height / 2 } };
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...positions.from, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    const x = positions.from.x + (positions.to.x - positions.from.x) * i / 8;
    const y = positions.from.y + (positions.to.y - positions.from.y) * i / 8;
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    await sleep(30);
  }
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...positions.to, button: "left", buttons: 0, clickCount: 1 });
  await page.until(`window.__scriptEditor.broll()[0].over !== ${JSON.stringify(original.over)}`, "shot moved");
  const moved = await page.eval(`window.__scriptEditor.broll()[0]`);
  console.log(`PROOF before Undo: over=${JSON.stringify(moved.over)}, typing preserved=${await page.eval(`window.__scriptEditor.markdown() === ${JSON.stringify(typed)}`)}`);
  await page.eval(`document.querySelector(".shot-frame__jump").focus()`);
  for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
  await sleep(350);
  const after = await page.eval(`({ over: window.__scriptEditor.broll()[0].over, markdown: window.__scriptEditor.markdown() })`);
  console.log(`PROOF after Undo: over=${JSON.stringify(after.over)}, sentinel preserved=${after.markdown.includes("UNDO-SENTINEL-A")}`);
  assert.equal(after.markdown, typed, "Undo after moving B-roll preserves unrelated typing");
  assert.equal(after.over, original.over, "Undo restores the shot's original paragraph");
  console.log("RESULT: ok se01-browser undo restores shot and preserves typing");
} finally {
  await page.close();
  cdp.close();
}
