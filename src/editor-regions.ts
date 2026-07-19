import type { Brush } from './brush';
import { cloneBrush, createBoxBrush } from './brush';
import { createEntity, entityOrigin, type Entity } from './entity';
import { entityBounds as getEntityBounds, hasEntityGeometry, selectionBounds as getSelectionBounds } from './editor-queries';
import type { Editor } from './editor';
import { serializeMap as serializeEntities } from './mapfile';
import type { Vec3 } from './math';
import type { Patch } from './patch';
import { clonePatch } from './patch';
import { getSelectedBrushItems } from './editor-selection';
import { isGroupInfoEntity } from './named-groups';

export interface RegionBounds {
  mins: Vec3;
  maxs: Vec3;
}

interface RegionExportOptions {
  addCompileBoundaryBrushes?: boolean;
}

const REGION_COMPILE_WALL_THICKNESS = 16;
const REGION_COMPILE_WALL_OVERLAP = 1;
export const REGION_WORLD_LIMIT = 65536;
const REGION_BOUNDARY_TEXTURE = 'common/caulk';

function boundsIntersectRegion(bounds: RegionBounds, region: RegionBounds): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (bounds.mins[axis] > region.maxs[axis]) return false;
    if (bounds.maxs[axis] < region.mins[axis]) return false;
  }
  return true;
}

function pointInRegion(point: Vec3, region: RegionBounds): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (point[axis] < region.mins[axis] || point[axis] > region.maxs[axis]) return false;
  }
  return true;
}

function cloneEntityShell(entity: Entity): Entity {
  return {
    classname: entity.classname,
    properties: { ...entity.properties },
    brushes: [],
    patches: [],
  };
}

function buildCompileBoundaryBrushes(region: RegionBounds): Brush[] {
  const minX = region.mins[0];
  const maxX = region.maxs[0];
  const minY = region.mins[1];
  const maxY = region.maxs[1];
  const minZ = -REGION_WORLD_LIMIT;
  const maxZ = REGION_WORLD_LIMIT;

  return [
    createBoxBrush(
      [minX - REGION_COMPILE_WALL_THICKNESS, minY - REGION_COMPILE_WALL_THICKNESS, minZ],
      [minX + REGION_COMPILE_WALL_OVERLAP, maxY + REGION_COMPILE_WALL_THICKNESS, maxZ],
      REGION_BOUNDARY_TEXTURE,
    ),
    createBoxBrush(
      [maxX - REGION_COMPILE_WALL_OVERLAP, minY - REGION_COMPILE_WALL_THICKNESS, minZ],
      [maxX + REGION_COMPILE_WALL_THICKNESS, maxY + REGION_COMPILE_WALL_THICKNESS, maxZ],
      REGION_BOUNDARY_TEXTURE,
    ),
    createBoxBrush(
      [minX - REGION_COMPILE_WALL_THICKNESS, minY - REGION_COMPILE_WALL_THICKNESS, minZ],
      [maxX + REGION_COMPILE_WALL_THICKNESS, minY + REGION_COMPILE_WALL_OVERLAP, maxZ],
      REGION_BOUNDARY_TEXTURE,
    ),
    createBoxBrush(
      [minX - REGION_COMPILE_WALL_THICKNESS, maxY - REGION_COMPILE_WALL_OVERLAP, minZ],
      [maxX + REGION_COMPILE_WALL_THICKNESS, maxY + REGION_COMPILE_WALL_THICKNESS, maxZ],
      REGION_BOUNDARY_TEXTURE,
    ),
  ];
}

export function isRegionActive(editor: Editor): boolean {
  return editor.regionBounds !== null;
}

export function setRegionFromSelection(editor: Editor): void {
  const bounds = getSelectionBounds(editor);
  if (!bounds) {
    editor.statusMessage = 'No selection for region';
    return;
  }

  editor.regionBounds = {
    mins: [...bounds.mins] as Vec3,
    maxs: [...bounds.maxs] as Vec3,
  };
  editor.redrawRequested = true;
  editor.statusMessage = 'Region set from selection';
}

export function setRegionFromCurrentXYView(editor: Editor): void {
  if (!editor.activeXYViewBounds) {
    editor.statusMessage = 'Activate the XY viewport first';
    return;
  }
  editor.regionBounds = {
    mins: [...editor.activeXYViewBounds.mins] as Vec3,
    maxs: [...editor.activeXYViewBounds.maxs] as Vec3,
  };
  editor.redrawRequested = true;
  editor.statusMessage = 'Region set from current XY view';
}

export function setRegionFromSingleBrush(editor: Editor): void {
  const brushes = getSelectedBrushItems(editor);
  if (brushes.length !== 1) {
    editor.statusMessage = 'Select exactly one brush for the region';
    return;
  }
  editor.regionBounds = {
    mins: [...brushes[0].brush.mins] as Vec3,
    maxs: [...brushes[0].brush.maxs] as Vec3,
  };
  editor.redrawRequested = true;
  editor.statusMessage = 'Region set from brush';
}

