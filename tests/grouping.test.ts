import { describe, expect, test } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { groupSelectionIntoEntity, moveSelectionToWorldspawn } from '../src/editor-grouping';
import { createFlatPatch } from '../src/patch';

describe('brush-entity grouping', () => {
  test('moves selected brushes and patches into a brush entity and back', () => {
    const editor = new Editor();
    const worldspawn = createEntity('worldspawn');
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const patch = createFlatPatch([80, 0, 0], [144, 64, 32], 'common/caulk');
    worldspawn.brushes.push(brush);
    worldspawn.patches.push(patch);
    editor.entities = [worldspawn];
    editor.selection = [
      { type: 'brush', entity: worldspawn, brush },
      { type: 'patch', entity: worldspawn, patch },
    ];

    groupSelectionIntoEntity(editor, 'func_group');

    expect(worldspawn.brushes).toHaveLength(0);
    expect(worldspawn.patches).toHaveLength(0);
    expect(editor.entities).toHaveLength(2);
    const group = editor.entities[1];
    expect(group.classname).toBe('func_group');
    expect(group.brushes).toEqual([brush]);
    expect(group.patches).toEqual([patch]);
    expect(editor.selection).toEqual([{ type: 'entity', entity: group }]);

    moveSelectionToWorldspawn(editor);

    expect(editor.entities).toEqual([worldspawn]);
    expect(worldspawn.brushes).toEqual([brush]);
    expect(worldspawn.patches).toEqual([patch]);
    expect(editor.selection.map(item => item.type)).toEqual(['brush', 'patch']);
  });
});
