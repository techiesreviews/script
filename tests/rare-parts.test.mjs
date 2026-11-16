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
// A room module that arrives when the test lets it (each load is a new request; release and fail answer the latest);
// `made` collects the rooms the adapter starts and `retries` what each load was asked with.
function heldRoom() {
  const made = [], retries = [];
  let release, fail, arrived;
  class RoomClient {
    constructor(o) { Object.assign(this, o); made.push(this); }
    start() { return this; }
    stop() { this.stopped = true; }
    link(origin) { return `${origin}/#room=${this.room}&k=${this.key}`; }
    peopleList() { return []; }
    caretList() { return []; }
  }
  let asked = 0;
  const load = (retry) => {
    asked++;
    retries.push(retry);
    return (arrived = new Promise((res, rej) => { release = res; fail = rej; }));
  };
  return { made, retries, get asked() { return asked; }, load, release: (seam = 1) => release({ SEAM: seam, RoomClient }), fail: () => fail(new Error("offline")) };
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
  assert.deepEqual(p.calls.filter(([k]) => k === "sharing"), [], "the app's Undo stays until the room starts");
  assert.equal(t.sharing, true, "sharing counts as on while the part loads (the agent may not open another script over it; the person opening one stops it)");
  assert.equal(t.active, false, "no room runs yet: the person's own Undo still works");
  held.release();
  await tick();
  assert.equal(held.made.length, 1);
  assert.equal(held.made[0].role, "host");
  assert.deepEqual(p.calls.filter(([k]) => k === "sharing"), [["sharing", true]], "the room started: the app clears its Undo now");
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
  assert.deepEqual(p.calls.filter(([k]) => k === "sharing"), [], "the app's Undo is cleared only when a room starts, so it stays");
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
  assert.deepEqual(p.calls.filter(([k]) => k === "sharing"), [], "no room started: the app's Undo stays");
  assert.equal(p.$("#shareLabel").textContent, "Couldn't share. Click to try again.");
  assert.equal(p.$("#shareBtn").title, "Couldn't share. Click to try again.");
  await p.$("#shareBtn").fire("click");
  assert.equal(held.asked, 2, "a click on the failed button asks for the part again");
  assert.deepEqual(held.retries, [0, 1], "the retry asks under a new address");
  assert.equal(p.copied.length, 2, "the retry copies a new link");
  assert.notEqual(p.copied[1], p.copied[0]);
  assert.equal(t.sharing, true);
  held.release();
  await tick();
  assert.equal(held.made.length, 1, "the part came this time: the room starts");
  assert.equal(held.made[0].link("https://script.test"), p.copied[1], "the room is the one in the newly copied link");
  assert.deepEqual(p.calls.filter(([k]) => k === "sharing"), [["sharing", true]]);
  assert.equal(p.$("#shareLabel").textContent, "Link copied");

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

test("share room: a room part that speaks another seam version counts as not loaded and says to reload, for the host and a guest", async () => {
  const { createTogether } = await import("../public/together-adapter.js");
  const held = heldRoom();
  const p = page({});
  const t = createTogether(p.app, { loadRoom: held.load });
  await p.$("#shareBtn").fire("click");
  held.release(2);
  await tick();
  assert.equal(held.made.length, 0);
  assert.equal(t.sharing, false);
  assert.deepEqual(p.calls.filter(([k]) => k === "sharing"), [], "no room started: the app's Undo stays");
  // A part from a newer release comes the same on every retry: only a reload helps, so the button says that.
  assert.equal(p.$("#shareLabel").textContent, "Couldn't share. Reload the page.");
  await p.$("#shareBtn").fire("click");
  assert.equal(held.asked, 2, "a click still asks again");
  held.release(2);
  await tick();
  assert.equal(held.made.length, 0);
  assert.equal(p.$("#shareLabel").textContent, "Couldn't share. Reload the page.", "the same newer part again: still says to reload");

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
  share.fail("Couldn't share. Click to try again.");
  land();
  await clicked;
  assert.equal(label.textContent, "Couldn't share. Click to try again.");
  assert.ok(!button.attrs.has("data-done"), "no Link copied");
  assert.equal(fallbacks, 0);
  assert.equal(stop.hidden, true);
});

test("share button: a failed share shows a warning icon and data-failed on the button; a click that shares again clears them", async () => {
  const { createShareButton } = await import("../public/together/share-button.js");
  const el = () => ({ ...stubEl(), attrs: new Set(), toggleAttribute(n, on) { if (on) this.attrs.add(n); else this.attrs.delete(n); } });
  const button = el(), stop = el(), iconSlot = el(), label = el();
  const share = createShareButton({
    button, stop, iconSlot, label, icons: { share: "s", link: "l", check: "c", warn: "w" },
    share: () => "https://script.test/#room=x&k=y", end() {}, copy: async () => {}, timers: { setTimeout: () => 0, clearTimeout() {} },
  });
  assert.ok(!button.attrs.has("data-failed"));
  share.fail("Couldn't share. Click to try again.");
  assert.ok(button.attrs.has("data-failed"), "the button is marked failed");
  assert.equal(iconSlot.innerHTML, "w", "the warning icon replaces the share icon");
  assert.equal(button.title, "Couldn't share. Click to try again.");
  await button.fire("click");
  assert.ok(!button.attrs.has("data-failed"), "sharing again clears the failed look");
  assert.equal(iconSlot.innerHTML, "c");
  assert.equal(label.textContent, "Link copied");
});

test("share button: a clipboard write from a share that failed, landing after a retry, neither shows its old link nor says Link copied", async () => {
  const { createShareButton } = await import("../public/together/share-button.js");
  const el = () => ({ ...stubEl(), attrs: new Set(), toggleAttribute(n, on) { if (on) this.attrs.add(n); else this.attrs.delete(n); } });
  for (const late of ["reject", "resolve"]) {
    const button = el(), stop = el(), iconSlot = el(), label = el();
    const writes = [], shown = [];
    let n = 0;
    const share = createShareButton({
      button, stop, iconSlot, label, icons: { share: "s", link: "l", check: "c", warn: "w" },
      share: () => `https://script.test/#room=${++n}&k=y`, end() {}, fallback: (link) => shown.push(link),
      copy: () => new Promise((res, rej) => writes.push({ res, rej })), timers: { setTimeout: () => 0, clearTimeout() {} },
    });
    const first = button.fire("click");
    share.fail("Couldn't share. Click to try again.");
    const retry = button.fire("click");
    if (late === "reject") { writes[1].res(); await retry; writes[0].rej(new Error("denied")); await first; }
    else { writes[0].res(); await first; }
    assert.deepEqual(shown, [], `${late}: the first share's link is not shown to copy by hand`);
    if (late === "reject") assert.equal(label.textContent, "Link copied", "the retry's own copy says Link copied");
    else {
      assert.ok(!button.attrs.has("data-done"), "the first share's copy does not say Link copied while the retry's is pending");
      assert.equal(label.textContent, "Copy edit link");
      assert.ok(!button.attrs.has("data-failed"), "the retry dropped the failed look before its copy landed");
      assert.equal(iconSlot.innerHTML, "l");
    }
  }
});

test("share button: a copy from a share that was stopped, landing after a new share, says nothing and shows no link", async () => {
  const { createShareButton } = await import("../public/together/share-button.js");
  const el = () => ({ ...stubEl(), attrs: new Set(), toggleAttribute(n, on) { if (on) this.attrs.add(n); else this.attrs.delete(n); } });
  for (const late of ["resolve", "reject"]) {
    const button = el(), stop = el(), iconSlot = el(), label = el();
    const writes = [], shown = [];
    let n = 0;
    createShareButton({
      button, stop, iconSlot, label, icons: { share: "s", link: "l", check: "c", warn: "w" },
      share: () => `https://script.test/#room=${++n}&k=y`, end() {}, fallback: (link) => shown.push(link),
      copy: () => new Promise((res, rej) => writes.push({ res, rej })), timers: { setTimeout: () => 0, clearTimeout() {} },
    });
    const first = button.fire("click");
    await stop.fire("click");
    button.fire("click");
    if (late === "resolve") writes[0].res(); else writes[0].rej(new Error("denied"));
    await first;
    assert.ok(!button.attrs.has("data-done"), `${late}: no Link copied for the stopped share's link`);
    assert.deepEqual(shown, [], `${late}: the stopped share's link is not shown`);
  }
});

test("share room: a share stopped before its part failed: the next Share to edit asks for the part again; failing again says so on the button", async () => {
  const { createTogether } = await import("../public/together-adapter.js");
  const held = heldRoom();
  const p = page({});
  const t = createTogether(p.app, { loadRoom: held.load });
  await p.$("#shareBtn").fire("click");
  t.stop();
  held.fail();
  await tick();
  assert.equal(p.$("#shareLabel").textContent, "Share to edit", "the stopped share heard nothing");
  await p.$("#shareBtn").fire("click");
  assert.equal(held.asked, 2, "the next share asks for the part again");
  held.fail();
  await tick();
  assert.equal(p.$("#shareLabel").textContent, "Couldn't share. Click to try again.");
  assert.equal(p.$("#shareBtn").title, "Couldn't share. Click to try again.");
  assert.equal(t.sharing, false);
  assert.equal(held.made.length, 0);
});

test("share room: a part that failed during the hover: the click asks for it again and shares", async () => {
  const { createTogether } = await import("../public/together-adapter.js");
  const held = heldRoom();
  const p = page({});
  const t = createTogether(p.app, { loadRoom: held.load });
  await p.$("#share").fire("pointerenter");
  held.fail();
  await tick();
  await p.$("#shareBtn").fire("click");
  assert.equal(held.asked, 2);
  assert.deepEqual(held.retries, [0, 1]);
  assert.equal(p.copied.length, 1, "the click copies the link");
  assert.equal(t.sharing, true);
  held.release();
  await tick();
  assert.equal(held.made.length, 1, "the room starts");
});

test("share room: the pointer or the focus reaching Share to edit fetches the room's part before the click", async () => {
  const { createTogether } = await import("../public/together-adapter.js");
  for (const type of ["pointerenter", "pointerdown", "focusin"]) {
    const held = heldRoom();
    const p = page({});
    createTogether(p.app, { loadRoom: held.load });
    await p.$("#share").fire(type);
    assert.equal(held.asked, 1, type);
    await p.$("#shareBtn").fire("click");
    assert.equal(held.asked, 1, `${type}: the click uses the same load`);
  }
});

test("share room: the copy-by-hand box opened while the part loads closes, with its link cleared, when the part then fails", async () => {
  const { createTogether } = await import("../public/together-adapter.js");
  const held = heldRoom();
  const p = page({});
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => { throw new Error("blocked"); } } }, configurable: true });
  const menu = p.$("#shareMenu"), box = p.$("#shareLink");
  menu.open = false;
  menu.showPopover = () => { menu.open = true; };
  menu.hidePopover = () => { menu.open = false; };
  const t = createTogether(p.app, { loadRoom: held.load });
  await p.$("#shareBtn").fire("click");
  assert.equal(menu.open, true, "copying is blocked: the box to copy by hand shows");
  assert.match(box.value, /^https:\/\/script\.test\/#room=/);
  held.fail();
  await tick();
  assert.equal(t.sharing, false);
  assert.equal(menu.open, false, "the box closes: its link leads to no room");
  assert.equal(box.value, "", "the dead link is cleared");
  assert.equal(p.$("#shareLabel").textContent, "Couldn't share. Click to try again.");
});

