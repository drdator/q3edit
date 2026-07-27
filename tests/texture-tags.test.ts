import { describe, expect, test } from 'vitest';
import { textureSearchScore } from '../src/texture-search';
import {
  deleteTextureTag,
  listTextureTags,
  normalizeTextureTags,
  renameTextureTag,
  setTextureTags,
  textureTagsFor,
} from '../src/texture-tags';

describe('texture tags', () => {
  test('normalizes texture paths and de-duplicates user tags', () => {
    const tags = setTextureTags({}, 'Textures\\Base_Wall\\Metal', [' Rusty Metal ', 'rusty metal', 'Warm']);
    expect(textureTagsFor(tags, 'base_wall/metal')).toEqual(['rusty metal', 'warm']);
    expect(listTextureTags(tags)).toEqual(['rusty metal', 'warm']);
  });

  test('renames and deletes tags across texture paths', () => {
    const tags = normalizeTextureTags({
      'a/one': ['metal', 'warm'],
      'b/two': ['metal'],
    });
    const renamed = renameTextureTag(tags, 'metal', 'industrial');
    expect(textureTagsFor(renamed, 'a/one')).toEqual(['industrial', 'warm']);
    expect(textureTagsFor(deleteTextureTag(renamed, 'industrial'), 'b/two')).toEqual([]);
  });

  test('makes ordinary texture search tag-aware', () => {
    expect(textureSearchScore('base_wall/metal', 'rusty', null, [], ['rusty metal'])).toBeGreaterThan(0);
    expect(textureSearchScore('base_wall/metal', 'organic', null, [], ['rusty metal'])).toBeNull();
  });
});
