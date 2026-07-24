import { describe, expect, it } from 'vitest';
import {
  clampMcpActivityPanelHeight,
  filterMcpActivity,
  isMcpActivityAtTail,
  isMcpActivityInDocumentSession,
  resizedMcpActivityPanelHeight,
  summarizeMcpActivity,
} from '../src/live-bridge';
import type { McpActivityEntry } from '../src/live-bridge';

function entry(overrides: Partial<McpActivityEntry>): McpActivityEntry {
  return {
    id: 'mcp:1', timestamp: '2026-07-21T08:00:00.000Z', mcpSessionId: 'mcp', editorSessionId: 'editor-a',
    tool: 'map_status', readOnly: true, durationMs: 4, status: 'success',
    revisionBefore: 3, revisionAfter: 3, revisionDelta: 0,
    arguments: {}, result: { revision: 3 }, ...overrides,
  };
}

describe('MCP activity panel helpers', () => {
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
    expect(filterMcpActivity(entries, { query: '', status: 'all', kind: 'all' }).map(item => item.id))
      .toEqual(['mcp:1', 'mcp:2', 'mcp:3']);
    expect(filterMcpActivity(entries, { query: '', status: 'all', kind: 'action' }).map(item => item.tool)).toEqual(['map_apply']);
    expect(filterMcpActivity(entries, { query: '', status: 'error', kind: 'all' }).map(item => item.tool)).toEqual(['map_compile']);
    expect(filterMcpActivity(entries, { query: 'tower', status: 'all', kind: 'all' }).map(item => item.tool)).toEqual(['map_apply']);
    expect(filterMcpActivity(entries, { query: 'leak', status: 'all', kind: 'all' }).map(item => item.tool)).toEqual(['map_compile']);
  });

  it('summarizes calls, actions, errors, and document revisions', () => {
    expect(summarizeMcpActivity(entries)).toEqual({ total: 3, actions: 1, errors: 1, revisions: 1 });
  });

  it('clamps and resizes the bottom drawer within the available viewport', () => {
    expect(clampMcpActivityPanelHeight(50, 900)).toBe(140);
    expect(clampMcpActivityPanelHeight(900, 900)).toBe(720);
    expect(resizedMcpActivityPanelHeight(280, 600, 500, 900)).toBe(380);
    expect(resizedMcpActivityPanelHeight(280, 600, 760, 900)).toBe(140);
  });

  it('follows the console tail only while the scroll position is near the end', () => {
    expect(isMcpActivityAtTail({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })).toBe(true);
    expect(isMcpActivityAtTail({ scrollTop: 376, scrollHeight: 500, clientHeight: 100 })).toBe(true);
    expect(isMcpActivityAtTail({ scrollTop: 300, scrollHeight: 500, clientHeight: 100 })).toBe(false);
  });

  it('keeps replayed activity scoped to the current document session', () => {
    const boundary = Date.parse('2026-07-21T08:00:01.000Z');
    expect(isMcpActivityInDocumentSession(entry({ timestamp: '2026-07-21T08:00:00.000Z' }), boundary)).toBe(false);
    expect(isMcpActivityInDocumentSession(entry({ timestamp: '2026-07-21T08:00:01.000Z' }), boundary)).toBe(true);
    expect(isMcpActivityInDocumentSession(entry({ timestamp: 'not-a-date' }), boundary)).toBe(true);
  });
});
