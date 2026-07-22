import {
  DEFAULT_DISPLAY_PREFERENCES,
  DISPLAY_CATEGORIES,
  type DisplayPreferences,
  type RendererMode,
  type TextureFiltering,
} from './display-policy';
import type { BrushPrimitive } from './brush-primitives';
import type { InvisibleMode } from './editor';
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH } from './sidebar-layout';
import { clampMcpActivityPanelHeight, DEFAULT_MCP_ACTIVITY_PANEL_HEIGHT } from './live-bridge/activity-panel';

export const PREFERENCES_VERSION = 2;
export const PREFERENCES_STORAGE_KEY = 'q3edit.preferences.v2';
export const LEGACY_DISPLAY_STORAGE_KEY = 'q3edit.display.v1';

export type ThemePreset = 'dark' | 'light' | 'high-contrast' | 'custom';
export type ViewportLayout = 'quad' | 'wide-3d' | 'wide-2d';
export type GridSnapMode = 'off' | 'abs' | 'rel';
export type QuickPlayQuality = 'fast' | 'normal' | 'full';

export interface QuickPlayPreferences {
  quality: QuickPlayQuality;
  botsEnabled: boolean;
  botCount: number;
  botSkill: number;
}

export interface ThemeColors {
  background: string;
  panel: string;
  text: string;
  accent: string;
  viewport: string;
  gridMajor: string;
  gridMinor: string;
}

export interface GlobalPreferences {
  version: typeof PREFERENCES_VERSION;
  shortcuts: Record<string, string | null>;
  collapsedPanels: Record<string, boolean>;
  sidebar: { visible: boolean; width: number };
  mcpActivity: { visible: boolean; height: number };
  quickPlay: QuickPlayPreferences;
  theme: { preset: ThemePreset; colors: ThemeColors };
  viewportLayout: ViewportLayout;
  editorDefaults: {
    gridSize: number;
    gridSnapMode: GridSnapMode;
    snapToGeometry: boolean;
    textureLock: boolean;
    brushPrimitive: BrushPrimitive;
    brushSides: number;
    invisibleMode: InvisibleMode;
  };
  display: DisplayPreferences;
}

export interface PreferenceLoadResult {
  preferences: GlobalPreferences;
  migrated: boolean;
  recoveredFromCorruptStorage: boolean;
}

export const DEFAULT_THEME_COLORS: ThemeColors = {
  background: '#3c3c3c', panel: '#3c3c3c', text: '#cccccc', accent: '#e8a030',
  viewport: '#1e1e1e', gridMajor: 'rgba(100, 100, 100, 0.8)', gridMinor: 'rgba(60, 60, 60, 0.5)',
};

export const DEFAULT_GLOBAL_PREFERENCES: GlobalPreferences = {
  version: PREFERENCES_VERSION,
  shortcuts: {},
  collapsedPanels: {},
  sidebar: { visible: true, width: DEFAULT_SIDEBAR_WIDTH },
  mcpActivity: { visible: false, height: DEFAULT_MCP_ACTIVITY_PANEL_HEIGHT },
  quickPlay: { quality: 'normal', botsEnabled: false, botCount: 1, botSkill: 2 },
  theme: { preset: 'dark', colors: DEFAULT_THEME_COLORS },
  viewportLayout: 'quad',
  editorDefaults: {
    gridSize: 16, gridSnapMode: 'rel', snapToGeometry: false, textureLock: true,
    brushPrimitive: 'box', brushSides: 8, invisibleMode: 'show',
  },
  display: DEFAULT_DISPLAY_PREFERENCES,
};

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

function cloneDefaults(): GlobalPreferences {
  return structuredClone(DEFAULT_GLOBAL_PREFERENCES);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : fallback;
}