export function setRegionFromTallSelection(editor: Editor): void {
  const bounds = getSelectionBounds(editor);
  if (!bounds) {
    editor.statusMessage = 'No selection for tall region';
    return;
  }
  editor.regionBounds = {
    mins: [bounds.mins[0], bounds.mins[1], -REGION_WORLD_LIMIT],
    maxs: [bounds.maxs[0], bounds.maxs[1], REGION_WORLD_LIMIT],
  };
  editor.redrawRequested = true;
  editor.statusMessage = 'Tall region set from selection';
}

export function clearRegion(editor: Editor): void {
  if (!editor.regionBounds) {
    editor.statusMessage = 'No active region';
    return;
  }

  editor.regionBounds = null;
  editor.redrawRequested = true;
  editor.statusMessage = 'Region cleared';
}

export function isBrushInRegion(editor: Editor, brush: Brush, _entity?: Entity): boolean {
  if (!editor.regionBounds) return true;
  return boundsIntersectRegion({ mins: brush.mins, maxs: brush.maxs }, editor.regionBounds);
}

export function isPatchInRegion(editor: Editor, patch: Patch, _entity?: Entity): boolean {
  if (!editor.regionBounds) return true;
  return boundsIntersectRegion({ mins: patch.mins, maxs: patch.maxs }, editor.regionBounds);
}

export function isEntityInRegion(editor: Editor, entity: Entity): boolean {
  if (!editor.regionBounds) return true;

  if (hasEntityGeometry(entity)) {
    return entity.brushes.some(brush => isBrushInRegion(editor, brush)) ||
      entity.patches.some(patch => isPatchInRegion(editor, patch));
  }

  const origin = entityOrigin(entity);
  if (origin) {
    return pointInRegion(origin, editor.regionBounds);
  }

  const bounds = getEntityBounds(entity);
  return bounds ? boundsIntersectRegion(bounds, editor.regionBounds) : false;
}

export function collectRegionEntities(editor: Editor, options: RegionExportOptions = {}): Entity[] {
  if (!editor.regionBounds) {
    return editor.entities.map(cloneEntityShell).map((entity, index) => {
      entity.brushes = editor.entities[index].brushes.map(cloneBrush);
      entity.patches = editor.entities[index].patches.map(clonePatch);
      return entity;
    });
  }

  const sourceWorldspawn = editor.entities[0];
  const worldspawn = sourceWorldspawn ? cloneEntityShell(sourceWorldspawn) : createEntity('worldspawn');
  if (sourceWorldspawn) {
    for (const brush of sourceWorldspawn.brushes) {
      if (isBrushInRegion(editor, brush)) worldspawn.brushes.push(cloneBrush(brush));
    }
    for (const patch of sourceWorldspawn.patches) {
      if (isPatchInRegion(editor, patch)) worldspawn.patches.push(clonePatch(patch));
    }
  }
  if (options.addCompileBoundaryBrushes) {
    worldspawn.brushes.push(...buildCompileBoundaryBrushes(editor.regionBounds));
  }

  const entities: Entity[] = [worldspawn];

  for (let i = 1; i < editor.entities.length; i++) {
    const source = editor.entities[i];
    if (isGroupInfoEntity(source)) {
      entities.push(cloneEntityShell(source));
      continue;
    }
    if (!isEntityInRegion(editor, source)) continue;

    if (!hasEntityGeometry(source)) {
      entities.push(cloneEntityShell(source));
      continue;
    }

    const entity = cloneEntityShell(source);
    for (const brush of source.brushes) {
      if (isBrushInRegion(editor, brush)) entity.brushes.push(cloneBrush(brush));
    }
    for (const patch of source.patches) {
      if (isPatchInRegion(editor, patch)) entity.patches.push(clonePatch(patch));
    }
    if (entity.brushes.length > 0 || entity.patches.length > 0) {
      entities.push(entity);
    }
  }

  return entities;
}

export function serializeRegionMap(editor: Editor, options: RegionExportOptions = {}): string {
  return serializeEntities(collectRegionEntities(editor, options));
}

export function saveRegionToFile(editor: Editor): void {
  if (!editor.regionBounds) {
    editor.statusMessage = 'Set a region before saving';
    return;
  }
  try {
    const text = serializeRegionMap(editor);
    const stem = editor.fileName.replace(/\.[^.]+$/, '') || 'untitled';
    const fileName = `${stem}-region.map`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = fileName; link.click();
    URL.revokeObjectURL(url);
    editor.statusMessage = `Saved ${fileName}`;
  } catch (error) {
    editor.statusMessage = error instanceof Error ? `Region save failed: ${error.message}` : 'Region save failed';
  }
}
