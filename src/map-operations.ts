import { createBoxBrush, translateBrush, type Brush } from './brush';
import type { Editor } from './editor';
import { createEntity, translateEntity, type Entity } from './entity';
import type { Vec3 } from './math';
import { translatePatch, type Patch } from './patch';

export type MapObjectRef = `E${number}` | `E${number}:B${number}` | `E${number}:P${number}`;
export type MapSymbolicRef = `@${string}`;
export type MapTargetRef = MapObjectRef | MapSymbolicRef;

export interface CreateEntityOperation {
  type: 'create_entity';
  id?: string;
  classname: string;
  origin?: Vec3;
  properties?: Record<string, string>;
}

export interface SetEntityPropertiesOperation {
  type: 'set_entity_properties';
  target: MapTargetRef;
  classname?: string;
  properties?: Record<string, string>;
  unset?: string[];
}

export interface CreateBoxOperation {
  type: 'create_box';
  id?: string;
  parent?: MapTargetRef;
  mins: Vec3;
  maxs: Vec3;
  texture?: string;
}

export interface CreateRoomOperation {
  type: 'create_room';
  id?: string;
  parent?: MapTargetRef;
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
  targets: MapTargetRef[];
  delta: Vec3;
}

export interface SetTextureOperation {
  type: 'set_texture';
  targets: MapTargetRef[];
  texture: string;
}

export interface DeleteObjectsOperation {
  type: 'delete';
  targets: MapTargetRef[];
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
  aliases: Record<string, MapObjectRef[]>;
  summary: string;
}

type ResolvedObject =
  | { ref: MapObjectRef; kind: 'entity'; entityIndex: number; entity: Entity }
  | { ref: MapObjectRef; kind: 'brush'; entityIndex: number; entity: Entity; objectIndex: number; brush: Brush }
  | { ref: MapObjectRef; kind: 'patch'; entityIndex: number; entity: Entity; objectIndex: number; patch: Patch };

type ObjectHandle =
  | { kind: 'entity'; entity: Entity }
  | { kind: 'brush'; entity: Entity; brush: Brush }
  | { kind: 'patch'; entity: Entity; patch: Patch };

type SymbolicReferences = Map<string, ObjectHandle[]>;

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

function objectHandle(resolved: ResolvedObject): ObjectHandle {
  if (resolved.kind === 'entity') return { kind: 'entity', entity: resolved.entity };
  if (resolved.kind === 'brush') return { kind: 'brush', entity: resolved.entity, brush: resolved.brush };
  return { kind: 'patch', entity: resolved.entity, patch: resolved.patch };
}

function resolveHandle(editor: Pick<Editor, 'entities'>, handle: ObjectHandle): ResolvedObject {
  const entityIndex = editor.entities.indexOf(handle.entity);
  if (entityIndex < 0) throw new Error('A referenced entity was deleted earlier in this batch');
  if (handle.kind === 'entity') return { ref: `E${entityIndex}`, kind: 'entity', entityIndex, entity: handle.entity };
  if (handle.kind === 'brush') {
    const objectIndex = handle.entity.brushes.indexOf(handle.brush);
    if (objectIndex < 0) throw new Error('A referenced brush was deleted earlier in this batch');
    return { ref: `E${entityIndex}:B${objectIndex}`, kind: 'brush', entityIndex, entity: handle.entity, objectIndex, brush: handle.brush };
  }
  const objectIndex = handle.entity.patches.indexOf(handle.patch);
  if (objectIndex < 0) throw new Error('A referenced patch was deleted earlier in this batch');
  return { ref: `E${entityIndex}:P${objectIndex}`, kind: 'patch', entityIndex, entity: handle.entity, objectIndex, patch: handle.patch };
}

