import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Facts the Worker and the tab both need are written once, in a small public module both import (TOOLS-315), so a
// change can't reach one side only.
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
