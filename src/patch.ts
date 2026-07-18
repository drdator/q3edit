import { Vec3, vec3, vec3Sub, vec3Cross, vec3Normalize, vec3Copy, vec3RotateAxis, vec3MirrorAxis } from './math';

// ── Data structures ──

export interface PatchControlPoint {
  xyz: Vec3;
  uv: [number, number];
  terrainCoord?: [number, number];
}

export interface TerrainDefSurface {
  texture: string;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  contentFlags: number;
  surfaceFlags: number;
  value: number;
}

export interface TerrainDefData {
  origin: Vec3;
  scale: [number, number];
  surfaces: TerrainDefSurface[][];
  serializable: boolean;
}

export interface PatchTessVertex {
  position: Vec3;
  normal: Vec3;
  uv: [number, number];
}

export interface Patch {
  width: number;          // columns of control points
  height: number;         // rows of control points
  texture: string;
  terrainGroupId?: string;
  terrainDef?: TerrainDefData;
  contentFlags: number;
  surfaceFlags: number;
  value: number;
  ctrl: PatchControlPoint[][];  // ctrl[row][col], height rows x width cols
  subdivisions: number;         // tessellation level per sub-patch (default 6)
  // Computed by tessellation:
  mins: Vec3;
  maxs: Vec3;
  tessVerts: PatchTessVertex[];
  tessIndices: number[];  // triangle indices into tessVerts
}

// ── Biquadratic Bezier tessellation ──

const SUBDIVISIONS = 6;

function defaultTerrainDefSurface(texture: string, contentFlags = 0, surfaceFlags = 0, value = 0): TerrainDefSurface {
  return {
    texture,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    scaleX: 0.5,
    scaleY: 0.5,
    contentFlags,
    surfaceFlags,
    value,
  };
}

function syncTerrainDefControlUvs(patch: Patch): void {
  if (!patch.terrainDef) return;
  for (let row = 0; row < patch.height; row++) {
    for (let col = 0; col < patch.width; col++) {
      const point = patch.ctrl[row]?.[col];
      const surface = patch.terrainDef.surfaces[row]?.[col];
      if (!point || !surface) continue;
      point.uv = terrainDefUv(surface, point.xyz[0], point.xyz[1]);
    }
  }
}

export function terrainDefDisplayTexture(patch: Patch): string {
  if (!patch.terrainDef) return patch.texture;
  const centerTexture = patch.terrainDef.surfaces[Math.floor(patch.height / 2)]?.[Math.floor(patch.width / 2)]?.texture;
  const counts = new Map<string, number>();
  let bestTexture = centerTexture ?? patch.texture;
  let bestCount = counts.get(bestTexture) ?? 0;

  for (const row of patch.terrainDef.surfaces) {
    for (const surface of row) {
      const count = (counts.get(surface.texture) ?? 0) + 1;
      counts.set(surface.texture, count);
      if (count > bestCount || (count === bestCount && surface.texture === centerTexture)) {
        bestTexture = surface.texture;
        bestCount = count;
      }
    }
  }

  return bestTexture;
}

export function terrainPaintNeedsPreparation(patch: Patch): boolean {
  return !patch.terrainDef && (patch.width > 3 || patch.height > 3);
}

export function terrainDefCellTriangleIndices(
  patch: Patch,
  row: number,
  col: number,
): [number, number, number, number, number, number] {
  const topLeft = row * patch.width + col;
  const topRight = topLeft + 1;
  const bottomLeft = topLeft + patch.width;
  const bottomRight = bottomLeft + 1;
  if ((row + col) & 1) {
    return [topLeft, bottomLeft, bottomRight, bottomRight, topRight, topLeft];
  }
  return [topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight];
}

