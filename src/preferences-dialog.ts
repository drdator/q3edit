import { formatShortcut, normalizeShortcut, type CommandRegistry } from './commands';
import type { EditorCommandContext } from './editor-commands';
import type { Editor } from './editor';
import { DISPLAY_CATEGORIES, type DisplayCategory } from './display-policy';
import {
  DEFAULT_GLOBAL_PREFERENCES,
  exportGlobalPreferences,
  importGlobalPreferences,
  normalizeGlobalPreferences,
  saveGlobalPreferences,
  type GlobalPreferences,
  type ThemePreset,
} from './preferences';
import {
  exportProjectConfiguration,
  importProjectConfiguration,
  normalizeProjectConfiguration,
  saveProjectConfiguration,
  type ProjectConfiguration,
} from './project-config';

const THEME_VARIABLES = ['background', 'panel', 'text', 'accent', 'viewport', 'gridMajor', 'gridMinor'] as const;

export function applyAppearancePreferences(preferences: GlobalPreferences): void {
  const root = document.documentElement;
  root.dataset.editorTheme = preferences.theme.preset;
  const container = document.getElementById('viewport-container');
  if (container) container.dataset.layout = preferences.viewportLayout;
  const cssNames: Record<typeof THEME_VARIABLES[number], string> = {
    background: '--bg', panel: '--bg-light', text: '--text', accent: '--accent',
    viewport: '--viewport-bg', gridMajor: '--grid-major', gridMinor: '--grid-minor',
  };
  for (const name of THEME_VARIABLES) {
    if (preferences.theme.preset === 'custom') root.style.setProperty(cssNames[name], preferences.theme.colors[name]);
    else root.style.removeProperty(cssNames[name]);
  }
}

function labeled(label: string, control: HTMLElement): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'preferences-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  row.append(caption, control);
  return row;
}

function input(value = '', type = 'text'): HTMLInputElement {
  const control = document.createElement('input');
  control.type = type;
  control.value = value;
  return control;
}

function select(options: readonly string[], value: string): HTMLSelectElement {
  const control = document.createElement('select');
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option;
    item.textContent = option.replace(/-/g, ' ').replace(/^./, letter => letter.toUpperCase());
    item.selected = option === value;
    control.appendChild(item);
  }
  return control;
}

function checkbox(checked: boolean): HTMLInputElement {
  const control = input('', 'checkbox');
  control.checked = checked;
  return control;
}

function section(title: string, description?: string): HTMLElement {
  const element = document.createElement('section');
  element.className = 'preferences-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  element.appendChild(heading);
  if (description) {
    const help = document.createElement('p');
    help.textContent = description;
    element.appendChild(help);
  }
  return element;
}

function lines(value: string): string[] {
  return value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
}

