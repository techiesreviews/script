// Saving the open script: auto-save, Ctrl/Cmd+S, the changed-on-disk check, saves that wait while another one runs,
// drafts kept by script name, and saving into the browser or to a new file. No DOM: the file system, local storage and
// the clock are passed in, so the tests run it with a folder in memory (tests/saving.test.mjs).
//
// `script` is the open script's record (app.js reads it to draw the top bar). This module writes its save fields:
// handle, name, inBrowser, blank, savedText, savedAt, fileModified, saving, autoSaving, saveError, needsPermission,
// conflict. Every save carries its own handle, name and text, so a write lands in the file it was made for even after
// the person opened another script; its result changes `script` only while that script is still the open one.
import * as SaveQueue from "./save-queue.js";

// About 1.5 s after the last change, to the opened file only. Ctrl/Cmd+S and page hide save at once.
export const AUTOSAVE_MS = 1500;

// The browser's own files, as app.js hands them to createSaving and to the B-roll part.
export async function writeHandle(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
  try { return (await handle.getFile()).lastModified; } catch { return Date.now(); }
}
// Write access: a click may show the browser's prompt (`ask`); without it only access given before counts.
export async function permitted(handle, ask, mode = "readwrite") {
  const o = { mode };
  try {
    if (!handle.queryPermission) return true;
    if ((await handle.queryPermission(o)) === "granted") return true;
    return ask ? (await handle.requestPermission(o)) === "granted" : false;
  } catch { return false; }
}

// A browser copy left behind by a move to a file (the browser refused to delete it then) is kept off the list by name
// (in local storage, `store`) and deleted on a later listing; until then no script may take its name (app.js nameTaken).
// `dir()`: the browser's scripts folder. `lock(fn)`: runs fn alone among this site's tabs (navigator.locks; one at a
// time in this tab where the browser has no Web Locks), so one cleanup checks, deletes and frees a name before another
// may look at it.
export function createLeftCopies({ store, dir, lock = (fn) => fn() }) {
  const KEY = "movedCopies";
  const names = () => { const v = store.get(KEY); return Array.isArray(v) ? v : []; };
  // Right after the move: the copy goes, or its name is kept for later.
  const afterMove = (name) => lock(async () => {
    try { await (await dir()).removeEntry(name); } catch (e) { if (e?.name !== "NotFoundError") store.set(KEY, [...new Set([...names(), name])]); }
  });
  // A later listing found the copy: it goes, and its name is free again. The name is read again inside the lock:
  // another listing (or tab) may have deleted the copy meanwhile, and a new script may hold the name now.
  const retry = (name) => lock(async () => {
    const d = await dir();
    if (!names().includes(name)) return;
    try { await d.removeEntry(name); } catch (e) { if (e?.name !== "NotFoundError") return; }
    store.set(KEY, names().filter((n) => n !== name));
  });
  // After a full listing of the folder (`found`: every file name in it): the copies named in `left` (the names as the
  // listing started) that are still there go; the names whose copy went some other way (an older tab, cleared storage)
  // are freed.
  async function listed(left, found) {
    const gone = left.filter((n) => !found.has(n));
    // Looked up again inside the lock: the name may have been kept again for a newer copy since the folder was read.
    if (gone.length) await lock(async () => {
      const d = await dir(), free = [];
      for (const n of gone) {
        try { await d.getFileHandle(n); } catch (e) { if (e?.name === "NotFoundError") free.push(n); }
      }
      if (free.length) store.set(KEY, names().filter((n) => !free.includes(n)));
    });
    for (const n of left) if (found.has(n)) await retry(n);
  }
  // The scripts in the browser's folder, without the copies left behind; then those copies are cleaned (listed).
  async function list() {
    const out = [], left = names(), found = new Set();
    for await (const handle of (await dir()).values()) {
      if (handle.kind !== "file") continue;
      found.add(handle.name);
      if (names().includes(handle.name)) continue; // read live: another listing may have freed the name for a new script
      let at = 0;
      try { at = (await handle.getFile()).lastModified; } catch { /* listed without a time */ }
      out.push({ handle, name: handle.name, at, browser: true });
    }
    await listed(left, found);
    return out;
  }
  return { names, afterMove, listed, list };
}

/**
 * createSaving({ script, editor, files, browser, drafts, clock, on })
 * The caller keeps the open script's draft before it calls open() for another script.
 * - editor: { ready(), doc(), text(), dirty(), paused() } — a script is open and the person may save it; its document
 *   object; its text as it would be saved; changed since the last save; a "/" command is being typed.
 * - files: { write(handle, text) → modified, file(handle) → { lastModified, text() }, permitted(handle, ask),
 *   pickSave(suggestedName) → handle (null where files can't be picked), download(text, name) }
 * - browser: { name(from, doc) → a free name from the title, create(name, text) → { handle, modified } }
 * - drafts: local storage { get(key), set(key, value), del(key) }
 * - clock: { now(), later(fn, ms) → id, cancel(id) }
 * - on: { status(), conflict(at), written(handle), done(moved), renamed(from, to, { clear }), placed(handle, how) }
 */
