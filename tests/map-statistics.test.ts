import { describe, expect, test } from 'vitest';
import { collectMapStatistics } from '../bridge/map-statistics';
import { createBoxBrush } from '../src/brush';
import { createEntity, createWorldspawn } from '../src/entity';
import { serializeMap } from '../src/mapfile';
import { CONTENTS_DETAIL } from '../src/map-flags';

describe('map statistics', () => {
  test('summarizes geometry classification, bounds, lighting, spawns, and items', () => {
    const world = createWorldspawn();
    world.brushes.push(createBoxBrush([0, 0, 0], [128, 128, 16], 'base_floor/stone'));
    const detail = createBoxBrush([32, 32, 16], [48, 48, 64], 'base_trim/metal');
    detail.faces.forEach(face => { face.contentFlags |= CONTENTS_DETAIL; });
    world.brushes.push(detail);
    const light = createEntity('light', [64, 64, 96]); light.properties.light = '400';
    const spawn = createEntity('info_player_deathmatch', [16, 16, 40]);
    const item = createEntity('weapon_rocketlauncher', [96, 96, 40]);

    const result = collectMapStatistics(serializeMap([world, light, spawn, item]));

    expect(result).toMatchObject({
      worldBounds: { mins: [0, 0, 0], maxs: [128, 128, 96] },
      geometry: { structuralBrushes: 1, detailBrushes: 1, totalBrushes: 2 },
      textures: { uniqueCount: 2, names: ['base_floor/stone', 'base_trim/metal'] },
      lighting: { count: 1, lights: [{ ref: 'E1', intensity: 400 }] },
      spawns: { count: 1, objects: [{ ref: 'E2' }] },
      items: { count: 1, objects: [{ ref: 'E3', classname: 'weapon_rocketlauncher' }] },
    });
  });
});
