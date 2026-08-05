import {
  cloneBrush,
  cloneTextureProjection,
  mirrorBrush,
  rotateBrush,
  scaleBrushFaces,
  translateBrush,
  type Brush,
  type BrushTextureProjection,
} from './brush';
import { createBrushPrimitive } from './brush-primitives';
import {
  cloneEntity,
  createEntity,
  entityOrigin,
  mirrorEntity,
  rotateEntity,
  setEntityOrigin,
  translateEntity,
  type Entity
} from './entity';
import { vec3Add, vec3Copy, vec3MirrorAxis, vec3RotateAxis, vec3Snap, type Vec3 } from './math';
import { clonePatch, mirrorPatch, PatchControlPoint, rotatePatch, scalePatchControlPoints, translatePatch, type Patch } from './patch';
import { entityBounds } from './editor-queries';
import type { Editor, SelectionItem } from './editor';
import { getSelectedBrushItems, getSelectedPatchItems } from './editor-selection';
import {
  captureBrushPrimitiveVertexTextureState,
  mirrorBrushLocked,
  restoreBrushPrimitiveVertexTextureState,
  rotateBrushLocked,
  scaleBrushLocked,
  translateBrushLocked,
} from './texture-lock';
import { getEntityClassRegistry } from './entity-definitions';
import { cloneTransformDescriptor } from './transform-descriptor';
import { collectBrushVertices, moveVertices } from './vertex';

export interface BrushScaleOriginal {
  brush: Brush;
  origPoints: [Vec3, Vec3, Vec3][];
  textureProjections: BrushTextureProjection[];
}

export interface PatchScaleOriginal {
  patch: Patch;
  origCtrl: PatchControlPoint[][];
}

export interface BrushRotationOriginal {
  brush: Brush;
  points: [Vec3, Vec3, Vec3][];
  planes: { normal: Vec3; dist: number }[];
  polygons: Vec3[][];
  textureProjections: BrushTextureProjection[];
}

export interface PatchRotationOriginal {
  patch: Patch;
  ctrl: PatchControlPoint[][];
}

export interface EntityRotationOriginal {
  entity: Entity;
  origin: Vec3 | null;
  angle?: string;
  angles?: string;
}

function selectedEntitySet(editor: Editor): Set<Entity> {
  return new Set(
    editor.selection
      .filter((item): item is Extract<SelectionItem, { type: 'entity' }> => item.type === 'entity')
      .map(item => item.entity)
  );
}

export function translateEditorBrush(editor: Editor, brush: Brush, delta: Vec3): void {
  if (editor.textureLock) {
    translateBrushLocked(brush, delta);
    return;
  }
  translateBrush(brush, delta);
}

export function rotateEditorBrush(editor: Editor, brush: Brush, center: Vec3, axis: number, angle: number): void {
  if (editor.textureLock) {
    rotateBrushLocked(brush, center, axis, angle);
    return;
  }
  rotateBrush(brush, center, axis, angle);
}

function normalizedAngle(value: number): string {
  const normalized = ((value % 360) + 360) % 360;
  const rounded = Math.abs(normalized - Math.round(normalized)) < 1e-6
    ? Math.round(normalized)
    : Number(normalized.toFixed(6));
  return String(rounded);
}

function rotateMiscModel(entity: Entity, axis: number, angle: number, originalAngle?: string, originalAngles?: string): void {
  if (entity.classname !== 'misc_model') return;
  const hasSnapshot = originalAngle !== undefined || originalAngles !== undefined;
  const vector = (hasSnapshot ? originalAngles : entity.properties.angles)?.trim().split(/\s+/).map(Number);
  const scalar = Number((hasSnapshot ? originalAngle : entity.properties.angle) ?? 0);
  const hasAngles = vector?.length === 3 && vector.every(Number.isFinite);
  const angles = hasAngles
    ? vector
    : [0, Number.isFinite(scalar) ? scalar : 0, 0];
  const component = axis === 0 ? 2 : axis === 1 ? 0 : 1;
  angles[component] = Number(normalizedAngle(angles[component] + angle * 180 / Math.PI));

  // Preserve the classic yaw-only key until a full 3-axis rotation is needed.
  // Q3Map2 gives `angles` precedence, so never leave both representations set.
  if (axis === 2 && !hasAngles) {
    entity.properties.angle = String(angles[1]);
    delete entity.properties.angles;
  } else {
    entity.properties.angles = angles.join(' ');
    delete entity.properties.angle;
  }
}

