# Script editor

A calm editor for video scripts. Open a Markdown script, edit it, and let **your own AI agent** help over MCP: select a sentence, pick "Simpler", "Shorter", "Sound like me" or ask anything, and the answer shows in place as before/after with Keep or Undo.

**Live:** https://script.techies.tools

- Edits a plain Markdown file: `## 1 · Hook (0:00–0:30)` sections, `[ON SCREEN: …]` and `[SILENT: …]` notes, and spoken paragraphs. The file stays byte for byte the same where you didn't edit it.
- Saves itself to the file you opened (about 1.5 s after you stop typing). If the file changed on disk, it asks before overwriting.
- A section list with spoken times, a word count and the spoken length.
- Export: the camera script (spoken text only), a prompter file, or **Open in prompter**, which opens the script on [prompter.techies.tools](https://prompter.techies.tools).
- A switcher with your recent scripts and a search.
- "Try a demo script" on the start screen loads a made-up example.

## Your script stays with you

The editor has no accounts and no built-in AI, so it costs nothing to use. Scripts are opened and saved in your browser with the File System Access API (Chrome and Edge; other browsers download a copy). A draft of unsaved changes stays in your browser's local storage.

When you connect an agent, a small live relay (a Cloudflare Durable Object) passes asks and answers between your browser tab and your agent. It never stores script text: it keeps only when the connection was made, whether it was disconnected, and the agent's name and version. The prompter link carries the script in the part after `#`, which browsers never send to a server.

## Connect your agent (MCP)

1. Open a script and click **Connect your agent** → **Wait for MCP**. This copies a connection prompt with a private token.
2. Paste it into Claude Code (or any MCP client that can send an `Authorization` header). It runs:

   ```sh
   claude mcp add --transport http script-editor https://script.techies.tools/mcp --header "Authorization: Bearer <token>"
   ```

3. Use the `watch_script` prompt. Your agent waits for asks and answers each one in place.

Tools: `get_script` (also returns the linked B-roll list), `wait_for_asks`, `answer_ask`, `sketch_shot` (draws a storyboard sketch for a shot), `list_asks`. A connection lasts at most eight hours; **Disconnect MCP** ends it at once. Keep the token private.

## Run it on your computer

You need [Node.js](https://nodejs.org/) 24 or newer. There are no npm dependencies.

```sh
npx wrangler@4 dev               # editor, /mcp and the relay at http://localhost:8787
node --test tests/*.test.mjs     # runs the tests
```

With the local server running, `node scripts/smoke-relay.mjs` checks the relay and MCP end to end. To connect an agent to your local copy, use the prompt from **Wait for MCP**: it already points at `http://localhost:8787/mcp`.

## Deploy your own copy

It runs on the Cloudflare Workers **free plan**: one Worker serves the page as static assets and answers `/mcp` and `/api/relay`, and one SQLite-backed Durable Object class is the relay.

1. Log in: `npx wrangler@4 login`.
2. In `wrangler.jsonc`, change `"name"` if you like, and replace the `routes` entry `script.techies.tools` with your own domain, or remove `routes` to use the `*.workers.dev` address.
3. Deploy: `npx wrangler@4 deploy`.

## Contributing

Issues and pull requests are welcome. Please keep the promises above: no built-in AI calls, no script text on the server, and everything on the Cloudflare free plan. Run `node --test tests/*.test.mjs` before you send a change, and keep changes small.

## Maintainer tooling

`scripts/agents/` holds the Agent Kit, the maintainer's tooling for AI coding agents (checks, tests and reviews). See [`docs/agents/agent-scripts.md`](docs/agents/agent-scripts.md) and [`AGENTS.md`](AGENTS.md). You don't need it to run, test or deploy.

## License

[MIT](LICENSE) © 2026 Techies Reviews