export function terrainDefCellTexture(patch: Patch, row: number, col: number): string {
  if (!patch.terrainDef) return patch.texture;
  const textures = [
    patch.terrainDef.surfaces[row]?.[col]?.texture,
    patch.terrainDef.surfaces[row]?.[col + 1]?.texture,
    patch.terrainDef.surfaces[row + 1]?.[col]?.texture,
    patch.terrainDef.surfaces[row + 1]?.[col + 1]?.texture,
  ].filter((texture): texture is string => !!texture);
  if (textures.length === 0) return patch.texture;

  const counts = new Map<string, number>();
  let bestTexture = textures[0];
  let bestCount = 0;
  for (const texture of textures) {
    const count = (counts.get(texture) ?? 0) + 1;
    counts.set(texture, count);
    if (count > bestCount) {
      bestTexture = texture;
      bestCount = count;
    }
  }
  return bestTexture;
}

/** Evaluate a quadratic Bezier at parameter t for a single component. */
function bezier2(a: number, b: number, c: number, t: number): number {
  // B(t) = (1-t)^2 * a + 2(1-t)t * b + t^2 * c
  // Equivalent: (a - 2b + c)*t^2 + (2b - 2a)*t + a
  return (a - 2 * b + c) * t * t + (2 * b - 2 * a) * t + a;
}

/** Sample a single 3x3 biquadratic Bezier sub-patch at (u, v). */
function sampleSubPatch(
  ctrl: PatchControlPoint[][],  // 3 rows x 3 cols
  u: number, v: number
): { xyz: Vec3; uv: [number, number] } {
  // Interpolate 3 rows along u to get 3 intermediate points
  const mid: { xyz: Vec3; uv: [number, number] }[] = [];
  for (let r = 0; r < 3; r++) {
    const p0 = ctrl[r][0], p1 = ctrl[r][1], p2 = ctrl[r][2];
    mid.push({
      xyz: [
        bezier2(p0.xyz[0], p1.xyz[0], p2.xyz[0], u),
        bezier2(p0.xyz[1], p1.xyz[1], p2.xyz[1], u),
        bezier2(p0.xyz[2], p1.xyz[2], p2.xyz[2], u),
      ],
      uv: [
        bezier2(p0.uv[0], p1.uv[0], p2.uv[0], u),
        bezier2(p0.uv[1], p1.uv[1], p2.uv[1], u),
      ],
    });
  }
  // Interpolate the 3 results along v
  return {
    xyz: [
      bezier2(mid[0].xyz[0], mid[1].xyz[0], mid[2].xyz[0], v),
      bezier2(mid[0].xyz[1], mid[1].xyz[1], mid[2].xyz[1], v),
      bezier2(mid[0].xyz[2], mid[1].xyz[2], mid[2].xyz[2], v),
    ],
    uv: [
      bezier2(mid[0].uv[0], mid[1].uv[0], mid[2].uv[0], v),
      bezier2(mid[0].uv[1], mid[1].uv[1], mid[2].uv[1], v),
    ],
  };
}

