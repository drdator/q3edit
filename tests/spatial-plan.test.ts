import { describe, expect, test } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { applyMapOperations } from '../src/map-operations';
import { inspectSpatialPlan, readSpatialPlan } from '../src/spatial-plan';

function emptyEditor(): Editor {
  const editor = new Editor();
  editor.entities = [createEntity('worldspawn')];
  return editor;
}

describe('semantic spatial plans', () => {
  test('persists areas independently from generated geometry', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [{
      type: 'create_area', id: 'atrium', purpose: 'central combat landmark', shape: 'radial',
      center: [0, 0, 64], radius: 192, height: 256, levels: [64, 160],
      openings: [{ side: 'north', width: 96 }], landmarkIntent: 'visible reactor above the upper route',
    }]);

    const plan = readSpatialPlan(editor.worldspawn.properties);
    expect(editor.worldspawn.brushes).toHaveLength(0);
    expect(plan.areas).toEqual([expect.objectContaining({
      id: 'atrium', shape: 'radial', levels: [64, 160],
    })]);
    expect(result.changed).toContain('E0');
  });

  test('creates editable grouped floors and a connection in one atomic batch', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      {
        type: 'create_area', id: 'lower', purpose: 'entry', shape: 'rectangular', center: [0, 0, 32],
        bounds: { mins: [-128, -128, 32], maxs: [128, 128, 192] }, height: 160, geometry: 'floor', texture: 'base_floor/concrete',
      },
      {
        type: 'create_area', id: 'upper', purpose: 'upper control', shape: 'octagonal', center: [384, 128, 128],
        radius: 128, height: 192, geometry: 'floor', texture: 'base_floor/metal',
      },
      {
        type: 'connect_areas', id: 'main_ramp', fromArea: 'lower', toArea: 'upper', routeType: 'ramp',
        width: 96, cover: 'open', visibility: 'visible', traversalIntent: 'primary exposed ascent',
        geometry: 'floor', thickness: 16, texture: 'base_floor/metal',
      },
    ]);

    const plan = readSpatialPlan(editor.worldspawn.properties);
    expect(plan.areas).toHaveLength(2);
    expect(plan.connections).toEqual([expect.objectContaining({ id: 'main_ramp', fromArea: 'lower', toArea: 'upper' })]);
    expect(editor.worldspawn.brushes).toHaveLength(3);
    expect(editor.worldspawn.brushes.every(brush => brush.editorGroupId?.startsWith('spatial-'))).toBe(true);
    expect(result.aliases).toMatchObject({ '@lower': [expect.stringMatching(/^E0:B/)], '@upper': [expect.stringMatching(/^E0:B/)], '@main_ramp': [expect.stringMatching(/^E0:B/)] });

    const inspection = inspectSpatialPlan(plan);
    expect(inspection.connectedComponents).toEqual([['lower', 'upper']]);
    expect(inspection.routeTypes.ramp).toBe(1);
    expect(inspection.bounds).not.toBeNull();
  });

  test('rejects a connection to an area that does not exist', () => {
    const editor = emptyEditor();
    expect(() => applyMapOperations(editor, [{
      type: 'connect_areas', id: 'missing_route', fromArea: 'one', toArea: 'two', routeType: 'corridor', width: 96,
    }])).toThrow(/missing one, two/);
  });
});
