// What the tab and the Worker both know about the agent link (worker/mcp.js imports it too), written once.
// A token lives at most eight hours; then the tab replaces it as Disconnect MCP does, and the Worker refuses it.
export const TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000;
// The answer to wait_for_asks when nothing was asked: from the tab, or from the Worker when the wait runs out.
export const NO_ASKS = "No asks yet. Call wait_for_asks again to keep listening.";
