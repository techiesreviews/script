import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import * as D from "../public/doc.js";

// TOOLS-311 (pick 4 of the TOOLS-296 review): the parts of the editor a person uses rarely load the first time they are
// needed, as the B-roll part does since TOOLS-306: the share room (Share to edit, or a guest's edit link), and the zip
// maker with the video-folder writer (Export all, Save to video folder). The page's first load carries none of them.
const pub = new URL("../public/", import.meta.url);
const read = (p) => readFileSync(new URL(p, pub), "utf8");
const size = (f) => statSync(new URL(f, pub)).size;

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
const LATER = ["together/room.js", "export-pack.js", "video-folder.js", "zip.js"];
const seam = (src, name = "SEAM") => Number(new RegExp(`\\b${name}\\s*=\\s*(\\d+)`).exec(src)?.[1]);

test("first load: the share room, the zip maker and the video-folder writer are not among the startup files", (t) => {
  const files = startupGraph();
  assert.ok(files.includes("app.js") && files.includes("together-adapter.js"), files.join(", "));
  for (const f of LATER) assert.ok(!files.includes(f), `${f} loads at startup: ${files.join(", ")}`);
  const bytes = files.reduce((n, f) => n + size(f), 0);
  t.diagnostic(`startup: ${files.length} files, ${bytes} bytes; on first use: ${LATER.map((f) => `${f} ${size(f)}`).join(", ")}`);
});

test("first load: the app loads the export pack with import() and the adapter loads the room with import(), each checking its seam version", () => {
  const app = read("app.js"), adapter = read("together-adapter.js");
  assert.match(app, /import\("\.\/export-pack\.js"\)/);
  assert.doesNotMatch(app, /from\s+["']\.\/(?:zip|video-folder|export-pack)\.js["']/);
  assert.equal(seam(read("export-pack.js")), seam(app, "PACK_SEAM"), "app.js and export-pack.js agree on the seam version");
  assert.match(adapter, /import\("\.\/together\/room\.js"\)/);
  assert.doesNotMatch(adapter, /from\s+["']\.\/together\/room\.js["']/);
  assert.equal(seam(read("together/room.js")), seam(adapter, "ROOM_SEAM"), "together-adapter.js and room.js agree on the seam version");
});

test("what the startup needs of them lives in small files; room.js and video-folder.js pass the same functions on", async () => {
  const link = await import("../public/together/link.js"), room = await import("../public/together/room.js");
  for (const name of ["parseLink", "newRoom", "makeLink", "ROOM_RE", "KEY_RE", "SECRET_RE"]) assert.equal(room[name], link[name], name);
  const keys = link.newRoom();
  assert.deepEqual(link.parseLink(new URL(link.makeLink("https://script.test/", keys)).hash), { room: keys.room, key: keys.key });
  const note = await import("../public/folder-note.js"), folder = await import("../public/video-folder.js");
  for (const name of ["listState", "settleFolder", "folderNote"]) assert.equal(folder[name], note[name], name);
  assert.equal(note.folderNote({ unloaded: true }), "Couldn't load. Reload the page.");
});

/* ---------- The export pack: Export all and Save to video folder ---------- */
const SCRIPT = read("samples/demo-good-script.md");
function memoryDir() {
  const files = new Map(), dirs = new Map();
  const dir = {
    files, dirs,
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name) && !create) throw Object.assign(new Error(name), { name: "NotFoundError" });
      return {
        async getFile() { return { text: async () => String(files.get(name)) }; },
        async createWritable() { let data; return { write: async (d) => { data = d; }, close: async () => { files.set(name, data); } }; },
      };
    },
    async getDirectoryHandle(name) { if (!dirs.has(name)) dirs.set(name, memoryDir()); return dirs.get(name); },
  };
  return dir;
}

test("export pack: one small interface; Export all packs the files it is given into a zip", async () => {
  const pack = await import("../public/export-pack.js");
  assert.deepEqual(Object.keys(pack).sort(), ["SEAM", "saveFolder", "zipAll"]);
  const zip = pack.zipAll([{ name: "a.md", text: "# A\n" }, { name: "a-camera.txt", text: "A\n" }]);
  assert.ok(zip instanceof Uint8Array);
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], "a zip starts with PK");
  assert.ok(new TextDecoder().decode(zip).includes("a-camera.txt"));
});

