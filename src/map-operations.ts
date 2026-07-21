import {
  classicTextureProjection,
  clipBrush,
  cloneBrush,
  computeBrushGeometry,
  createBoxBrush,
  createFace,
  textureAxisFromPlane,
  validateBrush,
  type Brush,
  type BrushFace,
} from './brush';
import { createBrushPrimitive, createWedgeBrush, type BrushPrimitive, type WedgeDirection } from './brush-primitives';
import type { Editor } from './editor';
import { cloneEntity, createEntity, type Entity } from './entity';
import {
  mirrorEditorBrush,
  mirrorEditorEntity,
  rotateEditorBrush,
  rotateEditorEntity,
  translateEditorBrush,
  translateEditorEntity,
} from './editor-transforms';
import { vec3Dot, type Vec3 } from './math';
import { clonePatch, mirrorPatch, rotatePatch, translatePatch, type Patch } from './patch';
import { CONTENTS_DETAIL, CONTENTS_STRUCTURAL } from './map-flags';
import { hollowBrush, subtractBrush } from './csg';
import {
  GROUP_ID_KEY,
  GROUP_INFO_CLASSNAME,
  GROUP_NAME_KEY,
  isGroupInfoEntity,
  listNamedGroups,
} from './named-groups';

export type MapObjectRef = `E${number}` | `E${number}:B${number}` | `E${number}:P${number}`;
export type MapFaceRef = `E${number}:B${number}:F${number}`;
export type MapDocumentRef = MapObjectRef | MapFaceRef;
export type MapSymbolicRef = `@${string}`;
export type MapTargetRef = MapObjectRef | MapSymbolicRef;
export type MapFaceTargetRef = MapFaceRef | MapSymbolicRef | `${MapSymbolicRef}:F${number}`;

interface CreationMetadata {
  id?: string;
  group?: string;
  groupId?: string;
}

export interface TextureTransform {
  /** Fit one complete texture repeat to the face before applying the other relative transforms. */
  fit?: boolean;
  shift?: [number, number];
  scale?: [number, number];
  rotateDegrees?: number;
}

