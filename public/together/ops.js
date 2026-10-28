// Working together: block-level operations, how two of them made at the same time fit together, and the diff
// that finds them. Pure module: no DOM, no network. Nothing here knows about scripts.
//
// A document is a list of blocks { id, text, attrs }. `text` is what people edit ("\n" line breaks); `attrs` is
// opaque here (the script editor keeps the block type, its separator and its heading marker in it).
//
//   { type: "text",   blockId, at, del, ins }               replace `del` characters at `at` with `ins`
//   { type: "split",  blockId, at, newId, attrs }           the text from `at` on moves to a new block after it
//   { type: "merge",  blockId, into, at }                   the block joins the end of the block before it
//                                                           (`into`; `at` is that block's length before)
//   { type: "insert", after, block: { id, text, attrs } }   a new block after `after` (null: at the start)
//   { type: "remove", blockId }
//   { type: "attrs",  blockId, attrs }                      only the attrs that changed
//
// Text is transformed against everything. Two structure changes that touch the same block are a Conflict: the
// host then sends that person a fresh snapshot instead of guessing.

export class Conflict extends Error {
  constructor(message = "conflict") { super(message); this.name = "Conflict"; }
}

export const cloneBlocks = (blocks) => blocks.map((b) => ({ id: b.id, text: b.text, attrs: { ...b.attrs } }));

/* ---------- Apply ---------- */
// `io` reads and writes a block, so the same code works on plain blocks and on an app's own model.
export const plainIO = {
  text: (b) => b.text,
  setText: (b, t) => { b.text = t; },
  setAttrs: (b, a) => { b.attrs = { ...b.attrs, ...a }; },
  make: (id, text, attrs) => ({ id, text, attrs: { ...attrs } }),
};

export function applyOp(blocks, op, io = plainIO) {
  const at = (id) => {
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) throw new Conflict(`no block ${id}`);
    return i;
  };
  const fresh = (id) => { if (blocks.some((b) => b.id === id)) throw new Conflict(`block ${id} exists`); };
  switch (op.type) {
    case "text": {
      const b = blocks[at(op.blockId)], t = io.text(b);
      if (op.at + op.del > t.length) throw new Conflict("range");
      io.setText(b, t.slice(0, op.at) + op.ins + t.slice(op.at + op.del));
      return;
    }
    case "split": {
      const i = at(op.blockId), b = blocks[i], t = io.text(b);
      fresh(op.newId);
      if (op.at > t.length) throw new Conflict("range");
      io.setText(b, t.slice(0, op.at));
      blocks.splice(i + 1, 0, io.make(op.newId, t.slice(op.at), op.attrs));
      return;
    }
    case "merge": {
      const i = at(op.blockId), p = blocks[i - 1];
      if (!p || p.id !== op.into) throw new Conflict("merge");
      io.setText(p, io.text(p) + io.text(blocks[i]));
      blocks.splice(i, 1);
      return;
    }
    case "insert": {
      const i = op.after == null ? 0 : at(op.after) + 1;
      fresh(op.block.id);
      blocks.splice(i, 0, io.make(op.block.id, op.block.text, op.block.attrs));
      return;
    }
    case "remove": blocks.splice(at(op.blockId), 1); return;
    case "attrs": io.setAttrs(blocks[at(op.blockId)], op.attrs); return;
  }
  throw new Conflict(`unknown op ${op?.type}`);
}
export function applyOps(blocks, ops, io = plainIO) {
  for (const op of ops) applyOp(blocks, op, io);
  return blocks;
}

/* ---------- Transform ---------- */
const touched = (op) => {
  switch (op.type) {
    case "split": return [op.blockId, op.newId];
    case "merge": return [op.blockId, op.into];
    case "insert": return [op.after ?? "\u0000start", op.block.id];
    default: return [op.blockId];
  }
};

// Text against text in one block. Where both touch the same place, `aWins` puts a's text first.
function textText(a, b, aWins) {
  if (a.blockId !== b.blockId) return [a];
  const aEnd = a.at + a.del, bEnd = b.at + b.del, shift = b.ins.length - b.del;
  if (bEnd < a.at || (bEnd === a.at && b.at < a.at)) return [{ ...a, at: a.at + shift }];
  if (b.at > aEnd || (b.at === aEnd && a.at < aEnd)) return [a];
  const left = Math.max(0, Math.min(aEnd, b.at) - a.at); // a's deletion before b's range
  const right = Math.max(0, aEnd - Math.max(a.at, bEnd)); // a's deletion after b's range
  const bInsEnd = b.at + b.ins.length;
  const first = a.at < b.at || (a.at === b.at && aWins);
  if (!first) return [{ ...a, at: bInsEnd, del: right }];
  if (!right) return [{ ...a, del: left }];
  if (!b.ins) return [{ ...a, del: left + right }];
  // b's text sits inside what a deleted: delete around it, keep b's text.
  return [{ ...a, at: bInsEnd, del: right, ins: "" }, { ...a, del: left }];
}

