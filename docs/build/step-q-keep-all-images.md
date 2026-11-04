# Step Q: Keep all for the agent's pictures

Lex (2026-11-04): when the AI updates several images (B-roll sketches, each with Keep / Undo), there is no accept-all button. Wanted: one "Keep all" (and, if cheap, "Undo all") for the pending AI image changes, visible when two or more are pending. Fleet issue: https://github.com/techiesreviews/fleet/issues/24

## What changes

1. **A small bar with "N images", Undo all and Keep all** shows from two open pictures on, in the look of the per-picture Keep and Undo. It stays in sight under the top bar in the script and in the storyboard, for the host or a person alone; guests see none, as they have no Keep or Undo on pictures.
2. **What counts** (`pendingImages` in `public/broll.js`): pictures and drawings waiting for Keep or Undo, pictures put in at once with their Undo (step K2), and suggested adds with a picture. A picture being written doesn't count, nor does a shot gone from the list. Suggestions without a picture keep their own Keep and Undo, and the storyboard's existing "Keep all · Undo all" for answers with several changes stays as it was; the "N images" tells the two apart.
3. **Keep all** does what each picture's own Keep does: a waiting picture is written into the list and a suggested add is added. A picture that can't be written stays with "Not saved", and its own Keep or Keep all can try again. A picture put in at once is already in the list, so Keep all only takes away its mark and its Undo, and the shot can be dragged again.
4. **Undo all** does what each picture's own Undo does. It was cheap: all three kinds already have an Undo to call.
5. **Undo after Keep all:** a single Keep can't be undone today (the B-roll list isn't part of Ctrl/Cmd+Z), so a Keep all can't either. This matches the existing behaviour.
6. Over the script the bar takes no room, so the text doesn't move when it comes. Over the storyboard it has its own row above the storyboard's bar, which moves the storyboard down by that row.

## Checks

`tests/broll.test.mjs` (`pendingImages`). `scripts/smoke-keep-all.mjs` in a real browser at 1280 px and 390 px, with the agent over MCP and real clicks: start the site with `scripts/agents/kit bg dev -- npx --yes wrangler@4 dev --port <port>` and Chrome with `scripts/agents/kit bg chrome -- google-chrome --headless=new --remote-debugging-port=<port> --user-data-dir=<a scratch folder> about:blank`, then run `node scripts/smoke-keep-all.mjs http://127.0.0.1:<port> <Chrome's port>`. The run is in `docs/agents/evidence/step-q-browser.txt`. Not covered by a browser step: a guest in a shared script (one line in `imagesOpen`), and a write that fails during Keep all (it goes through `keepSketch`'s own handling).

## Done

Built and checked as above. Feature list: updated (`docs/features.md`).
