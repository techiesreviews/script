# TOOLS-482: the scrollbar finding from the release review

Card TOOLS-482 (parent TOOLS-470). The second release try of select across paragraphs stopped on one release-review finding (P2, `public/app.js:1441` on 31b2d3d). Two small P3s from the same review are folded in.

## What changed

- A press on the page's scrollbar (any button) keeps a selection across paragraphs: the capture `pointerdown` handler returns early when the press lands on `document.documentElement`, the same signal `scrollbarHeld` already uses. Before, a left or middle press there cleared the span, so dragging the scrollbar to check a long selection threw it away.
- A middle press in the text still ends the span, as TOOLS-470 decided: on Linux a middle press pastes the browser's own selection there, and with the span kept that paste would replace the selected words (browser check 11 guards this).
- "Moved here" ends when another B-roll list is linked or the list is unlinked (`broll.moved` was reset only when leaving the script, so the note could stick to a shot of the next list with the same id).
- Letting go of a drag no longer throws when the page has no selection range left (`collapseToStart()` is called only with a range).

## Checks

- `scripts/smoke-select-across.mjs` step 2b: after a span over three paragraphs, a left and a middle press at `innerWidth - 4` (on the scrollbar) keep it, dragging the scrollbar's thumb scrolls the page and keeps it, the words are unchanged, and Ctrl+C still copies it. It failed first with `public/app.js` from 3e56880 (`a left press on the scrollbar keeps the span: {"on":false,...}`), then passed.
- Step 18b (after the first review): a span delete moves B2 ("Moved here"), the demo's list is linked again through the file field, and Undo puts the words back: B2 shows on its paragraph with no "Moved here". It failed first with `public/broll-app.js` from 3e56880, then passed.
- The browser run is 44/44 at 1280 and 390 px: `docs/agents/evidence/tools-482-browser.txt`.
- Not covered by a browser step: unlinking the list (the same reset as linking), and a drag ending with no selection range (no real input leads there reliably).
