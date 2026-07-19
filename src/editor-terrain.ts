import type { Editor } from './editor';
import { getSelectedPatchItems } from './editor-selection';
import {
  createGridPatch,
  createTerrainDefGridPatch,
  setPatchTexture,
  syncTerrainDefMetadata,
  terrainDefCellTexture,
  terrainDefDisplayTexture,
  terrainPaintNeedsPreparation,
  tessellatePatch,
  type Patch,
  type TerrainDefSurface,
} from './patch';

export type TerrainFalloff = 'smooth' | 'linear';
export type TerrainBrushMode = 'height' | 'texture';

export type TerrainSampleChanges = Partial<TerrainDefSurface> & { height?: number };

let nextTerrainGroupId = 1;

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

function canonicalTerrainTexture(texture: string): string {
  return texture.trim().replace(/\\/g, '/').replace(/^textures\//i, '');
}

function createTerrainGroupId(): string {
  return `terrain-${nextTerrainGroupId++}`;
}

function terrainCoordKey(coord: [number, number]): string {
  return `${coord[0]}:${coord[1]}`;
}

function assignTerrainCoords(patch: Patch): void {
  for (let row = 0; row < patch.height; row++) {
    for (let col = 0; col < patch.width; col++) {
      patch.ctrl[row][col].terrainCoord = [row, col];
    }
  }
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

type TerrainTouchedPoint = {
  dataIndex: number;
  row: number;
  col: number;
};

export type TerrainPaintTarget = {
  patch: Patch;
  type: 'patch' | 'cell';
  row: number;
  col: number;
  mins: [number, number, number];
  maxs: [number, number, number];
  texture: string;
  needsPreparation: boolean;
};

type TerrainSeamSmoothMode = 'neutral' | 'raise' | 'lower';

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

function ensureTerrainAnchorsPreferSelection(editor: Editor): TerrainBrushAnchor[] | null {
  if (!editor.patchEditMode || editor.patchEditData.length === 0) {
    editor.statusMessage = 'Enter patch edit mode to sculpt terrain';
    return null;
  }

  const selectedAnchors = selectedTerrainAnchors(editor);
  if (selectedAnchors.length > 0) return selectedAnchors;

  const cursorAnchors = cursorTerrainAnchors(editor);
  if (cursorAnchors.length > 0) return cursorAnchors;

  return [];
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

function terrainPatchDistanceToPoint(patch: Patch, point: [number, number, number]): number {
  const [axisA, axisB] = terrainPlanarAxes(terrainHeightAxis(patch));
  const clampedA = Math.max(patch.mins[axisA], Math.min(point[axisA], patch.maxs[axisA]));
  const clampedB = Math.max(patch.mins[axisB], Math.min(point[axisB], patch.maxs[axisB]));
  return Math.hypot(point[axisA] - clampedA, point[axisB] - clampedB);
}

function terrainPaintTargetBounds(points: Patch['ctrl'][number][number][]): {
  mins: [number, number, number];
  maxs: [number, number, number];
} {
  const mins: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxs: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis++) {
      mins[axis] = Math.min(mins[axis], point.xyz[axis]);
      maxs[axis] = Math.max(maxs[axis], point.xyz[axis]);
    }
  }
  return { mins, maxs };
}

function terrainPatchPaintTarget(patch: Patch): TerrainPaintTarget {
  return {
    patch,
    type: 'patch',
    row: 0,
    col: 0,
    mins: [patch.mins[0], patch.mins[1], patch.mins[2]],
    maxs: [patch.maxs[0], patch.maxs[1], patch.maxs[2]],
    texture: patch.texture,
    needsPreparation: terrainPaintNeedsPreparation(patch),
  };
}

function terrainDefCellPaintTarget(patch: Patch, row: number, col: number): TerrainPaintTarget {
  const corners = [
    patch.ctrl[row][col],
    patch.ctrl[row][col + 1],
    patch.ctrl[row + 1][col],
    patch.ctrl[row + 1][col + 1],
  ];
  const bounds = terrainPaintTargetBounds(corners);
  return {
    patch,
    type: 'cell',
    row,
    col,
    mins: bounds.mins,
    maxs: bounds.maxs,
    texture: terrainDefCellTexture(patch, row, col),
    needsPreparation: false,
  };
}

function nearestTerrainDefCellPaintTarget(patch: Patch, point: [number, number, number]): TerrainPaintTarget {
  const [axisA, axisB] = terrainPlanarAxes(terrainHeightAxis(patch));
  let bestTarget = terrainDefCellPaintTarget(patch, 0, 0);
  let bestDist = Infinity;

  for (let row = 0; row < patch.height - 1; row++) {
    for (let col = 0; col < patch.width - 1; col++) {
      const a = patch.ctrl[row][col].xyz;
      const b = patch.ctrl[row][col + 1].xyz;
      const c = patch.ctrl[row + 1][col].xyz;
      const d = patch.ctrl[row + 1][col + 1].xyz;
      const centerA = (a[axisA] + b[axisA] + c[axisA] + d[axisA]) * 0.25;
      const centerB = (a[axisB] + b[axisB] + c[axisB] + d[axisB]) * 0.25;
      const dist = Math.hypot(point[axisA] - centerA, point[axisB] - centerB);
      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = terrainDefCellPaintTarget(patch, row, col);
      }
    }
  }

  return bestTarget;
}

