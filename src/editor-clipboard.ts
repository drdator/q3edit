import { cloneBrush, type Brush } from './brush';
import type { Editor, SelectionItem } from './editor';
import { cloneEntity, createEntity, translateEntity, type Entity } from './entity';
import { parseMap, serializeMap } from './mapfile';
import { clonePatch, type Patch } from './patch';
import type { Vec3 } from './math';

type ClipboardBuildResult = {
  entities: Entity[];
  totalItems: number;
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

function buildClipboardEntities(editor: Editor): ClipboardBuildResult {
  const selectedEntities = selectedEntitySet(editor);
  const fullEntities: Entity[] = [];
  const partialEntities = new Map<Entity, Entity>();
  let worldspawnCopy: Entity | null = null;
  const seenBrushes = new Set<Brush>();
  const seenPatches = new Set<Patch>();
  let totalItems = 0;

  for (const entity of selectedEntities) {
    if (entity === editor.worldspawn) continue;
    fullEntities.push(cloneEntity(entity));
    totalItems++;
  }

  const worldspawnTarget = (): Entity => {
    if (!worldspawnCopy) worldspawnCopy = createEntity('worldspawn');
    return worldspawnCopy;
  };

  const entityTarget = (entity: Entity): Entity => {
    if (entity === editor.worldspawn) return worldspawnTarget();
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
  if (worldspawnCopy && (worldspawnCopy.brushes.length > 0 || worldspawnCopy.patches.length > 0)) {
    entities.push(worldspawnCopy);
  }
  entities.push(...fullEntities);
  entities.push(...partialEntities.values());
  return { entities, totalItems };
}

function parseClipboardEntities(text: string): Entity[] | null {
  if (!text.trim()) return null;
  const entities = parseMap(text);
  if (entities.length === 0) return null;
  return entities;
}

function clipboardOffset(editor: Editor): Vec3 {
  const delta: Vec3 = [0, 0, 0];
  delta[editor.nudgeAxisH] += editor.gridSize;
  delta[editor.nudgeAxisV] += editor.gridSize;
  return delta;
}

function formatClipboardCount(totalItems: number): string {
  return `${totalItems} item${totalItems === 1 ? '' : 's'}`;
}

function browserClipboard(): Clipboard | null {
  return typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null;
}

export async function copySelection(editor: Editor): Promise<void> {
  const { entities, totalItems } = buildClipboardEntities(editor);
  if (entities.length === 0) {
    editor.statusMessage = 'Nothing to copy';
    return;
  }

  const text = serializeMap(entities);
  editor.clipboardText = text;

  let wroteSystemClipboard = false;
  const clipboard = browserClipboard();
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      wroteSystemClipboard = true;
    } catch {
      wroteSystemClipboard = false;
    }
  }

  editor.statusMessage = wroteSystemClipboard
    ? `Copied ${formatClipboardCount(totalItems)}`
    : `Copied ${formatClipboardCount(totalItems)} (internal clipboard)`;
}

export async function pasteClipboard(editor: Editor): Promise<void> {
  let entities: Entity[] | null = null;
  const clipboard = browserClipboard();

  if (clipboard?.readText) {
    try {
      const text = await clipboard.readText();
      const parsed = parseClipboardEntities(text);
      if (parsed) {
        entities = parsed;
        editor.clipboardText = text;
      }
    } catch {
      // Fall back to the in-memory clipboard below.
    }
  }

  if (!entities && editor.clipboardText) {
    entities = parseClipboardEntities(editor.clipboardText);
  }

  if (!entities || entities.length === 0) {
    editor.statusMessage = 'Clipboard does not contain map data';
    return;
  }

  const delta = clipboardOffset(editor);
  const newSelection: SelectionItem[] = [];
  let pastedWorldBrushes = 0;
  let pastedWorldPatches = 0;
  let pastedEntities = 0;

  editor.snapshot();

  for (const source of entities) {
    const entity = cloneEntity(source);
    translateEntity(entity, delta);

    if (entity.classname === 'worldspawn') {
      for (const brush of entity.brushes) {
        editor.worldspawn.brushes.push(brush);
        newSelection.push({ type: 'brush', entity: editor.worldspawn, brush });
        pastedWorldBrushes++;
      }
      for (const patch of entity.patches) {
        editor.worldspawn.patches.push(patch);
        newSelection.push({ type: 'patch', entity: editor.worldspawn, patch });
        pastedWorldPatches++;
      }
      continue;
    }

    editor.entities.push(entity);
    newSelection.push({ type: 'entity', entity });
    pastedEntities++;
  }

  editor.reconcileHiddenState();
  editor.selection = newSelection;
  editor.dirty = true;

  const totalItems = pastedEntities + pastedWorldBrushes + pastedWorldPatches;
  if (totalItems === 0) {
    editor.statusMessage = 'Clipboard contained no pasteable items';
    return;
  }

  const parts: string[] = [];
  if (pastedEntities > 0) parts.push(`${pastedEntities} entit${pastedEntities === 1 ? 'y' : 'ies'}`);
  if (pastedWorldBrushes > 0) parts.push(`${pastedWorldBrushes} brush${pastedWorldBrushes === 1 ? '' : 'es'}`);
  if (pastedWorldPatches > 0) parts.push(`${pastedWorldPatches} patch${pastedWorldPatches === 1 ? '' : 'es'}`);
  editor.statusMessage = `Pasted ${parts.join(', ')}`;
}
