import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { buildSelectionTransfer, insertTransferEntities, parseTransferEntities } from '../src/editor-transfer';
import { parseMap, serializeMap } from '../src/mapfile';
import {
  GROUP_ID_KEY,
  GROUP_INFO_CLASSNAME,
  Q3RADIANT_NAMED_GROUP_SERIALIZATION,
  isGroupInfoEntity,
  listNamedGroups,
  reconcileNamedGroups,
} from '../src/named-groups';
import { createFlatPatch, createTerrainDefGridPatch } from '../src/patch';

function makeBrushPrimitive(): ReturnType<typeof createBoxBrush> {
  const brush = createBoxBrush([80, 0, 0], [144, 64, 64]);
  for (const face of brush.faces) {
    face.textureProjection = { kind: 'brush-primitive', matrix: [[1 / 128, 0, 0], [0, 1 / 128, 0]] };
  }
  return brush;
}

describe('named groups', () => {
  it('uses Q3Radiant metadata without changing object ownership', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const entity = createEntity('func_door');
    entity.brushes.push(brush);
    editor.entities.push(entity);
    editor.selection = [{ type: 'brush', entity, brush }];

    const group = editor.createNamedGroup('Architecture')!;
    expect(Q3RADIANT_NAMED_GROUP_SERIALIZATION).toContain('group_info/group');
    expect(entity.brushes).toEqual([brush]);
    expect(brush.editorGroupId).toBe(group.id);
    expect(editor.entities.some(isGroupInfoEntity)).toBe(true);

    editor.renameNamedGroup(group.id, 'Structural');
    expect(editor.namedGroups()[0].name).toBe('Structural');
    editor.removeSelectionFromNamedGroups();
    expect(brush.editorGroupId).toBeUndefined();
    editor.addSelectionToNamedGroup(group.id);
    editor.deleteNamedGroup(group.id);
    expect(brush.editorGroupId).toBeUndefined();
    expect(editor.entities).toContain(entity);
    expect(entity.brushes).toContain(brush);
  });

  it('round-trips membership for entities, both brush formats, patches, and terrain', () => {
    const editor = new Editor();
    const classic = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const primitive = makeBrushPrimitive();
    const patch = createFlatPatch([160, 0, 0], [224, 64, 0], 'common/caulk');
    const terrain = createTerrainDefGridPatch([240, 0, 0], [304, 64, 0], 'terrain/base', 3, 3);
    const point = createEntity('light', [32, 96, 32]);
    editor.worldspawn.brushes.push(classic, primitive);
    editor.worldspawn.patches.push(patch, terrain);
    editor.entities.push(point);
    editor.selection = [
      { type: 'brush', entity: editor.worldspawn, brush: classic },
      { type: 'brush', entity: editor.worldspawn, brush: primitive },
      { type: 'patch', entity: editor.worldspawn, patch },
      { type: 'patch', entity: editor.worldspawn, patch: terrain },
      { type: 'entity', entity: point },
    ];
    const group = editor.createNamedGroup('Gameplay')!;

    const text = serializeMap(editor.entities);
    expect(text).toContain('"classname" "group_info"');
    expect(text).toContain('// q3edit-group');
    expect(text).toContain('"group" "Gameplay"');
    const loaded = parseMap(text);
    const loadedGroup = listNamedGroups(loaded)[0];
    expect(loadedGroup).toMatchObject({ id: group.id, name: 'Gameplay' });
    expect(loaded[0].brushes.map(item => item.editorGroupId)).toEqual([group.id, group.id]);
    expect(loaded[0].patches.map(item => item.editorGroupId)).toEqual([group.id, group.id]);
    expect(loaded.find(entity => entity.classname === 'light')!.properties[GROUP_ID_KEY]).toBe(group.id);
  });

  it('preserves membership through duplicate, undo/redo, and transfer collisions', () => {
    const source = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    source.worldspawn.brushes.push(brush);
    source.selectBrush(source.worldspawn, brush);
    const group = source.createNamedGroup('Source Group')!;
    source.duplicateSelectionInPlace();
    expect(source.worldspawn.brushes[1].editorGroupId).toBe(group.id);
    source.undo();
    expect(source.worldspawn.brushes).toHaveLength(1);
    source.redo();
    expect(source.worldspawn.brushes[1].editorGroupId).toBe(group.id);

    const duplicated = source.worldspawn.brushes[1];
    source.selectBrush(source.worldspawn, duplicated);
    const transfer = buildSelectionTransfer(source);
    const parsed = parseTransferEntities(serializeMap(transfer.entities))!;
    const target = new Editor();
    target.createNamedGroup('Conflicting Group');
    const inserted = insertTransferEntities(target, parsed, [0, 0, 0]);
    expect(inserted.brushCount).toBe(1);
    expect(target.namedGroups()).toHaveLength(2);
    expect(target.worldspawn.brushes[0].editorGroupId).not.toBe(group.id);
    expect(target.namedGroups().find(item => item.id === target.worldspawn.brushes[0].editorGroupId)?.name).toBe('Source Group');
  });

  it('enforces hide/lock state and repairs malformed, unknown, and colliding IDs', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    editor.worldspawn.brushes.push(brush);
    editor.selectBrush(editor.worldspawn, brush);
    const group = editor.createNamedGroup('Locked')!;
    editor.setNamedGroupHidden(group.id, true);
    expect(editor.isBrushHidden(brush, editor.worldspawn)).toBe(true);
    editor.setNamedGroupHidden(group.id, false);
    editor.setNamedGroupLocked(group.id, true);
    editor.clearSelection();
    editor.selectBrush(editor.worldspawn, brush);
    expect(editor.selection).toEqual([]);
    editor.setNamedGroupLocked(group.id, false);
    editor.selectBrush(editor.worldspawn, brush);
    expect(editor.selection).toHaveLength(1);

    const malformedWorld = createEntity('worldspawn');
    const unknown = createBoxBrush([0, 0, 0], [8, 8, 8]); unknown.editorGroupId = 'unknown-valid';
    const invalid = createFlatPatch([0, 0, 0], [8, 8, 0], 'x'); invalid.editorGroupId = 'bad id!';
    malformedWorld.brushes.push(unknown); malformedWorld.patches.push(invalid);
    const first = createEntity(GROUP_INFO_CLASSNAME); first.properties[GROUP_ID_KEY] = 'duplicate'; first.properties.group = 'First';
    const second = createEntity(GROUP_INFO_CLASSNAME); second.properties[GROUP_ID_KEY] = 'duplicate'; second.properties.group = 'Second';
    const entities = [malformedWorld, first, second];
    reconcileNamedGroups(entities);
    const groups = listNamedGroups(entities);
    expect(new Set(groups.map(item => item.id)).size).toBe(groups.length);
    expect(groups.find(item => item.id === 'unknown-valid')?.name).toBe('Recovered unknown-valid');
    expect(invalid.editorGroupId).toBeUndefined();
  });
});
