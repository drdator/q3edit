import { clonePatch, createGridPatch, tessellatePatch, type Patch, type PatchControlPoint } from './patch';
import type { Vec3 } from './math';

const clonePoint = (point: PatchControlPoint): PatchControlPoint => ({ xyz: [...point.xyz] as Vec3, uv: [...point.uv] as [number, number], terrainCoord: point.terrainCoord ? [...point.terrainCoord] as [number, number] : undefined });
const mixPoint = (a: PatchControlPoint, b: PatchControlPoint, t: number): PatchControlPoint => ({
  xyz: a.xyz.map((value, axis) => value + (b.xyz[axis] - value) * t) as Vec3,
  uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t],
});

function finish(patch: Patch): Patch {
  patch.height = patch.ctrl.length; patch.width = patch.ctrl[0]?.length ?? 0;
  patch.terrainDef = undefined; tessellatePatch(patch); return patch;
}

export function insertPatchRows(patch: Patch, before = Math.max(1, patch.height - 1)): void {
  if (patch.height >= 31) return;
  const index = Math.max(1, Math.min(patch.height - 1, before));
  const a = patch.ctrl[index - 1]; const b = patch.ctrl[index];
  patch.ctrl.splice(index, 0, a.map((point, col) => mixPoint(point, b[col], 1 / 3)), a.map((point, col) => mixPoint(point, b[col], 2 / 3)));
  finish(patch);
}

export function deletePatchRows(patch: Patch, at = Math.max(1, patch.height - 2)): void {
  if (patch.height <= 3) return;
  patch.ctrl.splice(Math.max(1, Math.min(patch.height - 2, at)), 2); finish(patch);
}

export function insertPatchColumns(patch: Patch, before = Math.max(1, patch.width - 1)): void {
  if (patch.width >= 31) return;
  const index = Math.max(1, Math.min(patch.width - 1, before));
  for (const row of patch.ctrl) row.splice(index, 0, mixPoint(row[index - 1], row[index], 1 / 3), mixPoint(row[index - 1], row[index], 2 / 3));
  finish(patch);
}

export function deletePatchColumns(patch: Patch, at = Math.max(1, patch.width - 2)): void {
  if (patch.width <= 3) return;
  const index = Math.max(1, Math.min(patch.width - 2, at));
  for (const row of patch.ctrl) row.splice(index, 2); finish(patch);
}

export function transposePatch(patch: Patch): void {
  patch.ctrl = Array.from({ length: patch.width }, (_, row) => Array.from({ length: patch.height }, (_, col) => clonePoint(patch.ctrl[col][row])));
  finish(patch);
}

export function invertPatch(patch: Patch): void { patch.ctrl.reverse(); finish(patch); }
export function cyclePatchCap(patch: Patch): void { transposePatch(patch); invertPatch(patch); }

export const PATCH_TOOL_DECISIONS = {
  overlays: 'deferred: requires a non-document reference-layer model',
  freeze: 'deferred: requires overlay/reference semantics',
  weld: 'deferred: ambiguous across independent quadratic grids',
  drillDown: 'deferred: selection workflow has no Q3-compatible browser model yet',
  bend: 'deferred: requires an explicit pivot/axis interaction design',
  explicitInsertDeleteModes: 'implemented as deterministic selected-patch commands instead of modal tools',
} as const;

export function redispersePatchRows(patch: Patch): void {
  for (let col = 0; col < patch.width; col++) {
    const start = clonePoint(patch.ctrl[0][col]); const end = clonePoint(patch.ctrl[patch.height - 1][col]);
    for (let row = 1; row < patch.height - 1; row++) patch.ctrl[row][col] = mixPoint(start, end, row / (patch.height - 1));
  }
  finish(patch);
}

export function redispersePatchColumns(patch: Patch): void {
  for (const row of patch.ctrl) {
    const start = clonePoint(row[0]); const end = clonePoint(row[patch.width - 1]);
    for (let col = 1; col < patch.width - 1; col++) row[col] = mixPoint(start, end, col / (patch.width - 1));
  }
  finish(patch);
}

export function createPatchMatrix(mins: Vec3, maxs: Vec3, texture: string, width: number, height: number): Patch {
  if (width < 3 || height < 3 || width > 31 || height > 31 || width % 2 === 0 || height % 2 === 0) {
    throw new Error('Patch dimensions must be odd values from 3 through 31');
  }
  return createGridPatch(mins, maxs, texture, width, height, 0, 1, 2);
}

