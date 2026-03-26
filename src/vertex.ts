import { Vec3, vec3Add, vec3Copy, vec3Sub, vec3Dot, vec3DistSq,
         vec3Min, vec3Max, planeFromPoints } from './math';
import { Brush, BrushFace, updateFacePointsFromPolygon } from './brush';

export interface BrushVertex {
  position: Vec3;
  faceIndices: number[]; // indices into brush.faces that share this vertex
}

export interface BrushEdge {
  vertexIndices: [number, number];
  faceIndices: number[];
}

const VERTEX_EPSILON = 0.1;
const EPSILON_SQ = VERTEX_EPSILON * VERTEX_EPSILON;

/** Collect unique vertices from a brush's face polygons, tracking which faces share each vertex. */
export function collectBrushVertices(brush: Brush): BrushVertex[] {
  const vertices: BrushVertex[] = [];

  for (let fi = 0; fi < brush.faces.length; fi++) {
    const polygon = brush.faces[fi].polygon;
    for (const p of polygon) {
      let found = false;
      for (const v of vertices) {
        if (vec3DistSq(v.position, p) < EPSILON_SQ) {
          if (!v.faceIndices.includes(fi)) v.faceIndices.push(fi);
          found = true;
          break;
        }
      }
      if (!found) {
        vertices.push({ position: vec3Copy(p), faceIndices: [fi] });
      }
    }
  }

  return vertices;
}

function findVertexIndex(vertices: BrushVertex[], point: Vec3): number {
  for (let i = 0; i < vertices.length; i++) {
    if (vec3DistSq(vertices[i].position, point) < EPSILON_SQ) return i;
  }
  return -1;
}

/** Collect unique edges from brush face polygons as pairs of BrushVertex indices. */
export function collectBrushEdges(brush: Brush, vertices: BrushVertex[]): BrushEdge[] {
  const edges: BrushEdge[] = [];
  const seen = new Map<string, BrushEdge>();

  for (let fi = 0; fi < brush.faces.length; fi++) {
    const polygon = brush.faces[fi].polygon;
    for (let pi = 0; pi < polygon.length; pi++) {
      const a = findVertexIndex(vertices, polygon[pi]);
      const b = findVertexIndex(vertices, polygon[(pi + 1) % polygon.length]);
      if (a < 0 || b < 0 || a === b) continue;

      const keyA = Math.min(a, b);
      const keyB = Math.max(a, b);
      const key = `${keyA}:${keyB}`;
      const existing = seen.get(key);
      if (existing) {
        if (!existing.faceIndices.includes(fi)) existing.faceIndices.push(fi);
        continue;
      }

      const edge: BrushEdge = {
        vertexIndices: [a, b],
        faceIndices: [fi],
      };
      seen.set(key, edge);
      edges.push(edge);
    }
  }

  return edges;
}

/**
 * Move selected vertices by directly editing face polygons in-place.
 * Only the selected vertices move — all other vertices stay exactly where they are.
 * face.points and plane are updated for compatibility but polygons are NOT
 * recomputed from planes (that would shift adjacent vertices).
 * Call computeBrushGeometry when exiting vertex mode to reconcile.
 */
export function moveVertices(
  brush: Brush,
  vertices: BrushVertex[],
  selectedIndices: number[],
  delta: Vec3,
): void {
  if (selectedIndices.length === 0) return;

  // Compute new positions for moved vertices
  const newPositions: Vec3[] = selectedIndices.map(si =>
    vec3Add(vertices[si].position, delta)
  );

  // Directly update polygon vertices in-place — only the selected vertices change.
  for (const face of brush.faces) {
    for (let pi = 0; pi < face.polygon.length; pi++) {
      const p = face.polygon[pi];
      for (let mi = 0; mi < selectedIndices.length; mi++) {
        if (vec3DistSq(p, vertices[selectedIndices[mi]].position) < EPSILON_SQ) {
          face.polygon[pi] = vec3Copy(newPositions[mi]);
          break;
        }
      }
    }

    // Update face.points and plane from the modified polygon for map-file compatibility
    if (face.polygon.length >= 3) {
      updateFacePointsFromPolygon(face);
      face.plane = planeFromPoints(face.points[0], face.points[1], face.points[2]);
    }
  }

  // Recompute AABB
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

  // Update BrushVertex positions
  for (let i = 0; i < selectedIndices.length; i++) {
    vertices[selectedIndices[i]].position = vec3Copy(newPositions[i]);
  }
}


/** Pick the closest vertex within a 2D threshold. When vertices overlap, prefers higher depth (closer to camera). */
export function pickVertex2D(
  vertices: BrushVertex[],
  wx: number, wy: number,
  axisH: number, axisV: number, axisDepth: number,
  threshold: number
): number {
  let bestIdx = -1;
  let bestDist = threshold * threshold;
  let bestDepth = -Infinity;

  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i].position;
    const dx = p[axisH] - wx;
    const dy = p[axisV] - wy;
    const d = dx * dx + dy * dy;
    if (d > bestDist) continue;
    // Clearly closer in 2D → always wins; similar distance → higher depth wins
    if (d < bestDist - 0.01 || p[axisDepth] > bestDepth) {
      bestDist = d;
      bestDepth = p[axisDepth];
      bestIdx = i;
    }
  }
  return bestIdx;
}

function pointToSegmentDistSq2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/** Pick the closest projected brush edge within a 2D threshold. */
export function pickEdge2D(
  brush: Brush,
  vertices: BrushVertex[],
  wx: number,
  wy: number,
  axisH: number,
  axisV: number,
  axisDepth: number,
  threshold: number,
): { vertexIndices: [number, number]; distSq: number; depth: number } | null {
  const edges = collectBrushEdges(brush, vertices);
  let best: { vertexIndices: [number, number]; distSq: number; depth: number } | null = null;
  const thresholdSq = threshold * threshold;

  for (const edge of edges) {
    const a = vertices[edge.vertexIndices[0]]?.position;
    const b = vertices[edge.vertexIndices[1]]?.position;
    if (!a || !b) continue;
    const distSq = pointToSegmentDistSq2D(wx, wy, a[axisH], a[axisV], b[axisH], b[axisV]);
    if (distSq > thresholdSq) continue;

    const depth = Math.max(a[axisDepth], b[axisDepth]);
    if (!best || distSq < best.distSq - 0.01 || (Math.abs(distSq - best.distSq) < 0.01 && depth > best.depth)) {
      best = {
        vertexIndices: edge.vertexIndices,
        distSq,
        depth,
      };
    }
  }

  return best;
}

/** Pick the closest vertex to a 3D ray. Returns the nearest to the camera among candidates within threshold. */
export function pickVertex3D(
  vertices: BrushVertex[],
  rayOrigin: Vec3,
  rayDir: Vec3,
  threshold: number
): number {
  let bestIdx = -1;
  let bestT = Infinity; // prefer closest to camera

  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i].position;
    // Vector from ray origin to point
    const op = vec3Sub(p, rayOrigin);
    // Project onto ray
    const t = vec3Dot(op, rayDir);
    if (t < 0) continue; // behind camera
    // Closest point on ray
    const closest: Vec3 = [
      rayOrigin[0] + rayDir[0] * t,
      rayOrigin[1] + rayDir[1] * t,
      rayOrigin[2] + rayDir[2] * t,
    ];
    const dist = Math.sqrt(vec3DistSq(p, closest));
    // Scale threshold by distance for consistent screen-space picking
    const scaledThreshold = threshold * t * 0.01;
    if (dist < scaledThreshold && t < bestT) {
      bestT = t;
      bestIdx = i;
    }
  }
  return bestIdx;
}
