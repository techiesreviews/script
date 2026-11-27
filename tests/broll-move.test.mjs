import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as Doc from "../public/doc.js";
import * as Broll from "../public/broll.js";
import * as Changes from "../public/changes.js";
import * as Span from "../public/span.js";

// Exercise moveShot itself, including its inverse and its guard on where the shot is, with a queued in-memory sidecar.
// The browser smoke covers the pointer handlers and real browser storage without exposing another public API.
function movement() {
  const source = readFileSync(new URL("../public/broll-app.js", import.meta.url), "utf8");
  const start = source.indexOf("  async function moveShot("), end = source.indexOf("  // The paragraph a drag", start);
  assert.ok(start >= 0 && end > start, "moveShot's source boundaries exist");
  const state = { doc: Doc.parse("# Throwaway\n\nFirst spoken paragraph.\n\nSecond spoken paragraph.\n\nThird spoken paragraph.\n"), undo: [], redo: [], asks: [], lastStep: null };
  const paras = Broll.spokenBlocks(state.doc);
  let text = Broll.addShot(Broll.newList("Throwaway"), { id: "B1", kind: "broll", what: "Throwaway shot", how: "Keep this detail", over: Broll.overFor(state.doc, Broll.wholeParas(state.doc, [paras[0].id])) });
  const broll = { token: 1, shots: [], flags: {}, status: "ok", moved: new Set(), placing: new Map(), unsaved: new Map() };
  // The app's own adoptBroll takes a written list in: the shots are matched to the script and keep their Check flags.
  const adopt = () => {
    broll.flags = Object.fromEntries(broll.shots.filter((shot) => shot.check).map((shot) => [shot.id, true]));
    context.adoptBroll(text);
  };
  let move, queue = Promise.resolve(), writes = 0, hold = null, broken = false, slow = null;
  const shotById = (id) => broll.shots.find((shot) => shot.id === id);
  const context = { state, broll, Doc, Broll, shotById, covered: (shot) => (shot.blockIds || []).filter((id) => Doc.blockById(state.doc, id)),
    Changes, Date, UNDO_LIMIT: 300, TYPING_GROUP_MS: 1000, together: null,
    getCaret: () => null, byId: (id) => Doc.blockById(state.doc, id),
    followAnchors() {}, reanchorAll() {}, renderAll() {}, hideBar() {}, changed() {}, emit() {},
    changeList: (mutate) => {
      const gate = hold, fails = broken, saving = slow; hold = null; broken = false; slow = null;
      const run = queue.then(async () => {
        if (gate) await gate;
        if (fails) throw new Error("Not saved.");
        const next = mutate(text);
        if (saving) await saving; // the writer itself takes a while, after the change was chosen
        text = next; writes++; adopt();
        return text;
      });
      queue = run.catch(() => {});
      return run;
    },
    syncFlags() {}, renderBroll() {}, renderBrollMarks() {}, dropGoneSuggestions() {}, openShotCard() {}, shotFrameAnchor() {}, failShotCard() {},
    // A selection across paragraphs (TOOLS-470) is never drawn here.
    setSpan() {}, brollApi: null, Span: null,
  };
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const history = app.slice(app.indexOf("function checkpoint("), app.indexOf("/* ---------- Ask anchors follow edits"));
  const matchStart = source.indexOf("  function adoptBroll("), matchEnd = source.indexOf("  // A covered line changed", matchStart);
  assert.ok(matchStart >= 0 && matchEnd > matchStart, "adoptBroll's and rematchBroll's source boundaries exist");
  const matching = source.slice(matchStart, matchEnd);
  // A selection across paragraphs that took the shot's paragraph out (TOOLS-470) places it with these two.
  const spanStart = source.indexOf("  function placeShots("), spanEnd = source.indexOf("  /* ---------- Move a shot", spanStart);
  assert.ok(spanStart >= 0 && spanEnd > spanStart, "placeShots's and followSpan's source boundaries exist");
  runInNewContext(`${history}\n${matching}\n${source.slice(spanStart, spanEnd)}\n${source.slice(start, end)}\nObject.assign(this, { moveShot, adoptBroll, rematchBroll, placeShots, followSpan });`, context);
  adopt();
  broll.shots[0].check = true;
  const checkpoint = context.checkpointBrollMove;
  context.checkpointBrollMove = (entry) => { move = entry; return checkpoint(entry); };
  return { broll, get text() { return text; }, get writes() { return writes; }, get move() { return move; },
    state, paras, undo: () => context.undo(), redo: () => context.redo(),
    type: (text, index = 2) => { context.checkpoint("type", paras[index].id); Doc.setContent(state.doc, paras[index].id, Doc.contentOf(Doc.blockById(state.doc, paras[index].id)) + text); },
    // At the end, or before the paragraph `before`.
    insertPara: (before) => {
      context.checkpoint("insert");
      const block = Doc.parse("Temporary inserted paragraph.\n").blocks.find((b) => b.type === "para");
      const at = before == null ? state.doc.blocks.length : state.doc.blocks.findIndex((b) => b.id === paras[before].id);
      state.doc.blocks.splice(at, 0, block); paras.push({ id: block.id }); return paras.length - 1;
    },
    rewrite: (index, words) => { context.checkpoint("rewrite", paras[index].id); Doc.setContent(state.doc, paras[index].id, words); },
    deletePara: (index) => { context.checkpoint("delete"); state.doc.blocks.splice(state.doc.blocks.findIndex((b) => b.id === paras[index].id), 1); },
    describeShot: (id = "B1") => context.changeList((text) => Broll.updateShot(text, id, { what: "Changed shot description" })),
    // As the app does a moment after the script changed: shots that show on no paragraph are matched again.
    rematch: () => context.rematchBroll(false),
    failNextWrite: () => { broken = true; },
    holdNextSave: () => { let release; slow = new Promise((resolve) => { release = resolve; }); return release; },
    holdNextWrite: () => { let release; hold = new Promise((resolve) => { release = resolve; }); return release; },
    moveShot: (index = 1) => context.moveShot("B1", Broll.wholeParas(state.doc, [paras[index].id])),
    placeShots: (next) => context.placeShots(next), followSpan: (moves) => context.followSpan(moves),
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

for (const source of ["original", "rewritten", "two paragraphs"]) {
  test(`B-roll move history: deleting the ${source} source while a drag waits preserves separate Undos and Redos`, async () => {
    const m = movement();
    m.type(" UNDO-SENTINEL");
    if (source === "rewritten") m.rewrite(0, "Completely rewritten source before the drag.");
    const origin = source === "two paragraphs" ? [m.paras[0].id, m.paras[1].id] : [m.paras[0].id];
    if (source === "two paragraphs") m.replace((text) => Broll.updateShot(text, "B1", { over: Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, origin)) }));
    const deleted = source === "two paragraphs" ? 1 : 0, target = source === "two paragraphs" ? 2 : 1;
    const quote = Broll.parseBroll(m.text).shots[0].over;
    const release = m.holdNextWrite();
    const saved = m.moveShot(target);
    await settle();
    m.deletePara(deleted);
    release(); await saved;
    assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[target].id]);
    assert.equal(Doc.blockById(m.state.doc, m.paras[deleted].id), undefined);

    m.undo(); await settle();
    assert.ok(Doc.blockById(m.state.doc, m.paras[deleted].id), "the first Undo restores only the deleted paragraph");
    assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[target].id]);
    m.undo(); await settle();
    assert.match(Doc.serialize(m.state.doc), /UNDO-SENTINEL/, "the move's Undo must not remove older typing");
    assert.deepEqual(m.broll.shots[0].blockIds, origin, "the second Undo returns the shot to the entire restored source");
    assert.deepEqual(Broll.matchOver(Broll.spokenBlocks(m.state.doc), Broll.parseBroll(m.text).shots[0].over), origin, "the saved quote covers the entire restored source");
    if (source === "rewritten") assert.match(Doc.serialize(m.state.doc), /Completely rewritten source before the drag/);
    else assert.equal(Broll.parseBroll(m.text).shots[0].over, quote, "Undo preserves the original matching quote");
    assert.equal(m.broll.shots[0].check, true, "Undo restores the source's Check flag");
    assert.equal(m.state.undo.length, source === "rewritten" ? 2 : 1, "older typing and any earlier rewrite keep their own Undo");

    m.redo(); await settle();
    assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[target].id], "the first Redo moves only the shot");
    assert.ok(Doc.blockById(m.state.doc, m.paras[deleted].id));
    m.redo(); await settle();
    assert.equal(Doc.blockById(m.state.doc, m.paras[deleted].id), undefined, "the second Redo deletes the source again");
    assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[target].id]);
    assert.match(Doc.serialize(m.state.doc), /UNDO-SENTINEL/);
  });
}

