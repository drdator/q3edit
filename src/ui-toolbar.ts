import { Editor, Tool } from './editor';

export interface ToolbarContext {
  editor: Editor;
  setTool: (tool: Tool) => void;
  increaseGrid: () => void;
  toggleSnap: () => void;
  toggleGeoSnap: () => void;
  cycleInvisibleMode: () => void;
}

export function buildToolbar(ctx: ToolbarContext): void {
  const bar = document.getElementById('toolbar')!;

  const icon = (name: string, weight: string = 'regular'): string =>
    `<i class="ph${weight === 'regular' ? '' : '-' + weight} ph-${name}"></i>`;

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

  const tools: { id: Tool; icon: string; title: string }[] = [
    { id: 'select', icon: icon('cursor'), title: 'Select (1)' },
    { id: 'create', icon: icon('cube'), title: 'Create Brush (2)' },
    { id: 'entity', icon: icon('map-pin'), title: 'Place Entity (3)' },
    { id: 'clip', icon: icon('scissors'), title: 'Clip (4)' },
    { id: 'rotate', icon: icon('arrows-clockwise'), title: 'Rotate (5)' },
  ];

  for (const tool of tools) {
    addBtn({
      icon: tool.icon,
      title: tool.title,
      active: tool.id === ctx.editor.activeTool,
      dataset: { tool: tool.id },
      onClick: () => ctx.setTool(tool.id),
    });
  }

  bar.appendChild(createSeparator());

  addBtn({
    id: 'gizmo-move',
    icon: icon('arrows-out-cardinal'),
    title: 'Move mode (W)',
    active: ctx.editor.gizmoMode === 'move',
    onClick: () => { ctx.editor.gizmoMode = 'move'; ctx.editor.dirty = true; },
  });
  addBtn({
    id: 'gizmo-scale',
    icon: icon('resize'),
    title: 'Scale mode (E)',
    active: ctx.editor.gizmoMode === 'scale',
    onClick: () => { ctx.editor.gizmoMode = 'scale'; ctx.editor.dirty = true; },
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
