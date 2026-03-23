import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Reads agent transcript .jsonl files to show real-time thinking process.
 *
 * Claude Code stores subagent conversations at:
 *   ~/.claude/projects/{project-hash}/{session-uuid}/subagents/agent-{claudeAgentId}.jsonl
 *
 * Problem: Pulse's agentId (e.g. agent_mn32y78n_1368) != Claude's agentId (e.g. acfc3c5fb2c806aaa)
 *
 * Solution: Watch the subagents/ directory directly. When a new .jsonl file appears,
 * match it to the most recently registered Pulse agent by creation time.
 */
export class TranscriptReader implements vscode.Disposable {
  private readonly log = vscode.window.createOutputChannel('Pulse Transcript');
  private readonly debugLogPath: string;

  // File-level watchers: filePath → FSWatcher
  private fileWatchers = new Map<string, fs.FSWatcher>();

  // Directory-level watcher for new subagent files
  private dirWatcher: fs.FSWatcher | undefined;
  private dirPollTimer: ReturnType<typeof setInterval> | undefined;

  // pulseAgentId → filePath (matched transcript file)
  private agentFileMap = new Map<string, string>();

  // filePath → pulseAgentId (reverse map)
  private fileAgentMap = new Map<string, string>();

  // Read positions: filePath → bytes read
  private readPositions = new Map<string, number>();

  // Timestamp when we started watching — only match files modified after this
  private watchStartTime = 0;

  // Queue of Pulse agentIds waiting for a transcript file match
  private unmatchedAgents: { id: string; registeredAt: number }[] = [];

  private readonly _onNewEntry = new vscode.EventEmitter<TranscriptEntry>();
  readonly onNewEntry = this._onNewEntry.event;

  private readonly claudeProjectsDir: string;
  private activeSubagentsDir: string | undefined;

  constructor() {
    const claudeHome = process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
    this.claudeProjectsDir = path.join(claudeHome, 'projects');
    // Debug log file — use workspace .pulse/ if available, fallback to temp
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const wsRoot = workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
    this.debugLogPath = path.join(wsRoot, '.pulse', 'transcript-debug.log');
    this.debugLog('=== TranscriptReader initialized ===');
  }

  private debugLog(msg: string): void {
    const line = `[${new Date().toISOString()}] ${msg}`;
    this.log.appendLine(line);
    try { fs.appendFileSync(this.debugLogPath, line + '\n'); } catch { /* ignore */ }
  }

  /**
   * Register a Pulse agent for transcript tracking.
   * Does NOT match by agentId — instead queues the agent for time-based matching.
   */
  watchAgent(agentId: string, _sessionId: string, _promptPrefix: string): void {
    this.debugLog(`[watchAgent] called: agentId=${agentId}`);
    if (agentId === 'main' || this.agentFileMap.has(agentId)) {
      this.debugLog(`[watchAgent] skipped (main or already mapped)`);
      return;
    }

    // Queue this agent for matching
    this.unmatchedAgents.push({ id: agentId, registeredAt: Date.now() });
    this.debugLog(`[watchAgent] queued, unmatchedAgents=${this.unmatchedAgents.length}`);

    // Ensure we're watching the subagents/ directory
    this.ensureDirWatcher();

    // Try immediate match with any unmatched files
    this.matchNewFiles();
  }

