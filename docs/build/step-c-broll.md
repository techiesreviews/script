# Step C: B-roll and motion plates in the script

Goal: the script shows which lines have B-roll, and the B-roll list and motion plates live in the left column (Lex chose this, 2026-10-28). It matches the approved mock-up: the chat workspace's `sites/script-editor-mockup/index.html`, read only, with its `.broll-tag`, covered-line rule, `data-lit` and `.shot` styles.

## Source: a B-roll Markdown file next to the script

- Format: Lex's B-roll lists are Markdown tables. Use the demo below as the reference format.
  - Main table columns: `# | What to show | Over (A-roll line) | How to make it`.
  - An optional `## Screen recordings` table has columns `# | What to record | Over (A-roll line)`.
- **Over** quotes the first words of the spoken line, often ending in `…`, or gives a range: `"Let me walk you through…" through "you installing it."`. Match each quote to the spoken block that starts with (or contains) those words, ignoring quotes, `…`, case and punctuation. A range covers every spoken block from the first match to the last.
- **Motion plates** are rows whose "How to make it" mentions "motion" (for example "Motion plate", "motion graphic", or "Slide or motion plate").
- **Screen recordings** are the rows from the Screen recordings table (ids like S1).
- **Linking the file:** the left column's B-roll group shows "Link B-roll list…" until a file is linked. Linking picks the `.md` file (with an `<input type=file>` fallback). Remember its handle per script in IndexedDB, re-read it on open (asking permission again if needed), and allow "Unlink". The demo script links its own demo list automatically.
- **Demo:** add `public/samples/demo-good-script-broll.md`, a made-up list for the demo script. Use 8–10 shots over its real lines, including one range, two motion plates and two screen recordings.

## In the script (match the mock-up)

- **Tags:** a small tag in the right margin beside the first line of each shot ("B-roll B4", with a film, motion or screen icon). Draw a thin rule beside every line the shot covers. In narrow layouts the tag sits above the line. Tags are not part of the text and are never saved into the script.
- **Clicking a tag** lights up the covered lines and the shot in the list. Clicking a shot in the list scrolls to its lines and lights them up.
- **Check flags:** when a covered line changes (typing, a Keep or an undo), its tag gets a small orange dot, and the shot gets the dot and "Check" in the list. Lighting the shot clears its flag. Keep the flags with the draft, so they survive a reload.
- **Unmatched shots:** a shot whose Over text matches nothing goes to the list under "Not found in the script", in muted text, with its Over text.

## In the left column (under the section list)

- **Two groups that open and close** (the closed or open state is remembered):
  - "B-roll · 14", listing every shot including screen recordings: the id, a "What to show" summary and the check dot.
  - "Motion plates · 3", listing only the motion rows.
- **Phones:** the section chips row gets one more chip, "B-roll", which opens the same list as a sheet.
- **Agent context:** `get_script` (worker and tab) also returns `broll: [{ id, what, over, how, kind: "broll" | "motion" | "screen", blockIds, check }]`, so the agent can take the B-roll into account. Update the tool description.

## Checks

- **Unit tests:** parsing the table (including the demo and a copy of the shape of a real list with `…` and `through` ranges), quote-to-block matching, motion and screen detection, and a check flag after a change.
- Run `kit doctor` and `kit specs`. Do the browser check at desktop and phone width (start `npx wrangler@4 dev` yourself and stop it afterwards).
- Do not commit, push, deploy or stash. Report in at most 15 lines, including the RESULT lines.

## Addition (Lex, 2026-10-28): storyboard sketches

Reference: `docs/build/storyboard-sketch.html` (open it in a browser). It is the demo's 10 shots with simple line-drawing sketches, the left column with small thumbnails, and a storyboard grid.

- **Demo shots:** use exactly these 10 shots, ids, "What to show" and "Over" lines for `public/samples/demo-good-script-broll.md`, and turn the SVG helpers into static SVG markup.
- **Where sketches live:** in the B-roll file itself, under `## Sketches`, as fenced blocks: ```` ```svg B4 ```` … ```` ``` ````. They use a viewBox of `0 0 260 140` and only these classes: `s` (ink line), `l` (soft line), `o` (orange accent), `mv` (dashed orange movement) and plain `text`. The editor gives these classes their colours, so sketches follow light and dark mode.
- **Sanitising:** allow only `svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` and `text`, with geometry attributes, `class`, `text-anchor` and `transform`. Drop everything else: scripts, event handlers, `href` and `style`.
- **Left column:** each shot row shows its sketch as a 72 px thumbnail, or an empty dashed frame when there is none.
- **Storyboard view:** a "Storyboard" toggle at the top of the B-roll group opens a grid of all frames in script order, as in the reference: frame, id, kind tag, what, and Over. Clicking a frame jumps to its line. On phones it is one column.
- **The agent draws missing sketches:** a quiet "Ask for sketches" in the storyboard view creates an ask with `scope: "broll"` and `action: "sketch"`, listing the shots that have no sketch. The agent answers with a new MCP tool `sketch_shot { askId, shotId, svg }` (one call per shot, svg at most 8 KB, sanitised by the tab).
  - The tab shows each sketch with Keep or Undo in the frame.
  - Keep writes the sketch into the B-roll file's `## Sketches` section through the linked file handle (asking permission when needed), so it stays with the file.
  - Add the instruction text to `doc.js` ACTIONS. Add tests for the sanitiser, parsing and writing the Sketches section, and the tool's limits.
