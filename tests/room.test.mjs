import { test } from "node:test";
import assert from "node:assert/strict";
import { Room, CLOSE, HOST_GRACE_MS, HOST_CHECK_MS, GUESTS_MAX } from "../worker/room.js";
import { RoomClient, newRoom, makeLink, parseLink, protocols, LOG_MAX, sha256hex, ENDED_KEEP_MS } from "../public/together/room.js";
import { createOutbox } from "../public/together-adapter.js";
import { createHash } from "node:crypto";
import { applyOps, cloneBlocks } from "../public/together/ops.js";

const tick = () => new Promise((r) => setImmediate(r));
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await tick(); };
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 5)); }
  return fn();
}

/* ---------- A fake Durable Object context and fake sockets ---------- */
function fakeCtx() {
  const data = new Map();
  const sockets = [];
  const ctx = {
    alarm: null,
    storage: {
      get: async (k) => structuredClone(data.get(k)),
      put: async (k, v) => { data.set(k, structuredClone(v)); },
      setAlarm: async (t) => { ctx.alarm = t; },
      getAlarm: async () => ctx.alarm,
      deleteAlarm: async () => { ctx.alarm = null; },
      deleteAll: async () => { data.clear(); ctx.erased = true; },
      data,
    },
    acceptWebSocket(ws, tags) { ws.tags = tags; sockets.push(ws); },
    getWebSockets(tag) { return sockets.filter((s) => !s.closed && (!tag || s.tags.includes(tag))); },
    setWebSocketAutoResponse() {},
  };
  return ctx;
}
// The room's side of a socket. `peer` gets what the room sends.
class ServerSocket {
  constructor(peer) { this.peer = peer; this.att = null; this.closed = false; this.sent = []; }
  send(text) { if (this.closed) throw new Error("closed"); this.sent.push(JSON.parse(text)); this.peer?.deliver(text); }
  close(code = 1000) { if (this.closed) return; this.closed = true; this.code = code; this.peer?.closedBy(code); }
  serializeAttachment(v) { this.att = structuredClone(v); }
  deserializeAttachment() { return structuredClone(this.att); }
}
const hash = (s) => `h:${s}`; // the Worker passes hashes; any stable function does here

// A WebSocket for RoomClient that talks to an in-memory Room, like the Worker does.
function socketFactory(rooms) {
  return class FakeWebSocket {
    constructor(url, protos) {
      this.readyState = 0;
      this.listeners = { message: [], close: [], open: [] };
      const get = (p) => protos.find((x) => x.startsWith(p))?.slice(2) ?? "";
      const id = get("r.");
      if (!rooms.has(id)) rooms.set(id, new Room(fakeCtx(), {}));
      this.room = rooms.get(id);
      this.server = new ServerSocket(this);
      this.readyState = 1;
      const host = get("h.");
      queueMicrotask(() => this.room.join(this.server, { keyHash: hash(get("k.")), hostHash: host ? hash(host) : "" }));
    }
    addEventListener(type, fn) { this.listeners[type].push(fn); }
    send(text) { if (this.readyState !== 1) throw new Error("closed"); setImmediate(() => { if (!this.server.closed) this.room.webSocketMessage(this.server, text); }); }
    close(code = 1000) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      // Like a real socket: what was sent before arrives before the close.
      setImmediate(() => { this.server.closed = true; this.room.webSocketClose(this.server, code); this.closedBy(code); });
    }
    deliver(text) { setImmediate(() => { if (this.readyState === 1) for (const f of this.listeners.message) f({ data: text }); }); }
    closedBy(code) { this.readyState = 3; setImmediate(() => { for (const f of this.listeners.close) f({ code }); }); }
  };
}
const plainAdapter = (blocks = []) => {
  const a = {
    blocks, info: { name: "plain.md" }, at: null, applies: 0, busyNow: false, heldNow: false,
    caret: () => a.at,
    busy: () => a.busyNow,
    held: () => a.heldNow,
    read: () => cloneBlocks(a.blocks),
    apply: (ops) => { a.applies++; applyOps(a.blocks, ops); },
    meta: () => a.info,
    load: (doc) => { a.blocks = doc.blocks; a.info = doc.meta; },
    text: () => a.blocks.map((b) => b.text).join("|"),
    type: (blockId, at, text) => { const b = a.blocks.find((x) => x.id === blockId); b.text = b.text.slice(0, at) + text + b.text.slice(at); a.at = { blockId, offset: at + text.length }; },
  };
  return a;
};
// Timers that never keep the test process alive.
const timers = {
  setTimeout: (f, t) => setTimeout(f, t).unref(), clearTimeout,
  setInterval: (f, t) => setInterval(f, t).unref(), clearInterval,
};
const para = (id, text) => ({ id, text, attrs: { type: "para" } });

/* ---------- The Durable Object's message rules ---------- */
function roomWith() {
  const ctx = fakeCtx();
  const room = new Room(ctx, {});
  const join = async (creds) => { const ws = new ServerSocket(null); await room.join(ws, creds); return ws; };
  return { ctx, room, join };
}
const msg = (o) => JSON.stringify(o);

test("room: the host creates the room; a wrong key or no room is refused", async () => {
  const { ctx, join } = roomWith();
  const early = await join({ keyHash: "k", hostHash: "" });
  assert.equal(early.code, CLOSE.ended, "no room yet");
  const host = await join({ keyHash: "k", hostHash: "h" });
  assert.equal(host.sent[0].type, "welcome");
  assert.deepEqual(Object.keys(ctx.storage.data.get("meta")).sort(), ["createdAt", "ended", "hostHash", "keyHash"], "only hashes and times are stored");
  assert.equal((await join({ keyHash: "x", hostHash: "" })).code, CLOSE.refused);
  assert.equal((await join({ keyHash: "k", hostHash: "other" })).code, CLOSE.refused, "a guest can't become the host");
  const guest = await join({ keyHash: "k", hostHash: "" });
  assert.equal(guest.sent[0].type, "welcome");
  assert.match(guest.sent[0].pid, /^g[a-z0-9]{10}$/);
});

