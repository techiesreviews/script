# Step D: working together (carets, Share to edit, the agent's caret)

Goal: Lex shares a script with a link, and other people edit it with him live, each with their own caret. His agent shows a caret where it is working. Built here first; the Native Site Editor will take it over later. So the sharing part is its own module with a small, documented API, and nothing in it is tied to scripts.

Approved look and behaviour come from the chat workspace's `sites/script-editor-mockup/index.html` (read only; its `.rc*` caret CSS is the approved caret from the Native Site Editor prototypes 13 and 14):

- **Caret:** a thin coloured line with a first-letter circle. On hover or focus the circle widens, and the rest of the name slides out behind the first letter (blur, slide, fade).
- **Typing** shows only the caret, with no outlines. A selection is shown as a tint in that person's colour.
- **Undo on the name tag:** while a person's last text change can be undone, their name tag ends with an undo button that undoes only that change.
- **"Share to edit"** (top bar) shares and copies the link. After that the button reads "Copy edit link" and changes to "Link copied" with a check for about 2.4 s, next to a small × "Stop sharing". There is no Live badge and no toast.
- **Presence:** small avatars in the top bar (you, then the others). Clicking one scrolls to that person's caret. The section list shows coloured dots where people are.

## How it works (cheap, free plan, nothing stored)

- **Room:** a new Durable Object class `Room` (migration v2, `new_sqlite_classes: ["Room"]`).
  - Use the hibernation API, and keep per-socket data with `serializeAttachment`.
  - The room relays messages between the host tab and guests. It may hold the last snapshot in memory for joining guests, but never writes script text to storage.
  - The room ends when the host stops sharing or closes the tab (after 30 s with no host).
- **Link:** `https://script.techies.tools/#room=<id>&k=<key>`. The key stays in the fragment, so it is never sent in a URL. The socket proves it holds the key with a subprotocol, as the agent relay does.
- **Guests** type only a name (remembered in localStorage), then join. They:
  - get the script and edit text;
  - can't save the file, link B-roll, use the agent, export or share;
  - can still make asks, which go to the host and the host's agent and show for everyone. Answers show for everyone, and only the person who asked (or the host) picks Keep or Undo.
- **The host is the source of truth.**
  - Edits are block-level operations: `{ blockId, at, del, ins, base }`, plus structure operations for split, merge and new block, and for type and heading changes.
  - The host orders the operations, shifts the offsets of concurrent operations in the same block (simple operational transform on one string), applies them, and sends them out with a version number.
  - A guest whose `base` is too old gets a fresh snapshot.
  - The host's file auto-save keeps working as before.
- **Carets** send `{ personId, blockId, offset, selEnd? }` at most 15 times a second and are drawn with the `.rc` caret. The person's colour comes from a fixed palette with low chroma (orange stays reserved for the accent).
- **The agent's caret:** while the agent works on an ask, an agent caret ("Claude (agent)", with the model icon in the circle) sits at the end of the asked text. While the answer is shown it stays at the change, and it leaves after Keep or Undo. Guests see it too.

## Module boundary (for the Native Site Editor)

- Put everything in `public/together/`:
  - `room.js`: the connection, the protocol and the host/guest roles.
  - `carets.js` + `carets.css`: drawing carets inside any `contenteditable` element, given an element and an offset.
  - `share-button.js`: the button states.
  - The worker side goes in `worker/room.js`.
- The script editor plugs in through a small adapter (`public/together-adapter.js`): apply an operation, read a snapshot, find the element for a block id, report local changes.
- Document the protocol, the adapter API and how the Native Site Editor would plug in, in `docs/together.md` (at most 2 pages).

## Since this plan was written (steps C2–C5, all live)

The editor now also has:
- the Script/Storyboard switch;
- sketch frames beside the lines;
- "Add B-roll" and the shot card;
- agent B-roll suggestions (`answer_broll`, Keep/Undo);
- the `/` parts menu with renumbering.

For working together:

- **Guests and B-roll:** guests see the B-roll exactly as the host does: tags, frames, the Storyboard, and suggestions. The host sends the B-roll list text in the snapshot and again after each change. In this step guests can't add, change or remove shots, or Keep/Undo B-roll suggestions. They can use "Suggest B-roll", which is an ask like any other.
- **Guests and `/` parts:** guests can use the `/` menu. Inserting a part and renumbering go to the host as structure operations, the host applies them in order, and everyone ends on the same text. The command text is never sent before a part is picked.
- **Storyboard view:** each person picks their own view; it is not shared.

## Built in two parts

- **D1:** everything except the agent's caret and guests' asks:
  - the `Room` Durable Object and the protocol;
  - `public/together/` (room, carets, share button) and the adapter;
  - Share to edit, joining with a name, presence avatars;
  - live text editing with carets and selections, the undo button on the name tag;
  - the guest limits;
  - `docs/together.md`, `scripts/smoke-room.mjs` and the unit tests.
- **D2:**
  - guests' asks reaching the host and the agent, and answers showing for everyone (Keep/Undo only for the person who asked, or the host);
  - the agent's caret;
  - B-roll shown for guests, and the `/` parts for guests.

## Checks

- **Unit tests:** transforming concurrent operations in one block (insert/insert, insert/delete, delete/delete, split while typing), snapshot after an old base, the caret offset after a remote operation, and the room message rules with a fake socket.
- **Smoke test:** `scripts/smoke-room.mjs` (Node 24 WebSocket) with one host and two guests. It checks join, concurrent typing in the same paragraph, everyone ending on the same text, caret broadcast, a guest's ask reaching the host, stop sharing, and an ended room refusing new joins. It prints `RESULT: ok smoke-room`.
- **Browser check:** two tabs (host and guest) at desktop and phone width. Typing shows only the caret. Hovering a caret slides the name out. Share and Copy edit link work.
- Run `kit doctor` and `kit specs` (both `RESULT: ok`). Do not commit, push, deploy or stash. Report in at most 20 lines.
