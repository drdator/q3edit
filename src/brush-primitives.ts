import { type Brush, createBoxBrush, createFace, computeBrushGeometry } from './brush';
import { planeFromPoints, vec3Add, vec3Copy, vec3Dot, vec3Scale, vec3Sub, type Vec3 } from './math';

export type BrushPrimitive = 'box' | 'cylinder' | 'cone' | 'sphere' | 'pyramid';

export const BRUSH_PRIMITIVES: { value: BrushPrimitive; label: string; usesSides: boolean }[] = [
  { value: 'box', label: 'Box', usesSides: false },
  { value: 'cylinder', label: 'Cylinder', usesSides: true },
  { value: 'cone', label: 'Cone', usesSides: true },
  { value: 'sphere', label: 'Sphere', usesSides: true },
  { value: 'pyramid', label: 'Pyramid', usesSides: false },
];

const BRUSH_PRIMITIVE_ICON_NAMES: Record<BrushPrimitive, string> = {
  box: 'cube',
  cylinder: 'cylinder',
  cone: 'triangle',
  sphere: 'sphere',
  pyramid: 'triangle',
};

export function brushPrimitiveSideRange(primitive: BrushPrimitive): { min: number; max: number } | null {
  if (!brushPrimitiveUsesSides(primitive)) return null;
  return primitive === 'sphere' ? { min: 4, max: 32 } : { min: 3, max: 64 };
}

export function validateBrushPrimitiveParameters(
  primitive: BrushPrimitive,
  mins: Vec3,
  maxs: Vec3,
  axis: number,
  sides: number,
): void {
  if (![...mins, ...maxs].every(Number.isFinite)) throw new Error('Primitive bounds must be finite');
  if (![0, 1, 2].includes(axis) || !Number.isInteger(axis)) throw new Error('Primitive axis must be X, Y, or Z');
  for (let dimension = 0; dimension < 3; dimension++) {
    if (maxs[dimension] - mins[dimension] <= 0.001) throw new Error('Primitive dimensions must be greater than zero');
  }
  const range = brushPrimitiveSideRange(primitive);
  if (range && (!Number.isInteger(sides) || sides < range.min || sides > range.max)) {
    throw new Error(`${primitive} sides must be an integer from ${range.min} to ${range.max}`);
  }
}

function creationAxes(axis: number): [number, number] {
  if (axis === 0) return [1, 2];
  if (axis === 1) return [0, 2];
  return [0, 1];
}

function faceCenter(points: Vec3[]): Vec3 {
  const sum = points.reduce<Vec3>((acc, point) => vec3Add(acc, point), [0, 0, 0]);
  return vec3Scale(sum, 1 / points.length);
}

function createBrushFromPolygons(polygons: Vec3[][], texture: string): Brush {
  const allPoints = polygons.flat();
  const solidCenter = vec3Scale(
    allPoints.reduce<Vec3>((acc, point) => vec3Add(acc, point), [0, 0, 0]),
    1 / allPoints.length,
  );

  const faces = polygons.map(points => {
    const oriented = points.map(vec3Copy);
    const plane = planeFromPoints(oriented[0], oriented[1], oriented[2]);
    const outward = vec3Sub(faceCenter(oriented), solidCenter);
    if (vec3Dot(plane.normal, outward) < 0) {
      oriented.reverse();
    }
    return createFace(oriented[0], oriented[1], oriented[2], texture);
  });

  const brush: Brush = {
    faces,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
  };
  computeBrushGeometry(brush);
  return brush;
}

export type WedgeDirection = 'x+' | 'x-' | 'y+' | 'y-';

