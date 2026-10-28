// The script editor's side of working together (step D). It turns the script into blocks for the room and back,
// and wires Share to edit, joining with a name, the people in the top bar and other people's carets.
// The room itself (public/together/) knows nothing about scripts; see docs/together.md.
import * as D from "./doc.js";
import * as B from "./broll.js";
import * as C from "./changes.js";
import { agentBrand } from "./agent-brand.js";
import { RoomClient, newRoom, parseLink } from "./together/room.js";
import { applyOp, movePoint } from "./together/ops.js";
import { createCarets, colourVar } from "./together/carets.js";
import { createShareButton } from "./together/share-button.js";

export { parseLink };
const TYPES = ["title", "heading", "note", "raw", "para"];
const ATTRS = ["type", "sep", "prefix"];

/* ---------- The script as blocks (pure: no DOM) ---------- */
// A block's text is its content (what the person edits, "\n" line breaks); its type, separator and "# " / "## "
// marker are attrs. So a para that becomes a heading is an attrs change plus a text change, and carets keep the
// same content offsets as asks.
export const readBlocks = (doc) => doc.blocks.map((b) => ({ id: b.id, text: D.contentOf(b), attrs: { type: b.type, sep: b.sep, prefix: D.prefixOf(b) } }));

// The "# " / "## " marker belongs to its type: titles have "#", headings "##", every other block none. Like
// D.prefixOf, any run of spaces and tabs after the hashes counts.
const PREFIX_MAX = 1000;
const PREFIX = { title: /^#[ \t]+$/, heading: /^##[ \t]+$/ };
const prefixFits = (type, prefix) => (PREFIX[type] ? PREFIX[type].test(prefix) : prefix === "");
export function validAttrs(a, partial) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  const keys = Object.keys(a);
  if (!keys.length || keys.some((k) => !ATTRS.includes(k)) || (!partial && keys.length !== ATTRS.length)) return false;
  if ("type" in a && !TYPES.includes(a.type)) return false;
  if ("sep" in a && !(typeof a.sep === "string" && a.sep.length <= 400 && /^[ \t\r\n]*$/.test(a.sep))) return false;
  if ("prefix" in a && !(typeof a.prefix === "string" && a.prefix.length <= PREFIX_MAX && /^(?:#{1,2}[ \t]+)?$/.test(a.prefix))) return false;
  if ("type" in a && "prefix" in a && !prefixFits(a.type, a.prefix)) return false;
  return true;
}
/** The script after someone else's change: every marker fits its type, and blocks stay apart the way the file is
 *  read back (a blank line between blocks; only a title or heading may be followed by a single line break).
 *  With `before`, a block is checked when it is new or changed, or when the block before it is new, changed or
 *  another one (removed or moved), so a host file that already differs from these rules never blocks a guest's
 *  edits elsewhere. A separator never ends in spaces: the file would read them as the next block's text. */
export function validBlocks(blocks, before = null) {
  const key = (b, prev) => `${JSON.stringify(b.attrs)}|${prev?.id ?? ""}`;
  const old = before && new Map(before.map((b, i) => [b.id, key(b, before[i - 1])]));
  const same = (i) => !!old && old.get(blocks[i].id) === key(blocks[i], blocks[i - 1]);
  return blocks.every((b, i) => {
    if (same(i) && (i === 0 || same(i - 1))) return true;
    const { type, sep, prefix } = b.attrs || {};
    if (!validAttrs(b.attrs, false) || !prefixFits(type, prefix)) return false;
    if (i === 0) return /^(?:[ \t]*\r?\n)*$/.test(sep);
    const prev = blocks[i - 1].attrs?.type;
    return /^\r?\n(?:[ \t]*\r?\n)+$/.test(sep) || ((prev === "title" || prev === "heading") && /^\r?\n$/.test(sep));
  });
}

function scriptIO(doc) {
  const eolize = (t) => (doc.eol === "\r\n" ? t.replace(/\n/g, "\r\n") : t);
  return {
    text: (b) => D.contentOf(b),
    setText: (b, t) => { b.text = D.prefixOf(b) + eolize(t); },
    setAttrs: (b, a) => {
      const content = D.contentOf(b), prefix = a.prefix ?? D.prefixOf(b);
      if (a.type) b.type = a.type;
      if (a.sep != null) b.sep = a.sep;
      b.text = prefix + eolize(content);
    },
    make: (id, text, a) => ({ id, type: a.type, text: (a.prefix || "") + eolize(text), sep: a.sep }),
  };
}
/** Apply operations to the script document itself (D.serialize keeps working on it). */
export function applyToDoc(doc, ops, each = () => {}) {
  const io = scriptIO(doc);
  for (const op of ops) {
    each(op, op.type === "merge" ? D.contentOf(D.blockById(doc, op.into) || { text: "", type: "para" }).length : undefined);
    applyOp(doc.blocks, op, io);
  }
  return doc;
}
export const docMeta = (doc, name, broll = null) => ({ name, tail: doc.tail, eol: doc.eol, ...(broll ? { broll } : {}) });

/* ---------- Asks in a shared script (step D2, pure: no DOM) ---------- */
// The host keeps the asks: guests send theirs to the host, which checks them, adds them, hands them to its agent and
// shares every open ask (with its answer) with everyone, and every kept change that is still marked (step F). Only
// the person who asked, and the host, may Keep or Undo.
export const GUEST_ACTIONS = ["like", "simpler", "shorter", "explain", "facts", "ask", "broll"];
/** A guest's new ask as the host takes it: its quote found again in the host's script near the guest's place.
 *  Returns { blockId, start, end, action, instruction? } or null. */
export function guestAsk(doc, a) {
  if (!doc || !a || typeof a !== "object" || !GUEST_ACTIONS.includes(a.action)) return null;
  const b = typeof a.blockId === "string" ? D.blockById(doc, a.blockId) : null;
  if (!b || typeof a.quote !== "string" || !a.quote.trim() || a.quote.length > D.LIMITS.text || !Number.isInteger(a.start) || a.start < 0) return null;
  const typed = typeof a.instruction === "string" ? a.instruction.trim() : "";
  if (a.action === "ask" && (!typed || typed.length > D.LIMITS.instruction)) return null;
  if (a.action === "broll" && !B.spokenBlocks(doc).some((x) => x.id === b.id)) return null;
  const r = D.reanchor({ start: a.start, quote: a.quote }, D.contentOf(b));
  return r ? { blockId: b.id, start: r.start, end: r.end, action: a.action, ...(a.action === "ask" ? { instruction: typed } : {}) } : null;
}
/** The open asks a new ask closes where they overlap ("the newest ask wins"). The host's own ask closes any; a
 *  guest's ask (`onlyBy` = its asker id) closes only that guest's own, so nobody undoes someone else's answer. */
export function overlappingAsks(asks, { blockId, start, end }, onlyBy = null) {
  return asks.filter((a) => a.scope === "selection" && a.blockId === blockId && D.OPEN_STATUSES.includes(a.status) && a.answer?.kind !== "broll"
    && a.start < end && a.end > start && (!onlyBy || a.by?.id === onlyBy));
}
/** The host's check of a guest's Keep, Undo or dismiss: only on that guest's own open ask in the text (B-roll
 *  suggestions stay with the host), and Keep only once there is an answer. A change that went straight in can be
 *  undone while it is marked. */
export function guestMayAct(ask, act, askerId) {
  if (!ask || !askerId || ask.by?.id !== askerId || ask.scope !== "selection" || ask.answer?.kind === "broll") return false;
  if (C.isMarked(ask)) return act === "undo";
  if (!D.OPEN_STATUSES.includes(ask.status)) return false;
  if (act === "keep") return ask.status === "answered";
  return act === "undo" || act === "dismiss";
}
/** May this person Keep, Undo or cancel this ask? The person who asked, and the host. */
export const mayAct = (ask, { host = false, id = "" } = {}) => host || (!!id && ask?.by?.id === id);
/** What the host shares: the open asks and the marked changes, copied; each marked change with its exact place in
 *  the host's `doc` (C.withContext), so a guest finds that place or shows no mark. */
export const shareAsks = (asks, doc) => C.withContext(asks.filter((a) => D.OPEN_STATUSES.includes(a.status) || C.isMarked(a)), doc);
/** A guest places the host's asks in its own copy of the script: each quote is found again near its place; a
 *  marked change only at its exact place (C.place), or where this guest's own copy of it (`prev`, the asks shown
 *  now) has followed it since, while its text is there. An ask whose text is not here (yet) is left out; B-roll
 *  suggestions stay, as they live beside the lines. */
export function fitAsks(asks, doc, prev = []) {
  const out = [];
  for (const a of Array.isArray(asks) ? asks : []) {
    if (!a || typeof a.id !== "string") continue;
    if (C.isMarked(a)) {
      const change = a.change;
      if (C.place(a, doc)) { out.push(a); continue; }
      const p = prev.find((x) => x.id === a.id && C.isMarked(x) && x.change.text === change.text && x.change.at === change.at);
      const b = p && D.blockById(doc, p.blockId);
      if (b && D.contentOf(b).slice(p.start, p.end) === change.text) out.push(Object.assign(a, { change, blockId: p.blockId, start: p.start, end: p.end }));
      continue;
    }
    if (!D.OPEN_STATUSES.includes(a.status)) continue;
    if (a.scope === "selection") {
      const b = D.blockById(doc, a.blockId);
      const r = b && D.reanchor(a, D.contentOf(b));
      if (r) Object.assign(a, r);
      else if (a.answer?.kind !== "broll") continue;
    } else if (a.scope === "script" && a.answer?.kind === "marks") {
      for (const m of a.answer.marks) {
        if (m.state !== "open") continue;
        const b = D.blockById(doc, m.blockId);
        const r = b && D.reanchor(m, D.contentOf(b));
        if (r) Object.assign(m, r); else m.state = "gone";
      }
    }
    out.push(a);
  }
  return out;
}
/**
 * A guest's outbox for asks and Keep/Undo presses. Each item has a `ref` and stays until the host confirms it
 * (`ask-ack`) or refuses it (`ask-refused`); whatever was sent but not confirmed is sent again after the room was away.
 * A new ask waits until the host has all of this guest's text (`ready(true)`), so its quote is there.
 *   createOutbox({ send(msg) → bool, ready(waitForText) → bool, ref?() })
 */
export function createOutbox({ send, ready, ref = () => Math.random().toString(36).slice(2, 12) }) {
  const items = [];
  const flush = () => {
    for (const it of items) {
      if (it.sent) continue;
      if (!ready(it.wait) || !send(it.msg)) return;
      it.sent = true;
    }
  };
  return {
    items,
    push(msg, { wait = false } = {}) { const r = ref(); items.push({ ref: r, msg: { ...msg, ref: r }, wait, sent: false }); flush(); return r; },
    flush,
    /** Confirmed or refused by the host: out of the box. Returns the item. */
    done(r) { const i = items.findIndex((it) => it.ref === r); return i < 0 ? null : items.splice(i, 1)[0]; },
    /** The room was away: nothing sent is known to have arrived. */
    away() { for (const it of items) it.sent = false; },
    clear() { items.length = 0; },
  };
}
/**
 * The host's desk for guests' asks and presses (no DOM). Every message with a `ref` gets one answer, `ask-ack` or
 * `ask-refused` (with a reason), kept per ref, so a repeat (sent again after the room was away) gets the same answer
 * and is never done twice.
 *   createAskDesk({ people: () => Map pid → { asker, name }, sendTo(pid, msg), doc(), asks(), add(spec, by), act(id, act, asker) })
 */
export function createAskDesk({ people, sendTo, doc, asks, add, act }) {
  const answers = new Map(); // asker (or pid without one) → Map ref → { type, reason? }
  return function handle(msg) {
    if (typeof msg?.ref !== "string" || !msg.ref || msg.ref.length > 40) return;
    const p = people().get(msg.from);
    const who = p?.asker || `pid:${msg.from}`;
    let mine = answers.get(who);
    if (!mine) answers.set(who, (mine = new Map()));
    const send = (a) => sendTo(msg.from, { type: a.type, ref: msg.ref, ...(a.reason ? { reason: a.reason } : {}) });
    const known = mine.get(msg.ref);
    if (known) return send(known);
    const decide = () => {
      // A tab the host could not tell apart (no secret): nothing it asks or presses can be done.
      if (!p?.asker) return { type: "ask-refused", reason: "unknown" };
      const by = { id: p.asker, name: p.name };
      if (msg.ask) {
        const spec = guestAsk(doc(), msg.ask);
        if (!spec) return { type: "ask-refused", reason: "changed" };
        // Someone else's open ask or answer on this text stays as it is, so this one can't go there too.
        if (overlappingAsks(asks(), spec).some((a) => a.by?.id !== by.id)) return { type: "ask-refused", reason: "taken" };
        add(spec, by);
      } else if (typeof msg.id === "string" && ["keep", "undo", "dismiss"].includes(msg.act)) act(msg.id, msg.act, by.id);
      return { type: "ask-ack" };
    };
    const answer = decide();
    if (mine.size >= 500) mine.delete(mine.keys().next().value);
    mine.set(msg.ref, answer);
    send(answer);
  };
}
/** The agent's caret, from the asks: at the end of the asked text while the agent works on it; else at the end of
 *  its newest change that went straight in and is still marked (step F), where its name tag offers Undo to those
 *  who `may(ask)`; else at a note while it shows. Gone when none is left. The newest such ask wins. It is named and
 *  drawn as its model ("Claude" with Claude's logo; agent-brand.js), so guests work out the same from the shared
 *  asks. `askId` says which ask the caret's Undo is for. */
export function agentCaret(asks, doc, may = () => false) {
  const sel = asks.filter((a) => a.scope === "selection" && D.blockById(doc, a.blockId));
  const marked = C.newestMarked(sel);
  const a = sel.filter((x) => x.status === "taken").at(-1) || marked || sel.filter((x) => x.status === "answered" && x.answer && x.answer.kind !== "broll").at(-1);
  if (!a) return null;
  const { name, icon } = agentBrand(String((a.status === "taken" ? a.takenBy : a.answeredBy)?.name || "").slice(0, 200));
  const undo = a === marked && !!may(a);
  return { pid: "agent", kind: "agent", name, icon, colour: null, blockId: a.blockId, offset: a === marked ? C.markRange(a).end : a.end, undo, askId: a.id };
}
export function docFromSnapshot({ blocks, meta }) {
  const doc = { blocks: [], tail: typeof meta?.tail === "string" && /^\s{0,200}$/.test(meta.tail) ? meta.tail : "\n", eol: meta?.eol === "\r\n" ? "\r\n" : "\n" };
  const make = scriptIO(doc).make;
  doc.blocks = (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b && typeof b.id === "string" && typeof b.text === "string" && validAttrs(b.attrs, false))
    .map((b) => make(b.id, b.text.replace(/\r/g, ""), b.attrs));
  return doc;
}

/* ---------- The app side ---------- */
/**
 * createTogether(app): app = { doc(), name(), me, held(), selection(), restore(sel), element(id), applied(ops, sel),
 *   loadGuest(doc, name, broll), guestEnded(status), joinFailed(status), sharing(on), renderTop(), renderDots(),
 *   asks(), setRoomAsks(asks), guestAsk(spec, by), guestAct(id, act, askerId), askRefused(ask), brollShare(),
 *   setRoomBroll(b), undoAgent(askId), sheet, scriptEl, icon(name) }
 */
/** The script editor's adapter for RoomClient (no DOM of its own: everything goes through `app`). */
export function scriptAdapter(app, { busy = () => false } = {}) {
  return {
    read: () => readBlocks(app.doc()),
    meta: () => docMeta(app.doc(), app.name(), app.brollShare()),
    load: (snap) => app.loadGuest(docFromSnapshot(snap), String(snap.meta?.name || "script.md").slice(0, 120), snap.meta?.broll ?? null),
    caret: () => { const s = app.selection(); return s ? { blockId: s.id, offset: s.focus } : null; },
    held: () => app.held(),
    busy,
    validAttrs,
    validBlocks,
    apply(ops) {
      const doc = app.doc();
      if (!doc) return;
      let sel = app.selection();
      applyToDoc(doc, ops, (op, joinAt) => {
        if (!sel) return;
        const f = movePoint({ blockId: sel.id, offset: sel.focus }, op, { joinAt });
        const a = movePoint({ blockId: sel.id, offset: sel.anchor }, op, { joinAt });
        sel = f ? { ...sel, id: f.blockId, focus: f.offset, anchor: a && a.blockId === f.blockId ? a.offset : f.offset } : null;
      });
      app.applied(ops, sel);
    },
  };
}
export function createTogether(app) {
  let room = null, composing = false, last = "", shared = { asks: "", broll: "" };
  const $ = (s) => document.querySelector(s);
  const wsUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/room`;
  const isGuest = () => room?.role === "guest";
  // My asker id: the host's own id, or the opaque id the host gave this guest tab.
  const myId = () => (isGuest() ? room.asker : app.me.id);
  // A guest's asks and presses stay until the host confirms them; a new ask waits until the host has all my text.
  const outbox = createOutbox({ send: (m) => !!room?.send(m), ready: (wait) => room?.status === "live" && (!wait || room.settled()) });
  const agent = () => (app.doc() ? agentCaret(app.asks(), app.doc(), (a) => mayAct(a, { host: !isGuest(), id: myId() })) : null);
  const caretList = () => [...(room ? room.caretList() : []), ...[agent()].filter(Boolean)];
  const carets = createCarets({
    container: app.sheet,
    element: (id) => app.element(id),
    // The agent's Undo is the app's (its marked change, alone or shared); people's go through the room.
    onUndo: (pid) => (pid === "agent" ? app.undoAgent(agent()?.askId) : room?.undoFor(pid)),
    icon: (n) => app.icon(n),
  });

  app.scriptEl.addEventListener("compositionstart", () => { composing = true; });
  app.scriptEl.addEventListener("compositionend", () => { composing = false; queueMicrotask(() => room?.resume()); });

  const adapter = scriptAdapter(app, { busy: () => composing });

  // What the host shares besides the text: the open asks and the B-roll list, each sent again only when it changed.
  const asksMsg = () => ({ type: "asks", asks: shareAsks(app.asks(), app.doc()) });
  const brollMsg = () => ({ type: "broll", broll: app.brollShare() });
  function sync() {
    if (!room || room.role !== "host" || room.stopped) return;
    const a = asksMsg(), b = brollMsg();
    // Sent again only when what guests use changed: a mark's place index (for drafts) is left out of the comparison.
    const as = JSON.stringify(a.asks, (k, v) => (k === "ctx" && v ? { ...v, index: undefined } : v)), bs = JSON.stringify(b.broll);
    if (as !== shared.asks) { shared.asks = as; room.sendAll(a); }
    if (bs !== shared.broll) { shared.broll = bs; room.sendAll(b); }
  }
  // Host: a guest's ask or press, answered to that guest by its ref (a repeat gets the same answer).
  const fromGuest = createAskDesk({
    people: () => room.people,
    sendTo: (pid, m) => room.sendTo(pid, m),
    doc: () => app.doc(),
    asks: () => app.asks(),
    add: (spec, by) => app.guestAsk(spec, by),
    act: (id, act, asker) => app.guestAct(id, act, asker),
  });


  const on = {
    status(s) {
      if (s === "ended" || s === "refused" || s === "full") {
        if (room?.role === "guest") { if (room.synced) app.guestEnded(s); else app.joinFailed(s); }
        else { share.set(false); app.sharing(false); }
        room = null;
        outbox.clear();
      }
      if (s === "away") outbox.away();
      if (s === "live") outbox.flush();
      render();
    },
    people: () => render(),
    carets: () => { carets.set(caretList()); app.renderDots(); renderPeople(); },
    joined: (pid) => { room.sendTo(pid, asksMsg()); room.sendTo(pid, brollMsg()); },
    settled: () => outbox.flush(),
    message(msg) {
      if (room?.role === "host" && msg.type === "ask") fromGuest(msg);
      else if (isGuest() && msg.type === "ask-ack") outbox.done(msg.ref);
      else if (isGuest() && msg.type === "ask-refused") {
        const it = outbox.done(msg.ref);
        if (it?.msg.ask) app.askRefused(it.msg.ask, msg.reason === "taken" ? "taken" : "changed");
      } else if (isGuest() && msg.type === "asks" && app.doc()) {
        app.setRoomAsks(fitAsks(msg.asks, app.doc(), app.asks()));
        render();
      } else if (isGuest() && msg.type === "broll") {
        app.setRoomBroll(msg.broll);
      }
    },
  };

  /* Share to edit (host) */
  const share = createShareButton({
    button: $("#shareBtn"), stop: $("#stopShare"), iconSlot: $("#shareIcon"), label: $("#shareLabel"),
    icons: { share: app.icon("share"), link: app.icon("link"), check: app.icon("check") },
    share: () => {
      if (!app.doc()) return null;
      if (!room) {
        const name = app.me.name && app.me.name !== "You" ? app.me.name : "Host";
        shared = { asks: "", broll: "" };
        room = new RoomClient({ role: "host", ...newRoom(), url: wsUrl(), name, adapter, on }).start();
        app.sharing(true);
        render();
      }
      return room.link(location.origin);
    },
    end: () => { room?.stop(); },
    fallback: (link) => {
      const box = $("#shareLink");
      box.value = link;
      $("#shareMenu").showPopover();
      box.focus();
      box.select();
    },
  });

  /* People in the top bar: you, then the others (and the agent while it has a caret). Clicking one scrolls to their caret. */
  function renderPeople() {
    const el = $("#people");
    const a = room ? agent() : null;
    const list = [...(room?.peopleList() || []), ...(a ? [{ pid: "agent", name: a.name, icon: a.icon, kind: "agent", colour: null, me: false }] : [])];
    el.hidden = list.length < 2;
    const has = (pid) => pid === "agent" || !!room?.carets.has(pid);
    const sig = JSON.stringify(list.map((p) => [p.pid, p.name, p.icon, p.colour, p.me, has(p.pid)]));
    if (sig === last) return;
    const had = new Set([...el.children].map((c) => c.dataset.who));
    last = sig;
    const others = list.length - 1;
    const more = document.createElement("span");
    more.className = "people__more";
    more.textContent = `+${others - 2}`;
    more.title = list.filter((p) => !p.me).slice(2).map((p) => p.name).join(", ");
    more.setAttribute("aria-label", `${others - 2} more: ${more.title}`);
    el.replaceChildren(...[...list].sort((x, y) => y.me - x.me).map((p) => {
      const b = document.createElement(p.me ? "span" : "button");
      b.className = p.me ? "avatar avatar--me" : "avatar";
      if (p.kind === "agent") b.innerHTML = app.icon(p.icon || "agent");
      else b.textContent = Array.from(p.name.trim() || "?")[0].toUpperCase();
      b.title = p.me ? `${p.name} (you)` : p.name;
      if (!p.me) {
        b.type = "button";
        b.dataset.who = p.pid;
        b.style.setProperty("--c", colourVar(p));
        b.setAttribute("aria-label", `Go to ${p.name}`);
        b.disabled = !has(p.pid);
        if (had.size && !had.has(p.pid)) b.dataset.new = "";
      }
      return b;
    }), ...(others > 2 ? [more] : []));
  }
  $("#people").addEventListener("click", (e) => {
    const a = e.target.closest("button[data-who]");
    if (a) carets.focus(a.dataset.who, !matchMedia("(prefers-reduced-motion: reduce)").matches);
  });
  $("#people").addEventListener("animationend", (e) => delete e.target.dataset.new);

  function render() {
    renderPeople();
    carets.set(caretList());
    app.renderTop();
    app.renderDots();
  }

  return {
    get active() { return !!room && !room.stopped; },
    get guest() { return isGuest(); },
    get room() { return room; },
    get outbox() { return outbox.items; },
    /** Guest: join the room in the link with a name. */
    join(link, name) {
      room?.stop();
      room = new RoomClient({ role: "guest", ...link, url: wsUrl(), name, adapter, on }).start();
      return room;
    },
    /** Host: stop sharing (opening another script, for example). */
    stop() { if (room && room.role === "host") { room.stop(); share.set(false); } },
    /** After every change: the text goes to the room, and the host shares its asks and B-roll when they changed. */
    local() { room?.local(); sync(); },
    /** Host: the change just made is the agent's (an answer that went straight in, or its Undo): it goes to the room
     *  under the agent's name, so nobody's own Undo takes it back. */
    localAs(by) { room?.localAs(by); sync(); },
    sync,
    caret() {
      if (!room || room.stopped) return;
      const s = app.selection();
      if (s) room.caret({ blockId: s.id, offset: s.focus, selEnd: s.anchor });
    },
    /** Ctrl/Cmd+Z in a room undoes only your own changes. */
    undo() { return room?.undoMine() ?? false; },
    /** Redraw the carets (people's and the agent's) after the script re-rendered or the asks changed. */
    redraw() { carets.set(caretList()); if (room) renderPeople(); },
    /** May I Keep, Undo or cancel this ask? */
    may: (ask) => mayAct(ask, { host: !isGuest(), id: myId() }),
    /** Guest: a new ask for the host, or Keep / Undo / dismiss on my own ask. */
    ask: (spec) => outbox.push({ type: "ask", ask: spec }, { wait: true }),
    act: (id, act) => outbox.push({ type: "ask", id, act }),
    /** Coloured dots for the people (and the agent) whose caret is in these blocks (the section list). */
    dots(ids) {
      const list = room ? caretList() : [];
      return list.filter((c) => ids.has(c.blockId)).map((c) => `<span class="pdot pdot--person" style="--c: ${colourVar(c)}" title="${String(c.name).replace(/[&<>"']/g, "")}"></span>`).join("");
    },
    /** Show the share button only to the host's side, with a script open. */
    renderShare(open, guest) { $("#share").hidden = !open || guest; },
  };
}
