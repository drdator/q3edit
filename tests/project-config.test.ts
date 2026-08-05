import { describe, expect, it } from 'vitest';
import { createEntity } from '../src/entity';
import { DEFAULT_GLOBAL_PREFERENCES } from '../src/preferences';
import {
  DEFAULT_PROJECT_CONFIGURATION,
  MAP_PROJECT_CONFIG_KEY,
  PROJECT_CONFIG_STORAGE_KEY,
  importProjectConfiguration,
  loadProjectConfiguration,
  normalizeGameDirectory,
  readMapProjectConfiguration,
  resolveProjectPreferences,
  saveProjectConfiguration,
  writeMapProjectConfiguration,
} from '../src/project-config';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('project configuration', () => {
  it('round-trips paths, archive order, compile options, and definition sources', () => {
    const storage = new MemoryStorage();
    const project = structuredClone(DEFAULT_PROJECT_CONFIGURATION);
    project.game.basePath = '/games/quake3';
    project.assets.archives = ['pak0.pk3', 'mymod.pk3'];
    project.compile.bspArgs = ['-meta'];
    project.entityDefinitions.sources = ['scripts/entities.def'];
    project.diagnostics.mutedCodes = ['unknown-class', 'missing-texture'];
    saveProjectConfiguration(project, storage);
    expect(loadProjectConfiguration(storage)).toEqual(project);
  });

  it('recovers corrupt storage independently from global preferences', () => {
    const storage = new MemoryStorage();
    storage.setItem(PROJECT_CONFIG_STORAGE_KEY, 'nope');
    expect(loadProjectConfiguration(storage)).toEqual(DEFAULT_PROJECT_CONFIGURATION);
  });

  it('applies project overrides after global settings', () => {
    const project = structuredClone(DEFAULT_PROJECT_CONFIGURATION);
    project.overrides.gridSize = 32;
    project.overrides.display = { rendererMode: 'flat', categories: { lights: false } as never };
    const resolved = resolveProjectPreferences(DEFAULT_GLOBAL_PREFERENCES, project);
    expect(resolved.gridSize).toBe(32);
    expect(resolved.display.rendererMode).toBe('flat');
    expect(resolved.display.categories.lights).toBe(false);
    expect(resolved.display.categories.world).toBe(true);
  });

  it('rejects imports from unsupported future versions', () => {
    expect(() => importProjectConfiguration('{"version":2}')).toThrow('newer than this editor supports');
  });

  it('accepts safe standalone game directories and rejects filesystem paths', () => {
    expect(normalizeGameDirectory('tinygame')).toBe('tinygame');
    expect(normalizeGameDirectory('my-game_2')).toBe('my-game_2');
    expect(normalizeGameDirectory('../baseq3')).toBe('baseq3');
    expect(normalizeGameDirectory('mods/tinygame')).toBe('baseq3');
  });

  it('round-trips project configuration through worldspawn metadata', () => {
    const worldspawn = createEntity('worldspawn');
    const project = structuredClone(DEFAULT_PROJECT_CONFIGURATION);
    project.name = 'Embedded arena project';
    project.compile.bspArgs = ['-meta', '-samplesize', '8'];
    project.assets.archives = ['pak0.pk3', 'arena.pk3'];

    expect(writeMapProjectConfiguration([worldspawn], project)).toBe(true);
    expect(worldspawn.properties[MAP_PROJECT_CONFIG_KEY]).toBeTruthy();
    expect(readMapProjectConfiguration([worldspawn])).toEqual(project);
    expect(writeMapProjectConfiguration([worldspawn], project)).toBe(false);
  });

  it('ignores malformed or unsupported embedded project configuration', () => {
    const worldspawn = createEntity('worldspawn');
    worldspawn.properties[MAP_PROJECT_CONFIG_KEY] = 'not json';
    expect(readMapProjectConfiguration([worldspawn])).toBeNull();
    worldspawn.properties[MAP_PROJECT_CONFIG_KEY] = '{"version":2}';
    expect(readMapProjectConfiguration([worldspawn])).toBeNull();
  });
});
