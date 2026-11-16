#!/usr/bin/env node
// Browser check for TOOLS-306: the B-roll part (public/broll-app.js and broll.js) loads only on first use. With real
// clicks over CDP at 1280 and 390 px: a new script without B-roll fetches none of it; opening the Storyboard, an agent's
// B-roll call or the demo with its linked list loads it, and every B-roll flow then works as before (frames, the shot
// card, add a shot from the selection bar, the storyboard). After a reload the module comes back as "not changed" (304).
// B-roll from the "/" menu and B-roll asks in a reopened script's draft load it too. A module that can't load (the
// request refused) leaves a note on the Storyboard, an error for the agent, and the next script without B-roll saves
// to a video folder as before. The page must see no CSP violation and no error.
// Start the Worker with its assets first (`npx --yes wrangler@4 dev --port <port>`; it applies _headers) and a headless
// Chrome, then: node scripts/smoke-broll-lazy.mjs <base URL> <Chrome debugging port>
// Its traffic goes to the base URL and the debugging port only.
import { setMaxListeners } from "node:events";

const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const PORT = process.argv[3] || "9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "ok" : "FAIL"} ${label}${extra !== "" && !ok ? ` (${extra})` : ""}`);
  if (!ok) failures++;
};
const COLLECT = `window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + (e.blockedURI || "inline")));`;
const BROLL_FILES = /\/broll(?:-app)?\.js(?:\?|$)/;

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
async function clean(page, tag, what) {
  const seen = [...(await page.eval(`window.__csp.splice(0)`).catch(() => [])), ...page.log.splice(0)];
  // The module's request refused on purpose (failBroll) is the check's doing, not the page's.
  if (page.failBroll) seen.splice(0, seen.length, ...seen.filter((t) => !/broll-app\.js/.test(t)));
  check(seen.length === 0, `${tag} ${what}: no CSP violation or error`, [...new Set(seen)].join(" | ").slice(0, 400));
}
const loaded = (page) => new Set(page.broll.map((r) => r.url));
async function startScreen(page, token = null) {
  await page.send("Page.navigate", { url: `${BASE}/` });
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptyNew")`, "the start screen");
  if (token) {
    await page.eval(`localStorage.setItem("script-editor:agent", JSON.stringify({ token: ${JSON.stringify(token)}, createdAt: Date.now() }))`);
    await page.send("Page.reload");
    await sleep(300);
    await page.until(`document.readyState === "complete" && !!document.querySelector("#emptyNew")`, "the start screen");
  }
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
  return { error: !!(body?.result?.isError || body?.error), text: body?.result?.content?.[0]?.text ?? JSON.stringify(body.error) };
}
// Selects the word in the demo's line "A blank page." and waits for the selection bar.
async function selectDeadline(page) {
  await page.eval(`(() => { const l = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.includes("A blank page.")), w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const at = n.data.indexOf("deadline"); if (at < 0) continue; l.scrollIntoView({ block: "center" }); const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + 8); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; } })()`);
  return page.until(`!document.querySelector("#editBar").hidden`, "the selection bar");
}