test("B-roll move history: a source paragraph deleted before the drag stays a separate earlier step", async () => {
  const m = movement();
  const origin = [m.paras[0].id, m.paras[1].id];
  m.replace((text) => Broll.updateShot(text, "B1", { over: Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, origin)) }));
  m.deletePara(1);
  await m.moveShot(2);
  m.undo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "Undo returns to only the source still present at the drop");
  assert.equal(Doc.blockById(m.state.doc, m.paras[1].id), undefined, "the move's Undo does not undo the earlier deletion");
  assert.equal(m.state.redo.length, 1);
  m.undo(); await settle();
  assert.ok(Doc.blockById(m.state.doc, m.paras[1].id));
  m.redo(); await settle();
  assert.equal(Doc.blockById(m.state.doc, m.paras[1].id), undefined);
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
  m.redo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id]);
});

for (const early of [false, true]) {
  test(`B-roll move history: deleting the source ${early ? "before" : "after"} a queued Undo saves preserves the next drag's history`, async () => {
    const m = movement();
    m.type(" UNDO-SENTINEL");
    await m.moveShot(1);
    const releaseUndo = m.holdNextSave();
    m.undo(); await settle();
    const saved = m.moveShot(2);
    const releaseMove = m.holdNextWrite();
    if (early) m.deletePara(0);
    releaseUndo(); await settle();
    if (!early) {
      assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "the earlier Undo restores the next drag's real source");
      m.deletePara(0);
    }
    releaseMove(); await saved;
    assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id]);

    m.undo(); await settle();
    assert.ok(Doc.blockById(m.state.doc, m.paras[0].id));
    assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id], "the first Undo restores only the source paragraph");
    m.undo(); await settle();
    assert.match(Doc.serialize(m.state.doc), /UNDO-SENTINEL/, "the second Undo must preserve older typing");
    assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "the second Undo returns the shot to the source left by the queued Undo");
    m.redo(); await settle();
    assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id]);
    assert.ok(Doc.blockById(m.state.doc, m.paras[0].id), "the first Redo moves only the shot");
    m.redo(); await settle();
    assert.equal(Doc.blockById(m.state.doc, m.paras[0].id), undefined, "the second Redo deletes the source");
    assert.match(Doc.serialize(m.state.doc), /UNDO-SENTINEL/);
  });
}

test("B-roll move history: an earlier description save cannot erase a drag's deleted source", async () => {
  const m = movement();
  m.type(" UNDO-SENTINEL");
  const release = m.holdNextSave();
  const described = m.describeShot(); await settle();
  const moved = m.moveShot(1);
  m.deletePara(0);
  release(); await described; await moved;
  m.undo(); await settle();
  assert.ok(Doc.blockById(m.state.doc, m.paras[0].id));
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[1].id]);
  m.undo(); await settle();
  assert.match(Doc.serialize(m.state.doc), /UNDO-SENTINEL/, "the move's Undo preserves older typing after the earlier save rematches the shot");
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
  assert.equal(Broll.parseBroll(m.text).shots[0].what, "Changed shot description");
  m.redo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[1].id]);
  assert.ok(Doc.blockById(m.state.doc, m.paras[0].id));
  m.redo(); await settle();
  assert.equal(Doc.blockById(m.state.doc, m.paras[0].id), undefined);
  assert.match(Doc.serialize(m.state.doc), /UNDO-SENTINEL/);
});

