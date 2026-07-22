import type { Brush, BrushFace, BrushTextureProjection } from './brush';
import {
  classicTextureProjection,
  cloneTextureProjection,
  computeFaceUV,
  mirrorBrush,
  rotateBrush,
  scaleBrushFaces,
  textureAxisFromPlane,
  translateBrush,
} from './brush';
import {
  type Vec3,
  vec3Add,
  vec3Copy,
  vec3Cross,
  vec3Dot,
  vec3MirrorAxis,
  vec3Length,
  vec3RotateAxis,
  vec3Scale,
} from './math';

export type BrushPrimitiveVertexTextureState = Array<{
  face: BrushFace;
  uv: [[number, number], [number, number], [number, number]];
}>;

type FaceTextureLockState = {
  kind: 'classic';
  normal: Vec3;
  point: Vec3;
  sValue: number;
  tValue: number;
  sVec: Vec3;
  tVec: Vec3;
} | {
  kind: 'brush-primitive';
  normal: Vec3;
  point: Vec3;
  uValue: number;
  vValue: number;
  uVec: Vec3;
  vVec: Vec3;
};

function classicTextureVectors(
  projection: Extract<BrushTextureProjection, { kind: 'classic' }>,
  normal: Vec3,
): { sVec: Vec3; tVec: Vec3 } {
  const [sv, tv] = textureAxisFromPlane(normal);
  const angle = (projection.rotation / 180) * Math.PI;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const scaleX = projection.scaleX || 0.5;
  const scaleY = projection.scaleY || 0.5;

  const sVec: Vec3 = [0, 0, 0];
  const tVec: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    sVec[i] = (cos * sv[i] - sin * tv[i]) / scaleX;
    tVec[i] = (sin * sv[i] + cos * tv[i]) / scaleY;
  }

  return { sVec, tVec };
}

function captureBrushTextureState(
  brush: Brush,
  sourcePoints?: [Vec3, Vec3, Vec3][],
  sourceProjections?: BrushTextureProjection[],
): FaceTextureLockState[] {
  return brush.faces.map((face, index) => {
    const points = sourcePoints?.[index] ?? face.points;
    const projection = sourceProjections?.[index] ?? face.textureProjection;
    const normal = sourcePoints
      ? planeNormalFromPoints(points)
      : face.plane.normal;
    if (projection.kind === 'brush-primitive') {
      const point = vec3Copy(points[0]);
      const [sAxis, tAxis] = textureAxisFromPlane(normal);
      const [uRow, vRow] = projection.matrix;
      const uVec = vec3Add(vec3Scale(sAxis, uRow[0]), vec3Scale(tAxis, uRow[1]));
      const vVec = vec3Add(vec3Scale(sAxis, vRow[0]), vec3Scale(tAxis, vRow[1]));
      return {
        kind: 'brush-primitive',
        normal: vec3Copy(normal),
        point,
        uValue: vec3Dot(point, uVec) + uRow[2],
        vValue: vec3Dot(point, vVec) + vRow[2],
        uVec,
        vVec,
      };
    }
    const point = vec3Copy(points[0]);
    const { sVec, tVec } = classicTextureVectors(projection, normal);
    return {
      kind: 'classic',
      normal: vec3Copy(normal),
      point,
      sValue: vec3Dot(point, sVec) + projection.offsetX,
      tValue: vec3Dot(point, tVec) + projection.offsetY,
      sVec,
      tVec,
    };
  });
}

function planeNormalFromPoints(points: [Vec3, Vec3, Vec3]): Vec3 {
  const a: Vec3 = [
    points[1][0] - points[0][0],
    points[1][1] - points[0][1],
    points[1][2] - points[0][2],
  ];
  const b: Vec3 = [
    points[2][0] - points[0][0],
    points[2][1] - points[0][1],
    points[2][2] - points[0][2],
  ];
  const normal: Vec3 = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const length = vec3Length(normal);
  return length < 1e-8 ? [0, 0, 0] : vec3Scale(normal, 1 / length);
}