test("export pack: Save to video folder writes the script's folder, or gives a zip of it where there is no folder", async () => {
  const pack = await import("../public/export-pack.js");
  const doc = D.parse(SCRIPT);
  const args = { doc, scriptText: SCRIPT, title: D.titleOf(doc), broll: { linked: false }, modified: 0, dirty: true };
  const dir = memoryDir();
  const saved = await pack.saveFolder({ ...args, dir });
  assert.equal(saved.zip, undefined);
  assert.equal(saved.words, D.stats(doc).words);
  assert.ok(saved.written.includes("script.md") && saved.written.includes("prompter.md"), saved.written.join(", "));
  assert.equal(dir.files.get("script.md"), SCRIPT);
  const zipped = await pack.saveFolder({ ...args, dir: null });
  assert.ok(zipped.zip instanceof Uint8Array && zipped.zip.length > 0);
  assert.match(zipped.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(zipped.written, undefined);
});

/* ---------- The share room, with a stand-in page ---------- */
const listeners = () => {
  const on = new Map();
  return { on, addEventListener(type, fn) { on.set(type, [...(on.get(type) || []), fn]); }, fire: async (type, e = {}) => { for (const fn of on.get(type) || []) await fn(e); } };
};
const stubEl = () => ({
  ...listeners(), hidden: true, disabled: false, dataset: {}, value: "", textContent: "", innerHTML: "", title: "", children: [], firstChild: null,
  style: { setProperty() {} }, setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, append() {}, replaceChildren() {},
  showPopover() {}, focus() {}, select() {}, querySelector: () => stubEl(),
});
function page({ loadRoom }) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, stubEl()); return els.get(sel); };
  const copied = [];
  Object.assign(globalThis, {
    document: { querySelector: $, createElement: stubEl },
    location: { origin: "https://script.test", host: "script.test", protocol: "https:", hash: "" },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    ResizeObserver: class { observe() {} disconnect() {} },
    // A socket that never connects: a room started the old way (at once, with no part to wait for) goes nowhere.
    WebSocket: class { constructor() { this.readyState = 0; } addEventListener() {} send() {} close() {} },
  });
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t) => { copied.push(t); } } }, configurable: true });
  const calls = [];
  const doc = D.parse(SCRIPT);
  const app = {
    doc: () => doc, name: () => "demo.md", me: { id: "me", name: "Lex" }, held: () => null, selection: () => null, restore() {},
    element: () => null, applied() {}, loadGuest() {}, guestEnded: (s) => calls.push(["guestEnded", s]), joinFailed: (s) => calls.push(["joinFailed", s]),
    sharing: (on) => calls.push(["sharing", on]), renderTop() {}, renderDots() {}, asks: () => [], setRoomAsks() {}, guestAsk() {}, guestAct() {},
    askRefused() {}, brollShare: () => ({ status: "none" }), setRoomBroll() {}, undoAgent() {}, sheet: stubEl(), scriptEl: stubEl(), icon: () => "",
  };
  return { $, app, calls, copied, loadRoom };
}
// A room module that arrives when the test lets it; `made` collects the rooms the adapter starts.
function heldRoom() {
  const made = [];
  let release, fail;
  const arrived = new Promise((res, rej) => { release = res; fail = rej; });
  class RoomClient {
    constructor(o) { Object.assign(this, o); made.push(this); }
    start() { return this; }
    stop() { this.stopped = true; }
    link(origin) { return `${origin}/#room=${this.room}&k=${this.key}`; }
    peopleList() { return []; }
    caretList() { return []; }
  }
  let asked = 0;
  return { made, get asked() { return asked; }, load: () => { asked++; return arrived; }, release: (seam = 1) => release({ SEAM: seam, RoomClient }), fail: () => fail(new Error("offline")) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("share room: Share to edit copies the link inside the click; the room starts with that link's keys once its part is here", async () => {
  const { createTogether } = await import("../public/together-adapter.js");
  const held = heldRoom();
  const p = page({});
  const t = createTogether(p.app, { loadRoom: held.load });
  assert.equal(held.asked, 0, "nothing loads before the first share");
  await p.$("#shareBtn").fire("click");
  assert.equal(p.copied.length, 1, "the link is copied in the click, before the room's part arrives");
  assert.match(p.copied[0], /^https:\/\/script\.test\/#room=[\w-]{22}&k=[\w-]{43}$/);
  assert.equal(held.made.length, 0);
  assert.equal(t.sharing, true, "sharing counts as on while the part loads (another script may not open over it)");
  assert.equal(t.active, false, "no room runs yet: the person's own Undo still works");
  held.release();
  await tick();
  assert.equal(held.made.length, 1);
  assert.equal(held.made[0].role, "host");
  assert.equal(held.made[0].link("https://script.test"), p.copied[0], "the room is the one in the copied link");
  assert.equal(held.asked, 1);
});

test("share room: sharing stopped (or another script opened) before the part arrives starts no room", async () => {
  const { createTogether } = await import("../public/together-adapter.js");
  const held = heldRoom();
  const p = page({});
  const t = createTogether(p.app, { loadRoom: held.load });
  await p.$("#shareBtn").fire("click");
  t.stop();
  assert.equal(t.sharing, false);
  assert.deepEqual(p.calls.filter(([k]) => k === "sharing"), [["sharing", true], ["sharing", false]]);
  held.release();
  await tick();
  assert.equal(held.made.length, 0, "no room starts for a share that was stopped");
});

test("share room: a part that can't load ends sharing and the button says so; a guest's join says so too", async () => {
  const { createTogether } = await import("../public/together-adapter.js");
  const held = heldRoom();
  const p = page({});
  const t = createTogether(p.app, { loadRoom: held.load });
  await p.$("#shareBtn").fire("click");
  held.fail();
  await tick();
  assert.equal(t.sharing, false);
  assert.equal(held.made.length, 0);
  assert.deepEqual(p.calls.at(-1), ["sharing", false]);
  assert.equal(p.$("#shareLabel").textContent, "Couldn't share. Reload the page.");
  assert.equal(p.$("#shareBtn").title, "Couldn't share. Reload the page.");
  await p.$("#shareBtn").fire("click");
  assert.equal(p.copied.length, 1, "no new link is copied once the part has failed");

  const g = heldRoom();
  const q = page({});
  const guest = createTogether(q.app, { loadRoom: g.load });
  guest.join({ room: "r".repeat(22), key: "k".repeat(43) }, "Ann");
  g.fail();
  await tick();
  assert.deepEqual(q.calls.at(-1), ["joinFailed", "unloaded"]);
  assert.equal(g.made.length, 0);
});

test("share room: a guest joins once the part is here; a join replaced before then starts only the newer one", async () => {
  const { createTogether } = await import("../public/together-adapter.js");
  const g = heldRoom();
  const q = page({});
  const guest = createTogether(q.app, { loadRoom: g.load });
  guest.join({ room: "a".repeat(22), key: "k".repeat(43) }, "Ann");
  guest.join({ room: "b".repeat(22), key: "k".repeat(43) }, "Ann");
  g.release();
  await tick();
  assert.equal(g.made.length, 1);
  assert.equal(g.made[0].role, "guest");
  assert.equal(g.made[0].room, "b".repeat(22));
  assert.equal(guest.room, g.made[0]);
});

test("share room: a room part that speaks another seam version counts as not loaded, for the host and a guest", async () => {
  const { createTogether } = await import("../public/together-adapter.js");
  const held = heldRoom();
  const p = page({});
  const t = createTogether(p.app, { loadRoom: held.load });
  await p.$("#shareBtn").fire("click");
  held.release(2);
  await tick();
  assert.equal(held.made.length, 0);
  assert.equal(t.sharing, false);
  assert.deepEqual(p.calls.at(-1), ["sharing", false]);
  assert.equal(p.$("#shareLabel").textContent, "Couldn't share. Reload the page.");

  const g = heldRoom();
  const q = page({});
  createTogether(q.app, { loadRoom: g.load }).join({ room: "r".repeat(22), key: "k".repeat(43) }, "Ann");
  g.release(2);
  await tick();
  assert.equal(g.made.length, 0);
  assert.deepEqual(q.calls.at(-1), ["joinFailed", "unloaded"]);
});

test("share button: a copy that lands after sharing failed says nothing was copied and shows no fallback", async () => {
  const { createShareButton } = await import("../public/together/share-button.js");
  const el = () => ({ ...stubEl(), attrs: new Set(), toggleAttribute(n, on) { if (on) this.attrs.add(n); else this.attrs.delete(n); } });
  const button = el(), stop = el(), iconSlot = el(), label = el();
  let land, fallbacks = 0;
  const share = createShareButton({
    button, stop, iconSlot, label, icons: { share: "s", link: "l", check: "c" },
    share: () => "https://script.test/#room=x&k=y", end() {}, fallback: () => { fallbacks++; },
    copy: () => new Promise((res) => { land = res; }), timers: { setTimeout: () => 0, clearTimeout() {} },
  });
  const clicked = button.fire("click");
  share.fail("Couldn't share. Reload the page.");
  land();
  await clicked;
  assert.equal(label.textContent, "Couldn't share. Reload the page.");
  assert.ok(!button.attrs.has("data-done"), "no Link copied");
  assert.equal(fallbacks, 0);
  assert.equal(stop.hidden, true);
});