test("room: guests say who they are first, can't pose as someone else, and reach only the host", async () => {
  const { room, join } = roomWith();
  const host = await join({ keyHash: "k", hostHash: "h" });
  const a = await join({ keyHash: "k", hostHash: "" });
  const b = await join({ keyHash: "k", hostHash: "" });
  await room.webSocketMessage(a, msg({ type: "op", base: 0, ops: [] }));
  assert.equal(host.sent.length, 1, "nothing before hello");
  await room.webSocketMessage(a, msg({ type: "hello", name: "  Ana\u0007  Maria " }));
  assert.deepEqual(host.sent.at(-1), { type: "join", from: a.att.pid, name: "Ana Maria", client: null, v: null });
  await room.webSocketMessage(b, msg({ type: "hello", name: "" }));
  assert.equal(host.sent.at(-1).name, "Guest");
  await room.webSocketMessage(a, msg({ type: "op", from: "host", base: 0, seq: 1, ops: [1] }));
  assert.equal(host.sent.at(-1).from, a.att.pid, "the room stamps the sender");
  await room.webSocketMessage(a, msg({ type: "ask", ask: { id: "x" } }));
  assert.equal(host.sent.at(-1).type, "ask");
  const before = b.sent.length;
  for (const type of ["all", "to", "end", "snapshot", "people"]) await room.webSocketMessage(a, msg({ type, to: b.att.pid, msg: { type: "op" } }));
  assert.equal(b.sent.length, before, "guests can't send to others or end the room");
  assert.ok(!a.closed && !b.closed);
  await room.webSocketMessage(a, msg({ type: "caret", c: { blockId: "b1", offset: 2 } }));
  assert.deepEqual(b.sent.at(-1), { type: "caret", from: a.att.pid, c: { blockId: "b1", offset: 2 } });
  assert.equal(host.sent.at(-1).type, "caret");
  assert.ok(!a.sent.some((m) => m.type === "caret"), "a caret does not come back to its sender");
  await room.webSocketMessage(a, "x".repeat(600 * 1024));
  await room.webSocketMessage(b, "not json");
});

test("room: the host sends to one guest or to all; the end closes everyone and refuses new joins", async () => {
  const { ctx, room, join } = roomWith();
  const host = await join({ keyHash: "k", hostHash: "h" });
  const a = await join({ keyHash: "k", hostHash: "" });
  const b = await join({ keyHash: "k", hostHash: "" });
  await room.webSocketMessage(host, msg({ type: "to", to: a.att.pid, msg: { type: "snapshot", v: 3 } }));
  assert.equal(a.sent.at(-1).type, "snapshot");
  assert.notEqual(b.sent.at(-1).type, "snapshot");
  await room.webSocketMessage(host, msg({ type: "all", msg: { type: "op", v: 4 } }));
  assert.equal(a.sent.at(-1).v, 4);
  assert.equal(b.sent.at(-1).v, 4);
  await room.webSocketMessage(host, msg({ type: "end" }));
  assert.deepEqual([host.code, a.code, b.code], [CLOSE.ended, CLOSE.ended, CLOSE.ended]);
  assert.equal(ctx.storage.data.get("meta").ended, true);
  assert.equal(ctx.storage.data.get("meta").keyHash, undefined, "the keys are forgotten");
  assert.equal((await join({ keyHash: "k", hostHash: "" })).code, CLOSE.ended);
  assert.equal((await join({ keyHash: "k", hostHash: "h" })).code, CLOSE.ended);
});

test("room: the 21st guest is told the room is full", async () => {
  const { join } = roomWith();
  await join({ keyHash: "k", hostHash: "h" });
  for (let i = 0; i < GUESTS_MAX; i++) assert.equal((await join({ keyHash: "k", hostHash: "" })).code, undefined);
  assert.equal((await join({ keyHash: "k", hostHash: "" })).code, CLOSE.full);
});

test("room: with the host away, a guest's change is answered, never dropped quietly", async () => {
  const { room, join } = roomWith();
  const host = await join({ keyHash: "k", hostHash: "h" });
  const a = await join({ keyHash: "k", hostHash: "" });
  await room.webSocketMessage(a, msg({ type: "hello", name: "Ana", client: "client-aaaa", v: 4 }));
  assert.deepEqual(host.sent.at(-1), { type: "join", from: a.att.pid, name: "Ana", client: "client-aaaa", v: 4 });
  host.closed = true;
  await room.webSocketClose(host, 1006);
  await room.webSocketMessage(a, msg({ type: "op", base: 4, seq: 1, ops: [] }));
  assert.deepEqual(a.sent.at(-1), { type: "host", online: false });
});

test("room: an oversized op is refused by its seq; other oversized messages get no reply", async () => {
  const { room, join } = roomWith();
  const host = await join({ keyHash: "k", hostHash: "h" });
  const a = await join({ keyHash: "k", hostHash: "" });
  await room.webSocketMessage(a, msg({ type: "hello", name: "Ana" }));
  const big = "x".repeat(600 * 1024);
  const hostSeen = host.sent.length, before = a.sent.length;
  await room.webSocketMessage(a, msg({ type: "op", base: 0, seq: 7, ops: [{ type: "text", blockId: "b1", at: 0, del: 0, ins: big }] }));
  assert.deepEqual(a.sent.slice(before), [{ type: "refused", seq: 7 }]);
  await room.webSocketMessage(a, msg({ type: "ask", ask: { id: "a1", quote: big } }));
  assert.equal(a.sent.length, before + 1, "an oversized ask gets no reply");
  assert.equal(host.sent.length, hostSeen, "nothing oversized reaches the host");
});

