import type { Brush } from './brush';
import { createEntity, type Entity } from './entity';
import type { Editor, SelectionItem } from './editor';
import type { Patch } from './patch';

type SelectedBrushRef = { source: Entity; brush: Brush };
type SelectedPatchRef = { source: Entity; patch: Patch };

function selectedEntitySet(editor: Editor): Set<Entity> {
  return new Set(
    editor.selection
      .filter((item): item is Extract<SelectionItem, { type: 'entity' }> => item.type === 'entity')
      .map(item => item.entity)
  );
}

function collectSelectedGeometry(editor: Editor): {
  brushes: SelectedBrushRef[];
  patches: SelectedPatchRef[];
  sourceEntities: Set<Entity>;
} {
  const selectedEntities = selectedEntitySet(editor);
  const brushes: SelectedBrushRef[] = [];
  const patches: SelectedPatchRef[] = [];
  const seenBrushes = new Set<Brush>();
  const seenPatches = new Set<Patch>();
  const sourceEntities = new Set<Entity>();

  const addBrush = (source: Entity, brush: Brush): void => {
    if (seenBrushes.has(brush)) return;
    seenBrushes.add(brush);
    brushes.push({ source, brush });
    sourceEntities.add(source);
  };

  const addPatch = (source: Entity, patch: Patch): void => {
    if (seenPatches.has(patch)) return;
    seenPatches.add(patch);
    patches.push({ source, patch });
    sourceEntities.add(source);
  };

  for (const item of editor.selection) {
    if (item.type === 'entity') {
      for (const brush of item.entity.brushes) addBrush(item.entity, brush);
      for (const patch of item.entity.patches) addPatch(item.entity, patch);
      continue;
    }

    if (selectedEntities.has(item.entity)) continue;

    if (item.type === 'brush' || item.type === 'face') {
      addBrush(item.entity, item.brush);
    } else if (item.type === 'patch') {
      addPatch(item.entity, item.patch);
    }
  }

  return { brushes, patches, sourceEntities };
}

function removeBrushFromEntity(entity: Entity, brush: Brush): void {
  const index = entity.brushes.indexOf(brush);
  if (index >= 0) entity.brushes.splice(index, 1);
}

function removePatchFromEntity(entity: Entity, patch: Patch): void {
  const index = entity.patches.indexOf(patch);
  if (index >= 0) entity.patches.splice(index, 1);
}

function removeEmptyGeometryEntities(editor: Editor, entities: Iterable<Entity>, keep = new Set<Entity>()): void {
  for (const entity of entities) {
    if (entity === editor.worldspawn || keep.has(entity)) continue;
    if (entity.brushes.length > 0 || entity.patches.length > 0) continue;
    const index = editor.entities.indexOf(entity);
    if (index > 0) editor.entities.splice(index, 1);
    editor.hiddenEntities.delete(entity);
  }
}

export function groupSelectionIntoEntity(editor: Editor, classname = 'func_group'): void {
  const { brushes, patches, sourceEntities } = collectSelectedGeometry(editor);
  const total = brushes.length + patches.length;
  if (total === 0) {
    editor.statusMessage = 'No brush or patch selection to group';
    return;
  }

  editor.snapshot();

  const entity = createEntity(classname);
  for (const { source, brush } of brushes) {
    removeBrushFromEntity(source, brush);
    entity.brushes.push(brush);
  }
  for (const { source, patch } of patches) {
    removePatchFromEntity(source, patch);
    entity.patches.push(patch);
  }

  editor.entities.push(entity);
  removeEmptyGeometryEntities(editor, sourceEntities, new Set([entity]));
  editor.reconcileHiddenState();
  editor.selection = [{ type: 'entity', entity }];
  editor.dirty = true;
  editor.statusMessage = `Grouped ${total} item${total === 1 ? '' : 's'} into ${classname}`;
}

export function moveSelectionToWorldspawn(editor: Editor): void {
  const worldspawn = editor.worldspawn;
  const { brushes, patches, sourceEntities } = collectSelectedGeometry(editor);
  const selectedBrushes = brushes.filter(item => item.source !== worldspawn);
  const selectedPatches = patches.filter(item => item.source !== worldspawn);
  const total = selectedBrushes.length + selectedPatches.length;

  if (total === 0) {
    editor.statusMessage = 'No brush-entity selection to move to worldspawn';
    return;
  }

  editor.snapshot();

  for (const { source, brush } of selectedBrushes) {
    removeBrushFromEntity(source, brush);
    worldspawn.brushes.push(brush);
  }
  for (const { source, patch } of selectedPatches) {
    removePatchFromEntity(source, patch);
    worldspawn.patches.push(patch);
  }

  removeEmptyGeometryEntities(editor, sourceEntities, new Set([worldspawn]));
  editor.reconcileHiddenState();
  editor.selection = [
    ...selectedBrushes.map(({ brush }) => ({ type: 'brush' as const, entity: worldspawn, brush })),
    ...selectedPatches.map(({ patch }) => ({ type: 'patch' as const, entity: worldspawn, patch })),
  ];
  editor.dirty = true;
  editor.statusMessage = `Moved ${total} item${total === 1 ? '' : 's'} to worldspawn`;
}
