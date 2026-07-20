import { CommandRegistry, type CommandDefinition, type CommandMenuPlacement } from './commands';
import { getSelectedPatchItems } from './editor-selection';
import type { Editor, Tool } from './editor';
import type { Vec3 } from './math';
import { DISPLAY_CATEGORIES, type DisplayCategory, type RendererMode, type TextureFiltering } from './display-policy';
import { openExactPrimitiveDialog } from './primitive-dialog';
import { openReleaseNotesDialog } from './release-notes-dialog';

export interface EditorCommandContext {
  editor: Editor;
  handleExitVertexMode: () => void;
  openRotateDialog: () => void;
  openScaleDialog: () => void;
  compileBSP: () => void | Promise<void>;
  quickPlay: (quality: 'fast' | 'normal' | 'full') => void | Promise<void>;
  managePakFiles: () => void | Promise<void>;
  openPreferences: () => void;
  openProjectSettings: () => void;
  openDiagnostics: (tab: 'map' | 'entities' | 'find' | 'brush-macros') => void;
  openTerrainPanel: () => void;
  toggleSidebar: () => void;
  cycleInvisibleMode: () => void;
  setTool: (tool: Tool) => void;
  setGrid: (size: number) => void;
  increaseGrid: () => void;
  decreaseGrid: () => void;
  toggleSnap: () => void;
  toggleGeoSnap: () => void;
}

const MENU_ORDER: Record<string, number> = {
  File: 0,
  Edit: 1,
  View: 2,
  Region: 3,
  Pointfile: 4,
  Path: 5,
  Terrain: 6,
  Groups: 7,
  Patch: 8,
  Tools: 9,
  CSG: 10,
  Grid: 11,
};

const menu = (name: string, order: number, group: string, submenu?: string): CommandMenuPlacement => ({
  menu: name,
  menuOrder: MENU_ORDER[name],
  order,
  group,
  submenu,
});

const hasSelection = ({ editor }: EditorCommandContext) => editor.selection.length > 0;
const hasSelectedFaces = ({ editor }: EditorCommandContext) => editor.selectedFaces.length > 0;
const hasSelectedPatches = ({ editor }: EditorCommandContext) => getSelectedPatchItems(editor).length > 0;

function nudge(context: EditorCommandContext, horizontal: -1 | 0 | 1, vertical: -1 | 0 | 1, scale: 'normal' | 'fine' | 'large'): void {
  const { editor } = context;
  const amount = scale === 'fine' ? 1 : scale === 'large' ? editor.gridSize * 4 : editor.gridSize;
  const delta: Vec3 = [0, 0, 0];
  delta[editor.nudgeAxisH] = horizontal * amount;
  delta[editor.nudgeAxisV] = vertical * amount;
  if (editor.vertexMode && editor.vertexSelection.length > 0) editor.moveSelectedVertices(delta);
  else if (editor.patchEditMode && editor.patchControlSelection.length > 0) editor.moveSelectedControlPoints(delta);
  else editor.moveSelection(delta);
}

function cancelCurrentMode(context: EditorCommandContext): void {
  const { editor } = context;
  if (editor.vertexMode) context.handleExitVertexMode();
  else if (editor.patchEditMode) editor.exitPatchEditMode();
  else if (editor.activeTool === 'clip' && editor.clipPoints.length > 0) editor.cancelClip();
  else if (editor.activeTool === 'rotate' && editor.rotateAnchor) {
    editor.rotateAnchor = null;
    editor.redrawRequested = true;
  } else editor.clearSelection();
}

function cycleRenderSelected(context: EditorCommandContext): void {
  context.editor.renderSelectedOnly = !context.editor.renderSelectedOnly;
  context.editor.redrawRequested = true;
}

function setGizmo(context: EditorCommandContext, mode: 'move' | 'scale'): void {
  context.editor.gizmoMode = mode;
  context.editor.redrawRequested = true;
}

