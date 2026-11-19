import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as Doc from "../public/doc.js";
import * as Broll from "../public/broll.js";
import * as Changes from "../public/changes.js";

// Exercise moveShot itself, including its inverse and its guard on where the shot is, with a queued in-memory sidecar.
// The browser smoke covers the pointer handlers and real browser storage without exposing another public API.
function movement() {
  const source = readFileSync(new URL("../public/broll-app.js", import.meta.url), "utf8");
  const start = source.indexOf("  async function moveShot("), end = source.indexOf("  // The paragraph a drag", start);
  assert.ok(start >= 0 && end > start, "moveShot's source boundaries exist");
  const state = { doc: Doc.parse("# Throwaway\n\nFirst spoken paragraph.\n\nSecond spoken paragraph.\n\nThird spoken paragraph.\n"), undo: [], redo: [], asks: [], lastStep: null };
  const paras = Broll.spokenBlocks(state.doc);
  let text = Broll.addShot(Broll.newList("Throwaway"), { id: "B1", kind: "broll", what: "Throwaway shot", how: "Keep this detail", over: Broll.overFor(state.doc, Broll.wholeParas(state.doc, [paras[0].id])) });
  const broll = { token: 1, shots: [] };
  // As the app adopts a written list: every shot is matched to the script again and keeps its Check flag.
  const adopt = () => {
    const flagged = new Set(broll.shots.filter((shot) => shot.check).map((shot) => shot.id));
    broll.shots = Broll.parseBroll(text).shots; Broll.matchShots(state.doc, broll.shots);
    for (const shot of broll.shots) shot.check = flagged.has(shot.id);
  };
  adopt();
  broll.shots[0].check = true;
  let move, queue = Promise.resolve(), writes = 0, hold = null, broken = false;
  const shotById = (id) => broll.shots.find((shot) => shot.id === id);
  const context = { state, broll, Doc, Broll, shotById, covered: (shot) => (shot.blockIds || []).filter((id) => Doc.blockById(state.doc, id)),
    Changes, Date, UNDO_LIMIT: 300, TYPING_GROUP_MS: 1000, together: null,
    getCaret: () => null, byId: (id) => Doc.blockById(state.doc, id),
    followAnchors() {}, reanchorAll() {}, renderAll() {}, hideBar() {}, changed() {}, emit() {},
    changeList: (mutate) => {
      const gate = hold, fails = broken; hold = null; broken = false;
      const run = queue.then(async () => {
        if (gate) await gate;
        if (fails) throw new Error("Not saved.");
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
    type: (text, index = 2) => { context.checkpoint("type", paras[index].id); Doc.setContent(state.doc, paras[index].id, Doc.contentOf(Doc.blockById(state.doc, paras[index].id)) + text); },
    insertPara: () => {
      context.checkpoint("insert");
      const block = Doc.parse("Temporary inserted paragraph.\n").blocks.find((b) => b.type === "para");
      state.doc.blocks.push(block); paras.push({ id: block.id }); return paras.length - 1;
    },
    rewrite: (index, words) => { context.checkpoint("rewrite", paras[index].id); Doc.setContent(state.doc, paras[index].id, words); },
    failNextWrite: () => { broken = true; },
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
  m.type(" UNDO-SENTINEL");
  await m.moveShot();
  assert.equal(await m.move.undo(), true);
  assert.equal(Broll.parseBroll(m.text).shots[0].over, before);
  assert.equal(m.broll.shots[0].check, true, "Undo restores Check");
  assert.equal(await m.move.redo(), true);
  assert.equal(m.broll.shots[0].check, false, "Redo clears Check");
  m.replace((text) => Broll.updateShot(text, "B1", { over: '"Independent position"' }));
  const edited = m.text, writes = m.writes;
  m.undo(); await settle();
  assert.equal(m.text, edited, "the Over conflict does not overwrite the independent edit");
  assert.equal(m.writes, writes);
  assert.equal(m.move.valid(), false, "a permanent Over conflict must not trap every later Undo");
  assert.doesNotMatch(Doc.serialize(m.state.doc), /UNDO-SENTINEL/, "the same Undo skips the stale move and reaches the older typing");
  assert.equal(m.state.undo.length, 0);
  assert.equal(m.state.redo.length, 1, "only the typing can be redone");
});

test("B-roll move history: a shot changed while an Undo saves is left alone, and the Undos skip its stale moves", async () => {
  const m = movement();
  m.type(" UNDO-SENTINEL");
  await m.moveShot(1); await m.moveShot(2);
  const release = m.holdNextWrite();
  m.undo(); await settle();
  m.replace((text) => Broll.updateShot(text, "B1", { over: '"Independent position"' }));
  const edited = m.text, writes = m.writes;
  m.undo();
  release(); await settle();
  assert.equal(m.text, edited, "the changed shot is left alone");
  assert.equal(m.writes, writes);
  assert.doesNotMatch(Doc.serialize(m.state.doc), /UNDO-SENTINEL/, "the first Undo skips both stale moves and reaches the typing");
  assert.equal(m.state.undo.length, 0);
  assert.equal(m.state.redo.length, 1, "the waiting Undo found nothing left, and only the typing can be redone");
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

test("B-roll move history: Undo preserves an original hand-written quote that still matches", async () => {
  const m = movement();
  const original = '"spoken paragraph."';
  m.replace((text) => Broll.updateShot(text, "B1", { over: original }));
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
  await m.moveShot();
  m.undo(); await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, original);
});


test("B-roll move history: text Undo during held move Undo preserves both inverses and all Redos", async () => {
  const m = movement();
  const target = m.insertPara();
  await m.moveShot(target); await m.moveShot(1);
  const release = m.holdNextWrite();
  m.undo(); await settle();
  m.undo(); m.undo();
  release(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
  assert.doesNotMatch(Doc.serialize(m.state.doc), /Temporary inserted/);
  m.redo(); m.redo(); m.redo(); await settle();
  assert.match(Doc.serialize(m.state.doc), /Temporary inserted/);
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[1].id]);
});

test("B-roll move history: dragging during a held Undo returns to the restored origin", async () => {
  const m = movement();
  await m.moveShot(1);
  const release = m.holdNextWrite();
  m.undo(); await settle();
  const next = m.moveShot(2);
  release(); await next; await settle();
  assert.equal(m.broll.shots[0].check, false, "the new drag clears the Check flag the Undo before it restored");
  m.undo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
  assert.equal(m.broll.shots[0].check, true, "Undo restores the Check flag from the preceding inverse");
});


test("B-roll move history: surviving targets use current words after text Undo removes an intermediate paragraph", async () => {
  const m = movement();
  m.type("", 0);
  Doc.setContent(m.state.doc, m.paras[0].id, "UNDO-SENTINEL completely rewritten original paragraph.");
  const target = m.insertPara();
  await m.moveShot(target); await m.moveShot(1);
  const release = m.holdNextWrite();
  m.undo(); await settle();
  m.undo(); m.undo(); m.undo();
  release(); await settle();
  assert.doesNotMatch(Doc.serialize(m.state.doc), /UNDO-SENTINEL|Temporary inserted/);
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
});

test("B-roll move history: a recorded rewrite between two moves undoes and redoes step by step", async () => {
  const m = movement();
  const saved = () => Broll.matchOver(Broll.spokenBlocks(m.state.doc), Broll.parseBroll(m.text).shots[0].over);
  await m.moveShot(1);
  m.rewrite(1, "Rewritten middle paragraph while the shot covers it.");
  await m.moveShot(2);
  for (let i = 0; i < 3; i++) { m.undo(); await settle(); }
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "the third Undo reaches the first paragraph");
  assert.deepEqual(saved(), [m.paras[0].id], "the saved quote matches the first paragraph");
  assert.doesNotMatch(Doc.serialize(m.state.doc), /Rewritten middle/);
  assert.equal(m.state.redo.length, 3, "all three changes can be redone");
  for (let i = 0; i < 3; i++) { m.redo(); await settle(); }
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id]);
  assert.deepEqual(saved(), [m.paras[2].id]);
  assert.match(Doc.serialize(m.state.doc), /Rewritten middle/);
  assert.equal(m.state.undo.length, 3);
});

test("B-roll move history: a failed Undo save stops the Undo waiting behind it, and both positions stay reachable", async () => {
  const m = movement();
  await m.moveShot(1); await m.moveShot(2);
  const release = m.holdNextWrite();
  m.failNextWrite();
  m.undo(); await settle();
  m.undo();
  release(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id], "nothing moved: the save failed");
  assert.equal(m.state.undo.length, 2, "both moves keep their Undo, in their order");
  assert.equal(m.state.redo.length, 0);
  m.undo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[1].id], "the retry reaches the middle position");
  m.undo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "the first position is still reachable");
  m.redo(); m.redo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id]);
});

test("B-roll move history: a shot shown on no paragraph for a moment is still found by its saved quote", async () => {
  const m = movement();
  await m.moveShot(1);
  m.broll.shots[0].blockIds = []; // as right after the script's text was replaced, before the shots are matched again
  m.undo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
  assert.equal(m.state.redo.length, 1);
});
