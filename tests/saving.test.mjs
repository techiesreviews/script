import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The saving module through its own interface, with a folder in memory, a clock the test moves and local storage in a
// Map. The browser check `scripts/smoke-saving.mjs` runs the same paths in the real editor.
const { createSaving, AUTOSAVE_MS } = await import("../public/saving.js");

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
  assert.doesNotMatch(app, /save-queue\.js|Q\.(queueSave|settleQueue|splitQueue|changedOnDisk)/, "the save queue is the module's own");
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
    ["picked", "move-me.md"], ["renamed", "move-me.md", "moved.md", { clear: true }], ["placed", "moved.md", { was: { name: "move-me.md" } }],
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
  s.open(null, "# Other\n"); // another script without a file opens
  release();
  await run;
  await until(() => !s.script.saving);
  assert.equal(s.files.disk.get("moved.md").text, "# Demo\n\nMoving.\n", "the picked file holds the text from the click");
  assert.equal(s.files.disk.has("from-title.md"), false, "the other script is not saved into the browser");
  assert.ok(!s.events.some((e) => e[0] === "renamed"), "nothing is renamed");
  assert.deepEqual([s.script.name, s.script.handle, s.script.inBrowser], ["demo.md", null, false]);
  assert.deepEqual(s.store.get("draft:demo.md"), { text: "# Demo\n\nMoving.\n\nPressed.\n", at: 77_000, asks: [] }, "the demo's newer words are kept as its draft");
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
