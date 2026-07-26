import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMapWithDiagnostics, serializeMap } from '../src/mapfile';

const complexMap = readFileSync(
  new URL('./fixtures/compatibility/openarena-dm17ish.map', import.meta.url),
  'utf8',
);
const radiantFixtures = [
  'gtkradiant-patch-seam.map',
  'netradiant-coarse-snap.map',
].map(name => ({
  name,
  source: readFileSync(new URL(`./fixtures/compatibility/${name}`, import.meta.url), 'utf8'),
}));
const expectedInventory = {
  'openarena-dm17ish.map': { entities: 162, brushes: 211, patches: 47, warnings: 0, unsupported: 0 },
  'gtkradiant-patch-seam.map': { entities: 3, brushes: 6, patches: 2, warnings: 0, unsupported: 0 },
  'netradiant-coarse-snap.map': { entities: 3, brushes: 9, patches: 0, warnings: 0, unsupported: 0 },
} as const;

function inventory(source: string) {
  const result = parseMapWithDiagnostics(source);
  return {
    entities: result.document.entities.length,
    brushes: result.document.entities.reduce((sum, entity) => sum + entity.brushes.length, 0),
    patches: result.document.entities.reduce((sum, entity) => sum + entity.patches.length, 0),
    warnings: result.warnings.length,
    unsupported: result.unsupportedConstructs.length,
  };
}

function signature(source: string) {
  const result = parseMapWithDiagnostics(source);
  return {
    classes: result.document.entities.map(entity => entity.classname),
    properties: result.document.entities.map(entity => entity.properties),
    brushFaces: result.document.entities.map(entity => entity.brushes.map(brush =>
      brush.faces.map(face => ({
        texture: face.texture,
        projection: face.textureProjection,
        contentFlags: face.contentFlags,
        surfaceFlags: face.surfaceFlags,
        value: face.value,
      })))),
    patches: result.document.entities.map(entity => entity.patches.map(patch => ({
      width: patch.width,
      height: patch.height,
      texture: patch.texture,
      ctrl: patch.ctrl,
    }))),
  };
}

describe('independently sourced complex-map compatibility', () => {
  it('parses and structurally round-trips the OpenArena dm17ish source map', () => {
    const first = parseMapWithDiagnostics(complexMap);
    expect(first.errors).toEqual([]);
    expect(inventory(complexMap)).toEqual(expectedInventory['openarena-dm17ish.map']);

    const normalized = serializeMap(first.document.entities);
    expect(signature(normalized)).toEqual(signature(complexMap));
    expect(parseMapWithDiagnostics(normalized).errors).toEqual([]);
  });

  it('keeps independently sourced source bytes unchanged until an edit occurs', () => {
    const first = parseMapWithDiagnostics(complexMap);
    expect(first.unsupportedConstructs).toEqual([]);
    expect(complexMap).toContain('// entity 0');
  });

  it.each(radiantFixtures)('round-trips $name without parse errors', ({ name, source }) => {
    const first = parseMapWithDiagnostics(source);
    expect(first.errors).toEqual([]);
    expect(inventory(source)).toEqual(expectedInventory[name as keyof typeof expectedInventory]);
    const normalized = serializeMap(first.document.entities);
    expect(parseMapWithDiagnostics(normalized).errors).toEqual([]);
    expect(signature(normalized)).toEqual(signature(source));
  });
});
