import { describe, expect, test } from 'vitest';
import {
  clipBrush,
  cloneTextureProjection,
  computeFaceUV,
  createBoxBrush,
  type Brush,
} from '../src/brush';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import {
  fitTexture,
  projectTexture,
  resetTextureAlignment,
  rotateTexture,
  scaleTexture,
  scaleTextureFromProjection,
  shiftTexture,
} from '../src/editor-textures';
import {
  mirrorBrushLocked,
  rotateBrushLocked,
  scaleBrushLocked,
  translateBrushLocked,
} from '../src/texture-lock';
import { vec3Add, vec3MirrorAxis, vec3RotateAxis, type Vec3 } from '../src/math';
import { enterVertexMode, moveSelectedVertices, selectVertex } from '../src/editor-vertex';

function primitiveBrush(): Brush {
  const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'textures/common/caulk');
  brush.properties = { editor_note: 'primitive' };
  for (const face of brush.faces) {
    face.textureProjection = {
      kind: 'brush-primitive',
      matrix: [[0.01, 0.002, 0.125], [-0.003, 0.012, -0.25]],
    };
  }
  return brush;
}

function editorWithSelectedFace(): { editor: Editor; brush: Brush } {
  const editor = new Editor();
  const worldspawn = createEntity('worldspawn');
  const brush = primitiveBrush();
  worldspawn.brushes.push(brush);
  editor.entities = [worldspawn];
  editor.selection = [{ type: 'face', entity: worldspawn, brush, face: brush.faces[0] }];
  return { editor, brush };
}

function expectUvClose(actual: [number, number], expected: [number, number]): void {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
}

