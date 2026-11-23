# Script editor: behaviour-preserving cleanup (TOOLS-414)

Lex (2026-11-23): clean up code changed since 15 November and rank deeper architecture ideas without building them.

## Goal

Remove redundant indirection and narrated comments while preserving editor behaviour.

## Done when

1. One PR into dev removes AI-style clutter with no change to what the editor does; all tests pass.
2. A short report ranks deeper architecture ideas for Lex to choose; none is implemented.

## Changes

- Call `Cues.marksRange` directly instead of forwarding through `marksMoved`.
- Use `draftKey` directly instead of a second local name.
- Shorten repeated file summaries and remove narrated comments in recently changed modules. Keep ownership, failure, ordering, cross-tab and lazy-loading constraints documented, with the existing section dividers and ticket references.
- Keep every catch, fallback, lock, queue, validation and test assertion unchanged. There is no new behaviour or bug fix, so no new test or failing-test claim.

## Architecture ideas

The read-only report is `.scratch/tools-414-architecture-ideas.md` in the worktree. It ranks five ideas, with source locations and the deletion test. No glossary or ADR files were found. None of these ideas is implemented:

1. Browser storage module: concentrate repeated IndexedDB knowledge while preserving strict and best-effort errors. Medium effort, medium risk. Recommended first.
2. Script lifetime ownership: concentrate switching, aside records, queued save completion and draft handoff. Large effort, high risk.
3. B-roll host interface: reduce exposed editor internals and concentrate loading/writing state while preserving lazy loading. Large effort, high risk.
4. Browser-check transport module: share repeated Chrome request, timeout and cleanup code across smoke scripts. Medium effort, low product risk.
5. Ask-anchor updates: concentrate shared split/retype and cancellation rules for open and aside scripts. Medium effort, medium risk.

## Validation

- Baseline: `kit specs`, 603 tests passed before editing.
- `kit unit --affected`: 153 tests passed across five files.
- Compared the export pack against `origin/dev`: identical export names and seam version, with byte-identical ZIP output for empty and UTF-8 multi-file input. The `zipAll` wrapper stays because it limits the forwarded arguments.
- Full `kit specs` and independent reviews run before landing; their evidence is recorded with the PR.
- No browser check or `kit ux`: the cleanup adds no visible change. No feature-list edit is needed.

## Done

Feature list: no change (internal indirection and comments only; editor controls, words, state and behaviour are unchanged)
