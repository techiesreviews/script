// Each script's own key for what is kept beside it (TOOLS-361): its safety-net draft, its B-roll link and a B-roll list
// kept in the browser, and with the draft its "Check" flags. Before, all of these went by file name, and Save to video
// folder calls every script script.md, so two scripts could share them.
// - A file on the computer gets an id of its own the first time it opens here, kept with its handle in IndexedDB
//   (`fileIds`: [{ handle, id }], the file opened most recently first): its key is `file:<id>`. The same file opened
//   again (the switcher hands over a fresh handle) is found by `isSameEntry` and keeps its key; another file of the
//   same name gets another.
// - A script in the browser goes by its name: names there are unique, and a rename moves its keys (app.js moveKeys).
// - A script without a file (the demo, a file opened where files can't be saved) goes by its name, as before.
// Keys kept by name before this change stay readable: the files on the recent list take them once (`migrate`), and a
// file seen for the first time later takes what is still under its name (`handOver`, see legacyPlan).
// No DOM: storage, the file comparison, the lock and the id maker are passed in.

export const IDS_KEY = "fileIds";
export const MIGRATED_KEY = "fileIdsSince"; // when the keys kept by name were handed to the files on the list
export const IDS_MAX = 200;
export const fileKey = (id) => `file:${id}`;

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
 * createScriptKeys({ store, sameFile, lock, newId, handOver })
 * - store: { get(key) → value, or undefined (or null) when nothing is stored; rejects when it can't read (never
 *   "nothing" for a failed read: the list would be written over), put(key, value) → rejects when storage refuses }
 * - sameFile(a, b) → whether two handles are one file; lock(fn) → fn's result, alone among the tabs
 * - newId() → a new id; handOver(name, keys, { moving }?) — hands the keys kept under `name` to these files' keys
 *   (legacyPlan); `moving` for the one move of the files on the recent list
 */
export function createScriptKeys({ store, sameFile, lock, newId, handOver }) {
  const known = new WeakMap(); // handle -> key, for the handles this tab looked up or made
  let ready = Promise.resolve();
  const read = async () => {
    const list = await store.get(IDS_KEY);
    return Array.isArray(list) ? list.filter((r) => r?.handle && typeof r.id === "string") : [];
  };
  async function idIn(list, handle) {
    for (const r of list) if (await sameFile(r.handle, handle)) return r.id;
    return null;
  }
  // The old keys that could not be handed over stay under the name. Gives whether it worked.
  const hand = (name, keys, o) => Promise.resolve().then(() => handOver(name, keys, o)).then(() => true, () => false);
  // The key a script goes by now: a file looked up here has its own; any other script goes by its name.
  const keyOf = (handle, name) => (handle && known.get(handle)) || name;

  // The key of a file on the computer, looked up (async). A file seen for the first time gets an id and takes what is
  // still kept under its name. Where storage refuses, the file goes by its name, as before.
  function forFile(handle) {
    if (known.has(handle)) return Promise.resolve(known.get(handle));
    return ready.then(() => lock(async () => {
      if (known.has(handle)) return known.get(handle);
      const list = await read();
      let id = await idIn(list, handle);
      if (!id) {
        id = newId();
        await store.put(IDS_KEY, [{ handle, id }, ...list].slice(0, IDS_MAX));
        // Not everything under its name could be handed over (storage full): no id yet, so the next open tries again;
        // until then it goes by its name, where its old keys still are.
        if (!(await hand(handle.name, [fileKey(id)]))) {
          await store.put(IDS_KEY, list);
          return handle.name;
        }
      } else if (list[0].id !== id) {
        // Opened again: to the front, so a full list lets go of the files not opened here for longest. Best effort: a
        // write that fails leaves it where it is, and it keeps its key.
        await store.put(IDS_KEY, [...list.filter((r) => r.id === id), ...list.filter((r) => r.id !== id)]).catch(() => {});
      }
      known.set(handle, fileKey(id));
      return fileKey(id);
    })).catch(() => handle.name);
  }

  // A file this script was just saved into (Save as): a new key, used only once it is kept (a key the next page could
  // not find would lose what goes under it); where storage refuses, the file goes by its name. A file picked again
  // keeps one entry, the new one: it holds this script now.
  function adopt(handle) {
    const id = newId();
    const run = ready.then(() => lock(async () => {
      const rest = [];
      for (const r of await read()) if (!(await sameFile(r.handle, handle))) rest.push(r);
      await store.put(IDS_KEY, [{ handle, id }, ...rest].slice(0, IDS_MAX));
      known.set(handle, fileKey(id));
      return fileKey(id);
    })).catch(() => handle.name);
    ready = run.then(() => {});
    return run;
  }

  // Once per browser profile: the files on the recent list (`listFiles` → [{ handle, name }], newest first) get ids, and
  // each name's keys from before go to its files. Opens wait for it. When a name's keys could not all be handed over
  // (storage full), it is not marked done, and the next page tries again (handOver only fills places never written).
  function migrate(listFiles) {
    ready = ready.then(() => lock(async () => {
      if (await store.get(MIGRATED_KEY)) return;
      const list = await read(), added = [], byName = new Map();
      for (const f of await listFiles()) {
        let id = await idIn([...added, ...list], f.handle);
        if (!id) { id = newId(); added.push({ handle: f.handle, id, name: f.name }); }
        if (!byName.has(f.name)) byName.set(f.name, []);
        if (!byName.get(f.name).includes(fileKey(id))) byName.get(f.name).push(fileKey(id));
      }
      const entry = ({ handle, id }) => ({ handle, id });
      await store.put(IDS_KEY, [...added.map(entry), ...list].slice(0, IDS_MAX));
      const failed = new Set();
      for (const [name, keys] of byName) if (!(await hand(name, keys, { moving: true }))) failed.add(name);
      if (!failed.size) return void (await store.put(MIGRATED_KEY, Date.now()));
      // A name not handed over keeps no new ids: its files go by that name, where its old keys still are, until the
      // next page tries again (a file opened meanwhile tries again too).
      await store.put(IDS_KEY, [...added.filter((r) => !failed.has(r.name)).map(entry), ...list].slice(0, IDS_MAX));
    })).catch(() => {});
    return ready;
  }

  return { keyOf, forFile, adopt, migrate };
}