/** Tessellate a patch into renderable triangles. Call after modifying control points. */
export function tessellatePatch(patch: Patch, subdivisions?: number): void {
  if (subdivisions !== undefined) patch.subdivisions = subdivisions;
  if (patch.terrainDef) {
    syncTerrainDefMetadata(patch);
    tessellateTerrainDefPatch(patch);
    return;
  }
  subdivisions = patch.subdivisions;
  const verts: PatchTessVertex[] = [];
  const indices: number[] = [];

  const subPatchCols = (patch.width - 1) / 2;
  const subPatchRows = (patch.height - 1) / 2;
  const n = subdivisions + 1; // vertices per dimension per sub-patch

  for (let spr = 0; spr < subPatchRows; spr++) {
    for (let spc = 0; spc < subPatchCols; spc++) {
      // Extract the 3x3 sub-grid
      const baseRow = spr * 2;
      const baseCol = spc * 2;
      const sub: PatchControlPoint[][] = [];
      for (let r = 0; r < 3; r++) {
        sub.push([
          patch.ctrl[baseRow + r][baseCol],
          patch.ctrl[baseRow + r][baseCol + 1],
          patch.ctrl[baseRow + r][baseCol + 2],
        ]);
      }

      // Sample (n x n) vertices
      const baseVertex = verts.length;
      for (let vi = 0; vi < n; vi++) {
        const v = vi / subdivisions;
        for (let ui = 0; ui < n; ui++) {
          const u = ui / subdivisions;
          const sample = sampleSubPatch(sub, u, v);
          verts.push({
            position: sample.xyz,
            normal: [0, 0, 1], // placeholder, computed below
            uv: sample.uv,
          });
        }
      }

      // Generate triangle indices for this sub-patch
      for (let vi = 0; vi < subdivisions; vi++) {
        for (let ui = 0; ui < subdivisions; ui++) {
          const topLeft = baseVertex + vi * n + ui;
          const topRight = topLeft + 1;
          const bottomLeft = topLeft + n;
          const bottomRight = bottomLeft + 1;
          indices.push(topLeft, bottomLeft, topRight);
          indices.push(topRight, bottomLeft, bottomRight);
        }
      }
    }
  }

  // Compute per-vertex normals from adjacent triangles
  const normalAccum: Vec3[] = verts.map(() => [0, 0, 0]);
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
    const p0 = verts[i0].position, p1 = verts[i1].position, p2 = verts[i2].position;
    const e1 = vec3Sub(p1, p0);
    const e2 = vec3Sub(p2, p0);
    const n = vec3Cross(e1, e2);
    for (const idx of [i0, i1, i2]) {
      normalAccum[idx][0] += n[0];
      normalAccum[idx][1] += n[1];
      normalAccum[idx][2] += n[2];
    }
  }
  for (let i = 0; i < verts.length; i++) {
    verts[i].normal = vec3Normalize(normalAccum[i]);
  }

  // Compute AABB
  let mins: Vec3 = [Infinity, Infinity, Infinity];
  let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let a = 0; a < 3; a++) {
      if (v.position[a] < mins[a]) mins[a] = v.position[a];
      if (v.position[a] > maxs[a]) maxs[a] = v.position[a];
    }
  }
  // Also include control points in AABB (they may extend beyond tessellation)
  for (const row of patch.ctrl) {
    for (const cp of row) {
      for (let a = 0; a < 3; a++) {
        if (cp.xyz[a] < mins[a]) mins[a] = cp.xyz[a];
        if (cp.xyz[a] > maxs[a]) maxs[a] = cp.xyz[a];
      }
    }
  }

  patch.tessVerts = verts;
  patch.tessIndices = indices;
  patch.mins = mins;
  patch.maxs = maxs;
}

function tessellateTerrainDefPatch(patch: Patch): void {
  const verts: PatchTessVertex[] = [];
  const indices: number[] = [];

  for (let row = 0; row < patch.height; row++) {
    for (let col = 0; col < patch.width; col++) {
      const cp = patch.ctrl[row][col];
      verts.push({
        position: vec3Copy(cp.xyz),
        normal: [0, 0, 1],
        uv: [cp.uv[0], cp.uv[1]],
      });
    }
  }

  for (let row = 0; row < patch.height - 1; row++) {
    for (let col = 0; col < patch.width - 1; col++) {
      indices.push(...terrainDefCellTriangleIndices(patch, row, col));
    }
  }

  const normalAccum: Vec3[] = verts.map(() => [0, 0, 0]);
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
    const p0 = verts[i0].position, p1 = verts[i1].position, p2 = verts[i2].position;
    const e1 = vec3Sub(p1, p0);
    const e2 = vec3Sub(p2, p0);
    const n = vec3Cross(e1, e2);
    for (const idx of [i0, i1, i2]) {
      normalAccum[idx][0] += n[0];
      normalAccum[idx][1] += n[1];
      normalAccum[idx][2] += n[2];
    }
  }
  for (let i = 0; i < verts.length; i++) {
    verts[i].normal = vec3Normalize(normalAccum[i]);
  }

  let mins: Vec3 = [Infinity, Infinity, Infinity];
  let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const cp of patch.ctrl.flat()) {
    for (let a = 0; a < 3; a++) {
      mins[a] = Math.min(mins[a], cp.xyz[a]);
      maxs[a] = Math.max(maxs[a], cp.xyz[a]);
    }
  }

  patch.tessVerts = verts;
  patch.tessIndices = indices;
  patch.mins = mins;
  patch.maxs = maxs;
}

