# Step L2: drag a shot straight away; it snaps to the paragraph

Lex (2026-10-30), after trying step L: "I now need to press the move icon to move it, just like me drag the image or tag right away, without pressing that button. remove the move button. And while dragging. It should be able to snap to the paragraph, also where the b roll is shown, so that the dragging is always in the right place."

## What changes

- **No Move button.** The shot card loses Move (`#scMove`) and the wait to place a shot (step L's click / select / Escape flow) goes. The card keeps kind, What, How, Save, Cancel and "Remove shot".
- **Drag the shot itself, right away.** The whole shot in the margin, its picture or line drawing and its tag (`.shot-frame__jump`), can be grabbed and dragged at once; nothing to press first.
  - Mouse and pen: the drag starts after the pointer moves a few pixels; a plain click still lights the shot and opens its card. The browser's own image drag never takes over (pictures are `draggable="false"`, `dragstart` stopped).
  - Touch (phones and tablets): press and hold the shot about 0.4 s, then drag; a quick swipe on it still scrolls the page and a tap still opens the card. While a touch drag is on, the page does not scroll by the finger (only by the edge scroll below).
  - Make sure it really works in a real Chrome page with the demo (pictures and line drawings), not only in synthetic events: Lex could not drag before.
- **It snaps.** While dragging, the shot's frame does not float under the pointer: it jumps to the margin beside the spoken paragraph under the pointer (or the nearest spoken paragraph above or below it when the pointer is over a heading, a gap or a note), exactly where it will sit after the drop, and the accent rule shows the paragraphs it will cover (as many as before, fewer at the end of the script). The rest of the margin does not shift around while dragging. Phones (tags above the line): the same, the frame shows above the paragraph it would land on.
  - Over the title, the front matter or outside the script there is no snap: the frame shows back in its own place, faded, and a drop there leaves the shot where it was.
  - With motion allowed (`prefers-reduced-motion: no-preference`) the frame glides to each new place quickly (about 120 ms); otherwise it just jumps.
- **Edge scroll.** Dragging near the top or bottom of the visible script scrolls the page, faster nearer the edge, so a paragraph off screen can be reached with the drag alone.
- **Drop:** the shot is written there as in step L (only its Over, through `updateShot`, check flag cleared). Escape during a drag puts it back. Suggested frames and shots with a change waiting for Keep or Undo still cannot be dragged.
- Not for guests (as before). No explainer text.

## Clean up from step L

Remove the code, CSS and markup for the Move button and the wait (`startMove`, `endMove`, `placeMove`, `moveSelection`, the document `pointerdown`/`pointerup`/`selectionchange` handlers for the wait, `scriptEl.dataset.moving`, `#scMove`), keep `moveShot`, `targetFor`, `paraAt`, `showTarget` and the pure helpers in `broll.js` (`moveTo`, `wholeParas`, `moveOver`) and their tests. Update `docs/build/step-l-move-broll.md` (a line at the top: the Move button and the wait were replaced by step L2), `docs/data-shape.md` (the moving line) and the AGENTS.md sentence about moving.

## Checks

`kit doctor`, `kit specs` (`RESULT: ok`). Pure helpers for the snap (which spoken paragraph a pointer position snaps to, given the paragraphs' boxes; the edge-scroll speed for a pointer position) go in `broll.js` or a small module with unit tests. Browser check in real headless Chrome with the local Worker, using real input events (`Input.dispatchMouseEvent` and `Input.dispatchTouchEvent`, not synthetic DOM events), desktop 1280 px and 390 px, light and dark: drag a shot by its picture and by its tag to another paragraph (it snaps there while dragging and lands there); over a heading it snaps to the nearest paragraph; dragging near the bottom edge scrolls and reaches a paragraph off screen; Escape and a drop outside leave it; a click still opens the card; on touch a hold then drag moves it, a quick swipe on it scrolls and a tap opens the card; the card has no Move button; reload keeps the new place; only the Over cell changed in the list. Take screenshots mid-drag at both widths and look at them. The run goes in `docs/agents/evidence/step-l2-browser.txt`.
