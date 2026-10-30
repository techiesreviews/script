# Handoff: script-editor version 1 (updated 2026-10-30)

Dated to-dos are written as a line `Due YYYY-MM-DD: <what>`, so `kit doctor` can list overdue ones. None is open.

Version 1 is live at https://script.techies.tools (open to search engines since 2026-10-28, no-store; the workers.dev address is the fallback). Steps A and B are built, reviewed with `kit review` (evidence in `.scratch/reviews/main/`), fixed and deployed with `kit preview` (now `kit deploy`). A real Claude Code agent answered an ask on the live page over MCP. Smoke evidence: `docs/agents/evidence/smoke-relay.txt`.

Open, low priority (from the step B review): move `followPieces`/`takeUnseen` into `doc.js` with tests, show the message on a "Sounds like me" answer, and Undo-after-Keep should bring back the suggestion. The legacy 43-character token branch (`LEGACY_UNTIL`) was removed in step N (2026-10-30), after its date; a 43-character token is now refused as malformed. Notes from before 2026-10-28 that are never used again (a few dozen relay notes and ended rooms from testing, and any room that was live during that deploy) have no alarm and stay; they hold no script text.

The repo is github.com/techiesreviews/script (main). Next steps from the plan: B-roll both ways (step 2), multiplayer after the editor's agents + multiplayer build.

2026-10-28: Lex's feedback is done and live: the script is centred; the brand, Save button and feeds panel are removed; saving is automatic, with a per-script save queue; a script switcher with search; Export → Open in prompter (prompter.techies.tools link); dark mode in Techies Reviews night blue. Each change was reviewed with `kit review` and its findings fixed.
2026-10-28: the domain is live and the Open button is gone (opening is in the script menu and on the start screen). `kit preview` is renamed `kit deploy`, because it deploys the live site.

## Lex's decisions, 2026-10-28

- Kept: the "Type / for parts" hint; `/` parts follow the script's numbering (no numbers in a script without them); whole-script jobs (Sound like me, Plan B-roll, Ask for sketches) stay host-only.
- The agent's caret, avatar and button show the model's own name and logo ("Claude", not "Claude (agent)"); the sparkle for others.
- The site is open to search engines (no more `noindex` on pages; `/api/` and `/mcp` stay `noindex`). The old mock-up Worker (`script-editor-mockup`) is deleted.
- Plan decisions: scripts stay files (A); everyone brings their own agent (A); a separate site, not a mode in the Native Site Editor (A). How AI changes land: **straight into the text (B)**, lightly marked, with Undo on the agent's name tag, for everyone's asks, guests' too (step F).
- Standing OK: push to GitHub and `kit deploy` once a feature has passed `kit specs` and `kit review`.
- Live 2026-10-29: step F (answers land straight in, marked, Undo on the agent's tag) and step G (links: clean in the editor, Find links, whole in the prompter). Checked live: an answer lands and Undo restores it; a found link shows as its words and opens from the prompter's link row.
