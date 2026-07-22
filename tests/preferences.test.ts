import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GLOBAL_PREFERENCES,
  LEGACY_DISPLAY_STORAGE_KEY,
  PREFERENCES_STORAGE_KEY,
  importGlobalPreferences,
  loadGlobalPreferences,
  saveGlobalPreferences,
} from '../src/preferences';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('global preferences', () => {
  it('round-trips versioned preferences and normalizes invalid values', () => {
    const storage = new MemoryStorage();
    const preferences = structuredClone(DEFAULT_GLOBAL_PREFERENCES);
    preferences.editorDefaults.gridSize = 999;
    preferences.shortcuts['file.save'] = 'Ctrl+Shift+S';
    preferences.collapsedPanels['entity-panel'] = true;
    preferences.sidebar = { visible: false, width: 420 };
    preferences.mcpActivity = { visible: true, height: 360 };
    preferences.quickPlay = { quality: 'full', botsEnabled: true, botCount: 3, botSkill: 4 };
    saveGlobalPreferences(preferences, storage);

    const loaded = loadGlobalPreferences(storage);
    expect(loaded.preferences.version).toBe(2);
    expect(loaded.preferences.editorDefaults.gridSize).toBe(256);
    expect(loaded.preferences.shortcuts['file.save']).toBe('Ctrl+Shift+S');
    expect(loaded.preferences.collapsedPanels).toEqual({ 'entity-panel': true });
    expect(loaded.preferences.sidebar).toEqual({ visible: false, width: 420 });
    expect(loaded.preferences.mcpActivity).toEqual({ visible: true, height: 360 });
    expect(loaded.preferences.quickPlay).toEqual({ quality: 'full', botsEnabled: true, botCount: 3, botSkill: 4 });
  });

  it('ignores invalid persisted panel states', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 2,
      collapsedPanels: { 'entity-panel': true, 'texture-panel': 'yes', 'groups-panel': false },
    }));

    expect(loadGlobalPreferences(storage).preferences.collapsedPanels).toEqual({
      'entity-panel': true,
      'groups-panel': false,
    });
  });

  it('normalizes persisted sidebar visibility and width', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 2,
      sidebar: { visible: 'yes', width: 5000 },
    }));

    expect(loadGlobalPreferences(storage).preferences.sidebar).toEqual({
      visible: true,
      width: 600,
    });
  });

  it('normalizes persisted MCP activity panel visibility and height', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 2,
      mcpActivity: { visible: 'yes', height: 5000 },
    }));

    expect(loadGlobalPreferences(storage).preferences.mcpActivity).toEqual({
      visible: false,
      height: 800,
    });
  });

  it('normalizes persisted Quick Play settings', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 2,
      quickPlay: { quality: 'instant', botsEnabled: true, botCount: 99, botSkill: -4 },
    }));

    expect(loadGlobalPreferences(storage).preferences.quickPlay).toEqual({
      quality: 'normal',
      botsEnabled: true,
      botCount: 3,
      botSkill: 1,
    });
  });

  it('migrates the legacy display settings', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_DISPLAY_STORAGE_KEY, JSON.stringify({
      rendererMode: 'wireframe', textureFiltering: 'nearest', dynamicLights: true,
      categories: { lights: false },
    }));
    const loaded = loadGlobalPreferences(storage);
    expect(loaded.migrated).toBe(true);
    expect(loaded.preferences.display.rendererMode).toBe('wireframe');
    expect(loaded.preferences.display.categories.lights).toBe(false);
  });

  it('recovers from corrupt storage without throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCES_STORAGE_KEY, '{broken');
    const loaded = loadGlobalPreferences(storage);
    expect(loaded.recoveredFromCorruptStorage).toBe(true);
    expect(loaded.preferences).toEqual(DEFAULT_GLOBAL_PREFERENCES);
  });

  it('rejects imports from unsupported future versions', () => {
    expect(() => importGlobalPreferences('{"version":999}')).toThrow('newer than this editor supports');
  });
});