function uvDistance(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

describe('brushDef texture editing', () => {
  test('shifts a primitive matrix in normalized texture coordinates and is undoable', () => {
    const { editor, brush } = editorWithSelectedFace();

    shiftTexture(editor, 8, -16);

    expect(brush.faces[0].textureProjection).toEqual({
      kind: 'brush-primitive',
      matrix: [[0.01, 0.002, 0.1875], [-0.003, 0.012, -0.375]],
    });
    expect(editor.history.undoLabel).toBe('Shift texture');
    editor.undo();
    expect(editor.entities[0].brushes[0].faces[0].textureProjection).toEqual({
      kind: 'brush-primitive',
      matrix: [[0.01, 0.002, 0.125], [-0.003, 0.012, -0.25]],
    });
  });

  test('can edit one face without changing the rest of a multi-face selection', () => {
    const { editor, brush } = editorWithSelectedFace();
    editor.selection = [{ type: 'brush', entity: editor.entities[0], brush }];
    const target = brush.faces[0];
    const untouched = brush.faces[1];
    const originalTarget = structuredClone(target.textureProjection);
    const originalUntouched = structuredClone(untouched.textureProjection);

    shiftTexture(editor, 8, -16, [target]);
    rotateTexture(editor, 15, [target]);
    scaleTexture(editor, 0.25, [target]);

    expect(target.textureProjection).not.toEqual(originalTarget);
    expect(untouched.textureProjection).toEqual(originalUntouched);
  });

  test('scales UVs from their starting projection around a fixed anchor', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_floor/concrete');
    editor.worldspawn.brushes.push(brush);
    const face = brush.faces[4];
    const center = face.polygon.reduce<Vec3>(
      (sum, point) => vec3Add(sum, point),
      [0, 0, 0],
    ).map(value => value / face.polygon.length) as Vec3;
    const anchor = computeFaceUV(center, face, 128, 128);
    const initial = cloneTextureProjection(face.textureProjection);
    const before = face.polygon.map(point => computeFaceUV(point, face, 128, 128));
    const beforeWidth = Math.max(...before.map(uv => uv[0])) - Math.min(...before.map(uv => uv[0]));

    scaleTextureFromProjection(editor, face, initial, 1.5, anchor);

    const after = face.polygon.map(point => computeFaceUV(point, face, 128, 128));
    const afterWidth = Math.max(...after.map(uv => uv[0])) - Math.min(...after.map(uv => uv[0]));
    expect(afterWidth).toBeCloseTo(beforeWidth * 1.5);
    expectUvClose(computeFaceUV(center, face, 128, 128), anchor);
  });

  test('directly scales brush primitive UV matrices around a fixed anchor', () => {
    const { editor, brush } = editorWithSelectedFace();
    const face = brush.faces[0];
    const center = face.polygon.reduce<Vec3>(
      (sum, point) => vec3Add(sum, point),
      [0, 0, 0],
    ).map(value => value / face.polygon.length) as Vec3;
    const anchor = computeFaceUV(center, face, 128, 128);
    const initial = cloneTextureProjection(face.textureProjection);
    const before = face.polygon.map(point => computeFaceUV(point, face, 128, 128));
    const beforeHeight = Math.max(...before.map(uv => uv[1])) - Math.min(...before.map(uv => uv[1]));

    scaleTextureFromProjection(editor, face, initial, 0.6, anchor);

    const after = face.polygon.map(point => computeFaceUV(point, face, 128, 128));
    const afterHeight = Math.max(...after.map(uv => uv[1])) - Math.min(...after.map(uv => uv[1]));
    expect(afterHeight).toBeCloseTo(beforeHeight * 0.6);
    expectUvClose(computeFaceUV(center, face, 128, 128), anchor);
  });

  test('scales and rotates primitive matrices', () => {
    const scaled = editorWithSelectedFace();
    const face = scaled.brush.faces[0];
    face.textureProjection = {
      kind: 'brush-primitive',
      matrix: [[1 / 128, 0, 0.25], [0, 1 / 128, -0.5]],
    };
    scaleTexture(scaled.editor, 0.5);
    if (face.textureProjection.kind !== 'brush-primitive') throw new Error('expected primitive projection');
    expect(face.textureProjection.matrix[0][0]).toBeCloseTo(1 / 192, 9);
    expect(face.textureProjection.matrix[1][1]).toBeCloseTo(1 / 192, 9);
    expect(face.textureProjection.matrix[0][2]).toBe(0.25);

    const rotated = editorWithSelectedFace();
    const rotatedFace = rotated.brush.faces[0];
    rotatedFace.textureProjection = {
      kind: 'brush-primitive',
      matrix: [[1 / 128, 0, 0.25], [0, 1 / 128, -0.5]],
    };
    rotateTexture(rotated.editor, 90);
    if (rotatedFace.textureProjection.kind !== 'brush-primitive') throw new Error('expected primitive projection');
    expect(rotatedFace.textureProjection.matrix[0][0]).toBeCloseTo(0, 9);
    expect(rotatedFace.textureProjection.matrix[0][1]).toBeCloseTo(-1 / 128, 9);
    expect(rotatedFace.textureProjection.matrix[0][2]).toBeCloseTo(0.5, 9);
    expect(rotatedFace.textureProjection.matrix[1][0]).toBeCloseTo(1 / 128, 9);
    expect(rotatedFace.textureProjection.matrix[1][1]).toBeCloseTo(0, 9);
    expect(rotatedFace.textureProjection.matrix[1][2]).toBeCloseTo(0.25, 9);
  });

  test('resets and fits primitive matrices', () => {
    const reset = editorWithSelectedFace();
    resetTextureAlignment(reset.editor);
    expect(reset.brush.faces[0].textureProjection).toEqual({
      kind: 'brush-primitive',
      matrix: [[1 / 64, 0, 0], [0, 1 / 64, 0]],
    });

    const fitted = editorWithSelectedFace();
    fitTexture(fitted.editor);
    const projection = fitted.brush.faces[0].textureProjection;
    expect(projection.kind).toBe('brush-primitive');
    if (projection.kind === 'brush-primitive') {
      const face = fitted.brush.faces[0];
      for (const vertex of face.polygon) {
        const [u, v] = computeFaceUV(vertex, face, 128, 128);
        expect(u).toBeGreaterThanOrEqual(-1e-6);
        expect(u).toBeLessThanOrEqual(1 + 1e-6);
        expect(v).toBeGreaterThanOrEqual(-1e-6);
        expect(v).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  test('fits one texture axis without changing the other projection axis', () => {
    const widthOnly = editorWithSelectedFace();
    const widthFace = widthOnly.brush.faces[0];
    if (widthFace.textureProjection.kind !== 'brush-primitive') throw new Error('expected primitive projection');
    const originalV = [...widthFace.textureProjection.matrix[1]];
    fitTexture(widthOnly.editor, 'width');
    expect(widthFace.textureProjection.matrix[1]).toEqual(originalV);
    const uValues = widthFace.polygon.map(vertex => computeFaceUV(vertex, widthFace, 128, 128)[0]);
    expect(Math.max(...uValues) - Math.min(...uValues)).toBeCloseTo(1, 6);

    const editor = new Editor();
    const worldspawn = createEntity('worldspawn');
    const classic = createBoxBrush([0, 0, 0], [96, 64, 32], 'textures/common/caulk');
    const classicFace = classic.faces[4];
    if (classicFace.textureProjection.kind !== 'classic') throw new Error('expected classic projection');
    Object.assign(classicFace.textureProjection, {
      offsetX: 13,
      offsetY: 27,
      rotation: 30,
      scaleX: 0.25,
      scaleY: 0.75,
    });
    worldspawn.brushes.push(classic);
    editor.entities = [worldspawn];
    editor.selection = [{ type: 'face', entity: worldspawn, brush: classic, face: classicFace }];
    fitTexture(editor, 'width');
    expect(classicFace.textureProjection.rotation).toBe(30);
    expect(classicFace.textureProjection.scaleY).toBe(0.75);
    expect(classicFace.textureProjection.offsetY).toBe(27);
    const classicU = classicFace.polygon.map(vertex => computeFaceUV(vertex, classicFace, 128, 128)[0]);
    expect(Math.max(...classicU) - Math.min(...classicU)).toBeCloseTo(1, 6);
  });

  test('projects classic and primitive textures onto axial and camera bases', () => {
    const editor = new Editor();
    const worldspawn = createEntity('worldspawn');
    const brush = createBoxBrush([0, 0, 0], [96, 64, 32], 'textures/common/caulk');
    const face = brush.faces[4];
    if (face.textureProjection.kind !== 'classic') throw new Error('expected classic projection');
    Object.assign(face.textureProjection, {
      offsetX: 11,
      offsetY: -7,
      rotation: 33,
      scaleX: -0.25,
      scaleY: 0.75,
    });
    worldspawn.brushes.push(brush);
    editor.entities = [worldspawn];
    editor.selection = [{ type: 'face', entity: worldspawn, brush, face }];

    projectTexture(editor, 'axial');
    expect(face.textureProjection).toMatchObject({
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      scaleX: 0.25,
      scaleY: 0.75,
    });

    editor.camera3d.yaw = 0;
    editor.camera3d.pitch = 0;
    projectTexture(editor, 'camera');
    expect(face.textureProjection.rotation).toBeCloseTo(270, 6);

    const primitive = editorWithSelectedFace();
    const primitiveFace = primitive.brush.faces[0];
    if (primitiveFace.textureProjection.kind !== 'brush-primitive') throw new Error('expected primitive projection');
    const uMagnitude = Math.hypot(...primitiveFace.textureProjection.matrix[0].slice(0, 2));
    const vMagnitude = Math.hypot(...primitiveFace.textureProjection.matrix[1].slice(0, 2));
    projectTexture(primitive.editor, 'axial');
    expect(primitiveFace.textureProjection.matrix[0]).toEqual([uMagnitude, 0, 0]);
    expect(primitiveFace.textureProjection.matrix[1]).toEqual([0, vMagnitude, 0]);
  });
});

describe('brushDef geometry operations', () => {
  test('preserves UVs through locked translate, rotate, mirror, and non-uniform scale', () => {
    const center: Vec3 = [32, 32, 32];

    const translated = primitiveBrush();
    const translatedPoints = translated.faces.map(face => [...face.points[0]] as Vec3);
    const translatedUvs = translated.faces.map((face, index) => computeFaceUV(translatedPoints[index], face, 1, 1));
    const delta: Vec3 = [16, -8, 4];
    translateBrushLocked(translated, delta);
    translated.faces.forEach((face, index) => {
      expectUvClose(computeFaceUV(vec3Add(translatedPoints[index], delta), face, 1, 1), translatedUvs[index]);
    });

    const rotated = primitiveBrush();
    const rotatedPoints = rotated.faces.map(face => [...face.points[0]] as Vec3);
    const rotatedUvs = rotated.faces.map((face, index) => computeFaceUV(rotatedPoints[index], face, 1, 1));
    rotateBrushLocked(rotated, center, 2, Math.PI / 2);
    rotated.faces.forEach((face, index) => {
      const point = vec3RotateAxis(rotatedPoints[index], center, 2, Math.PI / 2);
      expectUvClose(computeFaceUV(point, face, 1, 1), rotatedUvs[index]);
    });

    const mirrored = primitiveBrush();
    const mirroredPoints = mirrored.faces.map(face => [...face.points[0]] as Vec3);
    const mirroredUvs = mirrored.faces.map((face, index) => computeFaceUV(mirroredPoints[index], face, 1, 1));
    mirrorBrushLocked(mirrored, center, 0);
    mirrored.faces.forEach((face, index) => {
      const point = vec3MirrorAxis(mirroredPoints[index], center, 0);
      expectUvClose(computeFaceUV(point, face, 1, 1), mirroredUvs[index]);
    });

    const scaled = primitiveBrush();
    const scaledPoints = scaled.faces.map(face => [...face.points[0]] as Vec3);
    const originalPoints = scaled.faces.map(face => face.points.map(point => [...point] as Vec3) as [Vec3, Vec3, Vec3]);
    const scaledUvs = scaled.faces.map((face, index) => computeFaceUV(scaledPoints[index], face, 1, 1));
    const scale: Vec3 = [2, 0.5, 1.5];
    scaleBrushLocked(scaled, originalPoints, center, scale);
    scaled.faces.forEach((face, index) => {
      const point: Vec3 = [
        center[0] + (scaledPoints[index][0] - center[0]) * scale[0],
        center[1] + (scaledPoints[index][1] - center[1]) * scale[1],
        center[2] + (scaledPoints[index][2] - center[2]) * scale[2],
      ];
      expectUvClose(computeFaceUV(point, face, 1, 1), scaledUvs[index]);
    });
  });

  test.each([
    ['classic', () => createBoxBrush([0, 0, 0], [64, 64, 64], 'textures/base_floor/metal')],
    ['brush primitive', primitiveBrush],
  ])('keeps %s texel density while resizing with texture lock', (_kind, createBrush) => {
    const brush = createBrush();
    const topFace = brush.faces[4];
    const originalPoints = brush.faces.map(face =>
      face.points.map(point => vec3Add(point, [0, 0, 0])) as [Vec3, Vec3, Vec3]
    );
    const textureProjections = brush.faces.map(face => cloneTextureProjection(face.textureProjection));
    const start = topFace.points[0];
    const end = topFace.points[1];
    const beforeStart = computeFaceUV(start, topFace, 1, 1);
    const beforeEnd = computeFaceUV(end, topFace, 1, 1);
    const scale: Vec3 = [2, 1, 1];
    const center: Vec3 = [32, 32, 32];

    scaleBrushLocked(brush, originalPoints, center, scale, textureProjections);

    const scaledStart: Vec3 = [-32, 0, 64];
    const scaledEnd: Vec3 = [96, 0, 64];
    expectUvClose(computeFaceUV(scaledStart, topFace, 1, 1), beforeStart);
    expect(uvDistance(
      computeFaceUV(scaledStart, topFace, 1, 1),
      computeFaceUV(scaledEnd, topFace, 1, 1),
    )).toBeCloseTo(uvDistance(beforeStart, beforeEnd) * 2, 6);
  });

  test('uses the drag-start texture projection for every resize update', () => {
    const repeated = primitiveBrush();
    const direct = primitiveBrush();
    const originalPoints = repeated.faces.map(face =>
      face.points.map(point => vec3Add(point, [0, 0, 0])) as [Vec3, Vec3, Vec3]
    );
    const textureProjections = repeated.faces.map(face => cloneTextureProjection(face.textureProjection));
    const center: Vec3 = [32, 32, 32];

    scaleBrushLocked(repeated, originalPoints, center, [1.25, 1, 1], textureProjections);
    scaleBrushLocked(repeated, originalPoints, center, [2, 1, 1], textureProjections);
    scaleBrushLocked(direct, originalPoints, center, [2, 1, 1], textureProjections);

    expect(repeated.faces.map(face => face.textureProjection))
      .toEqual(direct.faces.map(face => face.textureProjection));
  });

  test('keeps primitive projections and brush epairs through clipping', () => {
    const brush = primitiveBrush();
    const clipped = clipBrush(brush, [[32, 0, 0], [32, 64, 0], [32, 0, 64]]);

    expect(clipped).not.toBeNull();
    expect(clipped?.properties).toEqual({ editor_note: 'primitive' });
    expect(clipped?.faces.every(face => face.textureProjection.kind === 'brush-primitive')).toBe(true);
  });

  test('reprojects primitive matrices after texture-locked vertex editing', () => {
    const editor = new Editor();
    const worldspawn = createEntity('worldspawn');
    const brush = primitiveBrush();
    worldspawn.brushes.push(brush);
    editor.entities = [worldspawn];
    editor.selection = [{ type: 'brush', entity: worldspawn, brush }];
    enterVertexMode(editor);
    const before = brush.faces.map(face =>
      face.points.map(point => computeFaceUV(point, face, 1, 1)) as
        [[number, number], [number, number], [number, number]],
    );

    selectVertex(editor, 0, 0);
    moveSelectedVertices(editor, [8, 0, 0]);

    brush.faces.forEach((face, faceIndex) => {
      face.points.forEach((point, pointIndex) => {
        expectUvClose(computeFaceUV(point, face, 1, 1), before[faceIndex][pointIndex]);
      });
    });
  });
});
