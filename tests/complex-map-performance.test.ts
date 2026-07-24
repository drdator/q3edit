import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import {
  collectComplexMapCounts,
  createComplexMapFixture,
  runComplexMapBenchmark,
} from '../src/complex-map-performance';
import { Editor } from '../src/editor';
import { MapSpatialIndex } from '../src/map-spatial-index';
import { createFlatPatch } from '../src/patch';
import { activityRenderWindow } from '../src/live-bridge/activity-panel';

describe('complex map scalability', () => {
  it('defines repeatable fixture sizes with useful workload counts', () => {
    const small = createComplexMapFixture('small');
    const medium = createComplexMapFixture('medium');
    expect(collectComplexMapCounts(small)).toMatchObject({ brushes: 64, faces: 384 });
    expect(collectComplexMapCounts(medium)).toMatchObject({ brushes: 512, faces: 3_072 });
    expect(collectComplexMapCounts(medium).patchControlPoints).toBeGreaterThan(0);
  });

  it('indexes point and region queries without returning distant objects', () => {
    const editor = new Editor();
    editor.worldspawn.brushes = [
      createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/metal'),
      createBoxBrush([1_024, 1_024, 0], [1_088, 1_088, 64], 'base_wall/metal'),
    ];
    editor.worldspawn.patches = [createFlatPatch([128, 0, 0], [256, 128, 0], 'base_floor/stone')];
    const index = new MapSpatialIndex(editor);
    expect(index.queryPoint2D(0, 1, 32, 32).filter(entry => entry.kind === 'brush')).toHaveLength(1);
    expect(index.queryBounds2D(0, 1, -1, -1, 300, 300).map(entry => entry.kind)).toEqual(expect.arrayContaining(['brush', 'patch']));
    expect(index.queryBounds2D(0, 1, -1, -1, 300, 300).some(entry => entry.mins[0] > 1_000)).toBe(false);
    expect(index.estimatedBytes()).toBeGreaterThan(0);
  });

  it('reports all production workloads and explicit budgets', () => {
    const report = runComplexMapBenchmark('small');
    expect(report.metrics.map(item => item.name)).toEqual(expect.arrayContaining([
      'initial load', 'parse and geometry calculation', 'asset discovery', 'viewport geometry preparation',
      'indexed picking', 'region selection', 'transform 64 brushes', 'undo', 'redo', 'diagnostics',
      'save serialization', 'compile preparation',
    ]));
    expect(report.metrics.every(item => item.budgetMilliseconds > 0 && Number.isFinite(item.milliseconds))).toBe(true);
    expect(report.memory.spatialIndexBytes).toBeGreaterThan(0);
  });

  it('renders bounded chronological activity windows', () => {
    const result = activityRenderWindow(Array.from({ length: 1_000 }, (_, index) => index), 250);
    expect(result.entries).toHaveLength(250);
    expect(result.entries[0]).toBe(750);
    expect(result.entries[249]).toBe(999);
    expect(result.hidden).toBe(750);
  });
});
