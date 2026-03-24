import { Editor, Tool, InvisibleMode } from './editor';
import { Entity, ENTITY_CATEGORIES } from './entity';
import { TextureManager } from './textures';
import { Vec3 } from './math';
import { PropertiesPanel } from './properties-panel';
import { Brush } from './brush';
import { Patch } from './patch';
import { compileMap } from './q3map';
import '@phosphor-icons/web/regular';

const COMMON_TEXTURES = [
  'common/caulk',
  'common/clip',
  'common/trigger',
  'common/nodraw',
  'base_wall/basewall03',
  'base_wall/basewall04',
  'base_wall/concrete',
  'base_floor/concrete',
  'base_floor/diamond2c',
  'base_floor/pjgrate1',
  'base_trim/pewter_shiney',
  'base_trim/basemetalsupport',
  'gothic_wall/iron01_e',
  'gothic_wall/skull4',
  'gothic_floor/blocks15',
  'gothic_trim/baseboard09_e',
  'skies/toxicsky',
];

export class UI {
  editor: Editor;
  private openMenu: HTMLElement | null = null;
  private propertiesPanel: PropertiesPanel;
  private texMgr: TextureManager | null = null;
  private showTextureThumbnails = false;

  constructor(editor: Editor) {
    this.editor = editor;
    this.propertiesPanel = new PropertiesPanel(editor);
    this.buildMenuBar();
    this.buildToolbar();
    this.buildSidePanel();
    this.buildStatusBar();
    this.setupKeyboard();

    this.editor.onLocateTexture = (texture: string) => this.locateTexture(texture);
  }

  // ── Menu Bar ──