test("room: 30 s without the host ends the room; a host back in time keeps it", async () => {
  const { ctx, room, join } = roomWith();
  let host = await join({ keyHash: "k", hostHash: "h" });
  const a = await join({ keyHash: "k", hostHash: "" });
  host.closed = true;
  await room.webSocketClose(host, 1006);
  assert.deepEqual(a.sent.at(-1), { type: "host", online: false });
  assert.ok(ctx.alarm >= Date.now() + HOST_GRACE_MS - 1000);
  host = await join({ keyHash: "k", hostHash: "h" });
  assert.ok(ctx.alarm >= Date.now() + HOST_CHECK_MS - 1000, "back in time: the grace alarm becomes the daily check");
  assert.deepEqual(a.sent.at(-1), { type: "host", online: true });
  host.closed = true;
  await room.webSocketClose(host, 1001);
  await room.alarm();
  assert.equal(a.code, CLOSE.ended);
  assert.equal(ctx.storage.data.get("meta").ended, true);
});

test("room: an ended room is erased 7 days later; the old link then still says ended", async () => {
  const { ctx, room, join } = roomWith();
  let now = Date.UTC(2026, 9, 28, 20);
  room.now = () => now;
  const host = await join({ keyHash: "k", hostHash: "h" });
  assert.equal(ctx.alarm, now + HOST_CHECK_MS, "with the host in: a daily check");
  now += HOST_CHECK_MS;
  await room.alarm();
  assert.equal(ctx.alarm, now + HOST_CHECK_MS, "host still here: checked again tomorrow");
  assert.ok(!host.closed);
  await room.webSocketMessage(host, msg({ type: "end" }));
  const endedAt = now;
  assert.deepEqual(ctx.storage.data.get("meta"), { createdAt: Date.UTC(2026, 9, 28, 20), ended: true, endedAt });
  assert.equal(ctx.alarm, endedAt + ENDED_KEEP_MS);
  // An alarm that fires early is set again for the right time.
  now = endedAt + ENDED_KEEP_MS - 5000;
  await room.alarm();
  assert.equal(ctx.alarm, endedAt + ENDED_KEEP_MS);
  assert.ok(ctx.storage.data.has("meta"));
  now = endedAt + ENDED_KEEP_MS;
  await room.alarm();
  assert.equal(ctx.erased, true);
  assert.equal(ctx.storage.data.size, 0, "nothing is left");
  assert.equal((await join({ keyHash: "k", hostHash: "" })).code, CLOSE.ended, "a guest with the old link hears it ended");
  await room.alarm(); // an alarm on an empty room does nothing
  assert.equal(ctx.storage.data.size, 0);
});

test("room: a host gone without a close event is found at the daily check, and the room ends", async () => {
  const { ctx, room, join } = roomWith();
  const host = await join({ keyHash: "k", hostHash: "h" });
  const a = await join({ keyHash: "k", hostHash: "" });
  host.closed = true; // lost, no webSocketClose
  await room.alarm();
  assert.equal(a.code, CLOSE.ended);
  assert.equal(ctx.storage.data.get("meta").ended, true);
  assert.ok(ctx.alarm >= Date.now() + ENDED_KEEP_MS - 1000);
});

test("room: an ended note from before endedAt gets its erase when someone knocks", async () => {
  const { ctx, room, join } = roomWith();
  ctx.storage.data.set("meta", { createdAt: 1, ended: true });
  assert.equal((await join({ keyHash: "k", hostHash: "" })).code, CLOSE.ended);
  assert.ok(ctx.alarm >= Date.now() + ENDED_KEEP_MS - 1000);
  const set = ctx.alarm;
  assert.equal((await join({ keyHash: "k", hostHash: "h" })).code, CLOSE.ended);
  assert.equal(ctx.alarm, set, "an alarm already set is kept");
  await room.alarm(); // no endedAt: its time is long past
  assert.equal(ctx.storage.data.size, 0);
});

/* ---------- Host and guests through the room ---------- */
async function session(blocks) {
  const rooms = new Map();
  const WS = socketFactory(rooms);
  const creds = newRoom();
  const ha = plainAdapter(blocks);
  const host = new RoomClient({ role: "host", ...creds, url: "ws://x/api/room", name: "Lex", adapter: ha, WebSocketImpl: WS, timers, backoffMs: 5 }).start();
  await settle();
  const guest = async (name, on = {}, { client, secret } = {}) => {
    const a = plainAdapter();
    const c = new RoomClient({ role: "guest", room: creds.room, key: creds.key, url: "ws://x/api/room", name, adapter: a, WebSocketImpl: WS, timers, backoffMs: 5, on });
    if (client !== undefined) c.client = client;
    if (secret !== undefined) c.secret = secret;
    c.start();
    await settle();
    return { a, c };
  };
  return { rooms, creds, host, ha, guest };
}

