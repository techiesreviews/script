// Room for working together (Share to edit). One Durable Object per room id, with the hibernation API.
// It passes messages between the host's tab and the guests and never stores script text: storage holds only
// { keyHash, hostHash, createdAt, ended }. Per-socket data (person id, name, role) lives in the socket attachment.
// The host's tab is the source of truth; the room only checks who may send what, and stamps who sent it.
//
// No Cloudflare imports, so the tests can run it with a fake ctx and fake sockets.

export const PROTOCOL = "script-editor-room";
export const HOST_GRACE_MS = 30_000;
export const GUESTS_MAX = 20;
export const GUEST_MESSAGE_MAX = 512 * 1024;
export const NAME_MAX = 40;
export const CLOSE = { replaced: 4001, refused: 4003, ended: 4004, full: 4005 };
// What a guest may send. "op", "ask" and "resync" go to the host; a caret goes to everyone else.
const TO_HOST = new Set(["op", "ask", "resync"]);

const pidChars = "abcdefghijklmnopqrstuvwxyz0123456789";
function newPid() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return "g" + [...bytes].map((b) => pidChars[b % pidChars.length]).join("");
}
export const cleanName = (name) => String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Keepalive pings are answered without waking the object.
    if (typeof WebSocketRequestResponsePair === "function") {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
    }
  }

  // The Worker has checked the subprotocol's form and passes only the hashes of the keys.
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    await this.join(server, { keyHash: request.headers.get("X-Room-Key") || "", hostHash: request.headers.get("X-Room-Host") || "" });
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": PROTOCOL } });
  }

  meta() { return this.ctx.storage.get("meta"); }
  att(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  send(ws, msg) { try { ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)); return true; } catch { return false; } }
  host() { return this.ctx.getWebSockets("host")[0] ?? null; }
  guests() { return this.ctx.getWebSockets("guest"); }
  guest(pid) { return this.guests().find((ws) => this.att(ws).pid === pid) ?? null; }
  // A refused socket is not kept: it is accepted only to say why, then closed.
  refuse(ws, code, reason) {
    try { ws.accept?.(); ws.close(code, reason); } catch { /* closed */ }
  }

  async join(ws, { keyHash, hostHash }) {
    let meta = await this.meta();
    if (meta?.ended) return this.refuse(ws, CLOSE.ended, "ended");
    if (hostHash) {
      if (!meta) {
        meta = { keyHash, hostHash, createdAt: Date.now(), ended: false };
        await this.ctx.storage.put("meta", meta);
      } else if (meta.hostHash !== hostHash || meta.keyHash !== keyHash) return this.refuse(ws, CLOSE.refused, "refused");
      for (const old of this.ctx.getWebSockets("host")) { try { old.close(CLOSE.replaced, "replaced"); } catch { /* closed */ } }
      await this.ctx.storage.deleteAlarm();
      this.ctx.acceptWebSocket(ws, ["host"]);
      ws.serializeAttachment({ pid: "host", role: "host" });
      const peers = this.guests().map((g) => this.att(g)).filter((a) => a.name).map(({ pid, name }) => ({ pid, name }));
      this.send(ws, { type: "welcome", role: "host", pid: "host", peers });
      for (const g of this.guests()) this.send(g, { type: "host", online: true });
      return;
    }
    // A guest needs a room that exists and its key.
    if (!meta) return this.refuse(ws, CLOSE.ended, "ended");
    if (meta.keyHash !== keyHash) return this.refuse(ws, CLOSE.refused, "refused");
    if (this.guests().length >= GUESTS_MAX) return this.refuse(ws, CLOSE.full, "full");
    const pid = newPid();
    this.ctx.acceptWebSocket(ws, ["guest"]);
    ws.serializeAttachment({ pid, role: "guest", name: "" });
    this.send(ws, { type: "welcome", role: "guest", pid, host: !!this.host() });
  }

  async webSocketMessage(ws, data) {
    const me = this.att(ws);
    if (me.role !== "host" && me.role !== "guest") return;
    const size = typeof data === "string" ? data.length : data.byteLength;
    if (me.role === "guest" && size > GUEST_MESSAGE_MAX) return;
    let msg;
    try { msg = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)); } catch { return; }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    if (msg.type === "ping") return this.send(ws, { type: "pong" });
    if (me.role === "host") return this.fromHost(msg);
    return this.fromGuest(ws, me, msg);
  }

  async fromHost(msg) {
    if (msg.type === "to" && typeof msg.to === "string" && msg.msg) {
      const g = this.guest(msg.to);
      if (g) this.send(g, msg.msg);
    } else if (msg.type === "all" && msg.msg) {
      const text = JSON.stringify(msg.msg);
      for (const g of this.guests()) this.send(g, text);
    } else if (msg.type === "caret") {
      const text = JSON.stringify({ type: "caret", from: "host", c: msg.c ?? null });
      for (const g of this.guests()) this.send(g, text);
    } else if (msg.type === "end") {
      await this.end();
    }
  }

  fromGuest(ws, me, msg) {
    const host = this.host();
    if (msg.type === "hello") {
      const name = cleanName(msg.name) || "Guest";
      ws.serializeAttachment({ ...me, name });
      // `client` stays the same across the guest's reconnects; `v` is the last version it agreed on (or null).
      const client = typeof msg.client === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(msg.client) ? msg.client : null;
      const v = Number.isInteger(msg.v) && msg.v >= 0 ? msg.v : null;
      if (host) this.send(host, { type: "join", from: me.pid, name, client, v });
      else this.send(ws, { type: "host", online: false });
    } else if (!me.name) {
      // Nothing else before the guest has said who they are.
    } else if (TO_HOST.has(msg.type)) {
      // Never dropped quietly: without a host the guest hears so, keeps its change and sends it again later.
      if (host) this.send(host, { ...msg, from: me.pid });
      else this.send(ws, { type: "host", online: false });
    } else if (msg.type === "caret") {
      const text = JSON.stringify({ type: "caret", from: me.pid, c: msg.c ?? null });
      if (host) this.send(host, text);
      for (const g of this.guests()) if (g !== ws) this.send(g, text);
    }
  }

  async webSocketClose(ws, code) {
    const me = this.att(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch { /* closed */ }
    if (me.role === "guest") {
      const host = this.host();
      if (host && me.name) this.send(host, { type: "leave", from: me.pid });
    } else if (me.role === "host" && !this.ctx.getWebSockets("host").some((s) => s !== ws)) {
      if ((await this.meta())?.ended) return;
      for (const g of this.guests()) this.send(g, { type: "host", online: false });
      await this.ctx.storage.setAlarm(Date.now() + HOST_GRACE_MS);
    }
  }
  async webSocketError(ws) { return this.webSocketClose(ws, 1006); }

  // The host has been away for 30 seconds: the room ends.
  async alarm() {
    if (!this.host()) await this.end();
  }

  async end() {
    const meta = (await this.meta()) || {};
    await this.ctx.storage.put("meta", { createdAt: meta.createdAt ?? Date.now(), ended: true });
    await this.ctx.storage.deleteAlarm();
    for (const s of this.ctx.getWebSockets()) { try { s.close(CLOSE.ended, "ended"); } catch { /* closed */ } }
  }
}
