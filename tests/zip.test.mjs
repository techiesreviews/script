import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeZip, crc32 } from "../public/zip.js";

test("zip: crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("zip: Export all's file opens in a zip tool with every file, UTF-8 names and text intact", (t) => {
  const files = [{ name: "my-video.md", text: "# My video\n\nHello — “quotes”.\n" }, { name: "my-video-camera.txt", text: "Hello.\n" }, { name: "ünïcode-storyboard.html", text: "<!doctype html>" }];
  const bytes = makeZip(files, new Date(2026, 9, 29, 15, 30, 10));
  const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "all.zip");
  writeFileSync(path, bytes);
  const py = spawnSync("python3", ["-I", "-c", "import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps([[i.filename, z.read(i).decode('utf-8'), list(i.date_time)] for i in z.infolist()]))", path], { encoding: "utf8" });
  if (py.error) return t.skip("python3 is not here to read the zip");
  assert.equal(py.status, 0, py.stderr);
  const read = JSON.parse(py.stdout);
  assert.deepEqual(read.map(([n, txt]) => ({ name: n, text: txt })), files);
  assert.deepEqual(read[0][2], [2026, 10, 29, 15, 30, 10]);
});

test("zip: the layout is right without a zip tool (entries, offsets, names, sizes)", () => {
  const files = [{ name: "a.md", text: "# A\n" }, { name: "ü-b.txt", text: "héllo" }, { name: "c.html", text: "" }];
  const z = makeZip(files, new Date(1970, 0, 1));
  const v = new DataView(z.buffer);
  const end = z.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), files.length);
  const size = v.getUint32(end + 12, true), start = v.getUint32(end + 16, true);
  assert.equal(start + size, end);
  const dec = new TextDecoder(), enc = new TextEncoder();
  let at = start;
  for (const f of files) {
    assert.equal(v.getUint32(at, true), 0x02014b50);
    const nameLen = v.getUint16(at + 28, true), local = v.getUint32(at + 42, true);
    assert.equal(dec.decode(z.subarray(at + 46, at + 46 + nameLen)), f.name);
    assert.equal(v.getUint32(at + 24, true), enc.encode(f.text).length);
    assert.equal(v.getUint32(local, true), 0x04034b50);
    assert.equal(dec.decode(z.subarray(local + 30, local + 30 + nameLen)), f.name);
    assert.equal(dec.decode(z.subarray(local + 30 + nameLen, local + 30 + nameLen + enc.encode(f.text).length)), f.text);
    assert.equal(v.getUint16(at + 14, true), (0 << 9) | (1 << 5) | 1, "a date before 1980 is 1980-01-01");
    at += 46 + nameLen;
  }
});
