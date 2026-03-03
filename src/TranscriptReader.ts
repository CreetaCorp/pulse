import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Reads agent transcript .jsonl files to show real-time thinking process.
 * Claude Code stores subagent conversations at:
 *   ~/.claude/projects/{project-hash}/{session-id}/subagents/agent-a{hex}.jsonl
 *
 * Matching strategy:
 *   - Use session_id from dashboard to find the correct session directory
 *   - Match subagent file by prompt prefix (first line of file = user message with prompt)
 */
export class TranscriptReader implements vscode.Disposable {
  private watchers = new Map<string, fs.FSWatcher>();
  private readPositions = new Map<string, number>();
  private pendingAgents = new Map<string, { sessionId: string; promptPrefix: string }>();
  private pendingPollTimer: ReturnType<typeof setInterval> | undefined;

  private readonly _onNewEntry = new vscode.EventEmitter<TranscriptEntry>();
  readonly onNewEntry = this._onNewEntry.event;

  private readonly claudeProjectsDir: string;

  constructor() {
    const claudeHome = process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
    this.claudeProjectsDir = path.join(claudeHome, 'projects');
  }

  /**
   * Start watching for a specific agent's transcript.
   * Uses session_id + prompt prefix to locate the correct subagent file.
   */
  watchAgent(agentId: string, sessionId: string, promptPrefix: string): void {
    if (this.watchers.has(agentId)) {
      return; // Already watching
    }

    const transcriptPath = this.findTranscriptFile(sessionId, promptPrefix);
    if (transcriptPath) {
      this.initWatcher(agentId, transcriptPath);
    } else {
      // File not yet created — retry every second
      this.pendingAgents.set(agentId, { sessionId, promptPrefix });
      this.startPendingPoll();
    }
  }

  private initWatcher(agentId: string, transcriptPath: string): void {
    // Initial read
    this.readNewLines(agentId, transcriptPath);

    // Watch for changes
    try {
      const watcher = fs.watch(transcriptPath, () => {
        this.readNewLines(agentId, transcriptPath);
      });
      this.watchers.set(agentId, watcher);
    } catch {
      // fs.watch failed — fall back to the pending poll to keep reading
      this.watchers.set(agentId, { close: () => {} } as any);
    }
  }

  private startPendingPoll(): void {
    if (this.pendingPollTimer) {
      return;
    }
    this.pendingPollTimer = setInterval(() => {
      for (const [agentId, { sessionId, promptPrefix }] of this.pendingAgents) {
        const transcriptPath = this.findTranscriptFile(sessionId, promptPrefix);
        if (transcriptPath) {
          this.pendingAgents.delete(agentId);
          this.initWatcher(agentId, transcriptPath);
        }
      }
      if (this.pendingAgents.size === 0 && this.pendingPollTimer) {
        clearInterval(this.pendingPollTimer);
        this.pendingPollTimer = undefined;
      }
    }, 1000);
  }

  /**
   * Find the transcript .jsonl file for an agent.
   * Searches claudeProjectsDir/{sessionId}/subagents/ for a file whose
   * first-line prompt matches promptPrefix.
   */
  private findTranscriptFile(sessionId: string, promptPrefix: string): string | undefined {
    if (!sessionId) {
      return undefined;
    }

    try {
      if (!fs.existsSync(this.claudeProjectsDir)) {
        return undefined;
      }

      const matchPrefix = promptPrefix.substring(0, 80);

      // Search through project directories
      const projects = fs.readdirSync(this.claudeProjectsDir);
      for (const project of projects) {
        const sessionDir = path.join(this.claudeProjectsDir, project, sessionId);
        const subagentsDir = path.join(sessionDir, 'subagents');

        if (!fs.existsSync(subagentsDir)) {
          continue;
        }

        const files = fs.readdirSync(subagentsDir).filter(
          f => f.startsWith('agent-') && f.endsWith('.jsonl') && !f.includes('compact')
        );

        for (const file of files) {
          const filePath = path.join(subagentsDir, file);
          try {
            const firstLine = readFirstLine(filePath);
            if (!firstLine) {
              continue;
            }
            const entry = JSON.parse(firstLine);
            const content: unknown = entry?.message?.content;
            if (typeof content === 'string' && content.startsWith(matchPrefix)) {
              return filePath;
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // Search failed
    }

    return undefined;
  }

  /**
   * Read new lines from a transcript file since last read position.
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

      const newContent = buffer.toString('utf-8');
      const lines = newContent.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const parsed = this.parseEntry(agentId, entry);
          if (parsed) {
            this._onNewEntry.fire(parsed);
          }
        } catch {
          // Skip invalid lines
        }
      }
    } catch {
      // File access error
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

    if (role === 'user') {
      // Skip the first user message (it's the prompt we already know)
      if (raw.parentUuid === null && raw.isSidechain === true) {
        return null;
      }
      const text = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
          : '';
      if (!text) {
        return null;
      }
      return {
        agentId,
        role: 'user',
        type: 'text',
        content: text.substring(0, 500),
        timestamp: new Date().toISOString(),
      };
    }

    if (role === 'assistant') {
      const content = msg.content;
      if (!Array.isArray(content)) {
        return null;
      }

      // Extract first meaningful block
      for (const block of content) {
        if (block.type === 'thinking' && block.thinking) {
          return {
            agentId,
            role: 'assistant',
            type: 'thinking',
            content: block.thinking.substring(0, 300),
            timestamp: new Date().toISOString(),
          };
        }

        if (block.type === 'text' && block.text) {
          return {
            agentId,
            role: 'assistant',
            type: 'text',
            content: block.text.substring(0, 500),
            timestamp: new Date().toISOString(),
          };
        }

        if (block.type === 'tool_use') {
          return {
            agentId,
            role: 'assistant',
            type: 'tool_use',
            content: `${block.name}: ${summarizeToolInput(block.name, block.input)}`,
            timestamp: new Date().toISOString(),
          };
        }
      }
    }

    return null;
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    if (this.pendingPollTimer) {
      clearInterval(this.pendingPollTimer);
      this.pendingPollTimer = undefined;
    }
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

/** Read only the first line of a file efficiently. */
function readFirstLine(filePath: string): string | undefined {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2048);
    const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
    fs.closeSync(fd);
    const text = buf.subarray(0, bytesRead).toString('utf-8');
    const newline = text.indexOf('\n');
    return newline >= 0 ? text.substring(0, newline) : text;
  } catch {
    return undefined;
  }
}

function summarizeToolInput(toolName: string, input: any): string {
  if (!input) {
    return '';
  }
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
