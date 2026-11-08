# Step W: the last small bold follow-ups

Lex (2026-11-08, Orbit cards TOOLS-50 and TOOLS-52): finish the open bold follow-ups. Fix only what those two cards and the follow-up lists of steps S, T and U name. Nothing may change or lose script text; bold, link and slim-bar behaviour stay as they are.

## TOOLS-50 (fleet #29): already fixed

Both rare cases were fixed in step R, PR C (`step-r-bold-follow-ups.md`) and are on `dev`; the card could not find the commit. Not rebuilt.

- A guest's edit inside a host's open ask: `afterRoomOps` closes the ask (`C.followRoomEdit` in `public/changes.js`); tests in `tests/changes.test.mjs` and `tests/cues.test.mjs`, browser check `SMOKE_ONLY=guest` ("a guest typing inside the host's ask closes it"), evidence `docs/agents/evidence/step-r-browser-c.txt`.
- The `**  **` rule block: `emptied` in `public/cues.js` takes the marks with the last words; tests in `tests/cues.test.mjs`, browser check `runBoldOffEdits` in `SMOKE_ONLY=refusals`, same evidence file.
- The rest of the card's "Also" line is a documented limit (`** two **` after deleting the outer words) or belongs to TOOLS-52 (the 550 characters, the Ctrl+B check). The Prompter drawing inline `**` is not this editor.

## TOOLS-52 (fleet #31): items 1-4 were fixed in step R; item 5 and 6 now

- **`unmark_cue` over about 550 characters:** `list_cues` puts a stretch's words in its `cueId`, and the check refused a `cueId` over 560 characters, while the words are also over the 500 of `quote`, so the stretch could not be removed at all. A `cueId` now takes up to the longest script plus its block id (`CUE_ID_MAX` in `worker/mcp.js`). Test: `tests/cues.test.mjs`.
- **An open ask on part of a bold stretch showed its `**`:** a bold stretch cut by an ask's (or note's, or mark's) edge was drawn as plain Markdown. It is now drawn in pieces (`plainNodes` in `public/app.js`, `.md-cut` in `public/app.css`): the words keep the bold look, the `**` are hidden. Like a whole stretch, the `**` show while the selection touches it and a caret put on its edge goes just outside (`cutGroups`, `openLinks`, `closedLinks` in `public/app.js`, read from the pieces as they are now, so typing inside a stretch needs no redraw), so other people's carets are drawn on the words too. The text nodes are still the block's exact content, so offsets, asks and the room are unchanged. Not changed: a link inside such a stretch is drawn as before, without the bold look.
- **The colour inputs were small touch targets:** on a touch screen the colours and both "+" buttons are 44 px (`2.75rem`, the bar's own buttons), they were 36 px.
- **A guest's selection dropped when a host's ask arrived on that line (item 6):** `setRoomAsks` draws the line again; it now puts the selection back (the text is the same), so the guest's selection and bar stay.
- The Firefox and Safari hand check of Ctrl+B and ⌘B stays Lex's (Due 2026-11-10). A headless Firefox 155 was run on synthetic text as far as scripted keys go (below); WebKit would not start here.

## From the follow-up lists of steps T and U

- The bar's word count after B widened the words over a bold edge ("2 words" stayed while B marked 3): `barLabel` is set again by `changeMarkup` (step T, P3).
- A panned phone page put the bar and the top dock one top-bar height too low: the first free spot is `seenFrom(top, panned)`, the lower of the two, not their sum (`public/edit-bar.js`; step T, P3). The colours' height cap and place use the same helper and work the top edge, the seen end and the cap once (step U, P3).
- A colour field the mouse picked through kept the focus and held the colours open: its `change` takes the focus off unless the keyboard is there (step U, P3).
- Follow-up lines for the above are removed from the steps T and U lists.

## Checks

`tests/cues.test.mjs` (the long `cueId`), `tests/edit-bar.test.mjs` (`seenFrom`). In a real browser `scripts/smoke-keep-all.mjs` with `SMOKE_ONLY=followups`: `runAskInBold` and `runAskInBoldEdges` (the caret next to a cut stretch, an ask across its marks, a link inside it; 1280 and 390 px), `runGuestSelection` (1280 and 390 px), `runBarPanned` (390 px, a faked visual viewport); and in `SMOKE_ONLY=look` the 44 px colours and the "+" by mouse; in `SMOKE_ONLY=slim` the word count over a bold edge. Evidence: `docs/agents/evidence/step-w-browser.txt`. Each new check failed before its change.

## Left

- Step S's validation gaps (the smoke's colour and redraw checks compare typed values, not the page's CSS or scroll position) and the other test gaps of the follow-up lists: test-only, they change nothing the editor does.
- Documented limits of step R (a stretch with more lines in its block, two spaced stretches on one line, the Prompter not drawing `**`).

## Done

Feature list: updated (`docs/features.md`).

### Follow-ups

- Spec (P3): 3e9fe85:docs/build/step-u-bold-colours-by-b.md:29 — P3 ticket: this commit deleted the step U follow-up "Spec (P3) 5a8f408 … the Follow-ups list still says the ArrowLeft wrap is not really checked … Fix: remove that follow-up". But it kept the line that note asked to remove: "Validation gaps (gap): The ArrowLeft wrap is not really checked…", which is now line 29. So the list still claims a check is missing when the smoke script already has it ("ArrowLeft at the start wraps to the row's end", at both sizes, in the evidence). Fix: delete line 29, or mark it done in 5a8f408.
- Validation gaps (gap): Deleting next to a cut stretch's hidden marks has no check. `public/app.js:1235` now sets `linksBefore` when there is a `.md-cutmark:not([data-open])`. Through `closedLinks`, it also passes the cut groups to `L.keepHidden`. Nothing tests this path. Test to add in `runAskInBoldEdges`, after the ask on "word": put the caret just after "Say " with the stretch's marks hidden, press Delete, and assert that `get_script` still holds `big word now` with both marks whole. Then do the same with Backspace just after "now".
- Validation gaps (gap): `cutGroups` reads a stretch from its pieces. When typing or a deletion removes the whole first or last words piece (for example, select "big" in a stretch cut on "word" and delete it), `ws`/`we` fall back to the stretch's outer edges, so the hidden `` would count as words. Test to add in `runAskInBoldEdges`: select "big " inside the cut stretch, delete it, and assert the script reads `Say word now okay.` with no stray `*`.