/* ---------- Looks: the colours the CSS gives (WCAG contrast from the oklch tokens) ---------- */
const CSS = read("app.css");
// A token's value for a theme: light-dark(a, b) picks a or b.
const token = (name, mode) => {
  const v = new RegExp(`--${name}:\\s*([^;]+);`).exec(CSS)?.[1].trim();
  const ld = /^light-dark\((oklch\([^)]*\)),\s*(oklch\([^)]*\))\)$/.exec(v);
  return ld ? ld[mode === "light" ? 1 : 2] : v;
};
const oklch = (s) => { const [l, c, h] = /oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)\)/.exec(s).slice(1); return { l: +l / 100, c: +c, h: h === "none" ? null : +h }; };
// color-mix(in oklch, a p, b): shorter hue; a missing hue takes the other one's.
const mix = (a, p, b) => {
  const ha = a.h ?? b.h, hb = b.h ?? a.h;
  let d = (hb ?? 0) - (ha ?? 0);
  if (d > 180) d -= 360; else if (d < -180) d += 360;
  return { l: a.l * p + b.l * (1 - p), c: a.c * p + b.c * (1 - p), h: ha == null ? null : (((ha + d * (1 - p)) % 360) + 360) % 360 };
};
const luminance = ({ l, c, h }) => {
  const r = ((h ?? 0) * Math.PI) / 180, A = c * Math.cos(r), B = c * Math.sin(r);
  const L = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3, M = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3, S = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const R = clamp(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S), G = clamp(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S), Bl = clamp(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S);
  return 0.2126 * R + 0.7152 * G + 0.0722 * Bl;
};
const ratio = (x, y) => { const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };

