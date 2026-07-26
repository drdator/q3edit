import { describe, expect, it } from 'vitest';
import {
  collectComplexMapCounts,
  createComplexMapFixture,
  runCurrentMapBenchmark,
  runComplexMapBenchmark,
} from '../src/complex-map-performance';
import { activityRenderWindow } from '../src/live-bridge/activity-panel';

describe('complex map scalability', () => {
  it('defines repeatable fixture sizes with useful workload counts', () => {
    const small = createComplexMapFixture('small');
    const medium = createComplexMapFixture('medium');
    expect(collectComplexMapCounts(small)).toMatchObject({ brushes: 64 });
    expect(collectComplexMapCounts(medium)).toMatchObject({ brushes: 512 });
    expect(collectComplexMapCounts(small).faces).toBeGreaterThan(384);
    expect(collectComplexMapCounts(medium).patchControlPoints).toBeGreaterThan(0);
  });

  it('reports all production workloads and explicit budgets', () => {
    const report = runComplexMapBenchmark('small');
    expect(report.metrics.map(item => item.name)).toEqual(expect.arrayContaining([
      'initial load', 'parse and geometry calculation', 'asset discovery', 'viewport geometry preparation',
      '2D picking candidates', 'region selection', 'transform 64 brushes', 'undo', 'redo', 'diagnostics',
      'save serialization', 'compile preparation',
    ]));
    expect(report.metrics.every(item => item.budgetMilliseconds > 0 && Number.isFinite(item.milliseconds))).toBe(true);
    expect(report.metrics.find(item => item.name === 'viewport geometry preparation')).toMatchObject({
      budgetMilliseconds: 16.7,
      budgetClass: 'frame',
    });
    expect(report.metrics.find(item => item.name === '2D picking candidates')).toMatchObject({
      budgetMilliseconds: 2,
      budgetClass: 'interaction',
    });
  });

  it('benchmarks a detached copy of the current map', () => {
    const editor = createComplexMapFixture('small');
    const before = editor.serializeMap();
    const report = runCurrentMapBenchmark(editor);
    expect(report.fixture).toBe('current');
    expect(report.counts.brushes).toBe(64);
    expect(editor.serializeMap()).toBe(before);
  });

  it('renders bounded chronological activity windows', () => {
    const result = activityRenderWindow(Array.from({ length: 1_000 }, (_, index) => index), 250);
    expect(result.entries).toHaveLength(250);
    expect(result.entries[0]).toBe(750);
    expect(result.entries[249]).toBe(999);
    expect(result.hidden).toBe(750);
  });
});
