import { describe, expect, test } from 'vitest';
import { textureSearchScore } from '../src/texture-search';

describe('MCP texture search ranking', () => {
  test('matches unordered and separator-free query tokens', () => {
    expect(textureSearchScore('common/sky_space', 'space sky', { sky: true }, ['sky'])).toBeGreaterThan(0);
    expect(textureSearchScore('sfx/jumppad', 'jump pad', null, [])).toBeGreaterThan(0);
  });

  test('matches semantic terms and rejects partial token sets', () => {
    expect(textureSearchScore('custom/void', 'sky', { sky: true }, ['sky'])).toBeGreaterThan(0);
    expect(textureSearchScore('common/sky_space', 'space lava', { sky: true }, ['sky'])).toBeNull();
  });
});
