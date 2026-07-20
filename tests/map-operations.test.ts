import { describe, expect, test, vi } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity, entityOrigin } from '../src/entity';
import { applyMapOperations } from '../src/map-operations';

function emptyEditor(): Editor {
  const editor = new Editor();
  editor.entities = [createEntity('worldspawn')];
  return editor;
}

describe('serializable map operations', () => {
  test('creates a room and point entities as one undoable transaction', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      {
        type: 'create_room',
        mins: [0, 0, 0],
        maxs: [256, 256, 128],
        wallThickness: 16,
        textures: { walls: 'base_wall/metal', floor: 'base_floor/concrete' },
      },
      {
        type: 'create_entity',
        classname: 'info_player_deathmatch',
        origin: [64, 64, 32],
        properties: { angle: '90' },
      },
      {
        type: 'create_entity',
        classname: 'light',
        origin: [128, 128, 96],
        properties: { light: '500' },
      },
    ], 'MCP: Create test room');

    expect(editor.entities[0].brushes).toHaveLength(6);
    expect(editor.entities).toHaveLength(3);
    expect(editor.entities[1].properties.angle).toBe('90');
    expect(result.created).toHaveLength(8);
    expect(editor.history.undoLabel).toBe('MCP: Create test room');

    editor.undo();
    expect(editor.entities).toHaveLength(1);
    expect(editor.entities[0].brushes).toHaveLength(0);
  });

  test('updates, textures, translates, and deletes referenced objects', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      { type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64] },
      { type: 'create_entity', classname: 'light', origin: [16, 16, 80] },
    ]);

    applyMapOperations(editor, [
      { type: 'set_texture', targets: ['E0:B0'], texture: 'common/caulk' },
      { type: 'translate', targets: ['E0:B0', 'E1'], delta: [32, 0, 0] },
      { type: 'set_entity_properties', target: 'E1', properties: { light: '700' }, unset: ['_color'] },
    ]);

    expect(editor.entities[0].brushes[0].mins).toEqual([32, 0, 0]);
    expect(entityOrigin(editor.entities[1])).toEqual([48, 16, 80]);
    expect(editor.entities[1].properties.light).toBe('700');
    expect(editor.entities[0].brushes[0].faces.every(face => face.texture === 'common/caulk')).toBe(true);

    applyMapOperations(editor, [{ type: 'delete', targets: ['E0:B0', 'E1'] }]);
    expect(editor.entities).toHaveLength(1);
    expect(editor.entities[0].brushes).toHaveLength(0);
  });

  test('resolves symbolic references to new objects and collections within a batch', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      {
        type: 'create_room',
        id: 'north_room',
        mins: [0, 0, 0],
        maxs: [256, 256, 128],
      },
      {
        type: 'set_texture',
        targets: ['@north_room'],
        texture: 'base_wall/metal',
      },
      {
        type: 'create_entity',
        id: 'room_light',
        classname: 'light',
        origin: [128, 128, 80],
      },
      {
        type: 'set_entity_properties',
        target: '@room_light',
        properties: { light: '650' },
      },
      {
        type: 'translate',
        targets: ['@room_light'],
        delta: [0, 0, 16],
      },
    ]);

    expect(result.aliases['@north_room']).toEqual([
      'E0:B0', 'E0:B1', 'E0:B2', 'E0:B3', 'E0:B4', 'E0:B5',
    ]);
    expect(result.aliases['@room_light']).toEqual(['E1']);
    expect(editor.entities[0].brushes.every(brush => brush.faces.every(face => face.texture === 'base_wall/metal'))).toBe(true);
    expect(editor.entities[1].properties.light).toBe('650');
    expect(entityOrigin(editor.entities[1])).toEqual([128, 128, 96]);
  });

  test('rejects unknown and duplicate symbolic references transactionally', () => {
    const editor = emptyEditor();
    expect(() => applyMapOperations(editor, [
      { type: 'create_entity', id: 'lamp', classname: 'light', origin: [0, 0, 32] },
      { type: 'create_box', id: 'lamp', mins: [0, 0, 0], maxs: [32, 32, 32] },
    ])).toThrow('Duplicate symbolic id');
    expect(editor.entities).toHaveLength(1);

    expect(() => applyMapOperations(editor, [
      { type: 'delete', targets: ['@missing'] },
    ])).toThrow('Unknown symbolic reference');
  });

  test('rolls back the entire batch when an operation fails', () => {
    const editor = emptyEditor();

    expect(() => applyMapOperations(editor, [
      { type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64] },
      { type: 'set_entity_properties', target: 'E99', properties: { message: 'invalid' } },
    ])).toThrow('does not exist');

    expect(editor.entities[0].brushes).toHaveLength(0);
    expect(editor.history.canUndo).toBe(false);
  });

  test('emits committed, undo, and redo document changes', () => {
    const editor = emptyEditor();
    const listener = vi.fn();
    editor.subscribeDocumentChanges(listener);

    applyMapOperations(editor, [{ type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64] }], 'MCP: Add box');
    editor.undo();
    editor.redo();

    expect(listener.mock.calls.map(([change]) => change.label)).toEqual([
      'MCP: Add box',
      'Undo: MCP: Add box',
      'Redo: MCP: Add box',
    ]);
  });
});
