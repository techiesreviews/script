import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, serialize, exportPrompter } from "../public/doc.js";
import { parseBroll, matchShots, scriptOrder, exportBroll } from "../public/broll.js";
import { makeZip } from "../public/zip.js";
import { videoFolder, writeFolder, folderNote, listState, FOLDER_NAMES } from "../public/video-folder.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const SCRIPT = read("../public/samples/demo-good-script.md");
const LIST = read("../public/samples/demo-good-script-broll.md");

// A one-pixel PNG and a one-pixel WebP, as the editor keeps pictures (data addresses).
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const WEBP = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
const DRAWING = '<svg viewBox="0 0 260 140"><rect class="s" x="10" y="10" width="100" height="60"/><text class="o" x="20" y="90">Lex</text></svg>';

function build(over = {}) {
  const doc = parse(SCRIPT);
  const { shots, sketches } = parseBroll(LIST);
  matchShots(doc, shots);
  return { doc, scriptText: serialize(doc), shots: scriptOrder(doc, shots), sketches, title: "Demo video", date: new Date(2026, 10, 10, 9, 30), linked: true, ...over };
}
const names = (r) => r.files.map((f) => f.name);
const byName = (r, n) => r.files.find((f) => f.name === n);
const text = (f) => (typeof f.text === "string" ? f.text : new TextDecoder().decode(f.text));

test("video folder: the files carry the video-folder names", () => {
  const r = videoFolder(build({ sketches: { [parseBroll(LIST).shots[0].id]: PNG } }));
  for (const n of ["script.md", "prompter.md", "recording-notes.md", "b-roll.md", "b-roll.json"]) assert.ok(names(r).includes(n), `${n} is there`);
  assert.deepEqual(FOLDER_NAMES, ["script.md", "prompter.md", "recording-notes.md", "b-roll.md", "b-roll.json"]);
  assert.ok(names(r).some((n) => /^pictures\/.+\.png$/.test(n)), "the picture is in pictures/");
  assert.ok(names(r).includes("save-receipt.md"));
  assert.equal(new Set(names(r)).size, names(r).length, "no name twice");
});

test("video folder: the script is saved word for word, and the prompter files are the prompter export, twice the same", () => {
  const input = build();
  const r = videoFolder(input);
  assert.equal(text(byName(r, "script.md")), input.scriptText);
  assert.equal(text(byName(r, "prompter.md")), exportPrompter(input.doc));
  assert.equal(text(byName(r, "recording-notes.md")), text(byName(r, "prompter.md")));
});

