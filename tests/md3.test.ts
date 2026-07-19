import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { AssetIndex } from '../src/asset-index';
import { EntityClassRegistry, parseQuakedDefinitions, setEntityClassRegistry } from '../src/entity-definitions';
import { createEntity } from '../src/entity';
import { decodeMd3, Md3Error } from '../src/md3';
import { ModelManager } from '../src/model-manager';
import { buildModelGeometry, transformedModelBounds } from '../src/model-geometry';
import { projectModelPreview } from '../src/model-browser';
import { createMinimalMd3 } from './fixtures/minimal-md3';

function archive(name: string, files: Record<string, Uint8Array>) {
  const zipped = zipSync(files);
  return { name, data: new Uint8Array(zipped).buffer };
}

describe('MD3 decoding', () => {
  it('decodes headers, frames, tags, surfaces, triangles, UVs, shaders, and compressed vertices', () => {
    const model = decodeMd3(createMinimalMd3());
    expect(model.name).toBe('minimal');
    expect(model.frames[0]).toMatchObject({ mins: [-1, -1, -1], maxs: [1, 1, 1], name: 'frame0' });
    expect(model.tags[0][0]).toMatchObject({ name: 'tag_weapon', origin: [0, 0, 0] });
    expect(model.surfaces[0].triangles).toEqual([[0, 1, 2]]);
    expect(model.surfaces[0].uvs).toEqual([[0, 0], [1, 0], [0, 1]]);
    expect(model.surfaces[0].frames[0][1].position).toEqual([1, 0, 0]);
    expect(model.surfaces[0].frames[0][0].normal[2]).toBeCloseTo(1);
    expect(projectModelPreview(model, 320, 240)).toHaveLength(3);
  });

  it('reports invalid, truncated, and oversized binary structures', () => {
    expect(() => decodeMd3(new Uint8Array(4))).toThrow(Md3Error);
    const truncated = createMinimalMd3().slice(0, 400);
    expect(() => decodeMd3(truncated)).toThrow(/extent|Truncated/);
    const oversized = createMinimalMd3();
    new DataView(oversized.buffer).setInt32(76, 2048, true);
    expect(() => decodeMd3(oversized)).toThrow(/frame count/);
  });
});

describe('ModelManager', () => {
  it('resolves definition models, frame policy, skin overrides, and shader fallback', () => {
    const registry = new EntityClassRegistry([]);
    registry.add(parseQuakedDefinitions('/*QUAKED custom (1 1 1) (-8 -8 -8) (8 8 8)\nmodel: path (default: models/test.md3)\n*/').classes[0]);
    setEntityClassRegistry(registry);
    const index = new AssetIndex([archive('models.pk3', {
      'models/test.md3': createMinimalMd3(),
      'models/red.skin': strToU8('body,textures/models/red\n'),
    })]);
    const manager = new ModelManager(index);
    const entity = createEntity('custom');
    entity.properties.frame = '99';
    entity.properties.skin = 'models/red.skin';
    const resolved = manager.resolveEntity(entity)!;
    expect(resolved.frame).toBe(0);
    expect(resolved.surfaceTextures.get('body')).toBe('textures/models/red');
    entity.properties.origin = '10 20 30';
    entity.properties.angle = '90';
    entity.properties.modelscale = '2';
    const geometry = buildModelGeometry(entity, resolved);
    expect(geometry[0].texture).toBe('textures/models/red');
    expect(geometry[0].vertices.slice(8, 11)).toEqual([10, 22, 30]);
    expect(transformedModelBounds(entity, resolved)).toEqual({ mins: [8, 18, 28], maxs: [12, 22, 32] });
    delete entity.properties.skin;
    expect(manager.resolveEntity(entity)?.surfaceTextures.get('body')).toBe('textures/models/default');
    setEntityClassRegistry(new EntityClassRegistry());
  });

  it('uses archive precedence and invalidates the decoded cache when its index changes', () => {
    const valid = archive('valid.pk3', { 'models/test.md3': createMinimalMd3() });
    const invalid = archive('invalid.pk3', { 'models/test.md3': strToU8('broken') });
    const manager = new ModelManager(new AssetIndex([invalid, valid]));
    expect(manager.get('models/test.md3')).not.toBeNull();
    manager.setAssetIndex(new AssetIndex([valid, invalid]));
    expect(manager.get('models/test.md3')).toBeNull();
    expect(manager.error('models/test.md3')).toBeInstanceOf(Error);
  });
});