export function mirrorEditorBrush(editor: Editor, brush: Brush, center: Vec3, axis: number): void {
  if (editor.textureLock) {
    mirrorBrushLocked(brush, center, axis);
    return;
  }
  mirrorBrush(brush, center, axis);
}

function scaleEditorBrush(
  editor: Editor,
  brush: Brush,
  originalPoints: [Vec3, Vec3, Vec3][],
  center: Vec3,
  scale: Vec3,
  originalTextureProjections?: BrushTextureProjection[],
): void {
  if (editor.textureLock) {
    scaleBrushLocked(brush, originalPoints, center, scale, originalTextureProjections);
    return;
  }
  scaleBrushFaces(brush, originalPoints, center, scale);
}

export function translateEditorEntity(editor: Editor, entity: Entity, delta: Vec3): void {
  if (!editor.textureLock) {
    translateEntity(entity, delta);
    return;
  }

  const origin = entityOrigin(entity);
  if (origin) {
    setEntityOrigin(entity, vec3Add(origin, delta));
  }
  for (const brush of entity.brushes) {
    translateEditorBrush(editor, brush, delta);
  }
  for (const patch of entity.patches) {
    translatePatch(patch, delta);
  }
}

export function rotateEditorEntity(editor: Editor, entity: Entity, center: Vec3, axis: number, angle: number): void {
  if (!editor.textureLock) {
    rotateEntity(entity, center, axis, angle);
    rotateMiscModel(entity, axis, angle);
    return;
  }

  const origin = entityOrigin(entity);
  if (origin) {
    setEntityOrigin(entity, vec3RotateAxis(origin, center, axis, angle));
  }
  for (const brush of entity.brushes) {
    rotateEditorBrush(editor, brush, center, axis, angle);
  }
  for (const patch of entity.patches) {
    rotatePatch(patch, center, axis, angle);
  }
  rotateMiscModel(entity, axis, angle);
}

export function mirrorEditorEntity(editor: Editor, entity: Entity, center: Vec3, axis: number): void {
  if (!editor.textureLock) {
    mirrorEntity(entity, center, axis);
    return;
  }

  const origin = entityOrigin(entity);
  if (origin) {
    setEntityOrigin(entity, vec3MirrorAxis(origin, center, axis));
  }
  for (const brush of entity.brushes) {
    mirrorEditorBrush(editor, brush, center, axis);
  }
  for (const patch of entity.patches) {
    mirrorPatch(patch, center, axis);
  }
}

function scalePoint(point: Vec3, center: Vec3, scale: Vec3): Vec3 {
  return [
    center[0] + (point[0] - center[0]) * scale[0],
    center[1] + (point[1] - center[1]) * scale[1],
    center[2] + (point[2] - center[2]) * scale[2],
  ];
}

