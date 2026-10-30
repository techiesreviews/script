# What the editor does

The feature list of script.techies.tools, moved here from `AGENTS.md` in step N (2026-10-30). Each item names the step that built it (`docs/build/step-*.md`); a dated "Lex, …" is his decision and stays as it is unless he changes it. Add a line here when a step adds or changes something the person sees.

## Writing and saving

- A very simple, clean editor for video scripts. You open a Markdown script and edit it; it saves itself to the file.
- No "Saved" time is shown (Lex, 2026-10-29): only an orange dot for unsaved changes, "Saving…" on Ctrl/Cmd+S and "Not saved" when a save fails.
- A new script is saved in the browser at once (step J) and can be moved to a file with Export → Markdown file.
- The file name opens a switcher of recent scripts.

## Top bar and export

- Export (the orange primary button, last in the top bar) gives everything in one zip ("Export all", first in its menu), the camera script, the prompter file, or opens the script on prompter.techies.tools.
- Share to edit is an icon button, and "Connect your agent" shows the MCP mark until an agent is connected (Lex, 2026-10-29).
- Links in the script (`[words](https://…)`, step G) show as their words and reach the prompter whole, so it opens them as they are read.

## Asks and the person's own agent

- Select text and use the edit bar ("Sound like me", "Simpler", "Shorter", "Explain how it works", "Check facts", "Find links", "Ask…"; "Find links in the script" in the agent menu): this makes an **ask**.
- The person's **own connected agent** (over MCP) answers it: a new text or an addition goes straight into the script, lightly marked, with Undo on the agent's name tag (step F), until the person scrolls past it or 60 minutes are over (step M); a note shows beside the text.
- Asked for a whole script, the agent can also open one of the person's recent scripts, open a new script it wrote, or put in the whole text with an Undo line (step H).

## B-roll

- Asked in its own chat, the agent can suggest B-roll, each new shot with its sketch, and sketch shots in the list; they show with Keep and Undo like answers to asks (step I).
- A sketch can also be a picture the agent made and uploaded (`upload_image`); it is kept in the B-roll list file as a Markdown image (step K).
- A picture for a shot in the list goes in at once with Undo, and a used picture frees its place among the 24 that may wait (step K2).
- Pictures are cut to the storyboard frame and kept small (640 × 345, WebP, about 60 KB; step K3); line drawings stay for agents without an image tool.
- Big pictures in a list made elsewhere, or kept before step K3, are made lighter the same way whenever the list is saved (step K4).
- A shot moves to another paragraph by dragging it, its picture or its tag, straight away (a finger holds it first); while dragging it snaps beside the paragraph it will land on (steps L, L2).

## Working together

- Share to edit, other people's carets and Undo on name tags (step D, `docs/together.md`); guests' asks, the agent's caret, B-roll and `/` parts for guests (step D2).
