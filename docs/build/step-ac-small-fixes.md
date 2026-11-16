# Step AC: small fixes from the review

Lex (2026-11-16, Orbit TOOLS-315, pick 5 of the TOOLS-296 review): the review's small fixes and low bugs that steps Y to AB did not already fix, in Lex's order; the flaky "New script" step of the B-roll browser check (TOOLS-309); and two follow-ups from step AA if cheap. Bug fixes and work behind the scenes: no prototype. One change shows on screen (a browser copy left behind no longer shows in the switcher).

## What it does

- **TOOLS-309, the flaky browser check.** `smoke-broll-lazy.mjs`'s "another new script" step (1280 px, after a refused module load) timed out now and then, on live with an older browser profile and in some full runs. Reproduced on live with a copy of the saved older profile: the script menu draws its list a frame after it opens (17-18 ms), which moves "Open a script…" and "New script" down a row; the check found "New script" in the frame before and its press landed on "Open a script…" (the menu closed and no new script came). One frame is too soon for a person to act on, so this is the check's own problem, not the editor's. The check now waits for this open's list (the open script is the current row, and "New script" stays put for two frames) and presses 150 ms after finding the spot, as a slow machine would, so it fails every run without the wait. The other suites already click those items with a script click after waiting (`smoke-saving`, `smoke-rare-parts`).
- **A browser copy that can't be deleted after Save as** (review bug, step AA follow-up). When a browser script moves to a file and the browser refuses to delete its copy, the copy's name is kept in local storage (`script-editor:movedCopies`): the switcher leaves it out, no script takes its name while it is there (also with the moved file taken off the switcher; review round 1, P2: before, a new script could take the name and the next listing deleted it), and the next listing (the start screen, or opening the switcher) deletes it. Before, the failure was ignored and the copy stayed in the switcher with the Browser tag.
- **A waiting Ctrl+S without a file** (step AA follow-up). The demo's Ctrl+S made while its Save as wrote waited with no file of its own; when another script without a file opened before the write ended, it ran on that script, saving it into the browser and renaming it. Now, when another script opens, a waiting click without a file becomes its own script's draft (its words come back as "Unsaved changes" when that script is opened again).
- **Facts written once for the Worker and the tab.** The agent token's eight hours and the "No asks yet" answer are in `public/agent-link.js` (new, 469 bytes), which `app.js` and `worker/mcp.js` import; the Worker takes the room id and key patterns from `public/together/link.js` and the room protocol from `public/together/room.js`, as it already did for the room's keep time.
- **One HTML escape.** `escHtml` lives in `doc.js`; `app.js` and `broll.js` use it instead of their own copies (a missing value now escapes to nothing, never "null").
- **No dead code.** `applyBrollChanges`, used only by tests, is gone; the tests use `applyBrollChangesReport(...).markdown` as the app does.
- **A cap on the MCP request body** (review, info). `/mcp` refuses a body bigger than the largest allowed call (a whole script in `set_script`, every character spelled as `\uXXXX`, plus 64 KB: 1,265,536 bytes) with 413 before reading it in full, by its stated length or while it streams. `readUpTo` moved to `mcp.js`, so the picture upload and MCP read bodies the same way.
- **Module names.** The app's modules import each other as `Doc`, `Changes`, `Links`, `Cues`, `Broll` and `SaveQueue` instead of `D`, `C`, `L`, `K`, `B` and `Q` (`app.js`, `changes.js`, `together-adapter.js`, `broll-app.js`, `saving.js`).
- **History comments.** The examples the review named in `cues.js` and `press.js` now say what the code does instead of how it was first built.
- Sizes: the files the page needs before it runs went from 15 files and 429,605 bytes to 16 files and 432,169 bytes (+2,564: `agent-link.js`, the longer module names, the browser-copy code).

## Declined

