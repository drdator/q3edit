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

describe('MCP angled brush and patch operations', () => {
  test('creates every generic patch preset with stable aliases and groups', () => {
    const editor = emptyEditor();
    const presets = ['bevel', 'endcap', 'cylinder', 'arch', 'pipe', 'ramp'] as const;
    const result = applyMapOperations(editor, presets.map((preset, index) => ({
      type: 'create_patch' as const,
      id: preset,
      group: `Patch ${preset}`,
      preset,
      mins: [index * 160, 0, 0] as [number, number, number],
      maxs: [index * 160 + 128, 96, 192] as [number, number, number],
      texture: 'base_wall/metal',
      textureMode: 'natural' as const,
      subdivisions: 4,
    })));

    expect(editor.worldspawn.patches).toHaveLength(6);
    expect(editor.worldspawn.patches.every(patch => patch.subdivisions === 4 && patch.tessIndices.length > 0)).toBe(true);
    expect(editor.worldspawn.patches.every(patch => patch.editorGroupId)).toBe(true);
    for (const preset of presets) expect(result.aliases[`@${preset}`]).toEqual([expect.stringMatching(/^E0:P/)]);
    expect(parseMapWithDiagnostics(editor.serializeMap()).diagnostics).toEqual([]);
  });

  test('fits and transforms patch texture coordinates then thickens atomically', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      {
        type: 'create_patch', id: 'arch', preset: 'arch', mins: [-128, -16, 0], maxs: [128, 16, 192],
        texture: 'base_trim/metal', textureMode: 'fit',
      },
      {
        type: 'edit_patches', targets: ['@arch'], texture: 'base_trim/pewter', textureMode: 'fit',
        shift: [0.25, 0], scale: [2, 1], rotateDegrees: 90, subdivisions: 8,
      },
      { type: 'thicken_patch', id: 'shell', targets: ['@arch'], amount: 16, caps: true, group: 'Thick arch' },
    ]);

    expect(editor.worldspawn.patches).toHaveLength(6);
    expect(editor.worldspawn.patches.every(patch => patch.texture === 'base_trim/pewter')).toBe(true);
    expect(editor.worldspawn.patches.every(patch => patch.subdivisions === 8 && patch.editorGroupId)).toBe(true);
    expect(result.aliases['@shell']).toHaveLength(6);
  });

  test('creates tapered and offset trapezoid brushes with angled side planes', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [{
      type: 'create_tapered', mins: [-64, -64, 0], maxs: [64, 64, 192],
      topScale: [0.5, 0.75], topOffset: [24, 0], texture: 'base_wall/stone',
    }]);

    const brush = editor.worldspawn.brushes[0];
    expect(brush.faces).toHaveLength(6);
    expect(brush.faces.filter(face => Math.abs(face.plane.normal[2]) > 0.01 && Math.abs(face.plane.normal[2]) < 0.99)).toHaveLength(4);
    expect(parseMapWithDiagnostics(editor.serializeMap()).diagnostics).toEqual([]);
  });
});
