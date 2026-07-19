import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { AssetIndex, classifyAsset, normalizeAssetPath } from '../src/asset-index';

function archive(name: string, files: Record<string, string>) {
  const zipped = zipSync(Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, strToU8(value)]),
  ));
  return { name, data: new Uint8Array(zipped).buffer };
}

describe('AssetIndex', () => {
  it('normalizes paths once while retaining the original winning path', () => {
    const index = new AssetIndex([archive('base.pk3', {
      'Textures\\Gothic/WALL.TGA': 'pixels',
    })]);

    expect(normalizeAssetPath('/TEXTURES//Gothic/wall.tga')).toBe('textures/gothic/wall.tga');
    expect(index.get('textures/gothic/WALL.tga')).toMatchObject({
      path: 'Textures/Gothic/WALL.TGA',
      normalizedPath: 'textures/gothic/wall.tga',
      kind: 'image',
    });
    expect(new TextDecoder().decode(index.readBytes('TEXTURES/GOTHIC/wall.tga')!)).toBe('pixels');
  });

  it('uses later archives and later case variants while retaining override provenance', () => {
    const index = new AssetIndex([
      archive('pak0.pk3', { 'textures/common/a.tga': 'base' }),
      archive('pak1.pk3', { 'Textures/Common/A.TGA': 'override' }),
    ]);

    const winner = index.get('textures/common/a.tga')!;
    expect(winner.source.archiveName).toBe('pak1.pk3');
    expect(winner.overriddenSources.map(source => source.archiveName)).toEqual(['pak0.pk3']);
    expect(new TextDecoder().decode(index.readBytes(winner.path)!)).toBe('override');
  });

  it('honors archive order and disabled archives when rebuilt', () => {
    const low = archive('low.pk3', { 'scripts/entities.def': 'low' });
    const high = archive('high.pk3', { 'scripts/entities.def': 'high' });
    const index = new AssetIndex([low, high]);
    expect(index.readText('scripts/entities.def')).toBe('high');

    index.setArchives([high, low]);
    expect(index.readText('scripts/entities.def')).toBe('low');

    index.setArchives([low, { ...high, enabled: false }]);
    expect(index.readText('scripts/entities.def')).toBe('low');
    expect(index.archiveCount).toBe(1);
  });

  it('provides typed winning-asset queries for future consumers', () => {
    const index = new AssetIndex([archive('assets.pk3', {
      'textures/a.jpg': 'image',
      'scripts/base.shader': 'shader',
      'models/mapobjects/tree.md3': 'model',
      'models/mapobjects/tree.skin': 'skin',
      'scripts/entities.def': 'entities',
      'maps/q3dm1.map': 'map',
      'sound/world/hum.wav': 'binary',
    })]);

    expect(index.images()).toHaveLength(1);
    expect(index.shaders()).toHaveLength(1);
    expect(index.models()).toHaveLength(1);
    expect(index.skins()).toHaveLength(1);
    expect(index.entityDefinitions()).toHaveLength(1);
    expect(index.maps()).toHaveLength(1);
    expect(classifyAsset('sound/world/hum.wav')).toBe('binary');
    expect(index.list('binary')).toHaveLength(1);
  });

  it('rejects unsafe paths and enforces archive and decoded-entry limits', () => {
    const packed = archive('limits.pk3', {
      '../escape.txt': 'bad',
      'models/large.md3': '12345',
    });
    expect(() => new AssetIndex([packed], { maxArchiveBytes: 1 })).toThrow(/archive limit/);
    const index = new AssetIndex([packed], { maxEntryBytes: 4 });
    expect(index.get('../escape.txt')).toBeNull();
    expect(() => index.readBytes('models/large.md3')).toThrow(/decoded-entry limit/);
  });
});