function createTerrainTilePatch(source: Patch, startRow: number, startCol: number): Patch {
  const ctrl = source.ctrl.slice(startRow, startRow + 3).map(row =>
    row.slice(startCol, startCol + 3).map(cp => ({
      xyz: [...cp.xyz] as [number, number, number],
      uv: [cp.uv[0], cp.uv[1]] as [number, number],
      terrainCoord: cp.terrainCoord ? [cp.terrainCoord[0], cp.terrainCoord[1]] as [number, number] : undefined,
    }))
  );
  const terrainDef = source.terrainDef
    ? {
        origin: [...ctrl[0][0].xyz] as [number, number, number],
        scale: [
          ctrl[0][1].xyz[0] - ctrl[0][0].xyz[0],
          ctrl[1][0].xyz[1] - ctrl[0][0].xyz[1],
        ] as [number, number],
        surfaces: source.terrainDef.surfaces
          .slice(startRow, startRow + 3)
          .map(row => row.slice(startCol, startCol + 3).map(surface => ({ ...surface }))),
        serializable: true,
      }
    : undefined;
  const patch: Patch = {
    width: 3,
    height: 3,
    texture: source.texture,
    terrainGroupId: source.terrainGroupId,
    terrainDef,
    contentFlags: source.contentFlags,
    surfaceFlags: source.surfaceFlags,
    value: source.value,
    ctrl,
    subdivisions: source.subdivisions,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    tessVerts: [],
    tessIndices: [],
  };
  if (terrainDef) {
    patch.texture = terrainDefDisplayTexture(patch);
  }
  tessellatePatch(patch);
  return patch;
}

type TerrainSeamRef = {
  patch: Patch;
  point: Patch['ctrl'][number][number];
};

type TerrainPatchCoordMeta = {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  heightAxis: number;
  pointsByCoord: Map<string, Patch['ctrl'][number][number]>;
};

function buildTerrainPatchCoordMeta(patch: Patch): TerrainPatchCoordMeta | null {
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  const pointsByCoord = new Map<string, Patch['ctrl'][number][number]>();

  for (const row of patch.ctrl) {
    for (const point of row) {
      if (!point.terrainCoord) continue;
      const [coordRow, coordCol] = point.terrainCoord;
      minRow = Math.min(minRow, coordRow);
      maxRow = Math.max(maxRow, coordRow);
      minCol = Math.min(minCol, coordCol);
      maxCol = Math.max(maxCol, coordCol);
      pointsByCoord.set(terrainCoordKey(point.terrainCoord), point);
    }
  }

  if (!Number.isFinite(minRow) || !Number.isFinite(minCol)) return null;
  return {
    minRow,
    maxRow,
    minCol,
    maxCol,
    heightAxis: terrainHeightAxis(patch),
    pointsByCoord,
  };
}

