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
    expect(first.report.isolatedValidation.valid).toBe(true);
    expect(serializeArena('test_map', input.metadata)).toContain('type "ffa team"');
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