function createEditorCommands(): CommandDefinition<EditorCommandContext>[] {
  const displayLabels: Record<DisplayCategory, string> = {
    entities: 'Entities', lights: 'Lights', paths: 'Paths', world: 'World', detail: 'Detail Geometry',
    water: 'Water', clip: 'Clip', hint: 'Hint', caulk: 'Caulk', curves: 'Curves', names: 'Names',
    angles: 'Angles', coordinates: 'Coordinates', blocks: 'Blocks',
  };
  const displayCommands: CommandDefinition<EditorCommandContext>[] = DISPLAY_CATEGORIES.map((category, index) => ({
    id: `view.display.${category}`,
    label: displayLabels[category],
    menu: menu('View', 100 + index, 'display', 'Display Categories'),
    checked: ({ editor }) => editor.display.categories[category],
    execute: ({ editor }) => editor.toggleDisplayCategory(category),
  }));
  const rendererModes: RendererMode[] = ['wireframe', 'flat', 'textured'];
  const rendererCommands: CommandDefinition<EditorCommandContext>[] = rendererModes.map((mode, index) => ({
    id: `view.renderer.${mode}`,
    label: mode === 'flat' ? 'Flat Shaded' : mode[0].toUpperCase() + mode.slice(1),
    menu: menu('View', 200 + index, 'renderer', 'Renderer Mode'),
    checked: ({ editor }) => editor.display.rendererMode === mode,
    execute: ({ editor }) => editor.setRendererMode(mode),
  }));
  const textureFilters: TextureFiltering[] = ['nearest', 'linear', 'trilinear'];
  const filteringCommands: CommandDefinition<EditorCommandContext>[] = textureFilters.map((filtering, index) => ({
    id: `view.texture-filter.${filtering}`,
    label: filtering[0].toUpperCase() + filtering.slice(1),
    menu: menu('View', 210 + index, 'renderer', 'Texture Filtering'),
    checked: ({ editor }) => editor.display.textureFiltering === filtering,
    execute: ({ editor }) => editor.setTextureFiltering(filtering),
  }));
  const commands: CommandDefinition<EditorCommandContext>[] = [
    { id: 'file.new', label: 'New', defaultShortcut: 'Mod+N', menu: menu('File', 0, 'document'), execute: ({ editor }) => { editor.newMap(); editor.createDefaultMap(); } },
    { id: 'file.open', label: 'Open...', defaultShortcut: 'Mod+O', menu: menu('File', 10, 'open-save'), execute: ({ editor }) => editor.openMapFromFile() },
    { id: 'file.save', label: 'Save', defaultShortcut: 'Mod+S', menu: menu('File', 20, 'open-save'), execute: ({ editor }) => editor.saveMapToFile() },
    { id: 'file.manage-paks', label: 'Manage PK3 Files...', menu: menu('File', 30, 'assets'), execute: ctx => ctx.managePakFiles() },
    { id: 'file.project-settings', label: 'Project Settings...', menu: menu('File', 35, 'assets'), execute: ctx => ctx.openProjectSettings() },
    { id: 'file.import-prefab', label: 'Import Prefab...', menu: menu('File', 40, 'prefab'), execute: ({ editor }) => editor.importPrefabFromFile() },
    { id: 'file.save-prefab', label: 'Save Selection as Prefab', menu: menu('File', 50, 'prefab'), enabled: hasSelection, execute: ({ editor }) => editor.saveSelectionAsPrefab() },
    { id: 'file.export-console', label: 'Export .map to Console', menu: menu('File', 60, 'export'), execute: ({ editor }) => console.log(editor.serializeMap()) },
    { id: 'file.compile-bsp', label: 'Compile BSP...', menu: menu('File', 70, 'compile'), execute: ctx => ctx.compileBSP() },
    { id: 'file.quick-play-fast', label: 'Fast', defaultShortcut: 'Mod+Alt+1', menu: menu('File', 80, 'compile', 'Quick Play'), execute: ctx => ctx.quickPlay('fast') },
    { id: 'file.quick-play-normal', label: 'Normal', defaultShortcut: 'Mod+Alt+2', menu: menu('File', 81, 'compile', 'Quick Play'), execute: ctx => ctx.quickPlay('normal') },
    { id: 'file.quick-play-full', label: 'Full', defaultShortcut: 'Mod+Alt+3', menu: menu('File', 82, 'compile', 'Quick Play'), execute: ctx => ctx.quickPlay('full') },

    { id: 'edit.undo', label: 'Undo', defaultShortcut: 'Mod+Z', menu: menu('Edit', 0, 'history'), enabled: ({ editor }) => editor.history.canUndo, execute: ({ editor }) => editor.undo() },
    { id: 'edit.redo', label: 'Redo', defaultShortcut: 'Mod+Y', alternateShortcuts: ['Mod+Shift+Z'], menu: menu('Edit', 10, 'history'), enabled: ({ editor }) => editor.history.canRedo, execute: ({ editor }) => editor.redo() },
    { id: 'edit.copy', label: 'Copy', defaultShortcut: 'Mod+C', menu: menu('Edit', 20, 'clipboard'), enabled: hasSelection, execute: ({ editor }) => editor.copySelection() },
    { id: 'edit.paste', label: 'Paste', defaultShortcut: 'Mod+V', menu: menu('Edit', 30, 'clipboard'), execute: ({ editor }) => editor.pasteClipboard() },
    { id: 'edit.select-all', label: 'Select All', defaultShortcut: 'Mod+A', menu: menu('Edit', 40, 'selection'), execute: ({ editor }) => editor.selectAll() },
    { id: 'edit.select-all-type', label: 'Select All Of Type', menu: menu('Edit', 50, 'selection'), enabled: hasSelection, execute: ({ editor }) => editor.selectAllOfType() },
    { id: 'edit.invert-selection', label: 'Invert Selection', defaultShortcut: 'Mod+Shift+I', menu: menu('Edit', 60, 'selection'), execute: ({ editor }) => editor.invertSelection() },
    { id: 'edit.select-touching', label: 'Select Touching', menu: menu('Edit', 70, 'selection'), enabled: hasSelection, execute: ({ editor }) => editor.selectTouching() },
    { id: 'edit.select-inside', label: 'Select Inside', menu: menu('Edit', 80, 'selection'), enabled: hasSelection, execute: ({ editor }) => editor.selectInside() },
    { id: 'edit.select-complete-tall', label: 'Select Complete Tall', menu: menu('Edit', 90, 'selection'), enabled: hasSelection, execute: ({ editor }) => editor.selectCompleteTall() },
    { id: 'edit.select-partial-tall', label: 'Select Partial Tall', menu: menu('Edit', 100, 'selection'), enabled: hasSelection, execute: ({ editor }) => editor.selectPartialTall() },
    { id: 'edit.deselect', label: 'Deselect', defaultShortcut: 'Escape', menu: menu('Edit', 110, 'visibility'), execute: cancelCurrentMode },
    { id: 'edit.hide-selected', label: 'Hide Selected', defaultShortcut: 'H', menu: menu('Edit', 120, 'visibility'), enabled: hasSelection, execute: ({ editor }) => editor.hideSelected() },
    { id: 'edit.show-hidden', label: 'Show Hidden', defaultShortcut: 'Shift+H', menu: menu('Edit', 130, 'visibility'), execute: ({ editor }) => editor.showHidden() },
    { id: 'edit.make-detail', label: 'Make Detail', menu: menu('Edit', 140, 'brush-kind'), enabled: hasSelection, execute: ({ editor }) => editor.makeDetail() },
    { id: 'edit.make-structural', label: 'Make Structural', menu: menu('Edit', 150, 'brush-kind'), enabled: hasSelection, execute: ({ editor }) => editor.makeStructural() },
    { id: 'edit.group-selection', label: 'Group Selection', defaultShortcut: 'Mod+Shift+G', menu: menu('Edit', 160, 'grouping'), enabled: hasSelection, execute: ({ editor }) => editor.groupSelectionIntoEntity() },
    { id: 'edit.move-worldspawn', label: 'Move to Worldspawn', defaultShortcut: 'Mod+Shift+U', menu: menu('Edit', 170, 'grouping'), enabled: hasSelection, execute: ({ editor }) => editor.moveSelectionToWorldspawn() },
    { id: 'edit.preferences', label: 'Preferences...', defaultShortcut: 'Mod+,', menu: menu('Edit', 175, 'settings'), execute: ctx => ctx.openPreferences() },
    { id: 'edit.connect-entities', label: 'Connect Entities', defaultShortcut: 'Mod+K', menu: menu('Edit', 180, 'grouping'), execute: ({ editor }) => editor.connectSelectedEntities() },
    { id: 'groups.create', label: 'Create Named Group...', menu: menu('Groups', 0, 'manage'), execute: ({ editor }) => {
      const name = globalThis.prompt?.('Named group', 'Group'); if (name) editor.createNamedGroup(name);
    } },
    { id: 'groups.add-selection', label: 'Add Selection to Group...', menu: menu('Groups', 10, 'membership'), enabled: hasSelection, execute: ({ editor }) => {
      const groups = editor.namedGroups();
      const name = globalThis.prompt?.(`Group name (${groups.map(group => group.name).join(', ')})`, groups[0]?.name ?? '');
      const group = groups.find(candidate => candidate.name === name); if (group) editor.addSelectionToNamedGroup(group.id);
    } },
    { id: 'groups.remove-selection', label: 'Remove Selection from Groups', menu: menu('Groups', 20, 'membership'), enabled: hasSelection, execute: ({ editor }) => editor.removeSelectionFromNamedGroups() },
    { id: 'edit.duplicate', label: 'Duplicate', defaultShortcut: 'Mod+D', menu: menu('Edit', 190, 'change'), enabled: hasSelection, execute: ({ editor }) => editor.duplicateSelection() },
    { id: 'edit.delete', label: 'Delete', defaultShortcut: 'Delete', alternateShortcuts: ['Backspace'], menu: menu('Edit', 200, 'change'), enabled: hasSelection, execute: ({ editor }) => editor.deleteSelection() },
    { id: 'edit.rotate-90', label: 'Rotate 90°', defaultShortcut: 'R', menu: menu('Edit', 210, 'transform'), enabled: hasSelection, execute: ({ editor }) => editor.rotateSelection(90) },
    { id: 'edit.rotate-15', label: 'Rotate 15°', defaultShortcut: 'Shift+R', menu: menu('Edit', 220, 'transform'), enabled: hasSelection, execute: ({ editor }) => editor.rotateSelection(15) },
    { id: 'edit.rotate', label: 'Rotate...', defaultShortcut: 'Mod+Shift+R', menu: menu('Edit', 230, 'transform'), enabled: hasSelection, execute: ctx => ctx.openRotateDialog() },
    { id: 'edit.scale', label: 'Scale...', defaultShortcut: 'Mod+Shift+E', menu: menu('Edit', 240, 'transform'), enabled: hasSelection, execute: ctx => ctx.openScaleDialog() },
    { id: 'edit.flip-x', label: 'Flip X', defaultShortcut: 'Shift+X', menu: menu('Edit', 250, 'flip'), enabled: hasSelection, execute: ({ editor }) => editor.flipSelection(0) },
    { id: 'edit.flip-y', label: 'Flip Y', defaultShortcut: 'Shift+Y', menu: menu('Edit', 260, 'flip'), enabled: hasSelection, execute: ({ editor }) => editor.flipSelection(1) },
    { id: 'edit.flip-z', label: 'Flip Z', defaultShortcut: 'Shift+Z', menu: menu('Edit', 270, 'flip'), enabled: hasSelection, execute: ({ editor }) => editor.flipSelection(2) },

    { id: 'view.texture-lock', label: 'Texture Lock', defaultShortcut: 'T', menu: menu('View', 0, 'visibility'), checked: ({ editor }) => editor.textureLock, execute: ({ editor }) => editor.toggleTextureLock() },
    { id: 'view.invisible-mode', label: 'Cycle Invisible Mode', defaultShortcut: 'I', menu: menu('View', 10, 'visibility'), checked: ({ editor }) => editor.invisibleMode !== 'show', execute: ctx => ctx.cycleInvisibleMode() },
    { id: 'view.render-selected', label: 'Render Selected Only', menu: menu('View', 20, 'visibility'), checked: ({ editor }) => editor.renderSelectedOnly, execute: cycleRenderSelected },
    { id: 'view.cubic-clip', label: ({ editor }) => editor.cubicClipEnabled ? `Cubic Clipping: ${editor.cubicClipSize} cube` : 'Cubic Clipping: Off', menu: menu('View', 30, 'clipping'), checked: ({ editor }) => editor.cubicClipEnabled, execute: ({ editor }) => editor.toggleCubicClip() },
    { id: 'view.cubic-clip-smaller', label: 'Smaller Clip Cube', menu: menu('View', 40, 'clipping'), execute: ({ editor }) => editor.adjustCubicClipSize(-1) },
    { id: 'view.cubic-clip-larger', label: 'Larger Clip Cube', menu: menu('View', 50, 'clipping'), execute: ({ editor }) => editor.adjustCubicClipSize(1) },
    { id: 'view.sidebar', label: 'Right Sidebar', menu: menu('View', 60, 'layout'), checked: ({ editor }) => editor.preferences.sidebar.visible, execute: ctx => ctx.toggleSidebar() },
    { id: 'view.dynamic-lights', label: 'Dynamic Light Preview', menu: menu('View', 220, 'renderer'), checked: ({ editor }) => editor.display.dynamicLights, execute: ({ editor }) => editor.toggleDynamicLights() },
    ...displayCommands,
    ...rendererCommands,
    ...filteringCommands,
    { id: 'view.release-notes', label: 'Release Notes...', menu: menu('View', 1000, 'release-notes'), execute: () => openReleaseNotesDialog() },

    { id: 'region.from-selection', label: 'Set From Selection', menu: menu('Region', 0, 'region'), enabled: hasSelection, execute: ({ editor }) => editor.setRegionFromSelection() },
    { id: 'region.from-view', label: 'Set From Current XY View', menu: menu('Region', 10, 'region'), execute: ({ editor }) => editor.setRegionFromCurrentXYView() },
    { id: 'region.from-brush', label: 'Set From One Brush', menu: menu('Region', 20, 'region'), enabled: hasSelection, execute: ({ editor }) => editor.setRegionFromSingleBrush() },
    { id: 'region.from-tall-selection', label: 'Set Tall From Selection', menu: menu('Region', 30, 'region'), enabled: hasSelection, execute: ({ editor }) => editor.setRegionFromTallSelection() },
    { id: 'region.save', label: 'Save Region...', menu: menu('Region', 40, 'file'), enabled: ({ editor }) => editor.isRegionActive(), execute: ({ editor }) => editor.saveRegionToFile() },
    { id: 'region.off', label: 'Region Off', menu: menu('Region', 50, 'region'), enabled: ({ editor }) => editor.isRegionActive(), execute: ({ editor }) => editor.clearRegion() },
    { id: 'pointfile.open', label: 'Open Pointfile...', menu: menu('Pointfile', 0, 'file'), execute: ({ editor }) => editor.openPointfileFromFile() },
    { id: 'pointfile.clear', label: ({ editor }) => editor.pointfilePoints.length > 0 ? `Clear Pointfile (${editor.pointfilePoints.length})` : 'Clear Pointfile', menu: menu('Pointfile', 10, 'file'), enabled: ({ editor }) => editor.pointfilePoints.length > 0, execute: ({ editor }) => editor.clearPointfile() },
    { id: 'pointfile.previous', label: 'Previous Leak Spot', menu: menu('Pointfile', 20, 'navigate'), enabled: ({ editor }) => editor.pointfilePoints.length > 0, execute: ({ editor }) => editor.prevPointfilePoint() },
    { id: 'pointfile.next', label: 'Next Leak Spot', menu: menu('Pointfile', 30, 'navigate'), enabled: ({ editor }) => editor.pointfilePoints.length > 0, execute: ({ editor }) => editor.nextPointfilePoint() },
    { id: 'path.connect', label: 'Connect Selection as Path', defaultShortcut: 'Mod+Shift+K', menu: menu('Path', 0, 'path'), execute: ({ editor }) => editor.connectSelectedEntitiesAsPath() },
    { id: 'path.connect-closed', label: 'Connect Selection as Closed Path', defaultShortcut: 'Mod+Alt+K', menu: menu('Path', 10, 'path'), execute: ({ editor }) => editor.connectSelectedEntitiesAsClosedPath() },
    { id: 'path.camera-selection', label: 'Camera Path from Selection...', menu: menu('Path', 20, 'camera'), execute: ({ editor }) => {
      const name = globalThis.prompt?.('Camera path name', 'Camera Path'); if (name) editor.createCameraPathFromSelection(name);
    } },
    { id: 'path.camera-selection-closed', label: 'Closed Camera Path from Selection...', menu: menu('Path', 30, 'camera'), execute: ({ editor }) => {
      const name = globalThis.prompt?.('Camera path name', 'Camera Loop'); if (name) editor.createCameraPathFromSelection(name, true);
    } },
    { id: 'path.camera-view', label: 'New Camera Path from 3D View...', menu: menu('Path', 40, 'camera'), execute: ({ editor }) => {
      const name = globalThis.prompt?.('Camera path name', 'Camera Path'); if (name) editor.createCameraPathFromCurrentCamera(name);
    } },
    { id: 'path.camera-play', label: 'Play Camera Path', menu: menu('Path', 50, 'playback'), enabled: ({ editor }) => editor.cameraPaths().length > 0, execute: ({ editor }) => {
      const selected = editor.cameraPaths().find(path => path.points.some(point => editor.selection.some(item => item.entity === point.entity))) ?? editor.cameraPaths()[0];
      if (selected) editor.startCameraPlayback(selected.id);
    } },
    { id: 'path.camera-stop', label: 'Stop Camera', menu: menu('Path', 60, 'playback'), enabled: ({ editor }) => !!editor.cameraPlayback, execute: ({ editor }) => editor.stopCameraPlayback() },
    { id: 'path.smart', label: 'Build Smart Path', menu: menu('Path', 70, 'smart'), execute: ({ editor }) => editor.createSmartPath() },
    { id: 'path.smart-train', label: 'Build Smart Train Path', menu: menu('Path', 80, 'smart'), execute: ({ editor }) => editor.createSmartTrainPath() },

    { id: 'terrain.create', label: 'Create Terrain Patch', menu: menu('Terrain', 0, 'setup'), enabled: hasSelection, execute: ({ editor }) => editor.createTerrainPatch() },
    { id: 'terrain.prepare-paint', label: 'Prepare Terrain For Texture Paint', menu: menu('Terrain', 10, 'setup'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.splitTerrainIntoPaintTiles() },
    { id: 'terrain.stitch', label: 'Stitch Terrain Seams', menu: menu('Terrain', 20, 'setup'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.stitchTerrainSeams() },
    { id: 'terrain.toggle-brush-mode', label: ({ editor }) => `Brush Mode: ${editor.terrainBrushMode === 'texture' ? 'Texture' : 'Height'}`, menu: menu('Terrain', 30, 'mode'), execute: ({ editor }) => editor.toggleTerrainBrushMode() },
    { id: 'terrain.raise', label: 'Raise Terrain', defaultShortcut: 'PageUp', menu: menu('Terrain', 40, 'sculpt'), enabled: ({ editor }) => editor.patchEditMode, execute: ({ editor }) => editor.raiseTerrain() },
    { id: 'terrain.lower', label: 'Lower Terrain', defaultShortcut: 'PageDown', menu: menu('Terrain', 50, 'sculpt'), enabled: ({ editor }) => editor.patchEditMode, execute: ({ editor }) => editor.lowerTerrain() },
    { id: 'terrain.smooth', label: 'Smooth Terrain', defaultShortcut: 'Home', menu: menu('Terrain', 60, 'sculpt'), enabled: ({ editor }) => editor.patchEditMode, execute: ({ editor }) => editor.smoothTerrain() },
    { id: 'terrain.noise', label: 'Noise Terrain', menu: menu('Terrain', 70, 'sculpt'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.noiseTerrain() },
    { id: 'terrain.erode', label: 'Erode Terrain', menu: menu('Terrain', 80, 'sculpt'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.erodeTerrain() },
    { id: 'terrain.radius-smaller', label: 'Smaller Radius', menu: menu('Terrain', 90, 'brush'), execute: ({ editor }) => editor.adjustTerrainRadius(-8) },
    { id: 'terrain.radius-larger', label: 'Larger Radius', menu: menu('Terrain', 100, 'brush'), execute: ({ editor }) => editor.adjustTerrainRadius(8) },
    { id: 'terrain.brush-weaker', label: 'Weaker Brush', menu: menu('Terrain', 110, 'brush'), execute: ({ editor }) => editor.adjustTerrainStrength(-2) },
    { id: 'terrain.brush-stronger', label: 'Stronger Brush', menu: menu('Terrain', 120, 'brush'), execute: ({ editor }) => editor.adjustTerrainStrength(2) },
    { id: 'terrain.falloff', label: ({ editor }) => `Falloff: ${editor.terrainFalloff === 'smooth' ? 'Smooth' : 'Linear'}`, menu: menu('Terrain', 130, 'brush'), execute: ({ editor }) => editor.cycleTerrainFalloff() },
    { id: 'terrain.select-row', label: 'Select Terrain Row', menu: menu('Terrain', 135, 'selection'), enabled: ({ editor }) => editor.patchEditMode, execute: ({ editor }) => editor.selectTerrainRows() },
    { id: 'terrain.select-column', label: 'Select Terrain Column', menu: menu('Terrain', 136, 'selection'), enabled: ({ editor }) => editor.patchEditMode, execute: ({ editor }) => editor.selectTerrainColumns() },

    { id: 'tool.select', label: 'Select', defaultShortcut: '1', menu: menu('Tools', 0, 'tools'), checked: ({ editor }) => editor.activeTool === 'select', execute: ctx => ctx.setTool('select') },
    { id: 'tool.create', label: 'Create Brush', defaultShortcut: '2', menu: menu('Tools', 10, 'tools'), checked: ({ editor }) => editor.activeTool === 'create', execute: ctx => ctx.setTool('create') },
    { id: 'tool.entity', label: 'Place Entity', defaultShortcut: '3', menu: menu('Tools', 20, 'tools'), checked: ({ editor }) => editor.activeTool === 'entity', execute: ctx => ctx.setTool('entity') },
    { id: 'tool.clip', label: 'Clip', defaultShortcut: '4', menu: menu('Tools', 30, 'tools'), checked: ({ editor }) => editor.activeTool === 'clip', execute: ctx => ctx.setTool('clip') },
    { id: 'tool.rotate', label: 'Rotate', defaultShortcut: '5', menu: menu('Tools', 40, 'tools'), checked: ({ editor }) => editor.activeTool === 'rotate', execute: ctx => ctx.setTool('rotate') },
    { id: 'brush.create-exact', label: 'Create Exact Primitive...', menu: menu('Tools', 50, 'create'), execute: ({ editor }) => openExactPrimitiveDialog(editor) },
    { id: 'csg.subtract', label: 'CSG Subtract', defaultShortcut: 'Mod+Shift+S', menu: menu('CSG', 0, 'csg'), enabled: hasSelection, execute: ({ editor }) => editor.csgSubtract() },
    { id: 'csg.hollow', label: 'Make Hollow', defaultShortcut: 'Mod+Shift+H', menu: menu('CSG', 10, 'csg'), enabled: hasSelection, execute: ({ editor }) => editor.csgHollow() },
    { id: 'csg.merge', label: 'Merge Brushes', defaultShortcut: 'Mod+Shift+M', menu: menu('CSG', 20, 'csg'), enabled: hasSelection, execute: ({ editor }) => editor.csgMerge() },
    ...[1, 2, 4, 8, 16, 32, 64].map((size, index): CommandDefinition<EditorCommandContext> => ({ id: `grid.set-${size}`, label: `Grid ${size}`, menu: menu('Grid', index * 10, 'sizes'), checked: ({ editor }) => editor.gridSize === size, execute: ctx => ctx.setGrid(size) })),
    { id: 'grid.smaller', label: 'Smaller Grid', defaultShortcut: 'BracketLeft', menu: menu('Grid', 80, 'adjust'), execute: ctx => ctx.decreaseGrid() },
    { id: 'grid.larger', label: 'Larger Grid', defaultShortcut: 'BracketRight', menu: menu('Grid', 90, 'adjust'), execute: ctx => ctx.increaseGrid() },

    { id: 'edit.snap-grid', label: 'Snap Selection to Grid', defaultShortcut: 'Mod+G', enabled: hasSelection, execute: ({ editor }) => editor.snapSelectionToGrid() },
    { id: 'mode.vertex-or-patch', label: 'Toggle Vertex/Patch Edit', defaultShortcut: 'V', execute: ctx => {
      const { editor } = ctx;
      if (editor.vertexMode) ctx.handleExitVertexMode();
      else if (editor.patchEditMode) editor.exitPatchEditMode();
      else if (getSelectedPatchItems(editor).length > 0) editor.enterPatchEditMode();
      else if (editor.selection.length > 0) editor.enterVertexMode();
    } },
    { id: 'patch.create-flat', label: 'Create Flat Patch', defaultShortcut: 'P', menu: menu('Patch', 0, 'create'), enabled: hasSelection, execute: ({ editor }) => editor.createPatch('flat') },
    { id: 'patch.create-cylinder', label: 'Create Cylinder Patch', defaultShortcut: 'Shift+P', menu: menu('Patch', 10, 'create'), enabled: hasSelection, execute: ({ editor }) => editor.createPatch('cylinder') },
    { id: 'patch.create-cone', label: 'Create Cone Patch', defaultShortcut: 'Mod+P', menu: menu('Patch', 20, 'create'), enabled: hasSelection, execute: ({ editor }) => editor.createPatch('cone') },
    { id: 'patch.create-bevel', label: 'Create Bevel Patch', defaultShortcut: 'Mod+Shift+P', menu: menu('Patch', 30, 'create'), enabled: hasSelection, execute: ({ editor }) => editor.createPatch('bevel') },
    { id: 'patch.create-endcap', label: 'Create End Cap', menu: menu('Patch', 40, 'create'), enabled: hasSelection, execute: ({ editor }) => editor.createPatch('endcap') },
    { id: 'patch.create-square', label: 'Create Square 5x5', menu: menu('Patch', 50, 'matrix'), enabled: hasSelection, execute: ({ editor }) => editor.createMatrixPatch(5, 5) },
    { id: 'patch.create-dense', label: 'Create Dense 9x9', menu: menu('Patch', 60, 'matrix'), enabled: hasSelection, execute: ({ editor }) => editor.createMatrixPatch(9, 9) },
    { id: 'patch.create-arbitrary', label: 'Create Arbitrary Matrix...', menu: menu('Patch', 70, 'matrix'), enabled: hasSelection, execute: ({ editor }) => {
      const value = globalThis.prompt?.('Patch dimensions (odd, 3-31)', '5x3'); if (!value) return;
      const match = value.match(/^\s*(\d+)\s*[x, ]\s*(\d+)\s*$/i); if (match) editor.createMatrixPatch(Number(match[1]), Number(match[2]));
    } },
    { id: 'patch.insert-rows', label: 'Insert Rows', menu: menu('Patch', 80, 'grid'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.applyPatchOperation('insert-rows') },
    { id: 'patch.delete-rows', label: 'Delete Rows', menu: menu('Patch', 90, 'grid'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.applyPatchOperation('delete-rows') },
    { id: 'patch.insert-columns', label: 'Insert Columns', menu: menu('Patch', 100, 'grid'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.applyPatchOperation('insert-columns') },
    { id: 'patch.delete-columns', label: 'Delete Columns', menu: menu('Patch', 110, 'grid'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.applyPatchOperation('delete-columns') },
    ...(['transpose','invert','redisperse-rows','redisperse-columns','cycle-cap','naturalize','fit','shift-u','shift-v','scale-up','scale-down','rotate'] as const).map((operation, index) => ({ id: `patch.${operation}`, label: `Patch ${operation.replace(/-/g, ' ')}`, menu: menu('Patch', 120 + index, operation.includes('row') || operation.includes('column') ? 'grid' : 'texture'), enabled: hasSelectedPatches, execute: ({ editor }: EditorCommandContext) => editor.applyPatchOperation(operation) })),
    { id: 'patch.thicken', label: 'Thicken With Caps', menu: menu('Patch', 150, 'shape'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.thickenPatches() },
    { id: 'terrain.convert-patchdef2', label: 'Convert Terrain to patchDef2', menu: menu('Terrain', 140, 'setup'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.convertSelectedTerrainToPatch() },
    { id: 'patch.subdivide-more', label: 'Increase Patch Subdivisions', defaultShortcut: 'Plus', alternateShortcuts: ['='], menu: menu('Patch', 160, 'subdivision'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.changeSubdivisions(1) },
    { id: 'patch.subdivide-less', label: 'Decrease Patch Subdivisions', defaultShortcut: 'Minus', alternateShortcuts: ['Shift+_'], menu: menu('Patch', 170, 'subdivision'), enabled: hasSelectedPatches, execute: ({ editor }) => editor.changeSubdivisions(-1) },
    { id: 'clip.execute', label: 'Execute Clip', defaultShortcut: 'Enter', enabled: ({ editor }) => editor.activeTool === 'clip', execute: ({ editor }) => editor.executeClip() },
    { id: 'clip.cycle-mode', label: 'Cycle Clip Mode', defaultShortcut: 'Tab', enabled: ({ editor }) => editor.activeTool === 'clip', execute: ({ editor }) => editor.cycleClipMode() },
    { id: 'view.geometry-snap', label: 'Geometry Snap', defaultShortcut: 'G', checked: ({ editor }) => editor.snapToGeometry, execute: ctx => ctx.toggleGeoSnap() },
    { id: 'view.center-selection', label: 'Center on Selection', defaultShortcut: 'F', enabled: hasSelection, execute: ({ editor }) => editor.centerOnSelection() },
    { id: 'gizmo.move', label: 'Move Mode', defaultShortcut: 'W', checked: ({ editor }) => editor.gizmoMode === 'move', execute: ctx => setGizmo(ctx, 'move') },
    { id: 'gizmo.scale', label: 'Scale Mode', defaultShortcut: 'E', checked: ({ editor }) => editor.gizmoMode === 'scale', execute: ctx => setGizmo(ctx, 'scale') },
    { id: 'view.snap-mode', label: ({ editor }) => `Grid Snap: ${editor.gridSnapMode === 'off' ? 'Off' : editor.gridSnapMode === 'abs' ? 'Absolute' : 'Relative'}`, checked: ({ editor }) => editor.gridSnapMode !== 'off', execute: ctx => ctx.toggleSnap() },
    { id: 'terrain.open-panel', label: 'Open Terrain Panel', execute: ctx => ctx.openTerrainPanel() },
    { id: 'tools.map-info', label: 'Map Info & Diagnostics...', defaultShortcut: 'M', menu: menu('Tools', 300, 'diagnostics'), execute: ctx => ctx.openDiagnostics('map') },
    { id: 'tools.entity-info', label: 'Entity Info...', defaultShortcut: 'Mod+L', menu: menu('Tools', 310, 'diagnostics'), execute: ctx => ctx.openDiagnostics('entities') },
    { id: 'tools.find-brush', label: 'Find Brush...', defaultShortcut: 'Mod+Shift+B', menu: menu('Tools', 320, 'diagnostics'), execute: ctx => ctx.openDiagnostics('find') },
    { id: 'tools.brush-macros', label: 'Brush Macros...', menu: menu('Tools', 330, 'diagnostics'), execute: ctx => ctx.openDiagnostics('brush-macros') },

    { id: 'texture.fit', label: 'Fit Texture', defaultShortcut: 'Mod+Shift+F', enabled: hasSelectedFaces, execute: ({ editor }) => editor.fitTexture() },
    { id: 'texture.reset', label: 'Reset Texture Alignment', defaultShortcut: 'Mod+Shift+N', enabled: hasSelectedFaces, execute: ({ editor }) => editor.resetTextureAlignment() },
    { id: 'texture.rotate-positive', label: 'Rotate Texture Clockwise', defaultShortcut: 'Shift+PageUp', enabled: hasSelectedFaces, execute: ({ editor }) => editor.rotateTexture(15) },
    { id: 'texture.rotate-positive-fine', label: 'Rotate Texture Clockwise (Fine)', defaultShortcut: 'Mod+Shift+PageUp', enabled: hasSelectedFaces, execute: ({ editor }) => editor.rotateTexture(1) },
    { id: 'texture.rotate-negative', label: 'Rotate Texture Counterclockwise', defaultShortcut: 'Shift+PageDown', enabled: hasSelectedFaces, execute: ({ editor }) => editor.rotateTexture(-15) },
    { id: 'texture.rotate-negative-fine', label: 'Rotate Texture Counterclockwise (Fine)', defaultShortcut: 'Mod+Shift+PageDown', enabled: hasSelectedFaces, execute: ({ editor }) => editor.rotateTexture(-1) },
    { id: 'texture.scale-up', label: 'Scale Texture Up', defaultShortcut: 'Mod+PageUp', enabled: hasSelectedFaces, execute: ({ editor }) => editor.scaleTexture(0.05) },
    { id: 'texture.scale-down', label: 'Scale Texture Down', defaultShortcut: 'Mod+PageDown', enabled: hasSelectedFaces, execute: ({ editor }) => editor.scaleTexture(-0.05) },
  ];

  const directions = [
    ['left', -1, 0, 'ArrowLeft'],
    ['right', 1, 0, 'ArrowRight'],
    ['up', 0, 1, 'ArrowUp'],
    ['down', 0, -1, 'ArrowDown'],
  ] as const;
  for (const [name, horizontal, vertical, shortcut] of directions) {
    const textureShift = (ctx: EditorCommandContext, amount: number): boolean => {
      if (ctx.editor.selectedFaces.length === 0) return false;
      ctx.editor.shiftTexture(horizontal * amount, -vertical * amount);
      return true;
    };
    commands.push(
      { id: `selection.nudge-${name}`, label: `Nudge ${name}`, defaultShortcut: shortcut, enabled: hasSelection, execute: ctx => nudge(ctx, horizontal, vertical, 'normal') },
      { id: `selection.nudge-${name}-fine`, label: `Nudge ${name} (Fine)`, defaultShortcut: `Mod+${shortcut}`, alternateShortcuts: [`Mod+Shift+${shortcut}`], enabled: hasSelection, execute: ctx => { if (!textureShift(ctx, 1)) nudge(ctx, horizontal, vertical, 'fine'); } },
      { id: `selection.nudge-${name}-large`, label: `Nudge ${name} (Large)`, defaultShortcut: `Shift+${shortcut}`, enabled: hasSelection, execute: ctx => { if (!textureShift(ctx, 8)) nudge(ctx, horizontal, vertical, 'large'); } },
    );
  }
  return commands;
}

export function createEditorCommandRegistry(context: EditorCommandContext): CommandRegistry<EditorCommandContext> {
  const registry = new CommandRegistry(context);
  registry.registerAll(createEditorCommands());
  return registry;
}
