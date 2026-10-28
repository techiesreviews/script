// Working together: the connection to a room, the protocol, and the host and guest roles.
// Nothing here knows about scripts: an app plugs in through an adapter (see docs/together.md).
//
// The host's tab is the source of truth. It orders every change, gives it a version number and sends it to
// everyone. A guest keeps at most one batch of changes in flight; the host's copy of it is its receipt.
// A guest never drops its own changes: it sends only while the room is live, keeps the batch in flight and the
// rest unsent across a lost connection or an away host, and on rejoining catches up from its last confirmed
// version (or rebases onto a snapshot) before sending them again.
import { diff, applyOps, transformOps, cloneBlocks, validOps, validCaret, movePoint, opEnd, Conflict } from "./ops.js";

export const PROTOCOL = "script-editor-room";
export const CARET_MS = Math.ceil(1000 / 15); // at most 15 caret messages a second
export const COLOURS = 6;
export const LOG_MAX = 500;
const GROUP_MS = 1500; // typing with pauses shorter than this is one change for Undo
const PING_MS = 30_000;
const MINE_MAX = 100;

/* ---------- Links and keys ---------- */
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export const ROOM_RE = /^[A-Za-z0-9_-]{22}$/;
export const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
/** A new room: its id, the edit key in the link, and the host key that never leaves the host's tab. */
export const newRoom = () => ({ room: random(16), key: random(32), hostKey: random(32) });
/** The edit link. The key stays after "#", so browsers never send it to a server. */
export const makeLink = (origin, { room, key }) => `${String(origin).replace(/\/+$/, "")}/#room=${room}&k=${key}`;
export function parseLink(hash) {
  const p = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  const room = p.get("room") ?? "", key = p.get("k") ?? "";
  return ROOM_RE.test(room) && KEY_RE.test(key) ? { room, key } : null;
}
/** The key is proved with WebSocket subprotocols, never in a URL. */
export const protocols = ({ room, key, hostKey }) => [PROTOCOL, `r.${room}`, `k.${key}`, ...(hostKey ? [`h.${hostKey}`] : [])];

/* ---------- The client ---------- */
/**
 * new RoomClient({ role: "host" | "guest", room, key, hostKey?, url, name, adapter, on })
 *   adapter: { read(), apply(ops, { by }), meta(), load({ blocks, meta }), caret?(), held?(), busy?(), validAttrs?(attrs, partial), validBlocks?(blocks, before) }
 *   on: { status(s), people(list), carets(), message(msg), changed() }
 *   status: connecting | live | away (connection lost, or the host is away) | ended | refused | full (final: the last three)
 */
export class RoomClient {
  constructor({ role, room, key, hostKey = null, url, name = "", adapter, on = {}, WebSocketImpl = globalThis.WebSocket, now = () => Date.now(), timers = globalThis, backoffMs = 500 }) {
    Object.assign(this, { role, room, key, hostKey: role === "host" ? hostKey : null, url, name, adapter, on, WS: WebSocketImpl, now, timers, backoffMs });
    this.client = random(12); // stays the same across reconnects, so the host knows which batches it already has
    this.pid = role === "host" ? "host" : null;
    this.v = 0;
    this.shadow = null; // host: the agreed document; guest: the agreed document plus the batch in flight
    this.confirmed = null; // guest: the agreed document at version v
    this.live = null; // what this tab shows, as blocks
    this.log = []; // host: [{ v, ops, by, client, seq }]
    this.applied = new Map(); // host: client → the last seq it applied from that client
    this.pending = null; // guest: { seq, ops } in flight
    this.seq = 0;
    this.synced = false;
    this.resyncing = false;
    this.people = new Map(); // pid → { pid, name, colour, kind }
    this.carets = new Map(); // pid → { blockId, offset, selEnd? }
    this.changes = new Map(); // pid → their last text change { blockId, start, end, removed, at, alive }
    this.mine = []; // my changes, newest last, for Ctrl/Cmd+Z
    this.queue = [];
    this.status = "connecting";
    this.retry = 0;
    this.stopped = false;
    this.myCaret = null;
  }

