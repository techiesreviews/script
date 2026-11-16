import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import * as D from "../public/doc.js";
import * as B from "../public/broll.js";

// TOOLS-306: the B-roll part of the editor is one module (public/broll-app.js) that the app loads the first time a
// script needs it (a linked list, B-roll asks, the Storyboard, an agent's B-roll call). The page's first load carries
// none of it, and the rest of the app talks to it through createBroll's small interface.
const pub = new URL("../public/", import.meta.url);
const read = (p) => readFileSync(new URL(p, pub), "utf8");
const SCRIPT = read("samples/demo-good-script.md");
const LIST = read("samples/demo-good-script-broll.md");

// The files a browser fetches before the page can run: index.html's module scripts and everything they import
// statically (import … from, export … from, bare import). A dynamic import() is not followed.
function startupGraph() {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = read(file).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
    for (const m of src.matchAll(/(?:^|[;\n])\s*(?:import|export)\s+(?:[^;()]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g)) {
      visit(new URL(m[1], new URL(file, pub)).pathname.slice(pub.pathname.length));
    }
  };
  for (const m of read("index.html").matchAll(/<script type="module" src="([^"]+)"/g)) visit(m[1]);
  return [...seen];
}

test("first load: no B-roll code is among the files the page needs to start", (t) => {
  const files = startupGraph();
  assert.ok(files.includes("app.js") && files.includes("doc.js"), files.join(", "));
  for (const f of ["broll.js", "broll-app.js"]) assert.ok(!files.includes(f), `${f} loads at startup: ${files.join(", ")}`);
  const bytes = files.reduce((n, f) => n + statSync(new URL(f, pub)).size, 0);
  const later = ["broll.js", "broll-app.js"].reduce((n, f) => n + statSync(new URL(f, pub)).size, 0);
  t.diagnostic(`startup: ${files.length} files, ${bytes} bytes; on first use: broll-app.js + broll.js, ${later} bytes`);
});

test("first load: the app loads the B-roll module with import() and checks its seam version", () => {
  const app = read("app.js");
  assert.match(app, /import\("\.\/broll-app\.js"\)/);
  assert.doesNotMatch(app, /from\s+["']\.\/broll(?:-app)?\.js["']/);
  const seam = (src) => Number(/\b(?:BROLL_)?SEAM\s*=\s*(\d+)/.exec(src)?.[1]);
  assert.ok(seam(app) >= 1);
  assert.equal(seam(read("broll-app.js")), seam(app), "app.js and broll-app.js agree on the seam version");
});

test("ask helpers the startup needs live in doc.js; broll.js passes the same functions on", () => {
  for (const name of ["spokenBlocks", "normalize", "withoutPictures", "askForAgent", "forAgent"]) {
    assert.equal(typeof D[name], "function", name);
    assert.equal(B[name], D[name], name);
  }
});

/* ---------- createBroll(host): the interface, with a stand-in page ---------- */
const stubEl = () => ({
  hidden: true, disabled: false, dataset: {}, value: "", textContent: "", innerHTML: "", title: "", children: [], firstChild: null,
  style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, contains: () => false, focus() {}, replaceChildren() {},
  insertAdjacentHTML() {}, prepend() {}, append() {}, remove() {}, closest: () => null, click() {}, requestSubmit() {},
  getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }), getClientRects: () => [],
});
function stage({ guest = false } = {}) {
  Object.assign(globalThis, {
    document: { ...stubEl(), documentElement: stubEl(), activeElement: null, createElement: stubEl },
    addEventListener() {}, removeEventListener() {},
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    getComputedStyle: () => ({ position: "static", translate: "none" }),
    matchMedia: () => ({ matches: false }),
    getSelection: () => ({ rangeCount: 0, isCollapsed: true, removeAllRanges() {} }),
    innerHeight: 800, scrollY: 0,
  });
  globalThis.CSS ??= {};
  globalThis.CSS.escape ??= (s) => String(s);
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, stubEl()); return els.get(sel); };
  const state = { doc: D.parse(SCRIPT), name: "demo-good-script.md", guest, asks: [], handle: null, inBrowser: false };
  const calls = [];
  const note = (name) => (...args) => { calls.push(name); return args[0]; };
  const host = {
    state, ui: { view: "script", scriptY: 0 }, scriptEl: stubEl(), $, $$: () => [], h: stubEl, icon: () => "", esc: (s) => String(s),
    store: { get: () => null, set() {}, del() {} }, me: { id: "me", name: "You" }, reduced: { matches: false },
    FILE_TYPES: [], SAMPLE: { name: "demo-good-script.md" }, SAMPLE_BROLL: { url: "samples/demo-good-script-broll.md", name: "demo-good-script-broll.md" },
    together: () => null, isOpen: (a) => D.OPEN_STATUSES.includes(a.status), isBrollAnswer: (a) => a.status === "answered" && a.answer?.kind === "broll",
    byId: (id) => D.blockById(state.doc, id), wrapOf: () => null, baseName: () => "demo-good-script",
    emit: note("emit"), changed: note("changed"), closeAsk: note("closeAsk"), validBy: (by) => by, offerAsks: note("offerAsks"),
    renderBlock: note("renderBlock"), getCaret: () => null, renderTocDots: note("renderTocDots"), renderAgent: note("renderAgent"),
    refreshBar: note("refreshBar"), brollChanged: note("brollChanged"), schedulePersist: note("schedulePersist"),
    hideBar: note("hideBar"), closeCard: note("closeCard"), editorJump: note("editorJump"), placeOverText: note("placeOverText"),
    positionSlash: note("positionSlash"), scriptView: () => ({ top: 0, bottom: 800 }), personInput: note("personInput"),
    readContent: () => "", offsetIn: () => 0, agentBy: () => ({ id: "agent:test", name: "Test" }), agent: { token: "t", ws: null },
    getLinkKey: async () => null, setLinkKey: async () => {}, keyed: (fn) => fn(), listKey: (n) => `brollList:${n}`,
    readKept: async () => null, delKept: async () => {}, idbPut: async () => {}, permitted: async () => true, writeHandle: async () => {},
    canPick: false,
  };
  return { host, state, calls };
}
const API = ["adoptRoom", "agentTool", "answerBroll", "canAdd", "cardOpen", "cleanSketches", "close", "closeCard", "dropGone",
  "endDrag", "escape", "exports", "flags", "folder", "link", "load", "openCard", "pictureBytes", "pictureHead", "positionCard",
  "refreshSuggestions", "rematch", "render", "renderMarks", "renderView", "requestPlan", "requestSketches", "roomShare",
  "setFlags", "shots", "sketch", "status", "touched"];