function downloadJson(name: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function chooseJson(): Promise<string | null> {
  return new Promise(resolve => {
    const chooser = input('', 'file');
    chooser.accept = '.json,application/json';
    chooser.onchange = async () => resolve(chooser.files?.[0] ? chooser.files[0].text() : null);
    chooser.click();
  });
}

export interface PreferencesDialogOptions {
  editor: Editor;
  commands: CommandRegistry<EditorCommandContext>;
}

export interface ProjectSettingsDialogOptions {
  editor: Editor;
  onApplied?: (project: ProjectConfiguration) => void;
}

function removeSettingsDialogs(): void {
  document.getElementById('preferences-dialog')?.remove();
  document.getElementById('project-settings-dialog')?.remove();
}

export function openPreferencesDialog(options: PreferencesDialogOptions): void {
  removeSettingsDialogs();
  const { editor, commands } = options;
  let preferences = structuredClone(editor.preferences);

  const overlay = document.createElement('div');
  overlay.id = 'preferences-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'preferences-title');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog preferences-dialog';
  const title = document.createElement('div');
  title.id = 'preferences-title';
  title.className = 'editor-dialog-title';
  title.textContent = 'Preferences';
  const content = document.createElement('div');
  content.className = 'preferences-content';
  const status = document.createElement('div');
  status.className = 'preferences-status';
  status.setAttribute('role', 'status');

  const general = section('Editor defaults', 'Global defaults apply unless the current project overrides them.');
  const grid = input(String(preferences.editorDefaults.gridSize), 'number'); grid.min = '1'; grid.max = '256';
  const snap = select(['off', 'abs', 'rel'], preferences.editorDefaults.gridSnapMode);
  const geoSnap = checkbox(preferences.editorDefaults.snapToGeometry);
  const textureLock = checkbox(preferences.editorDefaults.textureLock);
  const primitive = select(['box', 'cylinder', 'cone', 'sphere', 'pyramid'], preferences.editorDefaults.brushPrimitive);
  const sides = input(String(preferences.editorDefaults.brushSides), 'number'); sides.min = '3'; sides.max = '64';
  const invisible = select(['show', 'dim', 'hide'], preferences.editorDefaults.invisibleMode);
  general.append(labeled('Grid size', grid), labeled('Grid snap', snap), labeled('Geometry snap', geoSnap),
    labeled('Texture lock', textureLock), labeled('Default brush', primitive), labeled('Brush sides', sides), labeled('Invisible geometry', invisible));

  const appearance = section('Appearance');
  const theme = select(['dark', 'light', 'high-contrast', 'custom'], preferences.theme.preset);
  const layout = select(['quad', 'wide-3d', 'wide-2d'], preferences.viewportLayout);
  appearance.append(labeled('Theme', theme), labeled('Viewport layout', layout));
  const colorControls = new Map<typeof THEME_VARIABLES[number], HTMLInputElement>();
  for (const name of THEME_VARIABLES) {
    const control = input(preferences.theme.colors[name]);
    colorControls.set(name, control);
    appearance.appendChild(labeled(name.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`), control));
  }

  const display = section('Display & renderer');
  const renderer = select(['wireframe', 'flat', 'textured'], preferences.display.rendererMode);
  const filtering = select(['nearest', 'linear', 'trilinear'], preferences.display.textureFiltering);
  const lights = checkbox(preferences.display.dynamicLights);
  display.append(labeled('Renderer', renderer), labeled('Texture filtering', filtering), labeled('Dynamic lights', lights));
  const categoryControls = new Map<DisplayCategory, HTMLInputElement>();
  const categoryGrid = document.createElement('div'); categoryGrid.className = 'preferences-checkbox-grid';
  for (const category of DISPLAY_CATEGORIES) {
    const control = checkbox(preferences.display.categories[category]);
    categoryControls.set(category, control);
    categoryGrid.appendChild(labeled(category, control));
  }
  display.appendChild(categoryGrid);

  const commandSection = section('Commands & shortcuts', 'Use Mod for Command on macOS and Ctrl elsewhere. Leave a shortcut empty to disable it.');
  const commandSearch = input(); commandSearch.placeholder = 'Filter commands';
  const commandList = document.createElement('div'); commandList.className = 'preferences-command-list';
  const shortcutInputs = new Map<string, HTMLInputElement>();
  const sortedCommands = [...commands.list()].sort((a, b) => commands.getState(a.id).label.localeCompare(commands.getState(b.id).label));
  for (const command of sortedCommands) {
    const row = document.createElement('div'); row.className = 'preferences-command-row';
    row.dataset.search = `${command.id} ${commands.getState(command.id).label}`.toLowerCase();
    const label = document.createElement('span'); label.textContent = commands.getState(command.id).label; label.title = command.id;
    const shortcut = input(commands.shortcutFor(command.id) ?? ''); shortcut.placeholder = 'Disabled';
    shortcut.title = commands.shortcutFor(command.id) ? formatShortcut(commands.shortcutFor(command.id)!) : 'No shortcut';
    shortcutInputs.set(command.id, shortcut);
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn'; reset.textContent = 'Reset';
    reset.onclick = () => { shortcut.value = commands.defaultShortcutFor(command.id) ?? ''; };
    row.append(label, shortcut, reset); commandList.appendChild(row);
  }
  commandSearch.oninput = () => {
    const query = commandSearch.value.trim().toLowerCase();
    for (const row of commandList.children) (row as HTMLElement).hidden = !(row as HTMLElement).dataset.search!.includes(query);
  };
  commandSection.append(commandSearch, commandList);

  content.append(general, appearance, display, commandSection, status);

  const actions = document.createElement('div'); actions.className = 'editor-dialog-actions preferences-actions';
  const resetAll = document.createElement('button'); resetAll.className = 'btn'; resetAll.textContent = 'Reset global defaults';
  resetAll.onclick = () => {
    preferences = structuredClone(DEFAULT_GLOBAL_PREFERENCES);
    saveGlobalPreferences(preferences);
    commands.resetAllShortcuts();
    editor.applyPreferences(preferences);
    applyAppearancePreferences(preferences);
    overlay.remove(); openPreferencesDialog(options);
  };
  const exportPrefs = document.createElement('button'); exportPrefs.className = 'btn'; exportPrefs.textContent = 'Export preferences';
  exportPrefs.onclick = () => downloadJson('q3edit-preferences.json', exportGlobalPreferences(editor.preferences));
  const importPrefs = document.createElement('button'); importPrefs.className = 'btn'; importPrefs.textContent = 'Import preferences';
  importPrefs.onclick = async () => {
    try {
      const json = await chooseJson(); if (!json) return;
      preferences = importGlobalPreferences(json);
      const conflicts = commands.replaceShortcutOverrides(preferences.shortcuts);
      if (conflicts.length) throw new Error('The imported preferences contain conflicting shortcuts');
      saveGlobalPreferences(preferences); editor.applyPreferences(preferences); applyAppearancePreferences(preferences);
      overlay.remove(); openPreferencesDialog(options);
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  };
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; cancel.onclick = () => overlay.remove();
  const apply = document.createElement('button'); apply.className = 'btn primary'; apply.textContent = 'Apply';
  apply.onclick = () => {
    try {
      const shortcuts: Record<string, string | null> = {};
      for (const command of sortedCommands) {
        const value = shortcutInputs.get(command.id)!.value.trim();
        const defaultShortcut = commands.defaultShortcutFor(command.id);
        if (!value) {
          if (defaultShortcut) shortcuts[command.id] = null;
        } else {
          const normalized = normalizeShortcut(value);
          if (normalized !== defaultShortcut) shortcuts[command.id] = normalized;
        }
      }
      const conflicts = commands.replaceShortcutOverrides(shortcuts);
      if (conflicts.length) {
        const conflict = conflicts[0];
        throw new Error(`${formatShortcut(conflict.shortcut)} is assigned to both ${commands.getState(conflict.conflictingCommandId).label} and ${commands.getState(conflict.commandId).label}`);
      }
      preferences = normalizeGlobalPreferences({
        ...preferences, shortcuts,
        editorDefaults: {
          gridSize: Number(grid.value), gridSnapMode: snap.value, snapToGeometry: geoSnap.checked,
          textureLock: textureLock.checked, brushPrimitive: primitive.value, brushSides: Number(sides.value), invisibleMode: invisible.value,
        },
        viewportLayout: layout.value,
        theme: { preset: theme.value as ThemePreset, colors: Object.fromEntries([...colorControls].map(([name, control]) => [name, control.value])) },
        display: {
          rendererMode: renderer.value, textureFiltering: filtering.value, dynamicLights: lights.checked,
          categories: Object.fromEntries([...categoryControls].map(([name, control]) => [name, control.checked])),
        },
      });
      saveGlobalPreferences(preferences);
      editor.applyPreferences(preferences); applyAppearancePreferences(preferences);
      editor.statusMessage = 'Preferences saved';
      overlay.remove();
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  };
  actions.append(resetAll, exportPrefs, importPrefs, cancel, apply);
  dialog.append(title, content, actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { overlay.remove(); event.stopPropagation(); } });
  grid.focus();
}

export function openProjectSettingsDialog(options: ProjectSettingsDialogOptions): void {
  removeSettingsDialogs();
  const { editor } = options;
  let project = structuredClone(editor.projectConfiguration);

  const overlay = document.createElement('div');
  overlay.id = 'project-settings-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'project-settings-title');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog project-settings-dialog';
  const title = document.createElement('div');
  title.id = 'project-settings-title';
  title.className = 'editor-dialog-title';
  title.textContent = 'Project Settings';
  const content = document.createElement('div');
  content.className = 'project-settings-content';
  const status = document.createElement('div');
  status.className = 'preferences-status';
  status.setAttribute('role', 'status');

  const projectSection = section('Project', 'Settings in this dialog apply only to the current project.');
  const projectName = input(project.name);
  const basePath = input(project.game.basePath);
  const gameDir = input(project.game.gameDirectory);
  const executable = input(project.game.executable);
  projectSection.append(labeled('Project name', projectName), labeled('Game base path', basePath),
    labeled('Game directory', gameDir), labeled('Game executable', executable));

  const assetsSection = section('Assets & definitions', 'One archive or search path per line. Binary PK3 data remains in the browser asset store.');
  const archives = document.createElement('textarea'); archives.value = project.assets.archives.join('\n');
  const searchPaths = document.createElement('textarea'); searchPaths.value = project.assets.searchPaths.join('\n');
  const openArena = checkbox(project.assets.openArenaEnabled);
  const definitionSources = document.createElement('textarea'); definitionSources.value = project.entityDefinitions.sources.join('\n');
  assetsSection.append(labeled('Archive order', archives), labeled('Asset search paths', searchPaths),
    labeled('Use OpenArena assets', openArena), labeled('Entity definition sources', definitionSources));

  const compileSection = section('Build', 'Configure the browser-based BSP, VIS, and LIGHT toolchain.');
  const bspArgs = input(project.compile.bspArgs.join(' '));
  const vis = checkbox(project.compile.vis); const visArgs = input(project.compile.visArgs.join(' '));
  const light = checkbox(project.compile.light); const lightArgs = input(project.compile.lightArgs.join(' '));
  compileSection.append(labeled('BSP arguments', bspArgs), labeled('Run VIS', vis), labeled('VIS arguments', visArgs),
    labeled('Run LIGHT', light), labeled('LIGHT arguments', lightArgs));

  const overridesSection = section('Editor overrides', 'Use the global options to inherit the editor defaults.');
  const projectGrid = input(project.overrides.gridSize === undefined ? '' : String(project.overrides.gridSize), 'number');
  projectGrid.placeholder = 'Use global'; projectGrid.min = '1'; projectGrid.max = '256';
  const projectSnap = select(['', 'off', 'abs', 'rel'], project.overrides.gridSnapMode ?? '');
  projectSnap.options[0].textContent = 'Use global';
  overridesSection.append(labeled('Grid size', projectGrid), labeled('Grid snap', projectSnap));

  content.append(projectSection, assetsSection, compileSection, overridesSection, status);

  const actions = document.createElement('div'); actions.className = 'editor-dialog-actions preferences-actions';
  const exportProject = document.createElement('button'); exportProject.className = 'btn'; exportProject.textContent = 'Export project';
  exportProject.onclick = () => downloadJson('q3edit-project.json', exportProjectConfiguration(editor.projectConfiguration));
  const importProject = document.createElement('button'); importProject.className = 'btn'; importProject.textContent = 'Import project';
  importProject.onclick = async () => {
    try {
      const json = await chooseJson(); if (!json) return;
      project = importProjectConfiguration(json);
      saveProjectConfiguration(project); editor.applyPreferences(editor.preferences, project);
      options.onApplied?.(project);
      overlay.remove(); openProjectSettingsDialog(options);
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  };
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; cancel.onclick = () => overlay.remove();
  const apply = document.createElement('button'); apply.className = 'btn primary'; apply.textContent = 'Apply';
  apply.onclick = () => {
    try {
      project = normalizeProjectConfiguration({
        ...project, name: projectName.value,
        game: { basePath: basePath.value, gameDirectory: gameDir.value, executable: executable.value },
        assets: { archives: lines(archives.value), searchPaths: lines(searchPaths.value), openArenaEnabled: openArena.checked, configured: true },
        compile: { bspArgs: lines(bspArgs.value.replace(/\s+/g, ',')), vis: vis.checked, visArgs: lines(visArgs.value.replace(/\s+/g, ',')), light: light.checked, lightArgs: lines(lightArgs.value.replace(/\s+/g, ',')) },
        entityDefinitions: { sources: lines(definitionSources.value) },
        overrides: { ...project.overrides, gridSize: projectGrid.value ? Number(projectGrid.value) : undefined, gridSnapMode: projectSnap.value || undefined },
      });
      saveProjectConfiguration(project);
      editor.applyPreferences(editor.preferences, project);
      options.onApplied?.(project);
      editor.statusMessage = 'Project settings saved';
      overlay.remove();
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  };
  actions.append(exportProject, importProject, cancel, apply);
  dialog.append(title, content, actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { overlay.remove(); event.stopPropagation(); } });
  projectName.focus();
}
