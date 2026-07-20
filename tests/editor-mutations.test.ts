import { describe, expect, test } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { rotateGeometryFromOriginals } from '../src/editor-transforms';

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

  test('rotates misc_model yaw with the rotation commands', () => {
    const editor = new Editor();
    const worldspawn = createEntity('worldspawn');
    const model = createEntity('misc_model', [32, 0, 0]);
    model.properties.angle = '350';
    editor.entities = [worldspawn, model];
    editor.selection = [{ type: 'entity', entity: model }];
    editor.rotationAxis = 2;

    editor.rotateSelection(15);

    expect(model.properties.angle).toBe('5');
    editor.undo();
    expect(editor.entities[1].properties.angle).toBe('350');
  });

  test('rotates misc_model yaw and origin from an interactive-tool snapshot', () => {
    const editor = new Editor();
    const model = createEntity('misc_model', [32, 0, 0]);
    editor.entities = [createEntity('worldspawn'), model];

    rotateGeometryFromOriginals(editor, [], [], [{
      entity: model,
      origin: [32, 0, 0],
      angle: '350',
    }], [0, 0, 0], 2, Math.PI / 2);

    const origin = model.properties.origin.split(' ').map(Number);
    expect(origin[0]).toBeCloseTo(0);
    expect(origin[1]).toBeCloseTo(32);
    expect(origin[2]).toBeCloseTo(0);
    expect(model.properties.angle).toBe('80');
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