function smoothTerrainSeamTangents(
  seamPoints: Map<string, TerrainSeamRef[]>,
  affected: Set<Patch>,
  touchedTargets: Map<string, [number, number, number][]> | null,
  mode: TerrainSeamSmoothMode,
): number {
  const patchMeta = new Map<Patch, TerrainPatchCoordMeta>();
  for (const refs of seamPoints.values()) {
    for (const ref of refs) {
      if (patchMeta.has(ref.patch)) continue;
      const meta = buildTerrainPatchCoordMeta(ref.patch);
      if (meta) patchMeta.set(ref.patch, meta);
    }
  }

  const applyPair = (
    seamHeight: number,
    heightAxis: number,
    aPatch: Patch,
    aPoint: Patch['ctrl'][number][number],
    bPatch: Patch,
    bPoint: Patch['ctrl'][number][number],
  ): boolean => {
    const aCurrent = aPoint.xyz[heightAxis];
    const bCurrent = bPoint.xyz[heightAxis];
    let aTarget = seamHeight - (((seamHeight - aCurrent) + (bCurrent - seamHeight)) * 0.5);
    let bTarget = seamHeight + (((seamHeight - aCurrent) + (bCurrent - seamHeight)) * 0.5);
    if (mode === 'raise') {
      aTarget = Math.max(aCurrent, aTarget);
      bTarget = Math.max(bCurrent, bTarget);
    } else if (mode === 'lower') {
      aTarget = Math.min(aCurrent, aTarget);
      bTarget = Math.min(bCurrent, bTarget);
    }
    let changed = false;
    if (Math.abs(aPoint.xyz[heightAxis] - aTarget) > 0.0001) {
      aPoint.xyz[heightAxis] = aTarget;
      affected.add(aPatch);
      changed = true;
    }
    if (Math.abs(bPoint.xyz[heightAxis] - bTarget) > 0.0001) {
      bPoint.xyz[heightAxis] = bTarget;
      affected.add(bPatch);
      changed = true;
    }
    return changed;
  };

  let smoothed = 0;

  for (const [key, refs] of seamPoints) {
    if (refs.length < 2) continue;
    if (touchedTargets && !touchedTargets.has(key)) continue;
    const seamCoord = refs[0].point.terrainCoord;
    if (!seamCoord) continue;
    const [coordRow, coordCol] = seamCoord;
    const seamHeight = refs[0].point.xyz[terrainHeightAxis(refs[0].patch)];

    const left = refs.find(ref => patchMeta.get(ref.patch)?.maxCol === coordCol);
    const right = refs.find(ref => patchMeta.get(ref.patch)?.minCol === coordCol);
    if (left && right && left.patch !== right.patch) {
      const leftMeta = patchMeta.get(left.patch);
      const rightMeta = patchMeta.get(right.patch);
      if (leftMeta && rightMeta && leftMeta.heightAxis === rightMeta.heightAxis) {
        const leftInner = leftMeta.pointsByCoord.get(terrainCoordKey([coordRow, coordCol - 1]));
        const rightInner = rightMeta.pointsByCoord.get(terrainCoordKey([coordRow, coordCol + 1]));
        if (leftInner && rightInner && applyPair(seamHeight, leftMeta.heightAxis, left.patch, leftInner, right.patch, rightInner)) {
          smoothed++;
        }
      }
    }

    const top = refs.find(ref => patchMeta.get(ref.patch)?.maxRow === coordRow);
    const bottom = refs.find(ref => patchMeta.get(ref.patch)?.minRow === coordRow);
    if (top && bottom && top.patch !== bottom.patch) {
      const topMeta = patchMeta.get(top.patch);
      const bottomMeta = patchMeta.get(bottom.patch);
      if (topMeta && bottomMeta && topMeta.heightAxis === bottomMeta.heightAxis) {
        const topInner = topMeta.pointsByCoord.get(terrainCoordKey([coordRow - 1, coordCol]));
        const bottomInner = bottomMeta.pointsByCoord.get(terrainCoordKey([coordRow + 1, coordCol]));
        if (topInner && bottomInner && applyPair(seamHeight, topMeta.heightAxis, top.patch, topInner, bottom.patch, bottomInner)) {
          smoothed++;
        }
      }
    }
  }

  return smoothed;
}

function stitchTerrainPatchGroup(
  patches: Patch[],
  touchedTargets: Map<string, [number, number, number][]> | null,
  mode: TerrainSeamSmoothMode,
): number {
  const seamPoints = new Map<string, TerrainSeamRef[]>();

  for (const patch of patches) {
    for (const row of patch.ctrl) {
      for (const point of row) {
        if (!point.terrainCoord) continue;
        const key = terrainCoordKey(point.terrainCoord);
        const refs = seamPoints.get(key) ?? [];
        refs.push({ patch, point });
        seamPoints.set(key, refs);
      }
    }
  }

  const affected = new Set<Patch>();
  let stitched = 0;

  for (const [key, refs] of seamPoints) {
    if (refs.length < 2) continue;
    const touched = touchedTargets?.get(key) ?? null;
    if (touchedTargets && !touched) continue;

    const target: [number, number, number] = [0, 0, 0];
    const sourcePoints = touched ?? refs.map(ref => ref.point.xyz);
    for (const point of sourcePoints) {
      target[0] += point[0];
      target[1] += point[1];
      target[2] += point[2];
    }
    target[0] /= sourcePoints.length;
    target[1] /= sourcePoints.length;
    target[2] /= sourcePoints.length;

    let changed = false;
    for (const ref of refs) {
      const point = ref.point.xyz;
      if (Math.abs(point[0] - target[0]) < 0.0001
        && Math.abs(point[1] - target[1]) < 0.0001
        && Math.abs(point[2] - target[2]) < 0.0001) {
        continue;
      }
      point[0] = target[0];
      point[1] = target[1];
      point[2] = target[2];
      affected.add(ref.patch);
      changed = true;
    }
    if (changed) stitched++;
  }

  stitched += smoothTerrainSeamTangents(seamPoints, affected, touchedTargets, mode);

  for (const patch of affected) {
    tessellatePatch(patch);
  }

  return stitched;
}

