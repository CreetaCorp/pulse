/**
 * Pulse Agent Tracker — SessionStart Hook
 * Initializes dashboard state and registers main agent.
 *
 * Triggered: Once at session start
 * Writes: .pulse/agent-dashboard.json
 */

const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const { initSession, getDashboardPath } = require(path.join(PLUGIN_ROOT, 'lib', 'agent-tracker'));

function main() {
  try {
    const dashboard = initSession();

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        plugin: 'pulse-agent-tracker',
        sessionId: dashboard.session.id,
        dashboardPath: getDashboardPath(),
        mainAgent: 'registered',
      },
    }));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        plugin: 'pulse-agent-tracker',
        error: err.message,
      },
    }));
    process.exit(0);
  }
}

main();
