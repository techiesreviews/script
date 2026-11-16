#!/usr/bin/env node
// Browser check for TOOLS-308: every way the editor saves a script, as it works on `dev` before saving moved into one
// module (and after: these checks must pass unchanged). Real typing and clicks over CDP at 1280 px.
// Files on the computer are stood in for by a folder "disk" in the browser's private file system: the page's
// `showOpenFilePicker` and `showSaveFilePicker` hand back real FileSystemFileHandles there, which the check reads back.
// Writes can be slowed down or refused per file name (window.__slow / window.__fail) to catch saves that cross.
// Start the Worker with its assets first (`npx --yes wrangler@4 dev --port <port>`; Share to edit needs its rooms) and a
// headless Chrome, then: node scripts/smoke-saving.mjs <base URL> <Chrome debugging port>
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
// "Leave site?" (an unsaved script on reload) is answered Leave, as a person reloading on purpose would.
cdp.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Page.javascriptDialogOpening" && m.sessionId) send("Page.handleJavaScriptDialog", { accept: true }, m.sessionId).catch(() => {});
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Chrome didn't answer ${method}`)); }, 20000);
  waiting.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  cdp.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

// Installed before the app's own scripts on every load (DevTools scripts are not subject to the page's CSP).
const STUBS = `(() => {
  const disk = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("disk", { create: true });
  window.__pick = null; // the "disk" file the open picker hands back
  window.showOpenFilePicker = async () => { if (!window.__pick) throw new DOMException("", "AbortError"); return [await (await disk()).getFileHandle(window.__pick, { create: true })]; };
  window.showSaveFilePicker = async (o) => { window.__saveAsked = o?.suggestedName; return (await disk()).getFileHandle(window.__saveAs || o.suggestedName, { create: true }); };
  window.__slow = {}; window.__fail = {}; window.__writes = [];
  const create = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = async function (...a) {
    if (window.__fail[this.name]) throw new DOMException("The file could not be written.", "NotAllowedError");
    const w = await create.apply(this, a), name = this.name, ms = window.__slow[name];
    const write = w.write.bind(w), close = w.close.bind(w);
    w.write = (data) => { window.__writes.push({ name, text: typeof data === "string" ? data : "(bytes)" }); return write(data); };
    if (ms) w.close = async () => { await new Promise((r) => setTimeout(r, ms)); return close(); };
    return w;
  };
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push(String(e.message)));
  addEventListener("unhandledrejection", (e) => window.__errors.push(String(e.reason?.message || e.reason)));
  document.addEventListener("securitypolicyviolation", (e) => window.__errors.push("CSP " + e.violatedDirective + " " + (e.blockedURI || "inline")));
})();`;

// One browser profile (its own private file system, IndexedDB and local storage) with any number of tabs.
async function openProfile() {
  const { browserContextId } = await send("Target.createBrowserContext");
  return {
    tab: (width = 1280, height = 800) => openTab(browserContextId, width, height),
    close: () => send("Target.disposeBrowserContext", { browserContextId }),
  };
}
async function openTab(browserContextId, width, height) {
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
        try { if (await page.eval(expression)) return true; } catch { /* the page is navigating */ }
        if (Date.now() > end) { check(false, `timed out: ${label}`); return false; }
        await sleep(60);
      }
    },
    async click(selector) {
      const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error(`nothing to press: ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 });
    },
    async press(key, code, vk, modifiers = 0) {
      for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers });
    },
    saveKey: () => page.press("s", "KeyS", 83, 2),
    // Types at the end of the last paragraph that holds `inside` (or the last paragraph).
    async typeAtEnd(text, inside = "") {
      await page.eval(`(() => { const ps = [...document.querySelectorAll('#script .block[data-type="para"]')].filter((x) => x.textContent.includes(${JSON.stringify(inside)})); const el = ps[ps.length - 1]; el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
      await page.send("Input.insertText", { text });
    },
    async open(path = "/") {
      await page.send("Page.navigate", { url: `${BASE}${path}` });
      await page.until(`document.readyState === "complete" && !!document.querySelector("#emptyNew")`, "the start screen");
    },
    async reload() {
      await page.send("Page.reload", { ignoreCache: false });
      await sleep(300);
      await page.until(`document.readyState === "complete" && !!document.querySelector("#emptyNew")`, "the start screen after a reload");
    },
    settled: (label = "the script is saved") => page.until(`!document.querySelector("#layout").hidden && document.querySelector("#saveState").dataset.state === ""`, label),
    script: () => page.eval(`document.querySelector("#script").textContent`),
    errors: () => page.eval(`window.__errors`),
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: STUBS });
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  return page;
}

