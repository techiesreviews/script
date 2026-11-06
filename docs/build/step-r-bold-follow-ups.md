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
- Browser checks in `scripts/smoke-keep-all.mjs`: `runMenuHeight` (`SMOKE_ONLY=menu`), and the storage-full checks in `runRename` (`SMOKE_ONLY=rename`). Evidence: `docs/agents/evidence/step-r-browser-b.txt`.
- Known flake of the local test server, not of the editor: about one `runRename` run in six stops with `Error: Net…` as the body of an agent call (wrangler dev); a second run passes.

## Done

Feature list: updated (`docs/features.md`).