function touchedTargetsFromPatchEditData(
  editor: Editor,
  touched: TerrainTouchedPoint[],
): Map<string, Map<string, [number, number, number][]>> {
  const touchedTargetsByGroup = new Map<string, Map<string, [number, number, number][]>>();
  for (const item of touched) {
    const data = editor.patchEditData[item.dataIndex];
    const point = data?.patch.ctrl[item.row]?.[item.col];
    const groupId = data?.patch.terrainGroupId;
    if (!groupId || !point?.terrainCoord) continue;
    const groupTargets = touchedTargetsByGroup.get(groupId) ?? new Map<string, [number, number, number][]>();
    const key = terrainCoordKey(point.terrainCoord);
    const targets = groupTargets.get(key) ?? [];
    targets.push([point.xyz[0], point.xyz[1], point.xyz[2]]);
    groupTargets.set(key, targets);
    touchedTargetsByGroup.set(groupId, groupTargets);
  }
  return touchedTargetsByGroup;
}

function stitchTerrainGroups(
  editor: Editor,
  patches: Patch[],
  touchedTargetsByGroup: Map<string, Map<string, [number, number, number][]>> | null,
  mode: TerrainSeamSmoothMode = 'neutral',
): number {
  const groups = new Map<string, Patch[]>();
  for (const patch of patches) {
    if (!patch.terrainGroupId) continue;
    const group = groups.get(patch.terrainGroupId) ?? [];
    group.push(patch);
    groups.set(patch.terrainGroupId, group);
  }

  let stitched = 0;
  for (const [groupId, groupPatches] of groups) {
    if (groupPatches.length < 2) continue;
    stitched += stitchTerrainPatchGroup(groupPatches, touchedTargetsByGroup?.get(groupId) ?? null, mode);
  }

  if (stitched > 0) {
    editor.redrawRequested = true;
  }
  return stitched;
}

export function stitchSelectedTerrainControlSeams(editor: Editor): number {
  const touched: TerrainTouchedPoint[] = editor.patchControlSelection.map(item => ({
    dataIndex: item.dataIndex,
    row: item.row,
    col: item.col,
  }));
  return editor.transact('Stitch terrain control seams', () =>
    stitchTerrainGroups(
      editor,
      editor.patchEditData.map(data => data.patch),
      touchedTargetsFromPatchEditData(editor, touched),
      'neutral',
    )
  );
}

export function updateTerrainSample(
  editor: Editor,
  patch: Patch,
  row: number,
  column: number,
  changes: TerrainSampleChanges,
): void {
  const point = patch.ctrl[row]?.[column];
  const surface = patch.terrainDef?.surfaces[row]?.[column];
  if (!point || !surface || !patch.terrainDef) {
    editor.statusMessage = 'Terrain sample is no longer available';
    return;
  }
  if ((changes.scaleX !== undefined && Math.abs(changes.scaleX) < 0.0001)
      || (changes.scaleY !== undefined && Math.abs(changes.scaleY) < 0.0001)) {
    editor.statusMessage = 'Terrain texture scale cannot be zero';
    return;
  }

  editor.transact('Edit terrain sample', () => {
    const { height, ...surfaceChanges } = changes;
    Object.assign(surface, surfaceChanges);
    const affected = new Set<Patch>([patch]);
    if (height !== undefined && Number.isFinite(height)) {
      point.xyz[2] = height;
      if (patch.terrainGroupId && point.terrainCoord) {
        const grouped = editor.entities.flatMap(entity => entity.patches)
          .filter(candidate => candidate.terrainGroupId === patch.terrainGroupId);
        const targets = new Map<string, Map<string, [number, number, number][]>>();
        targets.set(patch.terrainGroupId, new Map([
          [terrainCoordKey(point.terrainCoord), [[point.xyz[0], point.xyz[1], point.xyz[2]]]],
        ]));
        stitchTerrainGroups(editor, grouped, targets);
        grouped.forEach(candidate => affected.add(candidate));
      }
    }
    for (const candidate of affected) {
      if (candidate.terrainDef) syncTerrainDefMetadata(candidate);
      tessellatePatch(candidate);
    }
    editor.redrawRequested = true;
    editor.statusMessage = `Updated terrain sample ${row},${column}`;
  }, { coalesceKey: `terrain-sample-${row}-${column}` });
}

function selectTerrainLine(editor: Editor, axis: 0 | 1): void {
  if (!editor.patchEditMode || editor.patchEditData.length === 0 || editor.patchControlSelection.length === 0) {
    editor.statusMessage = 'Select a terrain control point first';
    return;
  }
  const coordinates = new Set<number>();
  for (const selected of editor.patchControlSelection) {
    const point = editor.patchEditData[selected.dataIndex]?.patch.ctrl[selected.row]?.[selected.col];
    if (point?.terrainCoord) coordinates.add(point.terrainCoord[axis]);
  }
  if (coordinates.size === 0) {
    editor.statusMessage = 'Selected control points do not belong to a terrain group';
    return;
  }
  editor.patchControlSelection = [];
  for (let dataIndex = 0; dataIndex < editor.patchEditData.length; dataIndex++) {
    const patch = editor.patchEditData[dataIndex].patch;
    for (let row = 0; row < patch.height; row++) {
      for (let column = 0; column < patch.width; column++) {
        const coord = patch.ctrl[row][column].terrainCoord;
        if (coord && coordinates.has(coord[axis])) {
          editor.patchControlSelection.push({ dataIndex, row, col: column });
        }
      }
    }
  }
  editor.redrawRequested = true;
  editor.statusMessage = `Selected terrain ${axis === 0 ? 'row' : 'column'}`;
}

