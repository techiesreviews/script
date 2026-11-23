# TOOLS-436: keep B-roll names reserved when lookup fails

Lex (2026-11-23): fix hidden failures first, starting with F2 in the TOOLS-429 risk report. Land on dev only.

## Change

Naming a new or renamed browser script needs a complete B-roll reservation inventory. Previously a failed IndexedDB open returned an empty inventory, and a failed cursor returned only the names reached so far. Both allowed a new script to take a name belonging to an old link or kept list.

Discovery now rejects on open, transaction, cursor or abort failure, and returns names only after the read transaction completes. The existing B-roll queue isolates a failed turn so a healthy retry can name safely. A title-following rename keeps the old name when discovery fails; the save of the script's words still succeeds. The agent's open request reports the failed lookup through its existing error handler. New script leaves the current script open when reservations are unknown. If file creation fails after a successful lookup, its existing unsaved fallback uses the checked name.

No storage record is changed by discovery. Cleared null records still release their names; retained links and IndexedDB-only lists reserve names regardless of capitals. No notice, layout, script text, draft handling or collaborative editing changes are added.

## Tests first

`ASE_OWNER=fleet-lead scripts/agents/kit specs tests/broll-names.test.mjs` initially failed with `open: unknown reservations must stop naming`: actual `orphan.md`, expected `rejected`.

After making discovery strict, the New script regression failed because it opened the unchecked `untitled-script.md` fallback. A separate file-creation failure test also failed: actual `untitled-script.md`, expected `untitled-script-2.md`. After the fallback guard and checked-name change, all three tests pass.

The fixture runs the actual app functions against controlled IndexedDB events and uses the real document naming functions. It covers open and mid-cursor failure, transaction setup failure, abort-only failure, abort after cursor exhaustion, recovery through the same queue, retained links and lists without recent rows or browser files, case-insensitive reservation and null tombstones. It does not claim a full browser UI test.

## Retained fallback policies

- Script listing still returns its existing empty or partial results on storage failure. No missing-file or deletion claim is introduced.
- Incomplete browser-directory walks still keep moved-copy reservations; browser copy cleanup is unchanged.
- Recent-history display may still degrade to browser inventory; strict recent-history updates and their queue are unchanged from TOOLS-435.
- Optional-storage reads and writes elsewhere retain their existing behavior. New script still falls back to an unsaved script after file-creation failure, once its name is checked, or in a browser without browser saving.
- Saving existing words still succeeds when a title-following rename cannot run. Drafts, links, kept lists and B-roll queue ordering stay intact.

## Done

Done when 1: met — injected open, mid-cursor, transaction, abort-only and post-cursor abort failures into the actual naming path; none approved a name. A healthy retry chose orphan-2.md and only-list-2.md while retaining the original link and list.

Done when 2: met — the regression first selected orphan.md on failed discovery; the fallback regressions first opened an unchecked name. All three now pass through kit specs.

Feature list: no change (existing name reservation invariant is restored; no new control, notice or layout).

No new visible notice: screenshots and kit ux are not needed; use kit pr --not-visible with the naming-safety reason. The project has no scripted UX checks or runner guide, as documented in its kitchen extras.

Lead: close TOOLS-436 (Done, with a dated note naming the PR and its merge SHA).
