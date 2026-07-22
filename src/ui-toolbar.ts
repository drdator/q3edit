import { Editor } from './editor';
import { BRUSH_PRIMITIVES, brushPrimitiveSideRange, brushPrimitiveUsesSides } from './brush-primitives';
import { applyBrushPrimitiveToolbarIcon, brushPrimitiveToolbarIconMarkup } from './brush-primitive-icons';
import { formatShortcut, type CommandId, type CommandRegistry } from './commands';
import type { EditorCommandContext } from './editor-commands';
import { createEntityClassPicker } from './entity-class-picker';

export interface ToolbarContext {
  editor: Editor;
  commands: CommandRegistry<EditorCommandContext>;
}

export function buildToolbar(ctx: ToolbarContext): void {
  const bar = document.getElementById('toolbar')!;
  const toolList = document.createElement('div');
  toolList.className = 'toolbar-tools';
  const footer = document.createElement('div');
  footer.className = 'toolbar-footer';
  bar.replaceChildren(toolList, footer);
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
    container?: HTMLElement;
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
    (opts.container ?? toolList).appendChild(btn);
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

  const sidesSelect = document.createElement('input');
  sidesSelect.type = 'number';
  sidesSelect.id = 'toolbar-brush-sides';
  sidesSelect.min = '3'; sidesSelect.max = '64'; sidesSelect.step = '1'; sidesSelect.value = String(ctx.editor.currentBrushSides);
  createToolBody.appendChild(sidesSelect);

  const exactButton = document.createElement('div'); exactButton.className = 'btn'; exactButton.textContent = 'Exact Primitive...';
  exactButton.addEventListener('mousedown', () => void ctx.commands.execute('brush.create-exact'));
  createToolBody.appendChild(exactButton);

  document.body.appendChild(createToolPanel);

  let createToolButton: HTMLElement | null = null;
  let entityToolButton: HTMLElement | null = null;

  const syncCreateToolPanel = () => {
    primitiveSelect.value = ctx.editor.currentBrushPrimitive;
    const range = brushPrimitiveSideRange(ctx.editor.currentBrushPrimitive);
    if (range) {
      sidesSelect.min = String(range.min); sidesSelect.max = String(range.max);
      ctx.editor.currentBrushSides = Math.max(range.min, Math.min(range.max, Math.round(ctx.editor.currentBrushSides)));
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
    closeEntityToolPanel();
    syncCreateToolPanel();
    setCreateToolButtonIcon();
    createToolPanel.classList.add('open');
    createToolButton.classList.add('active-panel');
    positionCreateToolPanel();
  };

  const entityToolPanel = document.createElement('div');
  entityToolPanel.className = 'panel floating-panel tool-popover-panel entity-tool-popover';
  entityToolPanel.id = 'entity-tool-panel';
  const entityToolHeader = document.createElement('div');
  entityToolHeader.className = 'panel-header';
  entityToolHeader.textContent = 'Place Entity';
  const entityToolBody = document.createElement('div');
  entityToolBody.className = 'panel-body';
  entityToolPanel.append(entityToolHeader, entityToolBody);

  const closeEntityToolPanel = () => {
    entityToolPanel.classList.remove('open');
    entityToolButton?.classList.remove('active-panel');
  };
  const updateEntityToolButtonTitle = (classname = ctx.editor.currentEntityClass) => {
    const shortcut = ctx.commands.getState('tool.entity').shortcut;
    if (entityToolButton) entityToolButton.title = `Place Entity: ${classname}${shortcut ? ` (${formatShortcut(shortcut)})` : ''}`;
  };
  const entityPicker = createEntityClassPicker(ctx.editor, {
    idPrefix: 'toolbar-entity-class',
    listSize: 11,
    onConfirm: () => closeEntityToolPanel(),
    onSelectionChanged: updateEntityToolButtonTitle,
  });
  entityToolBody.appendChild(entityPicker.element);
  document.body.appendChild(entityToolPanel);

  const positionEntityToolPanel = () => {
    if (!entityToolButton) return;
    const rect = entityToolButton.getBoundingClientRect();
    entityToolPanel.style.left = `${rect.right + 8}px`;
    const maxTop = Math.max(8, window.innerHeight - entityToolPanel.offsetHeight - 8);
    entityToolPanel.style.top = `${Math.min(maxTop, Math.max(8, rect.top))}px`;
  };
  const openEntityToolPanel = () => {
    if (!entityToolButton) return;
    closeCreateToolPanel();
    entityPicker.refresh();
    entityToolPanel.classList.add('open');
    entityToolButton.classList.add('active-panel');
    positionEntityToolPanel();
    entityPicker.focus();
  };

  primitiveSelect.addEventListener('change', () => {
    ctx.editor.currentBrushPrimitive = primitiveSelect.value as typeof ctx.editor.currentBrushPrimitive;
    syncCreateToolPanel();
    setCreateToolButtonIcon();
    ctx.editor.redrawRequested = true;
    ctx.editor.persistCurrentPreferences();
  });
  sidesSelect.addEventListener('change', () => {
    const range = brushPrimitiveSideRange(ctx.editor.currentBrushPrimitive);
    if (!range) return;
    ctx.editor.currentBrushSides = Math.max(range.min, Math.min(range.max, Math.round(Number(sidesSelect.value)) || range.min));
    sidesSelect.value = String(ctx.editor.currentBrushSides);
    ctx.editor.redrawRequested = true;
    ctx.editor.persistCurrentPreferences();
  });

  document.addEventListener('mousedown', (event) => {
    const target = event.target as Node | null;
    if (createToolPanel.classList.contains('open') &&
        !(target && (createToolPanel.contains(target) || createToolButton?.contains(target)))) closeCreateToolPanel();
    if (entityToolPanel.classList.contains('open') &&
        !(target && (entityToolPanel.contains(target) || entityToolButton?.contains(target)))) closeEntityToolPanel();
  });
  window.addEventListener('resize', () => {
    if (createToolPanel.classList.contains('open')) positionCreateToolPanel();
    if (entityToolPanel.classList.contains('open')) positionEntityToolPanel();
  });
  window.addEventListener('scroll', () => {
    if (createToolPanel.classList.contains('open')) positionCreateToolPanel();
    if (entityToolPanel.classList.contains('open')) positionEntityToolPanel();
  }, true);
  entityToolPanel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeEntityToolPanel(); entityToolButton?.focus(); }
  });

  const tools = [
    { id: 'select', commandId: 'tool.select', icon: icon('cursor') },
    { id: 'create', commandId: 'tool.create', icon: brushPrimitiveToolbarIconMarkup(ctx.editor.currentBrushPrimitive) },
    { id: 'entity', commandId: 'tool.entity', icon: icon('map-pin') },
    { id: 'clip', commandId: 'tool.clip', icon: icon('scissors') },
    { id: 'rotate', commandId: 'tool.rotate', icon: icon('arrows-clockwise') },
  ];

  for (const tool of tools) {
    const btn = addBtn({
      id: tool.id === 'create' ? 'tool-create' : tool.id === 'entity' ? 'tool-entity' : undefined,
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

        if (tool.id === 'entity') {
          if (ctx.editor.activeTool !== 'entity') {
            void ctx.commands.execute(tool.commandId);
            openEntityToolPanel();
            return;
          }
          if (entityToolPanel.classList.contains('open')) closeEntityToolPanel();
          else openEntityToolPanel();
          return;
        }

        closeCreateToolPanel();
        closeEntityToolPanel();
        void ctx.commands.execute(tool.commandId);
      },
    });
    if (tool.id === 'create') {
      createToolButton = btn;
      setCreateToolButtonIcon();
    } else if (tool.id === 'entity') {
      entityToolButton = btn;
      entityPicker.refresh();
      refreshCommandState.push(updateEntityToolButtonTitle);
    }
  }

  toolList.appendChild(createSeparator());

  addBtn({
    id: 'terrain-panel-toggle',
    commandId: 'terrain.open-panel',
    icon: icon('mountains'),
  });

  toolList.appendChild(createSeparator());

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

  toolList.appendChild(createSeparator());

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

  toolList.appendChild(createSeparator());

  addBtn({
    id: 'invis-toggle',
    commandId: 'view.invisible-mode',
    icon: icon('eye'),
  });

  toolList.appendChild(createSeparator());

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

  toolList.appendChild(createSeparator());

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

  toolList.appendChild(createSeparator());

  addBtn({
    commandId: 'edit.undo',
    icon: icon('arrow-counter-clockwise'),
  });
  addBtn({
    commandId: 'edit.redo',
    icon: icon('arrow-clockwise'),
  });

  footer.appendChild(createSeparator());

  addBtn({
    id: 'quick-play',
    commandId: 'file.quick-play',
    icon: icon('play'),
    container: footer,
  });

  ctx.commands.subscribe(() => {
    for (const refresh of refreshCommandState) refresh();
  });
}
