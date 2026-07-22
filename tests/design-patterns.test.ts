import { describe, expect, test } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { applyMapOperations } from '../src/map-operations';
import { collectMapStatistics } from '../bridge/map-statistics';
import { searchDesignPatterns } from '../bridge/design-patterns';

describe('abstract MCP design patterns', () => {
  test('matches gameplay goals and adapts scale without returning fixed geometry', () => {
    const editor = new Editor();
    editor.entities = [createEntity('worldspawn')];
    applyMapOperations(editor, [{ type: 'create_box', mins: [-512, -384, 0], maxs: [512, 384, 256] }]);
    const results = searchDesignPatterns('curved flanking route with glimpses', ['route choice'], 'medium', 3, collectMapStatistics(editor.serializeMap()));

    expect(results[0]).toMatchObject({
      id: 'curved-flank-corridor', scale: expect.arrayContaining(['medium']),
      areaConstraints: expect.arrayContaining([expect.objectContaining({ role: 'flank' })]),
      routeConstraints: expect.arrayContaining([expect.objectContaining({ visibility: 'glimpse' })]),
      liveMapAdaptation: { worldBounds: expect.any(Object), recommendedSpan: expect.any(Array) },
    });
    expect(results.flatMap(result => result.areaConstraints).every(constraint => !('bounds' in constraint))).toBe(true);
    expect(results.flatMap(result => result.routeConstraints).every(constraint => !('points' in constraint))).toBe(true);
  });

  test('offers the full catalog when no search preference is supplied', () => {
    const statistics = collectMapStatistics('// empty');
    const results = searchDesignPatterns('', [], undefined, 8, statistics);
    expect(results).toHaveLength(8);
    expect(results.map(result => result.id)).toEqual(expect.arrayContaining([
      'raised-perimeter-loop', 'crossing-bridges', 'split-level-room', 'curved-flank-corridor',
      'radial-landmark', 'compression-release-entrance', 'vertical-courtyard', 'layered-exposed-center',
    ]));
  });
});
