# Working together (Share to edit)

The host shares a script with a link; guests type a name and edit it live, each with their own caret. The host's tab is the source of truth and its file stays the only copy: the room passes messages and stores no script text. Step D1 built the rooms, carets, Share to edit and the guest limits; D2 adds guests' asks, the agent's caret, B-roll and `/` parts for guests.

## Pieces

| File | What it does |
| --- | --- |
| `public/together/ops.js` | Block operations, their transform, the diff that finds them, point moves. Pure. |
| `public/together/room.js` | `RoomClient`: the connection, the protocol, the host and guest roles, per-person Undo. |
| `public/together/carets.js` + `carets.css` | Other people's carets and selections, drawn in a layer over any `contenteditable`. |
| `public/together/share-button.js` | Share to edit → Link copied ✓ (2.4 s) → Copy edit link, with × Stop sharing. |
| `public/together-adapter.js` | The script editor's adapter and UI wiring (the only file that knows about scripts). |
| `worker/room.js` | The `Room` Durable Object (hibernation API, migration `v2`). |

Nothing in `public/together/` or `worker/room.js` knows about scripts.

## Link and keys

`https://script.techies.tools/#room=<22 chars>&k=<43 chars>`. Everything after `#` stays in the browser. The socket opens `/api/room` with the subprotocols `["script-editor-room", "r.<room>", "k.<key>"]`, plus `"h.<host key>"` for the host (the host key never leaves the host's tab). The Worker checks their form and passes only SHA-256 hashes to the room, which stores `{ keyHash, hostHash, createdAt, ended }` (once ended `{ createdAt, ended, endedAt }`) and nothing else. Close codes: `4003` wrong key, `4004` ended (or no such room), `4005` full (20 guests), `4001` another host tab took over. The first three are final: the client stops and does not reconnect.

The room keeps one alarm, and the note says what it means. While the host is in, it is a daily check, so a room whose host left without a close event (a restart, say) still ends. When the host's tab closes, it is the 30-second grace. When the room ends, the note becomes `{ createdAt, ended: true, endedAt }` and the alarm erases it 7 days later; an ended note from before `endedAt` gets that alarm when someone knocks. After the erase, a guest with the old link still hears `4004`. The host's own tab, if it is still open, would make the room anew with the same keys; that is allowed, because only that tab holds the host key (in memory, never saved). But a host tab that has heard nothing from its room for 7 days stops with `ended` instead of reconnecting.

## Document model

A document is a list of blocks `{ id, text, attrs }`. `text` is what people edit (`\n` line breaks); `attrs` is opaque to the room. The script editor uses `text = contentOf(block)` and `attrs = { type, sep, prefix }` (`prefix` is the `# ` / `## ` marker), so carets and asks share content offsets and a para that becomes a heading is an attrs change plus a text change.

Operations (`ops.js`):

```js
{ type: "text",   blockId, at, del, ins }              // the spec's { blockId, at, del, ins }
{ type: "split",  blockId, at, newId, attrs }          // Enter
{ type: "merge",  blockId, into, at }                  // Backspace at the start (`at` = length of `into`)
{ type: "insert", after, block: { id, text, attrs } }  // new block, e.g. a "/" part
{ type: "remove", blockId }
{ type: "attrs",  blockId, attrs }                     // type and heading changes
```

Text is transformed against everything (insert/insert ties go to the change the host ordered first; text typed inside a deleted part is kept; typing in a block that is split follows its words). Two structure operations on the same block are a `Conflict`: the host then sends that guest a fresh snapshot instead of guessing.

## Protocol

The room stamps `from` on everything a guest sends and lets guests send only `hello`, `op`, `ask`, `resync` (to the host) and `caret` (to everyone else).

| From → to | Message |
| --- | --- |
| room → anyone | `{ type: "welcome", role, pid, peers? / host? }` |
| guest → host | `{ type: "hello", name, client, v }` → host gets `{ type: "join", from, name, client, v }`; `{ type: "leave", from }` when it closes |
| host → guest | `{ type: "catchup", v, entries, seen, people, carets }` when the guest's `v` is still in the log, else `{ type: "snapshot", v, doc: { blocks, meta }, people, carets, seen, refused? }` (sent with `{ type: "to", to: pid, msg }`) |
| guest → host | `{ type: "op", base, seq, ops }` (at most one in flight; the frame must start exactly with `{"type":"op","base":<int>,"seq":<int>`, no spaces, so the room can refuse an oversized batch by its seq without parsing it) and `{ type: "resync" }` |
| host → all | `{ type: "op", v, ops, by, client?, seq? }` (sent with `{ type: "all", msg }`; the copy with the guest's own `client` and `seq` is its receipt) |
| room → guest | `{ type: "host", online }`, also in answer to a change sent while the host is away |
| room → guest | `{ type: "refused", seq }` when a batch is too large for the room |
| host → all | `{ type: "people", people: [{ pid, name, colour, kind }] }` |
| anyone → others | `{ type: "caret", c: { blockId, offset, selEnd? } }`, at most 15 a second |
| host → room | `{ type: "end" }`; the room also ends 30 s after the host's tab closed, or at the daily check without a host |
| guest → host | `{ type: "ask", ref, ask: { blockId, start, quote, action, instruction? } }` a new ask; `{ type: "ask", ref, id, act: "keep" \| "undo" \| "dismiss" }` on the guest's own ask |
| host → guest | `{ type: "ask-ack", ref }` taken (or already taken); `{ type: "ask-refused", ref, reason: "changed" \| "taken" }` the quote is not in the host's script, or someone else's open ask is on that text |
| host → guest | `{ type: "you", asker }` the opaque id that carries this tab's Keep/Undo rights; `{ type: "join-refused" }` another tab uses this tab's client id |
| host → all | `{ type: "asks", asks }` every open ask with its answer, when they change (and to a guest that joins) |
| host → all | `{ type: "broll", broll: { status, name, text, flags } }` the B-roll list, when it changes (also in the snapshot's `meta.broll`) |

The host transforms a guest's batch against every version after its `base`, applies it, gives it the next version and sends it to everyone. A `base` older than the host's log (500 versions) gets a snapshot. A guest transforms what arrives against its batch in flight and its unsent changes. Carets follow every operation; the author's caret goes to the end of their change.

**Nothing a guest types is lost.** A guest sends only while the room is live; otherwise its changes stay unsent. `client` (random, kept across reconnects) and `seq` let the host skip a batch it already has and tell the guest, as `seen`, the last one it applied. After a lost connection, or when the host is back, the guest says hello with its last confirmed `v`: it gets the versions it missed, then sends its batch in flight again (unless `seen` covers it) and then the rest. A snapshot (old base or a clash) rebases the guest's unsent changes onto it; only changes that clash with the host's on the same block give way. While a resync is open the guest's hello asks for a snapshot. A batch the host will not take (not valid for the document) comes back as a snapshot with `refused: seq`, and one too large for the room as `{ type: "refused", seq }` (an oversized frame that doesn't start as above is dropped with no reply): the guest drops that batch, keeps what it typed after it, and never sends it again.

**Undo.** Each tab tracks everyone's last text change (typing with pauses under 1.5 s is one change). While it is untouched, that person's name tag shows Undo, which undoes only that change. Ctrl/Cmd+Z in a room undoes only your own text, Enter and Backspace joins; the whole-document undo stack is cleared when sharing starts and ends.

## The adapter API

```js
new RoomClient({ role, room, key, hostKey?, url, name, adapter, on }).start()
adapter = {
  read(),                // → blocks for the current document
  apply(ops, { by }),    // apply someone else's operations (or an Undo) to your document and redraw
  meta(),                // host: what guests need besides blocks (file name, line endings…)
  load({ blocks, meta }),// guest: show this document
  caret?(),              // { blockId, offset } of your caret (picks the place of an ambiguous edit)
  held?(),               // true while local changes must not be sent yet (the "/" command)
  busy?(),               // true while an input method composes; call room.resume() after
  validAttrs?(attrs, partial), // check attrs from guests
  validBlocks?(blocks, before), // check the document after a guest's batch (changed blocks only)
}
on = { status(s), people(list), carets(), message(msg), changed(), joined(pid) }
status: connecting | live | away | ended | refused | full
room.local()  room.caret(c)  room.undoMine()  room.undoFor(pid)  room.canUndo(pid)  room.stop()
room.peopleList()  room.caretList()  room.send(msg)  room.sendAll(msg)  room.sendTo(pid, msg)   // the last two: host
```

`createCarets({ container, element: (blockId) => el, onUndo, icon })` draws `caretList()` with `set(list)`; call `draw()` after your editor re-renders.

## The script editor's rules

- Text edits still go through `doc.js`: `changed()` calls `room.local()`, which diffs the document; remote operations are applied to `state.doc` with `applyToDoc` and the app redraws, re-anchors asks and auto-saves as before.
- Guests can't save, export, link, add, change or remove B-roll, Keep/Undo B-roll suggestions or sketches, run the "Sounds like me" check, use an agent of their own, or share. A guest's tab never connects its own agent. Opening another script stops sharing; reading the same file again from disk does not.
- **Asks (D2).** A guest's ask (the edit bar, "Suggest B-roll" included) goes to the host, which finds its quote again, adds it with `by: { id: <asker>, name }`, hands it to its agent and shares every open ask with everyone. A guest's ask closes only that guest's own overlapping asks; over someone else's open ask or answer it is refused, so every ask stays visible. Answers show for everyone; Keep, Undo and ✕ show only for the person who asked and the host, and a guest's press is done by the host after `guestMayAct`.
- **Who asked.** Each guest tab sends a private secret with hello; the host keeps only its SHA-256 and gives the tab an opaque `asker` id (`you`), which `by.id` carries. Each client id is tied for the whole session to the first secret it came with: a later join with that id and another secret is refused, whether or not the first tab is still here; the same tab back (same secret) keeps its asker id. A join without a secret ties the client id to no secret: it is refused while another tab with that id is here, and a later tab with a secret and that id is refused too.
- **The outbox.** A guest's asks and presses stay in an outbox until the host answers `ask-ack` or `ask-refused` (by `ref`); after the room was away they are sent again, and the host answers a repeat without doing it twice. A new ask waits until the host has all of the guest's text (`room.settled()`, signalled by `on.settled`); a refused one shows a quiet line under its line: "Couldn't ask: this text changed", or "Couldn't ask: someone else's ask is on this text". The host keeps its answer per `ref` (`createAskDesk`), so a repeat gets the same answer; a tab without a secret gets `ask-refused`.
- **The agent's caret (D2)** is worked out from the shared asks in every tab: named as its model ("Claude", "Codex", "ChatGPT"…, no "(agent)") with the model's own logo, or its own name with a sparkle when the model is unknown (Lex, 2026-10-28; `public/agent-brand.js`), at the end of the asked text while the ask is taken, at the change while its answer shows, gone after Keep or Undo. The host sees it also when not sharing. It joins the avatars while sharing.
- **B-roll (D2).** Guests get the list text and the Check flags and show tags, frames, the Storyboard and suggestions as the host does; a click on a frame only lights it. Each person picks their own Script/Storyboard view.
- **`/` parts (D2)** work for guests: the part and the renumbering reach the host as block operations, and the command text is held back (`slashHold`) until a part is picked, as for the host.
- Guests see the host's name ("Host" until the host has joined a room with a name).

## How the Native Site Editor would plug in

Copy `public/together/` and `worker/room.js`. Write an adapter whose blocks are its editable regions (`text` = their plain text, `attrs` = whatever it needs to rebuild them), call `room.local()` after each edit, and give `createCarets` a container and an `element(blockId)` lookup. Asks and other shared state ride on app messages (`sendAll`, `sendTo`, `on.message`, `on.joined`); an agent's caret can be worked out from them, as here, and drawn as a caret with `kind: "agent"`.
