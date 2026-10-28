# Handoff: script-editor version 1 (updated 2026-10-27, late evening)

Version 1 is live at https://script.techies.tools (noindex, no-store; the workers.dev address is the fallback). Steps A and B are built, reviewed with `kit review` (evidence in `.scratch/reviews/main/`), fixed and deployed with `kit preview`. A real Claude Code agent answered an ask on the live page over MCP. Smoke evidence: `docs/agents/evidence/smoke-relay.txt`.

Open, low priority (from the step B review): move `followPieces`/`takeUnseen` into `doc.js` with tests, check 4003 for a revoked token's tab in the smoke test, show the message on a "Sounds like me" answer, and Undo-after-Keep should bring back the suggestion.

Waiting for Lex: a GitHub repo (he said yes on 2026-10-28, but the GitHub key here cannot create repositories), and the four open decisions in the plan (kept outside this repository). Next steps from the plan: B-roll both ways (step 2), multiplayer after the editor's agents + multiplayer build.

2026-10-28: Lex's feedback is done and live: the script is centred; the brand, Save button and feeds panel are removed; saving is automatic, with a per-script save queue; a script switcher with search; Export → Open in prompter (prompter.techies.tools link); dark mode in Techies Reviews night blue. Each change was reviewed with `kit review` and its findings fixed.
2026-10-28: the domain is live and the Open button is gone (opening is in the script menu and on the start screen). `kit preview` is renamed `kit deploy`, because it deploys the live site.
