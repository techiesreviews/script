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

`tests/edit-bar.test.mjs`. In a real browser, `scripts/smoke-keep-all.mjs` with `SMOKE_ONLY=slim`: `runSlimBar` (1280 px and 390 px), `runBarPlace` (1280x800, 1280x420, 390x760) and `runSlimGuest`; the other groups now send their asks by typing. Evidence: `docs/agents/evidence/step-t-browser.txt`. Not checked: a real on-screen keyboard on a real phone, and Firefox and Safari.

## Done

Feature list: updated (`docs/features.md`).
