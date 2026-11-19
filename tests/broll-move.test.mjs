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
  const state = { doc: Doc.parse("# Throwaway\n\nFirst spoken paragraph.\n\nSecond spoken paragraph.\n") };
  const paras = Broll.spokenBlocks(state.doc);
  let text = Broll.addShot(Broll.newList("Throwaway"), { id: "B1", kind: "broll", what: "Throwaway shot", how: "Keep this detail", over: Broll.overFor(state.doc, Broll.wholeParas(state.doc, [paras[0].id])) });
  const broll = { token: 1, shots: [] };
  const adopt = () => { broll.shots = Broll.parseBroll(text).shots; Broll.matchShots(state.doc, broll.shots); };
  adopt();
  broll.shots[0].check = true;
  let move, queue = Promise.resolve(), writes = 0;
  const shotById = (id) => broll.shots.find((shot) => shot.id === id);
  const context = { state, broll, Doc, Broll, shotById, covered: (shot) => shot.blockIds,
    checkpointBrollMove: (entry) => { move = entry; return () => {}; },
    changeList: (mutate) => {
      const run = queue.then(() => {
        text = mutate(text); writes++; adopt();
        return text;
      });
      queue = run.catch(() => {});
      return run;
    },
    syncFlags() {}, renderBroll() {}, openShotCard() {}, shotFrameAnchor() {}, failShotCard() {},
  };
  runInNewContext(`${source.slice(start, end)}\nthis.moveShot = moveShot;`, context);
  return { broll, get text() { return text; }, get writes() { return writes; }, get move() { return move; },
    moveShot: () => context.moveShot("B1", Broll.wholeParas(state.doc, [paras[1].id])),
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
