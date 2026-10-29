# script-editor (script.techies.tools)

A very simple, clean editor for video scripts. You open a Markdown script and edit it; it saves itself to the file. The file name opens a switcher of recent scripts. Export gives the camera script, the prompter file, or opens the script on prompter.techies.tools; links in the script (`[words](https://…)`, step G) show as their words and reach the prompter whole, so it opens them as they are read. Select text and use the edit bar ("Sound like me", "Simpler", "Shorter", "Explain how it works", "Check facts", "Find links", "Ask…"; "Find links in the script" in the agent menu): this makes an **ask**. The person's **own connected agent** (over MCP) answers it: a new text or an addition goes straight into the script, lightly marked, with Undo on the agent's name tag (step F); a note shows beside the text. Asked for a whole script, the agent can also open one of the person's recent scripts, open a new script it wrote, or put in the whole text with an Undo line (step H).

Owner: Lex (non-technical; explain in plain words). The approved mock-up and the plan are kept outside this repository; this file, `docs/data-shape.md` and the code are the reference here.

## Rules

- **No paid usage.** There are no built-in AI API calls, ever. All AI work is done by the person's own agent through MCP. Cloudflare free plan only: Workers, static assets, and SQLite-backed Durable Objects for the live relay and for the rooms of Share to edit.
- **Scripts stay with the person.** Files are opened and saved in the browser (File System Access API, with download as a fallback). The relay passes asks and answers between the tab and the agent and never stores script text.
- Every stored note has an expiry date and cleans itself; keys carry their birth date. Each Durable Object sets an alarm for its note's end and empties itself with `deleteAll()`; agent tokens are made by the Worker with its own time inside (`docs/data-shape.md`). Notes written before 2026-10-28 get their alarm only when they are used again (`docs/build/handoff.md`).
- Address: https://script.techies.tools (Lex approved 2026-10-28; workers.dev stays as a fallback). Search engines may list the site (Lex, 2026-10-28); HTTP answers from `/api/` and `/mcp` stay `noindex`. Lex's standing OK (2026-10-28): push to GitHub and deploy with `kit deploy` once a feature has passed `kit specs` and `kit review`.
- Never touch the Native Site Editor repos or its live site. Copy its approach (agents over MCP, asks like its "pins for asking agents", caret and edit-bar look), not its code.
- No toasts and no explainer text: the interface shows what happens where it happens. Calm neutral look in light mode and Techies Reviews night blue in dark mode, with the warm orange `#ff6a3d` as the only accent. CSS follows the good-css skill: logical properties, oklch colours, hover inside `(hover: hover) and (pointer: fine)`, motion inside `prefers-reduced-motion: no-preference`.
- Working together is built in step D: Share to edit, other people's carets and the undo on name tags (`docs/together.md`). The host's file stays the only copy; a room passes changes and carets between tabs and never stores script text. Guests' asks, the agent's caret, B-roll and `/` parts for guests are built too (step D2); `docs/data-shape.md` describes the shared asks.

## Agent Kit

Read `docs/agents/agent-scripts.md`. Run `scripts/agents/kit help` and `scripts/agents/kit doctor` before you change code, and `scripts/agents/kit specs` before you hand over.
