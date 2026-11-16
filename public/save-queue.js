// Saves that wait while another save runs, kept per script. Pure: no DOM, no files. Imported by the app and the tests.
//
// A request is { handle, name, text, browser, savedText, force, auto }: everything needed to write that script to
// its own file later, even after the person has opened another script. `savedText` is the file's words as the tab last
// wrote or read them: the changed-on-disk check (saving.js) goes by them.
// The queue is { waiting, left }: `waiting` is the newest script's request; `left` holds snapshots of scripts
// the person has left, at most one per file.

export const emptyQueue = () => ({ waiting: null, left: [] });

// Within one file the strongest request wins: a forced or clicked save never shrinks into an auto-save.
function merge(older, newer) {
  return { ...newer, force: older.force || newer.force, auto: older.auto && newer.auto };
}

function keepSnapshot(left, snap, same) {
  const i = left.findIndex((s) => same(s.handle, snap.handle));
  if (i < 0) return [...left, snap];
  return left.map((s, j) => (j === i ? merge(s, snap) : s));
}

/** Add a request that arrived while another save runs. Flags only merge within the same file. */
export function queueSave(queue, request, same = Object.is) {
  const { waiting } = queue;
  if (waiting && same(waiting.handle, request.handle)) return { ...queue, waiting: merge(waiting, request) };
  // Another script: the old request becomes a snapshot for its own file, and a fresh record starts.
  return { waiting: { ...request }, left: waiting ? keepSnapshot(queue.left, waiting, same) : queue.left };
}

/** A write finished: later requests for that file compare against what was just written, not the older state. */
export function settleQueue(queue, written, same = Object.is) {
  if (!written) return queue;
  const fix = (r) => (r && same(r.handle, written.handle) ? { ...r, savedText: written.text } : r);
  return { waiting: fix(queue.waiting), left: queue.left.map(fix) };
}

/** When the running save ends: snapshots of scripts the person left, and the open script's own request (or null). */
export function splitQueue(queue, currentHandle, same = Object.is) {
  const { waiting, left } = queue;
  if (waiting && !same(waiting.handle, currentHandle)) return { left: keepSnapshot(left, waiting, same), current: null };
  return { left, current: waiting };
}
