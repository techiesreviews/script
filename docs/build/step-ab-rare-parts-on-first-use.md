# Step AB: rare parts load on first use

Lex (2026-11-16, Orbit TOOLS-311, pick 4 of the TOOLS-296 review): the parts of the editor a person uses rarely load the first time they are needed, the way the B-roll part does since step Z, so opening the editor downloads less. Nothing on screen changes. It waits with saving (step AA) for Lex's click-through before it goes live.

## What it does

- **The share room** (`public/together/room.js`, 35 KB) loads when the host first presses Share to edit, or as soon as a guest's edit link opens (while the Join form shows). `together-adapter.js` loads it with `import()` and checks its seam version (`ROOM_SEAM` and `SEAM`).
  - The edit link is made and copied inside the Share to edit click, as before: its keys come from `public/together/link.js` (`newRoom`, `makeLink`, `parseLink`, the id and key rules), which loads at startup; `room.js` passes them on. The room with those keys starts once its part is here.
  - While the part is on its way, sharing counts as on (another script may not open over it, the agent's `open_script` is refused as before), and Stop sharing, or opening another script, drops it: no room starts. A guest's newer join replaces an older one still waiting.
  - A part that can't load (or speaks another seam version): the host's share ends and the button's label and tooltip say "Couldn't share. Reload the page." (no new link is copied after that); a guest's Join says "Couldn't load the edit link. Reload the page." where the ended-link note shows.
  - The rest of working together (the adapter, `ops.js`, carets, the share button) stays at startup: the agent's caret uses it even when nothing is shared.
- **The export pack** (`public/export-pack.js`, with `zip.js` and the video-folder writer `video-folder.js`, 14 KB in all) loads when the Export menu opens (`beforetoggle`, so a menu opened and closed at once still asks for it). Export all and Save to video folder use it; a click waits for it if it is not here yet. The folder picker still opens inside the click; everything a save or a zip needs is read from the script before the pack is awaited, so it is the script on screen at the click that is exported, whatever opens meanwhile.
  - Its interface: `SEAM`, `zipAll(files)` (Export all) and `saveFolder({ dir, doc, scriptText, title, broll, modified, dirty })` (the folder written to `dir`, or the zip of it without one).
  - The note under "Save to video folder" and what a save needs of the B-roll list (`listState`, `settleFolder`, `folderNote`) moved to `public/folder-note.js`, which loads at startup; `video-folder.js` passes them on.
  - A pack that can't load (or speaks another seam version): Export all and Save to video folder both say "Couldn't load. Reload the page." on the item (a new note under Export all, hidden otherwise) until a reload, and neither downloads or writes anything.
- Not moved: the agent link section of `app.js` (the review: it starts only once a token is stored, but it is woven through the asks, answers and the agent's script tools, and needs a step-Z-style move first).
- Cache and CSP (step Y): the new files are same-site module scripts (`script-src 'self'`) with `Cache-Control: no-cache` and an ETag; after a reload each answers 304.
- Sizes (the files the page needs before it runs, `index.html`'s module script and its static imports): before, 16 files and 468,623 bytes of JavaScript; now 15 files and 427,135 bytes (−41,488, −8.9 %). On first use: `together/room.js` 34,578, `export-pack.js` 1,696, `video-folder.js` 8,786, `zip.js` 3,123 bytes.

## Where

`public/together/link.js` (new), `public/together/room.js`, `public/together/share-button.js` (`fail(text)`; a copy that lands after sharing ended no longer says "Link copied"), `public/together-adapter.js` (`createTogether(app, { loadRoom })`, `preload()`), `public/export-pack.js` (new), `public/folder-note.js` (new), `public/video-folder.js`, `public/app.js` (the export pack's loader, Export all and Save to video folder, the guest's note, `together.preload()` for a guest's link), `public/index.html` (`#zipNote`). Tests: `tests/rare-parts.test.mjs`. Browser check: `scripts/smoke-rare-parts.mjs`.

## Browser check

`scripts/smoke-rare-parts.mjs` on `wrangler dev` (it applies `_headers` and runs the rooms) and headless Chrome, at 1280 and 390 px with real clicks, watching every request: a new script with typing fetches none of `together/room.js`, `export-pack.js`, `video-folder.js`, `zip.js` (and does fetch `together/link.js` and `folder-note.js`); opening the Export menu loads the pack, Export all downloads the script's zip (it starts with "PK") and no note shows; Share to edit copies the edit link, loads `room.js`, and the room started is the one in the copied link, with "Link copied" and Stop sharing; the guest's link loads `room.js` while the Join form shows (and no export pack), the guest joins and gets the host's text, the host sees the guest; Stop sharing ends the room; after a reload each of the four files answers 304 on the wire; with `room.js` held, the link is still copied in the click, sharing shows as on with no room, and Stop sharing before the part comes starts none; with `room.js` and `export-pack.js` refused, the share button says "Couldn't share. Reload the page." and sharing is off, Export all and Save to video folder say "Couldn't load. Reload the page." and Export all downloads nothing, and a guest's Join says "Couldn't load the edit link. Reload the page.". No CSP violation and no page error. The older suites run on the same server. Evidence: `docs/agents/evidence/tools-311-browser.txt`.

## Done

Feature list: no change (rare parts load on first use; nothing on screen changes)

### Proof

- Failing tests first: met. `tests/rare-parts.test.mjs` failed 8 of 9 on `origin/dev` (`together/room.js`, `zip.js` and `video-folder.js` among the startup files; no `export-pack.js`, `together/link.js` or `folder-note.js`; the share room started at once in the click). The ninth (a share stopped before the part arrives starts no room) is a guard that held already. With the change all 9 pass, and `kit specs` passes 473 of 473.
- The first load carries none of these parts: met. The startup files went from 16 files, 468,623 bytes, to 15 files, 427,135 bytes (−8.9 %); `tests/rare-parts.test.mjs` checks the four files are not among them. In headless Chrome, `smoke-rare-parts.mjs` saw no request for any of them while a new script was opened and typed in, at 1280 and 390 px.
- Each part loads on first use and works: met. `smoke-rare-parts.mjs` 67 ok, 0 fail (the Export menu, Export all, Share to edit with a guest, a held room, refused parts, 304 after a reload). The older suites on the same server: `smoke-csp` 51 ok (0 CSP violations), `smoke-saving` 73 ok, `smoke-broll-lazy` 91 ok, `smoke-video-folder` 93 ok, `smoke-keep-all` 933 ok, `smoke-room` 27 ok, `smoke-relay` 42 ok.
- A plain error line on a load failure: met. With the requests refused, the share button, Export all, Save to video folder and a guest's Join each said to reload (`smoke-rare-parts.mjs`), with no page error.
