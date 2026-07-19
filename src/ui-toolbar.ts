import { Editor, Tool } from './editor';
import { BRUSH_PRIMITIVES, brushPrimitiveUsesSides } from './brush-primitives';
import { applyBrushPrimitiveToolbarIcon, brushPrimitiveToolbarIconMarkup } from './brush-primitive-icons';

export interface ToolbarContext {
  editor: Editor;
  setTool: (tool: Tool) => void;
  openTerrainPanel: () => void;
  increaseGrid: () => void;
  toggleSnap: () => void;
  toggleGeoSnap: () => void;
  cycleInvisibleMode: () => void;
}

export function buildToolbar(ctx: ToolbarContext): void {
  const bar = document.getElementById('toolbar')!;

  const icon = (name: string, weight: string = 'regular'): string =>
    `<i class="ph${weight === 'regular' ? '' : '-' + weight} ph-${name}"></i>`;

  const setCreateToolButtonIcon = () => {
    applyBrushPrimitiveToolbarIcon(createToolButton, ctx.editor.currentBrushPrimitive);
  };

  const createSeparator = (): HTMLElement => {
    const sep = document.createElement('div');
    sep.className = 'tool-separator';
    return sep;
  };

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
    if (opts.dataset) {
      for (const [k, v] of Object.entries(opts.dataset)) btn.dataset[k] = v;
    }
    btn.addEventListener('mousedown', () => opts.onClick());
    bar.appendChild(btn);
    return btn;
  };

  const createToolPanel = document.createElement('div');
  createToolPanel.className = 'panel floating-panel tool-popover-panel';
  createToolPanel.id = 'create-tool-panel';

  const createToolHeader = document.createElement('div');
  createToolHeader.className = 'panel-header';
  createToolHeader.textContent = 'Create Brush';
  createToolPanel.appendChild(createToolHeader);

  const createToolBody = document.createElement('div');
  createToolBody.className = 'panel-body';
  createToolPanel.appendChild(createToolBody);

  const primitiveLabel = document.createElement('label');
  primitiveLabel.textContent = 'Primitive';
  createToolBody.appendChild(primitiveLabel);

  const primitiveSelect = document.createElement('select');
  primitiveSelect.id = 'toolbar-brush-primitive';
  for (const option of BRUSH_PRIMITIVES) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    primitiveSelect.appendChild(opt);
  }
  createToolBody.appendChild(primitiveSelect);

  const sidesLabel = document.createElement('label');
  sidesLabel.textContent = 'Sides';
  createToolBody.appendChild(sidesLabel);

  const sidesSelect = document.createElement('select');
  sidesSelect.id = 'toolbar-brush-sides';
  for (let sides = 3; sides <= 9; sides++) {
    const opt = document.createElement('option');
    opt.value = String(sides);
    opt.textContent = String(sides);
    sidesSelect.appendChild(opt);
  }
  createToolBody.appendChild(sidesSelect);

  document.body.appendChild(createToolPanel);

  let createToolButton: HTMLElement | null = null;

  const syncCreateToolPanel = () => {
    primitiveSelect.value = ctx.editor.currentBrushPrimitive;
    for (const option of Array.from(sidesSelect.options)) {
      option.disabled = ctx.editor.currentBrushPrimitive === 'sphere' && Number(option.value) < 4;
    }
    if (ctx.editor.currentBrushPrimitive === 'sphere' && ctx.editor.currentBrushSides < 4) {
      ctx.editor.currentBrushSides = 4;
    }
    sidesSelect.value = String(ctx.editor.currentBrushSides);
    const usesSides = brushPrimitiveUsesSides(ctx.editor.currentBrushPrimitive);
    sidesSelect.disabled = !usesSides;
    sidesLabel.style.opacity = usesSides ? '1' : '0.5';
  };

  const positionCreateToolPanel = () => {
    if (!createToolButton) return;
    const rect = createToolButton.getBoundingClientRect();
    createToolPanel.style.left = `${rect.right + 8}px`;
    const maxTop = Math.max(8, window.innerHeight - createToolPanel.offsetHeight - 8);
    createToolPanel.style.top = `${Math.min(maxTop, Math.max(8, rect.top))}px`;
  };

  const closeCreateToolPanel = () => {
    createToolPanel.classList.remove('open');
    createToolButton?.classList.remove('active-panel');
  };

  const openCreateToolPanel = () => {
    if (!createToolButton) return;
    syncCreateToolPanel();
    setCreateToolButtonIcon();
    createToolPanel.classList.add('open');
    createToolButton.classList.add('active-panel');
    positionCreateToolPanel();
  };

  primitiveSelect.addEventListener('change', () => {
    ctx.editor.currentBrushPrimitive = primitiveSelect.value as typeof ctx.editor.currentBrushPrimitive;
    syncCreateToolPanel();
    setCreateToolButtonIcon();
    ctx.editor.redrawRequested = true;
  });
  sidesSelect.addEventListener('change', () => {
    ctx.editor.currentBrushSides = Number(sidesSelect.value);
    ctx.editor.redrawRequested = true;
  });

  document.addEventListener('mousedown', (event) => {
    const target = event.target as Node | null;
    if (!createToolPanel.classList.contains('open')) return;
    if (target && (createToolPanel.contains(target) || createToolButton?.contains(target))) return;
    closeCreateToolPanel();
  });
  window.addEventListener('resize', () => {
    if (createToolPanel.classList.contains('open')) positionCreateToolPanel();
  });
  window.addEventListener('scroll', () => {
    if (createToolPanel.classList.contains('open')) positionCreateToolPanel();
  }, true);

  const tools: { id: Tool; icon: string; title: string }[] = [
    { id: 'select', icon: icon('cursor'), title: 'Select (1)' },
    { id: 'create', icon: brushPrimitiveToolbarIconMarkup(ctx.editor.currentBrushPrimitive), title: 'Create Brush (2)' },
    { id: 'entity', icon: icon('map-pin'), title: 'Place Entity (3)' },
    { id: 'clip', icon: icon('scissors'), title: 'Clip (4)' },
    { id: 'rotate', icon: icon('arrows-clockwise'), title: 'Rotate (5)' },
  ];

  for (const tool of tools) {
    const btn = addBtn({
      id: tool.id === 'create' ? 'tool-create' : undefined,
      icon: tool.icon,
      title: tool.title,
      active: tool.id === ctx.editor.activeTool,
      dataset: { tool: tool.id },
      onClick: () => {
        if (tool.id === 'create') {
          if (ctx.editor.activeTool !== 'create') {
            ctx.setTool('create');
            openCreateToolPanel();
            return;
          }
          if (createToolPanel.classList.contains('open')) {
            closeCreateToolPanel();
          } else {
            openCreateToolPanel();
          }
          return;
        }

        closeCreateToolPanel();
        ctx.setTool(tool.id);
      },
    });
    if (tool.id === 'create') {
      createToolButton = btn;
      setCreateToolButtonIcon();
    }
  }

  bar.appendChild(createSeparator());

  addBtn({
    id: 'terrain-panel-toggle',
    icon: icon('mountains'),
    title: 'Open terrain panel',
    onClick: () => ctx.openTerrainPanel(),
  });

  bar.appendChild(createSeparator());

  addBtn({
    id: 'gizmo-move',
    icon: icon('arrows-out-cardinal'),
    title: 'Move mode (W)',
    active: ctx.editor.gizmoMode === 'move',
    onClick: () => { ctx.editor.gizmoMode = 'move'; ctx.editor.redrawRequested = true; },
  });
  addBtn({
    id: 'gizmo-scale',
    icon: icon('resize'),
    title: 'Scale mode (E)',
    active: ctx.editor.gizmoMode === 'scale',
    onClick: () => { ctx.editor.gizmoMode = 'scale'; ctx.editor.redrawRequested = true; },
  });

  bar.appendChild(createSeparator());

  addBtn({
    id: 'grid-label',
    icon: `<span class="tool-label">G:${ctx.editor.gridSize}</span>`,
    title: 'Grid size (click to increase, [ / ])',
    onClick: () => ctx.increaseGrid(),
  });

  addBtn({
    id: 'snap-toggle',
    icon: icon('magnet-straight'),
    title: 'Cycle grid snap: off / absolute / relative',
    active: true,
    onClick: () => ctx.toggleSnap(),
  });

  addBtn({
    id: 'geosnap-toggle',
    icon: icon('polygon'),
    title: 'Geometry snap (G)',
    onClick: () => ctx.toggleGeoSnap(),
  });

  addBtn({
    id: 'texlock-toggle',
    icon: `<span class="tool-label">TL</span>`,
    title: 'Texture lock (T)',
    active: ctx.editor.textureLock,
    onClick: () => ctx.editor.toggleTextureLock(),
  });

  bar.appendChild(createSeparator());

  addBtn({
    id: 'invis-toggle',
    icon: icon('eye'),
    title: 'Invisible geometry: show / dim / hide (I)',
    onClick: () => ctx.cycleInvisibleMode(),
  });

  bar.appendChild(createSeparator());

  addBtn({
    icon: icon('selection'),
    title: 'Make Hollow (Ctrl+Shift+H)',
    onClick: () => ctx.editor.csgHollow(),
  });
  addBtn({
    icon: icon('subtract'),
    title: 'CSG Subtract (Ctrl+Shift+S)',
    onClick: () => ctx.editor.csgSubtract(),
  });
  addBtn({
    icon: icon('unite'),
    title: 'Merge Brushes (Ctrl+Shift+M)',
    onClick: () => ctx.editor.csgMerge(),
  });

  bar.appendChild(createSeparator());

  addBtn({
    icon: icon('trash'),
    title: 'Delete (Del)',
    onClick: () => ctx.editor.deleteSelection(),
  });
  addBtn({
    icon: icon('copy'),
    title: 'Copy (Ctrl+C)',
    onClick: () => { void ctx.editor.copySelection(); },
  });
  addBtn({
    icon: icon('clipboard'),
    title: 'Paste (Ctrl+V)',
    onClick: () => { void ctx.editor.pasteClipboard(); },
  });
  addBtn({
    icon: icon('files'),
    title: 'Duplicate (Ctrl+D)',
    onClick: () => ctx.editor.duplicateSelection(),
  });

  bar.appendChild(createSeparator());

  addBtn({
    icon: icon('arrow-counter-clockwise'),
    title: 'Undo (Ctrl+Z)',
    onClick: () => ctx.editor.undo(),
  });
  addBtn({
    icon: icon('arrow-clockwise'),
    title: 'Redo (Ctrl+Y)',
    onClick: () => ctx.editor.redo(),
  });
}