function resolveTargets(editor: Pick<Editor, 'entities'>, refs: readonly MapTargetRef[], aliases: SymbolicReferences): ResolvedObject[] {
  const resolved: ResolvedObject[] = [];
  const seen = new Set<object>();
  for (const ref of refs) {
    const items = ref.startsWith('@')
      ? aliases.get(ref.slice(1))?.map(handle => resolveHandle(editor, handle))
      : [resolveObject(editor, ref as MapObjectRef)];
    if (!items) throw new Error(`Unknown symbolic reference ${ref}`);
    for (const item of items) {
      const identity = item.kind === 'entity' ? item.entity : item.kind === 'brush' ? item.brush : item.patch;
      if (seen.has(identity)) continue;
      seen.add(identity);
      resolved.push(item);
    }
  }
  return resolved;
}

function resolveEntity(editor: Pick<Editor, 'entities'>, ref: MapTargetRef | undefined, aliases: SymbolicReferences): ResolvedObject & { kind: 'entity' } {
  const resolved = resolveTargets(editor, [ref ?? 'E0'], aliases);
  if (resolved.length !== 1 || resolved[0].kind !== 'entity') throw new Error(`${ref ?? 'E0'} is not a single entity`);
  return resolved[0];
}

function registerAlias(aliases: SymbolicReferences, id: string | undefined, handles: ObjectHandle[]): void {
  if (!id) return;
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) throw new Error(`Invalid symbolic id ${id}`);
  if (aliases.has(id)) throw new Error(`Duplicate symbolic id @${id}`);
  aliases.set(id, handles);
}

function addBox(entity: Entity, mins: Vec3, maxs: Vec3, texture: string): Brush {
  assertBounds(mins, maxs);
  const brush = createBoxBrush(mins, maxs, texture);
  entity.brushes.push(brush);
  return brush;
}

function applyCreateRoom(editor: Editor, operation: CreateRoomOperation, aliases: SymbolicReferences): ObjectHandle[] {
  assertBounds(operation.mins, operation.maxs);
  const { entity } = resolveEntity(editor, operation.parent, aliases);
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
  return boxes.map(([mins, maxs, texture]) => ({ kind: 'brush' as const, entity, brush: addBox(entity, mins, maxs, texture) }));
}

function setObjectTexture(resolved: ResolvedObject, texture: string): void {
  if (!texture.trim()) throw new Error('texture must not be empty');
  const brushes = resolved.kind === 'entity' ? resolved.entity.brushes : resolved.kind === 'brush' ? [resolved.brush] : [];
  const patches = resolved.kind === 'entity' ? resolved.entity.patches : resolved.kind === 'patch' ? [resolved.patch] : [];
  for (const brush of brushes) for (const face of brush.faces) face.texture = texture;
  for (const patch of patches) patch.texture = texture;
}

function applyTranslation(targets: ResolvedObject[], delta: Vec3): void {
  assertVector('delta', delta);
  const entities = new Set(targets.filter(item => item.kind === 'entity').map(item => item.entity));
  for (const item of targets) {
    if (item.kind === 'entity') translateEntity(item.entity, delta);
    else if (!entities.has(item.entity) && item.kind === 'brush') translateBrush(item.brush, delta);
    else if (!entities.has(item.entity) && item.kind === 'patch') translatePatch(item.patch, delta);
  }
}

function applyDeletion(editor: Editor, resolved: ResolvedObject[]): void {
  if (resolved.some(item => item.kind === 'entity' && item.entity === editor.entities[0])) throw new Error('Worldspawn cannot be deleted');

  const entities = new Set(resolved.filter(item => item.kind === 'entity').map(item => item.entity));
  const brushes = resolved.filter((item): item is Extract<ResolvedObject, { kind: 'brush' }> => item.kind === 'brush' && !entities.has(item.entity));
  const patches = resolved.filter((item): item is Extract<ResolvedObject, { kind: 'patch' }> => item.kind === 'patch' && !entities.has(item.entity));
  brushes.sort((a, b) => b.objectIndex - a.objectIndex).forEach(item => item.entity.brushes.splice(item.objectIndex, 1));
  patches.sort((a, b) => b.objectIndex - a.objectIndex).forEach(item => item.entity.patches.splice(item.objectIndex, 1));
  [...entities].map(entity => editor.entities.indexOf(entity)).sort((a, b) => b - a).forEach(index => editor.entities.splice(index, 1));
  editor.selection = editor.selection.filter(item => {
    if (item.type === 'entity') return editor.entities.includes(item.entity);
    if (item.type === 'brush' || item.type === 'face') return item.entity.brushes.includes(item.brush);
    return item.entity.patches.includes(item.patch);
  });
}