// Reads a file from the private file system: "disk" stands for the computer, "scripts" is the editor's own.
const read = (page, dir, name) => page.eval(`(async () => { try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(${JSON.stringify(dir)}); return await (await (await d.getFileHandle(${JSON.stringify(name)})).getFile()).text(); } catch { return null; } })()`);
const list = (page, dir) => page.eval(`(async () => { const out = []; try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(${JSON.stringify(dir)}); for await (const [n, h] of d.entries()) if (h.kind === "file") out.push(n); } catch { /* none */ } return out.sort(); })()`);
// Writes a file on "disk" as another program would (a newer time, other text).
const writeOutside = (page, name, text) => page.eval(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("disk", { create: true }); const h = await d.getFileHandle(${JSON.stringify(name)}, { create: true }); const w = await h.createWritable(); await w.write(${JSON.stringify(text)}); await w.close(); return true; })()`);
const banner = (page) => page.eval(`document.querySelector("#banner").hidden ? "" : document.querySelector("#banner").textContent`);
const clickBanner = (page, label) => page.eval(`(() => { const b = [...document.querySelectorAll("#banner button")].find((x) => x.textContent === ${JSON.stringify(label)}); if (b) b.click(); return !!b; })()`);
async function openDisk(page, name) {
  await page.eval(`window.__pick = ${JSON.stringify(name)}; true`);
  if (await page.eval(`!document.querySelector("#layout").hidden`)) {
    await page.click("#docSwitch");
    await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
    await page.eval(`document.querySelector("#menuOpen").click(); true`); // the menu may still be settling under a pointer click
  } else await page.click("#emptyOpen");
  await page.until(`document.querySelector("#fileName")?.textContent === ${JSON.stringify(name)} && !document.querySelector("#layout").hidden`, `${name} is open`);
}
async function switchTo(page, name) {
  await page.click("#docSwitch");
  // The list is drawn again on every open: wait for this open's rows (the open script is the current one).
  await page.until(`(() => { const rows = [...document.querySelectorAll("#scriptList .scripts__open")], now = document.querySelector("#fileName").textContent, n = (b) => b.querySelector(".scripts__name").textContent; return document.querySelector("#scriptMenu").matches(":popover-open") && rows.some((b) => n(b) === now && b.hasAttribute("aria-current")) && rows.some((b) => n(b) === ${JSON.stringify(name)} && !b.hasAttribute("aria-current")); })()`, `${name} in the switcher`);
  await page.eval(`[...document.querySelectorAll("#scriptList .scripts__open")].find((b) => b.querySelector(".scripts__name").textContent === ${JSON.stringify(name)}).click()`);
  await page.until(`document.querySelector("#fileName").textContent === ${JSON.stringify(name)}`, `${name} is open again`);
}
async function exportItem(page, kind) {
  await page.click("#exportBtn");
  await page.until(`document.querySelector("#exportMenu").matches(":popover-open")`, "the Export menu");
  await page.click(`[data-export="${kind}"]`);
}
const FILE = (title, line) => `# ${title}\n\n${line}\n`;
const noErrors = async (page, what) => { const e = await page.errors(); check(!e.length, `${what}: no page error or CSP violation`, e.join(" | ")); };

