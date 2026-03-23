/**
 * Pulse Agent Tracker — Stop Hook
 * Finalizes the session and marks orphaned agents as error.
 *
 * Triggered: When the main agent finishes (Stop event)
 * Writes: .pulse/agent-dashboard.json
 */

const path = require('path');
const fs = require('fs');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const { endSession, getDashboardPath } = require(path.join(PLUGIN_ROOT, 'lib', 'agent-tracker'));

function main() {
  try {
    const input = readStdin();
    const stopReason = input?.stop_reason || 'unknown';
    const sessionStatus = stopReason === 'error' ? 'error' : 'completed';

    const dashboard = endSession(sessionStatus);
    const summary = dashboard.summary;

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        plugin: 'pulse-agent-tracker',
        sessionId: dashboard.session.id,
        sessionStatus: dashboard.session.status,
        stopReason,
        finalSummary: {
          total: summary.total,
          done: summary.done,
          error: summary.error,
          sessionDuration: calculateDuration(dashboard.session.startedAt, dashboard.session.endedAt),
        },
        dashboardPath: getDashboardPath(),
      },
    }));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        plugin: 'pulse-agent-tracker',
        error: err.message,
      },
    }));
    process.exit(0);
  }
}

function calculateDuration(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso) - new Date(startIso);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
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
