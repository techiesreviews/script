# Step C2: sketches in the script, a Script/Storyboard switch, export per part

Lex's feedback on the live step C (2026-10-28). The B-roll sketches belong in the script itself, not in the left column. The storyboard gets its own view, opened from the top bar. Export lets him pick the A-roll, the B-roll or the storyboard on its own.

## 1. Sketches inside the script

- Beside the first line of each shot, in the right margin where the tag is now, show the shot's sketch frame (about 160 px wide, viewBox `0 0 260 140`) with the tag ("B4", kind icon, check dot) on top of it. A shot without a sketch shows the empty dashed frame.
- The covered-line rule, the click-to-light behaviour and the check flags stay as they are. Clicking the frame lights the covered lines.
- Agent sketches waiting for a choice show Keep and Undo in the frame here too (same component as the storyboard).
- Narrow layouts (no room in the margin): the frame sits above the line, at most half the column width.
- Frames are never part of the text: not selectable into an ask, not copied, never saved into the script.

## 2. A "Script | Storyboard" switch in the top bar

- A small two-option switch in the top bar, shown only while a script is open. "Script" is the editor; "Storyboard" replaces the script column with the storyboard grid (full width). Remember the choice in localStorage.
- Accessible: buttons with `aria-pressed` (or a radio group), keyboard friendly, visible focus.
- The storyboard view gets everything that used to sit in the left column:
  - a quiet header line: the B-roll list's file name with "Change…" and "Unlink", or "Link B-roll list…" when none is linked (then the view shows only that, as its empty state);
  - filter chips "All · 10", "B-roll · 5", "Motion plates · 3", "Screen · 2" (counts from the list; hide a chip with 0);
  - "Ask for sketches" (as now);
  - shots that match nothing go last, under "Not found in the script", muted.
- Clicking a frame switches back to Script and lights that shot's lines.

## 3. Left column: sections only

- Remove the B-roll and Motion plates groups and the Storyboard toggle from the left column. The left column is the section list only.
- Phones: remove the "B-roll" chip and the B-roll sheet (`#brollSheet`); the top-bar switch covers it. Remove the dead code and CSS that only served these.

## 4. Export: A-roll, B-roll and storyboard separately

The Export menu gets three small groups with quiet headings:

- **A-roll:** Camera script (.txt), Open in prompter, Prompter (.md), as now.
- **B-roll:** "B-roll list (.md)": the shots in script order as a Markdown table (`# | Kind | What to show | Over (A-roll line) | How to make it | Check`), then the `## Sketches` section, in the same format the parser reads, so the file can be linked again.
- **Storyboard:** "Storyboard (.html)": one self-contained HTML file (no scripts, inline CSS, light colours, prints well on A4 with `@page`), with the title and, per shot in script order, the frame, id, kind, what and the Over line. Sketches go through the sanitiser.
- Without a linked B-roll list the B-roll and Storyboard items are disabled, with the quiet note "Link a B-roll list first".
- Keep the "Markdown file (.md)" item where it is.

## 5. The script name button

- The whole block in the top left (script name, chevron and the "384 words · 2:24 spoken" line) is one button that opens the script menu (search, open, new, remove). Hovering or focusing it highlights the whole block. The save state and the "Allow saving" button stay next to it, outside the button.

## Checks

- Unit tests for the B-roll export (round trip: export, parse again, same shots and sketches) and the storyboard HTML (sanitised, no `<script>`, every shot present).
- Browser check at desktop and phone width with the demo: frames beside the lines in Script, the switch, the storyboard filters, all four export items, and the name button opening the menu from the word-count line too. Start `npx wrangler@4 dev` yourself and stop it afterwards.
- Run `kit doctor` and `kit specs` (both `RESULT: ok`). Do not commit, push, deploy or stash. Report in at most 15 lines, including the RESULT lines.
