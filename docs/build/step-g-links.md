# Step G: links that open by themselves in the prompter

Lex's choice (2026-10-28): when a script mentions a tool, a site or a source, the right page should open by itself while he records. The prompter (prompter.techies.tools, repo `techies-prompter`, read-only from here) already does that part: a link on a line opens on its "main screen" window when the reading line reaches it, and with Follow my voice saying the link's words opens it. Its format lives in `techies-prompter/src/core.mjs` (`classify`, `textLinks`, `parse`). This step makes the editor hold links, show them cleanly, let the agent find them, and hand them to the prompter whole. Built after step F (answers land straight in).

## Format in the script

- A link inside a spoken line is Markdown: `[words](https://full-address)`. Only `https://` and `http://` addresses; the words are what is spoken.
- A line of its own `- Label: https://full-address` in a spoken section is a prompter link line (the first one right under a heading opens when the section starts).
- Links are not used in `[reminders]` or headings (the prompter ignores them there).

## 1. Links reach the prompter

- `exportPrompter` keeps every link whole: sentence splitting never splits inside `[…](…)`, and link lines pass through unchanged, in their place.
- The camera script (`exportCamera`) shows only the words. Word counts and the spoken time count only the words, never the address.
- Tests: a link whose words hold ". X", a link at the start and end of a sentence, a link line under a heading and mid-section, word counts.

## 2. Links look clean in the editor

- A link shows as its words with a faint dotted underline, like the prompter; `[`, `](` and the address are hidden while the caret is outside the link. With the caret inside (or a selection touching it), the full Markdown shows so it can be edited. The text model keeps the Markdown, so offsets, asks, carets and the room are unchanged.
- Pointing at a link (fine pointer) shows the address as its title. Ctrl/Cmd+click opens it in a new tab; a plain click only places the caret.
- Works alone and in a shared room, in light and dark, desktop and phone.

## 3. The agent finds links

- **Find links** joins the edit bar's More menu. On a selection it asks about that text (also for guests); with nothing selected it asks about the whole script (host only, like the other whole-script jobs).
- The agent answers with `answer_ask` kind `links`: `links: [{ quote, url }]`, at most 30, where `quote` is words copied exactly from the spoken text and `url` a full `https://` address. The host's tab turns each quote's first unlinked occurrence (inside the asked text) into `[quote](url)`, as one change that lands straight in, marked, with Undo on the agent's name tag (step F). Quotes not found, already linked, or inside reminders and headings are skipped and listed back to the agent.
- Agent instructions: link the official page (the maker's own site, the exact docs page or the original source), never a search page, a shortener or an affiliate link; skip a mention when unsure.
- MCP checks: `https:`/`http:` only, length limits, no `javascript:` or `data:`.

## Checks

`kit specs` (format, export, link parsing, the `links` answer and its checks), a browser check (link display, caret in and out, Ctrl/Cmd+click, Find links end to end with a fake agent, alone and shared), and `smoke-relay.mjs` with a `links` answer. Then open the exported prompter link and check that a link opens on the main screen.
