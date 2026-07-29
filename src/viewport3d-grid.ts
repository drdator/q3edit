export const VIEWPORT_3D_GRID_EXTENT = 32768;

export function viewport3DGridSpacing(gridSize: number): number {
  const fineGridSize = Number.isFinite(gridSize) && gridSize > 0 ? gridSize : 1;
  return Math.max(fineGridSize * 8, 64);
}

export function buildViewport3DGridVertices(
  gridSize: number,
  extent = VIEWPORT_3D_GRID_EXTENT,
): number[] {
  const step = viewport3DGridSpacing(gridSize);
  const limit = Math.ceil(Math.max(0, extent) / step) * step;
  const verts: number[] = [];

  for (let x = -limit; x <= limit; x += step) {
    verts.push(x, -limit, 0, x, limit, 0);
  }
  for (let y = -limit; y <= limit; y += step) {
    verts.push(-limit, y, 0, limit, y, 0);
  }

  return verts;
}
