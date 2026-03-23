/**
 * Pulse Agent Dashboard - Shared Types
 * Matches the JSON schema from lens plugin's agent-tracker.js
 */

export interface DashboardState {
  $schema: string;
  session: SessionInfo;
  agents: AgentEntry[];
  summary: AgentSummary;
  errors: ErrorRecord[];
  lastUpdatedAt: string;
}

export interface SessionInfo {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: 'active' | 'completed' | 'error';
}

export interface AgentEntry {
  id: string;
  name: string;
  description: string;
  parentId?: string | null;
  status: 'pending' | 'running' | 'done' | 'error';
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface AgentSummary {
  total: number;
  pending: number;
  running: number;
  done: number;
  error: number;
}

export interface ErrorRecord {
  agentId: string;
  agentName: string;
  error: string;
  at: string;
}
