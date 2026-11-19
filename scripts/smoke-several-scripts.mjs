#!/usr/bin/env node
// Browser check for TOOLS-358 (several scripts): while the person writes one script, their agent answers an ask in
// another. Real typing and clicks over CDP, at 1280 px and at 390 px (a phone), with the agent played over /mcp.
// The scripts are made up and live in the browser's private file system of a fresh profile.
// Start the Worker with its assets first (`npx --yes wrangler@4 dev --port <port>`) and a headless Chrome, then:
//   node scripts/smoke-several-scripts.mjs <base URL> <Chrome debugging port> [screenshot folder]
// Its traffic goes to the base URL and the debugging port only.
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const PORT = process.argv[3] || "9222";
const SHOTS = process.argv[4] || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
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
  if (m.method === "Page.javascriptDialogOpening" && m.sessionId) send("Page.handleJavaScriptDialog", { accept: true }, m.sessionId).catch(() => {});
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

const STUBS = `(() => {
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push(String(e.message)));
  addEventListener("unhandledrejection", (e) => window.__errors.push(String(e.reason?.message || e.reason)));
  document.addEventListener("securitypolicyviolation", (e) => window.__errors.push("CSP " + e.violatedDirective + " " + (e.blockedURI || "inline")));
  // Files on the computer stand in as folders of a "disk" folder in the private file system: __pick is "folder/name".
  window.__pick = null;
  window.showOpenFilePicker = async () => {
    if (!window.__pick) throw new DOMException("", "AbortError");
    const [dir, name] = window.__pick.split("/");
    const disk = await (await navigator.storage.getDirectory()).getDirectoryHandle("disk", { create: true });
    return [await (await disk.getDirectoryHandle(dir, { create: true })).getFileHandle(name, { create: true })];
  };
})();`;

async function openTab(width, height, extra = "") {
  const { browserContextId } = await send("Target.createBrowserContext");
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = {
    close: () => send("Target.disposeBrowserContext", { browserContextId }),
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
      const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error(`nothing to press: ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 });
    },
    steady: (selector) => page.until(`new Promise((done) => { const at = () => JSON.stringify(document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect() ?? null), was = at(); setTimeout(() => done(was !== "null" && at() === was), 250); })`, `${selector} in place`),
    async key(key, code, vk, text) { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, ...(text && type === "keyDown" ? { text } : {}) }); },
    async shot(name) {
      if (!SHOTS) return;
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, "base64"));
    },
    errors: () => page.eval(`window.__errors`),
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: STUBS });
  if (extra) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: extra });
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  return page;
}

/* ---------- The agent, over /mcp ---------- */
let rpcId = 0;
function agentFor(token) {
  return async (method, params) => {
    const res = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}), id: ++rpcId }) });
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
}
const toolText = (r) => r?.result?.content?.[0]?.text ?? "";

/* ---------- Made-up scripts ---------- */
const filler = (topic, n) => Array.from({ length: n }, (_, i) => `${topic} note ${i + 1}: a short spoken line that only fills the page so it can scroll.`);
const WALK = { title: "A walk before breakfast", lines: ["What if the best part of your day is over before breakfast?", ...filler("Walk", 14), "Put your shoes by the door the night before. That's the whole trick."] };
const LONG = "Then you cover the bowl with a plate or a clean towel and you simply leave it alone on the kitchen counter for the whole night, which is really all there is to it.";
const SHORT = "Cover the bowl and leave it on the counter overnight. That's all.";
const BREAD = { title: "Bread at home", lines: ["Good bread needs four things: flour, water, salt and time.", ...filler("Bread", 8), LONG, ...filler("Oven", 6)] };
const nameOf = (s) => `${s.title.toLowerCase().replace(/\s+/g, "-")}.md`;

const isOpen = (name) => `document.querySelector("#fileName")?.textContent === ${JSON.stringify(name)} && !document.querySelector("#layout").hidden`;
// Types a made-up script into a new one: the title, then each line as its own paragraph.
async function writeScript(page, s) {
  await page.send("Input.insertText", { text: s.title });
  for (const line of s.lines) {
    await page.key("Enter", "Enter", 13);
    await page.send("Input.insertText", { text: line });
  }
  await page.until(isOpen(nameOf(s)), `${nameOf(s)} is named after its title`, 8000);
  await page.until(`document.querySelector("#saveState").dataset.state === ""`, `${nameOf(s)} is saved`, 8000);
}
async function menuOpen(page) {
  await page.click("#docSwitch");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open") && document.querySelector("#scriptList .scripts__open[aria-current]")`, "the script menu with its rows");
  await sleep(150);
}
const row = (name) => `[...document.querySelectorAll("#scriptList .scripts__row")].find((li) => li.querySelector(".scripts__name")?.textContent === ${JSON.stringify(name)})`;
const rowState = (name) => `(() => { const li = ${row(name)}; if (!li) return null; return { spin: !!li.querySelector(".scripts__spin"), note: li.querySelector(".scripts__ai")?.textContent || "", dot: !!li.querySelector(".ai-dot"), current: !!li.querySelector("[aria-current]"), unseen: li.hasAttribute("data-unseen") }; })()`;
async function openFromMenu(page, name) {
  await menuOpen(page);
  await page.eval(`(${row(name)}).querySelector(".scripts__open").click()`);
  await page.until(isOpen(name), `${name} opens from the menu`);
}
const readScript = (page, name) => page.eval(`(async () => { try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("scripts"); return await (await (await d.getFileHandle(${JSON.stringify(name)})).getFile()).text(); } catch { return null; } })()`);
// Where the person is in the open script: the window's scroll, the focused line and the caret offset in it.
const where = (page) => page.eval(`(() => { const s = getSelection(), el = document.activeElement; const r = s.rangeCount ? s.getRangeAt(0) : null; return { y: Math.round(scrollY), focus: el?.dataset?.id ? el.textContent.slice(0, 40) : el?.id || el?.tagName, at: r ? r.startOffset : -1, text: document.querySelector("#script").textContent }; })()`);

// A fresh profile with the agent connected.
async function connect(width, height, extra = "") {
  const page = await openTab(width, height, extra);
  const minted = await (await fetch(`${BASE}/api/agent-token`, { method: "POST" })).json();
  const mcp = agentFor(minted.token);
  await page.send("Page.navigate", { url: `${BASE}/` });
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptyNew")`, "the start screen");
  await page.eval(`localStorage.setItem("script-editor:agent", ${JSON.stringify(JSON.stringify({ token: minted.token, createdAt: Date.now() }))}); true`);
  await page.send("Page.reload", {});
  await sleep(300);
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptyNew")`, "the start screen after the token");
  await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "1.0" } });
  await page.until(`document.querySelector("#agentBtn").dataset.state === "on"`, "the agent is connected");
  return { page, mcp };
}
// ...and two made-up scripts saved in the browser; B is open.
async function start(width, height, extra = "") {
  const { page, mcp } = await connect(width, height, extra);

  // Two made-up scripts, both saved in the browser.
  await page.steady("#emptyNew");
  await page.click("#emptyNew");
  await page.until(`!document.querySelector("#layout").hidden`, "a new script");
  await writeScript(page, WALK);
  await menuOpen(page);
  await page.eval(`document.querySelector("#menuNew").click(); true`);
  await page.until(`document.querySelector("#fileName").textContent !== ${JSON.stringify(nameOf(WALK))}`, "a second new script");
  await writeScript(page, BREAD);
  return { page, mcp, A: nameOf(WALK), B: nameOf(BREAD) };
}
// An ask ("Shorter") on the paragraph that starts with `words` in the open script, taken by the agent.
// `part`: [from, to] of the paragraph's text to ask on (default all of it).
// `take`: false leaves it waiting (the agent does not pick it up).
async function askShorter(page, mcp, words, part = null, take = true) {
  const asksBefore = await page.eval(`document.querySelectorAll("#script .ask").length`);
  await page.eval(`getSelection().removeAllRanges(); document.activeElement?.blur(); true`);
  await page.until(`document.querySelector("#editBar").hidden`, "the edit bar from before has gone");
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith(${JSON.stringify(words)})); el.scrollIntoView({ block: "center" }); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = w.nextNode())) if (!n.parentElement.closest("[contenteditable='false']")) nodes.push(n); const total = nodes.reduce((x, y) => x + y.data.length, 0); const part = ${JSON.stringify(part)} || [0, total]; const point = (at) => { for (const x of nodes) { if (at <= x.data.length) return [x, at]; at -= x.data.length; } }; const r = document.createRange(); r.setStart(...point(part[0])); r.setEnd(...point(part[1])); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await page.until(`!document.querySelector("#editBar").hidden`, "the edit bar shows on the selection");
  await page.click("#askInput");
  await page.send("Input.insertText", { text: "Shorter" });
  await sleep(80);
  await page.key("Enter", "Enter", 13, "\r");
  await page.until(`document.querySelectorAll("#script .ask").length > ${asksBefore}`, "the ask shows");
  if (!take) return null;
  const asks = JSON.parse(toolText(await mcp("tools/call", { name: "wait_for_asks", arguments: { waitSeconds: 5 } })) || "{}").asks || [];
  return asks.find((a) => (part ? true : a.quote?.startsWith(words)));
}
const fileHas = (name, words) => `(async () => { try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("scripts"); return (await (await (await d.getFileHandle(${JSON.stringify(name)})).getFile()).text()).includes(${JSON.stringify(words)}); } catch { return false; } })()`;