/** Create a right triangular ramp whose high end faces direction. */
export function createWedgeBrush(mins: Vec3, maxs: Vec3, texture: string, direction: WedgeDirection): Brush {
  validateBrushPrimitiveParameters('box', mins, maxs, 2, 4);
  const travelAxis = direction[0] === 'x' ? 0 : 1;
  const sideAxis = travelAxis === 0 ? 1 : 0;
  const highTravel = direction.endsWith('+') ? maxs[travelAxis] : mins[travelAxis];
  const lowTravel = direction.endsWith('+') ? mins[travelAxis] : maxs[travelAxis];
  const point = (travel: number, side: number, height: number): Vec3 => {
    const value: Vec3 = [0, 0, height];
    value[travelAxis] = travel;
    value[sideAxis] = side;
    return value;
  };
  const lowSide = mins[sideAxis];
  const highSide = maxs[sideAxis];
  const low0 = point(lowTravel, lowSide, mins[2]);
  const low1 = point(lowTravel, highSide, mins[2]);
  const high0 = point(highTravel, lowSide, mins[2]);
  const high1 = point(highTravel, highSide, mins[2]);
  const top0 = point(highTravel, lowSide, maxs[2]);
  const top1 = point(highTravel, highSide, maxs[2]);
  return createBrushFromPolygons([
    [low0, low1, high1, high0],
    [high0, high1, top1, top0],
    [low0, high0, top0],
    [low1, top1, high1],
    [low0, top0, top1, low1],
  ], texture);
}

function makeAxisPoint(axis: number, axisValue: number, uAxis: number, uValue: number, vAxis: number, vValue: number): Vec3 {
  const point: Vec3 = [0, 0, 0];
  point[axis] = axisValue;
  point[uAxis] = uValue;
  point[vAxis] = vValue;
  return point;
}

function createCylinderBrush(mins: Vec3, maxs: Vec3, texture: string, axis: number, sides: number): Brush {
  const [uAxis, vAxis] = creationAxes(axis);
  const center: Vec3 = vec3Scale(vec3Add(mins, maxs), 0.5);
  const radiusU = (maxs[uAxis] - mins[uAxis]) * 0.5;
  const radiusV = (maxs[vAxis] - mins[vAxis]) * 0.5;
  const bottom = mins[axis];
  const top = maxs[axis];
  const ringBottom: Vec3[] = [];
  const ringTop: Vec3[] = [];

  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    const u = center[uAxis] + Math.cos(angle) * radiusU;
    const v = center[vAxis] + Math.sin(angle) * radiusV;
    ringBottom.push(makeAxisPoint(axis, bottom, uAxis, u, vAxis, v));
    ringTop.push(makeAxisPoint(axis, top, uAxis, u, vAxis, v));
  }

  const polygons: Vec3[][] = [ringTop, [...ringBottom].reverse()];
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    polygons.push([ringBottom[i], ringBottom[next], ringTop[next], ringTop[i]]);
  }

  return createBrushFromPolygons(polygons, texture);
}

function createConeBrush(mins: Vec3, maxs: Vec3, texture: string, axis: number, sides: number): Brush {
  const [uAxis, vAxis] = creationAxes(axis);
  const center: Vec3 = vec3Scale(vec3Add(mins, maxs), 0.5);
  const radiusU = (maxs[uAxis] - mins[uAxis]) * 0.5;
  const radiusV = (maxs[vAxis] - mins[vAxis]) * 0.5;
  const bottom = mins[axis];
  const apex = makeAxisPoint(axis, maxs[axis], uAxis, center[uAxis], vAxis, center[vAxis]);
  const base: Vec3[] = [];

  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    const u = center[uAxis] + Math.cos(angle) * radiusU;
    const v = center[vAxis] + Math.sin(angle) * radiusV;
    base.push(makeAxisPoint(axis, bottom, uAxis, u, vAxis, v));
  }

  const polygons: Vec3[][] = [[...base].reverse()];
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    polygons.push([base[i], base[next], apex]);
  }

  return createBrushFromPolygons(polygons, texture);
}

