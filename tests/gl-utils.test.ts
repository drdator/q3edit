import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_LIGHT_AMBIENT,
  DYNAMIC_LIGHT_LIMIT,
  DYNAMIC_LIGHT_RADIUS_SCALE,
  effectiveDynamicLightRadius,
  selectDynamicLightInfluences,
} from '../src/dynamic-lighting';
import { FRAG_SRC } from '../src/gl-utils';

describe('viewport fragment shader', () => {
  it('uses a very dark ambient floor only for dynamic-light preview', () => {
    expect(DYNAMIC_LIGHT_AMBIENT).toBe(0.05);
    expect(FRAG_SRC).toContain('uniform float uDynamicLightingEnabled;');
    expect(FRAG_SRC).toContain('float baseLight = mix(diff, 0.05, uDynamicLightingEnabled);');
  });

  it('expands light intensity into the effective preview radius', () => {
    expect(DYNAMIC_LIGHT_RADIUS_SCALE).toBe(1.5);
    expect(effectiveDynamicLightRadius(300)).toBe(450);
    expect(effectiveDynamicLightRadius(0)).toBe(1.5);
  });

  it('supports a practical light set and chooses it by influence instead of map order', () => {
    expect(DYNAMIC_LIGHT_LIMIT).toBe(16);
    expect(FRAG_SRC).toContain('uniform vec3 uDynamicLightPos[16];');
    expect(FRAG_SRC).toContain('for (int i = 0; i < 16; i++)');

    const selected = selectDynamicLightInfluences([
      { value: 'far', origin: [1000, 0, 0], radius: 100 },
      { value: 'wide', origin: [600, 0, 0], radius: 1000 },
      { value: 'near', origin: [25, 0, 0], radius: 100 },
    ], [0, 0, 0], 2);

    expect(selected.map(light => light.value)).toEqual(['near', 'wide']);
  });
});