function terrainDefUv(surface: TerrainDefSurface, x: number, y: number): [number, number] {
  const sx = Math.abs(surface.scaleX) > 0.0001 ? surface.scaleX : 0.5;
  const sy = Math.abs(surface.scaleY) > 0.0001 ? surface.scaleY : 0.5;
  const angle = surface.rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rx = x * cos + y * sin;
  const ry = -x * sin + y * cos;
  return [
    rx / (sx * 128) + surface.offsetX / 128,
    ry / (sy * 128) + surface.offsetY / 128,
  ];
}

export function syncTerrainDefMetadata(patch: Patch): void {
  if (!patch.terrainDef) return;

  const terrain = patch.terrainDef;
  const epsilon = 0.001;
  const originX = patch.ctrl[0]?.[0]?.xyz[0] ?? terrain.origin[0];
  const originY = patch.ctrl[0]?.[0]?.xyz[1] ?? terrain.origin[1];
  const scaleX = patch.width > 1 ? patch.ctrl[0][1].xyz[0] - patch.ctrl[0][0].xyz[0] : terrain.scale[0];
  const scaleY = patch.height > 1 ? patch.ctrl[1][0].xyz[1] - patch.ctrl[0][0].xyz[1] : terrain.scale[1];

  let serializable = Number.isFinite(scaleX) && Number.isFinite(scaleY) && Math.abs(scaleX) > epsilon && Math.abs(scaleY) > epsilon;
  for (let row = 0; row < patch.height && serializable; row++) {
    for (let col = 0; col < patch.width; col++) {
      const point = patch.ctrl[row][col].xyz;
      const expectedX = originX + col * scaleX;
      const expectedY = originY + row * scaleY;
      if (Math.abs(point[0] - expectedX) > epsilon || Math.abs(point[1] - expectedY) > epsilon) {
        serializable = false;
        break;
      }
    }
  }

  terrain.origin[0] = originX;
  terrain.origin[1] = originY;
  terrain.scale = [scaleX, scaleY];
  terrain.serializable = serializable;
  syncTerrainDefControlUvs(patch);
  patch.texture = terrainDefDisplayTexture(patch);
}

export function setPatchTexture(patch: Patch, texture: string): void {
  patch.texture = texture;
  if (!patch.terrainDef) return;
  for (const row of patch.terrainDef.surfaces) {
    for (const surface of row) {
      surface.texture = texture;
    }
  }
}

// ── Utility functions ──

export function clonePatch(patch: Patch): Patch {
  const ctrl: PatchControlPoint[][] = patch.ctrl.map(row =>
    row.map(cp => ({
      xyz: vec3Copy(cp.xyz),
      uv: [cp.uv[0], cp.uv[1]] as [number, number],
      terrainCoord: cp.terrainCoord ? [cp.terrainCoord[0], cp.terrainCoord[1]] as [number, number] : undefined,
    }))
  );
  const p: Patch = {
    width: patch.width,
    height: patch.height,
    texture: patch.texture,
    terrainGroupId: patch.terrainGroupId,
    terrainDef: patch.terrainDef
      ? {
          origin: vec3Copy(patch.terrainDef.origin),
          scale: [patch.terrainDef.scale[0], patch.terrainDef.scale[1]],
          surfaces: patch.terrainDef.surfaces.map(row => row.map(surface => ({ ...surface }))),
          serializable: patch.terrainDef.serializable,
        }
      : undefined,
    contentFlags: patch.contentFlags,
    surfaceFlags: patch.surfaceFlags,
    value: patch.value,
    ctrl,
    subdivisions: patch.subdivisions,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    tessVerts: [],
    tessIndices: [],
  };
  tessellatePatch(p);
  return p;
}

