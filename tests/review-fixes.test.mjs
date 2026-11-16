import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Small fixes from the code review of 2026-11-15 (TOOLS-315). Facts the Worker and the tab both need are written once,
// in a small public module both import, so a change can't reach one side only.
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("shared facts: the agent token's age and the no-asks answer come from public/agent-link.js", async () => {
  const link = await import("../public/agent-link.js");
  const mcp = await import("../worker/mcp.js");
  assert.equal(link.TOKEN_MAX_AGE_MS, 8 * 60 * 60 * 1000);
  assert.equal(mcp.MAX_AGE_MS, link.TOKEN_MAX_AGE_MS);
  assert.equal(mcp.NO_ASKS, link.NO_ASKS);
  for (const f of ["public/app.js", "worker/mcp.js"]) {
    assert.ok(!src(f).includes("No asks yet."), `${f} writes the no-asks answer itself`);
    assert.ok(!/8 \* 60 \* 60 \* 1000/.test(src(f)), `${f} writes the token's age itself`);
    assert.match(src(f), /from "(\.\/|\.\.\/public\/)agent-link\.js"/, `${f} imports agent-link.js`);
  }
});

test("shared facts: the Worker takes the room id, key and protocol from the tab's room files", async () => {
  const link = await import("../public/together/link.js");
  const tabRoom = await import("../public/together/room.js");
  const workerRoom = await import("../worker/room.js");
  assert.equal(workerRoom.PROTOCOL, tabRoom.PROTOCOL);
  assert.ok(!src("worker/room.js").includes('"script-editor-room"'), "worker/room.js writes the protocol itself");
  assert.ok(!/const (ROOM|KEY)_RE =/.test(src("worker/index.js")), "worker/index.js writes the room id or key pattern itself");
  assert.match(src("worker/index.js"), /import \{[^}]*\bROOM_RE\b[^}]*\bKEY_RE\b[^}]*\} from "\.\.\/public\/together\/link\.js"/);
  assert.ok(link.ROOM_RE.test("a".repeat(22)) && link.KEY_RE.test("b".repeat(43)));
});

test("one HTML escape: doc.js's escHtml, used by app.js and broll.js (no copy of their own)", async () => {
  const doc = await import("../public/doc.js");
  assert.equal(doc.escHtml(`<a href="x">Tom & 'Jo'</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jo&#39;&lt;/a&gt;");
  assert.equal(doc.escHtml(null), "");
  assert.equal(doc.escHtml(7), "7");
  for (const f of ["public/app.js", "public/broll.js"]) assert.ok(!/replace\(\/\[&<>"'\]\/g/.test(src(f)), `${f} has its own HTML escape`);
});

test("no dead code: broll.js has no export that only the tests use", async () => {
  const broll = await import("../public/broll.js");
  assert.equal("applyBrollChanges" in broll, false, "applyBrollChanges: the app uses applyBrollChangesReport");
});

test("module names: the app's modules import each other under their own names, not one letter", () => {
  for (const f of ["public/app.js", "public/changes.js", "public/together-adapter.js", "public/broll-app.js", "public/saving.js"]) {
    const one = [...src(f).matchAll(/import \* as ([A-Za-z_$]+) from/g)].map((m) => m[1]).filter((n) => n.length === 1);
    assert.deepEqual(one, [], `${f} imports a module under a one-letter name`);
  }
});

test("left-behind copies: app.js gives them the browser's Web Locks (a stand-in in the tab without them), holds the open browser script, and saves with the name held", () => {
  const app = src("public/app.js");
  const call = app.match(/createLeftCopies\(\{[^\n]*\}\)/)?.[0] ?? "";
  assert.match(call, /locks: navigator\.locks \?\? tabLocks\(\)/, "the real lock manager, or one tab's stand-in: never no lock");
  assert.match(app, /const holdOpen = \(\) => copies\.open\(state\.inBrowser && state\.handle \? state\.name : null\);/);
  const body = (name) => app.slice(app.indexOf(name), app.indexOf("\n}\n", app.indexOf(name)));
  assert.match(body("function loadText("), /saving\.open\([^\n]*\n\s*holdOpen\(\);/, "a script that opens is held (or the last one let go) at once");
  assert.match(body("async function followTitle("), /state\.name = name; holdOpen\(\); renderTop\(\);/, "a renamed script is held under its new name");
  assert.match(app, /placed\(handle, \{ was = null, at, browser = false \}\) \{[^}]*const freed = holdOpen\(\);[^}]*Promise\.all\(\[freed, forget\(was\)\]\)\.then\(\(\) => copies\.afterMove\(was\.name, at\)\)/s, "a moved script is let go before its copy is cleaned, with the copy's time");
  assert.match(app, /held: \(name, fn\) => copies\.saving\(name, fn\),/, "every save holds its script's name");
});
