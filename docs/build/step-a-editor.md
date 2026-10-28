# Step A: the editor in the browser

Goal: Lex can open a Markdown video script, edit it in the clean interface of the approved mock-up, save it back to the same file, and export the camera script and the prompter file. Selecting text shows the edit bar. Each action creates an **ask**, and the ask's answer shows in place. In this step, answers arrive only through a test hook. Step B adds the agent connection.

Read first: `AGENTS.md`, `docs/agents/agent-scripts.md`, the approved mock-up, kept outside this repository (copy its look, tokens, edit bar, before/after change, voice-card and prompter-view CSS; adapt as needed) and the good-css skill (a maintainer coding guide) (with the references for what you write).

## Files

- `public/index.html`: the app shell. `public/app.css`: styles. `public/app.js`: UI (ES module). `public/doc.js`: a pure module (no DOM) for parsing, serializing, exports and ask anchoring, imported by the app and by the tests.
- `public/_headers`: `/*` → `X-Robots-Tag: noindex` and `Cache-Control: no-store`. `public/robots.txt`: `Disallow: /`.
- `wrangler.jsonc`: name `script-editor`, compatibility_date `2026-10-27`, `workers_dev: true`, `preview_urls: false`, `assets.directory: ./public`. Assets only in this step; step B adds the Worker.
- `package.json`: `"type": "module"`, private, scripts `dev` (`npx --yes wrangler@4 dev`), `test` (`node --test tests/*.test.mjs`). No runtime dependencies, no build step.
- `docs/data-shape.md`: the document and ask data shape (below), written for a future multiplayer build.
- `tests/doc.test.mjs`: unit tests for `doc.js`.
- Sample: `public/samples/demo-backup-wordpress.md` (a made-up demo script; the first build used a private one). Fixtures are in `tests/fixtures/`. Do not edit anything outside this repository.

## Document model (`doc.js`)

- `parse(markdown)` gives `{ blocks: [{ id, type, text, sep }], tail }`. Split on runs of 2+ newlines. `sep` is the exact separator text before the block (`""` for the first block), and `tail` is the trailing whitespace. `serialize(doc)` must give back **exactly** the input for any file; test it on both fixtures and on edge cases (CRLF, no trailing newline, 3 blank lines, a heading directly followed by text on the next line).
- Types: `title` (a single line starting with `# `), `heading` (a single line starting with `## `), `note` (a block wrapped in `[` … `]`, such as `[ON SCREEN: …]` and `[SILENT: …]`), `raw` (lists `- `/`* `/`1. `, tables `|`, `---`, quotes `>`, code fences; keep a fence with blank lines inside it as one block) and `para` (everything else). If a block's first line is a `#`/`##` heading followed by more lines, split it into a heading block and a rest block, using `sep: "\n"`, so it still round-trips.
- Block ids are stable: random, short, and kept across edits. New blocks get `sep: "\n\n"`.
- Sections: every `heading` starts one. A section is **spoken** when its heading starts with a number (`## 1 · Hook (0:00–0:40)`). When no heading is numbered, all sections are spoken. Text before the first heading is the front matter: show the title, and show the rest as muted `raw`/`para` blocks.
- `exportCamera(doc)`: the `para` text of spoken sections only, with no headings, notes or raw blocks, joined by one blank line, ending with a newline. Collapse soft line breaks inside a paragraph into spaces.
- `exportPrompter(doc)`: the prompter Markdown read by the original prompter page (kept outside this repository; its `parse()` is copied into `tests/doc.test.mjs`, and see `tests/fixtures/prompter-example.md`). It starts with `# <title>`. For each spoken section it writes `---`, a blank line, then `### **<N> · <TITLE IN CAPITALS> · <M:SS start time>**` (the time comes from `(0:40–2:00)` in the heading; leave out ` · time` when there is none). Paragraphs are split into one sentence per line, with a blank line between paragraphs. Notes stay as one line each, with the brackets kept. Test: run the prompter's own parse logic (copy its regexes into the test) on the export of the fixture and check 9 sections, their titles and times, and that no line is lost.
- Word count and spoken length: words in spoken paragraphs, at 160 words a minute.

## Interface (match the mock-up)

