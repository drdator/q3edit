import { describe, expect, it } from 'vitest';
import { computeBrushGeometry, createBoxBrush } from '../src/brush';
import { faceUvPolygon, fitUvViewport, screenToUv, shortestAngleDelta, uvToScreen } from '../src/uv-editor';
import { surfaceDragMultiplier } from '../src/surface-inspector';

describe('UV editor view model', () => {
  it('projects a classic brush face into texture space', () => {
    const brush = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/concrete');
    const face = brush.faces[4];
    const polygon = faceUvPolygon(face, 128, 128);

    expect(polygon).toHaveLength(4);
    expect(Math.max(...polygon.map(point => point.u)) - Math.min(...polygon.map(point => point.u))).toBeCloseTo(2);
    expect(Math.max(...polygon.map(point => point.v)) - Math.min(...polygon.map(point => point.v))).toBeCloseTo(2);
  });

  it('projects brush primitive matrices without converting them', () => {
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const face = brush.faces[4];
    face.textureProjection = {
      kind: 'brush-primitive',
      matrix: [[1 / 64, 0, 0.25], [0, 1 / 64, -0.5]],
    };
    computeBrushGeometry(brush);

    const polygon = faceUvPolygon(face, 256, 256);
    expect(face.textureProjection.kind).toBe('brush-primitive');
    expect(Math.min(...polygon.map(point => point.u))).toBeCloseTo(0.25);
    expect(Math.max(...polygon.map(point => point.u))).toBeCloseTo(1.25);
    expect(Math.max(...polygon.map(point => point.v)) - Math.min(...polygon.map(point => point.v))).toBeCloseTo(1);
    expect(polygon.some(point => Math.abs(point.v + 0.5) < 1e-6)).toBe(true);
  });

  it('round-trips between UV and canvas coordinates', () => {
    const viewport = fitUvViewport([{ u: -1, v: 0 }, { u: 3, v: 2 }], 800, 500);
    const point = { u: 1.25, v: -0.75 };
    const screen = uvToScreen(point, viewport);

    expect(screenToUv(screen[0], screen[1], viewport)).toEqual(point);
  });

  it('keeps rotation deltas continuous across the angle wrap boundary', () => {
    const degrees = (value: number) => value * Math.PI / 180;
    expect(shortestAngleDelta(degrees(179), degrees(-179)) * 180 / Math.PI).toBeCloseTo(2);
    expect(shortestAngleDelta(degrees(-179), degrees(179)) * 180 / Math.PI).toBeCloseTo(-2);
  });

  it('uses Shift to reduce interactive surface adjustments to one tenth', () => {
    expect(surfaceDragMultiplier(false)).toBe(1);
    expect(surfaceDragMultiplier(true)).toBe(0.1);
  });
});
