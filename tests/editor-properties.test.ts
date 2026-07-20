import { describe, expect, test, vi } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import {
  addEntityProperty,
  addEntityProperties,
  removeEntityProperty,
  removeEntityProperties,
  renameEntityProperty,
  setEntityClassname,
  setEntityClassnames,
  setEntityProperty,
  setEntityProperties,
  setEntitySpawnflag,
  setEntitySpawnflags,
  setTypedEntityProperty,
  setTypedEntityProperties,
  updateFaceProperties,
  updateBrushPrimitiveMatrixEntry,
} from '../src/editor-properties';
import type { EntityPropertyType } from '../src/entity-definitions';

function editorWithEntity(): { editor: Editor; entity: ReturnType<typeof createEntity> } {
  const editor = new Editor();
  const worldspawn = createEntity('worldspawn');
  const entity = createEntity('light', [0, 0, 32]);
  worldspawn.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64]));
  editor.entities = [worldspawn, entity];
  return { editor, entity };
}

describe('transactional property editing', () => {
  test('makes classname and key lifecycle edits undoable', () => {
    const { editor, entity } = editorWithEntity();

    expect(setEntityClassname(editor, entity, 'info_player_start')).toBe(true);
    expect(renameEntityProperty(editor, entity, 'origin', 'spawn_origin')).toBe(true);
    setEntityProperty(editor, entity, 'angle', '90');
    const addedKey = addEntityProperty(editor, entity);
    removeEntityProperty(editor, entity, addedKey);

    expect(editor.history.undoCount).toBe(5);
    editor.undo();
    expect(editor.entities[1].properties).toHaveProperty(addedKey, '');
  });

  test('coalesces continuous property values and restores the original value', () => {
    vi.useFakeTimers();
    const { editor, entity } = editorWithEntity();
    entity.properties.light = '300';

    setEntityProperty(editor, entity, 'light', '350');
    vi.advanceTimersByTime(100);
    setEntityProperty(editor, entity, 'light', '400');

    expect(editor.history.undoCount).toBe(1);
    editor.undo();
    expect(editor.entities[1].properties.light).toBe('300');
    vi.useRealTimers();
  });

  test('edits multiple entities in one undoable property transaction', () => {
    vi.useFakeTimers();
    const editor = new Editor();
    const first = createEntity('light', [0, 0, 32]);
    const second = createEntity('light', [64, 0, 32]);
    first.properties.light = '200';
    second.properties.light = '400';
    editor.entities = [createEntity('worldspawn'), first, second];

    setEntityProperties(editor, [first, second], 'light', '500');
    vi.advanceTimersByTime(100);
    setEntityProperties(editor, [first, second], 'light', '600');

    expect(first.properties.light).toBe('600');
    expect(second.properties.light).toBe('600');
    expect(editor.history.undoCount).toBe(1);
    editor.undo();
    expect(editor.entities[1].properties.light).toBe('200');
    expect(editor.entities[2].properties.light).toBe('400');
    vi.useRealTimers();
  });

  test('applies multi-entity classname, typed, flag, add, and remove edits as batches', () => {
    const editor = new Editor();
    const first = createEntity('misc_model');
    const second = createEntity('misc_model');
    first.properties.angle = '45';
    second.properties.angle = '90';
    first.properties.spawnflags = '128';
    second.properties.spawnflags = '256';
    editor.entities = [createEntity('worldspawn'), first, second];

    setTypedEntityProperties(editor, [first, second], 'angles', '10 20 30', 'vector');
    expect(first.properties.angle).toBeUndefined();
    expect(second.properties.angle).toBeUndefined();
    expect(first.properties.angles).toBe('10 20 30');
    expect(second.properties.angles).toBe('10 20 30');

    setEntitySpawnflags(editor, [first, second], 4, true);
    expect(first.properties.spawnflags).toBe('132');
    expect(second.properties.spawnflags).toBe('260');

    const key = addEntityProperties(editor, [first, second]);
    expect(first.properties[key]).toBe('');
    expect(second.properties[key]).toBe('');
    removeEntityProperties(editor, [first, second], key);
    expect(first.properties[key]).toBeUndefined();
    expect(second.properties[key]).toBeUndefined();

    expect(setEntityClassnames(editor, [first, second], 'info_notnull')).toBe(true);
    expect(first.classname).toBe('info_notnull');
    expect(second.classname).toBe('info_notnull');
  });

  test('updates multiple face fields in one labeled undo entry', () => {
    const { editor } = editorWithEntity();
    const faces = editor.entities[0].brushes[0].faces.slice(0, 2);

    updateFaceProperties(editor, faces, 'Edit face flags', {
      contentFlags: 8,
      surfaceFlags: 16,
    });

    expect(faces.every(face => face.contentFlags === 8 && face.surfaceFlags === 16)).toBe(true);
    expect(editor.history.undoLabel).toBe('Edit face flags');
    editor.undo();
    expect(editor.entities[0].brushes[0].faces.slice(0, 2).every(face =>
      face.contentFlags === 0 && face.surfaceFlags === 0
    )).toBe(true);
  });

  test('edits brush-primitive matrix entries transactionally', () => {
    const { editor } = editorWithEntity();
    const face = editor.entities[0].brushes[0].faces[0];
    face.textureProjection = {
      kind: 'brush-primitive',
      matrix: [[0.01, 0, 0], [0, 0.01, 0]],
    };

    updateBrushPrimitiveMatrixEntry(editor, [face], 0, 2, 0.25);

    expect(face.textureProjection.matrix[0][2]).toBe(0.25);
    expect(editor.history.undoLabel).toBe('Edit brush primitive matrix');
    editor.undo();
    const restored = editor.entities[0].brushes[0].faces[0].textureProjection;
    expect(restored.kind).toBe('brush-primitive');
    if (restored.kind === 'brush-primitive') expect(restored.matrix[0][2]).toBe(0);
  });

  test.each<EntityPropertyType>([
    'string', 'number', 'vector', 'color', 'choice', 'asset', 'entity-reference', 'angle',
  ])('makes %s entity fields undoable and redoable', (type) => {
    const { editor, entity } = editorWithEntity();
    setTypedEntityProperty(editor, entity, 'typed', `value-${type}`, type);
    expect(entity.properties.typed).toBe(`value-${type}`);
    editor.undo();
    expect(editor.entities[1].properties.typed).toBeUndefined();
    editor.redo();
    expect(editor.entities[1].properties.typed).toBe(`value-${type}`);
  });

  test('keeps Q3Map2 misc_model transform representations mutually exclusive', () => {
    const editor = new Editor();
    const entity = createEntity('misc_model');
    editor.entities = [createEntity('worldspawn'), entity];
    entity.properties.angle = '90';
    entity.properties.modelscale = '2';

    setTypedEntityProperty(editor, entity, 'angles', '10 20 30', 'vector');
    expect(entity.properties).not.toHaveProperty('angle');
    expect(entity.properties.angles).toBe('10 20 30');

    setTypedEntityProperty(editor, entity, 'modelscale_vec', '1 2 3', 'vector');
    expect(entity.properties).not.toHaveProperty('modelscale');
    expect(entity.properties.modelscale_vec).toBe('1 2 3');

    editor.undo();
    expect(editor.entities[1].properties.modelscale).toBe('2');
    expect(editor.entities[1].properties).not.toHaveProperty('modelscale_vec');
    editor.undo();
    expect(editor.entities[1].properties.angle).toBe('90');
    expect(editor.entities[1].properties).not.toHaveProperty('angles');
  });

  test('toggles documented spawnflags without losing unknown bits', () => {
    const { editor, entity } = editorWithEntity();
    entity.properties.spawnflags = String(0x80);
    setEntitySpawnflag(editor, entity, 4, true);
    expect(entity.properties.spawnflags).toBe(String(0x84));
    editor.undo();
    expect(editor.entities[1].properties.spawnflags).toBe(String(0x80));
    editor.redo();
    expect(editor.entities[1].properties.spawnflags).toBe(String(0x84));
  });
});
