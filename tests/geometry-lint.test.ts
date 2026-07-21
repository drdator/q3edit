import { describe, expect, test } from 'vitest';
import { lintGeometry } from '../bridge/geometry-lint';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { applyMapOperations } from '../src/map-operations';

function emptyEditor(): Editor {
  const editor = new Editor();
  editor.entities = [createEntity('worldspawn')];
  return editor;
}

describe('MCP geometry quality lint', () => {
  test('finds duplicate brushes and same-plane overlaps', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      { type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64] },
      { type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64] },
      { type: 'create_box', mins: [32, 32, 0], maxs: [96, 96, 64] },
    ]);

    const result = lintGeometry(editor.serializeMap());
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-brush', refs: ['E0:B0', 'E0:B1'] }),
      expect.objectContaining({ code: 'coplanar-overlap', refs: expect.arrayContaining(['E0:B0:F4', 'E0:B2:F4']) }),
    ]));
  });

  test('finds thin, sliver, and compiler-grid geometry', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      { type: 'create_box', mins: [0.13, 0, 0], maxs: [64, 64, 0.5] },
    ]);

    const result = lintGeometry(editor.serializeMap());
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'thin-brush', refs: ['E0:B0'] }),
      expect.objectContaining({ code: 'sliver-face', refs: expect.arrayContaining(['E0:B0:F0']) }),
      expect.objectContaining({ code: 'off-grid-geometry', refs: ['E0:B0'] }),
    ]));
  });

  test('suggests detail classification only for small structural world geometry', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      { type: 'create_box', id: 'structural', mins: [0, 0, 0], maxs: [32, 32, 32] },
      { type: 'create_box', id: 'detail', mins: [64, 0, 0], maxs: [96, 32, 32] },
      { type: 'set_brush_classification', targets: ['@detail'], classification: 'detail' },
    ]);

    const suggestions = lintGeometry(editor.serializeMap()).issues.filter(issue => issue.code === 'likely-structural-detail');
    expect(suggestions).toEqual([expect.objectContaining({ refs: ['E0:B0'] })]);
  });
});
