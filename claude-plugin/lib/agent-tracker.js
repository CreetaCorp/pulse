/**
 * Pulse Agent Tracker
 * Tracks agent lifecycle for the Pulse real-time dashboard.
 *
 * State file: .pulse/agent-dashboard.json (relative to project root)
 * Cross-platform: Windows (Git Bash) + macOS + Linux
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────

const DASHBOARD_DIR = '.pulse';
const DASHBOARD_FILE = 'agent-dashboard.json';
const SCHEMA_VERSION = 'pulse-agent-dashboard/1.0.0';
const MAX_COMPLETED_AGENTS = 50;
const MAX_ERROR_LOG = 20;

// ── Path Resolution ──────────────────────────────────────

function getProjectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function getDashboardPath() {
  return path.join(getProjectRoot(), DASHBOARD_DIR, DASHBOARD_FILE);
}

function ensureDashboardDir() {
  const dashboardPath = getDashboardPath();
  const dir = path.dirname(dashboardPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dashboardPath;
}

// ── Schema ───────────────────────────────────────────────

function createDefaultDashboard() {
  return {
    $schema: SCHEMA_VERSION,
    session: {
      id: generateSessionId(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'active',
    },
    agents: [],
    summary: {
      total: 0,
      pending: 0,
      running: 0,
      done: 0,
      error: 0,
    },
    errors: [],
    lastUpdatedAt: new Date().toISOString(),
  };
}

function createAgentEntry(description, options = {}) {
  return {
    id: options.id || generateAgentId(),
    name: options.name || extractAgentName(description),
    description: (description || '').substring(0, 200),
    parentId: options.parentId || null,
    status: 'pending',
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    error: null,
  };
}

// ── State Operations ─────────────────────────────────────

function loadDashboard() {
  const dashboardPath = getDashboardPath();
  try {
    if (fs.existsSync(dashboardPath)) {
      const raw = fs.readFileSync(dashboardPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && data.$schema && data.agents && data.session) {
        return data;
      }
    }
  } catch {
    // Corrupted file, start fresh
  }
  return createDefaultDashboard();
}

function saveDashboard(dashboard) {
  const dashboardPath = ensureDashboardDir();
  dashboard.lastUpdatedAt = new Date().toISOString();
  recalculateSummary(dashboard);

  const json = JSON.stringify(dashboard, null, 2);
  try {
    const tempPath = dashboardPath + '.tmp.' + process.pid;
    fs.writeFileSync(tempPath, json, 'utf-8');
    fs.renameSync(tempPath, dashboardPath);
    return true;
  } catch {
    // Fallback: direct write (Windows rename can fail across drives)
    try {
      fs.writeFileSync(dashboardPath, json, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
}

function initSession() {
  const dashboard = createDefaultDashboard();

  // Register main agent automatically
  const mainAgent = createAgentEntry('Main Agent', {
    id: 'main',
    name: 'Main Agent',
    parentId: null,
  });
  mainAgent.status = 'running';
  dashboard.agents.push(mainAgent);

  saveDashboard(dashboard);
  return dashboard;
}

function registerAgent(description, options = {}) {
  const dashboard = loadDashboard();
  const agent = createAgentEntry(description, {
    parentId: options.parentId || 'main',
    ...options,
  });
  agent.status = 'running';
  dashboard.agents.push(agent);
  saveDashboard(dashboard);
  return agent;
}

function completeAgent(agentId, status, errorMsg) {
  const dashboard = loadDashboard();
  let agent;

  if (agentId) {
    agent = dashboard.agents.find(a => a.id === agentId);
  } else {
    // Find the most recent running agent (exclude main)
    agent = [...dashboard.agents]
      .reverse()
      .find(a => a.status === 'running' && a.id !== 'main');
  }

  if (!agent) return null;

  agent.status = status || 'done';
  agent.endedAt = new Date().toISOString();
  agent.durationMs = new Date(agent.endedAt) - new Date(agent.startedAt);

  if (status === 'error' && errorMsg) {
    agent.error = errorMsg.substring(0, 500);
    dashboard.errors.push({
      agentId: agent.id,
      agentName: agent.name,
      error: errorMsg.substring(0, 500),
      at: agent.endedAt,
    });
    if (dashboard.errors.length > MAX_ERROR_LOG) {
      dashboard.errors = dashboard.errors.slice(-MAX_ERROR_LOG);
    }
  }

  // Trim completed agents
  const completed = dashboard.agents.filter(a => a.status === 'done' || a.status === 'error');
  if (completed.length > MAX_COMPLETED_AGENTS) {
    const toRemove = completed.slice(0, completed.length - MAX_COMPLETED_AGENTS);
    const removeIds = new Set(toRemove.map(a => a.id));
    removeIds.delete('main'); // Never remove main agent
    dashboard.agents = dashboard.agents.filter(a => !removeIds.has(a.id));
  }

  saveDashboard(dashboard);
  return agent;
}

function endSession(status) {
  const dashboard = loadDashboard();
  dashboard.session.endedAt = new Date().toISOString();
  dashboard.session.status = status || 'completed';

  // Mark any still-running agents as error (orphaned)
  for (const agent of dashboard.agents) {
    if (agent.status === 'running' || agent.status === 'pending') {
      agent.status = agent.id === 'main' ? 'done' : 'error';
      agent.endedAt = dashboard.session.endedAt;
      if (agent.id !== 'main') {
        agent.error = 'Session ended while agent was still running';
      }
      agent.durationMs = new Date(agent.endedAt) - new Date(agent.startedAt);
    }
  }

  saveDashboard(dashboard);
  return dashboard;
}

// ── Helpers ──────────────────────────────────────────────

function recalculateSummary(dashboard) {
  const agents = dashboard.agents || [];
  dashboard.summary = {
    total: agents.length,
    pending: agents.filter(a => a.status === 'pending').length,
    running: agents.filter(a => a.status === 'running').length,
    done: agents.filter(a => a.status === 'done').length,
    error: agents.filter(a => a.status === 'error').length,
  };
}

function generateSessionId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `sess_${ts}_${rand}`;
}

function generateAgentId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(2).toString('hex');
  return `agent_${ts}_${rand}`;
}

function extractAgentName(description) {
  if (!description) return 'unnamed-task';
  const firstLine = description.split('\n')[0]
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .trim();
  if (firstLine.length <= 40) return firstLine || 'unnamed-task';
  return firstLine.substring(0, 37) + '...';
}

// ── Module Exports ───────────────────────────────────────

module.exports = {
  loadDashboard,
  saveDashboard,
  initSession,
  registerAgent,
  completeAgent,
  endSession,
  createDefaultDashboard,
  createAgentEntry,
  getDashboardPath,
  ensureDashboardDir,
  recalculateSummary,
  generateSessionId,
  generateAgentId,
  extractAgentName,
};
