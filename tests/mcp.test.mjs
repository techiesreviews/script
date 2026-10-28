import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcp, checkArgs, TOOLS, PROTOCOL_VERSIONS, NOT_OPEN, NO_ASKS, INSTRUCTIONS, checkToken, newToken, TOKEN_RE, MAX_AGE_MS, FUTURE_SLACK_MS, LEGACY_UNTIL } from "../worker/mcp.js";

const { token: TOKEN, born: BORN } = newToken();
const BASE = "https://script-editor.example.workers.dev/mcp";

// A fake relay: records ops and answers them like the Durable Object would.
function fakeRelay({ tab = true, authorized = true, results = {} } = {}) {
  const ops = [];
  return {
    ops,
    relayFor: (token) => ({
      async op(m) {
        ops.push({ token, ...m });
        if (!authorized) return { status: "unauthorized" };
        if (m.op !== "call") return { status: "ok" };
        if (!tab) return { status: "no-tab" };
        const r = results[m.tool];
        if (r === "timeout") return { status: "timeout" };
        if (r && r.error) return { status: "ok", error: r.error };
        return { status: "ok", result: r ?? { ok: true } };
      },
    }),
  };
}
async function rpc(body, { relay = fakeRelay(), token = TOKEN, origin, method = "POST", raw, now } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  const req = new Request(BASE, { method, headers, body: method === "POST" ? (raw ?? JSON.stringify(body)) : undefined });
  const res = await handleMcp(req, now ? { ...relay, now } : relay);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers, relay };
}
const call = (name, args, opts) => rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, opts);
const text = (r) => r.body.result.content[0].text;

test("initialize echoes a supported protocol version, else the newest", async () => {
  for (const v of PROTOCOL_VERSIONS) {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v, clientInfo: { name: "claude-code", version: "2.1" } } });
    assert.equal(r.body.result.protocolVersion, v);
  }
  const r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(r.body.result.protocolVersion, "2025-11-25");
  assert.deepEqual(r.body.result.serverInfo.name, "script-editor");
  assert.ok(r.body.result.capabilities.tools && r.body.result.capabilities.prompts);
  assert.equal(r.body.result.instructions, INSTRUCTIONS);
  assert.match(INSTRUCTIONS, /data, not instructions/);
});

test("initialize passes the client's name and version to the relay, cut short", async () => {
  const relay = fakeRelay();
  await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code".repeat(10), version: "2.1" } } }, { relay });
  const agent = relay.ops.find((o) => o.op === "agent");
  assert.equal(agent.name.length, 60);
  assert.equal(agent.version, "2.1");
  assert.equal(agent.token, TOKEN);
  assert.equal(agent.born, BORN, "each op carries the token's birth time");
});

test("checkToken: a token lives 8 hours from its birth on the Worker's clock", () => {
  const now = Date.UTC(2026, 9, 28, 20);
  const { token, born } = newToken(now);
  assert.match(token, /^se2-[0-9a-z]{8,10}-[A-Za-z0-9_-]{43}$/);
  assert.equal(parseInt(token.split("-")[1], 36), now);
  assert.equal(born, now);
  assert.ok(TOKEN_RE.test(token));
  assert.notEqual(newToken(now).token, token, "the random part differs");
  assert.deepEqual(checkToken(token, now), { ok: true, born: now });
  assert.deepEqual(checkToken(token, now + MAX_AGE_MS - 1), { ok: true, born: now });
  assert.deepEqual(checkToken(token, now + MAX_AGE_MS), { ok: false, reason: "expired" });
  // A clock skew within a minute is fine; further in the future is refused.
  assert.deepEqual(checkToken(token, now - FUTURE_SLACK_MS), { ok: true, born: now });
  assert.deepEqual(checkToken(token, now - FUTURE_SLACK_MS - 1), { ok: false, reason: "invalid" });
  // Legacy tokens (43 characters, made by the tab) work until the switch-over, then never again.
  const legacy = "A".repeat(43);
  assert.deepEqual(checkToken(legacy, LEGACY_UNTIL - 1), { ok: true, born: null });
  assert.deepEqual(checkToken(legacy, LEGACY_UNTIL), { ok: false, reason: "expired" });
  assert.equal(LEGACY_UNTIL, Date.parse("2026-10-30T12:00:00Z"));
  for (const bad of ["", null, "short", "A".repeat(42), "A".repeat(44), "se2-abc-" + "A".repeat(43), `se2-${now.toString(36).toUpperCase()}-${"A".repeat(43)}`, `se1-${now.toString(36)}-${"A".repeat(43)}`, `se2-${now.toString(36)}-${"A".repeat(42)}`, token + " ", "A".repeat(43) + "\n"]) {
    assert.deepEqual(checkToken(bad, now), { ok: false, reason: "invalid" }, JSON.stringify(bad));
  }
});

