import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Lex, 2026-10-29: the copied prompt connects any MCP agent, not only Claude Code.
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
// The test reads the function's source text from app.js and runs it with a stand-in location and token.
const src = app.match(/^function connectionPrompt\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];
const origin = "https://script.techies.tools";
const token = `se2-abcdefgh-${"A".repeat(43)}`;
const prompt = src && new Function("location", "agent", `${src}\nreturn connectionPrompt();`)({ origin }, { token });

test("connection prompt: the server and header come first, for any MCP client", () => {
  assert.ok(src, "connectionPrompt is found in app.js");
  const lines = prompt.split("\n");
  assert.equal(lines[1], `Server: ${origin}/mcp (Streamable HTTP)`);
  assert.equal(lines[2], `Header: Authorization: Bearer ${token}`);
  assert.match(prompt, /already there, replace it/, "a reconnect replaces the old entry");
});

test("connection prompt: the Claude Code, Codex and JSON settings are well formed", () => {
  assert.ok(prompt.includes(`claude mcp add --transport http script-editor ${origin}/mcp --header "Authorization: Bearer ${token}"`));
  assert.ok(prompt.includes(`[mcp_servers.script-editor]\n     url = "${origin}/mcp"\n     http_headers = { Authorization = "Bearer ${token}" }`));
  const json = JSON.parse(prompt.match(/^\s*(\{ "mcpServers".*\})$/m)[1]);
  assert.deepEqual(json.mcpServers["script-editor"], { url: `${origin}/mcp`, headers: { Authorization: `Bearer ${token}` } });
});

test("connection prompt: it names the prompt and the tools that answer asks", () => {
  for (const name of ["watch_script", "wait_for_asks", "answer_ask", "answer_broll", "sketch_shot"]) assert.ok(prompt.includes(name), name);
});
