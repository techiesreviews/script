# Step L: move a B-roll shot to another paragraph

**Replaced in part by step L2** (`step-l2-drag-shots.md`, Lex 2026-10-30): the Move button and the wait to place a shot are gone; a shot is dragged straight away (also on touch, after a hold) and snaps to the paragraph while dragging. What a move writes is unchanged.

Lex (2026-10-30): "I would like to be able to change the b roll position to another paragraph." Asked how, he chose **both**: drag the tag on a computer, and a Move button for phones. Until now a shot was moved by removing it and adding it again (step C3).

## Moving with the Move button (every screen)

- The shot card (opened from a shot's tag, its frame, or a shot in the left column or the Storyboard, also one under "Not found in the script") gets **Move** beside "Remove shot". Not for guests, like the rest of the card.
- Move closes the card and the shot waits to be placed: it stays lit, and the script shows that a paragraph can be picked (the spoken paragraph under the pointer gets the light covered-line rule in the accent while hovered; on touch nothing until tapped). No explainer text.
  - **Click or tap a spoken paragraph:** the shot goes there and covers as many spoken paragraphs as before, starting at that one (fewer at the end of the script).
  - **Select text** (one or several spoken paragraphs) and let go: the shot covers exactly those paragraphs, as "Add B-roll" would.
  - A click on a heading, the title, or outside the script, or Escape, ends the wait and leaves the shot where it was. Typing ends it too. A press there counts only when it is let go as a click: on touch, a swipe that starts there scrolls and the shot keeps waiting. A click outside the script ends the wait even while text is still selected in it.
- The text is never changed by a move; the caret and selection behave as usual afterwards.

## Dragging the tag (fine pointer only)

- On `(hover: hover) and (pointer: fine)` (a mouse or a pen) a shot's tag in the margin (`.shot-frame` / `.broll-tag`) can be dragged. While dragging, the spoken paragraph under the pointer shows where it will land (the same accent rule over the paragraphs it would cover); the shot's own lines stay as they are until it is dropped.
- Dropping on a spoken paragraph moves the shot there, keeping its number of paragraphs (as a click above). Dropping anywhere else, or Escape while dragging, leaves it where it was.
- A plain click on the tag still lights the shot and opens its card, as now. The drag starts only after the pointer has moved a few pixels.
- Suggested frames (the agent's B-roll waiting for Keep) and shots with a change waiting for Keep or Undo are not draggable.

## What a move writes

- The shot's **Over** is written again with `B.overFor(doc, selection)` for the new paragraphs (one paragraph: its first words; several: a "… through …" range), through `updateShot(md, id, { over })`, in `changeList` and the one-write-at-a-time queue, like any change of the card. Everything else in the list stays byte for byte (its id, kind, What, How, sketch and the other rows).
- Moving onto the paragraphs it already covers writes nothing.
- The shot's check flag clears (moving it is checking it). It shows at once in its new place, in the Storyboard (script order) and in `get_script`'s `broll`.
- A list kept in the browser and a linked file are written the same way as other card changes; "Not saved" shows in the card's place as now if the write fails (the shot then stays where it was).

## Checks

`tests/broll.test.mjs`: the Over for a move (one paragraph, keeping a range's length, shortened at the end of the script, a selection of several paragraphs) matches back to exactly the new paragraphs, also when the same first words come earlier; `updateShot` with only `over` changes only that cell. Pure helpers for "which paragraphs a move covers" go in `broll.js` with tests. Browser check (headless Chrome, local Worker) at desktop and 390 px, light and dark: Move then click, Move then select two paragraphs, Move then Escape, a drag on desktop to another paragraph, a drag dropped outside, a shot from "Not found in the script" moved into the script; the file or browser list holds the new Over and the rest is unchanged; reload keeps it. The run goes in `docs/agents/evidence/step-l-browser.txt`.
