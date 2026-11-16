# Step AA: saving in one module (TOOLS-308)

Lex (2026-11-15): pick 3 of the script editor review (TOOLS-296, report `script-editor-architecture-review-2026-11-15.html`, item 4 "Deepen the script-file module"): first tests for every way a script is saved, as it works today; then saving moves into one module with a small interface, and the same tests keep passing. Nothing on screen changes. Saving goes live only after Lex has clicked through it.

## What

1. **Characterization first.** `scripts/smoke-saving.mjs` drives the real editor in headless Chrome and checks every saving path as it works on `dev` before the move: a new script saved in the browser at once and named after its title, auto-save after about 1.5 s, Ctrl+S at once, a new script left untouched is not kept, reopening after a reload, the demo's draft with "Unsaved changes from …", Restore and Discard, Ctrl+S on the demo into the browser, a file from the computer auto-saved, "The file changed on disk at …" with "Save mine" and "Open that version", "Allow saving to …" and a refused Ctrl+S, Export → "Markdown file (.md)" moving a browser script to a file, the prompter link and Save to video folder carrying the saved script, switching scripts while a save runs (every save goes to the script it was made for), a failed write on a script the person left kept as unsaved changes, a B-roll link that stays with its own script when another script is saved under a new name during its link lookup, two tabs on one file, and Share to edit (the guest's words reach the host's file; the guest's browser keeps nothing).
2. **One module.** Saving moves out of `public/app.js` into `public/saving.js`. `createSaving({ script, editor, files, browser, drafts, clock, on })` gets the file system, local storage and the clock passed in (saving makes no network calls: the prompter link is made in the tab) and answers with `save`, `schedule`, `flush`, `stop`, `saveAs`, `saveMine`, `allow`, `open`, `queued` and `drafts`; what the person sees follows through `on`. Every save carries its own handle, name and text, so its write lands in the file it was made for even after another script opened, and its result changes the open script's record only while that script is still open. `save-queue.js` stays the module's pure queue. The browser's own file helpers (`writeHandle`, `permitted`) move along; `app.js` still hands them to the B-roll part.

## Where

`public/saving.js` (new), `public/app.js` (the save code is gone; it creates the module and calls it). Tests: `tests/saving.test.mjs` (the interface with a folder in memory, a clock the test moves and local storage in a Map: auto-save timing, saves that cross a script switch, a failed write on a left script kept as a draft, changed on disk and Save mine, Allow saving, saving into the browser and a switch meanwhile, Save as, drafts by name; and that `app.js` holds no save code). Browser check: `scripts/smoke-saving.mjs`.

## Browser check

`scripts/smoke-saving.mjs` on `wrangler dev` (it applies `_headers`) and headless Chrome, 1280 px, real typing and clicks; files on the computer are a folder in the browser's private file system that the stubbed pickers hand out. It passed on `dev` before the move (70 checks, twice) and passes unchanged after it. The older suites (`smoke-csp`, `smoke-video-folder`, `smoke-broll-lazy`, `smoke-keep-all`, `smoke-room`, `smoke-relay`) pass on the same server. Evidence: `docs/agents/evidence/tools-308-browser.txt`.

## Done

Feature list: no change (saving moved into one module; nothing on screen changes)

### Proof

- Characterization tests for every saving path, passing on `dev` first: met. `node scripts/smoke-saving.mjs` on `origin/dev` 4e2bb84 printed 70 `ok` and `ok all`, twice (evidence, step 1).
- One saving module with the storage, clock and file system passed in; `app.js` only calls it: met. `tests/saving.test.mjs` failed first (`Cannot find module public/saving.js`), now 10 of 10 pass; its first test fails if `app.js` holds save code or the save queue again.
- The step-1 tests keep passing unchanged: met. The same `smoke-saving.mjs` after the move: 70 `ok`, `ok all`.
- A save always goes to the script it was made for: met. Browser: alpha.md's write held 900 ms, more typing, a switch to bravo.md and Ctrl+S there; alpha.md gets all of Alpha's words, bravo.md only Bravo's, and no write ever carried the other script's text. Before the test helper waited for the switcher's fresh rows, a stale row made the switch a no-op and the check caught Bravo's words in alpha.md (`FAIL switch: no write ever went to the other script's file`), so the check does see a crossed save. Unit: the same with a held write in memory, and the open script's record follows only its own write. B-roll: with the demo's list loaded and the next script's link lookup held, a save under a new name gets no list (`B-roll link: the saved script does not take the demo's list`).
- Strict CSP green: met. `smoke-csp` 51 `ok`, `ok all`, no violation; `smoke-saving` checks for none on every page too.
- All unit and browser checks green: met. `kit specs` 458 pass; the six older browser suites pass.

### Declined

- Report bug (low, `app.js` Save as): a failed delete of the browser copy after "Markdown file (.md)" is still ignored, so that copy can stay in the switcher with the Browser tag. The only fix is to try the delete again later with no clear moment to do it, and the private file system refusing a delete of its own file is rare; left as it was so nothing changes in this move.
- Report bug (low, `video-folder.js`): saving again to the same video folder after shots were removed leaves their old pictures in `pictures/`. Fixing it means deleting files in a folder the person owns, which may hold pictures they put there; that is Lex's choice, asked through the lead.