// 1. A new script is saved in the browser at once, its file follows the title, typing auto-saves after a short pause
// and Ctrl+S saves at once.
async function runNewScript() {
  const profile = await openProfile();
  const page = await profile.tab();
  await page.open();
  await page.click("#emptyNew");
  await page.until(`!document.querySelector("#layout").hidden`, "the new script");
  check((await list(page, "scripts")).length === 1, "new script: saved in the browser at once", (await list(page, "scripts")).join());
  await page.send("Input.insertText", { text: "Saving plan" });
  await page.until(`document.querySelector("#fileName").textContent === "saving-plan.md"`, "the name follows the title", 6000);
  check(await page.eval(`document.querySelector("#fileName").textContent`) === "saving-plan.md", "new script: the file takes the title's name");
  check(JSON.stringify(await list(page, "scripts")) === '["saving-plan.md"]', "new script: the old name is gone from the browser", (await list(page, "scripts")).join());
  check((await read(page, "scripts", "saving-plan.md"))?.startsWith("# Saving plan"), "new script: the file holds the typed title");
  // Auto-save: not at once, but after about 1.5 s without typing.
  await page.typeAtEnd("First line typed.");
  const t0 = Date.now();
  await sleep(300);
  check(!(await read(page, "scripts", "saving-plan.md")).includes("First line typed."), "auto-save: nothing is written while typing goes on");
  check(await page.eval(`document.querySelector("#saveState").dataset.state === "dirty"`), "auto-save: the dot shows unsaved changes meanwhile");
  await page.until(`document.querySelector("#saveState").dataset.state === ""`, "auto-saved", 6000);
  const waited = Date.now() - t0;
  check((await read(page, "scripts", "saving-plan.md")).includes("First line typed."), "auto-save: the text is written after the pause");
  check(waited >= 1200, "auto-save: it waits about 1.5 s", waited);
  // Ctrl+S: written at once.
  await page.typeAtEnd(" Saved by key.");
  await page.saveKey();
  await sleep(400);
  check((await read(page, "scripts", "saving-plan.md")).includes("Saved by key."), "Ctrl+S: written at once, before the auto-save pause");
  // A new script left as it came is not kept when another one opens.
  await page.click("#docSwitch");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await page.click("#menuNew");
  await page.until(`document.querySelector("#fileName").textContent === "untitled-script.md"`, "a second new script");
  await switchTo(page, "saving-plan.md");
  await sleep(300);
  check(JSON.stringify(await list(page, "scripts")) === '["saving-plan.md"]', "a new script left untouched is not kept", (await list(page, "scripts")).join());
  // Reopen after a reload: the start screen offers the last script, with its saved text.
  await page.reload();
  check(await page.eval(`!document.querySelector("#emptyReopen").hidden && document.querySelector("#reopenLabel").textContent === "Reopen saving-plan.md"`), "reload: the start screen offers to reopen the browser script", await page.eval(`document.querySelector("#reopenLabel").textContent`));
  await page.click("#emptyReopen");
  await page.until(`document.querySelector("#fileName").textContent === "saving-plan.md"`, "reopened");
  check((await page.script()).includes("First line typed. Saved by key."), "reload: the reopened browser script has its saved text");
  check(await banner(page) === "", "reload: no unsaved-changes line for a saved script", await banner(page));
  await noErrors(page, "new script");
  await profile.close();
}

