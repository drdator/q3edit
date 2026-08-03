import { Brush, BrushFace, clipBrush, cloneTextureProjection, computeBrushGeometry, validateBrush } from './brush';
import { Plane, Vec3, planePointDistance, vec3Copy, vec3Dot, vec3Scale, vec3Sub } from './math';

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
 * Subtract one or more carvers from a target brush.
 *
 * Returns the convex fragments making up the difference, an empty array when
 * the target is completely removed, or null when none of the carvers overlap.
 */
export function differenceBrushes(target: Brush, carvers: readonly Brush[]): Brush[] | null {
  let pieces: Brush[] = [target];
  let changed = false;

  for (const carver of carvers) {
    const next: Brush[] = [];
    for (const piece of pieces) {
      const fragments = subtractBrush(piece, carver);
      if (fragments === null) next.push(piece);
      else {
        changed = true;
        next.push(...fragments);
      }
    }
    pieces = next;
    if (pieces.length === 0) break;
  }

  return changed ? pieces : null;
}

/**
 * Create a hollow shell from a brush by insetting each face inward.
 * Each face produces one shell piece: the original brush clipped by an
 * inward-offset copy of that face plane.
 */
export function hollowBrush(brush: Brush, thickness: number): Brush[] {
  const shells: Brush[] = [];

  for (const face of brush.faces) {
    const shell = hollowShellForFace(brush, face, thickness);
    if (shell) shells.push(shell);
  }

  return shells;
}

function hollowShellForFace(brush: Brush, face: BrushFace, thickness: number): Brush | null {
  if (face.polygon.length < 3) return null;
  const offset = vec3Scale(face.plane.normal, thickness);
  return clipBrush(brush, [
    vec3Sub(face.points[1], offset),
    vec3Sub(face.points[0], offset),
    vec3Sub(face.points[2], offset),
  ]);
}

/**
 * Create an inward-facing room shell. Only the face visible from inside keeps
 * the source face material; exterior and edge faces are caulked.
 */
export function roomThicknessFits(brush: Brush, thickness: number): boolean {
  return Number.isFinite(thickness) && thickness > 0 &&
    brush.maxs.every((maximum, axis) =>
      maximum - brush.mins[axis] > thickness * 2 + ON_EPSILON);
}

export function roomBrushes(brush: Brush, thickness: number): Brush[] {
  if (!roomThicknessFits(brush, thickness)) return [];
  const shells: Brush[] = [];
  for (const source of brush.faces) {
    const shell = hollowShellForFace(brush, source, thickness);
    if (!shell) continue;
    const expectedDist = -source.plane.dist + thickness;
    for (const face of shell.faces) {
      face.texture = 'common/caulk';
      const opposite = vec3Dot(face.plane.normal, source.plane.normal) < -1 + NORMAL_EPSILON;
      if (!opposite || Math.abs(face.plane.dist - expectedDist) >= DIST_EPSILON) continue;
      face.texture = source.texture;
      face.textureProjection = cloneTextureProjection(source.textureProjection);
      face.contentFlags = source.contentFlags;
      face.surfaceFlags = source.surfaceFlags;
      face.value = source.value;
    }
    shells.push(shell);
  }
  return shells;
}

function dominantAxis(normal: Vec3): number {
  const absolute = normal.map(Math.abs);
  return absolute[0] > absolute[1]
    ? (absolute[0] > absolute[2] ? 0 : 2)
    : (absolute[1] > absolute[2] ? 1 : 2);
}

function pointInsideConvexFace(point: Vec3, face: BrushFace): boolean {
  const polygon = faceVertices(face);
  const drop = dominantAxis(face.plane.normal);
  const axes = [0, 1, 2].filter(axis => axis !== drop);
  let positive = false;
  let negative = false;
  for (let index = 0; index < polygon.length; index++) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    const cross = (to[axes[0]] - from[axes[0]]) * (point[axes[1]] - from[axes[1]]) -
      (to[axes[1]] - from[axes[1]]) * (point[axes[0]] - from[axes[0]]);
    if (cross > ON_EPSILON) positive = true;
    else if (cross < -ON_EPSILON) negative = true;
    if (positive && negative) return false;
  }
  return true;
}

/** True only when an opposing coplanar face completely covers the target face. */
export function faceFullyCoveredByOpposingFace(target: BrushFace, opposing: BrushFace): boolean {
  if (!planeEqual(target.plane, opposing.plane, true)) return false;
  return faceVertices(target).every(point => pointInsideConvexFace(point, opposing));
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
    name: brushes.every(brush => brush.name === brushes[0].name) ? brushes[0].name : undefined,
    editorGroupId: brushes.every(brush => brush.editorGroupId === brushes[0].editorGroupId)
      ? brushes[0].editorGroupId
      : undefined,
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

/**
 * Build the common convex volume shared by all input brushes.
 *
 * A convex brush is the intersection of the back half-spaces defined by its
 * face planes, so intersecting brushes only requires combining and
 * deduplicating those planes. Materials are inherited from the first brush by
 * matching each result plane to its closest outward-facing source face.
 */
export function intersectBrushes(brushes: Brush[]): Brush | null {
  if (brushes.length < 2) return null;
  for (let index = 1; index < brushes.length; index++) {
    if (!aabbOverlap(brushes[0], brushes[index])) return null;
  }

  const firstBrush = brushes[0];
  const faces: BrushFace[] = [];
  for (const brush of brushes) {
    for (const face of brush.faces) {
      if (faces.some(existing => planeEqual(existing.plane, face.plane))) continue;

      const material = firstBrush.faces.reduce((closest, candidate) =>
        vec3Dot(candidate.plane.normal, face.plane.normal)
          > vec3Dot(closest.plane.normal, face.plane.normal)
          ? candidate
          : closest);
      const resultFace = cloneFace(face);
      resultFace.editorObjectId = undefined;
      resultFace.texture = material.texture;
      resultFace.textureProjection = cloneTextureProjection(material.textureProjection);
      resultFace.contentFlags = material.contentFlags;
      resultFace.surfaceFlags = material.surfaceFlags;
      resultFace.value = material.value;
      faces.push(resultFace);
    }
  }

  const intersection: Brush = {
    faces,
    name: brushes.every(brush => brush.name === firstBrush.name) ? firstBrush.name : undefined,
    editorGroupId: brushes.every(brush => brush.editorGroupId === firstBrush.editorGroupId)
      ? firstBrush.editorGroupId
      : undefined,
    properties: firstBrush.properties ? { ...firstBrush.properties } : undefined,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
  };
  computeBrushGeometry(intersection);
  intersection.faces = intersection.faces.filter(face => face.polygon.length >= 3);
  if (intersection.faces.length < 4) return null;
  if (intersection.maxs.some((value, axis) => value - intersection.mins[axis] <= ON_EPSILON)) return null;
  if (!validateBrush(intersection).valid) return null;
  return intersection;
}
