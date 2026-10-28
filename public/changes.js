// The agent's answers go straight into the text (step F, Lex 2026-10-28). A "replace" or "add" answer on a selection
// is applied at once; the ask becomes `kept` and keeps its change, lightly marked, while the changed text is untouched:
//   ask.start/end  the changed text in its block (content offsets), ask.change = { text, removed, at }
// Undo puts `removed` back in place of `text` (only while the text is exactly there) and makes the ask `undone`.
// Pure: no DOM. The editor (app.js) calls these and draws the mark; the room carries the text like any change.
import * as D from "./doc.js";
import { diff, movePoint } from "./together/ops.js";

export const STRAIGHT_IN = ["replace", "add"];
/** A kept answer whose change is still marked (its text untouched since it went in). */
export const isMarked = (a) => !!a && a.scope === "selection" && a.status === "kept" && !!a.change && typeof a.change.text === "string";
/** Does this answer go straight into the text? */
export const goesStraightIn = (ask, answer) => ask?.scope === "selection" && STRAIGHT_IN.includes(answer?.kind);

/** The script as { id, text, attrs } for following marks (content, like asks and carets). */
export const blocksOf = (doc) => doc.blocks.map((b) => ({ id: b.id, text: D.contentOf(b), attrs: { type: b.type } }));

/**
 * Apply an answered ask's replace or add to the document, as one change, on its quote found again near its place
 * (null, and nothing changes, when the quote is gone). Returns { blockId, at, delta, result, mark } (result:
 * D.setContent's, for following splits) and sets the ask `kept`. When the change stays inside its block (no new
 * paragraphs, the same type), `mark` is { start, end, change: { text, removed, at: now } } for `setMark` (after the
 * other marks followed this change); otherwise it is null and the change goes in unmarked.
 */
export function land(doc, ask, now = Date.now()) {
  const b = D.blockById(doc, ask.blockId);
  if (!b || !goesStraightIn(ask, ask.answer)) return null;
  const content = D.contentOf(b), type = b.type;
  // The quote must still be there (found again near its place); otherwise nothing changes.
  const r = D.reanchor(ask, content);
  if (!r) return null;
  Object.assign(ask, r);
  const res = D.applyAnswer(content, ask);
  // The whole changed stretch: for "add" that includes the spaces put around the text, so Undo removes them too.
  const from = ask.answer.kind === "add" ? ask.end : ask.start;
  const to = from + res.content.length - content.length + (ask.answer.kind === "add" ? 0 : ask.end - ask.start);
  const removed = content.slice(from, ask.answer.kind === "add" ? from : ask.end);
  const at = ask.end, delta = res.content.length - content.length;
  ask.status = "kept";
  const result = D.setContent(doc, b.id, res.content);
  const inPlace = !result.changed && !result.created.length && b.type === type && D.contentOf(b) === res.content;
  const mark = inPlace ? { start: from, end: to, change: { text: res.content.slice(from, to), removed, at: now } } : null;
  return { blockId: b.id, at, delta, result, mark };
}
export function setMark(ask, mark) {
  if (!mark) return;
  ask.start = mark.start;
  ask.end = mark.end;
  ask.change = mark.change;
}

/** Undo a marked change: its text goes back to what was there. Returns { blockId, at, delta } or null when the
 *  change is no longer exactly there (then it is no longer marked either). The ask becomes `undone`. */
export function undo(doc, ask) {
  if (!isMarked(ask)) return null;
  const b = D.blockById(doc, ask.blockId);
  const content = b ? D.contentOf(b) : "";
  if (!b || content.slice(ask.start, ask.end) !== ask.change.text) { delete ask.change; return null; }
  const { removed } = ask.change;
  D.setContent(doc, b.id, content.slice(0, ask.start) + removed + content.slice(ask.end));
  const out = { blockId: b.id, at: ask.end, delta: removed.length - (ask.end - ask.start) };
  ask.status = "undone";
  ask.end = ask.start + removed.length;
  delete ask.change;
  return out;
}

/** Text typed right before or after a mark stays outside it; an edit inside it, or a gone block, ends it. */
function followOne(ask, ops) {
  let s = { blockId: ask.blockId, offset: ask.start }, e = { blockId: ask.blockId, offset: ask.end };
  for (const op of ops) {
    s = movePoint(s, op, { right: true });
    e = movePoint(e, op);
    if (!s || !e || s.blockId !== e.blockId || e.offset < s.offset) return null;
  }
  return { blockId: s.blockId, start: s.offset, end: e.offset };
}
/**
 * Marks follow the script from `before` to `after` (both from blocksOf). A mark whose text is no longer exactly
 * there loses its mark (the ask stays kept). `ops` (the operations from before to after, when known: a room's) or
 * `caret` ({ blockId, offset } after the edit) say where an edit that reads more than one way really happened.
 * Returns the ids of the blocks whose marks moved or went, to redraw.
 */
export function follow(asks, before, after, { caret = null, ops = null } = {}) {
  const marked = asks.filter(isMarked);
  const touched = new Set();
  if (!marked.length || !before) return touched;
  ops ||= diff(before, after, caret);
  if (!ops.length) return touched;
  const text = new Map(after.map((b) => [b.id, b.text]));
  for (const a of marked) {
    const p = followOne(a, ops);
    const ok = p && (text.get(p.blockId) ?? "").slice(p.start, p.end) === a.change.text;
    if (ok && p.blockId === a.blockId && p.start === a.start) continue;
    touched.add(a.blockId);
    if (ok) { Object.assign(a, p); touched.add(p.blockId); } else delete a.change;
  }
  return touched;
}

/** Place a marked change in another copy of the script (a guest's, or after a reload): its text, found again near
 *  its place. Returns false when the text is not there (the ask then shows no mark). */
export function place(ask, doc) {
  if (!isMarked(ask)) return false;
  const near = D.blockById(doc, ask.blockId) ? { blockId: ask.blockId, start: ask.start } : null;
  const hit = D.findQuote(doc, ask.change.text, near);
  if (!hit) { delete ask.change; return false; }
  Object.assign(ask, hit);
  return true;
}

/** The newest marked change (the agent's caret sits there and its name tag offers Undo). */
export function newestMarked(asks, doc = null) {
  let best = null;
  for (const a of asks) if (isMarked(a) && (!doc || D.blockById(doc, a.blockId)) && (!best || (a.change.at || 0) >= (best.change.at || 0))) best = a;
  return best;
}
/** The mark as drawn: without the spaces at its ends. */
export function markRange(ask) {
  const t = ask.change.text;
  const lead = t.length - t.trimStart().length, trail = t.length - t.trimEnd().length;
  return { start: ask.start + lead, end: Math.max(ask.start + lead, ask.end - trail) };
}
