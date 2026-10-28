# Step C4: the agent suggests B-roll (add, change, remove), the person keeps or undoes

Lex (2026-10-28) agreed: B-roll works like text. The agent suggests and the person decides. Today the agent can read the B-roll (`get_script`) and draw sketches (`sketch_shot`), but it can't add, change or remove a shot.

## New asks

- **Edit bar:** "Suggest B-roll" (next to "Add B-roll") makes an ask `{ scope: "selection", action: "broll" }` for the selected spoken lines, with the quote as usual.
- **Storyboard header:** "Plan B-roll" (next to "Ask for sketches") makes an ask `{ scope: "broll", action: "plan" }` for the whole script.
- **"Ask…"** (free text on a selection) may also be answered with B-roll changes, for example "add a screen recording here".
- Add the instruction texts to `doc.js` ACTIONS:
  - `broll`: suggest 1–3 shots for these lines, short "What to show" and "How to make it", and only where a picture helps the viewer;
  - `plan`: go through the whole script and suggest adds, changes and removals, at most 20, without repeating what is already there.

## New MCP tool `answer_broll`

- Input: `{ askId, changes: [...], message? }`, with at most 20 changes and a message of at most 200 characters. Each change is one of:
  - `{ op: "add", kind: "broll" | "motion" | "screen", what (≤ 200), how? (≤ 120), quote (≤ 500, exact spoken text from the script, may span lines), why? (≤ 160) }`;
  - `{ op: "update", id, what?, how?, kind?, why? }`;
  - `{ op: "remove", id, why? }`.
- The tab checks it all and refuses with a clear error:
  - an unknown or finished ask, or an ask that doesn't allow B-roll (only `broll`, `plan` and free `ask` asks);
  - unknown ids;
  - a quote that isn't in the spoken text;
  - the kind `screen` with a `how`;
  - more than the limits.
- For an add, the tab builds the Over line from the quote with the C3 selection-to-Over builder, so it matches the same lines.
- It returns "Shown to the person. They choose Keep or Undo per change."
- `get_script` stays as it is (it already returns `broll`). `list_asks` shows each B-roll change's state (waiting, kept, undone).
- Update the tool list (6 tools), the server instructions, the `watch_script` prompt and WATCH_PROMPT ("answer_broll for B-roll asks"), the README and `scripts/smoke-relay.mjs`: expect 6 tools, and add one `answer_broll` round trip with a fake tab.

## How suggestions show

- **Add:** a suggested shot beside its line, the same as a real shot but with a dashed orange frame, the tag "Suggested", the "What" and "How", and Keep and Undo. It shows in the Storyboard too (in script order, same look) and counts in no filter until it is kept.
- **Change:** on the existing shot's frame, the card shows the old text struck through and the new text, with Keep and Undo.
- **Remove:** the shot's frame is dimmed with "Remove?", the agent's why, and Keep and Undo.
- Several changes in one answer: also show "Keep all · Undo all" once, in the Storyboard header, while any are waiting.
- **Keep:**
  - an add gets the next free id at that moment;
  - every Keep writes through `addShot` / `updateShot` / `removeShot` and the one-write-at-a-time queue, to the linked file or the browser-kept list, as in C3;
  - no list yet: the first Keep makes one, as in C3.
- **Undo** drops the suggestion; nothing is written.
- If the person changes the script so a suggested add's quote no longer matches, the suggestion moves to "Not found in the script" and can still be kept or undone.
- The agent's chip and shimmer while it works on the ask stay as they are for text asks.

## Checks

- **Unit tests:**
  - the tool's input limits and refusals in `worker/mcp.js` and on the tab side;
  - Over from a quote across lines;
  - Keep of an add, update and remove giving the same file as the C3 functions;
  - "Keep all" writing in one queued write, or in order without lost changes;
  - an Undo writes nothing.
- **Smoke test:** `node scripts/smoke-relay.mjs` against `npx wrangler@4 dev` prints `RESULT: ok smoke` with 6 tools.
- **Browser check** with the demo at desktop and phone width: a fake agent answer (through `window.__scriptEditor` or the relay) with one add, one change and one remove. Each shows in place; Keep and Undo work; reload keeps the kept ones.
- Run `kit doctor` and `kit specs` (both `RESULT: ok`). Do not commit, push, deploy or stash. Report in at most 15 lines, including the RESULT lines.
