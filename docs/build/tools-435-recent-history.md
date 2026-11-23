# TOOLS-435 — Keep recent-file history on storage failure

Lex (2026-11-23): fix hidden recent-history failures F1 and F4 from the TOOLS-429 investigation on dev. Preserve the existing optional-storage and browser-inventory fallbacks. Do not release or deploy.

## Change

Optional IndexedDB writes now return whether the transaction completed. They use the existing transaction writer, which handles completion, error and abort. Recent-history updates reject failed writes before advancing the remembered handle or removing background state.

Updates read recent history strictly, including the legacy last-file record. A failed read never reaches the change callback or a write. Display-only reads retain their existing fallback. Each caller receives its own operation result; an internal recovered queue lets the following operation run. Opening and saving a script still tolerate optional history failures. Failed remove actions retain their row, and a failed browser deletion leaves its background state and file available for retry.

The script-saving, draft and collaborative-editing modules are unchanged. Existing B-roll and browser-directory fallback policies remain unchanged.

## Evidence

- Before F1: `kit specs tests/recent-history.test.mjs` failed because a failed write fulfilled instead of rejecting. The same test covers write error, abort-only, synchronous put failure and database-open failure, then successful recovery.
- Before F4: the focused suite failed because a failed recent-history read fulfilled instead of rejecting. The test also covers the legacy last-file read and verifies that a healthy retry retains the old row.
- Before deletion protection: the focused suite failed because a failed history removal marked the retained browser script gone. The regression now verifies that its file, keys and background state remain available until a successful retry.
- The focused suite passes all seven tests. Compatibility checks cover genuinely empty history, newest-first ordering, the 20-entry cap, deduplication, removal, a thrown change callback and display-only fallback.
- An isolated native Chrome check exercised the actual IndexedDB helpers: `completion=true error=false abort=false retained=old retry=true`. It injected a duplicate-key transaction error and an explicit abort after a successful put request. Its temporary browser profile and tab were closed and removed.

Done when 1: met — The write-failure regression failed first, then passed for transaction error, abort-only, synchronous put failure and open failure. Native Chrome confirmed successful completion, rollback on error and abort, and a healthy retry. The caller receives rejection; the remembered handle and background cleanup advance only after persistence.

Done when 2: met — The failed-read regression failed first, then passed for both recent and legacy last-file reads. The change callback never runs on a failed read; after recovery the old row is still present and the next update prepends without replacing it.

Done when 3: met — All seven focused regressions and the complete 638-test suite pass, including queue recovery, ordering, cap, removal and retained background state. Script-content saving, recovery drafts and collaborative-editing modules are unchanged.

## Done

Feature list: no change (storage bookkeeping and failure propagation only; no new control, notice, copy, layout or presentation policy).

UX and screenshots: not applicable; there is no visible notice or new interface. Existing fallback presentation remains unchanged.

Agent Kit doctor passed all 13 checks. This project has no `docs/agents/runner.md`; `docs/agents/kitchen-extras.md` documents that omission and supplies its workflow.

Lead: close TOOLS-435 (Done, with a dated note naming the PR and its merge SHA).
