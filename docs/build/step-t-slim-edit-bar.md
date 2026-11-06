# Step T: the slim edit bar

Lex (2026-11-04), repeated 2026-11-06 through the fleet lead: the selection bar keeps only the text input and the B button. Shorter, Simpler, Sound like me, More and B-roll become typed commands with autocomplete: a grey ghost of the rest of the suggestion after the caret, a small Tab key beside it, Tab takes it, Enter sends the text. No toasts: the sending shows inside the input. The Tab key must not change the input's size. Nothing that could be done before may become impossible. The bar must not cover the selected text or the line above it when that can be avoided. Mock-up: `mockups/edit-bar.html` in the fleet repository.

## What changes

- `public/edit-bar.js` (pure, tested): `resolveTyped` says what a typed line does, `suggestions` what the ghost offers, `rememberAsk` keeps earlier free asks, `barSpot` and `phoneDock` where the bar goes.
- A typed command gives the same `action` and standard instruction as its button: nothing changes in what reaches the agent or the host, guests included. Anything else is an `ask` with the words as typed; Enter sends what is typed, never the ghost.
- Decisions the mock-up left open:
  - **More:** the mock-up has no place for it, so the typed command `more` opens the same small menu (Explain how it works, Check facts, Find links).
  - **B-roll:** the old button opened Add B-roll… and Suggest B-roll. `b-roll` makes the ask (what a guest's button did), `add b-roll` opens the card (the host's).
  - **Escape:** closes the bar, as the note asked, also while a ghost shows; the mock-up's first press only hid the ghost.
  - **A command that can't run here** (B-roll over words that aren't spoken, Add B-roll as a guest): its button was disabled or missing, so Send turns off and nothing goes; only a screen reader hears why, as no extra text was asked for.
  - **Sending:** an ask is made at once and has no later "sent" moment to wait for, so the input shows Sending… for 700 ms and the bar goes; the ask's chip on the words carries on from there.
- With the focus in the bar the browser takes the page's selection away, so a CSS highlight keeps the words marked (not in browsers without the Custom Highlight API: there the words show as before, unmarked).
- Placement: below the words; else above them with one line clear; else right above them; else, when the words fill the window, on the side with more room; always on screen. The input no longer grows on focus. A wide screen with an on-screen keyboard (a tablet) counts only what is seen (`visualViewport`). Phone: docked at the bottom, above the on-screen keyboard, at the top when it would sit on the words.

## Checks