export function createSaving({ script, editor, files, browser, drafts: store, clock, on }) {
  let queue = SaveQueue.emptyQueue();
  let timer = 0;
  let opened = 0; // counts open(): a Save as that lands after another script opened must leave that script alone

  const key = (name) => `draft:${name}`;
  const drafts = {
    get: (name) => store.get(key(name)),
    set: (name, draft) => store.set(key(name), draft),
    del: (name) => store.del(key(name)),
    move(from, to) {
      const draft = store.get(key(from));
      if (draft != null) { store.set(key(to), draft); store.del(key(from)); }
    },
  };

  function stop() { clock.cancel(timer); timer = 0; }
  function schedule() {
    stop();
    if (editor.paused()) return; // a "/" command is being typed: auto-save waits until the menu closes
    if (script.handle && !script.conflict && editor.dirty()) timer = clock.later(() => save({ auto: true }), AUTOSAVE_MS);
  }
  function flush() {
    stop();
    if (script.handle && !script.conflict && editor.dirty()) save({ auto: true });
  }

  const request = (force, auto) => ({
    handle: script.handle, name: script.name, text: editor.text(),
    savedText: script.savedText, fileModified: script.fileModified, force, auto,
  });
  // A script the person left could not be written: its draft is stamped now, so reopening it offers "Unsaved changes from …".
  function keepDraft(name, text) {
    const draft = drafts.get(name);
    drafts.set(name, { text, at: clock.now(), asks: draft?.asks ?? [], ...(draft?.broll ? { broll: draft.broll } : {}) });
  }
  // The file's time when it changed on disk since our last write (and holds other text), else 0.
  async function diskConflict(handle, req) {
    if (req.force || !req.fileModified) return 0;
    const f = await files.file(handle);
    if (f.lastModified <= req.fileModified) return 0;
    return SaveQueue.changedOnDisk(req, { lastModified: f.lastModified, text: await f.text() }) ? f.lastModified : 0;
  }
  // Write a left script's snapshot straight to its own file, with auto-save rules: no permission prompt, and the
  // changed-on-disk check. `script` is never touched.
  async function writeLeft(snap) {
    try {
      if (await files.permitted(snap.handle, false)) {
        if (!(await diskConflict(snap.handle, snap))) {
          return { handle: snap.handle, text: snap.text, modified: await files.write(snap.handle, snap.text) };
        }
      }
    } catch { /* kept as a draft below */ }
    keepDraft(snap.name, snap.text);
    return null;
  }

  async function save({ force = false, auto = false } = {}) {
    if (!editor.ready()) return;
    if (script.saving) {
      // Auto-save without a file does nothing; a click without a file waits for its turn to pick one.
      if (script.handle || !auto) queue = SaveQueue.queueSave(queue, request(force, auto));
      return;
    }
    // Auto-save only writes to a file that is already open; it never asks where to save.
    if (!script.handle && auto) return;
    if (!script.handle) return browser ? saveInBrowser() : saveAs();
    stop();
    const { handle, name, savedText, fileModified } = script;
    const text = editor.text();
    let written = null;
    script.saving = true;
    script.autoSaving = auto;
    script.saveError = "";
    on.status();
    try {
      // A click or key press may show the browser's permission prompt; auto-save may not, so it shows "Allow saving to …".
      if (!(await files.permitted(handle, !auto))) {
        if (auto) { if (handle === script.handle) script.needsPermission = true; }
        else throw new Error("No permission to write this file.");
      } else {
        if (handle === script.handle) script.needsPermission = false;
        const conflict = await diskConflict(handle, { force, fileModified, savedText });
        if (conflict && handle === script.handle) {
          script.conflict = true;
          on.conflict(conflict);
        } else if (!conflict) {
          // Written to the file it was made for, even if another script was opened meanwhile.
          written = { handle, text, modified: await files.write(handle, text) };
          if (handle === script.handle) {
            script.fileModified = written.modified;
            script.conflict = false;
            script.savedText = text;
            script.savedAt = clock.now();
            // A rename that fails leaves the old name; the text is saved either way.
            try { await on.written(handle); } catch { /* keeps its name */ }
          }
        }
      }
    } catch (e) {
      // A script the person already left keeps its local draft; its problem must not show on the new one.
      if (handle === script.handle) script.saveError = e?.message || "Could not save.";
    }
    if (!written && handle !== script.handle) keepDraft(name, text);
    queue = SaveQueue.settleQueue(queue, written);
    return drain(false);
  }
  // Scripts the person left go straight to their own files; requests that arrive meanwhile keep waiting. Then the
  // open script's own waiting request runs.
  async function drain(moved) {
    for (;;) {
      const { left, current } = SaveQueue.splitQueue(queue, script.handle);
      if (!left.length) { queue = SaveQueue.emptyQueue(); script.saving = false; finish(current, moved); return; }
      queue = { waiting: current, left: [] };
      for (const snap of left) queue = SaveQueue.settleQueue(queue, await writeLeft(snap));
    }
  }
  function finish(current, moved) {
    script.autoSaving = false;
    on.done(moved);
    // The open script's own waiting request runs with its own flags.
    if (current) save({ force: current.force, auto: current.auto });
    else if (!script.saveError && !script.needsPermission) schedule();
  }
  // After "The file changed on disk": the person keeps this version.
  function saveMine() {
    script.conflict = false;
    return save({ force: true });
  }
  async function allow() {
    if (!script.handle) return;
    if (await files.permitted(script.handle, true)) { script.needsPermission = false; on.status(); save(); }
    else { script.needsPermission = false; script.saveError = "No permission to write this file."; on.status(); }
  }

  // "Markdown file (.md)" and Ctrl/Cmd+S without an open file where nothing can be saved in the browser: pick where to
  // save, then keep auto-saving there.
  async function saveAs() {
    if (!editor.ready() || script.saving) return;
    const text = editor.text(), mine = opened;
    const was = script.inBrowser ? script.handle : null;
    // Where files can't be saved, a script in the browser stays there and a copy downloads.
    if (was && !files.pickSave) return files.download(text, script.name);
    script.saveError = "";
    try {
      if (files.pickSave) {
        let handle;
        try { handle = await files.pickSave(script.name); }
        catch (e) { if (e?.name === "AbortError") return; throw e; }
        script.saving = true;
        on.status();
        const modified = await files.write(handle, text);
        if (mine === opened) {
          script.fileModified = modified;
          if (handle.name !== script.name) {
            drafts.del(script.name);
            // The file's name takes this script's B-roll link and list, or none. A script leaving the browser frees
            // its name there, so its old keys are cleared; a file on disk or the demo keeps its own.
            on.renamed(script.name, handle.name, { clear: !!was });
            script.name = handle.name;
          }
          Object.assign(script, { handle, inBrowser: false, blank: "", needsPermission: false, conflict: false, savedText: text, savedAt: clock.now() });
          // The script moved to its file: the copy in the browser goes.
          on.placed(handle, { was });
        } else {
          // Another script opened while it was written: the file holds this text and is listed; the script open now
          // keeps its own file, name, draft and B-roll keys, and the browser copy stays.
          on.placed(handle, {});
        }
      } else {
        files.download(text, script.name);
        script.fileModified = clock.now(); // the downloaded copy is from now; the old file's day no longer fits it
        script.savedText = text;
        script.savedAt = clock.now();
      }
    } catch (e) {
      if (mine === opened) script.saveError = e?.message || "Could not save.";
    }
    // With another script open now, the saves made meanwhile run as after any save: scripts left go to their own
    // files (or drafts), then the open script's own request with its own flags (a click may still show the prompt).
    if (mine !== opened) return drain(true);
    script.saving = false;
    // Requests made during a save-as belonged to the old place; the new file is now current.
    queue = SaveQueue.emptyQueue();
    on.done(true);
    schedule();
  }
  // Ctrl/Cmd+S on a script without a file (the demo, or a file opened where files can't be saved): into the browser.
  async function saveInBrowser() {
    if (!editor.ready() || script.saving) return;
    const doc = editor.doc(), text = editor.text(), from = script.name;
    script.saving = true;
    script.saveError = "";
    on.status();
    try {
      const { handle, modified } = await browser.create(await browser.name(from, doc), text);
      if (editor.doc() === doc) {
        on.renamed(from, handle.name, { clear: false });
        Object.assign(script, { name: handle.name, handle, inBrowser: true, fileModified: modified, savedText: text, savedAt: clock.now(), needsPermission: false, conflict: false });
      }
      on.placed(handle, { browser: true });
    } catch (e) {
      if (editor.doc() === doc) script.saveError = e?.message || "Could not save.";
    }
    script.saving = false;
    queue = SaveQueue.emptyQueue();
    on.done(true);
    schedule();
  }

  // Another script opens: its record starts from its file (a pending auto-save of the last one was flushed before).
  function open({ handle = null, name, browser: inBrowser = false, savedText, modified = 0, fresh = false }) {
    opened++;
    // A waiting click without a file (the demo's Ctrl+S during its Save as) has nowhere to go once its script is left,
    // and never runs on the script opened now. Its words are in the draft the app keeps on leaving (loadText), which is
    // as new or newer, or the app found nothing unsaved.
    if (queue.waiting && !queue.waiting.handle) queue = { ...queue, waiting: null };
    Object.assign(script, {
      name, handle, inBrowser: !!handle && inBrowser, blank: "", savedText, savedAt: fresh ? 0 : modified,
      fileModified: modified, saveError: "", needsPermission: false, conflict: false,
    });
    stop();
  }
  // The handles saves are waiting for: a file the switcher hands over again is the same file.
  const queued = () => [queue.waiting?.handle, ...queue.left.map((x) => x.handle)].filter(Boolean);

  return { save, schedule, flush, stop, saveAs, saveMine, allow, open, queued, drafts };
}
