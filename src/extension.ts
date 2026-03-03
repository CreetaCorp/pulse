import * as vscode from 'vscode';
import * as path from 'path';
import { AgentWatcher } from './AgentWatcher';
import { DashboardPanel } from './DashboardPanel';
import { AgentTreeProvider } from './AgentTreeProvider';
import { StatusBarManager } from './StatusBarManager';
import { TranscriptReader } from './TranscriptReader';
import { DashboardState } from './types';

// Multi-project support: one watcher per workspace folder
const watchers = new Map<string, AgentWatcher>();
const projectStates = new Map<string, DashboardState>();
const previousRunningCount = new Map<string, number>(); // for 0→N transition detection

let statusBar: StatusBarManager | undefined;
let treeProvider: AgentTreeProvider | undefined;
let transcriptReader: TranscriptReader | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Creet Agent Dashboard');
  outputChannel.appendLine('[Creet] Extension activating...');

  // Status bar
  statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);

  // TreeView
  treeProvider = new AgentTreeProvider();
  const treeView = vscode.window.createTreeView('creetaAgentTree', {
    treeDataProvider: treeProvider,
  });
  context.subscriptions.push(treeView);

  // Transcript reader for live agent thinking
  transcriptReader = new TranscriptReader();
  transcriptReader.onNewEntry((entry) => {
    DashboardPanel.currentPanel?.postTranscriptEntry(entry);
  });
  context.subscriptions.push(transcriptReader);

  // Start watchers for ALL workspace folders
  syncWatchers(outputChannel);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('creeta.openDashboard', () => {
      const panel = DashboardPanel.createOrShow(context.extensionUri);
      // Send all current project states
      for (const [project, state] of projectStates) {
        panel.updateProjectState(project, state);
      }
    }),

    vscode.commands.registerCommand('creeta.refreshDashboard', () => {
      for (const [project, watcher] of watchers) {
        const state = watcher.readNow();
        if (state) {
          handleStateUpdate(project, state);
        }
      }
    }),

    vscode.commands.registerCommand('creeta.clearDashboard', () => {
      projectStates.clear();
      DashboardPanel.currentPanel?.clearAll();
      const empty: DashboardState = {
        $schema: 'creet-agent-dashboard/1.0.0',
        session: { id: '', startedAt: '', endedAt: null, status: 'completed' },
        agents: [],
        summary: { total: 0, pending: 0, running: 0, done: 0, error: 0 },
        errors: [],
        lastUpdatedAt: new Date().toISOString(),
      };
      treeProvider?.update(empty);
      statusBar?.update(empty);
    })
  );

  // Watch for workspace folder changes (add/remove projects)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      syncWatchers(outputChannel);
    })
  );

  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('[Creet] Extension activated.');
}

/** Sync watchers to match current workspace folders */
function syncWatchers(output: vscode.OutputChannel): void {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const currentProjects = new Set(folders.map(f => f.name));

  // Remove watchers for folders no longer in workspace
  for (const [project, watcher] of watchers) {
    if (!currentProjects.has(project)) {
      watcher.dispose();
      watchers.delete(project);
      projectStates.delete(project);
      previousRunningCount.delete(project);
      output.appendLine(`[Creet] Stopped watching: ${project}`);
    }
  }

  // Add watchers for new folders
  for (const folder of folders) {
    if (!watchers.has(folder.name)) {
      const dashboardDir = path.join(folder.uri.fsPath, '.creet');
      startWatcher(folder.name, dashboardDir, output);
    }
  }
}

function startWatcher(projectName: string, dashboardDir: string, output: vscode.OutputChannel): void {
  const watcher = new AgentWatcher(dashboardDir);

  watcher.onStateChange((state) => {
    handleStateUpdate(projectName, state);
  });

  watcher.onFileCreated(() => {
    const autoOpen = vscode.workspace
      .getConfiguration('creeta')
      .get<boolean>('autoOpen', true);
    if (autoOpen) {
      vscode.commands.executeCommand('creeta.openDashboard');
    }
  });

  watchers.set(projectName, watcher);
  output.appendLine(`[Creet] Watching: ${dashboardDir}`);

  // Initial read
  const initialState = watcher.readNow();
  if (initialState) {
    handleStateUpdate(projectName, initialState);
  }
}

