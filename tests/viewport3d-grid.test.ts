import { describe, expect, it } from 'vitest';
import {
  buildViewport3DGridVertices,
  VIEWPORT_3D_GRID_EXTENT,
  viewport3DGridSpacing,
} from '../src/viewport3d-grid';

describe('3D viewport grid', () => {
  it('uses the same coarse interval as the 2D grid', () => {
    expect(viewport3DGridSpacing(1)).toBe(64);
    expect(viewport3DGridSpacing(8)).toBe(64);
    expect(viewport3DGridSpacing(16)).toBe(128);
    expect(viewport3DGridSpacing(32)).toBe(256);

    const grid = buildViewport3DGridVertices(16, 256);
    expect(grid).toHaveLength(60);
    expect(grid.slice(0, 18)).toEqual([
      -256, -256, 0, -256, 256, 0,
      -128, -256, 0, -128, 256, 0,
      0, -256, 0, 0, 256, 0,
    ]);
  });

  it('covers the full 3D camera viewing distance', () => {
    expect(VIEWPORT_3D_GRID_EXTENT).toBe(32768);
    const verts = buildViewport3DGridVertices(256);
    const coordinates = verts.filter((_, index) => index % 3 !== 2);

    expect(Math.min(...coordinates)).toBe(-VIEWPORT_3D_GRID_EXTENT);
    expect(Math.max(...coordinates)).toBe(VIEWPORT_3D_GRID_EXTENT);
  });

  it('falls back to a safe positive spacing', () => {
    expect(buildViewport3DGridVertices(0, 64)).toEqual(buildViewport3DGridVertices(1, 64));
  });
});
