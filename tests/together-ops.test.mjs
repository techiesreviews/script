import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, cloneBlocks, transformOps, diff, movePoint, Conflict, validOps, validCaret } from "../public/together/ops.js";

const doc = (...texts) => texts.map((text, i) => ({ id: `b${i}`, text, attrs: { type: "para" } }));
const texts = (blocks) => blocks.map((b) => `${b.id}:${b.text}`).join("|");
// Both orders must end on the same document: a then b', and b then a'.
function both(start, a, b) {
  const [a2, b2] = transformOps(a, b, true);
  const one = applyOps(applyOps(cloneBlocks(start), a), b2);
  const two = applyOps(applyOps(cloneBlocks(start), b), a2);
  assert.equal(texts(one), texts(two));
  return texts(one);
}
const ins = (blockId, at, text) => ({ type: "text", blockId, at, del: 0, ins: text });
const del = (blockId, at, n, text = "") => ({ type: "text", blockId, at, del: n, ins: text });

test("ops: insert/insert in one block, both orders agree and the first one wins the tie", () => {
  const s = doc("Hello world");
  assert.equal(both(s, [ins("b0", 5, " big")], [ins("b0", 11, "!")]), "b0:Hello big world!");
  assert.equal(both(s, [ins("b0", 5, "A")], [ins("b0", 5, "B")]), "b0:HelloAB world");
});

test("ops: insert/delete keeps text typed inside a deleted part", () => {
  const s = doc("one two three");
  assert.equal(both(s, [ins("b0", 5, "X")], [del("b0", 4, 4)]), "b0:one Xthree");
  assert.equal(both(s, [ins("b0", 0, "> ")], [del("b0", 4, 4)]), "b0:> one three");
});

test("ops: delete/delete that overlap remove each character once", () => {
  const s = doc("abcdefgh");
  assert.equal(both(s, [del("b0", 1, 4)], [del("b0", 3, 4)]), "b0:ah");
  assert.equal(both(s, [del("b0", 2, 3, "X")], [del("b0", 2, 2, "Y")]), "b0:abXYfgh");
});

test("ops: split while someone types in the same block", () => {
  const s = doc("First half. Second half.");
  const split = [{ type: "split", blockId: "b0", at: 12, newId: "n1", attrs: { type: "para" } }];
  assert.equal(both(s, [ins("b0", 18, " part")], split), "b0:First half. |n1:Second part half.");
  assert.equal(both(s, [ins("b0", 5, "est")], split), "b0:Firstest half. |n1:Second half.");
  // Typing right at the cut stays on the left line; a deletion across the cut is split in two.
  assert.equal(both(s, [ins("b0", 12, "!")], split), "b0:First half. !|n1:Second half.");
  assert.equal(both(s, [del("b0", 6, 10)], split), "b0:First |n1:nd half.");
});

test("ops: merge while someone types in the joined block", () => {
  const s = doc("Hello", " world");
  const merge = [{ type: "merge", blockId: "b1", into: "b0", at: 5 }];
  assert.equal(both(s, [ins("b1", 6, "!")], merge), "b0:Hello world!");
  assert.equal(both(s, [ins("b0", 5, ",")], merge), "b0:Hello, world");
});

test("ops: two structure changes on one block are a conflict", () => {
  const s = doc("abc");
  assert.throws(() => transformOps([{ type: "split", blockId: "b0", at: 1, newId: "x", attrs: {} }], [{ type: "remove", blockId: "b0" }], true), Conflict);
  assert.doesNotThrow(() => both(doc("a", "b"), [{ type: "remove", blockId: "b0" }], [{ type: "split", blockId: "b1", at: 0, newId: "x", attrs: {} }]));
  void s;
});

// Random edits on random documents: whatever two people do at the same time, both orders agree.
function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32); }
function randomOp(blocks, r, tag) {
  const b = blocks[Math.floor(r() * blocks.length)], i = blocks.indexOf(b), n = b.text.length;
  const k = r();
  if (k < 0.55) { const at = Math.floor(r() * (n + 1)); const d = Math.floor(r() * (n - at + 1) * (r() < 0.5 ? 0 : 1)); return [{ type: "text", blockId: b.id, at, del: d, ins: r() < 0.7 ? tag : "" }]; }
  if (k < 0.7) return [{ type: "split", blockId: b.id, at: Math.floor(r() * (n + 1)), newId: `s${tag}`, attrs: { type: "para" } }];
  if (k < 0.8 && i > 0) return [{ type: "merge", blockId: b.id, into: blocks[i - 1].id, at: blocks[i - 1].text.length }];
  if (k < 0.88) return [{ type: "remove", blockId: b.id }];
  if (k < 0.94) return [{ type: "insert", after: r() < 0.2 ? null : b.id, block: { id: `i${tag}`, text: tag, attrs: { type: "para" } } }];
  return [{ type: "attrs", blockId: b.id, attrs: { type: r() < 0.5 ? "note" : "para" } }];
}
test("ops: random concurrent edits converge (TP1)", () => {
  const r = rng(7);
  let checked = 0;
  for (let n = 0; n < 4000; n++) {
    const s = doc(...Array.from({ length: 1 + Math.floor(r() * 3) }, () => "abcdefgh".slice(0, Math.floor(r() * 9))));
    const a = randomOp(s, r, "X"), b = randomOp(s, r, "Y");
    try { both(s, a, b); checked++; } catch (e) { if (!(e instanceof Conflict)) throw e; }
  }
  assert.ok(checked > 3000, `only ${checked} pairs checked`);
});

