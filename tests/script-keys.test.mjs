import { test } from "node:test";
import assert from "node:assert/strict";

// TOOLS-361: what is kept beside a script (its safety-net draft, its B-roll link and list, its "Check" flags) goes by
// the script's own key, not its file name. A file on the computer gets an id of its own, kept with its handle.
const { createScriptKeys, createHandOver, legacyPlan, fileKey, IDS_KEY, MIGRATED_KEY, IDS_MAX } = await import("../public/script-keys.js");

// Files stand in as objects with a path: two handle objects for one path are the same file (isSameEntry).
const file = (path) => ({ name: path.split("/").pop(), path });
const sameFile = async (a, b) => !!a && !!b && a.path === b.path;
let n = 0; // ids never repeat, also across pages
// `off`: switches a test may flip while the page lives (storage refusing writes, or reads). `live`: the files of the
// scripts the tab has in use (open, or kept aside).
function setup({ store = new Map(), refuse = false, unreadable = false, live = () => [] } = {}) {
  let chain = Promise.resolve();
  const handed = [], released = [], off = { refuse, unreadable }; // released: the names that let go of their old keys
  const keys = createScriptKeys({
    store: {
      get: async (k) => { if (off.unreadable) throw new Error("read failed"); return store.has(k) ? structuredClone(store.get(k)) : null; },
      put: async (k, v) => { if (off.refuse) throw new Error("storage off"); store.set(k, v); },
    },
    sameFile,
    lock: (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; },
    newId: () => `id${++n}`,
    handOver: async (name, list, o) => { handed.push(o ? [name, list, o] : [name, list]); return async () => { released.push(name); }; },
    live,
  });
  return { keys, store, handed, released, off };
}
const entriesFor = (store, path) => (store.get(IDS_KEY) ?? []).filter((r) => r.handle.path === path);

test("script keys: a file gets a key of its own; the same file again gets it too; another file of that name gets another", async () => {
  const { keys } = setup();
  const a = await keys.forFile(file("a/script.md"));
  const again = await keys.forFile(file("a/script.md")); // the switcher hands over a fresh handle for a known file
  const b = await keys.forFile(file("b/script.md"));
  assert.equal(a, fileKey("id1"));
  assert.equal(again, a);
  assert.notEqual(b, a);
  assert.match(b, /^file:/);
});

test("script keys: keyOf gives a looked-up file's key; any other script (in the browser, without a file) goes by its name", async () => {
  const { keys } = setup();
  const h = file("a/script.md");
  assert.equal(keys.keyOf(h, "script.md"), "script.md", "not looked up yet");
  const k = await keys.forFile(h);
  assert.equal(keys.keyOf(h, "script.md"), k);
  assert.equal(keys.keyOf({ name: "my-video.md" }, "my-video.md"), "my-video.md");
  assert.equal(keys.keyOf(null, "demo.md"), "demo.md");
});

test("script keys: the ids are kept, so the next page finds a file's key again", async () => {
  const first = setup();
  const k = await first.keys.forFile(file("a/script.md"));
  const next = setup({ store: first.store });
  assert.equal(await next.keys.forFile(file("a/script.md")), k);
  assert.ok(Array.isArray(first.store.get(IDS_KEY)));
});

test("script keys: a file seen for the first time takes the keys kept under its name before (once); a known file takes none", async () => {
  const { keys, handed } = setup();
  const a = await keys.forFile(file("a/script.md"));
  await keys.forFile(file("a/script.md"));
  const b = await keys.forFile(file("b/script.md"));
  assert.deepEqual(handed, [["script.md", [a]], ["script.md", [b]]]);
});

test("script keys: moving to keys, the files on the list get ids and each name's old keys go to its files, newest first, once", async () => {
  const { keys, handed, store } = setup();
  const list = [file("b/script.md"), file("x/other.md"), file("a/script.md")]; // newest first
  await keys.migrate(async () => list.map((h) => ({ handle: h, name: h.name })));
  const [b, x, a] = await Promise.all(list.map((h) => keys.forFile(file(h.path))));
  assert.deepEqual(handed, [["script.md", [b, a], { moving: true }], ["other.md", [x], { moving: true }]]);
  assert.ok(store.get(MIGRATED_KEY));
  await keys.migrate(async () => list.map((h) => ({ handle: h, name: h.name })));
  assert.equal(handed.length, 2, "it runs once");
});

