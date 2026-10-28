// The agent's answers go straight into the text (step F, Lex 2026-10-28). A "replace" or "add" answer on a selection
// is applied at once; the ask becomes `kept` and keeps its change, lightly marked, while the changed text is untouched:
//   ask.start/end  the changed text in its block (content offsets), ask.change = { text, removed, at, ctx? }
// Undo puts `removed` back in place of `text` (only while the text is exactly there) and makes the ask `undone`.
// The change stays inside its block: blank lines in the answer are already one space (D.cleanAnswer), and a text
// that would turn the block into another kind (a "## " at its start, brackets around it) goes in on one line,
// without the marks at its start (and a "]" at its end). An answer that still can't keep the type is refused.
// Kept with a draft or shared with guests, a change carries ctx = { index, before, after }: its block's place and
// up to CTX characters around it. It is placed again only where that matches exactly; otherwise it shows no mark.
// Pure: no DOM. The editor (app.js) calls these and draws the mark; the room carries the text like any change.
import * as D from "./doc.js";
import { diff, movePoint } from "./together/ops.js";

export const STRAIGHT_IN = ["replace", "add"];
/** A kept answer whose change is still marked (its text untouched since it went in). */
export const isMarked = (a) => !!a && a.scope === "selection" && a.status === "kept" && !!a.change && typeof a.change.text === "string" && a.change.text.trim() !== "";
/** Does this answer go straight into the text? */
export const goesStraightIn = (ask, answer) => ask?.scope === "selection" && STRAIGHT_IN.includes(answer?.kind);

/** The script as { id, text, attrs } for following marks (content, like asks and carets). */
export const blocksOf = (doc) => doc.blocks.map((b) => ({ id: b.id, text: D.contentOf(b), attrs: { type: b.type } }));