test("together: a change made for the agent goes out under its name; the host's held \"/\" text stays back", async () => {
  const { host, ha, guest } = await session([para("p1", "We start here. Then we go on."), para("p2", "Second line.")]);
  const g = await guest("Ana");
  const ops = [];
  const seen = g.c.applyRemote.bind(g.c);
  g.c.applyRemote = (o, by, next) => { ops.push(by); return seen(o, by, next); };
  // The agent's answer goes straight in on the host's tab.
  ha.blocks[0].text = "We begin. Then we go on.";
  host.localAs("agent");
  await settle(60);
  assert.equal(g.a.text(), ha.text());
  assert.deepEqual(ops, ["agent"], "attributed to the agent, not the host");
  assert.equal(host.log.at(-1).by, "agent");
  assert.equal(host.undoMine(), false, "the host's Ctrl/Cmd+Z doesn't take the agent's change");
  assert.ok(!g.c.canUndo("host"), "the host's name tag offers no Undo for it");
  // The host types a "/" command (held back), and the agent's change lands after it in the same line.
  ha.heldNow = true;
  ha.type("p1", 0, "/po");
  host.local();
  ha.blocks[0].text = ha.blocks[0].text.replace("Then we go on.", "Next.");
  host.localAs("agent");
  await settle(60);
  assert.equal(g.a.text(), "We begin. Next.|Second line.", "the guest gets the agent's change without the command");
  assert.equal(ha.text(), "/poWe begin. Next.|Second line.");
  ha.heldNow = false;
  ha.blocks[0].text = ha.blocks[0].text.slice(3);
  host.local();
  await settle(60);
  assert.equal(g.a.text(), ha.text());
});

test("together: guests get the script, type at the same time in one paragraph, and all end on the same text", async () => {
  const { host, ha, guest } = await session([para("p1", "We start here."), para("p2", "Second line.")]);
  const g1 = await guest("Ana"), g2 = await guest("Ben");
  assert.equal(g1.a.text(), ha.text());
  assert.equal(g1.a.info.name, "plain.md");
  assert.deepEqual(host.peopleList().map((p) => p.name), ["Lex", "Ana", "Ben"]);
  assert.deepEqual(g2.c.peopleList().map((p) => p.colour), [0, 1, 2]);
  // Everyone types in p1 before hearing from the others.
  ha.type("p1", 2, " all"); host.local();
  g1.a.type("p1", 0, "So, "); g1.c.local();
  g2.a.type("p1", 14, " Now."); g2.c.local();
  g1.a.type("p1", 4, "yes "); g1.c.local();
  await settle(80);
  assert.equal(ha.text(), "So, yes We all start here. Now.|Second line.");
  assert.equal(g1.a.text(), ha.text());
  assert.equal(g2.a.text(), ha.text());
  assert.equal(host.v, 4);
});

test("together: Enter and typing at the same time, carets follow, and the undo on a name tag", async () => {
  const { host, ha, guest } = await session([para("p1", "First half. Second half.")]);
  const g = await guest("Ana");
  g.a.type("p1", 18, " part"); g.c.local();
  ha.blocks.splice(1, 0, { id: "n1", text: ha.blocks[0].text.slice(12), attrs: { type: "para" } });
  ha.blocks[0].text = ha.blocks[0].text.slice(0, 12);
  host.local();
  await settle(80);
  assert.equal(ha.text(), "First half. |Second part half.");
  assert.equal(g.a.text(), ha.text());
  // Ana's caret sits at the end of what she typed, on the new line.
  assert.deepEqual(host.carets.get(g.c.pid), { blockId: "n1", offset: 11 });
  g.c.caret({ blockId: "n1", offset: 3, selEnd: 0 });
  await settle();
  assert.deepEqual(host.carets.get(g.c.pid), { blockId: "n1", offset: 3, selEnd: 0 });
  assert.ok(host.canUndo(g.c.pid), "Ana's last change can be undone from her name tag");
  assert.ok(host.undoFor(g.c.pid));
  await settle(80);
  assert.equal(ha.text(), "First half. |Second half.");
  assert.equal(g.a.text(), ha.text());
  assert.ok(!host.canUndo(g.c.pid));
  // Ctrl+Z in a room undoes my own change only.
  g.a.type("p1", 0, "My "); g.c.local();
  await settle(60);
  assert.ok(g.c.undoMine());
  await settle(60);
  assert.equal(ha.text(), "First half. |Second half.");
});

test("together: a guest whose base is too old gets a fresh snapshot, and its change is rebased onto it", async () => {
  const { host, ha, guest } = await session([para("p1", "abc")]);
  const g = await guest("Ana");
  let snapshots = 0;
  const load = g.a.load;
  g.a.load = (doc) => { snapshots++; load(doc); };
  host.log = []; host.v = 10; // the host's log no longer reaches the guest's version
  g.a.type("p1", 3, "d"); g.c.local();
  await settle(60);
  assert.equal(snapshots, 1);
  assert.equal(g.a.text(), ha.text());
  assert.equal(ha.text(), "abcd", "the change survives the snapshot");
  assert.equal(g.c.v, 11, "sent again on top of version 10");
  // A structure clash on one block also ends in a snapshot, never in two different texts.
  g.a.blocks.splice(0, 1); g.c.local();
  ha.blocks.splice(1, 0, para("n", "x")); host.local();
  await settle(80);
  assert.equal(g.a.text(), ha.text());
});

test("together: stop sharing ends the room for guests, and the link no longer works", async () => {
  const { rooms, creds, host, guest } = await session([para("p1", "abc")]);
  const g = await guest("Ana");
  const asks = [];
  host.on.message = (m) => asks.push(m);
  g.c.send({ type: "ask", ask: { id: "a1" } });
  await settle();
  assert.equal(asks[0]?.from, g.c.pid, "a guest's ask reaches the host");
  host.stop();
  await settle();
  assert.equal(g.c.status, "ended");
  const late = await guest("Late");
  assert.equal(late.c.status, "ended");
  assert.equal(rooms.size, 1);
  void creds;
});

