import { computeFaceUV, type BrushFace } from './brush';

export interface UvPoint {
  u: number;
  v: number;
}

export interface UvViewport {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  axisX?: [number, number];
  axisY?: [number, number];
  orientationCenter?: [number, number];
}

export function faceUvPolygon(
  face: BrushFace,
  textureWidth: number,
  textureHeight: number,
): UvPoint[] {
  return face.polygon.map(point => {
    const [u, v] = computeFaceUV(point, face, textureWidth, textureHeight);
    return { u, v };
  });
}

export function fitUvViewport(
  points: UvPoint[],
  width: number,
  height: number,
  padding = 72,
  mode: 'texture' | 'surface' = 'texture',
): UvViewport {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  if (points.length === 0) {
    return {
      scale: Math.min(safeWidth, safeHeight) / 2,
      offsetX: safeWidth / 2,
      offsetY: safeHeight / 2,
      width: safeWidth,
      height: safeHeight,
    };
  }

  const minU = Math.min(...points.map(point => point.u));
  const maxU = Math.max(...points.map(point => point.u));
  const minV = Math.min(...points.map(point => point.v));
  const maxV = Math.max(...points.map(point => point.v));
  const minimumRange = mode === 'surface' ? 1e-9 : 0.25;
  const rangeU = Math.max(minimumRange, maxU - minU);
  const rangeV = Math.max(minimumRange, maxV - minV);
  const availableWidth = Math.max(1, safeWidth - padding * 2);
  const availableHeight = Math.max(1, safeHeight - padding * 2);
  const fittedScale = Math.min(availableWidth / rangeU, availableHeight / rangeV);
  const scale = mode === 'surface' ? fittedScale : Math.max(8, Math.min(256, fittedScale));
  return {
    scale,
    offsetX: safeWidth / 2 - ((minU + maxU) / 2) * scale,
    offsetY: safeHeight / 2 - ((minV + maxV) / 2) * scale,
    width: safeWidth,
    height: safeHeight,
  };
}

export function uvToScreen(point: UvPoint, viewport: UvViewport): [number, number] {
  const x = viewport.offsetX + point.u * viewport.scale;
  const y = viewport.offsetY + point.v * viewport.scale;
  const axisX = viewport.axisX ?? [1, 0];
  const axisY = viewport.axisY ?? [0, 1];
  const center = viewport.orientationCenter ?? [viewport.width / 2, viewport.height / 2];
  const dx = x - center[0];
  const dy = y - center[1];
  return [
    center[0] + axisX[0] * dx + axisY[0] * dy,
    center[1] + axisX[1] * dx + axisY[1] * dy,
  ];
}

export function screenToUv(x: number, y: number, viewport: UvViewport): UvPoint {
  const axisX = viewport.axisX ?? [1, 0];
  const axisY = viewport.axisY ?? [0, 1];
  const center = viewport.orientationCenter ?? [viewport.width / 2, viewport.height / 2];
  const dx = x - center[0];
  const dy = y - center[1];
  const determinant = axisX[0] * axisY[1] - axisX[1] * axisY[0];
  const safeDeterminant = Math.abs(determinant) > 1e-6 ? determinant : 1;
  const unrotatedX = center[0] + (dx * axisY[1] - dy * axisY[0]) / safeDeterminant;
  const unrotatedY = center[1] + (-dx * axisX[1] + dy * axisX[0]) / safeDeterminant;
  return {
    u: (unrotatedX - viewport.offsetX) / viewport.scale,
    v: (unrotatedY - viewport.offsetY) / viewport.scale,
  };
}

export function uvViewportDeterminant(viewport: UvViewport): number {
  const axisX = viewport.axisX ?? [1, 0];
  const axisY = viewport.axisY ?? [0, 1];
  return axisX[0] * axisY[1] - axisX[1] * axisY[0];
}

export function uvPolygonCenter(points: UvPoint[]): UvPoint {
  if (points.length === 0) return { u: 0, v: 0 };
  return {
    u: points.reduce((sum, point) => sum + point.u, 0) / points.length,
    v: points.reduce((sum, point) => sum + point.v, 0) / points.length,
  };
}

export function shortestAngleDelta(previous: number, current: number): number {
  let delta = current - previous;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
