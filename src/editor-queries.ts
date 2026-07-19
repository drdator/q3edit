import { entityOrigin, type Entity } from './entity';
import { vec3Add, vec3Max, vec3Min, vec3Scale, type Vec3 } from './math';
import type { Brush } from './brush';
import type { Patch } from './patch';
import type { Editor } from './editor';
import type { ModelManager } from './model-manager';
import { getEntityClassRegistry } from './entity-definitions';

export function* allBrushes(editor: Editor): Iterable<{ entity: Entity; brush: Brush }> {
  for (const entity of editor.entities) {
    for (const brush of entity.brushes) {
      yield { entity, brush };
    }
  }
}

export function* allPatches(editor: Editor): Iterable<{ entity: Entity; patch: Patch }> {
  for (const entity of editor.entities) {
    for (const patch of entity.patches) {
      yield { entity, patch };
    }
  }
}

export function* nonWorldspawnEntities(editor: Editor): Iterable<Entity> {
  for (let i = 1; i < editor.entities.length; i++) {
    yield editor.entities[i];
  }
}

export function hasEntityGeometry(entity: Entity): boolean {
  return entity.brushes.length > 0 || entity.patches.length > 0;
}

export function isPointEntity(entity: Entity): boolean {
  return !hasEntityGeometry(entity);
}

export function* pointEntities(editor: Editor): Iterable<Entity> {
  for (const entity of nonWorldspawnEntities(editor)) {
    if (isPointEntity(entity)) {
      yield entity;
    }
  }
}

export function entityBounds(entity: Entity, models?: ModelManager | null): { mins: Vec3; maxs: Vec3 } | null {
  let mins: Vec3 = [Infinity, Infinity, Infinity];
  let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
  let hasBounds = false;

  for (const brush of entity.brushes) {
    mins = vec3Min(mins, brush.mins);
    maxs = vec3Max(maxs, brush.maxs);
    hasBounds = true;
  }

  for (const patch of entity.patches) {
    mins = vec3Min(mins, patch.mins);
    maxs = vec3Max(maxs, patch.maxs);
    hasBounds = true;
  }

  if (hasBounds) {
    return { mins, maxs };
  }

  const modelBounds = models?.entityBounds(entity);
  if (modelBounds) return modelBounds;

  const origin = entityOrigin(entity);
  if (!origin) return null;
  const definitionBounds = getEntityClassRegistry().get(entity.classname)?.bounds;
  if (definitionBounds) {
    return {
      mins: vec3Add(origin, definitionBounds.mins),
      maxs: vec3Add(origin, definitionBounds.maxs),
    };
  }
  return { mins: origin, maxs: origin };
}

export function entityCenter(entity: Entity, models?: ModelManager | null): Vec3 | null {
  const bounds = entityBounds(entity, models);
  if (!bounds) return null;
  return vec3Scale(vec3Add(bounds.mins, bounds.maxs), 0.5);
}

export function entityDisplayOrigin(entity: Entity): Vec3 | null {
  return entityOrigin(entity) ?? entityCenter(entity);
}

export function collectSnapTargets(editor: Editor, includeSelected = false): [number[], number[], number[]] {
  const sets: [Set<number>, Set<number>, Set<number>] = [new Set(), new Set(), new Set()];

  for (const { entity, brush } of allBrushes(editor)) {
    if (!editor.isBrushInRegion(brush, entity)) continue;
    if (!includeSelected && editor.selection.some(item =>
      (item.type === 'brush' && item.brush === brush) ||
      (item.type === 'entity' && item.entity === entity)
    )) continue;
    for (const face of brush.faces) {
      for (const v of face.polygon) {
        sets[0].add(v[0]);
        sets[1].add(v[1]);
        sets[2].add(v[2]);
      }
    }
  }

  for (const { entity, patch } of allPatches(editor)) {
    if (!editor.isPatchInRegion(patch, entity)) continue;
    if (!includeSelected && editor.selection.some(item =>
      (item.type === 'patch' && item.patch === patch) ||
      (item.type === 'entity' && item.entity === entity)
    )) continue;
    for (const row of patch.ctrl) {
      for (const cp of row) {
        sets[0].add(cp.xyz[0]);
        sets[1].add(cp.xyz[1]);
        sets[2].add(cp.xyz[2]);
      }
    }
  }

  for (const entity of nonWorldspawnEntities(editor)) {
    if (!editor.isEntityInRegion(entity)) continue;
    if (!includeSelected && editor.selection.some(item => item.type === 'entity' && item.entity === entity)) continue;
    const origin = entityOrigin(entity);
    if (!origin) continue;
    sets[0].add(origin[0]);
    sets[1].add(origin[1]);
    sets[2].add(origin[2]);
  }

  return [
    [...sets[0]].sort((a, b) => a - b),
    [...sets[1]].sort((a, b) => a - b),
    [...sets[2]].sort((a, b) => a - b),
  ];
}

export function selectionBounds(editor: Editor): { mins: Vec3; maxs: Vec3 } | null {
  if (editor.selection.length === 0) return null;

  let mins: Vec3 = [Infinity, Infinity, Infinity];
  let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const item of editor.selection) {
    if (item.type === 'entity') {
      const bounds = entityBounds(item.entity, editor.modelManager);
      if (!bounds) continue;
      mins = vec3Min(mins, bounds.mins);
      maxs = vec3Max(maxs, bounds.maxs);
      continue;
    }

    if (item.type === 'patch') {
      mins = vec3Min(mins, item.patch.mins);
      maxs = vec3Max(maxs, item.patch.maxs);
      continue;
    }

    mins = vec3Min(mins, item.brush.mins);
    maxs = vec3Max(maxs, item.brush.maxs);
  }

  return { mins, maxs };
}

export function selectionCenter(editor: Editor): Vec3 | null {
  const bounds = selectionBounds(editor);
  if (!bounds) return null;
  return vec3Scale(vec3Add(bounds.mins, bounds.maxs), 0.5);
}
