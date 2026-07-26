import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { AssetIndex } from '../src/asset-index';
import { createBoxBrush } from '../src/brush';
import { createEntity } from '../src/entity';
import { buildReleasePackage, scanProjectAssets, serializeArena } from '../src/release-package';

function archive(name: string, files: Record<string, string>) {
  return { name, data: new Uint8Array(zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])))).buffer };
}

function textureAdapter(index: AssetIndex) {
  return {
    getShaderSourcePath: (name: string) => name === 'custom/wall' ? 'scripts/custom.shader' : null,
    getShaderMetadata: () => ({ referencedImages: ['textures/custom/wall.tga'], sky: null, semantics: { sky: false } }),
    findImageFile: () => null,
  } as never;
}

describe('release packaging', () => {
  it('audits sources, licensing, duplicates, and unused assets', () => {
    const assets = new AssetIndex([
      archive('custom.pk3', {
        'scripts/custom.shader': 'custom/wall {}',
        'textures/custom/wall.tga': 'image',
        'textures/custom/unused.tga': 'unused',
        'COPYING': 'redistributable',
      }),
      archive('override.pk3', { 'textures/custom/wall.tga': 'override', 'LICENSE.txt': 'ok' }),
    ]);
    const world = createEntity('worldspawn');
    world.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64], 'custom/wall'));
    const manifest = scanProjectAssets([world], assets, textureAdapter(assets));
    expect(manifest.missing).toEqual([]);
    expect(manifest.ambiguous.map(item => item.resolvedPath)).toContain('textures/custom/wall.tga');
    expect(manifest.unusedProjectAssets).toContainEqual({ path: 'textures/custom/unused.tga', archive: 'custom.pk3' });
  });

  it('builds deterministic package contents and typed arena metadata', () => {
    const assets = new AssetIndex([archive('custom.pk3', {
      'scripts/custom.shader': 'custom/wall {}',
      'textures/custom/wall.tga': 'image',
      'COPYING': 'redistributable',
    })]);
    const world = createEntity('worldspawn');
    world.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64], 'custom/wall'));
    const input = {
      mapName: 'test_map', bsp: strToU8('bsp'), aas: strToU8('aas'), entities: [world],
      assets, textures: textureAdapter(assets),
      metadata: { title: 'Test Arena', gameTypes: ['ffa', 'team'], botSupport: true, recommendedPlayers: '2-4', author: 'Mapper', description: 'Test' },
      levelshot: strToU8('png'), files: { readme: 'read me' },
    };
    const first = buildReleasePackage(input);
    const second = buildReleasePackage(input);
    expect(first.pk3).toEqual(second.pk3);
    const files = unzipSync(first.pk3);
    expect(Object.keys(files)).toEqual([...Object.keys(files)].sort((a, b) => a.localeCompare(b)));
    expect(files['maps/test_map.bsp']).toBeTruthy();
    expect(files['scripts/test_map.arena']).toBeTruthy();
    expect(files['textures/custom/wall.tga']).toBeTruthy();
    expect(first.report.archiveValidation.valid).toBe(true);
    expect(serializeArena('test_map', input.metadata)).toContain('type "ffa team"');
  });

  it('never packages base-game archives even when they contain a license file', () => {
    const assets = new AssetIndex([archive('pak0.pk3', {
      'textures/base/wall.tga': 'image',
      'COPYING': 'base game license',
    })]);
    const world = createEntity('worldspawn');
    world.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64], 'base/wall'));
    const textures = {
      getShaderSourcePath: () => null,
      getShaderMetadata: () => null,
      findImageFile: () => ['textures/base/wall.tga', strToU8('image')],
    } as never;
    const result = buildReleasePackage({
      mapName: 'base_test', bsp: strToU8('bsp'), entities: [world], assets, textures,
      metadata: { title: '', gameTypes: ['ffa'], botSupport: false, recommendedPlayers: '', author: '', description: '' },
    });
    expect(result.report.manifest.dependencies[0].disposition).toBe('base-game');
    expect(unzipSync(result.pk3)['textures/base/wall.tga']).toBeUndefined();
  });

  it('includes both music tracks and materials referenced by skins', () => {
    const assets = new AssetIndex([archive('custom.pk3', {
      'models/custom/object.md3': 'not needed for skin parsing',
      'models/custom/object.skin': 'body,textures/custom/body',
      'textures/custom/body.tga': 'image',
      'sound/music/intro.ogg': 'intro',
      'sound/music/loop.ogg': 'loop',
      'COPYING': 'redistributable',
    })]);
    const entity = createEntity('misc_model');
    entity.properties.model = 'models/custom/object.md3';
    entity.properties.skin = 'models/custom/object.skin';
    entity.properties.music = 'music/intro.ogg music/loop.ogg';
    const textures = {
      getShaderSourcePath: () => null,
      getShaderMetadata: () => null,
      findImageFile: (name: string) => name === 'textures/custom/body'
        ? ['textures/custom/body.tga', strToU8('image')]
        : null,
    } as never;
    const manifest = scanProjectAssets([entity], assets, textures);
    expect(manifest.dependencies.map(item => item.resolvedPath)).toEqual(expect.arrayContaining([
      'models/custom/object.skin',
      'textures/custom/body.tga',
      'sound/music/intro.ogg',
      'sound/music/loop.ogg',
    ]));
  });

  it('blocks missing and unlicensed dependencies by default', () => {
    const assets = new AssetIndex([archive('custom.pk3', { 'textures/custom/wall.tga': 'image' })]);
    const world = createEntity('worldspawn');
    world.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64], 'custom/wall'));
    const textures = {
      getShaderSourcePath: () => null, getShaderMetadata: () => null,
      findImageFile: () => ['textures/custom/wall.tga', strToU8('image')],
    } as never;
    expect(() => buildReleasePackage({
      mapName: 'test', bsp: strToU8('bsp'), entities: [world], assets, textures,
      metadata: { title: '', gameTypes: ['ffa'], botSupport: false, recommendedPlayers: '', author: '', description: '' },
    })).toThrow(/redistribution license/i);
  });
});
