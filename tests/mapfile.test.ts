import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createEntity } from '../src/entity';
import { createBoxBrush } from '../src/brush';
import { parseMap, parseMapWithDiagnostics, serializeMap } from '../src/mapfile';
import { createFlatPatch, createTerrainDefGridPatch } from '../src/patch';

const classicBrushFixture = readFileSync(
  new URL('./fixtures/classic-brush.map', import.meta.url),
  'utf8',
);
const brushDefFixture = readFileSync(
  new URL('./fixtures/brushdef.map', import.meta.url),
  'utf8',
);
const terrainFixture = readFileSync(
  new URL('./fixtures/q3radiant-terrain.map', import.meta.url),
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
        textureProjection: {
          kind: 'classic',
          offsetX: 4,
          offsetY: -8,
          rotation: 15,
          scaleX: 0.25,
          scaleY: 0.5,
        },
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
      textureProjection: face.textureProjection,
      contentFlags: face.contentFlags,
      surfaceFlags: face.surfaceFlags,
      value: face.value,
    }))).toEqual(first[0].brushes[0].faces.map(face => ({
      points: face.points,
      texture: face.texture,
      textureProjection: face.textureProjection,
      contentFlags: face.contentFlags,
      surfaceFlags: face.surfaceFlags,
      value: face.value,
    })));
  });
});

