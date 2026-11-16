// Browser check for TOOLS-311: the parts a person uses rarely load on first use. With real clicks over CDP at 1280 and
// 390 px, watching every request: a new script with typing fetches no share room (together/room.js), export pack,
// folder writer or zip maker; opening the Export menu loads the export pack and Export all downloads the zip; Share to
// edit copies the link in the click and loads the room (the pointer over it already fetches it), and a guest's edit
// link loads it while the Join form shows;
// after a reload each part answers 304. While the room's part is held, Ctrl+Z still undoes the person's typing, and
// sharing stopped then starts no room and keeps the Undo steps from before. A part that
// can't load (its request refused) says so on its control: the share button, Export all and Save to video folder, and
// a guest's Join. Export all clicked while the pack is held zips the script of the click, even after another opens; a pack
// that fails after the video folder is picked writes nothing and says so; a folder saved while the pack loads holds the
// script as it was at the click. No CSP violation and no page error.
// Start the Worker with its assets first (`npx --yes wrangler@4 dev --port <port>`; it applies _headers and runs the
// rooms) and a headless Chrome, then: node scripts/smoke-rare-parts.mjs <base URL> <Chrome debugging port>
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


// The parts that load on first use, and the small startup files that stand in for them.
const RARE = ["/together/room.js", "/export-pack.js", "/video-folder.js", "/zip.js"];
const WATCHED = /\/(?:together\/(?:room|link)|export-pack|video-folder|zip|folder-note)\.js(?:\?|$)/;
const PACK = ["/export-pack.js", "/video-folder.js", "/zip.js"];

// fail / hold: URL patterns whose requests are refused (as a network blip would) or held until page.release().
async function openPage(width, height, { fail = [], hold = [] } = {}) {
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
    async key(key, code, keyCode, text) {
      for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, ...(type === "keyDown" && text ? { text } : {}) });
    },
    asked: [], // the watched files the page asked for
    got: [], // their answers on the wire: { url, status }
    held: [],
    failing: fail.length > 0,
    release: () => Promise.all(page.held.splice(0).map((requestId) => page.send("Fetch.continueRequest", { requestId }))),
    refuse: () => Promise.all(page.held.splice(0).map((requestId) => page.send("Fetch.failRequest", { requestId, errorReason: "Failed" }))),
    close: () => send("Target.disposeBrowserContext", { browserContextId }),
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Network.enable");
  const patterns = [...fail, ...hold].map((urlPattern) => ({ urlPattern }));
  if (patterns.length) await page.send("Fetch.enable", { patterns });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: COLLECT });
  page.log = [];
  const urls = new Map(); // requestId → path, for the watched files
  const held = (url) => hold.some((p) => url.includes(p.replace(/\*/g, "")));
  cdp.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.sessionId !== sessionId) return;
    if (m.method === "Log.entryAdded" && /Content Security Policy|Refused to/i.test(m.params.entry.text)) page.log.push(m.params.entry.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") page.log.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    if (m.method === "Runtime.exceptionThrown") page.log.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Network.requestWillBeSent" && WATCHED.test(m.params.request.url)) { page.asked.push(new URL(m.params.request.url).pathname); urls.set(m.params.requestId, new URL(m.params.request.url).pathname); }
    // The status on the wire (a 304 that Chrome then answers from its cache can show as 200 in responseReceived).
    if (m.method === "Network.responseReceivedExtraInfo" && urls.has(m.params.requestId)) page.got.push({ url: urls.get(m.params.requestId), status: m.params.statusCode });
    if (m.method === "Page.javascriptDialogOpening") page.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    if (m.method === "Fetch.requestPaused" && held(m.params.request.url)) page.held.push(m.params.requestId);
    else if (m.method === "Fetch.requestPaused") page.send("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "Failed" }).catch(() => {});
  });
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  return page;
}
async function clean(page, tag, what) {
  const seen = [...(await page.eval(`window.__csp.splice(0)`).catch(() => [])), ...page.log.splice(0)];
  // A request refused on purpose is the check's doing, not the page's.
  if (page.failing) seen.splice(0, seen.length, ...seen.filter((t) => !/room\.js|export-pack\.js|ERR_FAILED/.test(t)));
  check(seen.length === 0, `${tag} ${what}: no CSP violation or error`, [...new Set(seen)].join(" | ").slice(0, 400));
}
const asked = (page, files) => files.every((f) => page.asked.includes(f));
async function startScreen(page, url = `${BASE}/`) {
  await page.send("Page.navigate", { url });
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptyNew")`, "the start screen");
}
async function newScript(page, title) {
  await page.click("#emptyNew");
  await page.until(`!document.querySelector("#layout").hidden`, "the new script");
  await page.send("Input.insertText", { text: title });
  await page.key("Enter", "Enter", 13, "\r");
  await page.send("Input.insertText", { text: "Hello there my friend." });
  await sleep(300);
}
// The clipboard and downloads, stood in for: the copied link lands in window.__link, each download's name and first
// bytes (and its text, as stored zips keep it) in window.__downloads.
const STANDINS = `Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__link = t; } } });
  window.__downloads = []; const blobs = new Map(), make = URL.createObjectURL;
  URL.createObjectURL = (b) => { const u = make(b); blobs.set(u, b); return u; };
  HTMLAnchorElement.prototype.click = function () { const name = this.download; blobs.get(this.href).arrayBuffer().then((b) => { const text = [...new Uint8Array(b)].map((c) => String.fromCharCode(c)).join(""); window.__downloads.push({ name, head: text.slice(0, 2), text }); }); }; true`;
