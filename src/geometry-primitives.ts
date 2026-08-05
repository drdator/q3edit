import { type Vec3, vec3Add, vec3Cross, vec3Length, vec3Normalize, vec3Scale, vec3Sub } from './math';

function pushPoint(vertices: number[], point: Vec3): void {
  vertices.push(point[0], point[1], point[2]);
}

function perpendicularBasis(direction: Vec3): [Vec3, Vec3] {
  const reference: Vec3 = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const first = vec3Normalize(vec3Cross(direction, reference));
  return [first, vec3Normalize(vec3Cross(direction, first))];
}

function ringPoint(center: Vec3, first: Vec3, second: Vec3, radius: number, angle: number): Vec3 {
  return vec3Add(
    center,
    vec3Add(vec3Scale(first, Math.cos(angle) * radius), vec3Scale(second, Math.sin(angle) * radius)),
  );
}

/** Appends a capped tube made from triangles. */
export function appendTubeTriangles(
  vertices: number[],
  start: Vec3,
  end: Vec3,
  radius: number,
  sides = 8,
): void {
  const delta = vec3Sub(end, start);
  if (radius <= 0 || vec3Length(delta) < 1e-6 || sides < 3) return;
  const direction = vec3Normalize(delta);
  const [first, second] = perpendicularBasis(direction);

  for (let side = 0; side < sides; side++) {
    const angle = side * Math.PI * 2 / sides;
    const nextAngle = (side + 1) * Math.PI * 2 / sides;
    const startPoint = ringPoint(start, first, second, radius, angle);
    const startNext = ringPoint(start, first, second, radius, nextAngle);
    const endPoint = ringPoint(end, first, second, radius, angle);
    const endNext = ringPoint(end, first, second, radius, nextAngle);

    pushPoint(vertices, startPoint);
    pushPoint(vertices, endPoint);
    pushPoint(vertices, endNext);
    pushPoint(vertices, startPoint);
    pushPoint(vertices, endNext);
    pushPoint(vertices, startNext);

    pushPoint(vertices, start);
    pushPoint(vertices, startNext);
    pushPoint(vertices, startPoint);
    pushPoint(vertices, end);
    pushPoint(vertices, endPoint);
    pushPoint(vertices, endNext);
  }
}

/** Appends a capped cone whose point is at `tip`. */
export function appendConeTriangles(
  vertices: number[],
  base: Vec3,
  tip: Vec3,
  radius: number,
  sides = 10,
): void {
  const delta = vec3Sub(tip, base);
  if (radius <= 0 || vec3Length(delta) < 1e-6 || sides < 3) return;
  const direction = vec3Normalize(delta);
  const [first, second] = perpendicularBasis(direction);

  for (let side = 0; side < sides; side++) {
    const angle = side * Math.PI * 2 / sides;
    const nextAngle = (side + 1) * Math.PI * 2 / sides;
    const point = ringPoint(base, first, second, radius, angle);
    const next = ringPoint(base, first, second, radius, nextAngle);
    pushPoint(vertices, tip);
    pushPoint(vertices, point);
    pushPoint(vertices, next);
    pushPoint(vertices, base);
    pushPoint(vertices, next);
    pushPoint(vertices, point);
  }
}

/** Appends an axis-aligned solid box centered on `center`. */
export function appendBoxTriangles(vertices: number[], center: Vec3, halfSize: number): void {
  if (halfSize <= 0) return;
  const corners: Vec3[] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ].map(([x, y, z]) => [
    center[0] + x * halfSize,
    center[1] + y * halfSize,
    center[2] + z * halfSize,
  ] as Vec3);
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  for (const face of faces) {
    pushPoint(vertices, corners[face[0]]);
    pushPoint(vertices, corners[face[1]]);
    pushPoint(vertices, corners[face[2]]);
  }
}
