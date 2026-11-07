# Step U: the bold colours by B

Lex (2026-11-07), on a prototype of two ways: "Can we hover the b and have options to change colors" → "Yes variant a", and "Where is the hover for colors on the b icon? I see them in the menu, where I don't want it, I want it on the hover with the b".

## What changes

- Hovering B on the selection bar, or reaching it with the keyboard, opens a small popover by it: **Bold text colour** (the default orange, five colours and a "+" for your own) and **Bold background** (None, five colours and a "+"), a sample word in the chosen look and **Reset**. Picking a colour changes how bold words look at once.
- Clicking B still only bolds or unbolds the selection. On a phone a tap on B bolds and opens the colours as well; a tap anywhere else closes them.
- They close when the pointer leaves B and the popover, on Escape (a second Escape closes the bar, as before), or when the keyboard focus leaves them. B has no tooltip any more, so nothing sits on them; its keys stay in `aria-keyshortcuts`.
- The popover never sits on the selected words: under the bar, over it, beside it, or at the top or bottom of what is seen, whichever comes first that keeps it on screen and off the words (`popSpot` in `public/edit-bar.js`). It is in the top layer, so the bar keeps its size.
- The two colour fields left the file name's menu: the colours live only by B now.
- The same saved setting: `script-editor:boldStyle` in this browser, per person (guests and hosts each keep their own). A colour chosen before keeps showing. The ready-made colours are `#rrggbb` (`BOLD_SWATCHES` in `public/cues.js`), so `boldStyle` keeps letting only those through. The default orange and None are "nothing chosen". **Reset** removes the saved setting: orange and bold, no background. (Step S had no Reset; Lex's approved prototype has one.)
- Display only: no script text, prompter file or export changes.

## Checks

`tests/edit-bar.test.mjs` (`popSpot`, the bar's markup) and `tests/bold-always-on.test.mjs` (the colours by B and not in the menu, the swatches). In a real browser `scripts/smoke-keep-all.mjs` with `SMOKE_ONLY=look`: `runBoldLook` (the colours in dark and light mode, now read in the popover) and `runBoldPop` at 1280x800, 1280x420, 390x760 and 320x640: hover opens, the bar keeps its size, on screen and off the words, picking saves and shows at once, clicking B still bolds, your own colour, Reset, the pointer leaving, Escape, the keyboard, and on the phone sizes a tap on B, picking by tap and a tap elsewhere. `runMenuHeight` now checks New script is reachable and the menu has no colour fields. Evidence: `docs/agents/evidence/step-u-browser.txt`.

Not checked: a real phone, Firefox and Safari, and a colour field's own picker (the system's window; the check sets the field's value).

## Done

Feature list: updated (`docs/features.md`).
