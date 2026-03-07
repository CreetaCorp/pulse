import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DashboardState } from './types';

/**
 * Watches .lens/agent-dashboard.json for changes.
 * Uses FileSystemWatcher + polling fallback for reliability.
 */
export class AgentWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private lastContent = '';

  private readonly _onStateChange = new vscode.EventEmitter<DashboardState>();
  readonly onStateChange = this._onStateChange.event;

  private readonly _onFileCreated = new vscode.EventEmitter<void>();
  readonly onFileCreated = this._onFileCreated.event;

  constructor(private readonly dashboardDir: string) {
    this.setupWatcher();
    this.setupPolling();
  }

  private get filePath(): string {
    return path.join(this.dashboardDir, 'agent-dashboard.json');
  }

  private setupWatcher(): void {
    try {
      const pattern = new vscode.RelativePattern(
        vscode.Uri.file(this.dashboardDir),
        'agent-dashboard.json'
      );
      this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
      this.watcher.onDidChange(() => this.readAndEmit());
      this.watcher.onDidCreate(() => {
        this._onFileCreated.fire();
        this.readAndEmit();
      });
    } catch {
      // Directory might not exist yet; polling will handle it
    }
  }

  private setupPolling(): void {
    const interval = vscode.workspace
      .getConfiguration('creeta')
      .get<number>('pollInterval', 500);
    this.pollTimer = setInterval(() => this.readAndEmit(), interval);
  }

  private readAndEmit(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }
      const content = fs.readFileSync(this.filePath, 'utf-8');
      if (content === this.lastContent) {
        return;
      }
      this.lastContent = content;

      const state: DashboardState = JSON.parse(content);
      if (state && state.$schema && state.agents) {
        this._onStateChange.fire(state);
      }
    } catch {
      // File being written to or corrupted; skip this cycle
    }
  }

  /** Force a read right now. Also syncs lastContent to avoid duplicate poll event. */
  readNow(): DashboardState | undefined {
    try {
      if (!fs.existsSync(this.filePath)) {
        return undefined;
      }
      const content = fs.readFileSync(this.filePath, 'utf-8');
      this.lastContent = content; // prevent first poll cycle from re-firing
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    this.watcher?.dispose();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    this._onStateChange.dispose();
    this._onFileCreated.dispose();
  }
}
