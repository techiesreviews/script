import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyQueue, queueSave, settleQueue, splitQueue, changedOnDisk } from "../public/save-queue.js";

const A = { name: "a.md" }, B = { name: "b.md" };
const req = (handle, text, flags = {}) => ({ handle, name: handle?.name ?? "untitled.md", text, savedText: "saved", fileModified: 100, force: false, auto: true, ...flags });

test("save queue: within one file the newest text and the strongest flags win", () => {
  let q = queueSave(emptyQueue(), req(A, "a1", { force: true, auto: true }));
  q = queueSave(q, req(A, "a2", { force: false, auto: false }));
  assert.equal(q.waiting.text, "a2");
  assert.equal(q.waiting.force, true); // force ||
  assert.equal(q.waiting.auto, false); // auto &&
  q = queueSave(q, req(A, "a3"));
  assert.deepEqual([q.waiting.force, q.waiting.auto, q.waiting.text], [true, false, "a3"]);
  assert.deepEqual(q.left, []);
});

test("save queue: another file keeps the old request as a snapshot and starts a fresh record", () => {
  // A is saving, the switch flush queues A, then Ctrl/Cmd+S on B.
  let q = queueSave(emptyQueue(), req(A, "a-at-switch"));
  q = queueSave(q, req(B, "b1", { auto: false }));
  assert.equal(q.left.length, 1);
  assert.equal(q.left[0].handle, A);
  assert.equal(q.left[0].text, "a-at-switch");
  // B's click is not shrunk into an auto-save, and gets no flags from A.
  assert.deepEqual([q.waiting.handle, q.waiting.auto, q.waiting.force], [B, false, false]);
  const { left, current } = splitQueue(q, B);
  assert.deepEqual(left.map((s) => s.text), ["a-at-switch"]);
  assert.equal(current.handle, B);
  assert.equal(current.auto, false);
});

test("save queue: A -> B -> A does not carry B's force onto A", () => {
  let q = queueSave(emptyQueue(), req(A, "a1"));
  q = queueSave(q, req(B, "b1", { force: true, auto: false })); // "Save mine" on B
  q = queueSave(q, req(A, "a2"));
  assert.deepEqual([q.waiting.handle, q.waiting.force, q.waiting.auto], [A, false, true]);
  assert.deepEqual(q.left.map((s) => [s.handle, s.force]), [[A, false], [B, true]]);
  // Back on B again: the B snapshot merges only with B.
  q = queueSave(q, req(B, "b2"));
  assert.deepEqual(q.left.map((s) => [s.handle.name, s.text, s.force]), [["a.md", "a2", false], ["b.md", "b1", true]]);
  assert.equal(q.waiting.text, "b2");
  assert.equal(q.waiting.force, false);
});

test("save queue: a waiting request for a script the person left becomes a snapshot when the save ends", () => {
  const q = queueSave(emptyQueue(), req(A, "a-latest"));
  const { left, current } = splitQueue(q, B);
  assert.equal(current, null);
  assert.deepEqual(left.map((s) => [s.handle, s.text]), [[A, "a-latest"]]);
  assert.deepEqual(splitQueue(q, A), { left: [], current: q.waiting });
  assert.deepEqual(splitQueue(emptyQueue(), A), { left: [], current: null });
});

test("save queue: the finished write's lastModified feeds the snapshot's changed-on-disk check", () => {
  // A's running save wrote "a1" at time 200; its snapshot still knows the older file (time 100, "saved").
  let q = queueSave(emptyQueue(), req(A, "a2"));
  q = queueSave(q, req(B, "b1"));
  const fileAfterOurWrite = { lastModified: 200, text: "a1" };
  assert.equal(changedOnDisk(q.left[0], fileAfterOurWrite), true, "without the finished write it looks like someone else changed it");
  q = settleQueue(q, { handle: A, text: "a1", modified: 200 });
  assert.equal(q.left[0].fileModified, 200);
  assert.equal(q.left[0].savedText, "a1");
  assert.equal(changedOnDisk(q.left[0], fileAfterOurWrite), false);
  assert.equal(changedOnDisk(q.left[0], { lastModified: 300, text: "someone else" }), true);
  // Other files and failed writes are left alone.
  assert.equal(q.waiting.fileModified, 100);
  assert.equal(settleQueue(q, null), q);
  assert.equal(settleQueue(q, { handle: A, text: "x", modified: 0 }), q);
});

test("changed on disk: same text or an older file is not a change, force skips the check", () => {
  const r = req(A, "a", { savedText: "s", fileModified: 100 });
  assert.equal(changedOnDisk(r, { lastModified: 150, text: "s" }), false);
  assert.equal(changedOnDisk(r, { lastModified: 100, text: "other" }), false);
  assert.equal(changedOnDisk(r, { lastModified: 150, text: "other" }), true);
  assert.equal(changedOnDisk({ ...r, force: true }, { lastModified: 150, text: "other" }), false);
  assert.equal(changedOnDisk({ ...r, fileModified: 0 }, { lastModified: 150, text: "other" }), false);
});
