#!/usr/bin/env node
// Smoke test for the relay and MCP. Start the Worker first: npx wrangler@4 dev
// Then: node scripts/smoke-relay.mjs [base URL, default http://127.0.0.1:8787]
// It plays the editor tab over WebSocket and the agent over fetch to /mcp. No network beyond the local Worker.
const BASE = (process.argv[2] || process.env.SMOKE_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "ok" : "FAIL"} ${label}${extra && !ok ? ` (${extra})` : ""}`);
  if (!ok) failures++;
};
const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

/* ---------- The fake tab ---------- */
const asks = [];
const waiters = [];
const received = { agent: null, answers: [] };
let ws;
function tabConnect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(`${WS_BASE}/api/relay`, ["script-editor", `t.${token}`]);
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (e) => reject(new Error(e.message || "WebSocket error")));
    ws.addEventListener("message", (e) => onTabMessage(JSON.parse(e.data)));
  });
}
const reply = (id, payload) => ws.send(JSON.stringify({ type: "result", id, ...payload }));
const unseen = () => asks.filter((a) => a.status === "waiting");
function take(list) { for (const a of list) a.status = "taken"; return list.map(({ id, scope, action, instruction, quote, context, section, createdAt }) => ({ id, scope, action, instruction, quote, context, section, createdAt })); }
function onTabMessage(m) {
  if (m.type === "agent") received.agent = m;
  if (m.type !== "call") return;
  if (m.tool === "get_script") return reply(m.id, { result: { fileName: "smoke.md", title: "Smoke", markdown: "# Smoke\n\n## 1 · Hook (0:00)\n\nHello there.\n", sections: [{ heading: "1 · Hook (0:00)", spoken: true }], words: 2, spoken: "0:01" } });
  if (m.tool === "wait_for_asks") {
    const now = unseen();
    if (now.length) return reply(m.id, { result: { asks: take(now) } });
    const timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reply(m.id, { result: { asks: [], message: "No asks yet. Call wait_for_asks again to keep listening." } }); }, (m.args.waitSeconds ?? 25) * 1000);
    const w = { id: m.id, timer };
    waiters.push(w);
    return;
  }
  if (m.tool === "answer_ask") {
    const a = asks.find((x) => x.id === m.args.askId);
    if (!a || (a.status !== "waiting" && a.status !== "taken")) return reply(m.id, { error: "Unknown ask." });
    a.status = "answered";
    a.answer = { kind: m.args.kind, text: m.args.text };
    received.answers.push(m.args);
    return reply(m.id, { result: "Shown to the person. They choose Keep or Undo." });
  }
  if (m.tool === "list_asks") return reply(m.id, { result: { asks: asks.map(({ id, action, status, answer }) => ({ id, action, status, answer })) } });
  reply(m.id, { error: "Unknown tool" });
}
function makeAsk() {
  const a = { id: "ask" + asks.length, scope: "selection", action: "simpler", instruction: "Use simpler words.", quote: "Hello there.", context: "Hello there.", section: "1 · Hook (0:00)", createdAt: new Date().toISOString(), status: "waiting" };
  asks.push(a);
  const w = waiters.shift();
  if (w) { clearTimeout(w.timer); reply(w.id, { result: { asks: take(unseen()) } }); }
}

/* ---------- The agent ---------- */
let rpcId = 0;
async function mcp(method, params, { auth = token, origin, notification = false } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (origin) headers.Origin = origin;
  const body = { jsonrpc: "2.0", method, ...(params ? { params } : {}), ...(notification ? {} : { id: ++rpcId }) };
  const res = await fetch(`${BASE}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const toolText = (r) => r.body?.result?.content?.[0]?.text ?? "";

