import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { createEntity, createWorldspawn } from '../src/entity';
import { ensureEditorObjectIds } from '../src/editor-object-ids';
import { cloneMapSnapshot } from '../src/history';
import {
  acceptBaselineEntry,
  diffMaps,
  mergeMapsThreeWay,
} from '../src/map-diff';

function baseMap() {
  const worldspawn = createWorldspawn();
  worldspawn.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/concrete'));
  const light = createEntity('light', [32, 32, 96]);
  light.properties.light = '300';
  const entities = [worldspawn, light];
  ensureEditorObjectIds(entities);
  return entities;
}

describe('map diff', () => {
  it('reports stable object additions, removals, and modifications', () => {
    const baseline = baseMap();
    const current = cloneMapSnapshot(baseline);
    current[0].brushes[0].faces[0].texture = 'base_wall/metal';
    current.splice(1, 1);
    current.push(createEntity('info_player_deathmatch', [128, 0, 32]));
    ensureEditorObjectIds(current);

    const result = diffMaps(current, baseline);
    expect(result.counts).toEqual({ added: 1, removed: 1, modified: 1 });
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'brush', change: 'modified', correlation: 'stable-id' }),
      expect.objectContaining({ kind: 'entity', change: 'removed', label: expect.stringContaining('light') }),
      expect.objectContaining({ kind: 'entity', change: 'added', label: expect.stringContaining('info_player') }),
    ]));
  });

  it('accepts one baseline object without restoring the whole map', () => {
    const baseline = baseMap();
    const current = cloneMapSnapshot(baseline);
    current[0].brushes[0].faces[0].texture = 'base_wall/metal';
    current[1].properties.light = '700';
    const brushChange = diffMaps(current, baseline).entries.find(entry => entry.kind === 'brush')!;

    expect(acceptBaselineEntry(current, baseline, brushChange)).toBe(true);
    expect(current[0].brushes[0].faces[0].texture).toBe('base_wall/concrete');
    expect(current[1].properties.light).toBe('700');
  });
});

describe('three-way map merge', () => {
  it('applies independent incoming changes and keeps current changes', () => {
    const baseline = baseMap();
    const current = cloneMapSnapshot(baseline);
    const incoming = cloneMapSnapshot(baseline);
    current[0].brushes[0].faces[0].texture = 'base_wall/metal';
    incoming[1].properties.light = '900';

    const result = mergeMapsThreeWay(baseline, current, incoming);
    expect(result).toMatchObject({ applied: 1, conflicts: [], skipped: [] });
    expect(result.entities[0].brushes[0].faces[0].texture).toBe('base_wall/metal');
    expect(result.entities[1].properties.light).toBe('900');
  });

  it('reports same-object conflicts and leaves the current value in place', () => {
    const baseline = baseMap();
    const current = cloneMapSnapshot(baseline);
    const incoming = cloneMapSnapshot(baseline);
    current[1].properties.light = '600';
    incoming[1].properties.light = '900';

    const result = mergeMapsThreeWay(baseline, current, incoming);
    expect(result.applied).toBe(0);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ kind: 'entity', reason: expect.stringContaining('differently') }),
    ]);
    expect(result.entities[1].properties.light).toBe('600');
  });
});