test("B-roll move history: a queued Undo does not pull an earlier deletion into the next drag's source", async () => {
  const m = movement();
  m.type(" UNDO-SENTINEL");
  const target = m.insertPara();
  const origin = [m.paras[0].id, m.paras[1].id];
  m.replace((text) => Broll.updateShot(text, "B1", { over: Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, origin)) }));
  await m.moveShot(2);
  const release = m.holdNextSave();
  m.undo(); await settle();
  m.deletePara(1);
  const moved = m.moveShot(target);
  release(); await moved;
  m.undo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "the move's Undo returns to the source that existed at the drop");
  assert.equal(Doc.blockById(m.state.doc, m.paras[1].id), undefined, "the earlier deletion is a separate Undo");
  m.undo(); await settle();
  assert.ok(Doc.blockById(m.state.doc, m.paras[1].id));
  m.redo(); await settle();
  assert.equal(Doc.blockById(m.state.doc, m.paras[1].id), undefined);
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
  m.redo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[target].id]);
  assert.match(Doc.serialize(m.state.doc), /UNDO-SENTINEL/);
});

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

test("B-roll move history: dragging during a held Undo returns to the restored origin when two paragraphs say the same", async () => {
  const m = movement();
  m.rewrite(0, Doc.contentOf(Doc.blockById(m.state.doc, m.paras[1].id)));
  await m.moveShot(1);
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[1].id]);
  const release = m.holdNextWrite();
  m.undo(); await settle();
  const quote = m.broll.shots[0].over;
  const next = m.moveShot(2);
  release(); await next; await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id]);
  m.undo(); await settle();
  assert.equal(m.broll.shots[0].over, quote, "the Undo before the drag moved the shot without changing its quote");
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "Undo returns the shot to the paragraph the earlier Undo restored it to");
  m.redo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id]);
});

test("B-roll move: moving a shot onto a paragraph that says the same as an earlier one clears Check and stays there", async () => {
  const m = movement();
  m.rewrite(2, Doc.contentOf(Doc.blockById(m.state.doc, m.paras[1].id)));
  assert.equal(m.broll.shots[0].check, true);
  await m.moveShot(2);
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id], "the shot stays on the paragraph it was dropped on");
  assert.equal(m.broll.shots[0].check, false, "no words changed, so moving the shot checks it");
});

// The third paragraph says the same as the second, older typing sits in a paragraph of its own, and a second shot
// shows on the second paragraph. B1, the first shot, is still on the first paragraph.
function repeated() {
  const m = movement();
  m.type(" UNDO-SENTINEL", m.insertPara());
  m.rewrite(2, Doc.contentOf(Doc.blockById(m.state.doc, m.paras[1].id)));
  const over = Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, [m.paras[1].id]));
  m.replace((text) => Broll.addShot(text, { id: "B2", kind: "broll", what: "Second shot", how: "As it is", over }));
  return { m, at: (id) => m.broll.shots.find((shot) => shot.id === id).blockIds };
}

test("B-roll move history: a shot moved onto a repeated paragraph stays there when another shot is saved, and its Undo returns it", async () => {
  const { m, at } = repeated();
  await m.moveShot(2);
  assert.deepEqual(at("B1"), [m.paras[2].id]);
  await m.describeShot("B2");
  assert.deepEqual(at("B1"), [m.paras[2].id], "saving another shot leaves the moved shot on the paragraph it was dropped on");
  assert.deepEqual(at("B2"), [m.paras[1].id], "the saved shot stays on the earlier paragraph");
  assert.equal(m.broll.shots[0].check, false, "the other shot's save adds no Check");
  const steps = m.state.undo.length;
  m.undo(); await settle();
  assert.deepEqual(at("B1"), [m.paras[0].id], "Undo returns the shot to where it came from");
  assert.match(Doc.serialize(m.state.doc), /UNDO-SENTINEL/, "the move's Undo keeps earlier typing");
  assert.equal(m.state.undo.length, steps - 1, "only the move was undone");
  m.redo(); await settle();
  assert.deepEqual(at("B1"), [m.paras[2].id], "Redo puts the shot back on the later paragraph");
  await m.describeShot("B2");
  assert.deepEqual(at("B1"), [m.paras[2].id], "and it stays there after the next save too");
});

test("B-roll move history: a shot whose repeated paragraph was deleted and brought back still undoes its move", async () => {
  const { m, at } = repeated();
  await m.moveShot(2);
  m.deletePara(2); m.rematch();
  assert.deepEqual(at("B1"), [m.paras[1].id], "with its paragraph gone, the shot shows on the one that says the same");
  m.undo(); await settle(); m.rematch();
  assert.ok(Doc.blockById(m.state.doc, m.paras[2].id), "the first Undo brings the paragraph back");
  const steps = m.state.undo.length;
  m.undo(); await settle();
  assert.deepEqual(at("B1"), [m.paras[0].id], "the second Undo returns the shot to where it came from");
  assert.match(Doc.serialize(m.state.doc), /UNDO-SENTINEL/, "the move's Undo keeps earlier typing");
  assert.equal(m.state.undo.length, steps - 1, "only the move was undone");
  m.redo(); await settle();
  assert.deepEqual(at("B1"), [m.paras[2].id], "Redo puts the shot back on the later paragraph");
});

