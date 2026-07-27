import type { Brush } from './brush';
import type { Entity } from './entity';
import { CONTENTS_DETAIL } from './map-flags';
import type { Patch } from './patch';

export type DisplayCategory =
  | 'entities' | 'lights' | 'paths' | 'world' | 'detail' | 'water'
  | 'clip' | 'hint' | 'caulk' | 'curves' | 'names' | 'angles'
  | 'coordinates' | 'dimensions' | 'blocks' | 'sky' | 'models'
  | 'triggers' | 'translucent' | 'decals' | 'pointEntities'
  | 'structural' | 'areaportals' | 'visportals' | 'clusterportals'
  | 'botclips' | 'funcGroups' | 'lightgrid' | 'lightRadii';
export type RendererMode = 'wireframe' | 'flat' | 'textured' | 'lightmap' | 'overdraw';
export type TextureFiltering = 'nearest' | 'linear' | 'trilinear';

export interface DisplayPreferences {
  categories: Record<DisplayCategory, boolean>;
  rendererMode: RendererMode;
  textureFiltering: TextureFiltering;
  dynamicLights: boolean;
}

export const DISPLAY_CATEGORIES: readonly DisplayCategory[] = [
  'entities', 'lights', 'paths', 'world', 'detail', 'water', 'clip', 'hint',
  'caulk', 'curves', 'names', 'angles', 'coordinates', 'dimensions', 'blocks',
  'sky', 'models', 'triggers', 'translucent', 'decals', 'pointEntities',
  'structural', 'areaportals', 'visportals', 'clusterportals', 'botclips',
  'funcGroups', 'lightgrid', 'lightRadii',
];

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  categories: {
    ...Object.fromEntries(DISPLAY_CATEGORIES.map(category => [category, true])),
    lightRadii: false,
  } as Record<DisplayCategory, boolean>,
  rendererMode: 'textured',
  textureFiltering: 'trilinear',
  dynamicLights: false,
};

const STORAGE_KEY = 'q3edit.display.v1';
const CONTENTS_WATER = 0x20;
const CONTENTS_PLAYERCLIP = 0x10000;
const CONTENTS_MONSTERCLIP = 0x20000;
const CONTENTS_AREAPORTAL = 0x8000;
const CONTENTS_CLUSTERPORTAL = 0x100000;
const CONTENTS_DONOTENTER = 0x200000;
const CONTENTS_TRANS = 0x20000000;
const CONTENTS_TRIGGER = 0x40000000;
const SURF_SKY = 0x4;
const SURF_HINT = 0x100;

export function loadDisplayPreferences(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): DisplayPreferences {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    if (!stored) return structuredClone(DEFAULT_DISPLAY_PREFERENCES);
    const parsed = JSON.parse(stored) as Partial<DisplayPreferences>;
    const categories = { ...DEFAULT_DISPLAY_PREFERENCES.categories };
    for (const category of DISPLAY_CATEGORIES) {
      if (typeof parsed.categories?.[category] === 'boolean') categories[category] = parsed.categories[category];
    }
    const rendererMode = ['wireframe', 'flat', 'textured', 'lightmap', 'overdraw'].includes(parsed.rendererMode ?? '')
      ? parsed.rendererMode as RendererMode : DEFAULT_DISPLAY_PREFERENCES.rendererMode;
    const textureFiltering = ['nearest', 'linear', 'trilinear'].includes(parsed.textureFiltering ?? '')
      ? parsed.textureFiltering as TextureFiltering : DEFAULT_DISPLAY_PREFERENCES.textureFiltering;
    return { categories, rendererMode, textureFiltering, dynamicLights: parsed.dynamicLights === true };
  } catch {
    return structuredClone(DEFAULT_DISPLAY_PREFERENCES);
  }
}

export function saveDisplayPreferences(preferences: DisplayPreferences, storage: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* persistence is optional */ }
}