export function selectTerrainRows(editor: Editor): void { selectTerrainLine(editor, 0); }
export function selectTerrainColumns(editor: Editor): void { selectTerrainLine(editor, 1); }

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

  editor.beginTransaction('Create terrain');
  const terrainDefCompatible =
    axisDepth === 2
    && ((axisH === 0 && axisV === 1) || (axisH === 1 && axisV === 0));
  const patch = terrainDefCompatible
    ? createTerrainDefGridPatch(bounds.mins, bounds.maxs, editor.currentTexture, width, height)
    : createGridPatch(bounds.mins, bounds.maxs, editor.currentTexture, width, height, axisH, axisV, axisDepth);
  patch.terrainGroupId = createTerrainGroupId();
  assignTerrainCoords(patch);
  editor.worldspawn.patches.push(patch);
  editor.selection = [{ type: 'patch', entity: editor.worldspawn, patch }];
  editor.enterPatchEditMode();

  const centerRow = Math.floor(height / 2);
  const centerCol = Math.floor(width / 2);
  editor.patchControlSelection = [{ dataIndex: 0, row: centerRow, col: centerCol }];
  editor.terrainBrushCenter = null;
  editor.terrainBrushAxes = null;
  editor.redrawRequested = true;
  const paintHint = terrainPaintNeedsPreparation(patch)
    ? ' (Use Prepare Terrain For Texture Paint for local texture painting)'
    : '';
  editor.statusMessage = terrainDefCompatible
    ? `Created terrainDef terrain ${width}x${height}${paintHint}`
    : `Created terrain patch ${width}x${height}${paintHint}`;
  editor.commitTransaction();
}

export function splitTerrainIntoPaintTiles(editor: Editor): void {
  const patchItems = getSelectedPatchItems(editor);
  if (patchItems.length === 0) {
    editor.statusMessage = 'Select a terrain patch to prepare for texture paint';
    return;
  }

  const wasPatchEditMode = editor.patchEditMode;
  if (wasPatchEditMode) editor.exitPatchEditMode();

  editor.beginTransaction('Prepare terrain for texture paint');
  let changed = false;
  let tileCount = 0;
  const nextSelection: { type: 'patch'; entity: typeof patchItems[number]['entity']; patch: Patch }[] = [];

  for (const item of patchItems) {
    const subPatchCols = (item.patch.width - 1) / 2;
    const subPatchRows = (item.patch.height - 1) / 2;
    if (subPatchCols < 2 && subPatchRows < 2) {
      nextSelection.push({ type: 'patch', entity: item.entity, patch: item.patch });
      continue;
    }

    const tiles: Patch[] = [];
    for (let row = 0; row <= item.patch.height - 3; row += 2) {
      for (let col = 0; col <= item.patch.width - 3; col += 2) {
        tiles.push(createTerrainTilePatch(item.patch, row, col));
      }
    }
    if (tiles.length <= 1) {
      nextSelection.push({ type: 'patch', entity: item.entity, patch: item.patch });
      continue;
    }

    changed = true;

    const patchIndex = item.entity.patches.indexOf(item.patch);
    if (patchIndex >= 0) {
      item.entity.patches.splice(patchIndex, 1, ...tiles);
    }
    nextSelection.push(...tiles.map(patch => ({ type: 'patch' as const, entity: item.entity, patch })));
    tileCount += tiles.length;
  }

  if (!changed) {
    editor.commitTransaction();
    if (wasPatchEditMode) editor.enterPatchEditMode();
    editor.statusMessage = 'Selected terrain is already ready for texture paint';
    return;
  }

  editor.selection = nextSelection;
  editor.enterPatchEditMode();
  editor.patchControlSelection = [];
  editor.redrawRequested = true;
  editor.statusMessage = `Prepared terrain for texture paint (${tileCount} tiles, click any tile to work on the whole set)`;
  editor.commitTransaction();
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
  const touched: TerrainTouchedPoint[] = [];
  for (const anchor of anchors) {
    const items = anchorsByPatch.get(anchor.dataIndex) ?? [];
    items.push(anchor);
    anchorsByPatch.set(anchor.dataIndex, items);
  }
  const selectedPointsByPatch = selectedOnly ? selectedTerrainPointSets(editor) : null;

  if (takeSnapshot) editor.beginTransaction('Sculpt terrain');

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
        touched.push({ dataIndex, row, col });
      }
    }

    tessellatePatch(patch);
  }

  stitchTerrainGroups(
    editor,
    editor.patchEditData.map(data => data.patch),
    touchedTargetsFromPatchEditData(editor, touched),
    amount > 0 ? 'raise' : 'lower',
  );

  editor.redrawRequested = true;
  editor.statusMessage = `${amount > 0 ? 'Raised' : 'Lowered'} terrain (${Math.abs(amount).toFixed(1)}, r=${radius}, s=${terrainStrength(editor)}, ${falloff})`;
  if (takeSnapshot) editor.commitTransaction();
}

