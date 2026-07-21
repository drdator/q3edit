import {
  classicTextureProjection,
  clipBrush,
  cloneBrush,
  cloneTextureProjection,
  computeBrushGeometry,
  createBoxBrush,
  createFace,
  scaleBrushFaces,
  textureAxisFromPlane,
  validateBrush,
  type Brush,
  type BrushFace,
} from './brush';
import { createBrushPrimitive, createTaperedBrush, createWedgeBrush, type BrushPrimitive, type WedgeDirection } from './brush-primitives';
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
import {
  clonePatch,
  createArchPatch,
  createBevelPatch,
  createCylinderPatch,
  createEndcapPatch,
  createRampPatch,
  mirrorPatch,
  rotatePatch,
  scalePatchControlPoints,
  tessellatePatch,
  translatePatch,
  type Patch,
} from './patch';
import { fitPatchUV, naturalizePatchUV, thickenPatch, transformPatchUV } from './patch-operations';
import { CONTENTS_DETAIL, CONTENTS_STRUCTURAL } from './map-flags';
import { hollowBrush, subtractBrush } from './csg';
import {
  GROUP_ID_KEY,
  GROUP_INFO_CLASSNAME,
  GROUP_NAME_KEY,
  isGroupInfoEntity,
  listNamedGroups,
} from './named-groups';
import {
  SPATIAL_PLAN_KEY,
  readSpatialPlan,
  serializeSpatialPlan,
  upsertSpatialArea,
  upsertSpatialConnection,
  type SpatialAreaShape,
  type SpatialOpening,
  type SpatialRouteType,
} from './spatial-plan';
import {
  CONSTRUCTION_PATHS_KEY,
  readConstructionPaths,
  serializeConstructionPaths,
  upsertConstructionPath,
  type ConstructionPathCurve,
  type ConstructionPathKind,
} from './construction-paths';

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
  areaId?: string;
  connectionId?: string;
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

