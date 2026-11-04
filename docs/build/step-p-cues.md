# Step P: cue marking in the editor

Lex (2026-11-04): cues are optional and off by default; the settings are chosen by the person and by the agent; with cues off the editor works as today. He wants to try cues on one real script before deciding. Spec and decisions: fleet `script-editor-cues-spec.md` (sections 3, 4 and 7), tracked as techiesreviews/fleet#14. This step is the editor part only; the prompter does not read cues yet, so its export strips them by default.

## What changes

- `public/cues.js` (new): the cue format `==words==`, the settings, the Ctrl/Cmd+B toggle, the rewrite rule and the agent's cue plans. Pure; tests in `tests/cues.test.mjs`.
- `public/app.js`: cues drawn with the links' show/hide trick; Ctrl/Cmd+B and the Cue button; the Cues settings in the file name's menu; the agent's `list_cues`, `mark_cue`, `unmark_cue`, `get_cue_settings`, `set_cue_settings`; `get_script` lists cues while on; the prompter export follows the export setting.
- `public/app.css`: the cue look in one rule (`.md-cue .md-link__words`), from the accent tokens, to be swapped for the prompter's shared look.
- `public/changes.js`: `listCues`, `planCues`, `landCues`; a replace keeps cues whose words survive and says how many went. `public/links.js`: links never land inside a cue. `public/doc.js`: exports and counts read cue words.
- `worker/mcp.js`: the five tools, their checks and a line in the agent instructions.

## Try it (Lex)

Open a script, open the file name's menu, turn on Cue marking. Select a few words and press Ctrl+B (⌘B on a Mac) or Cue on the selection bar; press again to take it off; Ctrl+Z undoes either. Ask your agent to mark a cue, then undo it from its name tag. Export the prompter file: the cue words come out plain unless "Cues in the prompter file" is on.

## Not in this step

The prompter reading cues, a camera action that does something, the shared cue look and reader from the prompter (`public/shared/`).

## Done

- `kit specs`: see `docs/agents/evidence/specs.txt`. Browser: `docs/agents/evidence/step-p-cues-browser.txt` (headless Chrome, real Ctrl+B and clicks, 1280 px and 390 px, the agent over MCP).
- Ctrl+B in Chrome: the page gets it first and nothing else takes it (Chrome has no Ctrl+B shortcut of its own; with cue marking off it does nothing, as before). Firefox (Ctrl+B opens the bookmarks sidebar unless a page takes it) and Safari (⌘B) are not checked: scripted key input goes to the page and never through the browser's own shortcuts, so this needs a hand check. Due 2026-11-10: Lex (or the lead) presses Ctrl+B in Firefox and ⌘B in Safari on a selection with cue marking on; if a browser takes it, the shortcut becomes Ctrl+Alt+B there (Lex's decision 9).
