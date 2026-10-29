# Script editor

A calm editor for video scripts. Open a Markdown script, edit it, and let **your own AI agent** help over MCP: select a sentence, pick "Simpler", "Shorter", "Sound like me" or ask anything, and the change goes straight into the text, lightly marked, with Undo on your agent's name tag.

**Live:** https://script.techies.tools

- Edits a plain Markdown file: `## 1 · Hook (0:00–0:30)` sections, `[ON SCREEN: …]` and `[SILENT: …]` notes, and spoken paragraphs. The file stays byte for byte the same where you didn't edit it.
- Saves itself to the file you opened (about 1.5 s after you stop typing). If the file changed on disk, it asks before overwriting.
- A new script is saved in your browser at once, named after its title (a "Browser" tag in the switcher). **Export → Markdown file (.md)** moves it to a file on your computer. In the switcher, × and then **Delete** removes a script from the browser.
- A section list with spoken times, a word count and the spoken length.
- Type `/` while writing to add a part: Hook, Intro, Problem, Point, Demo, Recap, Call to action, Close or a named Section (numbered for where it lands; later sections move up), an `[ON SCREEN: ]` or `[SILENT: ]` note, B-roll for the current line, or a divider.
- Export: the camera script (spoken text only), a prompter file, or **Open in prompter**, which opens the script on [prompter.techies.tools](https://prompter.techies.tools).
- B-roll beside the lines: link a B-roll list, add a shot to selected text yourself, or let your agent suggest shots ("Suggest B-roll" on a selection, "Plan B-roll" for the whole script). Every suggested add, change or removal waits for your Keep or Undo.
- A switcher with your recent scripts and a search.
- **Share to edit:** copy a link, and others edit the script with you live, each with their own caret. They type only a name. Your file stays the only copy and keeps saving itself. Guests see the B-roll and can ask your agent too (you see their asks, everyone sees the answers, and only the person who asked or you keep them); they can't save, export, change the B-roll or share it further. Your agent shows its own caret where it works. Stop sharing with ×, or close the tab.
- "Try a demo script" on the start screen loads a made-up example.

## Your script stays with you

The editor has no accounts and no built-in AI, so it costs nothing to use. Scripts are opened and saved in your browser with the File System Access API (Chrome and Edge; other browsers download a copy). New scripts are kept in the browser's own private storage on this computer (Chrome, Edge, Firefox and Safari 26), never on a server; clearing the site's data in the browser deletes them, so save the ones you want to keep as files. A draft of unsaved changes stays in your browser's local storage.

When you share a script, a small room (another Durable Object) passes changes and carets between your tab and your guests. It never stores script text: it keeps only hashes of the link's keys, when the room was made and whether it ended. The key is in the part of the link after `#`, which browsers never send to a server.

When you connect an agent, a small live relay (a Cloudflare Durable Object) passes asks and answers between your browser tab and your agent. It never stores script text: it keeps only when the connection was made, whether it was disconnected, and the agent's name and version. The prompter link carries the script in the part after `#`, which browsers never send to a server.

## Connect your agent (MCP)

1. Open a script and click **Connect your agent** → **Wait for MCP**. This copies a connection prompt with a private token.
2. Paste it into your agent: Claude Code, Codex, Cursor or any other MCP client that can send an `Authorization` header. The prompt gives the server (`https://script.techies.tools/mcp`, Streamable HTTP) and the header (`Authorization: Bearer <token>`), with ready-made settings for Claude Code, Codex and JSON-configured apps, so the agent adds itself the way its own app does.

3. Use the `watch_script` prompt. Your agent waits for asks and answers each one in place.

Tools: `get_script` (also returns the linked B-roll list), `wait_for_asks`, `answer_ask`, `answer_broll` (suggests B-roll adds, changes and removals; a new shot can bring its sketch), `sketch_shot` (draws a storyboard sketch for a shot), `list_asks`, and, when you ask your agent for a whole script, `list_scripts` (your recent scripts), `open_script` (opens one of them, or a new script it wrote) and `set_script` (puts in the open script's whole text, with Undo). `answer_broll` and `sketch_shot` also work when you ask your agent for B-roll or sketches in its own chat. You can connect your agent from the start screen too, so it can write your first script. A connection lasts at most eight hours; **Disconnect MCP** ends it at once. Keep the token private.

## Run it on your computer

You need [Node.js](https://nodejs.org/) 24 or newer. There are no npm dependencies.

```sh
npx wrangler@4 dev               # editor, /mcp and the relay at http://localhost:8787
node --test tests/*.test.mjs     # runs the tests
```

With the local server running, `node scripts/smoke-relay.mjs` checks the relay and MCP end to end, and `node scripts/smoke-room.mjs` checks Share to edit with one host and two guests. To connect an agent to your local copy, use the prompt from **Wait for MCP**: it already points at `http://localhost:8787/mcp`.

## Deploy your own copy

It runs on the Cloudflare Workers **free plan**: one Worker serves the page as static assets and answers `/mcp`, `/api/relay` and `/api/room`, and two SQLite-backed Durable Object classes are the relay and the rooms.

1. Log in: `npx wrangler@4 login`.
2. In `wrangler.jsonc`, change `"name"` if you like, and replace the `routes` entry `script.techies.tools` with your own domain, or remove `routes` to use the `*.workers.dev` address.
3. Deploy: `npx wrangler@4 deploy`.

## Contributing

Issues and pull requests are welcome. Please keep the promises above: no built-in AI calls, no script text on the server, and everything on the Cloudflare free plan. Run `node --test tests/*.test.mjs` before you send a change, and keep changes small.

## Maintainer tooling

`scripts/agents/` holds the Agent Kit, the maintainer's tooling for AI coding agents (checks, tests and reviews). See [`docs/agents/agent-scripts.md`](docs/agents/agent-scripts.md) and [`AGENTS.md`](AGENTS.md). You don't need it to run, test or deploy.

## License

[MIT](LICENSE) © 2026 Techies Reviews