function rotateVectorBetweenNormals(vector: Vec3, from: Vec3, to: Vec3): Vec3 {
  const cosine = Math.max(-1, Math.min(1, vec3Dot(from, to)));
  if (cosine > 1 - 1e-8) return vec3Copy(vector);

  let axis = vec3Cross(from, to);
  let sine = vec3Length(axis);
  if (sine < 1e-8) {
    const fallback: Vec3 = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    axis = vec3Cross(from, fallback);
    axis = vec3Scale(axis, 1 / vec3Length(axis));
    sine = 0;
  } else {
    axis = vec3Scale(axis, 1 / sine);
  }
  const cross = vec3Cross(axis, vector);
  const alongAxis = vec3Dot(axis, vector) * (1 - cosine);
  return [
    vector[0] * cosine + cross[0] * sine + axis[0] * alongAxis,
    vector[1] * cosine + cross[1] * sine + axis[1] * alongAxis,
    vector[2] * cosine + cross[2] * sine + axis[2] * alongAxis,
  ];
}

function normalizeDegrees(angle: number): number {
  const normalized = ((angle % 360) + 360) % 360;
  return Math.abs(normalized) < 1e-6 ? 0 : normalized;
}

function restoreBrushTextureState(
  brush: Brush,
  state: FaceTextureLockState[],
  pointTransform: (point: Vec3) => Vec3,
  vectorTransform: (vector: Vec3, previous: FaceTextureLockState, face: BrushFace) => Vec3,
): void {
  for (let i = 0; i < brush.faces.length; i++) {
    const face = brush.faces[i];
    const prev = state[i];
    if (!prev) continue;
    if (prev.kind === 'brush-primitive') {
      const point = pointTransform(prev.point);
      const uVec = vectorTransform(prev.uVec, prev, face);
      const vVec = vectorTransform(prev.vVec, prev, face);
      const [sAxis, tAxis] = textureAxisFromPlane(face.plane.normal);
      face.textureProjection = {
        kind: 'brush-primitive',
        matrix: [
          [vec3Dot(uVec, sAxis), vec3Dot(uVec, tAxis), prev.uValue - vec3Dot(point, uVec)],
          [vec3Dot(vVec, sAxis), vec3Dot(vVec, tAxis), prev.vValue - vec3Dot(point, vVec)],
        ],
      };
      continue;
    }
    const projection = classicTextureProjection(face);
    if (!projection) continue;

    const point = pointTransform(prev.point);
    const sVec = vectorTransform(prev.sVec, prev, face);
    const tVec = vectorTransform(prev.tVec, prev, face);
    const [sv, tv] = textureAxisFromPlane(face.plane.normal);

    const ss = vec3Dot(sVec, sv);
    const st = vec3Dot(sVec, tv);
    const ts = vec3Dot(tVec, sv);
    const tt = vec3Dot(tVec, tv);

    const scaleX = 1 / Math.max(1e-6, Math.hypot(ss, st));
    // A cardinal plane-axis change can reflect one texture axis. Classic Q3
    // projection represents that with a negative scale; forcing both scales
    // positive changes the mapping when a face rotates between base axes.
    const determinant = ss * tt - st * ts;
    const scaleY = (determinant < 0 ? -1 : 1) /
      Math.max(1e-6, Math.hypot(ts, tt));
    const cos = ((ss * scaleX) + (tt * scaleY)) * 0.5;
    const sin = ((-st * scaleX) + (ts * scaleY)) * 0.5;

    projection.scaleX = scaleX;
    projection.scaleY = scaleY;
    projection.rotation = normalizeDegrees(Math.atan2(sin, cos) * 180 / Math.PI);
    projection.offsetX = prev.sValue - vec3Dot(point, sVec);
    projection.offsetY = prev.tValue - vec3Dot(point, tVec);
  }
}

