# Step C3: add B-roll to a piece of text, with a description

Lex (2026-10-28): "I also want to be able to add B-roll and define a description for a piece of text." Today shots only come from a linked B-roll file. Now he selects text in the script and adds a shot to it himself, and he can change or remove it later.

## Adding a shot

- The edit bar (shown for a selection) gets one more action, "Add B-roll" with the film icon, after the existing actions.
- It opens a small card at the selection, in the style of the voice card:
  - kind: B-roll · Motion plate · Screen recording (a three-option switch, B-roll by default);
  - "What to show" (the description): required, one line that can wrap, at most 200 characters, focused on open;
  - "How to make it": optional, at most 120 characters, hidden for Screen recording;
  - Add and Cancel. Enter adds, Escape cancels.
- The new shot:
  - id: the next free `B<n>` for B-roll and Motion plate, the next free `S<n>` for Screen recording;
  - Over: built from the selection so the existing matcher finds the same lines again. One block: the first words of the selection (about 8 words, ending in `…` when cut). Several blocks: a range, `"first words…" through "first words of the last block…"`. If the quote would match an earlier line first, use more words until it doesn't;
  - Motion plate: when "How" is empty, write "Motion plate", so it is detected as motion as before. In a table without a Kind column, a How that does not mention motion is written as "Motion plate: <how>"; a B-roll whose How mentions motion, or a motion plate in a table without a How column, gives that table a Kind column, filled in for every row, so every kind reads back the same (review fix, 2026-10-28).
  - A row always has its id: a table without an id column gets a standard table next to it.
- It shows at once: tag, rule and empty sketch frame beside the line, in the Storyboard and its filters, in `get_script`'s `broll` and in "Ask for sketches".

## Changing and removing a shot

- Clicking a shot's tag or frame lights it up as now and also opens the same card filled in: kind, What, How, plus "Remove shot". Save changes the row in place. After Cancel or Escape the shot stays lit, and one click opens its card again.
- Remove takes the row out, and its sketch too.
- To move a shot to other text, the person removes it and adds it again (no extra UI). Replaced by step L: Move in the card, or dragging the tag on a computer (`step-l-move-broll.md`).
- Changing the kind to or from Screen recording in a list without a Kind column moves the row between the two tables and keeps its id (a `B<n>` can then sit among the screen recordings). When the Screen recordings table has no How column (as in the demo and in a new list), a How is lost on that move.

## Where it is saved

- Pure functions in `broll.js` change the B-roll Markdown and keep everything else in the file exactly as it was: other rows, notes, headings and sketches.
  - `addShot(md, shot)`: adds the row to the main table, or to `## Screen recordings` (which it creates if missing).
  - `updateShot(md, id, fields)`.
  - `removeShot(md, id)`: removes the row and its sketch block.
  - Pipes in text are escaped.
- **A linked file:** write through the existing linked handle and the one-write-at-a-time queue, asking permission when needed, as the sketch Keep does.
- **No list linked yet:** the first Add makes a new list. Where the File System Access API exists, a save picker suggests `<script name>-broll.md` next to the script; the new file starts with `# <script title> · B-roll list`, the main table and the Screen recordings table, and becomes the linked list. If the picker is cancelled, or the API is missing, the list is kept in the browser (below); any other problem shows "Not saved" in the card.
- **The demo list and lists kept in the browser:** changes stay in local storage under their own key, `script-editor:brollList:<script name>`, apart from the script's draft (so "Discard" on unsaved script changes keeps the list), and survive a reload. The Storyboard header shows a quiet "Not saved to a file · Save as…", which saves the list as a file and links it. Export → B-roll list also still works.

## Checks

- Unit tests: `addShot`, `updateShot`, `removeShot` (the rest of the file is unchanged byte for byte; pipes; the Screen recordings table is created when missing; the sketch is removed with the row), the next free id, and Over built from a selection matching back to the same blocks (one block, several blocks, a quote that would first match an earlier line).
- Browser check with the demo at desktop and phone width: select text → Add B-roll → the shot appears beside the line and in the Storyboard; edit its description; remove it; reload and the change is still there. Start `npx wrangler@4 dev` yourself and stop it afterwards.
- Run `kit doctor` and `kit specs` (both `RESULT: ok`). Do not commit, push, deploy or stash. Report in at most 15 lines, including the RESULT lines.
