import { createBoxBrush, translateBrush, type Brush } from './brush';
import type { Editor } from './editor';
import { createEntity, translateEntity, type Entity } from './entity';
import type { Vec3 } from './math';
import { translatePatch, type Patch } from './patch';

export type MapObjectRef = `E${number}` | `E${number}:B${number}` | `E${number}:P${number}`;

export interface CreateEntityOperation {
  type: 'create_entity';
  classname: string;
  origin?: Vec3;
  properties?: Record<string, string>;
}

export interface SetEntityPropertiesOperation {
  type: 'set_entity_properties';
  target: MapObjectRef;
  classname?: string;
  properties?: Record<string, string>;
  unset?: string[];
}

export interface CreateBoxOperation {
  type: 'create_box';
  parent?: MapObjectRef;
  mins: Vec3;
  maxs: Vec3;
  texture?: string;
}

export interface CreateRoomOperation {
  type: 'create_room';
  parent?: MapObjectRef;
  mins: Vec3;
  maxs: Vec3;
  wallThickness?: number;
  textures?: {
    walls?: string;
    floor?: string;
    ceiling?: string;
  };
}

export interface TranslateObjectsOperation {
  type: 'translate';
  targets: MapObjectRef[];
  delta: Vec3;
}

export interface SetTextureOperation {
  type: 'set_texture';
  targets: MapObjectRef[];
  texture: string;
}

export interface DeleteObjectsOperation {
  type: 'delete';
  targets: MapObjectRef[];
}

export type MapOperation =
  | CreateEntityOperation
  | SetEntityPropertiesOperation
  | CreateBoxOperation
  | CreateRoomOperation
  | TranslateObjectsOperation
  | SetTextureOperation
  | DeleteObjectsOperation;

export interface MapOperationResult {
  revision: number;
  operationCount: number;
  created: MapObjectRef[];
  changed: MapObjectRef[];
  summary: string;
}

type ResolvedObject =
  | { ref: MapObjectRef; kind: 'entity'; entityIndex: number; entity: Entity }
  | { ref: MapObjectRef; kind: 'brush'; entityIndex: number; entity: Entity; objectIndex: number; brush: Brush }
  | { ref: MapObjectRef; kind: 'patch'; entityIndex: number; entity: Entity; objectIndex: number; patch: Patch };

