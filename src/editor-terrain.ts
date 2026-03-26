import type { Editor } from './editor';
import { createGridPatch, tessellatePatch, type Patch } from './patch';

export type TerrainFalloff = 'smooth' | 'linear';

function terrainSubPatchesForExtent(extent: number, gridSize: number): number {
  const cellSize = Math.max(gridSize * 4, 32);
  return Math.max(1, Math.min(16, Math.round(extent / cellSize)));
}

function terrainHeightAxis(patch: Patch): number {
  const extents = [
    patch.maxs[0] - patch.mins[0],
    patch.maxs[1] - patch.mins[1],
    patch.maxs[2] - patch.mins[2],
  ];
  let axis = 0;
  for (let i = 1; i < 3; i++) {
    if (extents[i] < extents[axis]) axis = i;
  }
  return axis;
}

function terrainPlanarAxes(heightAxis: number): [number, number] {
  if (heightAxis === 0) return [1, 2];
  if (heightAxis === 1) return [0, 2];
  return [0, 1];
}

function terrainRadius(editor: Editor): number {
  return Math.max(8, editor.terrainBrushRadius);
}

function terrainStrength(editor: Editor): number {
  return Math.max(1, editor.terrainBrushStrength);
}

function terrainBrushWeight(distance: number, radius: number, falloff: TerrainFalloff): number {
  if (distance >= radius) return 0;
  const t = distance / radius;
  if (falloff === 'linear') return 1 - t;
  return 1 - t * t * (3 - 2 * t);
}

type SelectedTerrainCenter = {
  dataIndex: number;
  row: number;
  col: number;
};

type TerrainBrushAnchor = {
  dataIndex: number;
  point: [number, number, number];
};

function selectedTerrainCenters(editor: Editor): SelectedTerrainCenter[] {
  if (!editor.patchEditMode || editor.patchControlSelection.length === 0) return [];
  return editor.patchControlSelection.map(cp => ({
    dataIndex: cp.dataIndex,
    row: cp.row,
    col: cp.col,
  }));
}

function cursorTerrainAnchors(editor: Editor): TerrainBrushAnchor[] {
  if (!editor.patchEditMode || !editor.terrainBrushCenter || !editor.terrainBrushAxes) return [];
  const [brushAxisH, brushAxisV] = editor.terrainBrushAxes;
  const point = [...editor.terrainBrushCenter] as [number, number, number];
  const anchors: TerrainBrushAnchor[] = [];

  for (let dataIndex = 0; dataIndex < editor.patchEditData.length; dataIndex++) {
    const patch = editor.patchEditData[dataIndex]?.patch;
    if (!patch) continue;
    const [axisA, axisB] = terrainPlanarAxes(terrainHeightAxis(patch));
    const matchesAxes = (brushAxisH === axisA && brushAxisV === axisB)
      || (brushAxisH === axisB && brushAxisV === axisA);
    if (!matchesAxes) continue;
    anchors.push({ dataIndex, point });
  }

  return anchors;
}

function selectedTerrainAnchors(editor: Editor): TerrainBrushAnchor[] {
  const centers = selectedTerrainCenters(editor);
  const anchors: TerrainBrushAnchor[] = [];
  for (const center of centers) {
    const patch = editor.patchEditData[center.dataIndex]?.patch;
    const point = patch?.ctrl[center.row]?.[center.col]?.xyz;
    if (!point) continue;
    anchors.push({
      dataIndex: center.dataIndex,
      point: [...point] as [number, number, number],
    });
  }
  return anchors;
}

function selectedTerrainPointSets(editor: Editor): Map<number, Set<string>> {
  const selected = new Map<number, Set<string>>();
  for (const center of selectedTerrainCenters(editor)) {
    const items = selected.get(center.dataIndex) ?? new Set<string>();
    items.add(`${center.row}:${center.col}`);
    selected.set(center.dataIndex, items);
  }
  return selected;
}

