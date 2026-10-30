# Kitchen extras: script-editor

`scripts/agents/kit rulebook` prints the shared rulebook, then this file. Where they differ, this
file wins. The project's own rules are in `AGENTS.md`; the build steps are in `docs/build/`.

## Branches, checks and the shared file

- **Landing branch `main`, release branch `main`** (`branches` in `scripts/agents/kit.json`). There
  is no dev branch. The GitHub repo is `techiesreviews/script`.
- **No PR flow** unless Lex asks for one: a reviewed change is merged into `main` and pushed. The
  shared stations' `kit pr`, `kit pr --release` and Tuesday "ship it" do not apply here.
- **Checks:** `checks.test` is `node --test tests/*.test.mjs`; run it through `kit specs` before
  every hand-over and before `kit review`. `checks.doctor` adds the Claude CLI and a `node --check`
  of every JavaScript file to `kit doctor`.
- **Own commands** (`scripts/agents/project.d`):
  - `kit specs [FILE...]`: the unit tests, evidence in `docs/agents/evidence/specs.txt`.
  - `kit deploy`: the live site, https://script.techies.tools, and the workers.dev fallback, with
    wrangler. A production deploy, not a preview; it never pushes to GitHub.
- **Shared file:** none is set. `public/app.js` is the big file most steps touch; two builders in
  it at once should expect to merge.
- **Docs the shared rulebook names:** no runner guide, issue tracker guide or UX rulebook. A change
  Lex asks for is a step file `docs/build/step-<letter>-<slug>.md` opening "Lex (YYYY-MM-DD): …"
  (`docs/build/README.md` lists them); the UX rules
  are in `AGENTS.md` (Rules). Dated to-dos are written as a line `Due YYYY-MM-DD: <what>`.

## Visible changes

- **Feature list:** the first paragraph of `AGENTS.md`. No `kit ux` checks are scripted for this project yet.
- **Screenshots and real input:** start the site with
  `scripts/agents/kit bg dev -- npx --yes wrangler@4 dev --port <free port>` and headless Chrome
  with `kit bg` too, drive it over CDP (desktop and 390 px phone width), stop both with
  `kit bg --stop <name>`; never `pkill` a pattern that matches your own shell. Evidence: `docs/agents/evidence/step-<x>-browser.txt`.

## After a merge

- None: there are no preview deploys. Lex tries a change on the live site.

## Release

- **Lex's standing OK (2026-10-28):** once a change has passed `kit specs` and `kit review`, push
  `main` to GitHub and run `scripts/agents/kit deploy`; its `RESULT: ok deploy …` line is the
  evidence. Check the live page after the deploy. `docs/build/handoff.md` records what is live.

## Other

- Never touch the Native Site Editor repos or its live site (`AGENTS.md`).
- **Pins** (the same as the shared table, kept here on purpose):

| Role | Model | How |
| --- | --- | --- |
| Review, every change | `claude-opus-5-5`, medium | `scripts/agents/kit review --commit <SHA> --ticket docs/build/<step>.md` |