test("B-roll move history: a shot whose first paragraph was taken out and put back by Undo and Redo still redoes its move", async () => {
  const m = movement(), at = () => m.broll.shots[0].blockIds;
  m.rewrite(2, "Temporary inserted paragraph.");
  const added = m.insertPara(2); // says the same as the third paragraph, right before it
  m.replace((text) => Broll.updateShot(text, "B1", { over: Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, [m.paras[added].id])) }));
  assert.deepEqual(at(), [m.paras[added].id]);
  await m.moveShot(1);
  m.undo(); await settle();
  assert.deepEqual(at(), [m.paras[added].id], "Undo returns the shot to the added paragraph");
  m.undo(); await settle(); m.rematch();
  assert.deepEqual(at(), [m.paras[2].id], "with the added paragraph undone, the shot shows on the one that says the same");
  m.redo(); await settle(); m.rematch();
  assert.ok(Doc.blockById(m.state.doc, m.paras[added].id), "Redo brings the added paragraph back");
  m.redo(); await settle();
  assert.deepEqual(at(), [m.paras[1].id], "the second Redo moves the shot again");
  assert.equal(m.state.redo.length, 0);
  m.undo(); await settle();
  assert.deepEqual(at(), [m.paras[added].id], "and its Undo returns it to the added paragraph");
});

test("B-roll list: another list opened for the script places its shots by their quotes, not where the old list's showed", async () => {
  const { m, at } = repeated();
  await m.moveShot(2);
  assert.deepEqual(at("B1"), [m.paras[2].id]);
  m.broll.token++; // as linking another list does; its B1 has the same quote
  m.replace((text) => text);
  assert.deepEqual(at("B1"), [m.paras[1].id], "the other list's shot shows on the first paragraph that says its quote");
});

test("B-roll list: a range whose end is written later takes it in at the next save of another shot", async () => {
  const { m, at } = repeated();
  m.replace((text) => Broll.updateShot(text, "B1", { over: '"First spoken paragraph." through "Written later."' }));
  assert.deepEqual(at("B1"), [m.paras[0].id], "without its end the range shows on its first paragraph");
  m.rewrite(2, "Written later.");
  await m.describeShot("B2");
  assert.deepEqual(at("B1"), [m.paras[0].id, m.paras[1].id, m.paras[2].id]);
});

test("B-roll move history: a shot placed again by other words of a repeated paragraph is not taken back by its old move", async () => {
  const { m, at } = repeated();
  await m.moveShot(2);
  m.replace((text) => Broll.updateShot(text, "B1", { over: '"Second spoken"' }));
  assert.deepEqual(at("B1"), [m.paras[1].id], "the new quote finds the first paragraph that says it");
  const edited = m.text, writes = m.writes;
  m.undo(); await settle();
  assert.equal(m.text, edited, "the old move's Undo does not overwrite the new place");
  assert.equal(m.writes, writes);
  assert.equal(m.move.valid(), false);
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

test("B-roll move history: typing while an Undo finds its move stale is not undone by that Undo", async () => {
  const m = movement();
  m.type(" OLD");
  await m.moveShot(1);
  const release = m.holdNextWrite();
  m.undo(); await settle();
  m.replace((text) => Broll.updateShot(text, "B1", { over: '"Independent position"' }));
  const edited = m.text;
  m.type(" NEW");
  release(); await settle();
  assert.match(Doc.serialize(m.state.doc), / OLD NEW/, "the skipped move's Undo takes neither the new typing nor the older typing");
  assert.equal(m.state.undo.length, 2, "both typing steps keep their Undo, and the stale move is gone");
  assert.equal(m.text, edited);
});

test("B-roll move history: a drag waiting behind an Undo's save lands on its paragraph's current words", async () => {
  const m = movement();
  const saved = () => Broll.matchOver(Broll.spokenBlocks(m.state.doc), Broll.parseBroll(m.text).shots[0].over);
  await m.moveShot(1);
  const release = m.holdNextWrite();
  m.undo(); await settle();
  const next = m.moveShot(2);
  m.rewrite(2, "Rewritten last paragraph while the drag waits.");
  release(); await next; await settle();
  assert.deepEqual(saved(), [m.paras[2].id], "the saved quote matches the paragraph the shot was dropped on");
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id]);
  assert.match(Doc.serialize(m.state.doc), /Rewritten last paragraph/);
  m.undo(); await settle();
  m.undo(); await settle();
  assert.doesNotMatch(Doc.serialize(m.state.doc), /Rewritten last paragraph/);
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "the drag's Undo returns to where the Undo before it left the shot");
  m.redo(); await settle();
  assert.deepEqual(saved(), [m.paras[2].id], "Redo moves the shot onto the paragraph's words as they are then");
  m.redo(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id], "the shot stays on its paragraph when the rewrite is redone");
  assert.match(Doc.serialize(m.state.doc), /Rewritten last paragraph/);
});

test("B-roll move history: a drag whose paragraph is gone when its turn comes never happened", async () => {
  const m = movement();
  const first = Broll.parseBroll(m.text).shots[0].over;
  const target = m.insertPara();
  await m.moveShot(1);
  const release = m.holdNextWrite();
  m.undo(); await settle();
  const next = m.moveShot(target);
  m.state.doc.blocks.splice(m.state.doc.blocks.findIndex((b) => b.id === m.paras[target].id), 1);
  release(); await next; await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "the shot stays where the Undo left it");
  assert.equal(Broll.parseBroll(m.text).shots[0].over, first);
  assert.equal(m.state.undo.length, 1, "only the paragraph's own step is left: the drag left none");
});

test("B-roll move history: a drag onto the place a waiting Undo restores moves nothing and leaves no step", async () => {
  const m = movement();
  await m.moveShot(1);
  const release = m.holdNextWrite();
  m.undo(); await settle();
  const next = m.moveShot(0);
  release(); await next; await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
  assert.equal(m.broll.shots[0].check, true, "nothing moved, so the Check flag the Undo restored stays");
  assert.equal(m.state.undo.length, 0, "a move that moved nothing is no Undo step");
  assert.equal(m.state.redo.length, 0, "the drop was a new action all the same: Redo of the Undo before it is gone");
});

test("B-roll move history: an Undo waiting behind a drag that moves nothing is not spent on older typing", async () => {
  const m = movement();
  m.type(" OLD");
  await m.moveShot(1);
  const release = m.holdNextWrite();
  m.undo();
  const next = m.moveShot(0);
  m.undo();
  release(); await next; await settle();
  assert.match(Doc.serialize(m.state.doc), / OLD/);
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id]);
  assert.equal(m.state.undo.length, 1, "the typing keeps its Undo");
});

