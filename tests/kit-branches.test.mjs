import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  }
});

test("kit deploy runs kit release-check before wrangler", () => {
  const deploy = read("scripts/agents/project.d/deploy");
  assert.match(deploy, /^scripts\/agents\/kit release-check \|\| \{[^\n]*exit 1; \}$[\s\S]*wrangler@4 deploy/m);
});
