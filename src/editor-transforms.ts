import { cloneBrush, mirrorBrush, rotateBrush, scaleBrushFaces, translateBrush, type Brush } from './brush';
import { createBrushPrimitive } from './brush-primitives';
import {
  cloneEntity,
  createEntity,
  entityDefaults,
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
import { mirrorBrushLocked, rotateBrushLocked, translateBrushLocked } from './texture-lock';

export interface BrushScaleOriginal {
  brush: Brush;
  origPoints: [Vec3, Vec3, Vec3][];
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
  textures: { offsetX: number; offsetY: number; rotation: number; scaleX: number; scaleY: number }[];
}

export interface PatchRotationOriginal {
  patch: Patch;
  ctrl: PatchControlPoint[][];
}

function selectedEntitySet(editor: Editor): Set<Entity> {
  return new Set(
    editor.selection
      .filter((item): item is Extract<SelectionItem, { type: 'entity' }> => item.type === 'entity')
      .map(item => item.entity)
  );
}

function translateEditorBrush(editor: Editor, brush: Brush, delta: Vec3): void {
  if (editor.textureLock) {
    translateBrushLocked(brush, delta);
    return;
  }
  translateBrush(brush, delta);
}

function rotateEditorBrush(editor: Editor, brush: Brush, center: Vec3, axis: number, angle: number): void {
  if (editor.textureLock) {
    rotateBrushLocked(brush, center, axis, angle);
    return;
  }
  rotateBrush(brush, center, axis, angle);
}

function mirrorEditorBrush(editor: Editor, brush: Brush, center: Vec3, axis: number): void {
  if (editor.textureLock) {
    mirrorBrushLocked(brush, center, axis);
    return;
  }
  mirrorBrush(brush, center, axis);
}

function translateEditorEntity(editor: Editor, entity: Entity, delta: Vec3): void {
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

function rotateEditorEntity(editor: Editor, entity: Entity, center: Vec3, axis: number, angle: number): void {
  if (!editor.textureLock) {
    rotateEntity(entity, center, axis, angle);
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
}

function mirrorEditorEntity(editor: Editor, entity: Entity, center: Vec3, axis: number): void {
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
    for (const { brush, origPoints } of brushes) {
      scaleBrushFaces(brush, origPoints, origin, scale);
    }
    for (const { patch, origCtrl } of patches) {
      scalePatchControlPoints(patch, origCtrl, origin, scale);
    }
    editor.dirty = true;
  }, { coalesceKey: 'resize-selection' });
}

export function rotateGeometryFromOriginals(
  editor: Editor,
  brushes: BrushRotationOriginal[],
  patches: PatchRotationOriginal[],
  center: Vec3,
  axis: number,
  angle: number,
): void {
  editor.transact('Rotate selection', () => {
    for (const { brush, points, planes, polygons, textures } of brushes) {
      for (let faceIndex = 0; faceIndex < brush.faces.length; faceIndex++) {
        const face = brush.faces[faceIndex];
        face.points[0] = vec3Copy(points[faceIndex][0]);
        face.points[1] = vec3Copy(points[faceIndex][1]);
        face.points[2] = vec3Copy(points[faceIndex][2]);
        face.plane = { normal: vec3Copy(planes[faceIndex].normal), dist: planes[faceIndex].dist };
        face.polygon = polygons[faceIndex].map(vec3Copy);
        face.offsetX = textures[faceIndex].offsetX;
        face.offsetY = textures[faceIndex].offsetY;
        face.rotation = textures[faceIndex].rotation;
        face.scaleX = textures[faceIndex].scaleX;
        face.scaleY = textures[faceIndex].scaleY;
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
    editor.dirty = true;
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
    editor.dirty = true;
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
    editor.dirty = true;
    editor.statusMessage = 'Deleted';
  });
}

export function moveSelection(editor: Editor, delta: Vec3): void {
  if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return;
  editor.transact('Move selection', () => {
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
    editor.dirty = true;
  }, { coalesceKey: 'move-selection' });
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

    editor.dirty = true;
    const axisName = ['X', 'Y', 'Z'][axis];
    editor.statusMessage = `Rotated ${angleDeg}° around ${axisName}`;
  });
}

export function flipSelection(editor: Editor, axis: number): void {
  if (editor.selection.length === 0) return;

  const center = editor.selectionCenter();
  if (!center) return;

  editor.transact('Flip selection', () => {
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

    editor.dirty = true;
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
    const brushItems = getSelectedBrushItems(editor);
    const patchItems = getSelectedPatchItems(editor);
    const brushOriginals = brushItems.map(({ brush }) =>
      brush.faces.map(face => [
        [...face.points[0]] as Vec3,
        [...face.points[1]] as Vec3,
        [...face.points[2]] as Vec3,
      ] as [Vec3, Vec3, Vec3])
    );
    const patchOriginals = patchItems.map(({ patch }) =>
      patch.ctrl.map(row =>
        row.map(cp => ({ xyz: [...cp.xyz] as Vec3, uv: [cp.uv[0], cp.uv[1]] as [number, number] }))
      )
    );

    for (let i = 0; i < brushItems.length; i++) {
      const origPoints = brushOriginals[i];
      if (!origPoints) continue;
      scaleBrushFaces(brushItems[i].brush, origPoints, center, scale);
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

    editor.dirty = true;
    editor.statusMessage = `Scaled x${scale[0].toFixed(2)} y${scale[1].toFixed(2)} z${scale[2].toFixed(2)}`;
  });
}

export function duplicateSelection(editor: Editor): void {
  if (editor.selection.length === 0) return;
  editor.transact('Duplicate selection', () => {
    const newSelection: SelectionItem[] = [];
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
        newSelection.push({ type: 'entity', entity: newEntity });
      }
    }

    editor.selection = newSelection;
    editor.dirty = true;
    editor.statusMessage = 'Duplicated';
  });
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
    editor.dirty = true;
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
    editor.dirty = true;
  });
}

export function addEntity(editor: Editor, classname: string, origin: Vec3, ctrlKey = false): Entity {
  return editor.transact('Create entity', () => {
    const snapped = vec3Snap(origin, editor.effectiveGrid(ctrlKey));
    const entity = createEntity(classname, snapped);
    const defaults = entityDefaults(classname);
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in entity.properties)) {
        entity.properties[key] = value;
      }
    }
    editor.entities.push(entity);
    editor.dirty = true;
    return entity;
  });
}
