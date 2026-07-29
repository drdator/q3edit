import { describe, expect, it } from 'vitest';
import { affineTransformFromTriangles } from '../src/viewport2d-textures';

describe('2D viewport texture transforms', () => {
  it('maps texture pixels onto screen-space triangles', () => {
    const transform = affineTransformFromTriangles(
      [[0, 0], [64, 0], [0, 32]],
      [[20, 30], [148, 30], [20, 94]],
    );

    expect(transform).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 20, f: 30 });
  });

  it('supports rotated and skewed texture projections', () => {
    const transform = affineTransformFromTriangles(
      [[2, 3], [6, 3], [2, 5]],
      [[10, 20], [10, 28], [4, 20]],
    );

    expect(transform).toEqual({ a: 0, b: 2, c: -3, d: 0, e: 19, f: 16 });
  });

  it('rejects degenerate UV triangles', () => {
    expect(affineTransformFromTriangles(
      [[0, 0], [1, 1], [2, 2]],
      [[0, 0], [10, 0], [0, 10]],
    )).toBeNull();
  });
});