function normalizedShader(name: string): string {
  return name.toLowerCase().replace(/^textures\//, '');
}

function shaderCategories(
  texture: string,
  contentFlags: number,
  surfaceFlags: number,
): Set<DisplayCategory> {
  const categories = new Set<DisplayCategory>();
  const shader = normalizedShader(texture);
  if ((contentFlags & CONTENTS_DETAIL) !== 0) categories.add('detail');
  else categories.add('structural');
  if ((contentFlags & CONTENTS_WATER) !== 0) categories.add('water');
  if ((contentFlags & (CONTENTS_PLAYERCLIP | CONTENTS_MONSTERCLIP)) !== 0) categories.add('clip');
  if ((contentFlags & CONTENTS_AREAPORTAL) !== 0) categories.add('areaportals');
  if ((contentFlags & CONTENTS_CLUSTERPORTAL) !== 0) categories.add('clusterportals');
  if ((contentFlags & CONTENTS_DONOTENTER) !== 0) categories.add('botclips');
  if ((contentFlags & CONTENTS_TRANS) !== 0) categories.add('translucent');
  if ((contentFlags & CONTENTS_TRIGGER) !== 0) categories.add('triggers');
  if ((surfaceFlags & SURF_SKY) !== 0) categories.add('sky');
  if ((surfaceFlags & SURF_HINT) !== 0) categories.add('hint');
  if (/^common\/(?:clip|weapclip|monsterclip)$/.test(shader)) categories.add('clip');
  if (/^common\/(?:hint|skip)$/.test(shader)) categories.add('hint');
  if (shader === 'common/areaportal') categories.add('areaportals');
  if (/^common\/(?:visportal|portal)$/.test(shader)) categories.add('visportals');
  if (shader === 'common/clusterportal') categories.add('clusterportals');
  if (/^common\/(?:botclip|donotenter)$/.test(shader)) categories.add('botclips');
  if (shader === 'common/trigger') categories.add('triggers');
  if (shader === 'common/lightgrid') categories.add('lightgrid');
  if (shader === 'common/caulk') categories.add('caulk');
  if (/(?:^|[/_])decals?(?:[/_]|$)/.test(shader)) categories.add('decals');
  if (/(?:^|\/)sky(?:s|_[^/]*)?(?:\/|$)/.test(shader)) categories.add('sky');
  return categories;
}

function materialCategories(brush: Brush): Set<DisplayCategory> {
  const categories = new Set<DisplayCategory>();
  for (const face of brush.faces) {
    for (const category of shaderCategories(face.texture, face.contentFlags, face.surfaceFlags)) {
      categories.add(category);
    }
  }
  return categories;
}

export function brushDisplayCategories(brush: Brush, entity?: Entity): Set<DisplayCategory> {
  const categories = materialCategories(brush);
  categories.add('blocks');
  if (entity?.classname === 'worldspawn') categories.add('world');
  if (entity && /^trigger_/i.test(entity.classname)) categories.add('triggers');
  if (entity?.classname === 'func_group') categories.add('funcGroups');
  return categories;
}

export function isBrushCategoryVisible(preferences: DisplayPreferences, brush: Brush, entity?: Entity): boolean {
  return [...brushDisplayCategories(brush, entity)].every(category => preferences.categories[category]);
}

export function isPatchCategoryVisible(preferences: DisplayPreferences, patch: Patch, entity?: Entity): boolean {
  const categories = shaderCategories(patch.texture, patch.contentFlags, patch.surfaceFlags);
  categories.add('curves');
  if (entity?.classname === 'worldspawn') categories.add('world');
  if (entity && /^trigger_/i.test(entity.classname)) categories.add('triggers');
  if (entity?.classname === 'func_group') categories.add('funcGroups');
  return [...categories].every(category => preferences.categories[category]);
}

export function isEntityCategoryVisible(preferences: DisplayPreferences, entity: Entity): boolean {
  if (entity.classname === 'worldspawn') return preferences.categories.world;
  if (entity.brushes.length || entity.patches.length) {
    if (entity.classname === 'func_group' && !preferences.categories.funcGroups) return false;
    if (/^trigger_/i.test(entity.classname) && !preferences.categories.triggers) return false;
    return true;
  }
  if (!preferences.categories.entities || !preferences.categories.pointEntities) return false;
  if (entity.classname === 'light' && !preferences.categories.lights) return false;
  if (/^(?:path_|target_)/i.test(entity.classname) && !preferences.categories.paths) return false;
  if ((entity.classname === 'misc_model' || !!entity.properties.model) && !preferences.categories.models) return false;
  if (/^trigger_/i.test(entity.classname) && !preferences.categories.triggers) return false;
  return true;
}

export function setDisplayCategory(preferences: DisplayPreferences, category: DisplayCategory, visible: boolean): void {
  preferences.categories[category] = visible;
  saveDisplayPreferences(preferences);
}

export function setAllDisplayCategories(preferences: DisplayPreferences, visible: boolean): void {
  for (const category of DISPLAY_CATEGORIES) preferences.categories[category] = visible;
  saveDisplayPreferences(preferences);
}

export function invertDisplayCategories(preferences: DisplayPreferences): void {
  for (const category of DISPLAY_CATEGORIES) {
    preferences.categories[category] = !preferences.categories[category];
  }
  saveDisplayPreferences(preferences);
}