export function scaleGeometryFromOriginals(
  editor: Editor,
  brushes: BrushScaleOriginal[],
  patches: PatchScaleOriginal[],
  origin: Vec3,
  scale: Vec3,
): void {
  editor.transact('Resize selection', () => {
    for (const { brush, origPoints, textureProjections } of brushes) {
      scaleEditorBrush(editor, brush, origPoints, origin, scale, textureProjections);
    }
    for (const { patch, origCtrl } of patches) {
      scalePatchControlPoints(patch, origCtrl, origin, scale);
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'resize-selection' });
}

export function rotateGeometryFromOriginals(
  editor: Editor,
  brushes: BrushRotationOriginal[],
  patches: PatchRotationOriginal[],
  entities: EntityRotationOriginal[],
  center: Vec3,
  axis: number,
  angle: number,
): void {
  editor.transact('Rotate selection', () => {
    for (const { brush, points, planes, polygons, textureProjections } of brushes) {
      for (let faceIndex = 0; faceIndex < brush.faces.length; faceIndex++) {
        const face = brush.faces[faceIndex];
        face.points[0] = vec3Copy(points[faceIndex][0]);
        face.points[1] = vec3Copy(points[faceIndex][1]);
        face.points[2] = vec3Copy(points[faceIndex][2]);
        face.plane = { normal: vec3Copy(planes[faceIndex].normal), dist: planes[faceIndex].dist };
        face.polygon = polygons[faceIndex].map(vec3Copy);
        face.textureProjection = cloneTextureProjection(textureProjections[faceIndex]);
      }
      rotateEditorBrush(editor, brush, center, axis, angle);
    }
    for (const { patch, ctrl } of patches) {
      for (let row = 0; row < patch.height; row++) {
        for (let col = 0; col < patch.width; col++) {
          patch.ctrl[row][col].xyz = vec3Copy(ctrl[row][col].xyz);
        }
      }
      rotatePatch(patch, center, axis, angle);
    }
    for (const original of entities) {
      if (original.origin) {
        setEntityOrigin(original.entity, vec3RotateAxis(original.origin, center, axis, angle));
      }
      rotateMiscModel(original.entity, axis, angle, original.angle, original.angles);
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'rotate-selection-preview' });
}

export function addBrush(editor: Editor, mins: Vec3, maxs: Vec3, axis: number, ctrlKey = false): Brush {
  const grid = editor.effectiveGrid(ctrlKey);
  const snappedMins = vec3Snap(mins, grid);
  const snappedMaxs = vec3Snap(maxs, grid);

  const realMins: Vec3 = [
    Math.min(snappedMins[0], snappedMaxs[0]),
    Math.min(snappedMins[1], snappedMaxs[1]),
    Math.min(snappedMins[2], snappedMaxs[2]),
  ];
  const realMaxs: Vec3 = [
    Math.max(snappedMins[0], snappedMaxs[0]),
    Math.max(snappedMins[1], snappedMaxs[1]),
    Math.max(snappedMins[2], snappedMaxs[2]),
  ];

  for (let i = 0; i < 3; i++) {
    if (realMaxs[i] - realMins[i] < grid) {
      realMaxs[i] = realMins[i] + grid;
    }
  }

  return editor.transact('Create brush', () => {
    const brush = createBrushPrimitive(
      editor.currentBrushPrimitive,
      realMins,
      realMaxs,
      editor.currentTexture,
      axis,
      editor.currentBrushSides,
    );
    editor.worldspawn.brushes.push(brush);
    editor.redrawRequested = true;
    return brush;
  });
}

export function deleteSelection(editor: Editor): void {
  if (editor.selection.length === 0) return;
  editor.transact('Delete selection', () => {
    const selectedEntities = selectedEntitySet(editor);

    for (const item of editor.selection) {
      if (item.type !== 'entity' && selectedEntities.has(item.entity)) continue;
      if (item.type === 'brush' || item.type === 'face') {
        const idx = item.entity.brushes.indexOf(item.brush);
        if (idx >= 0) item.entity.brushes.splice(idx, 1);
      } else if (item.type === 'patch') {
        const idx = item.entity.patches.indexOf(item.patch);
        if (idx >= 0) item.entity.patches.splice(idx, 1);
      } else {
        const idx = editor.entities.indexOf(item.entity);
        if (idx > 0) editor.entities.splice(idx, 1);
      }
    }

    editor.reconcileHiddenState();
    editor.selection = [];
    editor.redrawRequested = true;
    editor.statusMessage = 'Deleted';
  });
}

export function moveSelection(editor: Editor, delta: Vec3): void {
  if (editor.selection.length === 0 || (delta[0] === 0 && delta[1] === 0 && delta[2] === 0)) return;
  editor.transact('Move selection', () => {
    editor.recordTransactionTransform({ kind: 'move', delta }, 'accumulate');
    const selectedEntities = selectedEntitySet(editor);

    for (const item of editor.selection) {
      if (item.type !== 'entity' && selectedEntities.has(item.entity)) continue;
      if (item.type === 'brush' || item.type === 'face') {
        translateEditorBrush(editor, item.brush, delta);
      } else if (item.type === 'patch') {
        translatePatch(item.patch, delta);
      } else {
        translateEditorEntity(editor, item.entity, delta);
      }
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'move-selection', assumeChanged: true });
}

export function moveSelectedFaces(editor: Editor, delta: Vec3): void {
  const selectedFaces = editor.selection.filter(item => item.type === 'face');
  if (selectedFaces.length === 0 || (delta[0] === 0 && delta[1] === 0 && delta[2] === 0)) return;
  editor.transact('Move brush faces', () => {
    const facesByBrush = new Map<Brush, Set<Brush['faces'][number]>>();
    for (const item of selectedFaces) {
      const faces = facesByBrush.get(item.brush) ?? new Set<Brush['faces'][number]>();
      faces.add(item.face);
      facesByBrush.set(item.brush, faces);
    }
    for (const [brush, faces] of facesByBrush) {
      const faceIndices = new Set([...faces].map(face => brush.faces.indexOf(face)).filter(index => index >= 0));
      const vertices = collectBrushVertices(brush);
      const selectedIndices = vertices
        .map((vertex, index) => vertex.faceIndices.some(faceIndex => faceIndices.has(faceIndex)) ? index : -1)
        .filter(index => index >= 0);
      const textureState = editor.textureLock ? captureBrushPrimitiveVertexTextureState(brush) : null;
      moveVertices(brush, vertices, selectedIndices, delta);
      if (textureState) restoreBrushPrimitiveVertexTextureState(textureState);
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'move-brush-faces' });
}

export function rotateSelection(editor: Editor, angleDeg: number): void {
  if (editor.selection.length === 0) return;
  const angle = (angleDeg / 180) * Math.PI;
  const axis = editor.rotationAxis;

  const bounds = editor.selectionBounds();
  if (!bounds) return;
  const center: Vec3 = [
    (bounds.mins[0] + bounds.maxs[0]) / 2,
    (bounds.mins[1] + bounds.maxs[1]) / 2,
    (bounds.mins[2] + bounds.maxs[2]) / 2,
  ];
  editor.transact('Rotate selection', () => {
    editor.recordTransactionTransform({ kind: 'rotate', angleDeg, axis, centerMode: 'selection' });
    const selectedEntities = selectedEntitySet(editor);

    for (const item of editor.selection) {
      if (item.type !== 'entity' && selectedEntities.has(item.entity)) continue;
      if (item.type === 'brush' || item.type === 'face') {
        rotateEditorBrush(editor, item.brush, center, axis, angle);
      } else if (item.type === 'patch') {
        rotatePatch(item.patch, center, axis, angle);
      } else {
        rotateEditorEntity(editor, item.entity, center, axis, angle);
      }
    }

    editor.redrawRequested = true;
    const axisName = ['X', 'Y', 'Z'][axis];
    editor.statusMessage = `Rotated ${angleDeg}° around ${axisName}`;
  });
}

export function flipSelection(editor: Editor, axis: number): void {
  if (editor.selection.length === 0) return;

  const center = editor.selectionCenter();
  if (!center) return;

  editor.transact('Flip selection', () => {
    editor.recordTransactionTransform({ kind: 'flip', axis, centerMode: 'selection' });
    const selectedEntities = selectedEntitySet(editor);

    for (const item of editor.selection) {
      if (item.type !== 'entity' && selectedEntities.has(item.entity)) continue;
      if (item.type === 'brush' || item.type === 'face') {
        mirrorEditorBrush(editor, item.brush, center, axis);
      } else if (item.type === 'patch') {
        mirrorPatch(item.patch, center, axis);
      } else {
        mirrorEditorEntity(editor, item.entity, center, axis);
      }
    }

    editor.redrawRequested = true;
    const axisName = ['X', 'Y', 'Z'][axis];
    editor.statusMessage = `Flipped along ${axisName}`;
  });
}

export function scaleSelection(editor: Editor, scale: Vec3): void {
  if (editor.selection.length === 0) return;
  if (scale.some(value => !isFinite(value) || value <= 0.001)) {
    editor.statusMessage = 'Scale factors must be greater than zero';
    return;
  }
  if (scale.every(value => Math.abs(value - 1) < 1e-6)) {
    editor.statusMessage = 'Scale unchanged';
    return;
  }

  const center = editor.selectionCenter();
  if (!center) return;

  editor.transact('Scale selection', () => {
    editor.recordTransactionTransform({ kind: 'scale', scale, centerMode: 'selection' });
    const brushItems = getSelectedBrushItems(editor);
    const patchItems = getSelectedPatchItems(editor);
    const brushOriginals = brushItems.map(({ brush }) =>
      ({
        points: brush.faces.map(face => [
          [...face.points[0]] as Vec3,
          [...face.points[1]] as Vec3,
          [...face.points[2]] as Vec3,
        ] as [Vec3, Vec3, Vec3]),
        textureProjections: brush.faces.map(face => cloneTextureProjection(face.textureProjection)),
      })
    );
    const patchOriginals = patchItems.map(({ patch }) =>
      patch.ctrl.map(row =>
        row.map(cp => ({ xyz: [...cp.xyz] as Vec3, uv: [cp.uv[0], cp.uv[1]] as [number, number] }))
      )
    );

    for (let i = 0; i < brushItems.length; i++) {
      const original = brushOriginals[i];
      if (!original) continue;
      scaleEditorBrush(editor, brushItems[i].brush, original.points, center, scale, original.textureProjections);
    }

    for (let i = 0; i < patchItems.length; i++) {
      const origCtrl = patchOriginals[i] as PatchControlPoint[][] | undefined;
      if (!origCtrl) continue;
      scalePatchControlPoints(patchItems[i].patch, origCtrl, center, scale);
    }

    const scaledEntities = new Set<Entity>();
    for (const item of editor.selection) {
      if (item.type !== 'entity' || scaledEntities.has(item.entity)) continue;
      scaledEntities.add(item.entity);
      const origin = entityOrigin(item.entity);
      if (origin) {
        setEntityOrigin(item.entity, scalePoint(origin, center, scale));
      }
    }

    editor.redrawRequested = true;
    editor.statusMessage = `Scaled x${scale[0].toFixed(2)} y${scale[1].toFixed(2)} z${scale[2].toFixed(2)}`;
  });
}

export function repeatLastTransform(editor: Editor): void {
  if (editor.selection.length === 0) {
    editor.statusMessage = 'Select objects to repeat a transform';
    return;
  }
  if (!editor.lastTransform) {
    editor.statusMessage = 'No transform to repeat';
    return;
  }

  const transform = cloneTransformDescriptor(editor.lastTransform);
  if (transform.kind === 'move') {
    moveSelection(editor, transform.delta);
  } else if (transform.kind === 'rotate') {
    const previousAxis = editor.rotationAxis;
    editor.rotationAxis = transform.axis;
    try {
      rotateSelection(editor, transform.angleDeg);
    } finally {
      editor.rotationAxis = previousAxis;
    }
  } else if (transform.kind === 'scale') {
    scaleSelection(editor, transform.scale);
  } else {
    flipSelection(editor, transform.axis);
  }
}

const FALLBACK_INCOMING_RELATIONSHIP_KEYS = ['targetname'] as const;
const FALLBACK_OUTGOING_RELATIONSHIP_KEYS = ['target', 'killtarget', 'pathtarget'] as const;
const SHARED_RELATIONSHIP_KEYS = ['team'] as const;

function relationshipKeys(entity: Entity): { incoming: Set<string>; outgoing: Set<string> } {
  const incoming = new Set<string>(FALLBACK_INCOMING_RELATIONSHIP_KEYS);
  const outgoing = new Set<string>(FALLBACK_OUTGOING_RELATIONSHIP_KEYS);
  const definition = getEntityClassRegistry().get(entity.classname);
  for (const relationship of definition?.relationships ?? []) {
    (relationship.direction === 'incoming' ? incoming : outgoing).add(relationship.key);
  }
  for (const property of Object.values(definition?.properties ?? {})) {
    if (property.type !== 'entity-reference') continue;
    if (property.key.toLowerCase().includes('targetname')) incoming.add(property.key);
    else outgoing.add(property.key);
  }
  return { incoming, outgoing };
}

function uniqueRelationshipName(value: string, used: Set<string>): string {
  let index = 1;
  let candidate = `${value}_${index}`;
  while (used.has(candidate)) candidate = `${value}_${++index}`;
  used.add(candidate);
  return candidate;
}

function makeDuplicatedEntityLinksUnique(editor: Editor, pairs: Array<{ source: Entity; clone: Entity }>): number {
  const used = new Set<string>();
  for (const entity of editor.nonWorldspawnEntities()) {
    const keys = relationshipKeys(entity);
    for (const key of [...keys.incoming, ...keys.outgoing, ...SHARED_RELATIONSHIP_KEYS]) {
      const value = entity.properties[key]?.trim();
      if (value) used.add(value);
    }
  }

  const referenceReplacements = new Map<string, string>();
  const sharedReplacements = new Map<string, string>();
  for (const { source } of pairs) {
    const { incoming } = relationshipKeys(source);
    for (const key of incoming) {
      const value = source.properties[key]?.trim();
      if (value && !referenceReplacements.has(value)) {
        referenceReplacements.set(value, uniqueRelationshipName(value, used));
      }
    }
    for (const key of SHARED_RELATIONSHIP_KEYS) {
      const value = source.properties[key]?.trim();
      const identity = `${key}\u0000${value}`;
      if (value && !sharedReplacements.has(identity)) {
        sharedReplacements.set(identity, uniqueRelationshipName(value, used));
      }
    }
  }

  for (const { source, clone } of pairs) {
    const { incoming, outgoing } = relationshipKeys(source);
    for (const key of [...incoming, ...outgoing]) {
      const value = clone.properties[key]?.trim();
      const replacement = value ? referenceReplacements.get(value) : undefined;
      if (replacement) clone.properties[key] = replacement;
    }
    for (const key of SHARED_RELATIONSHIP_KEYS) {
      const value = clone.properties[key]?.trim();
      const replacement = value ? sharedReplacements.get(`${key}\u0000${value}`) : undefined;
      if (replacement) clone.properties[key] = replacement;
    }
  }
  return referenceReplacements.size + sharedReplacements.size;
}

function duplicateSelectionWithOptions(editor: Editor, makeUnique: boolean): void {
  if (editor.selection.length === 0) return;
  editor.transact(makeUnique ? 'Duplicate and make unique' : 'Duplicate selection', () => {
    const newSelection: SelectionItem[] = [];
    const entityPairs: Array<{ source: Entity; clone: Entity }> = [];
    const offset: Vec3 = [editor.gridSize, editor.gridSize, 0];
    const selectedEntities = selectedEntitySet(editor);

    for (const item of editor.selection) {
      if (item.type !== 'entity' && selectedEntities.has(item.entity)) continue;
      if (item.type === 'brush' || item.type === 'face') {
        const newBrush = cloneBrush(item.brush);
        translateEditorBrush(editor, newBrush, offset);
        item.entity.brushes.push(newBrush);
        newSelection.push({ type: 'brush', entity: item.entity, brush: newBrush });
      } else if (item.type === 'patch') {
        const newPatch = clonePatch(item.patch);
        translatePatch(newPatch, offset);
        item.entity.patches.push(newPatch);
        newSelection.push({ type: 'patch', entity: item.entity, patch: newPatch });
      } else {
        const newEntity = cloneEntity(item.entity);
        translateEditorEntity(editor, newEntity, offset);
        editor.entities.push(newEntity);
        entityPairs.push({ source: item.entity, clone: newEntity });
        newSelection.push({ type: 'entity', entity: newEntity });
      }
    }

    const remapped = makeUnique ? makeDuplicatedEntityLinksUnique(editor, entityPairs) : 0;
    editor.selection = newSelection;
    editor.redrawRequested = true;
    editor.statusMessage = makeUnique
      ? `Duplicated and made unique (${remapped} relationship name${remapped === 1 ? '' : 's'} remapped)`
      : 'Duplicated';
  });
}

export function duplicateSelection(editor: Editor): void {
  duplicateSelectionWithOptions(editor, false);
}

export function duplicateSelectionAndMakeUnique(editor: Editor): void {
  duplicateSelectionWithOptions(editor, true);
}

export function snapSelectionToGrid(editor: Editor): void {
  if (editor.selection.length === 0) return;
  editor.transact('Snap selection to grid', () => {
    const selectedEntities = selectedEntitySet(editor);
    for (const item of editor.selection) {
    if (item.type !== 'entity' && selectedEntities.has(item.entity)) continue;
    if (item.type === 'brush' || item.type === 'face') {
      const snapped = vec3Snap(item.brush.mins, editor.gridSize);
      const delta: Vec3 = [
        snapped[0] - item.brush.mins[0],
        snapped[1] - item.brush.mins[1],
        snapped[2] - item.brush.mins[2],
      ];
      if (delta[0] !== 0 || delta[1] !== 0 || delta[2] !== 0) {
        translateEditorBrush(editor, item.brush, delta);
      }
    } else if (item.type === 'patch') {
      const snapped = vec3Snap(item.patch.mins, editor.gridSize);
      const delta: Vec3 = [
        snapped[0] - item.patch.mins[0],
        snapped[1] - item.patch.mins[1],
        snapped[2] - item.patch.mins[2],
      ];
      if (delta[0] !== 0 || delta[1] !== 0 || delta[2] !== 0) {
        translatePatch(item.patch, delta);
      }
    } else {
      const origin = entityOrigin(item.entity);
      if (origin) {
        const snapped = vec3Snap(origin, editor.gridSize);
        const delta: Vec3 = [
          snapped[0] - origin[0],
          snapped[1] - origin[1],
          snapped[2] - origin[2],
        ];
        if (delta[0] !== 0 || delta[1] !== 0 || delta[2] !== 0) {
          translateEditorEntity(editor, item.entity, delta);
        }
        continue;
      }
      const bounds = entityBounds(item.entity);
      if (!bounds) continue;
      const snapped = vec3Snap(bounds.mins, editor.gridSize);
      const delta: Vec3 = [
        snapped[0] - bounds.mins[0],
        snapped[1] - bounds.mins[1],
        snapped[2] - bounds.mins[2],
      ];
      if (delta[0] !== 0 || delta[1] !== 0 || delta[2] !== 0) {
        translateEditorEntity(editor, item.entity, delta);
      }
    }
    }
    editor.redrawRequested = true;
    editor.statusMessage = 'Snapped to grid';
  });
}

export function duplicateSelectionInPlace(editor: Editor): void {
  if (editor.selection.length === 0) return;
  editor.transact('Duplicate selection', () => {
    const newSelection: SelectionItem[] = [];
    const selectedEntities = selectedEntitySet(editor);
    for (const item of editor.selection) {
      if (item.type !== 'entity' && selectedEntities.has(item.entity)) continue;
      if (item.type === 'brush' || item.type === 'face') {
        const newBrush = cloneBrush(item.brush);
        item.entity.brushes.push(newBrush);
        newSelection.push({ type: 'brush', entity: item.entity, brush: newBrush });
      } else if (item.type === 'patch') {
        const newPatch = clonePatch(item.patch);
        item.entity.patches.push(newPatch);
        newSelection.push({ type: 'patch', entity: item.entity, patch: newPatch });
      } else {
        const newEntity = cloneEntity(item.entity);
        editor.entities.push(newEntity);
        newSelection.push({ type: 'entity', entity: newEntity });
      }
    }
    editor.selection = newSelection;
    editor.redrawRequested = true;
  });
}

export function addEntity(editor: Editor, classname: string, origin: Vec3, ctrlKey = false): Entity {
  return editor.transact('Create entity', () => {
    const snapped = vec3Snap(origin, editor.effectiveGrid(ctrlKey));
    const entity = createEntity(classname, snapped);
    editor.entities.push(entity);
    editor.redrawRequested = true;
    return entity;
  });
}
