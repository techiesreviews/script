# Step O: changes land on `dev`, `main` only takes `dev`

Lex (2026-10-31): "Yes a branch can go into dev, main can only get dev." The same day he asked for this in every project ("Yes all of these"). Kitchen tickets 89 and 90 carry it out; this step is the script editor's part. It replaces the branch and extras lines of `step-n-kitchen.md` item 1 (no dev branch, `main` only). Nothing the person writing a script sees changes.

## What changes

- `scripts/agents/kit.json`: `branches.land` and `branches.ci` are `dev`; `branches.release` stays `main`.
- Every change lands on `dev` through `scripts/agents/kit pr` (a PR into `dev`).
- `main` changes only by a release of `dev`: `scripts/agents/kit pr --release --base main` from a branch that is exactly `origin/dev`.
- Lex's standing OK to push and `kit deploy` (2026-10-28) holds: `kit deploy` runs from `main` after a release, and it starts with `scripts/agents/kit release-check`, so it refuses changed and untracked files and anything that is not exactly `origin/main` (files git ignores are not checked) (the kit's rule for a live deploy command).
- `AGENTS.md` and `docs/agents/kitchen-extras.md` say the same.

## Done (2026-10-31)

Evidence: `docs/agents/evidence/step-o-branches.txt` (the commit each run was made at is named there; `kit pr` rebases when it lands, so a later commit with the same subject has a new SHA).

- `scripts/agents/kit doctor` ends `RESULT: ok` and names `dev` as the landing branch.
- `scripts/agents/kit pr --dry-run` from the change's branch fetches and rebases onto `origin/dev`.
- `scripts/agents/kit pr --release --base main --dry-run` from the same branch is refused: "HEAD … is N commits ahead of origin/dev: a release carries only what landed on dev".
- `scripts/agents/kit pr --dry-run --base main` is refused: "--base main requires --release"; `kit pr --release --dry-run` without `--base main` is refused: "--release requires --base main".
- `scripts/agents/kit release-check` on a branch that is not `origin/main` fails, so `kit deploy` stops before wrangler.
- `tests/kit-branches.test.mjs` checks the branch settings, that `kit deploy` runs `kit release-check` before wrangler, and that `AGENTS.md` and the extras say the same.
- `kit doctor` also warns that three setup pieces the kit added since are missing (the brief-guard entry in `.claude/settings.json` and the stop-guard entries in `.claude/settings.json` and `.codex/hooks.json`); they are left for a later `kit init`, because this step changes only the branches.
- Feature list: no change (nothing the person sees changed)