async function run({ width, height, label, undoBy }) {
  console.log(`--- ${label} (${width} px)`);
  const { page, mcp, A, B } = await start(width, height);

  // In B: an ask on the long sentence ("Shorter").
  const ask = await askShorter(page, mcp, "Then you cover");
  check(!!ask && ask.fileName === undefined, "the agent gets B's ask (the open script's: no file name with it)", JSON.stringify(ask));

  // Back to A, the agent still at work in B: B's menu row shows a spinner and "AI working".
  await openFromMenu(page, A);
  await menuOpen(page);
  const working = await page.eval(rowState(B));
  check(working?.spin && working.note === "AI working" && !working.dot, "B's row: spinner and \"AI working\", no dot", JSON.stringify(working));
  const openRow = await page.eval(rowState(A));
  check(openRow?.current && !openRow.note && !openRow.dot, "the open script's row: no note, no dot", JSON.stringify(openRow));
  await page.shot(`${label}-1-menu-ai-working`);
  await page.key("Escape", "Escape", 27);
  await page.until(`!document.querySelector("#scriptMenu").matches(":popover-open")`, "the menu closes");
  check(await page.eval(`document.querySelector("#aiDot").hidden`), "no dot on the file name while the AI works");

  // Typing in A: scroll a little, put the caret in a line, type.
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith("Walk note 6")); el.scrollIntoView({ block: "center" }); el.focus(); const t = el.firstChild; getSelection().collapse(t, 12); })()`);
  await page.send("Input.insertText", { text: "really " });
  await sleep(200);
  const before = await where(page);

  // The agent answers B while the person is in A: nothing moves in A.
  const answered = await mcp("tools/call", { name: "answer_ask", arguments: { askId: ask?.id, kind: "replace", text: SHORT } });
  check(!answered?.result?.isError && /lightly marked|in the text/i.test(toolText(answered)), "answer_ask in B is accepted while A is open", toolText(answered));
  await page.until(`!document.querySelector("#aiDot").hidden`, "the orange dot shows on the file name");
  await sleep(300);
  const after = await where(page);
  check(after.y === before.y && after.focus === before.focus && after.at === before.at && after.text === before.text, "nothing moved in A: same scroll, caret and text", `${JSON.stringify({ ...before, text: before.text.length })} vs ${JSON.stringify({ ...after, text: after.text.length })}`);
  await page.send("Input.insertText", { text: "very " });
  check((await page.eval(`document.activeElement.textContent`)).includes("really very "), "the person keeps typing in A");
  await page.until(fileHas(B, SHORT), "B's file holds the agent's change");
  const bFile = await readScript(page, B);
  check(bFile?.includes(SHORT) && !bFile.includes(LONG), "B's file has the change, not the old sentence");
  check(!(await readScript(page, A))?.includes(SHORT), "A's file never gets B's change");
  const dot = await page.eval(`(() => { const d = document.querySelector("#aiDot").getBoundingClientRect(), n = document.querySelector("#fileName").getBoundingClientRect(), s = getComputedStyle(document.querySelector("#aiDot")); return { w: Math.round(d.width), above: d.top < n.top + n.height / 2 - 2, colour: s.backgroundColor }; })()`);
  check(dot.w >= 9 && dot.above, "the file name's dot is bigger than the 7 px not-saved dot and sits higher, at the corner", JSON.stringify(dot));
  await page.shot(`${label}-2-dot-on-file-name`);
  await menuOpen(page);
  const done = await page.eval(rowState(B));
  check(done?.note === "AI done" && done.dot && !done.spin && done.unseen, "B's row: \"AI done\" and the orange dot, no number", JSON.stringify(done));
  check(!(await page.eval(rowState(A)))?.dot, "the open script never gets a dot");
  await page.shot(`${label}-3-menu-ai-done`);

  // A click opens B at the change, lightly marked, with Undo on the agent's tag; the dot goes.
  await page.eval(`(${row(B)}).querySelector(".scripts__open").click()`);
  await page.until(isOpen(B), "B opens");
  await page.until(`!!document.querySelector("#script .agent-change")`, "the change is lightly marked");
  const view = await page.eval(`(() => { const m = document.querySelector("#script .agent-change").getBoundingClientRect(), top = document.querySelector(".top").getBoundingClientRect().bottom; return { inView: m.top >= top && m.bottom <= innerHeight, text: document.querySelector("#script .agent-change").textContent }; })()`);
  check(view.inView && view.text.includes("Cover the bowl"), "B opens at the change, on screen", JSON.stringify(view));
  await page.until(`!!document.querySelector(".rc__undo")`, "Undo on the agent's tag");
  check(await page.eval(`document.querySelector("#aiDot").hidden`), "the dot goes once the change is seen");
  await page.shot(`${label}-4-at-the-change`);
  if (undoBy === "key") {
    await page.eval(`document.activeElement?.blur(); true`);
    for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
  } else await page.eval(`document.querySelector(".rc__undo").click(); true`);
  await page.until(`document.querySelector("#script").textContent.includes(${JSON.stringify(LONG.slice(0, 60))})`, "Undo puts the old sentence back");
  check(!(await page.eval(`document.querySelector("#script").textContent`)).includes("Cover the bowl and leave") && !(await page.eval(`!!document.querySelector("#script .agent-change")`)), `the agent's words are gone after ${undoBy === "key" ? "Ctrl+Z (one step)" : "Undo on the agent's tag"}`);

  // Back to A: where it was left, caret and all.
  await openFromMenu(page, A);
  await sleep(200);
  const back = await where(page);
  check(Math.abs(back.y - after.y) <= 2 && back.focus.startsWith("Walk note 6:really very ") && back.at === after.at + 5, "A comes back at its scroll place with its caret", `${JSON.stringify({ y: after.y, focus: after.focus, at: after.at })} vs ${JSON.stringify({ y: back.y, focus: back.focus, at: back.at })}`);
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

