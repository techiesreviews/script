# Step H: the agent opens a script or puts in its whole text

Lex (2026-10-29): the connected agent can open a script, or put in the text of the script directly. Lex chose:

1. **A new script from the agent opens right away.** The script open now is saved first (as when the person switches) and stays in the recent list. The new one has no file yet: it shows as unsaved, is kept as a draft, and the first save asks where.
2. **A whole new text goes straight in, with an Undo line.** A line at the top of the script says "Claude replaced the text · Undo". Undo puts the old text back exactly, while the agent's text is untouched (the line goes at the first edit). Ctrl/Cmd+Z takes it back too.
3. **The agent may open the person's recent scripts** (the switcher under the file name). When the browser needs the person's OK to read the file, a line "Claude wants to open … · Open · Not now" shows (on the start screen too), and the agent is told so.
4. **"Connect your agent" is on the start screen too**, so the agent can write a first script. Never in a guest's tab.

## Tools (`worker/mcp.js`)

- `list_scripts`: `{ open, recent: [{ name, openedAt, open }] }`, newest first.
- `open_script`: `{ name }` (a recent script) or `{ markdown, fileName? }` (a new script; the name is cleaned, ends in `.md`, and gets `-2`, `-3`… when a recent file or a kept draft has it: `scriptFileName` in `public/doc.js`). Refused while the script is shared (it would end the sharing), while a Restore/Discard or changed-file choice is open, and while the open script has unsaved changes but no file yet (leaving it would leave it only as a hidden draft): the agent asks the person to save it first. The "wants to open" line's Not now, a refused browser prompt, or a click that is no longer allowed brings back an Undo line it covered. While that line waits for the person, `open_script` and `set_script` are refused ("Try again after they answer"), so nothing else can take its place; Not now wins over an Open whose browser prompt is still up, and an Open runs once.
- `set_script`: `{ markdown }`, the open script's whole text. Paragraphs left word for word keep their ids (`keepIds`), so their asks, notes and marked changes stay; asks on text that is gone are cancelled. One Ctrl/Cmd+Z step when alone; in a shared script it goes out as the agent's change, and the line's Undo puts the old text back as a change of the host's. The file keeps its own line endings. The same text again changes nothing. Refused while a Restore/Discard or changed-file choice is open.
- Markdown is at most 200,000 characters; a file name at most 120. `INSTRUCTIONS` says to use these only when the person asks for a whole script.

## Checks

`tests/doc.test.mjs` (`scriptFileName`, `keepIds`) and `tests/mcp.test.mjs` (the nine tools, arguments, instructions, the call reaching the tab). In a real browser (headless Chrome, local Worker, MCP over fetch): the start-screen button, `list_scripts` and `get_script` with nothing open, `open_script` from Markdown (name, unsaved, draft), `set_script` (text, the Undo line, the kept and the cancelled ask), the same text again, Undo and Ctrl/Cmd+Z, an unknown name, refused while the open new script has no file, the warning before the tab closes, a name with a kept draft getting `-2`; recent scripts in the browser's own file system: `list_scripts` newest first, `open_script` by name in any capitals, "already open", a file that needs the OK (the line, Not now and a refused prompt bringing back the Undo line, the OK opening it after the script before was saved to its file); desktop and 390 px. `scripts/smoke-relay.mjs` lists the nine tools.
