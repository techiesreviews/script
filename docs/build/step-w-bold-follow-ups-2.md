# Step W: the last small bold follow-ups

Lex (2026-11-08, Orbit cards TOOLS-50 and TOOLS-52): finish the open bold follow-ups. Fix only what those two cards and the follow-up lists of steps S, T and U name. Nothing may change or lose script text; bold, link and slim-bar behaviour stay as they are.

## TOOLS-50 (fleet #29): already fixed

Both rare cases were fixed in step R, PR C (`step-r-bold-follow-ups.md`) and are on `dev`; the card could not find the commit. Not rebuilt.

- A guest's edit inside a host's open ask: `afterRoomOps` closes the ask (`C.followRoomEdit` in `public/changes.js`); tests in `tests/changes.test.mjs` and `tests/cues.test.mjs`, browser check `SMOKE_ONLY=guest` ("a guest typing inside the host's ask closes it"), evidence `docs/agents/evidence/step-r-browser-c.txt`.
- The `**  **` rule block: `emptied` in `public/cues.js` takes the marks with the last words; tests in `tests/cues.test.mjs`, browser check `runBoldOffEdits` in `SMOKE_ONLY=refusals`, same evidence file.
- The rest of the card's "Also" line is a documented limit (`** two **` after deleting the outer words) or belongs to TOOLS-52 (the 550 characters, the Ctrl+B check). The Prompter drawing inline `**` is not this editor.

## TOOLS-52 (fleet #31): items 1-4 were fixed in step R; item 5 and 6 now

- **`unmark_cue` over about 550 characters:** `list_cues` puts a stretch's words in its `cueId`, and the check refused a `cueId` over 560 characters, while the words are also over the 500 of `quote`, so the stretch could not be removed at all. A `cueId` now takes up to the longest script plus its block id (`CUE_ID_MAX` in `worker/mcp.js`). Test: `tests/cues.test.mjs`.
- **An open ask on part of a bold stretch showed its `**`:** a bold stretch cut by an ask's (or note's, or mark's) edge was drawn as plain Markdown. It is now drawn in pieces (`plainNodes` in `public/app.js`, `.md-cut` in `public/app.css`): the words keep the bold look, the `**` are hidden. The text nodes are still the block's exact content, so offsets, asks, carets and the room are unchanged. Not changed: a link inside such a stretch is drawn as before, without the bold look.
- **The colour inputs were small touch targets:** on a touch screen the colours and both "+" buttons are 44 px (`2.75rem`, the bar's own buttons), they were 36 px.
- **A guest's selection dropped when a host's ask arrived on that line (item 6):** `setRoomAsks` draws the line again; it now puts the selection back (the text is the same), so the guest's selection and bar stay.
- The Firefox and Safari hand check of Ctrl+B and ⌘B stays Lex's (Due 2026-11-10). A headless Firefox 155 was run on synthetic text as far as scripted keys go (below); WebKit would not start here.

## From the follow-up lists of steps T and U

- The bar's word count after B widened the words over a bold edge ("2 words" stayed while B marked 3): `barLabel` is set again by `changeMarkup` (step T, P3).
- A panned phone page put the bar and the top dock one top-bar height too low: the first free spot is `seenFrom(top, panned)`, the lower of the two, not their sum (`public/edit-bar.js`; step T, P3). The colours' height cap and place use the same helper and work the top edge, the seen end and the cap once (step U, P3).
- A colour field the mouse picked through kept the focus and held the colours open: its `change` takes the focus off unless the keyboard is there (step U, P3).
- Follow-up lines for the above are removed from the steps T and U lists.

## Checks

`tests/cues.test.mjs` (the long `cueId`), `tests/edit-bar.test.mjs` (`seenFrom`). In a real browser `scripts/smoke-keep-all.mjs` with `SMOKE_ONLY=followups`: `runAskInBold` (1280 and 390 px), `runGuestSelection`, `runBarPanned` (390 px, a faked visual viewport); and in `SMOKE_ONLY=look` the 44 px colours and the "+" by mouse; in `SMOKE_ONLY=slim` the word count over a bold edge. Evidence: `docs/agents/evidence/step-w-browser.txt`. Each new check failed before its change.

## Left

- Step S's validation gaps (the smoke's colour and redraw checks compare typed values, not the page's CSS or scroll position) and the other test gaps of the follow-up lists: test-only, they change nothing the editor does.
- Documented limits of step R (a stretch with more lines in its block, two spaced stretches on one line, the Prompter not drawing `**`).

## Done

Feature list: updated (`docs/features.md`).
