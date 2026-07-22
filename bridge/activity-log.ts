import { appendFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { McpActivityEntry } from '../src/live-bridge/protocol';

interface SummarizeOptions {
  depth?: number;
  maxDepth?: number;
  maxArray?: number;
}

function summarized(value: unknown, key = '', options: SummarizeOptions = {}): unknown {
  const depth = options.depth ?? 0;
  const maxDepth = options.maxDepth ?? 5;
  const maxArray = options.maxArray ?? 32;
  if (key === 'mapText') return '<map text omitted>';
  if (key === 'data' || key === 'imageDataUrl') return '<binary image omitted>';
  if (typeof value === 'string') return value.length > 800 ? `${value.slice(0, 800)}… <${value.length - 800} chars omitted>` : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= maxDepth) return Array.isArray(value) ? `<array ${value.length}>` : '<object>';
  if (Array.isArray(value)) {
    const items = value.slice(0, maxArray).map(item => summarized(item, '', { ...options, depth: depth + 1 }));
    if (value.length > maxArray) items.push(`<${value.length - maxArray} items omitted>`);
    return items;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([childKey, childValue]) => [childKey, summarized(childValue, childKey, { ...options, depth: depth + 1 })]));
}

export class McpActivityLog {
  readonly filePath: string;
  private entries: McpActivityEntry[] = [];

  constructor(
    readonly directory: string,
    readonly mcpSessionId: string,
    private readonly onEntry?: (entry: McpActivityEntry) => void,
  ) {
    this.filePath = join(resolve(directory), `${mcpSessionId}.jsonl`);
  }

  async record(entry: Omit<McpActivityEntry, 'id' | 'timestamp' | 'mcpSessionId' | 'arguments' | 'result'> & {
    arguments: unknown; result: unknown;
  }): Promise<void> {
    const complete: McpActivityEntry = {
      id: `${this.mcpSessionId}:${this.entries.length + 1}`,
      timestamp: new Date().toISOString(),
      mcpSessionId: this.mcpSessionId,
      ...entry,
      arguments: summarized(entry.arguments),
      result: summarized(entry.result, '', { maxDepth: 4, maxArray: 20 }),
    };
    await mkdir(this.directory, { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(complete)}\n`, 'utf8');
    this.entries.push(complete);
    this.onEntry?.(complete);
  }

  recent(limit = 50, editorSessionId?: string): McpActivityEntry[] {
    const filtered = editorSessionId ? this.entries.filter(entry => entry.editorSessionId === editorSessionId) : this.entries;
    return filtered.slice(-Math.max(1, Math.min(limit, 500)));
  }

  page(limit = 50, cursor?: string, editorSessionId?: string): { entries: McpActivityEntry[]; nextCursor: string | null; filteredCount: number } {
    const filtered = editorSessionId ? this.entries.filter(entry => entry.editorSessionId === editorSessionId) : this.entries;
    let end = filtered.length;
    if (cursor) {
      end = filtered.findIndex(entry => entry.id === cursor);
      if (end < 0) throw new Error('Activity cursor is no longer available; restart from the newest page');
    }
    const start = Math.max(0, end - Math.max(1, Math.min(limit, 100)));
    const entries = filtered.slice(start, end);
    return { entries, nextCursor: start > 0 ? entries[0].id : null, filteredCount: filtered.length };
  }

  get count(): number { return this.entries.length; }
}