export function paintTerrainTexture(editor: Editor, takeSnapshot = true): number {
  if (!editor.patchEditMode || editor.patchEditData.length === 0) {
    editor.statusMessage = 'Enter patch edit mode to paint terrain';
    return 0;
  }

  const texture = canonicalTerrainTexture(editor.currentTexture);
  if (!texture) return 0;
  const targets = hoveredTerrainPaintTargets(editor);
  if (targets.length === 0) {
    editor.statusMessage = 'Hover terrain in a matching 2D or 3D view to paint';
    return 0;
  }
  if (targets.some(target => target.needsPreparation)) {
    editor.statusMessage = 'Prepare Terrain For Texture Paint before local terrain texture painting';
    return 0;
  }

  if (takeSnapshot) editor.beginTransaction('Paint terrain texture');
  let painted = 0;
  let paintedCells = 0;
  let paintedPatches = 0;
  for (const target of targets) {
    let changed = false;

    if (target.type === 'cell' && target.patch.terrainDef) {
      const surfaces = [
        target.patch.terrainDef.surfaces[target.row]?.[target.col],
        target.patch.terrainDef.surfaces[target.row]?.[target.col + 1],
        target.patch.terrainDef.surfaces[target.row + 1]?.[target.col],
        target.patch.terrainDef.surfaces[target.row + 1]?.[target.col + 1],
      ].filter((surface): surface is NonNullable<typeof surface> => !!surface);
      changed = surfaces.some(surface => surface.texture !== texture);
      if (changed) {
        for (const surface of surfaces) {
          surface.texture = texture;
        }
        tessellatePatch(target.patch);
        paintedCells++;
      }
    } else {
      changed = target.patch.terrainDef
        ? target.patch.terrainDef.surfaces.some(row => row.some(surface => surface.texture !== texture))
        : target.patch.texture !== texture;
      if (changed) {
        setPatchTexture(target.patch, texture);
        paintedPatches++;
      }
    }
    if (changed) painted++;
  }

  if (painted === 0) {
    if (takeSnapshot) editor.commitTransaction();
    editor.statusMessage = 'No terrain patches changed';
    return 0;
  }

  editor.redrawRequested = true;
  const parts: string[] = [];
  if (paintedCells > 0) parts.push(`${paintedCells} ${paintedCells === 1 ? 'cell' : 'cells'}`);
  if (paintedPatches > 0) parts.push(`${paintedPatches} ${paintedPatches === 1 ? 'patch' : 'patches'}`);
  editor.statusMessage = `Painted ${parts.join(' and ')} with ${texture}`;
  if (takeSnapshot) editor.commitTransaction();
  return painted;
}

export function hoveredTerrainPaintTargets(editor: Editor): TerrainPaintTarget[] {
  if (!editor.patchEditMode || editor.patchEditData.length === 0) return [];

  const anchors = cursorTerrainAnchors(editor);
  if (anchors.length === 0) return [];

  let bestDistance = Infinity;
  const targets: TerrainPaintTarget[] = [];
  const seen = new Set<string>();

  const makeTarget = (patch: Patch, point: [number, number, number]): TerrainPaintTarget =>
    patch.terrainDef && (patch.width > 3 || patch.height > 3)
      ? nearestTerrainDefCellPaintTarget(patch, point)
      : terrainPatchPaintTarget(patch);

  for (const anchor of anchors) {
    const data = editor.patchEditData[anchor.dataIndex];
    if (!data) continue;
    const distance = terrainPatchDistanceToPoint(data.patch, anchor.point);
    const target = makeTarget(data.patch, anchor.point);
    const key = `${anchor.dataIndex}:${target.type}:${target.row}:${target.col}`;
    if (distance < bestDistance - 0.001) {
      bestDistance = distance;
      targets.length = 0;
      seen.clear();
      targets.push(target);
      seen.add(key);
    } else if (Math.abs(distance - bestDistance) <= 0.001 && !seen.has(key)) {
      targets.push(target);
      seen.add(key);
    }
  }

  return targets;
}

export function hoveredTerrainPaintPatches(editor: Editor): Patch[] {
  const seen = new Set<Patch>();
  const patches: Patch[] = [];
  for (const target of hoveredTerrainPaintTargets(editor)) {
    if (seen.has(target.patch)) continue;
    seen.add(target.patch);
    patches.push(target.patch);
  }
  return patches;
}

