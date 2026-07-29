import {
  mat4Ortho,
  mat4Perspective,
  vec3Cross,
  vec3Normalize,
  type Mat4,
  type Vec3,
} from './math';

export type Viewport3DProjection = 'perspective' | 'orthographic';
export type IsometricDirection = 'northeast' | 'northwest' | 'southeast' | 'southwest';

export const DEFAULT_ORTHOGRAPHIC_SCALE = 512;
export const MIN_ORTHOGRAPHIC_SCALE = 8;
export const MAX_ORTHOGRAPHIC_SCALE = 16384;
export const ISOMETRIC_PITCH = -Math.asin(1 / Math.sqrt(3));

const ISOMETRIC_YAWS: Record<IsometricDirection, number> = {
  northeast: Math.PI * 1.25,
  northwest: Math.PI * 1.75,
  southeast: Math.PI * 0.75,
  southwest: Math.PI * 0.25,
};

export function isometricCameraAngles(direction: IsometricDirection): { yaw: number; pitch: number } {
  return { yaw: ISOMETRIC_YAWS[direction], pitch: ISOMETRIC_PITCH };
}

export function clampOrthographicScale(scale: number): number {
  return Math.max(MIN_ORTHOGRAPHIC_SCALE, Math.min(MAX_ORTHOGRAPHIC_SCALE, scale));
}

export function orthographicScaleForPerspectiveDistance(distance: number, fov: number): number {
  return clampOrthographicScale(Math.max(1, distance) * Math.tan(fov / 2));
}

export function perspectiveDistanceForOrthographicScale(scale: number, fov: number): number {
  return clampOrthographicScale(scale) / Math.max(1e-5, Math.tan(fov / 2));
}

export function viewport3DCameraBasis(
  yaw: number,
  pitch: number,
): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward: Vec3 = [
    Math.cos(yaw) * Math.cos(pitch),
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
  ];
  const right = vec3Normalize(vec3Cross(forward, [0, 0, 1]));
  const up = vec3Cross(right, forward);
  return { forward, right, up };
}

export function viewport3DProjectionMatrix(
  projection: Viewport3DProjection,
  aspect: number,
  fov: number,
  orthographicScale: number,
): Mat4 {
  if (projection === 'perspective') return mat4Perspective(fov, aspect, 1, 16384);
  const halfHeight = clampOrthographicScale(orthographicScale);
  const halfWidth = halfHeight * Math.max(1e-5, aspect);
  return mat4Ortho(-halfWidth, halfWidth, -halfHeight, halfHeight, -32768, 32768);
}
