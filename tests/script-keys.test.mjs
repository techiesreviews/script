import { test } from "node:test";
import assert from "node:assert/strict";

// TOOLS-361: what is kept beside a script (its safety-net draft, its B-roll link and list, its "Check" flags) goes by
// the script's own key, not its file name. A file on the computer gets an id of its own, kept with its handle.
const { createScriptKeys, legacyPlan, fileKey, IDS_KEY, MIGRATED_KEY, IDS_MAX } = await import("../public/script-keys.js");

// Files stand in as objects with a path: two handle objects for one path are the same file (isSameEntry).
const file = (path) => ({ name: path.split("/").pop(), path });
const sameFile = async (a, b) => !!a && !!b && a.path === b.path;
let n = 0; // ids never repeat, also across pages
function setup({ store = new Map(), refuse = false, unreadable = false } = {}) {
  let chain = Promise.resolve();
  const handed = [];
  const keys = createScriptKeys({
    store: {
      get: async (k) => { if (unreadable) throw new Error("read failed"); return store.has(k) ? structuredClone(store.get(k)) : null; },
      put: async (k, v) => { if (refuse) throw new Error("storage off"); store.set(k, v); },
    },
    sameFile,
    lock: (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; },
    newId: () => `id${++n}`,
    handOver: async (name, list, o) => { handed.push(o ? [name, list, o] : [name, list]); },
  });
  return { keys, store, handed };
}

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

test("script keys: a file picked again for Save as gets the new key, never two", async () => {
  const { keys, store } = setup();
  await keys.forFile(file("c/script.md"));
  const k = await keys.adopt(file("c/script.md"));
  await keys.forFile(file("z/z.md")); // runs after the adopt is kept
  assert.equal(store.get(IDS_KEY).filter((r) => r.handle.path === "c/script.md").length, 1);
  assert.equal(await setup({ store }).keys.forFile(file("c/script.md")), k);
});

test("script keys: where storage refuses, a file goes by its name and takes nothing; Save as too", async () => {
  const { keys, handed } = setup({ refuse: true });
  const h = file("a/script.md");
  assert.equal(await keys.forFile(h), "script.md");
  assert.equal(keys.keyOf(h, "script.md"), "script.md");
  const saved = file("c/script.md");
  assert.equal(await keys.adopt(saved), "script.md", "a key that can't be kept is never used: the next page could not find it");
  assert.equal(keys.keyOf(saved, "script.md"), "script.md");
  assert.deepEqual(handed, []);
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
  assert.equal(store.get(IDS_KEY).length, 0, "no id kept");
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
