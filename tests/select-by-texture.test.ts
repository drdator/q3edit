import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { createFlatPatch } from '../src/patch';

describe('select by texture', () => {
  it('selects matching faces across visible unlocked brushes', () => {
    const editor = new Editor();
    const matching = createBoxBrush([0, 0, 0], [64, 64, 64], 'textures/base_wall/metal');
    const hidden = createBoxBrush([80, 0, 0], [144, 64, 64], 'base_wall/metal');
    const locked = createBoxBrush([160, 0, 0], [224, 64, 64], 'base_wall/metal');
    editor.worldspawn.brushes.push(matching, hidden, locked);
    editor.hiddenBrushes.add(hidden);
    editor.selection = [{ type: 'brush', entity: editor.worldspawn, brush: locked }];
    const group = editor.createNamedGroup('Locked')!;
    editor.setNamedGroupLocked(group.id, true);
    editor.currentTexture = 'BASE_WALL/METAL';

    editor.selectFacesByTexture();

    expect(editor.selection).toHaveLength(6);
    expect(editor.selection.every(item => item.type === 'face' && item.brush === matching)).toBe(true);
    expect(editor.statusMessage).toContain('6 faces');
  });

  it('selects matching brushes and patches without selecting unrelated entity geometry', () => {
    const editor = new Editor();
    const matching = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_floor/tile');
    matching.faces[0].texture = 'base_trim/edge';
    const unrelated = createBoxBrush([80, 0, 0], [144, 64, 64], 'base_wall/plain');
    const patch = createFlatPatch([0, 80, 0], [64, 144, 0], 'textures/base_trim/edge');
    editor.worldspawn.brushes.push(matching, unrelated);
    editor.worldspawn.patches.push(patch);
    editor.currentTexture = 'base_trim/edge';

    editor.selectObjectsByTexture();

    expect(editor.selection).toEqual([
      { type: 'brush', entity: editor.worldspawn, brush: matching },
      { type: 'patch', entity: editor.worldspawn, patch },
    ]);
  });

  it('does not allow direct face selection through a locked group', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/metal');
    editor.worldspawn.brushes.push(brush);
    editor.selection = [{ type: 'brush', entity: editor.worldspawn, brush }];
    const group = editor.createNamedGroup('Locked')!;
    editor.setNamedGroupLocked(group.id, true);
    editor.selection = [{ type: 'brush', entity: editor.worldspawn, brush }];

    editor.selectFace(editor.worldspawn, brush, brush.faces[0]);

    expect(editor.selection).toEqual([{ type: 'brush', entity: editor.worldspawn, brush }]);
    expect(editor.statusMessage).toContain('locked');
  });
});
