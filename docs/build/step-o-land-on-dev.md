# Step O: changes land on `dev`, `main` only takes `dev`

Lex (2026-10-31): "Yes a branch can go into dev, main can only get dev." The same day he asked for this in every project ("Yes all of these"). Kitchen tickets 89 and 90 carry it out; this step is the script editor's part. It replaces the branch line of `step-n-kitchen.md` item 1 (no dev branch). Nothing the person writing a script sees changes.

## What changes

- `scripts/agents/kit.json`: `branches.land` and `branches.ci` are `dev`; `branches.release` stays `main`.
- Every change lands on `dev` through `scripts/agents/kit pr` (a PR into `dev`).
- `main` changes only by a release of `dev`: `scripts/agents/kit pr --release --base main` from a branch that is exactly `origin/dev`.
- Lex's standing OK to push and `kit deploy` (2026-10-28) holds: `kit deploy` runs from `main` after a release.
- `AGENTS.md` and `docs/agents/kitchen-extras.md` say the same.

## Done (2026-10-31)

- `scripts/agents/kit doctor` ends `RESULT: ok` and names `dev` as the landing branch.
- `scripts/agents/kit pr --dry-run` from the change's branch fetches and rebases onto `origin/dev`.
- `scripts/agents/kit pr --release --base main --dry-run` from the same branch is refused: "HEAD … is 1 commit ahead of origin/dev: a release carries only what landed on dev".
- Feature list: no change (nothing the person sees changed)
