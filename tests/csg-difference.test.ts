import { describe, expect, test } from 'vitest';
import { createBoxBrush, validateBrush } from '../src/brush';
import { differenceBrushes } from '../src/csg';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';

describe('CSG difference', () => {
  test('subtracts multiple cutters into valid convex fragments', () => {
    const target = createBoxBrush([0, 0, 0], [128, 128, 128]);
    const firstCutter = createBoxBrush([32, -16, 32], [96, 144, 96]);
    const secondCutter = createBoxBrush([-16, 48, 48], [144, 80, 80]);

    const fragments = differenceBrushes(target, [firstCutter, secondCutter]);

    expect(fragments).not.toBeNull();
    expect(fragments!.length).toBeGreaterThan(1);
    expect(fragments!.every(fragment => validateBrush(fragment).valid)).toBe(true);
  });

  test('replaces only selected inputs, selects the result, and is undoable', () => {
    const editor = new Editor();
    const world = createEntity('worldspawn');
    const target = createBoxBrush([0, 0, 0], [128, 128, 128]);
    const cutter = createBoxBrush([32, -16, 32], [96, 144, 96]);
    const untouched = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/untouched');
    world.brushes.push(target, cutter, untouched);
    editor.entities = [world];
    editor.selection = [
      { type: 'brush', entity: world, brush: target },
      { type: 'brush', entity: world, brush: cutter },
    ];

    editor.csgDifference();

    expect(world.brushes).toContain(untouched);
    expect(world.brushes).not.toContain(target);
    expect(world.brushes).not.toContain(cutter);
    expect(editor.selection.length).toBeGreaterThan(1);
    expect(editor.selection.every(item => item.type === 'brush' && item.brush !== untouched)).toBe(true);
    expect(editor.history.undoLabel).toBe('CSG difference');

    editor.undo();
    expect(editor.worldspawn.brushes).toHaveLength(3);
  });

  test('keeps inputs and history unchanged when cutters do not intersect', () => {
    const editor = new Editor();
    const world = createEntity('worldspawn');
    const target = createBoxBrush([0, 0, 0], [32, 32, 32]);
    const cutter = createBoxBrush([64, 64, 64], [96, 96, 96]);
    world.brushes.push(target, cutter);
    editor.entities = [world];
    editor.selection = [
      { type: 'brush', entity: world, brush: target },
      { type: 'brush', entity: world, brush: cutter },
    ];

    editor.csgDifference();

    expect(world.brushes).toEqual([target, cutter]);
    expect(editor.selection).toHaveLength(2);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.statusMessage).toContain('do not intersect');
  });

  test('allows cutters to remove the target completely', () => {
    const editor = new Editor();
    const world = createEntity('worldspawn');
    const target = createBoxBrush([16, 16, 16], [48, 48, 48]);
    const cutter = createBoxBrush([0, 0, 0], [64, 64, 64]);
    world.brushes.push(target, cutter);
    editor.entities = [world];
    editor.selection = [
      { type: 'brush', entity: world, brush: target },
      { type: 'brush', entity: world, brush: cutter },
    ];

    editor.csgDifference();

    expect(world.brushes).toEqual([]);
    expect(editor.selection).toEqual([]);
    expect(editor.history.undoLabel).toBe('CSG difference');
    expect(editor.statusMessage).toContain('removed the first brush completely');
  });
});