test("B-roll move history: words typed into the target paragraph while a move or its Undo saves keep the shot there, with Check", async () => {
  const m = movement();
  m.broll.shots[0].check = false;
  let release = m.holdNextSave();
  const moved = m.moveShot(1); await settle();
  m.rewrite(1, "Rewritten middle paragraph while the move saves.");
  release(); await moved; await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[1].id], "the moved shot stays on the paragraph it was dropped on");
  assert.equal(m.broll.shots[0].check, true, "its words changed during the save");
  m.broll.shots[0].check = false;
  release = m.holdNextSave();
  m.undo(); await settle(); // the rewrite
  m.undo(); await settle(); // the move, whose save is held
  m.rewrite(0, "Rewritten first paragraph while the Undo saves.");
  release(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[0].id], "the shot stays on the paragraph Undo returned it to");
  assert.equal(m.broll.shots[0].check, true);
  assert.match(Doc.serialize(m.state.doc), /Rewritten first paragraph/);
});

test("B-roll move history: words typed into the target paragraph while a Redo saves keep the shot there, with Check", async () => {
  const m = movement();
  await m.moveShot(1);
  m.undo(); await settle();
  const release = m.holdNextSave();
  m.redo(); await settle();
  m.rewrite(1, "Rewritten middle paragraph while the Redo saves.");
  release(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[1].id]);
  assert.equal(m.broll.shots[0].check, true);
});

test("B-roll move history: words added to the target paragraph while a move, its Undo or its Redo saves give the shot Check", async () => {
  // The added words leave the saved quote matching, so only the paragraph's words tell that it changed.
  const during = async (m, start, index) => {
    m.broll.shots[0].check = false;
    const release = m.holdNextSave();
    const done = start(); await settle();
    m.type(" added while saving", index);
    release(); await done; await settle();
    assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[index].id]);
    assert.equal(m.broll.shots[0].check, true);
  };
  let m = movement();
  await during(m, () => m.moveShot(1), 1);
  m = movement();
  m.broll.shots[0].check = false;
  await m.moveShot(1);
  await during(m, () => m.undo(), 0);
  m = movement();
  await m.moveShot(1);
  m.undo(); await settle();
  await during(m, () => m.redo(), 1);
});

// TOOLS-470: a selection across paragraphs took the shot's paragraph out, so the shot went to the joined one. Its Undo
// and Redo write the shot's quote back and forth; each write meets the list as the one before left it.
const takeOut = (m, index) => {
  const i = m.state.doc.blocks.findIndex((b) => b.id === m.paras[index].id);
  return m.state.doc.blocks.splice(i, 1)[0];
};
const putBack = (m, block, before) => {
  m.state.doc.blocks.splice(m.state.doc.blocks.findIndex((b) => b.id === m.paras[before].id), 0, block);
};

test("B-roll span: a shot moved onto a paragraph with no words keeps its Over in the list, never an empty one", async () => {
  const m = movement();
  const old = Broll.parseBroll(m.text).shots[0].over;
  takeOut(m, 0);
  m.rewrite(1, "");
  const writes = m.writes;
  m.followSpan([{ id: "B1", blockIds: [m.paras[1].id], moved: true }]);
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, old, "the list keeps the shot's Over");
  assert.equal(m.writes, writes, "nothing is written");
  // A Redo whose shot was changed since and whose paragraph is gone again places it the same way.
  const r = movement();
  takeOut(r, 0);
  r.rewrite(1, "");
  const redoWrites = r.writes;
  r.placeShots({ token: r.broll.token, shots: { B1: { blockIds: [r.paras[1].id], expect: "\"Older words\"", over: "\"Older words\"" } }, moved: ["B1"] });
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(Broll.parseBroll(r.text).shots[0].over, old, "the list keeps the shot's Over after the Redo too");
  assert.equal(r.writes, redoWrites, "and the Redo writes nothing");
});

test("B-roll span: a shot sent on from an emptied paragraph keeps the next paragraph through more typing and a later save", async () => {
  // Whole paragraphs replaced from their very start (Delete, a first key with no letters, composed text): followShots
  // sends the shot to the next paragraph with words. Its Over then quotes those words, so it stays there.
  // The span's own code picks the paragraph: the first two paragraphs, selected from the very start, typed over with ".
  const m = movement();
  const second = Doc.contentOf(Doc.blockById(m.state.doc, m.paras[1].id)).length;
  const r = Span.replaceSpan(m.state.doc, Span.spanOf(m.state.doc, { id: m.paras[0].id, offset: 0 }, { id: m.paras[1].id, offset: second }), "\"");
  m.state.doc = r.doc;
  const moves = Span.followShots(r.doc, m.broll.shots, r);
  assert.deepEqual(moves, [{ id: "B1", blockIds: [m.paras[2].id], moved: true }], "followShots sends the shot to the third paragraph");
  m.followSpan(moves);
  for (let i = 0; i < 4; i++) await settle();
  const list = Broll.spokenBlocks(m.state.doc);
  assert.ok(Broll.fitsOver(list, [m.paras[2].id], Broll.parseBroll(m.text).shots[0].over), "the list's Over quotes the next paragraph");
  Doc.setContent(m.state.doc, r.id, "\"New words typed after the quote mark.");
  await m.describeShot(); await settle();
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[2].id], "after more typing and a later save the shot is still there");
});

test("B-roll span: Undo and Redo pressed while the shot's saves wait leave the list with the Redo's quote", async () => {
  const m = movement();
  const old = Broll.parseBroll(m.text).shots[0].over;
  const gone = takeOut(m, 0);
  const releaseSpan = m.holdNextWrite();
  const undoStep = m.followSpan([{ id: "B1", blockIds: [m.paras[1].id], moved: true }]);
  const joined = m.broll.shots[0].over;
  assert.notEqual(joined, old, "the shot's quote follows it to the paragraph it shows on now");
  // Undo before the span's save lands, then that save lands, then Redo while the Undo's save still waits.
  putBack(m, gone, 1);
  const releaseUndo = m.holdNextWrite();
  const redoStep = m.placeShots(undoStep);
  releaseSpan(); await settle(); await settle();
  takeOut(m, 0);
  m.placeShots(redoStep);
  releaseUndo();
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, joined, "the last step pressed, Redo, is what the list says");
});

