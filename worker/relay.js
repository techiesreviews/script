// Live relay between the agent (MCP over HTTP) and the open editor tab (WebSocket).
// One Durable Object per token hash. It stores only { createdAt, expiresAt, revoked, agent: { name, version } },
// never script text: calls and results pass through memory. An alarm just after expiresAt erases the note.
import { DurableObject } from "cloudflare:workers";
import { MAX_AGE_MS } from "./mcp.js";

export const ALARM_SLACK_MS = 60_000;
export const IMAGE_PART = 256 * 1024;
// When a note may go: its expiry, or for a note from before expiresAt 8 hours after it was made (long past).
const dueOf = (meta) => (meta?.expiresAt ?? (meta?.createdAt ?? 0) + MAX_AGE_MS) + ALARM_SLACK_MS;

export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pending = new Map();
    // Keepalive pings from the tab are answered without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  now() { return Date.now(); }
  async meta() {
    return (await this.ctx.storage.get("meta")) ?? null;
  }
  valid(meta) {
    const now = this.now();
    return !!meta && !meta.revoked && now - meta.createdAt < MAX_AGE_MS && (meta.expiresAt == null || now < meta.expiresAt);
  }
  // Every write sets the alarm, so no note outlives its expiry.
  async save(meta) {
    await this.ctx.storage.put("meta", meta);
    await this.ctx.storage.setAlarm(dueOf(meta));
  }
  // A note from before alarms gets one when it is used again.
  async keepTimed(meta) {
    if (meta && (await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(dueOf(meta));
  }
  tab() {
    return this.ctx.getWebSockets("tab").at(-1) ?? null;
  }
  send(ws, message) {
    try { ws.send(JSON.stringify(message)); return true; } catch { return false; }
  }

  // The tab connects here. The Worker has already checked the token and passes its birth time.
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const bornHeader = request.headers.get("X-Token-Born");
    const born = bornHeader && /^\d+$/.test(bornHeader) ? Number(bornHeader) : null;
    const now = this.now();
    let meta = await this.meta();
    await this.keepTimed(meta);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // No birth time is only possible from outside the Worker; it is refused like a token past its time.
    const late = born == null || (!meta && now - born >= MAX_AGE_MS);
    if (late || (meta && !this.valid(meta))) {
      // Not kept: accepted only to say why, then closed, like the Worker and the room do (a socket handed to the
      // hibernation API and closed at once did not finish closing in wrangler dev).
      server.accept();
      server.close(4003, meta?.revoked ? "revoked" : "expired");
    } else {
      if (!meta) {
        meta = { createdAt: born, expiresAt: born + MAX_AGE_MS, revoked: false, agent: null };
        await this.save(meta);
      }
      // Only the newest tab receives calls.
      for (const old of this.ctx.getWebSockets("tab")) {
        try { old.close(4001, "Open in another tab"); } catch { /* already closed */ }
      }
      this.ctx.acceptWebSocket(server, ["tab"]);
      this.send(server, { type: "ready", createdAt: meta.createdAt });
      if (meta.agent) this.send(server, { type: "agent", ...meta.agent });
    }
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": "script-editor" } });
  }

  async webSocketMessage(ws, data) {
    let msg;
    try { msg = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)); } catch { return; }
    if (msg?.type === "result" && typeof msg.id === "string") {
      const p = this.pending.get(msg.id);
      if (p) p.done({ status: "ok", result: msg.result, error: msg.error });
    } else if (msg?.type === "ping") {
      this.send(ws, { type: "pong" });
    } else if (msg?.type === "revoke") {
      // The revoked note stays until its alarm, so the token is refused until it would have expired anyway. Without a
      // note (rare) the token's birth time is unknown here: it is kept as long as any token could still live.
      const now = this.now();
      const meta = (await this.meta()) ?? { createdAt: now, expiresAt: now + MAX_AGE_MS, agent: null };
      await this.save({ ...meta, revoked: true, agent: null });
      for (const p of this.pending.values()) p.done({ status: "unauthorized" });
      for (const s of this.ctx.getWebSockets()) { try { s.close(4003, "revoked"); } catch { /* closed */ } }
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch { /* closed */ }
  }

  // The note's time is up: whatever waits is refused, the tab is told, and the object is emptied.
  async alarm() {
    const meta = await this.meta();
    const due = dueOf(meta);
    if (meta && this.now() < due) return this.ctx.storage.setAlarm(due);
    for (const p of this.pending.values()) p.done({ status: "unauthorized" });
    for (const s of this.ctx.getWebSockets()) { try { s.close(4003, "expired"); } catch { /* closed */ } }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // Called by the Worker for each MCP request; message.born is the token's birth time.
  async op(message) {
    const meta = await this.meta();
    await this.keepTimed(meta);
    if (!this.valid(meta)) return { status: "unauthorized" };
    if (!Number.isFinite(message.born) || this.now() - message.born >= MAX_AGE_MS) return { status: "unauthorized" };
    if (message.op === "auth") return { status: "ok" };
    if (message.op === "agent") {
      meta.agent = { name: String(message.name ?? "").slice(0, 60), version: String(message.version ?? "").slice(0, 30) };
      await this.save(meta);
      const ws = this.tab();
      if (ws) this.send(ws, { type: "agent", ...meta.agent });
      return { status: "ok" };
    }
    if (message.op === "call") {
      const ws = this.tab();
      if (!ws) return { status: "no-tab" };
      const id = crypto.randomUUID();
      const timeout = Math.min(Math.max(Number(message.timeout) || 10_000, 1_000), 35_000);
      return await new Promise((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(id); resolve({ status: "timeout" }); }, timeout);
        this.pending.set(id, { done: (r) => { clearTimeout(timer); this.pending.delete(id); resolve(r); } });
        if (!this.send(ws, { type: "call", id, tool: message.tool, args: message.args ?? {} })) {
          this.pending.get(id)?.done({ status: "no-tab" });
        }
      });
    }
    return { status: "ok" };
  }

  // A picture from the agent (step K), from the Worker's upload address, answered by the tab like a call. Never
  // stored. A JSON head { type: "image", id, code, mime, parts, size }, then the bytes in binary parts of IMAGE_PART:
  // each part starts with the head's id (36 bytes) and its number (4 bytes), so WebSocket messages stay small and
  // nothing is re-encoded.
  async image({ code, type, bytes }) {
    const meta = await this.meta();
    await this.keepTimed(meta);
    if (!this.valid(meta)) return { status: "unauthorized" };
    const ws = this.tab();
    if (!ws) return { status: "no-tab" };
    const data = new Uint8Array(bytes);
    const id = crypto.randomUUID();
    const parts = Math.max(1, Math.ceil(data.byteLength / IMAGE_PART));
    return await new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ status: "timeout" }); }, 30_000);
      this.pending.set(id, { done: (r) => { clearTimeout(timer); this.pending.delete(id); resolve(r); } });
      const fail = () => this.pending.get(id)?.done({ status: "no-tab" });
      if (!this.send(ws, { type: "image", id, code, mime: type, parts, size: data.byteLength })) return fail();
      const head = new TextEncoder().encode(id);
      for (let part = 0; part < parts; part++) {
        const chunk = data.subarray(part * IMAGE_PART, (part + 1) * IMAGE_PART);
        const frame = new Uint8Array(40 + chunk.byteLength);
        frame.set(head, 0);
        new DataView(frame.buffer).setUint32(36, part);
        frame.set(chunk, 40);
        try { ws.send(frame.buffer); } catch { return fail(); }
      }
    });
  }
}
