import type { Brush, BrushFace } from './brush';
import { mirrorBrush, rotateBrush, textureAxisFromPlane, translateBrush } from './brush';
import {
  type Vec3,
  vec3Add,
  vec3Copy,
  vec3Dot,
  vec3MirrorAxis,
  vec3RotateAxis,
} from './math';

type FaceTextureLockState = {
  point: Vec3;
  sValue: number;
  tValue: number;
  sVec: Vec3;
  tVec: Vec3;
};

function faceTextureVectors(face: BrushFace): { sVec: Vec3; tVec: Vec3 } {
  const [sv, tv] = textureAxisFromPlane(face.plane.normal);
  const angle = (face.rotation / 180) * Math.PI;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const scaleX = face.scaleX || 0.5;
  const scaleY = face.scaleY || 0.5;

  const sVec: Vec3 = [0, 0, 0];
  const tVec: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    sVec[i] = (cos * sv[i] - sin * tv[i]) / scaleX;
    tVec[i] = (sin * sv[i] + cos * tv[i]) / scaleY;
  }

  return { sVec, tVec };
}

function captureBrushTextureState(brush: Brush): FaceTextureLockState[] {
  return brush.faces.map(face => {
    const point = vec3Copy(face.points[0]);
    const { sVec, tVec } = faceTextureVectors(face);
    return {
      point,
      sValue: vec3Dot(point, sVec) + face.offsetX,
      tValue: vec3Dot(point, tVec) + face.offsetY,
      sVec,
      tVec,
    };
  });
}

function normalizeDegrees(angle: number): number {
  const normalized = ((angle % 360) + 360) % 360;
  return Math.abs(normalized) < 1e-6 ? 0 : normalized;
}

function restoreBrushTextureState(
  brush: Brush,
  state: FaceTextureLockState[],
  pointTransform: (point: Vec3) => Vec3,
  vectorTransform: (vector: Vec3) => Vec3,
): void {
  for (let i = 0; i < brush.faces.length; i++) {
    const face = brush.faces[i];
    const prev = state[i];
    if (!prev) continue;

    const point = pointTransform(prev.point);
    const sVec = vectorTransform(prev.sVec);
    const tVec = vectorTransform(prev.tVec);
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

    face.scaleX = scaleX;
    face.scaleY = scaleY;
    face.rotation = normalizeDegrees(Math.atan2(sin, cos) * 180 / Math.PI);
    face.offsetX = prev.sValue - vec3Dot(point, sVec);
    face.offsetY = prev.tValue - vec3Dot(point, tVec);
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
