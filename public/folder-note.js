// The note under "Save to video folder" (TOOLS-194), and what a save needs of the B-roll list. Small, so the page loads
// it at startup to show the note; the folder writer itself (video-folder.js) loads on first use (TOOLS-311).
export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** The B-roll list as a save sees it, from the editor's status: "none" (no list linked), "ok" (read), or "wait" (a linked
 *  list that is loading, blocked or unreadable: saving then would leave out B-roll the folder should have). */
export const listState = (status) => (status === "none" ? "none" : status === "ok" ? "ok" : "wait");

// What a linked list that is not ready needs, by the editor's status for it.
const WAIT_NOTE = { loading: "B-roll list still loading", permission: "Allow the B-roll list first", error: "B-roll list can't be read" };

/** A save the B-roll list stopped is over once the list is ready (`null`), so a later reload of the list brings no
 *  note back; any other result stays as it is. */
export const settleFolder = (r, status) => (r?.wait && listState(status) !== "wait" ? null : r);

/** The short note under "Save to video folder": what the last save did, or "". A save the B-roll list stopped follows
 *  the list's status now (`status`, when given): it says what the list needs, and nothing once the list is ready. */
export function folderNote(r, status) {
  if (!r) return "";
  if (r.unloaded) return "Couldn't load. Reload the page.";
  if (r.error && r.wait) {
    const now = status ?? r.wait;
    return listState(now) === "wait" ? WAIT_NOTE[now] || WAIT_NOTE.error : "";
  }
  if (r.error) return "Could not save";
  if (r.saving) return "Saving…";
  return `${r.zip ? "Downloaded" : "Saved"} ${r.date} · ${plural(r.words, "word")}${r.kept?.length ? " · cue files kept" : ""}${r.noLink ? " · no prompter link" : ""}`;
}
