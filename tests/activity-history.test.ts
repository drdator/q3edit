import { describe, expect, it } from 'vitest';
import {
  ActivityHistory,
  activityFromMcp,
  filterActivity,
  summarizeActivity,
  type ActivityEntry,
} from '../src/activity-history';
import type { McpActivityEntry } from '../src/live-bridge/protocol';

function activity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'entry',
    timestamp: '2026-07-24T08:00:00.000Z',
    source: 'edit',
    status: 'success',
    category: 'change',
    title: 'Move selection',
    revisionBefore: 1,
    revisionAfter: 2,
    undoable: true,
    historical: false,
    ...overrides,
  };
}

describe('ActivityHistory', () => {
  it('filters by source, kind, error status, and searchable detail content', () => {
    const entries = [
      activity(),
      activity({
        id: 'mcp',
        source: 'mcp',
        category: 'read',
        title: 'map_query',
        revisionBefore: 2,
        revisionAfter: 2,
        undoable: false,
        details: [{ title: 'Arguments', value: { group: 'tower' } }],
      }),
      activity({
        id: 'build',
        source: 'build',
        category: 'build',
        status: 'error',
        title: 'BSP compilation failed',
        summary: 'Leak detected',
        revisionBefore: 2,
        revisionAfter: 2,
        undoable: false,
      }),
    ];

    expect(filterActivity(entries, { query: '', source: 'mcp', kind: 'all' }).map(entry => entry.id)).toEqual(['mcp']);
    expect(filterActivity(entries, { query: '', source: 'all', kind: 'changes' }).map(entry => entry.id)).toEqual(['entry']);
    expect(filterActivity(entries, { query: '', source: 'all', kind: 'errors' }).map(entry => entry.id)).toEqual(['build']);
    expect(filterActivity(entries, { query: 'tower', source: 'all', kind: 'all' }).map(entry => entry.id)).toEqual(['mcp']);
  });

  it('summarizes events, changes, errors, and revision transitions', () => {
    const entries = [
      activity(),
      activity({ id: 'same', revisionBefore: 2, revisionAfter: 2 }),
      activity({ id: 'error', status: 'error', category: 'build', revisionBefore: 2, revisionAfter: 2 }),
    ];
    expect(summarizeActivity(entries)).toEqual({ total: 3, changes: 2, errors: 1, revisions: 1 });
  });

  it('restores persisted entries as historical and non-undoable', () => {
    const history = new ActivityHistory();
    history.restore([activity()]);
    expect(history.list()).toEqual([
      expect.objectContaining({ historical: true, undoable: false }),
    ]);
  });

  it('converts MCP calls into detailed read or change entries', () => {
    const entry: McpActivityEntry = {
      id: 'mcp-entry',
      timestamp: '2026-07-24T08:00:00.000Z',
      mcpSessionId: 'mcp-session',
      editorSessionId: 'editor-session',
      tool: 'map_apply',
      readOnly: false,
      status: 'success',
      durationMs: 12,
      revisionBefore: 2,
      revisionAfter: 3,
      revisionDelta: 1,
      arguments: { operations: [] },
      result: { revision: 3 },
    };
    expect(activityFromMcp(entry)).toEqual(expect.objectContaining({
      id: 'mcp-entry',
      source: 'mcp',
      category: 'change',
      undoable: true,
      title: 'map_apply',
    }));
  });
});
