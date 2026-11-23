import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the app's history boundary with storage failures, without starting its UI.
const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source)?.index;
  assert.notEqual(start, undefined, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
const functions = ["idb", "idbGet", "idbRead", "idbPut", "idbSet", "sameFile", "recentScripts", "anySame", "without", "updateRecent"].map(functionSource).join("\n");
const handle = (name) => ({ name, isSameEntry: async (other) => other.name === name });
const row = (name) => ({ handle: handle(name), name, at: 1 });

function fixture(entries = []) {
  const stored = new Map(entries), fail = {}, dropped = [], asides = [];
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        if (fail.open) { request.error = new Error("open refused"); request.onerror(); return; }
        request.result = {
          transaction() {
            const transaction = {};
            transaction.objectStore = () => ({
              get(key) {
                const request = {};
                queueMicrotask(() => {
                  if (fail.read === key) { request.error = new Error("read refused"); request.onerror(); }
                  else { request.result = stored.get(key); request.onsuccess(); }
                });
                return request;
              },
              put(value, key) {
                if (fail.write === "throw") throw new Error("put refused");
                queueMicrotask(() => {
                  if (fail.write) {
                    transaction.error = fail.write === "abort" ? null : new Error("write refused");
                    if (fail.write === "error") transaction.onerror?.();
                    transaction.onabort?.();
                  } else { stored.set(key, value); transaction.oncomplete?.(); }
                });
              },
            });
            return transaction;
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
  const context = vm.createContext({ indexedDB, asides, dropKept: (h) => dropped.push(h.name), browserScripts: async () => [] });
  const recentActions = source.slice(source.indexOf("const remember = (handle"), source.indexOf("\n\n", source.indexOf("const remember = (handle")));
  vm.runInContext(`const RECENT_MAX = 20; let recentQueue = Promise.resolve(), lastHandle = null;\n${functions}\n${recentActions}`, context);
  const run = (code) => vm.runInContext(code, context);
  const update = (change) => { context.change = change; return run("updateRecent(change)"); };
  const names = async () => Array.from(await run("recentScripts()"), (r) => r.name);
  return { stored, fail, dropped, asides, context, run, update, names };
}

test("recent history: failed writes report failure, retain rows and kept scripts, and allow the next update", async () => {
  for (const outcome of ["error", "abort", "throw", "open"]) {
    const old = row("a.md"), next = row("b.md"), f = fixture([["recent", [old]]]);
    f.asides.push({ handle: old.handle, doc: "retained background state" });
    f.context.oldHandle = old.handle;
    f.run("lastHandle = oldHandle");
    if (outcome === "open") f.fail.open = true;
    else f.fail.write = outcome;
    const result = await Promise.race([
      f.update(() => [next]).then(() => "fulfilled", () => "rejected"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 100)),
    ]);
    assert.equal(result, "rejected", outcome);
    assert.equal(f.run("lastHandle.name"), "a.md", "no persisted-success state on failure");
    assert.deepEqual(f.dropped, [], "no success-dependent cleanup");
    delete f.fail.open;
    delete f.fail.write;
    assert.deepEqual(await f.names(), ["a.md"]);
    await f.update((list) => [next, ...list]);
    assert.deepEqual(await f.names(), ["b.md", "a.md"], "the queue recovers");
    assert.equal(f.asides[0].doc, "retained background state");
  }
});

test("recent history: failed reads never replace unread rows, and a healthy retry preserves them", async () => {
  for (const key of ["recent", "last"]) {
    const old = row("a.md"), next = row("b.md");
    const f = fixture(key === "last" ? [["last", old.handle]] : [["recent", [old]]]);
    f.fail.read = key;
    let changed = false;
    const outcome = await f.update((list) => { changed = true; return [next, ...list]; }).then(() => "fulfilled", () => "rejected");
    assert.equal(outcome, "rejected", key);
    assert.equal(changed, false, "an unread inventory never reaches the change callback");
    delete f.fail.read;
    assert.deepEqual(await f.names(), ["a.md"], "the old history remains readable");
    await f.update((list) => [next, ...list]);
    assert.deepEqual(await f.names(), ["b.md", "a.md"]);
  }
});

test("recent history: an empty store accepts entries, keeps newest first within 20, and forget only removes its row", async () => {
  const f = fixture();
  for (let i = 0; i < 22; i++) {
    f.context.file = handle(`${i}.md`);
    await f.run("remember(file)");
  }
  assert.deepEqual(await f.names(), Array.from({ length: 20 }, (_, i) => `${21 - i}.md`));
  f.context.file = handle("8.md");
  await f.run("remember(file)");
  assert.deepEqual((await f.names()).slice(0, 3), ["8.md", "21.md", "20.md"]);
  await f.run("forget(file)");
  assert.equal((await f.names()).length, 19);
  assert.equal((await f.names()).includes("8.md"), false);
});

test("recent history: a thrown change rejects its caller without poisoning the next queued turn", async () => {
  const f = fixture([["recent", [row("a.md")]]]);
  const broken = f.update(() => { throw new Error("change refused"); });
  const retry = f.update((list) => [row("b.md"), ...list]);
  await assert.rejects(broken, /change refused/);
  await retry;
  assert.deepEqual(await f.names(), ["b.md", "a.md"]);
});

test("recent history: optional display still falls back on read failure, without writing its fallback", async () => {
  const f = fixture([["recent", [row("a.md")]]]);
  f.context.browserScripts = async () => [{ ...row("browser.md"), browser: true }];
  f.fail.read = "recent";
  assert.deepEqual(await f.names(), ["browser.md"]);
  await assert.rejects(f.update(() => []), /read refused/);
  delete f.fail.read;
  assert.deepEqual(await f.names(), ["a.md", "browser.md"]);
});

test("optional storage writes report success or failure and settle even when only abort fires", async () => {
  const f = fixture();
  assert.equal(await f.run('idbSet("recent", [])'), true);
  for (const outcome of ["error", "abort", "throw"]) {
    f.fail.write = outcome;
    assert.equal(await f.run('idbSet("recent", [])'), false, outcome);
  }
});

test("recent history: a failed removal keeps the browser file and its background state available for retry", async () => {
  const old = { ...row("browser.md"), browser: true };
  const f = fixture([["recent", [{ name: old.name, at: 1, browser: true }]]]);
  const kept = { handle: old.handle, doc: "retained words and asks", writes: Promise.resolve() };
  let deleted = false, keysDropped = false;
  f.context.browserScripts = async () => [old];
  f.context.keptFor = async () => kept;
  f.context.saving = { idle: async () => {} };
  f.context.scriptsDir = async () => ({ removeEntry: async () => { deleted = true; } });
  f.context.nameShared = async () => false;
  f.context.dropKeys = () => { keysDropped = true; };
  f.context.entry = old;
  f.run(`const deleting = [];\n${functionSource("deleteBrowserScript")}`);
  f.fail.read = "recent";
  await assert.rejects(f.run("deleteBrowserScript(entry)"), /read refused/);
  assert.equal(kept.gone, undefined, "its agent can still work in the retained script");
  assert.deepEqual(f.dropped, []);
  assert.equal(deleted, false);
  assert.equal(keysDropped, false, "its recovery draft and B-roll stay put");
  assert.equal(f.run("deleting.length"), 0, "a retry is not blocked");
  delete f.fail.read;
  await f.run("deleteBrowserScript(entry)");
  assert.equal(deleted, true);
  assert.equal(keysDropped, true);
});
