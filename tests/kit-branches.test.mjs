import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Step O (kitchen 89/90): changes land on dev and main only takes dev; the docs agents read say the same.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("kit.json lands on dev, releases to main, and the docs agree", () => {
  assert.deepEqual(JSON.parse(read("scripts/agents/kit.json")).branches, { land: "dev", release: "main", ci: "dev" });
  for (const doc of ["AGENTS.md", "docs/agents/kitchen-extras.md"]) {
    const text = read(doc);
    assert.match(text, /lands? on `dev`/, doc);
    assert.match(text, /kit pr --release --base main`/, doc);
    assert.doesNotMatch(text, /lands? in `main`|[Ll]anding branch `main`/, doc);
    assert.match(text, /`kit deploy` runs from `main` after the release|kit deploy`, run from `main` after the release/, doc);
    assert.match(text, /release-check/, doc);
  }
});

test("kit deploy runs kit release-check before wrangler", () => {
  const deploy = read("scripts/agents/project.d/deploy");
  assert.match(deploy, /^scripts\/agents\/kit release-check \|\| \{[^\n]*exit 1; \}$[\s\S]*wrangler@4 deploy/m);
});

// The deploy script itself, run with a stub kit and a stub npx: a failed check stops before wrangler.
const deployScript = fileURLToPath(new URL("../scripts/agents/project.d/deploy", import.meta.url));
const runDeploy = (t, checkStatus) => {
  const root = mkdtempSync(join(tmpdir(), "script-deploy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stub = (path, body) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755); };
  stub(join(root, "scripts/agents/kit"), `echo "RESULT: ${checkStatus ? "fail" : "ok"} release-check: stub"; exit ${checkStatus}`);
  const marker = join(root, "wrangler-ran");
  stub(join(root, "bin/npx"), `touch "${marker}"; echo "https://script-editor.example.workers.dev"`);
  const result = spawnSync(deployScript, [], { encoding: "utf8", env: { ...process.env, KIT_ROOT: root, PATH: `${join(root, "bin")}:${process.env.PATH}` } });
  return { result, ran: existsSync(marker), last: result.stdout.trimEnd().split("\n").at(-1) };
};

test("kit deploy stops before wrangler when kit release-check fails", t => {
  const { result, ran, last } = runDeploy(t, 1);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(last, /^RESULT: fail deploy: release-check/);
  assert.equal(ran, false);
});

test("kit deploy reaches wrangler when kit release-check passes", t => {
  const { result, ran, last } = runDeploy(t, 0);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(last, /^RESULT: ok deploy https:\/\/script\.techies\.tools/);
  assert.equal(ran, true);
});
