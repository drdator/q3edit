import { describe, expect, it } from 'vitest';
import {
  compareBspStatistics,
  fragmentedLeafIndices,
  leafAtPoint,
  parseBsp,
  parsePortalFile,
  toolShaderKind,
} from '../src/bsp-inspection';

function fixtureBsp(): Uint8Array {
  const lumpLengths = [29, 72, 16, 36, 48, 4, 4, 40, 12, 8, 44 * 3, 12, 0, 104, 128 * 128 * 3, 0, 9];
  const headerSize = 8 + 17 * 8;
  const offsets: number[] = [];
  let length = headerSize;
  for (const lumpLength of lumpLengths) {
    offsets.push(length);
    length += lumpLength;
  }
  const data = new Uint8Array(length);
  data.set(new TextEncoder().encode('IBSP'), 0);
  const view = new DataView(data.buffer);
  view.setInt32(4, 46, true);
  for (let index = 0; index < 17; index++) {
    view.setInt32(8 + index * 8, offsets[index], true);
    view.setInt32(12 + index * 8, lumpLengths[index], true);
  }
  data.set(new TextEncoder().encode('{"classname" "worldspawn"}\0'), offsets[0]);
  data.set(new TextEncoder().encode('textures/common/hint'), offsets[1]);
  view.setInt32(offsets[4], 0, true);
  view.setInt32(offsets[4] + 8, -64, true);
  view.setInt32(offsets[4] + 12, -64, true);
  view.setInt32(offsets[4] + 16, -64, true);
  view.setInt32(offsets[4] + 20, 64, true);
  view.setInt32(offsets[4] + 24, 64, true);
  view.setInt32(offsets[4] + 28, 64, true);
  view.setInt32(offsets[4] + 36, 12, true);
  view.setFloat32(offsets[7], -128, true);
  view.setFloat32(offsets[7] + 4, -128, true);
  view.setFloat32(offsets[7] + 8, -128, true);
  view.setFloat32(offsets[7] + 12, 128, true);
  view.setFloat32(offsets[7] + 16, 128, true);
  view.setFloat32(offsets[7] + 20, 128, true);
  view.setInt32(offsets[13], 0, true);
  view.setInt32(offsets[13] + 8, 1, true);
  view.setInt32(offsets[13] + 16, 3, true);
  view.setInt32(offsets[13] + 24, 3, true);
  view.setInt32(offsets[13] + 28, 0, true);
  view.setInt32(offsets[13] + 40, 16, true);
  view.setInt32(offsets[13] + 44, 16, true);
  view.setInt32(offsets[16], 1, true);
  view.setInt32(offsets[16] + 4, 1, true);
  data[offsets[16] + 8] = 1;
  return data;
}

describe('Quake III BSP inspection', () => {
  it('parses structure, lightmaps, surfaces, world bounds, and visibility', () => {
    const inspection = parseBsp(fixtureBsp(), 'PRT1\n1\n1\n3 0 0 (0 0 0) (64 0 0) (0 64 0)\n');
    expect(inspection.version).toBe(46);
    expect(inspection.stats).toMatchObject({
      entities: 1,
      shaders: 1,
      nodes: 1,
      leaves: 1,
      clusters: 1,
      portals: 1,
      drawSurfaces: 1,
      triangles: 1,
      lightmaps: 1,
    });
    expect(inspection.surfaces[0]).toMatchObject({
      shader: 'textures/common/hint',
      type: 'planar',
      lightmapPixels: 256,
      lighting: 'unlit',
      emissive: false,
      transparent: false,
    });
    expect(inspection.visibility?.visibleClusters(0)).toEqual([0]);
    expect(inspection.worldBounds).toEqual({ mins: [-128, -128, -128], maxs: [128, 128, 128] });
    expect(leafAtPoint(inspection, [0, 0, 0])?.cluster).toBe(0);
  });

  it('parses portal polygons and rejects unrelated text', () => {
    expect(parsePortalFile('PRT1\n1\n1\n3 0 1 (0 0 0) (1 0 0) (0 1 0)\n')).toEqual([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    ]);
    expect(parsePortalFile('not a portal file')).toEqual([]);
  });

  it('reports comparisons, fragmented leaves, and tool shader semantics', () => {
    const inspection = parseBsp(fixtureBsp());
    inspection.leaves = Array.from({ length: 20 }, (_, index) => ({
      ...inspection.leaves[0],
      surfaceCount: index,
    }));
    expect(fragmentedLeafIndices(inspection)).toEqual([18, 19]);
    const previous = { ...inspection.stats, leaves: 0, bytes: inspection.stats.bytes - 10 };
    expect(compareBspStatistics(inspection.stats, previous)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'bytes', delta: 10 }),
      expect.objectContaining({ key: 'leaves', delta: 1 }),
    ]));
    expect(toolShaderKind('textures/common/areaportal')).toBe('areaportal');
    expect(toolShaderKind('base_wall/concrete')).toBeNull();
  });

  it('rejects unsupported and truncated BSP files', () => {
    expect(() => parseBsp(new Uint8Array(10))).toThrow(/header/i);
    const data = fixtureBsp();
    new DataView(data.buffer).setInt32(4, 47, true);
    expect(() => parseBsp(data)).toThrow(/version 47/);
  });
});