// Text against a structure change.
function textStruct(a, b) {
  if (b.type === "split" && a.blockId === b.blockId) {
    const k = b.at, end = a.at + a.del;
    if (a.del === 0 ? a.at <= k : end <= k) return [a]; // typing right at the cut stays on the left
    if (a.at >= k) return [{ ...a, blockId: b.newId, at: a.at - k }];
    return [{ ...a, blockId: b.newId, at: 0, del: end - k, ins: "" }, { ...a, del: k - a.at }];
  }
  if (b.type === "merge" && a.blockId === b.blockId) return [{ ...a, blockId: b.into, at: a.at + b.at }];
  if (b.type === "remove" && a.blockId === b.blockId) return [];
  return [a];
}

// A structure change against text: only the cut of a split and the join point of a merge move.
function structText(a, b) {
  if (a.type === "split" && a.blockId === b.blockId) {
    const k = a.at, bEnd = b.at + b.del;
    if (bEnd <= k && (b.at < k || b.del === 0)) return [{ ...a, at: k + b.ins.length - b.del }];
    if (b.at >= k) return [a];
    return [{ ...a, at: b.at + b.ins.length }];
  }
  if (a.type === "merge" && a.into === b.blockId) return [{ ...a, at: a.at + b.ins.length - b.del }];
  return [a];
}

/** a' (a list) that applies after b, when a and b were made on the same document. */
export function transform(a, b, aWins) {
  const at = a.type === "text", bt = b.type === "text";
  if (at && bt) return textText(a, b, aWins);
  if (at) return textStruct(a, b);
  if (bt) return structText(a, b);
  const tb = new Set(touched(b));
  if (touched(a).some((id) => tb.has(id))) throw new Conflict(`${a.type} and ${b.type} on the same block`);
  return [a];
}

/** [A', B']: A' applies after B, B' after A. `aWins` breaks ties at the same place in favour of A. */
export function transformOps(A, B, aWins) {
  if (!A.length || !B.length) return [A, B];
  if (A.length === 1 && B.length === 1) return [transform(A[0], B[0], aWins), transform(B[0], A[0], !aWins)];
  if (A.length > 1) {
    const [a1, b1] = transformOps(A.slice(0, 1), B, aWins);
    const [a2, b2] = transformOps(A.slice(1), b1, aWins);
    return [[...a1, ...a2], b2];
  }
  const [a1, b1] = transformOps(A, B.slice(0, 1), aWins);
  const [a2, b2] = transformOps(a1, B.slice(1), aWins);
  return [a2, [...b1, ...b2]];
}

/* ---------- Points (carets, selections, change ranges) ---------- */
/** Where a point { blockId, offset } is after `op`; null when its block is gone. `right`: a point exactly where
 *  text is inserted moves after it. For a merge, `joinAt` is the length of the block it joins (default op.at). */
export function movePoint(p, op, { right = false, joinAt } = {}) {
  if (!p) return null;
  if (op.blockId !== p.blockId && op.type !== "insert") return p;
  switch (op.type) {
    case "text": {
      const o = p.offset;
      if (o < op.at || (o === op.at && !right)) return p;
      if (o === op.at) return { ...p, offset: o + op.ins.length };
      if (o >= op.at + op.del) return { ...p, offset: o + op.ins.length - op.del };
      return { ...p, offset: op.at + op.ins.length };
    }
    case "split":
      return p.offset > op.at || (p.offset === op.at && right) ? { ...p, blockId: op.newId, offset: p.offset - op.at } : p;
    case "merge": return { ...p, blockId: op.into, offset: p.offset + (joinAt ?? op.at) };
    case "remove": return null;
    default: return p;
  }
}

/** Where the person who made `op` leaves their caret. */
export function opEnd(op, joinAt) {
  switch (op.type) {
    case "text": return { blockId: op.blockId, offset: op.at + op.ins.length };
    case "split": return { blockId: op.newId, offset: 0 };
    case "merge": return { blockId: op.into, offset: joinAt ?? op.at };
    case "insert": return { blockId: op.block.id, offset: op.block.text.length };
    default: return null;
  }
}

