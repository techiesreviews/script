# Step X: Save to video folder

Lex (2026-11-10, Orbit TOOLS-194, weekly flow step 7b): when a script is final, one action puts the script, the cue files, the B-roll data and its pictures in the video's folder under the names the video folders use (`youtube/workflow/project-files.md`), with a short receipt. Nothing may change or reformat script text; build only this.

## What it does

- Export menu, second item: **Save to video folder**. The browser's folder picker (`showDirectoryPicker`) opens; the files are written there. Where the browser has no folder picker the same files come as one zip, `<name>-video-folder.zip`.
- Files: `script.md` (the script exactly as the editor saves it), `prompter.md` and `recording-notes.md` (the prompter export, the same text in both, as the workflow wants them identical), `b-roll.md` (the Export all list, with each picture written as a link to its file), `b-roll.json` (id, kind, what, over, how, check, picture path for every shot, in script order), `pictures/<shot id>.png|jpg|webp|svg`, `save-receipt.md` (date, words, shots, pictures).
- Picture file names come from the shot id: letters, digits, dot, dash and underscore only, starting with a letter (`shot-` is put in front otherwise), never twice. Line drawings are written as standalone SVG with the storyboard's colours.
- A linked B-roll list that is loading, blocked or unreadable (`listState` is "wait") saves nothing: the item says what it needs (`WAIT_NOTE`: "B-roll list still loading", "Allow the B-roll list first" or "B-roll list can't be read"). One save runs at a time (a second click is ignored until the first ends).
- Without a linked B-roll list there is no `b-roll.md`, `b-roll.json` or `pictures/`; the receipt says "no list linked".
- A `prompter.md` or `recording-notes.md` already in the folder is kept as it is: the speaking cues written after the script is final must not be replaced by the plain prompter export (playbook: reopening keeps approved cues). Everything else is replaced. Nothing is ever deleted: a picture of a shot that was removed, or one whose format changed (`B1.png` and later `B1.svg`), stays in `pictures/` from an earlier save; `b-roll.json` and `b-roll.md` name the right files. A sketch that belongs to no shot is not saved.
- The menu item shows the result in one line (`folderNote`); no toast, no explainer.

## Where

`public/video-folder.js` (pure: `videoFolder`, `writeFolder`, `folderNote`), `saveToFolder` in `public/app.js`, one item in `public/index.html`; `exportBroll` takes `paths` so a sketch can be a file link. Tests: `tests/video-folder.test.mjs` (names, B-roll data and pictures included, receipt, the zip names, writing into a folder, cue files kept, the note). Each new test failed before the change (the module did not exist).

## Browser check

`scripts/smoke-video-folder.mjs` (1280, 390 and 320 px, real clicks; the folder picker is replaced by one returning a folder in the browser's private file system): the item is second in the menu, the files and pictures are written with the right names, `b-roll.md` links the picture files, the receipt and the item's note, hand-written cue files kept on a second save, no toast; a cancelled picker leaves the item and the last note alone, a refused one says "Could not save", and with no picker the item says "(.zip)" and a zip named `<name>-video-folder.zip` is downloaded; two quick clicks open the picker once. Evidence: `docs/agents/evidence/step-x-browser.txt`.

## Done

Feature list: updated (`docs/features.md`).
