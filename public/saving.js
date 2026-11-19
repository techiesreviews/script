// Saving the open script: auto-save, Ctrl/Cmd+S, the changed-on-disk check, saves that wait while another one runs,
// drafts kept by script name, and saving into the browser or to a new file. No DOM: the file system, local storage and
// the clock are passed in, so the tests run it with a folder in memory (tests/saving.test.mjs).
//
// `script` is the open script's record (app.js reads it to draw the top bar). This module writes its save fields:
// handle, name, inBrowser, blank, savedText, savedAt, fileModified, saving, autoSaving, saveError, needsPermission,
// conflict. Every save carries its own handle, name and text, so a write lands in the file it was made for even after
// the person opened another script; its result changes `script` only while that script is still the open one.
//
// What a tab knows of a file is the words it last wrote into it or read from it (`savedText`). Whether a file is
// unchanged is decided by those words (their fingerprint) and never by the file's time: a time is read after the
// write, and by then it may be another tab's. `fileModified` is for what the person sees only (the day of a draft, the
// prompter link).
import * as SaveQueue from "./save-queue.js";

// About 1.5 s after the last change, to the opened file only. Ctrl/Cmd+S and page hide save at once.
export const AUTOSAVE_MS = 1500;

// The browser's own files, as app.js hands them to createSaving and to the B-roll part. Gives the file's time, to
// show; it proves nothing about whose words the file holds.
export async function writeHandle(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
  try { return (await handle.getFile()).lastModified; } catch { return Date.now(); }
}
// A script's fingerprint: the SHA-256 of its words as a file gives them back (UTF-8, so half of a character pair
// counts as the "\ufffd" the file gets, and a byte-order mark in front counts as nothing: a file is read without it).
export async function fingerprint(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
export const sameWords = async (a, b) => a === b || (await fingerprint(a)) === (await fingerprint(b));
// Write access: a click may show the browser's prompt (`ask`); without it only access given before counts.
export async function permitted(handle, ask, mode = "readwrite") {
  const o = { mode };
  try {
    if (!handle.queryPermission) return true;
    if ((await handle.queryPermission(o)) === "granted") return true;
    return ask ? (await handle.requestPermission(o)) === "granted" : false;
  } catch { return false; }
}

// One tab's stand-in for navigator.locks.request (shared and exclusive holders in the order asked, ifAvailable), for a
// browser without Web Locks: it orders this tab's own work only. The tests share one between their tabs.
export function tabLocks() {
  const all = new Map(); // name -> { held: [mode], waiting: [{ mode, start }] }
  const free = (s, mode) => !s.held.length || (mode === "shared" && !s.held.includes("exclusive"));
  const next = (name) => {
    const s = all.get(name);
    while (s.waiting.length && free(s, s.waiting[0].mode)) { const w = s.waiting.shift(); s.held.push(w.mode); w.start(); }
    if (!s.held.length) all.delete(name);
  };
  return {
    request(name, options, fn) {
      if (typeof options === "function") { fn = options; options = {}; }
      const mode = options.mode ?? "exclusive";
      if (!all.has(name)) all.set(name, { held: [], waiting: [] });
      const s = all.get(name);
      if (options.ifAvailable && (s.waiting.length || !free(s, mode))) return Promise.resolve().then(() => fn(null));
      return new Promise((resolve, reject) => {
        const release = () => { s.held.splice(s.held.indexOf(mode), 1); next(name); };
        s.waiting.push({ mode, start: () => Promise.resolve().then(() => fn({ name, mode })).then((v) => { release(); resolve(v); }, (e) => { release(); reject(e); }) });
        next(name);
      });
    },
  };
}

// The scripts in the browser's folder, for all tabs of the browser. `dir()`: that folder. `store`: local storage.
// `locks`: navigator.locks (tabLocks without it). `write(handle, text)`: writes a file, gives its time.
//
// A browser copy left behind by a move to a file (another tab has it open, or the browser refused to delete it) is kept
// off the list by name (in `store`) and deleted on a later listing; until then no script may take its name (app.js
// nameTaken). With the name goes the fingerprint of the copy's words as the tab that moved it knew them: only a copy
// that still holds exactly those words is the script that moved.
//
// Three kinds of lock keep the tabs from losing each other's words:
// - one for all cleanups, so one cleanup checks, deletes and frees a name before another (or another tab) looks at it;
// - one per script name, held shared by every tab that has that script open (`open`) and by every save into it
//   (`saving`). A script is deleted only under that lock held alone, taken only when it is free at once: one open in a
//   tab, or being saved into, is skipped, and a save that comes during a delete waits for it;
// - one per script name for writing, held alone by each save, from its look at the file to the end of its write: two
//   tabs' saves into one script run one after the other, so the second sees the first's words before it writes. A new
//   script (`create`) and a script taking another name (`rename`) write under that name's lock too.
export function createLeftCopies({ store, dir, locks = tabLocks(), write = writeHandle }) {
  const KEY = "movedCopies", PRINTS = "movedCopyPrints"; // the names, and each copy's fingerprint as the tab that moved it knew it
  const names = () => { const v = store.get(KEY); return Array.isArray(v) ? v : []; };
  const prints = () => { const v = store.get(PRINTS); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
  const free = (gone) => {
    store.set(KEY, names().filter((n) => !gone.includes(n)));
    store.set(PRINTS, Object.fromEntries(Object.entries(prints()).filter(([n]) => !gone.includes(n))));
  };
  const lock = (fn) => locks.request("script-editor:moved-copies", fn);
  const key = (name) => `script-editor:script:${name}`;
  const writing = (name) => `script-editor:write:${name}`;
  // Runs fn while no tab has the script open or saves into it; where one does, nothing runs (null).
  const unused = (name, fn) => locks.request(key(name), { ifAvailable: true }, (held) => (held ? fn() : null));
  const print = async (d, name) => fingerprint(await (await (await d.getFileHandle(name)).getFile()).text());
  const isGone = (e) => e?.name === "NotFoundError";
  // A script's row for the list (null: its file is gone). One whose time can't be read is listed without it.
  const row = async (handle) => {
    let at = 0;
    try { at = (await handle.getFile()).lastModified; } catch (e) { if (isGone(e)) return null; }
    return { handle, name: handle.name, at, browser: true };
  };

  // The browser script this tab has open (null: none, or a file on the computer). Its name is held until another
  // script opens, the script moves or is renamed, or the tab closes. The promise ends once the name held before is
  // let go, so a cleanup that follows can take it.
  let mine = null;
  function open(name) {
    if (mine?.name === name) return Promise.resolve();
    const was = mine;
    mine = null;
    was?.leave();
    if (name != null) {
      let leave;
      const until = new Promise((r) => { leave = r; });
      mine = { name, leave, left: locks.request(key(name), { mode: "shared" }, () => until).catch(() => {}) };
    }
    return was ? was.left : Promise.resolve();
  }
  // A save into the script `name` (fn: its look at the file, then its write) runs with the name held (asked for before
  // any wait, so a script that is left right after still has it) and alone among the saves into that script, in every
  // tab. Where the locks can't be asked for, the save runs all the same, once.
  async function saving(name, fn) {
    let ran = false;
    const run = () => { ran = true; return fn(); };
    try { return await locks.request(key(name), { mode: "shared" }, () => locks.request(writing(name), run)); } catch (e) { if (ran) throw e; return run(); }
  }
  // A new script, never over another one (getFileHandle with create would open it): the look and the write are one
  // save, so of two tabs that take the same free name at once one makes the script and the other is told.
  const create = (name, text) => saving(name, async () => {
    const d = await dir();
    let there = true;
    try { await d.getFileHandle(name); } catch (e) { if (!isGone(e)) throw e; there = false; }
    if (there) throw new Error(`${name} is in the browser already.`);
    const handle = await d.getFileHandle(name, { create: true });
    return { handle, modified: await write(handle, text) };
  });
  // A script takes another name (its title changed) only when no file has that name, looked up and moved under the
  // name's lock for writing. A name another tab is writing under right now is not waited for: false, as for a name
  // that is taken, and the script keeps its name until its next save.
  const rename = (handle, name) => locks.request(writing(name), { ifAvailable: true }, async (held) => {
    if (!held) return false;
    try { await (await dir()).getFileHandle(name); return false; } catch (e) { if (!isGone(e)) throw e; }
    await handle.move(name);
    return true;
  });
  // A script nobody wants (a new script left as it came) is deleted only while no tab has it open or saves into it and
  // it still holds exactly `words`. True once it is gone.
  const discard = async (name, words) => !!(await unused(name, async () => {
    const d = await dir();
    try {
      if ((await print(d, name)) !== (await fingerprint(words))) return false;
      await d.removeEntry(name);
    } catch (e) { return isGone(e); }
    return true;
  }));

  // Right after the move. `words`: the copy as the moving tab last wrote or read it; only a copy that still holds
  // them is the script that moved. It goes at once when no tab uses it. A copy with other words (saved into by another
  // tab) is not deleted and not hidden: it stays a browser script with those words. A copy in use, one the browser
  // won't delete or one that can't be read now is kept for later, with the fingerprint of those words.
  const afterMove = (name, words) => lock(async () => {
    const d = await dir(), known = await fingerprint(words);
    const settled = await unused(name, async () => {
      try {
        if ((await print(d, name)) !== known) return true;
        await d.removeEntry(name);
      } catch (e) { return isGone(e); }
      return true;
    });
    if (settled) { if (names().includes(name)) free([name]); return; }
    store.set(KEY, [...new Set([...names(), name])]);
    store.set(PRINTS, { ...prints(), [name]: known });
  });
  // A later listing found the copy: it goes, and its name is free again. The name is read again inside the lock:
  // another listing (or tab) may have deleted the copy meanwhile, and a new script may hold the name now. A copy in
  // use, or one that can't be read or deleted now, waits for the next listing. A copy with other words than the moving
  // tab knew (or kept without a fingerprint) is not deleted: its name is freed, so it shows in the switcher again.
  const retry = (name) => lock(async () => {
    const d = await dir();
    if (!names().includes(name)) return;
    await unused(name, async () => {
      const known = prints()[name];
      try {
        if (typeof known === "string" && (await print(d, name)) === known) await d.removeEntry(name);
        else await d.getFileHandle(name); // not the script that moved: only its name is freed, if it is still there
      } catch (e) { if (!isGone(e)) return; }
      free([name]);
    });
  });
  // The files among `skipped` (left out of a listing by their kept name) whose name is free now, as rows: a copy with
  // other words that a cleanup freed, in this listing or in another one at the same moment, or a new script that took
  // the name since. Read under the cleanups' lock, so a name is never looked at halfway through a cleanup.
  const shown = (skipped) => (skipped.length ? lock(async () => {
    const d = await dir(), rows = [];
    for (const name of skipped) {
      if (names().includes(name)) continue;
      let handle;
      try { handle = await d.getFileHandle(name); } catch { continue; }
      const r = await row(handle);
      if (r) rows.push(r);
    }
    return rows;
  }) : []);
  // After a full listing of the folder (`found`: every file name in it): the copies named in `left` (the names as the
  // listing started) that are still there go; the names whose copy went some other way (an older tab, cleared storage)
  // are freed. Gives the rows of the files the listing left out (`skipped`) that show after that.
  async function listed(left, found, skipped = left.filter((n) => found.has(n))) {
    const gone = left.filter((n) => !found.has(n));
    // Looked up again inside the lock: the name may have been kept again for a newer copy since the folder was read.
    if (gone.length) await lock(async () => {
      const d = await dir(), missing = [];
      for (const n of gone) {
        try { await d.getFileHandle(n); } catch (e) { if (isGone(e)) missing.push(n); }
      }
      if (missing.length) free(missing);
    });
    for (const n of left) if (found.has(n)) await retry(n);
    return shown(skipped);
  }
  // The scripts in the browser's folder, without the copies left behind; then those copies are cleaned, and every
  // file the walk left out whose name is free after that joins the list.
  async function list() {
    const out = [], left = names(), found = new Set(), skipped = [];
    try {
      for await (const handle of (await dir()).values()) {
        if (handle.kind !== "file") continue;
        found.add(handle.name);
        if (names().includes(handle.name)) { skipped.push(handle.name); continue; } // read live: another listing may have freed the name for a new script
        const r = await row(handle); // null: deleted meanwhile (a copy another cleanup took away)
        if (r) out.push(r);
      }
    } catch {
      return out; // the folder stopped listing: the scripts found so far show, and a partial walk frees no name
    }
    try { out.push(...(await listed(left, found, skipped))); } catch { /* the cleanup waits for the next listing; the scripts found still show */ }
    return out;
  }
  return { names, open, saving, create, rename, discard, afterMove, listed, list };
}

/**
 * createSaving({ script, editor, files, browser, drafts, clock, on })
 * The caller keeps the open script's draft before it calls open() for another script.
 * - editor: { ready(), doc(), text(), dirty(), paused() } — a script is open and the person may save it; its document
 *   object; its text as it would be saved; changed since the last save; a "/" command is being typed.
 * - files: { write(handle, text) → modified, file(handle) → { lastModified, text() }, permitted(handle, ask),
 *   pickSave(suggestedName) → handle (null where files can't be picked), download(text, name),
 *   held(name, fn) → fn's result: runs a save into a script in the browser with its name held, alone among the saves
 *   into that script in every tab (createLeftCopies saving; optional) }
 * - browser: { name(from, doc) → a free name from the title, create(name, text) → { handle, modified } }
 * - drafts: local storage { get(key), set(key, value), del(key) }
 * - clock: { now(), later(fn, ms) → id, cancel(id) }
 * - on: { status(), conflict(at), written(handle), done(moved), renamed(from, to, { clear }),
 *   placed(handle, { was, words, browser }) — was: the browser copy the script moved out of, words: that copy as
 *   this tab last wrote or read it; left({ handle, text, modified }) — a script the person left was written (optional) }
 */
export function createSaving({ script, editor, files, browser, drafts: store, clock, on }) {
  let queue = SaveQueue.emptyQueue();
  let timer = 0;
  let opened = 0; // counts open(): a Save as that lands after another script opened must leave that script alone
  const leftWaits = new Map(); // handle -> the saveLeft calls whose snapshot waits in the queue for a running save

  // A save into a script in the browser runs with its name held from its first step to the end of its write, alone
  // among the saves into that script in every tab: the cleanup of a left-behind browser copy never deletes one that
  // words are on their way into, and no other tab's save lands between this save's look at the file and its write. A
  // file on the computer has no such hold (other programs write it too); the changed-on-disk check is its guard.
  // The name is the file's own, read as the hold is asked for: a save that waited may be for a script that took
  // another name since (its title changed), and the other tabs know the file by the name it has now.
  const held = (browser, handle, fn) => (browser && files.held ? files.held(handle.name, fn) : fn());
  // The name a waiting request's draft goes by: its file's name now; the script's own for a request without a file.
  const nameOf = (req) => req.handle?.name ?? req.name;
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
    handle: script.handle, name: script.name, text: editor.text(), browser: script.inBrowser,
    savedText: script.savedText, force, auto,
  });
  // A script the person left could not be written: its draft is stamped now, so reopening it offers "Unsaved changes from …".
  function keepDraft(name, text) {
    const draft = drafts.get(name);
    drafts.set(name, { text, at: clock.now(), asks: draft?.asks ?? [], ...(draft?.broll ? { broll: draft.broll } : {}) });
  }
  // The changed-on-disk check: the file holds other words than this tab last wrote into it or read from it
  // (`savedText`). Gives { at: the file's time, to show }, else null. The file's time decides nothing.
  async function diskConflict(handle, req) {
    if (req.force) return null;
    const f = await files.file(handle);
    return (await sameWords(await f.text(), req.savedText)) ? null : { at: f.lastModified };
  }
  // Write a left script's snapshot straight to its own file, with auto-save rules: no permission prompt, and the
  // changed-on-disk check. `script` is never touched.
  function writeLeft(snap) {
    return held(snap.browser, snap.handle, async () => {
      try {
        if (await files.permitted(snap.handle, false)) {
          if (!(await diskConflict(snap.handle, snap))) {
            return { handle: snap.handle, text: snap.text, modified: await files.write(snap.handle, snap.text) };
          }
        }
      } catch { /* kept as a draft below */ }
      keepDraft(nameOf(snap), snap.text);
      return null;
    });
  }
  // A left script's words reached its file: the app keeps what that file now holds (`left` is optional).
  const wroteLeft = (written) => { if (written) on.left?.(written); return written; };

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
    const { handle, savedText, inBrowser } = script;
    const text = editor.text();
    let written = null;
    script.saving = true;
    script.autoSaving = auto;
    script.saveError = "";
    on.status();
    await held(inBrowser, handle, async () => {
      try {
        // A click or key press may show the browser's permission prompt; auto-save may not, so it shows "Allow saving to …".
        if (!(await files.permitted(handle, !auto))) {
          if (auto) { if (handle === script.handle) script.needsPermission = true; }
          else throw new Error("No permission to write this file.");
        } else {
          if (handle === script.handle) script.needsPermission = false;
          const conflict = await diskConflict(handle, { force, savedText });
          if (conflict && handle === script.handle) {
            script.conflict = true;
            on.conflict(conflict.at);
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
    });
    if (!written && handle !== script.handle) keepDraft(handle.name, text);
    if (written && handle !== script.handle) wroteLeft(written);
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
      for (const snap of left) {
        const written = wroteLeft(await writeLeft(snap));
        queue = SaveQueue.settleQueue(queue, written);
        const waits = leftWaits.get(snap.handle);
        leftWaits.delete(snap.handle);
        for (const done of waits || []) done(written);
      }
    }
  }
  // A script the person left changed while it waited (their agent's answer landed in it, TOOLS-358): its words go to
  // its own file with the auto-save rules. While a save runs, they wait in the queue like any script left behind, after
  // an older write of the same file, and are compared with what that write left. Gives { handle, text, modified }, or
  // null when the words were kept as a draft instead. `script` is never touched.
  function saveLeft(snap) {
    if (!script.saving) return writeLeft(snap).then(wroteLeft);
    queue = SaveQueue.queueLeft(queue, { ...snap, force: false, auto: true });
    return new Promise((done) => leftWaits.set(snap.handle, [...(leftWaits.get(snap.handle) || []), done]));
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
          const words = script.savedText; // the browser copy as this tab last wrote or read it
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
          on.placed(handle, was ? { was, words } : { was });
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

  return { save, schedule, flush, stop, saveAs, saveMine, saveLeft, allow, open, queued, drafts };
}
