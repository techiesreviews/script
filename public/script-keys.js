// Each script's own key for what is kept beside it (TOOLS-361): its safety-net draft, its B-roll link and a B-roll list
// kept in the browser, and with the draft its "Check" flags. Before, all of these went by file name, and Save to video
// folder calls every script script.md, so two scripts could share them.
// - A file on the computer gets an id of its own the first time it opens here, kept with its handle in IndexedDB
//   (`fileIds`: [{ handle, id }], the file opened most recently first): its key is `file:<id>`. The same file opened
//   again (the switcher hands over a fresh handle) is found by `isSameEntry` and keeps its key; another file of the
//   same name gets another. The stored list decides, at every open: one file has one key, in every tab and through
//   every handle (Save as onto a file keeps the key it had), and a key a tab still writes under that fell off the
//   list is put back.
// - A script in the browser goes by its name: names there are unique, and a rename moves its keys (app.js moveKeys).
// - A script without a file (the demo, a file opened where files can't be saved) goes by its name, as before.
// Keys kept by name before this change stay readable: the files on the recent list take them once (`migrate`), and a
// file seen for the first time later takes what is still under its name (`createHandOver`, see legacyPlan). A
// hand-over copies first, then the files' ids are kept, and only then the name lets go; every read in it fails
// loudly. Any doubt means nothing is deleted and nothing is marked done: the old keys stay as they were.
// No DOM: storage, the file comparison, the lock and the id maker are passed in.

export const IDS_KEY = "fileIds";
export const MIGRATED_KEY = "fileIdsSince"; // when the keys kept by name were handed to the files on the list
export const IDS_MAX = 200;
export const fileKey = (id) => `file:${id}`;
const idOf = (key) => key.slice("file:".length);

/**
 * legacyPlan(keys, { browser, moving }) → what the keys kept under one name before TOOLS-361 become, or null.
 * `keys`: the keys of the files of that name, newest first; `browser`: a script in the browser has that name (it keeps
 * them); `moving`: the one move of the files on the recent list. Every file gets a copy of the B-roll link and list it
 * showed before; the newest takes the draft (drafts were written on leaving a script, so the last one left wrote it);
 * then the name lets go of them, so a file opened later under that name starts without them. After the move, keys
 * under a browser script's name are that script's own: a file seen for the first time takes none of them.
 */
export function legacyPlan(keys, { browser = false, moving = false } = {}) {
  if (!keys.length || (browser && !moving)) return null;
  return { broll: [...keys], draft: browser ? null : keys[0], clear: !browser };
}

/**
 * createHandOver({ idb, local, key, browserHas, keeps }) → handOver(name, keys, { moving }?)
 * What was kept under a file name before TOOLS-361 goes to these files' keys (legacyPlan), in two steps, so that a
 * stop at any point loses nothing. handOver makes the copies and deletes nothing. It gives letGo(), which takes the
 * old keys away from the name and is called once the files' ids are kept (createScriptKeys does that), or null when
 * the name has nothing to let go. letGo.undo() takes the draft copy back, for a try whose ids could not be kept.
 * - idb: IndexedDB { read(key) → the value, undefined when nothing is stored (a link or list removed on purpose is a
 *   stored null); rejects when it can't read · put(key, value) → rejects when it can't write }
 * - local: local storage as it is stored { read(key) → a string, or null · write(key, string) · remove(key) }; each
 *   throws when it can't
 * - key: { draft(k), link(k), list(k) } → where a script key's draft, B-roll link and B-roll list are stored
 * - browserHas(name) → whether a script in the browser has that name; rejects when that can't be told
 * - keeps(name) → a name that keeps its own keys (the demo)
 * Every read comes before the first write, and a read that fails stops the hand-over: it is never taken for "nothing
 * there" (a draft that could not be read would count as handed over, and be deleted).
 */