// After a reload the change is still in the file and marked; a file another program changed meanwhile opens from the
// file, with the agent's words as "Unsaved changes".
async function runEdges() {
  console.log("--- reload and a file changed elsewhere (1280 px)");
  const { page, mcp, A, B } = await start(1280, 800);
  const first = await askShorter(page, mcp, "Then you cover");
  await openFromMenu(page, A);
  const r1 = await mcp("tools/call", { name: "answer_ask", arguments: { askId: first?.id, kind: "replace", text: SHORT } });
  check(!r1?.result?.isError, "the answer lands in B", toolText(r1));
  await page.until(fileHas(B, SHORT), "B's file holds the change");
  await page.send("Page.reload", {});
  await sleep(300);
  await page.until(`document.readyState === "complete" && !document.querySelector("#emptyReopen").hidden`, "the start screen after a reload");
  await page.steady("#emptyReopen");
  await page.click("#emptyReopen");
  await page.until(`!document.querySelector("#layout").hidden`, "a script opens after the reload");
  if (!(await page.eval(isOpen(B)))) await openFromMenu(page, B);
  // Accepted limit (lead, 2026-11-19): after a reload a background script's marks and asks are gone; its file keeps
  // the agent's change.
  await page.until(`document.querySelector("#script").textContent.includes(${JSON.stringify(SHORT)})`, "after a reload B still has the agent's change");
  const second = await askShorter(page, mcp, "Good bread needs");
  check(!!second, "the agent gets a second ask in B");
  await openFromMenu(page, A);
  // Another program writes B's file before the answer comes: the answer is never written over it.
  await page.eval(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("scripts"); const w = await (await d.getFileHandle(${JSON.stringify(B)})).createWritable(); await w.write(${JSON.stringify("# Bread at home\n\nSomeone else wrote this.\n")}); await w.close(); return true; })()`);
  const r2 = await mcp("tools/call", { name: "answer_ask", arguments: { askId: second?.id, kind: "replace", text: "Bread needs four things." } });
  check(!r2?.result?.isError, "the second answer is taken while B's file was changed elsewhere", toolText(r2));
  await sleep(500);
  check(!(await page.eval(fileHas(B, "Bread needs four things."))), "B's file changed elsewhere is not written over");
  await openFromMenu(page, B);
  await page.until(`!document.querySelector("#banner").hidden && document.querySelector("#banner").textContent.startsWith("Unsaved changes from")`, "B opens from its file, the agent's words as Unsaved changes");
  check((await page.eval(`document.querySelector("#script").textContent`)).includes("Someone else wrote this."), "B shows what its file holds now");
  await page.eval(`[...document.querySelectorAll("#banner button")].find((b) => b.textContent === "Restore").click(); true`);
  await page.until(`document.querySelector("#script").textContent.includes("Bread needs four things.")`, "Restore brings the agent's words back");
  // Deleting a script the agent just worked in: its dot, its row, its file and its draft all go, and none comes back.
  await page.until(`document.querySelector("#saveState").dataset.state === ""`, "B is saved after Restore", 8000);
  const third = await askShorter(page, mcp, "Bread note 3");
  await openFromMenu(page, A);
  const r3 = await mcp("tools/call", { name: "answer_ask", arguments: { askId: third?.id, kind: "replace", text: "Bread note three." } });
  check(!r3?.result?.isError, "a third answer lands in B", toolText(r3));
  await page.until(`!document.querySelector("#aiDot").hidden`, "the dot for B");
  await menuOpen(page);
  await page.eval(`(${row(B)}).querySelector(".scripts__remove").click(); true`);
  await page.until(`!!(${row(B)})?.querySelector(".scripts__delete")`, "Delete asks once more");
  await page.eval(`(${row(B)}).querySelector(".scripts__delete").click(); true`);
  await page.until(`!(${row(B)})`, "B's row is gone", 8000);
  await sleep(600);
  check(await page.eval(`document.querySelector("#aiDot").hidden`), "the dot goes with the deleted script");
  check(await page.eval(`localStorage.getItem("script-editor:draft:" + ${JSON.stringify(B)}) === null`), "no draft comes back under the deleted script's name");
  check((await readScript(page, B)) === null, "the deleted script's file is gone");
  const r4 = await mcp("tools/call", { name: "wait_for_asks", arguments: { waitSeconds: 0 } });
  check(!toolText(r4).includes(B), "the agent gets no ask of the deleted script", toolText(r4));
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

// A "/" command being typed when the person switches through the file-name menu (lead, 2026-11-19, TOOLS-358): it
// never reaches the script's file, not when it is left and not when the agent's answer lands, and Ctrl+Z can't bring
// it back. Back in the text without switching, it is ordinary text again and saves as usual.
const lineText = (start) => `[...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith(${JSON.stringify(start)}))?.textContent ?? null`;
async function typeCommand(page, line, command) {
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith(${JSON.stringify(line)})); el.scrollIntoView({ block: "center" }); el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  for (const ch of command) { await page.send("Input.insertText", { text: ch }); await sleep(40); }
  await page.until(`!document.querySelector("#slashMenu").hidden`, `the parts menu opens on ${command.trim()}`);
}
const fileLacks = async (page, name, words) => { const t = await readScript(page, name); return typeof t === "string" && !t.includes(words); };
async function runSlash(width, height) {
  console.log(`--- a half-typed / command when switching (${width} px)`);
  const { page, mcp, A, B } = await start(width, height);
  const ask = await askShorter(page, mcp, "Then you cover");
  // Back in the text without switching: the command is ordinary text again, and it saves.
  await typeCommand(page, "Bread note 2", " /hoo");
  await page.click("#docSwitch");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await page.key("Escape", "Escape", 27);
  await page.until(`!document.querySelector("#scriptMenu").matches(":popover-open")`, "the menu closes");
  // Back in the text with a real click on a line.
  const spot = await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith("Bread note 3")); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...spot, button: "left", clickCount: 1 });
  await page.until(fileHas(B, " /hoo"), "back in the text, the typed words save as usual", 6000);
  await page.until(`document.querySelector("#saveState").dataset.state === ""`, "and the not-saved dot goes", 6000);
  // An answer lands while the menu is open and puts the caret back in the text; Escape, and typing on: it saves again.
  const ask3 = await askShorter(page, mcp, "Bread note 6");
  await typeCommand(page, "Bread note 6", " /sil");
  await page.click("#docSwitch");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  const r3 = await mcp("tools/call", { name: "answer_ask", arguments: { askId: ask3?.id, kind: "replace", text: "Bread note six." } });
  check(!r3?.result?.isError, "an answer lands while the menu is open", toolText(r3));
  await page.key("Escape", "Escape", 27);
  await page.until(`!document.querySelector("#scriptMenu").matches(":popover-open")`, "the menu closes");
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith("Bread note six")); if (!el.contains(document.activeElement) && document.activeElement !== el) { el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); } })()`);
  await page.send("Input.insertText", { text: "x" });
  await page.until(fileHas(B, " /silx"), "after Escape and typing on, the words save as usual", 6000);

  // Focus going to another button while the menu stays open (Tab): it is ordinary text again and saves.
  await typeCommand(page, "Bread note 7", " /div");
  await page.click("#docSwitch");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await page.eval(`document.querySelector("#exportBtn").focus(); true`);
  await page.until(fileHas(B, " /div"), "focus on another button: the words save as usual", 6000);
  await page.key("Escape", "Escape", 27);

  // Switching through the menu while a command is typed; meanwhile the agent shortens the words before it.
  // Two asks in the line the command goes into: its first words (answered while the menu is open) and the rest
  // (answered while A opens: the answer puts the caret back in that line).
  const ask2 = await askShorter(page, mcp, "Bread note 4", [0, 12]);
  const ask4 = await askShorter(page, mcp, "Bread note 4", [14, 33]); // "a short spoken line"
  await typeCommand(page, "Bread note 4", " /on");
  await page.click("#docSwitch"); // a real click: focus goes to the menu (its search box on a desktop, the button on a phone)
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open") && document.querySelector("#scriptList .scripts__open[aria-current]")`, "the script menu");
  const r2 = await mcp("tools/call", { name: "answer_ask", arguments: { askId: ask2?.id, kind: "replace", text: "Bread note four" } });
  check(!r2?.result?.isError, "an answer lands before the command while the menu is open", toolText(r2));
  const before = "Bread note four: a short line that only fills the page so it can scroll."; // both answers in, no command
  await sleep(2000); // longer than the auto-save pause
  check(await fileLacks(page, B, " /on"), "with the file-name menu open, /on is not saved into B's file");
  // A opens slowly; meanwhile the agent answers in B, which puts the caret back in B's text.
  await page.eval(`(() => { const get = FileSystemFileHandle.prototype.getFile; window.__slowOpen = true; FileSystemFileHandle.prototype.getFile = async function (...a) { if (window.__slowOpen && this.name === ${JSON.stringify(A)}) { window.__slowOpen = false; await new Promise((r) => setTimeout(r, 1500)); } return get.apply(this, a); }; })()`);
  await page.eval(`(${row(A)}).querySelector(".scripts__open").click()`);
  await sleep(300);
  const r4 = await mcp("tools/call", { name: "answer_ask", arguments: { askId: ask4?.id, kind: "replace", text: "a short line" } });
  check(!r4?.result?.isError, "an answer lands in B while A is still opening", toolText(r4));
  await page.until(isOpen(A), "A opens");
  await sleep(500);
  check(await fileLacks(page, B, " /on"), "leaving B through the menu does not save /on into B's file");
  const r = await mcp("tools/call", { name: "answer_ask", arguments: { askId: ask?.id, kind: "replace", text: SHORT } });
  check(!r?.result?.isError, "the answer lands in B", toolText(r));
  await page.until(fileHas(B, SHORT), "B's file holds the change");
  check(await fileLacks(page, B, " /on"), "the agent's answer does not bring /on into B's file");
  check(await page.eval(`localStorage.getItem("script-editor:draft:" + ${JSON.stringify(B)}) === null || !localStorage.getItem("script-editor:draft:" + ${JSON.stringify(B)}).includes(" /on")`), "B's draft has no /on");
  await openFromMenu(page, B);
  await page.until(`!!document.querySelector("#script .agent-change")`, "B opens at the change");
  const reopened = await page.eval(lineText("Bread note four"));
  check(reopened === before, "B opens with the line as it was before the command", JSON.stringify(reopened));
  for (let i = 0; i < 3; i++) {
    await page.eval(`document.activeElement?.blur(); true`);
    for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
    await sleep(200);
  }
  const text = await page.eval(`document.querySelector("#script").textContent`);
  const line4 = (await page.eval(lineText("Bread note four"))) ?? (await page.eval(lineText("Bread note 4")));
  check(text.includes(LONG.slice(0, 60)) && line4 === before, "Ctrl+Z takes the agent's change out and never brings any part of the command back", JSON.stringify(line4));
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

