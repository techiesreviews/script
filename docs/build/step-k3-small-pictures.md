# Step K3: pictures cut to the storyboard frame and kept small

Lex (2026-10-29): "We could shrink and optimize the images, to a max size of the storyboard image. We don't need the original size of course, this could be done with an in browser image optimization … but make it strict to save space." And: "line drawings need to be there still so when a model doesn't have image gen, there is still a way." Lex agreed that `answer_broll` adds with a picture stay suggestions (Keep or Undo) and that `sketch_shot` line drawings keep waiting for Keep.

## What changes

- **Cut to the frame.** Every frame (beside the lines, in the storyboard, in the storyboard export) shows a picture at 260 : 140, cropped to fill. The tab now keeps only that part, centred (`pictureFit` in `public/broll.js`).
- **At most 640 × 345 px**, a little over the widest frame on a phone screen; never enlarged.
- **WebP** (JPEG where the browser can't make WebP), stepping down quality and then size (`PICTURE_STEPS`: 0.72, 0.6, 0.5 at full size, then 0.5 at ¾, 0.45 at ½) until it is at most `PICTURE_BUDGET` = 80,000 characters as a data address (about 60 KB). A very busy picture keeps the smallest step. Before: up to 960 × 720 JPEG, often 100–200 KB.
- All in the person's browser (canvas); nothing goes to a server. Pictures already kept stay as they are.
- **Line drawings stay** for agents without an image tool: `sketch_shot` with `svg` and an add's `sketch` work as before, and `INSTRUCTIONS` (VERSION 0.8.0) now says so.

## Checks

`tests/broll.test.mjs` (`pictureFit`: wide, tall, small and exact pictures, the size steps). In a real browser (headless Chrome, local Worker, pictures sent with HTTP PUT): a 1600 × 1000 photo-like picture comes back 640 × 345 WebP within the budget; a small picture is only cut, not enlarged; a tall one is cut to the frame; the kept line in the list is a WebP data address; a busy noise picture stays within the budget; without WebP (toDataURL stubbed) the picture is a JPEG within the budget; line drawings still work. `pickPicture` (first within the budget, else the smallest valid one) is unit-tested, with the quality steps. The run is in `docs/agents/evidence/step-k3-browser.txt`.