export interface CreateEntityOperation extends CreationMetadata {
  type: 'create_entity';
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

export interface CreateEntityArrayOperation extends CreationMetadata {
  type: 'create_entity_array';
  classname: string;
  start: Vec3;
  count: number;
  delta: Vec3;
  properties?: Record<string, string>;
}

export interface CreateBoxOperation extends CreationMetadata {
  type: 'create_box';
  parent?: MapTargetRef;
  mins: Vec3;
  maxs: Vec3;
  texture?: string;
  textures?: { top?: string; bottom?: string; sides?: string };
  textureTransform?: TextureTransform;
  textureTransforms?: { top?: TextureTransform; bottom?: TextureTransform; sides?: TextureTransform };
}

export interface CreateRoomOperation extends CreationMetadata {
  type: 'create_room';
  parent?: MapTargetRef;
  mins: Vec3;
  maxs: Vec3;
  wallThickness?: number;
  textures?: {
    walls?: string;
    floor?: string;
    ceiling?: string;
  };
  textureTransform?: TextureTransform;
  textureTransforms?: { walls?: TextureTransform; floor?: TextureTransform; ceiling?: TextureTransform };
}

export interface CreateBoxArrayOperation extends CreationMetadata {
  type: 'create_box_array';
  parent?: MapTargetRef;
  mins: Vec3;
  maxs: Vec3;
  count: number;
  delta: Vec3;
  texture?: string;
  textures?: { top?: string; bottom?: string; sides?: string };
  textureTransform?: TextureTransform;
  textureTransforms?: { top?: TextureTransform; bottom?: TextureTransform; sides?: TextureTransform };
  classification?: 'detail' | 'structural';
}

export type MapAxis = 'x' | 'y' | 'z';

export interface CreatePrimitiveOperation extends CreationMetadata {
  type: 'create_primitive';
  parent?: MapTargetRef;
  primitive: BrushPrimitive;
  mins: Vec3;
  maxs: Vec3;
  texture?: string;
  textures?: { top?: string; bottom?: string; sides?: string };
  textureTransform?: TextureTransform;
  textureTransforms?: { top?: TextureTransform; bottom?: TextureTransform; sides?: TextureTransform };
  axis?: MapAxis;
  sides?: number;
}

export interface CreateWedgeOperation extends CreationMetadata {
  type: 'create_wedge';
  parent?: MapTargetRef;
  mins: Vec3;
  maxs: Vec3;
  texture?: string;
  textureTransform?: TextureTransform;
  direction?: WedgeDirection;
}

export interface CreateStairsOperation extends CreationMetadata {
  type: 'create_stairs';
  parent?: MapTargetRef;
  mins: Vec3;
  maxs: Vec3;
  texture?: string;
  textures?: { treads?: string; risers?: string; sides?: string; underside?: string };
  textureTransform?: TextureTransform;
  textureTransforms?: {
    treads?: TextureTransform; risers?: TextureTransform; sides?: TextureTransform; underside?: TextureTransform;
  };
  direction?: WedgeDirection;
  steps: number;
}

export interface CreateBrushOperation extends CreationMetadata {
  type: 'create_brush';
  parent?: MapTargetRef;
  texture?: string;
  textureTransform?: TextureTransform;
  faces: Array<{ points: [Vec3, Vec3, Vec3]; texture?: string; textureTransform?: TextureTransform }>;
}

export interface TranslateObjectsOperation {
  type: 'translate';
  targets: MapTargetRef[];
  delta: Vec3;
}

export interface RotateObjectsOperation {
  type: 'rotate';
  targets: MapTargetRef[];
  center: Vec3;
  axis: MapAxis;
  angleDegrees: number;
}

export interface MirrorObjectsOperation {
  type: 'mirror';
  targets: MapTargetRef[];
  center: Vec3;
  axis: MapAxis;
}

export interface CloneObjectsOperation extends CreationMetadata {
  type: 'clone';
  targets: MapTargetRef[];
  delta?: Vec3;
}

export interface ArrayObjectsOperation extends CreationMetadata {
  type: 'array';
  targets: MapTargetRef[];
  copies: number;
  delta: Vec3;
}

export interface SetTextureOperation {
  type: 'set_texture';
  targets: MapTargetRef[];
  texture: string;
}

export interface EditFacesOperation {
  type: 'edit_faces';
  targets: MapFaceTargetRef[];
  texture?: string;
  shift?: [number, number];
  scale?: [number, number];
  rotateDegrees?: number;
  fit?: boolean;
  contentFlags?: number;
  surfaceFlags?: number;
  value?: number;
}

export interface SetBrushClassificationOperation {
  type: 'set_brush_classification';
  targets: MapTargetRef[];
  classification: 'detail' | 'structural';
}

export interface ClipBrushesOperation {
  type: 'clip_brushes';
  id?: string;
  targets: MapTargetRef[];
  planePoints: [Vec3, Vec3, Vec3];
  keep?: 'front' | 'back' | 'both';
  texture?: string;
}

export interface HollowBrushesOperation {
  type: 'hollow_brushes';
  id?: string;
  targets: MapTargetRef[];
  thickness: number;
}

export interface CsgSubtractOperation {
  type: 'csg_subtract';
  id?: string;
  targets: MapTargetRef[];
  carvers: MapTargetRef[];
  deleteCarvers?: boolean;
}

export interface CreateJumpPadOperation extends CreationMetadata {
  type: 'create_jump_pad';
  mins: Vec3;
  maxs: Vec3;
  apex: Vec3;
  targetname?: string;
  texture?: string;
}

export interface CreateTeleporterOperation extends CreationMetadata {
  type: 'create_teleporter';
  mins: Vec3;
  maxs: Vec3;
  destination: Vec3;
  exitAngle?: number;
  targetname?: string;
  texture?: string;
}

export interface AssignGroupOperation {
  type: 'assign_group';
  targets: MapTargetRef[];
  group: string;
  groupId?: string;
}

export interface RemoveFromGroupOperation {
  type: 'remove_from_group';
  targets: MapTargetRef[];
}

export interface DeleteObjectsOperation {
  type: 'delete';
  targets: MapTargetRef[];
}

export type MapOperation =
  | CreateEntityOperation
  | CreateEntityArrayOperation
  | SetEntityPropertiesOperation
  | CreateBoxOperation
  | CreateBoxArrayOperation
  | CreateRoomOperation
  | CreatePrimitiveOperation
  | CreateWedgeOperation
  | CreateStairsOperation
  | CreateBrushOperation
  | TranslateObjectsOperation
  | RotateObjectsOperation
  | MirrorObjectsOperation
  | CloneObjectsOperation
  | ArrayObjectsOperation
  | SetTextureOperation
  | EditFacesOperation
  | SetBrushClassificationOperation
  | ClipBrushesOperation
  | HollowBrushesOperation
  | CsgSubtractOperation
  | CreateJumpPadOperation
  | CreateTeleporterOperation
  | AssignGroupOperation
  | RemoveFromGroupOperation
  | DeleteObjectsOperation;

export interface MapOperationResult {
  revision: number;
  operationCount: number;
  created: MapObjectRef[];
  changed: MapDocumentRef[];
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

interface ResolvedFace {
  ref: MapFaceRef;
  entity: Entity;
  brush: Brush;
  face: BrushFace;
}

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

function resolveFaces(editor: Pick<Editor, 'entities'>, refs: readonly MapFaceTargetRef[], aliases: SymbolicReferences): ResolvedFace[] {
  const result: ResolvedFace[] = [];
  const seen = new Set<BrushFace>();
  for (const ref of refs) {
    if (ref.startsWith('@')) {
      const match = /^@([A-Za-z][A-Za-z0-9_-]{0,63})(?::F(\d+))?$/.exec(ref);
      if (!match) throw new Error(`Invalid symbolic face reference ${ref}`);
      const handles = aliases.get(match[1]);
      if (!handles) throw new Error(`Unknown symbolic reference @${match[1]}`);
      const faceIndex = match[2] === undefined ? null : Number(match[2]);
      for (const handle of handles) {
        const resolved = resolveHandle(editor, handle);
        const brushes = resolved.kind === 'entity' ? resolved.entity.brushes : resolved.kind === 'brush' ? [resolved.brush] : [];
        if (brushes.length === 0) throw new Error(`${ref} does not resolve to brush geometry`);
        for (const brush of brushes) {
          const faces = faceIndex === null ? brush.faces : [brush.faces[faceIndex]];
          if (faces.some(face => !face)) throw new Error(`Face ${ref} does not exist`);
          for (const face of faces) {
            if (seen.has(face)) continue;
            seen.add(face);
            const entityIndex = editor.entities.indexOf(resolved.entity);
            const brushIndex = resolved.entity.brushes.indexOf(brush);
            const index = brush.faces.indexOf(face);
            result.push({ ref: `E${entityIndex}:B${brushIndex}:F${index}`, entity: resolved.entity, brush, face });
          }
        }
      }
      continue;
    }
    const match = /^E(\d+):B(\d+):F(\d+)$/.exec(ref);
    if (!match) throw new Error(`Invalid face reference ${ref}`);
    const entity = editor.entities[Number(match[1])];
    const brush = entity?.brushes[Number(match[2])];
    const face = brush?.faces[Number(match[3])];
    if (!entity || !brush || !face) throw new Error(`Face ${ref} does not exist`);
    if (seen.has(face)) continue;
    seen.add(face);
    result.push({ ref: ref as MapFaceRef, entity, brush, face });
  }
  return result;
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

function mergedTextureTransform(
  base: TextureTransform | undefined,
  override: TextureTransform | undefined,
): TextureTransform | undefined {
  if (!base) return override;
  if (!override) return base;
  return { ...base, ...override };
}

function applyBrushTextureTransform(editor: Editor, brush: Brush, transform: TextureTransform | undefined): void {
  if (!transform) return;
  for (const face of brush.faces) transformFaceTexture(editor, face, transform);
}

function applyCapSideTextures(
  editor: Editor,
  brush: Brush,
  axis: number,
  textures: { top?: string; bottom?: string; sides?: string } | undefined,
  textureTransform: TextureTransform | undefined,
  textureTransforms: { top?: TextureTransform; bottom?: TextureTransform; sides?: TextureTransform } | undefined,
  fallback: string,
): void {
  for (const face of brush.faces) {
    const component = face.plane.normal[axis];
    const slot = component > 0.9 ? 'top' : component < -0.9 ? 'bottom' : 'sides';
    if (textures) face.texture = textures[slot] ?? fallback;
    transformFaceTexture(editor, face, mergedTextureTransform(textureTransform, textureTransforms?.[slot]));
  }
}

function axisIndex(axis: MapAxis): number {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

function addPrimitive(editor: Editor, entity: Entity, operation: CreatePrimitiveOperation): Brush {
  assertBounds(operation.mins, operation.maxs);
  const brush = createBrushPrimitive(
    operation.primitive,
    operation.mins,
    operation.maxs,
    operation.texture ?? 'common/caulk',
    axisIndex(operation.axis ?? 'z'),
    operation.sides ?? 8,
  );
  applyCapSideTextures(
    editor, brush, operation.primitive === 'box' ? 2 : axisIndex(operation.axis ?? 'z'),
    operation.textures, operation.textureTransform, operation.textureTransforms, operation.texture ?? 'common/caulk',
  );
  entity.brushes.push(brush);
  return brush;
}

function addWedge(editor: Editor, entity: Entity, operation: CreateWedgeOperation): Brush {
  assertBounds(operation.mins, operation.maxs);
  const brush = createWedgeBrush(
    operation.mins, operation.maxs, operation.texture ?? 'common/caulk', operation.direction ?? 'x+',
  );
  applyBrushTextureTransform(editor, brush, operation.textureTransform);
  entity.brushes.push(brush);
  return brush;
}

function addStairs(editor: Editor, entity: Entity, operation: CreateStairsOperation): ObjectHandle[] {
  assertBounds(operation.mins, operation.maxs);
  if (!Number.isInteger(operation.steps) || operation.steps < 2 || operation.steps > 64) {
    throw new Error('steps must be an integer from 2 to 64');
  }
  const direction = operation.direction ?? 'x+';
  const travelAxis = direction[0] === 'x' ? 0 : 1;
  const positive = direction.endsWith('+');
  const run = (operation.maxs[travelAxis] - operation.mins[travelAxis]) / operation.steps;
  const rise = (operation.maxs[2] - operation.mins[2]) / operation.steps;
  const handles: ObjectHandle[] = [];
  for (let step = 0; step < operation.steps; step++) {
    const mins = [...operation.mins] as Vec3;
    const maxs = [...operation.maxs] as Vec3;
    if (positive) {
      mins[travelAxis] = operation.mins[travelAxis] + step * run;
      maxs[travelAxis] = operation.mins[travelAxis] + (step + 1) * run;
    } else {
      mins[travelAxis] = operation.maxs[travelAxis] - (step + 1) * run;
      maxs[travelAxis] = operation.maxs[travelAxis] - step * run;
    }
    maxs[2] = operation.mins[2] + (step + 1) * rise;
    handles.push({
      kind: 'brush', entity,
      brush: (() => {
        const fallback = operation.texture ?? 'common/caulk';
        const brush = addBox(entity, mins, maxs, fallback);
        for (const face of brush.faces) {
          const slot = face.plane.normal[2] > 0.9
            ? 'treads'
            : face.plane.normal[2] < -0.9
              ? 'underside'
              : Math.abs(face.plane.normal[travelAxis]) > 0.9 ? 'risers' : 'sides';
          if (operation.textures) face.texture = operation.textures[slot] ?? fallback;
          transformFaceTexture(
            editor, face,
            mergedTextureTransform(operation.textureTransform, operation.textureTransforms?.[slot]),
          );
        }
        return brush;
      })(),
    });
  }
  return handles;
}

function addPlaneBrush(editor: Editor, entity: Entity, operation: CreateBrushOperation): Brush {
  if (operation.faces.length < 4 || operation.faces.length > 128) throw new Error('faces must contain 4 to 128 planes');
  const faces = operation.faces.map((face, index) => {
    if (face.points.length !== 3) throw new Error(`face ${index + 1} must contain exactly three points`);
    face.points.forEach((point, pointIndex) => assertVector(`face ${index + 1} point ${pointIndex + 1}`, point));
    return createFace(face.points[0], face.points[1], face.points[2], face.texture ?? operation.texture ?? 'common/caulk');
  });
  const brush: Brush = { faces, mins: [0, 0, 0], maxs: [0, 0, 0] };
  computeBrushGeometry(brush);
  const validation = validateBrush(brush);
  if (!validation.valid) throw new Error(`Invalid plane brush: ${validation.issues.join('; ')}`);
  brush.faces.forEach((face, index) => {
    transformFaceTexture(
      editor, face,
      mergedTextureTransform(operation.textureTransform, operation.faces[index].textureTransform),
    );
  });
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
  const boxes: Array<[Vec3, Vec3, string, 'floor' | 'ceiling' | 'walls']> = [
    [[x0, y0, z0], [x1, y1, z0 + thickness], floorTexture, 'floor'],
    [[x0, y0, z1 - thickness], [x1, y1, z1], ceilingTexture, 'ceiling'],
    [[x0, y0, z0 + thickness], [x0 + thickness, y1, z1 - thickness], wallTexture, 'walls'],
    [[x1 - thickness, y0, z0 + thickness], [x1, y1, z1 - thickness], wallTexture, 'walls'],
    [[x0 + thickness, y0, z0 + thickness], [x1 - thickness, y0 + thickness, z1 - thickness], wallTexture, 'walls'],
    [[x0 + thickness, y1 - thickness, z0 + thickness], [x1 - thickness, y1, z1 - thickness], wallTexture, 'walls'],
  ];
  return boxes.map(([mins, maxs, texture, slot]) => {
    const brush = addBox(entity, mins, maxs, texture);
    applyBrushTextureTransform(
      editor, brush,
      mergedTextureTransform(operation.textureTransform, operation.textureTransforms?.[slot]),
    );
    return { kind: 'brush' as const, entity, brush };
  });
}

function setObjectTexture(resolved: ResolvedObject, texture: string): void {
  if (!texture.trim()) throw new Error('texture must not be empty');
  const brushes = resolved.kind === 'entity' ? resolved.entity.brushes : resolved.kind === 'brush' ? [resolved.brush] : [];
  const patches = resolved.kind === 'entity' ? resolved.entity.patches : resolved.kind === 'patch' ? [resolved.patch] : [];
  for (const brush of brushes) for (const face of brush.faces) face.texture = texture;
  for (const patch of patches) patch.texture = texture;
}

function textureDimensions(editor: Editor, face: BrushFace): [number, number] {
  const texture = editor.textureManager?.getIfLoaded(face.texture);
  return [texture?.width ?? 128, texture?.height ?? 128];
}

function fitFaceTexture(editor: Editor, face: BrushFace): void {
  if (face.polygon.length < 3) return;
  const [textureWidth, textureHeight] = textureDimensions(editor, face);
  const [sVector, tVector] = textureAxisFromPlane(face.plane.normal);
  const s = face.polygon.map(vertex => vec3Dot(vertex, sVector));
  const t = face.polygon.map(vertex => vec3Dot(vertex, tVector));
  const minS = Math.min(...s); const maxS = Math.max(...s);
  const minT = Math.min(...t); const maxT = Math.max(...t);
  const sRange = maxS - minS; const tRange = maxT - minT;
  if (sRange < 0.001 || tRange < 0.001) return;
  const projection = classicTextureProjection(face);
  if (projection) {
    projection.scaleX = sRange / textureWidth;
    projection.scaleY = tRange / textureHeight;
    projection.rotation = 0;
    projection.offsetX = -minS / projection.scaleX;
    projection.offsetY = -minT / projection.scaleY;
  } else if (face.textureProjection.kind === 'brush-primitive') {
    face.textureProjection.matrix = [[1 / sRange, 0, -minS / sRange], [0, 1 / tRange, -minT / tRange]];
  }
}

function transformFaceTexture(editor: Editor, face: BrushFace, transform: TextureTransform | undefined): void {
  if (!transform) return;
  if (transform.fit) fitFaceTexture(editor, face);
  const [width, height] = textureDimensions(editor, face);
  const projection = classicTextureProjection(face);
  if (transform.shift) {
    if (!transform.shift.every(Number.isFinite)) throw new Error('shift must contain two finite numbers');
    if (projection) {
      projection.offsetX += transform.shift[0]; projection.offsetY += transform.shift[1];
    } else if (face.textureProjection.kind === 'brush-primitive') {
      face.textureProjection.matrix[0][2] += transform.shift[0] / width;
      face.textureProjection.matrix[1][2] += transform.shift[1] / height;
    }
  }
  if (transform.scale) {
    if (!transform.scale.every(value => Number.isFinite(value) && value > 0)) throw new Error('scale must contain two positive finite multipliers');
    if (projection) {
      projection.scaleX *= transform.scale[0]; projection.scaleY *= transform.scale[1];
    } else if (face.textureProjection.kind === 'brush-primitive') {
      for (let column = 0; column < 2; column++) {
        face.textureProjection.matrix[0][column] /= transform.scale[0];
        face.textureProjection.matrix[1][column] /= transform.scale[1];
      }
    }
  }
  if (transform.rotateDegrees !== undefined) {
    if (!Number.isFinite(transform.rotateDegrees)) throw new Error('rotateDegrees must be finite');
    if (projection) {
      projection.rotation = ((projection.rotation + transform.rotateDegrees) % 360 + 360) % 360;
    } else if (face.textureProjection.kind === 'brush-primitive') {
      const angle = transform.rotateDegrees * Math.PI / 180;
      const cos = Math.cos(angle); const sin = Math.sin(angle);
      const [uRow, vRow] = face.textureProjection.matrix;
      const uPixels = uRow.map(value => value * width);
      const vPixels = vRow.map(value => value * height);
      for (let column = 0; column < 3; column++) {
        uRow[column] = (cos * uPixels[column] - sin * vPixels[column]) / width;
        vRow[column] = (sin * uPixels[column] + cos * vPixels[column]) / height;
      }
    }
  }
}

function editFace(editor: Editor, face: BrushFace, operation: EditFacesOperation): void {
  if (operation.texture !== undefined) {
    if (!operation.texture.trim()) throw new Error('texture must not be empty');
    face.texture = operation.texture;
  }
  if (operation.contentFlags !== undefined) face.contentFlags = operation.contentFlags;
  if (operation.surfaceFlags !== undefined) face.surfaceFlags = operation.surfaceFlags;
  if (operation.value !== undefined) face.value = operation.value;
  transformFaceTexture(editor, face, operation);
}

function classifyBrushes(targets: ResolvedObject[], classification: 'detail' | 'structural'): Brush[] {
  const brushes = new Set<Brush>();
  for (const target of targets) {
    if (target.kind === 'entity') target.entity.brushes.forEach(brush => brushes.add(brush));
    else if (target.kind === 'brush') brushes.add(target.brush);
    else throw new Error(`${target.ref} is a patch; brush classification requires brushes or brush-owning entities`);
  }
  for (const brush of brushes) classifyBrush(brush, classification);
  return [...brushes];
}

function classifyBrush(brush: Brush, classification: 'detail' | 'structural'): void {
  for (const face of brush.faces) {
    face.contentFlags = classification === 'detail'
      ? (face.contentFlags | CONTENTS_DETAIL) & ~CONTENTS_STRUCTURAL
      : face.contentFlags & ~(CONTENTS_DETAIL | CONTENTS_STRUCTURAL);
  }
}

function requireBrushes(targets: ResolvedObject[], operation: string): Array<ResolvedObject & { kind: 'brush' }> {
  return targets.map(target => {
    if (target.kind !== 'brush') throw new Error(`${target.ref} is not a brush; ${operation} requires brush references`);
    return target;
  });
}

function replaceBrush(target: ResolvedObject & { kind: 'brush' }, replacements: Brush[]): ObjectHandle[] {
  const index = target.entity.brushes.indexOf(target.brush);
  if (index < 0) throw new Error(`${target.ref} was replaced earlier in this batch`);
  target.entity.brushes.splice(index, 1, ...replacements);
  return replacements.map(brush => ({ kind: 'brush' as const, entity: target.entity, brush }));
}

function applyClipBrushes(operation: ClipBrushesOperation, targets: Array<ResolvedObject & { kind: 'brush' }>): ObjectHandle[] {
  operation.planePoints.forEach((point, index) => assertVector(`plane point ${index + 1}`, point));
  const handles: ObjectHandle[] = [];
  for (const target of targets) {
    const back = operation.keep !== 'front' ? clipBrush(target.brush, operation.planePoints, operation.texture) : null;
    const [a, b, c] = operation.planePoints;
    const front = operation.keep !== 'back' ? clipBrush(target.brush, [b, a, c], operation.texture) : null;
    const replacements = [back, front].filter((brush): brush is Brush => brush !== null);
    if (replacements.length === 0) throw new Error(`Clip plane removed all of ${target.ref}`);
    handles.push(...replaceBrush(target, replacements));
  }
  return handles;
}

function applyHollowBrushes(operation: HollowBrushesOperation, targets: Array<ResolvedObject & { kind: 'brush' }>): ObjectHandle[] {
  if (!Number.isFinite(operation.thickness) || operation.thickness <= 0) throw new Error('thickness must be a positive number');
  const handles: ObjectHandle[] = [];
  for (const target of targets) {
    const shells = hollowBrush(target.brush, operation.thickness);
    if (shells.length === 0) throw new Error(`Could not hollow ${target.ref} at thickness ${operation.thickness}`);
    handles.push(...replaceBrush(target, shells));
  }
  return handles;
}

function applyCsgSubtract(
  operation: CsgSubtractOperation,
  targets: Array<ResolvedObject & { kind: 'brush' }>,
  carvers: Array<ResolvedObject & { kind: 'brush' }>,
): ObjectHandle[] {
  const carverBrushes = new Set(carvers.map(item => item.brush));
  if (targets.some(item => carverBrushes.has(item.brush))) throw new Error('A CSG target cannot also be a carver');
  const handles: ObjectHandle[] = [];
  for (const target of targets) {
    let pieces = [target.brush];
    for (const carver of carvers) {
      pieces = pieces.flatMap(piece => subtractBrush(piece, carver.brush) ?? [piece]);
    }
    if (pieces.length === 1 && pieces[0] === target.brush) continue;
    handles.push(...replaceBrush(target, pieces));
  }
  if (operation.deleteCarvers) {
    for (const carver of carvers) {
      const index = carver.entity.brushes.indexOf(carver.brush);
      if (index >= 0) carver.entity.brushes.splice(index, 1);
    }
  }
  return handles;
}

function generatedGroupId(editor: Editor, name: string): string {
  const base = `mcp-${name.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'group'}`.slice(0, 120);
  const used = new Set(listNamedGroups(editor.entities).map(group => group.id));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

function ensureGroup(editor: Editor, name: string, requestedId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('group must not be empty');
  const existing = listNamedGroups(editor.entities).find(group => group.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    if (requestedId && existing.id !== requestedId) throw new Error(`Group ${trimmed} already exists with id ${existing.id}`);
    return existing.id;
  }
  if (requestedId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestedId)) throw new Error(`Invalid groupId ${requestedId}`);
  const groupId = requestedId ?? generatedGroupId(editor, trimmed);
  if (listNamedGroups(editor.entities).some(group => group.id === groupId)) throw new Error(`Group id ${groupId} already exists`);
  const entity = createEntity(GROUP_INFO_CLASSNAME);
  entity.properties[GROUP_ID_KEY] = groupId;
  entity.properties[GROUP_NAME_KEY] = trimmed;
  editor.entities.push(entity);
  return groupId;
}

function setResolvedGroup(target: ResolvedObject, groupId: string | undefined): void {
  if (target.kind === 'entity') {
    if (isGroupInfoEntity(target.entity)) throw new Error('group_info entities cannot be assigned to groups');
    if (groupId) target.entity.properties[GROUP_ID_KEY] = groupId;
    else delete target.entity.properties[GROUP_ID_KEY];
  } else if (target.kind === 'brush') {
    target.brush.editorGroupId = groupId;
  } else {
    target.patch.editorGroupId = groupId;
  }
}

function recordCreated(
  editor: Editor,
  operation: CreationMetadata,
  handles: ObjectHandle[],
  createdHandles: ObjectHandle[],
  aliases: SymbolicReferences,
  groupHandles = handles,
): void {
  if (operation.groupId && !operation.group) throw new Error('groupId requires group');
  createdHandles.push(...handles);
  registerAlias(aliases, operation.id, handles);
  if (!operation.group) return;
  const groupId = ensureGroup(editor, operation.group, operation.groupId);
  for (const handle of groupHandles) setResolvedGroup(resolveHandle(editor, handle), groupId);
}

function generatedTargetName(editor: Editor, kind: 'jump' | 'teleport', id: string | undefined, sequence: number): string {
  const stem = id?.toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || String(sequence);
  const base = `mcp_${kind}_${stem}`;
  const used = new Set(editor.entities.map(entity => entity.properties.targetname).filter(Boolean));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

function createGameplayLink(
  editor: Editor,
  operation: CreateJumpPadOperation | CreateTeleporterOperation,
  sequence: number,
): { handles: ObjectHandle[]; groupHandles: ObjectHandle[] } {
  assertBounds(operation.mins, operation.maxs);
  const endpoint = operation.type === 'create_jump_pad' ? operation.apex : operation.destination;
  assertVector(operation.type === 'create_jump_pad' ? 'apex' : 'destination', endpoint);
  if (operation.type === 'create_teleporter' && operation.exitAngle !== undefined && !Number.isFinite(operation.exitAngle)) {
    throw new Error('exitAngle must be finite');
  }
  const requestedTargetName = operation.targetname?.trim();
  if (operation.targetname !== undefined && !requestedTargetName) throw new Error('targetname must not be empty');
  if (requestedTargetName && editor.entities.some(entity => entity.properties.targetname === requestedTargetName)) {
    throw new Error(`targetname ${requestedTargetName} already exists`);
  }
  const targetname = requestedTargetName ?? generatedTargetName(
    editor, operation.type === 'create_jump_pad' ? 'jump' : 'teleport', operation.id, sequence,
  );
  const trigger = createEntity(operation.type === 'create_jump_pad' ? 'trigger_push' : 'trigger_teleport');
  trigger.properties.target = targetname;
  editor.entities.push(trigger);
  const brush = addBox(trigger, operation.mins, operation.maxs, operation.texture ?? 'common/trigger');
  const destination = createEntity(
    operation.type === 'create_jump_pad' ? 'target_position' : 'misc_teleporter_dest', endpoint,
  );
  destination.properties.targetname = targetname;
  if (operation.type === 'create_teleporter') destination.properties.angle = String(operation.exitAngle ?? 0);
  editor.entities.push(destination);
  const triggerHandle: ObjectHandle = { kind: 'entity', entity: trigger };
  const destinationHandle: ObjectHandle = { kind: 'entity', entity: destination };
  return {
    handles: [triggerHandle, { kind: 'brush', entity: trigger, brush }, destinationHandle],
    groupHandles: [triggerHandle, destinationHandle],
  };
}

function applyTranslation(editor: Editor, targets: ResolvedObject[], delta: Vec3): void {
  assertVector('delta', delta);
  const entities = new Set(targets.filter(item => item.kind === 'entity').map(item => item.entity));
  for (const item of targets) {
    if (item.kind === 'entity') translateEditorEntity(editor, item.entity, delta);
    else if (!entities.has(item.entity) && item.kind === 'brush') translateEditorBrush(editor, item.brush, delta);
    else if (!entities.has(item.entity) && item.kind === 'patch') translatePatch(item.patch, delta);
  }
}

function applyRotation(editor: Editor, targets: ResolvedObject[], center: Vec3, axis: MapAxis, angleDegrees: number): void {
  assertVector('center', center);
  if (!Number.isFinite(angleDegrees)) throw new Error('angleDegrees must be finite');
  const index = axisIndex(axis);
  const angle = angleDegrees * Math.PI / 180;
  const entities = new Set(targets.filter(item => item.kind === 'entity').map(item => item.entity));
  for (const item of targets) {
    if (item.kind === 'entity') rotateEditorEntity(editor, item.entity, center, index, angle);
    else if (!entities.has(item.entity) && item.kind === 'brush') rotateEditorBrush(editor, item.brush, center, index, angle);
    else if (!entities.has(item.entity) && item.kind === 'patch') rotatePatch(item.patch, center, index, angle);
  }
}

function applyMirror(editor: Editor, targets: ResolvedObject[], center: Vec3, axis: MapAxis): void {
  assertVector('center', center);
  const index = axisIndex(axis);
  const entities = new Set(targets.filter(item => item.kind === 'entity').map(item => item.entity));
  for (const item of targets) {
    if (item.kind === 'entity') mirrorEditorEntity(editor, item.entity, center, index);
    else if (!entities.has(item.entity) && item.kind === 'brush') mirrorEditorBrush(editor, item.brush, center, index);
    else if (!entities.has(item.entity) && item.kind === 'patch') mirrorPatch(item.patch, center, index);
  }
}

function cloneResolved(editor: Editor, target: ResolvedObject, delta: Vec3): ObjectHandle {
  if (target.kind === 'entity') {
    if (target.entityIndex === 0) throw new Error('Worldspawn cannot be cloned as an entity');
    const entity = cloneEntity(target.entity);
    translateEditorEntity(editor, entity, delta);
    editor.entities.push(entity);
    return { kind: 'entity', entity };
  }
  if (target.kind === 'brush') {
    const brush = cloneBrush(target.brush);
    translateEditorBrush(editor, brush, delta);
    target.entity.brushes.push(brush);
    return { kind: 'brush', entity: target.entity, brush };
  }
  const patch = clonePatch(target.patch);
  translatePatch(patch, delta);
  target.entity.patches.push(patch);
  return { kind: 'patch', entity: target.entity, patch };
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
  const changedFaceRefs = new Set<MapFaceRef>();
  const deletedRefs = new Set<MapObjectRef>();
  const aliases: SymbolicReferences = new Map();
  let gameplayLinkSequence = 0;

  editor.transact(label, () => {
    for (const operation of operations) {
      if (operation.type === 'create_entity') {
        if (!operation.classname.trim()) throw new Error('classname must not be empty');
        if (operation.origin) assertVector('origin', operation.origin);
        const entity = createEntity(operation.classname, operation.origin);
        Object.assign(entity.properties, operation.properties ?? {}, { classname: operation.classname });
        editor.entities.push(entity);
        const handle: ObjectHandle = { kind: 'entity', entity };
        recordCreated(editor, operation, [handle], createdHandles, aliases);
      } else if (operation.type === 'create_entity_array') {
        if (!operation.classname.trim()) throw new Error('classname must not be empty');
        assertVector('start', operation.start); assertVector('delta', operation.delta);
        if (!Number.isInteger(operation.count) || operation.count < 1 || operation.count > 128) throw new Error('count must be an integer from 1 to 128');
        const handles: ObjectHandle[] = [];
        for (let index = 0; index < operation.count; index++) {
          const origin = operation.start.map((value, axis) => value + operation.delta[axis] * index) as Vec3;
          const entity = createEntity(operation.classname, origin);
          Object.assign(entity.properties, operation.properties ?? {}, { classname: operation.classname });
          editor.entities.push(entity); handles.push({ kind: 'entity', entity });
        }
        recordCreated(editor, operation, handles, createdHandles, aliases);
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
        const fallback = operation.texture ?? 'common/caulk';
        const brush = addBox(entity, operation.mins, operation.maxs, fallback);
        applyCapSideTextures(
          editor, brush, 2, operation.textures,
          operation.textureTransform, operation.textureTransforms, fallback,
        );
        const handle: ObjectHandle = { kind: 'brush', entity, brush };
        recordCreated(editor, operation, [handle], createdHandles, aliases);
      } else if (operation.type === 'create_room') {
        const handles = applyCreateRoom(editor, operation, aliases);
        recordCreated(editor, operation, handles, createdHandles, aliases);
      } else if (operation.type === 'create_box_array') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        assertBounds(operation.mins, operation.maxs); assertVector('delta', operation.delta);
        if (!Number.isInteger(operation.count) || operation.count < 1 || operation.count > 128) throw new Error('count must be an integer from 1 to 128');
        const fallback = operation.texture ?? 'common/caulk';
        const handles: ObjectHandle[] = [];
        for (let index = 0; index < operation.count; index++) {
          const offset = operation.delta.map(value => value * index) as Vec3;
          const mins = operation.mins.map((value, axis) => value + offset[axis]) as Vec3;
          const maxs = operation.maxs.map((value, axis) => value + offset[axis]) as Vec3;
          const brush = addBox(entity, mins, maxs, fallback);
          applyCapSideTextures(
            editor, brush, 2, operation.textures,
            operation.textureTransform, operation.textureTransforms, fallback,
          );
          if (operation.classification) classifyBrush(brush, operation.classification);
          handles.push({ kind: 'brush', entity, brush });
        }
        recordCreated(editor, operation, handles, createdHandles, aliases);
      } else if (operation.type === 'create_primitive') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        const handle: ObjectHandle = { kind: 'brush', entity, brush: addPrimitive(editor, entity, operation) };
        recordCreated(editor, operation, [handle], createdHandles, aliases);
      } else if (operation.type === 'create_wedge') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        const handle: ObjectHandle = { kind: 'brush', entity, brush: addWedge(editor, entity, operation) };
        recordCreated(editor, operation, [handle], createdHandles, aliases);
      } else if (operation.type === 'create_stairs') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        const handles = addStairs(editor, entity, operation);
        recordCreated(editor, operation, handles, createdHandles, aliases);
      } else if (operation.type === 'create_brush') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        const handle: ObjectHandle = { kind: 'brush', entity, brush: addPlaneBrush(editor, entity, operation) };
        recordCreated(editor, operation, [handle], createdHandles, aliases);
      } else if (operation.type === 'create_jump_pad' || operation.type === 'create_teleporter') {
        const created = createGameplayLink(editor, operation, ++gameplayLinkSequence);
        recordCreated(editor, operation, created.handles, createdHandles, aliases, created.groupHandles);
      } else if (operation.type === 'translate') {
        const targets = resolveTargets(editor, operation.targets, aliases);
        applyTranslation(editor, targets, operation.delta);
        targets.forEach(target => changedHandles.add(objectHandle(target)));
      } else if (operation.type === 'rotate') {
        const targets = resolveTargets(editor, operation.targets, aliases);
        applyRotation(editor, targets, operation.center, operation.axis, operation.angleDegrees);
        targets.forEach(target => changedHandles.add(objectHandle(target)));
      } else if (operation.type === 'mirror') {
        const targets = resolveTargets(editor, operation.targets, aliases);
        applyMirror(editor, targets, operation.center, operation.axis);
        targets.forEach(target => changedHandles.add(objectHandle(target)));
      } else if (operation.type === 'clone') {
        const delta = operation.delta ?? [0, 0, 0];
        assertVector('delta', delta);
        const handles = resolveTargets(editor, operation.targets, aliases).map(target => cloneResolved(editor, target, delta));
        recordCreated(editor, operation, handles, createdHandles, aliases);
      } else if (operation.type === 'array') {
        assertVector('delta', operation.delta);
        if (!Number.isInteger(operation.copies) || operation.copies < 1 || operation.copies > 64) {
          throw new Error('copies must be an integer from 1 to 64');
        }
        const sources = resolveTargets(editor, operation.targets, aliases);
        const handles: ObjectHandle[] = [];
        for (let copy = 1; copy <= operation.copies; copy++) {
          const delta: Vec3 = operation.delta.map(value => value * copy) as Vec3;
          handles.push(...sources.map(target => cloneResolved(editor, target, delta)));
        }
        recordCreated(editor, operation, handles, createdHandles, aliases);
      } else if (operation.type === 'set_texture') {
        for (const target of resolveTargets(editor, operation.targets, aliases)) {
          setObjectTexture(target, operation.texture);
          changedHandles.add(objectHandle(target));
        }
      } else if (operation.type === 'edit_faces') {
        const faces = resolveFaces(editor, operation.targets, aliases);
        for (const resolved of faces) {
          editFace(editor, resolved.face, operation);
          changedFaceRefs.add(resolved.ref);
        }
      } else if (operation.type === 'set_brush_classification') {
        const targets = resolveTargets(editor, operation.targets, aliases);
        const brushes = classifyBrushes(targets, operation.classification);
        for (const brush of brushes) {
          const entity = editor.entities.find(candidate => candidate.brushes.includes(brush));
          if (entity) changedHandles.add({ kind: 'brush', entity, brush });
        }
      } else if (operation.type === 'clip_brushes') {
        const targets = requireBrushes(resolveTargets(editor, operation.targets, aliases), 'clip_brushes');
        const handles = applyClipBrushes(operation, targets);
        createdHandles.push(...handles);
        registerAlias(aliases, operation.id, handles);
      } else if (operation.type === 'hollow_brushes') {
        const targets = requireBrushes(resolveTargets(editor, operation.targets, aliases), 'hollow_brushes');
        const handles = applyHollowBrushes(operation, targets);
        createdHandles.push(...handles);
        registerAlias(aliases, operation.id, handles);
      } else if (operation.type === 'csg_subtract') {
        const targets = requireBrushes(resolveTargets(editor, operation.targets, aliases), 'csg_subtract');
        const carvers = requireBrushes(resolveTargets(editor, operation.carvers, aliases), 'csg_subtract');
        const handles = applyCsgSubtract(operation, targets, carvers);
        createdHandles.push(...handles);
        registerAlias(aliases, operation.id, handles);
      } else if (operation.type === 'assign_group') {
        const targets = resolveTargets(editor, operation.targets, aliases);
        const groupId = ensureGroup(editor, operation.group, operation.groupId);
        for (const target of targets) {
          setResolvedGroup(target, groupId);
          changedHandles.add(objectHandle(target));
        }
      } else if (operation.type === 'remove_from_group') {
        const targets = resolveTargets(editor, operation.targets, aliases);
        for (const target of targets) {
          setResolvedGroup(target, undefined);
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
  const changed = [...new Set<MapDocumentRef>([...refsForHandles(changedHandles), ...changedFaceRefs, ...deletedRefs])];
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