// 2. The demo (no file) keeps a draft in the browser; after a reload it offers "Unsaved changes from …" with Restore and
// Discard. Ctrl+S then saves it in the browser under its title's name.
async function runDraft() {
  const profile = await openProfile();
  const page = await profile.tab();
  await page.open();
  await page.click("#emptySample");
  await page.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the demo");
  await page.typeAtEnd(" Draft words here.", "page.");
  await page.until(`!!localStorage.getItem("script-editor:draft:demo-good-script.md")`, "the draft is kept", 3000);
  const draft = await page.eval(`JSON.parse(localStorage.getItem("script-editor:draft:demo-good-script.md"))`);
  check(draft?.text?.includes("Draft words here.") && draft.at > 0, "draft: kept in local storage with its time");
  check((await list(page, "scripts")).length === 0, "draft: the demo is not saved to a file by auto-save");
  await page.reload();
  await page.click("#emptySample");
  await page.until(`!document.querySelector("#banner").hidden`, "the unsaved-changes line");
  check(/^Unsaved changes from \d{1,2}:\d{2}/.test(await banner(page)) && (await banner(page)).includes("Restore") && (await banner(page)).includes("Discard"), "draft: after a reload the demo offers Restore and Discard", await banner(page));
  check(!(await page.script()).includes("Draft words here."), "draft: the script shows the file until Restore");
  await clickBanner(page, "Restore");
  await page.until(`document.querySelector("#script").textContent.includes("Draft words here.")`, "restored");
  check((await page.script()).includes("Draft words here."), "draft: Restore brings the typed words back");
  await page.reload();
  await page.click("#emptySample");
  await page.until(`!document.querySelector("#banner").hidden`, "the unsaved-changes line again");
  await clickBanner(page, "Discard");
  await sleep(300);
  check(!(await page.script()).includes("Draft words here.") && await banner(page) === "", "draft: Discard keeps the file's text");
  check(await page.eval(`localStorage.getItem("script-editor:draft:demo-good-script.md") === null`), "draft: Discard removes the kept draft");
  // Ctrl+S on the demo: into the browser, named after its title.
  await page.typeAtEnd(" Kept by key.", "page.");
  await page.saveKey();
  await page.until(`document.querySelector("#fileName").textContent !== "demo-good-script.md"`, "the demo saved under a new name");
  const name = await page.eval(`document.querySelector("#fileName").textContent`);
  check(/\.md$/.test(name) && (await list(page, "scripts")).includes(name), "Ctrl+S on the demo saves it in the browser", name);
  check((await read(page, "scripts", name))?.includes("Kept by key."), "Ctrl+S on the demo: the file holds what was typed");
  await noErrors(page, "draft");
  await profile.close();
}