function handleStateUpdate(projectName: string, rawState: DashboardState): void {
  const state = resolveStaleSession(rawState);
  projectStates.set(projectName, state);

  // Update dashboard panel with this project's state
  DashboardPanel.currentPanel?.updateProjectState(projectName, state);

  // Update tree with most active project's agents
  const activeState = getMostActiveState();
  if (activeState) {
    treeProvider?.update(activeState);
  }

  // Update status bar with aggregated totals across all projects
  statusBar?.update(buildAggregateState());

  // Start watching transcripts for running agents
  const runningAgents = state.agents.filter(a => a.status === 'running');
  for (const agent of runningAgents) {
    transcriptReader?.watchAgent(agent.id, state.session.id, agent.description);
  }

  // Auto-open only when running count transitions from 0 → N (not on every poll)
  const prevRunning = previousRunningCount.get(projectName) ?? 0;
  previousRunningCount.set(projectName, state.summary.running);
  if (state.summary.running > 0 && prevRunning === 0 && !DashboardPanel.currentPanel) {
    const autoOpen = vscode.workspace
      .getConfiguration('creeta')
      .get<boolean>('autoOpen', true);
    if (autoOpen) {
      vscode.commands.executeCommand('creeta.openDashboard');
    }
  }
}

/** Returns the most actively running project's state (for TreeView) */
function getMostActiveState(): DashboardState | undefined {
  let best: DashboardState | undefined;
  let bestScore = -1;
  for (const state of projectStates.values()) {
    const score = state.summary.running * 100 + state.summary.pending * 10 + state.summary.done;
    if (score > bestScore) {
      bestScore = score;
      best = state;
    }
  }
  return best;
}

/** Build a merged state for status bar (aggregate totals) */
function buildAggregateState(): DashboardState {
  let running = 0, done = 0, pending = 0, error = 0;
  for (const s of projectStates.values()) {
    running += s.summary.running;
    done += s.summary.done;
    pending += s.summary.pending;
    error += s.summary.error;
  }
  return {
    $schema: 'creet-agent-dashboard/1.0.0',
    session: { id: '', startedAt: '', endedAt: null, status: running > 0 ? 'active' : 'completed' },
    agents: [],
    summary: { total: running + done + pending + error, running, done, pending, error },
    errors: [],
    lastUpdatedAt: new Date().toISOString(),
  };
}

function resolveStaleSession(state: DashboardState): DashboardState {
  if (state.session.status !== 'active' || state.summary.running === 0) {
    return state;
  }

  const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
  try {
    const lastUpdate = new Date(state.lastUpdatedAt).getTime();
    if (Date.now() - lastUpdate < STALE_THRESHOLD_MS) {
      return state;
    }
  } catch {
    return state;
  }

  const resolvedAgents = state.agents.map(a => {
    if (a.status === 'running') {
      return { ...a, status: 'error' as const, error: 'Session ended unexpectedly', endedAt: state.lastUpdatedAt };
    }
    if (a.status === 'pending') {
      return { ...a, status: 'error' as const, error: 'Session ended before this agent started', endedAt: state.lastUpdatedAt };
    }
    return a;
  });

  return {
    ...state,
    session: { ...state.session, status: 'completed', endedAt: state.session.endedAt ?? state.lastUpdatedAt },
    agents: resolvedAgents,
    summary: {
      total: state.summary.total,
      pending: 0,
      running: 0,
      done: state.summary.done,
      error: state.summary.error + state.summary.running + state.summary.pending,
    },
  };
}

export function deactivate(): void {
  for (const watcher of watchers.values()) {
    watcher.dispose();
  }
  watchers.clear();
  transcriptReader?.dispose();
}