export function translatePatch(patch: Patch, delta: Vec3): void {
  for (const row of patch.ctrl) {
    for (const cp of row) {
      cp.xyz[0] += delta[0];
      cp.xyz[1] += delta[1];
      cp.xyz[2] += delta[2];
    }
  }
  if (patch.terrainDef) {
    tessellatePatch(patch);
    return;
  }
  for (const v of patch.tessVerts) {
    v.position[0] += delta[0];
    v.position[1] += delta[1];
    v.position[2] += delta[2];
  }
  patch.mins[0] += delta[0]; patch.mins[1] += delta[1]; patch.mins[2] += delta[2];
  patch.maxs[0] += delta[0]; patch.maxs[1] += delta[1]; patch.maxs[2] += delta[2];
}

export function rotatePatch(patch: Patch, center: Vec3, axis: number, angle: number): void {
  for (const row of patch.ctrl) {
    for (const cp of row) {
      cp.xyz = vec3RotateAxis(cp.xyz, center, axis, angle);
    }
  }
  tessellatePatch(patch);
}

export function mirrorPatch(patch: Patch, center: Vec3, axis: number): void {
  for (const row of patch.ctrl) {
    for (const cp of row) {
      cp.xyz = vec3MirrorAxis(cp.xyz, center, axis);
    }
    row.reverse();
  }
  tessellatePatch(patch);
}

/** Scale patch control points from origCtrl around scaleOrigin by scale factors, then re-tessellate. */
export function scalePatchControlPoints(
  patch: Patch,
  origCtrl: PatchControlPoint[][],
  scaleOrigin: Vec3,
  scale: Vec3,
): void {
  for (let r = 0; r < patch.height; r++) {
    for (let c = 0; c < patch.width; c++) {
      const orig = origCtrl[r][c].xyz;
      patch.ctrl[r][c].xyz = [
        scaleOrigin[0] + (orig[0] - scaleOrigin[0]) * scale[0],
        scaleOrigin[1] + (orig[1] - scaleOrigin[1]) * scale[1],
        scaleOrigin[2] + (orig[2] - scaleOrigin[2]) * scale[2],
      ];
    }
  }
  tessellatePatch(patch);
}

export function patchCenter(patch: Patch): Vec3 {
  return [
    (patch.mins[0] + patch.maxs[0]) / 2,
    (patch.mins[1] + patch.maxs[1]) / 2,
    (patch.mins[2] + patch.maxs[2]) / 2,
  ];
}

// ── Patch creation presets ──

function makePatch(width: number, height: number, ctrl: PatchControlPoint[][], texture: string): Patch {
  const patch: Patch = {
    width, height, texture,
    contentFlags: 0, surfaceFlags: 0, value: 0,
    ctrl, subdivisions: SUBDIVISIONS,
    mins: [0, 0, 0], maxs: [0, 0, 0],
    tessVerts: [], tessIndices: [],
  };
  tessellatePatch(patch);
  return patch;
}

function cp(x: number, y: number, z: number, u: number, v: number): PatchControlPoint {
  return { xyz: [x, y, z], uv: [u, v] };
}

