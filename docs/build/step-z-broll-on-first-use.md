# Step Z: the B-roll part loads on first use

Lex (2026-11-16, Orbit TOOLS-306, pick 2 of the TOOLS-296 review): the B-roll part becomes one module that loads the first time a script needs it, so opening a script without B-roll downloads none of it; the rest of the app talks to it through a small interface. B-roll and saving wait for his click-through before they go live. Nothing on screen changes.

## What it does

- `public/broll-app.js` is the B-roll part: the list linked to the script and its state, the frames beside the lines and the covered-line rule, the storyboard, the shot card, dragging a shot to other lines, the agent's B-roll suggestions with Keep and Undo, sketch asks, the agent's pictures (upload, shrink, put in at once), Keep all and Undo all for pictures, and the agent's B-roll tools (`upload_image`, `sketch_shot`, `answer_broll`). It was about 1,450 lines of `public/app.js`, moved as they were into `createBroll(host)`.
- `app.js` loads it with `import()` (and, through it, `public/broll.js`) when:
  - a script has a linked list (the demo links its own), or B-roll asks (a plan, sketches, or suggestions beside the lines, from a restored draft or a guest's copy);
  - the Storyboard opens;
  - the agent calls a B-roll tool, or a picture arrives;
  - the person types "add b-roll" in the selection bar or picks B-roll in the "/" menu.
- A B-roll call from the agent that waits for the module is for the script open when it came: if the person opened another script meanwhile, it changes nothing and the agent is told to call `get_script` and send it again. "add b-roll" and the "/" menu's B-roll open the card only if the same script is still open.
- The link found for a script is kept while the module is on its way, so saving the demo (or any linked script) under a new name in that moment takes its list along, as before; opening another script forgets it, so that script's save never takes the old one.
- Until then `app.js` answers for it: no list ("none"), or "loading" while the script's link is looked up, as before. The export items, the folder note, "add b-roll" in the selection bar and the list shared with guests follow it the same way.
- The interface (`createBroll` returns it, frozen): `status`, `link`, `shots`, `flags`, `setFlags`, `canAdd`, `load`, `close`, `render`, `renderMarks`, `renderView`, `rematch`, `touched`, `refreshSuggestions`, `dropGone`, `cleanSketches`, `cardOpen`, `openCard`, `positionCard`, `closeCard`, `endDrag`, `escape`, `requestSketches`, `requestPlan`, `answerBroll`, `sketch`, `agentTool`, `pictureHead`, `pictureBytes`, `exports`, `folder`, `roomShare`, `adoptRoom`. What it may use of the app is one object (`brollHost` in `app.js`).
- Helpers the startup needs moved from `broll.js` to `doc.js`, and `broll.js` passes them on: `spokenBlocks` and `normalize` (the "/" menu, bold, a guest's B-roll ask), `withoutPictures` (drafts and Share to edit), `askForAgent` and `forAgent` (what `wait_for_asks` and `get_script` give the agent). `together-adapter.js` uses them from `doc.js`; `video-folder.js` gets the B-roll helpers from the module with a linked list (`videoFolder({ …, broll })`) instead of importing `broll.js`.
- Sketches in asks are still cleaned where they come in (a restored draft, a guest's copy): by the module when it is there, and when it loads, it cleans the asks already there before it shows any of them. Only the module shows sketches.
- Cache and CSP (step Y): `broll-app.js` is a same-site module script, so `script-src 'self'` allows it, and the `/*` rule gives it `Cache-Control: no-cache` with an ETag like every file: after a reload it comes back as `304 Not Modified`. A tab opened before a release that loads the module after it could get a newer module than its `app.js`: both carry a seam version (`BROLL_SEAM` and `SEAM`); when they differ, or the module can't load, B-roll counts as unreadable (`error`: nothing is added or saved over it, the agent is told to ask the person to reload), and an open Storyboard says "Couldn't load the storyboard. Reload the page." Only a reload loads it again (browsers keep a failed module for the page's life). The "unreadable" state belongs to the script that needed the module: a script without B-roll opened afterwards counts as having no list, so its folder save works as before; "add b-roll" and B-roll in the "/" menu stay hidden until a reload.
- Sizes (the files the page needs before it runs, `index.html`'s module script and its static imports): before, 17 files and 598,692 bytes of JavaScript; now 15 files and 463,266 bytes (−135,426, −23 %). `broll-app.js` (88 KB) and `broll.js` (61 KB) come only on first use. `app.js` is 4,185 lines (was 5,552).

## Also

- `scripts/smoke-relay.mjs` expected the ten agent tools from before the cue tools; it now expects the thirteen (`list_cues`, `mark_cue`, `unmark_cue` too).
- `scripts/smoke-keep-all.mjs` waits through a page that is still navigating (a guest's link just opened), as `smoke-csp.mjs` does since step Y; it stopped twice with a null `#joinForm` on that race.

## Where

`public/broll-app.js` (new), `public/app.js` (the B-roll section is now the loader and the answers without the module; `handleCall` passes the B-roll tools on), `public/doc.js`, `public/broll.js`, `public/together-adapter.js`, `public/video-folder.js`. Tests: `tests/broll-app.test.mjs` (the startup files hold no B-roll code, `import()` and the seam version, the helpers in `doc.js`, `app.js` hands the module exactly the names it takes, `createBroll`'s interface with a stand-in page: a fresh part, a linked list read on load, shared, exported and saved to the folder, a guest's list, sketches cleaned when it loads and after); `tests/video-folder.test.mjs` passes the B-roll helpers. Browser check: `scripts/smoke-broll-lazy.mjs`.

## Browser check

`scripts/smoke-broll-lazy.mjs` on `wrangler dev` (it applies `_headers`) and headless Chrome, at 1280 and 390 px with real clicks, watching every request: a new script with typing fetches no B-roll file; opening the Storyboard loads `broll-app.js` and `broll.js` and shows "Link B-roll list…" and "Plan B-roll"; with the agent connected, `upload_image` loads the module and answers, `sketch_shot` without a list says there is none; the demo loads the module with its list, a frame opens its shot card, Escape closes it, "add b-roll" from the selection bar adds a shot whose frame shows, the storyboard shows every shot and a frame there goes back to its lit shot; after a reload `broll-app.js` answers 304; B-roll picked in the "/" menu of a script without a list loads it and opens the Add card; a reopened script whose draft holds a B-roll suggestion loads it and shows the suggestion; with the module's request refused, the Storyboard says "Couldn't load the storyboard. Reload the page.", the agent's `sketch_shot` is told to ask for a reload, and the next script without B-roll saves to a video folder ("B-roll: no list linked"); with the module's download held, an agent's `answer_broll` for one script followed by a switch to another script is refused ("opened another script meanwhile") and the other script gets no suggestion; the demo saved under its own name while the download is held shows its list once the module is here, and again after reopening. No CSP violation and no page error. The older suites run on the same server. Evidence: `docs/agents/evidence/tools-306-browser.txt`.

## Done

Feature list: no change (B-roll code loads on first use; nothing on screen changes)

### Proof

- Failing tests first: met. `tests/broll-app.test.mjs` failed 7 of 7 on `origin/dev` (no `broll-app.js`, `broll.js` among the startup files through `app.js`, `together-adapter.js` and `video-folder.js`, the helpers not in `doc.js`); with the change it passes them, plus a check that `app.js` hands the module exactly the names it takes (8 of 8), and `kit specs` passes 448 of 448.
- The first load carries no B-roll code: met. The startup files (`index.html`'s module script and its static imports) went from 17 files, 598,692 bytes of JavaScript, to 15 files, 463,266 bytes (−23 %); `broll-app.js` and `broll.js` (148,925 bytes) are not among them (`tests/broll-app.test.mjs`). In headless Chrome, `scripts/smoke-broll-lazy.mjs` saw no request for either file while a new script was opened and typed in, at 1280 and 390 px.
- It loads on first use and every B-roll flow works: met. `smoke-broll-lazy.mjs` 90 checks ok at 1280 and 390 px: the Storyboard, an agent's `upload_image`, the demo's linked list, B-roll in the "/" menu and a reopened draft's B-roll suggestion each load it; the shot card, "add b-roll" from the selection bar, the new shot's frame, the storyboard and its jump back to the lit shot work; with the module's request refused, the Storyboard note, the agent's error and a later folder save without B-roll work. `smoke-csp` 51 ok (demo, agent drawing and picture, storyboard, exports, Share to edit with a guest), `smoke-keep-all` 933 ok (Keep all and Undo all for pictures, add b-roll, guests), `smoke-video-folder` 93 ok, `smoke-room` 27 ok.
- CSP and cache rules: met. No CSP violation and no page error in any flow of `smoke-broll-lazy` and `smoke-csp`. `curl -sI /broll-app.js` on `wrangler dev`: `Cache-Control: no-cache`, an ETag and the CSP; with that ETag it answers 304, and after a reload Chrome got 304 for `broll-app.js`.
- The relay suite expects the thirteen tools: met. Before: `FAIL tools/list has the ten tools (answer_ask,answer_broll,get_script,list_asks,list_cues,list_scripts,mark_cue,open_script,set_script,sketch_shot,unmark_cue,upload_image,wait_for_asks)`; after: `smoke-relay` 42 ok, 0 fail.

- An agent's B-roll call that waits for the module goes to the script it was sent for (GPT's second look, P1): met. With the module's download held, `answer_broll` for script A, then a switch to script B: before the fix the call ran on B (`FAIL … the agent hears the person opened another script`, it got B's quote error); after it the agent hears "The person opened another script meanwhile" and B has no suggestion, at 1280 and 390 px.

- Saving the demo while the module loads keeps its list (second look in `kit pr`, P2): met. With the module's download held, Ctrl+S on the demo saves it under its title's name; before the fix its list was gone once the module arrived and after reopening (`FAIL … once the module is here, the saved demo shows its list`, `FAIL … reopened, the saved demo still has its list`, at both widths); after it both pass.

### Declined

- R1 (nit, `public/app.js` pickSlash): B-roll picked in the "/" menu removes the typed command before the module loads, so a first load that fails leaves nothing visible. Once a load has failed, B-roll is no longer offered in the menu or the selection bar; only that first failing pick is affected, and the person can undo the removed command with Ctrl+Z.
- R2 (gaps): no browser check yet for a seam-version mismatch (it throws into the same handler as a refused request, which is checked) or for a failed load that lands after the person switched scripts (the status rule is two lines: unreadable only for the script that asked, or one opened since that is still waiting for it). Test gaps; not worth another round.
- GPT second look (gaps): a version-mismatch test and a delayed-failure test with a script switch, as in R2 above; test gaps only.
- R3 (gaps): browser checks for a seam-version mismatch, a failed load after a script switch, and the card guards after a switch or an undo; test gaps only, and the review budget (3 rounds) is used.

### Follow-ups

Browser checks still to add to `scripts/smoke-broll-lazy.mjs` (test gaps from the reviews; the code paths exist and the related checks pass):
- A module with another seam version: answer the `broll-app.js` request with `Fetch.fulfillRequest` and `SEAM = 2`; expect the Storyboard note, the agent's "could not load its B-roll part" and a later folder save with "B-roll: no list linked".
- A failed load after a script switch: hold the demo's module download, open a new script through `#menuNew`, then fail the request; expect that script's folder save to write "B-roll: no list linked".
- The card guards: with the download held, pick B-roll in the "/" menu (or "add b-roll"), open another script, release; expect no Add card. After an undo in the same script instead, expect the card.
- An undo or a same-text `set_script` while an agent's `answer_broll` waits for the module: expect the call to go through.
- A save during the next script's link lookup once the module is here: hold the lookup (`IDBObjectStore.prototype.get` for `broll:` keys), save under a new name, release; expect no list linked to the saved script.
- Validation gaps (gap): R6-16 still open: same as R6-1.
- Validation gaps (gap): R6-15 still open: same as R6-2.
- Validation gaps (gap): R6-12 still open: there is still no check that the "/" menu's B-roll or "add b-roll" opens no card after a switch through `#menuNew`.
- Validation gaps (gap): R6-11 still open: `runEdges` still has no page that serves `broll-app.js` with a different `SEAM`.
- Validation gaps (gap): R6-10 still open: `holdBroll` still only lets the held request through.
- Validation gaps (gap): R6-9 still open: there is still no check that an undo or a same-text `set_script` lets a held `answer_broll` through. It is now listed as a task (line 64).
- Validation gaps (gap): R6-8 still open: same as R6-5. `scripts/smoke-broll-lazy.mjs` did not change.
- Validation gaps (gap): R6-7 still open: nothing runs `m.SEAM !== BROLL_SEAM` (`public/app.js:3167`) yet.
- Validation gaps (gap): R6-6 still open: there is still no page that serves a module with a different seam version. It is now listed as a task (line 61).
- Validation gaps (gap): R6-5 still open: there is still no check that fails the held request after a switch. It is now listed as a task (line 62).
- Validation gaps (gap): R6-4 still open: there is still no card-guard check for a switch or an undo. It is now listed as a task (line 63).
- Validation gaps (gap): R6-2 still open: nothing in `scripts/smoke-broll-lazy.mjs` changed, so the stale-link fix still has no browser check. It is now listed as a task (`docs/build/step-z-broll-on-first-use.md:65`).
- Validation gaps (gap): R6-1 still open: the commits since beb33d1 change only the step doc. Gaps R5-1 to R5-9 have no browser checks yet. They are now written down as tasks under "Follow-ups" in the step doc.
- Validation gaps (gap): These gaps are still open and are listed as tasks under "Follow-ups" in `docs/build/step-z-broll-on-first-use.md:60-65`. Each one names its test there: a module with a different seam version, through `Fetch.fulfillRequest` with `SEAM = 2`; a failed load after a switch through `#menuNew`, through `Fetch.failRequest` on the held request; the card guards after a switch, and after an undo; an undo or a same-text `set_script` while an `answer_broll` is held; a save during the next script's link lookup, with `IDBObjectStore.prototype.get` held for `broll:` keys.
- Validation gaps (gap): No new gaps. This round changed only the doc.