export function translateBrushLocked(brush: Brush, delta: Vec3): void {
  const state = captureBrushTextureState(brush);
  translateBrush(brush, delta);
  restoreBrushTextureState(
    brush,
    state,
    point => vec3Add(point, delta),
    vector => vec3Copy(vector),
  );
}

export function rotateBrushLocked(brush: Brush, center: Vec3, axis: number, angle: number): void {
  const state = captureBrushTextureState(brush);
  rotateBrush(brush, center, axis, angle);
  restoreBrushTextureState(
    brush,
    state,
    point => vec3RotateAxis(point, center, axis, angle),
    vector => vec3RotateAxis(vector, [0, 0, 0], axis, angle),
  );
}

export function mirrorBrushLocked(brush: Brush, center: Vec3, axis: number): void {
  const state = captureBrushTextureState(brush);
  mirrorBrush(brush, center, axis);
  restoreBrushTextureState(
    brush,
    state,
    point => vec3MirrorAxis(point, center, axis),
    vector => vec3MirrorAxis(vector, [0, 0, 0], axis),
  );
}

export function scaleBrushLocked(
  brush: Brush,
  originalPoints: [Vec3, Vec3, Vec3][],
  center: Vec3,
  scale: Vec3,
  originalTextureProjections?: BrushTextureProjection[],
): void {
  const projections = originalTextureProjections?.map(cloneTextureProjection);
  const state = captureBrushTextureState(brush, originalPoints, projections);
  scaleBrushFaces(brush, originalPoints, center, scale);
  restoreBrushTextureState(
    brush,
    state,
    point => [
      center[0] + (point[0] - center[0]) * scale[0],
      center[1] + (point[1] - center[1]) * scale[1],
      center[2] + (point[2] - center[2]) * scale[2],
    ],
    (vector, previous, face) => rotateVectorBetweenNormals(vector, previous.normal, face.plane.normal),
  );
}

export function captureBrushPrimitiveVertexTextureState(brush: Brush): BrushPrimitiveVertexTextureState {
  return brush.faces
    .filter(face => face.textureProjection.kind === 'brush-primitive')
    .map(face => ({
      face,
      uv: face.points.map(point => computeFaceUV(point, face, 1, 1)) as
        [[number, number], [number, number], [number, number]],
    }));
}

export function restoreBrushPrimitiveVertexTextureState(state: BrushPrimitiveVertexTextureState): void {
  for (const { face, uv } of state) {
    if (face.textureProjection.kind !== 'brush-primitive') continue;
    const [sAxis, tAxis] = textureAxisFromPlane(face.plane.normal);
    const coordinates = face.points.map(point => [
      vec3Dot(point, sAxis),
      vec3Dot(point, tAxis),
    ] as [number, number]) as [[number, number], [number, number], [number, number]];
    const uRow = solveAffineProjection(coordinates, [uv[0][0], uv[1][0], uv[2][0]]);
    const vRow = solveAffineProjection(coordinates, [uv[0][1], uv[1][1], uv[2][1]]);
    if (uRow && vRow) face.textureProjection.matrix = [uRow, vRow];
  }
}

function solveAffineProjection(
  points: [[number, number], [number, number], [number, number]],
  values: [number, number, number],
): [number, number, number] | null {
  const [[x1, y1], [x2, y2], [x3, y3]] = points;
  const [v1, v2, v3] = values;
  const determinant = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
  if (Math.abs(determinant) < 1e-9) return null;
  return [
    (v1 * (y2 - y3) + v2 * (y3 - y1) + v3 * (y1 - y2)) / determinant,
    (v1 * (x3 - x2) + v2 * (x1 - x3) + v3 * (x2 - x1)) / determinant,
    (v1 * (x2 * y3 - x3 * y2) + v2 * (x3 * y1 - x1 * y3) + v3 * (x1 * y2 - x2 * y1)) / determinant,
  ];
}
