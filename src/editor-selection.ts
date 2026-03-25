import type { Brush, BrushFace } from './brush';
import type { Entity } from './entity';
import type { Patch } from './patch';
import type { Editor } from './editor';
import { nonWorldspawnEntities } from './editor-queries';

function selectsWholeEntity(editor: Editor, entity: Entity): boolean {
  return entity !== editor.worldspawn && (entity.brushes.length > 0 || entity.patches.length > 0);
}

export function hasDirectGeometrySelection(editor: Editor, entity: Entity): boolean {
  return editor.selection.some(item =>
    item.entity === entity && (item.type === 'brush' || item.type === 'patch' || item.type === 'face')
  );
}

export function isBrushDirectlySelected(editor: Editor, brush: Brush): boolean {
  return editor.selection.some(item =>
    (item.type === 'brush' && item.brush === brush) ||
    (item.type === 'face' && item.brush === brush)
  );
}

export function isPatchDirectlySelected(editor: Editor, patch: Patch): boolean {
  return editor.selection.some(item => item.type === 'patch' && item.patch === patch);
}

export function clearSelection(editor: Editor): void {
  editor.selection = [];
  editor.exitVertexMode();
  editor.dirty = true;
}

export function selectBrush(editor: Editor, entity: Entity, brush: Brush, additive = false): void {
  if (selectsWholeEntity(editor, entity) && !hasDirectGeometrySelection(editor, entity)) {
    selectEntity(editor, entity, additive);
    return;
  }
  selectBrushDirect(editor, entity, brush, additive);
}

export function selectBrushDirect(editor: Editor, entity: Entity, brush: Brush, additive = false): void {
  if (!additive) editor.selection = [];
  const idx = editor.selection.findIndex(
    s => s.type === 'brush' && s.brush === brush
  );
  if (idx >= 0) {
    if (additive) editor.selection.splice(idx, 1);
    return;
  }
  editor.selection.push({ type: 'brush', entity, brush });
  editor.dirty = true;
}

export function selectEntity(editor: Editor, entity: Entity, additive = false): void {
  if (!additive) editor.selection = [];
  const idx = editor.selection.findIndex(
    s => s.type === 'entity' && s.entity === entity
  );
  if (idx >= 0) {
    if (additive) editor.selection.splice(idx, 1);
    return;
  }
  editor.selection.push({ type: 'entity', entity });
  editor.dirty = true;
}

export function isBrushSelected(editor: Editor, brush: Brush, entity?: Entity): boolean {
  return editor.selection.some(s =>
    (s.type === 'brush' && s.brush === brush) ||
    (!!entity && s.type === 'entity' && s.entity === entity)
  );
}

export function isEntitySelected(editor: Editor, entity: Entity): boolean {
  return editor.selection.some(s => s.type === 'entity' && s.entity === entity);
}

export function addBrushToSelection(editor: Editor, entity: Entity, brush: Brush): void {
  if (selectsWholeEntity(editor, entity) && !hasDirectGeometrySelection(editor, entity)) {
    addEntityToSelection(editor, entity);
    return;
  }
  addBrushDirectToSelection(editor, entity, brush);
}

export function addBrushDirectToSelection(editor: Editor, entity: Entity, brush: Brush): void {
  if (isBrushSelected(editor, brush, entity)) return;
  editor.selection.push({ type: 'brush', entity, brush });
  editor.dirty = true;
}

export function addEntityToSelection(editor: Editor, entity: Entity): void {
  if (isEntitySelected(editor, entity)) return;
  editor.selection.push({ type: 'entity', entity });
  editor.dirty = true;
}

export function selectPatch(editor: Editor, entity: Entity, patch: Patch, additive = false): void {
  if (selectsWholeEntity(editor, entity) && !hasDirectGeometrySelection(editor, entity)) {
    selectEntity(editor, entity, additive);
    return;
  }
  selectPatchDirect(editor, entity, patch, additive);
}

export function selectPatchDirect(editor: Editor, entity: Entity, patch: Patch, additive = false): void {
  if (!additive) editor.selection = [];
  const idx = editor.selection.findIndex(
    s => s.type === 'patch' && s.patch === patch
  );
  if (idx >= 0) {
    if (additive) editor.selection.splice(idx, 1);
    return;
  }
  editor.selection.push({ type: 'patch', entity, patch });
  editor.dirty = true;
}

