import type { Brush } from './brush';
import type { Entity } from './entity';
import { CONTENTS_DETAIL } from './map-flags';
import type { Patch } from './patch';

export type DisplayCategory =
  | 'entities' | 'lights' | 'paths' | 'world' | 'detail' | 'water'
  | 'clip' | 'hint' | 'caulk' | 'curves' | 'names' | 'angles'
  | 'coordinates' | 'blocks';
export type RendererMode = 'wireframe' | 'flat' | 'textured';
export type TextureFiltering = 'nearest' | 'linear' | 'trilinear';

export interface DisplayPreferences {
  categories: Record<DisplayCategory, boolean>;
  rendererMode: RendererMode;
  textureFiltering: TextureFiltering;
  dynamicLights: boolean;
}

export const DISPLAY_CATEGORIES: readonly DisplayCategory[] = [
  'entities', 'lights', 'paths', 'world', 'detail', 'water', 'clip', 'hint',
  'caulk', 'curves', 'names', 'angles', 'coordinates', 'blocks',
];

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  categories: Object.fromEntries(DISPLAY_CATEGORIES.map(category => [category, true])) as Record<DisplayCategory, boolean>,
  rendererMode: 'textured',
  textureFiltering: 'trilinear',
  dynamicLights: false,
};

const STORAGE_KEY = 'q3edit.display.v1';
const CONTENTS_WATER = 0x20;
const CONTENTS_PLAYERCLIP = 0x10000;
const CONTENTS_MONSTERCLIP = 0x20000;
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
    const rendererMode = ['wireframe', 'flat', 'textured'].includes(parsed.rendererMode ?? '')
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

function materialCategories(brush: Brush): Set<DisplayCategory> {
  const categories = new Set<DisplayCategory>();
  for (const face of brush.faces) {
    if ((face.contentFlags & CONTENTS_DETAIL) !== 0) categories.add('detail');
    if ((face.contentFlags & CONTENTS_WATER) !== 0) categories.add('water');
    if ((face.contentFlags & (CONTENTS_PLAYERCLIP | CONTENTS_MONSTERCLIP)) !== 0) categories.add('clip');
    if ((face.surfaceFlags & SURF_HINT) !== 0) categories.add('hint');
    const shader = face.texture.toLowerCase().replace(/^textures\//, '');
    if (/^common\/(?:clip|weapclip|monsterclip)$/.test(shader)) categories.add('clip');
    if (/^common\/(?:hint|skip)$/.test(shader)) categories.add('hint');
    if (shader === 'common/caulk') categories.add('caulk');
  }
  return categories;
}

export function brushDisplayCategories(brush: Brush, entity?: Entity): Set<DisplayCategory> {
  const categories = materialCategories(brush);
  categories.add('blocks');
  if (entity?.classname === 'worldspawn') categories.add('world');
  return categories;
}

export function isBrushCategoryVisible(preferences: DisplayPreferences, brush: Brush, entity?: Entity): boolean {
  return [...brushDisplayCategories(brush, entity)].every(category => preferences.categories[category]);
}

export function isPatchCategoryVisible(preferences: DisplayPreferences, patch: Patch, entity?: Entity): boolean {
  if (!preferences.categories.curves) return false;
  if (entity?.classname === 'worldspawn' && !preferences.categories.world) return false;
  if ((patch.contentFlags & CONTENTS_DETAIL) !== 0 && !preferences.categories.detail) return false;
  if ((patch.contentFlags & CONTENTS_WATER) !== 0 && !preferences.categories.water) return false;
  return true;
}

export function isEntityCategoryVisible(preferences: DisplayPreferences, entity: Entity): boolean {
  if (entity.classname === 'worldspawn') return preferences.categories.world;
  if (entity.brushes.length || entity.patches.length) return true;
  if (!preferences.categories.entities) return false;
  if (entity.classname === 'light' && !preferences.categories.lights) return false;
  if (/^(?:path_|target_)/i.test(entity.classname) && !preferences.categories.paths) return false;
  return true;
}

export function setDisplayCategory(preferences: DisplayPreferences, category: DisplayCategory, visible: boolean): void {
  preferences.categories[category] = visible;
  saveDisplayPreferences(preferences);
}
