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
