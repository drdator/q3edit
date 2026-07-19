import {
  tessellatePatch,
  type Patch,
  type TerrainDefData,
  type TerrainDefSurface,
} from './patch';

export type TerrainMesh = Patch & { terrainDef: TerrainDefData };

export interface TerrainValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Terrain deliberately remains a specialized Patch instead of a second document
 * primitive. It shares selection, transforms, tessellation, and seam topology with
 * Bezier patches; this adapter is the explicit boundary for terrain-only behavior.
 */
export const TERRAIN_MODEL_DECISION = 'unified-patch-with-explicit-terrain-adapter' as const;

export function isTerrainMesh(patch: Patch): patch is TerrainMesh {
  return patch.terrainDef !== undefined;
}

export function terrainSample(
  patch: Patch,
  row: number,
  column: number,
): { point: Patch['ctrl'][number][number]; surface: TerrainDefSurface } | null {
  if (!isTerrainMesh(patch)) return null;
  const point = patch.ctrl[row]?.[column];
  const surface = patch.terrainDef.surfaces[row]?.[column];
  return point && surface ? { point, surface } : null;
}

export function validateTerrainMesh(patch: Patch): TerrainValidationResult {
  if (!isTerrainMesh(patch)) return { valid: false, issues: ['Patch is not a terrainDef mesh'] };

  const issues: string[] = [];
  const terrain = patch.terrainDef;
  const epsilon = 0.001;
  if (patch.width < 2 || patch.height < 2) issues.push('Terrain lattice must be at least 2x2');
  if (patch.ctrl.length !== patch.height || patch.ctrl.some(row => row.length !== patch.width)) {
    issues.push('Control-point dimensions do not match the terrain header');
  }
  if (terrain.surfaces.length !== patch.height || terrain.surfaces.some(row => row.length !== patch.width)) {
    issues.push('Surface-sample dimensions do not match the terrain header');
  }
  if (!terrain.scale.every(value => Number.isFinite(value) && Math.abs(value) > epsilon)) {
    issues.push('Terrain lattice scale must contain two finite, non-zero values');
  }
  if (!terrain.origin.every(Number.isFinite)) issues.push('Terrain origin must be finite');

  for (let row = 0; row < patch.height; row++) {
    for (let column = 0; column < patch.width; column++) {
      const sample = terrainSample(patch, row, column);
      if (!sample) continue;
      const expectedX = terrain.origin[0] + column * terrain.scale[0];
      const expectedY = terrain.origin[1] + row * terrain.scale[1];
      if (Math.abs(sample.point.xyz[0] - expectedX) > epsilon || Math.abs(sample.point.xyz[1] - expectedY) > epsilon) {
        issues.push(`Sample ${row},${column} is outside the regular XY terrain lattice`);
      }
      if (!sample.point.xyz.every(Number.isFinite)) issues.push(`Sample ${row},${column} has non-finite coordinates`);
      const numeric = [
        sample.surface.offsetX, sample.surface.offsetY, sample.surface.rotation,
        sample.surface.scaleX, sample.surface.scaleY, sample.surface.contentFlags,
        sample.surface.surfaceFlags, sample.surface.value,
      ];
      if (!sample.surface.texture || !numeric.every(Number.isFinite)) {
        issues.push(`Sample ${row},${column} has invalid surface metadata`);
      }
    }
  }

  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function assertTerrainSerializable(patch: Patch): asserts patch is TerrainMesh {
  const result = validateTerrainMesh(patch);
  if (!result.valid) {
    throw new Error(`Cannot serialize terrainDef: ${result.issues.join('; ')}. Convert it to patchDef2 explicitly first.`);
  }
}

/** A deliberate, loss-aware conversion used before applying generic patch tools. */
export function convertTerrainToBezierPatch(patch: Patch): boolean {
  if (!isTerrainMesh(patch)) return false;
  const genericPatch: Patch = patch;
  genericPatch.terrainDef = undefined;
  patch.terrainGroupId = undefined;
  for (const row of patch.ctrl) {
    for (const point of row) point.terrainCoord = undefined;
  }
  tessellatePatch(patch);
  return true;
}
