import { Brush } from './brush';
import type { Editor } from './editor';
import { Entity } from './entity';
import { Patch } from './patch';

type BrushPanelMode = 'all' | 'brushes' | 'patches' | 'entities';

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

export class BrushPanel {
  private mode: BrushPanelMode = 'all';
  private signature = '';
  private readonly collapsedEntities = new WeakSet<Entity>();
  private readonly collapsedTerrainGroups = new Set<string>();
  private list: HTMLElement | null = null;

  constructor(private readonly editor: Editor) {}

  mount(): void {
    const body = document.getElementById('brush-body')!;
    const modeSelect = document.getElementById('brush-panel-mode') as HTMLSelectElement;
    modeSelect.addEventListener('change', () => {
      this.mode = modeSelect.value as BrushPanelMode;
      this.editor.selectionFilter = this.mode;
      this.signature = '';
      this.editor.redrawRequested = true;
    });
    modeSelect.addEventListener('mousedown', event => event.stopPropagation());

    const filter = document.createElement('div');
    filter.className = 'btn';
    filter.id = 'brush-filter-btn';
    filter.textContent = 'Render: All';
    filter.addEventListener('mousedown', () => {
      this.editor.renderSelectedOnly = !this.editor.renderSelectedOnly;
      filter.textContent = this.editor.renderSelectedOnly ? 'Render: Selected' : 'Render: All';
      this.editor.redrawRequested = true;
    });
    const controls = document.createElement('div');
    controls.className = 'brush-panel-controls';
    controls.append(modeSelect, filter);
    body.appendChild(controls);

    this.list = document.createElement('div');
    this.list.className = 'brush-list';
    this.list.id = 'brush-list';
    body.appendChild(this.list);

    body.addEventListener('mousedown', event => {
      if (event.target !== body || event.offsetX >= body.clientWidth) return;
      this.editor.clearSelection();
    });
  }

  update(): void {
    if (!this.list) return;
    const items = this.describeItems();
    this.renderItems(items);
    this.updateSelection(items);
  }

  private describeItems(): ListItem[] {
    const editor = this.editor;
    const items: ListItem[] = [];
    const regionSignature = editor.regionBounds
      ? `${editor.regionBounds.mins.join(',')}:${editor.regionBounds.maxs.join(',')}`
      : 'none';
    const signatureParts: string[] = [this.mode, regionSignature, JSON.stringify(editor.display.categories)];

    for (let entityIdx = 0; entityIdx < editor.entities.length; entityIdx++) {
      const entity = editor.entities[entityIdx];
      if (!editor.isEntityVisible(entity)) continue;
      const brushChildren = (this.mode === 'all' || this.mode === 'brushes')
        ? entity.brushes
          .filter(brush => editor.isBrushVisible(brush, entity))
          .map((brush, index) => ({
            kind: 'brush' as const,
            entity,
            brush,
            index,
            entityIdx,
            label: brush.name || `brush ${index}`,
          }))
        : [];
      const patchChildren = (this.mode === 'all' || this.mode === 'patches')
        ? this.patchItems(entity, entityIdx, signatureParts)
        : [];

      const includeEntity =
        this.mode === 'entities'
        || this.mode === 'all'
        || brushChildren.length > 0
        || patchChildren.length > 0;
      if (!includeEntity) continue;

      const childCount = brushChildren.length + patchChildren.length;
      const collapsed = childCount > 0 && this.collapsedEntities.has(entity);
      items.push({
        kind: 'entity',
        entity,
        entityIdx,
        label: this.entityLabel(entity, entityIdx === 0),
        meta: this.entityMeta(entity, brushChildren.length, patchChildren.length),
        collapsible: this.mode !== 'entities' && childCount > 0,
        collapsed,
      });
      signatureParts.push(`${entityIdx}:${entity.classname}:${entity.brushes.length}:${entity.patches.length}:${collapsed ? 1 : 0}`);
      if (this.mode !== 'entities' && !collapsed) items.push(...brushChildren, ...patchChildren);
    }

    const signature = signatureParts.join('|');
    if (this.signature === signature) return items;
    this.signature = signature;
    this.rebuildItems(items);
    return items;
  }

