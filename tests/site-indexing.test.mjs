import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Lex opened the pages to search engines on 2026-10-28; /api/ and /mcp stay out (the Worker marks them noindex).
const read = (p) => readFile(new URL(`../public/${p}`, import.meta.url), "utf8");

test("site: pages may be indexed, with a description and the canonical address", async () => {
  const [headers, html] = await Promise.all([read("_headers"), read("index.html")]);
  assert.doesNotMatch(headers, /noindex/i);
  assert.doesNotMatch(html, /noindex/i);
  assert.match(html, /<link rel="canonical" href="https:\/\/script\.techies\.tools\/">/);
  assert.match(html, /<meta name="description" content="[^"]{20,}">/);
});

test("site: robots.txt keeps /api/ and /mcp out and allows the rest", async () => {
  const robots = await read("robots.txt");
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Disallow: \/mcp$/m);
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
});