- Comments with dated choices (`Lex, 2026-…`, step names): kept. `AGENTS.md` makes Lex's dated choices the reference, and the comments point to them; only the review's named history examples changed.
- `sketchSvg` in `broll-app.js` and `sketchHtml` in `broll.js`: not one helper. The frames take sketches that were cleaned when they came in and are not draggable; `sketchHtml` cleans again for the storyboard file. One helper would clean every frame on every draw.
- The two SHA-256 functions: the tab's is synchronous on purpose (the host handles room messages in order); the Worker uses the platform's `crypto.subtle`.
- The one-at-a-time queues written three ways, and the text-node walks in `app.js` and `together/carets.js`: each guards different state; making them one is a refactor, not a small fix.
- `isBrollAnswer` "inlined" in `together-adapter.js`: those checks are a different rule (selection asks that are not B-roll, whatever their status).
- The same limit checked in the Worker and the tab (sketch length): the review calls it defence in depth; both read the same constant from `broll.js`.
- The silent `.catch` on the recent list's queue (`updateRecent`): it keeps the queue going; a refused write leaves the switcher without that entry, as with storage turned off, which the editor treats as normal and shows nowhere.
- Old picture files left in `pictures/` after shots are removed: Lex chose to keep them (2026-11-16, saving try-out "old pictures kept").
- The agent token in local storage: the Content-Security-Policy of step Y is the review's suggested answer; it is live.

## Where

`public/app.js`, `public/saving.js`, `public/agent-link.js` (new), `public/doc.js`, `public/broll.js`, `public/broll-app.js`, `public/changes.js`, `public/together-adapter.js`, `public/cues.js`, `public/press.js`, `worker/mcp.js`, `worker/index.js`, `worker/room.js`. Tests: `tests/review-fixes.test.mjs` (new), `tests/saving.test.mjs`, `tests/mcp.test.mjs`, `tests/broll.test.mjs`. Browser checks: `scripts/smoke-broll-lazy.mjs`, `scripts/smoke-saving.mjs` (`runMoveCopyStays`).

## Browser check

All suites on `wrangler dev` and headless Chrome 157: `smoke-csp` 51 ok, `smoke-saving` 76 ok, `smoke-broll-lazy` 91 ok, `smoke-rare-parts` 122 ok, `smoke-video-folder` 93 ok, `smoke-keep-all` 933 ok, `smoke-room` 27 ok, `smoke-relay` 42 ok, 0 FAIL. `smoke-broll-lazy` also on live with the older profile: 91 ok. Evidence: `docs/agents/evidence/tools-315-browser.txt`.

## Done

Feature list: one line under Files (a browser copy left behind after a move to a file is kept off the switcher and deleted later).

### Proof

- TOOLS-309, reproduce and fix or make the check robust: met. Reproduced on live with a copy of the older profile (3 FAIL, the release run's signature: menu closed, `fail-check.md` still open); measured New script moving down a row 17-18 ms after the menu opens (3 of 3 runs). Test-only: the check now waits for the drawn list. Failing first: with the press 150 ms late and no wait, 12 FAIL at both widths on every run (40e9342); with the wait, 91 ok locally and 91 ok on live with the older profile.
- A failed delete of the browser copy after Save as is no longer ignored: met. `smoke-saving` `runMoveCopyStays` failed first (the switcher listed `stuck-copy.md` twice, once with the Browser tag; the copy never went) and passes now: listed once as a file, deleted on the next visit. Review round 1 (P2) added: with the file taken off the switcher, a new script titled the same took `stuck-copy.md` and the next visit deleted it (2 FAIL on f63bb91's app); now it gets `stuck-copy-2.md` and keeps it.
- A pending Ctrl+S on the demo during a Save as write can't save and rename another script: met. The new test in `tests/saving.test.mjs` failed first ("the other script is not saved into the browser") and passes now; the demo's newer words are its draft.
- The review's small fixes, each with a failing test first: met. `tests/review-fixes.test.mjs` failed first for each (facts written twice; a second HTML escape and `applyBrollChanges`; one-letter module names) and passes now; the MCP body cap test in `tests/mcp.test.mjs` failed first (a 1.3 MB body reached parsing; a streamed one was read in full) and passes now; review round 1 added a stated length over the cap, refused with the body unread. The comment edits have no test.
- All unit and browser checks green, incl. smoke-csp, smoke-saving, smoke-broll-lazy, smoke-rare-parts: met (above; `kit specs` for the unit tests).