// Does this content still read as one block of this type (as parse() would read it)?
function keepsType(content, type) {
  if (type === "title" || type === "heading") return !content.includes("\n");
  const p = D.parse(content);
  return p.blocks.length <= 1 && (p.blocks[0]?.type ?? "para") === type;
}
// Marks at the start of a text that make a block a heading, the title, a list, a quote, a table, a fence, a rule, a
// note or HTML: "#", "- ", "1. ", ">", "|", "`", "~", "[", "<", "*", "+", "_".
const LEAD_MARKS = /^\s*(?:(?:#{1,6}|[-*+_>|`~[<]|\d+[.)])\s*)+/;
/**
 * The answer's text as it goes in, so that its block keeps its type (null when it can't): as sent when that fits;
 * otherwise on one line, without the marks at its start and a "]" at its end. In a heading or the title it is
 * always on one line.
 */
export function fitText(content, ask, type) {
  let text = ask.answer.text;
  if (type === "title" || type === "heading") text = text.replace(/\s*\n\s*/g, " ");
  const ok = (t) => keepsType(D.applyAnswer(content, { ...ask, answer: { ...ask.answer, text: t } }).content, type);
  if (ok(text)) return text;
  text = text.replace(/\s*\n\s*/g, " ").replace(LEAD_MARKS, "").replace(/\]\s*$/, "");
  return text.trim() && ok(text) ? text : null;
}
/** Does this answer fit its ask's block without changing its type (for the agent's answer_ask)? */
export function fits(doc, ask, answer) {
  if (!goesStraightIn(ask, answer)) return true;
  const b = D.blockById(doc, ask.blockId);
  const r = b && D.reanchor(ask, D.contentOf(b));
  return !r || fitText(D.contentOf(b), { ...ask, ...r, answer }, b.type) !== null;
}
/** What the tab tells the agent after answer_ask, per kind. */
export function answerResult(kind) {
  if (kind === "note") return "Shown to the person.";
  if (kind === "marks") return "Shown to the person. They choose Keep or Undo.";
  return "Done: the change is in the text now. The person can undo it.";
}

/**
 * Apply an answered ask's replace or add to the document, as one change, on its quote found again near its place
 * (null, and nothing changes, when the quote is gone). Returns { blockId, at, delta, result, mark } (result:
 * D.setContent's, for following splits) and sets the ask `kept`. When the change stays inside its block (no new
 * paragraphs, the same type), `mark` is { start, end, change: { text, removed, at: now } } for `setMark` (after the
 * other marks followed this change); otherwise (a safety net: fitText keeps it so) it is null and the change goes
 * in unmarked. A change of only spaces is not marked.
 */
export function land(doc, ask, now = Date.now()) {
  const b = D.blockById(doc, ask.blockId);
  if (!b || !goesStraightIn(ask, ask.answer)) return null;
  const content = D.contentOf(b), type = b.type;
  // The quote must still be there (found again near its place); otherwise nothing changes.
  const r = D.reanchor(ask, content);
  if (!r) return null;
  Object.assign(ask, r);
  const text = fitText(content, ask, type);
  if (text === null) return null;
  ask.answer = { ...ask.answer, text };
  const res = D.applyAnswer(content, ask);
  // The whole changed stretch: for "add" that includes the spaces put around the text, so Undo removes them too.
  const from = ask.answer.kind === "add" ? ask.end : ask.start;
  const to = from + res.content.length - content.length + (ask.answer.kind === "add" ? 0 : ask.end - ask.start);
  const removed = content.slice(from, ask.answer.kind === "add" ? from : ask.end);
  const at = ask.end, delta = res.content.length - content.length;
  ask.status = "kept";
  const result = D.setContent(doc, b.id, res.content);
  const inPlace = !result.changed && !result.created.length && b.type === type && D.contentOf(b) === res.content;
  const mark = inPlace && res.content.slice(from, to).trim() ? { start: from, end: to, change: { text: res.content.slice(from, to), removed, at: now } } : null;
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

const CTX = 40; // characters kept on each side of a change to find its exact place again
const around = (content, start, end) => ({ before: content.slice(Math.max(0, start - CTX), start), after: content.slice(end, end + CTX) });
/** Copies of the asks, each marked change with its place written down (ctx) from `doc`: for the draft and for
 *  guests. A change no longer exactly at its place loses its mark. */
export function withContext(asks, doc) {
  return structuredClone(asks).map((a) => {
    if (!isMarked(a)) return a;
    const index = doc ? doc.blocks.findIndex((b) => b.id === a.blockId) : -1;
    const content = index < 0 ? "" : D.contentOf(doc.blocks[index]);
    if (index < 0 || content.slice(a.start, a.end) !== a.change.text) delete a.change;
    else a.change.ctx = { index, ...around(content, a.start, a.end) };
    return a;
  });
}
/**
 * Place a marked change in another copy of the script: a guest's (the same block ids) or, `byIndex`, the script
 * read again after a reload or a Discard (new ids: its block is found by its place). Only where its text and up to
 * CTX characters on each side match exactly, at one spot; otherwise it is not placed (no mark, no Undo), never
 * guessed. Returns false then.
 */
export function place(ask, doc, { byIndex = false } = {}) {
  if (!isMarked(ask)) return false;
  const { text, ctx } = ask.change;
  const b = !ctx || typeof ctx.before !== "string" || typeof ctx.after !== "string" ? null
    : byIndex ? (Number.isInteger(ctx.index) ? doc.blocks[ctx.index] : null) : D.blockById(doc, ask.blockId);
  const content = b ? D.contentOf(b) : "";
  const hits = [];
  for (let i = b ? content.indexOf(text) : -1; i >= 0; i = content.indexOf(text, i + 1)) {
    const c = around(content, i, i + text.length);
    if (c.before === ctx.before && c.after === ctx.after) hits.push(i);
  }
  if (hits.length !== 1) { delete ask.change; return false; }
  Object.assign(ask, { blockId: b.id, start: hits[0], end: hits[0] + text.length });
  return true;
}

/**
 * A Ctrl/Cmd+Z (or redo) step that put the agent's change in or took it out says what its ask becomes when the
 * step is restored (`land`: { id, status }): Ctrl/Cmd+Z of the landing makes it undone, redo makes it kept again
 * (unmarked: Ctrl/Cmd+Z owns it now), Ctrl/Cmd+Z of a tag Undo makes it kept (unmarked). Returns `back`, what the
 * opposite step says, and `closed`, the ask whose status changed (to announce), or null.
 */
export function landStep(asks, land) {
  const ask = land && asks.find((a) => a.id === land.id && (a.status === "kept" || a.status === "undone"));
  if (!ask) return { back: null, closed: null };
  const back = { id: ask.id, status: ask.status };
  if (ask.status === land.status) return { back, closed: null };
  delete ask.change;
  ask.status = land.status;
  return { back, closed: ask };
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