const allSame = (ha, ...gs) => gs.every((g) => g.a.text() === ha.text() && !g.c.pending);

test("together: a guest whose connection drops keeps what it typed, and it arrives once", async () => {
  const { host, ha, guest } = await session([para("p1", "Hello."), para("p2", "World.")]);
  const g = await guest("Ana"), other = await guest("Ben");
  // The batch reaches the host, but the receipt is lost with the connection.
  g.a.type("p1", 6, " One"); g.c.local();
  g.c.ws.close();
  g.a.type("p1", 10, " Two"); g.c.local(); // typed while away: kept unsent
  ha.type("p2", 0, "Big "); host.local();
  // And a batch that never reached anyone.
  await waitFor(() => g.c.status === "away");
  g.a.type("p2", 10, " Three"); g.c.local();
  assert.ok(await waitFor(() => g.c.status === "live" && allSame(ha, g, other)), `${ha.text()} / ${g.a.text()}`);
  assert.equal(ha.text(), "Hello. One Two|Big World. Three");
  host.stop();
});

test("together: typing while the host is away arrives when the host is back", async () => {
  const { host, ha, guest } = await session([para("p1", "Hello.")]);
  const g = await guest("Ana");
  g.a.type("p1", 6, " Early"); g.c.local(); // in flight when the host's connection drops
  host.ws.close();
  await waitFor(() => g.c.status === "away");
  g.a.type("p1", 0, "Away: "); g.c.local();
  ha.type("p1", 6, "!"); host.local(); // the host typed while offline too
  assert.ok(await waitFor(() => host.status === "live" && g.c.status === "live" && allSame(ha, g)), `${ha.text()} / ${g.a.text()}`);
  assert.equal(ha.text(), "Away: Hello.! Early");
  host.stop();
});

test("together: a client told the room is full stops and does not reconnect", async () => {
  let made = 0;
  class Full {
    constructor() { made++; this.readyState = 1; this.l = {}; setImmediate(() => this.l.close?.({ code: 4005 })); }
    addEventListener(t, f) { this.l[t] = f; }
    send() {}
    close() {}
  }
  const c = new RoomClient({ role: "guest", ...newRoom(), url: "ws://x", name: "Late", adapter: plainAdapter(), WebSocketImpl: Full, timers, backoffMs: 1 }).start();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(c.status, "full");
  assert.equal(made, 1);
});

test("together: Ctrl+Z in a room undoes an Enter and a Backspace for everyone", async () => {
  const { host, ha, guest } = await session([para("p1", "First half. Second half."), para("p2", "Last line.")]);
  const g = await guest("Ana");
  const start = ha.text();
  // Enter in the middle of p1 (diff makes it a split).
  g.a.blocks.splice(1, 0, para("n1", g.a.blocks[0].text.slice(12)));
  g.a.blocks[0].text = g.a.blocks[0].text.slice(0, 12);
  g.c.local();
  await settle(60);
  assert.equal(ha.text(), "First half. |Second half.|Last line.");
  assert.ok(g.c.undoMine());
  await settle(60);
  assert.equal(ha.text(), start);
  assert.equal(g.a.text(), start);
  // Backspace at the start of p2 (a merge).
  g.a.blocks[0].text += g.a.blocks[1].text;
  g.a.blocks.splice(1, 1);
  g.c.local();
  await settle(60);
  assert.equal(ha.text(), "First half. Second half.Last line.");
  assert.ok(g.c.undoMine());
  await settle(60);
  assert.equal(ha.text(), start);
  assert.equal(g.a.text(), start);
  host.stop();
});

test("together: a resync lost with the host's connection ends in a snapshot, and typing goes on", async () => {
  const { host, ha, guest } = await session([para("p1", "Hello.")]);
  const g = await guest("Ana");
  host.backoffMs = 150; // away long enough for the resync to be lost
  host.ws.close();
  await waitFor(() => g.c.status === "away");
  // A version gap makes the guest ask for a resync while the host is away: the room answers "host away".
  g.c.status = "live";
  g.c.receive(JSON.stringify({ type: "op", v: g.c.v + 2, ops: [{ type: "text", blockId: "p1", at: 0, del: 0, ins: "?" }], by: "host" }));
  assert.ok(g.c.resyncing);
  await settle(10);
  assert.equal(host.status, "away", "the resync went nowhere");
  ha.type("p1", 6, " World."); host.local();
  assert.ok(await waitFor(() => host.status === "live" && g.c.status === "live" && allSame(ha, g)), `${ha.text()} / ${g.a.text()} / ${g.c.status}`);
  assert.ok(!g.c.resyncing);
  g.a.type("p1", 0, "Yes. "); g.c.local();
  assert.ok(await waitFor(() => ha.text() === "Yes. Hello. World." && allSame(ha, g)), ha.text());
  host.stop();
});

test("together: a batch the host refuses is sent once, then dropped, with no loop", async () => {
  const { host, ha, guest } = await session([para("p1", "Hello.")]);
  ha.validBlocks = (blocks) => !blocks.some((b) => b.text.includes("BAD"));
  const g = await guest("Ana");
  let snapshots = 0, sent = 0;
  const load = g.a.load;
  g.a.load = (doc) => { snapshots++; load(doc); };
  const send = g.c.send.bind(g.c);
  g.c.send = (m) => { if (m.type === "op") sent++; return send(m); };
  try {
    g.a.type("p1", 6, " BAD"); g.c.local();
    await settle(200);
    assert.equal(sent, 1, "sent once");
    assert.equal(snapshots, 1, "one snapshot, no loop");
    assert.equal(g.a.text(), "Hello.");
    assert.ok(allSame(ha, g));
    g.a.type("p1", 6, " Fine."); g.c.local();
    await settle(60);
    assert.equal(ha.text(), "Hello. Fine.");
  } finally {
    g.c.stop();
    host.stop();
  }
});

