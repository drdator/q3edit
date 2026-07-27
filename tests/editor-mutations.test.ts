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

  test('commits a continuous UV drag as one document transaction', () => {
    const editor = editorWithBrush();
    const entity = editor.entities[0];
    const brush = entity.brushes[0];
    const face = brush.faces[4];
    editor.selection = [{ type: 'face', entity, brush, face }];
    const projection = face.textureProjection;
    expect(projection.kind).toBe('classic');
    if (projection.kind !== 'classic') return;
    const originalOffset = projection.offsetX;

    editor.beginTransaction('Shift texture');
    for (let index = 0; index < 120; index++) editor.shiftTexture(0.5, 0);
    editor.commitTransaction();

    expect(editor.history.undoCount).toBe(1);
    expect(editor.history.undoLabel).toBe('Shift texture');
    expect(projection.offsetX).toBeCloseTo(originalOffset + 60);
    editor.undo();
    const restored = editor.entities[0].brushes[0].faces[4].textureProjection;
    expect(restored.kind).toBe('classic');
    if (restored.kind === 'classic') expect(restored.offsetX).toBeCloseTo(originalOffset);
  });

  test('repeats the complete accumulated move as one undoable transform', () => {
    const editor = editorWithBrush();

    editor.beginTransaction('Drag selection');
    editor.moveSelection([8, 0, 0]);
    editor.moveSelection([8, 0, 0]);
    editor.commitTransaction();
    editor.repeatLastTransform();

    expect(editor.entities[0].brushes[0].mins[0]).toBeCloseTo(32);
    expect(editor.history.undoLabel).toBe('Move selection');
    editor.undo();
    expect(editor.entities[0].brushes[0].mins[0]).toBeCloseTo(16);
  });

  test('repeats rotation around its recorded axis and recentres on the selection', () => {
    const editor = editorWithBrush();
    editor.rotationAxis = 2;
    editor.rotateSelection(90);
    editor.rotationAxis = 0;

    editor.repeatLastTransform();

    expect(editor.rotationAxis).toBe(0);
    expect(editor.lastTransform).toEqual({
      kind: 'rotate',
      angleDeg: 90,
      axis: 2,
      centerMode: 'selection',
    });
    expect(editor.history.undoLabel).toBe('Rotate selection');
  });

  test('does not retain a transform from a cancelled gesture', () => {
    const editor = editorWithBrush();
    editor.moveSelection([4, 0, 0]);

    editor.beginTransaction('Cancelled drag');
    editor.moveSelection([12, 0, 0]);
    editor.cancelTransaction();
    const restoredBrush = editor.entities[0].brushes[0];
    editor.selection = [{ type: 'brush', entity: editor.entities[0], brush: restoredBrush }];
    editor.repeatLastTransform();

    expect(restoredBrush.mins[0]).toBeCloseTo(8);
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

  test('uses Q3Map2 pitch yaw roll ordering for three-axis misc_model rotations', () => {
    const editor = new Editor();
    const model = createEntity('misc_model', [0, 0, 0]);
    model.properties.angle = '20';
    editor.entities = [createEntity('worldspawn'), model];
    editor.selection = [{ type: 'entity', entity: model }];

    editor.rotationAxis = 0;
    editor.rotateSelection(30);
    expect(model.properties.angles).toBe('0 20 30');
    expect(model.properties.angle).toBeUndefined();

    editor.rotationAxis = 1;
    editor.rotateSelection(40);
    expect(model.properties.angles).toBe('40 20 30');

    editor.rotationAxis = 2;
    editor.rotateSelection(50);
    expect(model.properties.angles).toBe('40 70 30');
    expect(model.properties.angle).toBeUndefined();
  });

  test('rebuilds interactive model angles from the drag snapshot', () => {
    const editor = new Editor();
    const model = createEntity('misc_model', [0, 0, 0]);
    model.properties.angles = '10 20 30';
    editor.entities = [createEntity('worldspawn'), model];
    const original = [{ entity: model, origin: [0, 0, 0] as [number, number, number], angles: '10 20 30' }];

    rotateGeometryFromOriginals(editor, [], [], original, [0, 0, 0], 1, Math.PI / 6);
    expect(model.properties.angles).toBe('40 20 30');
    rotateGeometryFromOriginals(editor, [], [], original, [0, 0, 0], 1, Math.PI / 3);
    expect(model.properties.angles).toBe('70 20 30');
  });

  test('does not accumulate interactive roll previews after converting a yaw-only model', () => {
    const editor = new Editor();
    const model = createEntity('misc_model', [0, 0, 0]);
    model.properties.angle = '20';
    editor.entities = [createEntity('worldspawn'), model];
    const original = [{ entity: model, origin: [0, 0, 0] as [number, number, number], angle: '20' }];

    rotateGeometryFromOriginals(editor, [], [], original, [0, 0, 0], 0, Math.PI / 6);
    expect(model.properties.angles).toBe('0 20 30');
    rotateGeometryFromOriginals(editor, [], [], original, [0, 0, 0], 0, Math.PI / 3);
    expect(model.properties.angles).toBe('0 20 60');
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
