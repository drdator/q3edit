import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  isBrushCategoryVisible,
  isEntityCategoryVisible,
  isPatchCategoryVisible,
  loadDisplayPreferences,
  saveDisplayPreferences,
} from '../src/display-policy';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { CONTENTS_DETAIL } from '../src/map-flags';
import { createFlatPatch } from '../src/patch';

describe('display policy', () => {
  it('classifies world, block, detail, water, clip, hint, and caulk independently', () => {
    const preferences = structuredClone(DEFAULT_DISPLAY_PREFERENCES);
    const world = createEntity('worldspawn');
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'common/caulk');
    brush.faces[0].contentFlags = CONTENTS_DETAIL | 0x20 | 0x10000;
    brush.faces[0].surfaceFlags = 0x100;
    for (const category of ['world', 'blocks', 'detail', 'water', 'clip', 'hint', 'caulk'] as const) {
      preferences.categories[category] = false;
      expect(isBrushCategoryVisible(preferences, brush, world), category).toBe(false);
      preferences.categories[category] = true;
    }
  });

  it('keeps entity, light, path, and curve categories independent', () => {
    const preferences = structuredClone(DEFAULT_DISPLAY_PREFERENCES);
    const light = createEntity('light');
    const path = createEntity('path_corner');
    preferences.categories.lights = false;
    expect(isEntityCategoryVisible(preferences, light)).toBe(false);
    expect(isEntityCategoryVisible(preferences, path)).toBe(true);
    preferences.categories.lights = true;
    preferences.categories.paths = false;
    expect(isEntityCategoryVisible(preferences, path)).toBe(false);
    const patch = createFlatPatch([0, 0, 0], [64, 64, 0], 'textures/test');
    preferences.categories.curves = false;
    expect(isPatchCategoryVisible(preferences, patch)).toBe(false);
  });

  it('persists validated renderer and category preferences', () => {
    let serialized: string | null = null;
    const storage = {
      getItem: () => serialized,
      setItem: (_key: string, value: string) => { serialized = value; },
    };
    const preferences = structuredClone(DEFAULT_DISPLAY_PREFERENCES);
    preferences.categories.entities = false;
    preferences.rendererMode = 'flat';
    preferences.textureFiltering = 'nearest';
    preferences.dynamicLights = true;
    saveDisplayPreferences(preferences, storage);
    expect(loadDisplayPreferences(storage)).toEqual(preferences);
  });

  it('keeps hidden-category selections selected but non-interactive', () => {
    const editor = new Editor();
    const world = createEntity('worldspawn');
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    world.brushes.push(brush); editor.entities = [world]; editor.selectBrush(world, brush);
    editor.toggleDisplayCategory('blocks');
    expect(editor.selection).toHaveLength(1);
    expect(editor.isBrushVisible(brush, world)).toBe(false);
    editor.toggleDisplayCategory('blocks');
    expect(editor.isBrushVisible(brush, world)).toBe(true);
  });
});
