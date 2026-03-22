import { Editor, Tool } from './editor';
import { Entity, ENTITY_CLASSES } from './entity';
import { TextureManager } from './textures';
import { Vec3 } from './math';
import { PropertiesPanel } from './properties-panel';
import { Brush } from './brush';

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
    this.buildBrushPanel();
    this.buildEntityPanel();
    this.buildTexturePanel();
  }

  private buildBrushPanel(): void {
    const body = document.getElementById('brush-body')!;

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
      if (ev.target === body) this.editor.clearSelection();
    });
  }

  private updateBrushPanel(): void {
    const list = document.getElementById('brush-list');
    if (!list) return;

    const e = this.editor;

    // Build flat list of entity+brush pairs
    const items: { entity: Entity; brush: Brush; index: number; entityIdx: number }[] = [];
    for (let ei = 0; ei < e.entities.length; ei++) {
      const entity = e.entities[ei];
      for (let bi = 0; bi < entity.brushes.length; bi++) {
        items.push({ entity, brush: entity.brushes[bi], index: bi, entityIdx: ei });
      }
    }

    // Rebuild DOM when item count changes
    if (list.childElementCount !== items.length) {
      list.innerHTML = '';
      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'brush-item';
        el.addEventListener('mousedown', (ev) => {
          e.selectBrush(item.entity, item.brush, ev.ctrlKey || ev.metaKey || ev.shiftKey);
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
      const selected = e.isSelected(item.brush);
      const isWorldspawn = item.entityIdx === 0;
      const label = item.brush.name || `brush ${item.index}`;
      const entityLabel = isWorldspawn ? '' : ` <span class="brush-entity">[${item.entity.classname}]</span>`;
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

      // Toggle vertex editing mode
      if (e.key === 'v' && !ctrl) {
        if (this.editor.vertexMode) {
          this.handleExitVertexMode();
        } else if (this.editor.selection.length > 0) {
          this.editor.enterVertexMode();
        }
        return;
      }

      if (e.key === '[') { this.decreaseGrid(); return; }
      if (e.key === ']') { this.increaseGrid(); return; }

      // Clip tool: Enter to execute, Tab to cycle mode
      if (e.key === 'Enter' && this.editor.activeTool === 'clip') { this.editor.executeClip(); return; }
      if (e.key === 'Tab' && this.editor.activeTool === 'clip') { e.preventDefault(); this.editor.cycleClipMode(); return; }

      // Focus on selection
      if (e.key === 'f' && !ctrl) { this.editor.centerOnSelection(); return; }

      // Gizmo mode: W = move, E = scale
      if (e.key === 'w' && !ctrl) { this.editor.gizmoMode = 'move'; this.editor.dirty = true; return; }
      if (e.key === 'e' && !ctrl) { this.editor.gizmoMode = 'scale'; this.editor.dirty = true; return; }

      // Rotation: R = 90°, Shift+R = 15°
      if (e.key === 'r' && !ctrl) { this.editor.rotateSelection(90); return; }
      if (e.key === 'R' && !ctrl) { this.editor.rotateSelection(15); return; }

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

  // ── Update UI state ──

  update(): void {
    const e = this.editor;

    document.getElementById('status-msg')!.textContent = e.statusMessage;
    let toolLabel: string;
    if (e.vertexMode) {
      toolLabel = 'Tool: vertex';
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

    // Directory selector
    const dirLabel = document.createElement('label');
    dirLabel.textContent = 'Texture Folder';
    dirLabel.style.marginTop = '6px';
    body.appendChild(dirLabel);

    const dirSelect = document.createElement('select');
    dirSelect.id = 'texture-dir-select';
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
    body.appendChild(dirSelect);

    const list = document.createElement('div');
    list.className = 'texture-list';
    list.id = 'texture-list';
    body.appendChild(list);

    // Show common textures initially
    this.populateTextureList(list, COMMON_TEXTURES, input);

    dirSelect.addEventListener('change', () => {
      const dir = dirSelect.value;
      if (!dir) {
        this.populateTextureList(list, COMMON_TEXTURES, input);
        return;
      }
      const textures = texMgr.listTexturesInDir(dir);
      this.populateTextureList(list, textures, input);
    });
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
    for (const tex of textures) {
      const item = document.createElement('div');
      item.className = 'texture-item' + (tex === this.editor.currentTexture ? ' selected' : '');
      // Strip 'textures/' prefix for display
      item.textContent = tex.replace(/^textures\//, '');
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