// 3. A file opened from the computer: auto-save writes to it; changed on disk shows "The file changed on disk at …"
// with "Save mine" and "Open that version"; reopening it after a reload; "Allow saving to …" when the browser has not
// given write access yet.
async function runDiskFile() {
  const profile = await openProfile();
  const page = await profile.tab();
  await page.open();
  await writeOutside(page, "talk.md", FILE("Talk", "Opening line."));
  await openDisk(page, "talk.md");
  await page.typeAtEnd(" Added here.");
  await page.settled("talk.md saved");
  check(await read(page, "disk", "talk.md") === FILE("Talk", "Opening line. Added here."), "disk file: auto-save writes to the opened file", await read(page, "disk", "talk.md"));
  check(!(await list(page, "scripts")).length, "disk file: no copy in the browser");
  // Changed on disk: the next save stops and asks.
  await sleep(50);
  await writeOutside(page, "talk.md", FILE("Talk", "Edited elsewhere."));
  await page.typeAtEnd(" Mine.");
  await page.until(`!document.querySelector("#banner").hidden`, "the changed-on-disk line", 6000);
  check(/^The file changed on disk at \d{1,2}:\d{2}/.test(await banner(page)), "changed on disk: the line says when", await banner(page));
  check(await read(page, "disk", "talk.md") === FILE("Talk", "Edited elsewhere."), "changed on disk: the other version is not written over");
  await sleep(2000);
  check(await read(page, "disk", "talk.md") === FILE("Talk", "Edited elsewhere."), "changed on disk: auto-save waits for the person's choice");
  await clickBanner(page, "Save mine");
  await page.settled("saved after Save mine");
  check(await read(page, "disk", "talk.md") === FILE("Talk", "Opening line. Added here. Mine."), "changed on disk: Save mine writes this version", await read(page, "disk", "talk.md"));
  // Open that version: the file's text shows, and what was on screen waits as a draft.
  await sleep(50);
  await writeOutside(page, "talk.md", FILE("Talk", "Second outside edit."));
  await page.typeAtEnd(" Not kept.");
  await page.until(`!document.querySelector("#banner").hidden`, "the changed-on-disk line again", 6000);
  await clickBanner(page, "Open that version");
  await page.until(`document.querySelector("#script").textContent.includes("Second outside edit.")`, "that version opens");
  check(/^Unsaved changes from/.test(await banner(page)), "Open that version: the screen's text waits as unsaved changes", await banner(page));
  await clickBanner(page, "Restore");
  await page.until(`document.querySelector("#script").textContent.includes("Not kept.")`, "restored");
  await page.settled("saved after Restore");
  check((await read(page, "disk", "talk.md")).includes("Not kept."), "Open that version, then Restore: saved to the file again");
  // Reopen after a reload.
  await page.reload();
  check(await page.eval(`document.querySelector("#reopenLabel").textContent === "Reopen talk.md" && !document.querySelector("#emptyReopen").hidden`), "reload: the start screen offers to reopen the file");
  await page.click("#emptyReopen");
  await page.until(`document.querySelector("#fileName").textContent === "talk.md"`, "talk.md reopened");
  check((await page.script()).includes("Not kept."), "reload: the reopened file shows its saved text");
  await noErrors(page, "disk file");
  // No write access yet: auto-save shows "Allow saving to talk.md" and writes nothing until it is clicked.
  await page.eval(`window.__grant = false; FileSystemHandle.prototype.queryPermission = async function () { return window.__grant ? "granted" : "prompt"; }; FileSystemHandle.prototype.requestPermission = async function () { return window.__grant ? "granted" : "denied"; }; true`);
  await page.typeAtEnd(" Needs access.");
  await page.until(`!document.querySelector("#allowSave").hidden`, "Allow saving", 6000);
  check(await page.eval(`document.querySelector("#allowSave").textContent`) === "Allow saving to talk.md", "permission: auto-save asks with Allow saving to talk.md");
  check(!(await read(page, "disk", "talk.md")).includes("Needs access."), "permission: nothing is written without access");
  await page.eval(`window.__grant = true; true`);
  await page.click("#allowSave");
  await page.settled("saved after Allow");
  check((await read(page, "disk", "talk.md")).includes("Needs access.") && await page.eval(`document.querySelector("#allowSave").hidden`), "permission: Allow saving writes the file and goes away");
  // Ctrl+S without access is an error on the save state, not a silent loss.
  await page.eval(`window.__grant = false; true`);
  await page.typeAtEnd(" Refused.");
  await page.saveKey();
  await page.until(`document.querySelector("#saveState").dataset.state === "error"`, "Not saved");
  check(await page.eval(`document.querySelector("#saveState").textContent === "Not saved" && document.querySelector("#saveState").title === "No permission to write this file."`), "permission: a refused Ctrl+S shows Not saved with the reason");
  await profile.close();
}

