#!/usr/bin/env node
// Browser check for step X: Export → "Save to video folder", at 1280 and 390 px, with real clicks over CDP.
// The folder picker can't be driven headless, so the page's `showDirectoryPicker` is replaced by one that hands back a
// folder in the browser's private file system (a real FileSystemDirectoryHandle), which the check reads back.
// Serve public/ (for example `python3 -m http.server <port> --directory public`) and start a headless Chrome first, then:
// node scripts/smoke-video-folder.mjs <base URL> <Chrome debugging port>
// Its traffic goes to the base URL and the debugging port only.
const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const PORT = process.argv[3] || "9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "ok" : "FAIL"} ${label}${extra !== "" && !ok ? ` (${extra})` : ""}`);
  if (!ok) failures++;
};

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
// Requests held back by Fetch.enable, oldest first.
const paused = [];
cdp.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Fetch.requestPaused") paused.push(m.params);
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
        if (await page.eval(expression)) return true;
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
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  return page;
}

// Every file in the folder: { path: text | "bytes:<length>" }.
const LIST = `(async () => {
  const out = {};
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("video");
  const walk = async (d, prefix) => {
    for await (const [name, h] of d.entries()) {
      if (h.kind === "directory") await walk(h, prefix + name + "/");
      else { const f = await h.getFile(); out[prefix + name] = /\\.(png|jpg|webp)$/.test(name) ? "bytes:" + f.size : await f.text(); }
    }
  };
  await walk(dir, "");
  return out;
})()`;
const STUB = `window.showDirectoryPicker = async (o) => { window.__pickerOptions = o; const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle("video", { create: true }); }; true`;

async function run(width, height) {
  const tag = `${width} px:`;
  const page = await openPage(width, height);
  await page.send("Page.navigate", { url: `${BASE}/` });
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the start screen");
  await page.eval(`(async () => { const r = await navigator.storage.getDirectory(); await r.removeEntry("video", { recursive: true }).catch(() => {}); })()`);
  await page.click("#emptySample");
  await page.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the demo's shots");
  await page.eval(STUB);

  // The menu item is there, second, and says nothing before a save.
  await page.click("#exportBtn");
  await page.until(`document.querySelector("#exportMenu").matches(":popover-open")`, "the Export menu opens");
  const order = await page.eval(`[...document.querySelectorAll("#exportMenu .menu-action")].slice(0, 2).map((b) => b.dataset.export)`);
  check(JSON.stringify(order) === '["all","folder"]', `${tag} Save to video folder is second, after Export all`, JSON.stringify(order));
  check(await page.eval(`document.querySelector("#folderNote").hidden`), `${tag} no note before a save`);
  check(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), `${tag} the menu fits the width`);

  await page.click(`[data-export="folder"]`);
  await page.until(`/^Saved /.test(document.querySelector("#folderNote").textContent)`, "the item shows the result");
  const files = await page.eval(LIST);
  const names = Object.keys(files).sort();
  for (const n of ["script.md", "prompter.md", "recording-notes.md", "b-roll.md", "b-roll.json", "save-receipt.md"]) check(n in files, `${tag} ${n} is written`);
  check(names.some((n) => /^pictures\/.+\.(png|jpg|webp|svg)$/.test(n)), `${tag} pictures are in pictures/`, names.join(", "));
  check(files["prompter.md"] === files["recording-notes.md"], `${tag} the two cue files are the same`);
  check(!!files["script.md"] && files["script.md"].startsWith("# "), `${tag} the script is a Markdown script`);
  const json = JSON.parse(files["b-roll.json"] || "{}");
  check(json.shots?.length >= 8, `${tag} b-roll.json has the shots`, json.shots?.length);
  const pics = (json.shots || []).map((s) => s.picture).filter(Boolean);
  check(pics.length > 0 && pics.every((p) => p in files), `${tag} every picture b-roll.json names is a file`, pics.join(", "));
  check(pics.every((p) => (files["b-roll.md"] || "").includes(`](${p})`)), `${tag} b-roll.md links each picture file`);
  check(!(files["b-roll.md"] || "").includes("data:image"), `${tag} no embedded picture in b-roll.md`);
  check(/Saved: \d{4}-\d{2}-\d{2}/.test(files["save-receipt.md"] || "") && /Words: \d+/.test(files["save-receipt.md"] || ""), `${tag} the receipt has date and word count`);
  const note = await page.eval(`document.querySelector("#folderNote").textContent`);
  check(/^Saved \d{4}-\d{2}-\d{2} · [\d,]+ words$/.test(note), `${tag} the item's note says what happened`, note);
  check(await page.eval(`window.__pickerOptions?.mode === "readwrite"`), `${tag} the picker asks for write access`);
  check(await page.eval(`!document.querySelector(".toast, [role=alert]")`), `${tag} no toast`);

  // A cue file written by hand is kept on the next save.
  await page.eval(`(async () => { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle("video"); for (const n of ["prompter.md", "recording-notes.md"]) { const w = await (await d.getFileHandle(n)).createWritable(); await w.write("hand cues"); await w.close(); } })()`);
  await page.click("#exportBtn");
  await page.until(`document.querySelector("#exportMenu").matches(":popover-open")`, "the Export menu opens again");
  await page.click(`[data-export="folder"]`);
  await page.until(`/cue files kept/.test(document.querySelector("#folderNote").textContent)`, "the note says the cue files were kept");
  const again = await page.eval(LIST);
  check(again["prompter.md"] === "hand cues" && again["recording-notes.md"] === "hand cues", `${tag} hand-written cue files are kept`);
  check(again["script.md"] === files["script.md"], `${tag} the script is saved again, the same`);

  await page.close();
}

