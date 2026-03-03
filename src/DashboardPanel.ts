import * as vscode from 'vscode';
import { DashboardState, AgentEntry } from './types';
import { TranscriptEntry } from './TranscriptReader';

/**
 * Manages the WebView panel for the Creet Agent Dashboard.
 * Shows real-time agent status with a cyberpunk-inspired UI.
 */
export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private static readonly viewType = 'creetDashboard';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static createOrShow(extensionUri: vscode.Uri): DashboardPanel {
    const column = vscode.ViewColumn.Beside;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Creet Agent Dashboard',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel);
    return DashboardPanel.currentPanel;
  }

  /** Single-project (backward compat) */
  updateState(state: DashboardState): void {
    this.panel.webview.postMessage({ type: 'updateProject', project: 'default', data: state });
  }

  /** Multi-project: sends one project's state */
  updateProjectState(project: string, state: DashboardState): void {
    this.panel.webview.postMessage({ type: 'updateProject', project, data: state });
  }

  clearAll(): void {
    this.panel.webview.postMessage({ type: 'clearAll' });
  }

  postTranscriptEntry(entry: TranscriptEntry): void {
    this.panel.webview.postMessage({ type: 'transcript', data: entry });
  }

  private dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  private getHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Creet Agent Dashboard</title>
  <style nonce="${nonce}">
    :root {
      --creet-pink: #ff3b8b;
      --creet-blue: #3b82f6;
      --creet-navy: #0f172a;
      --creet-green: #22c55e;
      --creet-red: #ef4444;
      --creet-yellow: #eab308;
      --creet-gray: #64748b;
      --bg: var(--vscode-editor-background, #0e0e12);
      --fg: var(--vscode-editor-foreground, #e2e8f0);
      --border: var(--vscode-panel-border, #1e293b);
      --card-bg: var(--vscode-sideBar-background, #12121a);
      --subtle: var(--vscode-descriptionForeground, #94a3b8);
      --font-mono: var(--vscode-editor-font-family, 'JetBrains Mono', 'Fira Code', monospace);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      overflow-x: hidden;
      position: relative;
    }

    /* Scanline overlay */
    body::after {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0,0,0,0.03) 2px,
        rgba(0,0,0,0.03) 4px
      );
      z-index: 9999;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 16px;
    }

    /* Header */
    .header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
      margin-bottom: 16px;
      position: relative;
    }

    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, var(--creet-pink), var(--creet-blue), var(--creet-navy));
    }

    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 8px;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .logo-text {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .logo-text .pink { color: var(--creet-pink); }
    .logo-text .blue { color: var(--creet-blue); }

    .live-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(239, 68, 68, 0.15);
      color: var(--creet-red);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .live-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--creet-red);
      animation: pulse 1.5s ease-in-out infinite;
    }

    .live-badge.idle { background: rgba(100,116,139,0.15); color: var(--creet-gray); }
    .live-badge.idle .live-dot { background: var(--creet-gray); animation: none; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .session-info {
      display: flex;
      gap: 16px;
      margin-top: 8px;
      color: var(--subtle);
      font-size: 11px;
    }

    /* Progress bar */
    .progress-section {
      margin-bottom: 16px;
    }

    .progress-bar-track {
      width: 100%;
      height: 4px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
    }

    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--creet-pink), var(--creet-blue));
      border-radius: 2px;
      transition: width 0.5s ease;
      position: relative;
    }

    .progress-bar-fill::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
      animation: shimmer 2s infinite;
    }

    @keyframes shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }

    .stats-row {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      font-size: 11px;
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .stat-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .stat-dot.running { background: var(--creet-blue); }
    .stat-dot.done { background: var(--creet-green); }
    .stat-dot.pending { background: var(--creet-yellow); }
    .stat-dot.error { background: var(--creet-red); }

    /* Agent grid */
    .agent-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }

    .agent-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      position: relative;
      overflow: hidden;
      transition: border-color 0.3s, opacity 0.3s;
    }

    .agent-card::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      border-radius: 3px 0 0 3px;
      transition: background 0.3s, box-shadow 0.3s;
    }

    .agent-card.running { border-color: rgba(59,130,246,0.3); }
    .agent-card.running::before {
      background: var(--creet-blue);
      box-shadow: 0 0 8px var(--creet-blue);
      animation: edge-pulse 2s ease-in-out infinite;
    }

    .agent-card.done { opacity: 0.75; }
    .agent-card.done::before { background: var(--creet-green); }

    .agent-card.pending { opacity: 0.6; }
    .agent-card.pending::before { background: var(--creet-yellow); }

    .agent-card.error { border-color: rgba(239,68,68,0.3); }
    .agent-card.error::before { background: var(--creet-red); }

    @keyframes edge-pulse {
      0%, 100% { box-shadow: 0 0 4px var(--creet-blue); }
      50% { box-shadow: 0 0 12px var(--creet-blue); }
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .agent-name {
      font-weight: 600;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 70%;
    }

    .status-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 8px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-badge.running {
      background: rgba(59,130,246,0.2);
      color: var(--creet-blue);
    }
    .status-badge.done {
      background: rgba(34,197,94,0.2);
      color: var(--creet-green);
    }
    .status-badge.pending {
      background: rgba(234,179,8,0.2);
      color: var(--creet-yellow);
    }
    .status-badge.error {
      background: rgba(239,68,68,0.2);
      color: var(--creet-red);
    }

    .card-desc {
      color: var(--subtle);
      font-size: 11px;
      margin-bottom: 8px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      transition: all 0.2s;
    }

    .agent-card.expanded .card-desc {
      -webkit-line-clamp: unset;
      display: block;
      overflow: visible;
      white-space: pre-wrap;
      word-break: break-word;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      margin-bottom: 8px;
    }

    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: var(--subtle);
    }

    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--border);
      border-top-color: var(--creet-blue);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 4px;
      vertical-align: middle;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes card-enter {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .agent-card {
      animation: card-enter 0.3s ease-out;
    }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 48px 16px;
      color: var(--subtle);
    }

    .empty-state .icon {
      font-size: 32px;
      margin-bottom: 12px;
      opacity: 0.4;
    }

    .empty-state .title {
      font-size: 14px;
      font-weight: 600;
      color: var(--fg);
      margin-bottom: 4px;
    }

    /* Footer */
    .footer {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: var(--subtle);
    }

    /* Live transcript log */
    .agent-card.expanded {
      grid-column: 1 / -1;
    }

    .card-toggle {
      cursor: pointer;
      user-select: none;
    }

    .transcript-log {
      display: block;
      margin-top: 8px;
      border-top: 1px solid var(--border);
      padding-top: 8px;
      max-height: 400px;
      overflow-y: auto;
      font-size: 11px;
      line-height: 1.6;
      scroll-behavior: smooth;
    }

    .transcript-log::-webkit-scrollbar {
      width: 4px;
    }
    .transcript-log::-webkit-scrollbar-track {
      background: transparent;
    }
    .transcript-log::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 2px;
    }

    .log-entry {
      padding: 3px 0;
      border-bottom: 1px solid rgba(255,255,255,0.03);
      animation: log-fade-in 0.3s ease-out;
    }

    @keyframes log-fade-in {
      from { opacity: 0; transform: translateX(-4px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .log-entry .log-icon {
      display: inline-block;
      width: 16px;
      text-align: center;
      margin-right: 4px;
      opacity: 0.7;
    }

    .log-entry.role-assistant .log-icon { color: var(--creet-blue); }
    .log-entry.role-user .log-icon { color: var(--creet-pink); }

    .log-entry.type-tool_use {
      color: var(--creet-yellow);
      font-family: var(--font-mono);
    }

    .log-entry.type-text.role-assistant {
      color: var(--fg);
    }

    .log-entry.type-text.role-user {
      color: var(--creet-pink);
      opacity: 0.8;
    }

    .log-entry.type-thinking {
      color: var(--subtle);
      font-style: italic;
      opacity: 0.75;
    }

    .log-content {
      word-break: break-word;
    }

    .log-time {
      color: var(--subtle);
      font-size: 9px;
      margin-left: 4px;
      opacity: 0.6;
    }

    .expand-hint {
      font-size: 9px;
      color: var(--subtle);
      margin-top: 4px;
      text-align: center;
      opacity: 0.6;
    }

    .agent-card.running .expand-hint {
      opacity: 1;
      color: var(--creet-blue);
    }

    /* Project tabs */
    .project-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }

    .project-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--subtle);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .project-tab:hover {
      border-color: var(--creet-blue);
      color: var(--fg);
    }

    .project-tab.active {
      border-color: var(--creet-blue);
      background: rgba(59,130,246,0.1);
      color: var(--creet-blue);
    }

    .project-tab.has-running {
      border-color: rgba(59,130,246,0.4);
    }

    .project-tab.has-running.active {
      border-color: var(--creet-blue);
    }

    .tab-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--creet-gray);
    }

    .project-tab.has-running .tab-dot {
      background: var(--creet-blue);
      animation: pulse 1.5s ease-in-out infinite;
    }

    @media (max-width: 480px) {
      .session-info { flex-direction: column; gap: 4px; }
      .agent-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-row">
        <div class="logo">
          <span class="logo-text">
            <span class="pink">/cc</span> <span class="blue">Agent Monitor</span>
          </span>
        </div>
        <div id="liveBadge" class="live-badge idle">
          <span class="live-dot"></span>
          <span id="liveText">IDLE</span>
        </div>
      </div>
    </div>

    <div id="progressFill" style="display:none"></div>
    <span id="sessionId" style="display:none"></span>
    <span id="sessionTime" style="display:none"></span>
    <span id="elapsed" style="display:none"></span>
    <span id="statRunning" style="display:none"></span>
    <span id="statDone" style="display:none"></span>
    <span id="statPending" style="display:none"></span>
    <span id="statError" style="display:none"></span>
    <span id="lastUpdate" style="display:none"></span>

    <div id="projectTabs" class="project-tabs" style="display:none"></div>

    <div id="agentGrid" class="agent-grid">
      <div class="empty-state">
        <div class="icon">&#x25C8;</div>
        <div class="title">Waiting for agents</div>
        <div>Run <code>/cc</code> in Claude Code to start multi-agent execution</div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

      let elapsedTimer = null;
      let sessionStartTime = null;
      const transcriptLogs = {}; // agentId -> [entries]
      let expandedAgentId = null;

      // Multi-project state
      const projectStates = {}; // projectName -> DashboardState
      let activeProject = null; // currently shown project

      // DOM refs
      const el = {
        liveBadge: document.getElementById('liveBadge'),
        liveText: document.getElementById('liveText'),
        sessionId: document.getElementById('sessionId'),
        sessionTime: document.getElementById('sessionTime'),
        elapsed: document.getElementById('elapsed'),
        progressFill: document.getElementById('progressFill'),
        statRunning: document.getElementById('statRunning'),
        statDone: document.getElementById('statDone'),
        statPending: document.getElementById('statPending'),
        statError: document.getElementById('statError'),
        agentGrid: document.getElementById('agentGrid'),
        lastUpdate: document.getElementById('lastUpdate'),
        projectTabs: document.getElementById('projectTabs'),
      };

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'updateProject' && msg.data) {
          projectStates[msg.project] = msg.data;
          // Auto-select first project or prefer running one
          const best = pickActiveProject();
          if (!activeProject || !projectStates[activeProject] || best !== activeProject) {
            activeProject = best;
          }
          renderTabs();
          render(projectStates[activeProject]);
        } else if (msg.type === 'update' && msg.data) {
          // Legacy single-project message
          projectStates['default'] = msg.data;
          activeProject = 'default';
          renderTabs();
          render(msg.data);
        } else if (msg.type === 'clearAll') {
          Object.keys(projectStates).forEach(k => delete projectStates[k]);
          activeProject = null;
          renderTabs();
          renderEmpty();
        } else if (msg.type === 'transcript' && msg.data) {
          handleTranscript(msg.data);
        }
      });

      function pickActiveProject() {
        const names = Object.keys(projectStates);
        if (names.length === 0) return null;
        // Prefer running project, then pending, then last updated
        let best = names[0];
        let bestScore = -1;
        for (const name of names) {
          const s = projectStates[name].summary;
          const score = s.running * 100 + s.pending * 10 + s.done;
          if (score > bestScore) { bestScore = score; best = name; }
        }
        return best;
      }

      function renderTabs() {
        const names = Object.keys(projectStates);
        if (names.length <= 1) {
          el.projectTabs.style.display = 'none';
          return;
        }
        el.projectTabs.style.display = 'flex';
        el.projectTabs.innerHTML = names.map(name => {
          const s = projectStates[name].summary;
          const isActive = name === activeProject;
          const hasRunning = s.running > 0;
          return '<div class="project-tab' + (isActive ? ' active' : '') + (hasRunning ? ' has-running' : '') + '" data-project="' + escapeHtml(name) + '">'
            + '<span class="tab-dot"></span>'
            + escapeHtml(name)
            + (hasRunning ? ' <span style="color:var(--creet-blue);font-size:9px">(' + s.running + ')</span>' : '')
            + '</div>';
        }).join('');
      }

      // Tab click
      document.addEventListener('click', function(e) {
        const tab = e.target.closest('.project-tab');
        if (tab) {
          const project = tab.getAttribute('data-project');
          if (project && projectStates[project]) {
            activeProject = project;
            renderTabs();
            render(projectStates[project]);
          }
          return;
        }
        // Card expand/collapse
        const card = e.target.closest('.card-toggle');
        if (!card) return;
        const agentId = card.getAttribute('data-agent-id');
        if (!agentId) return;
        if (expandedAgentId === agentId) {
          expandedAgentId = null;
          card.classList.remove('expanded');
        } else {
          const prev = document.querySelector('.agent-card.expanded');
          if (prev) prev.classList.remove('expanded');
          expandedAgentId = agentId;
          card.classList.add('expanded');
          const logEl = document.getElementById('log-' + agentId);
          if (logEl) logEl.scrollTop = logEl.scrollHeight;
        }
        updateHintForAgent(agentId);
      });

      function renderEmpty() {
        if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
        el.liveBadge.className = 'live-badge idle';
        el.liveText.textContent = 'IDLE';
        el.sessionId.textContent = 'Session: --';
        el.sessionTime.textContent = 'Started: --';
        el.elapsed.textContent = 'Elapsed: --';
        el.progressFill.style.width = '0%';
        el.statRunning.textContent = '0 running';
        el.statDone.textContent = '0 done';
        el.statPending.textContent = '0 pending';
        el.statError.textContent = '0 error';
        el.agentGrid.innerHTML = '<div class="empty-state"><div class="icon">&#x25C8;</div>'
          + '<div class="title">Waiting for agents</div>'
          + '<div>Run <code>/cc</code> in Claude Code to start multi-agent execution</div></div>';
        el.lastUpdate.textContent = 'Last update: --';
      }

      function render(state) {
        const { session, agents, summary, lastUpdatedAt } = state;

        // Live badge
        const hasRunning = summary.running > 0;
        el.liveBadge.className = 'live-badge' + (hasRunning ? '' : ' idle');
        el.liveText.textContent = hasRunning ? 'LIVE' : (session.status === 'completed' ? 'DONE' : 'IDLE');

        // Session info
        el.sessionId.textContent = 'Session: ' + (session.id || '--').substring(0, 20);
        el.sessionTime.textContent = 'Started: ' + formatTime(session.startedAt);

        // Elapsed timer
        if (session.startedAt && session.status === 'active') {
          sessionStartTime = new Date(session.startedAt).getTime();
          if (!elapsedTimer) {
            elapsedTimer = setInterval(updateElapsed, 1000);
          }
        } else {
          if (elapsedTimer) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
          }
          if (session.endedAt && session.startedAt) {
            const dur = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();
            el.elapsed.textContent = 'Duration: ' + formatDuration(dur);
          }
        }
        updateElapsed();

        // Progress
        const progress = summary.total > 0
          ? Math.round(((summary.done + summary.error) / summary.total) * 100)
          : 0;
        el.progressFill.style.width = progress + '%';

        // Stats
        el.statRunning.textContent = summary.running + ' running';
        el.statDone.textContent = summary.done + ' done';
        el.statPending.textContent = summary.pending + ' pending';
        el.statError.textContent = summary.error + ' error';

        // Agent grid — running agents only
        const runningAgents = agents.filter(a => a.status === 'running');
        if (runningAgents.length === 0) {
          el.agentGrid.innerHTML = '<div class="empty-state">'
            + '<div class="icon">&#x25C8;</div>'
            + '<div class="title">No running agents</div>'
            + '<div>Run <code>/cc</code> in Claude Code to start multi-agent execution</div>'
            + '</div>';
        } else {
          el.agentGrid.innerHTML = runningAgents.map(renderCard).join('');
        }

        // Last update
        el.lastUpdate.textContent = 'Last update: ' + formatTime(lastUpdatedAt);
      }

      function renderCard(agent, index) {
        const dur = elapsedSince(agent.startedAt);
        const logs = transcriptLogs[agent.id] || [];
        const logHtml = renderTranscriptLog(logs);
        const waitingHtml = logs.length === 0
          ? '<div style="color:var(--subtle);font-size:10px;opacity:0.6">◇ waiting for reasoning data...</div>'
          : '';

        return '<div class="agent-card running" data-agent-id="' + escapeHtml(agent.id) + '">'
          + '<div class="card-header">'
          + '<span class="agent-name"><span class="spinner"></span>' + escapeHtml(agent.name) + '</span>'
          + '<span style="color:var(--subtle);font-size:10px">' + dur + '</span>'
          + '</div>'
          + '<div class="transcript-log" id="log-' + escapeHtml(agent.id) + '">' + waitingHtml + logHtml + '</div>'
          + '</div>';
      }

      function iconFor(e) {
        if (e.type === 'tool_use') return '⚙';
        if (e.type === 'thinking') return '…';
        return e.role === 'assistant' ? '▸' : '◂';
      }

      function renderTranscriptLog(entries) {
        if (entries.length === 0) return '';
        // Show only reasoning: thinking + assistant text (exclude tool_use commands)
        const reasoningEntries = entries.filter(e => e.type !== 'tool_use');
        if (reasoningEntries.length === 0) return '';
        return reasoningEntries.map(function(e) {
          const icon = e.type === 'thinking' ? '…' : '▸';
          return '<div class="log-entry role-' + e.role + ' type-' + e.type + '">'
            + '<span class="log-icon">' + icon + '</span>'
            + '<span class="log-content">' + escapeHtml(e.content) + '</span>'
            + '</div>';
        }).join('');
      }

      function handleTranscript(entry) {
        if (!transcriptLogs[entry.agentId]) {
          transcriptLogs[entry.agentId] = [];
        }
        transcriptLogs[entry.agentId].push(entry);

        // Keep max 200 entries per agent
        if (transcriptLogs[entry.agentId].length > 200) {
          transcriptLogs[entry.agentId] = transcriptLogs[entry.agentId].slice(-150);
        }

        // Live-append reasoning entries only (skip tool_use commands)
        if (entry.type === 'tool_use') return;

        const logEl = document.getElementById('log-' + entry.agentId);
        if (logEl) {
          // Remove "waiting" placeholder on first entry
          const waiting = logEl.querySelector('div[style]');
          if (waiting) waiting.remove();

          const icon = entry.type === 'thinking' ? '…' : '▸';
          const div = document.createElement('div');
          div.className = 'log-entry role-' + entry.role + ' type-' + entry.type;
          div.innerHTML = '<span class="log-icon">' + icon + '</span>'
            + '<span class="log-content">' + escapeHtml(entry.content) + '</span>';
          logEl.appendChild(div);
          logEl.scrollTop = logEl.scrollHeight;
        }
      }

      function updateHintForAgent(agentId) {
        const card = document.querySelector('[data-agent-id="' + agentId + '"]');
        if (!card) return;
        const hint = card.querySelector('.expand-hint');
        if (!hint) return;
        const logs = transcriptLogs[agentId] || [];
        const isExpanded = card.classList.contains('expanded');
        const isRunning = card.classList.contains('running');
        if (isRunning) {
          hint.textContent = isExpanded ? '▲ click to collapse' : '▼ click to see thinking... (' + logs.length + ')';
        } else {
          hint.textContent = isExpanded ? '▲ collapse' : '▼ ' + logs.length + ' entries';
        }
      }

      // (click handler is defined above in the unified listener)

      function updateElapsed() {
        if (sessionStartTime) {
          const now = Date.now();
          el.elapsed.textContent = 'Elapsed: ' + formatDuration(now - sessionStartTime);
        }
      }

      function formatTime(iso) {
        if (!iso) return '--';
        try {
          const d = new Date(iso);
          return d.toLocaleTimeString();
        } catch { return '--'; }
      }

      function formatDuration(ms) {
        if (!ms || ms < 0) return '0s';
        const s = Math.floor(ms / 1000);
        if (s < 60) return s + 's';
        const m = Math.floor(s / 60);
        const rs = s % 60;
        return m + 'm ' + rs + 's';
      }

      function elapsedSince(iso) {
        if (!iso) return '--';
        try {
          return formatDuration(Date.now() - new Date(iso).getTime());
        } catch { return '--'; }
      }

      function escapeHtml(str) {
        if (!str) return '';
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      // Demo mode: if not in VS Code, show sample data after 1s
      if (!vscode) {
        setTimeout(() => {
          render({
            session: { id: 'sess_demo_abc123', startedAt: new Date().toISOString(), endedAt: null, status: 'active' },
            agents: [
              { id: '1', name: 'plan-plus', description: 'Overall project plan with brainstorming', status: 'done', startedAt: new Date(Date.now() - 30000).toISOString(), endedAt: new Date(Date.now() - 5000).toISOString(), durationMs: 25000, error: null },
              { id: '2', name: 'plugin-structure', description: 'Directory structure design for VS Code extension', status: 'running', startedAt: new Date(Date.now() - 20000).toISOString(), endedAt: null, durationMs: null, error: null },
              { id: '3', name: 'hook-development', description: 'PostToolUse hook design for agent tracking', status: 'running', startedAt: new Date(Date.now() - 18000).toISOString(), endedAt: null, durationMs: null, error: null },
              { id: '4', name: 'frontend-design', description: 'WebView dashboard UI with cyberpunk theme', status: 'pending', startedAt: null, endedAt: null, durationMs: null, error: null },
              { id: '5', name: 'phase-1-schema', description: 'Data schema and protocol definition', status: 'error', startedAt: new Date(Date.now() - 15000).toISOString(), endedAt: new Date(Date.now() - 10000).toISOString(), durationMs: 5000, error: 'Timeout exceeded' },
            ],
            summary: { total: 5, pending: 1, running: 2, done: 1, interrupted: 0, error: 1 },
            errors: [],
            lastUpdatedAt: new Date().toISOString(),
          });

          // Simulate live transcript entries for demo
          const demoEntries = [
            { agentId: '2', role: 'assistant', type: 'text', content: 'Analyzing the project structure requirements...', timestamp: new Date().toISOString() },
            { agentId: '2', role: 'assistant', type: 'tool_use', content: 'Glob: **/*.ts', timestamp: new Date(Date.now() + 1000).toISOString() },
            { agentId: '3', role: 'assistant', type: 'text', content: 'Designing the PostToolUse hook for Task matcher...', timestamp: new Date(Date.now() + 500).toISOString() },
            { agentId: '2', role: 'assistant', type: 'tool_use', content: 'Read: src/extension.ts', timestamp: new Date(Date.now() + 2000).toISOString() },
            { agentId: '3', role: 'assistant', type: 'tool_use', content: 'Grep: registerAgent', timestamp: new Date(Date.now() + 2500).toISOString() },
            { agentId: '2', role: 'assistant', type: 'text', content: 'Found 6 TypeScript files. Recommending src/ directory with types.ts, extension.ts, and feature modules.', timestamp: new Date(Date.now() + 3000).toISOString() },
            { agentId: '3', role: 'assistant', type: 'text', content: 'The hook should capture tool_input.description as the agent name and write to .creet/agent-dashboard.json', timestamp: new Date(Date.now() + 3500).toISOString() },
            { agentId: '2', role: 'assistant', type: 'tool_use', content: 'Write: src/types.ts', timestamp: new Date(Date.now() + 4000).toISOString() },
          ];

          let i = 0;
          const demoInterval = setInterval(() => {
            if (i < demoEntries.length) {
              handleTranscript(demoEntries[i]);
              i++;
            } else {
              clearInterval(demoInterval);
            }
          }, 800);
        }, 500);
      }
    })();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