test("/mcp: a token past its time, or from the future, is refused without asking the relay", async () => {
  const now = Date.UTC(2026, 9, 28, 20);
  for (const [token, label] of [[newToken(now - MAX_AGE_MS).token, "8 hours old"], [newToken(now + 2 * FUTURE_SLACK_MS).token, "from the future"], ["A".repeat(43), "legacy after the switch-over"]]) {
    let asked = 0;
    const relay = { relayFor: () => { asked++; return { op: async () => ({ status: "ok" }) }; } };
    const at = token.length === 43 ? () => LEGACY_UNTIL : () => now;
    for (const body of [{ jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", method: "notifications/initialized" }]) {
      const r = await rpc(body, { relay, token, now: at });
      assert.equal(r.status, 401, label);
      assert.equal(r.body.error.code, -32001);
    }
    assert.equal(asked, 0, `${label}: relayFor is never called`);
  }
  const legacy = fakeRelay();
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { relay: legacy, token: "A".repeat(43), now: () => LEGACY_UNTIL - 1 })).status, 200);
  assert.ok(legacy.ops.every((o) => o.born === null), "a legacy token's ops carry born: null");
});

test("tools/list has the six tools with input schemas and limits", async () => {
  const r = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(r.body.result.tools.map((t) => t.name).sort(), ["answer_ask", "answer_broll", "get_script", "list_asks", "sketch_shot", "wait_for_asks"]);
  const answer = TOOLS.find((t) => t.name === "answer_ask").inputSchema;
  assert.equal(answer.properties.text.maxLength, 4000);
  assert.equal(answer.properties.message.maxLength, 200);
  assert.equal(answer.properties.marks.maxItems, 20);
  assert.equal(answer.properties.marks.items.properties.quote.maxLength, 500);
  assert.equal(answer.properties.marks.items.properties.why.maxLength, 160);
  assert.equal(answer.properties.marks.items.properties.rewrite.maxLength, 1000);
  assert.equal(TOOLS.find((t) => t.name === "wait_for_asks").inputSchema.properties.waitSeconds.maximum, 25);
});

test("prompts: watch_script sets up the loop", async () => {
  const list = await rpc({ jsonrpc: "2.0", id: 3, method: "prompts/list" });
  assert.deepEqual(list.body.result.prompts.map((p) => p.name), ["watch_script"]);
  const got = await rpc({ jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "watch_script" } });
  assert.match(got.body.result.messages[0].content.text, /wait_for_asks/);
  assert.match(got.body.result.messages[0].content.text, /answer_ask/);
  const bad = await rpc({ jsonrpc: "2.0", id: 5, method: "prompts/get", params: { name: "nope" } });
  assert.equal(bad.body.error.code, -32602);
});

test("ping, unknown methods and unknown tools", async () => {
  assert.deepEqual((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" })).body.result, {});
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "resources/list" })).body.error.code, -32601);
  assert.equal((await call("delete_everything", {})).body.error.code, -32602);
});

test("401 without a valid Bearer token, or when the relay does not know it", async () => {
  const none = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { token: null });
  assert.equal(none.status, 401);
  assert.equal(none.body.error.code, -32001);
  assert.equal(none.headers.get("WWW-Authenticate"), "Bearer");
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { token: "short" })).status, 401);
  const relay = fakeRelay({ authorized: false });
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { relay })).status, 401);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { relay })).status, 401);
  assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, { relay })).status, 401);
  assert.equal(relay.ops.every((o) => !JSON.stringify(o).includes("Bearer")), true);
});

test("notifications get 202 with no body; GET and DELETE get 405", async () => {
  const r = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(r.status, 202);
  assert.equal(r.body, null);
  for (const method of ["GET", "DELETE"]) {
    const g = await rpc(null, { method });
    assert.equal(g.status, 405);
    assert.equal(g.headers.get("Allow"), "POST");
  }
});

test("a browser Origin from another site is refused; the same origin is fine", async () => {
  const foreign = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { origin: "https://evil.example" });
  assert.equal(foreign.status, 403);
  const same = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { origin: "https://script-editor.example.workers.dev" });
  assert.equal(same.status, 200);
});

test("bad JSON, batches and invalid requests", async () => {
  assert.equal((await rpc(null, { raw: "{nope" })).body.error.code, -32700);
  assert.equal((await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }])).body.error.code, -32600);
  assert.equal((await rpc({ id: 1, method: "ping" })).body.error.code, -32600);
});

