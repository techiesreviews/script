# Version 1 build steps

1. `step-a-editor.md`: the editor in the browser: open, edit, save, export, edit bar asks and answer display (no agent transport yet).
2. `step-b-agent.md`: the Worker, live relay and MCP, so a connected agent answers asks.

Later steps have their own files here, up to `step-m-marks-fade.md` (the agent's highlight goes away by itself), `step-n-kitchen.md` (the shared kitchen and tidying after the retro), `step-o-land-on-dev.md` (changes land on `dev`, `main` only takes `dev`), `step-q-keep-all-images.md` (Keep all and Undo all for the agent's pictures), `step-p-cues.md` (bold marking, first optional and off by default), `step-r-bold-follow-ups.md` (its follow-ups) and `step-s-bold-always-on.md` (bold always on, only its colours are settings); `step-l-move-broll.md` and `step-l2-drag-shots.md` move a B-roll shot to another paragraph.

Each step is built, checked with `kit specs`, committed and reviewed with `kit review --commit SHA --ticket docs/build/<step>.md`.
