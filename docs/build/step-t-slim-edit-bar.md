# Step T: the slim edit bar

Lex (2026-11-04), repeated 2026-11-06 through the fleet lead: the selection bar keeps only the text input and the B button. Shorter, Simpler, Sound like me, More and B-roll become typed commands with autocomplete: a grey ghost of the rest of the suggestion after the caret, a small Tab key beside it, Tab takes it, Enter sends the text. No toasts: the sending shows inside the input. The Tab key must not change the input's size. Nothing that could be done before may become impossible. The bar must not cover the selected text or the line above it when that can be avoided. Mock-up: `mockups/edit-bar.html` in the fleet repository.

## What changes

- `public/edit-bar.js` (pure, tested): `resolveTyped` says what a typed line does, `suggestions` what the ghost offers, `rememberAsk` keeps earlier free asks, `findWords` finds the selected words again after the line changed, so bold marks going on or off never move an ask to another copy of the same words, `barSpot` and `phoneDock` where the bar goes.
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
- Validation gaps (gap): R2-1 still open: nothing in the smoke script or unit tests reaches the `renderAsk` call in `renderBroll` (`public/app.js:2894`, the line has moved from 2892). This round did not touch it.
- Validation gaps (gap): R2-7, margin drag: before the release at line 785, assert `getSelection().toString().length > 0`. After the release, assert the bar opens with `page.until(barOpen, ...)`. This is now the only check on a press that starts outside the text and moves the selection.
- Validation gaps (gap): New, toolbar check at `scripts/smoke-keep-all.mjs:797`: it passes without showing that the selection survived, and with no selection the bar would stay closed under the old code too. After the click, also assert `getSelection().toString() === "deadline"`.
- Validation gaps (gap): B over a bold edge: the bar's word count is checked (step W); still not checked: after Enter the ask's quote is "big word now".
- Validation gaps (gap): R6-10 still open: the margin drag at `:866-872` is unchanged. There is no selection check before the release and no bar check after it.
- Validation gaps (gap): R6-8 still open: `scripts/smoke-keep-all.mjs:796` is unchanged. Keep the result and assert `instruction === "warmer"` and `quote === "the"`.
- Previous findings (P3): R6-4 still open: `docs/build/step-t-slim-edit-bar.md:33-36` and `:40` still have the old line numbers. The margin drag is now at `scripts/smoke-keep-all.mjs:864-871`, the toolbar check at `:882` and the bold-edge check at `:897`.
- Validation gaps (gap): R6-2 still open: the assertion at `:798` is now right, but `:796` still throws away the result of `newAsks()`, so the ask's instruction isn't checked.
- Standards (P3): e49ca81:docs/build/step-t-slim-edit-bar.md:33 — P3 style: this is R6-4, still open. Lines 33, 35, 36 and 40 point to old places in `scripts/smoke-keep-all.mjs` (`:784`, `:785`, `:797`, `:~820`). Fix: update them to `:864-871`, `:870`, `:882` and `:897`.
- Validation gaps (gap): R6-2 and R6-8, `scripts/smoke-keep-all.mjs:796`: write `const lastCopy = await newAsks();`. Then assert `lastCopy[0]?.instruction === "warmer" && lastCopy[0]?.quote === "the"`. The check would then also prove this ask is the one that was just sent.
- Validation gaps (gap): R6-10, `scripts/smoke-keep-all.mjs:869-871`: before the release, assert `getSelection().toString().length > 0`. After it, assert `await page.until(barOpen, "the bar after the release", 1500)`. The check at `:869` currently also passes if nothing was selected.
- Validation gaps (gap): New, `scripts/smoke-keep-all.mjs:746`: nothing confirms the bold came off. If `unmark_cue` did nothing, "the bold off again" at `:747` and the new "bold again" check at `:751` would both still pass. After the sleep at `:746`, assert `!(await script()).includes("Most")`.