export interface CreateTaperedOperation extends CreationMetadata {
  type: 'create_tapered';
  parent?: MapTargetRef;
  mins: Vec3;
  maxs: Vec3;
  texture?: string;
  textureTransform?: TextureTransform;
  topScale?: [number, number];
  topOffset?: [number, number];
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

export interface CreatePrefabOperation extends CreationMetadata {
  type: 'create_prefab';
  parent?: MapTargetRef;
  prefab: 'pillar' | 'door_frame' | 'jump_pad_base';
  mins: Vec3;
  maxs: Vec3;
  texture: string;
  textures?: { primary?: string; accent?: string; focal?: string; sides?: string; bottom?: string };
  textureTransform?: TextureTransform;
  textureTransforms?: {
    primary?: TextureTransform; accent?: TextureTransform; focal?: TextureTransform;
    sides?: TextureTransform; bottom?: TextureTransform;
  };
  orientation?: 'x' | 'y';
  classification?: 'detail' | 'structural';
}

export interface CreatePatchOperation extends CreationMetadata {
  type: 'create_patch';
  parent?: MapTargetRef;
  preset: 'bevel' | 'endcap' | 'cylinder' | 'arch' | 'pipe' | 'ramp';
  mins: Vec3;
  maxs: Vec3;
  texture?: string;
  axis?: MapAxis;
  direction?: WedgeDirection;
  subdivisions?: number;
  textureMode?: 'natural' | 'fit';
}

export interface EditPatchesOperation {
  type: 'edit_patches';
  targets: MapTargetRef[];
  texture?: string;
  textureMode?: 'natural' | 'fit';
  shift?: [number, number];
  scale?: [number, number];
  rotateDegrees?: number;
  subdivisions?: number;
}

export interface ThickenPatchOperation extends CreationMetadata {
  type: 'thicken_patch';
  targets: MapTargetRef[];
  amount: number;
  caps?: boolean;
}

export interface CreateAreaOperation extends CreationMetadata {
  type: 'create_area';
  id: string;
  purpose: string;
  shape: SpatialAreaShape;
  center: Vec3;
  bounds?: { mins: Vec3; maxs: Vec3 };
  radius?: number;
  height: number;
  levels?: number[];
  footprint?: Vec3[];
  openings?: SpatialOpening[];
  landmarkIntent?: string;
  geometry?: 'none' | 'floor' | 'room';
  texture?: string;
  wallThickness?: number;
}

export interface ConnectAreasOperation extends CreationMetadata {
  type: 'connect_areas';
  id: string;
  fromArea: string;
  toArea: string;
  routeType: SpatialRouteType;
  width: number;
  verticalChange?: number;
  curvature?: number;
  cover?: 'open' | 'partial' | 'enclosed';
  visibility?: 'hidden' | 'glimpse' | 'visible';
  traversalIntent?: string;
  geometry?: 'none' | 'floor';
  thickness?: number;
  texture?: string;
}

export interface CreatePathOperation extends CreationMetadata {
  type: 'create_path';
  id: string;
  parent?: MapTargetRef;
  kind: ConstructionPathKind;
  curve?: ConstructionPathCurve;
  points: Vec3[];
  width: number;
  height?: number;
  thickness?: number;
  spacing?: number;
  subdivisions?: number;
  sides?: number;
  join?: 'overlap' | 'bevel';
  capEnds?: boolean;
  bankDegrees?: number;
  texture?: string;
  classification?: 'detail' | 'structural';
  replaceTargets?: MapTargetRef[];
  variation?: {
    seed: number;
    width?: number;
    height?: number;
    spacing?: number;
    bankDegrees?: number;
    grid?: number;
  };
}

export interface ReshapeRoomOperation extends CreationMetadata {
  type: 'reshape_room';
  targets: MapTargetRef[];
  shape: 'octagonal';
  wallThickness?: number;
  rotationDegrees?: number;
  textureMode?: 'preserve' | 'fit';
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

export interface RepeatVariationOperation extends CreationMetadata {
  type: 'repeat_variation';
  targets: MapTargetRef[];
  copies: number;
  distribution?: 'linear' | 'radial' | 'mirror';
  delta?: Vec3;
  stepSequence?: Vec3[];
  center?: Vec3;
  axis?: MapAxis;
  angleStepDegrees?: number;
  rotationSequence?: number[];
  scaleSequence?: Vec3[];
  materialSequence?: Array<{ texture: string; role?: string }>;
  seed?: number;
  variation?: { position?: Vec3; rotationDegrees?: number; scale?: Vec3 };
  grid?: number;
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

export interface OffsetFacesOperation {
  type: 'offset_faces';
  targets: MapFaceTargetRef[];
  distance: number;
  textureMode?: 'preserve' | 'fit';
}

export interface ChamferBrushesOperation {
  type: 'chamfer_brushes';
  id?: string;
  targets: MapTargetRef[];
  amount: number;
  axis?: MapAxis;
  corners?: Array<'min-min' | 'min-max' | 'max-min' | 'max-max'>;
  texture?: string;
  textureMode?: 'preserve' | 'fit';
}

export interface TaperBrushesOperation {
  type: 'taper_brushes';
  id?: string;
  targets: MapTargetRef[];
  axis?: MapAxis;
  endScale: [number, number];
  endOffset?: [number, number];
  textureMode?: 'preserve' | 'fit';
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
  | CreateTaperedOperation
  | CreateStairsOperation
  | CreateBrushOperation
  | CreatePrefabOperation
  | CreatePatchOperation
  | EditPatchesOperation
  | ThickenPatchOperation
  | CreateAreaOperation
  | ConnectAreasOperation
  | CreatePathOperation
  | ReshapeRoomOperation
  | TranslateObjectsOperation
  | RotateObjectsOperation
  | MirrorObjectsOperation
  | CloneObjectsOperation
  | ArrayObjectsOperation
  | RepeatVariationOperation
  | SetTextureOperation
  | EditFacesOperation
  | SetBrushClassificationOperation
  | ClipBrushesOperation
  | HollowBrushesOperation
  | CsgSubtractOperation
  | OffsetFacesOperation
  | ChamferBrushesOperation
  | TaperBrushesOperation
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

function addTapered(editor: Editor, entity: Entity, operation: CreateTaperedOperation): Brush {
  assertBounds(operation.mins, operation.maxs);
  const brush = createTaperedBrush(
    operation.mins, operation.maxs, operation.texture ?? 'common/caulk',
    operation.topScale, operation.topOffset,
  );
  applyBrushTextureTransform(editor, brush, operation.textureTransform);
  entity.brushes.push(brush);
  return brush;
}

function patchCenterFromBounds(mins: Vec3, maxs: Vec3): Vec3 {
  return maxs.map((value, axis) => (value + mins[axis]) / 2) as Vec3;
}

function orientPatchExtrusion(patch: Patch, center: Vec3, nativeAxis: MapAxis, axis: MapAxis): void {
  if (nativeAxis === axis) return;
  if (nativeAxis === 'z' && axis === 'x') rotatePatch(patch, center, 1, Math.PI / 2);
  else if (nativeAxis === 'z' && axis === 'y') rotatePatch(patch, center, 0, -Math.PI / 2);
  else if (nativeAxis === 'y' && axis === 'x') rotatePatch(patch, center, 2, -Math.PI / 2);
  else if (nativeAxis === 'y' && axis === 'z') rotatePatch(patch, center, 0, Math.PI / 2);
  else throw new Error(`Unsupported patch orientation ${nativeAxis} to ${axis}`);
}

function validateGeneratedPatch(patch: Patch): void {
  if (patch.width < 3 || patch.height < 3 || patch.width > 31 || patch.height > 31 || patch.width % 2 === 0 || patch.height % 2 === 0) {
    throw new Error(`Patch control grid must use odd dimensions from 3 through 31; got ${patch.width}x${patch.height}`);
  }
  if (patch.ctrl.length !== patch.height || patch.ctrl.some(row => row.length !== patch.width)) throw new Error('Patch control grid is not rectangular');
  if (patch.ctrl.some(row => row.some(point => ![...point.xyz, ...point.uv].every(Number.isFinite)))) throw new Error('Patch control points and UVs must be finite');
  if (![...patch.mins, ...patch.maxs].every(Number.isFinite) || patch.tessVerts.length === 0 || patch.tessIndices.length === 0) {
    throw new Error('Patch did not produce finite tessellated geometry');
  }
}

function addPatch(editor: Editor, entity: Entity, operation: CreatePatchOperation): Patch {
  assertBounds(operation.mins, operation.maxs);
  const texture = operation.texture ?? 'common/caulk';
  const creators = {
    bevel: createBevelPatch,
    endcap: createEndcapPatch,
    cylinder: createCylinderPatch,
    arch: createArchPatch,
    pipe: createCylinderPatch,
    ramp: createRampPatch,
  } as const;
  const patch = creators[operation.preset](operation.mins, operation.maxs, texture);
  const center = patchCenterFromBounds(operation.mins, operation.maxs);
  if (operation.preset === 'arch') orientPatchExtrusion(patch, center, 'y', operation.axis ?? 'y');
  else if (operation.preset !== 'ramp') orientPatchExtrusion(patch, center, 'z', operation.axis ?? 'z');
  if (operation.preset === 'ramp') {
    const rotation = { 'x+': 0, 'y+': Math.PI / 2, 'x-': Math.PI, 'y-': -Math.PI / 2 }[operation.direction ?? 'x+'];
    if (rotation) rotatePatch(patch, center, 2, rotation);
  }
  if (operation.subdivisions !== undefined) {
    if (!Number.isInteger(operation.subdivisions) || operation.subdivisions < 1 || operation.subdivisions > 24) {
      throw new Error('Patch subdivisions must be an integer from 1 to 24');
    }
    patch.subdivisions = operation.subdivisions; tessellatePatch(patch);
  }
  if (operation.textureMode === 'fit') fitPatchUV(patch);
  else if (operation.textureMode === 'natural') naturalizePatchUV(patch);
  validateGeneratedPatch(patch);
  entity.patches.push(patch);
  return patch;
}

function resolvedPatches(targets: ResolvedObject[], operation: string): Array<{ entity: Entity; patch: Patch }> {
  const patches: Array<{ entity: Entity; patch: Patch }> = [];
  const seen = new Set<Patch>();
  for (const target of targets) {
    const candidates = target.kind === 'entity' ? target.entity.patches : target.kind === 'patch' ? [target.patch] : null;
    if (!candidates) throw new Error(`${target.ref} is a brush; ${operation} requires patch references or patch-owning entities`);
    for (const patch of candidates) if (!seen.has(patch)) { seen.add(patch); patches.push({ entity: target.entity, patch }); }
  }
  if (patches.length === 0) throw new Error(`${operation} did not resolve any patches`);
  return patches;
}

function applyEditPatches(operation: EditPatchesOperation, patches: Array<{ entity: Entity; patch: Patch }>): void {
  if (operation.texture !== undefined && !operation.texture.trim()) throw new Error('Patch texture must not be empty');
  if (operation.scale && (!operation.scale.every(value => Number.isFinite(value) && value > 0))) throw new Error('Patch UV scale must contain positive finite values');
  if (operation.shift && !operation.shift.every(Number.isFinite)) throw new Error('Patch UV shift must contain finite values');
  if (operation.rotateDegrees !== undefined && !Number.isFinite(operation.rotateDegrees)) throw new Error('Patch UV rotation must be finite');
  if (operation.subdivisions !== undefined && (!Number.isInteger(operation.subdivisions) || operation.subdivisions < 1 || operation.subdivisions > 24)) {
    throw new Error('Patch subdivisions must be an integer from 1 to 24');
  }
  for (const { patch } of patches) {
    if (operation.texture !== undefined) patch.texture = operation.texture;
    if (operation.textureMode === 'fit') fitPatchUV(patch);
    else if (operation.textureMode === 'natural') naturalizePatchUV(patch);
    if (operation.shift || operation.scale || operation.rotateDegrees !== undefined) {
      transformPatchUV(patch, operation.shift ?? [0, 0], operation.scale ?? [1, 1], operation.rotateDegrees ?? 0);
    }
    if (operation.subdivisions !== undefined) { patch.subdivisions = operation.subdivisions; tessellatePatch(patch); }
    validateGeneratedPatch(patch);
  }
}

function applyThickenPatches(operation: ThickenPatchOperation, patches: Array<{ entity: Entity; patch: Patch }>): ObjectHandle[] {
  if (!Number.isFinite(operation.amount) || operation.amount <= 0) throw new Error('thicken_patch amount must be positive');
  const handles: ObjectHandle[] = [];
  for (const { entity, patch } of patches) {
    const index = entity.patches.indexOf(patch);
    if (index < 0) throw new Error('A patch was replaced earlier in this batch');
    const replacements = thickenPatch(patch, operation.amount, operation.caps ?? true);
    replacements.forEach(replacement => { replacement.editorGroupId = patch.editorGroupId; validateGeneratedPatch(replacement); });
    entity.patches.splice(index, 1, ...replacements);
    handles.push(...replacements.map(replacement => ({ kind: 'patch' as const, entity, patch: replacement })));
  }
  return handles;
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

function addPrefab(editor: Editor, entity: Entity, operation: CreatePrefabOperation): ObjectHandle[] {
  assertBounds(operation.mins, operation.maxs);
  if (!operation.texture.trim()) throw new Error('texture must not be empty');
  const size = operation.maxs.map((value, axis) => value - operation.mins[axis]);
  const classification = operation.classification ?? 'detail';
  const materials = {
    primary: operation.textures?.primary ?? operation.texture,
    accent: operation.textures?.accent ?? operation.textures?.primary ?? operation.texture,
    focal: operation.textures?.focal ?? operation.textures?.primary ?? operation.texture,
    sides: operation.textures?.sides ?? operation.textures?.accent ?? operation.textures?.primary ?? operation.texture,
    bottom: operation.textures?.bottom ?? 'common/caulk',
  };
  const handles: ObjectHandle[] = [];
  const addRoleBox = (mins: Vec3, maxs: Vec3, role: 'primary' | 'accent') => {
    const brush = addBox(entity, mins, maxs, materials[role]);
    applyBrushTextureTransform(
      editor, brush,
      mergedTextureTransform(operation.textureTransform, operation.textureTransforms?.[role]),
    );
    classifyBrush(brush, classification);
    handles.push({ kind: 'brush', entity, brush });
  };

  if (operation.prefab === 'pillar') {
    if (Math.min(size[0], size[1]) < 16 || size[2] < 32) throw new Error('pillar bounds must be at least 16 × 16 × 32 units');
    const capHeight = Math.max(4, Math.round(size[2] * 0.15));
    const inset = Math.max(2, Math.round(Math.min(size[0], size[1]) * 0.125));
    addRoleBox(operation.mins, [operation.maxs[0], operation.maxs[1], operation.mins[2] + capHeight], 'accent');
    addRoleBox(
      [operation.mins[0] + inset, operation.mins[1] + inset, operation.mins[2] + capHeight],
      [operation.maxs[0] - inset, operation.maxs[1] - inset, operation.maxs[2] - capHeight],
      'primary',
    );
    addRoleBox([operation.mins[0], operation.mins[1], operation.maxs[2] - capHeight], operation.maxs, 'accent');
  } else if (operation.prefab === 'door_frame') {
    const widthAxis = operation.orientation === 'y' ? 1 : 0;
    const depthAxis = widthAxis === 0 ? 1 : 0;
    if (size[widthAxis] < 48 || size[2] < 48 || size[depthAxis] < 4) {
      throw new Error('door_frame bounds must be at least 48 units wide, 48 units high, and 4 units deep');
    }
    const postWidth = Math.max(4, Math.round(size[widthAxis] * 0.15));
    const lintelHeight = Math.max(4, Math.round(size[2] * 0.2));
    const firstMins = [...operation.mins] as Vec3; const firstMaxs = [...operation.maxs] as Vec3;
    firstMaxs[widthAxis] = operation.mins[widthAxis] + postWidth; firstMaxs[2] -= lintelHeight;
    const secondMins = [...operation.mins] as Vec3; const secondMaxs = [...operation.maxs] as Vec3;
    secondMins[widthAxis] = operation.maxs[widthAxis] - postWidth; secondMaxs[2] -= lintelHeight;
    const lintelMins = [...operation.mins] as Vec3; lintelMins[2] = operation.maxs[2] - lintelHeight;
    addRoleBox(firstMins, firstMaxs, 'primary');
    addRoleBox(secondMins, secondMaxs, 'primary');
    addRoleBox(lintelMins, operation.maxs, 'accent');
  } else {
    if (Math.min(size[0], size[1]) < 32 || size[2] < 4) throw new Error('jump_pad_base bounds must be at least 32 × 32 × 4 units');
    const brush = createBrushPrimitive('cylinder', operation.mins, operation.maxs, operation.texture, 2, 16);
    const focalTransform = mergedTextureTransform(
      mergedTextureTransform(operation.textureTransform, { fit: true }),
      operation.textureTransforms?.focal,
    );
    applyCapSideTextures(editor, brush, 2, {
      top: materials.focal, bottom: materials.bottom, sides: materials.sides,
    }, operation.textureTransform, {
      top: focalTransform, bottom: operation.textureTransforms?.bottom, sides: operation.textureTransforms?.sides,
    }, operation.texture);
    classifyBrush(brush, classification);
    entity.brushes.push(brush);
    handles.push({ kind: 'brush', entity, brush });
  }
  return handles;
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

function spatialGroupId(kind: 'area' | 'connection', id: string): string {
  return `spatial-${kind}-${id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`.slice(0, 128);
}

function areaBounds(operation: CreateAreaOperation): { mins: Vec3; maxs: Vec3 } {
  if (operation.bounds) {
    assertBounds(operation.bounds.mins, operation.bounds.maxs);
    return { mins: [...operation.bounds.mins] as Vec3, maxs: [...operation.bounds.maxs] as Vec3 };
  }
  if (operation.footprint && operation.footprint.length >= 3) {
    operation.footprint.forEach((point, index) => assertVector(`footprint point ${index + 1}`, point));
    return {
      mins: [
        Math.min(...operation.footprint.map(point => point[0])),
        Math.min(...operation.footprint.map(point => point[1])),
        operation.center[2],
      ],
      maxs: [
        Math.max(...operation.footprint.map(point => point[0])),
        Math.max(...operation.footprint.map(point => point[1])),
        operation.center[2] + operation.height,
      ],
    };
  }
  if (!Number.isFinite(operation.radius) || (operation.radius ?? 0) <= 0) {
    throw new Error('create_area requires bounds, a footprint with at least three points, or a positive radius');
  }
  const radius = operation.radius!;
  return {
    mins: [operation.center[0] - radius, operation.center[1] - radius, operation.center[2]],
    maxs: [operation.center[0] + radius, operation.center[1] + radius, operation.center[2] + operation.height],
  };
}

function applyCreateArea(editor: Editor, operation: CreateAreaOperation, aliases: SymbolicReferences): ObjectHandle[] {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(operation.id)) throw new Error('create_area id must be a stable identifier');
  if (!operation.purpose.trim()) throw new Error('create_area purpose must not be empty');
  assertVector('center', operation.center);
  if (!Number.isFinite(operation.height) || operation.height <= 0) throw new Error('create_area height must be positive');
  const bounds = areaBounds(operation);
  const levels = [...new Set(operation.levels?.length ? operation.levels : [bounds.mins[2]])].sort((a, b) => a - b);
  if (!levels.every(Number.isFinite)) throw new Error('create_area levels must contain finite absolute world Z values');
  for (const opening of operation.openings ?? []) {
    if (!Number.isFinite(opening.width) || opening.width <= 0) throw new Error('create_area opening widths must be positive');
  }

  const handles: ObjectHandle[] = [];
  const texture = operation.texture ?? 'common/caulk';
  if ((operation.geometry ?? 'none') === 'room') {
    if (operation.shape !== 'rectangular') throw new Error('room geometry currently requires a rectangular semantic area; use floor or none for other shapes');
    handles.push(...applyCreateRoom(editor, {
      type: 'create_room', mins: bounds.mins, maxs: bounds.maxs,
      wallThickness: operation.wallThickness, textures: { walls: texture, floor: texture, ceiling: texture },
    }, aliases));
  } else if (operation.geometry === 'floor') {
    const thickness = operation.wallThickness ?? 16;
    if (!Number.isFinite(thickness) || thickness <= 0) throw new Error('create_area floor thickness must be positive');
    for (const level of levels) {
      const mins: Vec3 = [bounds.mins[0], bounds.mins[1], level - thickness];
      const maxs: Vec3 = [bounds.maxs[0], bounds.maxs[1], level];
      const brush = ['octagonal', 'radial', 'curved'].includes(operation.shape)
        ? createBrushPrimitive('cylinder', mins, maxs, texture, 2, operation.shape === 'octagonal' ? 8 : 16)
        : createBoxBrush(mins, maxs, texture);
      editor.worldspawn.brushes.push(brush);
      handles.push({ kind: 'brush', entity: editor.worldspawn, brush });
    }
  }

  let groupId: string | undefined;
  if (handles.length > 0) {
    groupId = ensureGroup(editor, operation.group ?? `Area: ${operation.id}`, operation.groupId ?? spatialGroupId('area', operation.id));
    for (const handle of handles) setResolvedGroup(resolveHandle(editor, handle), groupId);
  }
  const current = readSpatialPlan(editor.worldspawn.properties);
  editor.worldspawn.properties[SPATIAL_PLAN_KEY] = serializeSpatialPlan(upsertSpatialArea(current, {
    id: operation.id,
    purpose: operation.purpose.trim(),
    shape: operation.shape,
    center: [...operation.center] as Vec3,
    bounds,
    radius: operation.radius,
    height: operation.height,
    levels,
    footprint: operation.footprint?.map(point => [...point] as Vec3),
    openings: operation.openings?.map(opening => ({ ...opening })) ?? [],
    landmarkIntent: operation.landmarkIntent?.trim() || undefined,
    groupId,
  }));
  return handles;
}

function orientBrushBetween(editor: Editor, brush: Brush, start: Vec3, end: Vec3, bankDegrees = 0): void {
  const delta = end.map((value, axis) => value - start[axis]) as Vec3;
  const horizontalLength = Math.hypot(delta[0], delta[1]);
  if (bankDegrees) rotateEditorBrush(editor, brush, [0, 0, 0], 0, bankDegrees * Math.PI / 180);
  rotateEditorBrush(editor, brush, [0, 0, 0], 1, -Math.atan2(delta[2], Math.max(0.0001, horizontalLength)));
  rotateEditorBrush(editor, brush, [0, 0, 0], 2, Math.atan2(delta[1], delta[0]));
  translateEditorBrush(editor, brush, start.map((value, axis) => (value + end[axis]) / 2) as Vec3);
}

function createBoxBetween(editor: Editor, start: Vec3, end: Vec3, width: number, height: number, texture: string, bankDegrees = 0): Brush {
  const length = Math.hypot(...end.map((value, axis) => value - start[axis]));
  if (length < 0.001) throw new Error('Path segment endpoints must be distinct');
  const brush = createBoxBrush([-length / 2, -width / 2, -height / 2], [length / 2, width / 2, height / 2], texture);
  orientBrushBetween(editor, brush, start, end, bankDegrees);
  return brush;
}

function createCylinderBetween(editor: Editor, start: Vec3, end: Vec3, diameter: number, sides: number, texture: string, bankDegrees = 0): Brush {
  const length = Math.hypot(...end.map((value, axis) => value - start[axis]));
  if (length < 0.001) throw new Error('Path segment endpoints must be distinct');
  const brush = createBrushPrimitive('cylinder', [-length / 2, -diameter / 2, -diameter / 2], [length / 2, diameter / 2, diameter / 2], texture, 0, sides);
  orientBrushBetween(editor, brush, start, end, bankDegrees);
  return brush;
}

function catmullRomPoint(a: Vec3, b: Vec3, c: Vec3, d: Vec3, t: number): Vec3 {
  return [0, 1, 2].map(axis => 0.5 * (
    2 * b[axis] + (-a[axis] + c[axis]) * t +
    (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t * t +
    (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t * t * t
  )) as Vec3;
}

function sampleConstructionPath(points: Vec3[], curve: ConstructionPathCurve, subdivisions: number): Vec3[] {
  if (curve === 'polyline') return points.map(point => [...point] as Vec3);
  const sampled: Vec3[] = [];
  for (let segment = 0; segment < points.length - 1; segment++) {
    const a = points[Math.max(0, segment - 1)];
    const b = points[segment];
    const c = points[segment + 1];
    const d = points[Math.min(points.length - 1, segment + 2)];
    for (let step = 0; step < subdivisions; step++) sampled.push(catmullRomPoint(a, b, c, d, step / subdivisions));
  }
  sampled.push([...points[points.length - 1]] as Vec3);
  return sampled;
}

function resampleBySpacing(points: Vec3[], spacing: number | ((index: number) => number)): Vec3[] {
  const result: Vec3[] = [[...points[0]] as Vec3];
  let carry = 0;
  for (let index = 0; index < points.length - 1; index++) {
    let start = [...points[index]] as Vec3;
    const end = points[index + 1];
    let remaining = Math.hypot(...end.map((value, axis) => value - start[axis]));
    let nextSpacing = typeof spacing === 'number' ? spacing : spacing(result.length - 1);
    while (remaining + carry >= nextSpacing && remaining > 0.0001) {
      const distance = nextSpacing - carry;
      const t = distance / remaining;
      start = start.map((value, axis) => value + (end[axis] - value) * t) as Vec3;
      result.push([...start] as Vec3);
      remaining = Math.hypot(...end.map((value, axis) => value - start[axis]));
      carry = 0;
      nextSpacing = typeof spacing === 'number' ? spacing : spacing(result.length - 1);
    }
    carry += remaining;
  }
  const last = points[points.length - 1];
  if (Math.hypot(...last.map((value, axis) => value - result[result.length - 1][axis])) > 0.001) result.push([...last] as Vec3);
  return result;
}

function pathVariationNoise(seed: number, index: number, channel: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9E3779B1) ^ Math.imul(channel + 1, 0x85EBCA77)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x7FEB352D);
  value = Math.imul(value ^ value >>> 15, 0x846CA68B);
  return ((value ^ value >>> 16) >>> 0) / 2147483648 - 1;
}

function variedPathValue(base: number, bound: number | undefined, seed: number, index: number, channel: number, grid = 1): number {
  if (!bound) return base;
  return Math.round((base + pathVariationNoise(seed, index, channel) * bound) / grid) * grid;
}

export interface ConstructionPathEstimate {
  curve: ConstructionPathCurve;
  kind: ConstructionPathKind;
  controlPointCount: number;
  sampledPointCount: number;
  segmentCount: number;
  distributedPointCount: number | null;
  estimatedBrushCount: number;
  approximateLength: number;
  exceedsObjectLimit: boolean;
}

export function estimateConstructionPath(operation: CreatePathOperation): ConstructionPathEstimate {
  const curve = operation.curve ?? 'polyline';
  const subdivisions = operation.subdivisions ?? 6;
  const spacing = operation.spacing ?? (operation.kind === 'stairs' ? 16 : 96);
  if (operation.points.length < 2 || operation.points.length > 64) throw new Error('Path estimate requires 2 to 64 control points');
  if (!Number.isInteger(subdivisions) || subdivisions < 1 || subdivisions > 16) throw new Error('Path estimate subdivisions must be an integer from 1 to 16');
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error('Path estimate spacing must be positive');
  if ((operation.variation?.spacing ?? 0) >= spacing) throw new Error('Path estimate spacing variation must be smaller than base spacing');
  const seed = operation.variation?.seed ?? 1;
  const variationGrid = operation.variation?.grid ?? 1;
  const spacingAt = (index: number) => variedPathValue(
    spacing,
    operation.variation?.spacing,
    seed,
    index,
    2,
    variationGrid,
  );
  const sampled = sampleConstructionPath(operation.points, curve, subdivisions);
  const segmentCount = Math.max(0, sampled.length - 1);
  const approximateLength = sampled.slice(0, -1).reduce((sum, point, index) => (
    sum + Math.hypot(...sampled[index + 1].map((value, axis) => value - point[axis]))
  ), 0);
  const distributed = ['stairs', 'supports', 'railing'].includes(operation.kind)
    ? resampleBySpacing(sampled, spacingAt)
    : null;
  let estimatedBrushCount = segmentCount;
  if (operation.kind === 'stairs') estimatedBrushCount = Math.max(0, (distributed?.length ?? 1) - 1);
  else if (operation.kind === 'supports') estimatedBrushCount = distributed?.length ?? 0;
  else if (operation.kind === 'railing') estimatedBrushCount += distributed?.length ?? 0;
  if (['corridor', 'wall', 'beam', 'trim'].includes(operation.kind) && sampled.length > 2) {
    estimatedBrushCount += sampled.length - 2;
  }
  return {
    curve,
    kind: operation.kind,
    controlPointCount: operation.points.length,
    sampledPointCount: sampled.length,
    segmentCount,
    distributedPointCount: distributed?.length ?? null,
    estimatedBrushCount,
    approximateLength: Number(approximateLength.toFixed(3)),
    exceedsObjectLimit: estimatedBrushCount > 256,
  };
}

function applyCreatePath(editor: Editor, operation: CreatePathOperation, aliases: SymbolicReferences): ObjectHandle[] {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(operation.id)) throw new Error('create_path id must be a stable identifier');
  if (operation.points.length < 2 || operation.points.length > 64) throw new Error('create_path points must contain 2 to 64 control points');
  operation.points.forEach((point, index) => assertVector(`path point ${index + 1}`, point));
  if (!Number.isFinite(operation.width) || operation.width <= 0) throw new Error('create_path width must be positive');
  const thickness = operation.thickness ?? 16;
  const height = operation.height ?? (operation.kind === 'wall' ? 192 : operation.kind === 'railing' ? 48 : thickness);
  const spacing = operation.spacing ?? (operation.kind === 'stairs' ? 16 : 96);
  const subdivisions = operation.subdivisions ?? 6;
  const sides = operation.sides ?? 8;
  const bankDegrees = operation.bankDegrees ?? 0;
  if (![thickness, height, spacing].every(value => Number.isFinite(value) && value > 0)) throw new Error('create_path thickness, height, and spacing must be positive');
  if (!Number.isInteger(subdivisions) || subdivisions < 1 || subdivisions > 16) throw new Error('create_path subdivisions must be an integer from 1 to 16');
  if (!Number.isInteger(sides) || sides < 3 || sides > 32) throw new Error('create_path sides must be an integer from 3 to 32');
  if (!Number.isFinite(bankDegrees) || Math.abs(bankDegrees) > 180) throw new Error('create_path bankDegrees must be between -180 and 180');
  const variation = operation.variation;
  if (variation) {
    if (!Number.isInteger(variation.seed)) throw new Error('create_path variation.seed must be an integer');
    const bounds = [variation.width, variation.height, variation.spacing, variation.bankDegrees].filter((value): value is number => value !== undefined);
    if (bounds.some(value => !Number.isFinite(value) || value < 0)) throw new Error('create_path variation bounds must be non-negative finite numbers');
    if (variation.grid !== undefined && (!Number.isFinite(variation.grid) || variation.grid <= 0)) throw new Error('create_path variation.grid must be positive');
    if ((variation.width ?? 0) >= operation.width || (variation.height ?? 0) >= height || (variation.spacing ?? 0) >= spacing) {
      throw new Error('create_path variation bounds must be smaller than their base width, height, and spacing');
    }
  }
  const seed = variation?.seed ?? 1;
  const variationGrid = variation?.grid ?? 1;
  const widthAt = (index: number) => variedPathValue(operation.width, variation?.width, seed, index, 0, variationGrid);
  const heightAt = (index: number) => variedPathValue(height, variation?.height, seed, index, 1, variationGrid);
  const spacingAt = (index: number) => variedPathValue(spacing, variation?.spacing, seed, index, 2, variationGrid);
  const bankAt = (index: number) => variedPathValue(bankDegrees, variation?.bankDegrees, seed, index, 3, 0.1);
  const curve = operation.curve ?? 'polyline';
  const sampled = sampleConstructionPath(operation.points, curve, subdivisions);
  const texture = operation.texture ?? 'common/caulk';
  const { entity } = resolveEntity(editor, operation.parent, aliases);
  const brushes: Brush[] = [];
  const add = (brush: Brush) => { classifyBrush(brush, operation.classification ?? (['wall', 'corridor', 'stairs'].includes(operation.kind) ? 'structural' : 'detail')); entity.brushes.push(brush); brushes.push(brush); };

  if (operation.kind === 'stairs') {
    const steps = resampleBySpacing(sampled, spacingAt);
    const baseZ = Math.min(...steps.map(point => point[2])) - thickness;
    for (let index = 0; index < steps.length - 1; index++) {
      const top = steps[index][2];
      const start: Vec3 = [steps[index][0], steps[index][1], (baseZ + top) / 2];
      const end: Vec3 = [steps[index + 1][0], steps[index + 1][1], (baseZ + top) / 2];
      add(createBoxBetween(editor, start, end, widthAt(index), top - baseZ, texture, bankAt(index)));
    }
  } else if (operation.kind === 'supports') {
    for (const [index, point] of resampleBySpacing(sampled, spacingAt).entries()) {
      const supportWidth = widthAt(index); const supportHeight = heightAt(index);
      add(createBoxBrush(
        [point[0] - supportWidth / 2, point[1] - supportWidth / 2, point[2] - supportHeight],
        [point[0] + supportWidth / 2, point[1] + supportWidth / 2, point[2]], texture,
      ));
    }
  } else {
    for (let index = 0; index < sampled.length - 1; index++) {
      let start = sampled[index]; let end = sampled[index + 1];
      const segmentWidth = widthAt(index); const segmentHeight = heightAt(index); const segmentBank = bankAt(index);
      if (operation.kind === 'wall') {
        start = [start[0], start[1], start[2] + segmentHeight / 2];
        end = [end[0], end[1], end[2] + segmentHeight / 2];
      } else if (operation.kind === 'railing') {
        start = [start[0], start[1], start[2] + segmentHeight];
        end = [end[0], end[1], end[2] + segmentHeight];
      }
      if (operation.kind === 'pipe') add(createCylinderBetween(editor, start, end, segmentWidth, sides, texture, segmentBank));
      else add(createBoxBetween(
        editor, start, end,
        operation.kind === 'wall' ? segmentWidth : operation.kind === 'railing' ? thickness : segmentWidth,
        operation.kind === 'wall' ? segmentHeight : operation.kind === 'railing' ? thickness : segmentHeight,
        texture, segmentBank,
      ));
    }
    if (operation.kind === 'railing') for (const [index, point] of resampleBySpacing(sampled, spacingAt).entries()) {
      const postHeight = heightAt(index);
      add(createBoxBrush(
        [point[0] - thickness / 2, point[1] - thickness / 2, point[2]],
        [point[0] + thickness / 2, point[1] + thickness / 2, point[2] + postHeight], texture,
      ));
    }
  }

  if (['corridor', 'wall', 'beam', 'trim'].includes(operation.kind) && sampled.length > 2) {
    for (const [jointIndex, point] of sampled.slice(1, -1).entries()) {
      const jointWidth = widthAt(jointIndex); const variedHeight = heightAt(jointIndex);
      const jointHeight = operation.kind === 'wall' ? variedHeight : operation.kind === 'corridor' ? thickness : variedHeight;
      const centerZ = operation.kind === 'wall' ? point[2] + variedHeight / 2 : point[2];
      const joint = operation.join === 'bevel'
        ? createBrushPrimitive('cylinder', [point[0] - jointWidth / 2, point[1] - jointWidth / 2, centerZ - jointHeight / 2], [point[0] + jointWidth / 2, point[1] + jointWidth / 2, centerZ + jointHeight / 2], texture, 2, 4)
        : createBoxBrush([point[0] - jointWidth / 2, point[1] - jointWidth / 2, centerZ - jointHeight / 2], [point[0] + jointWidth / 2, point[1] + jointWidth / 2, centerZ + jointHeight / 2], texture);
      add(joint);
    }
  }

  if (brushes.length === 0 || brushes.length > 256) throw new Error(`create_path generated ${brushes.length} objects; adjust spacing/subdivisions to produce 1 through 256`);
  const handles = brushes.map(brush => ({ kind: 'brush' as const, entity, brush }));
  const groupId = ensureGroup(
    editor,
    operation.group ?? `Path: ${operation.id}`,
    operation.groupId ?? spatialGroupId('connection', operation.connectionId ?? `path-${operation.id}`),
  );
  for (const handle of handles) setResolvedGroup(resolveHandle(editor, handle), groupId);
  const bounds = {
    mins: [0, 1, 2].map(axis => Math.min(...brushes.map(brush => brush.mins[axis]))) as Vec3,
    maxs: [0, 1, 2].map(axis => Math.max(...brushes.map(brush => brush.maxs[axis]))) as Vec3,
  };
  const document = readConstructionPaths(editor.worldspawn.properties);
  editor.worldspawn.properties[CONSTRUCTION_PATHS_KEY] = serializeConstructionPaths(upsertConstructionPath(document, {
    id: operation.id, kind: operation.kind, curve, controlPoints: operation.points.map(point => [...point] as Vec3),
    sampledPointCount: sampled.length, width: operation.width, height: operation.height, thickness, spacing: operation.spacing,
    subdivisions, sides: operation.kind === 'pipe' ? sides : undefined, join: operation.join ?? 'overlap',
    capEnds: operation.capEnds ?? true, bankDegrees, texture, classification: operation.classification ?? (['wall', 'corridor', 'stairs'].includes(operation.kind) ? 'structural' : 'detail'),
    groupId, objectCount: handles.length, replacedObjectCount: operation.replaceTargets?.length, variation: operation.variation, bounds,
  }));
  return handles;
}

function applyConnectAreas(editor: Editor, operation: ConnectAreasOperation): ObjectHandle[] {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(operation.id)) throw new Error('connect_areas id must be a stable identifier');
  if (!Number.isFinite(operation.width) || operation.width <= 0) throw new Error('connect_areas width must be positive');
  const current = readSpatialPlan(editor.worldspawn.properties);
  const from = current.areas.find(area => area.id === operation.fromArea);
  const to = current.areas.find(area => area.id === operation.toArea);
  if (!from || !to) throw new Error(`connect_areas requires existing areas; missing ${[!from && operation.fromArea, !to && operation.toArea].filter(Boolean).join(', ')}`);
  if (from.id === to.id) throw new Error('connect_areas cannot connect an area to itself');