// The menu is open when an answer lands (release review on PR #78): the row changes in place, so keyboard focus on it
// stays, and a mouse press that has started on it still opens the script.
async function runFocus() {
  console.log("--- the menu open while an answer lands (1280 px)");
  const { page, mcp, A, B } = await start(1280, 800);
  const first = await askShorter(page, mcp, "Then you cover");
  const second = await askShorter(page, mcp, "Bread note 3");
  await openFromMenu(page, A);
  await menuOpen(page);
  await page.eval(`(() => { const b = (${row(B)}).querySelector(".scripts__open"); b.focus(); window.__row = b; })()`);
  const r1 = await mcp("tools/call", { name: "answer_ask", arguments: { askId: first?.id, kind: "replace", text: SHORT } });
  check(!r1?.result?.isError, "the first answer lands in B", toolText(r1));
  await page.until(fileHas(B, SHORT), "B's file holds the first change");
  await sleep(300);
  check(await page.eval(`document.activeElement === window.__row && window.__row.isConnected`), "keyboard focus stays on B's row while it changes");
  const at = await page.eval(`(() => { const r = (${row(B)}).querySelector(".scripts__open").getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
  const r2 = await mcp("tools/call", { name: "answer_ask", arguments: { askId: second?.id, kind: "replace", text: "Bread note three." } });
  check(!r2?.result?.isError, "the second answer lands in B during the press", toolText(r2));
  await page.until(`(${row(B)})?.querySelector(".scripts__ai")?.textContent === "AI done"`, "B's row says AI done");
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
  await page.until(isOpen(B), "the press that started before the change still opens B");
  // The agent opens another script while the menu is open: the menu follows (review on PR #79).
  await menuOpen(page);
  const r3 = await mcp("tools/call", { name: "open_script", arguments: { name: A } });
  check(!r3?.result?.isError, "the agent opens A while the menu is open", toolText(r3));
  await page.until(isOpen(A), "A is open");
  await sleep(400);
  const marks = await page.eval(`({ a: !!(${row(A)})?.querySelector("[aria-current]"), b: !!(${row(B)})?.querySelector("[aria-current]") })`);
  check(marks.a && !marks.b, "the menu marks A as the open script, not B", JSON.stringify(marks));
  await page.eval(`(${row(B)}).querySelector(".scripts__open").click()`);
  await page.until(isOpen(B), "a click on B's row opens B again");
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

// Two different scripts called script.md, as Save to video folder names them (release review on PR #78): an answer
// landing in the closed one never touches the open one's draft (its safety net and its Check flags), and Restore
// gives each script its own words.
const writeDisk = (page, path, text) => page.eval(`(async () => { const [dir, name] = ${JSON.stringify(path)}.split("/"); const disk = await (await navigator.storage.getDirectory()).getDirectoryHandle("disk", { create: true }); const w = await (await (await disk.getDirectoryHandle(dir, { create: true })).getFileHandle(name, { create: true })).createWritable(); await w.write(${JSON.stringify(text)}); await w.close(); return true; })()`);
const readDisk = (page, path) => page.eval(`(async () => { try { const [dir, name] = ${JSON.stringify(path)}.split("/"); const disk = await (await navigator.storage.getDirectory()).getDirectoryHandle("disk"); return await (await (await (await disk.getDirectoryHandle(dir)).getFileHandle(name)).getFile()).text(); } catch { return null; } })()`);
// The nth row (from the top, most recent first) with this name that is not the open script.
const otherRow = (name, nth = 0) => `[...document.querySelectorAll("#scriptList .scripts__row")].filter((li) => li.querySelector(".scripts__name")?.textContent === ${JSON.stringify(name)} && !li.querySelector("[aria-current]"))[${nth}]`;
async function openOther(page, name, nth = 0) {
  await menuOpen(page);
  await page.eval(`(${otherRow(name, nth)}).querySelector(".scripts__open").click()`);
}
async function runSameName() {
  console.log("--- two scripts called script.md (1280 px)");
  const { page, mcp } = await connect(1280, 800);
  const md = (s) => `# ${s.title}\n\n${s.lines.join("\n\n")}\n`;
  await writeDisk(page, "a/script.md", md(BREAD));
  await writeDisk(page, "b/script.md", md(WALK));
  await page.eval(`window.__pick = "a/script.md"; true`);
  await page.steady("#emptyOpen");
  await page.click("#emptyOpen");
  await page.until(`document.querySelector("#script")?.textContent.includes("Good bread needs")`, "the first script.md (bread) opens");
  const ask = await askShorter(page, mcp, "Then you cover");
  check(!!ask, "the agent takes an ask in the bread script.md");
  const shared = await askShorter(page, mcp, "Bread note 3", [14, 33]); // "a short spoken line": words the walk script has too
  await page.eval(`window.__pick = "b/script.md"; true`);
  await menuOpen(page);
  await page.eval(`document.querySelector("#menuOpen").click(); true`);
  await page.until(`document.querySelector("#script")?.textContent.includes("What if the best part")`, "the second script.md (walk) opens");
  // The bread script went to the background: it leaves no copy under the shared name, so the walk script reads none.
  await sleep(500);
  const leftCopy = await page.eval(`localStorage.getItem("script-editor:draft:script.md")`);
  check(!leftCopy || (!leftCopy.includes("Then you cover") && !leftCopy.includes("Good bread")), "the bread script.md leaves no copy under the shared name as it goes to the background", leftCopy);
  check(!(await page.eval(`!!document.querySelector("#script .ask") || !document.querySelector("#banner").hidden`)), "the walk script.md takes none of the bread script's asks or words");
  const rs = await mcp("tools/call", { name: "answer_ask", arguments: { askId: shared?.id, kind: "replace", text: "a short line" } });
  check(!rs?.result?.isError, "the shared-words ask is answered in the bread script.md, in the background", toolText(rs));
  await page.until(`document.querySelector("#saveState").dataset.state === ""`, "the walk script is saved");
  await sleep(600);
  // The walk script's own draft: a safety net with a B-roll "Check" flag of its own.
  const own = JSON.stringify({ text: null, at: 1, asks: [], broll: { B9: true } });
  await page.eval(`localStorage.setItem("script-editor:draft:script.md", ${JSON.stringify(own)}); true`);
  // Another program changes the bread file, so the answer can't be written there and must wait somewhere.
  await writeDisk(page, "a/script.md", "# Bread at home\n\nSomeone else wrote this.\n");
  const r = await mcp("tools/call", { name: "answer_ask", arguments: { askId: ask?.id, kind: "replace", text: SHORT } });
  check(!r?.result?.isError, "the answer lands in the closed bread script.md", toolText(r));
  await sleep(1000);
  check((await page.eval(`localStorage.getItem("script-editor:draft:script.md")`)) === own, "the open walk script.md keeps its own draft and Check flags", await page.eval(`localStorage.getItem("script-editor:draft:script.md")`));
  check(!(await readDisk(page, "a/script.md"))?.includes(SHORT), "the bread file changed elsewhere is not written over");
  await page.until(`!document.querySelector("#aiDot").hidden`, "the dot for the bread script.md");
  // Leaving the walk script.md with words just typed, for a third script: the draft by that name stays the walk's.
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith("Walk note 3")); el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text: " Walk extra." });
  await menuOpen(page);
  await page.eval(`document.querySelector("#menuNew").click(); true`);
  await page.until(`document.querySelector("#fileName").textContent !== "script.md"`, "a third script opens");
  await sleep(1000);
  const walkDraft = await page.eval(`localStorage.getItem("script-editor:draft:script.md")`);
  check(!!walkDraft && walkDraft.includes("Walk extra.") && !walkDraft.includes("Cover the bowl") && !walkDraft.includes("Good bread"), "after leaving for a third script, the draft by that name is still the walk script's own", walkDraft);
  await openOther(page, "script.md", 1); // the bread script.md (the walk one is the most recent)
  await page.until(`!document.querySelector("#banner").hidden && document.querySelector("#banner").textContent.startsWith("Unsaved changes from")`, "the bread script.md offers its own words as Unsaved changes");
  await page.eval(`[...document.querySelectorAll("#banner button")].find((b) => b.textContent === "Restore").click(); true`);
  await page.until(`document.querySelector("#script").textContent.includes(${JSON.stringify(SHORT)})`, "Restore brings the agent's words into the bread script.md");
  check(!(await page.eval(`document.querySelector("#script").textContent`)).includes("What if the best part"), "Restore brings no words of the walk script");
  await page.until(`document.querySelector("#saveState").dataset.state === ""`, "the bread script.md is saved", 8000);
  await openOther(page, "script.md");
  await page.until(`document.querySelector("#script")?.textContent.includes("What if the best part")`, "the walk script.md opens again");
  await sleep(500);
  const banner = await page.eval(`document.querySelector("#banner").hidden ? "" : document.querySelector("#banner").textContent`);
  check(!banner.startsWith("Unsaved changes") && !(await page.eval(`document.querySelector("#script").textContent`)).includes("Cover the bowl"), "the walk script.md gets none of the bread script's words", banner);
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

