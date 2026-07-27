import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import {
  brushDisplayCategories,
  DEFAULT_DISPLAY_PREFERENCES,
  invertDisplayCategories,
  isBrushCategoryVisible,
  isEntityCategoryVisible,
  isPatchCategoryVisible,
  loadDisplayPreferences,
  saveDisplayPreferences,
  setAllDisplayCategories,
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

  it('classifies extended material and portal filters from flags and shader names', () => {
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'textures/base/wall');
    brush.faces[0].texture = 'textures/skies/space';
    brush.faces[0].surfaceFlags = 0x4;
    brush.faces[1].texture = 'textures/decals/sign';
    brush.faces[1].contentFlags = 0x20000000;
    brush.faces[2].texture = 'common/areaportal';
    brush.faces[2].contentFlags = 0x8000;
    brush.faces[3].texture = 'common/clusterportal';
    brush.faces[3].contentFlags = 0x100000;
    brush.faces[4].texture = 'common/botclip';
    brush.faces[4].contentFlags = 0x200000;
    brush.faces[5].texture = 'common/lightgrid';
    const categories = brushDisplayCategories(brush);

    expect([...categories]).toEqual(expect.arrayContaining([
      'sky', 'decals', 'translucent', 'areaportals', 'clusterportals',
      'botclips', 'lightgrid', 'structural', 'blocks',
    ]));
  });

  it('filters point entities, models, triggers, and func_groups independently', () => {
    const preferences = structuredClone(DEFAULT_DISPLAY_PREFERENCES);
    const model = createEntity('misc_model');
    model.properties.model = 'models/mapobjects/test.md3';
    preferences.categories.models = false;
    expect(isEntityCategoryVisible(preferences, model)).toBe(false);
    preferences.categories.models = true;
    preferences.categories.pointEntities = false;
    expect(isEntityCategoryVisible(preferences, model)).toBe(false);

    const trigger = createEntity('trigger_multiple');
    trigger.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64]));
    preferences.categories.pointEntities = true;
    preferences.categories.triggers = false;
    expect(isEntityCategoryVisible(preferences, trigger)).toBe(false);
    expect(isBrushCategoryVisible(preferences, trigger.brushes[0], trigger)).toBe(false);

    const group = createEntity('func_group');
    group.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64]));
    preferences.categories.triggers = true;
    preferences.categories.funcGroups = false;
    expect(isBrushCategoryVisible(preferences, group.brushes[0], group)).toBe(false);
  });

  it('inverts and resets every display filter', () => {
    const preferences = structuredClone(DEFAULT_DISPLAY_PREFERENCES);
    const before = { ...preferences.categories };
    invertDisplayCategories(preferences);
    for (const [category, visible] of Object.entries(before)) {
      expect(preferences.categories[category as keyof typeof preferences.categories]).toBe(!visible);
    }
    setAllDisplayCategories(preferences, true);
    expect(Object.values(preferences.categories).every(Boolean)).toBe(true);
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

  it('enables newly introduced display categories for existing preferences', () => {
    const serialized = JSON.stringify({
      categories: { entities: false },
      rendererMode: 'textured',
      textureFiltering: 'trilinear',
    });
    const storage = { getItem: () => serialized };

    const preferences = loadDisplayPreferences(storage);

    expect(preferences.categories.entities).toBe(false);
    expect(preferences.categories.dimensions).toBe(true);
    expect(preferences.categories.lightRadii).toBe(false);
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
