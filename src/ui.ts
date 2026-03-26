import { Editor, Tool, InvisibleMode } from './editor';
import { BRUSH_ENTITY_CLASSES, Entity, ENTITY_CATEGORIES } from './entity';
import { TextureManager } from './textures';
import { PropertiesPanel } from './properties-panel';
import { Brush } from './brush';
import { Patch } from './patch';
import { compileMap } from './q3map';
import { buildMenuBar as buildMenuBarUI } from './ui-menu';
import { buildToolbar as buildToolbarUI } from './ui-toolbar';
import { setupKeyboard as setupKeyboardUI } from './ui-keyboard';
import { brushPrimitiveUsesSides } from './brush-primitives';
import { applyBrushPrimitiveToolbarIcon } from './brush-primitive-icons';
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
  private textureDir = '';
  private textureSearch = '';
  private textureFind = '';
  private textureReplace = '';
  private textureReplaceScope: 'selection' | 'map' = 'selection';
  private textureReplaceMatch: 'exact' | 'contains' = 'exact';
  private collapsedBrushPanelEntities = new WeakSet<Entity>();

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
    buildMenuBarUI({
      editor: this.editor,
      getOpenMenu: () => this.openMenu,
      setOpenMenu: (menu) => { this.openMenu = menu; },
      closeMenus: () => this.closeMenus(),
      compileBSP: () => this.compileBSP(),
      cycleInvisibleMode: () => this.cycleInvisibleMode(),
      setTool: (tool) => this.setTool(tool),
      setGrid: (size) => this.setGrid(size),
      increaseGrid: () => this.increaseGrid(),
      decreaseGrid: () => this.decreaseGrid(),
    });
  }

  private closeMenus(): void {
    if (this.openMenu) {
      this.openMenu.classList.remove('open');
      this.openMenu = null;
    }
  }

  // ── Toolbar ──

  private buildToolbar(): void {
    buildToolbarUI({
      editor: this.editor,
      setTool: (tool) => this.setTool(tool),
      increaseGrid: () => this.increaseGrid(),
      toggleSnap: () => this.toggleSnap(),
      toggleGeoSnap: () => this.toggleGeoSnap(),
      cycleInvisibleMode: () => this.cycleInvisibleMode(),
    });
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
  private brushPanelSignature = '';

  private buildBrushPanel(): void {
    const body = document.getElementById('brush-body')!;
    const modeSelect = document.getElementById('brush-panel-mode') as HTMLSelectElement;

    modeSelect.addEventListener('change', () => {
      this.brushPanelMode = modeSelect.value as typeof this.brushPanelMode;
      this.editor.selectionFilter = this.brushPanelMode;
      this.brushPanelSignature = '';
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
      | {
          kind: 'entity';
          entity: Entity;
          entityIdx: number;
          label: string;
          meta: string;
          collapsible: boolean;
          collapsed: boolean;
        }
      | {
          kind: 'brush';
          entity: Entity;
          brush: Brush;
          index: number;
          entityIdx: number;
          label: string;
        }
      | {
          kind: 'patch';
          entity: Entity;
          patch: Patch;
          index: number;
          entityIdx: number;
          label: string;
        };

    const items: ListItem[] = [];
    const regionSignature = e.regionBounds
      ? `${e.regionBounds.mins.join(',')}:${e.regionBounds.maxs.join(',')}`
      : 'none';
    const signatureParts: string[] = [mode, regionSignature];

    for (let ei = 0; ei < e.entities.length; ei++) {
      const entity = e.entities[ei];
      if (!e.isEntityInRegion(entity)) continue;
      const brushChildren = (mode === 'all' || mode === 'brushes')
        ? entity.brushes
          .filter(brush => e.isBrushInRegion(brush, entity))
          .map((brush, index) => ({
            kind: 'brush' as const,
            entity,
            brush,
            index,
            entityIdx: ei,
            label: brush.name || `brush ${index}`,
          }))
        : [];
      const patchChildren = (mode === 'all' || mode === 'patches')
        ? entity.patches
          .filter(patch => e.isPatchInRegion(patch, entity))
          .map((patch, index) => ({
            kind: 'patch' as const,
            entity,
            patch,
            index,
            entityIdx: ei,
            label: `patch ${index}`,
          }))
        : [];

      const includeEntity =
        mode === 'entities' ||
        mode === 'all' ||
        brushChildren.length > 0 ||
        patchChildren.length > 0;
      if (!includeEntity) continue;

      const childCount = brushChildren.length + patchChildren.length;
      const collapsed = childCount > 0 && this.collapsedBrushPanelEntities.has(entity);
      const label = this.objectTreeEntityLabel(entity, ei === 0);
      const meta = this.objectTreeEntityMeta(entity, brushChildren.length, patchChildren.length);

      items.push({
        kind: 'entity',
        entity,
        entityIdx: ei,
        label,
        meta,
        collapsible: mode !== 'entities' && childCount > 0,
        collapsed,
      });
      signatureParts.push(`${ei}:${entity.classname}:${entity.brushes.length}:${entity.patches.length}:${collapsed ? 1 : 0}`);

      if (mode !== 'entities' && !collapsed) {
        items.push(...brushChildren, ...patchChildren);
      }
    }

    const signature = signatureParts.join('|');

    if (this.brushPanelSignature !== signature) {
      this.brushPanelSignature = signature;
      list.innerHTML = '';
      for (const item of items) {
        const el = document.createElement('div');
        el.className = item.kind === 'entity'
          ? 'brush-item brush-tree-entity'
          : 'brush-item brush-tree-child';

        const row = document.createElement('div');
        row.className = 'brush-tree-row';

        if (item.kind === 'entity') {
          const toggle = document.createElement('span');
          toggle.className = 'brush-tree-toggle' + (item.collapsible ? '' : ' empty');
          toggle.textContent = item.collapsible ? (item.collapsed ? '+' : '\u2212') : '';
          if (item.collapsible) {
            toggle.addEventListener('mousedown', (ev) => {
              ev.stopPropagation();
              if (this.collapsedBrushPanelEntities.has(item.entity)) {
                this.collapsedBrushPanelEntities.delete(item.entity);
              } else {
                this.collapsedBrushPanelEntities.add(item.entity);
              }
              this.brushPanelSignature = '';
              this.editor.dirty = true;
            });
          }

          const label = document.createElement('span');
          label.className = 'brush-tree-label';
          label.textContent = item.label;

          const meta = document.createElement('span');
          meta.className = 'brush-tree-meta';
          meta.textContent = item.meta;

          row.appendChild(toggle);
          row.appendChild(label);
          row.appendChild(meta);
        } else {
          const indent = document.createElement('span');
          indent.className = 'brush-tree-indent';

          const kind = document.createElement('span');
          kind.className = 'brush-tree-kind';
          kind.textContent = item.kind === 'brush' ? 'B' : 'P';

          const label = document.createElement('span');
          label.className = 'brush-tree-label';
          label.textContent = item.label;

          row.appendChild(indent);
          row.appendChild(kind);
          row.appendChild(label);
        }

        el.appendChild(row);
        el.addEventListener('mousedown', (ev) => {
          const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;
          if (item.kind === 'brush') {
            e.selectBrushDirect(item.entity, item.brush, additive);
          } else if (item.kind === 'patch') {
            e.selectPatchDirect(item.entity, item.patch, additive);
          } else {
            e.selectEntity(item.entity, additive);
          }
          e.centerOnSelection();
        });
        list.appendChild(el);
      }
    }

    const children = list.children;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const el = children[i] as HTMLElement;
      let selected: boolean;
      if (item.kind === 'brush') {
        selected = e.isSelected(item.brush);
      } else if (item.kind === 'patch') {
        selected = e.isPatchSelected(item.patch);
      } else {
        selected = e.isEntitySelected(item.entity);
      }
      el.classList.toggle('selected', selected);
    }
  }

  private objectTreeEntityLabel(entity: Entity, isWorldspawn: boolean): string {
    if (isWorldspawn) return 'worldspawn';
    const name = entity.properties['targetname'] || entity.properties['name'];
    return name ? `${entity.classname} "${name}"` : entity.classname;
  }

  private objectTreeEntityMeta(entity: Entity, brushCount: number, patchCount: number): string {
    const parts: string[] = [];
    if (brushCount > 0) parts.push(`${brushCount} brush${brushCount === 1 ? '' : 'es'}`);
    if (patchCount > 0) parts.push(`${patchCount} patch${patchCount === 1 ? '' : 'es'}`);
    if (parts.length === 0 && this.editor.isPointEntity(entity)) {
      const origin = this.editor.entityDisplayOrigin(entity);
      if (origin) {
        parts.push(`@ ${origin[0].toFixed(0)} ${origin[1].toFixed(0)} ${origin[2].toFixed(0)}`);
      }
    }
    return parts.join(', ');
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

    const brushEntityLabel = document.createElement('label');
    brushEntityLabel.textContent = 'Brush Entity Class';
    brushEntityLabel.style.marginTop = '10px';
    body.appendChild(brushEntityLabel);

    const brushEntitySelect = document.createElement('select');
    brushEntitySelect.id = 'brush-entity-class-select';
    for (const classname of BRUSH_ENTITY_CLASSES) {
      const opt = document.createElement('option');
      opt.value = classname;
      opt.textContent = classname;
      if (classname === this.editor.currentBrushEntityClass) opt.selected = true;
      brushEntitySelect.appendChild(opt);
    }
    brushEntitySelect.addEventListener('change', () => {
      this.editor.currentBrushEntityClass = brushEntitySelect.value;
    });
    body.appendChild(brushEntitySelect);

    const brushEntityActions = document.createElement('div');
    brushEntityActions.className = 'kv-row';

    const groupBtn = document.createElement('div');
    groupBtn.className = 'btn';
    groupBtn.textContent = 'Group Selection';
    groupBtn.addEventListener('mousedown', () => {
      this.editor.groupSelectionIntoEntity();
    });

    const ungroupBtn = document.createElement('div');
    ungroupBtn.className = 'btn';
    ungroupBtn.textContent = 'To Worldspawn';
    ungroupBtn.addEventListener('mousedown', () => {
      this.editor.moveSelectionToWorldspawn();
    });

    brushEntityActions.appendChild(groupBtn);
    brushEntityActions.appendChild(ungroupBtn);
    body.appendChild(brushEntityActions);

    // Properties area (shown when entity selected)
    const propsDiv = document.createElement('div');
    propsDiv.id = 'entity-props';
    propsDiv.style.marginTop = '8px';
    body.appendChild(propsDiv);
  }

  private buildTexturePanel(): void {
    const body = document.getElementById('texture-body')!;
    body.innerHTML = '';

    this.buildTextureReplaceControls(body);
    this.buildTextureBrowser(body);
  }

  private buildTextureReplaceControls(body: HTMLElement): void {
    const section = document.createElement('div');
    section.className = 'texture-tools';

    const title = document.createElement('div');
    title.className = 'texture-subhead';
    title.textContent = 'Find / Replace';
    section.appendChild(title);

    const bindSubmitKey = (input: HTMLInputElement) => {
      input.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        this.applyTextureReplace();
      });
    };

    const findLabel = document.createElement('label');
    findLabel.textContent = 'Find';
    section.appendChild(findLabel);

    const findRow = document.createElement('div');
    findRow.className = 'kv-row';

    const findInput = document.createElement('input');
    findInput.type = 'text';
    findInput.value = this.textureFind;
    findInput.spellcheck = false;
    findInput.autocomplete = 'off';
    findInput.addEventListener('input', () => {
      this.textureFind = findInput.value;
    });
    bindSubmitKey(findInput);

    const findCurrentBtn = document.createElement('div');
    findCurrentBtn.className = 'btn';
    findCurrentBtn.textContent = 'Current';
    findCurrentBtn.addEventListener('mousedown', () => {
      this.textureFind = this.editor.currentTexture;
      findInput.value = this.textureFind;
    });

    findRow.appendChild(findInput);
    findRow.appendChild(findCurrentBtn);
    section.appendChild(findRow);

    const replaceLabel = document.createElement('label');
    replaceLabel.textContent = 'Replace With';
    section.appendChild(replaceLabel);

    const replaceRow = document.createElement('div');
    replaceRow.className = 'kv-row';

    const replaceInput = document.createElement('input');
    replaceInput.type = 'text';
    replaceInput.value = this.textureReplace;
    replaceInput.spellcheck = false;
    replaceInput.autocomplete = 'off';
    replaceInput.addEventListener('input', () => {
      this.textureReplace = replaceInput.value;
    });
    bindSubmitKey(replaceInput);

    const replaceCurrentBtn = document.createElement('div');
    replaceCurrentBtn.className = 'btn';
    replaceCurrentBtn.textContent = 'Current';
    replaceCurrentBtn.addEventListener('mousedown', () => {
      this.textureReplace = this.editor.currentTexture;
      replaceInput.value = this.textureReplace;
    });

    replaceRow.appendChild(replaceInput);
    replaceRow.appendChild(replaceCurrentBtn);
    section.appendChild(replaceRow);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'kv-row';

    const scopeSelect = document.createElement('select');
    for (const [value, label] of [['selection', 'Selection'], ['map', 'Whole Map']] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === this.textureReplaceScope) opt.selected = true;
      scopeSelect.appendChild(opt);
    }
    scopeSelect.addEventListener('change', () => {
      this.textureReplaceScope = scopeSelect.value as 'selection' | 'map';
    });

    const matchSelect = document.createElement('select');
    for (const [value, label] of [['exact', 'Exact Match'], ['contains', 'Name Contains']] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === this.textureReplaceMatch) opt.selected = true;
      matchSelect.appendChild(opt);
    }
    matchSelect.addEventListener('change', () => {
      this.textureReplaceMatch = matchSelect.value as 'exact' | 'contains';
    });

    optionsRow.appendChild(scopeSelect);
    optionsRow.appendChild(matchSelect);
    section.appendChild(optionsRow);

    const replaceBtn = document.createElement('div');
    replaceBtn.className = 'btn texture-apply-btn';
    replaceBtn.textContent = 'Replace Textures';
    replaceBtn.addEventListener('mousedown', () => this.applyTextureReplace());
    section.appendChild(replaceBtn);

    body.appendChild(section);
  }

  private applyTextureReplace(): void {
    this.editor.replaceTextures(
      this.textureFind,
      this.textureReplace,
      this.textureReplaceScope,
      this.textureReplaceMatch,
    );
  }

  private buildTextureBrowser(body: HTMLElement): void {
    if (this.texMgr) {
      this.buildManagedTextureBrowser(body, this.texMgr);
      return;
    }

    const list = document.createElement('div');
    list.className = 'texture-list';
    list.id = 'texture-list';

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
      <span class="status-item" id="status-region"></span>
      <span class="status-item" id="status-brushes">Brushes: 0</span>
      <span class="status-item" id="status-gizmo"></span>
    `;
  }

  // ── Keyboard shortcuts ──

  private setupKeyboard(): void {
    setupKeyboardUI({
      editor: this.editor,
      handleExitVertexMode: () => this.handleExitVertexMode(),
      setTool: (tool) => this.setTool(tool),
      increaseGrid: () => this.increaseGrid(),
      decreaseGrid: () => this.decreaseGrid(),
      toggleGeoSnap: () => this.toggleGeoSnap(),
      cycleInvisibleMode: () => this.cycleInvisibleMode(),
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
    this.setGrid(this.editor.gridSize >= 256 ? 1 : this.editor.gridSize * 2);
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
    } else if (e.activeTool === 'create') {
      toolLabel = brushPrimitiveUsesSides(e.currentBrushPrimitive)
        ? `Tool: create (${e.currentBrushPrimitive} ${e.currentBrushSides})`
        : `Tool: create (${e.currentBrushPrimitive})`;
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

    let totalBrushCount = 0;
    let visibleBrushCount = 0;
    for (const entity of e.entities) {
      for (const brush of entity.brushes) {
        totalBrushCount++;
        if (e.isBrushInRegion(brush, entity)) visibleBrushCount++;
      }
    }
    document.getElementById('status-brushes')!.textContent = e.regionBounds
      ? `Brushes: ${visibleBrushCount}/${totalBrushCount}`
      : `Brushes: ${totalBrushCount}`;
    const regionEl = document.getElementById('status-region');
    if (regionEl) {
      if (e.regionBounds) {
        const size = [
          e.regionBounds.maxs[0] - e.regionBounds.mins[0],
          e.regionBounds.maxs[1] - e.regionBounds.mins[1],
          e.regionBounds.maxs[2] - e.regionBounds.mins[2],
        ].map(v => Math.round(v));
        regionEl.textContent = `Region: ${size[0]} x ${size[1]} x ${size[2]}`;
      } else {
        regionEl.textContent = '';
      }
    }
    document.getElementById('grid-label')!.innerHTML = `<span class="tool-label">G:${e.gridSize}</span>`;
    const snapBtn = document.getElementById('snap-toggle')!;
    const snapTitles = { off: 'Snap: off', abs: 'Snap: absolute', rel: 'Snap: relative' };
    snapBtn.title = snapTitles[e.gridSnapMode];
    snapBtn.classList.toggle('active', e.gridSnapMode !== 'off');
    snapBtn.classList.toggle('snap-abs', e.gridSnapMode === 'abs');
    document.getElementById('geosnap-toggle')!.classList.toggle('active', e.snapToGeometry);
    document.getElementById('texlock-toggle')!.classList.toggle('active', e.textureLock);
    applyBrushPrimitiveToolbarIcon(document.getElementById('tool-create') as HTMLElement | null, e.currentBrushPrimitive);
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

    const createPanel = document.getElementById('create-tool-panel');
    if (e.activeTool !== 'create') {
      createPanel?.classList.remove('open');
      document.getElementById('tool-create')?.classList.remove('active-panel');
    }

    // Update panels
    this.updateBrushPanel();
    this.propertiesPanel.update();
  }

  // ── Texture browser with pak textures ──

  updateTextureBrowser(texMgr: TextureManager): void {
    this.texMgr = texMgr;
    this.buildTexturePanel();
  }

  private buildManagedTextureBrowser(body: HTMLElement, texMgr: TextureManager): void {
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
    if (Array.from(dirSelect.options).some(opt => opt.value === this.textureDir)) {
      dirSelect.value = this.textureDir;
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
    searchInput.value = this.textureSearch;
    searchInput.style.marginTop = '4px';
    body.appendChild(searchInput);

    const list = document.createElement('div');
    list.className = 'texture-list';
    list.id = 'texture-list';
    body.appendChild(list);

    const allTextures = texMgr.listTextures();

    const repopulate = () => {
      const query = this.textureSearch.trim().toLowerCase();
      const dir = this.textureDir;
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
      this.textureDir = dirSelect.value;
      this.textureSearch = '';
      searchInput.value = '';
      repopulate();
    });
    searchInput.addEventListener('input', () => {
      this.textureSearch = searchInput.value;
      repopulate();
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
    title.textContent = this.editor.isRegionActive() ? 'Compile BSP (Region)' : 'Compile BSP';
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
    status.textContent = this.editor.isRegionActive() ? 'Active region only' : '';
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

    const doCompile = async () => {
      const compileWithRegion = this.editor.isRegionActive();
      const compileEntities = compileWithRegion
        ? this.editor.collectRegionEntities(true)
        : this.editor.entities;
      let imageFiles: Map<string, Uint8Array> | undefined;
      if (this.texMgr) {
        imageFiles = new Map();
        const usedTextures = new Set<string>();
        for (const ent of compileEntities) {
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
      const quality = qualitySelect.value;
      compileBtn.disabled = true;
      compileBtn.style.display = 'none';
      qualitySelect.disabled = true;
      runBtn.style.display = 'none';
      saveBtn.style.display = 'none';
      status.textContent = compileWithRegion ? 'Compiling active region...' : 'Compiling...';
      status.style.color = '#ccc';
      title.style.color = '#08a';
      log.textContent = '';

      const mapText = compileWithRegion
        ? this.editor.serializeRegionMap(true)
        : this.editor.serializeMap();

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
