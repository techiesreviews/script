# Step S: bold is always on, and only its colours are settings

Lex (2026-11-06), with a screenshot of the Bold menu: "remove the bold settings. Only use the color settings, and by default make the text orange and bold, matching the design of the prompter." "Make the bold marking the default turned on, so remove the functionality to turn it off."

## What changes

- Bold marking has no off any more: B, Ctrl/Cmd+B and the bold look work in every script, for hosts and guests. Everything that only ran while it was off is gone (`readCuesWhen`, the "bold off never refuses" paths).
- The file name's menu keeps only **Bold style**: a font colour and a background. "Bold marking (experimental)", "Camera action with bold words" and "Bold words in the prompter file" are gone.
- By default the words are orange and weight 800: `--bold-ink` in `public/app.css`, the prompter's own `--accent` (`oklch(65% 0.227 32.3)`) on the night blue, and the existing darker orange of `--accent-ink` in light mode, where the bright one is too faint on white.
- The prompter file always holds plain words, as it did by default: the prompter shows `**` as literal asterisks today. Showing bold in the prompter is its own job, in its own repository.
- The agent loses `get_cue_settings` and `set_cue_settings`: a hidden setting the person can't see or change would break the menu's promise. `list_cues`, `mark_cue` and `unmark_cue` stay and always work. The server's version goes to 0.10.0.
- The saved settings go from the browser when the page loads (`script-editor:cues`, `script-editor:cues:<file name>`). An older colour choice stays only if `own` was on.

## What to watch

- No Reset in step S: Lex asked for only the colour settings and nothing extra (2026-11-06). Step U (2026-11-07) moved the colours to a popover by B and added a Reset, as in Lex's approved prototype.

- With bold on for everyone, a `**pair**` in an older script now shows as bold where it showed as text before, and an edit that would turn a bold line into another kind of block is refused. That is what "on" always did; before it was opt-in.

## Checks

`tests/bold-always-on.test.mjs`; `tests/cues.test.mjs` no longer runs anything with bold off. In a real browser `scripts/smoke-keep-all.mjs`: `runBoldLook` (`SMOKE_ONLY=look`) checks the colours in dark and light mode, the menu and the old saved switch; the other groups run with bold on. Evidence: `docs/agents/evidence/step-s-browser.txt`.

## Done

Feature list: updated (`docs/features.md`).

### Follow-ups

- Validation gaps (gap): R1-7 still open: the redraw check is back (`scripts/smoke-keep-all.mjs:587`), but only the caret's text node is compared. Scroll position, a selected word and the caret's offset are not checked. The old 300 ms wait after the name change is also gone, so a later redraw could be missed.
- Validation gaps (gap): R1-5 still open: both fields are now checked in dark and light mode, and the four values are correct today (I converted them by hand). But `scripts/smoke-keep-all.mjs:541` and `:569` compare the fields with typed-in hex, not with the page's CSS. Changing `--bg` or `--bold-ink` in `public/app.css` still would not fail these two checks.
- Validation gaps (gap): R1-5, `scripts/smoke-keep-all.mjs:541` and `:569`: in each mode, paint `getComputedStyle(document.body).backgroundColor` and the default bold word's computed colour onto a 1×1 canvas. Read the pixel back as `#rrggbb` and require it to match `#boldBg` and `#boldFg`, so a CSS change without a `BOLD_SHOWN` change fails.
- Validation gaps (gap): R1-7, `scripts/smoke-keep-all.mjs:586-587`: scroll to a non-zero position before the rename and check `scrollY` is unchanged afterwards. Wait 300 ms after the name changes before checking. Check the caret's offset as well as its node. Add a second rename with a word selected, as the old `runRename` did, and check the same text is still selected.

