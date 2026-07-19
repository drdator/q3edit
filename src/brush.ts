import {
  Vec3, Plane, vec3, vec3Add, vec3Sub, vec3Scale, vec3Cross, vec3Dot,
  vec3Normalize, vec3Copy, vec3Lerp, vec3Min, vec3Max, vec3Snap,
  vec3RotateAxis, vec3MirrorAxis, vec3Length, planeFromPoints, planePointDistance
} from './math';

export interface ClassicBrushTextureProjection {
  kind: 'classic';
  offsetX: number;
  offsetY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface BrushPrimitiveTextureProjection {
  kind: 'brush-primitive';
  matrix: [[number, number, number], [number, number, number]];
}

export type BrushTextureProjection = ClassicBrushTextureProjection | BrushPrimitiveTextureProjection;

export interface BrushFace {
  points: [Vec3, Vec3, Vec3];  // 3 points defining the plane (for .map format)
  texture: string;
  textureProjection: BrushTextureProjection;
  contentFlags: number;
  surfaceFlags: number;
  value: number;
  // Computed
  plane: Plane;
  polygon: Vec3[];
}

export interface Brush {
  faces: BrushFace[];
  name?: string;
  /** Brush-local epairs used by brushDef. */
  properties?: Record<string, string>;
  // Computed AABB
  mins: Vec3;
  maxs: Vec3;
}

export function createFace(
  p1: Vec3, p2: Vec3, p3: Vec3,
  texture = 'common/caulk',
  offsetX = 0, offsetY = 0, rotation = 0,
  scaleX = 0.5, scaleY = 0.5,
  contentFlags = 0, surfaceFlags = 0, value = 0,
): BrushFace {
  return {
    points: [vec3Copy(p1), vec3Copy(p2), vec3Copy(p3)],
    texture,
    textureProjection: { kind: 'classic', offsetX, offsetY, rotation, scaleX, scaleY },
    contentFlags, surfaceFlags, value,
    plane: planeFromPoints(p1, p2, p3),
    polygon: [],
  };
}

export function createBoxBrush(mins: Vec3, maxs: Vec3, texture = 'common/caulk'): Brush {
  const [x0, y0, z0] = mins;
  const [x1, y1, z1] = maxs;

  const faces: BrushFace[] = [
    // +X (right)
    createFace([x1,y0,z0], [x1,y1,z0], [x1,y0,z1], texture),
    // -X (left)
    createFace([x0,y0,z0], [x0,y0,z1], [x0,y1,z0], texture),
    // +Y (back)
    createFace([x0,y1,z0], [x0,y1,z1], [x1,y1,z0], texture),
    // -Y (front)
    createFace([x0,y0,z0], [x1,y0,z0], [x0,y0,z1], texture),
    // +Z (top)
    createFace([x0,y0,z1], [x1,y0,z1], [x0,y1,z1], texture),
    // -Z (bottom)
    createFace([x0,y0,z0], [x0,y1,z0], [x1,y0,z0], texture),
  ];

  const brush: Brush = { faces, mins: vec3Copy(mins), maxs: vec3Copy(maxs) };
  computeBrushGeometry(brush);
  return brush;
}

export function computeBrushGeometry(brush: Brush): void {
  // Recompute planes from defining points, then recompute polygons
  for (const face of brush.faces) {
    face.plane = planeFromPoints(face.points[0], face.points[1], face.points[2]);
  }
  recomputePolygons(brush);
}

function recomputePolygons(brush: Brush): void {
  let globalMins: Vec3 = [Infinity, Infinity, Infinity];
  let globalMaxs: Vec3 = [-Infinity, -Infinity, -Infinity];

  // Compute base polygon size from actual brush extent
  let maxCoord = 0;
  for (const face of brush.faces) {
    for (const p of face.points) {
      for (let i = 0; i < 3; i++) maxCoord = Math.max(maxCoord, Math.abs(p[i]));
    }
  }
  const baseSize = Math.max(65536, maxCoord * 4);

  for (let i = 0; i < brush.faces.length; i++) {
    const face = brush.faces[i];

    // Start with a large polygon on this face's plane
    let polygon = createBasePolygon(face.plane, baseSize);

    // Clip against all other faces
    for (let j = 0; j < brush.faces.length; j++) {
      if (i === j) continue;
      polygon = clipPolygonByPlane(polygon, brush.faces[j].plane);
      if (polygon.length < 3) break;
    }

    face.polygon = polygon;

    for (const v of polygon) {
      globalMins = vec3Min(globalMins, v);
      globalMaxs = vec3Max(globalMaxs, v);
    }
  }

  brush.mins = globalMins;
  brush.maxs = globalMaxs;
}

function createBasePolygon(plane: Plane, size: number): Vec3[] {
  const n = plane.normal;
  const abs = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];

