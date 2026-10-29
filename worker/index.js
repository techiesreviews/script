// script.techies.tools Worker: static assets, agent tokens (/api/agent-token), the live relay (/api/relay), rooms for
// working together (/api/room) and MCP (/mcp).
import { Relay } from "./relay.js";
import { Room, PROTOCOL as ROOM_PROTOCOL } from "./room.js";
import { handleMcp, TOKEN_RE, checkToken, newToken } from "./mcp.js";
import { IMAGE_UPLOAD_MAX, IMAGE_TYPES } from "../public/broll.js";

export { Relay, Room };
const ROOM_RE = /^[A-Za-z0-9_-]{22}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
// A picture from the agent (step K): /mcp/images/<the token's hash>/<a one-time code the tab gave out>.
const IMAGE_PATH_RE = /^\/mcp\/images\/([0-9a-f]{64})\/([A-Za-z0-9_-]{22})$/;
function base64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

async function sha256hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function relayStub(env, token) {
  return env.RELAY.get(env.RELAY.idFromName(await sha256hex(token)));
}
// A socket that is closed at once, so the tab hears why (4003 makes it forget the token). No relay object is touched.
function closedSocket(code, reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": "script-editor" } });
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
    if (url.pathname === "/api/agent-token") {
      // A new agent token with the Worker's own time inside (see mcp.js). It touches no relay object.
      if (request.method !== "POST") return noindex(Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } }));
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return noindex(Response.json({ error: "Forbidden" }, { status: 403 }));
      const { token, born } = newToken();
      return noindex(Response.json({ token, createdAt: born }, { headers: { "Cache-Control": "no-store" } }));
    }
    if (url.pathname === "/api/relay") {
      if (request.headers.get("Upgrade") !== "websocket") return noindex(Response.json({ error: "Expected a WebSocket" }, { status: 426 }));
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return noindex(Response.json({ error: "Forbidden" }, { status: 403 }));
      // The token travels as a subprotocol, never in the URL: ["script-editor", "t.<token>"].
      const protocols = (request.headers.get("Sec-WebSocket-Protocol") || "").split(",").map((p) => p.trim());
      const token = protocols.find((p) => p.startsWith("t."))?.slice(2) ?? "";
      if (!protocols.includes("script-editor") || !TOKEN_RE.test(token)) return noindex(Response.json({ error: "Unauthorized" }, { status: 401 }));
      // Past its time (or from the future): refused here, before any relay object is touched.
      const t = checkToken(token);
      if (!t.ok) return closedSocket(4003, t.reason);
      const stub = await relayStub(env, token);
      const headers = { Upgrade: "websocket" };
      if (t.born != null) headers["X-Token-Born"] = String(t.born);
      return stub.fetch("https://relay/tab", { headers });
    }
    if (url.pathname === "/api/room") {
      if (request.headers.get("Upgrade") !== "websocket") return noindex(Response.json({ error: "Expected a WebSocket" }, { status: 426 }));
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return noindex(Response.json({ error: "Forbidden" }, { status: 403 }));
      // Room id and keys travel as subprotocols, never in the URL: ["script-editor-room", "r.<room>", "k.<key>", "h.<host key>"?].
      // The room gets only the keys' hashes.
      const protocols = (request.headers.get("Sec-WebSocket-Protocol") || "").split(",").map((p) => p.trim());
      const part = (prefix) => protocols.find((p) => p.startsWith(prefix))?.slice(2) ?? "";
      const room = part("r."), key = part("k."), host = part("h.");
      if (!protocols.includes(ROOM_PROTOCOL) || !ROOM_RE.test(room) || !KEY_RE.test(key) || (host && !KEY_RE.test(host))) {
        return noindex(Response.json({ error: "Unauthorized" }, { status: 401 }));
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      const headers = { Upgrade: "websocket", "X-Room-Key": await sha256hex(key) };
      if (host) headers["X-Room-Host"] = await sha256hex(host);
      return stub.fetch("https://room/join", { headers });
    }
    const image = url.pathname.match(IMAGE_PATH_RE);
    if (image) {
      // Passed straight to the open tab through the live relay; nothing is stored. The code is checked by the tab.
      const say = (status, body) => noindex(Response.json(body, { status, headers: { "Cache-Control": "no-store" } }));
      if (request.method !== "PUT" && request.method !== "POST") return say(405, { error: "Send the picture with PUT." });
      const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
      if (!IMAGE_TYPES.includes(type)) return say(415, { error: "Send a PNG, JPEG or WebP picture with its Content-Type." });
      if (Number(request.headers.get("Content-Length") || 0) > IMAGE_UPLOAD_MAX) return say(413, { error: `The picture is bigger than ${IMAGE_UPLOAD_MAX / 1024 / 1024} MB.` });
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length) return say(400, { error: "The picture is empty." });
      if (bytes.length > IMAGE_UPLOAD_MAX) return say(413, { error: `The picture is bigger than ${IMAGE_UPLOAD_MAX / 1024 / 1024} MB.` });
      const r = await env.RELAY.get(env.RELAY.idFromName(image[1])).image({ code: image[2], type, data: base64(bytes) });
      if (r.status === "ok" && !r.error) return say(200, r.result);
      if (r.status === "ok") return say(400, { error: r.error });
      if (r.status === "no-tab") return say(409, { error: "The script editor is not open. Ask the person to open it and keep the tab open." });
      if (r.status === "timeout") return say(504, { error: "The editor did not answer in time." });
      return say(401, { error: "This address is not valid (any more). Call upload_image again." });
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
