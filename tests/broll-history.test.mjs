import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as Doc from "../public/doc.js";
import * as Changes from "../public/changes.js";

// Run the app's actual history functions with no page. The browser regression drives the real drag and writer;
// these checks control the asynchronous save so typing, fast Undo/Redo and failed writes are deterministic.
function history() {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const section = source.slice(source.indexOf("function checkpoint("), source.indexOf("/* ---------- Ask anchors follow edits"));
  const state = { doc: Doc.parse("# Throwaway\n\nOriginal words.\n"), undo: [], redo: [], asks: [], lastStep: null };
  const context = { state, Doc, Changes, together: null, Date, UNDO_LIMIT: 300, TYPING_GROUP_MS: 1000,
    getCaret: () => null, byId: (id) => Doc.blockById(state.doc, id),
    followAnchors() {}, reanchorAll() {}, renderAll() {}, hideBar() {}, changed() {}, emit() {},
  };
  runInNewContext(`${section}\nthis.api = { checkpoint, undo, redo, checkpointBrollMove };`, context);
  const type = (text) => {
    const para = state.doc.blocks.find((b) => b.type === "para");
    context.api.checkpoint("type", para.id);
    Doc.setContent(state.doc, para.id, Doc.contentOf(para) + text);
  };
  return { ...context.api, state, type, words: () => Doc.serialize(state.doc) };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("B-roll move: Undo and Redo change only the shot, in order with script typing", async () => {
  const h = history();
  h.type(" UNDO-SENTINEL-A");
  const typed = h.words();
  let over = "second";
  h.checkpointBrollMove({ valid: () => true, undo: async () => { over = "first"; return true; }, redo: async () => { over = "second"; return true; } });
  h.undo(); await settle();
  assert.equal(h.words(), typed, "undoing the move preserves unrelated typing");
  assert.equal(over, "first");
  h.redo(); await settle();
  assert.equal(over, "second");
  h.type(" Later typing");
  h.undo(); await settle();
  assert.equal(h.words(), typed, "typing after the move is its own step");
  assert.equal(over, "second");
  h.undo(); await settle();
  assert.equal(over, "first");
  assert.equal(h.words(), typed);
  h.undo(); await settle();
  assert.doesNotMatch(h.words(), /UNDO-SENTINEL-A/, "a later Undo can still undo the earlier typing");
});

test("B-roll move: an Undo waiting for its save cannot restore old script words over new typing", async () => {
  const h = history();
  h.type(" UNDO-SENTINEL-A");
  let finish;
  const saved = new Promise((resolve) => { finish = resolve; });
  h.checkpointBrollMove({ valid: () => true, undo: () => saved, redo: async () => true });
  h.undo();
  h.type(" Typed while saving");
  finish(true); await settle();
  assert.match(h.words(), /UNDO-SENTINEL-A Typed while saving/);
  assert.equal(h.state.redo.length, 0, "typing invalidates Redo even while the move save is pending");
});

test("B-roll move: a failed Undo keeps the step available and preserves script history", async () => {
  const h = history();
  h.type(" UNDO-SENTINEL-A");
  const typed = h.words();
  let success = false;
  h.checkpointBrollMove({ valid: () => true, undo: async () => success, redo: async () => true });
  h.undo(); await settle();
  assert.equal(h.state.undo.length, 2, "a failed write does not consume the move's Undo");
  assert.equal(h.state.redo.length, 0);
  assert.equal(h.words(), typed);
  success = true;
  h.undo(); await settle();
  assert.equal(h.state.undo.length, 1);
});

test("B-roll move: a failed initial save removes its step, and a changed list invalidates old moves", async () => {
  const h = history();
  h.type(" UNDO-SENTINEL-A");
  const cancel = h.checkpointBrollMove({ valid: () => true, undo: async () => true, redo: async () => true });
  cancel();
  assert.equal(h.state.undo.length, 1);
  h.checkpointBrollMove({ valid: () => false, undo: () => assert.fail("must not write to a different list"), redo: () => assert.fail("must not write to a different list") });
  h.undo(); await settle();
  assert.doesNotMatch(h.words(), /UNDO-SENTINEL-A/);
});