describe('patch map formats', () => {
  test('round-trips a Q3Radiant terrainDef syntax fixture losslessly', () => {
    const first = parseMapWithDiagnostics(terrainFixture);
    expect(first.diagnostics).toEqual([]);
    const original = first.document.entities[0].patches[0];
    const second = parseMapWithDiagnostics(serializeMap(first.document.entities));
    const loaded = second.document.entities[0].patches[0];
    expect(second.diagnostics).toEqual([]);
    expect(loaded.ctrl).toEqual(original.ctrl);
    expect(loaded.terrainDef).toEqual(original.terrainDef);
  });

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

  test('produces compiler-safe output without editor metadata or patch group epairs', () => {
    const worldspawn = createEntity('worldspawn');
    worldspawn.properties._q3edit_style_brief = JSON.stringify({ notes: 'x'.repeat(12_000) });
    worldspawn.properties._q3edit_spatial_plan = JSON.stringify({ areas: Array.from({ length: 50 }, (_, id) => ({ id })) });
    const patch = createFlatPatch([0, 0, 0], [128, 128, 32], 'base_wall/concrete');
    patch.editorGroupId = 'arches';
    patch.properties = { _q3edit_internal: 'editor only' };
    worldspawn.patches.push(patch);
    const group = createEntity('group_info');
    group.properties._q3edit_group_id = 'arches';
    group.properties.group = 'Gothic Arches';

    const editable = serializeMap([worldspawn, group]);
    const patchBlock = editable.slice(editable.indexOf('patchDef2'), editable.indexOf('// entity 1'));
    expect(editable).toContain('_q3edit_style_brief');
    expect(editable).toContain('// q3edit-group arches');
    expect(patchBlock).not.toContain('"group" "Gothic Arches"');

    const compilerSafe = serializeMap([worldspawn, group], { compilerSafe: true });
    expect(compilerSafe).not.toContain('_q3edit_');
    expect(compilerSafe).not.toContain('group_info');
    expect(compilerSafe).not.toContain('q3edit-group');
    expect(compilerSafe).not.toContain('editor only');
    expect(Math.max(...compilerSafe.split('\n').map(line => line.length))).toBeLessThan(4096);
    expect(parseMapWithDiagnostics(compilerSafe).diagnostics).toEqual([]);
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

  test('rejects a non-regular terrain lattice instead of silently changing format', () => {
    const worldspawn = createEntity('worldspawn');
    const terrain = createTerrainDefGridPatch([0, 0, 0], [128, 128, 16], 'terrain/base', 3, 3);
    terrain.ctrl[1][1].xyz[0] += 4;
    worldspawn.patches.push(terrain);

    expect(() => serializeMap([worldspawn])).toThrow(/Convert it to patchDef2 explicitly/);
  });
});

describe('map diagnostics', () => {
  test('loads and round-trips a Q3Radiant brushDef fixture', () => {
    const result = parseMapWithDiagnostics(brushDefFixture);

    expect(result.document.entities).toHaveLength(1);
    expect(result.document.entities[0].brushes).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.unsupportedConstructs).toEqual([]);
    const brush = result.document.entities[0].brushes[0];
    expect(brush.properties).toEqual({ editor_note: 'primitive cube' });
    expect(brush.faces).toHaveLength(6);
    for (const face of brush.faces) {
      expect(face.textureProjection).toEqual({
        kind: 'brush-primitive',
        matrix: [[0.0078125, 0, 0.125], [0, 0.015625, -0.25]],
      });
      expect(face).toMatchObject({
        texture: 'textures/common/caulk',
        contentFlags: 134217728,
        surfaceFlags: 1024,
        value: 7,
      });
    }

    const roundTripped = parseMapWithDiagnostics(serializeMap(result.document.entities));
    expect(roundTripped.diagnostics).toEqual([]);
    expect(roundTripped.document.entities[0].brushes[0]).toMatchObject({
      properties: brush.properties,
      faces: brush.faces.map(face => ({
        texture: face.texture,
        textureProjection: face.textureProjection,
        contentFlags: face.contentFlags,
        surfaceFlags: face.surfaceFlags,
        value: face.value,
      })),
    });
  });

  test('reports and skips unsupported map blocks without losing later entities', () => {
    const source = `
{
"classname" "worldspawn"
{
brushDef3
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
      message: expect.stringContaining("Unsupported map block 'brushDef3'"),
    }));
    expect(result.warnings).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.unsupportedConstructs).toEqual([expect.objectContaining({
      keyword: 'brushDef3',
      line: 5,
      column: 1,
      rawSource: expect.stringContaining('brushDef'),
    })]);
  });

  test('rejects mixed projection formats instead of silently converting them', () => {
    const entity = createEntity('worldspawn');
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    brush.faces[0].textureProjection = {
      kind: 'brush-primitive',
      matrix: [[0.01, 0, 0], [0, 0.01, 0]],
    };
    entity.brushes.push(brush);

    expect(() => serializeMap([entity])).toThrow('mixed classic and brush-primitive projections');
  });

  test('preserves separate classic and brush-primitive brushes in one map', () => {
    const entity = createEntity('worldspawn');
    const classic = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const primitive = createBoxBrush([80, 0, 0], [144, 64, 64]);
    for (const face of primitive.faces) {
      face.textureProjection = {
        kind: 'brush-primitive',
        matrix: [[1 / 128, 0, 0], [0, 1 / 128, 0]],
      };
    }
    entity.brushes.push(classic, primitive);

    const result = parseMapWithDiagnostics(serializeMap([entity]));

    expect(result.diagnostics).toEqual([]);
    expect(result.document.entities[0].brushes.map(brush => brush.faces[0].textureProjection.kind))
      .toEqual(['classic', 'brush-primitive']);
  });

  test('reports malformed brushDef matrices at their source location', () => {
    const source = `{\n"classname" "worldspawn"\n{\nbrushDef\n{\n( 0 0 0 ) ( 0 0 64 ) ( 0 64 0 ) ( ( nope 0 0 ) ( 0 1 0 ) ) common/caulk 0 0 0\n}\n}\n}`;
    const result = parseMapWithDiagnostics(source);

    expect(result.errors).toContainEqual(expect.objectContaining({
      line: 6,
      column: 37,
      message: expect.stringContaining('brushDef texture matrix row 1'),
    }));
    expect(result.document.entities[0].brushes).toEqual([]);
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
