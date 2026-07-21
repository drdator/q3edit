import { describe, expect, test } from 'vitest';
import { queryMap } from '../bridge/map-query';
import { createBoxBrush } from '../src/brush';
import { createEntity } from '../src/entity';
import { serializeMap } from '../src/mapfile';
import { GROUP_ID_KEY, GROUP_INFO_CLASSNAME, GROUP_NAME_KEY } from '../src/named-groups';
import { inspectMapGroups } from '../bridge/map-query';

function queryFixture(): string {
  const world = createEntity('worldspawn');
  world.properties.message = 'MCP query fixture';
  world.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64], 'base_floor/stone'));

  const door = createEntity('func_door');
  door.properties.targetname = 'north_gate';
  door.brushes.push(createBoxBrush([128, 0, 0], [160, 64, 96], 'base_door/metal'));

  const light = createEntity('light');
  light.properties.origin = '32 32 96';
  light.properties.light = '600';
  return serializeMap([world, door, light]);
}

describe('map spatial query', () => {
  test('filters entities by classname and properties', () => {
    expect(queryMap(queryFixture(), { kind: 'entity', classname: 'func_door', propertyKey: 'targetname', propertyValue: 'north' }))
      .toEqual([expect.objectContaining({ ref: 'E1', kind: 'entity', classname: 'func_door' })]);
    expect(queryMap(queryFixture(), { kind: 'entity', propertyKey: 'light', propertyValue: '60' }))
      .toEqual([expect.objectContaining({ ref: 'E2', origin: [32, 32, 96] })]);
  });

  test('finds textured geometry and respects owning entity filters', () => {
    expect(queryMap(queryFixture(), { kind: 'brush', texture: 'door' }))
      .toEqual([expect.objectContaining({ ref: 'E1:B0', textures: ['base_door/metal'] })]);
    expect(queryMap(queryFixture(), { kind: 'brush', classname: 'worldspawn' }))
      .toEqual([expect.objectContaining({ ref: 'E0:B0' })]);
    expect(queryMap(queryFixture(), { kind: 'face', texture: 'stone' })).toHaveLength(6);
    expect(queryMap(queryFixture(), { kind: 'face', texture: 'stone' })[0])
      .toMatchObject({ ref: 'E0:B0:F0', brush: 'E0:B0', texture: 'base_floor/stone' });
  });

  test('looks up exact entity, brush, face, and patch references directly', () => {
    const matches = queryMap(queryFixture(), { refs: ['E2', 'E0:B0', 'E1:B0:F3'] });
    expect(matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 'E2', kind: 'entity' }),
      expect.objectContaining({ ref: 'E0:B0', kind: 'brush' }),
      expect.objectContaining({ ref: 'E1:B0:F3', kind: 'face' }),
    ]));
    expect(matches).toHaveLength(3);
    expect(queryMap(queryFixture(), { refs: ['E9'] })).toEqual([]);
  });

  test('supports intersecting and contained world-space bounds', () => {
    expect(queryMap(queryFixture(), {
      kind: 'brush', bounds: { mins: [48, 48, 48], maxs: [80, 80, 80], mode: 'intersects' },
    })).toEqual([expect.objectContaining({ ref: 'E0:B0' })]);

    expect(queryMap(queryFixture(), {
      kind: 'brush', bounds: { mins: [-1, -1, -1], maxs: [65, 65, 65], mode: 'inside' },
    })).toEqual([expect.objectContaining({ ref: 'E0:B0' })]);

    expect(queryMap(queryFixture(), {
      kind: 'entity', classname: 'light', bounds: { mins: [0, 0, 80], maxs: [64, 64, 128] },
    })).toEqual([expect.objectContaining({ ref: 'E2' })]);
  });

  test('queries persistent named groups and lists their members', () => {
    const world = createEntity('worldspawn');
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/metal');
    brush.editorGroupId = 'mcp-reactor';
    world.brushes.push(brush);
    const group = createEntity(GROUP_INFO_CLASSNAME);
    group.properties[GROUP_ID_KEY] = 'mcp-reactor';
    group.properties[GROUP_NAME_KEY] = 'Reactor Core';
    const mapText = serializeMap([world, group]);

    expect(queryMap(mapText, { kind: 'brush', group: 'Reactor Core' }))
      .toEqual([expect.objectContaining({ ref: 'E0:B0', group: { id: 'mcp-reactor', name: 'Reactor Core' } })]);
    expect(inspectMapGroups(mapText)).toEqual([
      expect.objectContaining({ id: 'mcp-reactor', name: 'Reactor Core', memberCount: 1, members: ['E0:B0'] }),
    ]);
  });
});
