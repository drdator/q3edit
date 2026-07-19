import { Editor, Tool, InvisibleMode } from './editor';
import { Entity } from './entity';
import { TextureManager } from './textures';
import { PropertiesPanel } from './properties-panel';
import { Brush } from './brush';
import { Patch } from './patch';
import { compileMap } from './q3map';
import { buildMenuBar as buildMenuBarUI } from './ui-menu';
import { buildToolbar as buildToolbarUI } from './ui-toolbar';
import { setupKeyboard as setupKeyboardUI } from './ui-keyboard';
import { createEditorCommandRegistry, type EditorCommandContext } from './editor-commands';
import type { CommandRegistry } from './commands';
import { brushPrimitiveUsesSides } from './brush-primitives';
import { applyBrushPrimitiveToolbarIcon } from './brush-primitive-icons';
import { PakManagerModel, type PakManagerEntry, type PakManagerResult } from './pak-manager';
import { buildEntityPanel as buildEntityPanelUI } from './entity-panel';
import 'virtual:phosphor-icons.css';

export interface AssetLoadingHandle {
  ready: Promise<void>;
  update: (message: string, completed?: number, total?: number) => void;
  close: () => void;
}

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
  'base_trim/dirty_pewter',
  'gothic_wall/iron01_e',
  'gothic_wall/skull4',
  'gothic_floor/blocks17floor',
  'gothic_trim/baseboard09',
  'skies/earthsky01',
];

export class UI {
  editor: Editor;
  private openMenu: HTMLElement | null = null;
  private commands: CommandRegistry<EditorCommandContext>;
  private propertiesPanel: PropertiesPanel;
  private texMgr: TextureManager | null = null;
  private showTextureThumbnails = false;
  private textureDir = '';
  private textureSearch = '';
  private textureFind = '';
  private textureReplace = '';
  private textureReplaceScope: 'selection' | 'map' = 'selection';
  private textureReplaceMatch: 'exact' | 'contains' = 'exact';
  private textureAssetStatus = 'Loading OpenArena assets...';
  private importedPakNames: string[] = [];
  private collapsedBrushPanelEntities = new WeakSet<Entity>();
  private collapsedBrushPanelTerrainGroups = new Set<string>();

  constructor(editor: Editor) {
    this.editor = editor;
    this.propertiesPanel = new PropertiesPanel(editor);
    this.commands = createEditorCommandRegistry({
      editor: this.editor,
      handleExitVertexMode: () => this.handleExitVertexMode(),
      openRotateDialog: () => this.openRotateDialog(),
      openScaleDialog: () => this.openScaleDialog(),
      compileBSP: () => this.compileBSP(),
      quickPlay: quality => this.compileBSP(quality),
      managePakFiles: () => this.onManagePakFiles?.(),
      openTerrainPanel: () => this.openTerrainPanel(),
      cycleInvisibleMode: () => this.cycleInvisibleMode(),
      setTool: tool => this.setTool(tool),
      setGrid: size => this.setGrid(size),
      increaseGrid: () => this.increaseGrid(),
      decreaseGrid: () => this.decreaseGrid(),
      toggleSnap: () => this.toggleSnap(),
      toggleGeoSnap: () => this.toggleGeoSnap(),
    });
    this.buildMenuBar();
    this.buildToolbar();
    this.buildSidePanel();
    this.buildStatusBar();
    this.setupKeyboard();

    this.editor.onLocateTexture = (texture: string) => this.locateTexture(texture);
    this.editor.onRequestExitVertexMode = () => this.handleExitVertexMode();
  }

  // ── Menu Bar ──

  private buildMenuBar(): void {
    buildMenuBarUI({
      commands: this.commands,
      getOpenMenu: () => this.openMenu,
      setOpenMenu: (menu) => { this.openMenu = menu; },
      closeMenus: () => this.closeMenus(),
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
      commands: this.commands,
    });
  }

  // ── Side Panel ──

  private buildSidePanel(): void {
    // Add collapse toggles to all panel headers
    for (const header of document.querySelectorAll('#sidepanel .panel-header')) {
      const panel = header.parentElement as HTMLElement | null;
      if (panel?.id === 'terrain-panel') continue;
      const toggle = document.createElement('span');
      toggle.className = 'panel-toggle';
      toggle.textContent = '\u2212';
      header.appendChild(toggle);
      header.addEventListener('mousedown', () => {
        const owningPanel = header.parentElement!;
        owningPanel.classList.toggle('collapsed');
        toggle.textContent = owningPanel.classList.contains('collapsed') ? '+' : '\u2212';
      });
    }

    this.buildBrushPanel();
    this.buildEntityPanel();
    this.buildTexturePanel();
    this.buildTerrainPanel();
    this.setupTerrainPopover();
  }

  private setPanelCollapsed(panel: HTMLElement, collapsed: boolean): void {
    panel.classList.toggle('collapsed', collapsed);
    const toggle = panel.querySelector('.panel-toggle');
    if (toggle) toggle.textContent = collapsed ? '+' : '\u2212';
  }

  private positionTerrainPanel(): void {
    const panel = document.getElementById('terrain-panel') as HTMLElement | null;
    const button = document.getElementById('terrain-panel-toggle') as HTMLElement | null;
    if (!panel || !button) return;
    const rect = button.getBoundingClientRect();
    panel.style.left = `${rect.right + 8}px`;
    const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
    panel.style.top = `${Math.min(maxTop, Math.max(8, rect.top))}px`;
  }

  private closeTerrainPanel(): void {
    const panel = document.getElementById('terrain-panel');
    if (!panel) return;
    panel.classList.remove('open');
    this.editor.redrawRequested = true;
  }

  private openTerrainPanel(): void {
    const panel = document.getElementById('terrain-panel') as HTMLElement | null;
    if (!panel) return;
    if (panel.classList.contains('open')) {
      this.closeTerrainPanel();
      return;
    }
    this.setPanelCollapsed(panel, false);
    panel.classList.add('open');
    this.positionTerrainPanel();
    this.editor.redrawRequested = true;
  }

