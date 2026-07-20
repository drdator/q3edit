import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_LIGHT_AMBIENT,
  DYNAMIC_LIGHT_RADIUS_SCALE,
  effectiveDynamicLightRadius,
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
});
