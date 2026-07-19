import type { Brush } from './brush';
import type { Entity } from './entity';
import type { Patch } from './patch';
import type { Editor } from './editor';
import { allBrushes, allPatches } from './editor-queries';
import { isBrushInRegion, isEntityInRegion, isPatchInRegion } from './editor-regions';
import { isBrushCategoryVisible, isEntityCategoryVisible, isPatchCategoryVisible } from './display-policy';
import { isGroupInfoEntity, isObjectInHiddenGroup } from './named-groups';

export const INVISIBLE_TEXTURES = new Set([
  'common/clip', 'common/weapclip', 'common/trigger',
  'common/hint', 'common/skip', 'common/nodraw',
  'common/areaportal', 'common/donotenter', 'common/caulk',
]);

export function clearHiddenState(editor: Editor): void {
  editor.hiddenBrushes.clear();
  editor.hiddenPatches.clear();
  editor.hiddenEntities.clear();
}

export function hideSelected(editor: Editor): void {
  if (editor.selection.length === 0) return;

  if (editor.patchEditMode) editor.exitPatchEditMode();
  if (editor.vertexMode) editor.exitVertexMode();

  const selectedEntities = new Set(
    editor.selection
      .filter((item): item is Extract<typeof editor.selection[number], { type: 'entity' }> => item.type === 'entity')
      .map(item => item.entity)
  );
  const hiddenBrushes = new Set<Brush>();
  const hiddenPatches = new Set<Patch>();
  const hiddenEntities = new Set<Entity>();

  for (const item of editor.selection) {
    if (item.type === 'entity') {
      editor.hiddenEntities.add(item.entity);
      hiddenEntities.add(item.entity);
      continue;
    }
    if (selectedEntities.has(item.entity)) continue;
    if (item.type === 'brush' || item.type === 'face') {
      editor.hiddenBrushes.add(item.brush);
      hiddenBrushes.add(item.brush);
    } else if (item.type === 'patch') {
      editor.hiddenPatches.add(item.patch);
      hiddenPatches.add(item.patch);
    }
  }

  editor.selection = [];
  editor.redrawRequested = true;
  const total = hiddenEntities.size + hiddenBrushes.size + hiddenPatches.size;
  editor.statusMessage = total > 0 ? `Hidden ${total} item${total === 1 ? '' : 's'}` : 'Nothing hidden';
}

export function showHidden(editor: Editor): void {
  const hadHidden = editor.hiddenBrushes.size > 0 || editor.hiddenPatches.size > 0 || editor.hiddenEntities.size > 0;
  clearHiddenState(editor);
  editor.redrawRequested = true;
  editor.statusMessage = hadHidden ? 'Hidden items shown' : 'No hidden items';
}

export function reconcileHiddenState(editor: Editor): void {
  const liveBrushes = new Set<Brush>();
  const livePatches = new Set<Patch>();
  const liveEntities = new Set<Entity>(editor.entities);

  for (const { brush } of allBrushes(editor)) {
    liveBrushes.add(brush);
  }
  for (const { patch } of allPatches(editor)) {
    livePatches.add(patch);
  }

  for (const brush of [...editor.hiddenBrushes]) {
    if (!liveBrushes.has(brush)) editor.hiddenBrushes.delete(brush);
  }
  for (const patch of [...editor.hiddenPatches]) {
    if (!livePatches.has(patch)) editor.hiddenPatches.delete(patch);
  }
  for (const entity of [...editor.hiddenEntities]) {
    if (!liveEntities.has(entity)) editor.hiddenEntities.delete(entity);
  }
}

export function isEntityHidden(editor: Editor, entity: Entity): boolean {
  return isGroupInfoEntity(entity) || editor.hiddenEntities.has(entity) || isObjectInHiddenGroup(editor, entity);
}

export function isBrushHidden(editor: Editor, brush: Brush, entity?: Entity): boolean {
  return editor.hiddenBrushes.has(brush) || isObjectInHiddenGroup(editor, brush, entity) || (!!entity && isEntityHidden(editor, entity));
}

export function isPatchHidden(editor: Editor, patch: Patch, entity?: Entity): boolean {
  return editor.hiddenPatches.has(patch) || isObjectInHiddenGroup(editor, patch, entity) || (!!entity && isEntityHidden(editor, entity));
}

export function isBrushVisible(editor: Editor, brush: Brush, entity?: Entity): boolean {
  if (!isBrushInRegion(editor, brush)) return false;
  if (isBrushHidden(editor, brush, entity)) return false;
  if (!isBrushCategoryVisible(editor.display, brush, entity)) return false;
  if (editor.invisibleMode === 'hide' && brush.faces.length > 0 &&
      brush.faces.every(face => INVISIBLE_TEXTURES.has(face.texture.toLowerCase()))) {
    return false;
  }
  if (!editor.renderSelectedOnly || editor.selection.length === 0) return true;
  return editor.selection.some(item =>
    ((item.type === 'brush' || item.type === 'face') && item.brush === brush) ||
    (!!entity && item.type === 'entity' && item.entity === entity)
  );
}

export function isPatchVisible(editor: Editor, patch: Patch, entity?: Entity): boolean {
  if (!isPatchInRegion(editor, patch)) return false;
  if (isPatchHidden(editor, patch, entity)) return false;
  if (!isPatchCategoryVisible(editor.display, patch, entity)) return false;
  if (!editor.renderSelectedOnly || editor.selection.length === 0) return true;
  return editor.selection.some(item =>
    (item.type === 'patch' && item.patch === patch) ||
    (!!entity && item.type === 'entity' && item.entity === entity)
  );
}

export function isEntityVisible(editor: Editor, entity: Entity): boolean {
  if (!isEntityInRegion(editor, entity)) return false;
  if (isEntityHidden(editor, entity)) return false;
  if (!isEntityCategoryVisible(editor.display, entity)) return false;
  if (!editor.renderSelectedOnly || editor.selection.length === 0) return true;
  return editor.selection.some(item =>
    (item.type === 'entity' && item.entity === entity) ||
    (item.type === 'brush' && item.entity === entity) ||
    (item.type === 'face' && item.entity === entity) ||
    (item.type === 'patch' && item.entity === entity)
  );
}