export function createHandOver({ idb, local, key, browserHas, keeps = () => false }) {
  // When a draft was written. One that can't be read as a draft is an error: which of two is newer can't be told.
  const writtenAt = (raw) => { const at = JSON.parse(raw)?.at; return typeof at === "number" ? at : 0; };
  // A removal that did not take is an error too, so nothing counts as let go while it is still there.
  const remove = (k) => { local.remove(k); if (local.read(k) != null) throw new Error("It could not be removed."); };
  return async function handOver(name, keys, { moving = false } = {}) {
    if (keeps(name)) return null;
    const plan = legacyPlan(keys, { browser: await browserHas(name), moving });
    if (!plan) return null;
    // What the name holds. A list left in local storage (from before lists were kept in IndexedDB) counts when
    // IndexedDB has none.
    const link = await idb.read(key.link(name)), stored = await idb.read(key.list(name));
    const older = local.read(key.list(name)), draft = local.read(key.draft(name));
    const parsed = older == null ? null : JSON.parse(older);
    const list = typeof stored === "string" ? stored : typeof parsed === "string" ? parsed : null;
    if (link == null && list == null && draft == null) return null;
    // What the files hold already. Only places never written are filled (a try again never writes over what a file
    // has since, nor brings back a link removed on purpose), and of two drafts the one written later stays.
    const places = [];
    for (const k of plan.broll) places.push({ k, list: await idb.read(key.list(k)), link: await idb.read(key.link(k)) });
    const own = plan.draft && draft != null ? local.read(key.draft(plan.draft)) : null;
    const takes = !!plan.draft && draft != null && own !== draft && (own == null || writtenAt(draft) > writtenAt(own));
    // The copies: the list before its link, the draft last. A write that fails stops here, with everything still
    // under the name.
    for (const p of places) {
      if (list != null && p.list === undefined) await idb.put(key.list(p.k), list);
      if (link != null && p.link === undefined) await idb.put(key.link(p.k), link);
    }
    if (takes) local.write(key.draft(plan.draft), draft);
    if (!plan.clear) return null;
    // The name lets go: its draft first, then its list and link. A draft written under the name since the copy is
    // never deleted: letting go stops, and the next try hands those words over.
    const letGo = async () => {
      if (local.read(key.draft(name)) !== draft) throw new Error("The draft changed since it was copied.");
      if (draft != null) remove(key.draft(name));
      if (list != null && older != null) remove(key.list(name));
      if (list != null) await idb.put(key.list(name), null);
      if (link != null) await idb.put(key.link(name), null);
    };
    // A try whose ids could not be kept takes its draft copy back (the name still has the original), so no copy piles
    // up in local storage under keys nobody will look up. Copies in IndexedDB stay: where the ids can't be written
    // there, they could not be either.
    letGo.undo = () => {
      if (!takes) return;
      if (own == null) remove(key.draft(plan.draft));
      else local.write(key.draft(plan.draft), own);
    };
    return letGo;
  };
}

/**
 * createScriptKeys({ store, sameFile, lock, newId, handOver, live })
 * - store: { get(key) → value, or undefined (or null) when nothing is stored; rejects when it can't read (never
 *   "nothing" for a failed read: the list would be written over), put(key, value) → rejects when storage refuses }
 * - sameFile(a, b) → whether two handles are one file; lock(fn) → fn's result, alone among the tabs
 * - newId() → a new id; handOver(name, keys, { moving }?) — copies the keys kept under `name` to these files' keys
 *   (createHandOver); `moving` for the one move of the files on the recent list. It gives letGo() (or nothing): the
 *   name lets go of them, called here once the files' ids are kept
 * - live() → the files of the scripts this tab has in use (open, or kept aside): the keys it still writes under
 */