test("script keys: a file made by Save as has its key once it is kept, also for the next page", async () => {
  const { keys, store, handed } = setup();
  const h = file("c/script.md");
  const k = await keys.adopt(h);
  assert.match(k, /^file:/);
  assert.equal(keys.keyOf(h, "script.md"), k);
  assert.equal(await keys.forFile(file("c/script.md")), k, "looked up again later: the same key");
  const next = setup({ store });
  assert.equal(await next.keys.forFile(file("c/script.md")), k);
  assert.deepEqual(handed, [], "a new file takes no old keys of its name");
});

test("script keys (P1): Save as onto a file that has a key keeps that key: the same file, the same key, whatever the handle", async () => {
  const { keys, store } = setup();
  const aside = file("c/script.md"); // the file as this tab holds it (open, or kept aside)
  const k = await keys.forFile(aside);
  const picked = file("c/script.md"); // the picker's handle for the same file
  assert.equal(await keys.adopt(picked), k);
  assert.equal(keys.keyOf(aside, "script.md"), keys.keyOf(picked, "script.md"), "both handles write under one key");
  await keys.forFile(file("z/z.md")); // runs after the adopt is kept
  assert.equal(entriesFor(store, "c/script.md").length, 1, "never two entries");
  assert.equal(await setup({ store }).keys.forFile(file("c/script.md")), k, "and the next page finds what was written under it");
});

test("script keys (P1): a key this tab remembers that fell off the list is put back when its script opens again", async () => {
  const { keys, store } = setup();
  const h = file("a/script.md");
  const a = await keys.forFile(h);
  const other = setup({ store }); // another tab opens 200 other files
  for (let i = 0; i < IDS_MAX; i++) await other.keys.forFile(file(`t${i}/x.md`));
  assert.equal(entriesFor(store, "a/script.md").length, 0, "it fell off the list");
  assert.equal(await keys.forFile(h), a);
  assert.equal(entriesFor(store, "a/script.md").length, 1, "back on the list");
  assert.equal(await setup({ store }).keys.forFile(file("a/script.md")), a, "the next page finds the words kept under it");
});

test("script keys (P1): the scripts a tab has in use keep their keys on the list while it opens other files, and when it is looked at again", async () => {
  const inUse = [];
  const { keys, store } = setup({ live: () => inUse });
  const h = file("a/script.md");
  const a = await keys.forFile(h);
  inUse.push(h); // kept aside, with the agent working in it: never opened again meanwhile
  for (let i = 0; i < IDS_MAX + 5; i++) await keys.forFile(file(`u${i}/x.md`));
  assert.equal(store.get(IDS_KEY).length, IDS_MAX, "the list stays within its size");
  assert.equal(await setup({ store }).keys.forFile(file("a/script.md")), a, "this tab's own opens never push it off");
  const other = setup({ store }); // another tab fills the list while this one is not looked at
  for (let i = 0; i < IDS_MAX; i++) await other.keys.forFile(file(`v${i}/x.md`));
  assert.equal(entriesFor(store, "a/script.md").length, 0);
  await keys.keep(); // the tab is looked at again
  assert.equal(await setup({ store }).keys.forFile(file("a/script.md")), a, "put back before a reload could lose what is under it");
  inUse.length = 0;
  await keys.keep();
  assert.equal(entriesFor(store, "a/script.md").length, 1, "a script no longer in use is neither added twice nor taken off");
});

test("script keys: a file that got a new id from another tab after it fell off goes by the listed id at its next open: one key for every tab", async () => {
  const inUse = [];
  const { keys, store } = setup({ live: () => inUse });
  const h = file("a/script.md");
  const a = await keys.forFile(h);
  inUse.push(h);
  const other = setup({ store });
  for (let i = 0; i < IDS_MAX; i++) await other.keys.forFile(file(`w${i}/x.md`));
  const z = await other.keys.forFile(file("a/script.md")); // seen there as a new file
  assert.notEqual(z, a);
  await keys.keep();
  assert.equal(entriesFor(store, "a/script.md").length, 1, "a listed file is never given a second entry");
  assert.equal(keys.keyOf(h, "script.md"), a, "its key does not change under a script in use");
  assert.equal(await keys.forFile(h), z, "the stored list decides when it opens");
  assert.equal(keys.keyOf(h, "script.md"), z);
});

