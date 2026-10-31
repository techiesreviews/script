// The kit's hook entries in .claude/settings.json and .codex/hooks.json are the ones kit init writes: the push
// guard, the subagent cap and brief guard, and the stop guard. Run: node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = path => JSON.parse(readFileSync(join(root, path), "utf8"));
const files = [".claude/settings.json", ".codex/hooks.json"];
const commands = groups => (groups ?? []).flatMap(group => (group.hooks ?? []).map(hook => hook.command));
const runs = name => command => command.endsWith(`/scripts/agents/hooks/run.sh ${name}`);
// A group with no matcher matches every tool, as in Claude Code and Codex.
const matches = (matcher, tool) => new RegExp(`^(?:${matcher ?? ".*"})$`).test(tool);
const runsOn = (groups, tool, name) => (groups ?? []).some(group => matches(group.matcher, tool) && commands([group]).some(runs(name)));

test("both files run the push guard on Bash and the stop guard, and only it, when a turn ends", () => {
  for (const path of files) {
    const { hooks } = read(path);
    assert.ok(runsOn(hooks?.PreToolUse, "Bash", "bash-guard"), `${path}: Bash runs bash-guard`);
    const stop = commands(hooks?.Stop);
    assert.equal(stop.length, 1, `${path} has one Stop command`);
    assert.ok(runs("stop-guard")(stop[0]), `${path} Stop runs stop-guard`);
  }
});

test("Claude runs the brief guard on every way to start a subagent, and agent-cap counts native subagents", () => {
  const { hooks } = read(".claude/settings.json");
  for (const tool of ["Agent", "Task", "mcp__t3-code__delegate_task"]) assert.ok(runsOn(hooks?.PreToolUse, tool, "brief-guard"), `brief-guard runs on ${tool}`);
  // agent-cap skips booking a slot for a brief the brief guard refuses only when this exact command ending is there.
  // It counts native subagents only, so delegate_task gets the brief guard and no agent-cap.
  for (const event of ["PreToolUse", "PostToolUse", "PostToolUseFailure"]) {
    for (const tool of ["Agent", "Task"]) assert.ok(runsOn(hooks?.[event], tool, "agent-cap"), `${event}: agent-cap runs on ${tool}`);
    assert.ok(!runsOn(hooks?.[event], "mcp__t3-code__delegate_task", "agent-cap"), `${event}: no agent-cap on delegate_task`);
  }
  // Codex has no Agent or Task tool to brief, so no brief guard (as in the kit's own hook file).
  assert.ok(!Object.values(read(".codex/hooks.json").hooks ?? {}).flatMap(commands).some(runs("brief-guard")), "Codex runs no brief-guard");
});

/** The hook names the kit's hooks/run.sh passes on (its case line), or why they cannot be read. */
function kitHooks() {
  try {
    const home = execFileSync(join(root, "scripts/agents/kit"), ["--home"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
    const runner = join(home, "hooks/run.sh");
    if (!existsSync(runner)) return { reason: "no Agent Kit hooks on this machine" };
    const names = /^case \$1 in ([\w|-]+)\)/m.exec(readFileSync(runner, "utf8"))?.[1].split("|");
    return names ? { names } : { reason: "the kit's hooks/run.sh has no case line" };
  } catch { return { reason: "no Agent Kit on this machine" }; }
}

test("every hook name either file uses is one the kit runs", t => {
  const { names, reason } = kitHooks();
  if (!names) return t.skip(reason);
  for (const path of files) {
    for (const command of Object.values(read(path).hooks ?? {}).flatMap(commands)) {
      const name = /\/scripts\/agents\/hooks\/run\.sh (\S+)$/.exec(command)?.[1];
      assert.ok(name && names.includes(name), `${path}: ${command}`);
    }
  }
});
