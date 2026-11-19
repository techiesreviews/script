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
})();`;

async function openTab(width, height) {
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

// A fresh profile with the agent connected and two made-up scripts saved in the browser; B is open.
async function start(width, height) {
  const page = await openTab(width, height);
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
async function askShorter(page, mcp, words) {
  await page.eval(`(() => { const el = [...document.querySelectorAll('#script .block[data-type="para"]')].find((x) => x.textContent.startsWith(${JSON.stringify(words)})); el.scrollIntoView({ block: "center" }); const t = el.firstChild; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, t.data.length); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await page.until(`!document.querySelector("#editBar").hidden`, "the edit bar shows on the selection");
  await page.click("#askInput");
  await page.send("Input.insertText", { text: "Shorter" });
  await sleep(80);
  await page.key("Enter", "Enter", 13, "\r");
  await page.until(`!!document.querySelector("#script .ask")`, "the ask shows");
  const asks = JSON.parse(toolText(await mcp("tools/call", { name: "wait_for_asks", arguments: { waitSeconds: 5 } })) || "{}").asks || [];
  return asks.find((a) => a.quote?.startsWith(words));
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
  await page.until(`[...document.querySelectorAll("#script .agent-change")].some((m) => m.textContent.includes("Cover the bowl"))`, "after a reload B still shows the change, marked");
  await page.until(`!!document.querySelector(".rc__undo")`, "with Undo on the agent's tag after the reload");
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

  // Switching through the menu while a command is typed; meanwhile the agent shortens the words before it.
  const ask2 = await askShorter(page, mcp, "Bread note 4");
  await typeCommand(page, "Bread note 4", " /on");
  await page.click("#docSwitch"); // a real click: focus goes to the menu (its search box on a desktop, the button on a phone)
  await page.until(`document.querySelector("#scriptMenu").matches(":popover-open") && document.querySelector("#scriptList .scripts__open[aria-current]")`, "the script menu");
  const r2 = await mcp("tools/call", { name: "answer_ask", arguments: { askId: ask2?.id, kind: "replace", text: "Bread note four." } });
  check(!r2?.result?.isError, "an answer lands before the command while the menu is open", toolText(r2));
  const before = "Bread note four.";
  await sleep(2000); // longer than the auto-save pause
  check(await fileLacks(page, B, " /on"), "with the file-name menu open, /on is not saved into B's file");
  await page.eval(`(${row(A)}).querySelector(".scripts__open").click()`);
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

// SMOKE_ONLY=slash (or desktop, phone, edges) runs one part.
const only = process.env.SMOKE_ONLY || "";
try {
  if (!only || only === "desktop") await run({ width: 1280, height: 800, label: "desktop", undoBy: "tag" });
  if (!only || only === "phone") await run({ width: 390, height: 844, label: "phone", undoBy: "key" });
  if (!only || only === "edges") await runEdges();
  if (!only || only === "slash") { await runSlash(1280, 800); await runSlash(390, 844); }
} catch (e) {
  check(false, "the check ran to the end", e.stack || e.message);
}
cdp.close();
console.log(failures ? `RESULT: fail several-scripts ${failures} failed` : "RESULT: ok several-scripts");
process.exit(failures ? 1 : 0);