test("script keys: a file this tab knows keeps its key while the list can't be read or written", async () => {
  const { keys, store, off } = setup();
  const h = file("a/script.md");
  const a = await keys.forFile(h);
  const before = structuredClone(store.get(IDS_KEY));
  off.unreadable = true;
  assert.equal(await keys.forFile(h), a);
  assert.equal(await keys.adopt(h), a, "Save as onto it too");
  off.unreadable = false;
  off.refuse = true;
  assert.equal(await keys.forFile(h), a);
  assert.deepEqual(store.get(IDS_KEY), before, "and nothing was written over");
});

test("script keys: where storage refuses, a file goes by its name and its name lets go of nothing; Save as too", async () => {
  const { keys, released } = setup({ refuse: true });
  const h = file("a/script.md");
  assert.equal(await keys.forFile(h), "script.md");
  assert.equal(keys.keyOf(h, "script.md"), "script.md");
  const saved = file("c/script.md");
  assert.equal(await keys.adopt(saved), "script.md", "a key that can't be kept is never used: the next page could not find it");
  assert.equal(keys.keyOf(saved, "script.md"), "script.md");
  assert.deepEqual(released, [], "no id could be kept, so nothing is deleted");
});

test("script keys (P1): Save as onto a file kept aside whose key fell off the list still keeps that key, never a second one", async () => {
  const inUse = [];
  const { keys, store } = setup({ live: () => inUse });
  const aside = file("c/script.md");
  const k = await keys.forFile(aside);
  inUse.push(aside);
  const other = setup({ store }); // another tab opens 200 other files
  for (let i = 0; i < IDS_MAX; i++) await other.keys.forFile(file(`s${i}/x.md`));
  assert.equal(await keys.adopt(file("c/script.md")), k); // the picker's own handle
  assert.equal(entriesFor(store, "c/script.md").length, 1);
  assert.equal(await setup({ store }).keys.forFile(file("c/script.md")), k);
});

test("script keys: moving to keys is tried again on the next page when a name's keys could not all be handed over", async () => {
  const store = new Map();
  let fail = true;
  const list = [{ handle: file("a/script.md"), name: "script.md" }];
  const keysA = createScriptKeys({ store: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } }, sameFile, lock: (fn) => fn(), newId: () => `m${++n}`, handOver: async () => { if (fail) throw new Error("full"); } });
  await keysA.migrate(async () => list);
  assert.equal(store.has(MIGRATED_KEY), false);
  assert.equal(await keysA.forFile(file("a/script.md")), "script.md", "no id kept for a name not handed over: it goes by its name, where its old draft still is");
  fail = false;
  const handed = [];
  const keysB = createScriptKeys({ store: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } }, sameFile, lock: (fn) => fn(), newId: () => `m${++n}`, handOver: async (name, keys) => { handed.push([name, keys]); } });
  await keysB.migrate(async () => list);
  assert.ok(store.has(MIGRATED_KEY));
  assert.deepEqual(handed, [["script.md", [await keysB.forFile(file("a/script.md"))]]], "the same file, the same key");
});

test("script keys: a read that fails gives the name and writes nothing, so no other file loses its key; moving to keys waits for a good read", async () => {
  const first = setup();
  const k = await first.keys.forFile(file("a/script.md"));
  const before = structuredClone(first.store.get(IDS_KEY));
  const broken = setup({ store: first.store, unreadable: true });
  assert.equal(await broken.keys.forFile(file("b/script.md")), "script.md");
  await broken.keys.migrate(async () => [{ handle: file("c/c.md"), name: "c.md" }]);
  assert.deepEqual(first.store.get(IDS_KEY), before);
  assert.equal(first.store.has(MIGRATED_KEY), false);
  assert.equal(await setup({ store: first.store }).keys.forFile(file("a/script.md")), k);
});

test("script keys: a file opened again moves to the front, so a full list lets go of the files not opened for longest", async () => {
  const { keys, store } = setup();
  const a = await keys.forFile(file("a/script.md"));
  for (let i = 0; i < IDS_MAX - 1; i++) await keys.forFile(file(`f${i}/x.md`));
  const next = setup({ store });
  assert.equal(await next.keys.forFile(file("a/script.md")), a); // opened again (a new page): to the front
  await next.keys.forFile(file("new/x.md")); // one more file: the list is full
  assert.equal(store.get(IDS_KEY).length, IDS_MAX);
  assert.equal(await setup({ store }).keys.forFile(file("a/script.md")), a);
});

