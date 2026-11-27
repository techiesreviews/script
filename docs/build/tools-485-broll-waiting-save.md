# TOOLS-485: a B-roll shot stays on the right paragraph while a list save is still waiting

Card TOOLS-485 (parent TOOLS-470). The fifth release try of select across paragraphs stopped on one finding from its second look (release head 9275fab): P1 `public/broll-app.js:919`. With the paragraphs "Lead gone", "Gone original" and "Gone Lead original", shot B1 on the second and the list save held: delete from "gone" through "Gone ", then Enter over a selection from the joined paragraph's start through the last "Gone ". B1 follows "Lead original" to the new paragraph, but when the held save lands it jumps to the paragraph the Enter left empty.

## What changed

- The cause: a change across paragraphs that gives a shot a new quote (its Over) queues a save and keeps a note of where it put the shot (`broll.placing`), so that the save, once it lands, keeps the shot on that paragraph. The second change moved the shot on with the same quote, so it had nothing to write, and the note was only made when there was something to write. The first save then landed with its old note and put the shot back on the paragraph its own step had shown, which was still there, empty.
- `placeShots` now also brings the waiting note up to date when a step moves a shot and needs no write: the note of the save that still waits, with this quote, takes the shot's new paragraphs. The note stays that save's own (it is changed, not replaced), so the save still clears it when it has landed. Undo and Redo go through `placeShots` too, so they are covered by the same lines.
- One more case of the same kind, found by sweeping this path (below): the second change leaves the shot on no paragraph (no paragraph with words is left), its words are typed again and the shot is found beside them (`rematchBroll`, a moment after any change). A note that names no paragraph then took the shot off the script when the save landed. `adoptBroll` now lets such a note decide nothing: the shot is found by its quote, as it is after any change. Before this fix that note was in practice never empty (only shots on a paragraph a change takes out are moved); the old code put the shot on the empty first paragraph there instead.

## The sweep

The lead asked for one sweep of the whole placement path during changes across paragraphs (waiting saves, `placeShots`, `adoptBroll`, `broll.placing`), so the next review does not find another case of the same race.

- Read through: every place that sets a shot's paragraphs (`adoptBroll`, `rematchBroll`, `placeShots`, the drag's `land`) and every use of `broll.placing` and `broll.unsaved`. While a note of the current list waits, the shot's Over is the note's Over (a save from before leaves the shot as it shows; a drag never sets the Over on the page before its own save). A drag's save runs in its turn behind the waiting ones, and a step made while it waits is not written over the drag's quote, so the drag wins on the page and in the list alike. `rematchBroll` only touches shots that show on no paragraph.
- Run: a throwaway script (not in the repository) played random runs against the real `adoptBroll`, `rematchBroll`, `placeShots` and `followSpan`: three to five paragraphs from four words that repeat, one or two shots, then two to seven steps out of: a change across paragraphs (delete, typed text, Enter), Undo, Redo, another save of the list, the re-match of shots without a paragraph, a save held, a held save let go, and (in one run) a save that fails. At the end every save lands and one more follows. The check: each shot whose quote fits the paragraph the last step showed it on is on that paragraph. On the old code 10 of 16000 runs failed. With the first part of the fix alone 1 of 18000 failed (the empty note above). With both parts: 0 of 40000, and 0 of 8000 with failing saves.
- Left as they are, older than this card and not this race:
  - A shot whose paragraph's words changed so that its quote no longer fits is found by its quote at the next save of the list (it gets "Check" first). That is how the list is read everywhere, also after plain typing.
  - After a save that failed ("Not saved" shows in the shot's card), a second change that keeps the shot's quote writes nothing, so the list keeps the older quote until the next step that writes. The shot still shows on the right paragraph.

## Checks

- `tests/broll-move.test.mjs`, written before the fix:
  - "a second change across paragraphs that keeps the shot's quote keeps the shot there when the first one's save lands": the card's sequence. Red on the old code (`the shot stays beside "Lead original" when the held save lands`), green with the fix; it also checks the shot after another save of the list, "Moved here", and that no note is left.
  - "Undo and Redo of a change that kept the shot's quote, pressed while an earlier save waits, leave the shot where Redo put it": red on the old code, green with the fix.
  - "a shot a second change left on no paragraph, found by its quote since, stays there when the first one's save lands": red on the old code and red with the first part of the fix alone, green with both.
  - "Undo of a change that sent the shot to a paragraph that stays, pressed while an earlier save waits, puts the shot back for good": a guard for the note that now follows the shot; it passed before the fix too.
- Review round 1 asked for two more, both added:
  - "with two saves waiting, a third change that keeps the shot's quote keeps the shot there as each save lands": two changes each give the shot a new quote, a third moves it on with the second quote kept; the shot is checked after each save lands and after one more. Red on the old code (`and when the second lands`), green with the fix.
  - "when the waiting save fails after a second change moved the shot on, the shot stays where it shows": a guard, it passed before the fix too. The shot's card and its "Not saved" are not drawn in this harness, so the test checks the shot's place, the list and that no note is left.
- No browser step: the fault needs a list save held open between two edits, which the unit harness does with the app's own functions; the page draws the shot from the same `blockIds` these tests check.
- The two small tests the TOOLS-484 report listed as follow-ups (e) and (f) are not added here: they are in `tests/doc.test.mjs` and the typing path, not in the files this fix touches.

## Done

Done when 1: met — `tests/broll-move.test.mjs` "a second change across paragraphs that keeps the shot's quote keeps the shot there when the first one's save lands": with the B-roll save held, the delete gives the shot a new Over and the Enter moves it on with that Over kept; after the held save lands the shot is beside "Lead original", and after another list save too. Red on the old code, green with the fix.

Done when 2: not met yet — this change lands in dev first; the release to main and the deploy follow in the same job.

Feature list: updated (`docs/features.md`, select across paragraphs).
