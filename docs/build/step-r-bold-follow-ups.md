# Step R: bold marking follow-ups

Lex (2026-11-06): fix the follow-ups listed in fleet issues #29, #30 and #31, one small PR each on `dev`. Bold marking stays experimental and off by default; his earlier choices stand (stored `**words**`, the B button, Bold style colours).

## PR A: bold off never refuses an edit (#30, #31 item 1)

- `public/app.js` `syncFromDom`, `pasteText`, `mergeInto`: an edit that would make the line read as another kind of block ("**Note** - more" losing "Note", or a paste over `**Note`) is refused only while Bold marking is on. With it off, nothing is refused, as before bold existed.
- `public/app.js` `splitAt`: Enter and Shift+Enter just before the space in a bold line like `**1. x y**` or `**## Plan**` are now refused too (the parts joined without their marks would read as a list or a heading, so `1.` or `Pl` and `an` left the spoken text); the check runs only while Bold marking is on.
- Checked in a real browser: `scripts/smoke-keep-all.mjs` (`runBoldOffEdits`, and the "just before the space" cases in `runBoldKinds`; `SMOKE_ONLY=refusals` runs these two functions). Evidence: `docs/agents/evidence/step-r-browser.txt`.

## PR B: menu height, B-roll quotes across a bold edge, a refused write (#31 items 2-4)

- `public/app.css`: `.menu--scripts` gets `max-block-size: calc(100dvh - 4.5rem)` and `overflow-y: auto`, so the Bold settings never fall off the bottom of the file name's menu.
- `public/broll.js` `quoteSelection`: when the quote is not found in the raw text, it is searched in the text without the `**` marks and mapped back (`plainView` in `public/cues.js`, also used by `quoteAcrossCues`), so the agent can suggest B-roll over words that cross a bold edge. Tests: `tests/cues.test.mjs`.
- `public/app.js` `setCues`: item 4 was mostly done in step P (the agent is told "could not be saved"); what was left is that a refused write still redrew the page and read the settings again from storage, so settings held only in memory (a script's own, right after a rename with storage full) dropped while the message said "nothing changed". A refused write now redraws nothing.
- `public/app.js` `restoreCues`: Undo on the agent's settings line is a write too; when the browser refuses it, nothing is redrawn and the Undo line stays.
- Browser checks in `scripts/smoke-keep-all.mjs`: `runMenuHeight` (`SMOKE_ONLY=menu`, with twelve recent scripts), `runCuesStorageFull` (`SMOKE_ONLY=storage`) and the storage-full checks in `runRename` (`SMOKE_ONLY=rename`). Evidence: `docs/agents/evidence/step-r-browser-b.txt`.
- Known flake of the local test server, not of the editor: about one `runRename` run in six stops with `Error: Net…` as the body of an agent call (wrangler dev); a second run passes.

## PR C: two rare cases (#29)

- Bold on, on the host: `public/app.js` `afterRoomOps`: a guest's edit (typed or deleted inside it, or a split of its line inside it) that falls inside a host's open ask or "Sounds like me" mark closes it (`C.followRoomEdit` in `public/changes.js`), so the old text search can no longer move it onto a later copy of its words. One edit that spans the ask's words without changing them (a batch of edits, or a diff from the first changed character to the last) keeps the ask: the text it replaces and the new text are lined up (`C.alignChars`; `together-adapter.js` passes the text from before), and the ask follows when its own characters were kept side by side and no word grew into it. The same closing applies to the host's own Undo and to an Undo on a name tag. A guest leaves it to the host's asks message. With bold off the old search decides, as before.
- Bold off: `public/cues.js` `emptied`: a stretch alone on its line, its outer words deleted first and the middle one last, leaves `**  **`, which reads as a rule and turned the paragraph into a raw block. Its marks now go with the last words. A stretch with text around it (`a ** b ** c`) is untouched, as before.
- Checks: `tests/cues.test.mjs` (the sequence, spaces around a lone stretch, `textOpInside`, `followRoomEdit`, `alignChars`), and in a browser the guest case in the main run (`SMOKE_ONLY=guest`) and the `**one two three**` sequence in `runBoldOffEdits` (`SMOKE_ONLY=refusals`). Evidence: `docs/agents/evidence/step-r-browser-c.txt`.

## Live

2026-11-06: PRs A and B went live in one release (main `8a6986c`). Evidence: `docs/agents/evidence/step-r-live.txt`; the handoff has the rollback command.

## Not in the first release (left, in this order)

- PR D: fleet #31 item 5 (an open ask on part of a bold stretch shows its `**`; `unmark_cue` can't remove a stretch over about 550 characters; the colour inputs are small touch targets) and item 6 (a guest's selection is dropped when a host's ask arrives on that line) only if cheap, else they stay on the ticket.
- Still open from #29, no fix planned here: deleting outer words first leaves `** two **`, which reads like `a ** b ** c` (documented limit); the Prompter doesn't draw inline `**`.

Due 2026-11-10: Lex's Firefox and Safari hand check of Ctrl+B and ⌘B (fleet #29); it blocks nothing.
- Test gaps the reviews listed and the lead waived (browser checks, none changes what the editor does): for PR C: a guest's edit inside a "Sounds like me" mark; the host with bold off, and the host with bold off and the guest with bold on, both still on the old search; an edit that spans the host's ask without touching its word, in a real room (the lining-up is covered by unit tests only); Enter, Shift+Enter and joins with bold off; a bold-on paste refusal; a script's own setting turned on from the menu; Undo with nothing stored before and storage full; the wheel over the recent list on a tall window (the menu fits, so the page behind must not scroll); a real `answer_broll` across a bold edge with Keep; bold in a non-spoken section for the new quote search; `matchOver(overFor(...))` for quotes that start or end inside a bold stretch.
- Small things the reviews noted: a refused menu click or Undo gives no sign of why nothing happened; after a rename with storage full the agent is told `forScript: false` while the script's own settings are in force (held in memory); `.scripts` lost `overscroll-behavior: contain` and `.menu--scripts` has it, so the wheel moves on to the menu at the end of the list.

## Done

Feature list: updated (`docs/features.md`).
