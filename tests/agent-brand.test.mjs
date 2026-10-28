import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentBrand, prettyName } from "../public/agent-brand.js";
import { markIcon } from "../public/together/carets.js";

// Lex, 2026-10-28: the agent shows as its model, with the model's logo, and no "(agent)".
test("agentBrand: MCP clientInfo names and old pretty names become the model's name and logo", () => {
  const table = [
    ["claude-code", "Claude", "ai-claude"],
    ["claude-ai", "Claude", "ai-claude"],
    ["Claude Code", "Claude", "ai-claude"],
    ["Anthropic Desktop", "Claude", "ai-claude"],
    ["codex-mcp-client", "Codex", "ai-openai"],
    ["Codex Mcp Client", "Codex", "ai-openai"],
    ["openai-mcp", "ChatGPT", "ai-openai"],
    ["ChatGPT", "ChatGPT", "ai-openai"],
    ["gemini-cli-mcp-client", "Gemini", "ai-gemini"],
    ["cursor-vscode", "Cursor", "ai-cursor"],
    ["Visual Studio Code", "Copilot", "ai-copilot"],
    ["github-copilot", "Copilot", "ai-copilot"],
    ["my-tool", "My Tool", "ai-sparkle"],
    ["acme-mcp-client", "Acme", "ai-sparkle"],
    ["Zed Client", "Zed", "ai-sparkle"],
    ["", "Agent", "ai-sparkle"],
    [undefined, "Agent", "ai-sparkle"],
  ];
  for (const [raw, name, icon] of table) assert.deepEqual(agentBrand(raw), { name, icon }, String(raw));
});

test("prettyName: readable, short, and never empty", () => {
  assert.equal(prettyName("my_cool-tool"), "My Cool Tool");
  assert.equal(prettyName("My Tool"), "My Tool");
  assert.equal(prettyName("client"), "Client", "a bare 'client' is kept");
  assert.equal(prettyName("   "), "Agent");
  assert.equal(prettyName("x".repeat(300)).length, 60);
});

test("every brand icon is drawn, filled in one colour, with the credits beside them", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  for (const key of ["ai-claude", "ai-openai", "ai-gemini", "ai-cursor", "ai-copilot", "ai-sparkle", "agent"]) {
    assert.match(app, new RegExp(`^  "?${key}"?: '<path `, "m"), key);
  }
  assert.match(app, /Phosphor Icons \(MIT\)/);
  assert.match(app, /Simple Icons \(CC0\)/);
  assert.match(css, /svg\.i \.i-fill \{ fill: currentColor; stroke: none; \}/);
  assert.match(app, /Object\.hasOwn\(ICONS, n\)/, "unknown keys draw nothing");
});

test("carets: an agent's circle shows its own icon key, else the old agent mark; people show a letter", () => {
  assert.equal(markIcon({ kind: "agent", icon: "ai-claude" }), "ai-claude");
  assert.equal(markIcon({ kind: "agent" }), "agent");
  assert.equal(markIcon({ kind: "person", icon: "ai-claude" }), "");
  const src = readFileSync(new URL("../public/together/carets.js", import.meta.url), "utf8");
  assert.match(src, /const key = `\$\{p\.name\}\|\$\{agent\}\|\$\{mark\}\|\$\{p\.undo\}`/, "a new icon redraws the caret");
  assert.match(src, /box\.innerHTML = icon\(mark\)/);
  assert.doesNotMatch(src, /script/i, "public/together knows nothing about scripts");
});