  /**
   * Find and start watching the most recent subagents/ directory.
   */
  private ensureDirWatcher(): void {
    // Set watchStartTime on first call
    if (!this.watchStartTime) {
      this.watchStartTime = Date.now() - 60000; // 60s lookback
      this.debugLog(`[ensureDirWatcher] watchStartTime=${new Date(this.watchStartTime).toISOString()}`);
    }

    // Already polling — skip
    if (this.dirPollTimer) {
      return;
    }

    this.debugLog(`[ensureDirWatcher] claudeProjectsDir=${this.claudeProjectsDir}`);

    // Single unified poll: find dir if needed, then match files
    this.dirPollTimer = setInterval(() => {
      // Find subagents dir if not yet found
      if (!this.activeSubagentsDir) {
        const dir = this.findActiveSubagentsDir();
        if (dir) {
          this.debugLog(`[poll] found subagentsDir=${dir}`);
          this.activeSubagentsDir = dir;
        } else {
          return; // Keep polling until found
        }
      }

      // Match new files
      this.matchNewFiles();
    }, 300);

    // Stop after 5 minutes
    setTimeout(() => this.stopDirPolling(), 300000);

    // Also try immediately
    const dir = this.findActiveSubagentsDir();
    if (dir) {
      this.activeSubagentsDir = dir;
      this.debugLog(`[ensureDirWatcher] foundSubagentsDir=${dir}`);
      this.matchNewFiles();
    } else {
      this.debugLog(`[ensureDirWatcher] no dir yet, polling...`);
    }
  }

  /**
   * Check for new .jsonl files and match them to unmatched Pulse agents.
   */
  private matchNewFiles(): void {
    if (!this.activeSubagentsDir || this.unmatchedAgents.length === 0) {
      return;
    }
    this.debugLog(`[matchNewFiles] dir=${this.activeSubagentsDir}, unmatched=${this.unmatchedAgents.length}, matched=${this.fileAgentMap.size}`);

    try {
      const files = fs.readdirSync(this.activeSubagentsDir)
        .filter(f => f.startsWith('agent-') && f.endsWith('.jsonl') && !f.includes('compact'))
        .map(f => {
          const fullPath = path.join(this.activeSubagentsDir!, f);
          return { name: f, path: fullPath, mtime: fs.statSync(fullPath).mtimeMs };
        })
        .filter(f => !this.fileAgentMap.has(f.path)) // not already matched
        .filter(f => f.mtime >= this.watchStartTime) // only files modified after we started watching
        .sort((a, b) => a.mtime - b.mtime); // oldest first (FIFO matching with agents)

      this.debugLog(`[matchNewFiles] candidates=${files.length}, watchStartTime=${new Date(this.watchStartTime).toISOString()}`);

      for (const file of files) {
        if (this.unmatchedAgents.length === 0) { break; }

        // Match to the oldest unmatched Pulse agent (FIFO)
        const agent = this.unmatchedAgents.shift()!;
        this.agentFileMap.set(agent.id, file.path);
        this.fileAgentMap.set(file.path, agent.id);

        this.debugLog(`[matchNewFiles] MATCHED: ${agent.id} → ${file.name} (mtime=${new Date(file.mtime).toISOString()})`);

        // Start streaming this file
        this.startFileWatcher(agent.id, file.path);
      }

      // Keep polling — new agents may arrive later
    } catch (err: any) {
      this.debugLog(`[matchNewFiles] ERROR: ${err?.message}`);
    }
  }

  /**
   * Start watching a specific transcript file and stream entries.
   */
  private startFileWatcher(agentId: string, filePath: string): void {
    // Initial read
    this.readNewLines(agentId, filePath);

    // Watch for changes
    try {
      const watcher = fs.watch(filePath, () => {
        this.readNewLines(agentId, filePath);
      });
      this.fileWatchers.set(filePath, watcher);
    } catch {
      // fs.watch failed — use polling fallback
      const pollTimer = setInterval(() => {
        this.readNewLines(agentId, filePath);
      }, 500);
      this.fileWatchers.set(filePath, { close: () => clearInterval(pollTimer) } as any);
    }
  }