// A background script taken off the list while its save is still on its way (release review on PR #78): when that
// save fails, its words never land under the shared name, in the other script.md's draft.
async function runRemovedMidSave() {
  console.log("--- a background script.md taken off the list mid-save (1280 px)");
  const { page, mcp } = await connect(1280, 800);
  const md = (s) => `# ${s.title}\n\n${s.lines.join("\n\n")}\n`;
  await writeDisk(page, "a/script.md", md(BREAD));
  await writeDisk(page, "b/script.md", md(WALK));
  await page.eval(`window.__pick = "a/script.md"; true`);
  await page.steady("#emptyOpen");
  await page.click("#emptyOpen");
  await page.until(`document.querySelector("#script")?.textContent.includes("Good bread needs")`, "the bread script.md opens");
  const ask = await askShorter(page, mcp, "Then you cover");
  check(!!ask, "the agent takes an ask in the bread script.md");
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith("Bread note 2")); el.focus(); getSelection().selectAllChildren(el); getSelection().collapseToEnd(); })()`);
  await page.send("Input.insertText", { text: " Fresh words." }); // not saved yet: the save made as it is left will carry them
  // The next write of a script.md waits, then fails: the bread save made as it goes to the background.
  await page.eval(`(() => { window.__gate = new Promise((r) => { window.__release = r; }); window.__holdNext = true; const create = FileSystemFileHandle.prototype.createWritable; FileSystemFileHandle.prototype.createWritable = async function (...a) { if (window.__holdNext && this.name === "script.md") { window.__holdNext = false; window.__held = true; await window.__gate; throw new DOMException("The file could not be written.", "NotAllowedError"); } return create.apply(this, a); }; })()`);
  await page.eval(`window.__pick = "b/script.md"; true`);
  await menuOpen(page);
  await page.eval(`document.querySelector("#menuOpen").click(); true`);
  await page.until(`document.querySelector("#script")?.textContent.includes("What if the best part")`, "the walk script.md opens");
  await page.until(`window.__held === true`, "the bread save is on its way");
  // Every write under the shared name from now on is recorded.
  await page.eval(`(() => { window.__writes = []; const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === "script-editor:draft:script.md") window.__writes.push(String(v)); return set.call(this, k, v); }; })()`);
  await menuOpen(page);
  await page.eval(`(${otherRow("script.md")}).querySelector(".scripts__remove").click(); true`);
  await sleep(300);
  await page.eval(`window.__release(); true`);
  await sleep(1200);
  const writes = await page.eval(`window.__writes`);
  check(!writes.some((v) => v.includes("Fresh words") || v.includes("Good bread")), "the removed bread script's failed save writes none of its words under the shared name", writes.join(" | ").slice(0, 300));
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

// Found in the sweep before the release (lead, 2026-11-19): deleting a browser script.md while a file on the computer
// called script.md is open never removes that open script's draft (keys go by name).
async function runDeleteSameName() {
  console.log("--- deleting a browser script.md while a file script.md is open (1280 px)");
  const { page } = await connect(1280, 800);
  await page.steady("#emptyNew");
  await page.click("#emptyNew");
  await page.until(`!document.querySelector("#layout").hidden`, "a new script");
  await page.send("Input.insertText", { text: "Script" });
  await page.until(`document.querySelector("#fileName").textContent === "script.md"`, "the browser script is called script.md", 8000);
  await page.until(`document.querySelector("#saveState").dataset.state === ""`, "it is saved");
  await writeDisk(page, "b/script.md", `# ${WALK.title}\n\n${WALK.lines.join("\n\n")}\n`);
  await page.eval(`window.__pick = "b/script.md"; true`);
  await menuOpen(page);
  await page.eval(`document.querySelector("#menuOpen").click(); true`);
  await page.until(`document.querySelector("#script")?.textContent.includes("What if the best part")`, "the file script.md opens");
  await page.until(`document.querySelector("#saveState").dataset.state === ""`, "it is saved");
  await sleep(600);
  const own = JSON.stringify({ text: null, at: 1, asks: [], broll: { B9: true } }); // the open file's own draft
  await page.eval(`localStorage.setItem("script-editor:draft:script.md", ${JSON.stringify(own)}); true`);
  await menuOpen(page);
  const del = `[...document.querySelectorAll("#scriptList .scripts__row")].find((li) => li.querySelector(".scripts__name")?.textContent === "script.md" && li.querySelector(".scripts__tag"))`;
  await page.eval(`(${del}).querySelector(".scripts__remove").click(); true`);
  await page.until(`!!(${del})?.querySelector(".scripts__delete")`, "Delete asks once more");
  await page.eval(`(${del}).querySelector(".scripts__delete").click(); true`);
  await page.until(`!(${del})`, "the browser script.md is gone from the list", 8000);
  await sleep(500);
  check((await page.eval(`localStorage.getItem("script-editor:draft:script.md")`)) === own, "the open file script.md keeps its own draft", await page.eval(`localStorage.getItem("script-editor:draft:script.md")`));
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

