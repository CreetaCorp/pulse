import * as vscode from 'vscode';
import { DashboardState, AgentEntry } from './types';

/**
 * TreeDataProvider for the sidebar agent list.
 * Shows agents grouped by status with real-time updates.
 */
export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private state: DashboardState | undefined;

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  update(state: DashboardState): void {
    this.state = state;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentTreeItem): AgentTreeItem[] {
    if (!this.state) {
      return [new AgentTreeItem('No active session', '', 'inactive')];
    }

    // Root level: session info + agent list
    if (!element) {
      return this.buildRootItems();
    }

    return [];
  }

  private buildRootItems(): AgentTreeItem[] {
    const { session, agents, summary } = this.state!;
    const items: AgentTreeItem[] = [];

    // Session header
    const sessionLabel = session.status === 'active'
      ? `Session: Active`
      : `Session: ${session.status}`;
    const sessionItem = new AgentTreeItem(
      sessionLabel,
      `${summary.total} agents | ${summary.running} running`,
      session.status === 'active' ? 'running' : 'done'
    );
    sessionItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
    items.push(sessionItem);

    // Running agents first
    const running = agents.filter(a => a.status === 'running');
    for (const agent of running) {
      items.push(this.createAgentItem(agent));
    }

    // Pending
    const pending = agents.filter(a => a.status === 'pending');
    for (const agent of pending) {
      items.push(this.createAgentItem(agent));
    }

    // Done
    const done = agents.filter(a => a.status === 'done');
    for (const agent of done) {
      items.push(this.createAgentItem(agent));
    }

    // Errors
    const errors = agents.filter(a => a.status === 'error');
    for (const agent of errors) {
      items.push(this.createAgentItem(agent));
    }

    return items;
  }

  private createAgentItem(agent: AgentEntry): AgentTreeItem {
    const duration = agent.durationMs
      ? `${(agent.durationMs / 1000).toFixed(1)}s`
      : '...';

    const item = new AgentTreeItem(
      agent.name,
      `${agent.status} | ${duration}`,
      agent.status
    );
    item.tooltip = agent.description;
    return item;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

class AgentTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    status: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = this.getIcon(status);
    this.contextValue = status;
  }

  private getIcon(status: string): vscode.ThemeIcon {
    switch (status) {
      case 'running':
        return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
      case 'pending':
        return new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.yellow'));
      case 'done':
        return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
      case 'error':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      case 'inactive':
        return new vscode.ThemeIcon('circle-outline');
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}
