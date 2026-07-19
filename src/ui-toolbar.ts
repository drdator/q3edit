import { Editor } from './editor';
import { BRUSH_PRIMITIVES, brushPrimitiveUsesSides } from './brush-primitives';
import { applyBrushPrimitiveToolbarIcon, brushPrimitiveToolbarIconMarkup } from './brush-primitive-icons';
import { formatShortcut, type CommandId, type CommandRegistry } from './commands';
import type { EditorCommandContext } from './editor-commands';

export interface ToolbarContext {
  editor: Editor;
  commands: CommandRegistry<EditorCommandContext>;
}

export function buildToolbar(ctx: ToolbarContext): void {
  const bar = document.getElementById('toolbar')!;
  const refreshCommandState: (() => void)[] = [];

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
    commandId?: CommandId;
    icon: string;
    title?: string;
    active?: boolean;
    dataset?: Record<string, string>;
    onClick?: () => void;
  }) => {
    const btn = document.createElement('div');
    btn.className = 'tool-btn' + (opts.active ? ' active' : '');
    if (opts.id) btn.id = opts.id;
    btn.innerHTML = opts.icon;
    if (opts.title) btn.title = opts.title;
    if (opts.dataset) {
      for (const [k, v] of Object.entries(opts.dataset)) btn.dataset[k] = v;
    }
    if (opts.commandId) {
      btn.dataset.command = opts.commandId;
      const refresh = () => {
        const state = ctx.commands.getState(opts.commandId!);
        btn.classList.toggle('active', state.checked);
        btn.classList.toggle('disabled', !state.enabled);
        btn.setAttribute('aria-disabled', String(!state.enabled));
        const shortcut = state.shortcut ? ` (${formatShortcut(state.shortcut)})` : '';
        btn.title = `${state.label}${shortcut}`;
      };
      refresh();
      refreshCommandState.push(refresh);
    }
    btn.addEventListener('mousedown', () => {
      if (opts.commandId && !ctx.commands.getState(opts.commandId).enabled) return;
      if (opts.onClick) opts.onClick();
      else if (opts.commandId) void ctx.commands.execute(opts.commandId);
    });
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

  const tools = [
    { id: 'select', commandId: 'tool.select', icon: icon('cursor') },
    { id: 'create', commandId: 'tool.create', icon: brushPrimitiveToolbarIconMarkup(ctx.editor.currentBrushPrimitive) },
    { id: 'entity', commandId: 'tool.entity', icon: icon('map-pin') },
    { id: 'clip', commandId: 'tool.clip', icon: icon('scissors') },
    { id: 'rotate', commandId: 'tool.rotate', icon: icon('arrows-clockwise') },
  ];

  for (const tool of tools) {
    const btn = addBtn({
      id: tool.id === 'create' ? 'tool-create' : undefined,
      commandId: tool.commandId,
      icon: tool.icon,
      dataset: { tool: tool.id },
      onClick: () => {
        if (tool.id === 'create') {
          if (ctx.editor.activeTool !== 'create') {
            void ctx.commands.execute(tool.commandId);
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
        void ctx.commands.execute(tool.commandId);
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
    commandId: 'terrain.open-panel',
    icon: icon('mountains'),
  });

  bar.appendChild(createSeparator());

  addBtn({
    id: 'gizmo-move',
    commandId: 'gizmo.move',
    icon: icon('arrows-out-cardinal'),
  });
  addBtn({
    id: 'gizmo-scale',
    commandId: 'gizmo.scale',
    icon: icon('resize'),
  });

  bar.appendChild(createSeparator());

  addBtn({
    id: 'grid-label',
    commandId: 'grid.larger',
    icon: `<span class="tool-label">G:${ctx.editor.gridSize}</span>`,
  });

  addBtn({
    id: 'snap-toggle',
    commandId: 'view.snap-mode',
    icon: icon('magnet-straight'),
  });

  addBtn({
    id: 'geosnap-toggle',
    commandId: 'view.geometry-snap',
    icon: icon('polygon'),
  });

  addBtn({
    id: 'texlock-toggle',
    commandId: 'view.texture-lock',
    icon: `<span class="tool-label">TL</span>`,
  });

  bar.appendChild(createSeparator());

  addBtn({
    id: 'invis-toggle',
    commandId: 'view.invisible-mode',
    icon: icon('eye'),
  });

  bar.appendChild(createSeparator());

  addBtn({
    commandId: 'csg.hollow',
    icon: icon('selection'),
  });
  addBtn({
    commandId: 'csg.subtract',
    icon: icon('subtract'),
  });
  addBtn({
    commandId: 'csg.merge',
    icon: icon('unite'),
  });

  bar.appendChild(createSeparator());

  addBtn({
    commandId: 'edit.delete',
    icon: icon('trash'),
  });
  addBtn({
    commandId: 'edit.copy',
    icon: icon('copy'),
  });
  addBtn({
    commandId: 'edit.paste',
    icon: icon('clipboard'),
  });
  addBtn({
    commandId: 'edit.duplicate',
    icon: icon('files'),
  });

  bar.appendChild(createSeparator());

  addBtn({
    commandId: 'edit.undo',
    icon: icon('arrow-counter-clockwise'),
  });
  addBtn({
    commandId: 'edit.redo',
    icon: icon('arrow-clockwise'),
  });

  ctx.commands.subscribe(() => {
    for (const refresh of refreshCommandState) refresh();
  });
}
