import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createEntity } from '../src/entity';
import { parseMap, parseMapWithDiagnostics, serializeMap } from '../src/mapfile';
import { createFlatPatch, createTerrainDefGridPatch } from '../src/patch';

const classicBrushFixture = readFileSync(
  new URL('./fixtures/classic-brush.map', import.meta.url),
  'utf8',
);

describe('classic .map brushes', () => {
  test('loads face texture transforms, flags, and value', () => {
    const result = parseMapWithDiagnostics(classicBrushFixture);

    expect(result.diagnostics).toEqual([]);
    expect(result.document.entities).toHaveLength(2);
    expect(result.document.entities[0].properties).toMatchObject({
      classname: 'worldspawn',
      message: 'round-trip fixture',
    });
    expect(result.document.entities[1].properties).toMatchObject({
      classname: 'info_player_start',
      origin: '32 32 24',
      angle: '90',
    });

    const brush = result.document.entities[0].brushes[0];
    expect(brush.name).toBe('flagged cube');
    expect(brush.faces).toHaveLength(6);
    for (const face of brush.faces) {
      expect(face).toMatchObject({
        texture: 'textures/common/caulk',
        offsetX: 4,
        offsetY: -8,
        rotation: 15,
        scaleX: 0.25,
        scaleY: 0.5,
        contentFlags: 134217728,
        surfaceFlags: 1024,
        value: 7,
      });
    }
  });

  test('preserves supported data across a load/save/load cycle', () => {
    const first = parseMap(classicBrushFixture);
    const second = parseMap(serializeMap(first));

    expect(second).toHaveLength(2);
    expect(second[0].properties).toEqual(first[0].properties);
    expect(second[1].properties).toEqual(first[1].properties);
    expect(second[0].brushes[0].name).toBe('flagged cube');
    expect(second[0].brushes[0].faces.map(face => ({
      points: face.points,
      texture: face.texture,
      offsetX: face.offsetX,
      offsetY: face.offsetY,
      rotation: face.rotation,
      scaleX: face.scaleX,
      scaleY: face.scaleY,
      contentFlags: face.contentFlags,
      surfaceFlags: face.surfaceFlags,
      value: face.value,
    }))).toEqual(first[0].brushes[0].faces.map(face => ({
      points: face.points,
      texture: face.texture,
      offsetX: face.offsetX,
      offsetY: face.offsetY,
      rotation: face.rotation,
      scaleX: face.scaleX,
      scaleY: face.scaleY,
      contentFlags: face.contentFlags,
      surfaceFlags: face.surfaceFlags,
      value: face.value,
    })));
  });
});

describe('patch map formats', () => {
  test('round-trips patchDef2 geometry and header flags', () => {
    const worldspawn = createEntity('worldspawn');
    const patch = createFlatPatch([0, 0, 0], [128, 96, 32], 'base_wall/concrete');
    patch.contentFlags = 8;
    patch.surfaceFlags = 16;
    patch.value = 3;
    patch.ctrl[1][1].xyz[2] = 48;
    patch.ctrl[1][1].uv = [0.375, 0.625];
    worldspawn.patches.push(patch);

    const result = parseMapWithDiagnostics(serializeMap([worldspawn]));

    expect(result.diagnostics).toEqual([]);
    const loaded = result.document.entities[0].patches[0];
    expect(loaded).toMatchObject({
      width: 3,
      height: 3,
      texture: 'base_wall/concrete',
      contentFlags: 8,
      surfaceFlags: 16,
      value: 3,
    });
    expect(loaded.ctrl[1][1]).toEqual({ xyz: [64, 48, 48], uv: [0.375, 0.625] });
  });

  test('round-trips terrainDef heights and per-sample surface metadata', () => {
    const worldspawn = createEntity('worldspawn');
    const terrain = createTerrainDefGridPatch(
      [0, 0, 0],
      [128, 128, 16],
      'textures/terrain/base',
      3,
      3,
    );
    terrain.ctrl[1][1].xyz[2] = 40;
    terrain.terrainDef!.surfaces[1][1] = {
      texture: 'textures/terrain/rock',
      offsetX: 3,
      offsetY: -5,
      rotation: 30,
      scaleX: 0.25,
      scaleY: 0.75,
      contentFlags: 4,
      surfaceFlags: 128,
      value: 9,
    };
    worldspawn.patches.push(terrain);

    const result = parseMapWithDiagnostics(serializeMap([worldspawn]));

    expect(result.diagnostics).toEqual([]);
    const loaded = result.document.entities[0].patches[0];
    expect(loaded.terrainDef).toBeDefined();
    expect(loaded.ctrl[1][1].xyz).toEqual([64, 64, 40]);
    expect(loaded.terrainDef!.surfaces[1][1]).toEqual({
      texture: 'textures/terrain/rock',
      offsetX: 3,
      offsetY: -5,
      rotation: 30,
      scaleX: 0.25,
      scaleY: 0.75,
      contentFlags: 4,
      surfaceFlags: 128,
      value: 9,
    });
  });
});

