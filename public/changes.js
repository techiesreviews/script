// The agent's answers go straight into the text (step F, Lex 2026-10-28). A "replace" or "add" answer on a selection
// is applied at once; the ask becomes `kept` and keeps its change, lightly marked, while the changed text is untouched
// (and until it is scrolled past or 60 minutes are over: step M, at the end of this file):
//   ask.start/end  the changed text in its block (content offsets), ask.change = { text, removed, at, ctx? }
// Undo puts `removed` back in place of `text` (only while the text is exactly there) and makes the ask `undone`.
// The change stays inside its block: blank lines in the answer are already one space (D.cleanAnswer), and a text
// that would turn the block into another kind (a "## " at its start, brackets around it) goes in on one line,
// without the marks at its start (and a "]" at its end). An answer that still can't keep the type is refused.
// Kept with a draft or shared with guests, a change carries ctx = { index, before, after }: its block's place and
// up to CTX characters around it. It is placed again only where that matches exactly; otherwise it shows no mark.
// Links (step G): a "links" answer goes in the same way, as one change; its mark runs from the first new link to the
// last. On the whole script each paragraph that gets links has its own marked change, as an ask of its own made
// from the script ask (`from`), so every mark and Undo works as above; the landing is still one Ctrl/Cmd+Z step.
// Links never land in text other open work points at (open asks, "Sounds like me" marks, marked changes).
// Pure: no DOM. The editor (app.js) calls these and draws the mark; the room carries the text like any change.
import * as D from "./doc.js";
import * as L from "./links.js";
import { diff, movePoint } from "./together/ops.js";