  private setupTerrainPopover(): void {
    const panel = document.getElementById('terrain-panel') as HTMLElement | null;
    const button = document.getElementById('terrain-panel-toggle') as HTMLElement | null;
    if (!panel || !button) return;

    document.body.appendChild(panel);

    document.addEventListener('mousedown', (event) => {
      if (!panel.classList.contains('open')) return;
      const target = event.target as Node | null;
      if (target && (panel.contains(target) || button.contains(target))) return;
      this.closeTerrainPanel();
    });

    window.addEventListener('resize', () => {
      if (!panel.classList.contains('open')) return;
      this.positionTerrainPanel();
    });
    window.addEventListener('scroll', () => {
      if (!panel.classList.contains('open')) return;
      this.positionTerrainPanel();
    }, true);
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
      this.editor.redrawRequested = true;
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
      this.editor.redrawRequested = true;
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
          kind: 'terrainGroup';
          entity: Entity;
          entityIdx: number;
          groupId: string;
          representative: Patch;
          patches: Array<{ patch: Patch; index: number }>;
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
          grouped: boolean;
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
        ? (() => {
          const visiblePatches = entity.patches
            .map((patch, index) => ({ patch, index }))
            .filter(item => e.isPatchInRegion(item.patch, entity));
          const groupedPatches = new Map<string, Array<{ patch: Patch; index: number }>>();
          for (const item of visiblePatches) {
            if (!item.patch.terrainGroupId) continue;
            const group = groupedPatches.get(item.patch.terrainGroupId) ?? [];
            group.push(item);
            groupedPatches.set(item.patch.terrainGroupId, group);
          }

          const patchItems: Array<Extract<ListItem, { kind: 'terrainGroup' | 'patch' }>> = [];
          const emittedGroups = new Set<string>();
          for (const item of visiblePatches) {
            const groupId = item.patch.terrainGroupId;
            const grouped = groupId ? groupedPatches.get(groupId) : null;
            if (groupId && grouped && grouped.length > 1) {
              if (emittedGroups.has(groupId)) continue;
              emittedGroups.add(groupId);
              const collapseKey = `${ei}:${groupId}`;
              const collapsed = this.collapsedBrushPanelTerrainGroups.has(collapseKey);
              patchItems.push({
                kind: 'terrainGroup',
                entity,
                entityIdx: ei,
                groupId,
                representative: grouped[0].patch,
                patches: grouped,
                label: 'terrain set',
                meta: `${grouped.length} patches`,
                collapsible: true,
                collapsed,
              });
              signatureParts.push(`tg:${collapseKey}:${grouped.length}:${collapsed ? 1 : 0}`);
              if (!collapsed) {
                patchItems.push(...grouped.map(groupItem => ({
                  kind: 'patch' as const,
                  entity,
                  patch: groupItem.patch,
                  index: groupItem.index,
                  entityIdx: ei,
                  label: `patch ${groupItem.index}`,
                  grouped: true,
                })));
              }
              continue;
            }

            patchItems.push({
              kind: 'patch',
              entity,
              patch: item.patch,
              index: item.index,
              entityIdx: ei,
              label: `patch ${item.index}`,
              grouped: false,
            });
          }
          return patchItems;
        })()
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
          : item.kind === 'terrainGroup'
            ? 'brush-item brush-tree-child brush-tree-group'
            : item.kind === 'patch' && item.grouped
              ? 'brush-item brush-tree-grandchild'
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
              this.editor.redrawRequested = true;
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
        } else if (item.kind === 'terrainGroup') {
          const indent = document.createElement('span');
          indent.className = 'brush-tree-indent';

          const toggle = document.createElement('span');
          toggle.className = 'brush-tree-toggle' + (item.collapsible ? '' : ' empty');
          toggle.textContent = item.collapsible ? (item.collapsed ? '+' : '\u2212') : '';
          if (item.collapsible) {
            toggle.addEventListener('mousedown', (ev) => {
              ev.stopPropagation();
              const collapseKey = `${item.entityIdx}:${item.groupId}`;
              if (this.collapsedBrushPanelTerrainGroups.has(collapseKey)) {
                this.collapsedBrushPanelTerrainGroups.delete(collapseKey);
              } else {
                this.collapsedBrushPanelTerrainGroups.add(collapseKey);
              }
              this.brushPanelSignature = '';
              this.editor.redrawRequested = true;
            });
          }

          const kind = document.createElement('span');
          kind.className = 'brush-tree-kind';
          kind.textContent = 'T';

          const label = document.createElement('span');
          label.className = 'brush-tree-label';
          label.textContent = item.label;

          const meta = document.createElement('span');
          meta.className = 'brush-tree-meta';
          meta.textContent = item.meta;

          row.appendChild(indent);
          row.appendChild(toggle);
          row.appendChild(kind);
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
          } else if (item.kind === 'terrainGroup') {
            e.selectPatch(item.entity, item.representative, additive);
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
      } else if (item.kind === 'terrainGroup') {
        selected = item.patches.every(groupPatch => e.isPatchSelected(groupPatch.patch));
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
    buildEntityPanelUI(body, this.editor);
  }

  updateEntityDefinitions(): void {
    this.buildEntityPanel();
    this.editor.redrawRequested = true;
  }

  private buildTexturePanel(): void {
    const body = document.getElementById('texture-body')!;
    body.innerHTML = '';

    this.buildTextureSourceControls(body);
    this.buildTextureReplaceControls(body);
    this.buildTextureBrowser(body);
  }

  onManagePakFiles: (() => Promise<void>) | null = null;

  setTextureAssetStatus(status: string, importedPakNames: string[] = this.importedPakNames): void {
    this.textureAssetStatus = status;
    this.importedPakNames = importedPakNames;
    this.buildTexturePanel();
  }