function ensureTerrainAnchors(editor: Editor): TerrainBrushAnchor[] | null {
  if (!editor.patchEditMode || editor.patchEditData.length === 0) {
    editor.statusMessage = 'Enter patch edit mode to sculpt terrain';
    return null;
  }

  const cursorAnchors = cursorTerrainAnchors(editor);
  if (cursorAnchors.length > 0) return cursorAnchors;

  const selectedAnchors = selectedTerrainAnchors(editor);
  if (selectedAnchors.length > 0) return selectedAnchors;

  editor.statusMessage = 'Hover terrain in a matching 2D view or select terrain control points';
  return null;
}

export function createTerrainPatch(editor: Editor): void {
  const bounds = editor.selectionBounds();
  if (!bounds) {
    editor.statusMessage = 'Select bounds for terrain creation';
    return;
  }

  const axisH = editor.nudgeAxisH;
  const axisV = editor.nudgeAxisV;
  const axisDepth = editor.rotationAxis;
  const width = terrainSubPatchesForExtent(bounds.maxs[axisH] - bounds.mins[axisH], editor.gridSize) * 2 + 1;
  const height = terrainSubPatchesForExtent(bounds.maxs[axisV] - bounds.mins[axisV], editor.gridSize) * 2 + 1;

  editor.snapshot();
  const patch = createGridPatch(bounds.mins, bounds.maxs, editor.currentTexture, width, height, axisH, axisV, axisDepth);
  editor.worldspawn.patches.push(patch);
  editor.selection = [{ type: 'patch', entity: editor.worldspawn, patch }];
  editor.enterPatchEditMode();

  const centerRow = Math.floor(height / 2);
  const centerCol = Math.floor(width / 2);
  editor.patchControlSelection = [{ dataIndex: 0, row: centerRow, col: centerCol }];
  editor.terrainBrushCenter = null;
  editor.terrainBrushAxes = null;
  editor.dirty = true;
  editor.statusMessage = `Created terrain patch ${width}x${height} (Alt drag sculpt, Alt+Shift/Ctrl+Alt paint)`;
}

export function raiseTerrain(editor: Editor): void {
  sculptTerrain(editor, terrainStrength(editor));
}

export function lowerTerrain(editor: Editor): void {
  sculptTerrain(editor, -terrainStrength(editor));
}

export function sculptTerrain(editor: Editor, amount: number, takeSnapshot = true, selectedOnly = false): void {
  if (amount === 0) return;
  const anchors = ensureTerrainAnchors(editor);
  if (!anchors) return;

  const radius = terrainRadius(editor);
  const falloff = editor.terrainFalloff;
  const anchorsByPatch = new Map<number, TerrainBrushAnchor[]>();
  for (const anchor of anchors) {
    const items = anchorsByPatch.get(anchor.dataIndex) ?? [];
    items.push(anchor);
    anchorsByPatch.set(anchor.dataIndex, items);
  }
  const selectedPointsByPatch = selectedOnly ? selectedTerrainPointSets(editor) : null;

  if (takeSnapshot) editor.snapshot();

  for (const [dataIndex, patchAnchors] of anchorsByPatch) {
    const data = editor.patchEditData[dataIndex];
    if (!data) continue;
    const patch = data.patch;
    const heightAxis = terrainHeightAxis(patch);
    const [axisA, axisB] = terrainPlanarAxes(heightAxis);
    const original = patch.ctrl.map(row => row.map(cp => [...cp.xyz] as [number, number, number]));

    for (let row = 0; row < patch.height; row++) {
      for (let col = 0; col < patch.width; col++) {
        const selectedPoints = selectedPointsByPatch?.get(dataIndex);
        if (selectedPoints && selectedPoints.size > 0 && !selectedPoints.has(`${row}:${col}`)) continue;
        const point = original[row][col];
        let weight = 0;
        for (const anchor of patchAnchors) {
          const dx = point[axisA] - anchor.point[axisA];
          const dy = point[axisB] - anchor.point[axisB];
          weight = Math.max(weight, terrainBrushWeight(Math.hypot(dx, dy), radius, falloff));
        }
        if (weight <= 0) continue;
        patch.ctrl[row][col].xyz[heightAxis] = point[heightAxis] + amount * weight;
      }
    }

    tessellatePatch(patch);
  }

  editor.dirty = true;
  editor.statusMessage = `${amount > 0 ? 'Raised' : 'Lowered'} terrain (${Math.abs(amount).toFixed(1)}, r=${radius}, s=${terrainStrength(editor)}, ${falloff})`;
}

