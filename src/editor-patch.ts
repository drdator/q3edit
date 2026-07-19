import {
  type Patch,
  createBevelPatch,
  createConePatch,
  createCylinderPatch,
  createEndcapPatch,
  createFlatPatch,
  tessellatePatch,
} from './patch';
import type { Entity } from './entity';
import type { Vec3 } from './math';
import { getSelectedPatchItems } from './editor-selection';
import type { Editor } from './editor';
import { stitchSelectedTerrainControlSeams } from './editor-terrain';
import {
  createPatchMatrix, cyclePatchCap, deletePatchColumns, deletePatchRows, fitPatchUV, insertPatchColumns,
  insertPatchRows, invertPatch, naturalizePatchUV, redispersePatchColumns,
  redispersePatchRows, thickenPatch, transformPatchUV, transposePatch,
} from './patch-operations';
import { convertTerrainToBezierPatch, isTerrainMesh } from './terrain-model';

export type PatchOperation = 'insert-rows' | 'delete-rows' | 'insert-columns' | 'delete-columns'
  | 'transpose' | 'invert' | 'redisperse-rows' | 'redisperse-columns'
  | 'cycle-cap' | 'naturalize' | 'fit' | 'shift-u' | 'shift-v' | 'scale-up' | 'scale-down' | 'rotate';

export function createPatch(
  editor: Editor,
  preset: 'flat' | 'cylinder' | 'cone' | 'bevel' | 'endcap',
): void {
  const bounds = editor.selectionBounds();
  if (!bounds) {
    editor.statusMessage = 'Select a brush first';
    return;
  }
  editor.transact(`Create ${preset} patch`, () => {
    const { mins, maxs } = bounds;
    const texture = editor.currentTexture;
    const creators = {
      flat: createFlatPatch,
      cylinder: createCylinderPatch,
      cone: createConePatch,
      bevel: createBevelPatch,
      endcap: createEndcapPatch,
    };
    const patch = creators[preset](mins, maxs, texture);
    editor.worldspawn.patches.push(patch);
    editor.selection = [{ type: 'patch', entity: editor.worldspawn, patch }];
    editor.redrawRequested = true;
    editor.statusMessage = `Created ${preset} patch`;
  });
}

export function changeSubdivisions(editor: Editor, delta: number): void {
  const patchItems = getSelectedPatchItems(editor);
  if (patchItems.length === 0) return;
  editor.transact('Change patch subdivisions', () => {
    for (const item of patchItems) {
      const subdivisions = Math.max(1, Math.min(24, item.patch.subdivisions + delta));
      item.patch.subdivisions = subdivisions;
      tessellatePatch(item.patch);
    }
    const level = patchItems[0].patch.subdivisions;
    editor.redrawRequested = true;
    editor.statusMessage = `Subdivisions: ${level}`;
  }, { coalesceKey: 'patch-subdivisions' });
}

export function applyPatchOperation(editor: Editor, operation: PatchOperation): void {
  const items = getSelectedPatchItems(editor); if (!items.length) return;
  if (items.some(item => isTerrainMesh(item.patch))) {
    editor.statusMessage = 'Generic patch tools cannot edit terrainDef. Convert terrain to patchDef2 first.';
    return;
  }
  const operations: Record<PatchOperation, (patch: Patch) => void> = {
    'insert-rows': insertPatchRows, 'delete-rows': deletePatchRows,
    'insert-columns': insertPatchColumns, 'delete-columns': deletePatchColumns,
    transpose: transposePatch, invert: invertPatch,
    'cycle-cap': cyclePatchCap,
    'redisperse-rows': redispersePatchRows, 'redisperse-columns': redispersePatchColumns,
    naturalize: naturalizePatchUV, fit: fitPatchUV,
    'shift-u': patch => transformPatchUV(patch, [0.125, 0], [1, 1], 0),
    'shift-v': patch => transformPatchUV(patch, [0, 0.125], [1, 1], 0),
    'scale-up': patch => transformPatchUV(patch, [0, 0], [2, 2], 0),
    'scale-down': patch => transformPatchUV(patch, [0, 0], [0.5, 0.5], 0),
    rotate: patch => transformPatchUV(patch, [0, 0], [1, 1], 90),
  };
  editor.transact(`Patch ${operation}`, () => {
    for (const item of items) operations[operation](item.patch);
    editor.redrawRequested = true; editor.statusMessage = `Patch: ${operation}`;
  });
}

export function convertSelectedTerrainToPatch(editor: Editor): void {
  const items = getSelectedPatchItems(editor).filter(item => isTerrainMesh(item.patch));
  if (!items.length) {
    editor.statusMessage = 'Select terrainDef terrain to convert';
    return;
  }
  editor.transact('Convert terrain to patchDef2', () => {
    for (const item of items) convertTerrainToBezierPatch(item.patch);
    editor.redrawRequested = true;
    editor.statusMessage = `Converted ${items.length} terrain ${items.length === 1 ? 'mesh' : 'meshes'} to patchDef2`;
  });
}