test("video folder: B-roll data and pictures are included, and b-roll.md points to each picture file", () => {
  const { shots } = parseBroll(LIST);
  const [a, b, c] = shots;
  const input = build({ sketches: { [a.id]: PNG, [b.id]: WEBP, [c.id]: DRAWING } });
  const r = videoFolder(input);
  const json = JSON.parse(text(byName(r, "b-roll.json")));
  assert.equal(json.title, "Demo video");
  assert.equal(json.shots.length, shots.length);
  const row = json.shots.find((s) => s.id === a.id);
  assert.deepEqual(Object.keys(row).sort(), ["check", "how", "id", "kind", "over", "picture", "what"]);
  assert.equal(row.what, a.what);
  assert.equal(row.over, a.over);
  assert.match(row.picture, /^pictures\/.+\.png$/);
  assert.match(json.shots.find((s) => s.id === b.id).picture, /\.webp$/);
  assert.match(json.shots.find((s) => s.id === c.id).picture, /\.svg$/);
  assert.equal(json.shots.filter((s) => s.picture).length, 3, "only the shots with a sketch have a picture");
  // The picture files exist, with the right bytes; the line drawing is a standalone SVG file.
  const png = byName(r, row.picture);
  assert.ok(png.text instanceof Uint8Array);
  assert.deepEqual([...png.text.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const webp = byName(r, json.shots.find((s) => s.id === b.id).picture);
  assert.equal(new TextDecoder().decode(webp.text.slice(0, 4)), "RIFF");
  const svg = text(byName(r, json.shots.find((s) => s.id === c.id).picture));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 260 140">/);
  assert.match(svg, /<text class="o" x="20" y="90">Lex<\/text>/);
  // b-roll.md names each picture file and carries no data address.
  const md = text(byName(r, "b-roll.md"));
  assert.match(md, new RegExp(`!\\[${a.id}\\]\\(${row.picture.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`));
  assert.ok(!md.includes("data:image"), "no embedded picture in b-roll.md");
  assert.ok(md.includes(a.over.slice(0, 20)), "the spoken anchor is in the list");
  // Every picture the list or json names is a file in the result.
  for (const p of json.shots.map((s) => s.picture).filter(Boolean)) assert.ok(names(r).includes(p), `${p} exists`);
});

test("video folder: picture file names are plain, never twice, and the shot's id stays in the list", () => {
  const shots = [{ id: "#1", kind: "broll", what: "One", over: "", how: "", blockIds: [] }, { id: "B 2", kind: "broll", what: "Two", over: "", how: "", blockIds: [] }, { id: "b-2", kind: "broll", what: "Three", over: "", how: "", blockIds: [] }];
  const r = videoFolder(build({ shots, sketches: { "#1": PNG, "B 2": PNG, "b-2": PNG } }));
  const pics = names(r).filter((n) => n.startsWith("pictures/"));
  assert.equal(pics.length, 3);
  assert.equal(new Set(pics.map((p) => p.toLowerCase())).size, 3);
  for (const p of pics) assert.match(p, /^pictures\/[A-Za-z][A-Za-z0-9._-]*$/);
  assert.ok(pics.includes("pictures/shot-1.png"), "an id that starts with a symbol gets shot- in front");
  // Every picture file is linked from b-roll.md, also a shot whose id has a space (no fence could carry it).
  const md = text(byName(r, "b-roll.md"));
  for (const p of pics) assert.ok(md.includes(`](${p})`), `${p} is linked`);
  assert.ok(!md.includes("data:image"));
  assert.deepEqual(JSON.parse(text(byName(r, "b-roll.json"))).shots.map((s) => s.id), ["#1", "B 2", "b-2"]);
});

test("video folder: a sketch of no shot is not written into b-roll.md as an embedded picture, and gets no file", () => {
  const { shots } = parseBroll(LIST);
  const r = videoFolder(build({ sketches: { [shots[0].id]: PNG, ORPHAN: PNG } }));
  assert.ok(!text(byName(r, "b-roll.md")).includes("data:image"));
  assert.equal(names(r).filter((n) => n.startsWith("pictures/")).length, 1);
});

test("video folder: accents in a shot id are dropped, not turned into dashes", () => {
  const shots = [{ id: "Crème", kind: "broll", what: "x", over: "", how: "", blockIds: [] }];
  assert.ok(names(videoFolder(build({ shots, sketches: { Crème: PNG } }))).includes("pictures/Creme.png"));
});

test("video folder: without a B-roll list there is no B-roll file, and the receipt says so", () => {
  const r = videoFolder(build({ linked: false, shots: [], sketches: {} }));
  assert.deepEqual(names(r).sort(), ["prompter.md", "recording-notes.md", "save-receipt.md", "script.md"]);
  assert.match(text(byName(r, "save-receipt.md")), /B-roll: no list linked/);
});

test("video folder: the receipt has the date and the word count, and is short", () => {
  const input = build();
  const r = videoFolder(input);
  const receipt = text(byName(r, "save-receipt.md"));
  assert.match(receipt, /Saved: 2026-11-10/);
  assert.match(receipt, new RegExp(`Words: ${r.receipt.words}\\b`));
  assert.ok(r.receipt.words > 100, "the demo script has words");
  assert.match(receipt, new RegExp(`B-roll: ${input.shots.length} shots`));
  assert.ok(receipt.split("\n").length <= 10, "short");
  assert.equal(r.receipt.date, "2026-11-10");
});

test("video folder: the zip fallback carries the same names", () => {
  const r = videoFolder(build({ sketches: { [parseBroll(LIST).shots[0].id]: PNG } }));
  const z = makeZip(r.files);
  const v = new DataView(z.buffer);
  const end = z.length - 22;
  assert.equal(v.getUint16(end + 10, true), r.files.length);
  let at = v.getUint32(end + 16, true);
  const found = [];
  for (let i = 0; i < r.files.length; i++) {
    const len = v.getUint16(at + 28, true);
    found.push(new TextDecoder().decode(z.subarray(at + 46, at + 46 + len)));
    at += 46 + len;
  }
  assert.deepEqual(found, names(r));
});

/* ---------- Writing into a chosen folder ---------- */
// A folder that behaves like the browser's directory handle: files and folders by name, writable streams.
function fakeFolder(start = {}) {
  const files = new Map(Object.entries(start));
  const handle = (prefix) => ({
    async getFileHandle(name, { create = false } = {}) {
      const path = prefix + name;
      if (!files.has(path) && !create) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
      return { async createWritable() { let data; return { async write(d) { data = d; }, async close() { files.set(path, data); } }; } };
    },
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!create && ![...files.keys()].some((p) => p.startsWith(`${prefix}${name}/`))) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
      return handle(`${prefix}${name}/`);
    },
  });
  return { dir: handle(""), files };
}

