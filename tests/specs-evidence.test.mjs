import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const specs = join(import.meta.dirname, "../scripts/agents/project.d/specs");

test("kit specs: the evidence has no times, so two runs in a row give the same file, also when a test fails", () => {
  const root = mkdtempSync(join(tmpdir(), "specs-evidence-"));
  try {
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "tests/a.test.mjs"), [
      'import { test } from "node:test";',
      'test("passes", () => {});',
      'test("has a subtest", async (t) => { await t.test("inner fails", () => { throw new Error("no"); }); });',
      "",
    ].join("\n"));
    const run = () => {
      // Without the outer runner's NODE_TEST_CONTEXT, the inner node --test reports its own results.
      const { NODE_TEST_CONTEXT, ...env } = process.env;
      const r = spawnSync(process.execPath, [specs], { env: { ...env, KIT_ROOT: root }, encoding: "utf8" });
      return { status: r.status, text: readFileSync(join(root, "docs/agents/evidence/specs.txt"), "utf8") };
    };
    const one = run(), two = run();
    assert.equal(one.status, 1);
    assert.equal(one.text, two.text, "byte for byte the same");
    assert.doesNotMatch(one.text, /\(\d+(?:\.\d+)?ms\)$/m);
    assert.doesNotMatch(one.text, /duration_ms/);
    assert.match(one.text, /RESULT: fail specs\n$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("kit specs: --affected (what kit pr runs) takes an optional --base REF and runs every test; other words are refused", () => {
  const root = mkdtempSync(join(tmpdir(), "specs-affected-"));
  try {
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "tests/a.test.mjs"), 'import { test } from "node:test";\ntest("passes", () => {});\n');
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const run = (...args) => spawnSync(process.execPath, [specs, ...args], { env: { ...env, KIT_ROOT: root }, encoding: "utf8" });
    for (const args of [["--affected"], ["--affected", "--base", "origin/main"]]) {
      const r = run(...args);
      assert.equal(r.status, 0, args.join(" "));
      assert.match(r.stdout, /RESULT: ok specs --affected \(all tests\)\n$/);
    }
    for (const args of [["--affected", "--base"], ["--affected", "--base", "--x"], ["--affected", "extra"]]) {
      const r = run(...args);
      assert.equal(r.status, 2, args.join(" "));
      assert.match(r.stdout, /RESULT: fail specs usage/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