async function run(width, height) {
  const tag = `${width} px:`;

  // A new script without B-roll: none of the B-roll part is fetched while it opens and the person types.
  const fresh = await openPage(width, height);
  await startScreen(fresh);
  await fresh.click("#emptyNew");
  await fresh.until(`!document.querySelector("#layout").hidden`, "the new script");
  await fresh.send("Input.insertText", { text: "A new line to check." });
  await sleep(800);
  check(loaded(fresh).size === 0, `${tag} a new script without B-roll fetches no B-roll code`, [...loaded(fresh)].join(", "));
  await clean(fresh, tag, "new script");
  // The Storyboard is B-roll: opening it loads the module, which draws the empty board.
  await fresh.click('#viewSwitch [data-view="board"]');
  check(await fresh.until(`!!document.querySelector("#board .board__link") && !!document.querySelector('#board [data-act="plan"]')`, "the empty storyboard"), `${tag} opening the Storyboard shows Link B-roll list and Plan B-roll`);
  check(loaded(fresh).has("/broll-app.js") && loaded(fresh).has("/broll.js"), `${tag} opening the Storyboard loads broll-app.js and broll.js`, [...loaded(fresh)].join(", "));
  await fresh.click('#viewSwitch [data-view="script"]');
  await fresh.until(`document.querySelector("#board").hidden`, "back to the script");
  await clean(fresh, tag, "storyboard on first use");
  await fresh.close();

  // The agent's B-roll call loads the module too: upload_image answers with an address in a script without a list.
  const { token } = await (await fetch(`${BASE}/api/agent-token`, { method: "POST" })).json();
  const agentPage = await openPage(width, height);
  await startScreen(agentPage, token);
  await agentPage.click("#emptyNew");
  await agentPage.until(`!document.querySelector("#layout").hidden`, "the new script");
  let linked = false;
  for (let i = 0; i < 40 && !linked; i++) { linked = !(await mcp(token, "get_script", {})).error; if (!linked) await sleep(150); }
  check(linked && loaded(agentPage).size === 0, `${tag} the agent is connected and no B-roll code is loaded yet`, [...loaded(agentPage)].join(", "));
  const up = await mcp(token, "upload_image", {});
  check(!up.error && up.text.includes("/mcp/images/"), `${tag} upload_image answers with an address once the module loads`, up.text.slice(0, 200));
  check(loaded(agentPage).has("/broll-app.js"), `${tag} the agent's B-roll call loaded broll-app.js`);
  const noList = await mcp(token, "sketch_shot", { shotId: "B1", svg: '<svg><rect class="s" x="1" y="1" width="9" height="9"/></svg>' });
  check(noList.error && /no B-roll list yet/.test(noList.text), `${tag} sketch_shot without a list says there is none`, noList.text.slice(0, 200));
  await clean(agentPage, tag, "agent's B-roll call");
  await agentPage.close();

  // The demo links its list: the module loads with it and every B-roll flow works.
  const page = await openPage(width, height);
  await startScreen(page);
  await page.click("#emptySample");
  check(await page.until(`document.querySelectorAll(".shot-frame").length >= 6`, "the demo's shots"), `${tag} the demo shows its shots beside the lines`);
  check(loaded(page).has("/broll-app.js"), `${tag} a script with a linked list loads broll-app.js`);
  const before = await page.eval(`window.__scriptEditor.broll().length`);
  // A frame opens the shot card; Escape puts it away.
  await page.click(".shot-frame__jump");
  check(await page.until(`!document.querySelector("#shotCard").hidden && /·/.test(document.querySelector("#scTitle").textContent)`, "the shot card"), `${tag} a frame opens its shot card`);
  await page.key("Escape", "Escape", 27);
  check(await page.until(`document.querySelector("#shotCard").hidden`, "the card closing"), `${tag} Escape closes the shot card`);
  // Add a shot from the selection bar: "add b-roll", What, Enter.
  await selectDeadline(page);
  await page.click("#askInput");
  await page.send("Input.insertText", { text: "add b-roll" });
  await sleep(100);
  await page.key("Enter", "Enter", 13, "\r");
  check(await page.until(`!document.querySelector("#shotCard").hidden && document.activeElement.id === "scWhat"`, "the Add B-roll card"), `${tag} add b-roll opens the card`);
  await page.send("Input.insertText", { text: "Lazy module check" });
  await page.key("Enter", "Enter", 13, "\r");
  check(await page.until(`window.__scriptEditor.broll().length === ${before + 1}`, "the new shot", 8000), `${tag} the new shot is in the list`);
  check(await page.until(`[...document.querySelectorAll(".shot-frame__jump")].some((b) => /Lazy module check/.test(b.getAttribute("aria-label") || ""))`, "its frame"), `${tag} its frame shows beside the line`);
  // The storyboard lists every shot; a frame there goes back to the script with that shot lit.
  await page.click('#viewSwitch [data-view="board"]');
  check(await page.until(`document.querySelectorAll("#board .frame").length === ${before + 1}`, "the storyboard"), `${tag} the storyboard shows every shot`);
  await page.click("#board .frame__jump");
  check(await page.until(`document.querySelector("#board").hidden && !!document.querySelector(".shot-frame[data-lit]")`, "back to the lit shot"), `${tag} a storyboard frame goes back to its lit shot`);
  await page.key("Escape", "Escape", 27);
  await clean(page, tag, "demo B-roll flows");
  // A reload asks the server again: the unchanged module comes back as "not changed".
  page.broll.length = 0;
  await page.send("Page.reload");
  await sleep(300);
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the start screen again");
  await page.click("#emptySample");
  await page.until(`document.querySelectorAll(".shot-frame").length >= 6`, "the demo's shots again");
  const again = page.broll.find((r) => r.url === "/broll-app.js");
  check(again?.status === 304, `${tag} after a reload broll-app.js is checked with the server and comes back "not changed" (304)`, JSON.stringify(page.broll));
  await clean(page, tag, "reload");
  await page.close();
}

