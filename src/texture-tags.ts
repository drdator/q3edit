export type TextureTagMap = Record<string, string[]>;

export function normalizeTextureName(name: string): string {
  return name.trim().toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '');
}

export function normalizeTextureTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 48);
}

export function normalizeTextureTags(value: unknown): TextureTagMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: TextureTagMap = {};
  for (const [texture, tags] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(tags)) continue;
    const textureName = normalizeTextureName(texture);
    if (!textureName) continue;
    const normalized = [...new Set(tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map(normalizeTextureTag)
      .filter(Boolean))].sort();
    if (normalized.length > 0) result[textureName] = normalized;
  }
  return result;
}

export function textureTagsFor(tags: TextureTagMap, texture: string): string[] {
  return tags[normalizeTextureName(texture)] ?? [];
}

export function setTextureTags(tags: TextureTagMap, texture: string, values: string[]): TextureTagMap {
  const result = normalizeTextureTags(tags);
  const key = normalizeTextureName(texture);
  if (!key) return result;
  const normalized = [...new Set(values.map(normalizeTextureTag).filter(Boolean))].sort();
  if (normalized.length > 0) result[key] = normalized;
  else delete result[key];
  return result;
}

export function listTextureTags(tags: TextureTagMap): string[] {
  return [...new Set(Object.values(tags).flat())].sort();
}

export function renameTextureTag(tags: TextureTagMap, from: string, to: string): TextureTagMap {
  const source = normalizeTextureTag(from);
  const target = normalizeTextureTag(to);
  if (!source || !target) return normalizeTextureTags(tags);
  return normalizeTextureTags(Object.fromEntries(Object.entries(tags).map(([texture, values]) => [
    texture,
    values.map(value => value === source ? target : value),
  ])));
}

export function deleteTextureTag(tags: TextureTagMap, tag: string): TextureTagMap {
  const target = normalizeTextureTag(tag);
  return normalizeTextureTags(Object.fromEntries(Object.entries(tags).map(([texture, values]) => [
    texture,
    values.filter(value => value !== target),
  ])));
}
