import {
  Vec3, Plane, vec3, vec3Add, vec3Sub, vec3Scale, vec3Cross, vec3Dot,
  vec3Normalize, vec3Copy, vec3Lerp, vec3Min, vec3Max, vec3Snap,
  planeFromPoints, planePointDistance
} from './math';

export interface BrushFace {
  points: [Vec3, Vec3, Vec3];  // 3 points defining the plane (for .map format)
  texture: string;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  contentFlags: number;
  surfaceFlags: number;
  value: number;
  // Computed
  plane: Plane;
  polygon: Vec3[];
}

export interface Brush {
  faces: BrushFace[];
  // Computed AABB
  mins: Vec3;
  maxs: Vec3;
}

export function createFace(
  p1: Vec3, p2: Vec3, p3: Vec3,
  texture = 'common/caulk',
  offsetX = 0, offsetY = 0, rotation = 0,
  scaleX = 0.5, scaleY = 0.5
): BrushFace {
  return {
    points: [vec3Copy(p1), vec3Copy(p2), vec3Copy(p3)],
    texture, offsetX, offsetY, rotation, scaleX, scaleY,
    contentFlags: 0, surfaceFlags: 0, value: 0,
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

  for (let i = 0; i < brush.faces.length; i++) {
    const face = brush.faces[i];

    // Start with a large polygon on this face's plane
    let polygon = createBasePolygon(face.plane, 65536);

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
  }
  // Recompute polygons from the (now correctly translated) planes
  recomputePolygons(brush);
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
  }));
  return {
    faces,
    mins: vec3Copy(brush.mins),
    maxs: vec3Copy(brush.maxs),
  };
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

function textureAxisFromPlane(normal: Vec3): [Vec3, Vec3] {
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

  const ang = (face.rotation / 180) * Math.PI;
  const sinv = Math.sin(ang);
  const cosv = Math.cos(ang);

  // Rotated and scaled texture vectors
  const scaleX = face.scaleX || 0.5;
  const scaleY = face.scaleY || 0.5;

  const s: Vec3 = [0, 0, 0];
  const t: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    s[i] = (cosv * sv[i] - sinv * tv[i]) / scaleX;
    t[i] = (sinv * sv[i] + cosv * tv[i]) / scaleY;
  }

  const u = (vec3Dot(vertex, s) + face.offsetX) / texWidth;
  const v = (vec3Dot(vertex, t) + face.offsetY) / texHeight;

  return [u, v];
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