// Opening an "AI done" script from its menu row while the Storyboard is shown (release review on PR #78): it switches
// to the Script view and opens at the change.
async function runBoard() {
  console.log("--- AI done, opened from the Storyboard (1280 px)");
  const { page, mcp, A, B } = await start(1280, 800);
  const ask = await askShorter(page, mcp, "Then you cover");
  await page.eval(`window.scrollTo(0, 0); true`);
  await openFromMenu(page, A);
  const r = await mcp("tools/call", { name: "answer_ask", arguments: { askId: ask?.id, kind: "replace", text: SHORT } });
  check(!r?.result?.isError, "the answer lands in B", toolText(r));
  await page.until(`!document.querySelector("#aiDot").hidden`, "the dot for B");
  await page.click(`#viewSwitch [data-view="board"]`);
  await page.until(`document.querySelector("#layout").dataset.view === "board"`, "the Storyboard shows");
  await openFromMenu(page, B);
  await page.until(`document.querySelector("#layout").dataset.view === ""`, "opening B from its row shows the Script view", 4000);
  await page.until(`(() => { const m = document.querySelector("#script .agent-change"); if (!m) return false; const r = m.getBoundingClientRect(), top = document.querySelector(".top").getBoundingClientRect().bottom; return r.top >= top && r.bottom <= innerHeight; })()`, "B opens at the change, on screen", 4000);
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

// Release review on PR #78 (P0): deleting a browser script.md while another script.md is kept aside (a third script
// open) never clears that name's data: its draft, its B-roll link and its saved B-roll list.
const idbGet = (page, key) => page.eval(`new Promise((res) => { const r = indexedDB.open("script-editor", 1); r.onupgradeneeded = () => r.result.createObjectStore("handles"); r.onsuccess = () => { const q = r.result.transaction("handles").objectStore("handles").get(${JSON.stringify(key)}); q.onsuccess = () => res(JSON.stringify(q.result ?? null)); q.onerror = () => res("error"); }; r.onerror = () => res("error"); })`);
const idbPut = (page, key, value) => page.eval(`new Promise((res) => { const r = indexedDB.open("script-editor", 1); r.onupgradeneeded = () => r.result.createObjectStore("handles"); r.onsuccess = () => { const t = r.result.transaction("handles", "readwrite"); t.objectStore("handles").put(${JSON.stringify(value)}, ${JSON.stringify(key)}); t.oncomplete = () => res(true); t.onerror = () => res(false); }; r.onerror = () => res(false); })`);
async function runDeleteKeptSameName() {
  console.log("--- deleting a browser script.md while a file script.md is kept aside (1280 px)");
  const { page, mcp } = await connect(1280, 800);
  await page.steady("#emptyNew");
  await page.click("#emptyNew");
  await page.until(`!document.querySelector("#layout").hidden`, "a new script");
  await page.send("Input.insertText", { text: "Script" });
  await page.until(`document.querySelector("#fileName").textContent === "script.md"`, "the browser script is called script.md", 8000);
  await page.until(`document.querySelector("#saveState").dataset.state === ""`, "it is saved");
  await writeDisk(page, "b/script.md", `# ${WALK.title}\n\n${WALK.lines.join("\n\n")}\n`);
  await page.eval(`window.__pick = "b/script.md"; true`);
  await menuOpen(page);
  await page.eval(`document.querySelector("#menuOpen").click(); true`);
  await page.until(`document.querySelector("#script")?.textContent.includes("What if the best part")`, "the file script.md opens");
  const ask = await askShorter(page, mcp, "Walk note 3");
  check(!!ask, "the agent takes an ask in the file script.md");
  await menuOpen(page);
  await page.eval(`document.querySelector("#menuNew").click(); true`); // a third script: the file script.md goes to the background
  await page.until(`document.querySelector("#fileName").textContent !== "script.md"`, "a third script opens");
  await sleep(800);
  // The name's data, as the file script.md would have it: a draft, a B-roll link and a saved B-roll list.
  const draft = JSON.stringify({ text: null, at: 1, asks: [], broll: { B9: true } });
  await page.eval(`localStorage.setItem("script-editor:draft:script.md", ${JSON.stringify(draft)}); localStorage.setItem("script-editor:brollList:script.md", ${JSON.stringify(JSON.stringify("kept list"))}); true`);
  await idbPut(page, "broll:script.md", { name: "b-roll.md" });
  await idbPut(page, "brollList:script.md", "the B-roll list");
  await menuOpen(page);
  const del = `[...document.querySelectorAll("#scriptList .scripts__row")].find((li) => li.querySelector(".scripts__name")?.textContent === "script.md" && li.querySelector(".scripts__tag"))`;
  await page.eval(`(${del}).querySelector(".scripts__remove").click(); true`);
  await page.until(`!!(${del})?.querySelector(".scripts__delete")`, "Delete asks once more");
  await page.eval(`(${del}).querySelector(".scripts__delete").click(); true`);
  await page.until(`!(${del})`, "the browser script.md is gone from the list", 8000);
  await sleep(800);
  check((await page.eval(`localStorage.getItem("script-editor:draft:script.md")`)) === draft, "the kept file script.md keeps its draft");
  check((await page.eval(`localStorage.getItem("script-editor:brollList:script.md")`)) === JSON.stringify("kept list"), "the kept file script.md keeps its saved B-roll list (local)");
  check((await idbGet(page, "broll:script.md")) === JSON.stringify({ name: "b-roll.md" }), "the kept file script.md keeps its B-roll link", await idbGet(page, "broll:script.md"));
  check((await idbGet(page, "brollList:script.md")) === JSON.stringify("the B-roll list"), "the kept file script.md keeps its saved B-roll list", await idbGet(page, "brollList:script.md"));
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

/* ---------- TOOLS-361: each script's own key, not its file name ---------- */
// The key a file on the "disk" goes by: its id in IndexedDB `fileIds`, found with isSameEntry.
const keyOfDisk = (page, path) => page.eval(`(async () => { const [dir, name] = ${JSON.stringify(path)}.split("/"); const disk = await (await navigator.storage.getDirectory()).getDirectoryHandle("disk"); const h = await (await disk.getDirectoryHandle(dir)).getFileHandle(name); const list = await new Promise((res) => { const r = indexedDB.open("script-editor", 1); r.onsuccess = () => { const q = r.result.transaction("handles").objectStore("handles").get("fileIds"); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }; r.onerror = () => res([]); }); for (const e of list) if (await e.handle.isSameEntry(h)) return "file:" + e.id; return null; })()`);
const draftOf = (page, key) => page.eval(`localStorage.getItem(${JSON.stringify(`script-editor:draft:${key}`)})`);
const shotLabels = (page) => page.eval(`[...document.querySelectorAll("#script .shot-frame__jump")].map((b) => b.getAttribute("aria-label"))`);
const md = (s) => `# ${s.title}\n\n${s.lines.join("\n\n")}\n`;
const listFor = (rows) => `# B-roll\n\n| # | What to show | Over (A-roll line) | How to make it |\n| --- | --- | --- | --- |\n${rows.map(([id, what, over]) => `| ${id} | ${what} | "${over}" | Photo |`).join("\n")}\n`;
const BREAD_LIST = listFor([["B1", "Flour and a clock", BREAD.lines[0]], ["B2", "A bowl under a towel", "Then you cover…"]]);
const PART = [LONG.indexOf("the bowl"), LONG.indexOf(", which")], OVERNIGHT = "the bowl and leave it overnight"; // B2's line keeps its first words
const WALK_LIST = listFor([["B1", "Shoes by the door", WALK.lines.at(-1)]]);
async function pickOpen(page, path, words) {
  await page.eval(`window.__pick = ${JSON.stringify(path)}; true`);
  if (await page.eval(`!document.querySelector("#layout").hidden`)) {
    await menuOpen(page);
    await page.eval(`document.querySelector("#menuOpen").click(); true`);
  } else {
    await page.steady("#emptyOpen");
    await page.click("#emptyOpen");
  }
  await page.until(`document.querySelector("#script")?.textContent.includes(${JSON.stringify(words)})`, `${path} opens`);
}
// Two files called script.md: each keeps its own draft, B-roll list and "Check" flags, also for the agent's change
// made while it was in the background and after a reload; what was kept under the name before opens in the first.
async function runOwnKeys() {
  console.log("--- two files called script.md keep their own drafts, B-roll and Check flags (1280 px)");
  const { page, mcp } = await connect(1280, 800);
  await writeDisk(page, "a/script.md", md(BREAD));
  await writeDisk(page, "b/script.md", md(WALK));
  // Kept under the name before TOOLS-361: a B-roll list linked without a file and a draft with a "Check" flag.
  await idbPut(page, "broll:script.md", { name: "bread-broll.md", text: BREAD_LIST });
  await page.eval(`localStorage.setItem("script-editor:draft:script.md", ${JSON.stringify(JSON.stringify({ text: null, at: 1, asks: [], broll: { B1: true } }))}); true`);
  await pickOpen(page, "a/script.md", "Good bread needs");
  await page.until(`document.querySelectorAll("#script .shot-frame__jump").length === 2`, "the bread script.md shows the B-roll list kept under its name");
  check((await shotLabels(page)).some((l) => l.includes("B1: Flour and a clock · Check")), "old data still opens: the list and its Check flag", JSON.stringify(await shotLabels(page)));
  const A = await keyOfDisk(page, "a/script.md");
  check(/^file:/.test(A || ""), "the bread script.md has a key of its own", A);
  check((await page.eval(`localStorage.getItem("script-editor:draft:script.md")`)) === null && (await idbGet(page, "broll:script.md")) === "null", "the name lets go of what it held");
  // An ask over B2's line, answered while the walk script.md is open; another ask stays waiting.
  const ask = await askShorter(page, mcp, "Then you cover", PART);
  await askShorter(page, mcp, "Bread note 3", [14, 33], false);
  check(!!ask, "the agent takes an ask in the bread script.md; another waits");
  await pickOpen(page, "b/script.md", "What if the best part");
  const B = await keyOfDisk(page, "b/script.md");
  check(!!B && B !== A, "the walk script.md has another key", `${A} ${B}`);
  await sleep(600);
  check((await shotLabels(page)).length === 0 && (await page.eval(`!document.querySelector("#script .ask") && document.querySelector("#banner").hidden`)), "the walk script.md shows none of the bread script's list, asks or words");
  await idbPut(page, `broll:${B}`, { name: "walk-broll.md", text: WALK_LIST }); // a list of its own, read when it opens next
  const r = await mcp("tools/call", { name: "answer_ask", arguments: { askId: ask?.id, kind: "replace", text: OVERNIGHT } });
  check(!r?.result?.isError, "the answer lands in the bread script.md, in the background", toolText(r));
  for (let i = 0; i < 100 && !(await readDisk(page, "a/script.md"))?.includes(OVERNIGHT); i++) await sleep(60);
  check((await readDisk(page, "a/script.md"))?.includes(OVERNIGHT), "the bread file holds the change");
  check(!(await readDisk(page, "b/script.md"))?.includes(OVERNIGHT), "the walk file does not");
  await sleep(600);
  const aDraft = await draftOf(page, A), bDraft = await draftOf(page, B);
  check(!!aDraft && aDraft.includes(OVERNIGHT) && aDraft.includes('"B2":true') && aDraft.includes('"status":"waiting"'), "the background script keeps its own draft: the marked change, its open ask and the new Check flag", aDraft?.slice(0, 300));
  check(!bDraft || (!bDraft.includes(OVERNIGHT) && !bDraft.includes("B2")), "the walk script.md's draft holds nothing of the bread script", bDraft?.slice(0, 300));
  // A reload: the bread script.md is no longer in memory; its marks, asks and flags come back from its own draft.
  await page.send("Page.reload", {});
  await sleep(300);
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptyOpen")`, "the start screen after the reload");
  await pickOpen(page, "a/script.md", "Good bread needs");
  await page.until(`!!document.querySelector("#script .agent-change")`, "after the reload, the agent's change is still marked");
  check((await page.eval(`document.querySelector("#script .agent-change").textContent`)).includes("leave it overnight"), "the mark is on the agent's words");
  await page.until(`!!document.querySelector("#script .ask")`, "the open ask is back");
  await page.until(`document.querySelectorAll("#script .shot-frame__jump").length === 2`, "the bread list shows");
  const labels = await shotLabels(page);
  check(labels.some((l) => l.includes("B1:") && l.includes("· Check")) && labels.some((l) => l.includes("B2:") && l.includes("· Check")), "both Check flags are back: the old one and the background answer's", JSON.stringify(labels));
  await page.eval(`document.querySelector("#script .agent-change").scrollIntoView({ block: "center" }); true`);
  await page.until(`!!document.querySelector(".rc__undo")`, "Undo on the agent's tag after the reload");
  await page.shot("ownkeys-1-bread-after-reload");
  await page.eval(`document.querySelector(".rc__undo").click(); true`);
  await page.until(`document.querySelector("#script").textContent.includes("the bowl with a plate")`, "Undo after the reload puts the person's words back");
  await pickOpen(page, "b/script.md", "What if the best part");
  await page.until(`document.querySelectorAll("#script .shot-frame__jump").length === 1`, "the walk script.md shows its own list");
  const walk = await shotLabels(page);
  check(walk.length === 1 && walk[0].includes("Shoes by the door") && !walk[0].includes("Check"), "the walk script.md: its own shot, no Check", JSON.stringify(walk));
  check(await page.eval(`!document.querySelector("#script .agent-change") && !document.querySelector("#script .ask") && document.querySelector("#banner").hidden`), "the walk script.md: no marks, asks or Unsaved changes of the bread script");
  await page.shot("ownkeys-2-walk-own-list");
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}
// The files on the recent list when this version first runs take what was kept under their name: each gets the B-roll
// list, the newest the draft ("Unsaved changes"), and the name lets go.
async function runMigrate() {
  console.log("--- moving to keys: the files on the list take what their name held (1280 px)");
  const { page } = await connect(1280, 800);
  await writeDisk(page, "a/script.md", md(BREAD));
  await writeDisk(page, "b/script.md", md(WALK));
  await sleep(50);
  const unsaved = `${md(WALK).trimEnd()}\n\nWords typed before the update.\n`;
  await page.eval(`(async () => { const disk = await (await navigator.storage.getDirectory()).getDirectoryHandle("disk"); const h = async (d) => (await disk.getDirectoryHandle(d)).getFileHandle("script.md"); const recent = [{ handle: await h("b"), name: "script.md", at: Date.now() }, { handle: await h("a"), name: "script.md", at: Date.now() - 1000 }]; await new Promise((res) => { const r = indexedDB.open("script-editor", 1); r.onsuccess = () => { const t = r.result.transaction("handles", "readwrite"); const s = t.objectStore("handles"); s.put(recent, "recent"); s.delete("fileIds"); s.delete("fileIdsSince"); s.put({ name: "shared-broll.md", text: ${JSON.stringify(listFor([["B1", "Flour and a clock", BREAD.lines[0]], ["B2", "Shoes by the door", WALK.lines.at(-1)]]))} }, "broll:script.md"); t.oncomplete = res; }; }); localStorage.setItem("script-editor:draft:script.md", JSON.stringify({ text: ${JSON.stringify(unsaved)}, at: Date.now() + 5000, asks: [] })); return true; })()`);
  await page.send("Page.reload", {});
  await sleep(300);
  await page.until(`document.readyState === "complete" && !!document.querySelector("#emptyOpen")`, "the start screen after the update");
  await page.until(`localStorage.getItem("script-editor:draft:script.md") === null`, "the name's draft is handed to a file", 6000);
  await pickOpen(page, "b/script.md", "What if the best part");
  await page.until(`!document.querySelector("#banner").hidden && document.querySelector("#banner").textContent.startsWith("Unsaved changes")`, "the newest script.md offers the words typed before the update");
  await page.until(`document.querySelectorAll("#script .shot-frame__jump").length === 1`, "the newest script.md shows the list its name had");
  await pickOpen(page, "a/script.md", "Good bread needs");
  await page.until(`document.querySelectorAll("#script .shot-frame__jump").length === 1`, "the older script.md shows the list its name had too");
  check(await page.eval(`document.querySelector("#banner").hidden || !document.querySelector("#banner").textContent.startsWith("Unsaved changes")`), "the older script.md does not get the newest one's unsaved words");
  check((await idbGet(page, "broll:script.md")) === "null", "the name lets go of the list link");
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

// Release review on PR #78 (P2): a script left while the Storyboard shows keeps its caret; it comes back in the Script view.
async function runBoardCaret() {
  console.log("--- the caret of a script left from the Storyboard (1280 px)");
  const { page, A, B } = await start(1280, 800);
  await openFromMenu(page, A);
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith("Walk note 6")); el.scrollIntoView({ block: "center" }); el.focus(); getSelection().collapse(el.firstChild, 12); })()`);
  await sleep(200);
  await page.click(`#viewSwitch [data-view="board"]`);
  await page.until(`document.querySelector("#layout").dataset.view === "board"`, "the Storyboard shows");
  await openFromMenu(page, B); // A is left while the Storyboard shows
  await openFromMenu(page, A);
  await page.click(`#viewSwitch [data-view="script"]`);
  await page.until(`document.querySelector("#layout").dataset.view === ""`, "the Script view shows");
  await sleep(300);
  const at = await page.eval(`(() => { const s = getSelection(), el = document.activeElement; return { line: el?.textContent?.slice(0, 11), at: s.rangeCount ? s.getRangeAt(0).startOffset : -1 }; })()`);
  check(at.line === "Walk note 6" && at.at === 12, "A's caret comes back where it was", JSON.stringify(at));
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();
}

