import { Brush, BrushFace, clipBrush, cloneTextureProjection, computeBrushGeometry, validateBrush } from './brush';
import { Plane, Vec3, planePointDistance, vec3Copy, vec3Scale, vec3Sub } from './math';

const ON_EPSILON = 0.1;
const NORMAL_EPSILON = 1e-4;
const DIST_EPSILON = 0.02;
const CONVEX_EPSILON = 0.2;

/** Check if two brush AABBs overlap. */
function aabbOverlap(a: Brush, b: Brush): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.mins[i] >= b.maxs[i] - ON_EPSILON) return false;
    if (a.maxs[i] <= b.mins[i] + ON_EPSILON) return false;
  }
  return true;
}

function planeEqual(a: Plane, b: Plane, flip = false): boolean {
  const normal = flip
    ? [-b.normal[0], -b.normal[1], -b.normal[2]] as Vec3
    : b.normal;
  const dist = flip ? -b.dist : b.dist;

  return (
    Math.abs(a.normal[0] - normal[0]) < NORMAL_EPSILON &&
    Math.abs(a.normal[1] - normal[1]) < NORMAL_EPSILON &&
    Math.abs(a.normal[2] - normal[2]) < NORMAL_EPSILON &&
    Math.abs(a.dist - dist) < DIST_EPSILON
  );
}

function faceVertices(face: BrushFace): Vec3[] {
  return face.polygon.length >= 3 ? face.polygon : face.points;
}

function classifyBrushAgainstPlane(brush: Brush, plane: Plane): 'front' | 'back' | 'split' {
  let anyFront = false;
  let anyBack = false;

  for (const face of brush.faces) {
    for (const v of faceVertices(face)) {
      const dist = planePointDistance(plane, v);
      if (dist > ON_EPSILON) anyFront = true;
      else if (dist < -ON_EPSILON) anyBack = true;

      if (anyFront && anyBack) return 'split';
    }
  }

  return anyFront ? 'front' : 'back';
}

function brushInsideBrush(inner: Brush, outer: Brush): boolean {
  for (const outerFace of outer.faces) {
    for (const innerFace of inner.faces) {
      for (const v of faceVertices(innerFace)) {
        if (planePointDistance(outerFace.plane, v) > ON_EPSILON) return false;
      }
    }
  }
  return true;
}

function cloneFace(face: BrushFace): BrushFace {
  return {
    ...face,
    points: [vec3Copy(face.points[0]), vec3Copy(face.points[1]), vec3Copy(face.points[2])],
    plane: { normal: vec3Copy(face.plane.normal), dist: face.plane.dist },
    polygon: face.polygon.map(vec3Copy),
    textureProjection: cloneTextureProjection(face.textureProjection),
  };
}

function faceTouchesOtherBrush(face: BrushFace, brushIndex: number, brushes: Brush[]): boolean {
  for (let i = 0; i < brushes.length; i++) {
    if (i === brushIndex) continue;
    for (const otherFace of brushes[i].faces) {
      if (planeEqual(face.plane, otherFace.plane, true)) return true;
    }
  }
  return false;
}

function planesConcave(a: BrushFace, b: BrushFace): boolean {
  for (const v of faceVertices(a)) {
    if (planePointDistance(b.plane, v) > CONVEX_EPSILON) return true;
  }
  for (const v of faceVertices(b)) {
    if (planePointDistance(a.plane, v) > CONVEX_EPSILON) return true;
  }
  return false;
}

function mergeBrushListPairs(brushes: Brush[]): Brush[] {
  if (brushes.length < 2) return brushes;

  let list = brushes.slice();
  let merged = false;

  do {
    merged = false;
    const next: Brush[] = [];
    const used = new Array(list.length).fill(false);

    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;

      let mergedBrush: Brush | null = null;
      let mergedIndex = -1;
      for (let j = i + 1; j < list.length; j++) {
        if (used[j]) continue;
        const candidate = mergeBrushes([list[i], list[j]]);
        if (candidate) {
          mergedBrush = candidate;
          mergedIndex = j;
          break;
        }
      }

      if (mergedBrush && mergedIndex >= 0) {
        used[i] = true;
        used[mergedIndex] = true;
        next.push(mergedBrush);
        merged = true;
      } else {
        used[i] = true;
        next.push(list[i]);
      }
    }

    list = next;
  } while (merged);

  return list;
}

/**
 * Subtract carver brush from target brush using iterative plane splitting.
 * For each face of the carver, the target is split into a front piece (outside
 * the carver, kept as a fragment) and a back piece (potentially inside, split
 * further by subsequent faces). The final remaining piece is the intersection
 * and gets discarded.
 *
 * Returns fragments of target that lie outside the carver,
 * or null if there was no real intersection (target unchanged).
 */
