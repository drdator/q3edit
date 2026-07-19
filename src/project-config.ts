import type { DisplayPreferences } from './display-policy';
import type { GlobalPreferences, GridSnapMode } from './preferences';

export const PROJECT_CONFIG_VERSION = 1;
export const PROJECT_CONFIG_STORAGE_KEY = 'q3edit.project.current.v1';

export interface ProjectConfiguration {
  version: typeof PROJECT_CONFIG_VERSION;
  name: string;
  game: { basePath: string; gameDirectory: string; executable: string };
  assets: { archives: string[]; searchPaths: string[]; openArenaEnabled: boolean; configured: boolean };
  compile: { bspArgs: string[]; vis: boolean; visArgs: string[]; light: boolean; lightArgs: string[] };
  entityDefinitions: { sources: string[] };
  overrides: {
    gridSize?: number;
    gridSnapMode?: GridSnapMode;
    display?: Partial<DisplayPreferences>;
  };
}

export interface ResolvedProjectPreferences {
  gridSize: number;
  gridSnapMode: GridSnapMode;
  display: DisplayPreferences;
}

export const DEFAULT_PROJECT_CONFIGURATION: ProjectConfiguration = {
  version: PROJECT_CONFIG_VERSION,
  name: 'Quake III Arena',
  game: { basePath: '', gameDirectory: 'baseq3', executable: '' },
  assets: { archives: [], searchPaths: [], openArenaEnabled: true, configured: false },
  compile: { bspArgs: [], vis: true, visArgs: [], light: true, lightArgs: [] },
  entityDefinitions: { sources: [] },
  overrides: {},
};

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  : [];
const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;

export function normalizeProjectConfiguration(value: unknown): ProjectConfiguration {
  const result = structuredClone(DEFAULT_PROJECT_CONFIGURATION);
  if (!isRecord(value)) return result;
  const game = isRecord(value.game) ? value.game : {};
  const assets = isRecord(value.assets) ? value.assets : {};
  const compile = isRecord(value.compile) ? value.compile : {};
  const entityDefinitions = isRecord(value.entityDefinitions) ? value.entityDefinitions : {};
  const overrides = isRecord(value.overrides) ? value.overrides : {};
  result.name = text(value.name, result.name).slice(0, 120);
  result.game = {
    basePath: text(game.basePath), gameDirectory: text(game.gameDirectory, result.game.gameDirectory), executable: text(game.executable),
  };
  result.assets = {
    archives: strings(assets.archives), searchPaths: strings(assets.searchPaths),
    openArenaEnabled: typeof assets.openArenaEnabled === 'boolean' ? assets.openArenaEnabled : result.assets.openArenaEnabled,
    configured: assets.configured === true,
  };
  result.compile = {
    bspArgs: strings(compile.bspArgs), vis: typeof compile.vis === 'boolean' ? compile.vis : result.compile.vis,
    visArgs: strings(compile.visArgs), light: typeof compile.light === 'boolean' ? compile.light : result.compile.light,
    lightArgs: strings(compile.lightArgs),
  };
  result.entityDefinitions.sources = strings(entityDefinitions.sources);
  const rawGrid = Number(overrides.gridSize);
  if (Number.isFinite(rawGrid)) result.overrides.gridSize = Math.min(256, Math.max(1, Math.round(rawGrid)));
  if (['off', 'abs', 'rel'].includes(String(overrides.gridSnapMode))) result.overrides.gridSnapMode = overrides.gridSnapMode as GridSnapMode;
  if (isRecord(overrides.display)) result.overrides.display = overrides.display as Partial<DisplayPreferences>;
  return result;
}

export function loadProjectConfiguration(storage: ReadStorage | null = globalThis.localStorage ?? null): ProjectConfiguration {
  const stored = storage?.getItem(PROJECT_CONFIG_STORAGE_KEY);
  if (!stored) return structuredClone(DEFAULT_PROJECT_CONFIGURATION);
  try { return normalizeProjectConfiguration(JSON.parse(stored)); }
  catch { return structuredClone(DEFAULT_PROJECT_CONFIGURATION); }
}

export function saveProjectConfiguration(project: ProjectConfiguration, storage: WriteStorage | null = globalThis.localStorage ?? null): void {
  try { storage?.setItem(PROJECT_CONFIG_STORAGE_KEY, JSON.stringify(normalizeProjectConfiguration(project))); } catch { /* persistence is optional */ }
}

export function exportProjectConfiguration(project: ProjectConfiguration): string {
  return JSON.stringify(normalizeProjectConfiguration(project), null, 2);
}

export function importProjectConfiguration(json: string): ProjectConfiguration {
  const parsed = JSON.parse(json) as unknown;
  if (!isRecord(parsed)) throw new Error('Project file must contain a JSON object');
  if (Number(parsed.version) > PROJECT_CONFIG_VERSION) throw new Error(`Project version ${String(parsed.version)} is newer than this editor supports`);
  return normalizeProjectConfiguration(parsed);
}

export function resolveProjectPreferences(global: GlobalPreferences, project: ProjectConfiguration): ResolvedProjectPreferences {
  return {
    gridSize: project.overrides.gridSize ?? global.editorDefaults.gridSize,
    gridSnapMode: project.overrides.gridSnapMode ?? global.editorDefaults.gridSnapMode,
    display: {
      ...global.display,
      ...project.overrides.display,
      categories: { ...global.display.categories, ...project.overrides.display?.categories },
    },
  };
}
