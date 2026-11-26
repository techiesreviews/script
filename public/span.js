// A selection across blocks (TOOLS-470, Lex approved the sketch 2026-11-26). Each block is its own editing area, so a
// selection the browser makes can't leave it; the editor keeps one of its own that starts in one block and ends in
// another, up to the whole script. These are its rules: what it covers, what copy gives, and what delete, typing over
// and Enter make of it. Pure: no DOM. A span is { from: { id, offset }, to: { id, offset } } in reading order (content
// offsets, as the rest of the editor counts them).
import * as Doc from "./doc.js";
import * as Cues from "./cues.js";
import * as Links from "./links.js";
import * as Changes from "./changes.js";

const indexOf = (doc, id) => doc.blocks.findIndex((b) => b.id === id);
const clampTo = (doc, i, offset) => Math.max(0, Math.min(offset, Doc.contentOf(doc.blocks[i]).length));
const fold = (text) => text.replace(/\s*\n\s*/g, " ");

/** The span between two points, in reading order, or null when it stays inside one block (the browser's own selection
 *  does that). The script's title is never part of it: a point on the title is the start of the block after it.
 *  `hidden`: ids of blocks folded away (the notes at the top); they are skipped the same way. */
export function spanOf(doc, anchor, focus, { hidden } = {}) {
  let a = indexOf(doc, anchor?.id), z = indexOf(doc, focus?.id);
  if (a < 0 || z < 0) return null;
  let ao = clampTo(doc, a, anchor.offset), zo = clampTo(doc, z, focus.offset);
  if (a > z || (a === z && ao > zo)) [a, z, ao, zo] = [z, a, zo, ao];
  const skip = (i) => doc.blocks[i]?.type === "title" || !!hidden?.has(doc.blocks[i]?.id);
  while (a < z && skip(a)) { a++; ao = 0; }
  if (skip(z)) return null;
  if (a >= z) return null;
  return { from: { id: doc.blocks[a].id, offset: ao }, to: { id: doc.blocks[z].id, offset: zo } };
}

/** The blocks a span touches, each with the part of its content in it: [{ block, start, end }]. */
export function spanParts(doc, span) {
  const a = indexOf(doc, span?.from.id), z = indexOf(doc, span?.to.id);
  if (a < 0 || z < a) return [];
  return doc.blocks.slice(a, z + 1).map((block, k) => ({
    block,
    start: k === 0 ? span.from.offset : 0,
    end: a + k === z ? span.to.offset : Doc.contentOf(block).length,
  }));
}

/** True when a drag's span covers two blocks and holds no words of the block its far end (`focus`) is in: the pointer
 *  only went into the gap past its paragraph, and the selection would look like one paragraph's. */
export function spanFarEmpty(doc, span, focus) {
  const parts = spanParts(doc, span);
  if (parts.length !== 2) return false;
  const far = parts.find((p) => p.block.id === focus?.id);
  return !!far && far.start === far.end;
}

/** True when shared edits from another tab reach the span: words changed in a block it touches, or blocks added,
 *  joined or moved. Its offsets would then point at other words, so it ends. */
export function spanTouched(doc, span, ops) {
  if (!span) return false;
  const touched = new Set(spanParts(doc, span).map((p) => p.block.id));
  return ops.some((op) => op.type !== "text" || touched.has(op.blockId));
}

/** What copy gives: the words only (no bold marks, a link as its words), a blank line between blocks. */
export function spanCopy(doc, span) {
  return spanParts(doc, span).map(({ block, start, end }) => {
    const content = Doc.contentOf(block);
    if (block.type !== "para") return content.slice(start, end);
    const { text, map } = Cues.spokenView(content, { lines: true });
    let out = "";
    for (let i = 0; i < text.length; i++) if (map[i] >= start && map[i] < end) out += text[i];
    return out;
  }).join("\n\n");
}

/**
 * Replace a span with text (delete: ""): the first block keeps its id and takes the end of the last one; the blocks
 * between go, section titles too. The joined block keeps the first block's kind, or the last one's when the span starts
 * at the very start of the first block. A heading keeps its text on one line; blank lines in the text make paragraphs.
 * Bold and links cut by the span are settled as a deletion in one block would be (no lone marks; a link keeps the words
 * that are left). `split`: Enter, a new block starts at the caret.
 * Works on a copy: returns { doc, id, caret: { id, offset }, removed: [ids], left, typed, rest, follow } (left: how much
 * of the first block stays before the join; typed: how long what was put in is, both as it ended up; rest: words of the
 * last block are left after the span), or null when the edit is
 * refused because settled marks would turn the line into another kind of block (as one-block edits are refused).
 * `follow(side, start, end)`: where words the span left are now, for an ask on them: `side` "first" (a range of the first
 * block that ends before the span) or "last" (one of the last block that starts after it), in that block's offsets as
 * they were. Gives { id, start, end, quote } in the new document, or null when the span or the settling took or cut the
 * words. Every step of the edit is followed by its offsets (TOOLS-484): the words are never searched for, since a
 * repeated word has other copies and the marks that go shift each of them.
 */
