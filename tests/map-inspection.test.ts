import { describe, expect, test } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { createEntity } from '../src/entity';
import { serializeMap } from '../src/mapfile';
import { inspectMapObjects } from '../bridge/map-inspection';

describe('MCP map inspection', () => {
  test('returns compact entity and brush details with optional face geometry', () => {
    const worldspawn = createEntity('worldspawn');
    worldspawn.properties.message = 'inspection';
    worldspawn.brushes.push(createBoxBrush([0, 0, 0], [64, 96, 128], 'common/caulk'));
    const mapText = serializeMap([worldspawn]);

    expect(inspectMapObjects(mapText, ['E0', 'E0:B0'])).toEqual([
      expect.objectContaining({
        ref: 'E0',
        kind: 'entity',
        classname: 'worldspawn',
        properties: expect.objectContaining({ message: 'inspection' }),
        brushes: ['E0:B0'],
      }),
      expect.objectContaining({
        ref: 'E0:B0',
        kind: 'brush',
        mins: [0, 0, 0],
        maxs: [64, 96, 128],
        faceCount: 6,
        textures: ['common/caulk'],
      }),
    ]);

    const detailed = inspectMapObjects(mapText, ['E0:B0'], true)[0] as { faces: unknown[] };
    expect(detailed.faces).toHaveLength(6);
  });
});
