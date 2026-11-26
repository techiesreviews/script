# TOOLS-470: select all the text on the page, not just one paragraph

Lex approved the sketch on 2026-11-26 (`/home/ubulex/Projects/fleet/inbox/script-editor-TOOLS-470-prototype-2026-11-26/`). Land on dev only.

## Why the browser could not do it

Each block of the script is its own editing area (`contenteditable="plaintext-only"`), so the browser's selection stops at the block's edge. Turning the whole script into one editing area would touch every part of the editor (asks, bold words, links, shots, the shared rooms), so the editor keeps a selection of its own instead.

## Change

- `public/span.js` (pure, no DOM): a span is `{ from: { id, offset }, to: { id, offset } }` in reading order, in content offsets. `spanOf` makes one from two points (null inside one block, which stays the browser's); `spanParts` lists the blocks it touches; `spanCopy` gives the words only (bold marks and link addresses dropped, as the spoken view reads them) with a blank line between blocks; `replaceSpan` joins the ends with what was typed, settles bold marks and links as a one-block deletion would, keeps a heading on one line, and refuses (returns null) an edit whose settled marks would turn the line into another kind of block, as one-block edits are refused; `followShots` says where shots on removed blocks go (the joined block, or the next spoken paragraph when the join is not spoken).
- `public/app.js`: a mouse press in a block starts a drag; once the pointer reaches another block the span is drawn with the CSS Custom Highlight API (`::highlight(span-selection)`), and the browser's own selection inside the first block is hidden. The page scrolls near the top bar and the window's end while the button is held. Keys, `beforeinput`, copy, cut and paste are caught while a span is drawn: delete, cut, typing, Enter, paste and composed text replace it in one Undo step (`checkpoint("span")`), which also carries the span (`span`/`otherSpan`) and the shots' places (`shots`) so Undo puts the span back and the shots where they were. Arrows, a click or Escape end it. Asks covered by the span close; asks after it in its last block follow their words.
- `public/broll-app.js` (seam 5): `followSpan` and `placeShots` move shots and write their new Over to the list in one queued change (failures open the shot's card with "Not saved", as other list writes do); a moved shot shows "Moved here" and the orange frame until the next change that moves shots (a drag, or another span edit). Undo and Redo call `placeShots` with the other side.
- `public/app.css`: the highlight colour (the accent at 28%), no native selection or caret while a span shows, the "Moved here" note.

The sketch's bottom status line is not built: the project has no explainer text or toasts.

After the second look (round 1):

- The notes folded away at the top are never part of a span, even from a drag that starts on the title (`spanOf(..., { hidden })`).
- A paste with no text (only a picture) leaves the span and the words as they were.
- Each shot write checks, in its turn in the list's queue, that the list still holds the Over its step started from (`expect`), so Undo and Redo pressed while earlier saves wait end with the last step's Over. Each step records the list it belongs to (`token`); after another list is opened, Undo leaves that list's shots alone.
- An edit from another tab that reaches a block of the span, or adds or joins blocks, ends the span (`spanTouched`), so its offsets never point at other words.
- Composed text (an accent or an input method) joins the span's Undo step: one Undo takes back both.

## Limits

- In a shared script Undo is each person's own (the room's), so the span step there has no shots or span to put back; a guest's span edit moves no shots (the host's list is the host's).
- Touch screens and browsers without the Highlight API keep the old one-paragraph selection.

## Tests first

- `tests/span.test.mjs` (11 tests at first) failed first with the module missing, then passed.
- `scripts/smoke-select-across.mjs` failed first on 629da92 (`a span over three paragraphs is drawn: {"on":false,...}`), then passed 12/12 at 1280 and 390 px: `docs/agents/evidence/tools-470-browser.txt`. One check in it pointed at the wrong element (a shot frame sits beside its block, in the line, not inside it) and was corrected before the green run.
- Round 1: two `span.test.mjs` tests (folded notes, shared edits) and two `broll-move.test.mjs` tests (Undo and Redo while saves wait; Undo after another list was opened) failed first, then passed. Three browser checks (from the title, a picture paste, composed text) failed on the code before the fixes, then all passed 18/18 at 1280 and 390 px.

## Done

Done when 1: met — a mouse drag from the first paragraph into the third draws one selection over three paragraphs (browser check, 1280 and 390 px); across a section title too; `spanOf` covers any two points in the script.

Done when 2: met — copy gives the words with blank lines between; Delete joins the ends and the shot on the removed paragraph moves to the joined one with "Moved here"; typing replaces the selection; one Undo restores words, shots and the selection.

Done when 3: for the lead — Lex tries it on a test link and says go.