export function replaceSpan(doc, span, text = "", { split = false } = {}) {
  const parts = spanParts(doc, span);
  if (parts.length < 2) return null;
  const first = parts[0], last = parts.at(-1);
  const head = Doc.contentOf(first.block), tail = Doc.contentOf(last.block);
  const type = first.start === 0 ? last.block.type : first.block.type;
  const heading = type === "heading";
  // Only a paragraph settles its bold and links; elsewhere (lists, code, reminders, titles) marks are literal text.
  const settles = type === "para";
  let put = String(text ?? "").replace(/\r\n?/g, "\n");
  if (heading) put = fold(put);

  // The deletion, as if the two ends had been one text with a line break between them.
  const old = `${head}\n${tail}`, left = head.slice(0, first.start), right = tail.slice(last.end);
  let content = left + right, caret = left.length;
  // Each step of the edit, as where a range of the text before it is after it (null: the step took or cut it), for `follow`.
  const steps = [];
  let fix = null, settled = null;
  if (settles) {
    fix = Links.keepHidden(old, content, Links.textLinks(old), caret);
    if (fix) ({ content, caret } = fix);
    settled = Cues.settleMarks(old, content, caret, { deleted: fix?.gone });
    if (settled) {
      if (Changes.settlingChangesKind(old, settled.content)) return null;
      ({ content, caret } = settled);
    }
  }
  steps.push(settled ? settled.follow : through(old, fix ? fix.gone.map(([a, b]) => ({ at: a, del: b - a })) : [{ at: left.length, del: old.length - left.length - right.length }]));
  const kept = caret;

  // What is put in, at the join.
  if (put) {
    const typed = content.slice(0, caret) + put + content.slice(caret);
    const s = settles ? Cues.settleMarks(content, typed, caret + put.length) : null;
    if (s && Changes.settlingChangesKind(typed, s.content)) return null;
    steps.push(s ? s.follow : through(content, [{ at: caret, ins: put }]));
    ({ content, caret } = s || { content: typed, caret: caret + put.length });
  }
  if (heading && content.includes("\n")) {
    const before = fold(content.slice(0, caret)), breaks = [];
    for (const [from, part] of [[0, content.slice(0, caret)], [caret, content.slice(caret)]]) {
      for (const m of part.matchAll(/\s*\n\s*/g)) breaks.push({ at: from + m.index, del: m[0].length, ins: " " });
    }
    steps.push(through(content, breaks));
    content = before + fold(content.slice(caret));
    caret = before.length;
  }
  // A section title and the script's title have no blanks at their start: the "## " takes them.
  const blanks = heading || type === "title" ? content.match(/^[ \t]*/)[0].length : 0;
  if (blanks) {
    steps.push(through(content, [{ at: 0, del: blanks }]));
    content = content.slice(blanks);
    caret = Math.max(0, caret - blanks);
  }

  // Enter: the line breaks at the caret, settled so no lone marks are left in either part.
  let breakAt = null;
  if (split) {
    if (settles) {
      const s = Cues.settleMarks(content, `${content.slice(0, caret)}\n${content.slice(caret)}`, caret + 1);
      if (s?.content[s.caret - 1] === "\n") {
        const at = s.caret - 1, l = s.content.slice(0, at), r = s.content.slice(at + 1);
        if (!(Changes.keepsType(`${l}x`, "para") && Changes.keepsType(r, "para") && Changes.keepsType(l + r, "para"))) return null;
        // Through the settling, then without the line break it was settled around.
        steps.push((start, end) => {
          const to = s.follow(start, end);
          return to && { start: to.start > at ? to.start - 1 : to.start, end: to.end > at ? to.end - 1 : to.end };
        });
        content = l + r;
        caret = at;
      }
    }
    breakAt = caret;
  }

  const next = Doc.cloneDoc(doc);
  const removed = parts.slice(1).map((p) => p.block.id);
  for (const id of removed) Doc.removeBlock(next, id);
  const block = Doc.blockById(next, first.block.id);
  if (block.type !== type) { block.type = type; block.text = ""; }
  const r = Doc.setContent(next, block.id, content);
  let at = Doc.locate(r, caret);
  // Enter's new block: the words from `at` on in block `id` went to block `to`, `lead` of them from its start (a line
  // that reads as a section title there keeps its "## " outside its text).
  let entered = null;
  if (breakAt != null) {
    if (heading && at.offset === 0 && content.length) {
      const i = next.blocks.indexOf(block);
      Doc.insertBlock(next, i > 0 ? next.blocks[i - 1].id : null, "para", "");
    } else {
      const whole = Doc.contentOf(Doc.blockById(next, at.id)).length;
      const made = Doc.splitBlock(next, at.id, at.offset);
      entered = { id: at.id, at: at.offset, to: made.id, lead: whole - at.offset - Doc.contentOf(made).length };
      at = { id: made.id, offset: 0 };
    }
  }
  // Words of the last block left, read where they end up: after the caret, in the block it is in (Enter or a paste with
  // blank lines puts them in a new one), so what was put in never counts. There a line cut at its "- " is no longer a
  // reference, and a link cut before its address keeps none.
  const end = Doc.blockById(next, at.id);
  const rest = wordsAfter(Doc.contentOf(end), at.offset, end.type === "para");

  const follow = (side, start, end) => {
    if (!(start >= 0 && end > start) || (side === "first" ? end > first.start : side !== "last" || start < last.end)) return null;
    const shift = side === "first" ? 0 : head.length + 1;
    let range = { start: start + shift, end: end + shift };
    for (const step of steps) {
      range = step(range.start, range.end);
      if (!range || range.end <= range.start) return null;
    }
    // The block the text went to (blank lines put in make paragraphs; a section title keeps its "## " outside its text).
    const words = content.slice(range.start, range.end);
    const piece = Doc.locate(r, range.start), pieceEnd = Doc.locate(r, range.end - 1);
    if (piece.id !== pieceEnd.id) return null;
    let to = { id: piece.id, start: piece.offset, end: piece.offset + words.length };
    if (entered && to.id === entered.id && to.start >= entered.at) {
      to = { id: entered.to, start: to.start - entered.at - entered.lead, end: to.end - entered.at - entered.lead };
    }
    // Read where they are: a place that holds other text is no place for them.
    const now = Doc.blockById(next, to.id);
    if (to.start < 0 || !now || Doc.contentOf(now).slice(to.start, to.end) !== words) return null;
    return { ...to, quote: words };
  };
  return { doc: next, id: block.id, caret: at, removed, left: kept, typed: caret - kept, rest, follow };
}

