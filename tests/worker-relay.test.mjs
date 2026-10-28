import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { createHash } from "node:crypto";

// worker/index.js and the relay import "cloudflare:workers"; a tiny stand-in lets Node load them.
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  return next(specifier, context);
}`));

/* ---------- Stand-ins for the Workers runtime ---------- */
class FakeSocket {
  constructor() { this.sent = []; this.closed = false; this.accepted = false; }
  accept() { this.accepted = true; }
  send(text) { if (this.closed) throw new Error("closed"); this.sent.push(JSON.parse(text)); }
  close(code = 1000, reason = "") { if (this.closed) return; this.closed = true; this.code = code; this.reason = reason; }
}
const pairs = [];
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeSocket(); this[1] = new FakeSocket(); pairs.push(this); } };
const lastServer = () => pairs.at(-1)[1];
globalThis.WebSocketRequestResponsePair = class { constructor(request, response) { Object.assign(this, { request, response }); } };
// Node's Response refuses status 101; the Workers runtime allows it with a socket.
const BaseResponse = globalThis.Response;
globalThis.Response = class extends BaseResponse {
  constructor(body, init = {}) {
    if (init?.status !== 101) { super(body, init); return; }
    super(null, { ...init, status: 200 });
    Object.defineProperty(this, "status", { value: 101 });
    this.socket = init.webSocket;
  }
};

const { default: worker } = await import("../worker/index.js");
const { Relay, ALARM_SLACK_MS } = await import("../worker/relay.js");
const { newToken, MAX_AGE_MS, FUTURE_SLACK_MS, LEGACY_UNTIL } = await import("../worker/mcp.js");

function fakeCtx() {
  const data = new Map();
  const sockets = [];
  const ctx = {
    alarm: null,
    erased: false,
    storage: {
      get: async (k) => structuredClone(data.get(k)),
      put: async (k, v) => { data.set(k, structuredClone(v)); },
      setAlarm: async (t) => { ctx.alarm = t; },
      getAlarm: async () => ctx.alarm,
      deleteAlarm: async () => { ctx.alarm = null; },
      deleteAll: async () => { data.clear(); ctx.erased = true; },
      data,
    },
    sockets,
    acceptWebSocket(ws, tags) { ws.tags = tags; sockets.push(ws); },
    getWebSockets(tag) { return sockets.filter((s) => !s.closed && (!tag || s.tags.includes(tag))); },
    setWebSocketAutoResponse() {},
  };
  return ctx;
}
function relayWith(now) {
  const ctx = fakeCtx();
  const relay = new Relay(ctx, {});
  relay.now = () => now.t;
  // A tab connects (born: the token's birth time, null for a legacy token); returns the relay's side of its socket
  // (a refused one is not kept by ctx).
  const tab = async (born) => {
    const headers = new Headers({ Upgrade: "websocket" });
    if (born != null) headers.set("X-Token-Born", String(born));
    const res = await relay.fetch(new Request("https://relay/tab", { headers }));
    assert.equal(res.status, 101);
    assert.equal(res.headers.get("Sec-WebSocket-Protocol"), "script-editor");
    return lastServer();
  };
  return { ctx, relay, tab };
}
const T0 = Date.UTC(2026, 9, 28, 20);

/* ---------- The relay object's note ---------- */
test("relay: a new token's note lasts until its birth + 8 h, with an alarm just after", async () => {
  const now = { t: T0 + 1000 };
  const { ctx, relay, tab } = relayWith(now);
  const ws = await tab(T0);
  assert.equal(ws.sent[0].type, "ready");
  assert.equal(ws.sent[0].createdAt, T0);
  assert.deepEqual(ctx.storage.data.get("meta"), { createdAt: T0, expiresAt: T0 + MAX_AGE_MS, revoked: false, agent: null });
  assert.equal(ctx.alarm, T0 + MAX_AGE_MS + ALARM_SLACK_MS);
  assert.deepEqual(await relay.op({ op: "auth", born: T0 }), { status: "ok" });
  now.t = T0 + MAX_AGE_MS;
  assert.deepEqual(await relay.op({ op: "auth", born: T0 }), { status: "unauthorized" }, "past expiresAt: refused before the alarm");
});

test("relay: the alarm refuses what waits, closes the tab and erases everything; an early alarm is set again", async () => {
  const now = { t: T0 };
  const { ctx, relay, tab } = relayWith(now);
  const ws = await tab(T0);
  const due = T0 + MAX_AGE_MS + ALARM_SLACK_MS;
  now.t = due - 10;
  await relay.alarm();
  assert.equal(ctx.alarm, due, "early: set again");
  assert.ok(ctx.storage.data.has("meta") && !ws.closed);
  now.t = T0 + 1000;
  const waiting = relay.op({ op: "call", tool: "get_script", args: {}, born: T0, timeout: 30_000 });
  await new Promise((r) => setImmediate(r));
  assert.equal(ws.sent.at(-1).type, "call");
  now.t = due;
  await relay.alarm();
  assert.deepEqual(await waiting, { status: "unauthorized" });
  assert.equal(ws.code, 4003);
  assert.equal(ws.reason, "expired");
  assert.equal(ctx.erased, true);
  assert.equal(ctx.storage.data.size, 0);
  assert.equal(ctx.alarm, null);
});

test("relay: a tab with a token already past its time is refused and nothing is written", async () => {
  const now = { t: T0 + MAX_AGE_MS };
  const { ctx, tab } = relayWith(now);
  const ws = await tab(T0);
  assert.deepEqual([ws.accepted, ws.tags, ws.code, ws.reason], [true, undefined, 4003, "expired"]);
  assert.equal(ctx.storage.data.size, 0);
  assert.equal(ctx.alarm, null);
});

test("relay: after Disconnect the token stays refused until its alarm, then the note is gone", async () => {
  const now = { t: T0 };
  const { ctx, relay, tab } = relayWith(now);
  const ws = await tab(T0);
  await relay.op({ op: "agent", name: "claude-code", version: "2", born: T0 });
  assert.deepEqual(ctx.storage.data.get("meta").agent, { name: "claude-code", version: "2" });
  await relay.webSocketMessage(ws, JSON.stringify({ type: "revoke" }));
  assert.equal(ws.code, 4003);
  assert.equal(ctx.storage.data.get("meta").revoked, true);
  assert.equal(ctx.storage.data.get("meta").agent, null);
  assert.equal(ctx.alarm, T0 + MAX_AGE_MS + ALARM_SLACK_MS);
  now.t = T0 + MAX_AGE_MS - 1;
  assert.deepEqual(await relay.op({ op: "auth", born: T0 }), { status: "unauthorized" });
  const again = await tab(T0);
  assert.deepEqual([again.code, again.reason], [4003, "revoked"]);
  assert.equal(ctx.storage.data.get("meta").revoked, true, "a new tab does not bring it back");
  now.t = T0 + MAX_AGE_MS + ALARM_SLACK_MS;
  await relay.alarm();
  assert.equal(ctx.storage.data.size, 0);
});

test("relay: a revoke with no note keeps one as long as any token could live, with an alarm", async () => {
  const now = { t: T0 };
  const { ctx, relay } = relayWith(now);
  const ws = new FakeSocket();
  ctx.acceptWebSocket(ws, ["tab"]);
  await relay.webSocketMessage(ws, JSON.stringify({ type: "revoke" }));
  const meta = ctx.storage.data.get("meta");
  assert.equal(meta.revoked, true);
  assert.equal(meta.expiresAt, Math.max(T0 + MAX_AGE_MS, LEGACY_UNTIL));
  assert.equal(ctx.alarm, meta.expiresAt + ALARM_SLACK_MS);
});

test("relay: a legacy token's new note ends at the switch-over; an old note gets its alarm when used", async () => {
  const now = { t: T0 };
  const legacy = relayWith(now);
  await legacy.tab(null);
  assert.deepEqual(legacy.ctx.storage.data.get("meta"), { createdAt: T0, expiresAt: LEGACY_UNTIL, revoked: false, agent: null });
  assert.equal(legacy.ctx.alarm, LEGACY_UNTIL + ALARM_SLACK_MS);

  // A note from before this change: no expiresAt, no alarm.
  const old = relayWith(now);
  old.ctx.storage.data.set("meta", { createdAt: T0 - 1000, revoked: false, agent: null });
  assert.deepEqual(await old.relay.op({ op: "auth", born: null }), { status: "ok" });
  assert.equal(old.ctx.alarm, LEGACY_UNTIL + ALARM_SLACK_MS);
  const revoked = relayWith(now);
  revoked.ctx.storage.data.set("meta", { createdAt: T0 - 9 * 3600_000, revoked: true, agent: null });
  assert.equal((await revoked.tab(null)).code, 4003);
  assert.equal(revoked.ctx.alarm, LEGACY_UNTIL + ALARM_SLACK_MS, "kept (and refusing) until legacy tokens stop");
  assert.equal(revoked.ctx.storage.data.get("meta").revoked, true);
  // Its alarm erases it only after the switch-over.
  now.t = LEGACY_UNTIL;
  await revoked.relay.alarm();
  assert.equal(revoked.ctx.alarm, LEGACY_UNTIL + ALARM_SLACK_MS);
  now.t = LEGACY_UNTIL + ALARM_SLACK_MS;
  await revoked.relay.alarm();
  assert.equal(revoked.ctx.storage.data.size, 0);
});

/* ---------- The Worker's routes ---------- */
const sha = (s) => createHash("sha256").update(s).digest("hex");
function relayEnv() {
  const calls = { idFromName: [], fetch: [], op: [] };
  const env = {
    RELAY: {
      idFromName: (name) => { calls.idFromName.push(name); return { name }; },
      get: (id) => ({
        fetch: async (url, init) => { calls.fetch.push({ id, url, init }); return new Response("to the relay"); },
        op: async (m) => { calls.op.push({ id, ...m }); return { status: "ok" }; },
      }),
    },
  };
  return { env, calls };
}
const relayRequest = (token, origin) => {
  const headers = new Headers({ Upgrade: "websocket", "Sec-WebSocket-Protocol": `script-editor, t.${token}` });
  if (origin) headers.set("Origin", origin);
  return new Request("https://script.techies.tools/api/relay", { headers });
};

test("worker /api/agent-token: a fresh token with the Worker's time, POST from this site only", async () => {
  const before = Date.now();
  const res = await worker.fetch(new Request("https://script.techies.tools/api/agent-token", { method: "POST", headers: { Origin: "https://script.techies.tools" } }), {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["createdAt", "token"]);
  assert.match(body.token, /^se2-[0-9a-z]{8,10}-[A-Za-z0-9_-]{43}$/);
  assert.equal(parseInt(body.token.split("-")[1], 36), body.createdAt);
  assert.ok(body.createdAt >= before && body.createdAt <= Date.now());
  const foreign = await worker.fetch(new Request("https://script.techies.tools/api/agent-token", { method: "POST", headers: { Origin: "https://evil.example" } }), {});
  assert.equal(foreign.status, 403);
  const get = await worker.fetch(new Request("https://script.techies.tools/api/agent-token"), {});
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST");
});

test("worker /api/relay: a token past its time or from the future is closed with 4003, no relay object touched", async () => {
  const now = Date.now();
  for (const token of [newToken(now - 9 * 3600_000).token, newToken(now + 3600_000).token]) {
    const { env, calls } = relayEnv();
    const res = await worker.fetch(relayRequest(token, "https://script.techies.tools"), env);
    assert.equal(res.status, 101);
    assert.equal(res.headers.get("Sec-WebSocket-Protocol"), "script-editor", "browsers need the subprotocol to hear the close");
    const server = lastServer();
    assert.deepEqual([server.accepted, server.code, server.reason], [true, 4003, "expired"]);
    assert.equal(res.socket, pairs.at(-1)[0], "the tab gets the other end");
    assert.deepEqual([calls.idFromName.length, calls.fetch.length], [0, 0]);
  }
  // Malformed: 401 as before.
  const { env, calls } = relayEnv();
  assert.equal((await worker.fetch(relayRequest("se2-short"), env)).status, 401);
  assert.equal(calls.idFromName.length, 0);
});

test("worker /api/relay: a good token reaches its relay with its birth time; a legacy one without", async () => {
  const { token, born } = newToken();
  const { env, calls } = relayEnv();
  const res = await worker.fetch(relayRequest(token), env);
  assert.equal(await res.text(), "to the relay");
  assert.deepEqual(calls.idFromName, [sha(token)]);
  assert.equal(calls.fetch[0].init.headers["X-Token-Born"], String(born));
  if (Date.now() < LEGACY_UNTIL) {
    const legacy = relayEnv();
    await worker.fetch(relayRequest("A".repeat(43)), legacy.env);
    assert.equal(legacy.calls.fetch[0].init.headers["X-Token-Born"], undefined);
  }
});

test("worker /mcp: an expired token gets 401 without touching a relay; a good one passes its birth time", async () => {
  const mcp = (token) => new Request("https://script.techies.tools/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const old = relayEnv();
  const res = await worker.fetch(mcp(newToken(Date.now() - MAX_AGE_MS - FUTURE_SLACK_MS).token), old.env);
  assert.equal(res.status, 401);
  assert.equal(old.calls.idFromName.length, 0);
  const { token, born } = newToken();
  const good = relayEnv();
  assert.equal((await worker.fetch(mcp(token), good.env)).status, 200);
  assert.deepEqual(good.calls.op.map((o) => [o.op, o.born]), [["auth", born]]);
});
