import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// public/_headers: the page is checked with the server on every visit (a release is seen at once, unchanged files
// come back as "not changed"), and a strict Content-Security-Policy allows only what the editor uses.
const pub = new URL("../public/", import.meta.url);
const read = (p) => readFile(new URL(p, pub), "utf8");

/** The rules in a Cloudflare _headers file: { "/path": { "header-name": "value" } }. */
function parseHeaders(text) {
  const rules = {};
  let path = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { path = line.trim(); rules[path] = {}; continue; }
    const at = line.indexOf(":");
    rules[path][line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return rules;
}
/** The CSP as { directive: [sources] }. */
const parseCsp = (value) => Object.fromEntries(value.split(";").map((d) => d.trim()).filter(Boolean)
  .map((d) => { const [name, ...src] = d.split(/\s+/); return [name, src]; }));

const all = async () => parseHeaders(await read("_headers"))["/*"] || {};

test("headers: every file is checked with the server before it is reused, never kept blindly or refused", async () => {
  const rules = parseHeaders(await read("_headers"));
  assert.match(rules["/*"]?.["cache-control"] || "", /^no-cache$/);
  // No file name carries a content hash, so nothing may be kept without asking (a release would mix old and new files).
  for (const [path, headers] of Object.entries(rules)) {
    assert.doesNotMatch(headers["cache-control"] || "", /no-store|immutable|max-age=[1-9]/, path);
  }
});

test("headers: a strict Content-Security-Policy that allows only what the editor uses", async () => {
  const csp = parseCsp((await all())["content-security-policy"] || "");
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["style-src"], ["'self'"]);
  // Agent and guest pictures are data: addresses; a big one is read back with fetch(data:) to make it lighter.
  assert.deepEqual(csp["img-src"], ["'self'", "data:"]);
  // Its own API, the live relay (wss on the live address, for browsers where 'self' does not cover wss) and data: pictures.
  assert.deepEqual(csp["connect-src"], ["'self'", "wss://script.techies.tools", "data:"]);
  for (const name of ["object-src", "base-uri", "frame-ancestors", "frame-src", "worker-src", "manifest-src"]) {
    assert.deepEqual(csp[name], ["'none'"], name);
  }
  assert.deepEqual(csp["form-action"], ["'self'"]);
  for (const sources of Object.values(csp)) {
    assert.ok(!sources.some((s) => /unsafe|^https?:$|^\*$/.test(s)), sources.join(" "));
  }
});

test("headers: the usual security headers", async () => {
  const h = await all();
  assert.equal(h["x-content-type-options"], "nosniff");
  assert.equal(h["x-frame-options"], "DENY");
  assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(h["cross-origin-opener-policy"], "same-origin");
  assert.match(h["strict-transport-security"] || "", /^max-age=\d{8,}$/);
  for (const feature of ["camera", "microphone", "geolocation"]) assert.match(h["permissions-policy"] || "", new RegExp(`\\b${feature}=\\(\\)`));
});

// What the CSP forbids must not be in the page: no inline script, style or handler in index.html, and no style
// attribute in markup the page builds (CSSOM .style.setProperty stays allowed). video-folder.js writes a standalone
// SVG file into the person's folder, never into the page.
test("headers: the page needs nothing the CSP blocks", async () => {
  const html = await read("index.html");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
  const files = [...(await readdir(pub)).filter((f) => f.endsWith(".js")), ...(await readdir(new URL("together/", pub))).filter((f) => f.endsWith(".js")).map((f) => `together/${f}`)];
  for (const file of files) {
    if (file === "video-folder.js") continue;
    assert.doesNotMatch(await read(file), /\sstyle="/, file);
  }
});

test("headers: the section list's people dots carry their colour as a key the CSS maps, not a style attribute", async () => {
  const { colourKey, colourVar } = await import("../public/together/carets.js");
  for (const p of [{ kind: "agent" }, { colour: 0 }, { colour: 5 }, { colour: 7 }]) {
    assert.equal(colourVar(p), colourKey(p) === "agent" ? "var(--agent)" : `var(--rc-${colourKey(p)})`);
  }
  const css = await read("app.css");
  for (const key of ["agent", "1", "2", "3", "4", "5", "6"]) assert.match(css, new RegExp(`\\.pdot--person\\[data-c="${key}"\\]`));
});
