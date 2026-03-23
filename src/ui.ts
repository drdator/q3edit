import { Editor, Tool, InvisibleMode } from './editor';
import { Entity, ENTITY_CLASSES } from './entity';
import { TextureManager } from './textures';
import { Vec3 } from './math';
import { PropertiesPanel } from './properties-panel';
import { Brush } from './brush';
import { Patch } from './patch';

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

    const tools: { id: Tool; label: string }[] = [
      { id: 'select', label: 'SEL' },
      { id: 'create', label: 'BOX' },
      { id: 'entity', label: 'ENT' },
      { id: 'clip', label: 'CLIP' },
    ];

    for (const tool of tools) {
      const btn = document.createElement('div');
      btn.className = 'tool-btn' + (tool.id === this.editor.activeTool ? ' active' : '');
      btn.textContent = tool.label;
      btn.dataset.tool = tool.id;
      btn.addEventListener('mousedown', () => this.setTool(tool.id));
      bar.appendChild(btn);
    }

    bar.appendChild(this.createSeparator());

    // Grid display
    const gridLabel = document.createElement('div');
    gridLabel.className = 'tool-btn';
    gridLabel.id = 'grid-label';
    gridLabel.textContent = `G:${this.editor.gridSize}`;
    gridLabel.addEventListener('mousedown', () => this.increaseGrid());
    bar.appendChild(gridLabel);

    // Snap toggle
    const snapBtn = document.createElement('div');
    snapBtn.className = 'tool-btn active';
    snapBtn.id = 'snap-toggle';
    snapBtn.textContent = 'SNAP';
    snapBtn.title = 'Toggle grid snapping (hold Ctrl to temporarily disable)';
    snapBtn.addEventListener('mousedown', () => this.toggleSnap());
    bar.appendChild(snapBtn);

    bar.appendChild(this.createSeparator());

    // Invisible geometry mode
    const invisBtn = document.createElement('div');
    invisBtn.className = 'tool-btn';
    invisBtn.id = 'invis-toggle';
    invisBtn.textContent = 'INVIS';
    invisBtn.title = 'Cycle invisible geometry mode: show / dim / hide — I';
    invisBtn.addEventListener('mousedown', () => this.cycleInvisibleMode());
    bar.appendChild(invisBtn);

    bar.appendChild(this.createSeparator());

    // Action buttons
    const actions = [
      { label: 'DEL', action: () => this.editor.deleteSelection() },
      { label: 'DUP', action: () => this.editor.duplicateSelection() },
      { label: 'UNDO', action: () => this.editor.undo() },
      { label: 'REDO', action: () => this.editor.redo() },
    ];

    for (const a of actions) {
      const btn = document.createElement('div');
      btn.className = 'tool-btn';
      btn.textContent = a.label;
      btn.addEventListener('mousedown', () => a.action());
      bar.appendChild(btn);
    }
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
    for (const cls of ENTITY_CLASSES) {
      const opt = document.createElement('option');
      opt.value = cls;
      opt.textContent = cls;
      if (cls === this.editor.currentEntityClass) opt.selected = true;
      select.appendChild(opt);
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

    const label = document.createElement('label');
    label.textContent = 'Current Texture';
    body.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'texture-input';
    input.value = this.editor.currentTexture;
    input.addEventListener('change', () => {
      this.editor.setTexture(input.value);
    });
    body.appendChild(input);

    const listLabel = document.createElement('label');
    listLabel.textContent = 'Common Textures';
    listLabel.style.marginTop = '8px';
    body.appendChild(listLabel);

    const list = document.createElement('div');
    list.className = 'texture-list';

    for (const tex of COMMON_TEXTURES) {
      const item = document.createElement('div');
      item.className = 'texture-item' + (tex === this.editor.currentTexture ? ' selected' : '');
      item.textContent = tex;
      item.addEventListener('mousedown', () => {
        this.editor.setTexture(tex);
        input.value = tex;
        // Update selection state
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

      if (ctrl && e.key === 'z') { e.preventDefault(); this.editor.undo(); return; }
      if (ctrl && e.key === 'y') { e.preventDefault(); this.editor.redo(); return; }
      if (ctrl && e.key === 'Z') { e.preventDefault(); this.editor.redo(); return; }
      if (ctrl && e.key === 's') { e.preventDefault(); this.editor.saveMapToFile(); return; }
      if (ctrl && e.key === 'o') { e.preventDefault(); this.editor.openMapFromFile(); return; }
      if (ctrl && e.key === 'a') { e.preventDefault(); this.editor.selectAll(); return; }
      if (ctrl && e.key === 'd') { e.preventDefault(); this.editor.duplicateSelection(); return; }
      if (ctrl && e.key === 'g') { e.preventDefault(); this.editor.snapSelectionToGrid(); return; }

      if (e.key === 'Escape') {
        if (this.editor.vertexMode) {
          this.handleExitVertexMode();
        } else if (this.editor.patchEditMode) {
          this.editor.exitPatchEditMode();
        } else if (this.editor.activeTool === 'clip' && this.editor.clipPoints.length > 0) {
          this.editor.cancelClip();
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
    this.editor.snapToGrid = !this.editor.snapToGrid;
    this.editor.dirty = true;
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
    document.getElementById('status-grid')!.textContent = `Grid: ${e.gridSize}${e.snapToGrid ? '' : ' (free)'}`;
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
    document.getElementById('grid-label')!.textContent = `G:${e.gridSize}`;
    document.getElementById('snap-toggle')!.classList.toggle('active', e.snapToGrid);
    const invisBtn = document.getElementById('invis-toggle')!;
    const invisLabels: Record<InvisibleMode, string> = { show: 'INVIS', dim: 'DIM', hide: 'HIDE' };
    invisBtn.textContent = invisLabels[e.invisibleMode];
    invisBtn.classList.toggle('active', e.invisibleMode !== 'show');

    // Gizmo mode indicator (only when selection exists)
    const gizmoEl = document.getElementById('status-gizmo');
    if (gizmoEl) {
      gizmoEl.textContent = e.selection.length > 0 ? `3D: ${e.gizmoMode} (W/E)` : '';
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

    const label = document.createElement('label');
    label.textContent = 'Current Texture';
    body.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'texture-input';
    input.value = this.editor.currentTexture;
    input.addEventListener('change', () => {
      this.editor.setTexture(input.value);
    });
    body.appendChild(input);

    // Directory selector + view toggle row
    const dirRow = document.createElement('div');
    dirRow.style.display = 'flex';
    dirRow.style.alignItems = 'center';
    dirRow.style.marginTop = '6px';
    dirRow.style.gap = '4px';

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
      if (query) {
        const filtered = allTextures.filter(t => t.toLowerCase().includes(query));
        this.populateTextureList(list, filtered, input);
        return;
      }
      const dir = dirSelect.value;
      const textures = dir ? texMgr.listTexturesInDir(dir) : COMMON_TEXTURES;
      this.populateTextureList(list, textures, input);
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

  private populateTextureList(list: HTMLElement, textures: string[], input: HTMLInputElement): void {
    list.innerHTML = '';

    if (this.showTextureThumbnails && this.texMgr) {
      list.classList.add('texture-grid');
    } else {
      list.classList.remove('texture-grid');
    }

    for (const tex of textures) {
      const item = document.createElement('div');
      item.className = 'texture-item' + (tex === this.editor.currentTexture ? ' selected' : '');

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
        name.textContent = tex.replace(/^textures\//, '').split('/').pop() || tex;
        item.appendChild(name);
      } else {
        item.textContent = tex.replace(/^textures\//, '');
      }

      item.addEventListener('mousedown', () => {
        this.editor.setTexture(tex);
        input.value = tex;
        list.querySelectorAll('.texture-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
      });
      list.appendChild(item);
    }
  }
}