test("B-roll span: a moved shot whose paragraph is changed while its save waits stays there, with Check", async () => {
  const m = movement();
  m.broll.shots[0].check = false;
  takeOut(m, 0);
  const release = m.holdNextWrite();
  m.followSpan([{ id: "B1", blockIds: [m.paras[1].id], moved: true }]);
  // The person changes the words of the paragraph the shot went to before its save lands; it gets "Check".
  m.rewrite(1, "Other words entirely, typed while the save waited.");
  Broll.touchShots(m.state.doc, m.broll.shots);
  release();
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[1].id], "the shot stays on the paragraph it was moved to");
  assert.equal(m.broll.shots[0].check, true, "and keeps its Check");
});

// A change across paragraphs as the app makes it (applySpan): the span's own code changes the script and says where the
// shots go, and followSpan places them. Returns replaceSpan's result and the shots' step for Undo.
const across = (m, from, to, text = "", options = {}) => {
  const r = Span.replaceSpan(m.state.doc, Span.spanOf(m.state.doc, from, to), text, options);
  const moves = Span.followShots(r.doc, m.broll.shots, r);
  m.state.doc = r.doc;
  return { r, undoStep: moves.length ? m.followSpan(moves) : null };
};
// Three paragraphs where the second and the third end in the same words, with the shot on the second.
const leadOriginal = () => {
  const m = movement();
  m.rewrite(0, "Lead gone");
  m.rewrite(1, "Gone original");
  m.rewrite(2, "Gone Lead original");
  m.replace((text) => Broll.updateShot(text, "B1", { over: Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, [m.paras[1].id])) }));
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[1].id], "the shot starts on the second paragraph");
  return m;
};
const wordsOf = (m, id) => Doc.contentOf(Doc.blockById(m.state.doc, id));

test("B-roll span: a second change across paragraphs that keeps the shot's quote keeps the shot there when the first one's save lands", async () => {
  // TOOLS-485. The first change gives the shot a new quote, whose save waits. The second moves the shot to another
  // paragraph that says the same, so its quote needs no write: the waiting save must not put it back.
  const m = leadOriginal();
  const release = m.holdNextWrite();
  // Delete from "gone" through "Gone ": the first two paragraphs join as "Lead original".
  across(m, { id: m.paras[0].id, offset: 5 }, { id: m.paras[1].id, offset: 5 });
  assert.equal(wordsOf(m, m.paras[0].id), "Lead original");
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[0].id], "the shot follows to the joined paragraph");
  const joined = m.broll.shots[0].over;
  // Enter over a selection from the joined paragraph's start through the last "Gone ": the first paragraph is left
  // empty and "Lead original" starts a new one.
  const { r } = across(m, { id: m.paras[0].id, offset: 0 }, { id: m.paras[2].id, offset: 5 }, "", { split: true });
  const beside = r.caret.id;
  assert.equal(wordsOf(m, m.paras[0].id), "", "the first paragraph is empty");
  assert.equal(wordsOf(m, beside), "Lead original");
  assert.deepEqual([...m.broll.shots[0].blockIds], [beside], "the shot follows its words to the new paragraph");
  assert.equal(m.broll.shots[0].over, joined, "with the quote it had: nothing more to write");
  release();
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, joined, "the held save wrote the quote");
  assert.deepEqual([...m.broll.shots[0].blockIds], [beside], "the shot stays beside \"Lead original\" when the held save lands");
  assert.ok(m.broll.moved.has("B1"), "still with \"Moved here\"");
  assert.equal(m.broll.placing.size, 0, "and nothing is kept for a save that has landed");
  await m.describeShot(); await settle();
  assert.deepEqual([...m.broll.shots[0].blockIds], [beside], "and after another save of the list");
});

test("B-roll span: Undo and Redo of a change that kept the shot's quote, pressed while an earlier save waits, leave the shot where Redo put it", async () => {
  // The same two changes, then Undo and Redo of the second while the first one's save still waits: neither writes, and
  // the shot is where each shows it, also once that save lands.
  const m = leadOriginal();
  const release = m.holdNextWrite();
  across(m, { id: m.paras[0].id, offset: 5 }, { id: m.paras[1].id, offset: 5 });
  const before = Doc.cloneDoc(m.state.doc);
  const { r, undoStep } = across(m, { id: m.paras[0].id, offset: 0 }, { id: m.paras[2].id, offset: 5 }, "", { split: true });
  const after = Doc.cloneDoc(m.state.doc), writes = m.writes;
  // As the app's Undo and Redo do (restore): the script as the step left it, then the shots of that step.
  m.state.doc = before;
  const redoStep = m.placeShots(undoStep);
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[0].id], "Undo shows the shot on the joined paragraph");
  m.state.doc = after;
  m.placeShots(redoStep);
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "Redo shows it beside \"Lead original\" again");
  release();
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(m.writes, writes + 1, "only the held save writes");
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "and the shot stays there when the held save lands");
  assert.equal(m.broll.placing.size, 0);
});

test("B-roll span: Undo of a change that sent the shot to a paragraph that stays, pressed while an earlier save waits, puts the shot back for good", async () => {
  // A guard for the note that follows the shot since TOOLS-485 (this passed before it): the second change sends the
  // shot to a paragraph that is still there after its Undo, so a note left on it would take the shot along again.
  const m = leadOriginal();
  m.rewrite(2, "Lead original");
  const intro = m.insertPara(0);
  const release = m.holdNextWrite();
  across(m, { id: m.paras[0].id, offset: 5 }, { id: m.paras[1].id, offset: 5 });
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[0].id], "the shot follows to the joined paragraph");
  const before = Doc.cloneDoc(m.state.doc);
  // Delete from the very start of the paragraph before through the joined one: the shot goes to the next paragraph
  // with words, which says "Lead original" too.
  const { undoStep } = across(m, { id: m.paras[intro].id, offset: 0 }, { id: m.paras[0].id, offset: "Lead original".length });
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[2].id], "the shot goes on to the third paragraph");
  m.state.doc = before;
  m.placeShots(undoStep);
  release();
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[0].id], "after the Undo the shot is on the joined paragraph when the held save lands");
  await m.describeShot(); await settle();
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[0].id], "and after another save of the list");
  assert.equal(m.broll.placing.size, 0);
});