  link(origin) { return makeLink(origin, this); }
  start() {
    if (this.role === "host") {
      this.live = this.adapter.read();
      this.shadow = cloneBlocks(this.live);
      this.synced = true;
      this.people.set("host", { pid: "host", name: this.name, colour: 0, kind: "person" });
    }
    this.connect();
    this.pinger = this.timers.setInterval(() => this.send({ type: "ping" }), PING_MS);
    return this;
  }
  setStatus(s) { if (this.status !== s) { this.status = s; this.on.status?.(s); } }

  connect() {
    if (this.stopped) return;
    const ws = new this.WS(this.url, protocols(this));
    this.ws = ws;
    ws.addEventListener("message", (e) => { if (this.ws === ws) this.receive(e.data); });
    ws.addEventListener("close", (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (e.code === 4004) return this.finish("ended");
      if (e.code === 4003) return this.finish("refused");
      if (e.code === 4005) return this.finish("full");
      if (this.stopped) return;
      this.joining = false;
      this.setStatus("away");
      const delay = Math.min(15_000, this.backoffMs * 2 ** this.retry++) * (0.75 + Math.random() * 0.5);
      this.reconnect = this.timers.setTimeout(() => this.connect(), delay);
    });
  }
  send(msg) {
    try { if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; } } catch { /* closed */ }
    return false;
  }
  finish(status) {
    this.stopped = true;
    this.timers.clearTimeout(this.reconnect);
    this.timers.clearInterval(this.pinger);
    this.timers.clearTimeout(this.caretTimer);
    try { this.ws?.close(1000, "bye"); } catch { /* closed */ }
    this.ws = null;
    this.carets.clear();
    this.setStatus(status);
    this.on.carets?.();
  }
  /** Host: end the room for everyone. Guest: leave. */
  stop() {
    if (this.stopped) return;
    if (this.role === "host") this.send({ type: "end" });
    this.finish("ended");
  }

  receive(data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.type !== "string" || msg.type === "pong") return;
    // While the person composes text (an input method), changes wait so the composition is not broken.
    if (this.adapter.busy?.() && (msg.type === "op" || msg.type === "snapshot" || msg.type === "catchup" || msg.type === "refused")) { this.queue.push(msg); return; }
    this.retry = 0;
    if (this.role === "host") this.hostMessage(msg);
    else this.guestMessage(msg);
  }
  /** Call when the adapter is no longer busy. */
  resume() {
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.receive(JSON.stringify(m));
  }

  /* ---------- Local changes ---------- */
  /** Call after every change the person makes. */
  local() {
    if (!this.live || this.applying || this.stopped) return;
    const cur = this.adapter.read();
    const step = diff(this.live, cur, this.adapter.caret?.());
    if (!step.length) return this.flush();
    this.see(step, this.pid, cloneBlocks(this.live), { record: !this.undoing });
    this.live = cur;
    this.on.changed?.();
    this.flush();
  }
  flush() {
    if (this.stopped || this.adapter.held?.()) return;
    if (this.role === "host") {
      const ops = diff(this.shadow, this.live, this.adapter.caret?.());
      if (!ops.length) return;
      this.shadow = cloneBlocks(this.live);
      this.commit(ops, "host");
    } else {
      // Only while the room is live; otherwise the changes stay unsent (live differs from shadow) until then.
      if (!this.synced || this.pending || this.resyncing || this.status !== "live") return;
      const ops = diff(this.shadow, this.live, this.adapter.caret?.());
      if (!ops.length) return;
      const pending = { seq: this.seq + 1, ops };
      // Key order matters: the room reads type, base and seq from the start of an oversized frame (docs/together.md).
      if (!this.send({ type: "op", base: this.v, seq: pending.seq, ops })) return;
      this.seq = pending.seq;
      this.pending = pending;
      this.shadow = cloneBlocks(this.live);
    }
  }

  /** My caret: { blockId, offset, selEnd? } or null. Sent at most 15 times a second. */
  caret(c) {
    this.myCaret = c && validCaret(c) ? { blockId: c.blockId, offset: c.offset, ...(c.selEnd != null && c.selEnd !== c.offset ? { selEnd: c.selEnd } : {}) } : null;
    if (this.caretTimer) { this.caretLater = true; return; }
    this.send({ type: "caret", c: this.myCaret });
    this.caretTimer = this.timers.setTimeout(() => {
      this.caretTimer = 0;
      if (this.caretLater) { this.caretLater = false; this.caret(this.myCaret); }
    }, CARET_MS);
  }

  /* ---------- Applying changes that came from others ---------- */
  // `ops` apply to this.live; `next` is this.live with them applied.
  applyRemote(ops, by, next) {
    this.see(ops, by, cloneBlocks(this.live), { record: true });
    this.live = next;
    this.applying = true;
    try { this.adapter.apply(ops, { by }); } finally { this.applying = false; }
    this.on.carets?.();
  }

  // Carets, change ranges and Undo follow every applied batch; `base` is the document before it (changed here).
  see(ops, by, base, { record }) {
    const text = (id) => base.find((b) => b.id === id)?.text ?? "";
    const op1 = ops.length === 1 ? ops[0] : null;
    const now = this.now();
    let rec = null;
    if (op1?.type === "text") rec = { kind: "text", blockId: op1.blockId, start: op1.at, end: op1.at + op1.ins.length, removed: text(op1.blockId).slice(op1.at, op1.at + op1.del), at: now, alive: true };
    else if (op1?.type === "split") rec = { kind: "split", blockId: op1.blockId, newId: op1.newId, at: now, alive: true };
    else if (op1?.type === "merge") rec = { kind: "merge", blockId: op1.into, start: text(op1.into).length, end: text(op1.into).length, newId: op1.blockId, attrs: { ...base.find((b) => b.id === op1.blockId)?.attrs }, at: now, alive: true };
    // Typing on at the end of the same change, or Backspace inside it, makes the change longer or shorter.
    const grow = (prev) => {
      if (!prev?.alive || prev.kind !== "text" || rec?.kind !== "text" || prev.blockId !== rec.blockId || now - prev.at > GROUP_MS) return false;
      const o = op1;
      if (o.del === 0 && o.at === prev.end) prev.end += o.ins.length;
      else if (!o.ins && o.at >= prev.start && o.at + o.del === prev.end) prev.end -= o.del;
      else return false;
      prev.at = now;
      return true;
    };
    const mineTop = by === this.pid ? this.mine.at(-1) : null;
    const grewMine = record && by === this.pid && grow(mineTop);
    const theirs = this.changes.get(by);
    const grewTheirs = by !== this.pid && grow(theirs);
    let author = null;
    for (const op of ops) {
      const joinAt = op.type === "merge" ? text(op.into).length : undefined;
      for (const [pid, c] of this.carets) {
        if (pid === by) continue;
        const at = movePoint({ blockId: c.blockId, offset: c.offset }, op, { joinAt });
        const sel = c.selEnd != null ? movePoint({ blockId: c.blockId, offset: c.selEnd }, op, { joinAt }) : null;
        if (!at) this.carets.delete(pid);
        else this.carets.set(pid, { blockId: at.blockId, offset: at.offset, ...(sel && sel.blockId === at.blockId ? { selEnd: sel.offset } : {}) });
      }
      for (const ch of [...this.changes.values(), ...this.mine]) {
        if ((ch === mineTop && grewMine) || (ch === theirs && grewTheirs)) continue;
        follow(ch, op, joinAt);
      }
      author = opEnd(op, joinAt) || author;
      applyOps(base, [op]);
    }
    if (by !== this.pid && author && this.people.has(by)) this.carets.set(by, author);
    if (rec && !grewTheirs && by !== this.pid && rec.kind === "text") this.changes.set(by, rec);
    if (rec && record && by === this.pid && !grewMine) {
      this.mine.push(rec);
      if (this.mine.length > MINE_MAX) this.mine.shift();
    }
  }

  /* ---------- Undo ---------- */
  /** Is `pid`'s last text change still there to undo? */
  canUndo(pid) {
    const ch = this.changes.get(pid);
    return !!ch?.alive && (ch.end > ch.start || !!ch.removed) && this.fits(ch);
  }
  fits(ch) {
    const b = this.live?.find((x) => x.id === ch.blockId);
    if (!b) return false;
    if (ch.kind === "text") return ch.end <= b.text.length;
    if (ch.kind === "split") { const i = this.live.indexOf(b); return this.live[i + 1]?.id === ch.newId; }
    return ch.start <= b.text.length && !this.live.some((x) => x.id === ch.newId);
  }
  undoOps(ch) {
    if (ch.kind === "text") return [{ type: "text", blockId: ch.blockId, at: ch.start, del: ch.end - ch.start, ins: ch.removed }];
    if (ch.kind === "split") return [{ type: "merge", blockId: ch.newId, into: ch.blockId, at: this.live.find((b) => b.id === ch.blockId).text.length }];
    return [{ type: "split", blockId: ch.blockId, at: ch.start, newId: ch.newId, attrs: ch.attrs }];
  }
  run(ch) {
    ch.alive = false;
    const ops = this.undoOps(ch);
    this.undoing = true;
    try { this.adapter.apply(ops, { by: this.pid, local: true }); this.local(); } finally { this.undoing = false; }
    this.on.carets?.();
    return true;
  }
  /** Undo someone's last text change (the undo button on their name tag). */
  undoFor(pid) {
    if (!this.canUndo(pid)) return false;
    const ch = this.changes.get(pid);
    this.changes.delete(pid);
    return this.run(ch);
  }
  /** Ctrl/Cmd+Z in a room: undo my own newest change that is still there. */
  undoMine() {
    while (this.mine.length) {
      const ch = this.mine.pop();
      if (ch.alive && this.fits(ch)) return this.run(ch);
    }
    return false;
  }

  /* ---------- People and carets, as lists for the app ---------- */
  peopleList() {
    return [...this.people.values()].map((p) => ({ ...p, me: p.pid === this.pid }));
  }
  caretList() {
    const out = [];
    for (const [pid, c] of this.carets) {
      const p = this.people.get(pid);
      if (p && pid !== this.pid) out.push({ ...p, ...c, undo: this.canUndo(pid) });
    }
    return out;
  }
  setCaret(pid, c) {
    if (!validCaret(c) || pid === this.pid) return;
    if (c) this.carets.set(pid, c); else this.carets.delete(pid);
    this.on.carets?.();
  }
  setPeople(list) {
    this.people = new Map(list.map((p) => [p.pid, p]));
    for (const pid of this.carets.keys()) if (!this.people.has(pid)) this.carets.delete(pid);
    for (const pid of this.changes.keys()) if (!this.people.has(pid)) this.changes.delete(pid);
    this.on.people?.(this.peopleList());
    this.on.carets?.();
  }

  /* ---------- Host ---------- */
  hostMessage(msg) {
    switch (msg.type) {
      case "welcome": {
        // Back after a lost connection: the guests say hello again and catch up from their own versions.
        this.setStatus("live");
        const keep = [this.people.get("host")];
        for (const { pid, name } of msg.peers || []) keep.push(this.person(pid, name));
        this.setPeople(keep.filter(Boolean));
        this.local();
        this.sendPeople();
        return;
      }
      case "join": {
        const known = this.people.get(msg.from);
        this.people.set(msg.from, { ...this.person(msg.from, msg.name), client: typeof msg.client === "string" ? msg.client : known?.client ?? null });
        this.local();
        this.catchUp(msg.from, msg.v);
        this.setPeople([...this.people.values()]);
        this.sendPeople();
        return;
      }
      case "leave":
        this.people.delete(msg.from);
        this.setPeople([...this.people.values()]);
        this.sendPeople();
        return;
      case "op": return this.guestOps(msg);
      case "resync": return this.snapshotTo(msg.from);
      case "caret": return this.setCaret(msg.from, msg.c);
      default: this.on.message?.(msg);
    }
  }
  person(pid, name) {
    const known = this.people.get(pid);
    if (known) return { ...known, name: String(name || known.name).slice(0, 40) };
    const used = new Set([...this.people.values()].map((p) => p.colour));
    let colour = 0;
    while (used.has(colour) && colour < COLOURS) colour++;
    if (colour >= COLOURS) colour = this.people.size % COLOURS;
    return { pid, name: String(name || "Guest").slice(0, 40), colour, kind: "person" };
  }
  publicPeople() { return this.peopleList().map(({ me, client, ...p }) => p); }
  sendPeople() { this.send({ type: "all", msg: { type: "people", people: this.publicPeople() } }); }
  // A guest that comes back with a version still in the log gets what it missed; otherwise a snapshot.
  catchUp(pid, v) {
    const oldest = this.log.length ? this.log[0].v - 1 : this.v;
    if (!Number.isInteger(v) || v > this.v || v < oldest) return this.snapshotTo(pid);
    const client = this.people.get(pid)?.client;
    const carets = Object.fromEntries([...this.carets].filter(([p]) => p !== pid));
    if (this.myCaret) carets.host = this.myCaret;
    this.send({ type: "to", to: pid, msg: { type: "catchup", v: this.v, entries: this.log.filter((e) => e.v > v).map(({ v: ev, ops, by, client: c, seq }) => ({ v: ev, ops, by, client: c, seq })), seen: this.applied.get(client) ?? 0, people: this.publicPeople(), carets } });
  }
  // `refused`: the seq of the guest's batch that the host will not take (not valid for this document). The guest
  // drops that batch instead of sending it again.
  snapshotTo(pid, { refused } = {}) {
    if (!this.people.has(pid)) return;
    const carets = Object.fromEntries([...this.carets].filter(([p]) => p !== pid));
    if (this.myCaret) carets.host = this.myCaret;
    const seen = this.applied.get(this.people.get(pid)?.client) ?? 0;
    this.send({ type: "to", to: pid, msg: { type: "snapshot", v: this.v, doc: { blocks: this.shadow, meta: this.adapter.meta() }, people: this.publicPeople(), carets, seen, ...(refused != null ? { refused } : {}) } });
  }
  commit(ops, by, client = null, seq = null) {
    this.v++;
    this.log.push({ v: this.v, ops, by, client, seq });
    if (this.log.length > LOG_MAX) this.log.shift();
    if (client) this.applied.set(client, seq);
    this.send({ type: "all", msg: { type: "op", v: this.v, ops, by, ...(client ? { client, seq } : {}) } });
  }
  guestOps({ from, base, seq, ops }) {
    const client = this.people.get(from)?.client;
    if (!this.people.has(from) || !Number.isInteger(seq)) return;
    if (client && seq <= (this.applied.get(client) ?? 0)) return; // a batch sent again that is already in
    const oldest = this.log.length ? this.log[0].v - 1 : this.v;
    if (!validOps(ops, this.adapter.validAttrs)) return this.snapshotTo(from, { refused: seq });
    if (!Number.isInteger(base) || base > this.v || base < oldest) return this.snapshotTo(from);
    try {
      let g = ops;
      for (const e of this.log) if (e.v > base) [g] = transformOps(g, e.ops, false);
      const shadow = applyOps(cloneBlocks(this.shadow), g);
      if (this.adapter.validBlocks && !this.adapter.validBlocks(shadow, this.shadow)) return this.snapshotTo(from, { refused: seq });
      // The host's own changes not sent yet (a "/" command being typed) stay on top.
      const [gl] = transformOps(g, diff(this.shadow, this.live), true);
      const next = applyOps(cloneBlocks(this.live), gl);
      this.shadow = shadow;
      this.commit(g, from, client, seq);
      this.applyRemote(gl, from, next);
    } catch (e) {
      // A clash on the same block: a snapshot the guest rebases onto. Anything else that would not apply is refused.
      this.snapshotTo(from, e instanceof Conflict ? {} : { refused: seq });
    }
  }

  /* ---------- Guest ---------- */
  guestMessage(msg) {
    switch (msg.type) {
      case "welcome":
        this.pid = msg.pid;
        if (msg.host) this.hello();
        else this.setStatus("away");
        return;
      case "snapshot": return this.snapshot(msg);
      case "catchup": return this.catchup(msg);
      case "refused": return this.refused(msg); // the room would not pass a batch on (too large)
      case "op": return this.joining ? undefined : this.remoteOps(msg);
      case "people": return this.setPeople((msg.people || []).filter((p) => p && typeof p.pid === "string"));
      case "caret": return this.setCaret(msg.from, msg.c);
      case "host":
        // The room tells a guest the host is away (also when it could not pass a change on); the guest keeps its
        // changes and says hello again when the host is back.
        if (!msg.online) { this.joining = false; this.setStatus("away"); }
        else this.hello();
        return;
      default: this.on.message?.(msg);
    }
  }
  // Say who we are, with the last version we agreed on, so the host can send only what we missed.
  hello() {
    this.joining = true;
    this.setStatus("connecting");
    // While a resync is open, ask for a snapshot: a resync lost with a connection must not leave us waiting.
    this.send({ type: "hello", name: this.name, client: this.client, v: this.confirmed && !this.resyncing ? this.v : null });
  }
  // Drop the batch in flight (the host refused it): keep only what was typed after it, rebased onto the agreed
  // document. On a clash, the agreed document wins.
  dropPending() {
    if (!this.pending) return;
    let live = cloneBlocks(this.confirmed);
    try {
      const [after] = transformOps(diff(this.shadow, this.live), diff(this.shadow, this.confirmed), false);
      live = applyOps(cloneBlocks(this.confirmed), after);
    } catch { /* keep the agreed document */ }
    this.pending = null;
    this.shadow = cloneBlocks(this.confirmed);
    this.live = live;
    this.mine = [];
  }
  refused({ seq } = {}) {
    if (!this.pending || this.pending.seq !== seq) return;
    this.dropPending();
    this.applying = true;
    try { this.adapter.load({ blocks: cloneBlocks(this.live), meta: this.meta }); } finally { this.applying = false; }
    this.flush();
  }
  snapshot({ v, doc, people, carets, seen = 0, refused = null }) {
    if (!doc || !Array.isArray(doc.blocks)) return;
    if (refused != null && this.pending?.seq === refused) this.dropPending();
    const fresh = cloneBlocks(doc.blocks);
    // Keep what this guest typed: rebase it onto the snapshot. The batch in flight counts as in when the host has it.
    let live = fresh;
    if (this.confirmed && this.live) {
      const base = this.pending && seen >= this.pending.seq ? this.shadow : this.confirmed;
      try {
        const [mine] = transformOps(diff(base, this.live), diff(base, fresh), false);
        live = applyOps(cloneBlocks(fresh), mine);
      } catch { live = fresh; } // a clash on the same block: the host's text wins
    }
    if (this.pending && seen >= this.pending.seq) this.seq = Math.max(this.seq, seen);
    Object.assign(this, { v, pending: null, resyncing: false, synced: true, joining: false, mine: [] });
    this.changes.clear();
    this.confirmed = cloneBlocks(fresh);
    this.shadow = cloneBlocks(fresh);
    this.live = live;
    this.carets = new Map(Object.entries(carets || {}).filter(([, c]) => validCaret(c) && c));
    this.applying = true;
    this.meta = doc.meta;
    try { this.adapter.load({ blocks: cloneBlocks(live), meta: doc.meta }); } finally { this.applying = false; }
    this.setPeople(people || []);
    this.setStatus("live");
    if (this.myCaret) this.caret(this.myCaret);
    this.flush();
  }
  // Back in the room with a known version: apply what was missed, then send the batch in flight again if the host
  // never got it (its seq is past what the host has seen), then the rest.
  catchup({ v, entries, people, carets, seen = 0 }) {
    this.joining = false;
    for (const e of entries || []) this.remoteOps(e);
    if (this.resyncing) return; // the snapshot already asked for brings this guest up to date
    if (this.v !== v) return this.resync();
    this.setPeople(people || []);
    for (const [pid, c] of Object.entries(carets || {})) if (validCaret(c) && c) this.carets.set(pid, c);
    this.setStatus("live");
    if (this.pending) {
      if (seen >= this.pending.seq) { this.confirmed = cloneBlocks(this.shadow); this.pending = null; }
      // Key order matters (see flush).
      else if (!this.send({ type: "op", base: this.v, seq: this.pending.seq, ops: this.pending.ops })) return;
    }
    if (this.myCaret) this.caret(this.myCaret);
    this.on.carets?.();
    this.flush();
  }
  resync() {
    if (this.resyncing) return;
    this.resyncing = true;
    this.send({ type: "resync" });
  }
  remoteOps({ v, ops, by, client, seq }) {
    if (!this.synced || this.resyncing || v <= this.v) return;
    if (v !== this.v + 1) return this.resync();
    if (client === this.client && this.pending && seq === this.pending.seq) {
      this.v = v;
      this.pending = null;
      this.confirmed = cloneBlocks(this.shadow);
      return this.flush();
    }
    try {
      let [r, p] = transformOps(ops, this.pending?.ops ?? [], true);
      const confirmed = applyOps(cloneBlocks(this.confirmed), ops);
      const shadow = applyOps(cloneBlocks(this.shadow), r);
      [r] = transformOps(r, diff(this.shadow, this.live), true);
      const next = applyOps(cloneBlocks(this.live), r);
      this.confirmed = confirmed;
      this.shadow = shadow;
      if (this.pending) this.pending.ops = p;
      this.v = v;
      this.applyRemote(r, by, next);
    } catch {
      this.resync();
    }
  }
}