function createPyramidBrush(mins: Vec3, maxs: Vec3, texture: string, axis: number): Brush {
  const [uAxis, vAxis] = creationAxes(axis);
  const apex = makeAxisPoint(
    axis,
    maxs[axis],
    uAxis,
    (mins[uAxis] + maxs[uAxis]) * 0.5,
    vAxis,
    (mins[vAxis] + maxs[vAxis]) * 0.5,
  );
  const base = [
    makeAxisPoint(axis, mins[axis], uAxis, mins[uAxis], vAxis, mins[vAxis]),
    makeAxisPoint(axis, mins[axis], uAxis, maxs[uAxis], vAxis, mins[vAxis]),
    makeAxisPoint(axis, mins[axis], uAxis, maxs[uAxis], vAxis, maxs[vAxis]),
    makeAxisPoint(axis, mins[axis], uAxis, mins[uAxis], vAxis, maxs[vAxis]),
  ];

  return createBrushFromPolygons([
    [...base].reverse(),
    [base[0], base[1], apex],
    [base[1], base[2], apex],
    [base[2], base[3], apex],
    [base[3], base[0], apex],
  ], texture);
}

function spherePoint(center: Vec3, radius: Vec3, theta: number, phi: number): Vec3 {
  const cosPhi = Math.cos(phi);
  return [
    center[0] + Math.cos(theta) * cosPhi * radius[0],
    center[1] + Math.sin(theta) * cosPhi * radius[1],
    center[2] + Math.sin(phi) * radius[2],
  ];
}

function createSphereBrush(mins: Vec3, maxs: Vec3, texture: string, sides: number): Brush {
  const center = vec3Scale(vec3Add(mins, maxs), 0.5);
  const radius: Vec3 = [
    (maxs[0] - mins[0]) * 0.5,
    (maxs[1] - mins[1]) * 0.5,
    (maxs[2] - mins[2]) * 0.5,
  ];
  const polygons: Vec3[][] = [];
  const dt = (Math.PI * 2) / sides;
  const dp = Math.PI / sides;

  for (let i = 0; i < sides; i++) {
    const theta = i * dt;
    for (let j = 0; j <= sides - 2; j++) {
      const phi = j * dp - Math.PI / 2;
      polygons.push([
        spherePoint(center, radius, theta, phi),
        spherePoint(center, radius, theta, phi + dp),
        spherePoint(center, radius, theta + dt, phi + dp),
      ]);
    }
  }

  const topPhi = (sides - 1) * dp - Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const theta = i * dt;
    polygons.push([
      spherePoint(center, radius, theta, topPhi),
      spherePoint(center, radius, theta + dt, topPhi + dp),
      spherePoint(center, radius, theta + dt, topPhi),
    ]);
  }

  return createBrushFromPolygons(polygons, texture);
}

export function brushPrimitiveUsesSides(primitive: BrushPrimitive): boolean {
  return BRUSH_PRIMITIVES.some(option => option.value === primitive && option.usesSides);
}

export function brushPrimitiveIconName(primitive: BrushPrimitive): string {
  return BRUSH_PRIMITIVE_ICON_NAMES[primitive];
}

function fitBrushToBounds(brush: Brush, mins: Vec3, maxs: Vec3): Brush {
  const sourceMins = [...brush.mins] as Vec3;
  const sourceMaxs = [...brush.maxs] as Vec3;
  for (const face of brush.faces) {
    for (const point of face.points) {
      for (let axis = 0; axis < 3; axis++) {
        const extent = sourceMaxs[axis] - sourceMins[axis];
        point[axis] = mins[axis] + ((point[axis] - sourceMins[axis]) / extent) * (maxs[axis] - mins[axis]);
      }
    }
  }
  computeBrushGeometry(brush);
  return brush;
}

export function createBrushPrimitive(
  primitive: BrushPrimitive,
  mins: Vec3,
  maxs: Vec3,
  texture: string,
  axis: number,
  sides: number,
): Brush {
  validateBrushPrimitiveParameters(primitive, mins, maxs, axis, sides);

  let brush: Brush;
  switch (primitive) {
    case 'box':
      return createBoxBrush(mins, maxs, texture);
    case 'cylinder':
      brush = createCylinderBrush(mins, maxs, texture, axis, sides); break;
    case 'cone':
      brush = createConeBrush(mins, maxs, texture, axis, sides); break;
    case 'sphere':
      brush = createSphereBrush(mins, maxs, texture, sides); break;
    case 'pyramid':
      brush = createPyramidBrush(mins, maxs, texture, axis); break;
  }
  return fitBrushToBounds(brush, mins, maxs);
}
