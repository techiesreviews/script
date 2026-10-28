# Agent Kit for script-editor

Every model and provider uses `scripts/agents/kit` for coding here. The kit is adapted from the Agent Kit used across Techies Reviews projects (originally the Native Site Editor's). Root paths come from git: the current checkout, and the main checkout for worktrees (`KIT_ROOT` and `KIT_MAIN_ROOT` override them).

- `kit doctor`: checks Node 24+, git, the Claude CLI, npx, kit wiring and the syntax of every JavaScript file. No installs, no network.
- `kit specs [FILE...]`: runs `node --test` on `tests/*.test.mjs`. Evidence goes to `docs/agents/evidence/specs.txt`. Tests use no network and no paid services.
- `kit review --commit FULL_SHA [--ticket FILE]`: read-only review of one commit by Claude `claude-opus-5-5`, effort medium, in a separate session. Evidence goes to `.scratch/reviews/`. The lead runs it after committing only authorized work.
- `kit wait pid PID` or `kit wait output FILE`: bounded waiting for processes or logs that you own.
- `kit deploy`: deploys the live site to https://script.techies.tools (approved by Lex on 2026-10-28) and the workers.dev fallback with wrangler. It is a production deploy, not a preview, and never pushes to GitHub.

The kit has no browser-screenshot command here. The lead checks visible changes in a real browser (desktop and phone width) with `npx wrangler@4 dev` and T3's preview tools.
