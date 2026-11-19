import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as Doc from "../public/doc.js";
import * as Broll from "../public/broll.js";

// Exercise moveShot itself, including its inverse and expected-Over guard, with a queued in-memory sidecar.
// The browser smoke covers the pointer handlers and real browser storage without exposing another public API.
function movement() {
  const source = readFileSync(new URL("../public/broll-app.js", import.meta.url), "utf8");
  const start = source.indexOf("  async function moveShot("), end = source.indexOf("  // The paragraph a drag", start);
  assert.ok(start >= 0 && end > start, "moveShot's source boundaries exist");
  const state = { doc: Doc.parse("# Throwaway\n\nFirst spoken paragraph.\n\nSecond spoken paragraph.\n\nThird spoken paragraph.\n"), undo: [], redo: [], asks: [], lastStep: null };
  const paras = Broll.spokenBlocks(state.doc);
  let text = Broll.addShot(Broll.newList("Throwaway"), { id: "B1", kind: "broll", what: "Throwaway shot", how: "Keep this detail", over: Broll.overFor(state.doc, Broll.wholeParas(state.doc, [paras[0].id])) });
  const broll = { token: 1, shots: [] };
  const adopt = () => { broll.shots = Broll.parseBroll(text).shots; Broll.matchShots(state.doc, broll.shots); };
  adopt();
  broll.shots[0].check = true;
  let move, queue = Promise.resolve(), writes = 0, hold = null;
  const shotById = (id) => broll.shots.find((shot) => shot.id === id);
  const context = { state, broll, Doc, Broll, shotById, covered: (shot) => shot.blockIds,
    Date, UNDO_LIMIT: 300, TYPING_GROUP_MS: 1000, together: null,
    getCaret: () => null, byId: (id) => Doc.blockById(state.doc, id),
    followAnchors() {}, reanchorAll() {}, renderAll() {}, hideBar() {}, changed() {}, emit() {},
    changeList: (mutate) => {
      const gate = hold; hold = null;
      const run = queue.then(async () => {
        if (gate) await gate;
        text = mutate(text); writes++; adopt();
        return text;
      });
      queue = run.catch(() => {});
      return run;
    },
    syncFlags() {}, renderBroll() {}, openShotCard() {}, shotFrameAnchor() {}, failShotCard() {},
  };
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const history = app.slice(app.indexOf("function checkpoint("), app.indexOf("/* ---------- Ask anchors follow edits"));
  runInNewContext(`${history}\n${source.slice(start, end)}\nthis.moveShot = moveShot;`, context);
  const checkpoint = context.checkpointBrollMove;
  context.checkpointBrollMove = (entry) => { move = entry; return checkpoint(entry); };
  return { broll, get text() { return text; }, get writes() { return writes; }, get move() { return move; },
    state, paras, undo: () => context.undo(), redo: () => context.redo(),
    holdNextWrite: () => { let release; hold = new Promise((resolve) => { release = resolve; }); return release; },
    moveShot: (index = 1) => context.moveShot("B1", Broll.wholeParas(state.doc, [paras[index].id])),
    replace: (mutate) => { text = mutate(text); adopt(); },
  };
}

test("B-roll move: deleting the shot invalidates its history instead of blocking older typing Undo", async () => {
  const m = movement();
  await m.moveShot();
  assert.equal(m.move.valid(), true);
  m.replace((text) => Broll.removeShot(text, "B1"));
  assert.equal(m.move.valid(), false, "a deleted shot must not leave a retryable Undo step");
  const writes = m.writes;
  assert.equal(await m.move.undo(), false);
  assert.equal(m.writes, writes);
});

test("B-roll move: an Over conflict invalidates Undo without overwriting the changed shot", async () => {
  const m = movement();
  const before = Broll.parseBroll(m.text).shots[0].over;
  await m.moveShot();
  assert.equal(await m.move.undo(), true);
  assert.equal(Broll.parseBroll(m.text).shots[0].over, before);
  assert.equal(m.broll.shots[0].check, true, "Undo restores Check");
  assert.equal(await m.move.redo(), true);
  assert.equal(m.broll.shots[0].check, false, "Redo clears Check");
  m.replace((text) => Broll.updateShot(text, "B1", { over: '"Independent position"' }));
  const edited = m.text, writes = m.writes;
  assert.equal(await m.move.undo(), false);
  assert.equal(m.text, edited, "the Over conflict does not overwrite the independent edit");
  assert.equal(m.writes, writes);
  assert.equal(m.move.valid(), false, "a permanent Over conflict must not trap every later Undo");
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("B-roll move history: two fast Undos wait for the second save and restore both moves in keypress order", async () => {
  const m = movement();
  const words = Doc.serialize(m.state.doc);
  await m.moveShot(1);
  const release = m.holdNextWrite();
  const saved = m.moveShot(2);
  m.undo(); m.undo();
  release(); await saved; await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "both moves undo in keypress order");
  assert.equal(Doc.serialize(m.state.doc), words);
  m.redo(); m.redo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id], "both moves can be redone");
});

test("B-roll move history: Undo restores the original paragraph's current words and Check flag", async () => {
  const m = movement();
  Doc.setContent(m.state.doc, m.paras[0].id, "Completely rewritten original paragraph.");
  const words = Doc.serialize(m.state.doc);
  await m.moveShot();
  m.undo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "the restored shot still matches the rewritten paragraph");
  assert.equal(Doc.serialize(m.state.doc), words);
  assert.equal(m.broll.shots[0].check, true);
  m.redo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[1].id]);
});

test("B-roll move history: regenerated quotes between two moves keep the older inverse usable", async () => {
  const m = movement();
  await m.moveShot(1);
  Doc.setContent(m.state.doc, m.paras[1].id, "Rewritten middle paragraph while the shot covers it.");
  await m.moveShot(2);
  m.undo(); m.undo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
  assert.match(Doc.serialize(m.state.doc), /Rewritten middle paragraph/);
  m.redo(); m.redo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id]);
});
