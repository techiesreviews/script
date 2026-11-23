// Drafts and B-roll use file:<id> for disk files, matched by isSameEntry across handles and tabs (TOOLS-361).
// Browser scripts and scripts without a file use their names. Active file ids survive list eviction.
// Migration copies the old name's values, persists file ids, then clears the name. Failed reads or writes leave
// the old values available for a retry. Storage, file comparison and locks are injected.

export const IDS_KEY = "fileIds";
export const MIGRATED_KEY = "fileIdsSince"; // when the keys kept by name were handed to the files on the list
export const IDS_MAX = 200;
export const fileKey = (id) => `file:${id}`;
const idOf = (key) => key.slice("file:".length);
// What createInUse gives, for tabs that can't tell each other anything (a caller that leaves `inUse` out).
const UNTOLD = { hold: async () => {}, ids: async () => [], elsewhere: async () => false };

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
 *   stored null); rejects when it can't read · put(key, value) → rejects when it can't write · fill(key, value) →
 *   writes only where nothing was ever stored, looked at and written in one transaction, so no other tab comes in
 *   between; rejects when it can't }
 * - local: local storage as it is stored { read(key) → a string, or null · write(key, string) · remove(key) }; each
 *   throws when it can't
 * - key: { draft(k), link(k), list(k) } → where a script key's draft, B-roll link and B-roll list are stored
 * - browserHas(name) → whether a script in the browser has that name; rejects when that can't be told
 * - keeps(name) → a name that keeps its own keys (the demo)
 * - inUse: { elsewhere(id) } → whether another tab has a file in use (createInUse). handOver runs inside the id list's
 *   lock (createScriptKeys calls it there), which is what makes that answer hold until the write. Left out: tabs
 *   that can't tell each other, where the hand-over goes by what it reads
 * Every read comes before the first write, and a read that fails stops the hand-over: it is never taken for "nothing
 * there" (a draft that could not be read would count as handed over, and be deleted). What a write goes by is read
 * again as it is made (see "The copies" below): other tabs do not wait for a hand-over.
 */
export function createHandOver({ idb, local, key, browserHas, keeps = () => false, inUse = UNTOLD }) {
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
    // under the name. Other tabs write while this one waits (a draft at any time, outside every lock), so no write
    // here trusts a read made before a wait: a place is looked at again and filled in one go (`fill`), and the two
    // drafts are read again right before the write, with no wait in between. Words kept meanwhile under the file's
    // key or under the name, or another tab that has the file in use, stop the hand-over: nothing is written over and
    // nothing let go, and the next try decides again.
    for (const p of places) {
      if (list != null && p.list === undefined) await idb.fill(key.list(p.k), list);
      if (link != null && p.link === undefined) await idb.fill(key.link(p.k), link);
    }
    if (takes) {
      // A tab that has the file in use may keep words under its key at any moment, and local storage has no lock: the
      // draft is written only while no other tab has it (none can take it up before the id list's lock is given
      // back, see createInUse). The read right before the write covers this tab's own scripts, and the name.
      if (await inUse.elsewhere(idOf(plan.draft))) throw new Error("Another tab has the file in use.");
      const still = local.read(key.draft(plan.draft)) === own && local.read(key.draft(name)) === draft;
      if (!still) throw new Error("A draft changed while it was handed over.");
      local.write(key.draft(plan.draft), draft);
    }
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
    // up in local storage under keys nobody will look up; only while the key still holds that copy (a file that had an
    // id before may get newer words from another tab meanwhile). List and link copies in IndexedDB stay: few, since
    // the ids are refused there too, and never read.
    letGo.undo = () => {
      if (!takes || local.read(key.draft(plan.draft)) !== draft) return;
      if (own == null) remove(key.draft(plan.draft));
      else local.write(key.draft(plan.draft), own);
    };
    return letGo;
  };
}

/**
 * createInUse(locks) → { hold(id), ids(), elsewhere(id) }: which file ids the tabs of this browser have in use, so
 * that a full id list never lets go of one of them (createScriptKeys) and the hand-over writes no draft under the key
 * of a file another tab has in use (createHandOver). A page holds a shared Web Lock for each id it has looked up,
 * until it goes away (a reload, a close, a crash: the browser gives the lock back), and every page can ask which ids
 * are held. Nobody asks for these locks alone, so a request never waits for another tab.
 * - locks: navigator.locks (`request`, `query`). One tab's stand-in (saving.js tabLocks) has no `query`: it knows the
 *   ids of its own page only.
 * - hold(id) → done once the lock is held, so no other tab's write of the list comes before it. A lock that can't be
 *   had never stops an open: the other tabs are then not told, and the id is still put back if it falls off the list
 *   (createScriptKeys).
 * - ids() → the ids held by any page; rejects when that can't be asked (never "none").
 * - elsewhere(id) → whether another page holds the id; rejects when that can't be asked (never "no"). A page comes
 *   to know a file's key, and so to write under it, only inside the id list's lock and with this lock held
 *   (createScriptKeys `know`). So inside that lock, "no other page holds it" means no other tab writes under that
 *   key until the lock is given back (createHandOver goes by that).
 */
