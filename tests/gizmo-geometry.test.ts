import { describe, expect, it } from 'vitest';
import { buildGizmoAxisTriangles } from '../src/gizmo';

describe('solid gizmo geometry', () => {
  it('builds a filled move arrow with a shaft and arrowhead', () => {
    const vertices = buildGizmoAxisTriangles([0, 0, 0], 0, 100, false);

    expect(vertices.length).toBeGreaterThan(9);
    expect(vertices.length % 9).toBe(0);
    expect(vertices.filter((_, index) => index % 3 === 0)).toContain(100);
  });

  it('builds a filled scale handle with a shaft and box', () => {
    const vertices = buildGizmoAxisTriangles([10, 20, 30], 2, 100, true);
    const zCoordinates = vertices.filter((_, index) => index % 3 === 2);

    expect(vertices.length).toBeGreaterThan(9);
    expect(vertices.length % 9).toBe(0);
    expect(Math.max(...zCoordinates)).toBeCloseTo(137.5);
    expect(Math.min(...zCoordinates)).toBeCloseTo(30);
  });
});