test("together: back after the log moved on, a batch the host already applied arrives once", async () => {
  const { host, ha, guest } = await session([para("p1", "Hello."), para("p2", "")]);
  const g = await guest("Ana");
  g.c.backoffMs = 40;
  g.a.type("p1", 6, " Once."); g.c.local();
  g.c.ws.close(); // the host applies the batch, the receipt is lost
  await settle(8);
  assert.equal(ha.text(), "Hello. Once.|");
  for (let i = 0; i < LOG_MAX + 5; i++) { ha.type("p2", ha.blocks[1].text.length, "x"); host.local(); }
  assert.ok(host.log[0].v > g.c.v + 1, "the guest's version is out of the host's log");
  assert.ok(await waitFor(() => g.c.status === "live" && allSame(ha, g)), `${g.c.status}`);
  assert.equal(ha.text().split("Once.").length, 2, "the batch is in once");
  host.stop();
});

test("together: a catch-up waits while an input method composes", async () => {
  const { host, ha, guest } = await session([para("p1", "Hello.")]);
  const g = await guest("Ana");
  g.c.ws.close();
  await waitFor(() => g.c.status === "away");
  ha.type("p1", 6, " World."); host.local();
  g.a.busyNow = true;
  const before = g.a.applies;
  await waitFor(() => g.c.queue.some((m) => m.type === "catchup"));
  assert.equal(g.a.applies, before, "nothing applied while composing");
  g.a.busyNow = false;
  g.c.resume();
  assert.ok(await waitFor(() => g.c.status === "live" && allSame(ha, g)));
  assert.equal(g.a.text(), "Hello. World.");
  host.stop();
});

test("together: a catch-up entry that fails while a resync is open asks once, and the text arrives once", async () => {
  const { host, ha, guest } = await session([para("p1", "Hello."), para("p2", "")]);
  const g = await guest("Ana");
  g.c.backoffMs = 40;
  // The host's catch-up carries a broken entry, so applying it fails and the guest asks for a resync.
  const hostSend = host.send.bind(host);
  host.send = (m) => {
    if (m.type === "to" && m.msg.type === "catchup") m = { ...m, msg: { ...m.msg, entries: m.msg.entries.map((e) => (e.by === "host" ? { ...e, ops: [{ type: "text", blockId: "gone", at: 0, del: 0, ins: "?" }] } : e)) } };
    return hostSend(m);
  };
  let resyncs = 0;
  const guestSend = g.c.send.bind(g.c);
  g.c.send = (m) => { if (m.type === "resync") resyncs++; return guestSend(m); };
  g.a.type("p1", 6, " Once."); g.c.local();
  g.c.ws.close(); // the host applies the batch, the receipt is lost
  await settle(8);
  ha.type("p2", 0, "Host."); host.local();
  g.a.type("p1", 0, "Later. "); g.c.local(); // typed while away
  assert.ok(await waitFor(() => g.c.status === "live" && !g.c.resyncing && allSame(ha, g)), `${g.c.status} ${ha.text()} / ${g.a.text()}`);
  assert.equal(resyncs, 1, "exactly one resync");
  assert.equal(ha.text(), "Later. Hello. Once.|Host.");
  assert.equal(ha.text().split("Once.").length, 2, "the batch arrives once");
  host.stop();
});

// A guest whose batches are held back by the network: the batch stays in flight until the test answers.
async function heldGuest() {
  const { host, ha, guest } = await session([para("p1", "Hello.")]);
  const g = await guest("Ana");
  const send = g.c.send.bind(g.c);
  g.c.send = (m) => (m.type === "op" ? true : send(m));
  g.a.type("p1", 6, " Big"); g.c.local();
  const seq = g.c.pending.seq;
  g.a.type("p1", 0, "Kept "); g.c.local(); // typed after the batch: stays unsent
  return { host, ha, g, seq };
}

test("together: a refused with another seq leaves the batch in flight; a matching one drops only that batch", async () => {
  const { host, g, seq } = await heldGuest();
  g.c.receive(JSON.stringify({ type: "refused", seq: seq + 1 }));
  assert.equal(g.c.pending?.seq, seq);
  assert.equal(g.a.text(), "Kept Hello. Big");
  g.c.receive(JSON.stringify({ type: "refused", seq }));
  assert.notEqual(g.c.pending?.seq, seq, "the refused batch is no longer in flight");
  assert.ok(!g.c.pending?.ops.some((o) => o.ins === " Big"));
  assert.equal(g.a.text(), "Kept Hello.", "the refused batch is gone, what came after it stays");
  host.stop();
});

test("together: a refused that arrives while an input method composes waits in the queue", async () => {
  const { host, g, seq } = await heldGuest();
  g.a.busyNow = true;
  g.c.receive(JSON.stringify({ type: "refused", seq }));
  assert.equal(g.c.pending?.seq, seq, "not dropped while composing");
  assert.deepEqual(g.c.queue.map((m) => m.type), ["refused"]);
  g.a.busyNow = false;
  g.c.resume();
  assert.equal(g.a.text(), "Kept Hello.");
  assert.ok(!g.c.pending?.ops.some((o) => o.ins === " Big"));
  host.stop();
});

