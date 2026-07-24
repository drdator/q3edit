import { describe, expect, it } from 'vitest';
import {
  BuildHistoryService,
  type BuildHistoryStorage,
  type BuildRecord,
} from '../src/build-history';

class MemoryStorage implements BuildHistoryStorage {
  records: BuildRecord[] = [];
  async list() { return structuredClone(this.records).sort((a, b) => b.startedAt - a.startedAt); }
  async save(record: BuildRecord) {
    this.records = [...this.records.filter(candidate => candidate.id !== record.id), structuredClone(record)];
  }
  async remove(id: string) { this.records = this.records.filter(record => record.id !== id); }
}

function record(id: string, startedAt: number, fileName = 'map.map'): BuildRecord {
  return {
    id, startedAt, fileName, documentRevision: startedAt, quality: 'normal', region: false,
    durationMs: 10, success: true, reused: false, stages: [], statistics: null,
    diagnostics: [], output: [], bsp: new Uint8Array([1]), aas: null, portalFileText: null,
  };
}

describe('build history', () => {
  it('keeps a bounded newest-first artifact history', async () => {
    const storage = new MemoryStorage();
    const history = new BuildHistoryService(storage, 3);
    for (let index = 0; index < 5; index++) await history.add(record(String(index), index));
    expect((await history.list()).map(item => item.id)).toEqual(['4', '3', '2']);
  });

  it('filters and resolves the previous build for one map', async () => {
    const storage = new MemoryStorage();
    const history = new BuildHistoryService(storage);
    await history.add(record('other', 3, 'other.map'));
    await history.add(record('current', 2));
    await history.add(record('previous', 1));
    expect((await history.list('map.map')).map(item => item.id)).toEqual(['current', 'previous']);
    expect((await history.previous('map.map', 'current'))?.id).toBe('previous');
  });
});