// Where a range of `text` is after these edits ([{ at, del, ins }], in the text's offsets): Cues.opsRange, or null when
// one of them falls inside the range (text put in at its very start or end stays outside it).
function through(text, ops) {
  const range = Cues.opsRange(text, ops);
  return (start, end) => (ops.some((o) => (o.del ? o.at < end && o.at + o.del > start : o.at > start && o.at < end)) ? null : range(start, end));
}

// True when `content` has words after `end`: in a paragraph (`spoken`) only the spoken ones count (no bold marks, no
// hidden link address, no reference line); elsewhere marks are literal text. Read by whole characters, so a letter
// outside the basic range (two code units) counts.
function wordsAfter(content, end, spoken) {
  const word = /[\p{L}\p{N}]/u;
  if (!spoken) return word.test(content.slice(end));
  const { text, map } = Cues.spokenView(content);
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i));
    if (map[i] >= end && word.test(ch)) return true;
    i += ch.length;
  }
  return false;
}

/**
 * Where the B-roll shots go after replaceSpan (`result`): a shot on a removed block goes to the joined block, or to the
 * next spoken paragraph when the joined block is not spoken (a section title, a reminder), else the last one before it;
 * so do the joined block's own shots when it is no longer spoken. A paragraph left with no words (selected from its very
 * start) counts as not spoken: a shot there would have no words to quote. That is so also when the first key typed over
 * it has no letters (a quote mark, a space) and for composed text (deleted first): its Over could not follow words still
 * to come, and a later read of the list would take the shot off the script. `doc`: the document after the edit. Returns
 * the shots that changed: [{ id, blockIds, moved }] (moved: its first block went, so it now shows somewhere else).
 */
export function followShots(doc, shots, result) {
  const gone = new Set(result?.removed || []);
  if (!gone.size) return [];
  const spoken = Doc.spokenBlocks(doc).filter((b) => b.n.trim()).map((b) => b.id);
  const order = new Map(doc.blocks.map((b, i) => [b.id, i]));
  const join = order.get(result.id) ?? -1;
  const target = spoken.includes(result.id) ? result.id
    : spoken.find((id) => order.get(id) > join) ?? spoken.filter((id) => order.get(id) < join).at(-1) ?? null;
  // Enter, or pasted text with blank lines, put the last block's words that were left in the block at the caret: its
  // shots go with them (when some were left: a new block with no words keeps none).
  const lastGone = result.removed.at(-1), caretId = result.caret?.id;
  const tailTo = result.rest && caretId && caretId !== result.id && spoken.includes(caretId) ? caretId : target;
  // A first block selected from its very start takes the last block's kind: when that is a section title, its own
  // shots leave it too.
  const off = new Set(gone);
  if (target !== result.id) off.add(result.id);
  const out = [];
  for (const shot of shots || []) {
    const was = shot.blockIds || [];
    if (!was.some((id) => off.has(id))) continue;
    const blockIds = [...new Set(was.map((id) => (id === lastGone ? tailTo : off.has(id) ? target : id)).filter((id) => id && order.has(id)))];
    out.push({ id: shot.id, blockIds, moved: off.has(was[0]) });
  }
  return out;
}