/** Create a flat rectangular patch on the XY plane at z=maxs[2]. */
export function createFlatPatch(mins: Vec3, maxs: Vec3, texture: string): Patch {
  const [x0, y0, z0] = mins;
  const [x1, y1] = maxs;
  const z = maxs[2];
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const ctrl: PatchControlPoint[][] = [
    [cp(x0, y1, z, 0, 0), cp(mx, y1, z, 0.5, 0), cp(x1, y1, z, 1, 0)],
    [cp(x0, my, z, 0, 0.5), cp(mx, my, z, 0.5, 0.5), cp(x1, my, z, 1, 0.5)],
    [cp(x0, y0, z, 0, 1), cp(mx, y0, z, 0.5, 1), cp(x1, y0, z, 1, 1)],
  ];
  return makePatch(3, 3, ctrl, texture);
}

/** Create a flat grid patch aligned to the given axes at the max depth of the selection bounds. */
export function createGridPatch(
  mins: Vec3,
  maxs: Vec3,
  texture: string,
  width: number,
  height: number,
  axisH: number,
  axisV: number,
  axisDepth: number,
): Patch {
  const clampedWidth = Math.max(3, width | 1);
  const clampedHeight = Math.max(3, height | 1);
  const hMin = mins[axisH];
  const hMax = maxs[axisH];
  const vMin = mins[axisV];
  const vMax = maxs[axisV];
  const depth = maxs[axisDepth];
  const ctrl: PatchControlPoint[][] = [];

  for (let row = 0; row < clampedHeight; row++) {
    const tv = clampedHeight === 1 ? 0 : row / (clampedHeight - 1);
    const v = vMax + (vMin - vMax) * tv;
    const ctrlRow: PatchControlPoint[] = [];
    for (let col = 0; col < clampedWidth; col++) {
      const tu = clampedWidth === 1 ? 0 : col / (clampedWidth - 1);
      const h = hMin + (hMax - hMin) * tu;
      const point: Vec3 = [0, 0, 0];
      point[axisH] = h;
      point[axisV] = v;
      point[axisDepth] = depth;
      ctrlRow.push({ xyz: point, uv: [tu, tv] });
    }
    ctrl.push(ctrlRow);
  }

  return makePatch(clampedWidth, clampedHeight, ctrl, texture);
}

export function createTerrainDefGridPatch(
  mins: Vec3,
  maxs: Vec3,
  texture: string,
  width: number,
  height: number,
): Patch {
  const clampedWidth = Math.max(2, width);
  const clampedHeight = Math.max(2, height);
  const xMin = mins[0];
  const xMax = maxs[0];
  const yMin = mins[1];
  const yMax = maxs[1];
  const zBase = maxs[2];
  const scaleX = clampedWidth === 1 ? 0 : (xMax - xMin) / (clampedWidth - 1);
  const scaleY = clampedHeight === 1 ? 0 : (yMax - yMin) / (clampedHeight - 1);
  const surface = defaultTerrainDefSurface(texture);
  const ctrl: PatchControlPoint[][] = [];
  const surfaces: TerrainDefSurface[][] = [];

  for (let row = 0; row < clampedHeight; row++) {
    const y = yMin + row * scaleY;
    const ctrlRow: PatchControlPoint[] = [];
    const surfaceRow: TerrainDefSurface[] = [];
    for (let col = 0; col < clampedWidth; col++) {
      const x = xMin + col * scaleX;
      ctrlRow.push({
        xyz: [x, y, zBase],
        uv: terrainDefUv(surface, x, y),
      });
      surfaceRow.push({ ...surface });
    }
    ctrl.push(ctrlRow);
    surfaces.push(surfaceRow);
  }

  const patch = makePatch(clampedWidth, clampedHeight, ctrl, texture);
  patch.terrainDef = {
    origin: [xMin, yMin, zBase],
    scale: [scaleX, scaleY],
    surfaces,
    serializable: true,
  };
  tessellatePatch(patch);
  return patch;
}

