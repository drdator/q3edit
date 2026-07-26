import { describe, expect, test } from 'vitest';
import { createBoxBrush, validateBrush } from '../src/brush';
import { faceFullyCoveredByOpposingFace, roomBrushes } from '../src/csg';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';

describe('CSG room', () => {
  test('keeps one inward material face and caulks the rest of each shell', () => {
    const source = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/stone');
    const shells = roomBrushes(source, 8);

    expect(shells).toHaveLength(6);
    expect(shells.every(shell => validateBrush(shell).valid)).toBe(true);
    for (const shell of shells) {
      expect(shell.faces.filter(face => face.texture === 'base_wall/stone')).toHaveLength(1);
      expect(shell.faces.filter(face => face.texture === 'common/caulk').length).toBe(shell.faces.length - 1);
    }
  });
});

describe('conservative auto caulk', () => {
  test('recognizes complete opposing coverage but rejects partial coverage', () => {
    const target = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/metal');
    const full = createBoxBrush([64, -16, -16], [96, 80, 80], 'base_wall/metal');
    const partial = createBoxBrush([64, 16, 16], [96, 48, 48], 'base_wall/metal');

    expect(faceFullyCoveredByOpposingFace(target.faces[0], full.faces[1])).toBe(true);
    expect(faceFullyCoveredByOpposingFace(target.faces[0], partial.faces[1])).toBe(false);
  });

  test('caulks only fully covered selected faces and is undoable', () => {
    const editor = new Editor();
    const world = createEntity('worldspawn');
    const selected = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/metal');
    const neighbour = createBoxBrush([64, -16, -16], [96, 80, 80], 'base_wall/stone');
    world.brushes.push(selected, neighbour);
    editor.entities = [world];
    editor.selection = [{ type: 'brush', entity: world, brush: selected }];

    editor.autoCaulkSelected();

    expect(selected.faces.filter(face => face.texture === 'common/caulk')).toHaveLength(1);
    expect(editor.history.undoLabel).toBe('Auto caulk selected');
    editor.undo();
    expect(editor.entities[0].brushes[0].faces.every(face => face.texture === 'base_wall/metal')).toBe(true);
  });

  test('does not create history for partial or ambiguous coverage', () => {
    const editor = new Editor();
    const world = createEntity('worldspawn');
    const selected = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/metal');
    const partial = createBoxBrush([64, 16, 16], [96, 48, 48], 'base_wall/stone');
    world.brushes.push(selected, partial);
    editor.entities = [world];
    editor.selection = [{ type: 'brush', entity: world, brush: selected }];

    editor.autoCaulkSelected();

    expect(selected.faces.every(face => face.texture === 'base_wall/metal')).toBe(true);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.statusMessage).toContain('no fully covered');
  });

  test('does not treat trigger volumes as visible occluding geometry', () => {
    const editor = new Editor();
    const selected = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/metal');
    editor.worldspawn.brushes.push(selected);
    const trigger = createEntity('trigger_multiple');
    trigger.brushes.push(createBoxBrush([64, -16, -16], [96, 80, 80], 'common/trigger'));
    editor.entities.push(trigger);
    editor.selection = [{ type: 'brush', entity: editor.worldspawn, brush: selected }];

    editor.autoCaulkSelected();

    expect(selected.faces.every(face => face.texture === 'base_wall/metal')).toBe(true);
    expect(editor.history.canUndo).toBe(false);
  });

  test('does not alter a selected tool or trigger brush', () => {
    const editor = new Editor();
    const trigger = createEntity('trigger_multiple');
    const triggerBrush = createBoxBrush([0, 0, 0], [64, 64, 64], 'common/trigger');
    trigger.brushes.push(triggerBrush);
    editor.entities.push(trigger);
    editor.worldspawn.brushes.push(
      createBoxBrush([64, -16, -16], [96, 80, 80], 'base_wall/stone'),
    );
    editor.selection = [{ type: 'brush', entity: trigger, brush: triggerBrush }];

    editor.autoCaulkSelected();

    expect(triggerBrush.faces.every(face => face.texture === 'common/trigger')).toBe(true);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.statusMessage).toContain('visible solid');
  });
});
