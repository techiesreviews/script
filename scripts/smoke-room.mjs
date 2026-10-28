#!/usr/bin/env node
// Smoke test for working together (Share to edit). Start the Worker first: npx wrangler@4 dev
// Then: node scripts/smoke-room.mjs [base URL, default http://127.0.0.1:8787]
// One host and two guests use the real client (public/together/room.js) over WebSocket, each with a plain
// in-memory document. No network beyond the local Worker.
import { RoomClient, newRoom } from "../public/together/room.js";
import { applyOps, cloneBlocks } from "../public/together/ops.js";

const BASE = (process.argv[2] || process.env.SMOKE_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const URL_ = `${BASE.replace(/^http/, "ws")}/api/room`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "ok" : "FAIL"} ${label}${extra && !ok ? ` (${extra})` : ""}`);
  if (!ok) failures++;
};
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(25); }
  return fn();
}

function plainAdapter(blocks = []) {
  const a = {
    blocks, info: { name: "smoke.md" }, at: null,
    read: () => cloneBlocks(a.blocks),
    apply: (ops) => { applyOps(a.blocks, ops); },
    meta: () => a.info,
    load: (doc) => { a.blocks = doc.blocks; a.info = doc.meta; },
    caret: () => a.at,
    text: () => a.blocks.map((b) => b.text).join("|"),
    type(blockId, at, text) {
      const b = a.blocks.find((x) => x.id === blockId);
      const o = Math.min(at, b.text.length);
      b.text = b.text.slice(0, o) + text + b.text.slice(o);
      a.at = { blockId, offset: o + text.length };
    },
  };
  return a;
}
const para = (id, text) => ({ id, text, attrs: { type: "para" } });
const clients = [];
function client(opts) {
  const c = new RoomClient({ url: URL_, ...opts }).start();
  clients.push(c);
  return c;
}

try {
  const plain = await fetch(`${BASE}/api/room`);
  check(plain.status === 426, "/api/room without a WebSocket gets 426", plain.status);

  const creds = newRoom();
  check(!URL_.includes(creds.key) && !URL_.includes(creds.room), "the socket URL holds no room id and no key");
  const ha = plainAdapter([para("t1", "Smoke test"), para("p1", "We type here together."), para("p2", "A second line.")]);
  const asks = [];
  const host = client({ role: "host", ...creds, name: "Host", adapter: ha, on: { message: (m) => asks.push(m) } });
  check(await until(() => host.status === "live"), "the host opens the room", host.status);

  const g1a = plainAdapter(), g2a = plainAdapter();
  const g1 = client({ role: "guest", room: creds.room, key: creds.key, name: "Ana", adapter: g1a });
  const g2 = client({ role: "guest", room: creds.room, key: creds.key, name: "Ben", adapter: g2a });
  check(await until(() => g1.status === "live" && g2.status === "live"), "two guests join", `${g1.status} ${g2.status}`);
  check(g1a.text() === ha.text() && g2a.text() === ha.text(), "guests get the script", g1a.text());
  check(g1a.info?.name === "smoke.md", "guests get the file name");
  check(await until(() => host.peopleList().length === 3 && g2.peopleList().length === 3), "everyone sees three people", JSON.stringify(g2.peopleList()));

  const bad = client({ role: "guest", room: creds.room, key: newRoom().key, name: "Eve", adapter: plainAdapter() });
  check(await until(() => bad.status === "refused"), "a wrong key is refused", bad.status);

  // Concurrent typing in the same paragraph: everyone types before hearing from the others.
  const words = { host: ["one ", "two ", "three "], g1: ["ana1 ", "ana2 ", "ana3 "], g2: ["ben1 ", "ben2 ", "ben3 "] };
  for (let i = 0; i < 3; i++) {
    ha.type("p1", ha.blocks[1].text.indexOf(" here"), ` ${words.host[i].trim()}`); host.local();
    g1a.type("p1", 0, words.g1[i]); g1.local();
    g2a.type("p1", 999, words.g2[i]); g2.local();
    await sleep(5);
  }
  const same = () => g1a.text() === ha.text() && g2a.text() === ha.text() && !g1.pending && !g2.pending;
  check(await until(same, 8000), "everyone ends on the same text", `${ha.text()} / ${g1a.text()} / ${g2a.text()}`);
  const all = [...words.host, ...words.g1, ...words.g2].every((w) => ha.text().includes(w.trim()));
  check(all, "no typed word is lost", ha.text());
  check(host.v >= 3, "the host gave each batch a version", host.v);

  // Carets: Ana's caret reaches the host and Ben.
  g1.caret({ blockId: "p2", offset: 2, selEnd: 6 });
  check(await until(() => host.carets.get(g1.pid)?.offset === 2 && g2.carets.get(g1.pid)?.selEnd === 6), "a caret reaches everyone", JSON.stringify([...g2.carets]));
  host.caret({ blockId: "p2", offset: 4 });
  check(await until(() => g1.carets.get("host")?.offset === 4), "the host's caret reaches the guests");

  // A guest's ask reaches the host (answers come with step D2).
  g2.send({ type: "ask", ask: { id: "smoke-ask", action: "simpler", quote: "second line" } });
  check(await until(() => asks.some((m) => m.type === "ask" && m.ask?.id === "smoke-ask" && m.from === g2.pid)), "a guest's ask reaches the host", JSON.stringify(asks));

  // Stop sharing: guests see the end, and the link no longer opens the room.
  host.stop();
  check(await until(() => g1.status === "ended" && g2.status === "ended"), "stop sharing ends the room for guests", `${g1.status} ${g2.status}`);
  const late = client({ role: "guest", room: creds.room, key: creds.key, name: "Late", adapter: plainAdapter() });
  check(await until(() => late.status === "ended"), "an ended room refuses new joins", late.status);
} catch (e) {
  console.log("FAIL", e?.stack || e);
  failures++;
} finally {
  for (const c of clients) { try { c.finish(c.status); } catch { /* closed */ } }
}
console.log(`RESULT: ${failures ? "fail" : "ok"} smoke-room`);
process.exit(failures ? 1 : 0);
