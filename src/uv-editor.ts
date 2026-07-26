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
  const rangeU = Math.max(0.25, maxU - minU);
  const rangeV = Math.max(0.25, maxV - minV);
  const availableWidth = Math.max(1, safeWidth - padding * 2);
  const availableHeight = Math.max(1, safeHeight - padding * 2);
  const scale = Math.max(8, Math.min(256, availableWidth / rangeU, availableHeight / rangeV));
  return {
    scale,
    offsetX: safeWidth / 2 - ((minU + maxU) / 2) * scale,
    offsetY: safeHeight / 2 - ((minV + maxV) / 2) * scale,
    width: safeWidth,
    height: safeHeight,
  };
}

export function uvToScreen(point: UvPoint, viewport: UvViewport): [number, number] {
  return [
    viewport.offsetX + point.u * viewport.scale,
    viewport.offsetY + point.v * viewport.scale,
  ];
}

export function screenToUv(x: number, y: number, viewport: UvViewport): UvPoint {
  return {
    u: (x - viewport.offsetX) / viewport.scale,
    v: (y - viewport.offsetY) / viewport.scale,
  };
}

export function uvPolygonCenter(points: UvPoint[]): UvPoint {
  if (points.length === 0) return { u: 0, v: 0 };
  return {
    u: points.reduce((sum, point) => sum + point.u, 0) / points.length,
    v: points.reduce((sum, point) => sum + point.v, 0) / points.length,
  };
}