  const handles: ObjectHandle[] = [];
  if (operation.geometry === 'floor') {
    const thickness = operation.thickness ?? 16;
    if (!Number.isFinite(thickness) || thickness <= 0) throw new Error('connect_areas thickness must be positive');
    const start = [...from.center] as Vec3;
    const end = [...to.center] as Vec3;
    if (operation.verticalChange !== undefined) end[2] = start[2] + operation.verticalChange;
    const brush = createBoxBetween(editor, start, end, operation.width, thickness, operation.texture ?? 'common/caulk');
    editor.worldspawn.brushes.push(brush);
    handles.push({ kind: 'brush', entity: editor.worldspawn, brush });
  }

  let groupId: string | undefined;
  if (handles.length > 0) {
    groupId = ensureGroup(editor, operation.group ?? `Connection: ${operation.id}`, operation.groupId ?? spatialGroupId('connection', operation.id));
    for (const handle of handles) setResolvedGroup(resolveHandle(editor, handle), groupId);
  }
  editor.worldspawn.properties[SPATIAL_PLAN_KEY] = serializeSpatialPlan(upsertSpatialConnection(current, {
    id: operation.id,
    fromArea: operation.fromArea,
    toArea: operation.toArea,
    routeType: operation.routeType,
    width: operation.width,
    verticalChange: operation.verticalChange,
    curvature: operation.curvature,
    cover: operation.cover,
    visibility: operation.visibility,
    traversalIntent: operation.traversalIntent?.trim() || undefined,
    groupId,
  }));
  return handles;
}

function representativeBrush(targets: Array<ResolvedObject & { kind: 'brush' }>, role: 'floor' | 'ceiling' | 'wall'): Brush {
  const zSize = (brush: Brush) => brush.maxs[2] - brush.mins[2];
  if (role === 'floor') return [...targets].sort((a, b) => a.brush.maxs[2] - b.brush.maxs[2])[0].brush;
  if (role === 'ceiling') return [...targets].sort((a, b) => b.brush.mins[2] - a.brush.mins[2])[0].brush;
  return [...targets].sort((a, b) => zSize(b.brush) - zSize(a.brush))[0].brush;
}

function applyReshapeRoom(
  editor: Editor,
  operation: ReshapeRoomOperation,
  targets: Array<ResolvedObject & { kind: 'brush' }>,
): ObjectHandle[] {
  if (targets.length < 6) throw new Error('reshape_room requires the complete room shell (at least six brushes)');
  const entity = targets[0].entity;
  if (targets.some(target => target.entity !== entity)) throw new Error('reshape_room targets must belong to one entity');
  const unique = [...new Set(targets.map(target => target.brush))];
  if (unique.length !== targets.length) throw new Error('reshape_room targets must be unique');
  const mins = [0, 1, 2].map(axis => Math.min(...targets.map(target => target.brush.mins[axis]))) as Vec3;
  const maxs = [0, 1, 2].map(axis => Math.max(...targets.map(target => target.brush.maxs[axis]))) as Vec3;
  const inferredThickness = Math.min(...targets.flatMap(target => [0, 1, 2]
    .map(axis => target.brush.maxs[axis] - target.brush.mins[axis]).filter(size => size > 0.1)));
  const thickness = operation.wallThickness ?? inferredThickness;
  if (!Number.isFinite(thickness) || thickness <= 0 || thickness * 2 >= Math.min(maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2])) {
    throw new Error('reshape_room wallThickness must be positive and smaller than half the room dimensions');
  }
  const center: Vec3 = [(mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, (mins[2] + maxs[2]) / 2];
  const angleOffset = (operation.rotationDegrees ?? 22.5) * Math.PI / 180;
  if (!Number.isFinite(angleOffset)) throw new Error('reshape_room rotationDegrees must be finite');
  const radiusX = (maxs[0] - mins[0] - thickness) / 2;
  const radiusY = (maxs[1] - mins[1] - thickness) / 2;
  const ring = Array.from({ length: 8 }, (_, index): Vec3 => {
    const angle = angleOffset + index * Math.PI / 4;
    return [center[0] + Math.cos(angle) * radiusX, center[1] + Math.sin(angle) * radiusY, center[2]];
  });
  const floorSource = representativeBrush(targets, 'floor');
  const ceilingSource = representativeBrush(targets, 'ceiling');
  const wallSource = representativeBrush(targets, 'wall');
  const replacement: Brush[] = [];
  const floor = createBrushPrimitive('cylinder', [mins[0], mins[1], mins[2]], [maxs[0], maxs[1], mins[2] + thickness], floorSource.faces[0].texture, 2, 8);
  const ceiling = createBrushPrimitive('cylinder', [mins[0], mins[1], maxs[2] - thickness], [maxs[0], maxs[1], maxs[2]], ceilingSource.faces[0].texture, 2, 8);
  rotateEditorBrush(editor, floor, center, 2, angleOffset);
  rotateEditorBrush(editor, ceiling, center, 2, angleOffset);
  replacement.push(floor, ceiling);
  for (let index = 0; index < ring.length; index++) {
    const start = [...ring[index]] as Vec3; const end = [...ring[(index + 1) % ring.length]] as Vec3;
    start[2] = center[2]; end[2] = center[2];
    replacement.push(createBoxBetween(editor, start, end, thickness, maxs[2] - mins[2] - thickness * 2, wallSource.faces[0].texture));
  }
  for (const brush of replacement) {
    const roleSource = brush === floor ? floorSource : brush === ceiling ? ceilingSource : wallSource;
    for (const face of brush.faces) {
      applyFaceStyle(face, closestStyledFace(roleSource, face.plane.normal));
      if (operation.textureMode === 'fit') fitFaceTexture(editor, face);
    }
    brush.editorGroupId = targets[0].brush.editorGroupId;
    brush.properties = targets[0].brush.properties ? { ...targets[0].brush.properties } : undefined;
    const validation = validateBrush(brush);
    if (!validation.valid) throw new Error(`reshape_room produced invalid geometry: ${validation.issues.join('; ')}`);
  }
  const indices = targets.map(target => entity.brushes.indexOf(target.brush));
  if (indices.some(index => index < 0)) throw new Error('A reshape_room target was replaced earlier in this batch');
  const insertion = Math.min(...indices);
  [...indices].sort((a, b) => b - a).forEach(index => entity.brushes.splice(index, 1));
  entity.brushes.splice(insertion, 0, ...replacement);
  return replacement.map(brush => ({ kind: 'brush' as const, entity, brush }));
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

function applyFaceStyle(target: BrushFace, source: BrushFace, texture?: string): void {
  target.texture = texture ?? source.texture;
  target.textureProjection = cloneTextureProjection(source.textureProjection);
  target.contentFlags = source.contentFlags;
  target.surfaceFlags = source.surfaceFlags;
  target.value = source.value;
}

function closestStyledFace(brush: Brush, normal: Vec3): BrushFace {
  return brush.faces.reduce((best, face) =>
    vec3Dot(face.plane.normal, normal) > vec3Dot(best.plane.normal, normal) ? face : best,
  brush.faces[0]);
}

function applyOffsetFaces(editor: Editor, operation: OffsetFacesOperation, faces: ResolvedFace[]): void {
  if (!Number.isFinite(operation.distance) || Math.abs(operation.distance) < 0.001) throw new Error('offset_faces distance must be a non-zero finite number');
  const byBrush = new Map<Brush, BrushFace[]>();
  for (const resolved of faces) {
    const list = byBrush.get(resolved.brush) ?? [];
    list.push(resolved.face);
    byBrush.set(resolved.brush, list);
  }
  for (const [brush, selected] of byBrush) {
    for (const face of selected) {
      const delta = face.plane.normal.map(value => value * operation.distance) as Vec3;
      face.points = face.points.map(point => point.map((value, axis) => value + delta[axis]) as Vec3) as [Vec3, Vec3, Vec3];
    }
    computeBrushGeometry(brush);
    const validation = validateBrush(brush);
    if (!validation.valid) throw new Error(`offset_faces produced an invalid brush: ${validation.issues.join('; ')}`);
    if (operation.textureMode === 'fit') selected.forEach(face => fitFaceTexture(editor, face));
  }
}

function transverseAxes(axis: number): [number, number] {
  return axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
}

function applyChamferBrushes(
  editor: Editor,
  operation: ChamferBrushesOperation,
  targets: Array<ResolvedObject & { kind: 'brush' }>,
): ObjectHandle[] {
  if (!Number.isFinite(operation.amount) || operation.amount <= 0) throw new Error('chamfer_brushes amount must be positive');
  const axis = axisIndex(operation.axis ?? 'z');
  const [u, v] = transverseAxes(axis);
  const requested = operation.corners ?? ['min-min', 'min-max', 'max-min', 'max-max'];
  if (requested.length === 0) throw new Error('chamfer_brushes corners must not be empty');
  const corners = [...new Set(requested)];
  const handles: ObjectHandle[] = [];
  for (const target of targets) {
    const sizeU = target.brush.maxs[u] - target.brush.mins[u];
    const sizeV = target.brush.maxs[v] - target.brush.mins[v];
    if (operation.amount * 2 >= Math.min(sizeU, sizeV)) throw new Error(`chamfer amount is too large for ${target.ref}`);
    let current = target.brush;
    for (const corner of corners) {
      const [uSide, vSide] = corner.split('-') as ['min' | 'max', 'min' | 'max'];
      const signU = uSide === 'min' ? -1 : 1;
      const signV = vSide === 'min' ? -1 : 1;
      const normal: Vec3 = [0, 0, 0];
      normal[u] = signU / Math.SQRT2; normal[v] = signV / Math.SQRT2;
      const cornerPoint: Vec3 = [0, 0, 0];
      cornerPoint[u] = signU < 0 ? current.mins[u] : current.maxs[u];
      cornerPoint[v] = signV < 0 ? current.mins[v] : current.maxs[v];
      cornerPoint[axis] = (current.mins[axis] + current.maxs[axis]) / 2;
      const dist = vec3Dot(normal, cornerPoint) - operation.amount / Math.SQRT2;
      const center = normal.map(value => value * dist) as Vec3;
      center[axis] = cornerPoint[axis];
      const tangent: Vec3 = [0, 0, 0];
      tangent[u] = -normal[v]; tangent[v] = normal[u];
      const extent = Math.max(sizeU, sizeV, current.maxs[axis] - current.mins[axis]) * 2;
      let p1 = center.map((value, dimension) => value - tangent[dimension] * extent) as Vec3;
      let p2 = center.map((value, dimension) => value + tangent[dimension] * extent) as Vec3;
      const p3 = [...center] as Vec3; p3[axis] += extent;
      if (axis === 1) [p1, p2] = [p2, p1];
      const clipped = clipBrush(current, [p1, p2, p3], operation.texture);
      if (!clipped) throw new Error(`Could not chamfer ${corner} on ${target.ref}`);
      const newFace = clipped.faces.reduce((best, face) =>
        vec3Dot(face.plane.normal, normal) > vec3Dot(best.plane.normal, normal) ? face : best,
      clipped.faces[0]);
      applyFaceStyle(newFace, closestStyledFace(target.brush, normal), operation.texture);
      if (operation.textureMode === 'fit') fitFaceTexture(editor, newFace);
      current = clipped;
    }
    handles.push(...replaceBrush(target, [current]));
  }
  return handles;
}

function isAxisAlignedBox(brush: Brush): boolean {
  if (brush.faces.length !== 6) return false;
  const directions = new Set<string>();
  for (const face of brush.faces) {
    const axis = face.plane.normal.findIndex(value => Math.abs(value) > 0.999);
    if (axis < 0 || face.plane.normal.some((value, index) => index !== axis && Math.abs(value) > 0.001)) return false;
    directions.add(`${axis}:${Math.sign(face.plane.normal[axis])}`);
  }
  return directions.size === 6;
}

function remapFromTaperAxis(point: Vec3, axis: number, u: number, v: number): Vec3 {
  const result: Vec3 = [0, 0, 0];
  result[u] = point[0]; result[v] = point[1]; result[axis] = point[2];
  return result;
}

function applyTaperBrushes(
  editor: Editor,
  operation: TaperBrushesOperation,
  targets: Array<ResolvedObject & { kind: 'brush' }>,
): ObjectHandle[] {
  if (!operation.endScale.every(value => Number.isFinite(value) && value > 0 && value <= 4)) throw new Error('taper_brushes endScale values must be positive and at most 4');
  const endOffset = operation.endOffset ?? [0, 0];
  if (!endOffset.every(Number.isFinite)) throw new Error('taper_brushes endOffset values must be finite');
  const axis = axisIndex(operation.axis ?? 'z');
  const [u, v] = transverseAxes(axis);
  const handles: ObjectHandle[] = [];
  for (const target of targets) {
    if (!isAxisAlignedBox(target.brush)) throw new Error(`${target.ref} must be an axis-aligned six-face box before tapering`);
    const mappedMins: Vec3 = [target.brush.mins[u], target.brush.mins[v], target.brush.mins[axis]];
    const mappedMaxs: Vec3 = [target.brush.maxs[u], target.brush.maxs[v], target.brush.maxs[axis]];
    const replacement = createTaperedBrush(mappedMins, mappedMaxs, target.brush.faces[0].texture, operation.endScale, endOffset);
    for (const face of replacement.faces) face.points = face.points.map(point => remapFromTaperAxis(point, axis, u, v)) as [Vec3, Vec3, Vec3];
    computeBrushGeometry(replacement);
    for (const face of replacement.faces) {
      applyFaceStyle(face, closestStyledFace(target.brush, face.plane.normal));
      if (operation.textureMode === 'fit') fitFaceTexture(editor, face);
    }
    replacement.name = target.brush.name;
    replacement.editorGroupId = target.brush.editorGroupId;
    replacement.properties = target.brush.properties ? { ...target.brush.properties } : undefined;
    handles.push(...replaceBrush(target, [replacement]));
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
    // Within one generated batch, the human-facing group name is the stable
    // reuse key. A later operation may derive or suggest another ID for the
    // same name; keep the first group instead of failing halfway through the
    // atomic batch.
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
  if (operation.groupId && !operation.group && !operation.areaId && !operation.connectionId) throw new Error('groupId requires group unless areaId or connectionId supplies semantic grouping');
  if (operation.areaId && operation.connectionId) throw new Error('Creation metadata accepts areaId or connectionId, not both');
  createdHandles.push(...handles);
  registerAlias(aliases, operation.id, handles);
  if (!operation.group && !operation.areaId && !operation.connectionId) return;
  const plan = readSpatialPlan(editor.worldspawn.properties);
  const semanticKind = operation.areaId ? 'area' : operation.connectionId ? 'connection' : null;
  const semanticId = operation.areaId ?? operation.connectionId;
  const semanticArea = operation.areaId ? plan.areas.find(area => area.id === operation.areaId) : undefined;
  const semanticConnection = operation.connectionId ? plan.connections.find(connection => connection.id === operation.connectionId) : undefined;
  const semantic = semanticArea ?? semanticConnection;
  if (semanticId && !semantic) throw new Error(`${semanticKind} ${semanticId} does not exist in the spatial plan`);
  const semanticGroupId = semanticKind && semanticId
    ? operation.groupId ?? semantic?.groupId ?? spatialGroupId(semanticKind, semanticId)
    : operation.groupId;
  const existingGroup = semanticGroupId
    ? listNamedGroups(editor.entities).find(group => group.id === semanticGroupId)
    : undefined;
  const groupName = operation.group ?? existingGroup?.name ?? `${semanticKind === 'area' ? 'Area' : 'Connection'}: ${semanticId}`;
  const groupId = existingGroup?.id ?? ensureGroup(
    editor,
    groupName,
    semanticGroupId,
  );
  for (const handle of groupHandles) setResolvedGroup(resolveHandle(editor, handle), groupId);
  if (semanticArea) {
    editor.worldspawn.properties[SPATIAL_PLAN_KEY] = serializeSpatialPlan(upsertSpatialArea(plan, { ...semanticArea, groupId }));
  } else if (semanticConnection) {
    editor.worldspawn.properties[SPATIAL_PLAN_KEY] = serializeSpatialPlan(upsertSpatialConnection(plan, { ...semanticConnection, groupId }));
  }
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

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function handleCenter(handle: ObjectHandle): Vec3 {
  const bounds = handle.kind === 'brush' ? handle.brush : handle.kind === 'patch' ? handle.patch : null;
  if (!bounds) throw new Error('repeat_variation supports brush and patch targets, not whole entities');
  return bounds.maxs.map((value, axis) => (value + bounds.mins[axis]) / 2) as Vec3;
}

function scaleHandle(handle: ObjectHandle, center: Vec3, scale: Vec3): void {
  if (handle.kind === 'brush') {
    const points = handle.brush.faces.map(face => face.points.map(point => [...point] as Vec3) as [Vec3, Vec3, Vec3]);
    scaleBrushFaces(handle.brush, points, center, scale);
  } else if (handle.kind === 'patch') {
    const controlPoints = handle.patch.ctrl.map(row => row.map(point => ({ xyz: [...point.xyz] as Vec3, uv: [...point.uv] as [number, number] })));
    scalePatchControlPoints(handle.patch, controlPoints, center, scale);
  } else throw new Error('repeat_variation supports brush and patch targets, not whole entities');
}

function translateHandle(editor: Editor, handle: ObjectHandle, delta: Vec3): void {
  if (handle.kind === 'brush') translateEditorBrush(editor, handle.brush, delta);
  else if (handle.kind === 'patch') translatePatch(handle.patch, delta);
  else throw new Error('repeat_variation supports brush and patch targets, not whole entities');
}

function rotateHandle(editor: Editor, handle: ObjectHandle, center: Vec3, axis: number, radians: number): void {
  if (handle.kind === 'brush') rotateEditorBrush(editor, handle.brush, center, axis, radians);
  else if (handle.kind === 'patch') rotatePatch(handle.patch, center, axis, radians);
  else throw new Error('repeat_variation supports brush and patch targets, not whole entities');
}

function mirrorHandle(editor: Editor, handle: ObjectHandle, center: Vec3, axis: number): void {
  if (handle.kind === 'brush') mirrorEditorBrush(editor, handle.brush, center, axis);
  else if (handle.kind === 'patch') mirrorPatch(handle.patch, center, axis);
  else throw new Error('repeat_variation supports brush and patch targets, not whole entities');
}

function applyRepeatVariation(editor: Editor, operation: RepeatVariationOperation, aliases: SymbolicReferences): ObjectHandle[] {
  if (!Number.isInteger(operation.copies) || operation.copies < 1 || operation.copies > 64) throw new Error('repeat_variation copies must be an integer from 1 to 64');
  const distribution = operation.distribution ?? 'linear';
  if (distribution === 'mirror' && operation.copies !== 1) throw new Error('repeat_variation mirror distribution creates exactly one copy');
  if ((distribution === 'radial' || distribution === 'mirror') && !operation.center) throw new Error(`${distribution} distribution requires center`);
  if (operation.center) assertVector('center', operation.center);
  const delta = operation.delta ?? [0, 0, 0]; assertVector('delta', delta);
  operation.stepSequence?.forEach((step, index) => assertVector(`stepSequence ${index + 1}`, step));
  if (operation.stepSequence?.length === 0) throw new Error('stepSequence must not be empty');
  if (operation.rotationSequence?.some(value => !Number.isFinite(value))) throw new Error('rotationSequence must contain finite degrees');
  if (operation.scaleSequence?.some(scale => scale.length !== 3 || scale.some(value => !Number.isFinite(value) || value <= 0 || value > 4))) throw new Error('scaleSequence must contain positive three-axis scales no greater than 4');
  if (operation.materialSequence?.some(item => !item.texture.trim())) throw new Error('materialSequence textures must not be empty');
  if (operation.materialSequence?.length === 0) throw new Error('materialSequence must not be empty');
  const grid = operation.grid ?? 1;
  if (!Number.isFinite(grid) || grid <= 0) throw new Error('repeat_variation grid must be positive');
  const variation = operation.variation;
  if (variation?.position) assertVector('variation.position', variation.position);
  if (variation?.scale) assertVector('variation.scale', variation.scale);
  if (variation?.position?.some(value => value < 0) || variation?.scale?.some(value => value < 0)) throw new Error('variation bounds must be non-negative');
  if (variation?.scale?.some(value => value > 0.95)) throw new Error('variation.scale must stay within the safe 0 through 0.95 fractional range');
  if (variation?.rotationDegrees !== undefined && (!Number.isFinite(variation.rotationDegrees) || variation.rotationDegrees < 0 || variation.rotationDegrees > 180)) throw new Error('variation.rotationDegrees must be between 0 and 180');
  const sources = resolveTargets(editor, operation.targets, aliases);
  if (sources.some(source => source.kind === 'entity')) throw new Error('repeat_variation targets must be brushes or patches');
  const random = seededRandom(operation.seed ?? 1);
  const axis = axisIndex(operation.axis ?? 'z');
  const handles: ObjectHandle[] = [];
  let cumulative: Vec3 = [0, 0, 0];
  for (let copy = 1; copy <= operation.copies; copy++) {
    if (distribution === 'linear') {
      const step = operation.stepSequence?.[(copy - 1) % operation.stepSequence.length] ?? delta;
      cumulative = cumulative.map((value, dimension) => value + step[dimension]) as Vec3;
    }
    for (const source of sources) {
      const handle = cloneResolved(editor, source, [0, 0, 0]);
      if (distribution === 'linear') translateHandle(editor, handle, cumulative);
      else if (distribution === 'radial') {
        const angle = (operation.angleStepDegrees ?? 360 / (operation.copies + 1)) * copy * Math.PI / 180;
        rotateHandle(editor, handle, operation.center!, axis, angle);
      } else mirrorHandle(editor, handle, operation.center!, axis);

      const center = handleCenter(handle);
      const sequenceScale = operation.scaleSequence?.[(copy - 1) % operation.scaleSequence.length] ?? [1, 1, 1];
      const scale = sequenceScale.map((value, dimension) => {
        const bound = variation?.scale?.[dimension] ?? 0;
        return value * (1 + (random() * 2 - 1) * bound);
      }) as Vec3;
      if (scale.some(value => value <= 0.05 || value > 4)) throw new Error('repeat_variation generated scale outside the safe 0.05 through 4 range');
      if (scale.some(value => Math.abs(value - 1) > 1e-6)) scaleHandle(handle, center, scale);

      const sequenceRotation = operation.rotationSequence?.[(copy - 1) % operation.rotationSequence.length] ?? 0;
      const rotation = sequenceRotation + (random() * 2 - 1) * (variation?.rotationDegrees ?? 0);
      if (rotation) rotateHandle(editor, handle, handleCenter(handle), axis, rotation * Math.PI / 180);

      const position = [0, 1, 2].map(dimension => {
        const bound = variation?.position?.[dimension] ?? 0;
        return Math.round(((random() * 2 - 1) * bound) / grid) * grid;
      }) as Vec3;
      if (position.some(Boolean)) translateHandle(editor, handle, position);

      const material = operation.materialSequence?.[(copy - 1) % operation.materialSequence.length];
      if (material) setObjectTexture(resolveHandle(editor, handle), material.texture);
      handles.push(handle);
    }
  }
  return handles;
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
      } else if (operation.type === 'create_tapered') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        const handle: ObjectHandle = { kind: 'brush', entity, brush: addTapered(editor, entity, operation) };
        recordCreated(editor, operation, [handle], createdHandles, aliases);
      } else if (operation.type === 'create_stairs') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        const handles = addStairs(editor, entity, operation);
        recordCreated(editor, operation, handles, createdHandles, aliases);
      } else if (operation.type === 'create_brush') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        const handle: ObjectHandle = { kind: 'brush', entity, brush: addPlaneBrush(editor, entity, operation) };
        recordCreated(editor, operation, [handle], createdHandles, aliases);
      } else if (operation.type === 'create_prefab') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        const handles = addPrefab(editor, entity, operation);
        recordCreated(editor, operation, handles, createdHandles, aliases);
      } else if (operation.type === 'create_patch') {
        const { entity } = resolveEntity(editor, operation.parent, aliases);
        const handle: ObjectHandle = { kind: 'patch', entity, patch: addPatch(editor, entity, operation) };
        recordCreated(editor, operation, [handle], createdHandles, aliases);
      } else if (operation.type === 'create_area') {
        const handles = applyCreateArea(editor, operation, aliases);
        recordCreated(editor, { id: operation.id }, handles, createdHandles, aliases);
        changedHandles.add({ kind: 'entity', entity: editor.worldspawn });
      } else if (operation.type === 'connect_areas') {
        const handles = applyConnectAreas(editor, operation);
        recordCreated(editor, { id: operation.id }, handles, createdHandles, aliases);
        changedHandles.add({ kind: 'entity', entity: editor.worldspawn });
      } else if (operation.type === 'create_path') {
        const replaced = operation.replaceTargets ? resolveTargets(editor, operation.replaceTargets, aliases) : [];
        replaced.forEach(target => deletedRefs.add(target.ref));
        const handles = applyCreatePath(editor, operation, aliases);
        if (replaced.length > 0) applyDeletion(editor, replaced);
        recordCreated(editor, operation, handles, createdHandles, aliases);
        changedHandles.add({ kind: 'entity', entity: editor.worldspawn });
      } else if (operation.type === 'reshape_room') {
        const targets = requireBrushes(resolveTargets(editor, operation.targets, aliases), 'reshape_room');
        targets.forEach(target => deletedRefs.add(target.ref));
        const handles = applyReshapeRoom(editor, operation, targets);
        recordCreated(editor, operation, handles, createdHandles, aliases);
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
      } else if (operation.type === 'repeat_variation') {
        const handles = applyRepeatVariation(editor, operation, aliases);
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
      } else if (operation.type === 'edit_patches') {
        const patches = resolvedPatches(resolveTargets(editor, operation.targets, aliases), 'edit_patches');
        applyEditPatches(operation, patches);
        patches.forEach(({ entity, patch }) => changedHandles.add({ kind: 'patch', entity, patch }));
      } else if (operation.type === 'thicken_patch') {
        const patches = resolvedPatches(resolveTargets(editor, operation.targets, aliases), 'thicken_patch');
        const handles = applyThickenPatches(operation, patches);
        recordCreated(editor, operation, handles, createdHandles, aliases);
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
      } else if (operation.type === 'offset_faces') {
        const faces = resolveFaces(editor, operation.targets, aliases);
        applyOffsetFaces(editor, operation, faces);
        faces.forEach(face => changedFaceRefs.add(face.ref));
      } else if (operation.type === 'chamfer_brushes') {
        const targets = requireBrushes(resolveTargets(editor, operation.targets, aliases), 'chamfer_brushes');
        const handles = applyChamferBrushes(editor, operation, targets);
        createdHandles.push(...handles);
        registerAlias(aliases, operation.id, handles);
      } else if (operation.type === 'taper_brushes') {
        const targets = requireBrushes(resolveTargets(editor, operation.targets, aliases), 'taper_brushes');
        const handles = applyTaperBrushes(editor, operation, targets);
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
