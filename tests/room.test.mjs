import { test } from "node:test";
import assert from "node:assert/strict";
import { Room, CLOSE, HOST_GRACE_MS } from "../worker/room.js";
import { RoomClient, newRoom, makeLink, parseLink, protocols } from "../public/together/room.js";
import { applyOps, cloneBlocks } from "../public/together/ops.js";

const tick = () => new Promise((r) => setImmediate(r));
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await tick(); };

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
      deleteAlarm: async () => { ctx.alarm = null; },
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
    blocks, info: { name: "plain.md" }, at: null,
    caret: () => a.at,
    read: () => cloneBlocks(a.blocks),
    apply: (ops) => { applyOps(a.blocks, ops); },
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
  assert.deepEqual(host.sent.at(-1), { type: "join", from: a.att.pid, name: "Ana Maria" });
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

test("room: 30 s without the host ends the room; a host back in time keeps it", async () => {
  const { ctx, room, join } = roomWith();
  let host = await join({ keyHash: "k", hostHash: "h" });
  const a = await join({ keyHash: "k", hostHash: "" });
  host.closed = true;
  await room.webSocketClose(host, 1006);
  assert.deepEqual(a.sent.at(-1), { type: "host", online: false });
  assert.ok(ctx.alarm >= Date.now() + HOST_GRACE_MS - 1000);
  host = await join({ keyHash: "k", hostHash: "h" });
  assert.equal(ctx.alarm, null);
  assert.deepEqual(a.sent.at(-1), { type: "host", online: true });
  host.closed = true;
  await room.webSocketClose(host, 1001);
  await room.alarm();
  assert.equal(a.code, CLOSE.ended);
  assert.equal(ctx.storage.data.get("meta").ended, true);
});

/* ---------- Host and guests through the room ---------- */
async function session(blocks) {
  const rooms = new Map();
  const WS = socketFactory(rooms);
  const creds = newRoom();
  const ha = plainAdapter(blocks);
  const host = new RoomClient({ role: "host", ...creds, url: "ws://x/api/room", name: "Lex", adapter: ha, WebSocketImpl: WS, timers }).start();
  await settle();
  const guest = async (name) => {
    const a = plainAdapter();
    const c = new RoomClient({ role: "guest", room: creds.room, key: creds.key, url: "ws://x/api/room", name, adapter: a, WebSocketImpl: WS, timers }).start();
    await settle();
    return { a, c };
  };
  return { rooms, creds, host, ha, guest };
}

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

test("together: a guest whose base is too old gets a fresh snapshot", async () => {
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
  assert.equal(g.c.v, 10);
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

test("together: links keep the key after #, and keys travel as subprotocols", () => {
  const r = newRoom();
  const link = makeLink("https://script.techies.tools/", r);
  assert.match(link, /^https:\/\/script\.techies\.tools\/#room=[\w-]{22}&k=[\w-]{43}$/);
  assert.deepEqual(parseLink(new URL(link).hash), { room: r.room, key: r.key });
  assert.equal(parseLink("#room=abc&k=def"), null);
  assert.ok(!link.includes(r.hostKey));
  assert.deepEqual(protocols(r), ["script-editor-room", `r.${r.room}`, `k.${r.key}`, `h.${r.hostKey}`]);
});
