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

describe('MCP brush refinement operations', () => {
  test('extrudes a selected face while preserving its material projection', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      {
        type: 'create_box', id: 'block', mins: [0, 0, 0], maxs: [128, 96, 64], texture: 'base_wall/metal',
        textures: { top: 'base_floor/diamond', bottom: 'common/caulk', sides: 'base_wall/metal' },
      },
      { type: 'offset_faces', targets: ['@block:F4'], distance: 32 },
    ]);

    const brush = editor.worldspawn.brushes[0];
    expect(brush.maxs).toEqual([128, 96, 96]);
    expect(brush.faces[4].texture).toBe('base_floor/diamond');
    expect(brush.faces[4].textureProjection).toMatchObject({ kind: 'classic', scaleX: 0.5, scaleY: 0.5 });
    expect(parseMapWithDiagnostics(editor.serializeMap()).diagnostics).toEqual([]);
  });

  test('chamfers chosen corners and keeps named-group membership', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      { type: 'create_box', id: 'column', group: 'Angled columns', mins: [-64, -64, 0], maxs: [64, 64, 192], texture: 'base_wall/stone' },
      {
        type: 'chamfer_brushes', id: 'cut_column', targets: ['@column'], amount: 24, axis: 'z',
        corners: ['min-min', 'min-max', 'max-min', 'max-max'], texture: 'base_trim/metal', textureMode: 'fit',
      },
    ]);

    const brush = editor.worldspawn.brushes[0];
    expect(brush.faces).toHaveLength(10);
    expect(brush.faces.filter(face => face.texture === 'base_trim/metal')).toHaveLength(4);
    expect(brush.editorGroupId).toBeTruthy();
    expect(result.aliases['@cut_column']).toEqual(['E0:B0']);
    expect(parseMapWithDiagnostics(editor.serializeMap()).diagnostics).toEqual([]);
  });

  test('tapers an existing box on any axis while preserving semantic face styles', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      {
        type: 'create_box', id: 'beam', group: 'Tapered structure', mins: [0, -48, -32], maxs: [256, 48, 32],
        texture: 'base_wall/metal', textures: { top: 'base_trim/light', bottom: 'common/caulk', sides: 'base_wall/metal' },
      },
      { type: 'taper_brushes', targets: ['@beam'], axis: 'x', endScale: [0.5, 0.75], endOffset: [8, 4] },
    ]);

    const brush = editor.worldspawn.brushes[0];
    expect(brush.faces).toHaveLength(6);
    expect(brush.faces.some(face => Math.abs(face.plane.normal[0]) > 0.01 && Math.abs(face.plane.normal[0]) < 0.99)).toBe(true);
    expect(brush.faces.map(face => face.texture)).toEqual(expect.arrayContaining(['base_trim/light', 'common/caulk', 'base_wall/metal']));
    expect(brush.editorGroupId).toBeTruthy();
    expect(parseMapWithDiagnostics(editor.serializeMap()).diagnostics).toEqual([]);
  });

  test('preserves groups through clipping and CSG replacement fragments', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      { type: 'create_box', id: 'wall', group: 'Cut architecture', mins: [0, 0, 0], maxs: [192, 32, 160] },
      { type: 'create_box', id: 'door', mins: [64, -8, 0], maxs: [128, 40, 112] },
      { type: 'csg_subtract', targets: ['@wall'], carvers: ['@door'], deleteCarvers: true },
    ]);
    expect(editor.worldspawn.brushes.length).toBeGreaterThan(1);
    expect(editor.worldspawn.brushes.every(brush => brush.editorGroupId)).toBe(true);
  });
});