`tests/edit-bar.test.mjs`. In a real browser, `scripts/smoke-keep-all.mjs` with `SMOKE_ONLY=slim`: `runSlimBar` (1280 px and 390 px), `runBarPlace` (1280x800, 1280x420, 390x760), `runSlimGuest` (1280 px, 390 px, 320 px) and `runNarrowBar` (360x740, 320x640); the other groups now send their asks by typing. Evidence: `docs/agents/evidence/step-t-browser.txt`. Not checked: a real on-screen keyboard on a real phone or tablet (the ghost during a phone keyboard's composition, the lift above the keyboard), and Firefox and Safari. The field stays at least 200 px wide while it can: under about 378 px B takes a row of its own; at 320 px the field is about 190 px.

## Left as it was

Pressing a toolbar button with an ask half typed closes the bar and drops the typed words. The site did this before this step too (checked on the live site, 2026-11-06), so it is not changed here; the script text is never touched.

## Done

Feature list: updated (`docs/features.md`).

### Follow-ups

- Validation gaps (gap): R2-10 still open: same cause as R2-1, no test makes the list ready while "add b-roll" is typed.
- Validation gaps (gap): R2-7 still open: the margin drag at `scripts/smoke-keep-all.mjs:784` still checks only that the bar is hidden, which is also true if nothing was selected. After the release at line 785 nothing is checked.
- Previous findings (P3): R2-5 still open: this round has no CSS change. The reason still sits on a solid background above a full-width input (`public/app.css:445-446`), so it covers the end of a long ask and the caret there.
- Validation gaps (gap): R2-1 still open: nothing in the smoke script or unit tests reaches the `renderAsk` call in `renderBroll` (`public/app.js:2894`, the line has moved from 2892). This round did not touch it.
- Spec (P3): 46edee5:docs/build/step-t-slim-edit-bar.md:32 — P3 ticket: the open follow-up was edited and is now wrong. It says the longest line is "list not ready", "also 27 characters", but that reason is 14 characters. The 27 counted the typed words too, and the reason is no longer laid out after them. The test it describes is also out of date: it asserts the right edge of `#askGhost b`, which can't fail now the reason is pinned to the right (R2-6), and it uses the old " · list not ready" text. Its line references (656-659, 813) have moved too. Fix: say "list not ready" is the longest reason at 14 characters, and ask for the left-edge check (`#askGhost b` left >= `#askGhost` left) at the current lines.
- Standards (P3): 46edee5:scripts/smoke-keep-all.mjs:801 — P3 style: the comment "Right-to-left words…" is indented four spaces where the code around it uses two, a slip from the insertion above it. Fix: indent it two spaces.
- Validation gaps (gap): R2-1 and R2-10, the `renderAsk` call in `renderBroll`: with the bar open and "add b-roll" typed while the list isn't ready, make the list ready. Assert that `aria-invalid` is gone, the reason is cleared and Send is enabled.
- Validation gaps (gap): R2-7, margin drag: before the release at line 785, assert `getSelection().toString().length > 0`. After the release, assert the bar opens with `page.until(barOpen, ...)`. This is now the only check on a press that starts outside the text and moves the selection.
- Validation gaps (gap): New, toolbar check at `scripts/smoke-keep-all.mjs:797`: it passes without showing that the selection survived, and with no selection the bar would stay closed under the old code too. After the click, also assert `getSelection().toString() === "deadline"`.
- Defects (P3): 2c2b7ef:public/app.js:1258 — P3 fault: when B is pressed with the focus in the bar over a bold edge, the word count goes stale. Selecting "word now" in "big word now" counts 2 words. B then widens the selection to "big word now", which is 3 words, and marks all three, but `#ebLabel` is only set in `showBar` (`public/app.js:1363`), so it still says "2 words". The stale label only appears in this path, because B outside the bar reselects the text and `showBar` runs again. Fix: move the count into a small helper and call it from both `showBar` and this branch of `toggleCueHere`.
- Defects (P3): 2c2b7ef:public/app.js:1336 — P3 fault: on a panned phone page, the top dock sits one toolbar height too low. `.top` is sticky, so its `getBoundingClientRect().bottom` is measured against the layout viewport, as is `--bar-y`. The first visible line in those coordinates is `panned`, and the toolbar ends at `top`, so the first free spot is `Math.max(top, panned)`. `top + panned` overshoots by `min(top, panned)`. The same sum goes into `phoneDock` on line 1337, so words in that gap get the bottom dock and can be covered when the top dock would have been clear. It never covers the toolbar or goes off screen, and it only happens with the keyboard open and the page panned. Fix: set `const clear = Math.max(top, panned)`, and use `clear + 8` for `--bar-y` and `top: clear` for `phoneDock`.
- Validation gaps (gap): The panned branch of `placeBar` (`public/app.js:1335-1337`) has no coverage. The `phoneDock` unit test (`tests/edit-bar.test.mjs:115`) only passes a fixed `top`, so it never exercises the sum. Test to add: in `scripts/smoke-keep-all.mjs` at 390x760, redefine `window.visualViewport` with `offsetTop: 100` and a reduced `height`, then trigger `placeBarAgain` through a `visualViewport` scroll event. Assert that `--bar-y` is 8 px below the first free spot, and that `data-dock` is "top" for words just below the bar and "bottom" when the words would be under it.
- Validation gaps (gap): "Words gone" clearing is only shown for the input. `runSlimGuest` checks the reason, Send and the typed text, but not B or sending. Test to add: after the guest's Undo in `scripts/smoke-keep-all.mjs`, assert `#boldBtn` is enabled and `CSS.highlights.has("bar-selection")` is true. Then press Enter and assert `wait_for_asks` returns one ask with the original word as its quote.
- Validation gaps (gap): B over a bold edge only checks that the input is ready, not that the bar's words moved with it. Test to add: after the check at `scripts/smoke-keep-all.mjs:~820`, assert the input still holds "say it warmer". Then press Enter and assert the ask's quote is "big word now". Assert `#ebLabel` says "3 words" once the first defect above is fixed.

