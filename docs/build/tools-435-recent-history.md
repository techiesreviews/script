# TOOLS-435 — Keep recent-file history on storage failure

Lex (2026-11-23): fix hidden recent-history failures F1 and F4 from the TOOLS-429 investigation on dev. Preserve the existing optional-storage and browser-inventory fallbacks. Do not release or deploy.

Source: [TOOLS-435](https://board.techies.review/tasks/01a2098d-bab0-77ee-98cb-81b866238a03?workspace=01a1b0d3-5786-7701-98e9-ddb7285afe5a), supplied launch brief; [TOOLS-429 findings F1 and F4](/home/ubulex/Projects/fleet/inbox/script-editor-TOOLS-429-risk-check-2026-11-23.md).

## Acceptance contract

Goal: a failed browser-storage write or read never wipes or silently loses the recent-files list.

1. Every write settles on success, error and abort; callers see the failure.
2. A failed history read does not overwrite the stored list.
3. Tests reproduce both failures and pass; script content handling unchanged.

## Change

Optional IndexedDB writes now return whether the transaction completed. They use the existing transaction writer, which handles completion, error and abort. Recent-history updates reject failed writes before advancing the remembered handle or removing background state.

Updates read recent history strictly, including the legacy last-file record. A failed read never reaches the change callback or a write. Display-only reads retain their existing fallback. Each caller receives its own operation result; an internal recovered queue lets the following operation run. Opening and saving a script still tolerate optional history failures. Failed disk-file list removals retain their row. Explicit browser deletion and Save as cleanup retain their original behavior when optional history is unavailable.

The script-saving, draft and collaborative-editing modules are unchanged. Existing B-roll and browser-directory fallback policies remain unchanged.

## Evidence

- Before F1: `kit specs tests/recent-history.test.mjs` failed because a failed write fulfilled instead of rejecting. The same test covers write error, abort-only, synchronous put failure and database-open failure, then successful recovery.
- Before F4: the focused suite failed because a failed recent-history read fulfilled instead of rejecting. The test also covers the legacy last-file read and verifies that a healthy retry retains the old row.
- Review regression tests first failed for browser deletion and Save as cleanup when history failed. Both now pass: explicit deletion and cleanup continue independently of optional history, preserving the original fallback policy.
- The focused suite passes all eight tests. Compatibility checks cover genuinely empty history, newest-first ordering, the 20-entry cap, deduplication, removal, a thrown change callback and display-only fallback. Database-open failure is covered separately before the read and when the writer opens its connection after a successful read.
- An isolated native Chrome check exercised the actual IndexedDB helpers: `completion=true error=false abort=false retained=old retry=true`. It injected a duplicate-key transaction error and an explicit abort after a successful put request. Its temporary browser profile and tab were closed and removed.

Done when 1: met — The write-failure regression failed first, then passed for transaction error, abort-only, synchronous put failure and open failure. Native Chrome confirmed successful completion, rollback on error and abort, and a healthy retry. The caller receives rejection; the remembered handle and background cleanup advance only after persistence.

Done when 2: met — The failed-read regression failed first, then passed for both recent and legacy last-file reads. The change callback never runs on a failed read; after recovery the old row is still present and the next update prepends without replacing it.

Done when 3: met — All eight focused regressions and the complete 639-test suite pass, including queue recovery, ordering, cap, removal and retained background state. Script-content saving, recovery drafts and collaborative-editing modules are unchanged; explicit browser deletion and Save as cleanup retain their original fallback.

## Review findings

- R1-1 (P2), R1-2 (P2): fixed. Save as cleanup and explicit browser deletion tolerate a failed optional-history update. Both regressions failed before the correction and pass afterward.
- R1-3 (P3): fixed. The acceptance contract and source links are recorded above.
- R1-4 (P3), R1-7 (test gap): fixed. The write-failure test now also allows the history read and fails only the writer's subsequent database open.
- R1-5 (P3): fixed. The transaction writer's comment no longer compares it with its optional wrapper.
- R1-6 (test gap): fixed. The actual `placed` callback runs in the regression harness and cleanup is checked after a failed history write.
- Declined: R1-8 (test gap). Browser rename already uses the same tested history queue; `createSaving` catches its `written` callback's rejection, preserving the saved words. This task changes neither that callback boundary nor script saving. Additional rename integration coverage is outside this focused history repair.

## Done

Feature list: no change (storage bookkeeping and failure propagation only; no new control, notice, copy, layout or presentation policy)

UX and screenshots: not applicable; there is no visible notice or new interface. Existing fallback presentation remains unchanged.

Agent Kit doctor passed all 13 checks. This project has no `docs/agents/runner.md`; `docs/agents/kitchen-extras.md` documents that omission and supplies its workflow.

Lead: close TOOLS-435 (Done, with a dated note naming the PR and its merge SHA).

### Follow-ups

- Validation gaps (gap): R1-8 still open: The author declined it, and their reasoning holds up. In `followTitle`, the `updateRecent` call that can now reject is the last statement (`public/app.js:3199`). `saving.js:382` catches that rejection, so the saved words, the new name and the moved keys all stay. The only visible effect is that the…
- Standards (P3): f166d60:public/app.js:2826 — P3 style: The new comment replaced the old one, "a copy that can't be looked at now stays a browser script". The old comment explained the outer `.catch(() => {})` on `copies.afterMove`, and nothing explains it now. The new comment is also worded unlike the code around it ("existing cleanup policy"). Fix: keep both reasons, for example: `// history is optional: a failed forget doesn't stop the cleanup; a copy that can't be looked at now stays a browser script`.
- Validation gaps (gap): Browser rename when the history write fails (R1-8, optional). In `tests/recent-history.test.mjs`, load `followTitle` with stubs for `state`, `nameTaken`, `copies.rename`, `moveKeys`, `holdOpen` and `renderTop`. Set `f.fail.write = "error"`, then check three things: the returned promise rejects with "Recent history could not be kept"; `state.name` is the new name; `f.stored.get("recent")` still holds the old browser row. Together with the existing `saving.js:382` catch, this shows the rename stays harmless.
- Validation gaps (gap): Explicit deletion when the history write fails. The deletion test only sets `f.fail.read = "recent"`, so `forget` fails at the read and never reaches the write. Add a second pass of the same test with `f.fail.write = "error"`, asserting the same four outcomes: `kept.gone`, `deleted`, `keysDropped` and `deleting.length === 0`.

