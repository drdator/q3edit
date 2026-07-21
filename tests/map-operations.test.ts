import { describe, expect, test, vi } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity, entityOrigin } from '../src/entity';
import { createBoxBrush } from '../src/brush';
import { CONTENTS_DETAIL } from '../src/map-flags';
import { listNamedGroups } from '../src/named-groups';
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

  test('creates richer primitives, ramps, and stairs with symbolic collections', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      {
        type: 'create_primitive', id: 'column', primitive: 'cylinder',
        mins: [0, 0, 0], maxs: [64, 64, 128], axis: 'z', sides: 12, texture: 'base_wall/metal',
      },
      {
        type: 'create_wedge', id: 'ramp', mins: [96, 0, 0], maxs: [224, 96, 64],
        direction: 'x+', texture: 'base_floor/stone',
      },
      {
        type: 'create_stairs', id: 'stairs', mins: [0, 128, 0], maxs: [256, 256, 128],
        direction: 'x+', steps: 4, texture: 'base_floor/stone',
      },
    ]);

    expect(editor.worldspawn.brushes).toHaveLength(6);
    expect(editor.worldspawn.brushes[0].faces).toHaveLength(14);
    expect(editor.worldspawn.brushes[1].faces).toHaveLength(5);
    expect(result.aliases['@column']).toHaveLength(1);
    expect(result.aliases['@ramp']).toHaveLength(1);
    expect(result.aliases['@stairs']).toHaveLength(4);
  });

  test('creates convex brushes from explicit face planes', () => {
    const editor = emptyEditor();
    const source = createBoxBrush([0, 0, 0], [64, 96, 128], 'common/caulk');
    const result = applyMapOperations(editor, [{
      type: 'create_brush', id: 'plane_box',
      faces: source.faces.map(face => ({
        points: face.points.map(point => [...point]) as [[number, number, number], [number, number, number], [number, number, number]],
        texture: face.texture,
      })),
    }]);

    expect(result.aliases['@plane_box']).toEqual(['E0:B0']);
    expect(editor.worldspawn.brushes[0].mins).toEqual([0, 0, 0]);
    expect(editor.worldspawn.brushes[0].maxs).toEqual([64, 96, 128]);
  });

  test('rotates, mirrors, clones, and arrays objects in one batch', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      { type: 'create_box', id: 'source', mins: [0, 0, 0], maxs: [64, 32, 32] },
      { type: 'rotate', targets: ['@source'], center: [0, 0, 0], axis: 'z', angleDegrees: 90 },
      { type: 'mirror', targets: ['@source'], center: [0, 0, 0], axis: 'x' },
      { type: 'clone', id: 'copy', targets: ['@source'], delta: [96, 0, 0] },
      { type: 'array', id: 'row', targets: ['@source'], copies: 3, delta: [0, 64, 0] },
    ]);

    expect(editor.worldspawn.brushes).toHaveLength(5);
    expect(result.aliases['@copy']).toHaveLength(1);
    expect(result.aliases['@row']).toHaveLength(3);
    expect(editor.worldspawn.brushes.slice(2).map(brush => brush.mins[1])).toEqual([64, 128, 192]);
  });

  test('edits individual faces and classifies brushes as detail', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      { type: 'create_box', id: 'trim', mins: [0, 0, 0], maxs: [64, 96, 128], texture: 'common/caulk' },
      {
        type: 'edit_faces', targets: ['@trim:F4'], texture: 'base_trim/metal', fit: true,
        contentFlags: 8, surfaceFlags: 16, value: 3,
      },
      { type: 'edit_faces', targets: ['@trim:F0'], shift: [16, -8], scale: [2, 0.5], rotateDegrees: 90 },
      { type: 'set_brush_classification', targets: ['@trim'], classification: 'detail' },
    ], 'MCP: Finish trim brush');

    const brush = editor.worldspawn.brushes[0];
    expect(brush.faces[4]).toMatchObject({ texture: 'base_trim/metal', surfaceFlags: 16, value: 3 });
    expect(brush.faces[4].textureProjection).toMatchObject({ kind: 'classic', rotation: 0 });
    expect(brush.faces[0].textureProjection).toMatchObject({
      kind: 'classic', offsetX: 16, offsetY: -8, rotation: 90, scaleX: 1, scaleY: 0.25,
    });
    expect(brush.faces.every(face => (face.contentFlags & CONTENTS_DETAIL) !== 0)).toBe(true);
    expect(result.changed).toEqual(expect.arrayContaining(['E0:B0:F4', 'E0:B0:F0', 'E0:B0']));

    editor.undo();
    expect(editor.worldspawn.brushes).toHaveLength(0);
  });

  test('clips and hollows brushes while exposing the replacement refs', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      { type: 'create_box', id: 'block', mins: [0, 0, 0], maxs: [64, 64, 64] },
      {
        type: 'clip_brushes', id: 'halves', targets: ['@block'], keep: 'both',
        planePoints: [[32, 0, 0], [32, 0, 64], [32, 64, 0]],
      },
      { type: 'hollow_brushes', id: 'shell', targets: ['@halves'], thickness: 8 },
    ]);

    expect(result.aliases['@halves']).toEqual([]);
    expect(result.aliases['@shell']).toHaveLength(12);
    expect(editor.worldspawn.brushes).toHaveLength(12);
  });

  test('subtracts a carver and can remove it in the same operation', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      { type: 'create_box', id: 'wall', mins: [0, 0, 0], maxs: [128, 32, 128] },
      { type: 'create_box', id: 'door', mins: [32, -8, 0], maxs: [96, 40, 96] },
      { type: 'csg_subtract', id: 'cut_wall', targets: ['@wall'], carvers: ['@door'], deleteCarvers: true },
    ]);

    expect(result.aliases['@cut_wall'].length).toBeGreaterThan(1);
    expect(result.aliases['@door']).toEqual([]);
    expect(editor.worldspawn.brushes).toHaveLength(result.aliases['@cut_wall'].length);
  });

  test('assigns symbolic collections to persistent named groups', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      { type: 'create_room', id: 'reactor', mins: [0, 0, 0], maxs: [256, 256, 128] },
      { type: 'assign_group', targets: ['@reactor'], group: 'Reactor Core', groupId: 'mcp-reactor-core' },
    ]);

    expect(listNamedGroups(editor.entities)).toEqual([
      expect.objectContaining({ id: 'mcp-reactor-core', name: 'Reactor Core' }),
    ]);
    expect(editor.worldspawn.brushes.every(brush => brush.editorGroupId === 'mcp-reactor-core')).toBe(true);
    expect(result.changed).toEqual(['E0:B0', 'E0:B1', 'E0:B2', 'E0:B3', 'E0:B4', 'E0:B5']);

    const reloaded = emptyEditor();
    reloaded.loadMap(editor.serializeMap());
    expect(listNamedGroups(reloaded.entities)[0]).toMatchObject({ id: 'mcp-reactor-core', name: 'Reactor Core' });
    expect(reloaded.worldspawn.brushes.every(brush => brush.editorGroupId === 'mcp-reactor-core')).toBe(true);
  });

  test('honors persistent groups directly on creation operations', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      {
        type: 'create_box', id: 'trim', mins: [0, 0, 0], maxs: [64, 64, 64],
        group: 'Arena Details', groupId: 'arena-details',
      },
      { type: 'create_entity', classname: 'light', origin: [32, 32, 96], group: 'Arena Details' },
    ]);

    expect(listNamedGroups(editor.entities)).toEqual([
      expect.objectContaining({ id: 'arena-details', name: 'Arena Details' }),
    ]);
    expect(editor.worldspawn.brushes[0].editorGroupId).toBe('arena-details');
    expect(editor.entities.find(entity => entity.classname === 'light')?.properties._q3edit_group_id).toBe('arena-details');
  });

  test('reuses a batch group name when later operations suggest another id', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      {
        type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64],
        group: 'Shared Details', groupId: 'shared-details',
      },
      {
        type: 'create_box', mins: [80, 0, 0], maxs: [144, 64, 64],
        group: 'Shared Details', groupId: 'another-generated-id',
      },
    ]);

    expect(listNamedGroups(editor.entities)).toEqual([
      expect.objectContaining({ id: 'shared-details', name: 'Shared Details' }),
    ]);
    expect(editor.worldspawn.brushes.every(brush => brush.editorGroupId === 'shared-details')).toBe(true);
  });

  test('creates multiple wired gameplay helpers atomically in one batch', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      {
        type: 'create_jump_pad', id: 'rail_jump', mins: [0, 0, 0], maxs: [64, 64, 16], apex: [256, 32, 192],
        group: 'Traversal', groupId: 'traversal',
      },
      {
        type: 'create_teleporter', id: 'return_portal', mins: [128, 0, 0], maxs: [192, 64, 96],
        destination: [32, 256, 32], exitAngle: 90, group: 'Traversal',
      },
    ]);

    expect(result.operationCount).toBe(2);
    expect(result.aliases['@rail_jump']).toHaveLength(3);
    expect(result.aliases['@return_portal']).toHaveLength(3);
    const jump = editor.entities.find(entity => entity.classname === 'trigger_push')!;
    const apex = editor.entities.find(entity => entity.classname === 'target_position')!;
    expect(jump.properties.target).toBe(apex.properties.targetname);
    const teleport = editor.entities.find(entity => entity.classname === 'trigger_teleport')!;
    const destination = editor.entities.find(entity => entity.classname === 'misc_teleporter_dest')!;
    expect(teleport.properties.target).toBe(destination.properties.targetname);
    expect(destination.properties.angle).toBe('90');
    expect([jump, apex, teleport, destination].every(entity => entity.properties._q3edit_group_id === 'traversal')).toBe(true);
  });

  test('assigns semantic material slots while creating boxes, primitives, and stairs', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      {
        type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64], texture: 'fallback',
        textures: { top: 'box/top', bottom: 'box/bottom', sides: 'box/sides' },
      },
      {
        type: 'create_primitive', primitive: 'cylinder', axis: 'x', sides: 8,
        mins: [80, 0, 0], maxs: [144, 64, 64], texture: 'fallback',
        textures: { top: 'cylinder/top', bottom: 'cylinder/bottom', sides: 'cylinder/sides' },
      },
      {
        type: 'create_stairs', direction: 'y+', steps: 2,
        mins: [160, 0, 0], maxs: [224, 128, 64], texture: 'fallback',
        textures: { treads: 'stairs/tread', risers: 'stairs/riser', sides: 'stairs/side', underside: 'stairs/under' },
      },
    ]);

    const [box, cylinder, firstStep] = editor.worldspawn.brushes;
    expect(box.faces.find(face => face.plane.normal[2] > 0.9)?.texture).toBe('box/top');
    expect(box.faces.find(face => face.plane.normal[2] < -0.9)?.texture).toBe('box/bottom');
    expect(box.faces.find(face => Math.abs(face.plane.normal[0]) > 0.9)?.texture).toBe('box/sides');
    expect(cylinder.faces.find(face => face.plane.normal[0] > 0.9)?.texture).toBe('cylinder/top');
    expect(cylinder.faces.find(face => face.plane.normal[0] < -0.9)?.texture).toBe('cylinder/bottom');
    expect(cylinder.faces.find(face => Math.abs(face.plane.normal[0]) < 0.9)?.texture).toBe('cylinder/sides');
    expect(firstStep.faces.find(face => face.plane.normal[2] > 0.9)?.texture).toBe('stairs/tread');
    expect(firstStep.faces.find(face => face.plane.normal[2] < -0.9)?.texture).toBe('stairs/under');
    expect(firstStep.faces.find(face => Math.abs(face.plane.normal[1]) > 0.9)?.texture).toBe('stairs/riser');
    expect(firstStep.faces.find(face => Math.abs(face.plane.normal[0]) > 0.9)?.texture).toBe('stairs/side');
  });

  test('applies global and semantic texture transforms while creating geometry', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      {
        type: 'create_box', mins: [0, 0, 0], maxs: [256, 128, 32], texture: 'base',
        textureTransform: { scale: [2, 1] },
        textureTransforms: {
          top: { fit: true, scale: [0.5, 1], rotateDegrees: 90 },
          sides: { shift: [8, 0] },
        },
      },
      {
        type: 'create_room', mins: [0, 256, 0], maxs: [256, 384, 128],
        textureTransforms: { floor: { fit: true } },
      },
      {
        type: 'create_stairs', direction: 'x+', steps: 2,
        mins: [320, 0, 0], maxs: [448, 128, 64],
        textureTransforms: { treads: { fit: true }, risers: { rotateDegrees: 90 } },
      },
    ]);

    const box = editor.worldspawn.brushes[0];
    const top = box.faces.find(face => face.plane.normal[2] > 0.9)!;
    const bottom = box.faces.find(face => face.plane.normal[2] < -0.9)!;
    const side = box.faces.find(face => face.plane.normal[0] > 0.9)!;
    expect(top.textureProjection).toMatchObject({ kind: 'classic', scaleX: 1, scaleY: 1, rotation: 90 });
    expect(bottom.textureProjection).toMatchObject({ kind: 'classic', scaleX: 1, scaleY: 0.5, rotation: 0 });
    expect(side.textureProjection).toMatchObject({ kind: 'classic', offsetX: 8, scaleX: 1, scaleY: 0.5 });

    const roomFloorTop = editor.worldspawn.brushes[1].faces.find(face => face.plane.normal[2] > 0.9)!;
    expect(roomFloorTop.textureProjection).toMatchObject({ kind: 'classic', scaleX: 2, scaleY: 1 });

    const firstStep = editor.worldspawn.brushes[7];
    const tread = firstStep.faces.find(face => face.plane.normal[2] > 0.9)!;
    const riser = firstStep.faces.find(face => face.plane.normal[0] > 0.9)!;
    expect(tread.textureProjection).toMatchObject({ kind: 'classic', scaleX: 0.5, scaleY: 1 });
    expect(riser.textureProjection).toMatchObject({ kind: 'classic', rotation: 90 });
  });

  test('creates textured, detail-classified modular prefabs', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      {
        type: 'create_prefab', id: 'pillar', prefab: 'pillar',
        mins: [0, 0, 0], maxs: [64, 64, 128], texture: 'base_wall/metal',
        textures: { accent: 'base_trim/trim' }, group: 'Prefab Details',
      },
      {
        type: 'create_prefab', id: 'door', prefab: 'door_frame', orientation: 'x',
        mins: [96, 0, 0], maxs: [224, 16, 128], texture: 'base_wall/metal',
        textures: { accent: 'base_trim/trim' }, group: 'Prefab Details',
      },
      {
        type: 'create_prefab', id: 'pad', prefab: 'jump_pad_base',
        mins: [256, 0, 0], maxs: [384, 128, 16], texture: 'base_trim/metal',
        textures: { focal: 'sfx/jumppad', sides: 'base_trim/trim' }, group: 'Prefab Details',
      },
    ]);

    expect(result.aliases['@pillar']).toHaveLength(3);
    expect(result.aliases['@door']).toHaveLength(3);
    expect(result.aliases['@pad']).toHaveLength(1);
    expect(editor.worldspawn.brushes).toHaveLength(7);
    expect(editor.worldspawn.brushes.every(brush => brush.faces.every(face => (face.contentFlags & CONTENTS_DETAIL) !== 0))).toBe(true);
    expect(editor.worldspawn.brushes[1].mins).toEqual([8, 8, 19]);
    expect(editor.worldspawn.brushes[1].maxs).toEqual([56, 56, 109]);

    const jumpPad = editor.worldspawn.brushes[6];
    const top = jumpPad.faces.find(face => face.plane.normal[2] > 0.9)!;
    const side = jumpPad.faces.find(face => Math.abs(face.plane.normal[2]) < 0.9)!;
    expect(top.texture).toBe('sfx/jumppad');
    expect(top.textureProjection.kind).toBe('classic');
    if (top.textureProjection.kind !== 'classic') throw new Error('Expected classic texture projection');
    expect(top.textureProjection.scaleX).toBeCloseTo(1);
    expect(top.textureProjection.scaleY).toBeCloseTo(1);
    expect(side.texture).toBe('base_trim/trim');
  });

  test('creates repeated entities and classified detail geometry atomically', () => {
    const editor = emptyEditor();
    const result = applyMapOperations(editor, [
      {
        type: 'create_entity_array', id: 'lights', classname: 'light', start: [0, 0, 64], count: 4,
        delta: [64, 0, 0], properties: { light: '250' }, group: 'Lighting',
      },
      {
        type: 'create_box_array', id: 'pillars', mins: [0, 64, 0], maxs: [16, 80, 96], count: 3,
        delta: [64, 0, 0], texture: 'base_trim/metal', classification: 'detail', group: 'Details',
      },
    ]);

    expect(result.aliases['@lights']).toHaveLength(4);
    expect(result.aliases['@pillars']).toHaveLength(3);
    expect(editor.entities.filter(entity => entity.classname === 'light').map(entity => entity.properties.origin)).toEqual([
      '0 0 64', '64 0 64', '128 0 64', '192 0 64',
    ]);
    expect(editor.worldspawn.brushes).toHaveLength(3);
    expect(editor.worldspawn.brushes.every(brush => brush.faces.every(face => (face.contentFlags & CONTENTS_DETAIL) !== 0))).toBe(true);
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