test("createBroll: one small interface, and a fresh part holds no list", async () => {
  const { SEAM, createBroll } = await import("../public/broll-app.js");
  assert.equal(typeof SEAM, "number");
  const { host } = stage();
  const b = createBroll(host);
  assert.deepEqual(Object.keys(b).sort(), API);
  assert.ok(Object.isFrozen(b));
  assert.equal(b.status(), "none");
  assert.equal(b.link(), null);
  assert.deepEqual(b.shots(), []);
  assert.equal(b.flags(), null);
  assert.equal(b.canAdd(), true);
  assert.equal(b.cardOpen(), false);
  assert.deepEqual(b.roomShare(), { status: "none" });
  assert.deepEqual(b.folder(host.state.doc), { linked: false, shots: [], sketches: {} });
  b.setFlags({ B2: true });
  assert.deepEqual(b.flags(), { B2: true }, "a draft's Check flags wait for the list");
});

test("createBroll: a script's linked list is read on load, shared with guests, exported and saved to the folder", async () => {
  const { createBroll } = await import("../public/broll-app.js");
  const { host, calls } = stage();
  host.getLinkKey = async () => ({ name: "demo-good-script-broll.md", text: LIST });
  const b = createBroll(host);
  await b.load();
  assert.equal(b.status(), "ok");
  assert.equal(b.link().name, "demo-good-script-broll.md");
  assert.deepEqual(b.shots().map((s) => s.id), B.parseBroll(LIST).shots.map((s) => s.id));
  assert.ok(b.shots()[0].blockIds.length, "shots are matched to the script's lines");
  assert.ok(calls.includes("brollChanged"), "the app hears that the list changed");
  const share = b.roomShare();
  assert.equal(share.status, "ok");
  assert.equal(share.text, LIST);
  assert.deepEqual(b.exports().map((f) => f.name), ["demo-good-script-broll.md", "demo-good-script-storyboard.html"]);
  const folder = b.folder(host.state.doc);
  assert.equal(folder.linked, true);
  assert.equal(folder.shots.length, b.shots().length);
  assert.equal(typeof folder.broll.exportBroll, "function", "the folder writer gets the B-roll helpers from the module");
  b.close();
  assert.equal(b.status(), "none");
  assert.deepEqual(b.shots(), []);
});

test("createBroll: a guest shows the host's list and cannot add shots", async () => {
  const { createBroll } = await import("../public/broll-app.js");
  const { host } = stage({ guest: true });
  const b = createBroll(host);
  b.adoptRoom({ status: "ok", name: "Host list", text: LIST, flags: { B1: true } });
  assert.equal(b.status(), "ok");
  assert.deepEqual(b.link(), { name: "Host list", shared: true });
  assert.equal(b.shots().find((s) => s.id === "B1").check, true);
  assert.equal(b.canAdd(), false);
  b.adoptRoom({ status: "none" });
  assert.equal(b.status(), "none");
});

test("createBroll: sketches in asks are cleaned where they come in, also the ones already there when it loads", async () => {
  const { createBroll } = await import("../public/broll-app.js");
  const { host, state } = stage();
  const bad = '<svg><script>alert(1)</script><rect class="s" x="1" y="1" width="9" height="9" onclick="x()"/></svg>';
  const early = { id: "a1", scope: "broll", action: "sketch", status: "answered", shots: [{ id: "B1" }], answer: { kind: "sketches", sketches: { B1: bad }, done: {} } };
  state.asks.push(early);
  const b = createBroll(host);
  assert.doesNotMatch(early.answer.sketches.B1, /script|onclick/);
  const later = { id: "a2", scope: "selection", status: "answered", answer: { kind: "broll", changes: [{ op: "add", kind: "broll", what: "x", sketch: bad, state: "open" }] } };
  assert.equal(b.cleanSketches(later), later);
  assert.doesNotMatch(later.answer.changes[0].sketch, /script|onclick/);
});