test("together: app messages: the host tells a joining guest, sends to all or one; a guest's ask reaches the host", async () => {
  const { host, guest } = await session([para("p1", "Hello.")]);
  const fromGuests = [];
  host.on.message = (m) => fromGuests.push(m);
  host.on.joined = (pid) => host.sendTo(pid, { type: "asks", asks: ["for you"] });
  const aGot = [], bGot = [];
  const a = await guest("Ana", { message: (m) => aGot.push(m) });
  aGot.length = 0;
  const b = await guest("Ben", { message: (m) => bGot.push(m) });
  await settle(20);
  assert.ok(bGot.some((m) => m.type === "asks" && m.asks[0] === "for you"), "the joining guest is told");
  assert.ok(!aGot.some((m) => m.type === "asks"), "and nobody else");
  host.sendAll({ type: "broll", broll: { status: "none" } });
  await settle(20);
  assert.ok(aGot.some((m) => m.type === "broll") && bGot.some((m) => m.type === "broll"));
  a.c.send({ type: "ask", ask: { action: "simpler" } });
  await settle(20);
  assert.equal(fromGuests.at(-1).from, a.c.pid);
  assert.equal(a.c.sendAll({ type: "x" }), false, "only the host sends to all");
  host.stop();
});

test("together: asks and B-roll from the host wait while an input method composes", async () => {
  const { host, guest } = await session([para("p1", "Hello.")]);
  const g = await guest("Ana");
  const got = [];
  g.c.on.message = (m) => got.push(m.type);
  g.a.busyNow = true;
  host.sendAll({ type: "asks", asks: [] });
  host.sendAll({ type: "broll", broll: { status: "none" } });
  await settle(20);
  assert.deepEqual(got, []);
  assert.deepEqual(g.c.queue.map((m) => m.type), ["asks", "broll"]);
  g.a.busyNow = false;
  g.c.resume();
  assert.deepEqual(got, ["asks", "broll"]);
  host.stop();
});

test("together: sha256hex matches SHA-256", () => {
  for (const t of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(130), "é漢字🙂".repeat(9)]) assert.equal(sha256hex(t), createHash("sha256").update(t).digest("hex"));
});

test("together: a copied client id is refused; the same tab back with its secret keeps its asker id", async () => {
  const { host, guest } = await session([para("p1", "Hello.")]);
  const ana = await guest("Ana");
  await settle(20);
  const asker = ana.c.asker;
  assert.match(asker, /^a[\w-]{12}$/, "the host gave Ana an opaque id");
  assert.ok(![...host.people.values()].some((p) => JSON.stringify(p).includes(ana.c.secret)), "the host keeps no secret");
  assert.equal(host.people.get(ana.c.pid).key, sha256hex(ana.c.secret), "only its hash");
  // Eve copies Ana's client id (visible in every op) but not her secret.
  const eve = await guest("Eve");
  eve.c.client = ana.c.client;
  eve.c.hello();
  await settle(20);
  assert.equal(eve.c.status, "refused");
  assert.ok(![...host.people.values()].some((p) => p.name === "Eve" && p.asker === asker));
  assert.equal(host.people.get(ana.c.pid).asker, asker, "Ana keeps her rights");
  // Ana's own tab says hello again under a new connection: same secret, same asker id, old entry replaced.
  ana.c.ws.close();
  assert.ok(await waitFor(() => ana.c.status === "live" && host.people.has(ana.c.pid)));
  assert.equal(ana.c.asker, asker);
  assert.equal([...host.people.values()].filter((p) => p.client === ana.c.client).length, 1);
  host.stop();
});

test("together: an ask about typing not yet sent waits until the host has the text, then the host finds it", async () => {
  const { host, ha, guest } = await session([para("p1", "Hello.")]);
  const g = await guest("Ana");
  await settle(20);
  const heard = [];
  host.on.message = (m) => {
    if (m.type !== "ask") return;
    heard.push({ quote: m.ask.quote, hostText: ha.text() });
    host.sendTo(m.from, { type: ha.text().includes(m.ask.quote) ? "ask-ack" : "ask-refused", ref: m.ref });
  };
  const box = createOutbox({ send: (m) => g.c.send(m), ready: (wait) => g.c.status === "live" && (!wait || g.c.settled()) });
  g.c.on.settled = () => box.flush();
  const answers = [];
  g.c.on.message = (m) => { answers.push(m.type); box.done(m.ref); };
  g.a.type("p1", 6, " New words"); g.c.local(); // in flight
  g.a.type("p1", 16, " and more"); g.c.local(); // unsent behind it
  assert.ok(g.c.pending && !g.c.settled());
  box.push({ type: "ask", ask: { blockId: "p1", start: 7, quote: "words and more", action: "simpler" } }, { wait: true });
  assert.equal(heard.length, 0, "not sent yet");
  assert.ok(await waitFor(() => answers.length === 1));
  assert.deepEqual(heard, [{ quote: "words and more", hostText: "Hello. New words and more" }]);
  assert.deepEqual(answers, ["ask-ack"]);
  assert.equal(box.items.length, 0, "out of the box once confirmed");
  host.stop();
});