test("script keys: a file found in the list keeps its key when moving it to the front can't be written (review round 2)", async () => {
  const first = setup();
  const a = await first.keys.forFile(file("a/script.md"));
  await first.keys.forFile(file("b/script.md")); // a is no longer at the front
  const full = setup({ store: first.store, refuse: true });
  assert.equal(await full.keys.forFile(file("a/script.md")), a);
});

test("script keys: a file seen later whose hand-over fails gets no id yet, so the next open tries again (second look round 2)", async () => {
  const store = new Map();
  let fail = true;
  const handed = [];
  const keys = () => createScriptKeys({ store: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } }, sameFile, lock: (fn) => fn(), newId: () => `r${++n}`, handOver: async (name, list) => { if (fail) throw new Error("full"); handed.push([name, list]); } });
  assert.equal(await keys().forFile(file("a/script.md")), "script.md", "this page it goes by its name");
  assert.equal((store.get(IDS_KEY) ?? []).length, 0, "no id kept");
  fail = false;
  const k = await keys().forFile(file("a/script.md"));
  assert.match(k, /^file:/);
  assert.deepEqual(handed, [["script.md", [k]]]);
});

// A page over a store in a Map whose hand-over and list can be made to fail (SL-1, SL-3: lead's fix round, 2026-11-19).
// `fail` is read live, so storage can come back on the same page.
function pendingSetup(store, fail = {}) {
  const handed = [];
  const keys = createScriptKeys({
    store: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } },
    sameFile, lock: (fn) => fn(), newId: () => `p${++n}`,
    handOver: async (name, list, o) => { if (fail.hand) throw new Error("full"); handed.push(o ? [name, list, o] : [name, list]); },
  });
  const files = [{ handle: file("b/script.md"), name: "script.md" }, { handle: file("a/script.md"), name: "script.md" }];
  const migrated = keys.migrate(async () => { if (fail.list) throw new Error("the recent list can't be read"); return files; });
  return { keys, handed, migrated };
}

test("script keys (SL-1): after a failed move, a file opened on the same page takes nothing alone, also once storage is back; the next page hands the name to all its files", async () => {
  const store = new Map(), fail = { hand: true };
  const first = pendingSetup(store, fail);
  await first.migrated;
  fail.hand = false; // storage works again, on the same page
  assert.equal(await first.keys.forFile(file("a/script.md")), "script.md", "goes by its name while the move is pending");
  assert.deepEqual(first.handed, [], "no one-file move");
  const next = pendingSetup(store);
  await next.migrated;
  assert.ok(store.has(MIGRATED_KEY));
  assert.equal(next.handed.length, 1);
  assert.equal(next.handed[0][1].length, 2, "the retry hands the name to both files");
});

test("script keys: a page whose move failed takes up ids again once another tab has finished the move (review on the fix round)", async () => {
  const store = new Map(), fail = { hand: true };
  const first = pendingSetup(store, fail);
  await first.migrated;
  fail.hand = false; // storage is back
  const other = pendingSetup(store); // another tab finishes the move
  await other.migrated;
  assert.match(await first.keys.forFile(file("c/script.md")), /^file:/);
});

test("script keys (SL-3): a recent list that can't be read never marks the move done, and no file takes the name's keys alone meanwhile", async () => {
  const store = new Map();
  const first = pendingSetup(store, { list: true });
  await first.migrated;
  assert.equal(store.has(MIGRATED_KEY), false);
  assert.equal(await first.keys.forFile(file("a/script.md")), "script.md");
  assert.deepEqual(first.handed, []);
  const next = pendingSetup(store);
  await next.migrated;
  assert.ok(store.has(MIGRATED_KEY));
  assert.equal(next.handed.length, 1);
  assert.equal(next.handed[0][1].length, 2);
});

test("script keys (SL-4): reopening the same handle object moves it to the front too, so a full list keeps it", async () => {
  const { keys, store } = setup();
  const h = file("a/script.md");
  const a = await keys.forFile(h);
  for (let i = 0; i < IDS_MAX - 1; i++) await keys.forFile(file(`g${i}/x.md`));
  assert.equal(await keys.forFile(h), a); // the same handle again, as the open script
  await keys.forFile(file("new2/x.md"));
  assert.equal(await setup({ store }).keys.forFile(file("a/script.md")), a);
});

