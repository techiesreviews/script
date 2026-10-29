# Version 1 build steps

1. `step-a-editor.md`: the editor in the browser: open, edit, save, export, edit bar asks and answer display (no agent transport yet).
2. `step-b-agent.md`: the Worker, live relay and MCP, so a connected agent answers asks.

Later steps have their own files here, up to `step-i-own-broll.md` (B-roll and sketches asked for in the agent's own chat).

Each step is built, checked with `kit specs`, committed and reviewed with `kit review --commit SHA --ticket docs/build/<step>.md`.
