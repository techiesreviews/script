# Step I: B-roll and sketches asked for in the agent's own chat

Lex (2026-10-29): "just like the script, I would like to have general B-roll suggestions with sketches." Until now the agent could suggest B-roll and draw sketches only in answer to an ask made in the editor ("Suggest B-roll", "Plan B-roll", "Ask for sketches"). Now the person can also ask in the agent's own chat.

## What changes

- **`answer_broll` without `askId`**: the agent's own B-roll suggestions (adds, changes, removals). They show beside the lines and in the storyboard with Keep and Undo, exactly like the answer to "Plan B-roll". With no B-roll list yet, the first Keep makes one, as before. Refused while the list can't be read (needs the person's OK, still loading, or can't be opened).
- **A new shot can bring its sketch**: an add's optional `sketch` (the same svg as `sketch_shot`, at most 8 KB, cleaned). It shows in the suggested frame; Keep writes the shot and its sketch under the shot's new id in one write. This works for answers to asks too.
- **`sketch_shot` without `askId`**: a sketch for any shot in the list, also to redraw one. An open sketch ask (also one the person made) takes the shot in; else the agent gets a sketch ask of its own. When the person's ask still waits for other shots, the result names them.
- `INSTRUCTIONS` says to use these when the person asks in the agent's chat (not in an ask); the watch prompt names an add's `sketch`. `list_asks` marks such asks `own: true`. VERSION 0.4.0.

## Checks

`tests/broll.test.mjs` (an add's sketch is cleaned, refused on updates and removals, kept under the new id) and `tests/mcp.test.mjs` (askId optional, the sketch's limits, the call reaching the tab without askId, the instructions). In a real browser (headless Chrome, local Worker, MCP over fetch): `answer_broll` without askId with a sketched add, the suggested frame showing the sketch, Keep writing the shot and its sketch, `sketch_shot` without askId on a shot in the list, Keep and Undo, refusals for an unknown shot and with no list.
