// Who the connected agent is, for its caret, its avatar and the agent button: the model's own name and logo
// ("Claude", "Codex", …, no "(agent)"; Lex, 2026-10-28). Pure: no DOM. The icon keys are drawn by app.js (ICONS).
// The logos are their makers' trademarks, used only to name the connected agent.

const BRANDS = [
  [/claude|anthropic/i, "Claude", "ai-claude"],
  [/codex/i, "Codex", "ai-openai"],
  [/chatgpt|openai/i, "ChatGPT", "ai-openai"],
  [/gemini/i, "Gemini", "ai-gemini"],
  [/cursor/i, "Cursor", "ai-cursor"],
  [/copilot/i, "Copilot", "ai-copilot"], // not VS Code itself: it can run any model
];

/** An MCP clientInfo name made readable: "my-tool" → "My Tool"; names with capitals or spaces stay as they are.
 *  A trailing "mcp client" / "client" is dropped ("acme-mcp-client" → "Acme"). */
export function prettyName(n) {
  let name = String(n || "").trim();
  const bare = name.replace(/[\s_-]+(?:mcp[\s_-]+)?client$/i, "");
  if (bare.trim()) name = bare.trim();
  if (!name) return "Agent";
  name = /[A-Z ]/.test(name) ? name : name.split(/[-_]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return name.slice(0, 60);
}

/** The agent's name and icon key from its clientInfo name, or from a name already made pretty (old asks keep
 *  "Claude Code"). Unknown agents keep their own name with the sparkle. */
export function agentBrand(name) {
  const raw = String(name || "");
  const hit = BRANDS.find(([re]) => re.test(raw));
  return hit ? { name: hit[1], icon: hit[2] } : { name: prettyName(raw), icon: "ai-sparkle" };
}
