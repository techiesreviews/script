# What the editor does

The feature list of script.techies.tools, moved here from `AGENTS.md` in step N (2026-10-30). Each item names the step that built it (`docs/build/step-*.md`); a dated "Lex, …" is his decision and stays as it is unless he changes it. Add a line here when a step adds or changes something the person sees.

## Writing and saving

- A very simple, clean editor for video scripts. You open a Markdown script and edit it; it saves itself to the file.
- No "Saved" time is shown (Lex, 2026-10-29): only an orange dot for unsaved changes, "Saving…" on Ctrl/Cmd+S and "Not saved" when a save fails.
- A new script is saved in the browser at once (step J) and can be moved to a file with Export → Markdown file.
- The file name opens a switcher of recent scripts.
- Bold words (steps P and S; "cues" to the agent and in the code), always on (Lex, 2026-11-06): Ctrl+B (⌘B on a Mac) or the **B** button before the text input on the selection bar marks the selected words, and again takes it off; one Ctrl/Cmd+Z step each. They show orange and bold, like the prompter (the prompter's bright orange in dark mode, a darker orange that reads on white in light mode), their `**` marks only while the caret is in them. **Bold style** in the file name's menu is the only setting: a font colour and a background, with Reset once one is chosen. The prompter shows `**` as literal asterisks today, so the prompter file always holds plain words. Saved as Markdown bold, `**words**`: a `**` pair at word boundaries is bold, while `a**b`, `**kwargs` and `2**3` stay plain. Deleting all of a bold stretch's words takes its marks with them, also for guests. A guest's edit inside the host's open ask (or "Sounds like me" mark) closes it, so it never jumps to a later copy of its words. Known limits: an edit that would turn a bold line into another kind of block (a list or heading once the marks go) is refused, quietly; rare edits next to bold lines can leave marks as text; shared scripts have edge cases.

## Top bar and export

- Export (the orange primary button, last in the top bar) gives everything in one zip ("Export all", first in its menu), the camera script, the prompter file, or opens the script on prompter.techies.tools.
- Share to edit is an icon button, and "Connect your agent" shows the MCP mark until an agent is connected (Lex, 2026-10-29).
- Links in the script (`[words](https://…)`, step G) show as their words and reach the prompter whole, so it opens them as they are read.

## Asks and the person's own agent

- Select text and use the edit bar: this makes an **ask** ("Find links in the script" in the agent menu makes one for the whole script). The bar holds only the **B** button and a text input (step T, Lex 2026-11-04). Type an ask in your own words, or a command: Shorter, Simpler, Sound like me, B-roll (or Suggest B-roll), Add B-roll, Explain how it works, Check facts, Find links, or More, which opens a small menu with those last three. As you type, a grey ghost shows the rest of the suggestion after the caret (the commands, then your earlier asks, kept in this browser only), with a small **Tab** key beside it that never changes the input's size. Tab or pressing the key takes it, Up and Down switch it, Enter sends what is typed (empty: nothing), and Escape closes without changing the text. The input itself shows **Sending…**. B-roll over words that aren't spoken, or Add B-roll as a guest, says why in grey and sends nothing.
- The bar sits below the selected words, so they and the line above stay readable; with no room below it goes above them, one line clear when that fits. On a phone it is docked at the bottom, above the on-screen keyboard, and at the top when it would sit on the words. While the focus is in the bar the selected words stay marked.
- The person's **own connected agent** (over MCP) answers it: a new text or an addition goes straight into the script, lightly marked, with Undo on the agent's name tag (step F), until the person scrolls past it or 60 minutes are over (step M); a note shows beside the text.
- The agent can list bold words, and mark or remove them (each lightly marked, with Undo on its name tag); a rewrite keeps bold words that survive and tells the agent when some went.
- A script's new name (its title in the browser, Save as) redraws nothing on the page (step Q).
- The file name's menu scrolls inside itself on a short window, so the bold colours are always reachable; the agent can suggest B-roll over words that cross a bold edge (it reads the spoken text without the `**` marks) (step R).
- Asked for a whole script, the agent can also open one of the person's recent scripts, open a new script it wrote, or put in the whole text with an Undo line (step H).

## B-roll

- Asked in its own chat, the agent can suggest B-roll, each new shot with its sketch, and sketch shots in the list; they show with Keep and Undo like answers to asks (step I).
- A sketch can also be a picture the agent made and uploaded (`upload_image`); it is kept in the B-roll list file as a Markdown image (step K).
- A picture for a shot in the list goes in at once with Undo, and a used picture frees its place among the 24 that may wait (step K2).
- From two open pictures on, one bar with "Keep all" and "Undo all" sits in its own row at the top of the script and the storyboard, so it can never cover text; a Keep all can't be undone, like a single Keep (step Q).
- Pictures are cut to the storyboard frame and kept small (640 × 345, WebP, about 60 KB; step K3); line drawings stay for agents without an image tool.
- Big pictures in a list made elsewhere, or kept before step K3, are made lighter the same way whenever the list is saved (step K4).
- A shot moves to another paragraph by dragging it, its picture or its tag, straight away (a finger holds it first); while dragging it snaps beside the paragraph it will land on (steps L, L2).

## Working together

- Share to edit, other people's carets and Undo on name tags (step D, `docs/together.md`); guests' asks, the agent's caret, B-roll and `/` parts for guests (step D2).
