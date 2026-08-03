import { describe, expect, it } from 'vitest';
import { defaultTextureBrowserEntries } from '../src/texture-browser';

describe('default texture browser entries', () => {
  it('only shows common textures that exist in the active asset stack', () => {
    expect(defaultTextureBrowserEntries([
      'custom/wall',
      'Textures/Common/Caulk',
      'base_floor/diamond2c',
    ])).toEqual([
      'Textures/Common/Caulk',
      'base_floor/diamond2c',
    ]);
  });

  it('falls back to all available textures for a custom-only asset stack', () => {
    expect(defaultTextureBrowserEntries([
      'custom/floor',
      'custom/wall',
    ])).toEqual([
      'custom/floor',
      'custom/wall',
    ]);
  });

  it('shows no fake entries when the asset stack has no textures', () => {
    expect(defaultTextureBrowserEntries([])).toEqual([]);
  });
});