export function fitPatchUV(patch: Patch): void {
  for (let row = 0; row < patch.height; row++) for (let col = 0; col < patch.width; col++) patch.ctrl[row][col].uv = [col / (patch.width - 1), row / (patch.height - 1)];
  tessellatePatch(patch);
}
export function naturalizePatchUV(patch: Patch): void {
  for (const row of patch.ctrl) for (const point of row) point.uv = [point.xyz[0] / 64, -point.xyz[1] / 64];
  tessellatePatch(patch);
}
export function transformPatchUV(patch: Patch, shift: [number, number], scale: [number, number], rotation: number): void {
  const radians = rotation * Math.PI / 180; const c = Math.cos(radians); const s = Math.sin(radians);
  for (const row of patch.ctrl) for (const point of row) {
    const x = (point.uv[0] - 0.5) * scale[0]; const y = (point.uv[1] - 0.5) * scale[1];
    point.uv = [x * c - y * s + 0.5 + shift[0], x * s + y * c + 0.5 + shift[1]];
  }
  tessellatePatch(patch);
}

function pointNormal(patch: Patch, row: number, col: number): Vec3 {
  const left = patch.ctrl[row][Math.max(0, col - 1)].xyz; const right = patch.ctrl[row][Math.min(patch.width - 1, col + 1)].xyz;
  const up = patch.ctrl[Math.max(0, row - 1)][col].xyz; const down = patch.ctrl[Math.min(patch.height - 1, row + 1)][col].xyz;
  const a: Vec3 = [right[0] - left[0], right[1] - left[1], right[2] - left[2]];
  const b: Vec3 = [down[0] - up[0], down[1] - up[1], down[2] - up[2]];
  const n: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = Math.hypot(...n) || 1; return [n[0] / length, n[1] / length, n[2] / length];
}

function sidePatch(a: PatchControlPoint[], b: PatchControlPoint[], source: Patch): Patch {
  const ctrl = [a.map(clonePoint), a.map((point, index) => mixPoint(point, b[index], 0.5)), b.map(clonePoint)];
  const patch = clonePatch(source); patch.ctrl = ctrl; patch.terrainDef = undefined; return finish(patch);
}

export function thickenPatch(source: Patch, amount: number, caps = true): Patch[] {
  const front = clonePatch(source); const back = clonePatch(source);
  for (let row = 0; row < source.height; row++) for (let col = 0; col < source.width; col++) {
    const normal = pointNormal(source, row, col);
    for (const [patch, direction] of [[front, 0.5], [back, -0.5]] as const) {
      patch.ctrl[row][col].xyz = source.ctrl[row][col].xyz.map((value, axis) => value + normal[axis] * amount * direction) as Vec3;
    }
  }
  finish(front); invertPatch(back);
  if (!caps) return [front, back];
  const sides = [
    sidePatch(front.ctrl[0], [...back.ctrl[back.height - 1]].reverse(), source),
    sidePatch(front.ctrl[front.height - 1], [...back.ctrl[0]].reverse(), source),
    sidePatch(front.ctrl.map(row => row[0]), [...back.ctrl].reverse().map(row => row[back.width - 1]), source),
    sidePatch(front.ctrl.map(row => row[front.width - 1]), [...back.ctrl].reverse().map(row => row[0]), source),
  ];
  return [front, back, ...sides];
}

export interface PatchInspectorModel {
  width: number; height: number; subdivisions: number; texture: string;
  contentFlags: number; surfaceFlags: number; value: number;
  controlPoints: Array<{ row: number; col: number; xyz: Vec3; uv: [number, number] }>;
}
export function inspectPatch(patch: Patch): PatchInspectorModel {
  return { width: patch.width, height: patch.height, subdivisions: patch.subdivisions, texture: patch.texture,
    contentFlags: patch.contentFlags, surfaceFlags: patch.surfaceFlags, value: patch.value,
    controlPoints: patch.ctrl.flatMap((row, rowIndex) => row.map((point, col) => ({ row: rowIndex, col, xyz: [...point.xyz] as Vec3, uv: [...point.uv] as [number, number] }))) };
}