export function hoveredTerrainPaintNeedsPreparation(editor: Editor): boolean {
  return hoveredTerrainPaintPatches(editor).some(terrainPaintNeedsPreparation);
}

export function smoothTerrain(editor: Editor): void {
  const anchors = ensureTerrainAnchors(editor);
  if (!anchors) return;

  const radius = terrainRadius(editor);
  const falloff = editor.terrainFalloff;
  const anchorsByPatch = new Map<number, TerrainBrushAnchor[]>();
  const touched: TerrainTouchedPoint[] = [];
  for (const anchor of anchors) {
    const items = anchorsByPatch.get(anchor.dataIndex) ?? [];
    items.push(anchor);
    anchorsByPatch.set(anchor.dataIndex, items);
  }

  editor.beginTransaction('Smooth terrain');

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
        touched.push({ dataIndex, row, col });
      }
    }

    tessellatePatch(patch);
  }

  stitchTerrainGroups(editor, editor.patchEditData.map(data => data.patch), touchedTargetsFromPatchEditData(editor, touched));

  editor.redrawRequested = true;
  editor.statusMessage = `Smoothed terrain (r=${radius}, ${falloff})`;
  editor.commitTransaction();
}

export function noiseTerrain(editor: Editor): void {
  const anchors = ensureTerrainAnchorsPreferSelection(editor);
  if (!anchors) return;

  const radius = terrainRadius(editor);
  const strength = terrainStrength(editor);
  const falloff = editor.terrainFalloff;
  const anchorsByPatch = new Map<number, TerrainBrushAnchor[]>();
  const touched: TerrainTouchedPoint[] = [];
  const selectedPointsByPatch = selectedTerrainPointSets(editor);
  const selectedOnly = selectedPointsByPatch.size > 0;
  const anchored = anchors.length > 0;
  for (const anchor of anchors) {
    const items = anchorsByPatch.get(anchor.dataIndex) ?? [];
    items.push(anchor);
    anchorsByPatch.set(anchor.dataIndex, items);
  }

  editor.beginTransaction('Apply terrain noise');

  const patchEntries: Array<[number, TerrainBrushAnchor[]]> = anchored
    ? Array.from(anchorsByPatch.entries())
    : editor.patchEditData.map((_, dataIndex) => [dataIndex, [] as TerrainBrushAnchor[]]);

  for (const [dataIndex, patchAnchors] of patchEntries) {
    const data = editor.patchEditData[dataIndex];
    if (!data) continue;
    const patch = data.patch;
    const heightAxis = terrainHeightAxis(patch);
    const [axisA, axisB] = terrainPlanarAxes(heightAxis);
    const original = patch.ctrl.map(row => row.map(cp => [...cp.xyz] as [number, number, number]));
    const selectedPoints = selectedPointsByPatch.get(dataIndex);

    for (let row = 0; row < patch.height; row++) {
      for (let col = 0; col < patch.width; col++) {
        if (selectedOnly && (!selectedPoints || !selectedPoints.has(`${row}:${col}`))) continue;
        const point = original[row][col];
        let weight = anchored ? 0 : 1;
        for (const anchor of patchAnchors) {
          const dx = point[axisA] - anchor.point[axisA];
          const dy = point[axisB] - anchor.point[axisB];
          weight = Math.max(weight, terrainBrushWeight(Math.hypot(dx, dy), radius, falloff));
        }
        if (weight <= 0) continue;
        patch.ctrl[row][col].xyz[heightAxis] = point[heightAxis] + (Math.random() * 2 - 1) * strength * weight;
        touched.push({ dataIndex, row, col });
      }
    }

    tessellatePatch(patch);
  }

  stitchTerrainGroups(editor, editor.patchEditData.map(data => data.patch), touchedTargetsFromPatchEditData(editor, touched));

  editor.redrawRequested = true;
  editor.statusMessage = anchored
    ? `Applied terrain noise (r=${radius}, s=${strength}, ${falloff})`
    : `Applied terrain noise (full terrain, s=${strength})`;
  editor.commitTransaction();
}

