import type { McpActivityEntry } from './live-bridge/protocol';

export type ActivitySource = 'edit' | 'mcp' | 'file' | 'build' | 'system';
export type ActivityStatus = 'info' | 'success' | 'error';
export type ActivityCategory = 'change' | 'read' | 'file' | 'build' | 'system';

export interface ActivityEntry {
  id: string;
  timestamp: string;
  source: ActivitySource;
  status: ActivityStatus;
  category: ActivityCategory;
  title: string;
  summary?: string;
  revisionBefore: number | null;
  revisionAfter: number | null;
  undoable: boolean;
  historical: boolean;
  durationMs?: number;
  details?: readonly ActivityDetail[];
}

export interface ActivityDetail {
  title: string;
  value: unknown;
}

export type ActivityEntryInput = Omit<ActivityEntry, 'id' | 'timestamp' | 'historical'> & {
  id?: string;
  timestamp?: string;
  historical?: boolean;
};

export const MAX_ACTIVITY_ENTRIES = 1_000;

export interface ActivityFilter {
  query: string;
  source: 'all' | ActivitySource;
  kind: 'all' | 'changes' | 'errors' | 'reads';
}

function activityId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isActivityEntry(value: unknown): value is ActivityEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ActivityEntry>;
  return typeof entry.id === 'string'
    && typeof entry.timestamp === 'string'
    && ['edit', 'mcp', 'file', 'build', 'system'].includes(entry.source ?? '')
    && ['info', 'success', 'error'].includes(entry.status ?? '')
    && ['change', 'read', 'file', 'build', 'system'].includes(entry.category ?? '')
    && typeof entry.title === 'string'
    && (entry.summary === undefined || typeof entry.summary === 'string')
    && (entry.revisionBefore === null || Number.isInteger(entry.revisionBefore))
    && (entry.revisionAfter === null || Number.isInteger(entry.revisionAfter))
    && typeof entry.undoable === 'boolean'
    && typeof entry.historical === 'boolean'
    && (entry.durationMs === undefined || typeof entry.durationMs === 'number')
    && (entry.details === undefined || Array.isArray(entry.details));
}

export function filterActivity(entries: readonly ActivityEntry[], filter: ActivityFilter): ActivityEntry[] {
  const query = filter.query.trim().toLowerCase();
  return entries.filter(entry => {
    if (filter.source !== 'all' && entry.source !== filter.source) return false;
    if (filter.kind === 'changes' && entry.category !== 'change') return false;
    if (filter.kind === 'errors' && entry.status !== 'error') return false;
    if (filter.kind === 'reads' && entry.category !== 'read') return false;
    if (!query) return true;
    return [
      entry.title,
      entry.summary ?? '',
      entry.source,
      JSON.stringify(entry.details ?? []),
    ].some(value => value.toLowerCase().includes(query));
  });
}

export function summarizeActivity(entries: readonly ActivityEntry[]): {
  total: number; changes: number; errors: number; revisions: number;
} {
  return {
    total: entries.length,
    changes: entries.filter(entry => entry.category === 'change').length,
    errors: entries.filter(entry => entry.status === 'error').length,
    revisions: entries.filter(entry => entry.revisionBefore !== entry.revisionAfter && entry.revisionAfter !== null).length,
  };
}

export function activityFromMcp(entry: McpActivityEntry): ActivityEntryInput {
  const changedRevision = entry.revisionBefore !== null
    && entry.revisionAfter !== null
    && entry.revisionBefore !== entry.revisionAfter;
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    source: 'mcp',
    status: entry.status,
    category: changedRevision ? 'change' : entry.readOnly ? 'read' : 'system',
    title: entry.tool,
    summary: entry.status === 'error' ? 'MCP call failed' : entry.readOnly ? 'Read-only MCP call' : 'MCP action completed',
    revisionBefore: entry.revisionBefore,
    revisionAfter: entry.revisionAfter,
    undoable: changedRevision,
    durationMs: entry.durationMs,
    details: [
      {
        title: 'Session',
        value: {
          editorSessionId: entry.editorSessionId,
          mcpSessionId: entry.mcpSessionId,
        },
      },
      { title: 'Arguments', value: entry.arguments },
      { title: 'Result', value: entry.result },
    ],
  };
}

export class ActivityHistory {
  private entries: ActivityEntry[] = [];
  private listeners = new Set<() => void>();

  record(input: ActivityEntryInput): ActivityEntry {
    const entry: ActivityEntry = {
      ...input,
      id: input.id ?? activityId(),
      timestamp: input.timestamp ?? new Date().toISOString(),
      historical: input.historical ?? false,
    };
    const existingIndex = this.entries.findIndex(candidate => candidate.id === entry.id);
    if (existingIndex >= 0) this.entries.splice(existingIndex, 1);
    this.entries.push(entry);
    if (this.entries.length > MAX_ACTIVITY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ACTIVITY_ENTRIES);
    }
    this.notify();
    return entry;
  }

  recordMcp(entry: McpActivityEntry, documentSessionStartedAt: number): ActivityEntry | null {
    const timestamp = Date.parse(entry.timestamp);
    if (Number.isFinite(timestamp) && timestamp < documentSessionStartedAt) return null;
    return this.record(activityFromMcp(entry));
  }

  restore(entries: readonly ActivityEntry[]): void {
    this.entries = entries
      .filter(isActivityEntry)
      .slice(-MAX_ACTIVITY_ENTRIES)
      .map(entry => ({ ...structuredClone(entry), historical: true, undoable: false }));
    this.notify();
  }

  startDocumentSession(): void {
    this.entries = [];
    this.notify();
  }

  clear(): void {
    this.entries = [];
    this.notify();
  }

  snapshot(): ActivityEntry[] {
    return structuredClone(this.entries);
  }

  list(): readonly ActivityEntry[] {
    return this.entries;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