export function createScriptKeys({ store, sameFile, lock, newId, handOver, live = () => [] }) {
  const known = new WeakMap(); // handle -> key, as the stored list last gave it to this tab
  let ready = Promise.resolve();
  // The move of the keys kept by name (migrate) was asked for and is not done on this page: a file without an id whose
  // name waits goes by that name meanwhile and takes nothing alone (SL-1, SL-3). null: nothing waits. true: every name
  // (the move has not run yet, or its list could not be read). A Set: the names it could not hand over or that have not
  // let go; files of other names take their ids as usual, so one name that never works does not hold up the rest.
  let pending = null;
  const waits = (name) => pending === true || !!pending?.has(name);
  // Tries whose ids could not be kept take their draft copies back. One that can't stays: nothing is lost.
  const takeBack = (gos) => { for (const go of gos) try { go?.undo?.(); } catch { /* the copy stays */ } };
  const read = async () => {
    const list = await store.get(IDS_KEY);
    return Array.isArray(list) ? list.filter((r) => r?.handle && typeof r.id === "string") : [];
  };
  async function idIn(list, handle) {
    for (const r of list) if (await sameFile(r.handle, handle)) return r.id;
    return null;
  }
  // The key a script goes by now: a file looked up here has its own; any other script goes by its name.
  const keyOf = (handle, name) => (handle && known.get(handle)) || name;

  // The list as it should be kept now, or null when it is that already. `first`, the entry of the file opened or
  // saved into, goes to the front, so a full list lets go of the files not opened here for longest. The ids this tab
  // still writes under that fell off the list (other tabs filled it) go back on it: the scripts it has in use (`live`).
  // A script in use that the list has under another id by now is left alone: the list decides, at its next open.
  async function withMine(list, first = null) {
    const back = [];
    for (const handle of live()) {
      const id = known.has(handle) ? idOf(known.get(handle)) : null;
      if (!id || id === first?.id || back.some((r) => r.id === id) || list.some((r) => r.id === id)) continue;
      if (!(await idIn(list, handle))) back.push({ handle, id });
    }
    const next = [...(first ? [first] : []), ...back, ...list.filter((r) => r.id !== first?.id)].slice(0, IDS_MAX);
    return next.length === list.length && next.every((r, i) => r.id === list[i].id) ? null : next;
  }
  // The id this tab remembers for a file: for this handle, or for a script in use that is the same file.
  async function remembered(handle) {
    if (known.has(handle)) return idOf(known.get(handle));
    for (const h of live()) if (known.has(h) && (await sameFile(h, handle))) return idOf(known.get(h));
    return null;
  }
  // The id of a file that has one: the stored list decides (one file, one key, in every tab and through every
  // handle); an id this tab remembers that fell off the list still counts, and goes back on it (withMine).
  async function idFor(list, handle) {
    const id = (await idIn(list, handle)) ?? (await remembered(handle));
    if (id) known.set(handle, fileKey(id)); // before any write: a list that can't be written leaves the file its key
    return id;
  }
  // Keeps the list with this file's entry in front, then the tab knows the file by that key.
  async function keepId(list, handle, id) {
    const next = await withMine(list, { handle, id });
    if (next) await store.put(IDS_KEY, next);
    known.set(handle, fileKey(id));
    return fileKey(id);
  }

  // The key of a file on the computer, looked up in the stored list at every open (async). A file seen for the first
  // time gets an id and takes what is still kept under its name: the copies first, then its id is kept, and only then
  // the name lets go, so a stop in between loses nothing (no id yet: the next open tries again). Where the list can't
  // be read or written, a file goes on by the key this tab knows for it, else by its name; while the move is pending,
  // a file without an id goes by its name, where its old keys still are.
  function forFile(handle) {
    return ready.then(() => lock(async () => {
      const list = await read();
      const id = await idFor(list, handle);
      if (id) return keepId(list, handle, id);
      if (pending && (await store.get(MIGRATED_KEY))) pending = null; // another tab finished the move meanwhile
      if (waits(handle.name)) return handle.name;
      const mine = newId();
      const letGo = await handOver(handle.name, [fileKey(mine)]);
      const key = await keepId(list, handle, mine).catch((e) => { takeBack([letGo]); throw e; });
      // What can't be taken away now stays under the name: the file has its copies, so nothing is lost.
      if (letGo) await letGo().catch(() => {});
      return key;
    })).catch(() => keyOf(handle, handle.name));
  }

  // A file this script was just saved into (Save as). A file that has a key keeps it, whatever the handle: a script of
  // it open or kept aside in a tab goes on writing under that key, and the next page finds those words. A new file
  // gets a new id, and takes none of the old keys of its name. A new key is used only once it is kept (one the next
  // page could not find would lose what goes under it); where storage refuses, the file goes by the key this tab knows
  // for it, else by its name.
  function adopt(handle) {
    const run = ready.then(() => lock(async () => {
      const list = await read();
      return keepId(list, handle, (await idFor(list, handle)) ?? newId());
    })).catch(() => keyOf(handle, handle.name));
    ready = run.then(() => {});
    return run;
  }

  // The tab is looked at again: the keys of the scripts it has in use go back on the list if other tabs pushed them
  // off meanwhile, before a reload could lose what was written under them.
  function keep() {
    return ready.then(() => lock(async () => {
      const next = await withMine(await read());
      if (next) await store.put(IDS_KEY, next);
    })).catch(() => {});
  }

  // Once per browser profile: the files on the recent list (`listFiles` → [{ handle, name }], newest first) get ids, and
  // each name's keys from before go to its files. Opens wait for it. Every copy is made first, then the ids are kept,
  // and only then the names let go: nothing is deleted for a key the next page could not find. When a name's keys could
  // not all be copied (storage full, or a read that failed) or a name could not let go, it is not marked done, and the
  // next page tries again (handOver only fills places never written).
  function migrate(listFiles) {
    pending = true; // until it is known to be done: a list that can't be read never counts as "no files" (SL-3)
    ready = ready.then(() => lock(async () => {
      if (await store.get(MIGRATED_KEY)) return void (pending = null);
      const list = await read(), added = [], byName = new Map();
      for (const f of await listFiles()) {
        let id = await idIn([...added, ...list], f.handle);
        if (!id) { id = newId(); added.push({ handle: f.handle, id, name: f.name }); }
        if (!byName.has(f.name)) byName.set(f.name, []);
        if (!byName.get(f.name).includes(fileKey(id))) byName.get(f.name).push(fileKey(id));
      }
      // A name whose copies could not all be made keeps what it has, and its files get no id: they go by that name,
      // where their old keys still are, until the next page tries again with all of them (none takes them alone
      // meanwhile: `pending`, SL-1).
      const failed = new Set(), letGo = new Map();
      for (const [name, keys] of byName) {
        try { letGo.set(name, await handOver(name, keys, { moving: true })); } catch { failed.add(name); }
      }
      const mine = added.filter((r) => !failed.has(r.name)).map(({ handle, id }) => ({ handle, id }));
      if (mine.length) {
        await store.put(IDS_KEY, [...mine, ...list].slice(0, Math.max(IDS_MAX, mine.length))).catch((e) => { takeBack(letGo.values()); throw e; });
      }
      // A name that can't let go keeps its old keys beside the copies: nothing is lost, and the next page finishes it.
      for (const [name, go] of letGo) if (go) await go().catch(() => failed.add(name));
      if (failed.size) return void (pending = failed);
      await store.put(MIGRATED_KEY, Date.now());
      pending = null;
    })).catch(() => {});
    return ready;
  }

  return { keyOf, forFile, adopt, keep, migrate };
}
