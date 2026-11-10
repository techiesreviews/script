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
  await page.until(`!!document.querySelector("#folderNote").textContent`, "the item shows the result");
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

await run(1280, 800);
await run(390, 800);
cdp.close();
console.log(failures ? `${failures} FAILED` : "all ok");
process.exit(failures ? 1 : 0);