  let up: Vec3;
  if (abs[2] >= abs[0] && abs[2] >= abs[1]) {
    up = [0, 1, 0];
  } else {
    up = [0, 0, 1];
  }

  const right = vec3Normalize(vec3Cross(up, n));
  const realUp = vec3Cross(n, right);
  const center = vec3Scale(n, plane.dist);

  return [
    vec3Add(center, vec3Add(vec3Scale(right, -size), vec3Scale(realUp, -size))),
    vec3Add(center, vec3Add(vec3Scale(right,  size), vec3Scale(realUp, -size))),
    vec3Add(center, vec3Add(vec3Scale(right,  size), vec3Scale(realUp,  size))),
    vec3Add(center, vec3Add(vec3Scale(right, -size), vec3Scale(realUp,  size))),
  ];
}

function clipPolygonByPlane(polygon: Vec3[], plane: Plane): Vec3[] {
  if (polygon.length < 3) return [];
  const result: Vec3[] = [];
  const dists = polygon.map(v => planePointDistance(plane, v));

  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const di = dists[i];
    const dj = dists[j];

    // Keep vertices on back side or on the plane
    if (di <= 1e-4) {
      result.push(polygon[i]);
    }

    // Edge crosses the plane
    if ((di > 1e-4 && dj < -1e-4) || (di < -1e-4 && dj > 1e-4)) {
      const t = di / (di - dj);
      result.push(vec3Lerp(polygon[i], polygon[j], t));
    }
  }

  return result;
}

export function translateBrush(brush: Brush, delta: Vec3): void {
  for (const face of brush.faces) {
    // Move the defining points
    for (let i = 0; i < 3; i++) {
      face.points[i] = vec3Add(face.points[i], delta);
    }
    // Translate the plane directly — avoids floating point drift from recomputing normal
    face.plane.dist += vec3Dot(face.plane.normal, delta);
    // Translate polygon vertices directly — preserves non-planar geometry from vertex edits
    face.polygon = face.polygon.map(v => vec3Add(v, delta));
  }
  brush.mins = vec3Add(brush.mins, delta);
  brush.maxs = vec3Add(brush.maxs, delta);
}

export function rotateBrush(brush: Brush, center: Vec3, axis: number, angle: number): void {
  let mins: Vec3 = [Infinity, Infinity, Infinity];
  let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const face of brush.faces) {
    for (let i = 0; i < 3; i++) {
      face.points[i] = vec3RotateAxis(face.points[i], center, axis, angle);
    }
    face.plane = planeFromPoints(face.points[0], face.points[1], face.points[2]);
    // Rotate polygon vertices directly — preserves non-planar geometry from vertex edits
    face.polygon = face.polygon.map(v => vec3RotateAxis(v, center, axis, angle));
    for (const v of face.polygon) {
      mins = vec3Min(mins, v);
      maxs = vec3Max(maxs, v);
    }
  }
  brush.mins = mins;
  brush.maxs = maxs;
}

export function mirrorBrush(brush: Brush, center: Vec3, axis: number): void {
  let mins: Vec3 = [Infinity, Infinity, Infinity];
  let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const face of brush.faces) {
    const mirroredPoints = face.points.map(point => vec3MirrorAxis(point, center, axis)) as [Vec3, Vec3, Vec3];
    face.points = [mirroredPoints[2], mirroredPoints[1], mirroredPoints[0]];
    face.plane = planeFromPoints(face.points[0], face.points[1], face.points[2]);

    const mirroredPolygon = face.polygon.map(v => vec3MirrorAxis(v, center, axis));
    mirroredPolygon.reverse();
    face.polygon = mirroredPolygon;

    const boundsVerts = face.polygon.length > 0 ? face.polygon : face.points;
    for (const v of boundsVerts) {
      mins = vec3Min(mins, v);
      maxs = vec3Max(maxs, v);
    }
  }

  brush.mins = mins;
  brush.maxs = maxs;
}

