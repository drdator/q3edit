import { describe, expect, test } from 'vitest';
import {
  clipBrush,
  cloneBrush,
  computeFaceUV,
  createBoxBrush,
  validateBrush,
} from '../src/brush';
import { hollowBrush, mergeBrushes, subtractBrush } from '../src/csg';
import { vec3Add, vec3MirrorAxis, vec3RotateAxis, type Vec3 } from '../src/math';
import {
  mirrorBrushLocked,
  rotateBrushLocked,
  translateBrushLocked,
} from '../src/texture-lock';

describe('brush texture projections', () => {
  test('evaluates and clones brush-primitive matrices independently of classic texdefs', () => {
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const face = brush.faces[4];
    face.textureProjection = {
      kind: 'brush-primitive',
      matrix: [[1 / 128, 0, 0.25], [0, 1 / 64, 0.5]],
    };

    expectUvClose(computeFaceUV([64, 32, 64], face, 128, 64), [0.75, 0]);

    const cloned = cloneBrush(brush);
    expect(cloned.faces[4].textureProjection).toEqual(face.textureProjection);
    expect(cloned.faces[4].textureProjection).not.toBe(face.textureProjection);
    if (cloned.faces[4].textureProjection.kind === 'brush-primitive') {
      cloned.faces[4].textureProjection.matrix[0][2] = 99;
    }
    expect(face.textureProjection.matrix[0][2]).toBe(0.25);
  });
});

function expectVecClose(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 5);
  expect(actual[1]).toBeCloseTo(expected[1], 5);
  expect(actual[2]).toBeCloseTo(expected[2], 5);
}

function expectUvClose(actual: [number, number], expected: [number, number], context = ''): void {
  expect(actual[0], `${context} u`).toBeCloseTo(expected[0], 5);
  expect(actual[1], `${context} v`).toBeCloseTo(expected[1], 5);
}

describe('texture-locked brush transforms', () => {
  test('preserves texture coordinates through translation', () => {
    const brush = createBoxBrush([0, 0, 0], [64, 96, 128], 'base_wall/concrete');
    const delta: Vec3 = [24, -16, 8];
    const before = brush.faces.map(face => computeFaceUV(face.points[0], face, 128, 64));
    const points = brush.faces.map(face => [...face.points[0]] as Vec3);

    translateBrushLocked(brush, delta);

    brush.faces.forEach((face, index) => {
      expectVecClose(face.points[0], vec3Add(points[index], delta));
      expectUvClose(computeFaceUV(face.points[0], face, 128, 64), before[index]);
    });
  });

  test('preserves texture coordinates through rotation and mirror', () => {
    const center: Vec3 = [32, 48, 64];
    const angle = Math.PI / 2;
    const rotated = createBoxBrush([0, 0, 0], [64, 96, 128], 'base_wall/concrete');
    const rotatedUvs = rotated.faces.map(face => computeFaceUV(face.points[0], face, 128, 64));
    const rotatedPoints = rotated.faces.map(face => [...face.points[0]] as Vec3);

    rotateBrushLocked(rotated, center, 2, angle);

    rotated.faces.forEach((face, index) => {
      expectVecClose(face.points[0], vec3RotateAxis(rotatedPoints[index], center, 2, angle));
      expectUvClose(computeFaceUV(face.points[0], face, 128, 64), rotatedUvs[index], `rotated face ${index}`);
    });

    const mirrored = createBoxBrush([0, 0, 0], [64, 96, 128], 'base_wall/concrete');
    const mirroredUvs = mirrored.faces.map(face => computeFaceUV(face.points[0], face, 128, 64));
    const mirroredPoints = mirrored.faces.map(face => [...face.points[0]] as Vec3);

    mirrorBrushLocked(mirrored, center, 0);

    mirrored.faces.forEach((face, index) => {
      const transformedPoint = vec3MirrorAxis(mirroredPoints[index], center, 0);
      // Mirroring reverses the defining-point order to preserve outward normals.
      expectVecClose(face.points[2], transformedPoint);
      expectUvClose(computeFaceUV(transformedPoint, face, 128, 64), mirroredUvs[index], `mirrored face ${index}`);
    });
  });
});

describe('clipping and CSG invariants', () => {
  test('clips a valid box to the requested half-space', () => {
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const clipped = clipBrush(brush, [
      [32, 0, 0],
      [32, 64, 0],
      [32, 0, 64],
    ]);

    expect(clipped).not.toBeNull();
    expect(clipped!.mins[0]).toBeCloseTo(0);
    expect(clipped!.maxs[0]).toBeCloseTo(32);
    expect(validateBrush(clipped!).valid).toBe(true);
  });

  test('subtracts an overlapping carver into valid fragments', () => {
    const target = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const carver = createBoxBrush([32, 16, 16], [80, 48, 48]);
    const fragments = subtractBrush(target, carver);

    expect(fragments).not.toBeNull();
    expect(fragments!.length).toBeGreaterThan(0);
    expect(fragments!.every(fragment => validateBrush(fragment).valid)).toBe(true);
  });

  test('hollows a box into valid shell brushes', () => {
    const shells = hollowBrush(createBoxBrush([0, 0, 0], [64, 64, 64]), 8);

    expect(shells).toHaveLength(6);
    expect(shells.every(shell => validateBrush(shell).valid)).toBe(true);
  });

  test('merges adjacent boxes into their convex union', () => {
    const merged = mergeBrushes([
      createBoxBrush([0, 0, 0], [32, 64, 64]),
      createBoxBrush([32, 0, 0], [64, 64, 64]),
    ]);

    expect(merged).not.toBeNull();
    expectVecClose(merged!.mins, [0, 0, 0]);
    expectVecClose(merged!.maxs, [64, 64, 64]);
    expect(validateBrush(merged!).valid).toBe(true);
  });
});
