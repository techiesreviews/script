// The script editor's side of working together (step D). It turns the script into blocks for the room and back,
// and wires Share to edit, joining with a name, the people in the top bar and other people's carets.
// The room itself (public/together/) knows nothing about scripts; see docs/together.md.
import * as D from "./doc.js";
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

// The "# " / "## " marker belongs to its type: titles have "#", headings "##", every other block none.
const PREFIX = { title: /^#[ \t]{1,8}$/, heading: /^##[ \t]{1,8}$/ };
const prefixFits = (type, prefix) => (PREFIX[type] ? PREFIX[type].test(prefix) : prefix === "");
export function validAttrs(a, partial) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  const keys = Object.keys(a);
  if (!keys.length || keys.some((k) => !ATTRS.includes(k)) || (!partial && keys.length !== ATTRS.length)) return false;
  if ("type" in a && !TYPES.includes(a.type)) return false;
  if ("sep" in a && !(typeof a.sep === "string" && a.sep.length <= 400 && /^[ \t\r\n]*$/.test(a.sep))) return false;
  if ("prefix" in a && !(typeof a.prefix === "string" && /^(?:#{1,2}[ \t]{1,8})?$/.test(a.prefix))) return false;
  if ("type" in a && "prefix" in a && !prefixFits(a.type, a.prefix)) return false;
  return true;
}
/** The script after someone else's change: every marker fits its type, and blocks stay apart the way the file is
 *  read back (a blank line between blocks; only a title or heading may be followed by a single line break).
 *  With `before`, only blocks whose attrs are new or changed are checked, so a host file that already differs
 *  from these rules never blocks a guest's ordinary edits. */
export function validBlocks(blocks, before = null) {
  const old = before && new Map(before.map((b) => [b.id, JSON.stringify(b.attrs)]));
  return blocks.every((b, i) => {
    if (old && old.get(b.id) === JSON.stringify(b.attrs)) return true;
    const { type, sep, prefix } = b.attrs || {};
    if (!validAttrs(b.attrs, false) || !prefixFits(type, prefix)) return false;
    if (i === 0) return /^(?:[ \t]*\r?\n)*$/.test(sep);
    const prev = blocks[i - 1].attrs?.type;
    return /^\r?\n(?:[ \t]*\r?\n)+[ \t]*$/.test(sep) || ((prev === "title" || prev === "heading") && /^\r?\n$/.test(sep));
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
export const docMeta = (doc, name) => ({ name, tail: doc.tail, eol: doc.eol });
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
 * createTogether(app): app = { doc(), name(), me, setName(name), held(), selection(), restore(sel), element(id),
 *   applied(ops, sel), loadGuest(doc, name), guestEnded(status), joinFailed(status), sharing(on), renderTop(), renderDots(),
 *   sheet, scriptEl, icon(name) }
 */
export function createTogether(app) {
  let room = null, composing = false, last = "";
  const $ = (s) => document.querySelector(s);
  const wsUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/room`;
  const carets = createCarets({
    container: app.sheet,
    element: (id) => app.element(id),
    onUndo: (pid) => room?.undoFor(pid),
    icon: (n) => app.icon(n === "agent" ? "plug" : n),
  });

  app.scriptEl.addEventListener("compositionstart", () => { composing = true; });
  app.scriptEl.addEventListener("compositionend", () => { composing = false; queueMicrotask(() => room?.resume()); });

  const adapter = {
    read: () => readBlocks(app.doc()),
    meta: () => docMeta(app.doc(), app.name()),
    load: (snap) => app.loadGuest(docFromSnapshot(snap), String(snap.meta?.name || "script.md").slice(0, 120)),
    caret: () => { const s = app.selection(); return s ? { blockId: s.id, offset: s.focus } : null; },
    held: () => app.held(),
    busy: () => composing,
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

  const on = {
    status(s) {
      if (s === "ended" || s === "refused" || s === "full") {
        if (room?.role === "guest") { if (room.synced) app.guestEnded(s); else app.joinFailed(s); }
        else { share.set(false); app.sharing(false); }
        room = null;
      }
      render();
    },
    people: () => render(),
    carets: () => { carets.set(room ? room.caretList() : []); app.renderDots(); renderPeople(); },
  };

  /* Share to edit (host) */
  const share = createShareButton({
    button: $("#shareBtn"), stop: $("#stopShare"), iconSlot: $("#shareIcon"), label: $("#shareLabel"),
    icons: { share: app.icon("share"), link: app.icon("link"), check: app.icon("check") },
    share: () => {
      if (!app.doc()) return null;
      if (!room) {
        const name = app.me.name && app.me.name !== "You" ? app.me.name : "Host";
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

  /* People in the top bar: you, then the others. Clicking one scrolls to their caret. */
  function renderPeople() {
    const el = $("#people");
    const list = room?.peopleList() || [];
    el.hidden = list.length < 2;
    const sig = JSON.stringify(list.map((p) => [p.pid, p.name, p.colour, p.me, room?.carets.has(p.pid)]));
    if (sig === last) return;
    const had = new Set([...el.children].map((c) => c.dataset.who));
    last = sig;
    const others = list.length - 1;
    const more = document.createElement("span");
    more.className = "people__more";
    more.textContent = `+${others - 2}`;
    more.title = list.filter((p) => !p.me).slice(2).map((p) => p.name).join(", ");
    el.replaceChildren(...[...list].sort((a, b) => b.me - a.me).map((p) => {
      const a = document.createElement(p.me ? "span" : "button");
      a.className = p.me ? "avatar avatar--me" : "avatar";
      a.textContent = Array.from(p.name.trim() || "?")[0].toUpperCase();
      a.title = p.me ? `${p.name} (you)` : p.name;
      if (!p.me) {
        a.type = "button";
        a.dataset.who = p.pid;
        a.style.setProperty("--c", colourVar(p));
        a.setAttribute("aria-label", `Go to ${p.name}`);
        a.disabled = !room?.carets.has(p.pid);
        if (had.size && !had.has(p.pid)) a.dataset.new = "";
      }
      return a;
    }), ...(others > 2 ? [more] : []));
  }
  $("#people").addEventListener("click", (e) => {
    const a = e.target.closest("button[data-who]");
    if (a) carets.focus(a.dataset.who, !matchMedia("(prefers-reduced-motion: reduce)").matches);
  });
  $("#people").addEventListener("animationend", (e) => delete e.target.dataset.new);

  function render() {
    renderPeople();
    carets.set(room ? room.caretList() : []);
    app.renderTop();
    app.renderDots();
  }

  return {
    get active() { return !!room && !room.stopped; },
    get guest() { return room?.role === "guest"; },
    get room() { return room; },
    /** Guest: join the room in the link with a name. */
    join(link, name) {
      room?.stop();
      room = new RoomClient({ role: "guest", ...link, url: wsUrl(), name, adapter, on }).start();
      return room;
    },
    /** Host: stop sharing (opening another script, for example). */
    stop() { if (room && room.role === "host") { room.stop(); share.set(false); } },
    local() { room?.local(); },
    caret() {
      if (!room || room.stopped) return;
      const s = app.selection();
      if (s) room.caret({ blockId: s.id, offset: s.focus, selEnd: s.anchor });
    },
    /** Ctrl/Cmd+Z in a room undoes only your own changes. */
    undo() { return room?.undoMine() ?? false; },
    redraw() { carets.draw(); },
    /** Coloured dots for the people whose caret is in these blocks (the section list). */
    dots(ids) {
      if (!room) return "";
      return room.caretList().filter((c) => ids.has(c.blockId)).map((c) => `<span class="pdot pdot--person" style="--c: ${colourVar(c)}" title="${String(c.name).replace(/[&<>"']/g, "")}"></span>`).join("");
    },
    /** Show the share button only to the host's side, with a script open. */
    renderShare(open, guest) { $("#share").hidden = !open || guest; },
  };
}
