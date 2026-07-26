import { describe, expect, test } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { exportGeometryObj } from '../src/geometry-obj-export';
import { createFlatPatch } from '../src/patch';

describe('Wavefront OBJ geometry export', () => {
  test('exports brush triangles, UVs, normals, groups, and materials', () => {
    const result = exportGeometryObj([{
      name: 'worldspawn',
      brushes: [createBoxBrush([0, 0, 0], [64, 64, 64], 'textures/base_wall/metal')],
      patches: [],
    }], {
      subdivisions: 4,
      materialLibrary: 'arena.mtl',
      textureSize: () => ({ width: 64, height: 64 }),
    });

    expect(result.triangleCount).toBe(12);
    expect(result.materialCount).toBe(1);
    expect(result.obj).toContain('mtllib arena.mtl');
    expect(result.obj).toContain('g worldspawn');
    expect(result.obj).toContain('usemtl base_wall_metal');
    expect(result.obj.match(/^f /gm)).toHaveLength(12);
    expect(result.obj.match(/^vt /gm)).toHaveLength(36);
    expect(result.obj.match(/^vn /gm)).toHaveLength(36);
    expect(result.mtl).toContain('# Q3 texture/shader: textures/base_wall/metal');
  });

  test('uses the requested patch subdivision without mutating the source', () => {
    const patch = createFlatPatch([0, 0, 0], [64, 64, 0], 'base_floor/tile');
    const originalSubdivisions = patch.subdivisions;

    const result = exportGeometryObj([{
      name: 'patches',
      brushes: [],
      patches: [patch],
    }], { subdivisions: 2 });

    expect(result.triangleCount).toBe(8);
    expect(patch.subdivisions).toBe(originalSubdivisions);
    expect(result.obj).toContain('usemtl base_floor_tile');
  });

  test('flips the V coordinate once for OBJ convention', () => {
    const result = exportGeometryObj([{
      name: 'patch',
      brushes: [],
      patches: [createFlatPatch([0, 0, 0], [64, 64, 0], 'base_floor/tile')],
    }], { subdivisions: 1 });

    const textureCoordinates = result.obj.split('\n')
      .filter(line => line.startsWith('vt '))
      .map(line => line.split(/\s+/).slice(1).map(Number));
    expect(textureCoordinates.some(([, v]) => v === 1)).toBe(true);
    expect(textureCoordinates.some(([, v]) => v === 0)).toBe(true);
  });
});