test("script keys: the old keys of a name go to its files (the newest takes the draft) and the name lets go, unless a script in the browser has that name", () => {
  assert.deepEqual(legacyPlan(["file:b", "file:a"], { browser: false }), { broll: ["file:b", "file:a"], draft: "file:b", clear: true });
  assert.deepEqual(legacyPlan(["file:b"], { browser: true, moving: true }), { broll: ["file:b"], draft: null, clear: false });
  assert.equal(legacyPlan(["file:b"], { browser: true }), null, "after the move, a browser script's keys are its own: a new file of that name takes none");
  assert.equal(legacyPlan([], { browser: false }), null);
});

// A page whose steps are written down in order: the copies (handOver), the id list as it is kept, the name letting
// go, the move marked done. `fail`: which of them fail, read live.
function orderSetup(store = new Map(), fail = {}) {
  const steps = [];
  const keys = createScriptKeys({
    store: {
      get: async (k) => store.get(k),
      put: async (k, v) => { if (fail.ids && k === IDS_KEY) throw new Error("storage off"); steps.push(k === IDS_KEY ? "ids" : "done"); store.set(k, v); },
    },
    sameFile, lock: (fn) => fn(), newId: () => `o${++n}`,
    handOver: async (name) => {
      if (fail.copy === name) throw new Error("full");
      steps.push(`copy ${name}`);
      return async () => { if (fail.letGo === name) throw new Error("can't remove"); steps.push(`let go ${name}`); };
    },
  });
  return { keys, store, steps };
}
const onList = [{ handle: file("b/script.md"), name: "script.md" }, { handle: file("x/other.md"), name: "other.md" }, { handle: file("a/script.md"), name: "script.md" }];

test("script keys: a file seen for the first time: the copies first, then its id is kept, and only then the name lets go", async () => {
  const { keys, steps } = orderSetup();
  assert.match(await keys.forFile(file("a/script.md")), /^file:/);
  assert.deepEqual(steps, ["copy script.md", "ids", "let go script.md"]);
});

test("script keys: an id that can't be kept after the copies: the name lets go of nothing, and the file goes by its name", async () => {
  const store = new Map(), fail = { ids: true };
  const { keys, steps } = orderSetup(store, fail);
  assert.equal(await keys.forFile(file("a/script.md")), "script.md");
  assert.deepEqual(steps, ["copy script.md"], "nothing is deleted for a key the next page could not find");
  fail.ids = false;
  assert.match(await keys.forFile(file("a/script.md")), /^file:/, "its next open tries again");
});

test("script keys: a name that can't let go leaves the file its key: the id is kept and its copies are there", async () => {
  const store = new Map();
  const { keys } = orderSetup(store, { letGo: "script.md" });
  const k = await keys.forFile(file("a/script.md"));
  assert.match(k, /^file:/);
  assert.equal(await orderSetup(store).keys.forFile(file("a/script.md")), k);
});

test("script keys: the move makes every copy first, then keeps the ids, then the names let go, then it is marked done", async () => {
  const { keys, steps, store } = orderSetup();
  await keys.migrate(async () => onList);
  assert.deepEqual(steps, ["copy script.md", "copy other.md", "ids", "let go script.md", "let go other.md", "done"]);
  assert.ok(store.get(MIGRATED_KEY));
});

test("script keys: a name whose copies fail at the move keeps everything and its files get no id; the other names go on; not marked done", async () => {
  const store = new Map();
  const { keys, steps } = orderSetup(store, { copy: "script.md" });
  await keys.migrate(async () => onList);
  assert.deepEqual(steps, ["copy other.md", "ids", "let go other.md"]);
  assert.equal(store.has(MIGRATED_KEY), false);
  assert.deepEqual(store.get(IDS_KEY).map((r) => r.handle.path), ["x/other.md"]);
  assert.equal(await keys.forFile(file("a/script.md")), "script.md");
});

test("script keys: ids that can't be kept at the move: no name lets go, and it is not marked done", async () => {
  const store = new Map();
  const { keys, steps } = orderSetup(store, { ids: true });
  await keys.migrate(async () => onList);
  assert.deepEqual(steps, ["copy script.md", "copy other.md"], "nothing is deleted");
  assert.equal(store.has(MIGRATED_KEY), false);
  assert.equal(await keys.forFile(file("a/script.md")), "script.md");
});

