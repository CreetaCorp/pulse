/**
 * Pulse Agent Tracker — PostToolUse Hook (matcher: Task)
 * Marks a sub-agent as done or error when a Task tool completes.
 *
 * Triggered: After each Task tool invocation
 * Writes: .pulse/agent-dashboard.json
 */

const path = require('path');
const fs = require('fs');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const { completeAgent, loadDashboard } = require(path.join(PLUGIN_ROOT, 'lib', 'agent-tracker'));

function main() {
  try {
    const input = readStdin();

    const hasError = !!(input?.tool_error) || !!(input?.error);
    const status = hasError ? 'error' : 'done';
    const errorMsg = input?.tool_error || input?.error || null;

    const agent = completeAgent(null, status, errorMsg);
    const dashboard = loadDashboard();
    const summary = dashboard.summary;

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        matcher: 'Task',
        plugin: 'pulse-agent-tracker',
        agentId: agent?.id || 'unknown',
        agentName: agent?.name || 'unknown',
        status: agent?.status || status,
        durationMs: agent?.durationMs || null,
        dashboardSummary: {
          total: summary.total,
          running: summary.running,
          done: summary.done,
          error: summary.error,
        },
      },
    }));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
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
