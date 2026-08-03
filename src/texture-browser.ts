const COMMON_TEXTURES = [
  'common/caulk',
  'common/clip',
  'common/trigger',
  'common/nodraw',
  'base_wall/basewall03',
  'base_wall/basewall04',
  'base_wall/concrete',
  'base_floor/concrete',
  'base_floor/diamond2c',
  'base_floor/pjgrate1',
  'base_trim/pewter_shiney',
  'base_trim/dirty_pewter',
  'gothic_wall/iron01_e',
  'gothic_wall/skull4',
  'gothic_floor/blocks17floor',
  'gothic_trim/baseboard09',
  'skies/earthsky01',
];

function normalizedTextureName(texture: string): string {
  return texture.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '');
}

export function defaultTextureBrowserEntries(availableTextures: readonly string[]): string[] {
  const availableByName = new Map(
    availableTextures.map(texture => [normalizedTextureName(texture), texture]),
  );
  const commonTextures = COMMON_TEXTURES
    .map(texture => availableByName.get(normalizedTextureName(texture)))
    .filter((texture): texture is string => texture !== undefined);
  return commonTextures.length > 0 ? commonTextures : [...availableTextures];
}
