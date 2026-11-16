#!/usr/bin/env node
// Browser check for TOOLS-305: public/_headers sends a strict Content-Security-Policy. The main flows run with real
// clicks over CDP at 1280 and 390 px (open the demo, edit, save a new script, the B-roll list and the storyboard, an
// agent's line drawing and picture, the selection bar and bold colours, the prompter link, exports, Share to edit with a
// guest) and the page must see no CSP violation and no error. A request the CSP must refuse (another site) proves it is on.
// Start the Worker with its assets first (`npx --yes wrangler@4 dev --port <port>`; it applies _headers) and a headless
// Chrome, then: node scripts/smoke-csp.mjs <base URL> <Chrome debugging port>
// Its traffic goes to the base URL and the debugging port only (the refused request never leaves the browser).
const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const PORT = process.argv[3] || "9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "ok" : "FAIL"} ${label}${extra !== "" && !ok ? ` (${extra})` : ""}`);
  if (!ok) failures++;
};
const COLLECT = `window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + (e.blockedURI || "inline")));`;

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const cdp = new WebSocket(version.webSocketDebuggerUrl);
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
    async until(expression, label, ms = 8000) {
      const end = Date.now() + ms;
      for (;;) {
        // A page still navigating has no elements yet: keep waiting.
        if (await page.eval(expression).catch(() => false)) return true;
        if (Date.now() > end) { check(false, `timed out: ${label}`); return false; }
        await sleep(60);
      }
    },
    async click(selector) {
      const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error(`nothing to press: ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 });
    },
    close: () => send("Target.disposeBrowserContext", { browserContextId }),
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  // Every CSP violation the page sees, from the page's own event and from Chrome's console log.
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: COLLECT });
  page.log = [];
  cdp.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.sessionId !== sessionId) return;
    if (m.method === "Log.entryAdded" && /Content Security Policy|Refused to/i.test(m.params.entry.text)) page.log.push(m.params.entry.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") page.log.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    if (m.method === "Runtime.exceptionThrown") page.log.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  return page;
}


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
const doubleClick = async (page, at) => { for (const clickCount of [1, 2]) for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount }); await sleep(250); };
const wordSpot = `(() => { const l = [...document.querySelectorAll("#script .line__text, #script .line")].find((x) => x.textContent.includes("A blank page.")), w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const at = n.textContent.indexOf("deadline"); if (at < 0) continue; const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + 8); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } return null; })()`;
// The page's violations and errors so far, then cleared.
async function clean(page, tag, what) {
  const seen = [...(await page.eval(`window.__csp.splice(0)`)), ...page.log.splice(0)];
  check(seen.length === 0, `${tag} ${what}: no CSP violation or error`, [...new Set(seen)].join(" | ").slice(0, 400));
}

async function run(width, height) {
  const tag = `${width} px:`;
  const headers = (await fetch(`${BASE}/`)).headers;
  check(/script-src 'self'/.test(headers.get("content-security-policy") || ""), `${tag} the page comes with the CSP`);
  check(headers.get("cache-control") === "no-cache" && !!headers.get("etag"), `${tag} the page is checked with the server each visit (no-cache, ETag)`);
  const again = await fetch(`${BASE}/app.js`, { headers: { "If-None-Match": (await fetch(`${BASE}/app.js`)).headers.get("etag") } });
  check(again.status === 304, `${tag} an unchanged file comes back as "not changed" (304)`, again.status);

  const { token } = await (await fetch(`${BASE}/api/agent-token`, { method: "POST" })).json();
  const page = await openPage(width, height);
  await page.send("Page.navigate", { url: `${BASE}/` });
  await page.until(`document.readyState === "complete"`, "the page loads");
  await page.eval(`localStorage.setItem("script-editor:agent", JSON.stringify({ token: ${JSON.stringify(token)}, createdAt: Date.now() }))`);
  await page.send("Page.reload");
  await sleep(300);
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the start screen");

  // The CSP is on: another site is refused, a data: picture can be read back (the B-roll list's lighter pictures).
  check(await page.eval(`fetch("https://example.com/").then(() => false, () => true)`), `${tag} a request to another site is refused`);
  check((await page.eval(`window.__csp.splice(0).join(" ")`)).includes("connect-src"), `${tag} the refusal is the CSP's connect-src`);
  page.log.splice(0);
  check(await page.eval(`fetch("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==").then((r) => r.ok, () => false)`), `${tag} a data: picture can be read back`);
  await clean(page, tag, "start screen");

  // Open: the demo and its B-roll list, with the agent connected over the live relay.
  await page.click("#emptySample");
  await page.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the demo's shots");
  const agent = (name, args) => mcp(token, name, args);
  let linked = false;
  for (let i = 0; i < 40 && !linked; i++) { try { await agent("get_script", {}); linked = true; } catch { await sleep(150); } }
  check(linked, `${tag} the agent reaches the tab over the live relay (WebSocket)`);
  await clean(page, tag, "open the demo with its B-roll list");

  // B-roll: a line drawing waits for Keep, a picture goes in at once as a data: image.
  await agent("sketch_shot", { shotId: "B1", svg: `<svg viewBox="0 0 260 140"><circle class="s" cx="60" cy="70" r="30"/></svg>` });
  await page.until(`!!document.querySelector('#script .frame__img[data-pending]')`, "the line drawing");
  const png = await page.eval(`(() => { const c = document.createElement("canvas"); c.width = 400; c.height = 220; const g = c.getContext("2d"); g.fillStyle = "#274"; g.fillRect(0, 0, 400, 220); return c.toDataURL("image/png").split(",")[1]; })()`);
  const info = JSON.parse(await agent("upload_image", {}));
  const { imageId } = await (await fetch(info.url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: Buffer.from(png, "base64") })).json();
  await agent("sketch_shot", { shotId: "B2", imageId });
  check(await page.until(`[...document.querySelectorAll('#script img')].some((i) => i.src.startsWith("data:image/") && i.complete && i.naturalWidth > 0)`, "the agent's picture shows"), `${tag} the agent's picture shows as a data: image`);
  await clean(page, tag, "B-roll: an agent's drawing and picture");
  await page.click(`[data-view="board"]`);
  check(await page.until(`!document.querySelector("#board").hidden && document.querySelectorAll("#board img, #board svg").length > 0`, "the storyboard"), `${tag} the storyboard shows`);
  await clean(page, tag, "storyboard");
  await page.click(`[data-view="script"]`);
  await page.until(`!document.querySelector("#script").closest(".sheet").hidden`, "back to the script");

  // Edit: the selection bar and the bold colours (positions are set through the CSSOM, which the CSP allows).
  await page.eval(`scrollTo({ top: 0, behavior: "instant" })`);
  const spot = await page.eval(wordSpot);
  if (spot) {
    await doubleClick(page, spot);
    await page.until(`!document.querySelector("#editBar").hidden`, "the selection bar");
    check((await page.eval(`document.querySelector("#editBar").style.length`)) > 0, `${tag} the selection bar is placed (CSSOM style)`);
    await page.click("#boldBtn");
    await page.until(`document.querySelector("#boldPop").matches(":popover-open")`, "the bold colours");
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(150);
    await page.send("Input.insertText", { text: "promise" });
    check(await page.until(`document.querySelector("#script").textContent.includes("promise")`, "the typed word"), `${tag} typing replaces the selected word`);
  } else check(false, `${tag} a word to select`);
  await clean(page, tag, "edit");

  // The prompter link (opened in a new tab: captured here) and the exports (downloads through blob: links).
  await page.eval(`window.open = (u) => { window.__opened = u; return null; }; true`);
  await page.click("#exportBtn");
  await page.until(`document.querySelector("#exportMenu").matches(":popover-open")`, "the Export menu");
  await page.click(`[data-export="prompter-open"]`);
  await page.until(`!!window.__opened`, "the prompter link");
  check(/^https:\/\/prompter\.techies\.tools\/#s=[A-Za-z0-9_-]+/.test(await page.eval(`window.__opened`)), `${tag} Open in prompter makes the prompter link`);
  await page.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  for (const kind of ["camera", "storyboard", "all"]) {
    await page.click("#exportBtn");
    await page.until(`document.querySelector("#exportMenu").matches(":popover-open")`, "the Export menu");
    await page.click(`[data-export="${kind}"]`);
    await sleep(400);
  }
  await clean(page, tag, "prompter link and exports");

  // Share to edit: the room over a WebSocket, a guest joins; the host's section list shows the guest's dot in colour.
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
  // A click inside a section (the section list has no row for the lines above the first heading).
  const gspot = await guest.eval(`(() => { const l = document.querySelector("#script .section[data-sec] .line"); l.scrollIntoView({ block: "center" }); const b = l.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; })()`);
  await doubleClick(guest, gspot);
  await page.until(`!!document.querySelector('#toc .pdot--person[data-c]')`, "the guest's dot in the section list", 8000);
  const dot = await page.eval(`(() => { const d = document.querySelector('#toc .pdot--person[data-c]'); if (!d) return null; const probe = document.createElement("span"); probe.style.color = "var(--rc-" + d.dataset.c + ")"; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return { got: getComputedStyle(d).backgroundColor, want, style: d.getAttribute("style") }; })()`);
  check(!!dot && dot.got === dot.want && dot.style === null, `${tag} the guest's dot has the guest's colour, with no style attribute`, JSON.stringify(dot));
  await clean(guest, `${tag} guest:`, "join and select");
  await clean(page, tag, "Share to edit");
  await guest.close();
  await page.close();

  // Save: a new script is saved in the browser's private file system as the person types.
  const fresh = await openPage(width, height);
  await fresh.send("Page.navigate", { url: `${BASE}/` });
  await fresh.until(`document.readyState === "complete" && !!document.querySelector("#emptyNew")`, "the start screen");
  await fresh.click("#emptyNew");
  await fresh.until(`!document.querySelector("#layout").hidden`, "the new script");
  await fresh.send("Input.insertText", { text: "CSP check" });
  await fresh.until(`document.querySelector("#saveState").dataset.state === ""`, "saved");
  await sleep(1500);
  const saved = await fresh.eval(`(async () => { const r = await (await navigator.storage.getDirectory()).getDirectoryHandle("scripts"); for await (const [, h] of r.entries()) { if (h.kind !== "file") continue; const t = await (await h.getFile()).text(); if (t.includes("CSP check")) return true; } return false; })()`);
  check(saved, `${tag} a new script is saved with what was typed`);
  await clean(fresh, tag, "new script and save");
  await fresh.close();
}

await run(1280, 800);
await run(390, 844);
cdp.close();
console.log(failures ? `FAIL ${failures}` : "ok all");
process.exit(failures ? 1 : 0);
