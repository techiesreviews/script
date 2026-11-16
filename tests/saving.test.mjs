import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The saving module through its own interface, with a folder in memory, a clock the test moves and local storage in a
// Map. The browser check `scripts/smoke-saving.mjs` runs the same paths in the real editor.
const { createSaving, createLeftCopies, tabLocks, AUTOSAVE_MS } = await import("../public/saving.js");

function folder() {
  let tick = 1000;
  const disk = new Map();
  const gates = new Map(); // name -> promise a write waits for
  const log = [];
  return {
    disk, log,
    hold(name) { let open; gates.set(name, new Promise((r) => { open = r; })); return () => { gates.delete(name); open(); }; },
    outside(name, text) { disk.set(name, { text, lastModified: ++tick }); },
    port: {
      async write(handle, text) {
        if (handle.fail) throw new Error("The disk is full.");
        log.push([handle.name, text]);
        await gates.get(handle.name);
        if (handle.fail) throw new Error("The disk is full.");
        disk.set(handle.name, { text, lastModified: ++tick });
        return tick;
      },
      async file(handle) { const f = disk.get(handle.name); return { lastModified: f.lastModified, text: async () => f.text }; },
      async permitted(handle, ask) { (handle.asked ??= []).push(ask); return handle.allow !== false; },
      pickSave: null,
      download(text, name) { log.push(["download", name, text]); },
    },
  };
}
const clock = () => {
  const c = { t: 50_000, timers: new Map(), seq: 0 };
  c.port = { now: () => c.t, later: (fn, ms) => { const id = ++c.seq; c.timers.set(id, { fn, at: c.t + ms }); return id; }, cancel: (id) => c.timers.delete(id) };
  c.run = (ms) => { c.t += ms; for (const [id, x] of [...c.timers]) if (x.at <= c.t) { c.timers.delete(id); x.fn(); } };
  return c;
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const until = async (ok) => { for (let i = 0; i < 200 && !ok(); i++) await settle(); assert.ok(ok(), "settled"); };

// A stand-in editor: the open script's record and its text, as app.js keeps them.
function setup({ text = "# A\n\nOne.\n", handle = { name: "a.md" } } = {}) {
  const files = folder(), time = clock(), store = new Map(), events = [];
  if (handle) files.outside(handle.name, text);
  const script = { handle: null, name: "", savedText: "", fileModified: 0, saving: false, autoSaving: false, saveError: "", needsPermission: false, conflict: false, inBrowser: false, blank: "" };
  const ed = { doc: { id: 1 }, text, ready: true, paused: false };
  const ports = {
    script,
    editor: { ready: () => ed.ready, doc: () => ed.doc, text: () => ed.text, dirty: () => ed.text !== script.savedText, paused: () => ed.paused },
    files: files.port,
    browser: { name: async () => "from-title.md", create: async (name, t) => { files.outside(name, t); return { handle: { name }, modified: files.disk.get(name).lastModified }; } },
    drafts: { get: (k) => (store.has(k) ? structuredClone(store.get(k)) : null), set: (k, v) => { store.set(k, structuredClone(v)); return true; }, del: (k) => store.delete(k) },
    clock: time.port,
    on: {
      status: () => events.push("status"),
      conflict: (at) => events.push(["conflict", at]),
      written: async (h) => events.push(["written", h.name]),
      done: (moved) => events.push(["done", !!moved]),
      renamed: (from, to, o) => events.push(["renamed", from, to, o]),
      placed: (h, o) => events.push(["placed", h.name, o]),
    },
  };
  const saving = createSaving(ports);
  // Opening a script, as loadText does: the record starts from the file.
  const open = (h, t) => {
    ed.doc = { id: Math.random() };
    ed.text = t;
    saving.open({ handle: h, name: h?.name ?? "demo.md", savedText: t, modified: h ? files.disk.get(h.name).lastModified : 0 });
  };
  if (handle) open(handle, text);
  return { files, time, store, events, script, ed, saving, open, ports };
}

test("saving: the interface is small, and app.js reaches saving only through it", () => {
  const { saving } = setup();
  assert.deepEqual(Object.keys(saving).sort(), ["allow", "drafts", "flush", "open", "queued", "save", "saveAs", "saveMine", "schedule", "stop"]);
  assert.deepEqual(Object.keys(saving.drafts).sort(), ["del", "get", "move", "set"]);
  assert.equal(AUTOSAVE_MS, 1500);
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /save-queue\.js|(Q|SaveQueue)\.(queueSave|settleQueue|splitQueue|changedOnDisk)/, "the save queue is the module's own");
  assert.doesNotMatch(app, /\.createWritable\(|function (save|saveAs|saveInBrowser|writeLeft|diskConflict|keepDraft|finishSave)\(/, "no saving code is left in app.js");
  assert.doesNotMatch(app, /`draft:\$\{/, "drafts are kept by the module");
});

test("saving: auto-save waits 1.5 s on the clock it is given, then writes to the open file", async () => {
  const { files, time, script, ed, saving, events } = setup();
  ed.text = "# A\n\nOne. Two.\n";
  saving.schedule();
  time.run(AUTOSAVE_MS - 1);
  await settle();
  assert.equal(files.log.length, 0);
  time.run(1);
  await until(() => !script.saving);
  assert.deepEqual(files.log, [["a.md", "# A\n\nOne. Two.\n"]]);
  assert.equal(script.savedText, ed.text);
  assert.equal(script.fileModified, files.disk.get("a.md").lastModified);
  assert.equal(script.savedAt, time.t);
  assert.deepEqual(files.disk.get("a.md").text, ed.text);
  assert.ok(events.some((e) => e[0] === "written" && e[1] === "a.md"));
  // An auto-save never shows the browser's permission prompt.
  assert.deepEqual(script.handle.asked, [false]);
  assert.deepEqual(saving.queued(), []);
});

test("saving: nothing is scheduled while a \"/\" command is typed, for a clean script, or after a conflict", () => {
  const { time, script, ed, saving } = setup();
  saving.schedule();
  assert.equal(time.timers.size, 0, "clean");
  ed.text += "x";
  ed.paused = true;
  saving.schedule();
  assert.equal(time.timers.size, 0, "paused");
  ed.paused = false;
  script.conflict = true;
  saving.schedule();
  assert.equal(time.timers.size, 0, "conflict");
  script.conflict = false;
  saving.schedule();
  assert.equal(time.timers.size, 1);
  saving.stop();
  assert.equal(time.timers.size, 0, "stop clears it");
});

test("saving: opening another script stops a waiting auto-save and starts the record from the new file", async () => {
  const s = setup();
  s.files.outside("b.md", "# B\n");
  s.ed.text = "# A\n\nOne. Waiting.\n";
  s.saving.schedule();
  Object.assign(s.script, { conflict: true, saveError: "x", needsPermission: true });
  s.open({ name: "b.md" }, "# B\n");
  s.time.run(AUTOSAVE_MS);
  await settle();
  assert.equal(s.time.timers.size, 0);
  assert.equal(s.files.log.length, 0);
  assert.deepEqual([s.script.name, s.script.conflict, s.script.saveError, s.script.needsPermission, s.script.savedText], ["b.md", false, "", false, "# B\n"]);
});

test("saving: a click that waits for an auto-save of the same script runs after it, with its own flags", async () => {
  const s = setup();
  const A = s.script.handle, release = s.files.hold("a.md");
  s.ed.text = "# A\n\nOne. Auto.\n";
  s.saving.save({ auto: true });
  await settle();
  s.ed.text = "# A\n\nOne. Auto. Click.\n";
  s.saving.save();
  release();
  await until(() => !s.script.saving && s.files.log.length === 2);
  assert.deepEqual(s.files.log.map(([, t]) => t), ["# A\n\nOne. Auto.\n", "# A\n\nOne. Auto. Click.\n"]);
  assert.deepEqual(A.asked, [false, true], "the click may show the browser's prompt");
  assert.equal(s.script.savedText, "# A\n\nOne. Auto. Click.\n");
});

test("saving: a save always goes to the script it was made for, also when another script opens while it runs", async () => {
  const s = setup();
  const A = s.script.handle, B = { name: "b.md" };
  s.files.outside("b.md", "# B\n\nBee.\n");
  const release = s.files.hold("a.md");
  s.ed.text = "# A\n\nOne. Alpha one.\n";
  s.saving.save(); // Ctrl+S: A's write starts and waits
  await settle();
  s.ed.text = "# A\n\nOne. Alpha one. Alpha two.\n";
  s.saving.save({ auto: true }); // waits for its turn
  s.saving.flush(); // leaving A, as loadText does
  s.open(B, "# B\n\nBee.\n");
  s.ed.text = "# B\n\nBee. Bravo.\n";
  s.saving.save(); // Ctrl+S on B while A's write runs
  assert.deepEqual(s.saving.queued().map((h) => h.name).sort(), ["a.md", "b.md"]);
  release();
  await until(() => !s.script.saving && s.files.disk.get("b.md").text.includes("Bravo"));
  assert.equal(s.files.disk.get("a.md").text, "# A\n\nOne. Alpha one. Alpha two.\n");
  assert.equal(s.files.disk.get("b.md").text, "# B\n\nBee. Bravo.\n");
  assert.ok(s.files.log.every(([name, text]) => (name === "a.md" ? !text.includes("Bee") : !text.includes("Alpha"))), JSON.stringify(s.files.log));
  // B's record follows only B's own write.
  assert.equal(s.script.handle, B);
  assert.equal(s.script.savedText, "# B\n\nBee. Bravo.\n");
  assert.equal(s.script.fileModified, s.files.disk.get("b.md").lastModified);
  // A's left request was written with auto-save rules: no permission prompt.
  assert.ok(A.asked.slice(1).every((ask) => ask === false), JSON.stringify(A.asked));
});

test("saving: a script the person left that cannot be written keeps its text as a draft stamped by the clock", async () => {
  const s = setup();
  const release = s.files.hold("a.md");
  s.ed.text = "# A\n\nOne. First.\n";
  s.saving.save();
  await settle();
  s.store.set("draft:a.md", { text: null, at: 1, asks: [{ id: "k" }], broll: { s1: true } });
  s.ed.text = "# A\n\nOne. Lost?\n";
  s.saving.save({ auto: true });
  s.script.handle.fail = true; // the next write of a.md fails
  s.files.outside("b.md", "# B\n");
  s.open({ name: "b.md" }, "# B\n");
  s.time.t = 77_000;
  release();
  await until(() => !s.script.saving);
  assert.deepEqual(s.store.get("draft:a.md"), { text: "# A\n\nOne. Lost?\n", at: 77_000, asks: [{ id: "k" }], broll: { s1: true } });
  assert.equal(s.script.saveError, "", "A's problem does not show on B");
});

test("saving: a file changed on disk is not written over; Save mine writes this version", async () => {
  const s = setup();
  s.files.outside("a.md", "# A\n\nElsewhere.\n");
  s.ed.text = "# A\n\nOne. Mine.\n";
  await s.saving.save({ auto: true });
  const at = s.files.disk.get("a.md").lastModified;
  assert.deepEqual(s.events.filter((e) => e[0] === "conflict"), [["conflict", at]]);
  assert.equal(s.script.conflict, true);
  assert.equal(s.files.disk.get("a.md").text, "# A\n\nElsewhere.\n");
  s.saving.schedule();
  assert.equal(s.time.timers.size, 0, "auto-save waits for the person's choice");
  await s.saving.saveMine();
  await until(() => !s.script.saving);
  assert.equal(s.files.disk.get("a.md").text, "# A\n\nOne. Mine.\n");
  assert.equal(s.script.conflict, false);
  // The same text on disk with a newer time is no conflict.
  s.files.outside("a.md", "# A\n\nOne. Mine.\n");
  s.ed.text = "# A\n\nOne. Mine. More.\n";
  await s.saving.save({ auto: true });
  assert.equal(s.files.disk.get("a.md").text, "# A\n\nOne. Mine. More.\n");
});

test("saving: without write access auto-save asks for Allow saving; a click shows the reason; allow() saves", async () => {
  const s = setup();
  const A = s.script.handle;
  A.allow = false;
  s.ed.text = "# A\n\nNeeds access.\n";
  await s.saving.save({ auto: true });
  assert.equal(s.script.needsPermission, true);
  assert.deepEqual(A.asked, [false]);
  assert.equal(s.files.log.length, 0);
  await s.saving.save();
  assert.equal(s.script.saveError, "No permission to write this file.");
  assert.deepEqual(A.asked, [false, true]);
  A.allow = true;
  await s.saving.allow();
  await until(() => !s.script.saving && s.files.log.length === 1);
  assert.equal(s.script.needsPermission, false);
  assert.equal(s.files.disk.get("a.md").text, "# A\n\nNeeds access.\n");
});

test("saving: a script without a file goes into the browser under its title's name; one opened meanwhile is left alone", async () => {
  const s = setup({ handle: null });
  s.open(null, "# From title\n");
  s.ed.text = "# From title\n\nTyped.\n";
  await s.saving.save({ auto: true });
  assert.equal(s.files.disk.size, 0, "auto-save never asks where to save");
  await s.saving.save();
  assert.equal(s.files.disk.get("from-title.md").text, "# From title\n\nTyped.\n");
  assert.equal(s.script.name, "from-title.md");
  assert.equal(s.script.inBrowser, true);
  assert.equal(s.script.savedText, s.ed.text);
  assert.deepEqual(s.events.filter((e) => e[0] === "renamed" || e[0] === "placed"), [["renamed", "demo.md", "from-title.md", { clear: false }], ["placed", "from-title.md", { browser: true }]]);
  // Another script opens while the browser copy is made: its record and its B-roll keys are not touched.
  const t = setup({ handle: null });
  t.open(null, "# From title\n");
  t.ed.text = "# From title\n\nTyped.\n";
  const run = t.saving.save();
  t.open(null, "# Other\n");
  await run;
  assert.equal(t.script.name, "demo.md");
  assert.equal(t.script.handle, null);
  assert.ok(!t.events.some((e) => e[0] === "renamed"), "no B-roll link or draft moves to the other script");
});

test("saving: Save as moves a browser script to a file: renamed with its keys cleared, then placed", async () => {
  const s = setup({ handle: null });
  s.files.outside("move-me.md", "# Move me\n");
  s.saving.open({ handle: { name: "move-me.md" }, name: "move-me.md", browser: true, savedText: "# Move me\n", modified: 1 });
  s.ed.text = "# Move me\n\nLine.\n";
  s.store.set("draft:move-me.md", { text: "x", at: 1, asks: [] });
  s.files.port.pickSave = async (suggested) => { s.events.push(["picked", suggested]); return { name: "moved.md" }; };
  await s.saving.saveAs();
  assert.equal(s.files.disk.get("moved.md").text, "# Move me\n\nLine.\n");
  assert.deepEqual(s.events.filter((e) => ["picked", "renamed", "placed"].includes(e[0])), [
    ["picked", "move-me.md"], ["renamed", "move-me.md", "moved.md", { clear: true }], ["placed", "moved.md", { was: { name: "move-me.md" }, at: 1 }], // at: the browser copy's time as this tab last read or wrote it
  ]);
  assert.equal(s.store.has("draft:move-me.md"), false, "the old name's draft goes");
  assert.deepEqual([s.script.name, s.script.inBrowser, s.script.savedText], ["moved.md", false, s.ed.text]);
  // A failed write keeps the script where it was and says why.
  const f = setup({ handle: null });
  f.saving.open({ handle: { name: "keep.md" }, name: "keep.md", browser: true, savedText: "", modified: 1 });
  f.files.port.pickSave = async () => ({ name: "x.md", fail: true });
  await f.saving.saveAs();
  assert.deepEqual([f.script.saveError, f.script.saving, f.script.name, f.script.inBrowser], ["The disk is full.", false, "keep.md", true]);
  assert.ok(!f.events.some((e) => e[0] === "renamed" || e[0] === "placed"));
  // A cancelled picker changes nothing.
  s.files.port.pickSave = async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); };
  s.ed.text += "More.\n";
  await s.saving.saveAs();
  assert.equal(s.script.name, "moved.md");
  assert.equal(s.script.saveError, "");
  // Where files can't be picked, a browser script stays and a copy downloads.
  const d = setup({ handle: null });
  d.saving.open({ handle: { name: "b.md" }, name: "b.md", browser: true, savedText: "", modified: 1 });
  await d.saving.saveAs();
  assert.deepEqual(d.files.log, [["download", "b.md", d.ed.text]]);
});

test("saving: another script opened while Save as writes keeps its own file, name, draft and B-roll keys", async () => {
  const s = setup({ handle: null });
  s.files.outside("a.md", "# A\n");
  s.files.outside("b.md", "# B\n");
  s.saving.open({ handle: { name: "a.md" }, name: "a.md", browser: true, savedText: "# A\n", modified: 1 });
  s.ed.text = "# A\n\nMoving.\n";
  s.store.set("draft:a.md", { text: null, at: 1, asks: [{ id: "a" }] });
  s.store.set("draft:b.md", { text: null, at: 1, asks: [{ id: "b" }] });
  const release = s.files.hold("moved.md");
  s.files.port.pickSave = async () => ({ name: "moved.md" });
  const run = s.saving.saveAs();
  await settle();
  const B = { name: "b.md" };
  s.open(B, "# B\n");
  release();
  await run;
  assert.equal(s.files.disk.get("moved.md").text, "# A\n\nMoving.\n", "the picked file is written");
  assert.deepEqual([s.script.handle, s.script.name, s.script.inBrowser, s.script.savedText], [B, "b.md", false, "# B\n"]);
  assert.equal(s.script.fileModified, s.files.disk.get("b.md").lastModified);
  assert.ok(!s.events.some((e) => e[0] === "renamed"), "no draft or B-roll link moves with the other script open");
  assert.ok(!s.events.some((e) => e[0] === "placed" && e[2].was), "the browser copy of A stays");
  assert.deepEqual(s.store.get("draft:b.md"), { text: null, at: 1, asks: [{ id: "b" }] });
  assert.deepEqual(s.store.get("draft:a.md"), { text: null, at: 1, asks: [{ id: "a" }] });
  s.ed.text = "# B\n\nBee.\n";
  await s.saving.save();
  assert.equal(s.files.disk.get("b.md").text, "# B\n\nBee.\n");
  assert.equal(s.files.disk.get("moved.md").text, "# A\n\nMoving.\n");
});

test("saving: after a Save as that landed with another script open, that script's waiting click runs; a failed write says nothing there", async () => {
  const s = setup({ handle: null });
  s.files.outside("a.md", "# A\n");
  s.files.outside("b.md", "# B\n");
  s.saving.open({ handle: { name: "a.md" }, name: "a.md", browser: true, savedText: "# A\n", modified: 1 });
  const release = s.files.hold("moved.md");
  s.files.port.pickSave = async () => ({ name: "moved.md" });
  const run = s.saving.saveAs();
  await settle();
  const B = { name: "b.md" };
  s.open(B, "# B\n");
  s.ed.text = "# B\n\nClicked.\n";
  s.saving.save(); // Ctrl+S on B while A's file is written
  release();
  await run;
  await until(() => !s.script.saving && s.files.disk.get("b.md").text.includes("Clicked."));
  assert.deepEqual(B.asked, [true], "B's click keeps its flags");
  // The same with a write that fails after B opened: B shows no error and nothing moves.
  const f = setup({ handle: null });
  f.saving.open({ handle: { name: "a.md" }, name: "a.md", browser: true, savedText: "", modified: 1 });
  const target = { name: "moved.md" }, go = f.files.hold("moved.md");
  f.files.port.pickSave = async () => target;
  const failing = f.saving.saveAs();
  await settle();
  f.files.outside("b.md", "# B\n");
  f.open({ name: "b.md" }, "# B\n");
  target.fail = true;
  go();
  await failing;
  assert.deepEqual([f.script.saveError, f.script.name], ["", "b.md"]);
  assert.ok(!f.events.some((e) => e[0] === "placed" || e[0] === "renamed"));
});

test("saving: scripts left one after another while Save as writes each get their own save, or a draft", async () => {
  for (const refuse of [false, true]) {
    const s = setup({ handle: null });
    for (const n of ["a.md", "b.md", "c.md"]) s.files.outside(n, `# ${n}\n`);
    s.saving.open({ handle: { name: "a.md" }, name: "a.md", browser: true, savedText: "# a.md\n", modified: 1 });
    const release = s.files.hold("moved.md");
    s.files.port.pickSave = async () => ({ name: "moved.md" });
    const run = s.saving.saveAs();
    await settle();
    const B = { name: "b.md", fail: refuse }, C = { name: "c.md" };
    s.open(B, "# b.md\n");
    s.ed.text = "# b.md\n\nBee.\n";
    s.saving.save();
    s.open(C, "# c.md\n");
    s.ed.text = "# c.md\n\nSea.\n";
    s.saving.save();
    s.time.t = 88_000;
    release();
    await run;
    await until(() => !s.script.saving);
    assert.equal(s.files.disk.get("c.md").text, "# c.md\n\nSea.\n");
    assert.deepEqual(s.saving.queued(), []);
    if (refuse) {
      assert.equal(s.files.disk.get("b.md").text, "# b.md\n");
      assert.deepEqual(s.store.get("draft:b.md"), { text: "# b.md\n\nBee.\n", at: 88_000, asks: [] });
    } else assert.equal(s.files.disk.get("b.md").text, "# b.md\n\nBee.\n");
  }
});

test("saving: a Ctrl+S on the demo that waits for its Save as never saves or renames another script without a file", async () => {
  const s = setup({ handle: null });
  s.open(null, "# Demo\n");
  s.ed.text = "# Demo\n\nMoving.\n";
  const release = s.files.hold("moved.md");
  s.files.port.pickSave = async () => ({ name: "moved.md" });
  const run = s.saving.saveAs();
  await settle();
  s.ed.text = "# Demo\n\nMoving.\n\nPressed.\n";
  s.saving.save(); // Ctrl+S on the demo while its file is written: it waits, with no file of its own
  s.time.t = 77_000;
  // Leaving the demo, the app keeps its draft (persistDraft in loadText), then opens another script without a file.
  s.store.set("draft:demo.md", { text: s.ed.text, at: s.time.t, asks: [] });
  s.open(null, "# Other\n");
  release();
  await run;
  await until(() => !s.script.saving);
  assert.equal(s.files.disk.get("moved.md").text, "# Demo\n\nMoving.\n", "the picked file holds the text from the click");
  assert.equal(s.files.disk.has("from-title.md"), false, "the other script is not saved into the browser");
  assert.ok(!s.events.some((e) => e[0] === "renamed"), "nothing is renamed");
  assert.deepEqual([s.script.name, s.script.handle, s.script.inBrowser], ["demo.md", null, false]);
  assert.deepEqual(s.store.get("draft:demo.md"), { text: "# Demo\n\nMoving.\n\nPressed.\n", at: 77_000, asks: [] }, "the demo's newer words stay in its draft");
  assert.deepEqual(s.saving.queued(), []);
});

test("saving: a waiting Ctrl+S without a file never replaces a newer draft the app kept when the script was left", async () => {
  const s = setup({ handle: null });
  s.open(null, "# Demo\n");
  s.ed.text = "# Demo\n\nMoving.\n";
  const release = s.files.hold("moved.md");
  s.files.port.pickSave = async () => ({ name: "moved.md" });
  const run = s.saving.saveAs();
  await settle();
  s.ed.text = "# Demo\n\nMoving.\n\nPressed.\n";
  s.time.t = 70_000;
  s.saving.save(); // Ctrl+S while the file is written
  s.ed.text += "\nTyped after.\n";
  s.time.t = 71_000;
  // Leaving the demo, the app keeps its draft first (persistDraft in loadText), then opens the other script.
  s.store.set("draft:demo.md", { text: s.ed.text, at: s.time.t, asks: [{ id: "q" }] });
  s.open(null, "# Other\n");
  release();
  await run;
  await until(() => !s.script.saving);
  assert.deepEqual(s.store.get("draft:demo.md"), { text: "# Demo\n\nMoving.\n\nPressed.\n\nTyped after.\n", at: 71_000, asks: [{ id: "q" }] }, "the words typed after the Ctrl+S stay in the draft");
});

test("saving: a waiting Ctrl+S without a file brings back no words the person took out before leaving", async () => {
  for (const kept of [{ text: null, at: 71_000, asks: [{ id: "q" }] }, null]) {
    const s = setup({ handle: null });
    s.open(null, "# Demo\n");
    s.ed.text = "# Demo\n\nMoving.\n";
    const release = s.files.hold("moved.md");
    s.files.port.pickSave = async () => ({ name: "moved.md" });
    const run = s.saving.saveAs();
    await settle();
    s.ed.text = "# Demo\n\nMoving.\n\nPressed.\n";
    s.time.t = 70_000;
    s.saving.save();
    s.ed.text = "# Demo\n"; // undone back to the saved text
    s.time.t = 71_000;
    // Nothing unsaved: the app keeps a draft without text (open asks), or none.
    if (kept) s.store.set("draft:demo.md", kept); else s.store.delete("draft:demo.md");
    s.open(null, "# Other\n");
    release();
    await run;
    await until(() => !s.script.saving);
    assert.deepEqual(s.store.get("draft:demo.md") ?? null, kept, "the Ctrl+S words do not come back as unsaved changes");
  }
});

test("saving: a Ctrl+S on the demo that waits for another script's write never runs on the next script without a file", async () => {
  const s = setup();
  const release = s.files.hold("a.md");
  s.ed.text = "# A\n\nWriting.\n";
  const run = s.saving.save(); // a.md is written
  await settle();
  s.open(null, "# Demo\n");
  s.ed.text = "# Demo\n\nPressed.\n";
  s.saving.save(); // Ctrl+S on the demo waits, with no file of its own
  s.store.set("draft:demo.md", { text: s.ed.text, at: 1, asks: [] }); // kept on leaving (loadText)
  s.open(null, "# Other\n");
  release();
  await run;
  await until(() => !s.script.saving);
  assert.equal(s.files.disk.get("a.md").text, "# A\n\nWriting.\n");
  assert.equal(s.files.disk.has("from-title.md"), false, "nothing is saved into the browser");
  assert.ok(!s.events.some((e) => e[0] === "renamed"));
  assert.deepEqual(s.store.get("draft:demo.md"), { text: "# Demo\n\nPressed.\n", at: 1, asks: [] });
  assert.deepEqual(s.saving.queued(), []);
});

test("saving: Ctrl+S where neither the browser nor a file picker can save downloads the script", async () => {
  const s = setup({ handle: null });
  s.open(null, "# Demo\n");
  s.ed.text = "# Demo\n\nTyped.\n";
  const plain = createSaving({ ...s.ports, browser: null });
  s.time.t = 90_000;
  await plain.save();
  assert.deepEqual(s.files.log, [["download", "demo.md", "# Demo\n\nTyped.\n"]]);
  assert.deepEqual([s.script.savedText, s.script.fileModified, s.script.savedAt, s.script.handle], ["# Demo\n\nTyped.\n", 90_000, 90_000, null]);
});

test("saving: drafts are kept by script name, and move with a rename", () => {
  const { saving, store } = setup();
  saving.drafts.set("a.md", { text: "t", at: 5, asks: [] });
  assert.deepEqual(store.get("draft:a.md"), { text: "t", at: 5, asks: [] });
  assert.deepEqual(saving.drafts.get("a.md"), { text: "t", at: 5, asks: [] });
  saving.drafts.move("a.md", "b.md");
  assert.equal(saving.drafts.get("a.md"), null);
  assert.deepEqual(saving.drafts.get("b.md"), { text: "t", at: 5, asks: [] });
  saving.drafts.del("b.md");
  assert.equal(store.size, 0);
});

test("saving: a browser copy left behind is deleted by a later listing; two listings at once never delete a script that took the freed name", async () => {
  const store = new Map(), files = new Map([["stuck.md", "old copy"]]);
  let refuse = true, gate = null;
  const dir = {
    async removeEntry(name) { if (refuse) throw Object.assign(new Error("in use"), { name: "NoModificationAllowedError" }); if (!files.has(name)) throw Object.assign(new Error("gone"), { name: "NotFoundError" }); files.delete(name); },
    async getFileHandle(name) { if (!files.has(name)) throw Object.assign(new Error("gone"), { name: "NotFoundError" }); return { name, getFile: async () => ({ lastModified: 1 }) }; },
  };
  const ports = { store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, dir: async () => { if (gate) await gate; return dir; } };
  const copies = createLeftCopies(ports);
  await copies.afterMove("stuck.md", 1);
  assert.deepEqual(copies.names(), ["stuck.md"], "a refused delete keeps the name");
  refuse = false;
  // Listing A found the copy and stops for a moment; listing B (or another tab) deletes it and frees the name.
  let open;
  gate = new Promise((r) => { open = r; });
  const a = copies.listed(["stuck.md"], new Set(["stuck.md"]));
  gate = null;
  await copies.listed(["stuck.md"], new Set(["stuck.md"]));
  assert.deepEqual([copies.names(), files.has("stuck.md")], [[], false]);
  files.set("stuck.md", "a new script"); // a new script may take the name now
  open();
  await a;
  assert.equal(files.get("stuck.md"), "a new script", "the slower listing leaves the new script alone");
  // A full listing frees the names whose copy went some other way (an older tab, cleared storage), and deletes the rest.
  refuse = true;
  files.set("kept.md", "copy"); files.set("other.md", "a script");
  await copies.afterMove("kept.md", 1);
  await copies.afterMove("gone.md", 1);
  store.set("movedCopies", [...copies.names(), "later.md"]);
  refuse = false;
  await copies.listed(["kept.md", "gone.md"], new Set(["kept.md", "other.md", "stuck.md"]));
  assert.deepEqual([copies.names(), files.has("kept.md"), files.has("other.md")], [["later.md"], false, true], "a name added after the listing started stays");
});

test("saving: a second cleanup waits until the first has freed the name, and leaves a script that took it alone", async () => {
  const store = new Map([["movedCopies", ["stuck.md"]], ["movedCopyTimes", { "stuck.md": 1 }]]), files = new Map([["stuck.md", "old copy"]]);
  let held = null;
  const dir = { async getFileHandle(name) { if (!files.has(name)) throw Object.assign(new Error("gone"), { name: "NotFoundError" }); return { getFile: async () => ({ lastModified: 1 }) }; }, async removeEntry(name) {
    if (!held) { let open; held = { done: new Promise((r) => { open = r; }), open }; await held.done; } // the first delete waits
    if (!files.has(name)) throw Object.assign(new Error("gone"), { name: "NotFoundError" });
    files.delete(name);
  } };
  const copies = createLeftCopies({ store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, dir: async () => dir, locks: tabLocks() });
  const a = copies.listed(["stuck.md"], new Set(["stuck.md"]));
  const b = copies.listed(["stuck.md"], new Set(["stuck.md"]));
  for (let i = 0; i < 20; i++) await settle();
  let taken = false;
  if (!copies.names().includes("stuck.md")) { files.set("stuck.md", "a new script"); taken = true; } // a new script may take the name once it is free
  held.open();
  await Promise.all([a, b]);
  assert.equal(taken, false, "the name stays kept until the waiting delete is done");
  assert.deepEqual([files.has("stuck.md"), copies.names()], [false, []]);
});

test("saving: a listing frees a name only when its copy is really gone, also if the name was kept again meanwhile", async () => {
  const store = new Map([["movedCopies", ["x.md"]]]), files = new Map();
  const dir = {
    async removeEntry(name) { throw Object.assign(new Error("in use"), { name: "NoModificationAllowedError" }); },
    async getFileHandle(name) { if (!files.has(name)) throw Object.assign(new Error("gone"), { name: "NotFoundError" }); return { name }; },
  };
  const copies = createLeftCopies({ store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, dir: async () => dir });
  // The listing started with x.md kept and did not find it; meanwhile another script's copy x.md was left behind again.
  files.set("x.md", "a newer copy");
  await copies.listed(["x.md"], new Set());
  assert.deepEqual(copies.names(), ["x.md"], "the newer copy keeps its name kept");
  files.delete("x.md");
  await copies.listed(["x.md"], new Set());
  assert.deepEqual(copies.names(), []);
});

test("saving: a listing never shows a left-behind copy that another cleanup deleted while it walked the folder", async () => {
  const store = new Map([["movedCopies", ["stuck.md"]]]), files = new Map([["stuck.md", "old copy"], ["a.md", "a script"]]);
  const notFound = () => Object.assign(new Error("gone"), { name: "NotFoundError" });
  const handle = (name) => ({ kind: "file", name, async getFile() { if (!files.has(name)) throw notFound(); return { lastModified: 5 }; } });
  let pause = null;
  const dir = {
    async *values() { for (const name of ["stuck.md", "a.md"]) { if (pause) await pause.wait; yield handle(name); } },
    async removeEntry(name) { if (!files.has(name)) throw notFound(); files.delete(name); },
    async getFileHandle(name) { if (!files.has(name)) throw notFound(); return handle(name); },
  };
  const copies = createLeftCopies({ store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, dir: async () => dir });
  // The walk stops before it yields stuck.md; meanwhile another cleanup deletes the copy and frees the name.
  let go;
  pause = { wait: new Promise((r) => { go = r; }) };
  const listing = copies.list();
  await settle();
  pause = null;
  files.delete("stuck.md");
  store.set("movedCopies", []);
  go();
  const rows = await listing;
  assert.deepEqual(rows.map((r) => r.name), ["a.md"], "the deleted copy is not listed");
  // A new script that took the name is listed with its own file.
  files.set("stuck.md", "a new script");
  assert.deepEqual((await copies.list()).map((r) => [r.name, r.at]), [["stuck.md", 5], ["a.md", 5]]);
});

test("saving: a listing keeps a script it can't read the time of, and still shows the scripts when a cleanup fails", async () => {
  const store = new Map([["movedCopies", ["stuck.md"]]]);
  const handle = (name, fail) => ({ kind: "file", name, async getFile() { if (fail) throw Object.assign(new Error("denied"), { name: fail }); return { lastModified: 9 }; } });
  let calls = 0;
  const dir = { async *values() { yield handle("stuck.md"); yield handle("a.md"); yield handle("b.md", "NotAllowedError"); } };
  const copies = createLeftCopies({ store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, dir: async () => { if (++calls > 1) throw new Error("storage went away"); return dir; } });
  assert.deepEqual((await copies.list()).map((r) => [r.name, r.at]), [["a.md", 9], ["b.md", 0]]);
  assert.deepEqual(copies.names(), ["stuck.md"], "the copy's name stays kept for the next listing");
});

test("saving: a folder walk that fails partway still shows the scripts found so far, and frees no kept name", async () => {
  const store = new Map([["movedCopies", ["gone.md"]]]);
  const dir = { async *values() { yield { kind: "file", name: "a.md", async getFile() { return { lastModified: 3 }; } }; throw new Error("the folder stopped listing"); } };
  const copies = createLeftCopies({ store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, dir: async () => dir });
  assert.deepEqual((await copies.list()).map((r) => r.name), ["a.md"]);
  assert.deepEqual(copies.names(), ["gone.md"], "a partial walk is no proof the copy is gone");
});

test("saving: a left-behind copy that was saved into after the move is kept and shows again on the listing that finds it", async () => {
  const store = new Map(), files = new Map([["moved.md", { text: "at the move", lastModified: 100 }], ["other.md", { text: "untouched", lastModified: 100 }]]);
  let refuse = true;
  const notFound = () => Object.assign(new Error("gone"), { name: "NotFoundError" });
  const handle = (name) => ({ kind: "file", name, async getFile() { if (!files.has(name)) throw notFound(); return { lastModified: files.get(name).lastModified }; } });
  const dir = {
    async *values() { for (const name of [...files.keys()]) yield handle(name); },
    async removeEntry(name) { if (refuse) throw Object.assign(new Error("in use"), { name: "NoModificationAllowedError" }); if (!files.has(name)) throw notFound(); files.delete(name); },
    async getFileHandle(name) { if (!files.has(name)) throw notFound(); return handle(name); },
  };
  const copies = createLeftCopies({ store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, dir: async () => dir });
  await copies.afterMove("moved.md", 100);
  await copies.afterMove("other.md", 100);
  assert.deepEqual(copies.names(), ["moved.md", "other.md"]);
  assert.deepEqual(store.get("movedCopyTimes"), { "moved.md": 100, "other.md": 100 });
  // Newer words were saved into the browser copy since.
  files.set("moved.md", { text: "newer words", lastModified: 200 });
  refuse = false;
  const rows = await copies.list();
  assert.equal(files.get("moved.md")?.text, "newer words", "the copy with newer words is not deleted");
  assert.equal(files.has("other.md"), false, "an unchanged copy goes");
  assert.deepEqual([copies.names(), store.get("movedCopyTimes")], [[], {}], "both names are free, with their times");
  assert.deepEqual(rows.map((r) => [r.name, r.at, r.browser]), [["moved.md", 200, true]], "the listing that found it changed shows it as a browser script");
  assert.deepEqual((await copies.list()).map((r) => r.name), ["moved.md"], "and so does the next one, once");
});

// Two tabs of one browser: one scripts folder, one local storage and one lock manager between them. `hooks.remove(name)`
// runs as a delete starts (after the cleanup found the copy unchanged); `hooks.read(name)` may refuse a read.
function tabs(files, kept = {}) {
  const store = new Map([["movedCopies", Object.keys(kept)], ["movedCopyTimes", { ...kept }]]), locks = tabLocks(), hooks = {};
  const notFound = () => Object.assign(new Error("gone"), { name: "NotFoundError" });
  const handle = (name) => ({ kind: "file", name, async getFile() { if (!files.has(name)) throw notFound(); hooks.read?.(name); return { lastModified: files.get(name).lastModified }; } });
  const dir = {
    async *values() { for (const name of [...files.keys()]) yield handle(name); },
    async removeEntry(name) { await hooks.remove?.(name); if (!files.has(name)) throw notFound(); files.delete(name); },
    async getFileHandle(name) { if (!files.has(name)) throw notFound(); return handle(name); },
  };
  const tab = () => createLeftCopies({ store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, dir: async () => dir, locks });
  // A tab's save into a browser script, as writeHandle does it: a file that is gone can't be written.
  const write = (name, text, lastModified) => async () => { if (!files.has(name)) throw notFound(); files.set(name, { text, lastModified }); };
  return { store, hooks, tab, write, notFound };
}

test("saving, two tabs: a browser copy another tab has open is never deleted, not by the move and not by a cleanup; it shows again with that tab's words once the tab leaves it", async () => {
  const files = new Map([["x.md", { text: "at the move", lastModified: 100 }], ["same.md", { text: "never changed", lastModified: 100 }]]);
  const { tab, write } = tabs(files);
  const a = tab(), b = tab(), c = tab();
  // Tabs A and B have the browser script x.md open; tab A moves it to a file.
  a.open("x.md");
  b.open("x.md");
  await a.open(null);
  await a.afterMove("x.md", 100);
  assert.equal(files.get("x.md")?.text, "at the move", "the move leaves the copy tab B has open");
  assert.deepEqual(a.names(), ["x.md"], "its name is kept off the list");
  // Tab B keeps saving into it; cleanups from tab A (and from tab B's own switcher) leave it alone.
  assert.deepEqual((await a.list()).map((r) => r.name), ["same.md"]);
  await b.saving("x.md", write("x.md", "tab B's words", 200));
  assert.deepEqual([(await a.list()).map((r) => r.name), (await b.list()).map((r) => r.name)], [["same.md"], ["same.md"]]);
  assert.equal(files.get("x.md")?.text, "tab B's words");
  // Tab B leaves the script: the next listing shows it again, as a browser script with tab B's words.
  await b.open("other.md");
  assert.deepEqual((await a.list()).map((r) => [r.name, r.at]), [["same.md", 100], ["x.md", 200]]);
  assert.deepEqual([files.get("x.md")?.text, a.names()], ["tab B's words", []]);
  // A copy nobody saved into goes once the other tab has left it.
  a.open("same.md");
  c.open("same.md");
  await a.open(null);
  await a.afterMove("same.md", 100);
  assert.deepEqual([files.has("same.md"), a.names()], [true, ["same.md"]], "kept while tab C has it open");
  await c.open(null);
  assert.deepEqual((await a.list()).map((r) => r.name), ["x.md"]);
  assert.deepEqual([files.has("same.md"), a.names()], [false, []], "deleted by the next listing");
});

test("saving, two tabs: a copy saved into before the move is not the script that moved: it stays, by the moving tab's own time for it", async () => {
  const files = new Map([["early.md", { text: "tab B saved this and left", lastModified: 200 }], ["open.md", { text: "tab B saved this and has it open", lastModified: 200 }]]);
  const { tab, store } = tabs(files);
  const a = tab(), b = tab();
  // Tab A last read both scripts at time 100; tab B saved into them since. Nobody has early.md open now.
  a.open("early.md");
  await a.open(null);
  await a.afterMove("early.md", 100);
  assert.deepEqual([files.get("early.md")?.text, a.names()], ["tab B saved this and left", []], "kept, and listed as a browser script");
  assert.deepEqual((await a.list()).map((r) => r.name), ["early.md", "open.md"]);
  // Tab B still has open.md open: the time kept with the name is tab A's, not the newer time of the copy.
  b.open("open.md");
  a.open("open.md");
  await a.open(null);
  await a.afterMove("open.md", 100);
  assert.deepEqual([a.names(), store.get("movedCopyTimes")], [["open.md"], { "open.md": 100 }]);
  await b.open(null);
  assert.deepEqual((await a.list()).map((r) => r.name), ["early.md", "open.md"], "shown again once tab B leaves it");
  assert.equal(files.get("open.md")?.text, "tab B saved this and has it open");
});

test("saving, two tabs: a save into a copy and a cleanup of it never cross: a running save keeps the copy, a save that comes during the delete waits and is refused", async () => {
  const files = new Map([["x.md", { text: "at the move", lastModified: 100 }], ["y.md", { text: "at the move", lastModified: 100 }]]);
  const { tab, write, hooks } = tabs(files, { "x.md": 100, "y.md": 100 });
  const a = tab(), b = tab();
  // Tab B left x.md, and its last save is still running when tab A's listing comes by.
  let land;
  const running = b.saving("x.md", async () => { await new Promise((r) => { land = r; }); await write("x.md", "the last words", 200)(); });
  await settle();
  hooks.remove = (name) => { assert.notEqual(name, "x.md", "no delete while a save into the copy runs"); };
  await a.list();
  assert.equal(files.has("x.md"), true);
  land();
  await running;
  // A save that starts while the cleanup is between "unchanged" and the delete waits for it, then finds no file:
  // the tab shows it could not save (or keeps a draft), and no words land in a file about to be deleted.
  const order = [];
  let late;
  hooks.remove = async (name) => {
    if (name !== "y.md") return;
    late = b.saving("y.md", async () => { order.push("save"); await write("y.md", "too late", 300)(); });
    for (let i = 0; i < 5; i++) await settle();
    order.push("delete");
  };
  const rows = await a.list();
  await assert.rejects(late, { name: "NotFoundError" });
  assert.deepEqual(order, ["delete", "save"]);
  assert.deepEqual([rows.map((r) => r.name), files.get("x.md")?.text, files.has("y.md"), a.names()], [["x.md"], "the last words", false, []]);
});

test("saving: a left-behind copy whose time can't be read once stays kept and is tried again, not shown as a second script", async () => {
  const files = new Map([["x.md", { text: "unchanged", lastModified: 100 }]]);
  const { tab, hooks, store } = tabs(files, { "x.md": 100 });
  const copies = tab();
  hooks.read = () => { hooks.read = null; throw Object.assign(new Error("busy"), { name: "NotReadableError" }); };
  assert.deepEqual((await copies.list()).map((r) => r.name), []);
  assert.deepEqual([copies.names(), store.get("movedCopyTimes"), files.has("x.md")], [["x.md"], { "x.md": 100 }, true], "kept, with its time, for the next listing");
  assert.deepEqual((await copies.list()).map((r) => r.name), []);
  assert.deepEqual([copies.names(), files.has("x.md")], [[], false], "the unchanged copy goes on the next listing");
  // The same on the move itself: the copy is kept for later, not left as a second script.
  files.set("y.md", { text: "moved", lastModified: 100 });
  hooks.read = () => { hooks.read = null; throw Object.assign(new Error("busy"), { name: "NotReadableError" }); };
  await copies.afterMove("y.md", 100);
  assert.deepEqual([copies.names(), files.has("y.md")], [["y.md"], true]);
  assert.deepEqual((await copies.list()).map((r) => r.name), []);
  assert.equal(files.has("y.md"), false);
});

test("saving: tabLocks stands in for navigator.locks in one tab: shared holders together, an exclusive one alone, in order, and ifAvailable never waits", async () => {
  const locks = tabLocks(), log = [];
  const hold = (name, mode, label) => { let end; const done = locks.request(name, { mode }, async () => { log.push(label); await new Promise((r) => { end = r; }); return label; }); return { done, end: () => end() }; };
  const s1 = hold("n", "shared", "s1"), s2 = hold("n", "shared", "s2");
  await settle();
  assert.deepEqual(log, ["s1", "s2"]);
  assert.equal(await locks.request("n", { ifAvailable: true }, (l) => l), null, "not available while shared holders have it");
  assert.equal((await locks.request("n", { mode: "shared", ifAvailable: true }, (l) => l?.mode)), "shared");
  const x = hold("n", "exclusive", "x"), s3 = hold("n", "shared", "s3");
  await settle();
  assert.deepEqual(log, ["s1", "s2"], "the exclusive request waits, and the shared one behind it too");
  s1.end(); s2.end();
  assert.deepEqual(await Promise.all([s1.done, s2.done]), ["s1", "s2"]);
  await settle();
  assert.deepEqual(log, ["s1", "s2", "x"]);
  x.end();
  await x.done;
  await settle();
  assert.deepEqual(log, ["s1", "s2", "x", "s3"]);
  s3.end();
  await s3.done;
  assert.equal(await locks.request("n", { ifAvailable: true }, (l) => l?.mode), "exclusive", "free again; a request without a mode is exclusive");
  await assert.rejects(locks.request("n", async () => { throw new Error("inside"); }), /inside/);
  assert.equal(await locks.request("n", () => "after a failure"), "after a failure");
});

test("saving: a save still runs, once, where the lock can't be asked for; and leaving a script before its lock came frees it", async () => {
  const refused = { request: async () => { throw Object.assign(new Error("no locks here"), { name: "SecurityError" }); } };
  const copies = createLeftCopies({ store: { get: () => null, set: () => {} }, dir: async () => ({}), locks: refused });
  let runs = 0;
  assert.equal(await copies.saving("a.md", async () => { runs++; return "written"; }), "written");
  await assert.rejects(createLeftCopies({ store: { get: () => null, set: () => {} }, dir: async () => ({}) }).saving("a.md", async () => { runs++; throw new Error("The disk is full."); }), /disk is full/);
  assert.equal(runs, 2, "a save that fails is not run a second time");
  await copies.open("a.md"); // never rejects
  // Opened and left at once, before the lock was granted: nothing stays held.
  const locks = tabLocks(), quick = createLeftCopies({ store: { get: () => null, set: () => {} }, dir: async () => ({}), locks });
  quick.open("b.md");
  await quick.open(null);
  assert.equal(await locks.request("script-editor:script:b.md", { ifAvailable: true }, (l) => !!l), true);
});

test("saving: every save holds its script's name from its start to the end of its write, also the save of a script the person just left", async () => {
  const s = setup();
  const held = [];
  let inside = 0;
  s.ports.files.held = async (name, fn) => { held.push(name); inside++; try { return await fn(); } finally { inside--; } };
  const write = s.files.port.write;
  s.files.port.write = async (h, t) => { assert.equal(inside > 0, true, `${h.name} is written while its name is held`); return write(h, t); };
  // Leaving a.md with words not saved yet, as loadText does: flush, then open the next script.
  s.ed.text = "# A\n\nOne. Two.\n";
  s.saving.flush();
  assert.deepEqual(held, ["a.md"], "the name is held before the script is left, with no wait in between");
  s.files.outside("b.md", "# B\n");
  s.open({ name: "b.md" }, "# B\n");
  await until(() => !s.script.saving);
  assert.equal(s.files.disk.get("a.md").text, "# A\n\nOne. Two.\n");
  // A save that waited while another ran, for a script left meanwhile, holds its name too.
  const release = s.files.hold("b.md");
  s.ed.text = "# B\n\nFirst.\n";
  s.saving.save();
  s.ed.text = "# B\n\nSecond.\n";
  s.saving.save();
  s.files.outside("c.md", "# C\n");
  s.open({ name: "c.md" }, "# C\n");
  release();
  await until(() => !s.script.saving);
  assert.equal(s.files.disk.get("b.md").text, "# B\n\nSecond.\n");
  assert.deepEqual(held, ["a.md", "b.md", "b.md"]);
});