- **Top bar:** brand mark, then the file name with a save state ("Saved 22:41", or an orange dot for unsaved changes) and below it "1,360 words · 8:30 spoken". On the right: **Open**, **Save** (Ctrl/Cmd+S), **Export** (a menu: "Camera script (.txt)" and "Prompter (.md)"). Leave room for the "Sounds like me" and "Connect your agent" buttons that step B adds; render them disabled.
- **Empty state** (no script open): centered, three buttons: "Open a script", "New script", and "Try a demo script" (loads the sample). If a recent file handle is stored, also show "Reopen <name>".
- **Files:** use `showOpenFilePicker`/`showSaveFilePicker` with `.md`/`.markdown`/`.txt` and write through the handle. Keep the last handle in IndexedDB so the file can be reopened after a reload (ask for permission again). Fallback where the API is missing: `<input type=file>` and a download on Save. Keep an autosave draft in localStorage per file name. When a newer unsaved draft exists on open, show one quiet row above the title: "Unsaved changes from 22:41 · Restore · Discard". Warn on `beforeunload` when there are unsaved changes.
- **Layout:** section list (left, sticky; becomes a sticky row of chips on a phone), script (centre), and a "One script feeds" panel (right) with **Camera script** and **Prompter** rows. Each row shows "In sync" or "Updated just now" after edits; clicking a row opens a preview dialog (camera text in mono; the prompter as big white text on black with a reading line and slow auto-scroll, Pause/Play) that also has a Download button. Copy these from the mock-up. Leave out the B-roll and motion rows (a later step).
- **Blocks:** each `para`, `note` and `heading` is its own `contenteditable="plaintext-only"` element with `white-space: pre-wrap` (fall back to `true` where `plaintext-only` is missing). Notes look small and muted with a soft background. Raw blocks are editable too, in mono and muted. The title is editable. Section headings look like the mock-up's section heads and are editable.
- **Editing:**
  - Enter splits a para or note at the caret into two blocks. Shift+Enter inserts a line break inside the block.
  - Backspace at the very start of a para merges it into the previous para or note. Backspace in an empty block removes it.
  - Typing `## ` at the start of a para turns it into a heading; Enter at the end of a heading adds a para after it.
  - Pasted text is plain.
  - The model updates on `input`.
  - Your own undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) covers text and structure: snapshots of the blocks, grouped while typing (about 600 ms), restoring the caret's block.
- **Edit bar** (as in the mock-up and the editor's edit-bar.css): it shows on a non-empty selection inside one block and is placed above the selection (below if there is no room). On narrow screens it docks at the bottom. Its label says the word count. The buttons are "Sound like me", "Simpler", "Shorter", "Explain how it works", "Check facts", and an "Ask…" field. A selection that crosses blocks is clamped to the first block, and half words snap to whole words.
- **Asks:** picking an action creates an ask (see the data shape) and marks the selected text in place with a soft orange pending highlight, plus a small chip at its end: the action's icon and name, a pulsing dot, and ✕ to cancel. There is no other message. Asks are kept in memory and in localStorage with the draft. Anchors follow edits: keep `start`/`end` offsets plus the `quote`; after an edit in that block, re-find the quote nearest the old offset, or drop the ask if it is gone. The "Sounds like me" whole-script check is an ask with `scope: "script"` (the button stays disabled until step B, but the model and rendering are built now).
- **Answers:** `receiveAnswer(askId, answer)` is exported from `app.js` and also exposed as `window.__scriptEditor.answer(askId, answer)` for tests and step B. Answer kinds:
  - `replace` `{ text }`: in place, the old text is struck through and the new text is marked, followed by an inline bar with the action name, Undo and Keep. This is the mock-up's `.change`.
  - `add` `{ text }`: new text added after the quote, with the same bar.
  - `note` `{ text, tone: "ok" | "look" }`: the mock-up's `.checked` + `.note` chip, dismissed with ✕.
  - `marks` `{ marks: [{ quote, why, rewrite }] }`: only for `scope: "script"`. These are dashed orange underlines on each quote, with the mock-up's voice card on hover, focus or tap ("Use this" turns it into a `replace` suggestion; "Keep mine" removes the mark), and a count on the "Sounds like me" button plus dashed dots in the section list.
  - An optional `message` (at most 200 characters) shows as a small line under the change bar.
  - Keep writes the new text into the model as one undo step and briefly glows (the mock-up's `.landed`). Undo drops the answer and leaves the text as it was. Both close the ask.
- No toasts, no explainer text, no `alert()`. The interface shows what happened where it happened.

## Data shape (`docs/data-shape.md`)

Describe and use:

- `Document { blocks: Block[], tail }`, with `Block { id, type, text, sep }`.
- `Ask { id, scope: "selection" | "script", blockId?, start?, end?, quote?, context? (the block text), section? (heading text), action: "like" | "simpler" | "shorter" | "explain" | "facts" | "ask" | "voice", instruction (the action's standard instruction, or the typed Ask text), by: { id, name }, createdAt, status: "waiting" | "taken" | "answered" | "kept" | "undone" | "cancelled", answer?, answeredBy? }`.
- Standard instructions, stored in `doc.js`:
  - like: "Rewrite in the speaker's own voice: plain spoken words, short sentences, everyday metaphors. Keep the meaning and facts."
  - simpler: "Use simpler words and shorter sentences a beginner understands."
  - shorter: "Say the same in fewer words."
  - explain: "Add one or two plain sentences that explain how this works."
  - facts: "Check names, numbers and dates against what you know or can look up. Answer with a note."
  - voice: "Mark lines in the spoken text that sound generic or AI-like, with a one-line reason and a rewrite in the speaker's voice."
- How multiplayer fits later: stable block ids, an author on every ask, answer and edit, and room for `people` and `carets { personId, blockId, offset }`. One page at most.

## Checks

- Run `scripts/agents/kit doctor` before you start and `scripts/agents/kit specs` before you hand over; both must end `RESULT: ok`.
- `node --check` must pass for every file. Do not commit, push or deploy, and do not use git stash. Leave changes unstaged.
- Final report, at most 20 lines: the changed files, what works, the test results with their RESULT lines, and open risks. The lead does the browser checks.
