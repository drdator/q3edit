import { describe, expect, it } from 'vitest';
import { filterMcpActivity, summarizeMcpActivity } from '../src/mcp-activity-dialog';
import type { McpActivityEntry } from '../src/live-bridge-protocol';

function entry(overrides: Partial<McpActivityEntry>): McpActivityEntry {
  return {
    id: 'mcp:1', timestamp: '2026-07-21T08:00:00.000Z', mcpSessionId: 'mcp', editorSessionId: 'editor-a',
    tool: 'map_status', readOnly: true, durationMs: 4, status: 'success',
    revisionBefore: 3, revisionAfter: 3, revisionDelta: 0,
    arguments: {}, result: { revision: 3 }, ...overrides,
  };
}

describe('MCP activity dialog model', () => {
  const entries = [
    entry({ id: 'mcp:1' }),
    entry({
      id: 'mcp:2', tool: 'map_apply', readOnly: false,
      revisionBefore: 3, revisionAfter: 4, revisionDelta: 1,
      arguments: { label: 'Add tower' },
    }),
    entry({ id: 'mcp:3', tool: 'map_compile', status: 'error', result: { message: 'Leak detected' } }),
  ];

  it('filters by call kind, status, and searchable details', () => {
    expect(filterMcpActivity(entries, { query: '', status: 'all', kind: 'action' }).map(item => item.tool)).toEqual(['map_apply']);
    expect(filterMcpActivity(entries, { query: '', status: 'error', kind: 'all' }).map(item => item.tool)).toEqual(['map_compile']);
    expect(filterMcpActivity(entries, { query: 'tower', status: 'all', kind: 'all' }).map(item => item.tool)).toEqual(['map_apply']);
    expect(filterMcpActivity(entries, { query: 'leak', status: 'all', kind: 'all' }).map(item => item.tool)).toEqual(['map_compile']);
  });

  it('summarizes calls, actions, errors, and document revisions', () => {
    expect(summarizeMcpActivity(entries)).toEqual({ total: 3, actions: 1, errors: 1, revisions: 1 });
  });
});
