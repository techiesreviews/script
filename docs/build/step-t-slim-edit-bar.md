# Step T: the slim edit bar

Lex (2026-11-04), repeated 2026-11-06 through the fleet lead: the selection bar keeps only the text input and the B button. Shorter, Simpler, Sound like me, More and B-roll become typed commands with autocomplete: a grey ghost of the rest of the suggestion after the caret, a small Tab key beside it, Tab takes it, Enter sends the text. No toasts: the sending shows inside the input. The Tab key must not change the input's size. Nothing that could be done before may become impossible. The bar must not cover the selected text or the line above it when that can be avoided. Mock-up: `mockups/edit-bar.html` in the fleet repository.

## What changes

- `public/edit-bar.js` (pure, tested): `resolveTyped` says what a typed line does, `suggestions` what the ghost offers, `rememberAsk` keeps earlier free asks, `barSpot` and `phoneDock` where the bar goes.
- A typed command gives the same `action` and standard instruction as its button: nothing changes in what reaches the agent or the host, guests included. Anything else is an `ask` with the words as typed; Enter sends what is typed, never the ghost.
- Decisions the mock-up left open:
  - **More:** the mock-up has no place for it, so each of its items is a command of its own (Explain how it works, Check facts, Find links), and `more` opens the same small menu.
  - **B-roll:** the old button opened Add B-roll… and Suggest B-roll. `b-roll` and `suggest b-roll` make the ask (what a guest's button did), `add b-roll` opens the card (the host's).
  - **Escape:** closes the bar, as the note asked, also while a ghost shows; the mock-up's first press only hid the ghost.
  - **A command that can't run here** (B-roll over words that aren't spoken, Add B-roll as a guest): its button was disabled or missing, so it says why in grey on the input and sends nothing, rather than going to the agent as a free ask.
  - **Sending:** an ask is made at once and has no later "sent" moment to wait for, so the input shows Sending… for 700 ms and the bar goes; the ask's chip on the words carries on from there.
- With the focus in the bar the browser takes the page's selection away, so a CSS highlight keeps the words marked (not in browsers without the Custom Highlight API: there the words show as before, unmarked).
- Placement: below the words; else above them with one line clear; else right above them; else, when the words fill the window, on the side with more room; always on screen. The input no longer grows on focus. Phone: docked at the bottom, above the on-screen keyboard (`visualViewport`), at the top when it would sit on the words.

## Checks

`tests/edit-bar.test.mjs`. In a real browser, `scripts/smoke-keep-all.mjs` with `SMOKE_ONLY=slim`: `runSlimBar` (1280 px and 390 px), `runBarPlace` (1280x800, 1280x420, 390x760), `runSlimGuest` (1280 px, 390 px, 320 px) and `runNarrowBar` (360x740, 320x640); the other groups now send their asks by typing. Evidence: `docs/agents/evidence/step-t-browser.txt`. Not checked: a real on-screen keyboard on a real phone (the ghost during a phone keyboard's composition, the lift above the keyboard), and Firefox and Safari. The field stays at least 200 px wide while it can: under about 378 px B takes a row of its own; at 320 px the field is about 190 px and a refused command's reason may use the Tab key's room.

## Done

Feature list: updated (`docs/features.md`).

### Follow-ups

- Validation gaps (gap): The longest reason in the narrowest field: the check "the longest reason fits inside the input" (`scripts/smoke-keep-all.mjs:656-659`) runs over a heading, where B is hidden, so the field is about 260 px wide at 390 px. "Not spoken" can only appear with B hidden. With B showing, the field is about 212 px, and the longest line there is "add b-roll · list not ready", also 27 characters. Only the shorter "add b-roll · host only" is measured at that width (line 813). By estimate it should fit, but nothing shows it. Test to add: at 390 px over a spoken word, make the B-roll list not ready (`canAddBroll()` false for the host). Type "add b roll" and assert that the right edge of `#askGhost b` is within the right edge of `#askField`. If that state is awkward to reach, set the text of `#askGhost b` to " · list not ready" after the guest check at line 813 and measure the same edges, with the guest page opened at 390 px.
- Validation gaps (gap): The whole sentences for screen readers: the new `say` text is not checked. `tests/edit-bar.test.mjs` only asserts `why`, and the smoke check at line 655 matches `/spoken/`, which the short "not spoken" also passes. If `public/app.js:1423` went back to `plan.why`, every check would still pass. Test to add: in `tests/edit-bar.test.mjs`, assert `say` for all three refusals (`/needs spoken words/`, `/Only the host/`, `/list isn't ready/`). In the smoke check at line 655, tighten the match to `/^B-roll needs spoken words\.$/`.

