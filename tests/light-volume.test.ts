import { describe, expect, it } from 'vitest';
import { createEntity } from '../src/entity';
import { lightVolumeSegments, resolveLightVolume } from '../src/light-volume';

describe('light volume display', () => {
  it('uses the dynamic-preview radius for point lights', () => {
    const light = createEntity('light', [10, 20, 30]);
    light.properties.light = '300';

    const volume = resolveLightVolume([light], light);

    expect(volume).toEqual({ kind: 'point', origin: [10, 20, 30], radius: 450 });
    expect(volume && lightVolumeSegments(volume, 12)).toHaveLength(36);
  });

  it('builds a cone for targeted spotlights', () => {
    const light = createEntity('light', [0, 0, 64]);
    light.properties.target = 'spot_target';
    light.properties.radius = '48';
    const target = createEntity('target_position', [128, 0, 0]);
    target.properties.targetname = 'spot_target';

    const volume = resolveLightVolume([light, target], light);
    const segments = volume ? lightVolumeSegments(volume, 16) : [];

    expect(volume).toEqual({
      kind: 'spot',
      origin: [0, 0, 64],
      target: [128, 0, 0],
      targetRadius: 48,
    });
    expect(segments).toHaveLength(24);
    expect(segments.slice(16).every(([from]) => from === volume?.origin)).toBe(true);
  });

  it('falls back to a point volume when a spotlight target is unresolved', () => {
    const light = createEntity('light', [0, 0, 0]);
    light.properties.target = 'missing';

    expect(resolveLightVolume([light], light)).toEqual({
      kind: 'point',
      origin: [0, 0, 0],
      radius: 450,
    });
  });
});