test("video folder: writeFolder writes every file under its name, pictures in their folder", async () => {
  const r = videoFolder(build({ sketches: { [parseBroll(LIST).shots[0].id]: PNG } }));
  const { dir, files } = fakeFolder();
  const out = await writeFolder(dir, r.files);
  assert.deepEqual([...files.keys()].sort(), names(r).sort());
  assert.deepEqual(out.kept, []);
  assert.equal(out.written.length, r.files.length);
  assert.equal(files.get("script.md"), text(byName(r, "script.md")));
  assert.ok(files.get(names(r).find((n) => n.startsWith("pictures/"))) instanceof Uint8Array);
});

test("video folder: an existing cue file stays as it is; the script and B-roll files are replaced", async () => {
  const r = videoFolder(build());
  const { dir, files } = fakeFolder({ "prompter.md": "Lex's short cues", "recording-notes.md": "Lex's short cues", "script.md": "old script", "b-roll.md": "old list" });
  const out = await writeFolder(dir, r.files);
  assert.equal(files.get("prompter.md"), "Lex's short cues");
  assert.equal(files.get("recording-notes.md"), "Lex's short cues");
  assert.equal(files.get("script.md"), text(byName(r, "script.md")));
  assert.equal(files.get("b-roll.md"), text(byName(r, "b-roll.md")));
  assert.deepEqual(out.kept.sort(), ["prompter.md", "recording-notes.md"]);
  assert.ok(!out.written.includes("prompter.md"));
});

test("video folder: a failed write rejects, so the app can say it could not save", async () => {
  const dir = { async getFileHandle() { return { async createWritable() { throw new Error("disk full"); } }; }, async getDirectoryHandle() { return dir; } };
  await assert.rejects(writeFolder(dir, videoFolder(build()).files), /disk full/);
});

test("video folder: a linked B-roll list that is loading, blocked or unreadable does not count as no list", () => {
  assert.equal(listState("none"), "none");
  assert.equal(listState("ok"), "ok");
  for (const status of ["loading", "permission", "error", undefined]) assert.equal(listState(status), "wait", String(status));
});