function displayPreferences(value: unknown, fallback = DEFAULT_DISPLAY_PREFERENCES): DisplayPreferences {
  const source = isRecord(value) ? value : {};
  const categoriesSource = isRecord(source.categories) ? source.categories : {};
  const categories = { ...fallback.categories };
  for (const category of DISPLAY_CATEGORIES) {
    if (typeof categoriesSource[category] === 'boolean') categories[category] = categoriesSource[category] as boolean;
  }
  const rendererMode = ['wireframe', 'flat', 'textured'].includes(String(source.rendererMode))
    ? source.rendererMode as RendererMode : fallback.rendererMode;
  const textureFiltering = ['nearest', 'linear', 'trilinear'].includes(String(source.textureFiltering))
    ? source.textureFiltering as TextureFiltering : fallback.textureFiltering;
  return { categories, rendererMode, textureFiltering, dynamicLights: source.dynamicLights === true };
}

export function normalizeGlobalPreferences(value: unknown): GlobalPreferences {
  const defaults = cloneDefaults();
  if (!isRecord(value)) return defaults;
  const editor = isRecord(value.editorDefaults) ? value.editorDefaults : value;
  const theme = isRecord(value.theme) ? value.theme : {};
  const sidebar = isRecord(value.sidebar) ? value.sidebar : {};
  const mcpActivity = isRecord(value.mcpActivity) ? value.mcpActivity : {};
  const quickPlay = isRecord(value.quickPlay) ? value.quickPlay : {};
  const colors = isRecord(theme.colors) ? theme.colors : {};
  const rawGrid = Number(editor.gridSize);
  const gridSize = Number.isFinite(rawGrid) ? Math.min(256, Math.max(1, Math.round(rawGrid))) : defaults.editorDefaults.gridSize;
  const rawSides = Number(editor.brushSides);
  const brushSides = Number.isFinite(rawSides) ? Math.min(64, Math.max(3, Math.round(rawSides))) : defaults.editorDefaults.brushSides;
  const shortcuts: Record<string, string | null> = {};
  if (isRecord(value.shortcuts)) {
    for (const [id, shortcut] of Object.entries(value.shortcuts)) {
      if (typeof shortcut === 'string' || shortcut === null) shortcuts[id] = shortcut;
    }
  }
  const collapsedPanels: Record<string, boolean> = {};
  if (isRecord(value.collapsedPanels)) {
    for (const [id, collapsed] of Object.entries(value.collapsedPanels)) {
      if (typeof collapsed === 'boolean') collapsedPanels[id] = collapsed;
    }
  }
  const presets: ThemePreset[] = ['dark', 'light', 'high-contrast', 'custom'];
  const layouts: ViewportLayout[] = ['quad', 'wide-3d', 'wide-2d'];
  const snapModes: GridSnapMode[] = ['off', 'abs', 'rel'];
  const primitives: BrushPrimitive[] = ['box', 'cylinder', 'cone', 'sphere', 'pyramid'];
  const invisibleModes: InvisibleMode[] = ['show', 'dim', 'hide'];
  const quickPlayQualities: QuickPlayQuality[] = ['fast', 'normal', 'full'];
  const rawBotCount = Number(quickPlay.botCount);
  const rawBotSkill = Number(quickPlay.botSkill);
  return {
    version: PREFERENCES_VERSION,
    shortcuts,
    collapsedPanels,
    sidebar: {
      visible: typeof sidebar.visible === 'boolean' ? sidebar.visible : defaults.sidebar.visible,
      width: clampSidebarWidth(Number(sidebar.width)),
    },
    mcpActivity: {
      visible: typeof mcpActivity.visible === 'boolean' ? mcpActivity.visible : defaults.mcpActivity.visible,
      height: clampMcpActivityPanelHeight(Number(mcpActivity.height)),
    },
    quickPlay: {
      quality: quickPlayQualities.includes(quickPlay.quality as QuickPlayQuality)
        ? quickPlay.quality as QuickPlayQuality : defaults.quickPlay.quality,
      botsEnabled: typeof quickPlay.botsEnabled === 'boolean' ? quickPlay.botsEnabled : defaults.quickPlay.botsEnabled,
      botCount: Number.isFinite(rawBotCount) ? Math.min(3, Math.max(1, Math.round(rawBotCount))) : defaults.quickPlay.botCount,
      botSkill: Number.isFinite(rawBotSkill) ? Math.min(5, Math.max(1, Math.round(rawBotSkill))) : defaults.quickPlay.botSkill,
    },
    theme: {
      preset: presets.includes(theme.preset as ThemePreset) ? theme.preset as ThemePreset : defaults.theme.preset,
      colors: {
        background: color(colors.background, defaults.theme.colors.background),
        panel: color(colors.panel, defaults.theme.colors.panel),
        text: color(colors.text, defaults.theme.colors.text),
        accent: color(colors.accent, defaults.theme.colors.accent),
        viewport: color(colors.viewport, defaults.theme.colors.viewport),
        gridMajor: color(colors.gridMajor, defaults.theme.colors.gridMajor),
        gridMinor: color(colors.gridMinor, defaults.theme.colors.gridMinor),
      },
    },
    viewportLayout: layouts.includes(value.viewportLayout as ViewportLayout) ? value.viewportLayout as ViewportLayout : defaults.viewportLayout,
    editorDefaults: {
      gridSize,
      gridSnapMode: snapModes.includes(editor.gridSnapMode as GridSnapMode) ? editor.gridSnapMode as GridSnapMode : defaults.editorDefaults.gridSnapMode,
      snapToGeometry: typeof editor.snapToGeometry === 'boolean' ? editor.snapToGeometry : defaults.editorDefaults.snapToGeometry,
      textureLock: typeof editor.textureLock === 'boolean' ? editor.textureLock : defaults.editorDefaults.textureLock,
      brushPrimitive: primitives.includes(editor.brushPrimitive as BrushPrimitive) ? editor.brushPrimitive as BrushPrimitive : defaults.editorDefaults.brushPrimitive,
      brushSides,
      invisibleMode: invisibleModes.includes(editor.invisibleMode as InvisibleMode) ? editor.invisibleMode as InvisibleMode : defaults.editorDefaults.invisibleMode,
    },
    display: displayPreferences(value.display),
  };
}

