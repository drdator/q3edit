import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { McpActivityLog } from '../bridge/activity-log';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('MCP activity pagination', () => {
  test('uses stable entry cursors and preserves chronological pages', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'q3edit-activity-page-'));
    directories.push(directory);
    const log = new McpActivityLog(directory, 'session');
    for (const tool of ['map_status', 'map_preview', 'map_apply']) {
      await log.record({
        editorSessionId: 'editor-a', tool, readOnly: tool !== 'map_apply', durationMs: 1, status: 'success',
        revisionBefore: 1, revisionAfter: tool === 'map_apply' ? 2 : 1, revisionDelta: tool === 'map_apply' ? 1 : 0,
        arguments: {}, result: {},
      });
    }

    const newest = log.page(2);
    expect(newest.entries.map(entry => entry.tool)).toEqual(['map_preview', 'map_apply']);
    expect(newest.nextCursor).toBe('session:2');

    await log.record({
      editorSessionId: 'editor-a', tool: 'editor_review', readOnly: true, durationMs: 1, status: 'success',
      revisionBefore: 2, revisionAfter: 2, revisionDelta: 0, arguments: {}, result: {},
    });
    const older = log.page(2, newest.nextCursor!);
    expect(older.entries.map(entry => entry.tool)).toEqual(['map_status']);
    expect(older.nextCursor).toBeNull();
  });
});
