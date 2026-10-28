// script.techies.tools Worker: static assets, the live relay (/api/relay) and MCP (/mcp).
import { Relay } from "./relay.js";
import { handleMcp, TOKEN_RE } from "./mcp.js";

export { Relay };

async function sha256hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function relayStub(env, token) {
  return env.RELAY.get(env.RELAY.idFromName(await sha256hex(token)));
}
const noindex = (response) => {
  if (response.status === 101) return response;
  const r = new Response(response.body, response);
  r.headers.set("X-Robots-Tag", "noindex");
  return r;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/relay") {
      if (request.headers.get("Upgrade") !== "websocket") return noindex(Response.json({ error: "Expected a WebSocket" }, { status: 426 }));
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return noindex(Response.json({ error: "Forbidden" }, { status: 403 }));
      // The token travels as a subprotocol, never in the URL: ["script-editor", "t.<token>"].
      const protocols = (request.headers.get("Sec-WebSocket-Protocol") || "").split(",").map((p) => p.trim());
      const token = protocols.find((p) => p.startsWith("t."))?.slice(2) ?? "";
      if (!protocols.includes("script-editor") || !TOKEN_RE.test(token)) return noindex(Response.json({ error: "Unauthorized" }, { status: 401 }));
      const stub = await relayStub(env, token);
      return stub.fetch("https://relay/tab", { headers: { Upgrade: "websocket" } });
    }
    if (url.pathname === "/mcp") {
      const stubs = new Map();
      const relayFor = (token) => ({
        async op(message) {
          if (!stubs.has(token)) stubs.set(token, await relayStub(env, token));
          return stubs.get(token).op(message);
        },
      });
      return noindex(await handleMcp(request, { relayFor }));
    }
    if (url.pathname.startsWith("/api/")) return noindex(Response.json({ error: "Not found" }, { status: 404 }));
    return env.ASSETS.fetch(request);
  },
};