test("together: an ask waiting for text goes when the text settles without a send (a held / removed, a refused batch)", async () => {
  const { host, guest } = await session([para("p1", "Hello.")]);
  const g = await guest("Ana");
  await settle(20);
  const asksSent = [];
  let opsSent = 0;
  const send = g.c.send.bind(g.c);
  g.c.send = (m) => { if (m.type === "op") opsSent++; if (m.type === "ask") asksSent.push(m.ref); return send(m); };
  const box = createOutbox({ send: (m) => g.c.send(m), ready: (wait) => g.c.status === "live" && (!wait || g.c.settled()) });
  g.c.on.settled = () => box.flush();
  // A "/" command being typed is held back: the ask waits.
  g.a.heldNow = true;
  g.a.type("p1", 6, " /re"); g.c.local();
  box.push({ type: "ask", ask: { quote: "Hello" } }, { wait: true });
  assert.deepEqual(asksSent, []);
  // Escape and delete: nothing to send, the text is settled, the ask goes at once.
  g.a.blocks[0].text = "Hello."; g.a.heldNow = false; g.c.local();
  assert.equal(asksSent.length, 1, "sent on settling");
  assert.equal(opsSent, 0, "without any batch or receipt");
  // A batch the room refuses: dropped, then the waiting ask goes.
  g.c.send = (m) => { if (m.type === "ask") asksSent.push(m.ref); return m.type === "op" ? true : send(m); };
  g.a.type("p1", 0, "Big "); g.c.local();
  const seq = g.c.pending.seq;
  box.push({ type: "ask", ask: { quote: "Hello" } }, { wait: true });
  assert.equal(asksSent.length, 1);
  g.c.receive(JSON.stringify({ type: "refused", seq }));
  assert.equal(asksSent.length, 2, "sent after the refused batch was dropped");
  host.stop();
});

test("together: a copied client id stays refused while its tab is away, and the tab comes back with its rights", async () => {
  const { host, guest } = await session([para("p1", "Hello.")]);
  const ana = await guest("Ana");
  await settle(20);
  const asker = ana.c.asker;
  ana.c.backoffMs = 200;
  ana.c.ws.close(); // Ana is away; the room tells the host she left
  assert.ok(await waitFor(() => !host.people.has(ana.c.pid)));
  const eve = await guest("Eve");
  eve.c.client = ana.c.client; // copied from an op broadcast
  eve.c.hello();
  await settle(20);
  assert.equal(eve.c.status, "refused", "refused although Ana is not here");
  assert.ok(await waitFor(() => ana.c.status === "live" && host.people.get(ana.c.pid)?.asker === asker), "Ana is back with her asker id");
  assert.equal(ana.c.asker, asker);
  host.stop();
});

test("together: an unconfirmed ask goes again after the host was away; a refused one is handed back", () => {
  const sent = [];
  let live = true;
  const box = createOutbox({ send: (m) => (sent.push(m), true), ready: () => live, ref: (() => { let n = 0; return () => `r${++n}`; })() });
  box.push({ type: "ask", ask: { quote: "a" } }, { wait: true });
  box.push({ type: "ask", id: "x", act: "keep" });
  assert.deepEqual(sent.map((m) => m.ref), ["r1", "r2"]);
  live = false;
  box.away();
  box.push({ type: "ask", ask: { quote: "b" } });
  assert.equal(sent.length, 2, "nothing goes while away");
  live = true;
  box.done("r2");
  box.flush();
  assert.deepEqual(sent.map((m) => m.ref), ["r1", "r2", "r1", "r3"], "the unconfirmed ask is sent again, in order");
  assert.equal(box.done("r3").msg.ask.quote, "b");
  assert.deepEqual(box.items.map((i) => i.ref), ["r1"]);
});

test("together: links keep the key after #, and keys travel as subprotocols", () => {
  const r = newRoom();
  const link = makeLink("https://script.techies.tools/", r);
  assert.match(link, /^https:\/\/script\.techies\.tools\/#room=[\w-]{22}&k=[\w-]{43}$/);
  assert.deepEqual(parseLink(new URL(link).hash), { room: r.room, key: r.key });
  assert.equal(parseLink("#room=abc&k=def"), null);
  assert.ok(!link.includes(r.hostKey));
  assert.deepEqual(protocols(r), ["script-editor-room", `r.${r.room}`, `k.${r.key}`, `h.${r.hostKey}`]);
});

test("together: a tab without a secret never takes over a live entry, and its client id stays tied", async () => {
  const { host, guest } = await session([para("p1", "Hello.")]);
  const first = await guest("Ana", {}, { secret: null });
  await settle(20);
  assert.equal(first.c.status, "live");
  const client = first.c.client;
  // A second tab with the same client id and no secret: refused while the first is here.
  const copy = await guest("Eve", {}, { client, secret: null });
  await settle(20);
  assert.equal(copy.c.status, "refused");
  assert.ok(host.people.has(first.c.pid), "the first tab keeps its entry");
  // A tab with a secret can't claim a client id that was tied without one.
  const withSecret = await guest("Mo", {}, { client });
  await settle(20);
  assert.equal(withSecret.c.status, "refused");
  assert.ok(host.people.has(first.c.pid));
  host.stop();
});

test("together: a host tab that heard nothing from its room for 7 days does not make it anew", async () => {
  const rooms = new Map();
  const Base = socketFactory(rooms);
  let opened = 0;
  const WS = class extends Base { constructor(...a) { super(...a); opened++; } };
  let now = Date.UTC(2026, 9, 28, 20);
  const statuses = [];
  const host = new RoomClient({ role: "host", ...newRoom(), url: "ws://x/api/room", name: "Lex", adapter: plainAdapter([para("p1", "a")]), WebSocketImpl: WS, timers, backoffMs: 5, now: () => now, on: { status: (s) => statuses.push(s) } }).start();
  await settle();
  assert.equal(host.status, "live");
  assert.equal(host.lastHeard, now, "the welcome counts as hearing from the room");
  // Away a little: it comes back.
  now += 60_000;
  host.ws.close(1006);
  await waitFor(() => host.status === "live" && opened === 2);
  assert.equal(opened, 2);
  // Asleep for 7 days (the room was erased meanwhile): no new socket, the sharing has ended.
  now += ENDED_KEEP_MS;
  host.ws.close(1006);
  await waitFor(() => host.status === "ended");
  assert.equal(host.status, "ended");
  assert.equal(opened, 2, "no socket is opened");
  assert.ok(statuses.includes("away"));
});
