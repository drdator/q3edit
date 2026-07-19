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
    saveGlobalPreferences(preferences, storage);

    const loaded = loadGlobalPreferences(storage);
    expect(loaded.preferences.version).toBe(2);
    expect(loaded.preferences.editorDefaults.gridSize).toBe(256);
    expect(loaded.preferences.shortcuts['file.save']).toBe('Ctrl+Shift+S');
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