// How the share button looks: marked failed or not, its icon (and whether it shows), its text colour, and the colour of
// the save line's error state (the theme's warning look) for comparison.
const LOOK = `(() => {
  const b = document.querySelector("#shareBtn"), svg = b.querySelector("#shareIcon svg"), r = svg?.getBoundingClientRect();
  const probe = document.createElement("span"); probe.className = "save-state"; probe.dataset.state = "error"; document.body.append(probe);
  const warn = getComputedStyle(probe).color; probe.remove();
  return { failed: b.hasAttribute("data-failed"), icon: svg?.innerHTML || "", iconShown: !!r && r.width > 0 && r.height > 0, color: getComputedStyle(b).color, warn };
})()`;
// The button's accessible name as Chrome computes it (what a screen reader says).
async function axName(page, selector) {
  const { root } = await page.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  const { nodes } = await page.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
  return nodes.find((n) => !n.ignored)?.name?.value ?? "";
}
async function openExport(page) {
  await page.click("#exportBtn");
  return page.until(`document.querySelector("#exportMenu").matches(":popover-open")`, "the Export menu");
}

async function run(width, height) {
  const tag = `${width} px:`;

  // A new script, typed in: none of the rare parts is fetched; the small startup files are.
  const page = await openPage(width, height);
  await startScreen(page);
  await newScript(page, "Rare parts check");
  check(RARE.every((f) => !page.asked.includes(f)), `${tag} a new script with typing fetches no share room, zip maker or folder writer`, page.asked.join(", "));
  check(asked(page, ["/together/link.js", "/folder-note.js"]), `${tag} the small startup files (edit links, folder note) load with the page`, page.asked.join(", "));
  await clean(page, tag, "start and typing");

  // Opening the Export menu loads the export pack; Export all downloads a zip.
  await page.eval(STANDINS);
  await openExport(page);
  check(await page.until(`true`, "") && (await (async () => { for (let i = 0; i < 50 && !asked(page, PACK); i++) await sleep(100); return asked(page, PACK); })()), `${tag} opening the Export menu loads export-pack.js, video-folder.js and zip.js`, page.asked.join(", "));
  check(!page.asked.includes("/together/room.js"), `${tag} the Export menu fetches no share room`);
  await page.click('[data-export="all"]');
  check(await page.until(`window.__downloads.length === 1`, "the zip"), `${tag} Export all downloads one file`);
  const dl = await page.eval(`(({ name, head }) => ({ name, head }))(window.__downloads[0])`);
  check(/^[\w-]+\.zip$/.test(dl?.name) && !/video-folder/.test(dl.name) && dl.head === "PK", `${tag} it is the script's zip`, JSON.stringify(dl));
  await openExport(page);
  check(await page.eval(`document.querySelector("#zipNote").hidden && document.querySelector("#folderNote").hidden`), `${tag} no note on Export all or Save to video folder`);
  await page.key("Escape", "Escape", 27);
  await clean(page, tag, "Export menu and Export all");

  // Share to edit: the pointer reaching it fetches the room's part; the link is copied in the click; a guest's link loads
  // the part before the join.
  if (width >= 500) {
    const at = await page.eval(`(() => { const r = document.querySelector("#shareBtn").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
    for (let i = 0; i < 50 && !page.asked.includes("/together/room.js"); i++) await sleep(100);
    check(page.asked.includes("/together/room.js") && await page.eval(`!window.__link`), `${tag} the pointer over Share to edit fetches together/room.js before any click`);
  }
  await page.click("#shareBtn");
  check(await page.until(`/#room=[\\w-]{22}&k=[\\w-]{43}$/.test(window.__link || "")`, "the share link"), `${tag} Share to edit copies an edit link`);
  for (let i = 0; i < 50 && !page.asked.includes("/together/room.js"); i++) await sleep(100);
  check(page.asked.includes("/together/room.js"), `${tag} Share to edit loads together/room.js`);
  check(await page.until(`window.__scriptEditor.room()?.role === "host" && window.__scriptEditor.room().link === window.__link`, "the host's room"), `${tag} the room started is the one in the copied link`);
  check(await page.until(`document.querySelector("#shareLabel").textContent === "Link copied" && !document.querySelector("#stopShare").hidden`, "the button"), `${tag} the button says Link copied, with Stop sharing beside it`);
  const link = await page.eval(`window.__link`);
  const guest = await openPage(width, height);
  await guest.send("Page.navigate", { url: link });
  await guest.until(`!document.querySelector("#joinForm").hidden`, "the Join form");
  for (let i = 0; i < 50 && !guest.asked.includes("/together/room.js"); i++) await sleep(100);
  check(guest.asked.includes("/together/room.js"), `${tag} a guest's edit link loads together/room.js while the Join form shows`);
  check(!PACK.some((f) => guest.asked.includes(f)), `${tag} the guest fetches no export pack`);
  await guest.eval(`document.querySelector("#joinName").value = "Guest"`);
  await guest.click("#joinForm button");
  check(await guest.until(`(window.__scriptEditor.markdown() || "").includes("Hello there my friend.")`, "the guest's script", 12000), `${tag} the guest joins and gets the host's script`);
  check(await page.until(`window.__scriptEditor.room()?.people.length === 2`, "the guest with the host"), `${tag} the host sees the guest`);
  await clean(guest, `${tag} guest:`, "join");
  await clean(page, tag, "Share to edit");
  await guest.close();
  await page.click("#stopShare");
  check(await page.until(`!window.__scriptEditor.room() || window.__scriptEditor.room().status === "ended"`, "sharing stopped"), `${tag} Stop sharing ends the room`);

  // After a reload the parts come back as "not changed" (304).
  await page.send("Page.reload");
  await sleep(300);
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptyNew")`, "the start screen after a reload");
  page.got.splice(0);
  page.asked.splice(0);
  await newScript(page, "Rare parts again");
  await page.eval(STANDINS);
  await openExport(page);
  await page.key("Escape", "Escape", 27);
  await page.click("#shareBtn");
  await page.until(`!!window.__link`, "the share link after a reload");
  for (let i = 0; i < 50 && page.got.filter((r) => RARE.includes(r.url)).length < 4; i++) await sleep(100);
  const again = page.got.filter((r) => RARE.includes(r.url));
  check(again.length === 4 && again.every((r) => r.status === 304), `${tag} after a reload each part answers 304`, JSON.stringify(again));
  await page.click("#stopShare");
  await clean(page, tag, "after a reload");
  await page.close();

  // Sharing stopped while the room's part is on its way: no room starts.
  const held = await openPage(width, height, { hold: ["*together/room.js*"] });
  await startScreen(held);
  await newScript(held, "Held room");
  await held.eval(STANDINS);
  await held.click("#shareBtn");
  check(await held.until(`!!window.__link`, "the link while the room is held"), `${tag} with the room's part held, the link is still copied in the click`);
  for (let i = 0; i < 50 && !held.held.length; i++) await sleep(100);
  check(held.held.length > 0 && await held.eval(`!document.querySelector("#stopShare").hidden && window.__scriptEditor.room() === null`), `${tag} sharing shows as on while the part is held, with no room yet`);
  // The person's own Undo works while the part is on its way.
  const caretAtEnd = `(() => { const l = [...document.querySelectorAll('#script .block')].at(-1); l.focus(); const r = document.createRange(); r.selectNodeContents(l); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`;
  const undo = async () => { for (const type of ["keyDown", "keyUp"]) await held.send("Input.dispatchKeyEvent", { type, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 }); };
  await held.eval(caretAtEnd);
  await sleep(1700); // a new Undo step (typing after a pause)
  await held.send("Input.insertText", { text: " Undo me" });
  await held.until(`(window.__scriptEditor.markdown() || "").includes("Undo me")`, "the typing while held");
  await sleep(1700);
  await undo();
  check(await held.until(`!(window.__scriptEditor.markdown() || "").includes("Undo me") && (window.__scriptEditor.markdown() || "").includes("Hello there my friend.")`, "Undo while held"), `${tag} while the room's part is held, Ctrl+Z undoes the person's typing`);
  await held.click("#stopShare");
  await held.release();
  await sleep(800);
  check(await held.eval(`window.__scriptEditor.room() === null && document.querySelector("#shareLabel").textContent === "Share to edit"`), `${tag} sharing stopped before the part came: no room starts`);
  await held.eval(caretAtEnd);
  await undo();
  check(await held.until(`!(window.__scriptEditor.markdown() || "").includes("Hello there my friend.")`, "Undo after the stopped share"), `${tag} after that, the Undo steps from before the share are still there`);
  await clean(held, tag, "room held, sharing stopped");
  await held.close();

  // Export all clicked while the pack is on its way, then another script opened: the zip is the script of the click.
  const waitPack = await openPage(width, height, { hold: ["*export-pack.js*"] });
  await startScreen(waitPack);
  await newScript(waitPack, "Held export A");
  await waitPack.eval(STANDINS);
  await openExport(waitPack);
  for (let i = 0; i < 50 && !waitPack.held.length; i++) await sleep(100);
  check(waitPack.held.length > 0, `${tag} the export pack's download is held`);
  await waitPack.click('[data-export="all"]');
  // The menu may still be placing itself when it opens: the click is tried again until the other script is open.
  for (let i = 0; i < 5 && await waitPack.eval(`(window.__scriptEditor.markdown() || "").includes("Held export A")`); i++) {
    if (!(await waitPack.eval(`document.querySelector("#scriptMenu").matches(":popover-open")`))) await waitPack.click("#docSwitch");
    await waitPack.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
    await sleep(150);
    await waitPack.click("#menuNew");
    await sleep(400);
  }
  await waitPack.until(`!(window.__scriptEditor.markdown() || "").includes("Held export A")`, "the other script");
  await waitPack.send("Input.insertText", { text: "Held export B" });
  await sleep(200);
  check(await waitPack.eval(`window.__downloads.length === 0`), `${tag} Export all waits for the pack`);
  await waitPack.release();
  check(await waitPack.until(`window.__downloads.length === 1`, "the held zip"), `${tag} once the pack is here, one zip downloads`);
  await sleep(400);
  check(await waitPack.eval(`window.__downloads.length === 1 && window.__downloads[0].text.includes("Held export A") && !window.__downloads[0].text.includes("Held export B")`), `${tag} it holds the script on screen at the click, not the one opened since`);
  await clean(waitPack, tag, "Export all while the pack loads");
  await waitPack.close();

  // Save to video folder: the folder is picked in the click, then the pack fails: the item says so, nothing is written.
  const lateFail = await openPage(width, height, { hold: ["*export-pack.js*"] });
  lateFail.failing = true;
  await startScreen(lateFail);
  await newScript(lateFail, "Late failure");
  await lateFail.eval(`window.showDirectoryPicker = async () => { window.__picked = true; const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle("video", { create: true }); }; true`);
  await openExport(lateFail);
  for (let i = 0; i < 50 && !lateFail.held.length; i++) await sleep(100);
  await lateFail.click('[data-export="folder"]');
  await lateFail.until(`window.__picked === true`, "the folder picker");
  await sleep(200);
  await lateFail.refuse();
  await sleep(400);
  await openExport(lateFail);
  check(await lateFail.until(`document.querySelector("#folderNote").textContent === "Couldn't load. Reload the page." && !document.querySelector("#folderNote").hidden`, "the folder note"), `${tag} a pack that fails after the folder is picked: Save to video folder says to reload`);
  const written = await lateFail.eval(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("video"); const names = []; for await (const k of d.keys()) names.push(k); return names; })()`);
  check(written.length === 0, `${tag} nothing is written to the picked folder`, JSON.stringify(written));
  await lateFail.key("Escape", "Escape", 27);
  await clean(lateFail, tag, "pack that fails after the picker");
  await lateFail.close();

  // Save to video folder clicked while the pack is on its way, then more typing: the folder holds the script as it was at
  // the click, the same text in script.md and the cue files.
  const snap = await openPage(width, height, { hold: ["*export-pack.js*"] });
  await startScreen(snap);
  await newScript(snap, "Snapshot check");
  await snap.eval(`window.showDirectoryPicker = async () => { window.__picked = true; const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle("video", { create: true }); }; true`);
  await openExport(snap);
  for (let i = 0; i < 50 && !snap.held.length; i++) await sleep(100);
  await snap.click('[data-export="folder"]');
  await snap.until(`window.__picked === true`, "the folder picker");
  await sleep(200);
  await snap.eval(`(() => { const l = [...document.querySelectorAll('#script .block')].at(-1); l.focus(); const r = document.createRange(); r.selectNodeContents(l); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  await snap.send("Input.insertText", { text: " Typed later." });
  await snap.until(`(window.__scriptEditor.markdown() || "").includes("Typed later.")`, "the later typing");
  await snap.release();
  const readVideo = (name) => `(async () => { try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("video"); return await (await (await d.getFileHandle(${JSON.stringify(name)})).getFile()).text(); } catch { return ""; } })()`;
  await snap.until(`${readVideo("save-receipt.md")}.then((t) => t.length > 0)`, "the saved folder");
  const files = { script: await snap.eval(readVideo("script.md")), prompter: await snap.eval(readVideo("prompter.md")), notes: await snap.eval(readVideo("recording-notes.md")) };
  check(Object.values(files).every((t) => t.includes("Hello there my friend.") && !t.includes("Typed later.")), `${tag} a folder saved while the pack loads holds the script as it was at the click, in every file`, JSON.stringify(files).slice(0, 300));
  await clean(snap, tag, "folder saved while the pack loads");
  await snap.close();

  // Parts that can't load: each control says so, and nothing else breaks.
  const failing = await openPage(width, height, { fail: ["*together/room.js*", "*export-pack.js*"] });
  await startScreen(failing);
  await newScript(failing, "Failing parts");
  await failing.eval(STANDINS);
  const idle = await failing.eval(LOOK);
  await failing.click("#shareBtn");
  check(await failing.until(`document.querySelector("#shareLabel").textContent === "Couldn't share. Reload the page." && document.querySelector("#shareBtn").title === "Couldn't share. Reload the page."`, "the share failure"), `${tag} a room that can't load: the share button says to reload`);
  check(await failing.eval(`document.querySelector("#stopShare").hidden && window.__scriptEditor.room() === null`), `${tag} sharing is off again`);
  // The failure shows on the button itself, at every width: its own look and icon, and its name says what happened.
  const broken = await failing.eval(LOOK);
  check(broken.failed && !idle.failed, `${tag} the failed share button is marked data-failed`, JSON.stringify(broken));
  check(broken.icon !== idle.icon && broken.iconShown, `${tag} the failed share button shows a warning icon in place of the share icon`, JSON.stringify(broken));
  check(broken.color !== idle.color && broken.color === broken.warn, `${tag} the failed share button takes the warning colour`, `${idle.color} → ${broken.color}, warning ${broken.warn}`);
  check(await axName(failing, "#shareBtn") === "Couldn't share. Reload the page.", `${tag} the failed share button's name (what a screen reader says) is the failure`, await axName(failing, "#shareBtn"));
  await openExport(failing);
  check(await failing.until(`document.querySelector("#zipNote").textContent === "Couldn't load. Reload the page." && !document.querySelector("#zipNote").hidden && document.querySelector("#folderNote").textContent === "Couldn't load. Reload the page."`, "the export notes"), `${tag} an export pack that can't load: Export all and Save to video folder say to reload`);
  await failing.click('[data-export="all"]');
  await sleep(400);
  check(await failing.eval(`window.__downloads.length === 0`), `${tag} Export all then downloads nothing`);
  await failing.click("#exportBtn").catch(() => {});
  // The network is back: a click on the failed share button tries the room's part again, and sharing starts.
  await failing.send("Fetch.enable", { patterns: [{ urlPattern: "*export-pack.js*" }] });
  const before = failing.asked.filter((f) => f === "/together/room.js").length;
  await failing.click("#shareBtn");
  check(await failing.until(`!!window.__scriptEditor.room() && document.querySelector("#shareLabel").textContent === "Link copied" && !document.querySelector("#stopShare").hidden`, "the retried share"), `${tag} a click on the failed share button loads the room again and shares`);
  check(failing.asked.filter((f) => f === "/together/room.js").length > before, `${tag} the retry asked for together/room.js again`, failing.asked.join(", "));
  const back = await failing.eval(LOOK);
  check(!back.failed && back.color !== broken.color, `${tag} the button loses its failed look once sharing works`, JSON.stringify(back));
  check(await failing.eval(`window.__scriptEditor.room()?.link(location.origin) === window.__link`), `${tag} the room started is the one in the copied link`);
  await failing.click("#stopShare");
  await clean(failing, tag, "parts that can't load");
  await failing.close();

  const lost = await openPage(width, height, { fail: ["*together/room.js*"] });
  await lost.send("Page.navigate", { url: link });
  await lost.until(`!document.querySelector("#joinForm").hidden`, "the Join form");
  await lost.eval(`document.querySelector("#joinName").value = "Guest"`);
  await lost.click("#joinForm button");
  check(await lost.until(`document.querySelector("#emptyNote").textContent === "Couldn't load the edit link. Reload the page." && !document.querySelector("#emptyNote").hidden && document.querySelector("#joinForm").hidden`, "the guest's note"), `${tag} a guest whose room can't load is told to reload`);
  await clean(lost, `${tag} guest:`, "room that can't load");
  await lost.close();
}

await run(1280, 800);
await run(390, 844);
cdp.close();
console.log(failures ? `FAIL ${failures}` : "ok all");
process.exit(failures ? 1 : 0);
