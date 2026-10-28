// Live relay between the agent (MCP over HTTP) and the open editor tab (WebSocket).
// One Durable Object per token hash. It stores only { createdAt, revoked, agent: { name, version } },
// never script text: calls and results pass through memory.
import { DurableObject } from "cloudflare:workers";

export const MAX_AGE_MS = 8 * 60 * 60 * 1000;

export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pending = new Map();
    // Keepalive pings from the tab are answered without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  async meta() {
    return (await this.ctx.storage.get("meta")) ?? null;
  }
  valid(meta) {
    return !!meta && !meta.revoked && Date.now() - meta.createdAt < MAX_AGE_MS;
  }
  tab() {
    return this.ctx.getWebSockets("tab").at(-1) ?? null;
  }
  send(ws, message) {
    try { ws.send(JSON.stringify(message)); return true; } catch { return false; }
  }

  // The tab connects here (the Worker has already checked the token's form).
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    let meta = await this.meta();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (meta && !this.valid(meta)) {
      this.ctx.acceptWebSocket(server, ["closing"]);
      server.close(4003, meta.revoked ? "revoked" : "expired");
    } else {
      if (!meta) {
        meta = { createdAt: Date.now(), revoked: false, agent: null };
        await this.ctx.storage.put("meta", meta);
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
      const meta = (await this.meta()) ?? { createdAt: Date.now(), agent: null };
      await this.ctx.storage.put("meta", { ...meta, revoked: true, agent: null });
      for (const p of this.pending.values()) p.done({ status: "unauthorized" });
      for (const s of this.ctx.getWebSockets()) { try { s.close(4003, "revoked"); } catch { /* closed */ } }
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch { /* closed */ }
  }

  // Called by the Worker for each MCP request.
  async op(message) {
    const meta = await this.meta();
    if (!this.valid(meta)) return { status: "unauthorized" };
    if (message.op === "auth") return { status: "ok" };
    if (message.op === "agent") {
      meta.agent = { name: String(message.name ?? "").slice(0, 60), version: String(message.version ?? "").slice(0, 30) };
      await this.ctx.storage.put("meta", meta);
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
}