test("B-roll span: a shot a second change left on no paragraph, found by its quote since, stays there when the first one's save lands", async () => {
  // TOOLS-485, found by sweeping this path. The second change leaves no paragraph with words, so the shot shows on
  // none and its quote needs no write. Its words are typed again and the shot is found beside them: the waiting save
  // must neither put it back on the paragraph its own step showed (now empty) nor take it off the script.
  const m = leadOriginal();
  const release = m.holdNextWrite();
  across(m, { id: m.paras[0].id, offset: 5 }, { id: m.paras[1].id, offset: 5 });
  const joined = m.broll.shots[0].over;
  // Enter over everything from the joined paragraph's start to the script's end: two empty paragraphs are left.
  const { r } = across(m, { id: m.paras[0].id, offset: 0 }, { id: m.paras[2].id, offset: "Gone Lead original".length }, "", { split: true });
  assert.equal(wordsOf(m, m.paras[0].id), "", "the first paragraph is empty");
  assert.deepEqual([...m.broll.shots[0].blockIds], [], "the shot shows on no paragraph");
  assert.equal(m.broll.shots[0].over, joined, "with the quote it had: nothing more to write");
  Doc.setContent(m.state.doc, r.caret.id, "Lead original");
  m.rematch();
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "typed again, its words have the shot beside them");
  release();
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, joined, "the held save wrote the quote");
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "the shot stays beside its words when the held save lands");
  assert.equal(m.broll.placing.size, 0);
  await m.describeShot(); await settle();
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "and after another save of the list");
});

test("B-roll span: when the waiting save fails after a second change moved the shot on, the shot stays where it shows", async () => {
  // A guard (review round 1; this passed before TOOLS-485 too): the note the second change brought up to date belongs
  // to a save that then fails. Nothing is kept for it, and the shot stays beside its words through another list save.
  const m = leadOriginal();
  const release = m.holdNextWrite();
  m.failNextWrite();
  across(m, { id: m.paras[0].id, offset: 5 }, { id: m.paras[1].id, offset: 5 });
  const joined = m.broll.shots[0].over, listed = Broll.parseBroll(m.text).shots[0].over;
  const { r } = across(m, { id: m.paras[0].id, offset: 0 }, { id: m.paras[2].id, offset: 5 }, "", { split: true });
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "the shot follows its words to the new paragraph");
  release();
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, listed, "the save failed: the list holds the quote from before");
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "the shot stays beside \"Lead original\"");
  assert.equal(m.broll.placing.size, 0, "nothing is kept for the save that failed");
  await m.describeShot(); await settle();
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "and after another save of the list");
  assert.equal(m.broll.shots[0].over, joined, "with the quote of the words it shows beside");
});

test("B-roll span: with two saves waiting, a third change that keeps the shot's quote keeps the shot there as each save lands", async () => {
  // TOOLS-485, review round 1. Two changes each give the shot a new quote and both saves wait; a third moves the shot
  // on to a paragraph that says the same. Only the newest save's note follows the shot, and neither save moves it.
  const m = leadOriginal();
  m.rewrite(2, "Gone Intro original");
  const intro = m.insertPara(0);
  m.rewrite(intro, "Intro gone");
  const first = m.holdNextWrite();
  across(m, { id: m.paras[0].id, offset: 5 }, { id: m.paras[1].id, offset: 5 });
  const one = m.broll.shots[0].over;
  // Delete from "gone" in the paragraph before through "Lead " in the joined one: they join as "Intro original".
  const second = m.holdNextWrite();
  across(m, { id: m.paras[intro].id, offset: 6 }, { id: m.paras[0].id, offset: 5 });
  assert.equal(wordsOf(m, m.paras[intro].id), "Intro original");
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[intro].id], "the shot follows to the second joined paragraph");
  const two = m.broll.shots[0].over;
  assert.notEqual(two, one, "with a new quote: a second save waits");
  // Enter over a selection from that paragraph's start through the last "Gone ": it is left empty.
  const { r } = across(m, { id: m.paras[intro].id, offset: 0 }, { id: m.paras[2].id, offset: 5 }, "", { split: true });
  assert.equal(wordsOf(m, m.paras[intro].id), "");
  assert.equal(wordsOf(m, r.caret.id), "Intro original");
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "the shot follows its words to the new paragraph");
  assert.equal(m.broll.shots[0].over, two, "with the quote it had: nothing more to write");
  first();
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, one, "the first save wrote its quote");
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "the shot stays there when the first save lands");
  second();
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, two, "the list ends with the second quote");
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "and when the second lands");
  assert.equal(m.broll.placing.size, 0);
  await m.describeShot(); await settle();
  assert.deepEqual([...m.broll.shots[0].blockIds], [r.caret.id], "and after another save of the list");
});

test("B-roll span: Undo and Redo while saves wait never move a shot to an earlier paragraph that says the same", async () => {
  const m = movement();
  m.rewrite(0, "Same words in two places.");
  m.rewrite(2, "Same words in two places.");
  m.replace((text) => Broll.updateShot(text, "B1", { over: Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, [m.paras[1].id])) }));
  assert.deepEqual(m.broll.shots[0].blockIds, [m.paras[1].id]);
  const gone = takeOut(m, 1);
  const releaseSpan = m.holdNextWrite();
  const undoStep = m.followSpan([{ id: "B1", blockIds: [m.paras[2].id], moved: true }]);
  putBack(m, gone, 2);
  const releaseUndo = m.holdNextWrite();
  const redoStep = m.placeShots(undoStep);
  releaseSpan(); await settle(); await settle();
  takeOut(m, 1);
  const releaseRedo = m.holdNextWrite();
  m.placeShots(redoStep);
  releaseUndo(); await settle(); await settle();
  releaseRedo();
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[2].id], "the shot shows where Redo put it, not on the first paragraph with the same words");
});