export const STRAIGHT_IN = ["replace", "add", "links"];
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
// note or HTML: "# ", "- ", "1. ", ">", "|", "`", "~", "[", "<", "* ", "+ ", "_". Numbers and "#" only with a space after
// them, so "2.5 million" and "#1 tip" stay.
const LEAD_MARKS = /^\s*(?:(?:#{1,6}|[-*+]|\d+[.)])\s+|[_>|`~[<]\s*)+/;
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
  if (!goesStraightIn(ask, answer) || answer.kind === "links") return true;
  const b = D.blockById(doc, ask.blockId);
  const r = b && D.reanchor(ask, D.contentOf(b));
  return !r || fitText(D.contentOf(b), { ...ask, ...r, answer }, b.type) !== null;
}
/** What the tab tells the agent after answer_ask, per kind. For links: how many went in, and the quotes skipped. */
export function answerResult(kind, { linked = 0, skipped = [] } = {}) {
  if (kind === "note") return "Shown to the person.";
  if (kind === "marks") return "Shown to the person. They choose Keep or Undo.";
  if (kind === "links") return `Done: ${linked} ${linked === 1 ? "link is" : "links are"} in the text now. The person can undo them.${skippedText(skipped)}`;
  return "Done: the change is in the text now. The person can undo it.";
}
const skippedText = (skipped) => (skipped.length ? ` Skipped: ${skipped.map((x) => `${JSON.stringify(x.quote)} (${x.why})`).join("; ")}.` : "");
/** The agent's answer_ask error when none of its links could go in. */
export const noLinksError = (skipped) => `No link went in.${skippedText(skipped)} Quote words exactly as they are in the asked text, outside links, open asks and changes, headings and reminders.`;

// Where other open work points in a block: open asks on a selection (waiting, taken, answered; not B-roll
// suggestions, which live beside the lines), open "Sounds like me" marks and the agent's marked changes. Links never
// land there, so that work keeps its text (and its mark and Undo). `except`: the links ask itself.
function busyRanges(asks, except) {
  const out = new Map();
  const add = (id, start, end) => { if (!out.has(id)) out.set(id, []); out.get(id).push([start, end]); };
  for (const a of asks || []) {
    if (a.id === except) continue;
    if (a.scope === "selection" && D.OPEN_STATUSES.includes(a.status) && a.action !== "broll" && a.answer?.kind !== "broll") add(a.blockId, a.start, a.end); // kind "broll": a free Ask answered with B-roll
    else if (isMarked(a)) add(a.blockId, a.start, a.end);
    else if (a.scope === "script" && a.status === "answered" && Array.isArray(a.answer?.marks)) {
      for (const m of a.answer.marks) if (m.state === "open" && m.blockId) add(m.blockId, m.start, m.end);
    }
  }
  return out;
}
// Blocks a whole-script "Find links" may link: the spoken paragraphs; the other blocks only explain a skip.
function scriptSegments(doc, busy) {
  const spoken = new Set(D.outline(doc).sections.filter((s) => s.spoken).flatMap((s) => s.blocks.filter((b) => b.type === "para").map((b) => b.id)));
  const segments = [], others = [];
  for (const b of doc.blocks) {
    const content = D.contentOf(b);
    if (spoken.has(b.id)) segments.push({ id: b.id, content, from: 0, to: content.length, avoid: busy.get(b.id) || [] });
    else if (b.type !== "para") others.push(content);
  }
  return { segments, others };
}
/** What a links answer would do now, without changing anything: { segments, skipped } (L.planLinks). The selection's
 *  quote must still be there (else null). `asks`: all the asks, so that links stay out of other open work. A
 *  paragraph whose links would turn it into another kind of block gets none; its quotes are skipped. */
export function planFor(doc, ask, answer = ask.answer, { asks = [] } = {}) {
  const busy = busyRanges(asks, ask.id);
  let plan;
  if (ask.scope === "script") {
    const { segments, others } = scriptSegments(doc, busy);
    plan = L.planLinks(segments, answer.links, { others });
  } else {
    const b = D.blockById(doc, ask.blockId);
    const r = b && D.reanchor(ask, D.contentOf(b));
    if (!r) return null;
    const content = D.contentOf(b);
    const segment = b.type === "para" ? [{ id: b.id, content, from: r.start, to: r.end, avoid: busy.get(b.id) || [] }] : [];
    plan = L.planLinks(segment, answer.links, { others: b.type === "para" ? [] : [content] });
  }
  const segments = [], skipped = [...plan.skipped];
  for (const seg of plan.segments) {
    if (keepsType(seg.content, D.blockById(doc, seg.id)?.type)) segments.push(seg);
    else for (const l of seg.links) skipped.push({ quote: l.quote.slice(0, 80), why: "its paragraph would become another kind of block" });
  }
  return { segments, skipped };
}

/**
 * Apply an answered ask's replace or add to the document, as one change, on its quote found again near its place
 * (null, and nothing changes, when the quote is gone). Returns { blockId, at, delta, result, mark } (result:
 * D.setContent's, for following splits) and sets the ask `kept`. When the change stays inside its block (no new
 * paragraphs, the same type), `mark` is { start, end, change: { text, removed, at: now } } for `setMark` (after the
 * other marks followed this change); otherwise (a safety net: fitText keeps it so) it is null and the change goes
 * in unmarked. A change of only spaces is not marked.
 */
export function land(doc, ask, now = Date.now(), { asks = [] } = {}) {
  const b = D.blockById(doc, ask.blockId);
  if (!b || !goesStraightIn(ask, ask.answer)) return null;
  if (ask.answer.kind === "links") return landLinks(doc, ask, now, asks);
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
// One plan segment into its block: { at, delta, result, mark } (null when the block would change its type).
function landSegment(doc, seg, now) {
  const b = D.blockById(doc, seg.id);
  if (!b || !keepsType(seg.content, b.type)) return null;
  const old = D.contentOf(b);
  const end = seg.to + seg.delta;
  const result = D.setContent(doc, b.id, seg.content);
  const mark = { start: seg.from, end, change: { text: seg.content.slice(seg.from, end), removed: old.slice(seg.from, seg.to), at: now } };
  return { blockId: b.id, at: seg.to, delta: seg.delta, result, mark };
}
// A links answer on a selection: one change in its block, marked from the first new link to the last.
function landLinks(doc, ask, now, asks) {
  const plan = planFor(doc, ask, ask.answer, { asks });
  const seg = plan?.segments[0];
  if (!seg) return null;
  const res = landSegment(doc, seg, now);
  if (!res) return null;
  ask.status = "kept";
  ask.answer = { ...ask.answer, links: seg.links };
  return { ...res, skipped: plan.skipped };
}
/**
 * A links answer on the whole script: every spoken paragraph that gets links changes, each as its own marked change
 * with an ask of its own (a selection "links" ask from this one: `from`, the same `by` and agent, already kept), so
 * Undo on the agent's name tag takes them back one paragraph at a time. The script ask becomes kept.
 * Returns { parts: [{ ask, blockId, at, delta, result }], skipped } or null (nothing changes) when no link can go in.
 */
export function landScript(doc, ask, now = Date.now(), { asks = [] } = {}) {
  if (ask.scope !== "script" || ask.answer?.kind !== "links") return null;
  const plan = planFor(doc, ask, ask.answer, { asks });
  const segs = plan.segments;
  if (!segs.length) return null;
  const parts = [];
  for (const seg of segs) {
    const res = landSegment(doc, seg, now);
    const part = {
      id: D.newId(10), scope: "selection", action: "links", from: ask.id, instruction: ask.instruction, by: ask.by, createdAt: ask.createdAt,
      status: "kept", blockId: seg.id, quote: res.mark.change.text, section: D.sectionOfBlock(doc, seg.id),
      answer: { kind: "links", links: seg.links }, ...(ask.answeredBy ? { answeredBy: ask.answeredBy } : {}),
    };
    setMark(part, res.mark);
    parts.push({ ask: part, blockId: res.blockId, at: res.at, delta: res.delta, result: res.result });
  }
  ask.status = "kept";
  ask.answer = { ...ask.answer, links: segs.flatMap((s) => s.links) };
  return { parts, skipped: plan.skipped };
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
// A whole-script links landing names its script ask and the paragraphs' asks (`also`); they all change together.
export function landStep(asks, land) {
  const ask = land && asks.find((a) => a.id === land.id && (a.status === "kept" || a.status === "undone"));
  if (!ask) return { back: null, closed: null };
  const also = (land.also || []).map((id) => asks.find((a) => a.id === id && (a.status === "kept" || a.status === "undone"))).filter(Boolean);
  const back = { id: ask.id, status: ask.status, ...(land.also ? { also: land.also } : {}) };
  if (ask.status === land.status) return { back, closed: null };
  for (const a of [ask, ...also]) { delete a.change; a.status = land.status; }
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

/* The mark goes away by itself (step M, Lex 2026-10-30): once the person has scrolled past it, or 60 minutes after
   the change went in (`change.at`, the host's clock), whichever comes first. It ends like an edit inside it: the ask
   stays kept, its `change` goes, the text is untouched (so its Undo goes too). Pictures in the B-roll list are not
   asks with a change and keep their mark. */
export const MARK_MS = 60 * 60 * 1000;
/** Is this mark's time over? A change without `at` (a draft from before its time stamp) counts from `readAt`. */
export const markExpired = (ask, now, readAt = ask?.change?.readAt ?? now) => isMarked(ask) && now - (Number.isFinite(ask.change.at) ? ask.change.at : readAt) >= MARK_MS;
/** End the marks whose time is over; a mark without `at` gets `readAt`, the time this tab read it, so its 60 minutes
 *  count from then (`at` stays unset: it would make that old change the newest). Returns the asks whose mark ended. */
export function endExpired(asks, now) {
  const ended = [];
  for (const a of asks) {
    if (!isMarked(a)) continue;
    if (!Number.isFinite(a.change.at) && !Number.isFinite(a.change.readAt)) a.change.readAt = now;
    if (markExpired(a, now)) { delete a.change; ended.push(a); }
  }
  return ended;
}
/** Has the person read past this mark? `box`: its top and bottom (the bottom of its last line); `view`: the visible
 *  part of the script. Only once it has been on screen (`seen`) and its last line is above the middle. */
export const readPast = (box, view, seen) => !!seen && box.bottom < (view.top + view.bottom) / 2;
/** The asks as this person sees them: in a shared script a mark ended on one screen only (`ended`: ask ids) is gone
 *  from the copies; everyone else's, and the asks themselves, keep it. */
export const seenAsks = (asks, ended) => (ended?.size ? asks.map((a) => (isMarked(a) && ended.has(a.id) ? (({ change, ...rest }) => rest)(a) : a)) : asks);