export function applyMapOperations(editor: Editor, operations: readonly MapOperation[], label = 'Apply map operations'): MapOperationResult {
  if (operations.length === 0) throw new Error('At least one operation is required');
  const createdHandles: ObjectHandle[] = [];
  const changedHandles = new Set<ObjectHandle>();
  const deletedRefs = new Set<MapObjectRef>();
  const aliases: SymbolicReferences = new Map();

  editor.transact(label, () => {
    for (const operation of operations) {
      if (operation.type === 'create_entity') {
        if (!operation.classname.trim()) throw new Error('classname must not be empty');
        if (operation.origin) assertVector('origin', operation.origin);
        const entity = createEntity(operation.classname, operation.origin);
        Object.assign(entity.properties, operation.properties ?? {}, { classname: operation.classname });
        editor.entities.push(entity);
        const handle: ObjectHandle = { kind: 'entity', entity };
        createdHandles.push(handle);
        registerAlias(aliases, operation.id, [handle]);
      } else if (operation.type === 'set_entity_properties') {
        const targets = resolveTargets(editor, [operation.target], aliases);
        if (targets.length !== 1) throw new Error(`${operation.target} does not resolve to a single object`);
        const resolved = targets[0];
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
        changedHandles.add(objectHandle(resolved));
      } else if (operation.type === 'create_box') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        const handle: ObjectHandle = { kind: 'brush', entity, brush: addBox(entity, operation.mins, operation.maxs, operation.texture ?? 'common/caulk') };
        createdHandles.push(handle);
        registerAlias(aliases, operation.id, [handle]);
      } else if (operation.type === 'create_room') {
        const handles = applyCreateRoom(editor, operation, aliases);
        createdHandles.push(...handles);
        registerAlias(aliases, operation.id, handles);
      } else if (operation.type === 'translate') {
        const targets = resolveTargets(editor, operation.targets, aliases);
        applyTranslation(targets, operation.delta);
        targets.forEach(target => changedHandles.add(objectHandle(target)));
      } else if (operation.type === 'set_texture') {
        for (const target of resolveTargets(editor, operation.targets, aliases)) {
          setObjectTexture(target, operation.texture);
          changedHandles.add(objectHandle(target));
        }
      } else if (operation.type === 'delete') {
        const targets = resolveTargets(editor, operation.targets, aliases);
        targets.forEach(target => deletedRefs.add(target.ref));
        applyDeletion(editor, targets);
      }
    }
  });

  const refsForHandles = (handles: Iterable<ObjectHandle>): MapObjectRef[] => {
    const refs: MapObjectRef[] = [];
    for (const handle of handles) {
      try {
        refs.push(resolveHandle(editor, handle).ref);
      } catch {
        // Objects created and deleted in one batch do not have final references.
      }
    }
    return [...new Set(refs)];
  };
  const created = refsForHandles(createdHandles);
  const changed = [...new Set([...refsForHandles(changedHandles), ...deletedRefs])];
  const aliasResult = Object.fromEntries(
    [...aliases].map(([id, handles]) => [`@${id}`, refsForHandles(handles)]),
  );

  const summaryParts = [
    `${operations.length} operation${operations.length === 1 ? '' : 's'}`,
    created.length > 0 ? `${created.length} object${created.length === 1 ? '' : 's'} created` : '',
    changed.length > 0 ? `${changed.length} object${changed.length === 1 ? '' : 's'} changed` : '',
  ].filter(Boolean);
  return {
    revision: editor.documentRevision,
    operationCount: operations.length,
    created,
    changed,
    aliases: aliasResult,
    summary: summaryParts.join(' · '),
  };
}
