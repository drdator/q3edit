import { Editor, Tool } from './editor';

type MenuItem =
  | { label: string | (() => string); shortcut?: string; action?: () => void | Promise<void>; separator?: boolean }
  | { separator: true; label?: undefined; shortcut?: undefined; action?: undefined };

export interface MenuBarContext {
  editor: Editor;
  getOpenMenu: () => HTMLElement | null;
  setOpenMenu: (menu: HTMLElement | null) => void;
  closeMenus: () => void;
  compileBSP: () => void | Promise<void>;
  cycleInvisibleMode: () => void;
  setTool: (tool: Tool) => void;
  setGrid: (size: number) => void;
  increaseGrid: () => void;
  decreaseGrid: () => void;
}

export function buildMenuBar(ctx: MenuBarContext): () => void {
  const bar = document.getElementById('menubar')!;
  const refreshLabels: (() => void)[] = [];
  const menus: Record<string, MenuItem[]> = {
    'File': [
      { label: 'New', shortcut: 'Ctrl+N', action: () => { ctx.editor.newMap(); ctx.editor.createDefaultMap(); } },
      { separator: true },
      { label: 'Open...', shortcut: 'Ctrl+O', action: () => ctx.editor.openMapFromFile() },
      { label: 'Save', shortcut: 'Ctrl+S', action: () => ctx.editor.saveMapToFile() },
      { separator: true },
      { label: 'Import Prefab...', action: () => ctx.editor.importPrefabFromFile() },
      { label: 'Save Selection as Prefab', action: () => ctx.editor.saveSelectionAsPrefab() },
      { separator: true },
      { label: 'Export .map to Console', action: () => console.log(ctx.editor.serializeMap()) },
      { separator: true },
      { label: 'Compile BSP...', action: () => ctx.compileBSP() },
    ],
    'Edit': [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: () => ctx.editor.undo() },
      { label: 'Redo', shortcut: 'Ctrl+Y', action: () => ctx.editor.redo() },
      { separator: true },
      { label: 'Copy', shortcut: 'Ctrl+C', action: () => ctx.editor.copySelection() },
      { label: 'Paste', shortcut: 'Ctrl+V', action: () => ctx.editor.pasteClipboard() },
      { separator: true },
      { label: 'Select All', shortcut: 'Ctrl+A', action: () => ctx.editor.selectAll() },
      { label: 'Select All Of Type', action: () => ctx.editor.selectAllOfType() },
      { label: 'Invert Selection', shortcut: 'Ctrl+Shift+I', action: () => ctx.editor.invertSelection() },
      { label: 'Select Touching', action: () => ctx.editor.selectTouching() },
      { label: 'Select Inside', action: () => ctx.editor.selectInside() },
      { label: 'Select Complete Tall', action: () => ctx.editor.selectCompleteTall() },
      { label: 'Select Partial Tall', action: () => ctx.editor.selectPartialTall() },
      { separator: true },
      { label: 'Deselect', shortcut: 'Esc', action: () => ctx.editor.clearSelection() },
      { label: 'Hide Selected', shortcut: 'H', action: () => ctx.editor.hideSelected() },
      { label: 'Show Hidden', shortcut: 'Shift+H', action: () => ctx.editor.showHidden() },
      { separator: true },
      { label: 'Make Detail', action: () => ctx.editor.makeDetail() },
      { label: 'Make Structural', action: () => ctx.editor.makeStructural() },
      { separator: true },
      { label: 'Group Selection', shortcut: 'Ctrl+Shift+G', action: () => ctx.editor.groupSelectionIntoEntity() },
      { label: 'Move to Worldspawn', shortcut: 'Ctrl+Shift+U', action: () => ctx.editor.moveSelectionToWorldspawn() },
      { label: 'Connect Entities', shortcut: 'Ctrl+K', action: () => ctx.editor.connectSelectedEntities() },
      { separator: true },
      { label: 'Duplicate', shortcut: 'Ctrl+D', action: () => ctx.editor.duplicateSelection() },
      { label: 'Delete', shortcut: 'Del', action: () => ctx.editor.deleteSelection() },
      { separator: true },
      { label: 'Rotate 90°', shortcut: 'R', action: () => ctx.editor.rotateSelection(90) },
      { label: 'Rotate 15°', shortcut: 'Shift+R', action: () => ctx.editor.rotateSelection(15) },
      { label: 'Flip X', shortcut: 'Shift+X', action: () => ctx.editor.flipSelection(0) },
      { label: 'Flip Y', shortcut: 'Shift+Y', action: () => ctx.editor.flipSelection(1) },
      { label: 'Flip Z', shortcut: 'Shift+Z', action: () => ctx.editor.flipSelection(2) },
    ],
    'View': [
      { label: 'Texture Lock', shortcut: 'T', action: () => ctx.editor.toggleTextureLock() },
      { label: 'Cycle Invisible Mode', shortcut: 'I', action: () => ctx.cycleInvisibleMode() },
      {
        label: 'Render Selected Only',
        action: () => {
          ctx.editor.renderSelectedOnly = !ctx.editor.renderSelectedOnly;
          ctx.editor.dirty = true;
        },
      },
    ],
    'Region': [
      { label: 'Set From Selection', action: () => ctx.editor.setRegionFromSelection() },
      { label: 'Region Off', action: () => ctx.editor.clearRegion() },
    ],
    'Terrain': [
      { label: 'Create Terrain Patch', action: () => ctx.editor.createTerrainPatch() },
      { separator: true },
      { label: 'Raise Terrain', shortcut: 'PgUp', action: () => ctx.editor.raiseTerrain() },
      { label: 'Lower Terrain', shortcut: 'PgDn', action: () => ctx.editor.lowerTerrain() },
      { label: 'Smooth Terrain', shortcut: 'Home', action: () => ctx.editor.smoothTerrain() },
      { separator: true },
      { label: 'Smaller Radius', action: () => ctx.editor.adjustTerrainRadius(-8) },
      { label: 'Larger Radius', action: () => ctx.editor.adjustTerrainRadius(8) },
      { label: 'Weaker Brush', action: () => ctx.editor.adjustTerrainStrength(-2) },
      { label: 'Stronger Brush', action: () => ctx.editor.adjustTerrainStrength(2) },
      {
        label: () => `Falloff: ${ctx.editor.terrainFalloff === 'smooth' ? 'Smooth' : 'Linear'}`,
        action: () => ctx.editor.cycleTerrainFalloff(),
      },
    ],
    'Tools': [
      { label: 'Select', shortcut: '1', action: () => ctx.setTool('select') },
      { label: 'Create Brush', shortcut: '2', action: () => ctx.setTool('create') },
      { label: 'Place Entity', shortcut: '3', action: () => ctx.setTool('entity') },
      { label: 'Clip', shortcut: '4', action: () => ctx.setTool('clip') },
      { label: 'Rotate', shortcut: '5', action: () => ctx.setTool('rotate') },
    ],
    'CSG': [
      { label: 'CSG Subtract', shortcut: 'Shift+Ctrl+S', action: () => ctx.editor.csgSubtract() },
      { label: 'Make Hollow', shortcut: 'Shift+Ctrl+H', action: () => ctx.editor.csgHollow() },
      { label: 'Merge Brushes', shortcut: 'Shift+Ctrl+M', action: () => ctx.editor.csgMerge() },
    ],
    'Grid': [
      { label: 'Grid 1', action: () => ctx.setGrid(1) },
      { label: 'Grid 2', action: () => ctx.setGrid(2) },
      { label: 'Grid 4', action: () => ctx.setGrid(4) },
      { label: 'Grid 8', action: () => ctx.setGrid(8) },
      { label: 'Grid 16', action: () => ctx.setGrid(16) },
      { label: 'Grid 32', action: () => ctx.setGrid(32) },
      { label: 'Grid 64', action: () => ctx.setGrid(64) },
      { separator: true },
      { label: 'Smaller Grid', shortcut: '[', action: () => ctx.decreaseGrid() },
      { label: 'Larger Grid', shortcut: ']', action: () => ctx.increaseGrid() },
    ],
  };

  for (const [name, items] of Object.entries(menus)) {
    const menuItem = document.createElement('div');
    menuItem.className = 'menu-item';
    menuItem.textContent = name;

    const dropdown = document.createElement('div');
    dropdown.className = 'menu-dropdown';

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'menu-separator';
        dropdown.appendChild(sep);
        continue;
      }

      const action = document.createElement('div');
      action.className = 'menu-action';
      const label = document.createElement('span');
      const refreshLabel = () => {
        label.textContent = typeof item.label === 'function' ? item.label() : item.label;
      };
      refreshLabel();
      refreshLabels.push(refreshLabel);
      action.appendChild(label);
      if (item.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'shortcut';
        shortcut.textContent = item.shortcut;
        action.appendChild(shortcut);
      }
      action.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        ctx.closeMenus();
        item.action?.();
      });
      dropdown.appendChild(action);
    }

    menuItem.appendChild(dropdown);

    menuItem.addEventListener('mouseenter', () => {
      const openMenu = ctx.getOpenMenu();
      if (openMenu && openMenu !== menuItem) {
        for (const refreshLabel of refreshLabels) refreshLabel();
        openMenu.classList.remove('open');
        menuItem.classList.add('open');
        ctx.setOpenMenu(menuItem);
      }
    });

    menuItem.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (ctx.getOpenMenu() === menuItem) {
        ctx.closeMenus();
      } else {
        for (const refreshLabel of refreshLabels) refreshLabel();
        ctx.closeMenus();
        menuItem.classList.add('open');
        ctx.setOpenMenu(menuItem);
      }
    });

    bar.appendChild(menuItem);
  }

  document.addEventListener('mousedown', () => ctx.closeMenus());
  return () => {
    for (const refreshLabel of refreshLabels) refreshLabel();
  };
}