export function subtractBrush(target: Brush, carver: Brush): Brush[] | null {
  if (!aabbOverlap(target, carver)) return null;
  if (brushInsideBrush(target, carver)) return [];

  let remaining = target;
  const fragments: Brush[] = [];
  let split = false;

  for (let fi = 0; fi < carver.faces.length; fi++) {
    const face = carver.faces[fi];
    const classification = classifyBrushAgainstPlane(remaining, face.plane);

    if (classification === 'front') {
      return null;
    }
    if (classification === 'back') {
      continue;
    }
    split = true;

    // Front piece (outside carver on this face) — flip winding to keep front
    const front = clipBrush(remaining, [
      vec3Copy(face.points[1]),
      vec3Copy(face.points[0]),
      vec3Copy(face.points[2]),
    ]);
    if (front) fragments.push(front);

    // Back piece (potentially inside carver) — continue splitting
    const back = clipBrush(remaining, [
      vec3Copy(face.points[0]),
      vec3Copy(face.points[1]),
      vec3Copy(face.points[2]),
    ]);
    if (!back) return null;
    remaining = back;
  }

  if (!split) return null;

  // remaining is the intersection — discard it
  return mergeBrushListPairs(fragments);
}

/**
 * Create a hollow shell from a brush by insetting each face inward.
 * Each face produces one shell piece: the original brush clipped by an
 * inward-offset copy of that face plane.
 */
export function hollowBrush(brush: Brush, thickness: number): Brush[] {
  const shells: Brush[] = [];

  for (const face of brush.faces) {
    if (face.polygon.length < 3) continue;

    // Offset face inward along its outward normal
    const offset = vec3Scale(face.plane.normal, thickness);

    // clipBrush keeps the back side, so flip the offset face to keep the
    // outer shell (between original surface and offset plane)
    const shell = clipBrush(brush, [
      vec3Sub(face.points[1], offset),
      vec3Sub(face.points[0], offset),
      vec3Sub(face.points[2], offset),
    ]);
    if (shell) shells.push(shell);
  }

  return shells;
}

/**
 * Merge multiple brushes into a single convex brush.
 * Follows Radiant's outer-face merge logic: shared touching faces are removed,
 * the remaining outer faces must form a convex hull, and the result is rebuilt
 * from those planes. Returns null if the brushes overlap or the hull is concave.
 */
export function mergeBrushes(brushes: Brush[]): Brush | null {
  if (brushes.length < 2) return null;
  const projectionKinds = new Set(brushes.flatMap(brush =>
    brush.faces.map(face => face.textureProjection.kind),
  ));
  if (projectionKinds.size > 1) return null;
  const propertySignatures = new Set(brushes.map(brush => JSON.stringify(brush.properties ?? {})));
  if (propertySignatures.size > 1) return null;

  // Radiant rejects overlapping brushes for CSG merge.
  for (let i = 0; i < brushes.length; i++) {
    for (let j = i + 1; j < brushes.length; j++) {
      if (aabbOverlap(brushes[i], brushes[j])) return null;
    }
  }

  const outerFaces: BrushFace[] = [];
  for (let brushIndex = 0; brushIndex < brushes.length; brushIndex++) {
    for (const face of brushes[brushIndex].faces) {
      if (faceTouchesOtherBrush(face, brushIndex, brushes)) continue;
      outerFaces.push(face);
    }
  }

  if (outerFaces.length < 4) return null;

  // Outer faces must form a convex hull; otherwise the merged result is concave.
  for (let i = 0; i < outerFaces.length; i++) {
    for (let j = i + 1; j < outerFaces.length; j++) {
      if (planeEqual(outerFaces[i].plane, outerFaces[j].plane, false)) continue;
      if (planeEqual(outerFaces[i].plane, outerFaces[j].plane, true)) continue;
      if (planesConcave(outerFaces[i], outerFaces[j])) return null;
    }
  }

  const mergedFaces: BrushFace[] = [];
  outer: for (const face of outerFaces) {
    for (const existing of mergedFaces) {
      if (planeEqual(face.plane, existing.plane, false)) continue outer;
      if (planeEqual(face.plane, existing.plane, true)) continue outer;
    }
    mergedFaces.push(cloneFace(face));
  }

  const newBrush: Brush = {
    faces: mergedFaces,
    properties: brushes[0].properties ? { ...brushes[0].properties } : undefined,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
  };
  computeBrushGeometry(newBrush);

  // Remove faces clipped to nothing.
  newBrush.faces = newBrush.faces.filter(f => f.polygon.length >= 3);
  if (newBrush.faces.length < 4) return null;

  // Must form a valid convex solid
  const validation = validateBrush(newBrush);
  if (!validation.valid) return null;

  return newBrush;
}
