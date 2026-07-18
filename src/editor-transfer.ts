import { cloneBrush, type Brush } from './brush';
import type { Editor, SelectionItem } from './editor';
import { cloneEntity, createEntity, translateEntity, type Entity } from './entity';
import { parseMap } from './mapfile';
import type { Vec3 } from './math';
import { clonePatch, type Patch } from './patch';

export type TransferBuildResult = {
  entities: Entity[];
  totalItems: number;
};

export type TransferInsertResult = {
  selection: SelectionItem[];
  totalItems: number;
  entityCount: number;
  brushCount: number;
  patchCount: number;
};

function selectedEntitySet(editor: Editor): Set<Entity> {
  return new Set(
    editor.selection
      .filter((item): item is Extract<SelectionItem, { type: 'entity' }> => item.type === 'entity')
      .map(item => item.entity)
  );
}

function cloneEntityShell(entity: Entity): Entity {
  return {
    classname: entity.classname,
    properties: { ...entity.properties },
    brushes: [],
    patches: [],
  };
}

export function buildSelectionTransfer(editor: Editor): TransferBuildResult {
  const selectedEntities = selectedEntitySet(editor);
  const fullEntities: Entity[] = [];
  const partialEntities = new Map<Entity, Entity>();
  const worldspawnCopy = createEntity('worldspawn');
  const seenBrushes = new Set<Brush>();
  const seenPatches = new Set<Patch>();
  let totalItems = 0;

  for (const entity of selectedEntities) {
    if (entity === editor.worldspawn) continue;
    fullEntities.push(cloneEntity(entity));
    totalItems++;
  }

  const entityTarget = (entity: Entity): Entity => {
    if (entity === editor.worldspawn) return worldspawnCopy;
    let target = partialEntities.get(entity);
    if (!target) {
      target = cloneEntityShell(entity);
      partialEntities.set(entity, target);
    }
    return target;
  };

  for (const item of editor.selection) {
    if (item.type === 'entity') continue;
    if (selectedEntities.has(item.entity)) continue;

    if (item.type === 'brush' || item.type === 'face') {
      if (seenBrushes.has(item.brush)) continue;
      seenBrushes.add(item.brush);
      entityTarget(item.entity).brushes.push(cloneBrush(item.brush));
      totalItems++;
      continue;
    }

    if (item.type === 'patch') {
      if (seenPatches.has(item.patch)) continue;
      seenPatches.add(item.patch);
      entityTarget(item.entity).patches.push(clonePatch(item.patch));
      totalItems++;
    }
  }

  const entities: Entity[] = [];
  if (worldspawnCopy.brushes.length > 0 || worldspawnCopy.patches.length > 0) {
    entities.push(worldspawnCopy);
  }
  entities.push(...fullEntities);
  entities.push(...partialEntities.values());
  return { entities, totalItems };
}

export function parseTransferEntities(text: string): Entity[] | null {
  if (!text.trim()) return null;
  const entities = parseMap(text);
  if (entities.length === 0) return null;
  return entities;
}

export function countTransferItems(entities: Entity[]): number {
  let total = 0;

  for (const entity of entities) {
    if (entity.classname === 'worldspawn') {
      total += entity.brushes.length + entity.patches.length;
    } else {
      total++;
    }
  }

  return total;
}

export function transferOffset(editor: Editor): Vec3 {
  const delta: Vec3 = [0, 0, 0];
  delta[editor.nudgeAxisH] += editor.gridSize;
  delta[editor.nudgeAxisV] += editor.gridSize;
  return delta;
}

export function formatTransferCount(totalItems: number): string {
  return `${totalItems} item${totalItems === 1 ? '' : 's'}`;
}

export function insertTransferEntities(editor: Editor, entities: Entity[], delta: Vec3): TransferInsertResult {
  const selection: SelectionItem[] = [];
  let entityCount = 0;
  let brushCount = 0;
  let patchCount = 0;

  for (const source of entities) {
    const entity = cloneEntity(source);
    translateEntity(entity, delta);

    if (entity.classname === 'worldspawn') {
      for (const brush of entity.brushes) {
        editor.worldspawn.brushes.push(brush);
        selection.push({ type: 'brush', entity: editor.worldspawn, brush });
        brushCount++;
      }
      for (const patch of entity.patches) {
        editor.worldspawn.patches.push(patch);
        selection.push({ type: 'patch', entity: editor.worldspawn, patch });
        patchCount++;
      }
      continue;
    }

    editor.entities.push(entity);
    selection.push({ type: 'entity', entity });
    entityCount++;
  }

  editor.reconcileHiddenState();
  editor.selection = selection;
  editor.dirty = true;

  return {
    selection,
    totalItems: entityCount + brushCount + patchCount,
    entityCount,
    brushCount,
    patchCount,
  };
}
