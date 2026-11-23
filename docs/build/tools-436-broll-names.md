# TOOLS-436: keep B-roll names reserved when lookup fails

Lex (2026-11-23): fix hidden failures first, starting with F2 in the TOOLS-429 risk report. Land on dev only.

Source: [TOOLS-436](https://board.techies.review/tasks/01a2098d-bf0c-73ea-9923-70ba5a625952?workspace=01a1b0d3-5786-7701-98e9-ddb7285afe5a), supplied launch brief; [TOOLS-429 F2](/home/ubulex/Projects/fleet/inbox/script-editor-TOOLS-429-risk-check-2026-11-23.md#f2--preserve-b-roll-name-reservations-when-discovery-fails). The supplied card has two Done when items; the report's three F2 checks are covered within those two items below.

## Change

Naming a new or renamed browser script needs a complete B-roll reservation inventory. Previously a failed IndexedDB open returned an empty inventory, and a failed cursor returned only the names reached so far. Both allowed a new script to take a name belonging to an old link or kept list.

Discovery now rejects on open, transaction, cursor or abort failure, and returns names only after the read transaction completes. The existing B-roll queue isolates a failed turn so a healthy retry can name safely. A title-following rename keeps the old name when discovery fails; the save of the script's words still succeeds. The agent's open request reports the failed lookup through its existing error handler. New script leaves the current script open when reservations are unknown and uses the existing failed-open notice, "Couldn't open a new script". If file creation fails after a successful lookup, its existing unsaved fallback uses the checked name. Ctrl/Cmd+S on a script without a file, such as the demo, now refuses an unchecked name: the existing save-error handler keeps the script unsaved and shows "Not saved", with the error as its tooltip.

No storage record is changed by discovery. Cleared null records still release their names; retained links and IndexedDB-only lists reserve names regardless of capitals. Failure feedback reuses existing notices; no new notice type, layout, script text, draft handling or collaborative editing changes are added.

## Tests first

`ASE_OWNER=fleet-lead scripts/agents/kit specs tests/broll-names.test.mjs` initially failed with `open: unknown reservations must stop naming`: actual `orphan.md`, expected `rejected`.

After making discovery strict, the New script regression failed because it opened the unchecked `untitled-script.md` fallback. A separate file-creation failure test also failed: actual `untitled-script.md`, expected `untitled-script-2.md`. After the fallback guard and checked-name change, all three tests pass.

The fixture runs the actual app functions against controlled IndexedDB events and uses the real document naming functions. It covers open and mid-cursor failure, transaction setup failure, abort-only failure, abort after cursor exhaustion, recovery through the same queue, retained links and lists without recent rows or browser files, case-insensitive reservation and null tombstones. It does not claim a full browser UI test.

The notice regression also failed first with no openProblem call, then passed after the existing notice was used. Native headless Chrome on the local Worker reproduced that missing feedback before the correction, then showed "Couldn't open a new script" afterward, with no horizontal overflow at 1440 and 390 pixels in either theme. A native IndexedDB-only list reserved untitled-script.md through the failed open; restoring database access and retrying created untitled-script-2.md through -5.md in four runs. The old list remained "# Old shots" and each new script had no inherited list.

## Retained fallback policies

- Script listing still returns its existing empty or partial results on storage failure. No missing-file or deletion claim is introduced.
- Incomplete browser-directory walks still keep moved-copy reservations; browser copy cleanup is unchanged.
- Recent-history display may still degrade to browser inventory; strict recent-history updates and their queue are unchanged from TOOLS-435.
- Optional-storage reads and writes elsewhere retain their existing behavior. New script still falls back to an unsaved script after file-creation failure, once its name is checked, or in a browser without browser saving.
- Saving existing words still succeeds when a title-following rename cannot run. Drafts, links, kept lists and B-roll queue ordering stay intact.
- Saving a script without a file reports a failed name lookup through its existing "Not saved" state; it never creates a browser file under an unchecked name.

## Done

Done when 1: met — injected open, mid-cursor, transaction, abort-only and post-cursor abort failures into the actual naming path; none approved a name. A healthy retry chose orphan-2.md and only-list-2.md while retaining the original link and list.

Done when 2: met — the regression first selected orphan.md on failed discovery; the fallback regressions first opened an unchecked name. All three now pass through kit specs.

Feature list: updated with the existing notices used on failed naming. Before/after screenshots cover light and dark at 1440 and 390 pixels in .scratch/tools436-{before,after}-{light,dark}-{1440,390}.png. The project has no scripted UX checks or runner guide, as documented in its kitchen extras; kit ux is still run and its result reported.

`kit ux --ticket docs/build/tools-436-broll-names.md` could not run: `RESULT: fail ux ENOENT` for the missing `docs/agents/features.md`. The project has its human feature list at `docs/features.md`, but no kit UX feature map or shots command. No passing automated UX review is claimed. The kit's documented missing-map policy marks the PR UX check skipped; browser evidence above supplies the requested notice checks.

### Follow-ups

- Validation gaps (gap, second look): Add a Ctrl/Cmd+S test where `browser.name` rejects. Check that no file is created, the script stays unsaved, “Not saved” appears, saving finishes, and a healthy retry succeeds. Current tests stop at the naming boundary.

## Review findings

- R1-1 (P3): fixed. Added source links and clarified that the card has two acceptance items.
- R1-2 (P3): fixed. Documented Ctrl/Cmd+S without a file and its existing failure state.
- R1-3 (P2), R1-7 (test gap): fixed. The failed-open notice is reused; its regression failed before the correction and now passes.
- R1-4, R1-5 (test gaps): fixed. The naming regression also runs the actual followTitle and openScript failure paths and asserts that no file is renamed, created or loaded and that the name and stored B-roll stay intact.
- Declined: R1-6 (test gap). The saving module is unchanged and already catches a rejected browser.name before browser.create. This task tests the actual naming boundary's rejection; additional saving-module coverage is optional and would duplicate its existing error-handling contract.

Lead: close TOOLS-436 (Done, with a dated note naming the PR and its merge SHA).
