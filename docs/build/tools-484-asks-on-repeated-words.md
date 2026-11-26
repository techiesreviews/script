# TOOLS-484: asks on a repeated word stay on their own copy after a change across paragraphs

Card TOOLS-484 (parent TOOLS-470). The fourth release try of select across paragraphs stopped on one finding from its second look (release head 42c069c): P1 `public/app.js:1517`. With `**go go go live**` and `Other paragraph.`, an ask on the first "go", and the selection from "live" through "Other " deleted, the ask moved to the second "go".

## What changed

- The cause: once the two ends were joined, `applySpan` looked for the asks of the first paragraph again by their words (`reanchorBlock`, which takes the nearest copy). The delete had taken the `**` in front of the ask, so every copy sat two characters further left, and the nearest copy to the old place was the next one. The asks after the selection had the same fault from the other side: they were shifted by one fixed amount, which is wrong as soon as the settling takes or adds marks in front of them (`Intro words` + `**live go** go go end`, an ask on the second "go", delete from "words" through "**live ": the ask landed on the third "go").
- `Span.replaceSpan` now also returns `follow(side, start, end)`: where a range of the first paragraph (before the selection) or of the last one (after it) is in the new document, with the words that read there. It goes through every step of the edit by offsets: the deletion with its settled bold and links, what is typed or pasted in, a section title's fold to one line, Enter's settling, the split into paragraphs that pasted blank lines make, and Enter's new paragraph. No step looks for the words. A range the edit took or cut, or one that ends up across two paragraphs, has no place (`null`).
- `Doc.placeAsks(asks, at)` moves every open ask and "Sounds like me" mark to the place `at` gives, returns the moves (old and new place, each with its quote) and lists the ones whose words are gone. `applySpan` uses it for both paragraphs, closes the ones without a place (an ask is cancelled, a mark is marked gone, as before) and keeps the moves on the Undo step, where TOOLS-483's `askMoves` already were. `Doc.unmoveAsks` puts the quote back too when a move carries one, and leaves it on the moves for the Redo. Asks in the paragraphs between still close through `reanchorBlock`.
- A "Suggest B-roll" answer is never closed by an edit. When `follow` has a place for it, it goes there; when not, it does what it did before (after the selection: shifted to the joined paragraph; before it: left alone).
- `restore` (Undo and Redo) is unchanged: the moves a step carries are taken back by offset before asks are looked for again, so the search finds each one at its own place.
- The test hook `window.__scriptEditor.ask` now gives the edit bar's `plainAt` with the range, as a real selection does. Without it a test ask on a word inside bold was made on the first copy the search found, not on the one asked for.

## Checks

- `tests/span.test.mjs`, eight `follow:` tests, written before the code and failing first (`follow` did not exist): the repeated word before the selection and after it, typed text between the two sides, Enter, a paste with a blank line, a section title, a link cut by the selection, and one sweep: four first paragraphs times five last ones, every selection start and end, five edits (delete, a typed letter, a typed space, Enter, a paste with a blank line), every word outside the selection. For each it checks that the place given reads that word, and that it is the same copy: the words in front of it in the first paragraph, or behind it in the last, are the ones that were there before. 117425 words were placed and none was lost.
- `tests/doc.test.mjs` "placeAsks puts open anchors where their words went, with their quote; unmoveAsks takes them back, quote too": failed first (`placeAsks` did not exist), then passed.
- `scripts/smoke-select-across.mjs` step 16h (the card's example): an ask and a "Sounds like me" mark on the first "go", an ask on "paragraph"; Delete, Undo, Redo, Undo. It failed first on the code from 1d5b2e0 (`after Delete the ask and the mark are on the first "go" (0–2), not the second (3–5): …"at":[3,5]`), then passed.
- Step 16i (the card's second point): the same delete, then "Now " typed at the join, then Undo twice. The first Undo takes the typed text, the second the delete: the text and all three asks are as before the delete. It passed on its first run with the fix in place.
- Step 16j: the same from the other side (`Intro words` + `**live go** go go end`, an ask on the second "go"). It failed first on the code from 1d5b2e0 (`after Delete the ask is on the second "go" (9–11), not the third (12–14): …"at":[12,14]`), then passed.
- The browser run is 64/64 at 1280 and 390 px: `docs/agents/evidence/tools-484-browser.txt`. Two of the first six runs failed in 16h because the drag started two letters early: the asks' chips are drawn a moment after the ask is made and move the words after them. The drag of 16h–16j now waits until its two points stay where they are; nine runs in a row passed after that.
- Not changed, older than select across and outside this card:
  - Enter, a join and a paste inside one paragraph move asks to another paragraph without a record for Undo.
  - Ordinary typing, and Undo or Redo of a step that carries no moves, still look for asks by their words (`reanchorBlock`, `reanchorAll`): an ask on a repeated word can move to another copy when text is typed in front of it. That is why `restore` got no follow-by-offset of its own here: it would not make "delete, type, Undo" right while typing itself searches.
  - An ask whose words held a `**` that settling takes keeps the words as they read now, which can leave a lone `**` in its quote, as on the typing path.

## Done

Done when 1: met — browser step 16h with the card's example (`**go go go live**` + `Other paragraph.`, an ask and a "Sounds like me" mark on the first "go", "live" through "Other " deleted): it failed first on 1d5b2e0 (both on the second "go", `"at":[3,5]`) and passes now, with both on the first "go" after Delete (0–2), Undo (2–4), Redo and Undo again, at 1280 and 390 px. Step 16j shows the same for an ask after the selection.

Done when 2: met — browser step 16i: after the delete "Now " was typed at the join; the first Undo took the typed text, the second put `**go go go live**` and `Other paragraph.` back with the ask and the mark on the first "go" and the ask on "paragraph", all open (1280 and 390 px).

Done when 3: not met yet — this change lands in dev first; the release to main and the deploy follow in the same job.

Feature list: updated (`docs/features.md`, select across paragraphs).
