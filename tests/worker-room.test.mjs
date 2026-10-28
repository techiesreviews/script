import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { createHash } from "node:crypto";

// worker/index.js imports the relay, which imports "cloudflare:workers"; a tiny stand-in lets Node load it.
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  return next(specifier, context);
}`));
const { default: worker } = await import("../worker/index.js");

const ROOM = "AAAAAAAAAAAAAAAAAAAAAA", KEY = "k".repeat(43), HOST = "h".repeat(43);
const sha = (s) => createHash("sha256").update(s).digest("hex");
function call({ protocols, origin, upgrade = "websocket" } = {}) {
  const calls = [];
  const env = {
    ROOM: {
      idFromName: (name) => ({ name }),
      get: (id) => ({ fetch: async (url, init) => { calls.push({ id, url, init }); return new Response("to the room"); } }),
    },
  };
  const headers = new Headers();
  if (upgrade) headers.set("Upgrade", upgrade);
  if (origin) headers.set("Origin", origin);
  if (protocols) headers.set("Sec-WebSocket-Protocol", protocols.join(", "));
  return worker.fetch({ url: "https://script.techies.tools/api/room", headers }, env).then((res) => ({ res, calls }));
}

test("worker /api/room: refuses what is not a proper room socket", async () => {
  assert.equal((await call({ upgrade: null })).res.status, 426);
  const good = ["script-editor-room", `r.${ROOM}`, `k.${KEY}`];
  assert.equal((await call({ protocols: good, origin: "https://evil.example" })).res.status, 403);
  for (const protocols of [
    [`r.${ROOM}`, `k.${KEY}`], // no script-editor-room
    ["script-editor-room", "r.short", `k.${KEY}`],
    ["script-editor-room", `k.${KEY}`],
    ["script-editor-room", `r.${ROOM}`, "k.too-short"],
    ["script-editor-room", `r.${ROOM}`],
    ["script-editor-room", `r.${ROOM}`, `k.${KEY}`, "h.bad host key"],
  ]) {
    const { res, calls } = await call({ protocols });
    assert.equal(res.status, 401, protocols.join(" "));
    assert.equal(calls.length, 0);
  }
});

test("worker /api/room: the room gets only SHA-256 hashes of the keys, never the keys", async () => {
  const { res, calls } = await call({ protocols: ["script-editor-room", `r.${ROOM}`, `k.${KEY}`, `h.${HOST}`], origin: "https://script.techies.tools" });
  assert.equal(await res.text(), "to the room");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].id, { name: ROOM });
  const h = calls[0].init.headers;
  assert.match(h["X-Room-Key"], /^[0-9a-f]{64}$/);
  assert.equal(h["X-Room-Key"], sha(KEY));
  assert.equal(h["X-Room-Host"], sha(HOST));
  assert.ok(!JSON.stringify(calls[0]).includes(KEY) && !JSON.stringify(calls[0]).includes(HOST), "no raw key reaches the room");
  const guest = await call({ protocols: ["script-editor-room", `r.${ROOM}`, `k.${KEY}`] });
  assert.equal(guest.calls[0].init.headers["X-Room-Host"], undefined);
});