export function isPatchSelected(editor: Editor, patch: Patch, entity?: Entity): boolean {
  return editor.selection.some(s =>
    (s.type === 'patch' && s.patch === patch) ||
    (!!entity && s.type === 'entity' && s.entity === entity)
  );
}

export function addPatchToSelection(editor: Editor, entity: Entity, patch: Patch): void {
  if (selectsWholeEntity(editor, entity) && !hasDirectGeometrySelection(editor, entity)) {
    addEntityToSelection(editor, entity);
    return;
  }
  addPatchDirectToSelection(editor, entity, patch);
}

export function addPatchDirectToSelection(editor: Editor, entity: Entity, patch: Patch): void {
  if (isPatchSelected(editor, patch, entity)) return;
  editor.selection.push({ type: 'patch', entity, patch });
  editor.dirty = true;
}

export function selectFace(
  editor: Editor,
  entity: Entity,
  brush: Brush,
  face: BrushFace,
  additive = false,
): void {
  if (additive) {
    const allFaces = editor.selection.every(s => s.type === 'face');
    if (allFaces && editor.selection.length > 0) {
      const idx = editor.selection.findIndex(s => s.type === 'face' && s.face === face);
      if (idx >= 0) {
        editor.selection.splice(idx, 1);
      } else {
        editor.selection.push({ type: 'face', entity, brush, face });
      }
    } else {
      editor.selection = [{ type: 'face', entity, brush, face }];
    }
  } else {
    editor.selection = [{ type: 'face', entity, brush, face }];
  }
  editor.dirty = true;
}

export function isFaceSelected(editor: Editor, face: BrushFace): boolean {
  return editor.selection.some(s => s.type === 'face' && s.face === face);
}

export function getSelectedFaces(editor: Editor): BrushFace[] {
  return editor.selection
    .filter(s => s.type === 'face')
    .map(s => s.face);
}

export function getSelectedFace(editor: Editor): BrushFace | null {
  const item = editor.selection[0];
  return item?.type === 'face' ? item.face : null;
}

export function getSelectedBrushItems(editor: Editor): { entity: Entity; brush: Brush }[] {
  const unique: { entity: Entity; brush: Brush }[] = [];
  const seen = new Set<Brush>();

  for (const item of editor.selection) {
    if (item.type === 'entity') {
      for (const brush of item.entity.brushes) {
        if (seen.has(brush)) continue;
        seen.add(brush);
        unique.push({ entity: item.entity, brush });
      }
      continue;
    }

    if (item.type !== 'brush' && item.type !== 'face') continue;
    if (seen.has(item.brush)) continue;
    seen.add(item.brush);
    unique.push({ entity: item.entity, brush: item.brush });
  }

  return unique;
}

export function getSelectedPatchItems(editor: Editor): { entity: Entity; patch: Patch }[] {
  const unique: { entity: Entity; patch: Patch }[] = [];
  const seen = new Set<Patch>();

  for (const item of editor.selection) {
    if (item.type === 'entity') {
      for (const patch of item.entity.patches) {
        if (seen.has(patch)) continue;
        seen.add(patch);
        unique.push({ entity: item.entity, patch });
      }
      continue;
    }

    if (item.type !== 'patch') continue;
    if (seen.has(item.patch)) continue;
    seen.add(item.patch);
    unique.push({ entity: item.entity, patch: item.patch });
  }

  return unique;
}

export function selectAll(editor: Editor): void {
  editor.selection = [];
  const worldspawn = editor.entities[0];
  if (worldspawn) {
    for (const brush of worldspawn.brushes) {
      editor.selection.push({ type: 'brush', entity: worldspawn, brush });
    }
    for (const patch of worldspawn.patches) {
      editor.selection.push({ type: 'patch', entity: worldspawn, patch });
    }
  }
  for (const entity of nonWorldspawnEntities(editor)) {
    editor.selection.push({ type: 'entity', entity });
  }
  editor.dirty = true;
}