  /**
   * Read new lines from a transcript file since last position.
   */
  private readNewLines(agentId: string, filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      const lastPos = this.readPositions.get(filePath) || 0;

      if (stat.size <= lastPos) {
        return;
      }

      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(stat.size - lastPos);
      fs.readSync(fd, buffer, 0, buffer.length, lastPos);
      fs.closeSync(fd);

      this.readPositions.set(filePath, stat.size);

      const lines = buffer.toString('utf-8').split('\n').filter(Boolean);
      this.debugLog(`[readNewLines] ${agentId}: ${lines.length} new lines from pos ${lastPos}`);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const parsed = this.parseEntry(agentId, entry);
          if (parsed) {
            this.debugLog(`[readNewLines] FIRE: ${agentId} type=${parsed.type} content=${parsed.content.substring(0, 60)}`);
            this._onNewEntry.fire(parsed);
          }
        } catch { /* skip invalid lines */ }
      }
    } catch (err: any) {
      this.debugLog(`[readNewLines] ERROR: ${err?.message}`);
    }
  }

  /**
   * Parse a JSONL entry into a display-friendly format.
   */
  private parseEntry(agentId: string, raw: any): TranscriptEntry | null {
    if (!raw || !raw.message) {
      return null;
    }

    const msg = raw.message;
    const role = msg.role || raw.type;

    if (role === 'assistant') {
      const content = msg.content;
      if (!Array.isArray(content)) { return null; }

      for (const block of content) {
        if (block.type === 'thinking' && block.thinking) {
          return {
            agentId,
            role: 'assistant',
            type: 'thinking',
            content: block.thinking.substring(0, 300),
            timestamp: raw.timestamp || new Date().toISOString(),
          };
        }
        if (block.type === 'text' && block.text) {
          return {
            agentId,
            role: 'assistant',
            type: 'text',
            content: block.text.substring(0, 500),
            timestamp: raw.timestamp || new Date().toISOString(),
          };
        }
        if (block.type === 'tool_use') {
          return {
            agentId,
            role: 'assistant',
            type: 'tool_use',
            content: `${block.name}: ${summarizeToolInput(block.name, block.input)}`,
            timestamp: raw.timestamp || new Date().toISOString(),
          };
        }
      }
    }

    return null;
  }

  /**
   * Find the most recently modified subagents/ directory.
   */
  private findActiveSubagentsDir(): string | undefined {
    try {
      if (!fs.existsSync(this.claudeProjectsDir)) { return undefined; }

      const dirs: { path: string; mtime: number }[] = [];

      const projects = fs.readdirSync(this.claudeProjectsDir);
      for (const project of projects) {
        const projectDir = path.join(this.claudeProjectsDir, project);
        try {
          const entries = fs.readdirSync(projectDir, { withFileTypes: true });
          for (const entry of entries) {
            // Skip files (e.g. .jsonl) — only process directories
            if (!entry.isDirectory()) { continue; }
            if (entry.name === 'memory') { continue; }
            const fullPath = path.join(projectDir, entry.name);
            try {
              const subDir = path.join(fullPath, 'subagents');
              if (fs.existsSync(subDir)) {
                const stat = fs.statSync(subDir);
                dirs.push({ path: subDir, mtime: stat.mtimeMs });
              }
            } catch { continue; }
          }
        } catch { continue; }
      }

      if (dirs.length === 0) { return undefined; }

      dirs.sort((a, b) => b.mtime - a.mtime);
      return dirs[0].path;
    } catch { return undefined; }
  }

  private stopDirPolling(): void {
    if (this.dirPollTimer) {
      clearInterval(this.dirPollTimer);
      this.dirPollTimer = undefined;
    }
  }

  dispose(): void {
    for (const watcher of this.fileWatchers.values()) {
      watcher.close();
    }
    this.fileWatchers.clear();
    this.stopDirPolling();
    this._onNewEntry.dispose();
  }
}

export interface TranscriptEntry {
  agentId: string;
  role: 'user' | 'assistant';
  type: 'text' | 'tool_use' | 'thinking';
  content: string;
  timestamp: string;
}

function summarizeToolInput(toolName: string, input: any): string {
  if (!input) { return ''; }
  switch (toolName) {
    case 'Read': return input.file_path || '';
    case 'Write': return input.file_path || '';
    case 'Edit': return input.file_path || '';
    case 'Bash': return (input.command || '').substring(0, 80);
    case 'Glob': return input.pattern || '';
    case 'Grep': return input.pattern || '';
    case 'Task': return (input.description || input.prompt || '').substring(0, 60);
    default: return JSON.stringify(input).substring(0, 80);
  }
}
