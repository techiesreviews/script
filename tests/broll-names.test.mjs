import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as Doc from "../public/doc.js";

// Run the app's naming boundary with IndexedDB failures, without starting its UI.
const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source)?.index;
  assert.notEqual(start, undefined, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

function fixture() {
  const stored = new Map([
    ["broll:first.md", { name: "first-shots.md" }],
    ["broll:Orphan.md", { name: "orphan-shots.md" }],
    ["brollList:Only-list.md", "# Old shots\n"],
    ["broll:cleared.md", null],
    ["brollList:cleared.md", null],
  ]);
  const fail = {}, loaded = [], notices = [], renamed = [], created = [];
  const state = { doc: Doc.parse("# Orphan\n\nKeep my words.\n"), name: "current.md", inBrowser: true, handle: { name: "current.md", move() {} } };
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        if (fail.at === "open") { request.error = new Error("open refused"); request.onerror(); return; }
        request.result = { transaction() {
          if (fail.at === "transaction") throw new Error("transaction refused");
          const transaction = {};
          transaction.objectStore = () => ({ openCursor() {
            const request = {}, entries = [...stored];
            let at = 0;
            const next = () => queueMicrotask(() => {
              if (at === 1 && fail.at === "cursor") { request.error = new Error("cursor refused"); request.onerror(); transaction.onerror?.(); return; }
              if (at === 1 && fail.at === "abort") { transaction.onabort?.(); return; }
              const entry = entries[at++];
              request.result = entry ? { key: entry[0], value: entry[1], continue: next } : null;
              request.onsuccess();
              if (!entry) queueMicrotask(() => {
                if (fail.at === "late-abort") transaction.onabort?.();
                else transaction.oncomplete?.();
              });
            });
            next();
            return request;
          } });
          return transaction;
        } };
        request.onsuccess();
      });
      return request;
    },
  };
  const context = vm.createContext({
    indexedDB, Doc, state, browserSaving: true,
    recentScripts: async () => [], copies: { names: () => [], rename: (...args) => renamed.push(args) }, SAMPLE: { name: "demo.md" },
    LS: "script:", localStorage: { length: 0 }, saving: { drafts: { get: () => null } },
    createBrowserScript: async (...args) => { created.push(args); throw new Error("file creation refused"); },
    askingToOpen: null, together: null, busyChoice: () => "", isDirty: () => false, scriptProblem: () => "",
    openProblem: (name) => notices.push(name),
    loadText: (...args) => loaded.push(args), renderTop() {}, renderAll() {}, renderDerived() {}, selectTitle() {},
  });
  vm.runInContext(`let brollKeys = Promise.resolve();\n${["idb", "idbLinkedNames", "keyed", "nameTaken", "newScript", "followTitle", "openScript"].map(functionSource).join("\n")}`, context);
  return { fail, stored, state, loaded, notices, renamed, created, run: (code) => vm.runInContext(code, context) };
}

test("B-roll names: failed discovery never approves a new or renamed script name; the queue recovers", async () => {
  for (const outcome of ["open", "cursor", "transaction", "abort", "late-abort"]) {
    const f = fixture(), before = [...f.stored];
    f.fail.at = outcome;
    const result = await Promise.race([
      f.run("nameTaken()").then((taken) => Doc.scriptFileName("", Doc.parse("# Orphan\n"), taken), () => "rejected"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 100)),
    ]);
    assert.equal(result, "rejected", `${outcome}: unknown reservations must stop naming`);
    await assert.rejects(f.run("followTitle(state.handle)"));
    await assert.rejects(f.run("openScript({ markdown: '# Orphan\\n' })"));
    assert.deepEqual(f.renamed, [], "no file rename before reservations are known");
    assert.deepEqual(f.created, [], "no agent-created file before reservations are known");
    assert.deepEqual(f.loaded, [], "no agent fallback opens under an unchecked name");
    assert.equal(f.state.name, "current.md");
    delete f.fail.at;
    const taken = await f.run("nameTaken('current.md')");
    assert.equal(Doc.scriptFileName("", Doc.parse("# Orphan\n"), taken), "orphan-2.md");
    assert.equal(Doc.titleFileName("current.md", Doc.parse("# Only list\n"), taken), "only-list-2.md");
    assert.equal(taken("ORPHAN.MD"), true, "a retained link reserves its name in any capitals");
    assert.equal(taken("ONLY-LIST.MD"), true, "an IndexedDB-only list reserves its name");
    assert.equal(taken("cleared.md"), false, "cleared records still free their names");
    assert.equal(taken("demo.md"), true, "the demo keeps its name");
    assert.deepEqual([...f.stored], before, "discovery changes no links or kept lists");
  }
});

test("New script: an unread reservation leaves the current script alone instead of opening a colliding fallback", async () => {
  const f = fixture(), doc = f.state.doc;
  f.stored.set("brollList:untitled-script.md", "# Someone else's shots\n");
  f.fail.at = "open";
  await f.run("newScript()");
  assert.deepEqual(f.loaded, [], "no fallback opens under an unchecked name");
  assert.equal(f.state.doc, doc);
  assert.equal(f.state.name, "current.md");
  assert.deepEqual(f.notices, ["a new script"], "the existing failed-open notice reports the failure");
  assert.equal(f.stored.get("brollList:untitled-script.md"), "# Someone else's shots\n");
});

test("New script: a file-creation failure still falls back to an unsaved script, using its checked name", async () => {
  const f = fixture();
  f.stored.set("brollList:untitled-script.md", "# Someone else's shots\n");
  await f.run("newScript()");
  assert.equal(f.loaded[0][1].name, "untitled-script-2.md");
  assert.equal(f.loaded[0][1].fresh, true);
});