// Release review on PR #78 (SL-1): a "/" command is being typed, "Open a script…" is chosen and the picker is cancelled.
// Nothing opened, so focus elsewhere makes the command ordinary text again, and it saves as usual.
async function runOpenCancelled() {
  console.log("--- a / command, then Open a script… cancelled (1280 px)");
  const { page, B } = await start(1280, 800);
  await typeCommand(page, "Bread note 4", " /on");
  await page.eval(`window.__pick = null; true`); // the picker is cancelled
  await page.click("#docSwitch");
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await page.eval(`document.querySelector("#menuOpen").click(); true`);
  await sleep(500);
  check(await page.eval(`document.querySelector("#fileName").textContent === ${JSON.stringify(B)}`), "B is still open");
  await page.eval(`document.querySelector("#exportBtn").focus(); true`); // focus moves to another button
  await page.until(fileHas(B, " /on"), "after the cancelled picker, the typed words save as usual", 6000);
  const errs = await page.errors();
  check(!errs.length, "no page error or CSP violation", errs.join(" | "));
  await page.close();

  // Where the browser has no file picker (Firefox, Safari), "Open a script…" uses a file field and returns at once.
  console.log("--- the same where the browser has no file picker (1280 px)");
  const fb = await start(1280, 800, "delete window.showOpenFilePicker;");
  await fb.page.send("Page.setInterceptFileChooserDialog", { enabled: true }); // the chooser is answered below
  const fileInput = async () => (await fb.page.send("DOM.querySelector", { nodeId: (await fb.page.send("DOM.getDocument", {})).root.nodeId, selector: "#fileInput" })).nodeId;
  // (a) A file is picked: focus moves while the dialog is open, and the "/" command still stays out of B.
  await typeCommand(fb.page, "Bread note 4", " /on");
  await fb.page.click("#docSwitch");
  await fb.page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await fb.page.eval(`document.querySelector("#menuOpen").click(); true`);
  await sleep(300);
  await fb.page.eval(`document.querySelector("#exportBtn").focus(); true`); // focus comes back elsewhere after the dialog
  const pickDir = new URL("../.scratch/tools-358/", import.meta.url).pathname;
  mkdirSync(pickDir, { recursive: true }); // a fresh checkout has no .scratch folder
  const pickPath = `${pickDir}picked.md`;
  writeFileSync(pickPath, "# Picked\n\nA picked script.\n");
  await fb.page.send("DOM.setFileInputFiles", { files: [pickPath], nodeId: await fileInput() });
  await fb.page.until(`document.querySelector("#fileName").textContent === "picked.md"`, "the picked script opens");
  await sleep(800);
  check(await fileLacks(fb.page, fb.B, " /on"), "with no file picker, picking a file still leaves the / command out of B");
  // (b) The file field is cancelled: back in B, the typed words save as usual.
  await openFromMenu(fb.page, fb.B);
  await typeCommand(fb.page, "Bread note 5", " /sil");
  await fb.page.click("#docSwitch");
  await fb.page.until(`document.querySelector("#scriptMenu").matches(":popover-open")`, "the script menu");
  await fb.page.eval(`document.querySelector("#menuOpen").click(); true`);
  await sleep(300);
  await fb.page.eval(`document.querySelector("#fileInput").dispatchEvent(new Event("cancel")); document.querySelector("#exportBtn").focus(); true`);
  await fb.page.until(fileHas(fb.B, " /sil"), "with no file picker, after a cancel the typed words save as usual", 6000);
  const fbErrs = await fb.page.errors();
  check(!fbErrs.length, "no page error or CSP violation (no file picker)", fbErrs.join(" | "));
  await fb.page.close();
}

