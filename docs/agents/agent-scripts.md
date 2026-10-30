# Agent Kit for script-editor

Every model and provider uses `scripts/agents/kit` for coding here. Since step N (2026-10-30) the project runs the shared kit, the kitchen (github.com/techiesreviews/agent-kit): the launcher `scripts/agents/kit` runs the machine copy in `~/.local/share/agent-kit/current` (filled by `kit update`), and `scripts/agents/kit.json` holds this project's settings. `scripts/agents/kit` lists every command; `scripts/agents/kit <command> --help` explains one; `scripts/agents/kit rulebook` prints the shared rulebook and this project's extras (`docs/agents/kitchen-extras.md`).

The commands used most here:

- `kit doctor`: checks that the worktree is safe to build in (settings, base, hooks, Node), plus this project's `checks.doctor`: the Claude CLI and a `node --check` of every JavaScript file. No installs, no deploys.
- `kit specs [FILE...]` (this project's own, `scripts/agents/project.d/specs`): runs `node --test` on `tests/*.test.mjs`. Evidence goes to `docs/agents/evidence/specs.txt`. Tests use no network and no paid services.
- `kit review --commit FULL_SHA [--ticket FILE]`: read-only review of one commit by Claude `claude-opus-5-5`, effort medium (the kit's defaults), in a separate session. Evidence goes to `.scratch/reviews/` in the main checkout. The lead runs it after committing only authorized work.
- `kit bg <name> -- <command…>`, `kit bg --list`, `kit bg --stop <name>`: start, list and stop detached jobs you own (a dev server, headless Chrome). Logs in `.scratch/kit-jobs/<name>/`.
- `kit wait pid PID`, `kit wait output FILE`, `kit wait job NAME`: bounded waiting for processes, logs or `kit bg` jobs you own.
- `kit deploy` (this project's own, `scripts/agents/project.d/deploy`): deploys the live site to https://script.techies.tools (approved by Lex on 2026-10-28) and the workers.dev fallback with wrangler. It is a production deploy, not a preview, and never pushes to GitHub.

There is no screenshot command here. Visible changes are checked in a real browser: the site with `scripts/agents/kit bg dev -- npx --yes wrangler@4 dev --port <port>` and headless Chrome under `kit bg`, driven over CDP at desktop and 390 px phone width, or with T3's preview tools.