export function loadGlobalPreferences(storage: ReadStorage | null = globalThis.localStorage ?? null): PreferenceLoadResult {
  const stored = storage?.getItem(PREFERENCES_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      const version = isRecord(parsed) ? Number(parsed.version) : 0;
      return { preferences: normalizeGlobalPreferences(parsed), migrated: version !== PREFERENCES_VERSION, recoveredFromCorruptStorage: false };
    } catch {
      return { preferences: cloneDefaults(), migrated: false, recoveredFromCorruptStorage: true };
    }
  }
  const legacy = storage?.getItem(LEGACY_DISPLAY_STORAGE_KEY);
  if (legacy) {
    try {
      const preferences = cloneDefaults();
      preferences.display = displayPreferences(JSON.parse(legacy));
      return { preferences, migrated: true, recoveredFromCorruptStorage: false };
    } catch {
      return { preferences: cloneDefaults(), migrated: false, recoveredFromCorruptStorage: true };
    }
  }
  return { preferences: cloneDefaults(), migrated: false, recoveredFromCorruptStorage: false };
}

export function saveGlobalPreferences(preferences: GlobalPreferences, storage: WriteStorage | null = globalThis.localStorage ?? null): void {
  try { storage?.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeGlobalPreferences(preferences))); } catch { /* persistence is optional */ }
}

export function exportGlobalPreferences(preferences: GlobalPreferences): string {
  return JSON.stringify(normalizeGlobalPreferences(preferences), null, 2);
}

export function importGlobalPreferences(json: string): GlobalPreferences {
  const parsed = JSON.parse(json) as unknown;
  if (!isRecord(parsed)) throw new Error('Preferences file must contain a JSON object');
  if (Number(parsed.version) > PREFERENCES_VERSION) throw new Error(`Preferences version ${String(parsed.version)} is newer than this editor supports`);
  return normalizeGlobalPreferences(parsed);
}