// The primary action's hovered or pressed background, as the CSS mixes it: color-mix(in oklch, var(--accent) N%, var(--ink)).
const primary = (state) => {
  const m = new RegExp(`:is\\(\\.tb\\.tb--primary, \\.menu-action\\.menu-action--primary\\):${state}\\s*\\{\\s*background:\\s*color-mix\\(in oklch, var\\(--accent\\) ([\\d.]+)%, var\\(--ink\\)\\)`).exec(CSS);
  assert.ok(m, `the primary action's :${state} background mixes the orange with the ink`);
  return Number(m[1]) / 100;
};
test("export menu: a note inside Export all (the orange primary action) reads at 4.5:1 in light and dark, at rest, hovered and pressed", () => {
  // The note's colour inside the primary action: a rule for it, else the notes' own muted colour.
  const own = /(?:^|\})\s*[^{}]*\.menu-action--primary[^{}]*\.menu-action__note[^{}]*\{[^}]*?\bcolor:\s*([^;}]+)/m.exec(CSS)?.[1].trim();
  for (const mode of ["light", "dark"]) {
    const accent = oklch(token("accent", mode)), ink = oklch(token("ink", mode));
    const text = !own ? oklch(token("muted", mode)) : own === "inherit" || own === "currentColor" ? oklch(token("on-accent", mode)) : oklch(token(/var\(--([\w-]+)\)/.exec(own)[1], mode));
    for (const [state, bg] of [["at rest", accent], ["hovered", mix(accent, primary("hover"), ink)], ["pressed", mix(accent, primary("active"), ink)]]) {
      assert.ok(ratio(text, bg) >= 4.5, `${mode}, ${state}: the note on the orange is ${ratio(text, bg).toFixed(2)}:1`);
    }
  }
});