test("B-roll span: a shot moved on its own after a span edit keeps that place when the span edit is undone", async () => {
  const m = movement();
  const gone = takeOut(m, 0);
  const undoStep = m.followSpan([{ id: "B1", blockIds: [m.paras[1].id], moved: true }]);
  for (let i = 0; i < 4; i++) await settle();
  await m.moveShot(2);
  const newer = Broll.parseBroll(m.text).shots[0].over;
  putBack(m, gone, 1);
  m.placeShots(undoStep);
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, newer, "the list keeps the newer move");
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[2].id], "and the shot shows there");
});

test("B-roll span: a shot changed outside the page while the span edit saves shows where the list says after its Undo", async () => {
  const m = movement();
  const gone = takeOut(m, 0);
  const releaseSpan = m.holdNextWrite();
  const undoStep = m.followSpan([{ id: "B1", blockIds: [m.paras[1].id], moved: true }]);
  // The agent puts the shot on the third paragraph while the span edit's save waits.
  m.replace((text) => Broll.updateShot(text, "B1", { over: Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, [m.paras[2].id])) }));
  const theirs = Broll.parseBroll(m.text).shots[0].over;
  putBack(m, gone, 1);
  m.placeShots(undoStep);
  releaseSpan();
  for (let i = 0; i < 8; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, theirs, "neither save writes over the agent's change");
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[2].id], "the shot shows where the list says");
});

test("B-roll span: after a shot's save failed, the next span edit saves the shot where it shows", async () => {
  const m = movement();
  takeOut(m, 0);
  m.failNextWrite();
  m.followSpan([{ id: "B1", blockIds: [m.paras[1].id], moved: true }]);
  for (let i = 0; i < 4; i++) await settle();
  // Another save of the list in between leaves the shot where it shows.
  await m.describeShot();
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[1].id], "the shot still shows where the failed step put it");
  takeOut(m, 1);
  m.followSpan([{ id: "B1", blockIds: [m.paras[2].id], moved: true }]);
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, [m.paras[2].id])), "the list has the second edit's quote");
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[2].id], "and the shot shows there");
});

test("B-roll span: after a shot's save failed, the agent moving it still wins", async () => {
  const m = movement();
  takeOut(m, 0);
  m.failNextWrite();
  m.followSpan([{ id: "B1", blockIds: [m.paras[1].id], moved: true }]);
  for (let i = 0; i < 4; i++) await settle();
  m.replace((text) => Broll.updateShot(text, "B1", { over: Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, [m.paras[2].id])) }));
  const theirs = Broll.parseBroll(m.text).shots[0].over;
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[2].id], "the shot shows where the agent put it");
  takeOut(m, 1);
  m.followSpan([{ id: "B1", blockIds: [m.paras[2].id], moved: false }]);
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(Broll.parseBroll(m.text).shots[0].over, theirs, "the agent's quote stays in the list");
});

test("B-roll span: Redo that takes out the paragraph a shot was changed onto since puts the shot at the join", async () => {
  const m = movement();
  const gone = takeOut(m, 0);
  const undoStep = m.followSpan([{ id: "B1", blockIds: [m.paras[1].id], moved: true }]);
  for (let i = 0; i < 4; i++) await settle();
  putBack(m, gone, 1);
  const redoStep = m.placeShots(undoStep);
  for (let i = 0; i < 4; i++) await settle();
  // The agent gives the shot other words of the paragraph the span takes out.
  m.replace((text) => Broll.updateShot(text, "B1", { over: "\"First spoken\"" }));
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[0].id]);
  takeOut(m, 0);
  m.placeShots(redoStep);
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[1].id], "the shot goes to the join");
  assert.deepEqual([...Broll.matchOver(Broll.spokenBlocks(m.state.doc), Broll.parseBroll(m.text).shots[0].over)], [m.paras[1].id], "and the list says so");
  assert.ok(m.broll.moved.has("B1"), "with \"Moved here\"");
});

test("B-roll span: Redo leaves a shot moved on its own since without \"Moved here\"", async () => {
  const m = movement();
  const gone = takeOut(m, 0);
  const undoStep = m.followSpan([{ id: "B1", blockIds: [m.paras[1].id], moved: true }]);
  for (let i = 0; i < 4; i++) await settle();
  putBack(m, gone, 1);
  const redoStep = m.placeShots(undoStep);
  for (let i = 0; i < 4; i++) await settle();
  await m.moveShot(2);
  takeOut(m, 0);
  m.placeShots(redoStep);
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual([...m.broll.shots[0].blockIds], [m.paras[2].id], "the shot stays where it was moved");
  assert.ok(!m.broll.moved.has("B1"), "Redo moved nothing");
});

test("B-roll span: Undo after another list was opened leaves that list's shot alone", async () => {
  const m = movement();
  takeOut(m, 0);
  const undoStep = m.followSpan([{ id: "B1", blockIds: [m.paras[1].id], moved: true }]);
  for (let i = 0; i < 4; i++) await settle();
  // Another list for the script, with a shot of the same name.
  m.broll.token++;
  m.replace(() => Broll.addShot(Broll.newList("Throwaway"), { id: "B1", kind: "broll", what: "Another list's shot", how: "x", over: Broll.overFor(m.state.doc, Broll.wholeParas(m.state.doc, [m.paras[2].id])) }));
  const theirs = Broll.parseBroll(m.text).shots[0].over, writes = m.writes;
  assert.equal(m.placeShots(undoStep), null, "nothing to put back in another list");
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(m.writes, writes);
  assert.equal(Broll.parseBroll(m.text).shots[0].over, theirs);
  assert.equal(m.broll.shots[0].over, theirs);
});