function assertVector(name: string, value: Vec3): void {
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${name} must contain three finite numbers`);
  }
}

function assertBounds(mins: Vec3, maxs: Vec3): void {
  assertVector('mins', mins);
  assertVector('maxs', maxs);
  if (mins.some((value, axis) => value >= maxs[axis])) {
    throw new Error('mins must be smaller than maxs on every axis');
  }
}

function resolveObject(editor: Pick<Editor, 'entities'>, ref: MapObjectRef): ResolvedObject {
  const match = /^E(\d+)(?::([BP])(\d+))?$/.exec(ref);
  if (!match) throw new Error(`Invalid object reference ${ref}`);
  const entityIndex = Number(match[1]);
  const entity = editor.entities[entityIndex];
  if (!entity) throw new Error(`Entity ${ref} does not exist`);
  if (!match[2]) return { ref, kind: 'entity', entityIndex, entity };
  const objectIndex = Number(match[3]);
  if (match[2] === 'B') {
    const brush = entity.brushes[objectIndex];
    if (!brush) throw new Error(`Brush ${ref} does not exist`);
    return { ref, kind: 'brush', entityIndex, entity, objectIndex, brush };
  }
  const patch = entity.patches[objectIndex];
  if (!patch) throw new Error(`Patch ${ref} does not exist`);
  return { ref, kind: 'patch', entityIndex, entity, objectIndex, patch };
}

function resolveEntity(editor: Pick<Editor, 'entities'>, ref: MapObjectRef | undefined): { entity: Entity; entityIndex: number } {
  const resolved = resolveObject(editor, ref ?? 'E0');
  if (resolved.kind !== 'entity') throw new Error(`${ref} is not an entity`);
  return resolved;
}

function addBox(entity: Entity, mins: Vec3, maxs: Vec3, texture: string): number {
  assertBounds(mins, maxs);
  entity.brushes.push(createBoxBrush(mins, maxs, texture));
  return entity.brushes.length - 1;
}

function applyCreateRoom(editor: Editor, operation: CreateRoomOperation, created: MapObjectRef[]): void {
  assertBounds(operation.mins, operation.maxs);
  const { entity, entityIndex } = resolveEntity(editor, operation.parent);
  const thickness = operation.wallThickness ?? 16;
  if (!Number.isFinite(thickness) || thickness <= 0) throw new Error('wallThickness must be a positive number');
  const size = operation.maxs.map((value, axis) => value - operation.mins[axis]);
  if (size.some(value => thickness * 2 >= value)) throw new Error('wallThickness is too large for the room bounds');

  const [x0, y0, z0] = operation.mins;
  const [x1, y1, z1] = operation.maxs;
  const wallTexture = operation.textures?.walls ?? 'common/caulk';
  const floorTexture = operation.textures?.floor ?? wallTexture;
  const ceilingTexture = operation.textures?.ceiling ?? wallTexture;
  const boxes: Array<[Vec3, Vec3, string]> = [
    [[x0, y0, z0], [x1, y1, z0 + thickness], floorTexture],
    [[x0, y0, z1 - thickness], [x1, y1, z1], ceilingTexture],
    [[x0, y0, z0 + thickness], [x0 + thickness, y1, z1 - thickness], wallTexture],
    [[x1 - thickness, y0, z0 + thickness], [x1, y1, z1 - thickness], wallTexture],
    [[x0 + thickness, y0, z0 + thickness], [x1 - thickness, y0 + thickness, z1 - thickness], wallTexture],
    [[x0 + thickness, y1 - thickness, z0 + thickness], [x1 - thickness, y1, z1 - thickness], wallTexture],
  ];
  for (const [mins, maxs, texture] of boxes) {
    const brushIndex = addBox(entity, mins, maxs, texture);
    created.push(`E${entityIndex}:B${brushIndex}`);
  }
}

function setObjectTexture(resolved: ResolvedObject, texture: string): void {
  if (!texture.trim()) throw new Error('texture must not be empty');
  const brushes = resolved.kind === 'entity' ? resolved.entity.brushes : resolved.kind === 'brush' ? [resolved.brush] : [];
  const patches = resolved.kind === 'entity' ? resolved.entity.patches : resolved.kind === 'patch' ? [resolved.patch] : [];
  for (const brush of brushes) for (const face of brush.faces) face.texture = texture;
  for (const patch of patches) patch.texture = texture;
}

function applyTranslation(editor: Editor, targets: MapObjectRef[], delta: Vec3): void {
  assertVector('delta', delta);
  const resolved = targets.map(ref => resolveObject(editor, ref));
  const entityIndices = new Set(resolved.filter(item => item.kind === 'entity').map(item => item.entityIndex));
  for (const item of resolved) {
    if (item.kind === 'entity') translateEntity(item.entity, delta);
    else if (!entityIndices.has(item.entityIndex) && item.kind === 'brush') translateBrush(item.brush, delta);
    else if (!entityIndices.has(item.entityIndex) && item.kind === 'patch') translatePatch(item.patch, delta);
  }
}

function applyDeletion(editor: Editor, targets: MapObjectRef[]): void {
  const resolved = targets.map(ref => resolveObject(editor, ref));
  if (resolved.some(item => item.kind === 'entity' && item.entityIndex === 0)) throw new Error('Worldspawn cannot be deleted');

  const entityIndices = new Set(resolved.filter(item => item.kind === 'entity').map(item => item.entityIndex));
  const brushes = resolved.filter((item): item is Extract<ResolvedObject, { kind: 'brush' }> => item.kind === 'brush' && !entityIndices.has(item.entityIndex));
  const patches = resolved.filter((item): item is Extract<ResolvedObject, { kind: 'patch' }> => item.kind === 'patch' && !entityIndices.has(item.entityIndex));
  brushes.sort((a, b) => b.objectIndex - a.objectIndex).forEach(item => item.entity.brushes.splice(item.objectIndex, 1));
  patches.sort((a, b) => b.objectIndex - a.objectIndex).forEach(item => item.entity.patches.splice(item.objectIndex, 1));
  [...entityIndices].sort((a, b) => b - a).forEach(index => editor.entities.splice(index, 1));
  editor.selection = editor.selection.filter(item => {
    if (item.type === 'entity') return editor.entities.includes(item.entity);
    if (item.type === 'brush' || item.type === 'face') return item.entity.brushes.includes(item.brush);
    return item.entity.patches.includes(item.patch);
  });
}

export function applyMapOperations(editor: Editor, operations: readonly MapOperation[], label = 'Apply map operations'): MapOperationResult {
  if (operations.length === 0) throw new Error('At least one operation is required');
  const created: MapObjectRef[] = [];
  const changed = new Set<MapObjectRef>();

  editor.transact(label, () => {
    for (const operation of operations) {
      if (operation.type === 'create_entity') {
        if (!operation.classname.trim()) throw new Error('classname must not be empty');
        if (operation.origin) assertVector('origin', operation.origin);
        const entity = createEntity(operation.classname, operation.origin);
        Object.assign(entity.properties, operation.properties ?? {}, { classname: operation.classname });
        editor.entities.push(entity);
        created.push(`E${editor.entities.length - 1}`);
      } else if (operation.type === 'set_entity_properties') {
        const resolved = resolveObject(editor, operation.target);
        if (resolved.kind !== 'entity') throw new Error(`${operation.target} is not an entity`);
        if (operation.classname !== undefined) {
          if (!operation.classname.trim()) throw new Error('classname must not be empty');
          resolved.entity.classname = operation.classname;
          resolved.entity.properties.classname = operation.classname;
        }
        Object.assign(resolved.entity.properties, operation.properties ?? {});
        for (const key of operation.unset ?? []) {
          if (key === 'classname') throw new Error('classname cannot be removed');
          delete resolved.entity.properties[key];
        }
        changed.add(operation.target);
      } else if (operation.type === 'create_box') {
        const { entity, entityIndex } = resolveEntity(editor, operation.parent);
        const brushIndex = addBox(entity, operation.mins, operation.maxs, operation.texture ?? 'common/caulk');
        created.push(`E${entityIndex}:B${brushIndex}`);
      } else if (operation.type === 'create_room') {
        applyCreateRoom(editor, operation, created);
      } else if (operation.type === 'translate') {
        applyTranslation(editor, operation.targets, operation.delta);
        operation.targets.forEach(ref => changed.add(ref));
      } else if (operation.type === 'set_texture') {
        for (const ref of operation.targets) {
          setObjectTexture(resolveObject(editor, ref), operation.texture);
          changed.add(ref);
        }
      } else if (operation.type === 'delete') {
        applyDeletion(editor, operation.targets);
        operation.targets.forEach(ref => changed.add(ref));
      }
    }
  });

  const summaryParts = [
    `${operations.length} operation${operations.length === 1 ? '' : 's'}`,
    created.length > 0 ? `${created.length} object${created.length === 1 ? '' : 's'} created` : '',
    changed.size > 0 ? `${changed.size} object${changed.size === 1 ? '' : 's'} changed` : '',
  ].filter(Boolean);
  return {
    revision: editor.documentRevision,
    operationCount: operations.length,
    created,
    changed: [...changed],
    summary: summaryParts.join(' · '),
  };
}