export function createMatrixPatch(editor: Editor, width: number, height: number): void {
  const bounds = editor.selectionBounds(); if (!bounds) return;
  editor.transact(`Create ${width}x${height} patch`, () => {
    const patch = createPatchMatrix(bounds.mins, bounds.maxs, editor.currentTexture, width, height);
    editor.worldspawn.patches.push(patch); editor.selection = [{ type: 'patch', entity: editor.worldspawn, patch }]; editor.redrawRequested = true;
  });
}

export function thickenSelectedPatches(editor: Editor, amount = 16): void {
  const items = getSelectedPatchItems(editor); if (!items.length) return;
  editor.transact('Thicken patches', () => {
    const selection: typeof editor.selection = [];
    for (const item of items) {
      const index = item.entity.patches.indexOf(item.patch); if (index < 0) continue;
      const thickened = thickenPatch(item.patch, amount, true);
      item.entity.patches.splice(index, 1, ...thickened);
      selection.push(...thickened.map(patch => ({ type: 'patch' as const, entity: item.entity, patch })));
    }
    editor.selection = selection; editor.redrawRequested = true;
  });
}

export function updatePatchProperties(editor: Editor, patch: Patch, changes: Partial<Pick<Patch, 'texture' | 'subdivisions' | 'contentFlags' | 'surfaceFlags' | 'value'>>): void {
  editor.transact('Edit patch properties', () => {
    Object.assign(patch, changes); patch.subdivisions = Math.max(1, Math.min(24, patch.subdivisions)); tessellatePatch(patch); editor.redrawRequested = true;
  });
}

export function enterPatchEditMode(editor: Editor): void {
  const patchItems = getSelectedPatchItems(editor);
  if (patchItems.length === 0) return;

  editor.patchEditData = [];
  const seen = new Set<Patch>();
  for (const item of patchItems) {
    if (seen.has(item.patch)) continue;
    seen.add(item.patch);
    editor.patchEditData.push({ patch: item.patch, entity: item.entity });
  }

  editor.patchEditMode = true;
  editor.patchControlSelection = [];
  editor.terrainBrushCenter = null;
  editor.terrainBrushAxes = null;
  editor.redrawRequested = true;
  editor.statusMessage = 'Patch edit mode';
}

export function exitPatchEditMode(editor: Editor): void {
  if (!editor.patchEditMode) return;
  for (const data of editor.patchEditData) {
    tessellatePatch(data.patch);
  }
  editor.patchEditMode = false;
  editor.patchEditData = [];
  editor.patchControlSelection = [];
  editor.terrainBrushCenter = null;
  editor.terrainBrushAxes = null;
  editor.redrawRequested = true;
}

export function selectControlPoint(
  editor: Editor,
  dataIndex: number,
  row: number,
  col: number,
  additive = false,
): void {
  if (!additive) editor.patchControlSelection = [];
  const idx = editor.patchControlSelection.findIndex(
    cp => cp.dataIndex === dataIndex && cp.row === row && cp.col === col
  );
  if (idx >= 0) {
    if (additive) editor.patchControlSelection.splice(idx, 1);
    return;
  }
  editor.patchControlSelection.push({ dataIndex, row, col });
  editor.redrawRequested = true;
}

export function clearControlPointSelection(editor: Editor): void {
  editor.patchControlSelection = [];
  editor.redrawRequested = true;
}

export function isControlPointSelected(editor: Editor, dataIndex: number, row: number, col: number): boolean {
  return editor.patchControlSelection.some(
    cp => cp.dataIndex === dataIndex && cp.row === row && cp.col === col
  );
}

export function moveSelectedControlPoints(editor: Editor, delta: Vec3): void {
  if (editor.patchControlSelection.length === 0) return;

  editor.transact('Move patch control points', () => {
    const affectedPatches = new Set<number>();
    for (const controlPoint of editor.patchControlSelection) {
      const data = editor.patchEditData[controlPoint.dataIndex];
      if (!data) continue;
      const point = data.patch.ctrl[controlPoint.row][controlPoint.col];
      point.xyz[0] += delta[0];
      point.xyz[1] += delta[1];
      point.xyz[2] += delta[2];
      affectedPatches.add(controlPoint.dataIndex);
    }

    for (const dataIndex of affectedPatches) {
      tessellatePatch(editor.patchEditData[dataIndex].patch);
    }
    stitchSelectedTerrainControlSeams(editor);
    editor.redrawRequested = true;
  }, { coalesceKey: 'move-patch-control-points' });
}

export function patchControlSelectionCenter(editor: Editor): Vec3 | null {
  if (editor.patchControlSelection.length === 0) return null;
  let sum: Vec3 = [0, 0, 0];
  for (const controlPoint of editor.patchControlSelection) {
    const data = editor.patchEditData[controlPoint.dataIndex];
    if (!data) continue;
    const position = data.patch.ctrl[controlPoint.row][controlPoint.col].xyz;
    sum[0] += position[0];
    sum[1] += position[1];
    sum[2] += position[2];
  }
  const count = editor.patchControlSelection.length;
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}
