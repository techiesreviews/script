# TOOLS-483: the Undo-ask and held-drag findings from the release second look

Card TOOLS-483 (parent TOOLS-470). The third release try of select across paragraphs stopped on two findings from the GPT second look (release cut 91f2c18): P1 `public/app.js:1496` and P2 `public/app.js:1380`.

## What changed

- An open ask or a "Sounds like me" mark on words after the span, in its last paragraph, stays open through Undo. `Doc.moveAsks` now returns the moves it made (ask id, mark index, from, to). `applySpan` keeps them on its Undo step (`askMoves`), and `restore` puts those anchors back (`Doc.unmoveAsks`) right after the old blocks are back, before asks are found again. Before, the anchors still pointed at the joined paragraph, the quote was not found there, and the ask closed as "cancelled". The step left for the other list carries the flipped moves (`Doc.flipMoves`), so Redo takes them to the joined paragraph again. Only asks and marks still open and still in the block the move left them in are put back.
- An outside change that ends the span (the agent's answer, a shared edit) also ends a drag still held and its scrolling (`spanDragStop`, called where `liveSpan` and `paintSpan` drop the span and from `afterRoomOps`). A change to the block the drag started in, before any span was drawn, ends the drag the same way (`spanDrag.text`). Before, the next mouse move or scroll frame drew a span from the old start offset in the changed text.

## Checks

- `tests/doc.test.mjs` "moveAsks returns its moves; unmoveAsks puts open anchors back…": failed first (`unmoveAsks` and `flipMoves` did not exist), then passed.
- `scripts/smoke-select-across.mjs` step 16b: an ask on "sounds like you" and a "Sounds like me" mark on "before you press record" in the third paragraph; Delete over a span ending at "Today:", Undo, Redo, Undo: each time both are open and on their words. It failed first with `public/app.js` and `public/doc.js` from 44e0090 (`after Undo the ask is still open and both are back on the third paragraph`), then passed.
- Step 16c: the mouse is held in a drag over three paragraphs while the agent bolds a word in the first; moving on and letting go draw no span, and held near the window's end no span is drawn again either. It failed first with only the Undo fix in place (`no span comes back while the mouse moves on (held drag): {"on":true,…"ud. Why does it sound…"}`: the span came back four characters off), then passed.
- Step 16c also checks the test hook `window.__scriptEditor.spanBusy()` (a drag or its scrolling still running): false right after the agent's change and while the mouse stays held (review round 1).
- Step 16d (review round 1): the drag is held inside the first paragraph (no span yet) while the agent bolds a word there; moving on into the third paragraph and letting go draw no span, and the drag has stopped. It failed first without the start-paragraph check in `spanExtend` (`no span while moving into the third paragraph: {"on":true,…"ud. Why does it sound…"}`), then passed.
- The browser run is 50/50 at 1280 and 390 px: `docs/agents/evidence/tools-483-browser.txt`. One earlier green run failed step 15 at 390 px ("letting go stops the scrolling", a step this change does not touch); the next run passed it.
- Held near the window's end after the drag stopped, the page still scrolls a little: that is the browser's own scrolling of its selection inside the first paragraph while the mouse stays at the edge, not the editor's.
- Not covered: a one-paragraph Enter or join also moves asks to another block (`splitBlock`, `mergeInto`) without recording the move for Undo; whether that has the same gap was not checked here. It is older than select across and outside this card.