test("script keys: a name that can't let go at the move: not marked done, its files keep their ids, and the next page finishes it", async () => {
  const store = new Map();
  const first = orderSetup(store, { letGo: "script.md" });
  await first.keys.migrate(async () => onList);
  assert.deepEqual(first.steps, ["copy script.md", "copy other.md", "ids", "let go other.md"]);
  assert.equal(store.has(MIGRATED_KEY), false);
  const a = await first.keys.forFile(file("a/script.md"));
  assert.match(a, /^file:/, "its copies are kept and so is its id");
  const next = orderSetup(store);
  await next.keys.migrate(async () => onList);
  assert.deepEqual(next.steps, ["copy script.md", "copy other.md", "let go script.md", "let go other.md", "done"], "the same ids: the list is not written again");
  assert.equal(await next.keys.forFile(file("a/script.md")), a);
});

// The hand-over itself (createHandOver), with IndexedDB and local storage standing in as Maps. `bad`: the keys whose
// read, write or removal fails; `stuck`: the keys a removal leaves in place without saying so.
function overSetup({ browser = async () => false } = {}) {
  const idb = new Map(), local = new Map(), wrote = [];
  const bad = { read: new Set(), write: new Set(), remove: new Set(), stuck: new Set() };
  const fail = (what, k) => { if (bad[what].has(k)) throw new Error(`${what} ${k} failed`); };
  const handOver = createHandOver({
    idb: {
      read: async (k) => { fail("read", k); return structuredClone(idb.get(k)); },
      put: async (k, v) => { fail("write", k); wrote.push(k); idb.set(k, v); },
    },
    local: {
      read: (k) => { fail("read", k); return local.has(k) ? local.get(k) : null; },
      write: (k, v) => { fail("write", k); wrote.push(k); local.set(k, v); },
      remove: (k) => { fail("remove", k); if (!bad.stuck.has(k)) local.delete(k); },
    },
    key: { draft: (k) => `draft:${k}`, link: (k) => `broll:${k}`, list: (k) => `brollList:${k}` },
    browserHas: browser,
    keeps: (name) => name === "demo.md",
  });
  return { idb, local, bad, wrote, handOver };
}
const draftAt = (text, at) => JSON.stringify({ text, at, asks: [] });
// What a name held before TOOLS-361: a draft, a B-roll link and a B-roll list kept in the browser.
function oldKeys(o, name = "script.md") {
  o.local.set(`draft:${name}`, draftAt("Words typed before.", 5));
  o.idb.set(`broll:${name}`, { name: "list.md" });
  o.idb.set(`brollList:${name}`, "# B-roll\n");
}
const all = (o) => JSON.stringify([[...o.idb], [...o.local]]);

test("hand-over (P0): a draft that can't be read stops it: never taken for \"no draft\", nothing is written and nothing is deleted", async () => {
  for (const unreadable of ["draft:script.md", "draft:file:a"]) {
    const o = overSetup();
    oldKeys(o);
    o.local.set("draft:file:a", draftAt("The file's own words.", 9));
    const before = all(o);
    o.bad.read.add(unreadable);
    await assert.rejects(o.handOver("script.md", ["file:a"]), `${unreadable} can't be read`);
    assert.equal(all(o), before, `${unreadable}: everything stays as it was`);
  }
});

test("hand-over: any other read that fails stops it the same way: the name's link or list, a file's own place, the browser folder", async () => {
  for (const unreadable of ["broll:script.md", "brollList:script.md", "broll:file:a", "brollList:file:a"]) {
    const o = overSetup();
    oldKeys(o);
    const before = all(o);
    o.bad.read.add(unreadable);
    await assert.rejects(o.handOver("script.md", ["file:b", "file:a"], { moving: true }), `${unreadable} can't be read`);
    assert.equal(all(o), before, `${unreadable}: everything stays as it was`);
  }
  const o = overSetup({ browser: async () => { throw new Error("the folder can't be read"); } });
  oldKeys(o);
  const before = all(o);
  await assert.rejects(o.handOver("script.md", ["file:a"]));
  assert.equal(all(o), before);
});

test("hand-over: the copies come first and delete nothing; the name lets go only when asked, and then of everything", async () => {
  const o = overSetup();
  oldKeys(o);
  const letGo = await o.handOver("script.md", ["file:b", "file:a"], { moving: true });
  assert.equal(o.local.get("draft:file:b"), draftAt("Words typed before.", 5), "the newest file takes the draft");
  assert.equal(o.local.has("draft:file:a"), false);
  for (const k of ["file:a", "file:b"]) {
    assert.deepEqual(o.idb.get(`broll:${k}`), { name: "list.md" });
    assert.equal(o.idb.get(`brollList:${k}`), "# B-roll\n");
  }
  assert.ok(o.local.has("draft:script.md") && o.idb.get("broll:script.md") && o.idb.get("brollList:script.md"), "the name still has everything");
  await letGo();
  assert.equal(o.local.has("draft:script.md"), false);
  assert.equal(o.idb.get("broll:script.md"), null);
  assert.equal(o.idb.get("brollList:script.md"), null);
  assert.equal(await o.handOver("script.md", ["file:c"]), null, "a file seen later finds nothing left under the name");
  assert.equal(o.idb.has("broll:file:c"), false);
});

