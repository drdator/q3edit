import type { Brush, BrushFace } from './brush';
import type { Entity } from './entity';
import type { Patch } from './patch';
import type { Editor } from './editor';
import { allBrushes, allPatches, pointEntities } from './editor-queries';

export function clearSelection(editor: Editor): void {
  editor.selection = [];
  editor.exitVertexMode();
  editor.dirty = true;
}

export function selectBrush(editor: Editor, entity: Entity, brush: Brush, additive = false): void {
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

export function isBrushSelected(editor: Editor, brush: Brush): boolean {
  return editor.selection.some(s => s.type === 'brush' && s.brush === brush);
}

export function isEntitySelected(editor: Editor, entity: Entity): boolean {
  return editor.selection.some(s => s.type === 'entity' && s.entity === entity);
}

export function addBrushToSelection(editor: Editor, entity: Entity, brush: Brush): void {
  if (isBrushSelected(editor, brush)) return;
  editor.selection.push({ type: 'brush', entity, brush });
  editor.dirty = true;
}

export function addEntityToSelection(editor: Editor, entity: Entity): void {
  if (isEntitySelected(editor, entity)) return;
  editor.selection.push({ type: 'entity', entity });
  editor.dirty = true;
}

export function selectPatch(editor: Editor, entity: Entity, patch: Patch, additive = false): void {
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

export function isPatchSelected(editor: Editor, patch: Patch): boolean {
  return editor.selection.some(s => s.type === 'patch' && s.patch === patch);
}

export function addPatchToSelection(editor: Editor, entity: Entity, patch: Patch): void {
  if (isPatchSelected(editor, patch)) return;
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
  const items = editor.selection.filter(
    s => s.type === 'brush' || s.type === 'face'
  ) as ({ type: 'brush'; entity: Entity; brush: Brush } | {
    type: 'face';
    entity: Entity;
    brush: Brush;
    face: BrushFace;
  })[];

  const unique: { entity: Entity; brush: Brush }[] = [];
  const seen = new Set<Brush>();
  for (const item of items) {
    if (seen.has(item.brush)) continue;
    seen.add(item.brush);
    unique.push({ entity: item.entity, brush: item.brush });
  }
  return unique;
}

export function selectAll(editor: Editor): void {
  editor.selection = [];
  for (const { entity, brush } of allBrushes(editor)) {
    editor.selection.push({ type: 'brush', entity, brush });
  }
  for (const { entity, patch } of allPatches(editor)) {
    editor.selection.push({ type: 'patch', entity, patch });
  }
  for (const entity of pointEntities(editor)) {
    editor.selection.push({ type: 'entity', entity });
  }
  editor.dirty = true;
}