  private patchItems(entity: Entity, entityIdx: number, signatureParts: string[]): Array<Extract<ListItem, { kind: 'terrainGroup' | 'patch' }>> {
    const visible = entity.patches
      .map((patch, index) => ({ patch, index }))
      .filter(item => this.editor.isPatchVisible(item.patch, entity));
    const groups = new Map<string, Array<{ patch: Patch; index: number }>>();
    for (const item of visible) {
      if (!item.patch.terrainGroupId) continue;
      const group = groups.get(item.patch.terrainGroupId) ?? [];
      group.push(item);
      groups.set(item.patch.terrainGroupId, group);
    }

    const result: Array<Extract<ListItem, { kind: 'terrainGroup' | 'patch' }>> = [];
    const emitted = new Set<string>();
    for (const item of visible) {
      const groupId = item.patch.terrainGroupId;
      const grouped = groupId ? groups.get(groupId) : null;
      if (groupId && grouped && grouped.length > 1) {
        if (emitted.has(groupId)) continue;
        emitted.add(groupId);
        const collapseKey = `${entityIdx}:${groupId}`;
        const collapsed = this.collapsedTerrainGroups.has(collapseKey);
        result.push({
          kind: 'terrainGroup',
          entity,
          entityIdx,
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
          result.push(...grouped.map(groupItem => ({
            kind: 'patch' as const,
            entity,
            patch: groupItem.patch,
            index: groupItem.index,
            entityIdx,
            label: `patch ${groupItem.index}`,
            grouped: true,
          })));
        }
        continue;
      }
      result.push({
        kind: 'patch',
        entity,
        patch: item.patch,
        index: item.index,
        entityIdx,
        label: `patch ${item.index}`,
        grouped: false,
      });
    }
    return result;
  }

  private renderItems(items: ListItem[]): void {
    if (!this.list || this.list.children.length === items.length) return;
    this.rebuildItems(items);
  }

  private rebuildItems(items: ListItem[]): void {
    if (!this.list) return;
    this.list.replaceChildren();
    for (const item of items) {
      const element = document.createElement('div');
      element.className = item.kind === 'entity'
        ? 'brush-item brush-tree-entity'
        : item.kind === 'terrainGroup'
          ? 'brush-item brush-tree-child brush-tree-group'
          : item.kind === 'patch' && item.grouped
            ? 'brush-item brush-tree-grandchild'
            : 'brush-item brush-tree-child';
      const row = document.createElement('div');
      row.className = 'brush-tree-row';
      if (item.kind === 'entity') this.buildEntityRow(row, item);
      else if (item.kind === 'terrainGroup') this.buildTerrainGroupRow(row, item);
      else this.buildChildRow(row, item);
      element.appendChild(row);
      element.addEventListener('mousedown', event => this.selectItem(item, event));
      this.list.appendChild(element);
    }
  }

  private buildEntityRow(row: HTMLElement, item: Extract<ListItem, { kind: 'entity' }>): void {
    const toggle = document.createElement('span');
    toggle.className = `brush-tree-toggle${item.collapsible ? '' : ' empty'}`;
    toggle.textContent = item.collapsible ? (item.collapsed ? '+' : '\u2212') : '';
    if (item.collapsible) {
      toggle.addEventListener('mousedown', event => {
        event.stopPropagation();
        if (this.collapsedEntities.has(item.entity)) this.collapsedEntities.delete(item.entity);
        else this.collapsedEntities.add(item.entity);
        this.signature = '';
        this.editor.redrawRequested = true;
      });
    }
    const label = document.createElement('span');
    label.className = 'brush-tree-label';
    label.textContent = item.label;
    const meta = document.createElement('span');
    meta.className = 'brush-tree-meta';
    meta.textContent = item.meta;
    row.append(toggle, label, meta);
  }

  private buildTerrainGroupRow(row: HTMLElement, item: Extract<ListItem, { kind: 'terrainGroup' }>): void {
    const indent = document.createElement('span');
    indent.className = 'brush-tree-indent';
    const toggle = document.createElement('span');
    toggle.className = `brush-tree-toggle${item.collapsible ? '' : ' empty'}`;
    toggle.textContent = item.collapsed ? '+' : '\u2212';
    toggle.addEventListener('mousedown', event => {
      event.stopPropagation();
      const key = `${item.entityIdx}:${item.groupId}`;
      if (this.collapsedTerrainGroups.has(key)) this.collapsedTerrainGroups.delete(key);
      else this.collapsedTerrainGroups.add(key);
      this.signature = '';
      this.editor.redrawRequested = true;
    });
    const kind = document.createElement('span');
    kind.className = 'brush-tree-kind';
    kind.textContent = 'T';
    const label = document.createElement('span');
    label.className = 'brush-tree-label';
    label.textContent = item.label;
    const meta = document.createElement('span');
    meta.className = 'brush-tree-meta';
    meta.textContent = item.meta;
    row.append(indent, toggle, kind, label, meta);
  }

  private buildChildRow(row: HTMLElement, item: Extract<ListItem, { kind: 'brush' | 'patch' }>): void {
    const indent = document.createElement('span');
    indent.className = 'brush-tree-indent';
    const kind = document.createElement('span');
    kind.className = 'brush-tree-kind';
    kind.textContent = item.kind === 'brush' ? 'B' : 'P';
    const label = document.createElement('span');
    label.className = 'brush-tree-label';
    label.textContent = item.label;
    row.append(indent, kind, label);
  }

  private selectItem(item: ListItem, event: MouseEvent): void {
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (item.kind === 'brush') this.editor.selectBrushDirect(item.entity, item.brush, additive);
    else if (item.kind === 'patch') this.editor.selectPatchDirect(item.entity, item.patch, additive);
    else if (item.kind === 'terrainGroup') this.editor.selectPatch(item.entity, item.representative, additive);
    else this.editor.selectEntity(item.entity, additive);
    this.editor.centerOnSelection();
  }

  private updateSelection(items: ListItem[]): void {
    if (!this.list) return;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const selected = item.kind === 'brush'
        ? this.editor.isSelected(item.brush)
        : item.kind === 'patch'
          ? this.editor.isPatchSelected(item.patch)
          : item.kind === 'terrainGroup'
            ? item.patches.every(groupPatch => this.editor.isPatchSelected(groupPatch.patch))
            : this.editor.isEntitySelected(item.entity);
      this.list.children[index]?.classList.toggle('selected', selected);
    }
  }

  private entityLabel(entity: Entity, isWorldspawn: boolean): string {
    if (isWorldspawn) return 'worldspawn';
    const name = entity.properties.targetname || entity.properties.name;
    return name ? `${entity.classname} "${name}"` : entity.classname;
  }

  private entityMeta(entity: Entity, brushCount: number, patchCount: number): string {
    const parts: string[] = [];
    if (brushCount > 0) parts.push(`${brushCount} brush${brushCount === 1 ? '' : 'es'}`);
    if (patchCount > 0) parts.push(`${patchCount} patch${patchCount === 1 ? '' : 'es'}`);
    if (parts.length === 0 && this.editor.isPointEntity(entity)) {
      const origin = this.editor.entityDisplayOrigin(entity);
      if (origin) parts.push(`@ ${origin[0].toFixed(0)} ${origin[1].toFixed(0)} ${origin[2].toFixed(0)}`);
    }
    return parts.join(', ');
  }
}