export function erodeTerrain(editor: Editor): void {
  const anchors = ensureTerrainAnchorsPreferSelection(editor);
  if (!anchors) return;

  const radius = terrainRadius(editor);
  const strength = terrainStrength(editor);
  const falloff = editor.terrainFalloff;
  const erosionBlend = Math.max(0.08, Math.min(0.75, strength / 96));
  const anchorsByPatch = new Map<number, TerrainBrushAnchor[]>();
  const touched: TerrainTouchedPoint[] = [];
  const selectedPointsByPatch = selectedTerrainPointSets(editor);
  const selectedOnly = selectedPointsByPatch.size > 0;
  const anchored = anchors.length > 0;
  for (const anchor of anchors) {
    const items = anchorsByPatch.get(anchor.dataIndex) ?? [];
    items.push(anchor);
    anchorsByPatch.set(anchor.dataIndex, items);
  }

  editor.beginTransaction('Erode terrain');

  const patchEntries: Array<[number, TerrainBrushAnchor[]]> = anchored
    ? Array.from(anchorsByPatch.entries())
    : editor.patchEditData.map((_, dataIndex) => [dataIndex, [] as TerrainBrushAnchor[]]);

  for (const [dataIndex, patchAnchors] of patchEntries) {
    const data = editor.patchEditData[dataIndex];
    if (!data) continue;
    const patch = data.patch;
    const heightAxis = terrainHeightAxis(patch);
    const [axisA, axisB] = terrainPlanarAxes(heightAxis);
    const original = patch.ctrl.map(row => row.map(cp => [...cp.xyz] as [number, number, number]));
    const selectedPoints = selectedPointsByPatch.get(dataIndex);

    for (let row = 0; row < patch.height; row++) {
      for (let col = 0; col < patch.width; col++) {
        if (selectedOnly && (!selectedPoints || !selectedPoints.has(`${row}:${col}`))) continue;
        const point = original[row][col];
        let weight = anchored ? 0 : 1;
        for (const anchor of patchAnchors) {
          const dx = point[axisA] - anchor.point[axisA];
          const dy = point[axisB] - anchor.point[axisB];
          weight = Math.max(weight, terrainBrushWeight(Math.hypot(dx, dy), radius, falloff));
        }
        if (weight <= 0) continue;

        let lowerSum = 0;
        let lowerCount = 0;
        for (let nr = Math.max(0, row - 1); nr <= Math.min(patch.height - 1, row + 1); nr++) {
          for (let nc = Math.max(0, col - 1); nc <= Math.min(patch.width - 1, col + 1); nc++) {
            if (nr === row && nc === col) continue;
            const neighborHeight = original[nr][nc][heightAxis];
            if (neighborHeight >= point[heightAxis] - 0.001) continue;
            lowerSum += neighborHeight;
            lowerCount++;
          }
        }
        if (lowerCount === 0) continue;

        const target = lowerSum / lowerCount;
        patch.ctrl[row][col].xyz[heightAxis] = point[heightAxis] + (target - point[heightAxis]) * weight * erosionBlend;
        touched.push({ dataIndex, row, col });
      }
    }

    tessellatePatch(patch);
  }

  stitchTerrainGroups(editor, editor.patchEditData.map(data => data.patch), touchedTargetsFromPatchEditData(editor, touched));

  editor.redrawRequested = true;
  editor.statusMessage = anchored
    ? `Eroded terrain (r=${radius}, s=${strength}, ${falloff})`
    : `Eroded terrain (full terrain, s=${strength})`;
  editor.commitTransaction();
}

export function stitchTerrainSeams(editor: Editor, takeSnapshot = true, updateStatus = true): number {
  const patches = editor.patchEditMode
    ? editor.patchEditData.map(data => data.patch)
    : getSelectedPatchItems(editor).map(item => item.patch);

  if (patches.length === 0) {
    if (updateStatus) editor.statusMessage = 'Select prepared terrain patches to stitch';
    return 0;
  }

  if (takeSnapshot) editor.beginTransaction('Stitch terrain seams');
  const stitched = stitchTerrainGroups(editor, patches, null);
  if (stitched === 0) {
    if (takeSnapshot) editor.commitTransaction();
    if (updateStatus) editor.statusMessage = 'No terrain seams needed stitching';
    return 0;
  }

  if (updateStatus) editor.statusMessage = `Stitched ${stitched} terrain seam${stitched === 1 ? '' : 's'}`;
  if (takeSnapshot) editor.commitTransaction();
  return stitched;
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
  editor.redrawRequested = true;
  editor.statusMessage = `Terrain radius: ${editor.terrainBrushRadius}`;
}

export function adjustTerrainStrength(editor: Editor, delta: number): void {
  const next = Math.max(1, Math.min(256, editor.terrainBrushStrength + delta));
  if (next === editor.terrainBrushStrength) return;
  editor.terrainBrushStrength = next;
  editor.redrawRequested = true;
  editor.statusMessage = `Terrain strength: ${editor.terrainBrushStrength}`;
}

export function cycleTerrainFalloff(editor: Editor): void {
  editor.terrainFalloff = editor.terrainFalloff === 'smooth' ? 'linear' : 'smooth';
  editor.redrawRequested = true;
  editor.statusMessage = `Terrain falloff: ${editor.terrainFalloff}`;
}

export function toggleTerrainBrushMode(editor: Editor): void {
  editor.terrainBrushMode = editor.terrainBrushMode === 'height' ? 'texture' : 'height';
  editor.redrawRequested = true;
  editor.statusMessage = `Terrain brush mode: ${editor.terrainBrushMode}`;
}