test("hand-over: only places never written are filled, a link removed on purpose stays removed, and the list is kept before its link", async () => {
  const o = overSetup();
  oldKeys(o);
  o.idb.set("broll:file:a", null); // unlinked on purpose
  o.idb.set("brollList:file:b", "# Its own\n");
  await o.handOver("script.md", ["file:a", "file:b"], { moving: true });
  assert.equal(o.idb.get("broll:file:a"), null);
  assert.equal(o.idb.get("brollList:file:b"), "# Its own\n");
  assert.deepEqual(o.wrote, ["brollList:file:a", "broll:file:b", "draft:file:a"], "the draft last");
  const full = overSetup();
  oldKeys(full);
  full.bad.write.add("brollList:file:a");
  await assert.rejects(full.handOver("script.md", ["file:a"]));
  assert.equal(full.idb.has("broll:file:a"), false, "no link without its list");
  assert.equal(full.local.has("draft:file:a"), false, "and no draft before the rest is kept");
  assert.ok(full.local.has("draft:script.md") && full.idb.get("brollList:script.md"), "the name keeps everything");
});

test("hand-over: of two drafts the one written later stays under the file's key: its own, or the name's", async () => {
  const own = overSetup();
  oldKeys(own);
  own.local.set("draft:file:a", draftAt("The file's own, newer words.", 9));
  await (await own.handOver("script.md", ["file:a"]))();
  assert.equal(own.local.get("draft:file:a"), draftAt("The file's own, newer words.", 9));
  assert.equal(own.local.has("draft:script.md"), false, "the name's older draft goes");
  const named = overSetup();
  oldKeys(named);
  named.local.set("draft:file:a", draftAt("An older copy.", 2));
  await (await named.handOver("script.md", ["file:a"]))();
  assert.equal(named.local.get("draft:file:a"), draftAt("Words typed before.", 5), "words written under the name since are not lost");
  const broken = overSetup();
  oldKeys(broken);
  broken.local.set("draft:file:a", "{ not a draft");
  const before = all(broken);
  await assert.rejects(broken.handOver("script.md", ["file:a"]), "which one is newer can't be told: nothing is written over");
  assert.equal(all(broken), before);
});

test("hand-over: letting go never deletes a draft written under the name since it was copied, nor says done when a removal did not take", async () => {
  const o = overSetup();
  oldKeys(o);
  const letGo = await o.handOver("script.md", ["file:a"]);
  o.local.set("draft:script.md", draftAt("Typed meanwhile.", 20));
  await assert.rejects(letGo());
  assert.equal(o.local.get("draft:script.md"), draftAt("Typed meanwhile.", 20));
  assert.ok(o.idb.get("broll:script.md") && o.idb.get("brollList:script.md"), "the name keeps the rest too");
  const again = await o.handOver("script.md", ["file:a"]); // the next try
  assert.equal(o.local.get("draft:file:a"), draftAt("Typed meanwhile.", 20), "the newer words reach the file");
  await again();
  assert.equal(o.local.has("draft:script.md"), false);
  for (const [what, k] of [["stuck", "draft:script.md"], ["remove", "draft:script.md"], ["write", "broll:script.md"], ["write", "brollList:script.md"]]) {
    const s = overSetup();
    oldKeys(s);
    const go = await s.handOver("script.md", ["file:a"]);
    s.bad[what].add(k);
    await assert.rejects(go(), `${what} ${k}`);
    assert.equal(s.local.get("draft:file:a"), draftAt("Words typed before.", 5), "the file keeps its copy");
  }
});

