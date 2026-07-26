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
  naturalizePatchUVByDistance,
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

type PatchEdge = Array<Patch['ctrl'][number][number]>;

function patchEdges(patch: Patch): PatchEdge[] {
  return [
    patch.ctrl[0],
    patch.ctrl[patch.height - 1],
    patch.ctrl.map(row => row[0]),
    patch.ctrl.map(row => row[patch.width - 1]),
  ];
}

function endpointDistance(a: PatchEdge, b: PatchEdge, reverse: boolean): number {
  const first = reverse ? b[b.length - 1] : b[0];
  const last = reverse ? b[0] : b[b.length - 1];
  return Math.hypot(...a[0].xyz.map((value, axis) => value - first.xyz[axis]))
    + Math.hypot(...a[a.length - 1].xyz.map((value, axis) => value - last.xyz[axis]));
}

export function alignSelectedPatchBoundaries(editor: Editor): boolean {
  const items = getSelectedPatchItems(editor);
  if (items.length !== 2 || items.some(item => isTerrainMesh(item.patch))) return false;
  return editor.transact('Align patch UV boundary', () => {
    const sourceEdges = patchEdges(items[0].patch);
    const targetEdges = patchEdges(items[1].patch);
    let best: { source: PatchEdge; target: PatchEdge; reverse: boolean; distance: number } | null = null;
    for (const source of sourceEdges) for (const target of targetEdges) for (const reverse of [false, true]) {
      const distance = endpointDistance(source, target, reverse);
      if (!best || distance < best.distance) best = { source, target, reverse, distance };
    }
    if (!best || best.distance > 2) {
      editor.statusMessage = best
        ? `Selected patch boundaries are ${best.distance.toFixed(2)} units apart`
        : 'No corresponding patch boundaries found';
      return false;
    }
    const source = best.source;
    const target = best.reverse ? [...best.target].reverse() : best.target;
    target.forEach((point, index) => {
      const position = index / Math.max(1, target.length - 1) * (source.length - 1);
      const lower = Math.floor(position); const upper = Math.min(source.length - 1, Math.ceil(position));
      const blend = position - lower;
      point.uv = source[lower].uv.map((value, axis) => value + (source[upper].uv[axis] - value) * blend) as [number, number];
    });
    tessellatePatch(items[1].patch);
    editor.redrawRequested = true;
    editor.statusMessage = `Aligned patch UV boundary (${best.distance.toFixed(2)} endpoint units)`;
    return true;
  });
}

export function copySelectedPatchUV(editor: Editor): number {
  const items = getSelectedPatchItems(editor);
  if (items.length < 2 || items.some(item => isTerrainMesh(item.patch))) return 0;
  return editor.transact('Copy patch UV parameters', () => {
    const source = items[0].patch;
    for (const { patch } of items.slice(1)) {
      for (let row = 0; row < patch.height; row++) for (let col = 0; col < patch.width; col++) {
        const sourceRow = Math.round(row / Math.max(1, patch.height - 1) * (source.height - 1));
        const sourceCol = Math.round(col / Math.max(1, patch.width - 1) * (source.width - 1));
        patch.ctrl[row][col].uv = [...source.ctrl[sourceRow][sourceCol].uv];
      }
      tessellatePatch(patch);
    }
    editor.redrawRequested = true;
    return items.length - 1;
  });
}

export function naturalizeSelectedPatchesByDistance(editor: Editor, unitsPerRepeat: number): void {
  const items = getSelectedPatchItems(editor);
  if (!items.length || !Number.isFinite(unitsPerRepeat) || unitsPerRepeat <= 0) return;
  editor.transact('Natural patch UV by distance', () => {
    for (const item of items) naturalizePatchUVByDistance(item.patch, unitsPerRepeat);
    editor.redrawRequested = true;
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
