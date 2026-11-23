// Scripts kept aside retain their document, asks and undo steps while the agent works elsewhere.
// This module changes those records only; the app owns their files and display.
import * as Doc from "./doc.js";
import * as Changes from "./changes.js";

/** Asks a script kept aside answers itself: on selected words, not B-roll. A whole-script job waits for its script. */
export const takesAnswer = (a) => !!a && a.scope === "selection" && a.action !== "broll";
export const isWorking = (a) => takesAnswer(a) && (a.status === "waiting" || a.status === "taken");
const isBrollAnswer = (a) => a.status === "answered" && a.answer?.kind === "broll";

/** The script being left, kept aside while its agent works in it or it holds a change the person has not seen
 *  (`unseen`: ask ids); else null. Only a script in a file can take an answer while it is not open. */
export function leave({ handle, name, browser = false, doc, asks, undo, redo, savedText, fileModified, place = null, unseen = [] }) {
  if (!handle) return null;
  const s = { handle, name, browser: !!browser, doc, asks, undo, redo, savedText, fileModified, place, unseen: new Set(unseen) };
  return s.asks.some(isWorking) || s.unseen.size ? s : null;
}

/** "working" while the agent works on an ask there, then "done" until its change has been seen, else "". */
export const status = (s) => (s.asks.some(isWorking) ? "working" : s.unseen.size ? "done" : "");

export function findAsk(asides, id) {
  for (const aside of asides) {
    const ask = aside.asks.find((a) => a.id === id);
    if (ask) return { aside, ask };
  }
  return null;
}

/** The asks in the scripts kept aside that the agent has not seen yet; a taken ask comes back after `retakeMs`. */
export function pending(asides, now, retakeMs) {
  const out = [];
  for (const aside of asides) {
    for (const ask of aside.asks) {
      if (!isWorking(ask)) continue;
      if (ask.status === "waiting" || now - Date.parse(ask.takenAt || 0) > retakeMs) out.push({ aside, ask });
    }
  }
  return out;
}

/** The unseen change nearest the top of the script: where it opens from the menu. */
export function firstUnseen(s) {
  let best = null, bestAt = Infinity;
  for (const id of s.unseen) {
    const a = s.asks.find((x) => x.id === id);
    const at = a ? s.doc.blocks.findIndex((b) => b.id === a.blockId) * 1e6 + (a.start || 0) : -1;
    if (at >= 0 && at < bestAt) { best = id; bestAt = at; }
  }
  return best;
}

// Open asks in a block follow its text again, as in the open script (app.js reanchorBlock); one whose text is gone ends.
function reanchorBlock(s, id) {
  const b = Doc.blockById(s.doc, id);
  for (const a of s.asks) {
    if (a.scope !== "selection" || a.blockId !== id || !Doc.OPEN_STATUSES.includes(a.status) || isBrollAnswer(a)) continue;
    const r = b && Doc.reanchor(a, Doc.contentOf(b));
    if (!r) a.status = "cancelled";
    else { a.start = r.start; a.end = r.end; }
  }
}
// After setContent split or retyped a block: anchors move into the blocks their text went to (app.js followPieces).
function followPieces(s, id, r) {
  for (let i = r.pieces.length - 1; i >= 0; i--) {
    const p = r.pieces[i];
    if (i > 0) Doc.moveAsks(s.asks, id, p.id, p.start, -(p.start + p.prefix));
    else if (p.start + p.prefix) Doc.moveAsks(s.asks, id, id, 0, -(p.start + p.prefix));
  }
  for (const p of r.pieces) reanchorBlock(s, p.id);
}

/**
 * The agent's answer to an ask in a script kept aside, checked like any answer (Doc.checkAnswer gives `clean`).
 * A replace or add goes straight into its text as one undo step, lightly marked; a note waits beside its text.
 * Returns { ok: true, landed, cuesDropped } or { ok: false } when the asked text is gone (the ask is cancelled).
 */
export function answer(s, ask, clean, by, now = Date.now(), { undoLimit = 300 } = {}) {
  const b = Doc.blockById(s.doc, ask.blockId);
  const r = b && Doc.reanchor(ask, Doc.contentOf(b));
  if (!r) { ask.status = "cancelled"; return { ok: false }; }
  ask.start = r.start; ask.end = r.end;
  ask.answer = clean;
  ask.answeredBy = by;
  ask.status = "answered";
  if (!Changes.goesStraightIn(ask, clean)) { s.unseen.add(ask.id); return { ok: true, landed: false, cuesDropped: 0 }; }
  const before = Doc.cloneDoc(s.doc), base = Changes.blocksOf(s.doc);
  const res = Changes.land(s.doc, ask, now, { asks: s.asks });
  if (!res) { ask.status = "cancelled"; return { ok: false }; }
  // One Ctrl/Cmd+Z step once the person is back; undoing it makes the ask undone again (app.js restore).
  s.undo.push({ doc: before, caret: null, land: { id: ask.id, status: "undone" } });
  if (s.undo.length > undoLimit) s.undo.shift();
  s.redo = [];
  Doc.moveAsks(s.asks, res.blockId, res.blockId, res.at, res.delta);
  followPieces(s, res.blockId, res.result);
  Changes.follow(s.asks, base, Changes.blocksOf(s.doc)); // the agent's earlier changes follow this one
  Changes.setMark(ask, res.mark);
  s.unseen.add(ask.id);
  return { ok: true, landed: true, cuesDropped: res.cuesDropped || 0 };
}

/** Where the caret was, by line and offset: block ids are new each time a script is read from its file. */
export function caretPlace(doc, caret) {
  const index = caret && doc ? doc.blocks.findIndex((b) => b.id === caret.id) : -1;
  return index < 0 ? null : { index, offset: caret.offset };
}
export function caretAt(doc, place) {
  const b = place && doc?.blocks[place.index];
  return b ? { id: b.id, offset: Math.max(0, Math.min(place.offset, Doc.contentOf(b).length)) } : null;
}
