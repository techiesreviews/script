# Step N: the shared kitchen, and tidying after the retro

Lex (2026-10-30): after the retro he approved six changes. Each is its own commit; none changes what the editor does for the person writing a script.

## 1. The shared kitchen

The project ran an old copy of Agent Kit, so it lacked the kitchen's commands (`kit bg`, `kit ux`, `kit pr`, `kit status`, the hooks, …). It now runs the shared kit (github.com/techiesreviews/agent-kit) through the launcher `scripts/agents/kit`, written by `kit init` from the machine copy, with the settings in `scripts/agents/kit.json`:

- Branches: land, release and CI are `main` (no dev branch; GitHub repo `techiesreviews/script`). Replaced on 2026-10-31 by `step-o-land-on-dev.md`: changes land on `dev`, and `main` only takes `dev`.
- Checks: `node --test tests/*.test.mjs`; `kit doctor` also checks the Claude CLI and runs `node --check` on every JavaScript file.
- Own commands in `scripts/agents/project.d`: `kit specs` (the unit tests, evidence in `docs/agents/evidence/specs.txt`) and `kit deploy` (wrangler, https://script.techies.tools and the workers.dev fallback), as before.
- Review pins stay Claude `claude-opus-5-5`, medium (the kit's defaults, repeated in the extras).
- The rulebook extras `docs/agents/kitchen-extras.md`: `main` only, Lex's standing OK to push and `kit deploy` after `kit specs` and `kit review`. First written as "no PR flow unless Lex asks"; the lead changed it the same day, because the kitchen's guard will block a raw `git push` to the landing branch: a change lands in `main` through `kit pr`. The repo has no GitHub CI, and `kit pr` needs none (it runs the tests here and lands after the review). `featureList` is `docs/features.md` and `paths.visible` is `public/`. The `main`-only landing was replaced on 2026-10-31 by `step-o-land-on-dev.md`.
- The forked kit files are gone (`kit-lib.*`, `kit.d/`, `agent-run.mjs`, `sol-run.mjs`, `review-*.mjs`, `ci-summary.mjs`, `project-kit.mjs`); `docs/agents/agent-scripts.md` describes the new kit.

## 2. A flaky test

`tests/room.test.mjs` "together: a catch-up waits while an input method composes" sometimes took about 6 s instead of about 12 ms: it fell back to a timeout.

Cause: the test closes the guest's connection and polls every 5 ms for "away", but the guest reconnects after its own 5 ms backoff (± 25%). When the reconnect won, the guest was already back and live; the wait for "away" and then the wait for the queued catch-up each ran to their 3 s timeout, and since neither result was checked the test still passed. The same race made "a guest whose connection drops keeps what it typed" and "typing while the host is away" take 3 s now and then.

Fix: `holdAway(client)` keeps a dropped client away and `comeBack(client)` reconnects it at the step the test chooses; the three tests use them and now check their waits, so a timeout fails instead of passing slowly.

## 3. Evidence without timings

`docs/agents/evidence/specs.txt` was rewritten with every test's time on every run (diffs of about 500 lines, and merge conflicts between builders working at once). It is now written without times or durations, so it changes only when a result changes. `scripts/agents/project.d/specs` drops the `(12.3ms)` after each test and the `duration_ms` line from the file; the screen output keeps them. Two runs in a row give the same file.

## 4. A short AGENTS.md

The first paragraph of `AGENTS.md`, a growing list of what the editor does, is loaded into every agent's context. It moves to `docs/features.md`; `AGENTS.md` keeps a two-line description, the owner line, the Rules and pointers, and loses no rule. The paragraph is split into short items by topic, word for word; its dated decisions of Lex's (no "Saved" time, the Export and Share buttons, 2026-10-29) stay with the features they decide, and `AGENTS.md` says they stand until he changes them. The rulebook extras name `docs/features.md` as the feature list.

## 5. The old 43-character agent tokens

`docs/build/handoff.md` said: after 2026-10-30 12:00 UTC remove the legacy 43-character token branch (`LEGACY_UNTIL` in `worker/mcp.js`, its use in `worker/relay.js`, and its tests). The date has passed (checked 2026-10-30 20:52 UTC), and the tab drops any saved token older than 8 hours before it connects, so no 43-character token can still be in use. Removed: `LEGACY_UNTIL` and the 43-character form in `worker/mcp.js` (`TOKEN_RE` is the `se2-` form only, so such a token is malformed: 401 from `/api/relay` and `/mcp`); in `worker/relay.js` a note without `expiresAt` is due 8 hours after its `createdAt`, and a tab or call without a birth time is refused; `worker/index.js` always passes the birth time. The legacy tests are replaced by tests for these. `handoff.md` and `docs/data-shape.md` say so. From now on a dated to-do in the docs is a line `Due YYYY-MM-DD: <what>`, so the kitchen's doctor can list overdue ones.

## 6. One press helper

Three review findings were about presses that did not end cleanly (a swipe that became a scroll, a mouse release lost outside the window, the window losing focus). `public/press.js` tracks one press and ends it on `pointerup`, `pointercancel`, a move with no button held (mouse and pen), the window's `blur` and the tab hidden, with a move threshold and an optional touch hold-to-lift. The B-roll shot drag in `public/app.js` uses it, with no change in behaviour: `startPress` with `threshold: 5`, `touchSlop: 10`, `hold: HOLD_MS` (400 ms, now exported by `press.js`); `onEnd` drops the shot on `drop` and puts it back on every other end; `endDrag()` ends the press (`stop`), which Escape, a re-render without the shot and the other callers use as before. Its own `pointermove`, `pointerup`, `pointercancel`, `blur` and `visibilitychange` listeners are gone. The drag's `requestAnimationFrame` calls (the frame following the pointer, the edge scroll, the scroll under a still pointer) carry `// motion-exception: <reason>`, for the kitchen's motion check. Unit tests use fake events, targets and a fake clock (`tests/press.test.mjs`).

Browser check: headless Chrome with `--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2`, real CDP input: a mouse drag with the button held, a touch hold-then-drag at 390 px, a lost release. Server and Chrome run under `scripts/agents/kit bg` and stop with `kit bg --stop`. Evidence: `docs/agents/evidence/step-n-browser.txt`.

## Done (2026-10-30)

- Commits on `t3/migrate-shared-kit`, one per item (1 and its follow-up 1b, 2, 3, 4, 5, 6).
- `scripts/agents/kit doctor` and `scripts/agents/kit specs` end `RESULT: ok` through the new launcher; `kit review --help`, `kit bg --help` and `kit pr --dry-run` work.
- Browser check: `docs/agents/evidence/step-n-browser.txt` (the same results before and after item 6).
- Feature list: no change (nothing the person sees changed; the drag behaves as before)
