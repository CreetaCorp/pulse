/**
 * Pulse Agent Tracker — PreToolUse Hook (matcher: Task)
 * Registers a sub-agent when a Task tool starts.
 *
 * Triggered: Before each Task tool invocation
 * Writes: .pulse/agent-dashboard.json
 */

const path = require('path');
const fs = require('fs');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const { registerAgent } = require(path.join(PLUGIN_ROOT, 'lib', 'agent-tracker'));

function main() {
  try {
    const input = readStdin();
    const toolInput = input?.tool_input || {};
    const description = toolInput.description || toolInput.prompt || toolInput.task || '';

    const agent = registerAgent(description, { parentId: 'main' });

    console.log(JSON.stringify({
      decision: undefined,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        matcher: 'Task',
        plugin: 'pulse-agent-tracker',
        agentId: agent.id,
        agentName: agent.name,
        status: agent.status,
      },
    }));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        matcher: 'Task',
        plugin: 'pulse-agent-tracker',
        error: err.message,
      },
    }));
    process.exit(0);
  }
}

function readStdin() {
  try {
    const data = fs.readFileSync(0, 'utf-8');
    if (data) return JSON.parse(data);
  } catch {}
  if (process.argv[2]) {
    try { return JSON.parse(process.argv[2]); } catch {}
  }
  return {};
}

main();