describe('map diagnostics', () => {
  test('reports and skips unsupported map blocks without losing later entities', () => {
    const source = `
{
"classname" "worldspawn"
{
brushDef
{
( 0 0 1 -64 ) ( ( 0.5 0 0 ) ( 0 0.5 0 ) ) common/caulk 0 0 0
}
}
}
{
"classname" "info_player_start"
"origin" "16 24 32"
}
`;

    const result = parseMapWithDiagnostics(source);

    expect(result.document.entities).toHaveLength(2);
    expect(result.document.entities[0].brushes).toHaveLength(0);
    expect(result.document.entities[1].classname).toBe('info_player_start');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning',
      line: 5,
      column: 1,
      message: expect.stringContaining("Unsupported map block 'brushDef'"),
    }));
    expect(result.warnings).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.unsupportedConstructs).toEqual([expect.objectContaining({
      keyword: 'brushDef',
      line: 5,
      column: 1,
      rawSource: expect.stringContaining('brushDef'),
    })]);
  });

  test('reports malformed brush content', () => {
    const result = parseMapWithDiagnostics(`
{
"classname" "worldspawn"
{
this is not a brush face
}
}
`);

    expect(result.document.entities).toHaveLength(1);
    expect(result.document.entities[0].brushes).toHaveLength(0);
    expect(result.diagnostics.some(diagnostic =>
      diagnostic.severity === 'warning' && diagnostic.message.includes('brush face')
    )).toBe(true);
    expect(result.diagnostics.some(diagnostic =>
      diagnostic.severity === 'warning' && diagnostic.message.includes('fewer than 4 valid faces')
    )).toBe(true);
  });

  test('reports structural errors with line and column', () => {
    const result = parseMapWithDiagnostics('{\n"classname" worldspawn\n}');

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual({
      severity: 'warning',
      line: 2,
      column: 13,
      message: "Ignored malformed entity property 'classname'",
    });
  });

  test('parses supported syntax without depending on line boundaries', () => {
    const source = `{ "classname" "worldspawn" {
      ( 0 0 0 ) ( 0 0 64 ) ( 0 64 0 ) common/caulk 0 0 0 0.5 0.5
      ( 64 0 0 ) ( 64 64 0 ) ( 64 0 64 ) common/caulk 0 0 0 0.5 0.5
      ( 0 0 0 ) ( 64 0 0 ) ( 0 0 64 ) common/caulk 0 0 0 0.5 0.5
      ( 0 64 0 ) ( 0 64 64 ) ( 64 64 0 ) common/caulk 0 0 0 0.5 0.5
      ( 0 0 0 ) ( 0 64 0 ) ( 64 0 0 ) common/caulk 0 0 0 0.5 0.5
      ( 0 0 64 ) ( 64 0 64 ) ( 0 64 64 ) common/caulk 0 0 0 0.5 0.5
    } }`;

    const result = parseMapWithDiagnostics(source);

    expect(result.diagnostics).toEqual([]);
    expect(result.document.entities[0].brushes[0].faces).toHaveLength(6);
  });

  test('round-trips escaped entity property strings', () => {
    const entity = createEntity('worldspawn');
    entity.properties.message = 'say "hello"\\world\nnext';

    const result = parseMapWithDiagnostics(serializeMap([entity]));

    expect(result.diagnostics).toEqual([]);
    expect(result.document.entities[0].properties.message).toBe(entity.properties.message);
  });
});
