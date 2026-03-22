import { Editor, Tool } from './editor';
import { Brush, BrushFace } from './brush';
import { Entity, ENTITY_CLASSES } from './entity';
import { TextureManager } from './textures';
import { Vec3 } from './math';

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

  constructor(editor: Editor) {
    this.editor = editor;
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
    this.buildEntityPanel();
    this.buildTexturePanel();
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

      if (e.key === 'Escape') {
        if (this.editor.activeTool === 'clip' && this.editor.clipPoints.length > 0) {
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

      if (e.key === '[') { this.decreaseGrid(); return; }
      if (e.key === ']') { this.increaseGrid(); return; }

      // Clip tool: Enter to execute, Tab to cycle mode
      if (e.key === 'Enter' && this.editor.activeTool === 'clip') { this.editor.executeClip(); return; }
      if (e.key === 'Tab' && this.editor.activeTool === 'clip') { e.preventDefault(); this.editor.cycleClipMode(); return; }

      // Gizmo mode: W = move, E = scale
      if (e.key === 'w' && !ctrl) { this.editor.gizmoMode = 'move'; this.editor.dirty = true; return; }
      if (e.key === 'e' && !ctrl) { this.editor.gizmoMode = 'scale'; this.editor.dirty = true; return; }

      // Rotation: R = 90°, Shift+R = 15°
      if (e.key === 'r' && !ctrl) { this.editor.rotateSelection(90); return; }
      if (e.key === 'R' && !ctrl) { this.editor.rotateSelection(15); return; }

      // Arrow keys: nudge selection by grid size
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
        this.editor.moveSelection(delta);
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
    const toolLabel = e.activeTool === 'clip'
      ? `Tool: clip (${e.clipMode}) ${e.clipPoints.length}/2`
      : `Tool: ${e.activeTool}`;
    document.getElementById('status-tool')!.textContent = toolLabel;
    document.getElementById('status-grid')!.textContent = `Grid: ${e.gridSize}${e.snapToGrid ? '' : ' (free)'}`;
    const faceCount = e.selection.filter(s => s.type === 'face').length;
    const selLabel = faceCount > 0
      ? `Sel: ${faceCount} face${faceCount > 1 ? 's' : ''}`
      : `Sel: ${e.selection.length}`;
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

    // Update entity properties panel
    this.updateEntityProps();
  }

  private updateEntityProps(): void {
    const propsDiv = document.getElementById('entity-props')!;
    const sel = this.editor.selection;

    const faceItems = sel.filter(s => s.type === 'face') as Array<{ type: 'face'; entity: Entity; brush: Brush; face: BrushFace }>;
    if (faceItems.length === 1) {
      const face = faceItems[0].face;
      const brush = faceItems[0].brush;
      if (propsDiv.dataset.mode !== 'face' || propsDiv.dataset.faceId !== String(face.plane.dist)) {
        propsDiv.innerHTML = '';
        propsDiv.dataset.mode = 'face';
        propsDiv.dataset.faceId = String(face.plane.dist);
        this.buildFacePropsUI(propsDiv, face, brush);
      }
    } else if (faceItems.length > 1) {
      const faces = faceItems.map(f => f.face);
      const faceKey = faces.map(f => String(f.plane.dist)).join(',');
      if (propsDiv.dataset.mode !== 'multiface' || propsDiv.dataset.faceId !== faceKey) {
        propsDiv.innerHTML = '';
        propsDiv.dataset.mode = 'multiface';
        propsDiv.dataset.faceId = faceKey;
        this.buildMultiFacePropsUI(propsDiv, faces);
      }
    } else if (sel.length === 1 && sel[0].type === 'entity') {
      propsDiv.dataset.mode = 'entity';
      propsDiv.dataset.faceId = '';
      const entity = sel[0].entity;
      propsDiv.innerHTML = '';

      const title = document.createElement('label');
      title.textContent = `Properties: ${entity.classname}`;
      title.style.fontWeight = 'bold';
      propsDiv.appendChild(title);

      for (const [key, value] of Object.entries(entity.properties)) {
        if (key === 'classname') continue;
        const row = document.createElement('div');
        row.className = 'kv-row';

        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.value = key;
        keyInput.readOnly = true;
        keyInput.style.flex = '0.6';

        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.value = value;
        valInput.addEventListener('change', () => {
          entity.properties[key] = valInput.value;
          this.editor.dirty = true;
        });

        row.appendChild(keyInput);
        row.appendChild(valInput);
        propsDiv.appendChild(row);
      }

      // Add property button
      const addBtn = document.createElement('div');
      addBtn.className = 'btn';
      addBtn.textContent = '+ Add Key';
      addBtn.addEventListener('mousedown', () => {
        const key = prompt('Key name:');
        if (key) {
          entity.properties[key] = '';
          this.editor.dirty = true;
        }
      });
      propsDiv.appendChild(addBtn);
    } else if (sel.length === 1 && sel[0].type === 'brush') {
      propsDiv.dataset.mode = 'brush';
      propsDiv.dataset.faceId = '';
      propsDiv.innerHTML = '';
      const brush = sel[0].brush;
      const info = document.createElement('label');
      info.textContent = `Brush: ${brush.faces.length} faces`;
      propsDiv.appendChild(info);

      const texInfo = document.createElement('label');
      texInfo.textContent = `Texture: ${brush.faces[0]?.texture ?? 'none'}`;
      propsDiv.appendChild(texInfo);

      const sizeInfo = document.createElement('label');
      const size = [
        (brush.maxs[0] - brush.mins[0]).toFixed(0),
        (brush.maxs[1] - brush.mins[1]).toFixed(0),
        (brush.maxs[2] - brush.mins[2]).toFixed(0),
      ];
      sizeInfo.textContent = `Size: ${size.join(' x ')}`;
      propsDiv.appendChild(sizeInfo);
    } else {
      propsDiv.dataset.mode = '';
      propsDiv.dataset.faceId = '';
      propsDiv.innerHTML = '<label style="color: #666">No selection</label>';
    }
  }

  private buildFacePropsUI(container: HTMLElement, face: BrushFace, brush: { faces: BrushFace[] }): void {
    const title = document.createElement('label');
    title.textContent = 'Face Properties';
    title.style.fontWeight = 'bold';
    container.appendChild(title);

    const hint = document.createElement('label');
    hint.textContent = `Face ${brush.faces.indexOf(face) + 1} of ${brush.faces.length}`;
    hint.style.color = '#888';
    hint.style.fontSize = '11px';
    container.appendChild(hint);

    // Texture name
    this.addFaceField(container, 'Texture', face.texture, 'text', (val) => {
      face.texture = val;
      this.editor.dirty = true;
    });

    // Offset X/Y
    this.addFaceNumberRow(container, 'Offset', face.offsetX, face.offsetY, 'X', 'Y', (x, y) => {
      face.offsetX = x;
      face.offsetY = y;
      this.editor.dirty = true;
    });

    // Scale X/Y
    this.addFaceNumberRow(container, 'Scale', face.scaleX, face.scaleY, 'X', 'Y', (x, y) => {
      face.scaleX = x;
      face.scaleY = y;
      this.editor.dirty = true;
    });

    // Rotation
    this.addFaceField(container, 'Rotation', String(face.rotation), 'number', (val) => {
      face.rotation = parseFloat(val) || 0;
      this.editor.dirty = true;
    });

    // Flags
    this.addFaceNumberRow(container, 'Flags', face.surfaceFlags, face.contentFlags, 'Surf', 'Cont', (s, c) => {
      face.surfaceFlags = s;
      face.contentFlags = c;
      this.editor.dirty = true;
    });
  }

  private buildMultiFacePropsUI(container: HTMLElement, faces: BrushFace[]): void {
    const title = document.createElement('label');
    title.textContent = 'Face Properties';
    title.style.fontWeight = 'bold';
    container.appendChild(title);

    const hint = document.createElement('label');
    hint.textContent = `${faces.length} faces selected`;
    hint.style.color = '#888';
    hint.style.fontSize = '11px';
    container.appendChild(hint);

    // Texture: show common value or "(mixed)"
    const textures = new Set(faces.map(f => f.texture));
    const commonTex = textures.size === 1 ? [...textures][0] : '';
    this.addFaceField(container, 'Texture', commonTex, 'text', (val) => {
      for (const f of faces) f.texture = val;
      this.editor.dirty = true;
    }, textures.size > 1 ? '(mixed)' : undefined);

    // Offset
    const sameOx = faces.every(f => f.offsetX === faces[0].offsetX);
    const sameOy = faces.every(f => f.offsetY === faces[0].offsetY);
    this.addFaceNumberRow(container, 'Offset',
      sameOx ? faces[0].offsetX : 0, sameOy ? faces[0].offsetY : 0, 'X', 'Y', (x, y) => {
      for (const f of faces) { f.offsetX = x; f.offsetY = y; }
      this.editor.dirty = true;
    });

    // Scale
    const sameSx = faces.every(f => f.scaleX === faces[0].scaleX);
    const sameSy = faces.every(f => f.scaleY === faces[0].scaleY);
    this.addFaceNumberRow(container, 'Scale',
      sameSx ? faces[0].scaleX : 0.5, sameSy ? faces[0].scaleY : 0.5, 'X', 'Y', (x, y) => {
      for (const f of faces) { f.scaleX = x; f.scaleY = y; }
      this.editor.dirty = true;
    });

    // Rotation
    const sameRot = faces.every(f => f.rotation === faces[0].rotation);
    this.addFaceField(container, 'Rotation', sameRot ? String(faces[0].rotation) : '', 'number', (val) => {
      const r = parseFloat(val) || 0;
      for (const f of faces) f.rotation = r;
      this.editor.dirty = true;
    }, sameRot ? undefined : '(mixed)');

    // Flags
    const sameSurf = faces.every(f => f.surfaceFlags === faces[0].surfaceFlags);
    const sameCont = faces.every(f => f.contentFlags === faces[0].contentFlags);
    this.addFaceNumberRow(container, 'Flags',
      sameSurf ? faces[0].surfaceFlags : 0, sameCont ? faces[0].contentFlags : 0, 'Surf', 'Cont', (s, c) => {
      for (const f of faces) { f.surfaceFlags = s; f.contentFlags = c; }
      this.editor.dirty = true;
    });
  }

  private addFaceField(container: HTMLElement, label: string, value: string, type: string, onChange: (val: string) => void, placeholder?: string): void {
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.marginTop = '4px';
    lbl.style.fontSize = '11px';
    container.appendChild(lbl);

    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    if (placeholder) input.placeholder = placeholder;
    if (type === 'number') input.step = 'any';
    input.addEventListener('change', () => onChange(input.value));
    container.appendChild(input);
  }

  private addFaceNumberRow(
    container: HTMLElement,
    label: string,
    valA: number, valB: number,
    labelA: string, labelB: string,
    onChange: (a: number, b: number) => void
  ): void {
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.marginTop = '4px';
    lbl.style.fontSize = '11px';
    container.appendChild(lbl);

    const row = document.createElement('div');
    row.className = 'kv-row';

    const inputA = document.createElement('input');
    inputA.type = 'number';
    inputA.step = 'any';
    inputA.value = String(valA);
    inputA.placeholder = labelA;
    inputA.title = labelA;

    const inputB = document.createElement('input');
    inputB.type = 'number';
    inputB.step = 'any';
    inputB.value = String(valB);
    inputB.placeholder = labelB;
    inputB.title = labelB;

    const update = () => {
      onChange(parseFloat(inputA.value) || 0, parseFloat(inputB.value) || 0);
    };
    inputA.addEventListener('change', update);
    inputB.addEventListener('change', update);

    row.appendChild(inputA);
    row.appendChild(inputB);
    container.appendChild(row);
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