// A tracked change follows an operation; it dies when someone changes it from inside or its block goes.
function follow(ch, op, joinAt) {
  if (!ch.alive || op.type === "attrs") return;
  if (ch.kind === "split") {
    // An Enter is undone by joining the two blocks again: any other structure change to them ends it.
    if (op.type !== "text" && [op.blockId, op.into, op.newId].some((id) => id && (id === ch.blockId || id === ch.newId))) ch.alive = false;
    return;
  }
  const same = op.blockId === ch.blockId;
  let dead = op.type === "remove" && same;
  if (op.type === "text" && same) dead = op.del > 0 ? op.at < ch.end && op.at + op.del > ch.start : op.at > ch.start && op.at < ch.end;
  if (op.type === "split" && same) dead = op.at > ch.start && op.at < ch.end;
  if (ch.kind === "merge" && op.type !== "text" && (same || op.into === ch.blockId)) dead = true;
  if (dead) { ch.alive = false; return; }
  const empty = ch.start === ch.end;
  const s = movePoint({ blockId: ch.blockId, offset: ch.start }, op, { right: !empty, joinAt });
  const e = movePoint({ blockId: ch.blockId, offset: ch.end }, op, { joinAt });
  if (!s || !e || s.blockId !== e.blockId) { ch.alive = false; return; }
  Object.assign(ch, { blockId: s.blockId, start: s.offset, end: e.offset });
}