export function brushContainsPoint2D(brush: Brush, x: number, y: number, axisH: number, axisV: number): boolean {
  return x >= brush.mins[axisH] && x <= brush.maxs[axisH] &&
         y >= brush.mins[axisV] && y <= brush.maxs[axisV];
}

export function cloneBrush(brush: Brush): Brush {
  const faces = brush.faces.map(f => ({
    ...f,
    points: [vec3Copy(f.points[0]), vec3Copy(f.points[1]), vec3Copy(f.points[2])] as [Vec3, Vec3, Vec3],
    plane: { normal: vec3Copy(f.plane.normal), dist: f.plane.dist },
    polygon: f.polygon.map(vec3Copy),
    textureProjection: cloneTextureProjection(f.textureProjection),
  }));
  return {
    faces,
    name: brush.name,
    properties: brush.properties ? { ...brush.properties } : undefined,
    mins: vec3Copy(brush.mins),
    maxs: vec3Copy(brush.maxs),
  };
}

export function cloneTextureProjection(projection: BrushTextureProjection): BrushTextureProjection {
  if (projection.kind === 'classic') return { ...projection };
  return {
    kind: 'brush-primitive',
    matrix: [
      [...projection.matrix[0]],
      [...projection.matrix[1]],
    ],
  };
}

export function classicTextureProjection(face: BrushFace): ClassicBrushTextureProjection | null {
  return face.textureProjection.kind === 'classic' ? face.textureProjection : null;
}

// Get brush center
export function brushCenter(brush: Brush): Vec3 {
  return vec3Scale(vec3Add(brush.mins, brush.maxs), 0.5);
}

// ── Texture coordinate computation (Q3 algorithm from q3radiant) ──

// Base texture axes for the 6 cardinal normal directions
const BASE_AXES: Vec3[][] = [
  [[0,0,1],  [1,0,0],  [0,-1,0]],   // +Z floor
  [[0,0,-1], [1,0,0],  [0,-1,0]],   // -Z ceiling
  [[1,0,0],  [0,1,0],  [0,0,-1]],   // +X east
  [[-1,0,0], [0,1,0],  [0,0,-1]],   // -X west
  [[0,1,0],  [1,0,0],  [0,0,-1]],   // +Y north
  [[0,-1,0], [1,0,0],  [0,0,-1]],   // -Y south
];

export function textureAxisFromPlane(normal: Vec3): [Vec3, Vec3] {
  let bestAxis = 0;
  let bestDot = 0;
  for (let i = 0; i < 6; i++) {
    const dot = vec3Dot(normal, BASE_AXES[i][0] as Vec3);
    if (dot > bestDot) {
      bestDot = dot;
      bestAxis = i;
    }
  }
  return [
    vec3Copy(BASE_AXES[bestAxis][1] as Vec3),
    vec3Copy(BASE_AXES[bestAxis][2] as Vec3),
  ];
}

export function computeFaceUV(
  vertex: Vec3,
  face: BrushFace,
  texWidth: number,
  texHeight: number
): [number, number] {
  const [sv, tv] = textureAxisFromPlane(face.plane.normal);

  if (face.textureProjection.kind === 'brush-primitive') {
    const x = vec3Dot(vertex, sv);
    const y = vec3Dot(vertex, tv);
    const [s, t] = face.textureProjection.matrix;
    return [
      s[0] * x + s[1] * y + s[2],
      t[0] * x + t[1] * y + t[2],
    ];
  }

  const projection = face.textureProjection;
  const ang = (projection.rotation / 180) * Math.PI;
  const sinv = Math.sin(ang);
  const cosv = Math.cos(ang);

  // Rotated and scaled texture vectors
  const scaleX = projection.scaleX || 0.5;
  const scaleY = projection.scaleY || 0.5;

  const s: Vec3 = [0, 0, 0];
  const t: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    s[i] = (cosv * sv[i] - sinv * tv[i]) / scaleX;
    t[i] = (sinv * sv[i] + cosv * tv[i]) / scaleY;
  }

  const u = (vec3Dot(vertex, s) + projection.offsetX) / texWidth;
  const v = (vec3Dot(vertex, t) + projection.offsetY) / texHeight;

  return [u, v];
}