// The picker cancelled, the picker refused, and a browser with no folder picker (a zip with the same names).
async function runFallbacks() {
  const tag = "1280 px:";
  const page = await openPage(1280, 800);
  await page.send("Page.navigate", { url: `${BASE}/` });
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the start screen");
  await page.click("#emptySample");
  await page.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the demo's shots");
  const open = async () => { await page.click("#exportBtn"); await page.until(`document.querySelector("#exportMenu").matches(":popover-open")`, "the Export menu opens"); };
  await page.eval(`window.showDirectoryPicker = async () => { throw new DOMException("", "AbortError"); }; true`);
  await open();
  await page.click(`[data-export="folder"]`);
  await sleep(400);
  check(await page.eval(`document.querySelector("#folderNote").hidden`), `${tag} a cancelled picker leaves the item as it was`);
  await open();
  await page.eval(`window.showDirectoryPicker = async () => { throw new DOMException("", "NotAllowedError"); }; true`);
  await page.click(`[data-export="folder"]`);
  check(await page.until(`document.querySelector("#folderNote").textContent === "Could not save"`, "a refused picker says so on the item"), `${tag} a refused picker says "Could not save" on the item`);
  // A second click while the first save waits for its folder starts nothing.
  await page.eval(`window.__picks = 0; window.showDirectoryPicker = async () => { window.__picks++; await new Promise((r) => setTimeout(r, 500)); const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle("video", { create: true }); }; true`);
  await page.eval(`document.querySelector("#exportMenu").hidePopover(); true`);
  await open();
  await page.eval(`document.querySelector('[data-export="folder"]').click(); document.querySelector('[data-export="folder"]').click(); true`);
  await page.until(`/^Saved /.test(document.querySelector("#folderNote").textContent)`, "the overlapping clicks end in one save");
  check(await page.eval(`window.__picks === 1`), `${tag} two quick clicks open the picker once`, await page.eval(`window.__picks`));
  // A cancelled picker keeps the note of the save before it.
  await page.eval(`window.showDirectoryPicker = async () => { throw new DOMException("", "AbortError"); }; document.querySelector("#exportMenu").hidePopover(); true`);
  await open();
  await page.click(`[data-export="folder"]`);
  await sleep(300);
  check(await page.eval(`/^Saved /.test(document.querySelector("#folderNote").textContent)`), `${tag} a cancelled picker keeps the last note`, await page.eval(`document.querySelector("#folderNote").textContent`));
  await page.eval(`delete window.showDirectoryPicker; window.__downloads = []; const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); }; true`);
  await page.eval(`document.querySelector("#exportMenu").hidePopover(); true`);
  await open();
  await page.click(`[data-export="folder"]`);
  await page.until(`/^Downloaded \\d{4}-\\d{2}-\\d{2}/.test(document.querySelector("#folderNote").textContent)`, "the item says it downloaded");
  check(await page.eval(`document.querySelector("#folderLabel").textContent === "Save to video folder (.zip)"`), `${tag} the label says it is a zip here`);
  check(await page.eval(`window.__downloads.length === 1 && /-video-folder\\.zip$/.test(window.__downloads[0])`), `${tag} a zip named video-folder.zip is downloaded`, await page.eval(`JSON.stringify(window.__downloads)`));
  await page.close();
}

// A linked B-roll list that is still loading: the save writes nothing and the item says so; once the list is read the
// note goes away and a save works. The demo's list is held back with Fetch until the check lets it through.
async function runListNotReady() {
  const tag = "1280 px:";
  const page = await openPage(1280, 800);
  await page.send("Fetch.enable", { patterns: [{ urlPattern: "*demo-good-script-broll.md*", requestStage: "Request" }] });
  await page.send("Page.navigate", { url: `${BASE}/` });
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptySample")`, "the start screen");
  paused.length = 0;
  await page.click("#emptySample");
  for (let i = 0; i < 150 && !paused.length; i++) await sleep(60);
  check(paused.length === 1, `${tag} the demo's B-roll list is held back while it loads`, paused.length);
  if (!paused.length) return page.close();
  await page.eval(`window.__picks = 0; window.showDirectoryPicker = async () => { window.__picks++; const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle("video", { create: true }); }; true`);
  const open = async () => { await page.click("#exportBtn"); await page.until(`document.querySelector("#exportMenu").matches(":popover-open")`, "the Export menu opens"); };
  await open();
  await page.click(`[data-export="folder"]`);
  check(await page.until(`document.querySelector("#folderNote").textContent === "B-roll list still loading" && !document.querySelector("#folderNote").hidden`, "the item says the list is loading"), `${tag} a list still loading: the item says "B-roll list still loading"`);
  check(await page.eval(`window.__picks === 0`), `${tag} and the folder picker does not open`);
  await page.send("Fetch.continueRequest", { requestId: paused[0].requestId });
  await page.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the demo's shots");
  check(await page.until(`document.querySelector("#folderNote").hidden && document.querySelector("#folderNote").textContent === ""`, "the note goes away"), `${tag} once the list is read, the note is gone without another click`);
  await open();
  await page.click(`[data-export="folder"]`);
  check(await page.until(`/^Saved /.test(document.querySelector("#folderNote").textContent)`, "a save works now"), `${tag} then a save works`);
  check(await page.eval(`window.__picks === 1`), `${tag} the picker opened once, for that save`);
  await page.close();
}

await run(1280, 800);
await runFallbacks();
await runListNotReady();
await run(390, 800);
await run(320, 640);
cdp.close();
console.log(failures ? `${failures} FAILED` : "all ok");
process.exit(failures ? 1 : 0);
