import { describe, expect, test } from 'vitest';
import { lintGameplay } from '../bridge/gameplay-lint';
import { createBoxBrush } from '../src/brush';
import { createEntity } from '../src/entity';
import { serializeMap } from '../src/mapfile';

describe('MCP gameplay lint', () => {
  test('detects embedded entities, blocked spawns, and unsupported pickups', () => {
    const world = createEntity('worldspawn');
    world.brushes.push(createBoxBrush([0, 0, 0], [128, 128, 32]));
    const embedded = createEntity('light', [32, 32, 16]);
    const spawn = createEntity('info_player_deathmatch', [64, 64, 40]);
    const item = createEntity('item_health', [512, 512, 128]);

    const issues = lintGameplay(serializeMap([world, embedded, spawn, item]));
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'entity-in-solid', refs: ['E1', 'E0:B0'] }),
      expect.objectContaining({ code: 'spawn-clearance', refs: expect.arrayContaining(['E2', 'E0:B0']) }),
      expect.objectContaining({ code: 'unsupported-item', refs: ['E3'] }),
    ]));
  });
});