// 4. Export → "Markdown file (.md)" moves a browser script to a file on the computer: the browser copy goes and later
// typing saves to the file. The prompter link and Save to video folder carry the saved script.
async function runMoveToFile() {
  const profile = await openProfile();
  const page = await profile.tab();
  await page.open();
  await page.click("#emptyNew");
  await page.until(`!document.querySelector("#layout").hidden`, "the new script");
  await page.send("Input.insertText", { text: "Move me" });
  await page.typeAtEnd("A line to move.");
  await page.until(`document.querySelector("#fileName").textContent === "move-me.md"`, "named after its title", 6000);
  await page.settled();
  await exportItem(page, "markdown");
  await page.until(`document.querySelector("#saveAsAction").hidden`, "the script is a file now");
  check(await page.eval(`window.__saveAsked`) === "move-me.md", "Save as: the picker suggests the script's name", await page.eval(`window.__saveAsked`));
  check((await read(page, "disk", "move-me.md"))?.includes("A line to move."), "Save as: the file on the computer holds the script");
  await page.until(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("scripts"); for await (const x of d.keys()) return false; return true; })()`, "the browser copy goes");
  check(!(await list(page, "scripts")).length, "Save as: the browser copy is gone", (await list(page, "scripts")).join());
  await page.typeAtEnd(" After the move.");
  await page.settled("saved after the move");
  check((await read(page, "disk", "move-me.md")).includes("After the move."), "Save as: later typing saves to the new file");
  await page.click("#docSwitch");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  check(await page.until(`(() => { const r = [...document.querySelectorAll("#scriptList .scripts__open")].find((b) => b.querySelector(".scripts__name").textContent === "move-me.md"); return !!r && !r.querySelector(".scripts__tag"); })()`, "the switcher row"), "Save as: the switcher no longer tags it Browser");
  await page.press("Escape", "Escape", 27);
  // The prompter link carries the script as it is now.
  await page.eval(`window.open = (u) => { window.__opened = u; return null; }; true`);
  await sleep(400);
  await exportItem(page, "prompter-open");
  await page.until(`!!window.__opened`, "the prompter link");
  const carried = await page.eval(`(async () => { const q = new URLSearchParams(new URL(window.__opened).hash.slice(1)); const s = q.get("s"); const b = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4); const st = new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("deflate-raw")); return new TextDecoder().decode(await new Response(st).arrayBuffer()); })()`);
  check(carried.includes("After the move."), "prompter link: carries the script's latest text", carried.slice(0, 80));
  // Save to video folder: script.md is the saved script.
  await page.eval(`window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("video", { create: true }); true`);
  await exportItem(page, "folder");
  await page.until(`/^Saved /.test(document.querySelector("#folderNote").textContent)`, "the folder save");
  check(await read(page, "video", "script.md") === await read(page, "disk", "move-me.md"), "video folder: script.md is the saved script");
  check(/^https:\/\/prompter\.techies\.tools\/#s=/.test(await read(page, "video", "prompter-link.txt") || ""), "video folder: prompter-link.txt is written");
  await noErrors(page, "move to file");
  await profile.close();
}

// 5. Switching scripts while a save runs: every save goes to the script it was made for, a script whose write fails
// keeps its words as unsaved changes, and a B-roll link never moves to another script.
async function runSwitch() {
  const profile = await openProfile();
  const page = await profile.tab();
  await page.open();
  await writeOutside(page, "alpha.md", FILE("Alpha", "Alpha start."));
  await writeOutside(page, "bravo.md", FILE("Bravo", "Bravo start."));
  await openDisk(page, "alpha.md");
  await openDisk(page, "bravo.md");
  await switchTo(page, "alpha.md");
  // Alpha's write is slow: Ctrl+S starts it, more typing waits for it, then the person switches to Bravo and saves.
  await page.eval(`window.__slow["alpha.md"] = 900; true`);
  await page.typeAtEnd(" Alpha one.");
  await page.saveKey();
  await sleep(100);
  await page.typeAtEnd(" Alpha two.");
  await switchTo(page, "bravo.md");
  await page.typeAtEnd(" Bravo one.");
  await page.saveKey();
  await page.until(`(async () => { const t = (n) => navigator.storage.getDirectory().then((r) => r.getDirectoryHandle("disk")).then((d) => d.getFileHandle(n)).then((h) => h.getFile()).then((f) => f.text()); return (await t("alpha.md")).includes("Alpha two.") && (await t("bravo.md")).includes("Bravo one."); })()`, "both files written", 8000);
  check(await read(page, "disk", "alpha.md") === FILE("Alpha", "Alpha start. Alpha one. Alpha two."), "switch: alpha.md gets all of Alpha's words", await read(page, "disk", "alpha.md"));
  check(await read(page, "disk", "bravo.md") === FILE("Bravo", "Bravo start. Bravo one."), "switch: bravo.md gets only Bravo's words", await read(page, "disk", "bravo.md"));
  const crossed = (await page.eval(`window.__writes`)).filter((w) => (w.name === "alpha.md" && w.text.includes("Bravo")) || (w.name === "bravo.md" && w.text.includes("Alpha")));
  check(!crossed.length, "switch: no write ever went to the other script's file", JSON.stringify(crossed));
  await page.eval(`window.__slow = {}; true`);
  await page.settled("Bravo settled");
  await switchTo(page, "alpha.md");
  check(await banner(page) === "", "switch: Alpha reopens with no unsaved changes", await banner(page));
  // A left script whose write fails keeps its words: reopening offers them back.
  await page.eval(`window.__fail["alpha.md"] = true; true`);
  await page.typeAtEnd(" Alpha lost?");
  await switchTo(page, "bravo.md");
  await sleep(500);
  check(!(await read(page, "disk", "alpha.md")).includes("Alpha lost?"), "failed write: alpha.md could not be written");
  check(await banner(page) === "" && await page.eval(`document.querySelector("#saveState").dataset.state !== "error"`), "failed write: Alpha's problem does not show on Bravo");
  await page.eval(`window.__fail = {}; true`);
  await switchTo(page, "alpha.md");
  await page.until(`!document.querySelector("#banner").hidden`, "Alpha's unsaved changes");
  check(/^Unsaved changes from/.test(await banner(page)), "failed write: reopening Alpha offers its unsaved words", await banner(page));
  await clickBanner(page, "Restore");
  await page.settled("Alpha saved after Restore");
  check((await read(page, "disk", "alpha.md")).includes("Alpha lost?"), "failed write: Restore saves the words to alpha.md");
  await noErrors(page, "switch");
  await profile.close();
}

// 6. A B-roll link stays with its own script: with the B-roll part loaded (the demo), another script opens while its
// link lookup is held, and is saved under a new name before the lookup ends; it must not take the demo's list.
async function runBrollLink() {
  const profile = await openProfile();
  const page = await profile.tab();
  await page.open();
  await page.click("#emptySample");
  await page.until(`document.querySelectorAll(".shot-frame").length >= 8`, "the demo with its list");
  // Hold every IndexedDB read of a "broll:talk.md" key until the check lets it go.
  await page.eval(`(() => { window.__held = []; const get = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function (k) { const r = get.call(this, k); if (k === "broll:talk.md" && !window.__let) { let done = null; Object.defineProperty(r, "onsuccess", { configurable: true, set(f) { done = f; window.__held.push(() => f.call(r, { target: r })); }, get() { return done; } }); } return r; }; return true; })()`);
  await page.eval(`(() => { const i = document.querySelector("#fileInput"), d = new DataTransfer(); d.items.add(new File([${JSON.stringify(FILE("Talk notes", "No list here."))}], "talk.md", { type: "text/markdown" })); i.files = d.files; i.dispatchEvent(new Event("change")); return true; })()`);
  await page.until(`document.querySelector("#fileName").textContent === "talk.md"`, "talk.md (no file handle) is open");
  await page.until(`window.__held.length > 0`, "the link lookup is held");
  await page.typeAtEnd(" Saved meanwhile.");
  await page.saveKey();
  await sleep(600);
  await page.eval(`window.__let = true; window.__held.forEach((f) => f()); true`);
  await page.until(`document.querySelector("#fileName").textContent === "talk-notes.md"`, "saved under the title's name");
  await page.settled("talk saved");
  const name = await page.eval(`document.querySelector("#fileName").textContent`);
  check((await read(page, "scripts", name))?.includes("Saved meanwhile."), "B-roll link: the script is saved in the browser under its title's name", name);
  await sleep(400);
  const link = await page.eval(`new Promise((res) => { const r = indexedDB.open("script-editor", 1); r.onsuccess = () => { const q = r.result.transaction("handles").objectStore("handles").get("broll:" + ${JSON.stringify(name)}); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res("error"); }; r.onerror = () => res("error"); })`);
  check(link === null || link?.none === true, "B-roll link: the saved script does not take the demo's list", JSON.stringify(link));
  check(await page.eval(`document.querySelectorAll(".shot-frame").length === 0`), "B-roll link: no demo shots beside the saved script");
  await profile.close();
}

// 7. Two tabs on one file: the second tab's save sees the first tab's write and asks instead of writing over it.
async function runTwoTabs() {
  const profile = await openProfile();
  const one = await profile.tab();
  await one.open();
  await writeOutside(one, "shared.md", FILE("Shared", "Both tabs."));
  await openDisk(one, "shared.md");
  const two = await profile.tab();
  await two.open();
  await openDisk(two, "shared.md");
  await one.send("Page.bringToFront");
  await one.typeAtEnd(" From tab one.");
  await one.settled("tab one saved");
  await two.send("Page.bringToFront");
  await two.typeAtEnd(" From tab two.");
  await two.until(`!document.querySelector("#banner").hidden`, "tab two's changed-on-disk line", 6000);
  check(/^The file changed on disk at/.test(await banner(two)), "two tabs: the second tab sees the first tab's save", await banner(two));
  check(await read(two, "disk", "shared.md") === FILE("Shared", "Both tabs. From tab one."), "two tabs: the first tab's words are not written over");
  await noErrors(one, "two tabs (one)");
  await noErrors(two, "two tabs (two)");
  await profile.close();
}

// 8. Share to edit: a guest's typing reaches the host's file through the host's own save; the guest's browser keeps
// no copy and Ctrl+S there writes nothing.
async function runShare() {
  const host = await openProfile();
  const page = await host.tab();
  await page.open();
  await writeOutside(page, "joint.md", FILE("Joint", "Host line."));
  await openDisk(page, "joint.md");
  await page.eval(`Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__link = t; } } }); true`);
  await page.click("#shareBtn");
  await page.until(`!!window.__link`, "the share link");
  const guestProfile = await openProfile();
  const guest = await guestProfile.tab();
  await guest.send("Page.navigate", { url: await page.eval(`window.__link`) });
  await guest.until(`!document.querySelector("#joinForm").hidden`, "the Join form", 10000);
  await guest.eval(`document.querySelector("#joinName").value = "Guest"; true`);
  await guest.click("#joinForm button");
  await guest.until(`document.querySelector("#script").textContent.includes("Host line.")`, "the guest's copy", 12000);
  await guest.send("Page.bringToFront");
  await guest.typeAtEnd(" Guest words.", "Host line.");
  await guest.saveKey();
  await page.until(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("disk"); return (await (await (await d.getFileHandle("joint.md")).getFile()).text()).includes("Guest words."); })()`, "the host's file has the guest's words", 10000);
  check((await read(page, "disk", "joint.md")).includes("Host line. Guest words."), "share: the guest's words are saved to the host's file");
  check(!(await list(guest, "scripts")).length && !(await list(guest, "disk")).length, "share: the guest's browser keeps no copy");
  check(!(await guest.eval(`window.__writes`)).length, "share: the guest's Ctrl+S writes nothing");
  check(await guest.eval(`Object.keys(localStorage).every((k) => !k.startsWith("script-editor:draft:"))`), "share: the guest keeps no draft");
  await noErrors(page, "share (host)");
  await noErrors(guest, "share (guest)");
  await guestProfile.close();
  await host.close();
}

const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
for (const run of [runNewScript, runDraft, runDiskFile, runMoveToFile, runSwitch, runBrollLink, runTwoTabs, runShare]) {
  if (only && !only.includes(run.name)) continue;
  try { await run(); } catch (e) { check(false, `${run.name} stopped`, e.message); }
}
cdp.close();
console.log(failures ? `FAIL ${failures}` : "ok all");
process.exit(failures ? 1 : 0);