try {
  // Before any tab: the token is unknown, so the relay refuses it.
  const early = await mcp("tools/list");
  check(early.status === 401, "unknown token gets 401", early.status);
  const none = await mcp("tools/list", null, { auth: null });
  check(none.status === 401, "no token gets 401", none.status);
  const get = await fetch(`${BASE}/mcp`);
  check(get.status === 405, "GET /mcp gets 405", get.status);

  await tabConnect();
  check(ws.protocol === "script-editor", "relay answers with the script-editor subprotocol", ws.protocol);
  await sleep(200);

  const init = await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke-agent", version: "1.0" } });
  check(init.status === 200 && init.body.result?.protocolVersion === "2025-06-18", "initialize echoes the protocol version", JSON.stringify(init.body));
  check(init.body.result?.serverInfo?.name === "script-editor", "serverInfo is script-editor");
  const note = await mcp("notifications/initialized", null, { notification: true });
  check(note.status === 202, "notification gets 202", note.status);
  await sleep(200);
  check(received.agent?.name === "smoke-agent", "tab learns the agent's name", JSON.stringify(received.agent));

  const foreign = await mcp("tools/list", null, { origin: "https://evil.example" });
  check(foreign.status === 403, "foreign Origin is refused", foreign.status);

  const list = await mcp("tools/list");
  const names = list.body.result?.tools?.map((t) => t.name).sort().join(",");
  check(names === "answer_ask,get_script,list_asks,sketch_shot,wait_for_asks", "tools/list has the five tools", names);

  const script = await mcp("tools/call", { name: "get_script", arguments: {} });
  check(JSON.parse(toolText(script) || "{}").title === "Smoke", "get_script returns the tab's script", toolText(script));

  const waiting = mcp("tools/call", { name: "wait_for_asks", arguments: { waitSeconds: 10 } });
  await sleep(700);
  makeAsk();
  const got = await waiting;
  const delivered = JSON.parse(toolText(got) || "{}").asks ?? [];
  check(delivered.length === 1 && delivered[0].id === "ask0" && delivered[0].quote === "Hello there.", "wait_for_asks returns the new ask", toolText(got));

  const answered = await mcp("tools/call", { name: "answer_ask", arguments: { askId: "ask0", kind: "replace", text: "Hi." } });
  check(!answered.body.result?.isError && toolText(answered).includes("Shown to the person"), "answer_ask reaches the tab", toolText(answered));
  check(received.answers[0]?.text === "Hi.", "tab received the answer");

  const tooLong = await mcp("tools/call", { name: "answer_ask", arguments: { askId: "ask0", kind: "replace", text: "x".repeat(4001) } });
  check(tooLong.body.result?.isError === true, "over-long text is refused before the tab");

  const listed = await mcp("tools/call", { name: "list_asks", arguments: {} });
  check(JSON.parse(toolText(listed) || "{}").asks?.[0]?.status === "answered", "list_asks shows the answered status", toolText(listed));

  const quiet = await mcp("tools/call", { name: "wait_for_asks", arguments: { waitSeconds: 1 } });
  check(toolText(quiet).includes("No asks yet"), "wait_for_asks says no asks yet after its wait", toolText(quiet));

  // A second tab takes over; the first is closed with 4001.
  const first = ws;
  const closed = new Promise((r) => first.addEventListener("close", (e) => r(e.code)));
  await tabConnect();
  check((await Promise.race([closed, sleep(3000).then(() => "none")])) === 4001, "an older tab is closed with 4001");

  // Disconnect: the tab revokes the token, then the agent is refused.
  ws.send(JSON.stringify({ type: "revoke" }));
  await sleep(400);
  const after = await mcp("tools/list");
  check(after.status === 401, "a revoked token gets 401", after.status);

  // No tab connected: tools say the editor is not open.
  const token2 = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const ws2 = new WebSocket(`${WS_BASE}/api/relay`, ["script-editor", `t.${token2}`]);
  await new Promise((r) => ws2.addEventListener("open", r));
  ws2.close();
  await sleep(400);
  const r2 = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token2}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_script", arguments: {} } }) });
  const b2 = await r2.json();
  check(b2.result?.isError && b2.result.content[0].text.startsWith("The script editor is not open"), "with no tab, tools say the editor is not open", JSON.stringify(b2));
} catch (e) {
  console.log("FAIL", e?.message || e);
  failures++;
} finally {
  try { ws?.close(); } catch { /* closed */ }
}
console.log(`RESULT: ${failures ? "fail" : "ok"} smoke`);
process.exit(failures ? 1 : 0);