test("video folder: shot ids like constructor and toString work, with and without a paths option", () => {
  const shots = ["constructor", "toString", "__proto__"].map((id) => ({ id, kind: "broll", what: id, over: "", how: "", blockIds: [] }));
  const plain = exportBroll(shots, { constructor: DRAWING });
  assert.ok(!plain.includes("function"), "no inherited path in an ordinary export");
  assert.match(plain, /```svg constructor/);
  const r = videoFolder(build({ shots, sketches: { constructor: PNG } }));
  const json = JSON.parse(text(byName(r, "b-roll.json")));
  assert.equal(json.shots[0].picture, "pictures/constructor.png");
  assert.equal(json.shots[1].picture, null);
  assert.equal(json.shots[2].picture, null);
  assert.ok(!text(byName(r, "b-roll.md")).includes("function"));
});

test("video folder: a line drawing's file keeps a white background with no outline", () => {
  const { shots } = parseBroll(LIST);
  const r = videoFolder(build({ sketches: { [shots[0].id]: DRAWING } }));
  const svg = text(r.files.find((f) => f.name.endsWith(".svg")));
  assert.match(svg, /<rect width="260" height="140" style="fill:#fff;stroke:none"\/>/, "the inline style beats the drawing rules");
});

test("video folder: the note on the control says what happened, in a few words", () => {
  assert.equal(folderNote({ date: "2026-11-10", words: 1240, kept: [] }), "Saved 2026-11-10 · 1,240 words");
  assert.equal(folderNote({ date: "2026-11-10", words: 1, kept: ["prompter.md", "recording-notes.md"] }), "Saved 2026-11-10 · 1 word · cue files kept");
  assert.equal(folderNote({ zip: true, date: "2026-11-10", words: 12, kept: [] }), "Downloaded 2026-11-10 · 12 words");
  assert.equal(folderNote({ error: true }), "Could not save");
  assert.equal(folderNote({ error: true, wait: "loading" }), "B-roll list still loading");
  assert.equal(folderNote({ error: true, wait: "permission" }), "Allow the B-roll list first");
  assert.equal(folderNote({ error: true, wait: "error" }), "B-roll list can't be read");
  assert.equal(folderNote({ saving: true }), "Saving…");
  assert.equal(folderNote(null), "");
});

test("video folder: a note about the B-roll list follows the list, and clears once it is ready", () => {
  const waiting = { error: true, wait: "loading" };
  assert.equal(folderNote(waiting, "loading"), "B-roll list still loading");
  assert.equal(folderNote(waiting, "permission"), "Allow the B-roll list first", "the note says what the list needs now");
  assert.equal(folderNote(waiting, "error"), "B-roll list can't be read");
  assert.equal(folderNote(waiting, "ok"), "", "a list that is read now needs nothing");
  assert.equal(folderNote(waiting, "none"), "", "an unlinked list needs nothing");
  assert.equal(folderNote({ error: true }, "ok"), "Could not save", "other notes do not depend on the list");
  assert.equal(folderNote({ date: "2026-11-10", words: 12, kept: [] }, "loading"), "Saved 2026-11-10 · 12 words");
});

test("video folder: with only one cue file in the folder, that one is kept and the other is written", async () => {
  const r = videoFolder(build());
  const { dir, files } = fakeFolder({ "prompter.md": "cues" });
  const out = await writeFolder(dir, r.files);
  assert.equal(files.get("prompter.md"), "cues");
  assert.equal(files.get("recording-notes.md"), text(byName(r, "recording-notes.md")));
  assert.equal(files.get("recording-notes.md"), exportPrompter(build().doc));
  assert.deepEqual(out.kept, ["prompter.md"]);
});

test("video folder: nothing is deleted; a picture whose format changed stays, and the list names the new file", async () => {
  const { shots } = parseBroll(LIST);
  const id = shots[0].id;
  const first = videoFolder(build({ sketches: { [id]: PNG } }));
  const png = names(first).find((n) => n.startsWith("pictures/"));
  const { dir, files } = fakeFolder();
  await writeFolder(dir, first.files);
  const second = videoFolder(build({ sketches: { [id]: DRAWING } }));
  const svg = names(second).find((n) => n.startsWith("pictures/"));
  assert.match(png, /\.png$/);
  assert.match(svg, /\.svg$/);
  await writeFolder(dir, second.files);
  assert.ok(files.has(png), "the earlier picture is still in the folder");
  assert.ok(files.has(svg), "the new picture is written");
  const json = JSON.parse(files.get("b-roll.json"));
  const entry = (Array.isArray(json) ? json : json.shots).find((s) => s.id === id);
  assert.equal(entry.picture, svg);
});