const IN_USE = "script-editor:file-in-use:";
export function createInUse(locks) {
  const mine = new Set(), asked = new Map(); // the ids this page holds; id -> its one request
  function hold(id) {
    if (!asked.has(id)) asked.set(id, new Promise((done) => {
      const held = () => { mine.add(id); done(); return new Promise(() => {}); }; // not given back while the page lives
      // One that can't be had is asked for again the next time.
      Promise.resolve().then(() => locks.request(IN_USE + id, { mode: "shared" }, held)).catch(() => { asked.delete(id); done(); });
    }));
    return asked.get(id);
  }
  async function ids() {
    if (!locks.query) return [...mine];
    const { held } = await locks.query();
    return [...new Set(held.filter((l) => l.name.startsWith(IN_USE)).map((l) => l.name.slice(IN_USE.length)))];
  }
  // More holders than this page's own one. One tab's stand-in knows no other tab.
  async function elsewhere(id) {
    if (!locks.query) return false;
    const { held } = await locks.query();
    return held.filter((l) => l.name === IN_USE + id).length > (mine.has(id) ? 1 : 0);
  }
  return { hold, ids, elsewhere };
}

/**
 * createScriptKeys({ store, sameFile, lock, newId, handOver, live, inUse })
 * - store: { get(key) → value, or undefined (or null) when nothing is stored; rejects when it can't read (never
 *   "nothing" for a failed read: the list would be written over), put(key, value) → rejects when storage refuses }
 * - sameFile(a, b) → whether two handles are one file; lock(fn) → fn's result, alone among the tabs
 * - newId() → a new id; handOver(name, keys, { moving }?) — copies the keys kept under `name` to these files' keys
 *   (createHandOver); `moving` for the one move of the files on the recent list. It gives letGo() (or nothing): the
 *   name lets go of them, called here once the files' ids are kept
 * - live() → the files of the scripts this tab has in use (open, or kept aside): the keys it still writes under
 * - inUse: { hold(id), ids() } → what the tabs tell each other about the ids they have in use (createInUse). Left
 *   out, they can't: then only this tab's own scripts in use are known (`live`)
 */
export function createScriptKeys({ store, sameFile, lock, newId, handOver, live = () => [], inUse = UNTOLD }) {
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

  // The list as it should be kept now, or null when it is that already. `front` comes first: the entry of the file
  // opened or saved into (at the move: of the files given ids). Then the files in use, which count as opened most
  // recently: the scripts this tab has in use (`live`; an id of theirs that fell off the list goes back on it) and
  // the ids any tab holds (`inUse`). Then the rest, in the order it had. A full list lets go of the files not opened
  // for longest among that rest, and never of a file in use: a tab that is not looked at for a long time does not
  // lose a key it still writes under to the files other tabs open. Where it can't be told which ids are held, the
  // list lets go of none.
  // A script in use that the list has under another id by now is left alone: the list decides, at its next open.
  async function arranged(list, front = []) {
    const taken = new Set(front.map((r) => r.id)), mine = new Set(), back = [];
    for (const handle of live()) {
      const id = known.has(handle) ? idOf(known.get(handle)) : null;
      if (!id || taken.has(id) || mine.has(id)) continue;
      if (list.some((r) => r.id === id)) mine.add(id);
      else if (!(await idIn(list, handle))) { mine.add(id); back.push({ handle, id }); }
    }
    const held = await inUse.ids().then((ids) => new Set(ids), () => null); // null: it can't be told
    const used = (r) => !held || mine.has(r.id) || held.has(r.id);
    // The files in use stay in the order they had among themselves, so tabs looked at in turn do not write the list
    // again each time.
    const rest = [...back, ...list.filter((r) => !taken.has(r.id))];
    const kept = [...front, ...rest.filter(used)], free = rest.filter((r) => !used(r));
    const next = [...kept, ...free.slice(0, Math.max(0, IDS_MAX - kept.length))];
    return next.length === list.length && next.every((r, i) => r.id === list[i].id) ? null : next;
  }
  // The id this tab remembers for a file: for this handle, or for a script in use that is the same file.
  async function remembered(handle) {
    if (known.has(handle)) return idOf(known.get(handle));
    for (const h of live()) if (known.has(h) && (await sameFile(h, handle))) return idOf(known.get(h));
    return null;
  }
  // The id of a file that has one: the stored list decides (one file, one key, in every tab and through every
  // handle); an id this tab remembers that fell off the list still counts, and goes back on it (arranged).
  async function idFor(list, handle) {
    const id = (await idIn(list, handle)) ?? (await remembered(handle));
    if (id) await know(handle, id); // before any write: a list that can't be written leaves the file its key
    return id;
  }
  // The tab knows the file by this key from here on, and the other tabs are told its id is in use. Always inside the
  // list's lock, so no other tab writes the list between the two.
  async function know(handle, id) {
    await inUse.hold(id); // first: the tab writes under a key only once the others can see that it does
    known.set(handle, fileKey(id));
  }
  // Keeps the list with this file's entry in front, then the tab knows the file by that key.
  async function keepId(list, handle, id) {
    const next = await arranged(list, [{ handle, id }]);
    if (next) await store.put(IDS_KEY, next);
    await know(handle, id);
    return fileKey(id);
  }

  // The key of a file on the computer, looked up in the stored list at every open (async). A file seen for the first
  // time gets an id and takes what is still kept under its name: the copies first, then its id is kept, and only then
  // the name lets go, so a stop in between loses nothing (no id yet: the next open tries again). Where the list can't
  // be read or written, a file goes on by the key this tab knows for it, else by its name; while its name waits for
  // the move (`waits`), a file without an id goes by that name, where its old keys still are.
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

  // The tab is looked at again: the scripts it has in use go to the front of the list, and back on it if other tabs
  // pushed them off meanwhile (where the tabs can't tell each other), before a reload could lose what was written
  // under them.
  function keep() {
    return ready.then(() => lock(async () => {
      const next = await arranged(await read());
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
      // All of them are kept, however many, and so are the files the tabs have in use (`arranged`).
      if (mine.length) {
        const keepIds = async () => store.put(IDS_KEY, await arranged(list, mine));
        await keepIds().catch((e) => { takeBack(letGo.values()); throw e; });
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