export function smoothTerrain(editor: Editor): void {
  const anchors = ensureTerrainAnchors(editor);
  if (!anchors) return;

  const radius = terrainRadius(editor);
  const falloff = editor.terrainFalloff;
  const anchorsByPatch = new Map<number, TerrainBrushAnchor[]>();
  for (const anchor of anchors) {
    const items = anchorsByPatch.get(anchor.dataIndex) ?? [];
    items.push(anchor);
    anchorsByPatch.set(anchor.dataIndex, items);
  }

  editor.snapshot();

  for (const [dataIndex, patchAnchors] of anchorsByPatch) {
    const data = editor.patchEditData[dataIndex];
    if (!data) continue;
    const patch = data.patch;
    const heightAxis = terrainHeightAxis(patch);
    const [axisA, axisB] = terrainPlanarAxes(heightAxis);
    const original = patch.ctrl.map(row => row.map(cp => [...cp.xyz] as [number, number, number]));

    for (let row = 0; row < patch.height; row++) {
      for (let col = 0; col < patch.width; col++) {
        const point = original[row][col];
        let weight = 0;
        for (const anchor of patchAnchors) {
          const dx = point[axisA] - anchor.point[axisA];
          const dy = point[axisB] - anchor.point[axisB];
          weight = Math.max(weight, terrainBrushWeight(Math.hypot(dx, dy), radius, falloff));
        }
        if (weight <= 0) continue;

        let sum = 0;
        let count = 0;
        for (let nr = Math.max(0, row - 1); nr <= Math.min(patch.height - 1, row + 1); nr++) {
          for (let nc = Math.max(0, col - 1); nc <= Math.min(patch.width - 1, col + 1); nc++) {
            if (nr === row && nc === col) continue;
            sum += original[nr][nc][heightAxis];
            count++;
          }
        }
        if (count === 0) continue;

        const average = sum / count;
        patch.ctrl[row][col].xyz[heightAxis] = point[heightAxis] + (average - point[heightAxis]) * weight * 0.6;
      }
    }

    tessellatePatch(patch);
  }

  editor.dirty = true;
  editor.statusMessage = `Smoothed terrain (r=${radius}, ${falloff})`;
}

export function currentTerrainRadius(editor: Editor): number {
  return terrainRadius(editor);
}

export function currentTerrainStrength(editor: Editor): number {
  return terrainStrength(editor);
}

export function adjustTerrainRadius(editor: Editor, delta: number): void {
  const next = Math.max(8, Math.min(1024, editor.terrainBrushRadius + delta));
  if (next === editor.terrainBrushRadius) return;
  editor.terrainBrushRadius = next;
  editor.dirty = true;
  editor.statusMessage = `Terrain radius: ${editor.terrainBrushRadius}`;
}

export function adjustTerrainStrength(editor: Editor, delta: number): void {
  const next = Math.max(1, Math.min(256, editor.terrainBrushStrength + delta));
  if (next === editor.terrainBrushStrength) return;
  editor.terrainBrushStrength = next;
  editor.dirty = true;
  editor.statusMessage = `Terrain strength: ${editor.terrainBrushStrength}`;
}

export function cycleTerrainFalloff(editor: Editor): void {
  editor.terrainFalloff = editor.terrainFalloff === 'smooth' ? 'linear' : 'smooth';
  editor.dirty = true;
  editor.statusMessage = `Terrain falloff: ${editor.terrainFalloff}`;
}