// Opens a new script in the browser and types a title and one spoken line.
async function newScript(page, title) {
  await page.click("#emptyNew");
  await page.until(`!document.querySelector("#layout").hidden`, "the new script");
  await page.send("Input.insertText", { text: title });
  await page.key("Enter", "Enter", 13, "\r");
  await page.send("Input.insertText", { text: "Hello there my friend." });
  await sleep(300);
}

// Opens the script menu and waits for this open's list. The list is drawn just after the menu opens (a frame later, or
// longer on a slow disk), which moves "Open a script…" and "New script" down a row: a press found before that lands on
// the row above (TOOLS-309). Drawn means the open script is the current row and New script stays put for two frames.
async function openScriptMenu(page) {
  await page.click("#docSwitch");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await page.until(`new Promise((done) => {
    const y = () => document.querySelector("#menuNew").getBoundingClientRect().y, at = y(), now = document.querySelector("#fileName").textContent;
    const drawn = () => [...document.querySelectorAll("#scriptList .scripts__open[aria-current]")].some((b) => b.querySelector(".scripts__name").textContent === now);
    requestAnimationFrame(() => requestAnimationFrame(() => done(drawn() && y() === at)));
  })`, "the script menu's list");
}

async function runEdges(width, height) {
  const tag = `${width} px:`;

  // "/" on a spoken line of a script without a list: B-roll in the menu loads the module and opens the Add card.
  const slashPage = await openPage(width, height);
  await startScreen(slashPage);
  await newScript(slashPage, "Slash check");
  await slashPage.send("Input.insertText", { text: " /b" });
  check(await slashPage.until(`!document.querySelector("#slashMenu").hidden && !!document.querySelector('#slashMenu [data-part="broll"]')`, "B-roll in the / menu"), `${tag} the / menu offers B-roll on a spoken line`);
  check(slashPage.asked.length === 0, `${tag} before it is picked, no B-roll code is fetched`, slashPage.asked.join(", "));
  await slashPage.click('#slashMenu [data-part="broll"]');
  check(await slashPage.until(`!document.querySelector("#shotCard").hidden && document.activeElement.id === "scWhat"`, "the Add B-roll card"), `${tag} picking B-roll loads the module and opens the Add card`);
  check(slashPage.asked.includes("/broll-app.js"), `${tag} the / menu's B-roll loaded broll-app.js`);
  await clean(slashPage, tag, "B-roll from the / menu");
  await slashPage.close();

  // A reopened script whose draft holds B-roll suggestions loads the module and shows them beside the line.
  const draftPage = await openPage(width, height);
  await startScreen(draftPage);
  await newScript(draftPage, "Draft check");
  const askId = await draftPage.eval(`window.__scriptEditor.planAsk()`);
  const answered = await draftPage.eval(`window.__scriptEditor.answerBroll(${JSON.stringify(askId)}, { changes: [{ op: "add", kind: "broll", what: "Draft shot", how: "Stock clip", quote: "Hello there my friend." }] })`);
  check(answered === true && await draftPage.until(`!!document.querySelector(".shot-frame[data-suggested]")`, "the suggestion"), `${tag} a B-roll suggestion shows beside the line`, String(answered));
  // Saved (no "leave the page?" question), and the draft with the asks written (400 ms after a change).
  await draftPage.until(`document.querySelector("#saveState").dataset.state === ""`, "saved");
  await sleep(1500);
  draftPage.asked.length = 0;
  await draftPage.send("Page.reload");
  await sleep(300);
  await draftPage.until(`document.readyState === "complete" && !document.querySelector("#emptyReopen").hidden`, "Reopen on the start screen");
  check(draftPage.asked.length === 0, `${tag} the start screen fetches no B-roll code`, draftPage.asked.join(", "));
  await draftPage.click("#emptyReopen");
  check(await draftPage.until(`!!document.querySelector(".shot-frame[data-suggested]")`, "the suggestion again"), `${tag} reopened, its draft's suggestion shows again`);
  check(draftPage.asked.includes("/broll-app.js"), `${tag} the draft's B-roll asks loaded broll-app.js`);
  await clean(draftPage, tag, "draft with B-roll asks");
  await draftPage.close();

  // The module can't load: the Storyboard says so, the agent is told, and a script without B-roll still saves.
  const { token } = await (await fetch(`${BASE}/api/agent-token`, { method: "POST" })).json();
  const failPage = await openPage(width, height, { failBroll: true });
  failPage.failBroll = true;
  await startScreen(failPage, token);
  await newScript(failPage, "Fail check");
  await failPage.click('#viewSwitch [data-view="board"]');
  check(await failPage.until(`/Couldn't load the storyboard/.test(document.querySelector("#board").textContent)`, "the note on the storyboard"), `${tag} a module that can't load: the Storyboard says to reload`);
  let linked = false;
  for (let i = 0; i < 40 && !linked; i++) { linked = !(await mcp(token, "get_script", {})).error; if (!linked) await sleep(150); }
  const gone = await mcp(token, "sketch_shot", { shotId: "B1", svg: '<svg><rect class="s" x="1" y="1" width="9" height="9"/></svg>' });
  check(linked && gone.error && /could not load its B-roll part/.test(gone.text), `${tag} the agent's B-roll call is told to ask for a reload`, gone.text.slice(0, 200));
  await failPage.click('#viewSwitch [data-view="script"]');
  await failPage.until(`document.querySelector("#board").hidden`, "back to the script");
  await openScriptMenu(failPage);
  await failPage.click("#menuNew", { late: 150 });
  await failPage.until(`!window.__scriptEditor.markdown()?.includes("Fail check")`, "another new script");
  await failPage.until(`!document.querySelector("#scriptMenu").matches(":popover-open") && !document.querySelector("#exportBtn").hidden && document.querySelector("#saveState").dataset.state === ""`, "the new script settled");
  await sleep(500);
  await failPage.eval(`window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("video", { create: true }); true`);
  await failPage.click("#exportBtn");
  await failPage.until(`document.querySelector("#exportMenu").matches(":popover-open")`, "the Export menu");
  await failPage.click('[data-export="folder"]');
  const receipt = `(async () => { try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("video"); return await (await (await d.getFileHandle("save-receipt.md")).getFile()).text(); } catch { return ""; } })()`;
  check(await failPage.until(`${receipt}.then((t) => t.includes("B-roll: no list linked"))`, "the folder's receipt"), `${tag} after that, a script without B-roll saves to a video folder (no list linked)`, `${await failPage.eval(receipt)} | note: ${await failPage.eval(`document.querySelector("#folderNote").textContent + " / menu open: " + document.querySelector("#exportMenu").matches(":popover-open") + " / file: " + document.querySelector("#fileName").textContent`)}`);
  await clean(failPage, tag, "module that can't load");
  await failPage.close();

  // An agent's suggestion sent while the module loads is for the script open then: another script opened meanwhile
  // gets nothing, and the agent is told.
  const { token: t2 } = await (await fetch(`${BASE}/api/agent-token`, { method: "POST" })).json();
  const holdPage = await openPage(width, height, { holdBroll: true });
  await startScreen(holdPage, t2);
  await newScript(holdPage, "Hold check A");
  let on = false;
  for (let i = 0; i < 40 && !on; i++) { on = !(await mcp(t2, "get_script", {})).error; if (!on) await sleep(150); }
  const sent = mcp(t2, "answer_broll", { changes: [{ op: "add", kind: "broll", what: "Held shot", how: "Stock clip", quote: "Hello there my friend." }] });
  await holdPage.until(`true`, "the page");
  for (let i = 0; i < 50 && !holdPage.held.length; i++) await sleep(100);
  check(holdPage.held.length > 0, `${tag} the module's download is held while the agent's suggestion waits`);
  await openScriptMenu(holdPage);
  await holdPage.click("#menuNew", { late: 150 });
  await holdPage.until(`!window.__scriptEditor.markdown()?.includes("Hold check A")`, "script B");
  await holdPage.send("Input.insertText", { text: "Hold check B" });
  await holdPage.key("Enter", "Enter", 13, "\r");
  await holdPage.send("Input.insertText", { text: "Hello there my friend." });
  await sleep(300);
  await holdPage.release();
  const reply = await sent;
  check(reply.error && /opened another script meanwhile/.test(reply.text), `${tag} the agent hears the person opened another script`, reply.text.slice(0, 200));
  await sleep(500);
  check(await holdPage.eval(`!document.querySelector(".shot-frame[data-suggested]") && !window.__scriptEditor.asks().some((a) => a.scope === "broll")`), `${tag} the other script gets no suggestion`);
  await clean(holdPage, tag, "suggestion while the module loads");
  await holdPage.close();

  // The demo saved under its own name while the module is on its way keeps its list (its link goes along).
  const demoPage = await openPage(width, height, { holdBroll: true });
  await startScreen(demoPage);
  await demoPage.click("#emptySample");
  for (let i = 0; i < 50 && !demoPage.held.length; i++) await sleep(100);
  check(demoPage.held.length > 0, `${tag} the demo's module download is held`);
  await demoPage.until(`document.querySelector("#fileName").textContent === "demo-good-script.md"`, "the demo");
  await demoPage.eval(`document.querySelector('#script .block[data-type="para"]').focus()`);
  for (const type of ["keyDown", "keyUp"]) await demoPage.send("Input.dispatchKeyEvent", { type, key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
  check(await demoPage.until(`document.querySelector("#fileName").textContent !== "demo-good-script.md" && document.querySelector("#saveState").dataset.state === ""`, "saved in the browser"), `${tag} the demo is saved in the browser under its title's name while the module is held`);
  await demoPage.release();
  check(await demoPage.until(`document.querySelectorAll(".shot-frame").length >= 6`, "its shots"), `${tag} once the module is here, the saved demo shows its list`);
  await sleep(800);
  await demoPage.send("Page.reload");
  await sleep(300);
  await demoPage.until(`document.readyState === "complete" && !document.querySelector("#emptyReopen").hidden`, "Reopen on the start screen");
  await demoPage.click("#emptyReopen");
  // The reopened page asks for the module again: it is let through as it comes.
  for (let i = 0; i < 50; i++) { if (demoPage.held.length) await demoPage.release(); if (await demoPage.eval(`document.querySelectorAll(".shot-frame").length >= 6`).catch(() => false)) break; await sleep(100); }
  check(await demoPage.until(`document.querySelectorAll(".shot-frame").length >= 6`, "its shots after reopening"), `${tag} reopened, the saved demo still has its list`);
  await clean(demoPage, tag, "demo saved while the module loads");
  await demoPage.close();
}

await run(1280, 800);
await run(390, 844);
await runEdges(1280, 800);
await runEdges(390, 844);
cdp.close();
console.log(failures ? `FAIL ${failures}` : "ok all");
process.exit(failures ? 1 : 0);