test("share button: hovering the failed button keeps a warning background, a little stronger; pressing it still shows the pressed one", () => {
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m, i) => ({ i, sel: m[1].trim(), body: m[2] }));
  const hover = rules.find((r) => /\.share__btn\[data-failed\]:hover/.test(r.sel));
  assert.ok(hover, "a hover rule for the failed share button");
  const tint = /background:\s*color-mix\(in oklch, var\(--accent\) ([\d.]+)%, transparent\)/.exec(hover.body);
  assert.ok(tint && +tint[1] > 8 && +tint[1] < 15, `hovered, it stays orange, between rest (8 %) and pressed (15 %): ${hover.body.trim()}`);
  // The plain buttons' hover (.tb:not(.tb--ink, .tb--primary):enabled:hover, four classes) comes first, so the failed one wins.
  const plain = rules.find((r) => r.sel.startsWith(".tb:not(.tb--ink, .tb--primary):enabled:hover"));
  assert.ok(hover.i > plain.i, "the failed hover comes after the plain buttons' hover");
  assert.ok((hover.sel.match(/[.[:]/g) || []).length >= 4, `the failed hover is as specific as the plain one: ${hover.sel}`);
  const pressed = rules.find((r) => /\.share \.share__btn\[data-failed\]:active/.test(r.sel));
  assert.ok(pressed.i > hover.i, "the pressed look comes after the hover one, so a press shows");
});