test("hand-over: undo takes back the draft copy of a try whose ids could not be kept: gone, or the file's older draft again", async () => {
  const o = overSetup();
  oldKeys(o);
  (await o.handOver("script.md", ["file:a"])).undo();
  assert.equal(o.local.has("draft:file:a"), false);
  assert.equal(o.local.get("draft:script.md"), draftAt("Words typed before.", 5), "the name still has the original");
  const older = overSetup();
  oldKeys(older);
  older.local.set("draft:file:a", draftAt("An older copy.", 2));
  (await older.handOver("script.md", ["file:a"])).undo();
  assert.equal(older.local.get("draft:file:a"), draftAt("An older copy.", 2));
  const own = overSetup();
  oldKeys(own);
  own.local.set("draft:file:a", draftAt("The file's own, newer words.", 9));
  (await own.handOver("script.md", ["file:a"])).undo();
  assert.equal(own.local.get("draft:file:a"), draftAt("The file's own, newer words.", 9), "a draft the try did not write is left alone");
});

test("script keys: ids that can't be kept leave no draft copy behind under them, however often the open or the move is tried (review round 13)", async () => {
  const o = overSetup(), store = new Map();
  o.local.set("draft:script.md", draftAt("Words typed before.", 5));
  const page = () => createScriptKeys({
    store: { get: async (k) => store.get(k), put: async (k, v) => { if (k === IDS_KEY) throw new Error("storage off"); store.set(k, v); } },
    sameFile, lock: (fn) => fn(), newId: () => `u${++n}`, handOver: o.handOver,
  });
  const keys = page();
  assert.equal(await keys.forFile(file("a/script.md")), "script.md");
  assert.equal(await keys.forFile(file("a/script.md")), "script.md");
  assert.deepEqual([...o.local.keys()], ["draft:script.md"]);
  await page().migrate(async () => onList);
  assert.deepEqual([...o.local.keys()], ["draft:script.md"]);
});

test("script keys: a name the move could not hand over waits alone: a file of another name still gets its key on that page (review round 13)", async () => {
  const store = new Map();
  const { keys, steps } = orderSetup(store, { copy: "script.md" });
  await keys.migrate(async () => onList);
  assert.match(await keys.forFile(file("c/third.md")), /^file:/);
  assert.deepEqual(steps.slice(-3), ["copy third.md", "ids", "let go third.md"]);
  assert.equal(await keys.forFile(file("c/script.md")), "script.md", "a file of the waiting name takes nothing alone, also one not on the list");
  assert.equal(await keys.forFile(file("a/script.md")), "script.md");
  const stuck = orderSetup(new Map(), { letGo: "script.md" });
  await stuck.keys.migrate(async () => onList);
  assert.equal(await stuck.keys.forFile(file("c/script.md")), "script.md", "nor from a name that has not let go yet");
});

test("hand-over: a name a browser script has stays its own: at the move the files get a copy of its list and link only; later a file takes nothing", async () => {
  const o = overSetup({ browser: async () => true });
  oldKeys(o);
  const before = all(o);
  assert.equal(await o.handOver("script.md", ["file:c"]), null);
  assert.equal(all(o), before, "a file seen for the first time takes nothing");
  assert.equal(await o.handOver("script.md", ["file:b", "file:a"], { moving: true }), null, "nothing to let go: the name keeps its own");
  assert.deepEqual(o.idb.get("broll:file:a"), { name: "list.md" });
  assert.equal(o.idb.get("brollList:file:b"), "# B-roll\n");
  assert.equal(o.local.has("draft:file:b"), false, "its draft stays the browser script's");
  assert.ok(o.local.has("draft:script.md") && o.idb.get("broll:script.md") && o.idb.get("brollList:script.md"));
});

test("hand-over: a list still in local storage from before is handed over and goes with the name; one that can't be read stops it; the demo keeps its own", async () => {
  const o = overSetup();
  o.local.set("brollList:script.md", JSON.stringify("# Old place\n"));
  const letGo = await o.handOver("script.md", ["file:a"]);
  assert.equal(o.idb.get("brollList:file:a"), "# Old place\n");
  assert.ok(o.local.has("brollList:script.md"));
  await letGo();
  assert.equal(o.local.has("brollList:script.md"), false);
  const broken = overSetup();
  broken.local.set("brollList:script.md", "\"# Cut off");
  await assert.rejects(broken.handOver("script.md", ["file:a"]));
  assert.equal(broken.local.get("brollList:script.md"), "\"# Cut off");
  const demo = overSetup();
  oldKeys(demo, "demo.md");
  const before = all(demo);
  assert.equal(await demo.handOver("demo.md", ["file:a"]), null);
  assert.equal(all(demo), before);
});