// SMOKE_ONLY=slash (or desktop, phone, edges, focus, samename, removed, board, deletekept, boardcaret, opencancel,
// ownkeys, migrate) runs one part.
const only = process.env.SMOKE_ONLY || "";
try {
  if (!only || only === "desktop") await run({ width: 1280, height: 800, label: "desktop", undoBy: "tag" });
  if (!only || only === "phone") await run({ width: 390, height: 844, label: "phone", undoBy: "key" });
  if (!only || only === "edges") await runEdges();
  if (!only || only === "slash") { await runSlash(1280, 800); await runSlash(390, 844); }
  if (!only || only === "focus") await runFocus();
  if (!only || only === "samename") await runSameName();
  if (!only || only === "removed") await runRemovedMidSave();
  if (!only || only === "deletesame") await runDeleteSameName();
  if (!only || only === "board") await runBoard();
  if (!only || only === "deletekept") await runDeleteKeptSameName();
  if (!only || only === "boardcaret") await runBoardCaret();
  if (!only || only === "opencancel") await runOpenCancelled();
  if (!only || only === "ownkeys") await runOwnKeys();
  if (!only || only === "migrate") await runMigrate();
} catch (e) {
  check(false, "the check ran to the end", e.stack || e.message);
}
cdp.close();
console.log(failures ? `RESULT: fail several-scripts ${failures} failed` : "RESULT: ok several-scripts");
process.exit(failures ? 1 : 0);
