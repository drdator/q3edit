import { describe, expect, test } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { applyMapOperations } from '../src/map-operations';
import { parseMapWithDiagnostics } from '../src/mapfile';

function emptyEditor(): Editor {
  const editor = new Editor();
  editor.entities = [createEntity('worldspawn')];
  return editor;
}

describe('MCP controlled variation', () => {
  test('cycles deterministic spacing, scale, rotation, and labeled material roles', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      { type: 'create_box', id: 'module', mins: [-16, -16, 0], maxs: [16, 16, 64], texture: 'base_wall/metal' },
      {
        type: 'repeat_variation', id: 'rhythm', group: 'Facade rhythm', targets: ['@module'], copies: 4,
        distribution: 'linear', stepSequence: [[64, 0, 0], [96, 0, 0]],
        scaleSequence: [[1, 1, 1], [0.75, 0.75, 1]], rotationSequence: [0, 15],
        materialSequence: [
          { texture: 'base_wall/metal', role: 'primary' },
          { texture: 'base_trim/pewter', role: 'accent' },
        ],
      },
    ]);

    expect(result.aliases['@rhythm']).toHaveLength(4);
    expect(editor.worldspawn.brushes.slice(1).map(brush => [...new Set(brush.faces.map(face => face.texture))])).toEqual([
      ['base_wall/metal'], ['base_trim/pewter'], ['base_wall/metal'], ['base_trim/pewter'],
    ]);
    expect(editor.worldspawn.brushes.slice(1).map(brush => Math.round((brush.mins[0] + brush.maxs[0]) / 2))).toEqual([64, 160, 224, 320]);
    expect(new Set(editor.worldspawn.brushes.slice(1).map(brush => brush.editorGroupId)).size).toBe(1);
    expect(parseMapWithDiagnostics(editor.serializeMap()).diagnostics).toEqual([]);
  });

  test('supports radial and mirrored distributions', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      { type: 'create_box', id: 'radial_source', mins: [96, -8, 0], maxs: [112, 8, 48] },
      { type: 'repeat_variation', targets: ['@radial_source'], copies: 3, distribution: 'radial', center: [0, 0, 0], axis: 'z', angleStepDegrees: 90 },
      { type: 'create_box', id: 'mirror_source', mins: [32, 128, 0], maxs: [64, 160, 32] },
      { type: 'repeat_variation', targets: ['@mirror_source'], copies: 1, distribution: 'mirror', center: [0, 0, 0], axis: 'x' },
    ]);

    const centers = editor.worldspawn.brushes.slice(1, 4).map(brush => brush.maxs.map((value, axis) => Math.round((value + brush.mins[axis]) / 2) || 0));
    expect(centers).toEqual([[0, 104, 24], [-104, 0, 24], [0, -104, 24]]);
    const mirrored = editor.worldspawn.brushes[editor.worldspawn.brushes.length - 1];
    expect([mirrored.mins[0], mirrored.maxs[0]]).toEqual([-64, -32]);
  });

  test('seeded bounds are reproducible and reject unsafe scale', () => {
    const build = (seed: number) => {
      const editor = emptyEditor();
      applyMapOperations(editor, [
        { type: 'create_box', id: 'source', mins: [0, 0, 0], maxs: [16, 16, 16] },
        {
          type: 'repeat_variation', targets: ['@source'], copies: 6, delta: [48, 0, 0], seed, grid: 8,
          variation: { position: [12, 12, 0], rotationDegrees: 5, scale: [0.1, 0.1, 0.1] },
        },
      ]);
      return editor.worldspawn.brushes.slice(1).map(brush => ({ mins: brush.mins, maxs: brush.maxs }));
    };
    expect(build(42)).toEqual(build(42));
    expect(build(42)).not.toEqual(build(43));

    const editor = emptyEditor();
    expect(() => applyMapOperations(editor, [
      { type: 'create_box', id: 'source', mins: [0, 0, 0], maxs: [16, 16, 16] },
      { type: 'repeat_variation', targets: ['@source'], copies: 1, delta: [32, 0, 0], variation: { scale: [2, 0, 0] } },
    ])).toThrow(/safe .* range/);
  });
});