/* ---------- Diff: the operations that turn `before` into `after` ---------- */
function textOp(blockId, s, t, caret) {
  let p = 0;
  const max = Math.min(s.length, t.length);
  while (p < max && s[p] === t[p]) p++;
  let q = 0;
  while (q < max - p && s[s.length - 1 - q] === t[t.length - 1 - q]) q++;
  const op = { type: "text", blockId, at: p, del: s.length - p - q, ins: t.slice(p, t.length - q) };
  // Typing " a" after "a" can be read in more than one place; the caret says where it really happened.
  if (Number.isInteger(caret) && (!op.del || !op.ins)) {
    const at = op.ins ? caret - op.ins.length : caret;
    if (at >= 0 && at !== op.at && at + op.del <= s.length) {
      const ins = t.slice(at, at + op.ins.length);
      if (s.slice(0, at) + ins + s.slice(at + op.del) === t && (op.ins || s.slice(at, at + op.del).length === op.del)) return { ...op, at, ins };
    }
  }
  return op;
}

/** `caret` (optional, { blockId, offset }) is where the person's caret is now: it picks the place of an edit
 *  that could be read in more than one place. */
export function diff(before, after, caret = null) {
  const ops = [];
  const work = cloneBlocks(before);
  const target = new Map(after.map((b) => [b.id, b]));
  const push = (op) => { applyOp(work, op); ops.push(op); };
  // Gone: joined to the end of the block before it (Backspace at the start), or removed.
  for (let i = 0; i < work.length;) {
    const b = work[i];
    if (target.has(b.id)) { i++; continue; }
    const p = work[i - 1];
    if (p && b.text && target.get(p.id)?.text.startsWith(p.text + b.text)) push({ type: "merge", blockId: b.id, into: p.id, at: p.text.length });
    else push({ type: "remove", blockId: b.id });
  }
  // Moved: taken out here, they come back below as new blocks.
  const order = new Map(after.map((b, i) => [b.id, i]));
  let last = -1;
  for (const b of [...work]) {
    const i = order.get(b.id);
    if (i > last) last = i;
    else push({ type: "remove", blockId: b.id });
  }
  // New, in order: a split (Enter) when the text after the cut starts the new block, else an insert.
  const have = new Map(work.map((b) => [b.id, b]));
  after.forEach((b, i) => {
    if (have.has(b.id)) return;
    const prev = i ? after[i - 1].id : null;
    const q = prev && have.get(prev);
    const keep = q && target.get(prev).text;
    if (q && q.text.startsWith(keep) && q.text.slice(keep.length).startsWith(b.text)) push({ type: "split", blockId: prev, at: keep.length, newId: b.id, attrs: { ...b.attrs } });
    else push({ type: "insert", after: prev, block: { id: b.id, text: b.text, attrs: { ...b.attrs } } });
    have.set(b.id, work.find((x) => x.id === b.id));
  });
  for (const b of after) {
    const w = have.get(b.id), changed = {};
    for (const k of new Set([...Object.keys(w.attrs), ...Object.keys(b.attrs)])) if (w.attrs[k] !== b.attrs[k]) changed[k] = b.attrs[k];
    if (Object.keys(changed).length) push({ type: "attrs", blockId: b.id, attrs: changed });
  }
  for (const b of after) {
    const w = have.get(b.id);
    if (w.text !== b.text) push(textOp(b.id, w.text, b.text, caret?.blockId === b.id ? caret.offset : null));
  }
  return ops;
}

/* ---------- Checking operations from someone else ---------- */
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const TEXT_MAX = 200_000;
const isId = (v) => typeof v === "string" && ID_RE.test(v);
const isPos = (v) => Number.isInteger(v) && v >= 0 && v <= TEXT_MAX;
const isText = (v) => typeof v === "string" && v.length <= TEXT_MAX && !v.includes("\r");
/** True when `ops` is a well-formed list. `validAttrs(attrs, partial)` checks attrs for the app. */
export function validOps(ops, validAttrs = () => true) {
  if (!Array.isArray(ops) || !ops.length || ops.length > 5000) return false;
  return ops.every((op) => {
    if (!op || typeof op !== "object") return false;
    switch (op.type) {
      case "text": return isId(op.blockId) && isPos(op.at) && isPos(op.del) && isText(op.ins);
      case "split": return isId(op.blockId) && isPos(op.at) && isId(op.newId) && validAttrs(op.attrs, false);
      case "merge": return isId(op.blockId) && isId(op.into) && isPos(op.at);
      case "insert": return (op.after === null || isId(op.after)) && !!op.block && isId(op.block.id) && isText(op.block.text) && validAttrs(op.block.attrs, false);
      case "remove": return isId(op.blockId);
      case "attrs": return isId(op.blockId) && validAttrs(op.attrs, true);
      default: return false;
    }
  });
}
/** A caret from someone else: { blockId, offset, selEnd? } or null. */
export function validCaret(c) {
  return c === null || (!!c && typeof c === "object" && isId(c.blockId) && isPos(c.offset) && (c.selEnd == null || isPos(c.selEnd)));
}
