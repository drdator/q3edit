import { describe, expect, test } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { applyMapOperations } from '../src/map-operations';
import { parseMapWithDiagnostics } from '../src/mapfile';
import { constructionPathSummary, readConstructionPaths } from '../src/construction-paths';

function emptyEditor(): Editor {
  const editor = new Editor();
  editor.entities = [createEntity('worldspawn')];
  return editor;
}

describe('MCP construction paths', () => {
  test('creates a curved corridor with a durable source-to-group relationship', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [{
      type: 'create_path', id: 'west_flank', kind: 'corridor', curve: 'catmull-rom',
      points: [[-256, -128, 64], [-96, -64, 80], [64, 96, 112], [256, 128, 128]],
      width: 96, thickness: 16, subdivisions: 5, join: 'bevel', bankDegrees: 4,
      texture: 'base_floor/metal', group: 'West curved flank',
    }]);

    const document = readConstructionPaths(editor.worldspawn.properties);
    expect(document.paths).toEqual([expect.objectContaining({
      id: 'west_flank', kind: 'corridor', curve: 'catmull-rom', sampledPointCount: 16,
      objectCount: editor.worldspawn.brushes.length, groupId: expect.stringMatching(/^spatial-/),
      bounds: { mins: expect.any(Array), maxs: expect.any(Array) },
    })]);
    expect(editor.worldspawn.brushes.length).toBeGreaterThan(4);
    expect(editor.worldspawn.brushes.every(brush => brush.editorGroupId === document.paths[0].groupId)).toBe(true);
    expect(result.aliases['@west_flank']).toHaveLength(editor.worldspawn.brushes.length);
    expect(result.changed).toContain('E0');
    expect(parseMapWithDiagnostics(editor.serializeMap()).diagnostics).toEqual([]);
  });

  test('supports architectural path roles with deterministic spacing and editable brushes', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      { type: 'create_path', id: 'wall', kind: 'wall', points: [[0, 0, 0], [192, 0, 32]], width: 16, height: 128 },
      { type: 'create_path', id: 'rail', kind: 'railing', points: [[0, 96, 32], [192, 96, 64]], width: 8, height: 48, thickness: 8, spacing: 48 },
      { type: 'create_path', id: 'pipe', kind: 'pipe', points: [[0, 160, 96], [96, 224, 128], [224, 224, 128]], width: 24, sides: 8 },
      { type: 'create_path', id: 'stairs', kind: 'stairs', curve: 'catmull-rom', points: [[0, 320, 16], [96, 352, 64], [224, 320, 128]], width: 80, spacing: 24 },
      { type: 'create_path', id: 'supports', kind: 'supports', points: [[0, 448, 192], [256, 448, 192]], width: 16, height: 192, spacing: 64 },
    ]);

    const document = readConstructionPaths(editor.worldspawn.properties);
    const summary = constructionPathSummary(document);
    expect(summary).toMatchObject({
      count: 5,
      byKind: { wall: 1, railing: 1, pipe: 1, stairs: 1, supports: 1 },
      totalObjects: editor.worldspawn.brushes.length,
      bounds: { mins: expect.any(Array), maxs: expect.any(Array) },
    });
    expect(editor.worldspawn.brushes.length).toBeGreaterThan(15);
    expect(new Set(editor.worldspawn.brushes.map(brush => brush.editorGroupId)).size).toBe(5);
    expect(parseMapWithDiagnostics(editor.serializeMap()).diagnostics).toEqual([]);
  });

  test('rejects invalid or excessively dense paths before committing', () => {
    const editor = emptyEditor();
    expect(() => applyMapOperations(editor, [{
      type: 'create_path', id: 'bad', kind: 'supports', points: [[0, 0, 0], [1024, 0, 0]], width: 8, spacing: 1,
    }])).toThrow(/generated .* objects/);
    expect(editor.worldspawn.brushes).toHaveLength(0);
  });
});
