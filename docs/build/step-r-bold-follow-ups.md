# Step R: bold marking follow-ups

Lex (2026-11-06): fix the follow-ups listed in fleet issues #29, #30 and #31, one small PR each on `dev`. Bold marking stays experimental and off by default; his earlier choices stand (stored `**words**`, the B button, Bold style colours).

## PR A: bold off never refuses an edit (#30, #31 item 1)

- `public/app.js` `syncFromDom`, `pasteText`, `mergeInto`: an edit that would make the line read as another kind of block ("**Note** - more" losing "Note", or a paste over `**Note`) is refused only while Bold marking is on. With it off, nothing is refused, as before bold existed.
- `public/app.js` `splitAt`: Enter and Shift+Enter just before the space in a bold line like `**1. x y**` or `**## Plan**` are now refused too (the parts joined without their marks would read as a list or a heading, so `1.` or `Pl` and `an` left the spoken text); the check runs only while Bold marking is on.
- Checked in a real browser: `scripts/smoke-keep-all.mjs` (`runBoldOffEdits`, and the "just before the space" cases in `runBoldKinds`; `SMOKE_ONLY=refusals` runs these two functions). Evidence: `docs/agents/evidence/step-r-browser.txt`.

## Done

Feature list: updated (`docs/features.md`).
