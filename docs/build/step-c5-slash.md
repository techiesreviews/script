# Step C5: add parts with / commands while typing

Lex (2026-10-28): "When starting a new script, allow me to add parts with / commands while typing."

## How it works

- Typing `/` at the start of a line, or after a space, opens a small menu at the caret (in the style of the script menu). Typing more letters filters it (`/re` → Recap). Up and Down move, Enter or Tab picks, Escape closes it and leaves the typed text as it was. A click or tap picks too. When nothing matches, the menu closes.
- The command text (`/re`) is removed when a part is picked. It is never saved while the menu is open: autosave waits, or saves without the command.
- Works in every script, not only new ones. The menu never opens inside the title.

## The parts (in this order)

1. **Spoken parts.** Each adds a numbered spoken heading, `## N · <Name>` (or `## <Name>` in a script whose headings have no numbers, see Numbering), below the current block, plus an empty spoken paragraph with the caret in it:
   - Hook
   - Intro
   - Problem
   - Point
   - Demo
   - Recap
   - Call to action
   - Close
   - Section (named: the caret goes into the heading after `N · ` so the person types the name)
2. **On screen**, `[ON SCREEN: ]`: a note line, with the caret inside the brackets.
3. **Silent note**, `[SILENT: ]`: the same.
4. **B-roll**: opens the C3 "Add B-roll" card for the current spoken line. It shows only when the caret is in a spoken line.
5. **Divider**: `---`.

## Numbering

- Style (lead's choice, confirmed by Lex on 2026-10-28): a script with no headings yet, or with numbered headings, gets `## N · Name`; a script whose headings have no numbers gets `## Name`, so its sections stay spoken. A part never makes spoken text stop being spoken; spoken text with no heading above it goes under the new heading.

- The new heading gets the right number for where it lands, and the numbered headings after it move up by one.
  - Keep their names and any time range in brackets exactly as they were.
  - Change nothing else in the file.
- Put the renumbering in `doc.js` as a pure function, with tests (inserting at the start, the middle and the end; headings with and without a time range; CRLF).
- Undo (Ctrl+Z) takes back the whole insertion, renumbering included, in one step.

## A new script

- The empty first spoken line of a brand-new script shows the muted placeholder "Type / for parts". This is the only hint; it disappears once there is text. This is a small exception to the no-explainer rule, so Lex can see the feature exists; Lex chose to keep it on 2026-10-28.

## Not part of this step

- No agent use: asks and MCP stay as they are.

## Checks

- Unit tests: renumbering, the part templates (exact Markdown inserted), the filter (`/re`, `/cta` finds "Call to action", `/b` finds "B-roll"), and that a `/` in the middle of a word opens nothing.
- Browser check at desktop and phone width with a new script:
  - `/` → Hook → typing;
  - `/sec` → Enter → typing a name;
  - `/on` → typing inside the brackets;
  - Escape keeps `/on` as text;
  - inserting a part between two sections renumbers them;
  - Ctrl+Z undoes it;
  - a reload shows the saved result.

  Start `npx wrangler@4 dev` yourself and stop it afterwards (by process id).
- Run `kit doctor` and `kit specs` (both `RESULT: ok`). Do not commit, push, deploy or stash. Report in at most 15 lines, including the RESULT lines.
