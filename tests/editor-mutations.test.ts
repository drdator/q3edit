import { describe, expect, test } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';

function editorWithBrush(): Editor {
  const editor = new Editor();
  const worldspawn = createEntity('worldspawn');
  const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
  worldspawn.brushes.push(brush);
  editor.entities = [worldspawn];
  editor.selection = [{ type: 'brush', entity: worldspawn, brush }];
  return editor;
}

describe('transactional editor mutations', () => {
  test('makes brush creation undoable without a caller snapshot', () => {
    const editor = new Editor();
    editor.entities = [createEntity('worldspawn')];

    editor.addBrush([0, 0, 0], [64, 64, 64], 2);

    expect(editor.entities[0].brushes).toHaveLength(1);
    expect(editor.history.undoLabel).toBe('Create brush');
    editor.undo();
    expect(editor.entities[0].brushes).toHaveLength(0);
  });

  test('commits a continuous drag as one labeled undo entry', () => {
    const editor = editorWithBrush();

    editor.beginTransaction('Drag selection');
    editor.moveSelection([8, 0, 0]);
    editor.moveSelection([8, 0, 0]);
    editor.commitTransaction();

    expect(editor.history.undoCount).toBe(1);
    expect(editor.history.undoLabel).toBe('Drag selection');
    expect(editor.entities[0].brushes[0].mins[0]).toBeCloseTo(16);
    editor.undo();
    expect(editor.entities[0].brushes[0].mins[0]).toBeCloseTo(0);
  });

  test('does not add history when a command leaves the document unchanged', () => {
    const editor = editorWithBrush();

    editor.snapSelectionToGrid();

    expect(editor.history.canUndo).toBe(false);
  });

  test('makes terrain creation one undoable command', () => {
    const editor = editorWithBrush();

    editor.createTerrainPatch();

    expect(editor.entities[0].patches).toHaveLength(1);
    expect(editor.history.undoLabel).toBe('Create terrain');
    editor.undo();
    expect(editor.entities[0].patches).toHaveLength(0);
  });
});
