import { describe, expect, it } from 'vitest';
import { DYNAMIC_LIGHT_AMBIENT, FRAG_SRC } from '../src/gl-utils';

describe('viewport fragment shader', () => {
  it('uses a very dark ambient floor only for dynamic-light preview', () => {
    expect(DYNAMIC_LIGHT_AMBIENT).toBe(0.03);
    expect(FRAG_SRC).toContain('uniform float uDynamicLightingEnabled;');
    expect(FRAG_SRC).toContain('float baseLight = mix(diff, 0.03, uDynamicLightingEnabled);');
  });
});
