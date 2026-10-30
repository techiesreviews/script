# Step M: the agent's highlight goes away by itself

Lex (2026-10-30): the light tint on text the agent changed (step F) "is kind of distracting"; it should go away by itself. He chose: **once you've scrolled past it**, or **60 minutes after it came in**, whichever comes first. When it goes, **Undo on the agent's name tag goes with it**: the change becomes normal text (Ctrl/Cmd+Z still works as for your own typing).

## When the mark ends

- **Scrolled past.** The mark ends once the changed text has been on screen and is then scrolled up so that its last line is above the middle of the script's visible area (the person has read past it). Only the person's own scrolling counts: not the scroll that brings a new change into view, and not a jump the editor makes (a section, a shot, a search). A change that lands already above the middle ends at the person's next scroll that leaves it above the middle. A change that is never on screen keeps its mark until the 60 minutes are over.
- **60 minutes.** The mark ends 60 minutes after the change went in (`ask.change.at`, the host's clock, as now), also when it was never seen. It is checked about once a minute, when the tab comes back into view and when a script or draft is opened (a draft restored after more than 60 minutes shows no mark).
- Both are added to the ways a mark already ends (an edit inside it, a new ask on it, Undo), and end it the same way: the ask stays `kept`, its `change` is gone, the text is untouched, the tint, the agent's caret on it and its Undo go. The agent's caret moves to the next newest marked change, or leaves. `list_asks` still says `kept`.
- The tint fades out over about 400 ms where motion is allowed (`prefers-reduced-motion: no-preference`); otherwise it just goes.
- Only text changes. Pictures put into the B-roll list at once (step K2) keep their mark as before.

## Shared scripts (step D)

- **60 minutes** ends the mark for everyone: the host's tab ends it and shares the asks as usual.
- **Scrolled past** ends it on that person's screen only (host or guest): others still see it, with Undo where they may, until they scroll past it too or the 60 minutes are over. Alone, scrolling past ends the mark for good (kept with the draft like any other end).
- Ending a mark never changes the text, so nothing goes to the room but the asks.

## Where it lives

- Pure rules in `public/changes.js` with tests: `MARK_MS = 60 * 60 * 1000`; `markExpired(ask, now)`; a helper that ends the expired marks of a list of asks and says which ended; and a pure "read past" check from the mark's box and the visible area (`readPast({ top, bottom }, { top, bottom })` or similar).
- `public/app.js` watches the marks (IntersectionObserver or the scroll handler, nothing on every frame), keeps the per-person "scrolled past" set for a shared script in memory (by ask id), and redraws.

## Checks

`tests/changes.test.mjs`: expiry at 59 and 61 minutes; a mark without `at` (from a draft before step F's time stamp) counts its 60 minutes from when the tab read it; the read-past rule (below the middle, on the middle, above it, never on screen); `newestMarked` after an end; a guest's per-person end leaves the host's ask marked. Browser check (headless Chrome, local Worker, MCP over fetch) at desktop and 390 px: an answer lands in view and stays while not scrolled; scrolling it above the middle ends the tint and the Undo; one off screen keeps its mark; a clock moved 61 minutes ends it (also after a reload with Restore); in a room a guest's scroll ends it only for the guest. The run goes in `docs/agents/evidence/step-m-browser.txt`.
