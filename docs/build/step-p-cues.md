# Step P: bold marking in the editor ("cues" to the agent)

Lex (2026-11-04): cues are optional and off by default; the settings are chosen by the person and by the agent; with cues off the editor works as today. He wants to try cues on one real script before deciding. Spec and decisions: fleet `script-editor-cues-spec.md` (sections 3, 4 and 7), tracked as techiesreviews/fleet#14. This step is the editor part only; the prompter does not read cues yet, so its export strips them by default.

Lex's design change (2026-11-04, spec section 8, folded into this step): the "Cue" button and word are gone. A bold **B** icon button sits before the text input on the edit bar (Ctrl+B / ⌘B, tooltip "Bold (Ctrl+B)"); while it shows, the text input stays at least 200 px wide and the bar wraps, as in the approved mock-up. Marked words show bold, and a "Bold style" setting adds the person's own background and font colour, off by default. Saved as `==words==`. Words the person sees say "bold"; the MCP tool names (`list_cues`, `mark_cue`, `unmark_cue`, `get_cue_settings`, `set_cue_settings`), the setting keys and the code keep "cue". The B button stays hidden until Bold marking is on (Lex's section 7: off by default, today's behaviour unchanged). The autocomplete and Tab hint are fleet issue #25, later.

## What changes

- `public/cues.js` (new): the cue format `==words==`, the settings, the Ctrl/Cmd+B toggle, the rewrite rule and the agent's cue plans. Pure; tests in `tests/cues.test.mjs`.
- `public/app.js`: cues drawn with the links' show/hide trick; Ctrl/Cmd+B and the B button; the Bold settings and Bold style in the file name's menu; the agent's `list_cues`, `mark_cue`, `unmark_cue`, `get_cue_settings`, `set_cue_settings`; `get_script` lists cues while on; the prompter export follows the export setting.
- `public/app.css`: the look in two rules (`.md-cue .md-link__words`): plain bold, or the person's own colours.
- `public/changes.js`: `listCues`, `planCues`, `landCues`; a replace keeps cues whose words survive and says how many went. `public/links.js`: links never land inside a cue. `public/doc.js`: exports and counts read cue words.
- `public/broll.js`: bold marks never change a shot's check or its Over text.
- `worker/mcp.js`: the five tools, their checks, a line in the agent instructions and version 0.9.0.

## Try it (Lex)

Open a script, open the file name's menu, turn on Bold marking. Select a few words and press Ctrl+B (⌘B on a Mac) or B on the selection bar; press again to take it off; Ctrl+Z undoes either. Ask your agent to mark some words, then undo it from its name tag. Try "Use my own colours for bold". Export the prompter file: the words come out plain unless "Bold words in the prompter file" is on.

## Not in this step

The prompter reading cues, a camera action that does something, the shared cue look and reader from the prompter (`public/shared/`).

## Done

- `kit specs`: see `docs/agents/evidence/specs.txt`. Browser: `docs/agents/evidence/step-p-cues-browser.txt` (headless Chrome, real Ctrl+B and clicks, 1280 px and 390 px, the agent over MCP; the name tag's Undo is clicked from script, because a real mouse click there hit the section under it, noted on the PR).
- Ctrl+B in Chrome: the page gets it first and nothing else takes it (Chrome has no Ctrl+B shortcut of its own; with cue marking off it does nothing, as before). Firefox (Ctrl+B opens the bookmarks sidebar unless a page takes it) and Safari (⌘B) are not checked: scripted key input goes to the page and never through the browser's own shortcuts, so this needs a hand check. Due 2026-11-10: Lex (or the lead) presses Ctrl+B in Firefox and ⌘B in Safari on a selection with bold marking on; if a browser takes it, the shortcut becomes Ctrl+Alt+B there (Lex's decision 9).