/** Create a half-cylinder patch. The cylinder curves from mins to maxs in X, extruded along Z. */
export function createCylinderPatch(mins: Vec3, maxs: Vec3, texture: string): Patch {
  const [x0, y0, z0] = mins;
  const [x1, y1, z1] = maxs;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const mz = (z0 + z1) / 2;

  // 9 columns around the XY rectangle, 3 rows (bottom, mid, top Z)
  // Columns go counter-clockwise (outward-facing normals) when viewed from above
  const corners: [number, number][] = [
    [x0, my],                 // 0: left middle
    [x0, y1],                 // 1: top-left corner (control point)
    [mx, y1],                 // 2: top center
    [x1, y1],                 // 3: top-right corner (control point)
    [x1, my],                 // 4: right middle
    [x1, y0],                 // 5: bottom-right corner (control point)
    [mx, y0],                 // 6: bottom center
    [x0, y0],                 // 7: bottom-left corner (control point)
    [x0, my],                 // 8: wraps back to left middle
  ];

  const ctrl: PatchControlPoint[][] = [];
  const rows = [[z0, 0], [mz, 0.5], [z1, 1]];
  for (const [z, tv] of rows) {
    const row: PatchControlPoint[] = [];
    for (let c = 0; c < 9; c++) {
      const [px, py] = corners[c];
      row.push(cp(px, py, z, c / 8, tv));
    }
    ctrl.push(row);
  }
  return makePatch(9, 3, ctrl, texture);
}

/** Create a cone patch — cylinder with top row collapsed to center. */
export function createConePatch(mins: Vec3, maxs: Vec3, texture: string): Patch {
  const patch = createCylinderPatch(mins, maxs, texture);
  const mx = (mins[0] + maxs[0]) / 2;
  const my = (mins[1] + maxs[1]) / 2;
  // Collapse the top row (last row) to center XY
  const topRow = patch.ctrl[patch.height - 1];
  for (const pt of topRow) {
    pt.xyz[0] = mx;
    pt.xyz[1] = my;
  }
  tessellatePatch(patch);
  return patch;
}

/** Create a bevel (quarter-pipe) patch — 3-wide strip curving 90 degrees. */
export function createBevelPatch(mins: Vec3, maxs: Vec3, texture: string): Patch {
  const [x0, y0, z0] = mins;
  const [x1, y1, z1] = maxs;
  const mz = (z0 + z1) / 2;
  const ctrl: PatchControlPoint[][] = [
    [cp(x1, y1, z0, 1, 1), cp(x1, y0, z0, 1, 0), cp(x0, y0, z0, 0, 0)],
    [cp(x1, y1, mz, 1, 1), cp(x1, y0, mz, 1, 0), cp(x0, y0, mz, 0, 0)],
    [cp(x1, y1, z1, 1, 1), cp(x1, y0, z1, 1, 0), cp(x0, y0, z1, 0, 0)],
  ];
  return makePatch(3, 3, ctrl, texture);
}

/** Create an end cap patch — 5-point arc across XY, extruded along Z. */
export function createEndcapPatch(mins: Vec3, maxs: Vec3, texture: string): Patch {
  const [x0, y0, z0] = mins;
  const [x1, y1, z1] = maxs;
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  const ctrl: PatchControlPoint[][] = [
    [cp(x1, y0, z0, 1, 0), cp(x1, y1, z0, 1, 1), cp(mx, y1, z0, 0.5, 1), cp(x0, y1, z0, 0, 1), cp(x0, y0, z0, 0, 0)],
    [cp(x1, y0, mz, 1, 0), cp(x1, y1, mz, 1, 1), cp(mx, y1, mz, 0.5, 1), cp(x0, y1, mz, 0, 1), cp(x0, y0, mz, 0, 0)],
    [cp(x1, y0, z1, 1, 0), cp(x1, y1, z1, 1, 1), cp(mx, y1, z1, 0.5, 1), cp(x0, y1, z1, 0, 1), cp(x0, y0, z1, 0, 0)],
  ];
  return makePatch(5, 3, ctrl, texture);
}