// Clip a brush by a plane. Returns the portion on the back side of the plane
// (behind the plane, where planePointDistance <= 0), or null if nothing remains.
// planePoints are the 3 defining points for the new cap face.
function copyFaceStyle(
  source: BrushFace | undefined,
  planePoints: [Vec3, Vec3, Vec3],
  texture?: string,
): BrushFace {
  const face = createFace(
    planePoints[0],
    planePoints[1],
    planePoints[2],
    texture ?? source?.texture ?? 'common/caulk',
  );

  if (source) {
    face.textureProjection = cloneTextureProjection(source.textureProjection);
    face.contentFlags = source.contentFlags;
    face.surfaceFlags = source.surfaceFlags;
    face.value = source.value;
  }

  return face;
}

function dedupeCoplanarFaces(faces: BrushFace[]): BrushFace[] {
  const NORMAL_EPSILON = 1e-4;
  const DIST_EPSILON = 0.02;
  const unique: BrushFace[] = [];

  outer: for (const face of faces) {
    for (const existing of unique) {
      const sameNormal =
        Math.abs(face.plane.normal[0] - existing.plane.normal[0]) < NORMAL_EPSILON &&
        Math.abs(face.plane.normal[1] - existing.plane.normal[1]) < NORMAL_EPSILON &&
        Math.abs(face.plane.normal[2] - existing.plane.normal[2]) < NORMAL_EPSILON;
      if (sameNormal && Math.abs(face.plane.dist - existing.plane.dist) < DIST_EPSILON) {
        continue outer;
      }
    }
    unique.push(face);
  }

  return unique;
}

export function clipBrush(brush: Brush, planePoints: [Vec3, Vec3, Vec3], texture?: string): Brush | null {
  // Clone all original faces
  const faces: BrushFace[] = brush.faces.map(f => ({
    ...f,
    points: [vec3Copy(f.points[0]), vec3Copy(f.points[1]), vec3Copy(f.points[2])] as [Vec3, Vec3, Vec3],
    plane: { normal: vec3Copy(f.plane.normal), dist: f.plane.dist },
    polygon: [],
    textureProjection: cloneTextureProjection(f.textureProjection),
  }));

  // Add the clip face
  faces.push(copyFaceStyle(brush.faces[0], planePoints, texture));

  const newBrush: Brush = { faces, mins: [0, 0, 0], maxs: [0, 0, 0] };
  computeBrushGeometry(newBrush);

  // Remove faces with degenerate polygons
  newBrush.faces = dedupeCoplanarFaces(newBrush.faces.filter(f => f.polygon.length >= 3));

  // Need at least 4 faces for a valid convex brush
  if (newBrush.faces.length < 4) return null;

  const validation = validateBrush(newBrush);
  if (!validation.valid) return null;

  return newBrush;
}

// Scale brush faces along given axes from an origin point.
// scaleOrigin is the fixed anchor, scale is per-axis multiplier.
// origPoints are the saved original face defining points.
export function scaleBrushFaces(
  brush: Brush,
  origPoints: [Vec3, Vec3, Vec3][],
  scaleOrigin: Vec3,
  scale: Vec3
): void {
  for (let fi = 0; fi < brush.faces.length; fi++) {
    for (let pi = 0; pi < 3; pi++) {
      for (let i = 0; i < 3; i++) {
        brush.faces[fi].points[pi][i] = scaleOrigin[i] + (origPoints[fi][pi][i] - scaleOrigin[i]) * scale[i];
      }
    }
  }
  computeBrushGeometry(brush);
}

// ── Brush geometry validation ──

export interface BrushValidationResult {
  valid: boolean;
  issues: string[];
}

