// ── Vec3 ──

export type Vec3 = [number, number, number];

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const vec3Add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
export const vec3Sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
export const vec3Scale = (v: Vec3, s: number): Vec3 => [v[0]*s, v[1]*s, v[2]*s];
export const vec3Dot = (a: Vec3, b: Vec3): number => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
export const vec3Cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1]*b[2] - a[2]*b[1],
  a[2]*b[0] - a[0]*b[2],
  a[0]*b[1] - a[1]*b[0]
];
export const vec3Length = (v: Vec3): number => Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
export const vec3Normalize = (v: Vec3): Vec3 => {
  const len = vec3Length(v);
  return len < 1e-8 ? [0,0,0] : [v[0]/len, v[1]/len, v[2]/len];
};
export const vec3Negate = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
export const vec3Copy = (v: Vec3): Vec3 => [v[0], v[1], v[2]];
export const vec3Lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t
];
export const vec3Snap = (v: Vec3, grid: number): Vec3 => [
  Math.round(v[0]/grid)*grid, Math.round(v[1]/grid)*grid, Math.round(v[2]/grid)*grid
];
export const vec3Min = (a: Vec3, b: Vec3): Vec3 => [
  Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.min(a[2],b[2])
];
export const vec3Max = (a: Vec3, b: Vec3): Vec3 => [
  Math.max(a[0],b[0]), Math.max(a[1],b[1]), Math.max(a[2],b[2])
];
export const vec3AddMut = (out: Vec3, b: Vec3): Vec3 => {
  out[0] += b[0]; out[1] += b[1]; out[2] += b[2]; return out;
};

// Rotate point around center on a cardinal axis (0=X, 1=Y, 2=Z)
export function vec3RotateAxis(p: Vec3, center: Vec3, axis: number, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out: Vec3 = [p[0], p[1], p[2]];
  // Axes perpendicular to the rotation axis
  const a1 = (axis + 1) % 3;
  const a2 = (axis + 2) % 3;
  const d1 = p[a1] - center[a1];
  const d2 = p[a2] - center[a2];
  out[a1] = center[a1] + d1 * c - d2 * s;
  out[a2] = center[a2] + d1 * s + d2 * c;
  return out;
}

// ── Plane ──

export interface Plane {
  normal: Vec3;
  dist: number;
}

export function planeFromPoints(p1: Vec3, p2: Vec3, p3: Vec3): Plane {
  const v1 = vec3Sub(p2, p1);
  const v2 = vec3Sub(p3, p1);
  const normal = vec3Normalize(vec3Cross(v1, v2));
  const dist = vec3Dot(normal, p1);
  return { normal, dist };
}

export function planePointDistance(plane: Plane, point: Vec3): number {
  return vec3Dot(plane.normal, point) - plane.dist;
}

// ── Mat4 (column-major for WebGL) ──

export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
  const m = new Float32Array(16);
  const f = 1.0 / Math.tan(fov * 0.5);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const f = vec3Normalize(vec3Sub(center, eye));
  const s = vec3Normalize(vec3Cross(f, up));
  const u = vec3Cross(s, f);
  const m = new Float32Array(16);
  m[0] = s[0]; m[4] = s[1]; m[8]  = s[2];
  m[1] = u[0]; m[5] = u[1]; m[9]  = u[2];
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
  m[12] = -vec3Dot(s, eye);
  m[13] = -vec3Dot(u, eye);
  m[14] = vec3Dot(f, eye);
  m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const m = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      m[j*4+i] = a[0*4+i]*b[j*4+0] + a[1*4+i]*b[j*4+1] + a[2*4+i]*b[j*4+2] + a[3*4+i]*b[j*4+3];
    }
  }
  return m;
}

export function mat4Ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  const m = new Float32Array(16);
  m[0]  = 2 / (r - l);
  m[5]  = 2 / (t - b);
  m[10] = -2 / (f - n);
  m[12] = -(r + l) / (r - l);
  m[13] = -(t + b) / (t - b);
  m[14] = -(f + n) / (f - n);
  m[15] = 1;
  return m;
}

// ── Ray-triangle intersection (Möller–Trumbore) ──

export function rayTriangleIntersect(
  origin: Vec3, dir: Vec3, v0: Vec3, v1: Vec3, v2: Vec3
): number | null {
  const edge1 = vec3Sub(v1, v0);
  const edge2 = vec3Sub(v2, v0);
  const h = vec3Cross(dir, edge2);
  const a = vec3Dot(edge1, h);
  if (Math.abs(a) < 1e-8) return null;
  const f = 1.0 / a;
  const s = vec3Sub(origin, v0);
  const u = f * vec3Dot(s, h);
  if (u < 0 || u > 1) return null;
  const q = vec3Cross(s, edge1);
  const v = f * vec3Dot(dir, q);
  if (v < 0 || u + v > 1) return null;
  const t = f * vec3Dot(edge2, q);
  return t > 1e-6 ? t : null;
}
