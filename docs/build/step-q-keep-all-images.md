# Step Q: Keep all for the agent's pictures

Lex (2026-11-04): when the AI updates several images (B-roll sketches, each with Keep / Undo), there is no accept-all button. Wanted: one "Keep all" (and, if cheap, "Undo all") for the pending AI image changes, visible when two or more are pending. Fleet issue: https://github.com/techiesreviews/fleet/issues/24

## What changes

1. **A small bar with "N images", Undo all and Keep all** shows from two open pictures on, in the look of the per-picture Keep and Undo. It sits at the top of the script and of the storyboard, for the host or a person alone; guests see none, as they have no Keep or Undo on pictures.
2. **What counts** (`pendingImages` in `public/broll.js`): pictures and drawings waiting for Keep or Undo, pictures put in at once with their Undo (step K2), and suggested adds with a picture. Only what is in sight counts: over the script the shots with a frame, over the storyboard the shots its filter shows. A picture being written doesn't count, nor does a shot gone from the list. Suggestions without a picture keep their own Keep and Undo, and the storyboard's existing "Keep all · Undo all" for answers with several changes stays as it was; the "N images" tells the two apart.
3. **Keep all** does what each picture's own Keep does: a waiting picture is written into the list and a suggested add is added. A picture that can't be written stays with "Not saved", and its own Keep or Keep all can try again. A picture put in at once is already in the list, so Keep all only takes away its mark and its Undo, and the shot can be dragged again.
4. **Undo all** does what each picture's own Undo does. It was cheap: all three kinds already have an Undo to call.
5. **Undo after Keep all:** a single Keep can't be undone today (the B-roll list isn't part of Ctrl/Cmd+Z), so a Keep all can't either. This matches the existing behaviour.
6. **It can never cover text** (lead's decision, 2026-11-04, after three review rounds on a bar that followed the scroll): the bar is a row of its own in the page's flow, not sticky and not floating. It scrolls away with the page, so someone scrolled down goes back up to press it; each picture's own Keep and Undo stay beside it. Nothing moves the page for it. The row moves the text or the storyboard down when it comes, and what floats over the text (the "/" menu, the selection bar, the cards) follows it.
7. **Nothing jumps as the count falls:** the row stays when the count falls below two, until the view or the list changes. In the storyboard it lines up with the frames at any width. With large text or in a narrow window its parts wrap, so every one can be reached.

8. **A new name never leaves the page half drawn** (lead's decision, 2026-11-04, from the release review): a script's own bold settings are kept under its name, so a new name can change them. When the demo is saved into the browser, a title changes a browser script's name, or Save as gives it a file's name, the page follows at once. It is redrawn only when the settings really changed, so a rename while typing doesn't disturb the caret.

## Checks

`tests/broll.test.mjs` (`pendingImages`). `scripts/smoke-keep-all.mjs` in a real browser at 1280 px and 390 px (and the storyboard at 1920 px), with the agent over MCP and real clicks: start the site with `scripts/agents/kit bg dev -- npx --yes wrangler@4 dev --port <port>` and Chrome with `scripts/agents/kit bg chrome -- google-chrome --headless=new --remote-debugging-port=<port> --user-data-dir=<a scratch folder> about:blank`, then run `node scripts/smoke-keep-all.mjs http://127.0.0.1:<port> <Chrome's port>`. The script also checks bold marking off and on (step P) and the renames in item 8, and can run against the live site after a deploy, where it sends only test data. The run is in `docs/agents/evidence/step-q-browser.txt`. Not covered by a browser step: only some of the writes failing during one Keep all, a failed Undo all, a suggested add under a storyboard filter, and a list kept in a real file (the check uses the demo's list, kept in the browser; each of these goes through the code a single Keep or Undo uses).

## Done

Built and checked as above. Feature list: updated (`docs/features.md`).

## Follow-up

A way to reach the bar when scrolled far down, such as a small "Keep all" in the top bar. Not added now: the top bar has no spare room at 390 px, where it already shows the name, the view switch and four buttons, so it needs its own layout work.