  showOpenArenaNotice(): Promise<boolean> {
    document.getElementById('openarena-notice-dialog')?.remove();

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.id = 'openarena-notice-dialog';
      overlay.className = 'editor-dialog-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'openarena-notice-title');

      const dialog = document.createElement('div');
      dialog.className = 'editor-dialog openarena-notice-dialog';

      const title = document.createElement('div');
      title.id = 'openarena-notice-title';
      title.className = 'editor-dialog-title';
      title.textContent = 'Using OpenArena Assets';

      const copy = document.createElement('div');
      copy.className = 'openarena-notice-copy';
      const intro = document.createElement('p');
      intro.textContent = 'Q3Edit uses OpenArena assets by default so textures work without installing Quake III Arena. OpenArena does not contain the complete retail texture set.';
      const instructions = document.createElement('p');
      instructions.append(
        'To use the original Quake III Arena assets, choose File > Manage PK3 Files..., then add ',
        Object.assign(document.createElement('code'), { textContent: 'pak0.pk3' }),
        ' through ',
        Object.assign(document.createElement('code'), { textContent: 'pak8.pk3' }),
        ' from the game’s ',
        Object.assign(document.createElement('code'), { textContent: 'baseq3' }),
        ' folder and click Save.',
      );
      const privacy = document.createElement('p');
      privacy.textContent = 'Q3Edit reads these files locally and stores them only in this browser; they are never uploaded.';
      copy.append(intro, instructions, privacy);

      const footer = document.createElement('div');
      footer.className = 'editor-dialog-actions';
      const neverShow = document.createElement('button');
      neverShow.type = 'button';
      neverShow.className = 'btn';
      neverShow.textContent = 'Don’t show again';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn primary';
      ok.textContent = 'OK';
      footer.append(neverShow, ok);

      dialog.append(title, copy, footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      let settled = false;
      const finish = (dismissPermanently: boolean) => {
        if (settled) return;
        settled = true;
        overlay.remove();
        resolve(dismissPermanently);
      };
      neverShow.onclick = () => finish(true);
      ok.onclick = () => finish(false);
      overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      });
      overlay.tabIndex = -1;
      ok.focus();
    });
  }

  showAssetLoading(initialMessage: string): AssetLoadingHandle {
    document.getElementById('asset-loading-dialog')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'asset-loading-dialog';
    overlay.className = 'editor-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'asset-loading-title');

    const dialog = document.createElement('div');
    dialog.className = 'editor-dialog asset-loading-dialog';

    const title = document.createElement('div');
    title.id = 'asset-loading-title';
    title.className = 'editor-dialog-title';
    title.textContent = 'Updating Texture Assets';

    const status = document.createElement('div');
    status.className = 'asset-loading-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = initialMessage;

    const track = document.createElement('div');
    track.className = 'asset-loading-track indeterminate';
    const fill = document.createElement('div');
    fill.className = 'asset-loading-fill';
    track.appendChild(fill);

    const hint = document.createElement('div');
    hint.className = 'asset-loading-hint';
    hint.textContent = 'Large retail PK3 files can take a few seconds to extract.';

    dialog.append(title, status, track, hint);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const ready = new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    return {
      ready,
      update: (message, completed, total) => {
        status.textContent = message;
        if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
          track.classList.remove('indeterminate');
          fill.style.width = `${Math.max(0, Math.min(100, (completed / total) * 100))}%`;
        } else {
          track.classList.add('indeterminate');
          fill.style.removeProperty('width');
        }
      },
      close: () => overlay.remove(),
    };
  }

  private buildTextureSourceControls(body: HTMLElement): void {
    const section = document.createElement('div');
    section.className = 'texture-tools texture-source-tools';

    const title = document.createElement('div');
    title.className = 'texture-subhead';
    title.textContent = 'Asset Source';
    section.appendChild(title);

    const status = document.createElement('div');
    status.className = 'texture-source-status';
    status.textContent = this.textureAssetStatus;
    section.appendChild(status);

    const attribution = document.createElement('a');
    attribution.className = 'texture-source-attribution';
    attribution.href = '/openarena/OPENARENA.md';
    attribution.target = '_blank';
    attribution.rel = 'noreferrer';
    attribution.textContent = 'OpenArena license and source';
    section.appendChild(attribution);

    if (this.importedPakNames.length > 0) {
      const names = document.createElement('div');
      names.className = 'texture-source-files';
      names.textContent = this.importedPakNames.join(', ');
      names.title = this.importedPakNames.join('\n');
      section.appendChild(names);
    }

    const actions = document.createElement('div');
    actions.className = 'texture-source-actions';

    const manageBtn = document.createElement('button');
    manageBtn.type = 'button';
    manageBtn.className = 'btn';
    manageBtn.innerHTML = '<i class="ph ph-files" aria-hidden="true"></i><span>Manage PK3 files...</span>';
    manageBtn.title = 'Add, remove, or reorder PK3 files from your Quake III Arena installation';
    manageBtn.addEventListener('click', async () => {
      if (!this.onManagePakFiles) return;
      manageBtn.disabled = true;
      try {
        await this.onManagePakFiles();
      } finally {
        manageBtn.disabled = false;
      }
    });

    actions.appendChild(manageBtn);

    section.appendChild(actions);
    body.appendChild(section);
  }

  openPakManager(
    initialEntries: PakManagerEntry[],
    initialOpenArenaEnabled: boolean,
  ): Promise<PakManagerResult | null> {
    document.getElementById('pak-manager-dialog')?.remove();
    const model = new PakManagerModel(initialEntries, initialOpenArenaEnabled);
    const entries = model.entries;

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.id = 'pak-manager-dialog';
      overlay.className = 'editor-dialog-overlay';

      const dialog = document.createElement('div');
      dialog.className = 'editor-dialog pak-manager';

      const title = document.createElement('div');
      title.className = 'editor-dialog-title';
      title.textContent = 'Manage PK3 Files';
      dialog.appendChild(title);

      const description = document.createElement('div');
      description.className = 'editor-dialog-description';
      description.textContent = 'Files load from top to bottom. Later files have higher priority and override matching assets from earlier files.';
      dialog.appendChild(description);

      const list = document.createElement('div');
      list.className = 'pak-manager-list';
      dialog.appendChild(list);
      let recentlyMovedNames = new Set<string>();

      const formatSize = (bytes: number): string => {
        const mb = bytes / (1024 * 1024);
        return mb >= 0.1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
      };

      const render = () => {
        list.innerHTML = '';

        const defaultRow = document.createElement('div');
        defaultRow.className = 'pak-manager-row fixed';
        defaultRow.classList.toggle('disabled-source', !model.openArenaEnabled);
        const defaultOrder = document.createElement('span');
        defaultOrder.className = 'pak-manager-order';
        defaultOrder.textContent = '1';
        const defaultInfo = document.createElement('div');
        defaultInfo.className = 'pak-manager-info';
        const defaultName = document.createElement('div');
        defaultName.className = 'pak-manager-name';
        defaultName.textContent = 'OpenArena default assets';
        const defaultMeta = document.createElement('div');
        defaultMeta.className = 'pak-manager-meta';
        defaultMeta.textContent = model.openArenaEnabled
          ? 'Bundled fallback · loaded first'
          : 'Disabled · not downloaded or loaded';
        defaultInfo.append(defaultName, defaultMeta);

        const defaultToggle = document.createElement('label');
        defaultToggle.className = 'pak-manager-source-toggle';
        const defaultCheckbox = document.createElement('input');
        defaultCheckbox.type = 'checkbox';
        defaultCheckbox.checked = model.openArenaEnabled;
        defaultCheckbox.onchange = () => {
          model.openArenaEnabled = defaultCheckbox.checked;
          render();
        };
        const defaultToggleText = document.createElement('span');
        defaultToggleText.textContent = model.openArenaEnabled ? 'Enabled' : 'Disabled';
        defaultToggle.append(defaultCheckbox, defaultToggleText);
        defaultRow.append(defaultOrder, defaultInfo, defaultToggle);
        list.appendChild(defaultRow);

        entries.forEach((entry, index) => {
          const row = document.createElement('div');
          row.className = 'pak-manager-row';
          if (recentlyMovedNames.has(entry.name)) row.classList.add('recently-moved');

          const order = document.createElement('span');
          order.className = 'pak-manager-order';
          order.textContent = String(index + 2);

          const info = document.createElement('div');
          info.className = 'pak-manager-info';
          const name = document.createElement('div');
          name.className = 'pak-manager-name';
          name.textContent = entry.name;
          const meta = document.createElement('div');
          meta.className = 'pak-manager-meta';
          meta.textContent = `${formatSize(entry.size)}${entry.file ? ' · new' : ' · stored in this browser'}`;
          info.append(name, meta);

          const controls = document.createElement('div');
          controls.className = 'pak-manager-row-actions';
          const up = document.createElement('button');
          up.type = 'button';
          up.className = 'btn';
          up.innerHTML = '<i class="ph ph-arrow-up" aria-hidden="true"></i>';
          up.setAttribute('aria-label', 'Load earlier');
          up.title = 'Load earlier (lower priority)';
          up.disabled = index === 0;
          up.onclick = () => {
            model.move(index, -1);
            recentlyMovedNames = new Set([entry.name]);
            render();
          };
          const down = document.createElement('button');
          down.type = 'button';
          down.className = 'btn';
          down.innerHTML = '<i class="ph ph-arrow-down" aria-hidden="true"></i>';
          down.setAttribute('aria-label', 'Load later');
          down.title = 'Load later (higher priority)';
          down.disabled = index === entries.length - 1;
          down.onclick = () => {
            model.move(index, 1);
            recentlyMovedNames = new Set([entry.name]);
            render();
          };
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'btn pak-manager-remove';
          remove.innerHTML = '<i class="ph ph-trash" aria-hidden="true"></i>';
          remove.title = `Remove ${entry.name}`;
          remove.setAttribute('aria-label', `Remove ${entry.name}`);
          remove.onclick = () => {
            model.remove(index);
            render();
          };
          controls.append(up, down, remove);
          row.append(order, info, controls);
          list.appendChild(row);
        });
        recentlyMovedNames = new Set();

        if (entries.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'pak-manager-empty';
          empty.classList.toggle('warning', !model.openArenaEnabled);
          empty.textContent = model.openArenaEnabled
            ? 'No user PK3 files. OpenArena assets will be used on their own.'
            : 'No texture assets are enabled. The editor will run without textures.';
          list.appendChild(empty);
        }
        sortButton.disabled = entries.length < 2;
        removeAllButton.disabled = entries.length === 0;
      };

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.pk3,application/zip';
      fileInput.multiple = true;
      fileInput.hidden = true;
      fileInput.onchange = () => {
        model.upsertFiles(Array.from(fileInput.files ?? []));
        fileInput.value = '';
        render();
      };

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn pak-manager-add';
      addButton.innerHTML = '<i class="ph ph-plus" aria-hidden="true"></i><span>Add PK3 files...</span>';
      addButton.onclick = () => fileInput.click();

      const sortButton = document.createElement('button');
      sortButton.type = 'button';
      sortButton.className = 'btn';
      sortButton.innerHTML = '<i class="ph ph-sort-ascending" aria-hidden="true"></i><span>Sort by filename</span>';
      sortButton.title = 'Sort using natural numeric filename order';
      sortButton.disabled = entries.length < 2;
      sortButton.onclick = () => {
        recentlyMovedNames = model.sortByFilename();
        render();
      };

      const removeAllButton = document.createElement('button');
      removeAllButton.type = 'button';
      removeAllButton.className = 'btn pak-manager-remove-all';
      removeAllButton.innerHTML = '<i class="ph ph-trash" aria-hidden="true"></i><span>Remove all</span>';
      removeAllButton.onclick = () => {
        model.clear();
        recentlyMovedNames = new Set();
        render();
      };

      const sourceActions = document.createElement('div');
      sourceActions.className = 'pak-manager-source-actions';
      sourceActions.append(addButton, removeAllButton, sortButton);
      dialog.append(sourceActions, fileInput);

      const finePrint = document.createElement('div');
      finePrint.className = 'pak-manager-fine-print';
      const retailHelp = document.createElement('p');
      retailHelp.append(
        'Retail Quake III Arena: select ',
        Object.assign(document.createElement('code'), { textContent: 'pak0.pk3' }),
        ' through ',
        Object.assign(document.createElement('code'), { textContent: 'pak8.pk3' }),
        ' from the game’s ',
        Object.assign(document.createElement('code'), { textContent: 'baseq3' }),
        ' folder. Install a legally purchased copy or use the original CD, locate the game’s installation folder, then open ',
        Object.assign(document.createElement('code'), { textContent: 'baseq3' }),
        '.',
      );
      const demoLink = document.createElement('a');
      demoLink.href = 'https://archive.org/details/QuakeIiiArenaDemo';
      demoLink.target = '_blank';
      demoLink.rel = 'noreferrer';
      demoLink.textContent = 'Quake III Arena demo';
      retailHelp.append(
        ' No retail copy? The archived ',
        demoLink,
        ' includes a limited set of original assets. After installing or extracting it, add ',
        Object.assign(document.createElement('code'), { textContent: 'demoq3/pak0.pk3' }),
        '. Q3Edit reads these files locally and stores them only in this browser; they are never uploaded.',
      );
      finePrint.appendChild(retailHelp);
      dialog.appendChild(finePrint);

      const footer = document.createElement('div');
      footer.className = 'editor-dialog-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn';
      cancel.textContent = 'Cancel';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn primary';
      save.textContent = 'Save';
      footer.append(cancel, save);
      dialog.appendChild(footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      let settled = false;
      const finish = (result: PakManagerResult | null) => {
        if (settled) return;
        settled = true;
        overlay.remove();
        resolve(result);
      };
      cancel.onclick = () => finish(null);
      save.onclick = () => finish(model.result());
      overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      });
      overlay.tabIndex = -1;
      render();
      overlay.focus();
    });
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

  private setTerrainRadius(value: number): void {
    const next = Math.max(8, Math.min(1024, Math.round(value) || 8));
    if (next === this.editor.terrainBrushRadius) return;
    this.editor.terrainBrushRadius = next;
    this.editor.redrawRequested = true;
    this.editor.statusMessage = `Terrain radius: ${next}`;
  }

  private setTerrainStrength(value: number): void {
    const next = Math.max(1, Math.min(256, Math.round(value) || 1));
    if (next === this.editor.terrainBrushStrength) return;
    this.editor.terrainBrushStrength = next;
    this.editor.redrawRequested = true;
    this.editor.statusMessage = `Terrain strength: ${next}`;
  }

  private setTerrainBrushMode(mode: 'height' | 'texture'): void {
    if (mode === this.editor.terrainBrushMode) return;
    this.editor.terrainBrushMode = mode;
    this.editor.redrawRequested = true;
    this.editor.statusMessage = `Terrain brush mode: ${mode}`;
  }

  private setTerrainFalloff(falloff: 'smooth' | 'linear'): void {
    if (falloff === this.editor.terrainFalloff) return;
    this.editor.terrainFalloff = falloff;
    this.editor.redrawRequested = true;
    this.editor.statusMessage = `Terrain falloff: ${falloff}`;
  }

  private buildTerrainPanel(): void {
    const body = document.getElementById('terrain-body')!;
    body.innerHTML = '';

    const setupSection = document.createElement('div');
    setupSection.className = 'terrain-tools';

    const setupTitle = document.createElement('div');
    setupTitle.className = 'texture-subhead';
    setupTitle.textContent = 'Setup';
    setupSection.appendChild(setupTitle);

    const createBtn = document.createElement('div');
    createBtn.className = 'btn terrain-apply-btn';
    createBtn.textContent = 'Create Terrain Patch';
    createBtn.addEventListener('mousedown', () => this.editor.createTerrainPatch());
    setupSection.appendChild(createBtn);

    const prepareBtn = document.createElement('div');
    prepareBtn.className = 'btn terrain-apply-btn';
    prepareBtn.textContent = 'Prepare For Texture Paint';
    prepareBtn.addEventListener('mousedown', () => this.editor.splitTerrainIntoPaintTiles());
    setupSection.appendChild(prepareBtn);

    const stitchBtn = document.createElement('div');
    stitchBtn.className = 'btn terrain-apply-btn';
    stitchBtn.textContent = 'Stitch Terrain Seams';
    stitchBtn.addEventListener('mousedown', () => this.editor.stitchTerrainSeams());
    setupSection.appendChild(stitchBtn);

    body.appendChild(setupSection);

    const brushSection = document.createElement('div');
    brushSection.className = 'terrain-tools';

    const brushTitle = document.createElement('div');
    brushTitle.className = 'texture-subhead';
    brushTitle.textContent = 'Brush';
    brushSection.appendChild(brushTitle);

    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'Mode';
    brushSection.appendChild(modeLabel);

    const modeSelect = document.createElement('select');
    modeSelect.id = 'terrain-brush-mode';
    for (const [value, label] of [['height', 'Height'], ['texture', 'Texture']] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      modeSelect.appendChild(opt);
    }
    modeSelect.addEventListener('change', () => {
      this.setTerrainBrushMode(modeSelect.value as 'height' | 'texture');
    });
    brushSection.appendChild(modeSelect);

    const radiusLabel = document.createElement('label');
    radiusLabel.id = 'terrain-radius-label';
    radiusLabel.textContent = 'Radius';
    brushSection.appendChild(radiusLabel);

    const radiusInput = document.createElement('input');
    radiusInput.id = 'terrain-radius-input';
    radiusInput.className = 'terrain-slider';
    radiusInput.type = 'range';
    radiusInput.min = '8';
    radiusInput.max = '1024';
    radiusInput.step = '8';
    radiusInput.addEventListener('input', () => this.setTerrainRadius(Number(radiusInput.value)));
    brushSection.appendChild(radiusInput);

    const strengthLabel = document.createElement('label');
    strengthLabel.id = 'terrain-strength-label';
    strengthLabel.textContent = 'Strength';
    brushSection.appendChild(strengthLabel);

    const strengthInput = document.createElement('input');
    strengthInput.id = 'terrain-strength-input';
    strengthInput.className = 'terrain-slider';
    strengthInput.type = 'range';
    strengthInput.min = '1';
    strengthInput.max = '256';
    strengthInput.step = '1';
    strengthInput.addEventListener('input', () => this.setTerrainStrength(Number(strengthInput.value)));
    brushSection.appendChild(strengthInput);

    const falloffLabel = document.createElement('label');
    falloffLabel.id = 'terrain-falloff-label';
    falloffLabel.textContent = 'Falloff';
    brushSection.appendChild(falloffLabel);

    const falloffSelect = document.createElement('select');
    falloffSelect.id = 'terrain-falloff-select';
    for (const [value, label] of [['smooth', 'Smooth'], ['linear', 'Linear']] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      falloffSelect.appendChild(opt);
    }
    falloffSelect.addEventListener('change', () => {
      this.setTerrainFalloff(falloffSelect.value as 'smooth' | 'linear');
    });
    brushSection.appendChild(falloffSelect);

    const textureInfo = document.createElement('div');
    textureInfo.className = 'terrain-current-texture';
    textureInfo.id = 'terrain-current-texture';
    textureInfo.title = 'Locate in Texture panel';
    textureInfo.addEventListener('mousedown', () => this.locateTexture(this.editor.currentTexture));

    const textureThumb = document.createElement('img');
    textureThumb.className = 'terrain-current-texture-thumb';
    textureThumb.id = 'terrain-current-texture-thumb';
    textureThumb.alt = '';
    textureThumb.draggable = false;
    textureInfo.appendChild(textureThumb);

    const textureMeta = document.createElement('div');
    textureMeta.className = 'terrain-current-texture-meta';

    const textureTitle = document.createElement('div');
    textureTitle.className = 'terrain-current-texture-title';
    textureTitle.id = 'terrain-current-texture-title';
    textureMeta.appendChild(textureTitle);

    const textureName = document.createElement('div');
    textureName.className = 'terrain-current-texture-name';
    textureName.id = 'terrain-current-texture-name';
    textureMeta.appendChild(textureName);

    textureInfo.appendChild(textureMeta);
    brushSection.appendChild(textureInfo);

    const paintTarget = document.createElement('div');
    paintTarget.className = 'terrain-help terrain-paint-target';
    paintTarget.id = 'terrain-paint-target';
    brushSection.appendChild(paintTarget);

    body.appendChild(brushSection);

    const actionSection = document.createElement('div');
    actionSection.className = 'terrain-tools';

    const actionTitle = document.createElement('div');
    actionTitle.className = 'texture-subhead';
    actionTitle.textContent = 'Actions';
    actionSection.appendChild(actionTitle);

    const actionRow = document.createElement('div');
    actionRow.className = 'kv-row';

    const raiseBtn = document.createElement('div');
    raiseBtn.className = 'btn';
    raiseBtn.id = 'terrain-raise-btn';
    raiseBtn.textContent = 'Raise';
    raiseBtn.addEventListener('mousedown', () => this.editor.raiseTerrain());
    actionRow.appendChild(raiseBtn);

    const lowerBtn = document.createElement('div');
    lowerBtn.className = 'btn';
    lowerBtn.id = 'terrain-lower-btn';
    lowerBtn.textContent = 'Lower';
    lowerBtn.addEventListener('mousedown', () => this.editor.lowerTerrain());
    actionRow.appendChild(lowerBtn);

    const smoothBtn = document.createElement('div');
    smoothBtn.className = 'btn';
    smoothBtn.id = 'terrain-smooth-btn';
    smoothBtn.textContent = 'Smooth';
    smoothBtn.addEventListener('mousedown', () => this.editor.smoothTerrain());
    actionRow.appendChild(smoothBtn);

    actionSection.appendChild(actionRow);

    const actionRowSecondary = document.createElement('div');
    actionRowSecondary.className = 'kv-row';

    const noiseBtn = document.createElement('div');
    noiseBtn.className = 'btn';
    noiseBtn.id = 'terrain-noise-btn';
    noiseBtn.textContent = 'Noise';
    noiseBtn.addEventListener('mousedown', () => this.editor.noiseTerrain());
    actionRowSecondary.appendChild(noiseBtn);

    const erodeBtn = document.createElement('div');
    erodeBtn.className = 'btn';
    erodeBtn.id = 'terrain-erode-btn';
    erodeBtn.textContent = 'Erode';
    erodeBtn.addEventListener('mousedown', () => this.editor.erodeTerrain());
    actionRowSecondary.appendChild(erodeBtn);

    actionSection.appendChild(actionRowSecondary);

    const help = document.createElement('div');
    help.className = 'terrain-help';
    help.id = 'terrain-help';
    actionSection.appendChild(help);

    body.appendChild(actionSection);

    this.updateTerrainPanel();
  }

  private updateTerrainPanel(): void {
    const modeSelect = document.getElementById('terrain-brush-mode') as HTMLSelectElement | null;
    if (!modeSelect) return;

    const radiusInput = document.getElementById('terrain-radius-input') as HTMLInputElement | null;
    const radiusLabel = document.getElementById('terrain-radius-label') as HTMLLabelElement | null;
    const strengthInput = document.getElementById('terrain-strength-input') as HTMLInputElement | null;
    const strengthLabel = document.getElementById('terrain-strength-label') as HTMLLabelElement | null;
    const falloffSelect = document.getElementById('terrain-falloff-select') as HTMLSelectElement | null;
    const falloffLabel = document.getElementById('terrain-falloff-label') as HTMLLabelElement | null;
    const textureThumb = document.getElementById('terrain-current-texture-thumb') as HTMLImageElement | null;
    const textureTitle = document.getElementById('terrain-current-texture-title');
    const textureName = document.getElementById('terrain-current-texture-name');
    const paintTarget = document.getElementById('terrain-paint-target');
    const help = document.getElementById('terrain-help');
    const raiseBtn = document.getElementById('terrain-raise-btn') as HTMLElement | null;
    const lowerBtn = document.getElementById('terrain-lower-btn') as HTMLElement | null;
    const smoothBtn = document.getElementById('terrain-smooth-btn') as HTMLElement | null;
    const noiseBtn = document.getElementById('terrain-noise-btn') as HTMLElement | null;
    const erodeBtn = document.getElementById('terrain-erode-btn') as HTMLElement | null;
    const terrainPanelToggle = document.getElementById('terrain-panel-toggle');
    const terrainPanel = document.getElementById('terrain-panel');
    const textureMode = this.editor.terrainBrushMode === 'texture';

    if (modeSelect.value !== this.editor.terrainBrushMode) {
      modeSelect.value = this.editor.terrainBrushMode;
    }
    const radius = this.editor.currentTerrainRadius();
    const strength = this.editor.currentTerrainStrength();

    if (radiusInput && radiusInput.value !== String(radius)) {
      radiusInput.value = String(radius);
    }
    if (strengthInput && strengthInput.value !== String(strength)) {
      strengthInput.value = String(strength);
    }
    if (falloffSelect && falloffSelect.value !== this.editor.terrainFalloff) {
      falloffSelect.value = this.editor.terrainFalloff;
    }

    if (radiusLabel) radiusLabel.textContent = `Radius ${radius}`;
    if (strengthLabel) strengthLabel.textContent = `Strength ${strength}`;
    if (radiusInput) radiusInput.disabled = textureMode;
    if (radiusLabel) radiusLabel.style.opacity = textureMode ? '0.5' : '1';
    if (strengthInput) strengthInput.disabled = textureMode;
    if (strengthLabel) strengthLabel.style.opacity = textureMode ? '0.5' : '1';
    if (falloffSelect) falloffSelect.disabled = textureMode;
    if (falloffLabel) falloffLabel.style.opacity = textureMode ? '0.5' : '1';
    if (raiseBtn) raiseBtn.classList.toggle('disabled', textureMode);
    if (lowerBtn) lowerBtn.classList.toggle('disabled', textureMode);
    if (smoothBtn) smoothBtn.classList.toggle('disabled', textureMode);
    if (noiseBtn) noiseBtn.classList.toggle('disabled', textureMode);
    if (erodeBtn) erodeBtn.classList.toggle('disabled', textureMode);
    if (raiseBtn) raiseBtn.style.pointerEvents = textureMode ? 'none' : '';
    if (lowerBtn) lowerBtn.style.pointerEvents = textureMode ? 'none' : '';
    if (smoothBtn) smoothBtn.style.pointerEvents = textureMode ? 'none' : '';
    if (noiseBtn) noiseBtn.style.pointerEvents = textureMode ? 'none' : '';
    if (erodeBtn) erodeBtn.style.pointerEvents = textureMode ? 'none' : '';

    if (textureTitle) {
      textureTitle.textContent = textureMode ? 'Paint texture' : 'Current texture';
    }
    if (textureName) {
      textureName.textContent = this.editor.currentTexture;
    }
    if (textureThumb) {
      const url = this.texMgr?.getThumbnailUrl(this.editor.currentTexture) ?? null;
      if (url) {
        if (textureThumb.src !== url) textureThumb.src = url;
        textureThumb.hidden = false;
      } else {
        textureThumb.removeAttribute('src');
        textureThumb.hidden = true;
      }
    }

    if (paintTarget) {
      paintTarget.style.display = textureMode ? '' : 'none';
      if (textureMode) {
        const hovered = this.editor.hoveredTerrainPaintTargets();
        const needsPreparation = hovered.some(target => target.needsPreparation);
        const hoveredCount = hovered.length;
        const targetLabel = hoveredCount === 1
          ? hovered[0].type === 'cell' ? 'cell' : 'tile'
          : 'targets';
        const normalize = (texture: string) => texture.trim().replace(/\\/g, '/').replace(/^textures\//i, '');
        const activeTexture = normalize(this.editor.currentTexture);
        const hoveredTextures = new Set(hovered.map(target => normalize(target.texture)));

        if (hoveredCount === 0) {
          paintTarget.textContent = 'Paint target: hover terrain in a 2D or 3D view';
        } else if (needsPreparation) {
          paintTarget.textContent = 'Paint target: prepare terrain for local texture paint';
        } else if (hoveredTextures.size === 1) {
          const [hoveredTexture] = hoveredTextures;
          paintTarget.textContent = hoveredTexture === activeTexture
            ? `Paint target: ${hoveredCount} ${targetLabel} already use ${hoveredTexture}`
            : `Paint target: ${hoveredCount} ${targetLabel} ${hoveredTexture} -> ${activeTexture}`;
        } else {
          paintTarget.textContent = `Paint target: ${hoveredCount} ${targetLabel} -> ${activeTexture}`;
        }
      }
    }
    if (help) {
      help.textContent = textureMode
        ? 'Pick a texture in the Texture panel, hover a terrain cell or prepared tile in 2D or 3D to preview it, then Alt-click to paint or Alt-drag in 2D for brush painting.'
        : 'Alt-drag sculpts from the anchor, Alt+Shift paints up, Ctrl+Alt paints down, and Noise/Erode use the same brush settings.';
    }
    if (terrainPanelToggle && terrainPanel) {
      terrainPanelToggle.classList.toggle('active-panel', terrainPanel.classList.contains('open'));
    }
  }

  // ── Status Bar ──

  private buildStatusBar(): void {
    const bar = document.getElementById('statusbar')!;
    bar.innerHTML = `
      <span class="status-item" id="status-msg">Ready</span>
      <span class="status-item" id="status-file">untitled.map</span>
      <span class="status-item" id="status-tool">Tool: Select</span>
      <span class="status-item" id="status-grid">Grid: 16</span>
      <span class="status-item" id="status-sel">Sel: 0</span>
      <span class="status-item" id="status-region"></span>
      <span class="status-item" id="status-clip"></span>
      <span class="status-item" id="status-brushes">Brushes: 0</span>
      <span class="status-item" id="status-gizmo"></span>
    `;
  }

  // ── Keyboard shortcuts ──

  private setupKeyboard(): void {
    setupKeyboardUI({
      commands: this.commands,
      isFullscreen3d: () => this.editor.fullscreen3d,
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
    this.editor.redrawRequested = true;
  }

  private setGrid(size: number): void {
    this.editor.gridSize = size;
    this.editor.createDepth = Math.max(size * 4, 64);
    this.editor.redrawRequested = true;
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
    this.editor.redrawRequested = true;
    const labels = { off: 'Grid snap: OFF', abs: 'Grid snap: absolute', rel: 'Grid snap: relative' };
    this.editor.statusMessage = labels[this.editor.gridSnapMode];
    this.closeMenus();
  }

  private toggleGeoSnap(): void {
    this.editor.snapToGeometry = !this.editor.snapToGeometry;
    this.editor.redrawRequested = true;
    this.editor.statusMessage = this.editor.snapToGeometry ? 'Geometry snap: ON' : 'Geometry snap: OFF';
    this.closeMenus();
  }

  private cycleInvisibleMode(): void {
    const modes: InvisibleMode[] = ['show', 'dim', 'hide'];
    const idx = modes.indexOf(this.editor.invisibleMode);
    this.editor.invisibleMode = modes[(idx + 1) % modes.length];
    this.editor.redrawRequested = true;
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
    this.commands.notifyStateChanged();
    this.updateTerrainPanel();

    document.getElementById('status-msg')!.textContent = e.statusMessage;
    const modifiedMarker = e.hasUnsavedChanges ? ' *' : '';
    document.getElementById('status-file')!.textContent = `${e.fileName}${modifiedMarker}`;
    document.title = `${modifiedMarker ? '* ' : ''}${e.fileName} — Q3Edit`;
    let toolLabel: string;
    if (e.vertexMode) {
      toolLabel = 'Tool: vertex';
    } else if (e.patchEditMode) {
      toolLabel = e.terrainBrushMode === 'texture'
        ? 'Tool: patch edit (texture paint)'
        : `Tool: patch edit (height r${e.currentTerrainRadius()} s${e.currentTerrainStrength()} ${e.terrainFalloff})`;
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
      selLabel = `Sel: ${vc} vtx (drag verts/edges, V to exit)`;
    } else if (e.patchEditMode) {
      const pc = e.patchControlSelection.length;
      selLabel = e.terrainBrushMode === 'texture'
        ? `Sel: ${pc} cp (hover highlights paint target, Alt drag paints, prepare terrain for local paint, V to exit)`
        : `Sel: ${pc} cp (Alt drag sculpt, Alt+Shift paint up, Ctrl+Alt paint down, panel: noise/erode, V to exit)`;
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
    const clipEl = document.getElementById('status-clip');
    if (clipEl) {
      clipEl.textContent = e.cubicClipEnabled ? `Clip: ${e.cubicClipSize}` : '';
    }
    document.getElementById('grid-label')!.innerHTML = `<span class="tool-label">G:${e.gridSize}</span>`;
    const snapBtn = document.getElementById('snap-toggle')!;
    snapBtn.classList.toggle('snap-abs', e.gridSnapMode === 'abs');
    applyBrushPrimitiveToolbarIcon(document.getElementById('tool-create') as HTMLElement | null, e.currentBrushPrimitive);
    const invisBtn = document.getElementById('invis-toggle')!;
    const invisIcons: Record<InvisibleMode, string> = {
      show: 'ph ph-eye',
      dim: 'ph ph-eye-slash',
      hide: 'ph ph-eye-closed',
    };
    const invisIcon = invisBtn.querySelector('i');
    if (invisIcon) invisIcon.className = invisIcons[e.invisibleMode];

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

  private openRotateDialog(): void {
    if (this.editor.selection.length === 0) {
      this.editor.statusMessage = 'Nothing selected to rotate';
      return;
    }

    document.getElementById('transform-dialog')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'transform-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#2a2a2a;border:1px solid #08a;border-radius:6px;padding:16px 20px;width:360px;max-width:90vw;color:#eee;font:13px/1.5 monospace';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:bold;color:#08a;margin-bottom:8px';
    title.textContent = 'Rotate Selection';
    dialog.appendChild(title);

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-bottom:12px;color:#aaa';
    hint.textContent = 'Axis defaults to the last active 2D view.';
    dialog.appendChild(hint);

    const form = document.createElement('div');
    form.style.cssText = 'display:grid;grid-template-columns:80px 1fr;gap:8px 10px;align-items:center;margin-bottom:12px';

    const axisLabel = document.createElement('label');
    axisLabel.textContent = 'Axis';
    const axisSelect = document.createElement('select');
    axisSelect.style.cssText = 'background:#1a1a1a;color:#eee;border:1px solid #555;border-radius:4px;padding:4px 8px;font:13px monospace';
    for (const [value, label] of [['0', 'X'], ['1', 'Y'], ['2', 'Z']] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      if (Number(value) === this.editor.rotationAxis) option.selected = true;
      axisSelect.appendChild(option);
    }

    const angleLabel = document.createElement('label');
    angleLabel.textContent = 'Angle';
    const angleInput = document.createElement('input');
    angleInput.type = 'number';
    angleInput.step = '0.1';
    angleInput.value = '45';
    angleInput.style.cssText = 'background:#1a1a1a;color:#eee;border:1px solid #555;border-radius:4px;padding:4px 8px;font:13px monospace';

    form.appendChild(axisLabel);
    form.appendChild(axisSelect);
    form.appendChild(angleLabel);
    form.appendChild(angleInput);
    dialog.appendChild(form);

    const error = document.createElement('div');
    error.style.cssText = 'min-height:18px;margin-bottom:12px;color:#f80';
    dialog.appendChild(error);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.style.cssText = 'padding:6px 14px;background:#08a;color:#fff;border:none;border-radius:4px;cursor:pointer;font:13px monospace;font-weight:bold';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:6px 14px;background:#555;color:#eee;border:none;border-radius:4px;cursor:pointer;font:13px monospace';

    const close = () => overlay.remove();
    const apply = () => {
      const angle = parseFloat(angleInput.value);
      if (!isFinite(angle) || Math.abs(angle) < 1e-6) {
        error.textContent = 'Enter a non-zero angle.';
        angleInput.focus();
        angleInput.select();
        return;
      }
      this.editor.rotationAxis = Math.max(0, Math.min(2, Number(axisSelect.value) || 0));
      this.editor.rotateSelection(angle);
      close();
    };

    applyBtn.onclick = apply;
    cancelBtn.onclick = close;
    buttons.appendChild(applyBtn);
    buttons.appendChild(cancelBtn);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        e.stopPropagation();
      } else if (e.key === 'Enter') {
        apply();
        e.stopPropagation();
      }
    });

    overlay.tabIndex = 0;
    angleInput.focus();
    angleInput.select();
  }

  private openScaleDialog(): void {
    if (this.editor.selection.length === 0) {
      this.editor.statusMessage = 'Nothing selected to scale';
      return;
    }

    document.getElementById('transform-dialog')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'transform-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#2a2a2a;border:1px solid #08a;border-radius:6px;padding:16px 20px;width:380px;max-width:90vw;color:#eee;font:13px/1.5 monospace';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:bold;color:#08a;margin-bottom:8px';
    title.textContent = 'Scale Selection';
    dialog.appendChild(title);

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-bottom:12px;color:#aaa';
    hint.textContent = 'Scale factors are relative. 1 leaves size unchanged, 2 doubles it, 0.5 halves it.';
    dialog.appendChild(hint);

    const form = document.createElement('div');
    form.style.cssText = 'display:grid;grid-template-columns:80px 1fr;gap:8px 10px;align-items:center;margin-bottom:8px';

    const inputs: HTMLInputElement[] = [];
    for (const labelText of ['X Factor', 'Y Factor', 'Z Factor']) {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';
      input.min = '0.01';
      input.value = '1';
      input.style.cssText = 'background:#1a1a1a;color:#eee;border:1px solid #555;border-radius:4px;padding:4px 8px;font:13px monospace';
      form.appendChild(label);
      form.appendChild(input);
      inputs.push(input);
    }
    dialog.appendChild(form);

    const uniformRow = document.createElement('label');
    uniformRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;color:#ccc';

    const uniformInput = document.createElement('input');
    uniformInput.type = 'checkbox';
    uniformInput.checked = false;
    uniformInput.style.cssText = 'margin:0';
    uniformRow.appendChild(uniformInput);
    uniformRow.appendChild(document.createTextNode('Keep factors linked while editing'));
    dialog.appendChild(uniformRow);

    inputs.forEach((input) => {
      input.addEventListener('input', () => {
        if (!uniformInput.checked) return;
        for (const other of inputs) {
          if (other === input) continue;
          other.value = input.value;
        }
      });
    });

    const error = document.createElement('div');
    error.style.cssText = 'min-height:18px;margin-bottom:12px;color:#f80';
    dialog.appendChild(error);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.style.cssText = 'padding:6px 14px;background:#08a;color:#fff;border:none;border-radius:4px;cursor:pointer;font:13px monospace;font-weight:bold';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:6px 14px;background:#555;color:#eee;border:none;border-radius:4px;cursor:pointer;font:13px monospace';

    const close = () => overlay.remove();
    const apply = () => {
      const values = inputs.map(input => parseFloat(input.value));
      if (values.some(value => !isFinite(value) || value <= 0.001)) {
        error.textContent = 'Enter scale factors greater than zero.';
        const invalid = inputs.find((_, index) => !isFinite(values[index]) || values[index] <= 0.001);
        invalid?.focus();
        invalid?.select();
        return;
      }
      this.editor.scaleSelection([values[0], values[1], values[2]]);
      close();
    };

    applyBtn.onclick = apply;
    cancelBtn.onclick = close;
    buttons.appendChild(applyBtn);
    buttons.appendChild(cancelBtn);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        e.stopPropagation();
      } else if (e.key === 'Enter') {
        apply();
        e.stopPropagation();
      }
    });

    overlay.tabIndex = 0;
    inputs[0].focus();
    inputs[0].select();
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

  private async compileBSP(autoPlayQuality: 'fast' | 'normal' | 'full' | null = null): Promise<void> {
    document.getElementById('compile-dialog')?.remove();
    const autoPlay = autoPlayQuality !== null;
    const autoPlayLabel = autoPlayQuality
      ? autoPlayQuality[0].toUpperCase() + autoPlayQuality.slice(1)
      : '';

    const overlay = document.createElement('div');
    overlay.id = 'compile-dialog';
    overlay.className = 'editor-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'compile-dialog-title');

    const dialog = document.createElement('div');
    dialog.className = 'editor-dialog compile-dialog';

    const title = document.createElement('div');
    title.id = 'compile-dialog-title';
    title.className = 'editor-dialog-title';
    title.textContent = autoPlay
      ? (this.editor.isRegionActive()
          ? `Quick Play (${autoPlayLabel}, Region)`
          : `Quick Play (${autoPlayLabel})`)
      : (this.editor.isRegionActive() ? 'Compile BSP (Region)' : 'Compile BSP');
    dialog.appendChild(title);

    const description = document.createElement('div');
    description.className = 'editor-dialog-description';
    description.textContent = autoPlay
      ? (this.editor.isRegionActive()
          ? `Compile the active region at ${autoPlayQuality} quality, then start it in browser ioquake3.`
          : `Compile the current map at ${autoPlayQuality} quality, then start it in browser ioquake3.`)
      : (this.editor.isRegionActive()
          ? 'Compile the active region with the browser-based q3map toolchain.'
          : 'Compile the current map with the browser-based q3map toolchain.');
    dialog.appendChild(description);

    const qualityRow = document.createElement('div');
    qualityRow.className = 'compile-dialog-quality';
    const qualityLabel = document.createElement('label');
    qualityLabel.textContent = 'Quality:';
    const qualitySelect = document.createElement('select');
    qualityLabel.htmlFor = 'compile-dialog-quality';
    qualitySelect.id = 'compile-dialog-quality';
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
    qualityRow.hidden = autoPlay;
    dialog.appendChild(qualityRow);

    const status = document.createElement('div');
    status.className = 'compile-dialog-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = this.editor.isRegionActive() ? 'Active region only' : '';
    dialog.appendChild(status);

    const log = document.createElement('pre');
    log.className = 'compile-dialog-log';
    log.setAttribute('aria-label', 'Compiler output');
    log.textContent = '';
    dialog.appendChild(log);

    const buttons = document.createElement('div');
    buttons.className = 'editor-dialog-actions compile-dialog-actions';

    const compileBtn = document.createElement('button');
    compileBtn.type = 'button';
    compileBtn.className = 'btn primary';
    compileBtn.textContent = 'Compile';
    compileBtn.hidden = autoPlay;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Close';
    let dismissed = false;
    closeBtn.onclick = () => {
      dismissed = true;
      overlay.remove();
    };

    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = 'btn';
    runBtn.textContent = 'Play in browser';
    runBtn.hidden = true;

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Save .bsp';
    saveBtn.hidden = true;

    buttons.append(closeBtn, runBtn, saveBtn, compileBtn);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dismissed = true;
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
      const quality = autoPlayQuality ?? qualitySelect.value;
      compileBtn.disabled = true;
      compileBtn.textContent = 'Compiling...';
      qualitySelect.disabled = true;
      runBtn.hidden = true;
      saveBtn.hidden = true;
      dialog.classList.remove('success', 'warning', 'error');
      status.textContent = compileWithRegion ? 'Compiling active region...' : 'Compiling...';
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

      compileBtn.disabled = false;
      compileBtn.textContent = 'Compile';
      qualitySelect.disabled = false;

      if (result.success && result.bsp) {
        const leaked = !!result.pointfileText
          && this.editor.loadPointfileText(result.pointfileText, 'Leak detected: loaded pointfile');
        if (leaked) {
          dialog.classList.add('warning');
          status.textContent = `Compiled with leak (${(result.bsp.length / 1024).toFixed(1)} KB, pointfile loaded)`;
          log.textContent += (log.textContent ? '\n' : '') + '[editor] Leak pointfile loaded\n';
          log.scrollTop = log.scrollHeight;
          this.editor.statusMessage = 'Leak detected: pointfile loaded';
        } else {
          dialog.classList.add('success');
          this.editor.clearPointfile(false);
          status.textContent = `Compiled successfully (${(result.bsp.length / 1024).toFixed(1)} KB)`;
          this.editor.statusMessage = 'BSP compiled successfully';
        }

        saveBtn.hidden = false;
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

        runBtn.hidden = false;
        runBtn.onclick = () => {
          this.openBspPreview(baseName, result.bsp!);
        };

        if (autoPlay && !dismissed) {
          overlay.remove();
          this.openBspPreview(baseName, result.bsp);
        }
      } else {
        dialog.classList.add('error');
        if (result.pointfileText && this.editor.loadPointfileText(result.pointfileText, 'Leak detected: loaded pointfile')) {
          status.textContent = 'Compilation failed (leak pointfile loaded)';
          log.textContent += (log.textContent ? '\n' : '') + '[editor] Leak pointfile loaded\n';
          log.scrollTop = log.scrollHeight;
          this.editor.statusMessage = 'Leak detected: pointfile loaded';
        } else {
          this.editor.clearPointfile(false);
          status.textContent = 'Compilation failed';
          this.editor.statusMessage = 'BSP compilation failed';
        }
      }
    };

    if (autoPlay) compileBtn.click();
  }

  private openBspPreview(mapName: string, bsp: Uint8Array): void {
    document.getElementById('game-preview-overlay')?.remove();

    const safeMapName = mapName.replace(/[^a-zA-Z0-9_-]/g, '') || 'compile';
    const bspCopy = new Uint8Array(bsp.byteLength);
    bspCopy.set(bsp);

    const overlay = document.createElement('div');
    overlay.id = 'game-preview-overlay';
    overlay.className = 'editor-dialog-overlay game-preview-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'game-preview-title');

    const dialog = document.createElement('div');
    dialog.className = 'editor-dialog game-preview-dialog';

    const title = document.createElement('div');
    title.id = 'game-preview-title';
    title.className = 'editor-dialog-title';
    title.textContent = `Play ${safeMapName}`;

    const status = document.createElement('div');
    status.className = 'game-preview-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Preparing browser-local PK3 files...';

    const hint = document.createElement('div');
    hint.className = 'game-preview-hint';
    hint.append('Click the game view to capture the mouse. Press Escape to release it. · ');
    const sourceLink = document.createElement('a');
    sourceLink.href = '/ioquake3/SOURCE.md';
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener';
    sourceLink.textContent = 'ioquake3 source and license';
    hint.appendChild(sourceLink);

    const header = document.createElement('div');
    header.className = 'game-preview-header';
    header.append(title, status, hint);

    const frame = document.createElement('iframe');
    frame.className = 'game-preview-frame';
    frame.title = `ioquake3 preview of ${safeMapName}`;
    frame.src = '/ioquake3/player.html';
    frame.allow = 'autoplay; fullscreen';
    frame.setAttribute('allowfullscreen', '');

    const actions = document.createElement('div');
    actions.className = 'editor-dialog-actions game-preview-actions';

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.type = 'button';
    fullscreenBtn.className = 'btn';
    fullscreenBtn.textContent = 'Fullscreen';
    fullscreenBtn.onclick = () => {
      void frame.requestFullscreen().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        status.textContent = `Could not enter fullscreen: ${message}`;
      });
    };

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn primary';
    closeBtn.textContent = 'Close';

    let launchSent = false;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
      const message = event.data;
      if (message?.type === 'q3edit-player:ready' && !launchSent) {
        launchSent = true;
        frame.contentWindow?.postMessage({
          type: 'q3edit-player:launch',
          mapName: safeMapName,
          bsp: bspCopy.buffer,
        }, window.location.origin, [bspCopy.buffer]);
      } else if (message?.type === 'q3edit-player:status') {
        status.textContent = message.message;
      } else if (message?.type === 'q3edit-player:running') {
        dialog.classList.add('running');
        status.textContent = `Running ${safeMapName}`;
        this.editor.statusMessage = `Running ${safeMapName} in browser ioquake3`;
      } else if (message?.type === 'q3edit-player:capture') {
        const captured = message.captured === true;
        dialog.classList.toggle('captured', captured);
        if (!captured) closeBtn.focus();
      } else if (message?.type === 'q3edit-player:capture-error') {
        status.textContent = message.message;
        this.editor.statusMessage = message.message;
      } else if (message?.type === 'q3edit-player:error') {
        dialog.classList.add('error');
        status.textContent = `Could not start: ${message.message}`;
        this.editor.statusMessage = `ioquake3 failed: ${message.message}`;
      }
    };

    const close = () => {
      window.removeEventListener('message', onMessage);
      frame.src = 'about:blank';
      overlay.remove();
    };
    closeBtn.onclick = close;

    window.addEventListener('message', onMessage);
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && event.target !== frame) {
        close();
        event.stopPropagation();
      }
    });

    actions.append(fullscreenBtn, closeBtn);
    dialog.append(frame, header, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    closeBtn.focus();
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
      const asset = this.texMgr?.getTextureAsset(tex);
      if (asset) {
        const overrides = asset.overriddenSources.length > 0
          ? `; overrides ${asset.overriddenSources.map(source => source.archiveName).join(', ')}`
          : '';
        item.title = `${asset.path} — ${asset.source.archiveName}${overrides}`;
      }

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
