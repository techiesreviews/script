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

After the review (round 1):

- A drag that slips into the gap just past its paragraph, before reaching any word of the next one, stays the browser's own selection in that paragraph (`spanFarEmpty`).
- A right-click on a block the span covers keeps it (the menu's Copy); any other right or middle press ends it. A spelling fix picked from the menu ends the span and fixes only its word. On Linux a middle click then pastes the browser's own selection where it was pressed, as it does anywhere.
- The composed text's grouping ends when the composition ends or a plain key comes, so later typing is its own Undo step.
- With Ctrl or Cmd held, only bold, italic, underline and link keys are held back over a span; Ctrl/Cmd+Backspace and Delete delete it; copy, cut, paste, save and the browser's own keys go on.
- Bold and links are settled only when the joined block is a paragraph, as one-block edits do; in a list, code or a reminder the marks are plain text.
- Enter (or a paste with blank lines) over a span: shots on the last block go with its words to the new block, and stay at the join when none of its words are left.

After the review (round 2):

- A shot a span edit, its Undo or its Redo placed stays where that step put it until the step's save has landed (`broll.placing`): an earlier save landing first leaves it as it shows, and its own save keeps its paragraph even if the words changed meanwhile (with "Check") or an earlier paragraph says the same.

After the review (round 3):

- Undo or Redo of a span edit leaves alone a shot that was changed since (moved on its own, or by the agent): it stays where that newer change put it, on screen and in the list. A save that finds the list holding another Over for the shot shows the shot where the list puts it.
- A paragraph selected from its very start into a section title becomes that title; its own shots go to the next spoken paragraph, as the shots of the removed blocks do, and Undo puts them back.

After the review (round 4):

- A change the span did not make (the agent's answer, an edit from another tab) to a block it covers ends the span before any key, copy, cut or paste acts on it, so its offsets never point at other words.
- After a shot's save failed, the shot stays where it shows while the list still holds its Over from before (`broll.unsaved`), and the next span edit's save replaces that Over; another Over in the list (saved, or changed by the agent) wins.
- A Redo that takes out again the paragraph a shot was moved onto since puts the shot at the join with "Moved here" instead of leaving it on no paragraph. A shot that Undo or Redo leaves where a newer change put it shows no "Moved here".
- A last paragraph selected up to its closing bold marks has no words left, so its shots stay at the join.

## Limits

- In a shared script Undo is each person's own (the room's), so the span step there has no shots or span to put back; a guest's span edit moves no shots (the host's list is the host's).
- Touch screens and browsers without the Highlight API keep the old one-paragraph selection.

## Tests first

- `tests/span.test.mjs` (11 tests at first) failed first with the module missing, then passed.
- `scripts/smoke-select-across.mjs` failed first on 629da92 (`a span over three paragraphs is drawn: {"on":false,...}`), then passed 12/12 at 1280 and 390 px: `docs/agents/evidence/tools-470-browser.txt`. One check in it pointed at the wrong element (a shot frame sits beside its block, in the line, not inside it) and was corrected before the green run.
- Round 1: two `span.test.mjs` tests (folded notes, shared edits) and two `broll-move.test.mjs` tests (Undo and Redo while saves wait; Undo after another list was opened) failed first, then passed. Three browser checks (from the title, a picture paste, composed text) failed on the code before the fixes, then all passed 18/18 at 1280 and 390 px.
- Review round 1: three `span.test.mjs` tests (the gap past a paragraph, marks only in a paragraph, shots after Enter) and four browser checks (the gap below, a spelling fix, a cancelled composition, Ctrl keys) failed first, then passed; the browser run is 28/28 at 1280 and 390 px.
- Review round 2: two `broll-move.test.mjs` tests (a moved shot's paragraph changed while its save waits; Undo and Redo with a repeated paragraph) and one `span.test.mjs` case (Enter or a paste over a span to the very end) failed first, then passed. A browser check for text after a finished composition failed with that line turned off, then passed; a check that a drag held near the window's end scrolls on and stops on release guards what already worked. The browser run is 30/30 at 1280 and 390 px.
- Review round 3: two `broll-move.test.mjs` tests (a shot moved on its own after a span edit, then the span edit undone; a shot changed by the agent while the span edit saves, then undone) and one `span.test.mjs` test (a paragraph selected from its start into a section title) failed first, then passed. The first version of the `span.test.mjs` test cut the number off the next section title, which makes that part unspoken; it was corrected to a title that keeps its number. The browser run is still 30/30.
- Review round 4: three `broll-move.test.mjs` tests (the next span edit after a failed save; a Redo that takes out the paragraph a shot was changed onto; no "Moved here" on a shot Redo leaves alone) and one `span.test.mjs` case (a last paragraph ending in bold) failed first, then passed; a fourth `broll-move.test.mjs` test (the agent's move after a failed save still wins) guards what already worked. A browser check (the agent's answer to a block the span covers ends the span) failed first, then passed. The browser run is 32/32 at 1280 and 390 px.

## Done

Done when 1: met — a mouse drag from the first paragraph into the third draws one selection over three paragraphs (browser check, 1280 and 390 px); across a section title too; `spanOf` covers any two points in the script.

Done when 2: met — copy gives the words with blank lines between; Delete joins the ends and the shot on the removed paragraph moves to the joined one with "Moved here"; typing replaces the selection; one Undo restores words, shots and the selection.

Done when 3: for the lead — Lex tries it on a test link and says go.