// The host's log and diff() make lists of operations: batches of 2–4 on each side must converge too.
test("ops: random concurrent batches converge", () => {
  const r = rng(23);
  let checked = 0, n = 0;
  const batch = (s, side) => {
    const ops = [];
    let work = cloneBlocks(s);
    for (let k = 0, m = 2 + Math.floor(r() * 3); k < m; k++) {
      const op = randomOp(work, r, `${side}${n}${k}`);
      try { work = applyOps(cloneBlocks(work), op); ops.push(...op); } catch (e) { if (!(e instanceof Conflict)) throw e; }
      if (!work.length) break;
    }
    return ops;
  };
  for (; n < 3000; n++) {
    const s = doc(...Array.from({ length: 1 + Math.floor(r() * 4) }, () => "abcdefghij".slice(0, Math.floor(r() * 11))));
    const A = batch(s, "a"), B = batch(s, "b");
    try { both(s, A, B); checked++; } catch (e) { if (!(e instanceof Conflict)) throw e; }
  }
  assert.ok(checked > 1000, `only ${checked} batches checked`);
});

test("ops: diff finds operations that rebuild the document exactly", () => {
  const r = rng(11);
  for (let n = 0; n < 2000; n++) {
    let s = doc("Title", "One two", "Three");
    const before = cloneBlocks(s);
    for (let k = 0; k < 1 + Math.floor(r() * 3); k++) s = applyOps(cloneBlocks(s), randomOp(s, r, `Z${k}`));
    const ops = diff(before, s);
    assert.deepEqual(applyOps(cloneBlocks(before), ops), s);
  }
  // Enter and Backspace come out as a split and a merge, so typing elsewhere follows them.
  const a = doc("Hello world");
  assert.equal(diff(a, [{ id: "b0", text: "Hello ", attrs: { type: "para" } }, { id: "n", text: "world", attrs: { type: "para" } }])[0].type, "split");
  assert.equal(diff(doc("Hello", " world"), [{ id: "b0", text: "Hello world", attrs: { type: "para" } }])[0].type, "merge");
});

test("ops: a caret follows a remote operation", () => {
  const c = { blockId: "b0", offset: 8 };
  assert.deepEqual(movePoint(c, ins("b0", 2, "abc")), { blockId: "b0", offset: 11 });
  assert.deepEqual(movePoint(c, ins("b0", 9, "abc")), c);
  assert.deepEqual(movePoint(c, ins("b0", 8, "abc")), c); // text typed right at my caret goes after it
  assert.deepEqual(movePoint(c, ins("b0", 8, "abc"), { right: true }), { blockId: "b0", offset: 11 });
  assert.deepEqual(movePoint(c, del("b0", 4, 6)), { blockId: "b0", offset: 4 });
  assert.deepEqual(movePoint(c, { type: "split", blockId: "b0", at: 5, newId: "n", attrs: {} }), { blockId: "n", offset: 3 });
  assert.deepEqual(movePoint(c, { type: "merge", blockId: "b0", into: "p", at: 20 }), { blockId: "p", offset: 28 });
  assert.equal(movePoint(c, { type: "remove", blockId: "b0" }), null);
});

test("ops: operations and carets from someone else are checked", () => {
  assert.ok(validOps([ins("b0", 0, "x")]));
  assert.ok(!validOps([]));
  assert.ok(!validOps([{ type: "text", blockId: "b 0", at: 0, del: 0, ins: "x" }]));
  assert.ok(!validOps([{ type: "text", blockId: "b0", at: -1, del: 0, ins: "x" }]));
  assert.ok(!validOps([ins("b0", 0, "a\r\nb")]));
  assert.ok(!validOps([{ type: "eval", blockId: "b0" }]));
  assert.ok(!validOps([{ type: "attrs", blockId: "b0", attrs: { sep: "x" } }], (a) => /^\s*$/.test(a.sep ?? "")));
  assert.ok(validCaret(null) && validCaret({ blockId: "b0", offset: 3, selEnd: 1 }));
  assert.ok(!validCaret({ blockId: "b0", offset: 1.5 }));
});
