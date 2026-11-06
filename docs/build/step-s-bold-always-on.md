# Step S: bold is always on, and only its colours are settings

Lex (2026-11-06), with a screenshot of the Bold menu: "remove the bold settings. Only use the color settings, and by default make the text orange and bold, matching the design of the prompter." "Make the bold marking the default turned on, so remove the functionality to turn it off."

## What changes

- Bold marking has no off any more: B, Ctrl/Cmd+B and the bold look work in every script, for hosts and guests. Everything that only ran while it was off is gone (`readCuesWhen`, the "bold off never refuses" paths).
- The file name's menu keeps only **Bold style**: a font colour, a background, and Reset once one is chosen. "Bold marking (experimental)", "Camera action with bold words" and "Bold words in the prompter file" are gone.
- By default the words are orange and weight 800: `--bold-ink` in `public/app.css`, the prompter's own `--accent` (`oklch(65% 0.227 32.3)`) on the night blue, and the existing darker orange of `--accent-ink` in light mode, where the bright one is too faint on white.
- The prompter file always holds plain words, as it did by default: the prompter shows `**` as literal asterisks today. Showing bold in the prompter is its own job, in its own repository.
- The agent loses `get_cue_settings` and `set_cue_settings`: a hidden setting the person can't see or change would break the menu's promise. `list_cues`, `mark_cue` and `unmark_cue` stay and always work.
- The saved settings go from the browser when the page loads (`script-editor:cues`, `script-editor:cues:<file name>`). An older colour choice stays only if `own` was on.

## What to watch

- With bold on for everyone, a `**pair**` in an older script now shows as bold where it showed as text before, and an edit that would turn a bold line into another kind of block is refused. That is what "on" always did; before it was opt-in.

## Checks

`tests/bold-always-on.test.mjs`; `tests/cues.test.mjs` no longer runs anything with bold off. In a real browser `scripts/smoke-keep-all.mjs`: `runBoldLook` (`SMOKE_ONLY=look`) checks the colours in dark and light mode, the menu, Reset and the old saved switch; the other groups run with bold on. Evidence: `docs/agents/evidence/step-s-browser.txt`.

## Done

Feature list: updated (`docs/features.md`).
