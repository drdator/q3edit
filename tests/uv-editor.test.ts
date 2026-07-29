import { describe, expect, it } from 'vitest';
import { computeBrushGeometry, createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { faceUvPolygon, fitUvViewport, screenToUv, shortestAngleDelta, uvToScreen } from '../src/uv-editor';
import {
  patchClipPolygon,
  surfaceDragMultiplier,
  surfacePreviewCells,
  surfacePreviewLimit,
  surfaceCameraSide,
  surfaceCameraUvBasis,
  surfaceOutsideUvBasis,
  surfaceResizeCursor,
  surfaceScaledDragPoint,
  surfaceScaleFactor,
  surfaceSelectionSignature,
} from '../src/surface-inspector';

describe('UV editor view model', () => {
  it('projects a classic brush face into texture space', () => {
    const brush = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/concrete');
    const face = brush.faces[4];
    const polygon = faceUvPolygon(face, 128, 128);

    expect(polygon).toHaveLength(4);
    expect(Math.max(...polygon.map(point => point.u)) - Math.min(...polygon.map(point => point.u))).toBeCloseTo(2);
    expect(Math.max(...polygon.map(point => point.v)) - Math.min(...polygon.map(point => point.v))).toBeCloseTo(2);
  });

  it('detects whether the camera views a face from outside or inside the brush', () => {
    const brush = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/concrete');
    const top = brush.faces[4];
    expect(surfaceCameraSide(top, [64, 64, 256])).toBe('front/outside');
    expect(surfaceCameraSide(top, [64, 64, 32])).toBe('back/inside');
  });

  it('matches both UV axes to their camera-space directions', () => {
    const brush = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/concrete');
    const north = brush.faces.find(face => face.plane.normal[1] > 0.9);
    expect(north).toBeDefined();
    expect(surfaceCameraUvBasis(north!, [64, 256, 64], -Math.PI / 2, 0).axisX[0]).toBeCloseTo(-1);
    expect(surfaceCameraUvBasis(north!, [64, 256, 64], -Math.PI / 2, 0).axisY[1]).toBeCloseTo(1);
    expect(surfaceCameraUvBasis(north!, [64, 0, 64], Math.PI / 2, 0).axisX[0]).toBeCloseTo(1);
    expect(surfaceCameraUvBasis(north!, [64, 0, 64], Math.PI / 2, 0).axisY[1]).toBeCloseTo(1);
  });

  it('uses a stable outside-facing orientation for walls, floors, and ceilings', () => {
    const brush = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/concrete');
    const north = brush.faces.find(face => face.plane.normal[1] > 0.9)!;
    const south = brush.faces.find(face => face.plane.normal[1] < -0.9)!;
    const floor = brush.faces.find(face => face.plane.normal[2] > 0.9)!;
    const ceiling = brush.faces.find(face => face.plane.normal[2] < -0.9)!;

    expect(surfaceOutsideUvBasis(north).axisX[0]).toBeCloseTo(-1);
    expect(surfaceOutsideUvBasis(north).axisY[1]).toBeCloseTo(1);
    expect(surfaceOutsideUvBasis(south).axisX[0]).toBeCloseTo(1);
    expect(surfaceOutsideUvBasis(south).axisY[1]).toBeCloseTo(1);
    expect(surfaceOutsideUvBasis(floor).axisX[0]).toBeCloseTo(1);
    expect(surfaceOutsideUvBasis(floor).axisY[1]).toBeCloseTo(1);
    expect(surfaceOutsideUvBasis(ceiling).axisX[0]).toBeCloseTo(-1);
    expect(surfaceOutsideUvBasis(ceiling).axisY[1]).toBeCloseTo(1);
  });

  it('round-trips UV coordinates through a mirrored viewport', () => {
    const viewport = {
      scale: 10,
      offsetX: 0,
      offsetY: 0,
      width: 100,
      height: 100,
      axisX: [-1, 0] as [number, number],
      axisY: [0, 1] as [number, number],
      orientationCenter: [50, 50] as [number, number],
    };
    expect(uvToScreen({ u: 2, v: 3 }, viewport)).toEqual([80, 30]);
    expect(screenToUv(80, 30, viewport)).toEqual({ u: 2, v: 3 });
  });

  it('round-trips UV coordinates through a rotated viewport', () => {
    const viewport = {
      scale: 10,
      offsetX: 50,
      offsetY: 50,
      width: 100,
      height: 100,
      axisX: [0, 1] as [number, number],
      axisY: [-1, 0] as [number, number],
      orientationCenter: [50, 50] as [number, number],
    };
    expect(uvToScreen({ u: 2, v: 3 }, viewport)).toEqual([20, 70]);
    expect(screenToUv(20, 70, viewport)).toEqual({ u: 2, v: 3 });
  });

  it('round-trips UV coordinates through an oblique camera-facing viewport', () => {
    const viewport = {
      scale: 10,
      offsetX: 50,
      offsetY: 50,
      width: 100,
      height: 100,
      axisX: [1, 0] as [number, number],
      axisY: [-0.5, Math.sqrt(0.75)] as [number, number],
      orientationCenter: [50, 50] as [number, number],
    };
    const screen = uvToScreen({ u: 2, v: 3 }, viewport);
    expect(screenToUv(screen[0], screen[1], viewport).u).toBeCloseTo(2);
    expect(screenToUv(screen[0], screen[1], viewport).v).toBeCloseTo(3);
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

  it('fits a clipped face even when its UV range is very small', () => {
    const points = [{ u: 0, v: 0 }, { u: 0.01, v: 0.01 }];
    const textureViewport = fitUvViewport(points, 200, 200, 20);
    const surfaceViewport = fitUvViewport(points, 200, 200, 20, 'surface');
    const textureSpan = uvToScreen(points[1], textureViewport)[0] - uvToScreen(points[0], textureViewport)[0];
    const surfaceSpan = uvToScreen(points[1], surfaceViewport)[0] - uvToScreen(points[0], surfaceViewport)[0];

    expect(textureSpan).toBeLessThan(10);
    expect(surfaceSpan).toBeCloseTo(160);
  });

  it('keeps rotation deltas continuous across the angle wrap boundary', () => {
    const degrees = (value: number) => value * Math.PI / 180;
    expect(shortestAngleDelta(degrees(179), degrees(-179)) * 180 / Math.PI).toBeCloseTo(2);
    expect(shortestAngleDelta(degrees(-179), degrees(179)) * 180 / Math.PI).toBeCloseTo(-2);
  });

  it('supports fine and coarse interactive surface adjustments', () => {
    expect(surfaceDragMultiplier(false, false)).toBe(1);
    expect(surfaceDragMultiplier(true, false)).toBe(0.1);
    expect(surfaceDragMultiplier(false, true)).toBe(10);
    expect(surfaceDragMultiplier(true, true)).toBe(1);
  });

  it('chooses resize cursors from each handle screen direction', () => {
    const center: [number, number] = [100, 100];
    expect(surfaceResizeCursor(center, [140, 100])).toBe('ew-resize');
    expect(surfaceResizeCursor(center, [100, 60])).toBe('ns-resize');
    expect(surfaceResizeCursor(center, [140, 140])).toBe('nwse-resize');
    expect(surfaceResizeCursor(center, [60, 140])).toBe('nesw-resize');
    expect(surfaceResizeCursor(center, [135, 70])).toBe('nesw-resize');
  });

  it('maps scale-handle span directly to UV scale', () => {
    expect(surfaceScaleFactor(100, 150)).toBeCloseTo(1.5);
    expect(surfaceScaleFactor(-100, -150)).toBeCloseTo(1.5);
    expect(surfaceScaleFactor(-100, -50)).toBeCloseTo(0.5);
  });

  it('clamps scaling instead of inverting after crossing the fixed edge', () => {
    expect(surfaceScaleFactor(100, -10)).toBe(0.02);
    expect(surfaceScaleFactor(-100, 10)).toBe(0.02);
  });

  it('applies fine control to cursor travel before calculating scale', () => {
    expect(surfaceScaledDragPoint([100, 0], [100, 0], [-10, 0], 0.1)).toEqual([89, 0]);
    expect(surfaceScaledDragPoint([-100, 0], [-100, 0], [-120, 0], 0.1)).toEqual([-102, 0]);
  });

  it('distinguishes equal-looking surface selections', () => {
    const editor = new Editor();
    const first = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/concrete');
    const second = createBoxBrush([128, 0, 0], [192, 64, 64], 'base_wall/concrete');
    editor.worldspawn.brushes.push(first, second);
    editor.selection = [{ type: 'face', entity: editor.worldspawn, brush: first, face: first.faces[4] }];
    const firstSignature = surfaceSelectionSignature(editor);

    editor.selection = [{ type: 'face', entity: editor.worldspawn, brush: second, face: second.faces[4] }];

    expect(surfaceSelectionSignature(editor)).not.toBe(firstSignature);
  });

  it('builds a patch perimeter for clipped multi-surface previews', () => {
    const rows = [
      [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }],
      [{ u: 0, v: 1 }, { u: 1, v: 1 }, { u: 2, v: 1 }],
      [{ u: 0, v: 2 }, { u: 1, v: 2 }, { u: 2, v: 2 }],
    ];

    expect(patchClipPolygon(rows)).toEqual([
      { u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 },
      { u: 2, v: 1 }, { u: 2, v: 2 },
      { u: 1, v: 2 }, { u: 0, v: 2 },
      { u: 0, v: 1 },
    ]);
  });

  it('lays out separate surface previews responsively', () => {
    const narrow = surfacePreviewCells(3, 200, 560);
    expect(narrow.map(cell => cell.x)).toEqual([8, 8, 8]);
    expect(narrow[1].y).toBeGreaterThan(narrow[0].y + narrow[0].height);

    const wide = surfacePreviewCells(3, 500, 380);
    expect(wide[1].x).toBeGreaterThan(wide[0].x + wide[0].width);
    expect(wide[2].y).toBeGreaterThan(wide[0].y + wide[0].height);
  });

  it('limits separate previews to six usable rows', () => {
    expect(surfacePreviewLimit(1)).toBe(6);
    expect(surfacePreviewLimit(2)).toBe(12);
    expect(surfacePreviewLimit(3)).toBe(12);
  });
});