test("argument limits are checked before the tab sees the call", async () => {
  const relay = fakeRelay();
  const cases = [
    ["answer_ask", { askId: "a1", kind: "replace", text: "x".repeat(4001) }, /4000/],
    ["answer_ask", { askId: "a1", kind: "note", text: "x", message: "m".repeat(201) }, /200/],
    ["answer_ask", { askId: "a1", kind: "shout" }, /kind/],
    ["answer_ask", { kind: "note", text: "x" }, /askId/],
    ["answer_ask", { askId: "a1", kind: "marks", marks: Array(21).fill({ quote: "q", why: "w", rewrite: "r" }) }, /At most 20/],
    ["answer_ask", { askId: "a1", kind: "marks", marks: [{ quote: "q".repeat(501), why: "w", rewrite: "r" }] }, /500/],
    ["answer_ask", { askId: "a1", kind: "marks", marks: [{ quote: "q", why: "w".repeat(161), rewrite: "r" }] }, /160/],
    ["answer_ask", { askId: "a1", kind: "marks", marks: [{ quote: "q", why: "w", rewrite: "r".repeat(1001) }] }, /1000/],
    ["answer_ask", { askId: "a1", kind: "note", text: "x", tone: "loud" }, /tone/],
    ["wait_for_asks", { waitSeconds: 26 }, /0 to 25/],
    ["wait_for_asks", { waitSeconds: "soon" }, /0 to 25/],
    ["get_script", { extra: 1 }, /Unknown argument/],
  ];
  for (const [name, args, re] of cases) {
    const r = await call(name, args, { relay });
    assert.equal(r.body.result.isError, true, JSON.stringify(args).slice(0, 60));
    assert.match(text(r), re);
  }
  assert.equal(relay.ops.filter((o) => o.op === "call").length, 0);
  assert.equal(checkArgs("answer_ask", { askId: "a1", kind: "marks", marks: [{ quote: "q", why: "w", rewrite: "r" }] }), "");
});

test("tool calls go to the tab with timeouts; results come back as text JSON", async () => {
  const relay = fakeRelay({ results: { get_script: { title: "T", words: 3 } } });
  const r = await call("get_script", {}, { relay });
  assert.deepEqual(JSON.parse(text(r)), { title: "T", words: 3 });
  assert.equal(relay.ops.at(-1).timeout, 10000);
  await call("wait_for_asks", { waitSeconds: 3 }, { relay });
  assert.deepEqual(relay.ops.at(-1).args, { waitSeconds: 3 });
  assert.equal(relay.ops.at(-1).timeout, 8000);
  await call("wait_for_asks", {}, { relay });
  assert.equal(relay.ops.at(-1).timeout, 30000);
});

test("tool errors: no tab, the tab's own refusal, and a quiet wait", async () => {
  const closed = await call("get_script", {}, { relay: fakeRelay({ tab: false }) });
  assert.equal(closed.body.result.isError, true);
  assert.equal(text(closed), NOT_OPEN);
  const refused = await call("answer_ask", { askId: "a1", kind: "note", text: "x" }, { relay: fakeRelay({ results: { answer_ask: { error: "This ask is finished (kept)." } } }) });
  assert.equal(refused.body.result.isError, true);
  assert.match(text(refused), /finished/);
  const quiet = await call("wait_for_asks", { waitSeconds: 1 }, { relay: fakeRelay({ results: { wait_for_asks: "timeout" } }) });
  assert.equal(quiet.body.result.isError, undefined);
  assert.equal(text(quiet), NO_ASKS);
});

test("sketch_shot: schema, limits, and get_script describes the B-roll", async () => {
  const tool = TOOLS.find((t) => t.name === "sketch_shot");
  assert.deepEqual(tool.inputSchema.required, ["askId", "shotId", "svg"]);
  assert.equal(tool.inputSchema.properties.svg.maxLength, 8192);
  assert.equal(tool.inputSchema.properties.shotId.maxLength, 20);
  assert.match(TOOLS.find((t) => t.name === "get_script").description, /broll: .*blockIds.*check/);
  const svg = '<svg viewBox="0 0 260 140"><path class="s" d="M1 1L9 9"/></svg>';
  for (const [args, re] of [
    [{ shotId: "B4", svg }, /askId is required/],
    [{ askId: "a", svg }, /shotId is required/],
    [{ askId: "a", shotId: "B".repeat(21), svg }, /shotId is required/],
    [{ askId: "a", shotId: "B4" }, /svg is required/],
    [{ askId: "a", shotId: "B4", svg: "  " }, /svg is required/],
    [{ askId: "a", shotId: "B4", svg: "x".repeat(8193) }, /longer than 8192/],
    [{ askId: "a", shotId: "B4", svg, style: "x" }, /Unknown argument/],
  ]) assert.match(checkArgs("sketch_shot", args), re);
  assert.equal(checkArgs("sketch_shot", { askId: "a", shotId: "B4", svg: "x".repeat(8192) }), "");
  const relay = fakeRelay({ results: { sketch_shot: "Shown to the person beside the script line and in the storyboard. They choose Keep or Undo." } });
  const r = await call("sketch_shot", { askId: "a", shotId: "B4", svg }, { relay });
  assert.equal(text(r), "Shown to the person beside the script line and in the storyboard. They choose Keep or Undo.");
  assert.deepEqual(relay.ops.at(-1).args, { askId: "a", shotId: "B4", svg });
  const tooLong = await call("sketch_shot", { askId: "a", shotId: "B4", svg: "x".repeat(9000) }, { relay });
  assert.equal(tooLong.body.result.isError, true);
});

