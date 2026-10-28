#!/usr/bin/env node
// Smoke test for working together (Share to edit). Start the Worker first: npx wrangler@4 dev
// Then: node scripts/smoke-room.mjs [base URL, default http://127.0.0.1:8787]
// One host and two guests use the real client (public/together/room.js) over WebSocket, each with a plain
// in-memory document. No network beyond the local Worker.
import { RoomClient, newRoom, protocols } from "../public/together/room.js";
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
// Every socket the clients open, with the URL and subprotocols they really sent.
const opened = [];
class WatchedSocket extends WebSocket {
  constructor(url, protos) { super(url, protos); opened.push({ url, protos, ws: this }); }
}
const clients = [];
function client(opts) {
  const c = new RoomClient({ url: URL_, WebSocketImpl: WatchedSocket, backoffMs: 100, ...opts }).start();
  clients.push(c);
  return c;
}

try {
  const plain = await fetch(`${BASE}/api/room`);
  check(plain.status === 426, "/api/room without a WebSocket gets 426", plain.status);

  const creds = newRoom();
  const ha = plainAdapter([para("t1", "Smoke test"), para("p1", "We type here together."), para("p2", "A second line.")]);
  const asks = [];
  const host = client({ role: "host", ...creds, name: "Host", adapter: ha, on: { message: (m) => asks.push(m) } });
  check(await until(() => host.status === "live"), "the host opens the room", host.status);
  const sent = opened[0];
  check(JSON.stringify(sent.protos) === JSON.stringify(protocols(creds)) && sent.protos[0] === "script-editor-room", "the host proves its keys with subprotocols", JSON.stringify(sent.protos));
  check(!sent.url.includes(creds.key) && !sent.url.includes(creds.hostKey) && !sent.url.includes(creds.room), "the socket URL holds no room id and no key", sent.url);
  check(sent.ws.protocol === "script-editor-room", "the room answers with the script-editor-room subprotocol", sent.ws.protocol);

  const g1a = plainAdapter(), g2a = plainAdapter();
  // What each guest hears from the host's app: the shared asks (step D2).
  const shared = { g1: [], g2: [] };
  const g1 = client({ role: "guest", room: creds.room, key: creds.key, name: "Ana", adapter: g1a, on: { message: (m) => shared.g1.push(m) } });
  const g2 = client({ role: "guest", room: creds.room, key: creds.key, name: "Ben", adapter: g2a, on: { message: (m) => shared.g2.push(m) } });
  check(await until(() => g1.status === "live" && g2.status === "live"), "two guests join", `${g1.status} ${g2.status}`);
  check(g1a.text() === ha.text() && g2a.text() === ha.text(), "guests get the script", g1a.text());
  const gs = opened.find((o) => o.protos.length === 3);
  check(gs && JSON.stringify(gs.protos) === JSON.stringify(["script-editor-room", `r.${creds.room}`, `k.${creds.key}`]), "a guest sends no host key", JSON.stringify(gs?.protos));
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

  // A guest's connection drops while it types: nothing it typed is lost.
  g1a.type("p2", 0, "Kept1 "); g1.local();
  g1.ws.close();
  g1a.type("p2", 0, "Kept2 "); g1.local();
  check(await until(() => g1.status === "live" && same() && ha.text().includes("Kept2 Kept1 "), 8000), "a guest's typing survives a lost connection", `${ha.text()} / ${g1a.text()}`);
  check(ha.text().split("Kept1").length === 2, "and arrives once", ha.text());

  // The host's connection drops: guests keep typing, and it all arrives when the host is back.
  host.ws.close();
  check(await until(() => g2.status === "away"), "guests see the host is away", g2.status);
  g2a.type("p2", 999, " WhileAway"); g2.local();
  check(await until(() => host.status === "live" && g2.status === "live" && same() && ha.text().includes("WhileAway"), 10000), "typing while the host is away arrives when it is back", `${ha.text()} / ${g2a.text()}`);

  // Carets: Ana's caret reaches the host and Ben.
  g1.caret({ blockId: "p2", offset: 2, selEnd: 6 });
  check(await until(() => host.carets.get(g1.pid)?.offset === 2 && g2.carets.get(g1.pid)?.selEnd === 6), "a caret reaches everyone", JSON.stringify([...g2.carets]));
  host.caret({ blockId: "p2", offset: 4 });
  check(await until(() => g1.carets.get("host")?.offset === 4), "the host's caret reaches the guests");

  // A guest's ask reaches the host (answers come with step D2).
  g2.send({ type: "ask", ask: { id: "smoke-ask", action: "simpler", quote: "second line" } });
  check(await until(() => asks.some((m) => m.type === "ask" && m.ask?.id === "smoke-ask" && m.from === g2.pid)), "a guest's ask reaches the host", JSON.stringify(asks));
  // The host shares the ask, then the agent's answer, with everyone (as the editor's adapter does).
  const ask = { id: "smoke-ask", scope: "selection", action: "simpler", status: "waiting", by: { id: "guest:ben", name: "Ben" } };
  host.sendAll({ type: "asks", asks: [ask] });
  host.sendAll({ type: "asks", asks: [{ ...ask, status: "answered", answer: { kind: "replace", text: "Shorter line." }, answeredBy: { id: "agent:smoke", name: "Smoke" } }] });
  const answered = (list) => list.some((m) => m.type === "asks" && m.asks[0]?.answer?.text === "Shorter line.");
  check(await until(() => answered(shared.g1) && answered(shared.g2)), "an answer reaches everyone", JSON.stringify(shared.g1.slice(-1)));
  check(shared.g1.filter((m) => m.type === "asks").length === 2, "in order, once each", shared.g1.length);

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
