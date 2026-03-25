import { cloneBrush, createBoxBrush, rotateBrush, translateBrush, type Brush } from './brush';
import { cloneEntity, createEntity, entityDefaults, entityOrigin, rotateEntity, translateEntity, type Entity } from './entity';
import { vec3Snap, type Vec3 } from './math';
import { clonePatch, rotatePatch, translatePatch } from './patch';
import { entityBounds } from './editor-queries';
import type { Editor, SelectionItem } from './editor';

function selectedEntitySet(editor: Editor): Set<Entity> {
  return new Set(
    editor.selection
      .filter((item): item is Extract<SelectionItem, { type: 'entity' }> => item.type === 'entity')
      .map(item => item.entity)
  );
}

export function addBrush(editor: Editor, mins: Vec3, maxs: Vec3, ctrlKey = false): Brush {
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

  const brush = createBoxBrush(realMins, realMaxs, editor.currentTexture);
  editor.worldspawn.brushes.push(brush);
  editor.dirty = true;
  return brush;
}

export function deleteSelection(editor: Editor): void {
  if (editor.selection.length === 0) return;
  editor.snapshot();
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

  editor.selection = [];
  editor.dirty = true;
  editor.statusMessage = 'Deleted';
}

export function moveSelection(editor: Editor, delta: Vec3): void {
  if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return;
  const selectedEntities = selectedEntitySet(editor);

  for (const item of editor.selection) {
    if (item.type !== 'entity' && selectedEntities.has(item.entity)) continue;
    if (item.type === 'brush' || item.type === 'face') {
      translateBrush(item.brush, delta);
    } else if (item.type === 'patch') {
      translatePatch(item.patch, delta);
    } else {
      translateEntity(item.entity, delta);
    }
  }
  editor.dirty = true;
}

export function rotateSelection(editor: Editor, angleDeg: number): void {
  if (editor.selection.length === 0) return;
  editor.snapshot();

  const angle = (angleDeg / 180) * Math.PI;
  const axis = editor.rotationAxis;

  const bounds = editor.selectionBounds();
  if (!bounds) return;
  const center: Vec3 = [
    (bounds.mins[0] + bounds.maxs[0]) / 2,
    (bounds.mins[1] + bounds.maxs[1]) / 2,
    (bounds.mins[2] + bounds.maxs[2]) / 2,
  ];
  const selectedEntities = selectedEntitySet(editor);

  for (const item of editor.selection) {
    if (item.type !== 'entity' && selectedEntities.has(item.entity)) continue;
    if (item.type === 'brush' || item.type === 'face') {
      rotateBrush(item.brush, center, axis, angle);
    } else if (item.type === 'patch') {
      rotatePatch(item.patch, center, axis, angle);
    } else {
      rotateEntity(item.entity, center, axis, angle);
    }
  }

  editor.dirty = true;
  const axisName = ['X', 'Y', 'Z'][axis];
  editor.statusMessage = `Rotated ${angleDeg}° around ${axisName}`;
}

export function duplicateSelection(editor: Editor): void {
  if (editor.selection.length === 0) return;
  editor.snapshot();

  const newSelection: SelectionItem[] = [];
  const offset: Vec3 = [editor.gridSize, editor.gridSize, 0];
  const selectedEntities = selectedEntitySet(editor);

  for (const item of editor.selection) {
    if (item.type !== 'entity' && selectedEntities.has(item.entity)) continue;
    if (item.type === 'brush' || item.type === 'face') {
      const newBrush = cloneBrush(item.brush);
      translateBrush(newBrush, offset);
      item.entity.brushes.push(newBrush);
      newSelection.push({ type: 'brush', entity: item.entity, brush: newBrush });
    } else if (item.type === 'patch') {
      const newPatch = clonePatch(item.patch);
      translatePatch(newPatch, offset);
      item.entity.patches.push(newPatch);
      newSelection.push({ type: 'patch', entity: item.entity, patch: newPatch });
    } else {
      const newEntity = cloneEntity(item.entity);
      translateEntity(newEntity, offset);
      editor.entities.push(newEntity);
      newSelection.push({ type: 'entity', entity: newEntity });
    }
  }

  editor.selection = newSelection;
  editor.dirty = true;
  editor.statusMessage = 'Duplicated';
}

export function snapSelectionToGrid(editor: Editor): void {
  if (editor.selection.length === 0) return;
  editor.snapshot();
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
        translateBrush(item.brush, delta);
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
          translateEntity(item.entity, delta);
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
        translateEntity(item.entity, delta);
      }
    }
  }
  editor.dirty = true;
  editor.statusMessage = 'Snapped to grid';
}

export function duplicateSelectionInPlace(editor: Editor): void {
  if (editor.selection.length === 0) return;
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
}

export function addEntity(editor: Editor, classname: string, origin: Vec3, ctrlKey = false): Entity {
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
}