/** Validate brush geometry for BSP compatibility. */
export function validateBrush(brush: Brush): BrushValidationResult {
  const issues: string[] = [];

  // Minimum face count
  if (brush.faces.length < 4) {
    issues.push(`Too few faces (${brush.faces.length}, need at least 4)`);
  }

  // Check for degenerate planes (zero-length normals)
  for (let i = 0; i < brush.faces.length; i++) {
    const n = brush.faces[i].plane.normal;
    const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (len < 0.5) {
      issues.push(`Face ${i}: degenerate plane (zero normal)`);
    }
  }

  // Check for faces with too few polygon vertices
  for (let i = 0; i < brush.faces.length; i++) {
    if (brush.faces[i].polygon.length < 3) {
      issues.push(`Face ${i}: degenerate polygon (${brush.faces[i].polygon.length} vertices)`);
    }
  }

  // Check convexity: every vertex should be on or behind every face plane
  const CONVEX_EPSILON = 0.5;
  let nonConvex = false;
  for (let fi = 0; fi < brush.faces.length && !nonConvex; fi++) {
    const plane = brush.faces[fi].plane;
    for (let fj = 0; fj < brush.faces.length; fj++) {
      if (fi === fj) continue;
      for (const v of brush.faces[fj].polygon) {
        const dist = planePointDistance(plane, v);
        if (dist > CONVEX_EPSILON) {
          issues.push(`Non-convex: vertex ${dist.toFixed(1)} units in front of face ${fi}`);
          nonConvex = true;
          break;
        }
      }
      if (nonConvex) break;
    }
  }

  // Check for coplanar faces (same normal direction, same distance)
  for (let i = 0; i < brush.faces.length; i++) {
    for (let j = i + 1; j < brush.faces.length; j++) {
      const dot = vec3Dot(brush.faces[i].plane.normal, brush.faces[j].plane.normal);
      if (dot > 0.999) {
        const d1 = brush.faces[i].plane.dist;
        const d2 = brush.faces[j].plane.dist;
        if (Math.abs(d1 - d2) < 0.1) {
          issues.push(`Faces ${i} and ${j} are coplanar (duplicate)`);
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/** Update face.points from its polygon vertices (picks 3 non-collinear points). */
export function updateFacePointsFromPolygon(face: BrushFace): void {
  const polygon = face.polygon;
  for (let i = 0; i < polygon.length; i++) {
    const p0 = polygon[i];
    const p1 = polygon[(i + 1) % polygon.length];
    const p2 = polygon[(i + 2) % polygon.length];
    const cross = vec3Cross(vec3Sub(p1, p0), vec3Sub(p2, p0));
    if (vec3Length(cross) > 1e-6) {
      face.points = [vec3Copy(p0), vec3Copy(p1), vec3Copy(p2)];
      return;
    }
  }
  face.points = [vec3Copy(polygon[0]), vec3Copy(polygon[1]), vec3Copy(polygon[2])];
}

/** Rebuild brush from its face planes — reconvexifies and removes degenerate faces. */
export function rebuildBrush(brush: Brush): void {
  computeBrushGeometry(brush);
  // Remove faces whose polygons were clipped away entirely
  brush.faces = brush.faces.filter(f => f.polygon.length >= 3);
}

// ── Convex decomposition ──

/**
 * Split non-planar face polygons into planar triangles.
 * After vertex editing, faces can have 4+ vertices where not all lie on the
 * same plane. The face.plane (from 3 vertices) is then inaccurate, breaking
 * the convexity check and split algorithm. Triangulating ensures every face
 * is planar with an accurate plane.
 */
function triangulateNonPlanarFaces(brush: Brush): void {
  const PLANAR_EPSILON = 0.1;
  const newFaces: BrushFace[] = [];

  for (const face of brush.faces) {
    if (face.polygon.length <= 3) {
      newFaces.push(face);
      continue;
    }

    // Check if all polygon vertices lie on the face plane
    let maxDist = 0;
    for (const v of face.polygon) {
      maxDist = Math.max(maxDist, Math.abs(planePointDistance(face.plane, v)));
    }

    if (maxDist <= PLANAR_EPSILON) {
      newFaces.push(face);
      continue;
    }

    // Fan-triangulate from first vertex
    for (let i = 1; i < face.polygon.length - 1; i++) {
      const p0 = face.polygon[0];
      const p1 = face.polygon[i];
      const p2 = face.polygon[i + 1];
      const triPlane = planeFromPoints(p0, p1, p2);
      newFaces.push({
        ...face,
        points: [vec3Copy(p0), vec3Copy(p1), vec3Copy(p2)],
        plane: triPlane,
        polygon: [vec3Copy(p0), vec3Copy(p1), vec3Copy(p2)],
      });
    }
  }

  brush.faces = newFaces;
}

/**
 * Split a non-convex brush into multiple convex brushes by recursively
 * cutting along violated face planes.
 */
export function splitBrushConvex(brush: Brush, maxDepth = 8): Brush[] {
  if (maxDepth <= 0) return [brush];

  // Triangulate non-planar faces so every face has an accurate plane.
  // Without this, the convexity check and split use tilted planes from
  // 3 of a non-planar polygon's vertices, producing wrong results.
  triangulateNonPlanarFaces(brush);

  // Find the face plane with the worst convexity violation
  const CONVEX_EPSILON = 0.5;
  let splitFaceIdx = -1;
  let worstDist = CONVEX_EPSILON;

  for (let fi = 0; fi < brush.faces.length; fi++) {
    const plane = brush.faces[fi].plane;
    for (let fj = 0; fj < brush.faces.length; fj++) {
      if (fi === fj) continue;
      for (const v of brush.faces[fj].polygon) {
        const dist = planePointDistance(plane, v);
        if (dist > worstDist) {
          worstDist = dist;
          splitFaceIdx = fi;
        }
      }
    }
  }

  if (splitFaceIdx === -1) {
    // Already convex — keep the clipped polygons as the authoritative geometry.
    // Don't call rebuildBrush: it recomputes polygons from planes, which distorts
    // non-planar faces left over from vertex editing. Instead, just update
    // face.points/plane for map-file compatibility and recompute the AABB.
    brush.faces = brush.faces.filter(f => f.polygon.length >= 3);
    for (const face of brush.faces) {
      updateFacePointsFromPolygon(face);
      face.plane = planeFromPoints(face.points[0], face.points[1], face.points[2]);
    }
    let mins: Vec3 = [Infinity, Infinity, Infinity];
    let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const face of brush.faces) {
      for (const v of face.polygon) {
        mins = vec3Min(mins, v);
        maxs = vec3Max(maxs, v);
      }
    }
    brush.mins = mins;
    brush.maxs = maxs;
    return [brush];
  }

  const splitPlane = brush.faces[splitFaceIdx].plane;
  const [backBrush, frontBrush] = splitBrushByPlane(brush, splitFaceIdx, splitPlane);

  const results: Brush[] = [];
  if (backBrush) results.push(...splitBrushConvex(backBrush, maxDepth - 1));
  if (frontBrush) results.push(...splitBrushConvex(frontBrush, maxDepth - 1));

  return results.length > 0 ? results : [brush];
}

/** Split a brush's polygons along a plane, producing two brushes. */
function splitBrushByPlane(brush: Brush, splitFaceIdx: number, splitPlane: Plane): [Brush | null, Brush | null] {
  const invertedPlane: Plane = {
    normal: vec3Scale(splitPlane.normal, -1) as Vec3,
    dist: -splitPlane.dist,
  };

  const backFaces: BrushFace[] = [];
  const frontFaces: BrushFace[] = [];
  const cutPoints: Vec3[] = [];

  for (let fi = 0; fi < brush.faces.length; fi++) {
    const face = brush.faces[fi];

    if (fi === splitFaceIdx) {
      // The splitting face belongs to the back brush only (it IS the boundary).
      // Keep its full polygon — it may be non-planar after vertex editing, but
      // it represents the correct visual geometry the user created.
      backFaces.push(cloneFaceKeepPlane(face, face.polygon));
      continue;
    }

    // Clip polygon to each side of the split plane
    const backPoly = clipPolygonByPlane(face.polygon, splitPlane);
    const frontPoly = clipPolygonByPlane(face.polygon, invertedPlane);

    if (backPoly.length >= 3) {
      backFaces.push(cloneFaceKeepPlane(face, backPoly));
    }
    if (frontPoly.length >= 3) {
      frontFaces.push(cloneFaceKeepPlane(face, frontPoly));
    }

    // Collect vertices that lie on the split plane (the cut boundary)
    for (const v of backPoly) {
      if (Math.abs(planePointDistance(splitPlane, v)) < 1e-3) {
        let dup = false;
        for (const cp of cutPoints) {
          const dx = v[0] - cp[0], dy = v[1] - cp[1], dz = v[2] - cp[2];
          if (dx * dx + dy * dy + dz * dz < 0.01) { dup = true; break; }
        }
        if (!dup) cutPoints.push(vec3Copy(v));
      }
    }
  }

  // Only the front brush needs a cap face (inverted splitting plane).
  // The back brush already has the splitting face as its boundary.
  if (cutPoints.length >= 3) {
    const capPoly = orderPointsOnPlane(cutPoints, splitPlane);
    frontFaces.push(makeCaulkFace([...capPoly].reverse(), invertedPlane));
  }

  const backBrush = backFaces.length >= 4 ? assembleBrush(backFaces) : null;
  const frontBrush = frontFaces.length >= 4 ? assembleBrush(frontFaces) : null;

  return [backBrush, frontBrush];
}

/**
 * Clone a face with a (possibly clipped) polygon, keeping the original face.points
 * so that planeFromPoints produces the same plane. Clipping doesn't change the
 * infinite plane a face lies on, only its visible extent.
 */
function cloneFaceKeepPlane(face: BrushFace, polygon: Vec3[]): BrushFace {
  return {
    ...face,
    points: [vec3Copy(face.points[0]), vec3Copy(face.points[1]), vec3Copy(face.points[2])],
    plane: { normal: vec3Copy(face.plane.normal), dist: face.plane.dist },
    polygon: polygon.map(v => vec3Copy(v)),
    textureProjection: cloneTextureProjection(face.textureProjection),
  };
}

/** Create a caulk-textured cap face from a polygon and its plane. */
function makeCaulkFace(polygon: Vec3[], plane: Plane): BrushFace {
  let p0 = polygon[0], p1 = polygon[1], p2 = polygon[2];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const c = polygon[(i + 2) % polygon.length];
    const cross = vec3Cross(vec3Sub(b, a), vec3Sub(c, a));
    if (vec3Length(cross) > 1e-6) {
      p0 = a; p1 = b; p2 = c;
      break;
    }
  }

  return {
    points: [vec3Copy(p0), vec3Copy(p1), vec3Copy(p2)],
    texture: 'common/caulk',
    textureProjection: {
      kind: 'classic',
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      scaleX: 0.5,
      scaleY: 0.5,
    },
    contentFlags: 0, surfaceFlags: 0, value: 0,
    plane: { normal: vec3Copy(plane.normal), dist: plane.dist },
    polygon: polygon.map(v => vec3Copy(v)),
  };
}

/** Order points on a plane by angle around centroid — produces CCW winding when viewed along normal. */
function orderPointsOnPlane(points: Vec3[], plane: Plane): Vec3[] {
  if (points.length < 3) return points;

  // Centroid
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const cz = points.reduce((s, p) => s + p[2], 0) / points.length;
  const centroid: Vec3 = [cx, cy, cz];

  // Two axes on the plane (same logic as createBasePolygon)
  const n = plane.normal;
  const abs = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  const up: Vec3 = (abs[2] >= abs[0] && abs[2] >= abs[1]) ? [0, 1, 0] : [0, 0, 1];
  const axisU = vec3Normalize(vec3Cross(up, n));
  const axisV = vec3Cross(n, axisU);

  // Sort by angle
  const sorted = points.slice().sort((a, b) => {
    const da = vec3Sub(a, centroid);
    const db = vec3Sub(b, centroid);
    return Math.atan2(vec3Dot(da, axisV), vec3Dot(da, axisU))
         - Math.atan2(vec3Dot(db, axisV), vec3Dot(db, axisU));
  });

  return sorted;
}

/** Assemble a brush from pre-clipped faces. No rebuild — polygons are authoritative. */
function assembleBrush(faces: BrushFace[]): Brush {
  let mins: Vec3 = [Infinity, Infinity, Infinity];
  let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const face of faces) {
    for (const v of face.polygon) {
      mins = vec3Min(mins, v);
      maxs = vec3Max(maxs, v);
    }
  }
  return { faces, mins, maxs };
}

// Resize a box brush by setting new AABB (reconstructs faces)
export function resizeBoxBrush(brush: Brush, newMins: Vec3, newMaxs: Vec3): void {
  const texture = brush.faces[0]?.texture ?? 'common/caulk';
  const [x0, y0, z0] = newMins;
  const [x1, y1, z1] = newMaxs;

  brush.faces[0] = createFace([x1,y0,z0], [x1,y1,z0], [x1,y0,z1], texture);
  brush.faces[1] = createFace([x0,y0,z0], [x0,y0,z1], [x0,y1,z0], texture);
  brush.faces[2] = createFace([x0,y1,z0], [x0,y1,z1], [x1,y1,z0], texture);
  brush.faces[3] = createFace([x0,y0,z0], [x1,y0,z0], [x0,y0,z1], texture);
  brush.faces[4] = createFace([x0,y0,z1], [x1,y0,z1], [x0,y1,z1], texture);
  brush.faces[5] = createFace([x0,y0,z0], [x0,y1,z0], [x1,y0,z0], texture);

  computeBrushGeometry(brush);
}