  private buildMenuBar(): void {
    const bar = document.getElementById('menubar')!;

    type MenuItem = { label: string; shortcut?: string; action?: () => void; separator?: boolean } | { separator: true; label?: undefined; shortcut?: undefined; action?: undefined };
    const menus: Record<string, MenuItem[]> = {
      'File': [
        { label: 'New', shortcut: 'Ctrl+N', action: () => { this.editor.newMap(); this.editor.createDefaultMap(); } },
        { separator: true },
        { label: 'Open...', shortcut: 'Ctrl+O', action: () => this.editor.openMapFromFile() },
        { label: 'Save', shortcut: 'Ctrl+S', action: () => this.editor.saveMapToFile() },
        { separator: true },
        { label: 'Export .map to Console', action: () => console.log(this.editor.serializeMap()) },
        { separator: true },
        { label: 'Compile BSP...', action: () => this.compileBSP() },
      ],
      'Edit': [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: () => this.editor.undo() },
        { label: 'Redo', shortcut: 'Ctrl+Y', action: () => this.editor.redo() },
        { separator: true },
        { label: 'Select All', shortcut: 'Ctrl+A', action: () => this.editor.selectAll() },
        { label: 'Deselect', shortcut: 'Esc', action: () => this.editor.clearSelection() },
        { separator: true },
        { label: 'Duplicate', shortcut: 'Ctrl+D', action: () => this.editor.duplicateSelection() },
        { label: 'Delete', shortcut: 'Del', action: () => this.editor.deleteSelection() },
        { separator: true },
        { label: 'Rotate 90°', shortcut: 'R', action: () => this.editor.rotateSelection(90) },
        { label: 'Rotate 15°', shortcut: 'Shift+R', action: () => this.editor.rotateSelection(15) },
      ],
      'View': [
        { label: 'Cycle Invisible Mode', shortcut: 'I', action: () => this.cycleInvisibleMode() },
        { label: 'Render Selected Only', action: () => {
          this.editor.renderSelectedOnly = !this.editor.renderSelectedOnly;
          this.editor.dirty = true;
        }},
      ],
      'Tools': [
        { label: 'Select', shortcut: '1', action: () => this.setTool('select') },
        { label: 'Create Brush', shortcut: '2', action: () => this.setTool('create') },
        { label: 'Place Entity', shortcut: '3', action: () => this.setTool('entity') },
        { label: 'Clip', shortcut: '4', action: () => this.setTool('clip') },
        { label: 'Rotate', shortcut: '5', action: () => this.setTool('rotate') },
      ],
      'CSG': [
        { label: 'CSG Subtract', shortcut: 'Shift+Ctrl+S', action: () => this.editor.csgSubtract() },
        { label: 'Make Hollow', shortcut: 'Shift+Ctrl+H', action: () => this.editor.csgHollow() },
        { label: 'Merge Brushes', shortcut: 'Shift+Ctrl+M', action: () => this.editor.csgMerge() },
      ],
      'Grid': [
        { label: 'Grid 1', action: () => this.setGrid(1) },
        { label: 'Grid 2', action: () => this.setGrid(2) },
        { label: 'Grid 4', action: () => this.setGrid(4) },
        { label: 'Grid 8', action: () => this.setGrid(8) },
        { label: 'Grid 16', action: () => this.setGrid(16) },
        { label: 'Grid 32', action: () => this.setGrid(32) },
        { label: 'Grid 64', action: () => this.setGrid(64) },
        { separator: true },
        { label: 'Smaller Grid', shortcut: '[', action: () => this.decreaseGrid() },
        { label: 'Larger Grid', shortcut: ']', action: () => this.increaseGrid() },
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
        action.innerHTML = `<span>${item.label}</span>` +
          (item.shortcut ? `<span class="shortcut">${item.shortcut}</span>` : '');
        action.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.closeMenus();
          item.action?.();
        });
        dropdown.appendChild(action);
      }

      menuItem.appendChild(dropdown);

      menuItem.addEventListener('mouseenter', () => {
        if (this.openMenu && this.openMenu !== menuItem) {
          this.openMenu.classList.remove('open');
          menuItem.classList.add('open');
          this.openMenu = menuItem;
        }
      });

      menuItem.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (this.openMenu === menuItem) {
          this.closeMenus();
        } else {
          this.closeMenus();
          menuItem.classList.add('open');
          this.openMenu = menuItem;
        }
      });

      bar.appendChild(menuItem);
    }

    // Close menus when clicking elsewhere
    document.addEventListener('mousedown', () => this.closeMenus());
  }

  private closeMenus(): void {
    if (this.openMenu) {
      this.openMenu.classList.remove('open');
      this.openMenu = null;
    }
  }

  // ── Toolbar ──

  private buildToolbar(): void {
    const bar = document.getElementById('toolbar')!;

    const icon = (name: string, weight: string = 'regular'): string =>
      `<i class="ph${weight === 'regular' ? '' : '-' + weight} ph-${name}"></i>`;

    const addBtn = (opts: {
      id?: string;
      icon: string;
      title: string;
      active?: boolean;
      dataset?: Record<string, string>;
      onClick: () => void;
    }) => {
      const btn = document.createElement('div');
      btn.className = 'tool-btn' + (opts.active ? ' active' : '');
      if (opts.id) btn.id = opts.id;
      btn.innerHTML = opts.icon;
      btn.title = opts.title;
      if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) btn.dataset[k] = v;
      btn.addEventListener('mousedown', () => opts.onClick());
      bar.appendChild(btn);
      return btn;
    };

    // ── Tools ──
    const tools: { id: Tool; icon: string; title: string }[] = [
      { id: 'select', icon: icon('cursor'),             title: 'Select (1)' },
      { id: 'create', icon: icon('cube'),               title: 'Create Brush (2)' },
      { id: 'entity', icon: icon('map-pin'),            title: 'Place Entity (3)' },
      { id: 'clip',   icon: icon('scissors'),           title: 'Clip (4)' },
      { id: 'rotate', icon: icon('arrows-clockwise'),   title: 'Rotate (5)' },
    ];

    for (const tool of tools) {
      addBtn({
        icon: tool.icon,
        title: tool.title,
        active: tool.id === this.editor.activeTool,
        dataset: { tool: tool.id },
        onClick: () => this.setTool(tool.id),
      });
    }

    bar.appendChild(this.createSeparator());

    // ── Gizmo modes ──
    addBtn({
      id: 'gizmo-move',
      icon: icon('arrows-out-cardinal'),
      title: 'Move mode (W)',
      active: this.editor.gizmoMode === 'move',
      onClick: () => { this.editor.gizmoMode = 'move'; this.editor.dirty = true; },
    });
    addBtn({
      id: 'gizmo-scale',
      icon: icon('resize'),
      title: 'Scale mode (E)',
      active: this.editor.gizmoMode === 'scale',
      onClick: () => { this.editor.gizmoMode = 'scale'; this.editor.dirty = true; },
    });

    bar.appendChild(this.createSeparator());

    // ── Grid / Snap ──
    const gridBtn = addBtn({
      id: 'grid-label',
      icon: `<span class="tool-label">G:${this.editor.gridSize}</span>`,
      title: 'Grid size (click to increase, [ / ])',
      onClick: () => this.increaseGrid(),
    });

    addBtn({
      id: 'snap-toggle',
      icon: icon('magnet-straight'),
      title: 'Cycle grid snap: off / absolute / relative',
      active: true,
      onClick: () => this.toggleSnap(),
    });

    addBtn({
      id: 'geosnap-toggle',
      icon: icon('polygon'),
      title: 'Geometry snap (G)',
      onClick: () => this.toggleGeoSnap(),
    });

    bar.appendChild(this.createSeparator());

    // ── View ──
    addBtn({
      id: 'invis-toggle',
      icon: icon('eye'),
      title: 'Invisible geometry: show / dim / hide (I)',
      onClick: () => this.cycleInvisibleMode(),
    });

    bar.appendChild(this.createSeparator());

    // ── CSG ──
    addBtn({
      icon: icon('subtract'),
      title: 'CSG Subtract (Ctrl+Shift+S)',
      onClick: () => this.editor.csgSubtract(),
    });
    addBtn({
      icon: icon('selection'),
      title: 'Make Hollow (Ctrl+Shift+H)',
      onClick: () => this.editor.csgHollow(),
    });
    addBtn({
      icon: icon('unite'),
      title: 'Merge Brushes (Ctrl+Shift+M)',
      onClick: () => this.editor.csgMerge(),
    });

    bar.appendChild(this.createSeparator());

    // ── Actions ──
    addBtn({
      icon: icon('trash'),
      title: 'Delete (Del)',
      onClick: () => this.editor.deleteSelection(),
    });
    addBtn({
      icon: icon('copy'),
      title: 'Duplicate (Ctrl+D)',
      onClick: () => this.editor.duplicateSelection(),
    });
    addBtn({
      icon: icon('arrow-counter-clockwise'),
      title: 'Undo (Ctrl+Z)',
      onClick: () => this.editor.undo(),
    });
    addBtn({
      icon: icon('arrow-clockwise'),
      title: 'Redo (Ctrl+Y)',
      onClick: () => this.editor.redo(),
    });
  }

  private createSeparator(): HTMLElement {
    const sep = document.createElement('div');
    sep.className = 'tool-separator';
    return sep;
  }

  // ── Side Panel ──

  private buildSidePanel(): void {
    // Add collapse toggles to all panel headers
    for (const header of document.querySelectorAll('#sidepanel .panel-header')) {
      const toggle = document.createElement('span');
      toggle.className = 'panel-toggle';
      toggle.textContent = '\u2212';
      header.appendChild(toggle);
      header.addEventListener('mousedown', () => {
        const panel = header.parentElement!;
        panel.classList.toggle('collapsed');
        toggle.textContent = panel.classList.contains('collapsed') ? '+' : '\u2212';
      });
    }

    this.buildBrushPanel();
    this.buildEntityPanel();
    this.buildTexturePanel();
  }

  private brushPanelMode: 'all' | 'brushes' | 'patches' | 'entities' = 'all';
  private brushPanelItemCount = -1;

  private buildBrushPanel(): void {
    const body = document.getElementById('brush-body')!;
    const modeSelect = document.getElementById('brush-panel-mode') as HTMLSelectElement;

    modeSelect.addEventListener('change', () => {
      this.brushPanelMode = modeSelect.value as typeof this.brushPanelMode;
      this.editor.selectionFilter = this.brushPanelMode;
      this.brushPanelItemCount = -1; // force rebuild
      this.editor.dirty = true;
    });
    // Stop click from toggling panel collapse
    modeSelect.addEventListener('mousedown', (ev) => ev.stopPropagation());

    // Add hamburger icon before the select
    const icon = document.createElement('span');
    icon.className = 'panel-dropdown-icon';
    icon.textContent = '\u2630';
    modeSelect.before(icon);

    const filterBtn = document.createElement('div');
    filterBtn.className = 'btn';
    filterBtn.id = 'brush-filter-btn';
    filterBtn.textContent = 'Render: All';
    filterBtn.addEventListener('mousedown', () => {
      this.editor.renderSelectedOnly = !this.editor.renderSelectedOnly;
      filterBtn.textContent = this.editor.renderSelectedOnly ? 'Render: Selected' : 'Render: All';
      this.editor.dirty = true;
    });
    body.appendChild(filterBtn);

    const list = document.createElement('div');
    list.className = 'brush-list';
    list.id = 'brush-list';
    body.appendChild(list);

    body.addEventListener('mousedown', (ev) => {
      if (ev.target !== body) return;
      // Don't clear selection when clicking the scrollbar
      if (ev.offsetX >= body.clientWidth) return;
      this.editor.clearSelection();
    });
  }

  private updateBrushPanel(): void {
    const list = document.getElementById('brush-list');
    if (!list) return;

    const e = this.editor;
    const mode = this.brushPanelMode;

    type ListItem =
      | { kind: 'brush'; entity: Entity; brush: Brush; index: number; entityIdx: number }
      | { kind: 'patch'; entity: Entity; patch: Patch; index: number; entityIdx: number }
      | { kind: 'entity'; entity: Entity; entityIdx: number };

    // Build flat list based on filter mode
    const items: ListItem[] = [];
    for (let ei = 0; ei < e.entities.length; ei++) {
      const entity = e.entities[ei];
      if (mode === 'entities') {
        items.push({ kind: 'entity', entity, entityIdx: ei });
      } else {
        if (mode === 'all' || mode === 'brushes') {
          for (let bi = 0; bi < entity.brushes.length; bi++) {
            items.push({ kind: 'brush', entity, brush: entity.brushes[bi], index: bi, entityIdx: ei });
          }
        }
        if (mode === 'all' || mode === 'patches') {
          for (let pi = 0; pi < entity.patches.length; pi++) {
            items.push({ kind: 'patch', entity, patch: entity.patches[pi], index: pi, entityIdx: ei });
          }
        }
      }
    }

    // Rebuild DOM when item count changes
    if (this.brushPanelItemCount !== items.length) {
      this.brushPanelItemCount = items.length;
      list.innerHTML = '';
      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'brush-item';
        el.addEventListener('mousedown', (ev) => {
          const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;
          if (item.kind === 'brush') {
            e.selectBrush(item.entity, item.brush, additive);
          } else if (item.kind === 'patch') {
            e.selectPatch(item.entity, item.patch, additive);
          } else {
            e.selectEntity(item.entity, additive);
          }
          e.centerOnSelection();
        });
        list.appendChild(el);
      }
    }

    // Update labels and selection state
    const children = list.children;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const el = children[i] as HTMLElement;
      let selected: boolean;
      let label: string;
      if (item.kind === 'brush') {
        selected = e.isSelected(item.brush);
        label = item.brush.name || `brush ${item.index}`;
      } else if (item.kind === 'patch') {
        selected = e.isPatchSelected(item.patch);
        label = `patch ${item.index}`;
      } else {
        selected = e.isEntitySelected(item.entity);
        label = `${item.entity.classname}`;
      }
      const isWorldspawn = item.entityIdx === 0;
      const entityLabel = (item.kind !== 'entity' && !isWorldspawn)
        ? ` <span class="brush-entity">[${item.entity.classname}]</span>`
        : '';
      const html = label + entityLabel;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.classList.toggle('selected', selected);
    }
  }

  private buildEntityPanel(): void {
    const body = document.getElementById('entity-body')!;

    // Entity class selector
    const label = document.createElement('label');
    label.textContent = 'Entity Class';
    body.appendChild(label);

    const select = document.createElement('select');
    select.id = 'entity-class-select';
    for (const cat of ENTITY_CATEGORIES) {
      const group = document.createElement('optgroup');
      group.label = cat.name;
      for (const cls of cat.classes) {
        const opt = document.createElement('option');
        opt.value = cls.classname;
        opt.textContent = cls.classname;
        if (cls.classname === this.editor.currentEntityClass) opt.selected = true;
        group.appendChild(opt);
      }
      select.appendChild(group);
    }
    select.addEventListener('change', () => {
      this.editor.currentEntityClass = select.value;
    });
    body.appendChild(select);

    // Properties area (shown when entity selected)
    const propsDiv = document.createElement('div');
    propsDiv.id = 'entity-props';
    propsDiv.style.marginTop = '8px';
    body.appendChild(propsDiv);
  }

  private buildTexturePanel(): void {
    const body = document.getElementById('texture-body')!;

    const list = document.createElement('div');
    list.className = 'texture-list';

    for (const tex of COMMON_TEXTURES) {
      const item = document.createElement('div');
      item.className = 'texture-item' + (tex === this.editor.currentTexture ? ' selected' : '');
      item.textContent = tex;
      item.addEventListener('mousedown', () => {
        this.editor.setTexture(tex);
        list.querySelectorAll('.texture-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
      });
      list.appendChild(item);
    }

    body.appendChild(list);
  }

  // ── Status Bar ──

  private buildStatusBar(): void {
    const bar = document.getElementById('statusbar')!;
    bar.innerHTML = `
      <span class="status-item" id="status-msg">Ready</span>
      <span class="status-item" id="status-tool">Tool: Select</span>
      <span class="status-item" id="status-grid">Grid: 16</span>
      <span class="status-item" id="status-sel">Sel: 0</span>
      <span class="status-item" id="status-brushes">Brushes: 0</span>
      <span class="status-item" id="status-gizmo"></span>
    `;
  }

  // ── Keyboard shortcuts ──

  private setupKeyboard(): void {
    document.addEventListener('keydown', (e) => {
      // Don't handle shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); this.editor.redo(); return; }
      if (ctrl && e.key === 'z') { e.preventDefault(); this.editor.undo(); return; }
      if (ctrl && e.key === 'y') { e.preventDefault(); this.editor.redo(); return; }
      if (ctrl && e.key === 's') { e.preventDefault(); this.editor.saveMapToFile(); return; }
      if (ctrl && e.key === 'o') { e.preventDefault(); this.editor.openMapFromFile(); return; }
      if (ctrl && e.key === 'a') { e.preventDefault(); this.editor.selectAll(); return; }
      if (ctrl && e.key === 'd') { e.preventDefault(); this.editor.duplicateSelection(); return; }
      if (ctrl && e.key === 'g') { e.preventDefault(); this.editor.snapSelectionToGrid(); return; }

      // CSG operations
      if (ctrl && e.shiftKey && e.key === 'S') { e.preventDefault(); this.editor.csgSubtract(); return; }
      if (ctrl && e.shiftKey && e.key === 'H') { e.preventDefault(); this.editor.csgHollow(); return; }
      if (ctrl && e.shiftKey && e.key === 'M') { e.preventDefault(); this.editor.csgMerge(); return; }

      if (e.key === 'Escape') {
        if (this.editor.vertexMode) {
          this.handleExitVertexMode();
        } else if (this.editor.patchEditMode) {
          this.editor.exitPatchEditMode();
        } else if (this.editor.activeTool === 'clip' && this.editor.clipPoints.length > 0) {
          this.editor.cancelClip();
        } else if (this.editor.activeTool === 'rotate' && this.editor.rotateAnchor) {
          this.editor.rotateAnchor = null;
          this.editor.dirty = true;
        } else {
          this.editor.clearSelection();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { this.editor.deleteSelection(); return; }

      if (e.key === '1') { this.setTool('select'); return; }
      if (e.key === '2') { this.setTool('create'); return; }
      if (e.key === '3') { this.setTool('entity'); return; }
      if (e.key === '4') { this.setTool('clip'); return; }
      if (e.key === '5') { this.setTool('rotate'); return; }

      // Toggle vertex editing mode (V for brushes, V for patches if patches selected)
      if (e.key === 'v' && !ctrl) {
        if (this.editor.vertexMode) {
          this.handleExitVertexMode();
        } else if (this.editor.patchEditMode) {
          this.editor.exitPatchEditMode();
        } else if (this.editor.selection.some(s => s.type === 'patch')) {
          this.editor.enterPatchEditMode();
        } else if (this.editor.selection.length > 0) {
          this.editor.enterVertexMode();
        }
        return;
      }

      if (e.key === '[') { this.decreaseGrid(); return; }
      if (e.key === ']') { this.increaseGrid(); return; }

      // Patch creation: P = flat, Shift+P = cylinder, Ctrl+P = cone, Ctrl+Shift+P = bevel
      if (e.key === 'p' && !ctrl && this.editor.selection.length > 0) {
        this.editor.createPatch('flat'); return;
      }
      if (e.key === 'P' && !ctrl && this.editor.selection.length > 0) {
        this.editor.createPatch('cylinder'); return;
      }
      if (e.key === 'p' && ctrl && !e.shiftKey && this.editor.selection.length > 0) {
        e.preventDefault(); this.editor.createPatch('cone'); return;
      }
      if (e.key === 'p' && ctrl && e.shiftKey && this.editor.selection.length > 0) {
        e.preventDefault(); this.editor.createPatch('bevel'); return;
      }

      // Patch subdivision: +/- to increase/decrease tessellation
      if ((e.key === '+' || e.key === '=') && this.editor.selection.some(s => s.type === 'patch')) {
        this.editor.changeSubdivisions(1); return;
      }
      if ((e.key === '-' || e.key === '_') && this.editor.selection.some(s => s.type === 'patch')) {
        this.editor.changeSubdivisions(-1); return;
      }

      // Clip tool: Enter to execute, Tab to cycle mode
      if (e.key === 'Enter' && this.editor.activeTool === 'clip') { this.editor.executeClip(); return; }
      if (e.key === 'Tab' && this.editor.activeTool === 'clip') { e.preventDefault(); this.editor.cycleClipMode(); return; }

      // Toggle invisible geometry
      if (e.key === 'i' && !ctrl) { this.cycleInvisibleMode(); return; }

      // Toggle geometry snap
      if (e.key === 'g' && !ctrl) { this.toggleGeoSnap(); return; }

      // Focus on selection
      if (e.key === 'f' && !ctrl) { this.editor.centerOnSelection(); return; }

      // Gizmo mode: W = move, E = scale
      if (e.key === 'w' && !ctrl) { this.editor.gizmoMode = 'move'; this.editor.dirty = true; return; }
      if (e.key === 'e' && !ctrl) { this.editor.gizmoMode = 'scale'; this.editor.dirty = true; return; }

      // Rotation: R = 90°, Shift+R = 15°
      if (e.key === 'r' && !ctrl) { this.editor.rotateSelection(90); return; }
      if (e.key === 'R' && !ctrl) { this.editor.rotateSelection(15); return; }

      // Texture shortcuts: Shift+Arrow = shift texture, Ctrl+Shift+Arrow = fine shift
      if (e.key.startsWith('Arrow') && e.shiftKey && this.editor.selectedFaces.length > 0) {
        e.preventDefault();
        const step = ctrl ? 1 : 8;
        const du = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dv = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        this.editor.shiftTexture(du, dv);
        return;
      }

      // Texture fit: Ctrl+Shift+F
      if (e.key === 'F' && ctrl && e.shiftKey) { e.preventDefault(); this.editor.fitTexture(); return; }
      // Texture reset: Ctrl+Shift+N
      if (e.key === 'N' && ctrl && e.shiftKey) { e.preventDefault(); this.editor.resetTextureAlignment(); return; }
      // Texture rotate: Shift+PgUp/PgDn
      if (e.key === 'PageUp' && e.shiftKey) { this.editor.rotateTexture(e.ctrlKey ? 1 : 15); return; }
      if (e.key === 'PageDown' && e.shiftKey) { this.editor.rotateTexture(e.ctrlKey ? -1 : -15); return; }
      // Texture scale: Ctrl+PgUp/PgDn (no Shift)
      if (e.key === 'PageUp' && ctrl && !e.shiftKey) { this.editor.scaleTexture(0.05); return; }
      if (e.key === 'PageDown' && ctrl && !e.shiftKey) { this.editor.scaleTexture(-0.05); return; }

      // Arrow keys: nudge selection (or vertices in vertex mode)
      if (e.key.startsWith('Arrow') && this.editor.selection.length > 0) {
        e.preventDefault();
        const grid = e.ctrlKey ? 1 : e.shiftKey ? this.editor.gridSize * 4 : this.editor.gridSize;
        const delta: Vec3 = [0, 0, 0];
        const h = this.editor.nudgeAxisH;
        const v = this.editor.nudgeAxisV;
        if (e.key === 'ArrowRight') delta[h] = grid;
        else if (e.key === 'ArrowLeft') delta[h] = -grid;
        else if (e.key === 'ArrowUp') delta[v] = grid;
        else if (e.key === 'ArrowDown') delta[v] = -grid;
        this.editor.snapshot();
        if (this.editor.vertexMode && this.editor.vertexSelection.length > 0) {
          this.editor.moveSelectedVertices(delta);
        } else if (this.editor.patchEditMode && this.editor.patchControlSelection.length > 0) {
          this.editor.moveSelectedControlPoints(delta);
        } else {
          this.editor.moveSelection(delta);
        }
        return;
      }
    });
  }

  // ── Tool/Grid helpers ──

  private setTool(tool: Tool): void {
    if (this.editor.activeTool === 'clip' && tool !== 'clip') {
      this.editor.clipPoints = [];
    }
    if (this.editor.activeTool === 'rotate' && tool !== 'rotate') {
      this.editor.rotateAnchor = null;
    }
    this.editor.activeTool = tool;
    this.editor.dirty = true;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(el => {
      el.classList.toggle('active', (el as HTMLElement).dataset.tool === tool);
    });
  }

  private setGrid(size: number): void {
    this.editor.gridSize = size;
    this.editor.createDepth = Math.max(size * 4, 64);
    this.editor.dirty = true;
    this.closeMenus();
  }

  private increaseGrid(): void {
    this.setGrid(Math.min(256, this.editor.gridSize * 2));
  }

  private decreaseGrid(): void {
    this.setGrid(Math.max(1, this.editor.gridSize / 2));
  }

  private toggleSnap(): void {
    const modes: ('off' | 'abs' | 'rel')[] = ['off', 'abs', 'rel'];
    const idx = modes.indexOf(this.editor.gridSnapMode);
    this.editor.gridSnapMode = modes[(idx + 1) % modes.length];
    this.editor.dirty = true;
    const labels = { off: 'Grid snap: OFF', abs: 'Grid snap: absolute', rel: 'Grid snap: relative' };
    this.editor.statusMessage = labels[this.editor.gridSnapMode];
    this.closeMenus();
  }

  private toggleGeoSnap(): void {
    this.editor.snapToGeometry = !this.editor.snapToGeometry;
    this.editor.dirty = true;
    this.editor.statusMessage = this.editor.snapToGeometry ? 'Geometry snap: ON' : 'Geometry snap: OFF';
    this.closeMenus();
  }

  private cycleInvisibleMode(): void {
    const modes: InvisibleMode[] = ['show', 'dim', 'hide'];
    const idx = modes.indexOf(this.editor.invisibleMode);
    this.editor.invisibleMode = modes[(idx + 1) % modes.length];
    this.editor.dirty = true;
    const labels: Record<InvisibleMode, string> = {
      show: 'Invisible: show all',
      dim: 'Invisible: transparent',
      hide: 'Invisible: hidden',
    };
    this.editor.statusMessage = labels[this.editor.invisibleMode];
  }

  // ── Update UI state ──

  update(): void {
    const e = this.editor;

    document.getElementById('status-msg')!.textContent = e.statusMessage;
    let toolLabel: string;
    if (e.vertexMode) {
      toolLabel = 'Tool: vertex';
    } else if (e.patchEditMode) {
      toolLabel = 'Tool: patch edit';
    } else if (e.activeTool === 'clip') {
      toolLabel = `Tool: clip (${e.clipMode}) ${e.clipPoints.length}/2`;
    } else {
      toolLabel = `Tool: ${e.activeTool}`;
    }
    document.getElementById('status-tool')!.textContent = toolLabel;
    const snapLabel = e.gridSnapMode === 'off' ? ' (free)' : e.gridSnapMode === 'abs' ? ' (abs)' : '';
    document.getElementById('status-grid')!.textContent = `Grid: ${e.gridSize}${snapLabel}`;
    let selLabel: string;
    if (e.vertexMode) {
      const vc = e.vertexSelection.length;
      selLabel = `Sel: ${vc} vtx (V to exit)`;
    } else if (e.patchEditMode) {
      const pc = e.patchControlSelection.length;
      selLabel = `Sel: ${pc} cp (V to exit)`;
    } else {
      const faceCount = e.selection.filter(s => s.type === 'face').length;
      selLabel = faceCount > 0
        ? `Sel: ${faceCount} face${faceCount > 1 ? 's' : ''}`
        : `Sel: ${e.selection.length}`;
    }
    document.getElementById('status-sel')!.textContent = selLabel;

    let brushCount = 0;
    for (const entity of e.entities) brushCount += entity.brushes.length;
    document.getElementById('status-brushes')!.textContent = `Brushes: ${brushCount}`;
    document.getElementById('grid-label')!.innerHTML = `<span class="tool-label">G:${e.gridSize}</span>`;
    const snapBtn = document.getElementById('snap-toggle')!;
    const snapTitles = { off: 'Snap: off', abs: 'Snap: absolute', rel: 'Snap: relative' };
    snapBtn.title = snapTitles[e.gridSnapMode];
    snapBtn.classList.toggle('active', e.gridSnapMode !== 'off');
    document.getElementById('geosnap-toggle')!.classList.toggle('active', e.snapToGeometry);
    const invisBtn = document.getElementById('invis-toggle')!;
    const invisIcons: Record<InvisibleMode, string> = {
      show: 'ph ph-eye',
      dim: 'ph ph-eye-slash',
      hide: 'ph ph-eye-closed',
    };
    const invisIcon = invisBtn.querySelector('i');
    if (invisIcon) invisIcon.className = invisIcons[e.invisibleMode];
    invisBtn.classList.toggle('active', e.invisibleMode !== 'show');

    // Gizmo mode toolbar buttons
    document.getElementById('gizmo-move')?.classList.toggle('active', e.gizmoMode === 'move');
    document.getElementById('gizmo-scale')?.classList.toggle('active', e.gizmoMode === 'scale');

    // Gizmo mode indicator (only when selection exists)
    const gizmoEl = document.getElementById('status-gizmo');
    if (gizmoEl) {
      gizmoEl.textContent = e.selection.length > 0 ? `${e.gizmoMode} (W/E)` : '';
    }

    // Update panels
    this.updateBrushPanel();
    this.propertiesPanel.update();
  }

  // ── Texture browser with pak textures ──

  updateTextureBrowser(texMgr: TextureManager): void {
    this.texMgr = texMgr;
    const body = document.getElementById('texture-body')!;
    body.innerHTML = '';

    // Directory selector + view toggle row
    const dirRow = document.createElement('div');
    dirRow.style.display = 'flex';
    dirRow.style.alignItems = 'stretch';
    dirRow.style.gap = '2px';

    const dirSelect = document.createElement('select');
    dirSelect.id = 'texture-dir-select';
    dirSelect.style.flex = '1';
    const dirs = texMgr.listTextureDirectories();
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- select folder --';
    dirSelect.appendChild(defaultOpt);
    for (const dir of dirs) {
      const opt = document.createElement('option');
      opt.value = dir;
      opt.textContent = dir;
      dirSelect.appendChild(opt);
    }
    dirRow.appendChild(dirSelect);

    // View toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'texture-view-toggle';
    toggleBtn.title = 'Toggle thumbnail view';
    toggleBtn.textContent = this.showTextureThumbnails ? 'Aa' : '\u25A3';
    toggleBtn.addEventListener('click', () => {
      this.showTextureThumbnails = !this.showTextureThumbnails;
      toggleBtn.textContent = this.showTextureThumbnails ? 'Aa' : '\u25A3';
      repopulate();
    });
    dirRow.appendChild(toggleBtn);

    body.appendChild(dirRow);

    // Search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'texture-search';
    searchInput.placeholder = 'Search textures...';
    searchInput.style.marginTop = '4px';
    body.appendChild(searchInput);

    const list = document.createElement('div');
    list.className = 'texture-list';
    list.id = 'texture-list';
    body.appendChild(list);

    const allTextures = texMgr.listTextures();

    const repopulate = () => {
      const query = searchInput.value.trim().toLowerCase();
      const dir = dirSelect.value;
      if (query) {
        const filtered = allTextures.filter(t => t.toLowerCase().includes(query));
        this.populateTextureList(list, filtered, null);
        return;
      }
      const textures = dir ? texMgr.listTexturesInDir(dir) : COMMON_TEXTURES;
      this.populateTextureList(list, textures, dir || null);
    };

    // Show common textures initially
    repopulate();

    dirSelect.addEventListener('change', () => {
      searchInput.value = '';
      repopulate();
    });
    searchInput.addEventListener('input', repopulate);
  }

  /** Exit vertex mode with geometry validation. Shows warning dialog if brushes are invalid. */
  handleExitVertexMode(): void {
    const result = this.editor.exitVertexMode();
    if (!result) return;

    const { invalidBrushes } = result;
    const issueLines = invalidBrushes.flatMap(({ result: r }, i) =>
      r.issues.map(issue => `  Brush ${i + 1}: ${issue}`)
    );

    this.showGeometryWarning(issueLines, invalidBrushes);
  }

  /** Select the folder and scroll to a texture in the texture browser panel. */
  private locateTexture(texture: string): void {
    const dirSelect = document.getElementById('texture-dir-select') as HTMLSelectElement | null;
    if (!dirSelect) return;

    // Determine the folder from the texture path (e.g. "base_wall/concrete" -> "base_wall")
    const stripped = texture.replace(/^textures\//, '');
    const slashIdx = stripped.lastIndexOf('/');
    const dir = slashIdx >= 0 ? stripped.slice(0, slashIdx) : '';

    // Find matching option (could be bare name or textures/ prefixed)
    let matched = false;
    for (const opt of Array.from(dirSelect.options)) {
      const optDir = opt.value.replace(/^textures\//, '');
      if (optDir === dir) {
        dirSelect.value = opt.value;
        matched = true;
        break;
      }
    }
    if (!matched) {
      dirSelect.value = '';
    }

    // Trigger repopulation
    dirSelect.dispatchEvent(new Event('change'));

    // Scroll to and highlight the texture
    requestAnimationFrame(() => {
      const list = document.getElementById('texture-list');
      if (!list) return;
      for (const item of Array.from(list.children) as HTMLElement[]) {
        // Match by checking if clicking this item would set the right texture
        // The item stores the full texture name in the mousedown handler,
        // but we can match by checking selected state or text content
        const itemText = item.textContent || '';
        const texName = stripped.slice(slashIdx + 1);
        if (itemText === texName || itemText === stripped || itemText === texture) {
          list.querySelectorAll('.texture-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          item.scrollIntoView({ block: 'center', behavior: 'smooth' });
          break;
        }
      }
    });
  }

  /** Show a warning dialog for invalid brush geometry with Rebuild / Split / Revert options. */
  private showGeometryWarning(issues: string[], invalidBrushes: { brush: Brush; entity: Entity }[]): void {
    const brushes = invalidBrushes.map(b => b.brush);

    // Remove existing dialog if any
    document.getElementById('geom-warning')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'geom-warning';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#2a2a2a;border:1px solid #f80;border-radius:6px;padding:16px 20px;max-width:520px;color:#eee;font:13px/1.5 monospace';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:bold;color:#f80;margin-bottom:8px';
    title.textContent = 'Invalid Brush Geometry';
    dialog.appendChild(title);

    const desc = document.createElement('div');
    desc.style.cssText = 'margin-bottom:12px;color:#ccc';
    desc.textContent = 'This geometry may not compile to a valid BSP:';
    dialog.appendChild(desc);

    const list = document.createElement('pre');
    list.style.cssText = 'background:#1a1a1a;padding:8px;border-radius:4px;margin-bottom:12px;max-height:150px;overflow-y:auto;font-size:12px;color:#fa0;white-space:pre-wrap';
    list.textContent = issues.join('\n');
    dialog.appendChild(list);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';

    const rebuildBtn = document.createElement('button');
    rebuildBtn.textContent = 'Rebuild from planes';
    rebuildBtn.title = 'Recompute the convex brush from face planes — fixes non-convex shapes but may change vertex positions';
    rebuildBtn.style.cssText = 'padding:6px 14px;background:#e80;color:#000;border:none;border-radius:4px;cursor:pointer;font:13px monospace;font-weight:bold';
    rebuildBtn.onclick = () => {
      this.editor.rebuildBrushes(brushes);
      this.editor.statusMessage = 'Rebuilt brush geometry from planes';
      overlay.remove();
    };

    const splitBtn = document.createElement('button');
    splitBtn.textContent = 'Split into convex';
    splitBtn.title = 'Split the brush into multiple convex brushes — preserves vertex positions but creates extra brushes';
    splitBtn.style.cssText = 'padding:6px 14px;background:#08a;color:#fff;border:none;border-radius:4px;cursor:pointer;font:13px monospace;font-weight:bold';
    splitBtn.onclick = () => {
      this.editor.splitBrushesConvex(invalidBrushes);
      this.editor.statusMessage = 'Split into convex brushes';
      overlay.remove();
    };

    const revertBtn = document.createElement('button');
    revertBtn.textContent = 'Revert (undo)';
    revertBtn.title = 'Undo all vertex edits and restore the previous brush state';
    revertBtn.style.cssText = 'padding:6px 14px;background:#555;color:#eee;border:none;border-radius:4px;cursor:pointer;font:13px monospace';
    revertBtn.onclick = () => {
      this.editor.undo();
      this.editor.statusMessage = 'Reverted vertex edits';
      overlay.remove();
    };

    const keepBtn = document.createElement('button');
    keepBtn.textContent = 'Keep as-is';
    keepBtn.title = 'Leave the brush unchanged — may produce BSP compile errors';
    keepBtn.style.cssText = 'padding:6px 14px;background:#333;color:#999;border:1px solid #555;border-radius:4px;cursor:pointer;font:13px monospace';
    keepBtn.onclick = () => {
      this.editor.statusMessage = 'Warning: brush has invalid geometry';
      overlay.remove();
    };

    buttons.appendChild(rebuildBtn);
    buttons.appendChild(splitBtn);
    buttons.appendChild(revertBtn);
    buttons.appendChild(keepBtn);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Focus rebuild button and allow Escape to dismiss
    rebuildBtn.focus();
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        keepBtn.click();
        e.stopPropagation();
      }
    });
  }

  private async compileBSP(): Promise<void> {
    // Remove existing dialog if any
    document.getElementById('compile-dialog')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'compile-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#2a2a2a;border:1px solid #08a;border-radius:6px;padding:16px 20px;width:560px;max-width:90vw;color:#eee;font:13px/1.5 monospace';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:bold;color:#08a;margin-bottom:8px';
    title.textContent = 'Compile BSP';
    dialog.appendChild(title);

    // Quality selector
    const qualityRow = document.createElement('div');
    qualityRow.style.cssText = 'margin-bottom:10px;display:flex;gap:8px;align-items:center';
    const qualityLabel = document.createElement('span');
    qualityLabel.textContent = 'Quality:';
    qualityLabel.style.color = '#aaa';
    const qualitySelect = document.createElement('select');
    qualitySelect.style.cssText = 'background:#1a1a1a;color:#eee;border:1px solid #555;border-radius:4px;padding:4px 8px;font:13px monospace';
    for (const [value, label] of [
      ['fast', 'Fast (BSP only, no lighting)'],
      ['normal', 'Normal (BSP + fast vis + light)'],
      ['full', 'Full (BSP + full vis + light)'],
    ]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === 'normal') opt.selected = true;
      qualitySelect.appendChild(opt);
    }
    qualityRow.appendChild(qualityLabel);
    qualityRow.appendChild(qualitySelect);
    dialog.appendChild(qualityRow);

    const status = document.createElement('div');
    status.style.cssText = 'margin-bottom:8px;color:#ccc';
    status.textContent = '';
    dialog.appendChild(status);

    const log = document.createElement('pre');
    log.style.cssText = 'background:#1a1a1a;padding:8px;border-radius:4px;margin-bottom:12px;height:250px;overflow-y:auto;font-size:11px;color:#aaa;white-space:pre-wrap;word-break:break-all';
    log.textContent = '';
    dialog.appendChild(log);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

    const compileBtn = document.createElement('button');
    compileBtn.textContent = 'Compile';
    compileBtn.style.cssText = 'padding:6px 14px;background:#08a;color:#fff;border:none;border-radius:4px;cursor:pointer;font:13px monospace;font-weight:bold';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:6px 14px;background:#555;color:#eee;border:none;border-radius:4px;cursor:pointer;font:13px monospace';
    closeBtn.onclick = () => overlay.remove();

    const runBtn = document.createElement('button');
    runBtn.textContent = 'Run in ioquake3';
    runBtn.style.cssText = 'padding:6px 14px;background:#0a0;color:#fff;border:none;border-radius:4px;cursor:pointer;font:13px monospace;font-weight:bold;display:none';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save .bsp';
    saveBtn.style.cssText = 'padding:6px 14px;background:#08a;color:#fff;border:none;border-radius:4px;cursor:pointer;font:13px monospace;font-weight:bold;display:none';

    buttons.appendChild(compileBtn);
    buttons.appendChild(runBtn);
    buttons.appendChild(saveBtn);
    buttons.appendChild(closeBtn);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        e.stopPropagation();
      }
    });
    overlay.tabIndex = 0;
    compileBtn.focus();

    // Collect texture data once
    let imageFiles: Map<string, Uint8Array> | undefined;
    if (this.texMgr) {
      imageFiles = new Map();
      const usedTextures = new Set<string>();
      for (const ent of this.editor.entities) {
        for (const brush of ent.brushes) {
          for (const face of brush.faces) usedTextures.add(face.texture);
        }
        for (const patch of ent.patches) usedTextures.add(patch.texture);
      }
      for (const tex of usedTextures) {
        const found = this.texMgr.findImageFile(tex);
        if (found) imageFiles.set(found[0], found[1]);
      }
    }
    const shaderFiles = this.texMgr?.getShaderFiles();

    const doCompile = async () => {
      const quality = qualitySelect.value;
      compileBtn.disabled = true;
      compileBtn.style.display = 'none';
      qualitySelect.disabled = true;
      runBtn.style.display = 'none';
      saveBtn.style.display = 'none';
      status.textContent = 'Compiling...';
      status.style.color = '#ccc';
      title.style.color = '#08a';
      log.textContent = '';

      const mapText = this.editor.serializeMap();

      const result = await compileMap(mapText, {
        args: ['-v'],
        vis: quality !== 'fast',
        visArgs: quality === 'full' ? [] : ['-fast'],
        light: quality !== 'fast',
        shaderFiles,
        imageFiles,
        onOutput: (line) => {
          log.textContent += line + '\n';
          log.scrollTop = log.scrollHeight;
        },
      });

      return result;
    };

    const baseName = this.editor.fileName.replace(/\.map$/, '');

    compileBtn.onclick = async () => {
      const result = await doCompile();

      // Re-enable compile button for recompilation with different settings
      compileBtn.disabled = false;
      compileBtn.style.display = '';
      qualitySelect.disabled = false;

      if (result.success && result.bsp) {
        status.textContent = `Compiled successfully (${(result.bsp.length / 1024).toFixed(1)} KB)`;
        status.style.color = '#0c0';
        title.style.color = '#0c0';

        saveBtn.style.display = '';
        saveBtn.onclick = () => {
          const blob = new Blob([new Uint8Array(result.bsp!)], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = baseName + '.bsp';
          a.click();
          URL.revokeObjectURL(url);
          this.editor.statusMessage = `Saved ${baseName}.bsp`;
        };

        runBtn.style.display = '';
        runBtn.onclick = async () => {
          runBtn.textContent = 'Launching...';
          runBtn.disabled = true;
          try {
            const resp = await fetch('/api/run-map', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: baseName, bsp: Array.from(result.bsp!) }),
            });
            const data = await resp.json();
            if (data.ok) {
              this.editor.statusMessage = `Launched ioquake3 with ${baseName}`;
              runBtn.textContent = 'Launched!';
            } else {
              this.editor.statusMessage = `Launch failed: ${data.error}`;
              runBtn.textContent = 'Failed';
            }
          } catch (e: any) {
            this.editor.statusMessage = `Launch failed: ${e.message}`;
            runBtn.textContent = 'Failed';
          }
          setTimeout(() => { runBtn.textContent = 'Run in ioquake3'; runBtn.disabled = false; }, 2000);
        };

        this.editor.statusMessage = 'BSP compiled successfully';
      } else {
        status.textContent = 'Compilation failed';
        status.style.color = '#f44';
        title.style.color = '#f44';
        this.editor.statusMessage = 'BSP compilation failed';
      }
    };
  }

  private populateTextureList(list: HTMLElement, textures: string[], selectedDir: string | null): void {
    list.innerHTML = '';

    if (this.showTextureThumbnails && this.texMgr) {
      list.classList.add('texture-grid');
    } else {
      list.classList.remove('texture-grid');
    }

    for (const tex of textures) {
      const item = document.createElement('div');
      item.className = 'texture-item' + (tex === this.editor.currentTexture ? ' selected' : '');

      // Strip textures/ prefix, then strip selected dir prefix in list mode
      let displayName = tex.replace(/^textures\//, '');
      if (selectedDir) {
        const prefix = selectedDir.replace(/^textures\//, '') + '/';
        if (displayName.startsWith(prefix)) {
          displayName = displayName.slice(prefix.length);
        }
      }

      if (this.showTextureThumbnails && this.texMgr) {
        item.classList.add('texture-thumb');
        const img = document.createElement('img');
        const url = this.texMgr.getThumbnailUrl(tex);
        if (url) {
          img.src = url;
        }
        item.appendChild(img);
        const name = document.createElement('span');
        name.className = 'texture-thumb-name';
        name.textContent = displayName.split('/').pop() || displayName;
        item.appendChild(name);
      } else {
        item.textContent = displayName;
      }

      item.addEventListener('mousedown', () => {
        this.editor.setTexture(tex);
        list.querySelectorAll('.texture-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
      });
      list.appendChild(item);
    }
  }
}