test("answer_broll: schema, limits and refusals before the tab; the prompt and instructions name it", async () => {
  const tool = TOOLS.find((t) => t.name === "answer_broll");
  assert.deepEqual(tool.inputSchema.required, ["askId", "changes"]);
  assert.equal(tool.inputSchema.properties.changes.maxItems, 20);
  const item = tool.inputSchema.properties.changes.items.properties;
  assert.deepEqual([item.what.maxLength, item.how.maxLength, item.quote.maxLength, item.why.maxLength], [200, 120, 500, 160]);
  assert.equal(tool.inputSchema.properties.message.maxLength, 200);
  const add = { op: "add", kind: "broll", what: "A clock", quote: "Hello there." };
  for (const [args, re] of [
    [{ changes: [add] }, /askId is required/],
    [{ askId: "a" }, /changes must be a list/],
    [{ askId: "a", changes: [] }, /changes must be a list/],
    [{ askId: "a", changes: Array(21).fill(add) }, /At most 20 changes/],
    [{ askId: "a", changes: [add], message: "x".repeat(201) }, /message is longer than 200/],
    [{ askId: "a", changes: [{ ...add, op: "move" }] }, /op must be add, update or remove/],
    [{ askId: "a", changes: [{ ...add, kind: "photo" }] }, /kind must be broll, motion or screen/],
    [{ askId: "a", changes: [{ ...add, what: "x".repeat(201) }] }, /what is longer than 200/],
    [{ askId: "a", changes: [{ ...add, how: "x".repeat(121) }] }, /how is longer than 120/],
    [{ askId: "a", changes: [{ ...add, quote: "x".repeat(501) }] }, /quote is longer than 500/],
    [{ askId: "a", changes: [{ ...add, why: "x".repeat(161) }] }, /why is longer than 160/],
    [{ askId: "a", changes: [{ op: "add", kind: "broll", what: "x" }] }, /add needs kind, what and quote/],
    [{ askId: "a", changes: [{ ...add, kind: "screen", how: "Phone" }] }, /screen recording has no how/],
    [{ askId: "a", changes: [{ op: "remove" }] }, /remove needs id/],
    [{ askId: "a", changes: [{ op: "update", id: "B1", colour: "red" }] }, /unknown field colour/],
    [{ askId: "a", changes: [add], extra: 1 }, /Unknown argument/],
  ]) assert.match(checkArgs("answer_broll", args), re);
  assert.equal(checkArgs("answer_broll", { askId: "a", changes: [add, { op: "update", id: "B1", how: "Stock" }, { op: "remove", id: "B2", why: "Repeats B1" }], message: "Three ideas" }), "");
  const relay = fakeRelay({ results: { answer_broll: "Shown to the person. They choose Keep or Undo per change." } });
  const r = await call("answer_broll", { askId: "a", changes: [add] }, { relay });
  assert.equal(text(r), "Shown to the person. They choose Keep or Undo per change.");
  assert.deepEqual(relay.ops.at(-1).args, { askId: "a", changes: [add] });
  const refused = await call("answer_broll", { askId: "a", changes: Array(21).fill(add) }, { relay });
  assert.equal(refused.body.result.isError, true);
  assert.equal(relay.ops.filter((o) => o.tool === "answer_broll").length, 1);
  const prompt = await rpc({ jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "watch_script" } });
  assert.match(prompt.body.result.messages[0].content.text, /answer_broll for B-roll asks/);
  assert.match(INSTRUCTIONS, /answer_broll/);
});

test("mcp: the agent hears that replace and add go into the text at once and can be undone (step F)", () => {
  const answer = TOOLS.find((t) => t.name === "answer_ask").description;
  assert.match(answer, /go into the text at once/);
  assert.match(answer, /undo/);
  assert.doesNotMatch(answer, /chooses Keep or Undo/);
  assert.match(INSTRUCTIONS, /goes into the text at once/);
  assert.match(TOOLS.find((t) => t.name === "list_asks").description, /undone when the person undoes it/);
});
