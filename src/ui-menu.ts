import { formatShortcut, type CommandDefinition, type CommandRegistry } from './commands';
import type { EditorCommandContext } from './editor-commands';

type EditorCommand = CommandDefinition<EditorCommandContext>;
type MenuEntry =
  | { kind: 'command'; command: EditorCommand }
  | { kind: 'submenu'; label: string; commands: EditorCommand[] }
  | { kind: 'separator' };

export interface MenuBarContext {
  commands: CommandRegistry<EditorCommandContext>;
  getOpenMenu: () => HTMLElement | null;
  setOpenMenu: (menu: HTMLElement | null) => void;
  closeMenus: () => void;
}

function menuEntries(commands: EditorCommand[]): MenuEntry[] {
  const entries: MenuEntry[] = [];
  let previousGroup: string | undefined;
  for (let index = 0; index < commands.length;) {
    const command = commands[index];
    const placement = command.menu!;
    if (previousGroup !== undefined && placement.group !== previousGroup) entries.push({ kind: 'separator' });
    previousGroup = placement.group;

    if (!placement.submenu) {
      entries.push({ kind: 'command', command });
      index++;
      continue;
    }

    const submenu = placement.submenu;
    const children: EditorCommand[] = [];
    while (index < commands.length && commands[index].menu?.submenu === submenu) {
      children.push(commands[index]);
      index++;
    }
    entries.push({ kind: 'submenu', label: submenu, commands: children });
  }
  return entries;
}

export function buildMenuBar(ctx: MenuBarContext): () => void {
  const bar = document.getElementById('menubar')!;
  const refreshState: (() => void)[] = [];
  const menuCommands = ctx.commands.list()
    .filter((command): command is EditorCommand & { menu: NonNullable<EditorCommand['menu']> } => command.menu !== undefined)
    .sort((a, b) => a.menu.menuOrder - b.menu.menuOrder || a.menu.order - b.menu.order);
  const menus = new Map<string, EditorCommand[]>();
  for (const command of menuCommands) {
    const commands = menus.get(command.menu.menu) ?? [];
    commands.push(command);
    menus.set(command.menu.menu, commands);
  }

  const appendCommand = (container: HTMLElement, command: EditorCommand): void => {
    const action = document.createElement('div');
    action.className = 'menu-action';
    action.dataset.command = command.id;
    const label = document.createElement('span');
    action.appendChild(label);
    if (command.defaultShortcut) {
      const shortcut = document.createElement('span');
      shortcut.className = 'shortcut';
      shortcut.textContent = formatShortcut(command.defaultShortcut);
      action.appendChild(shortcut);
    }

    const refresh = () => {
      const state = ctx.commands.getState(command.id);
      label.textContent = state.label;
      action.classList.toggle('disabled', !state.enabled);
      action.classList.toggle('checked', state.checked);
      action.setAttribute('aria-disabled', String(!state.enabled));
      action.setAttribute('aria-checked', String(state.checked));
    };
    refresh();
    refreshState.push(refresh);
    action.addEventListener('mousedown', event => {
      event.stopPropagation();
      if (!ctx.commands.getState(command.id).enabled) return;
      ctx.closeMenus();
      void ctx.commands.execute(command.id);
    });
    container.appendChild(action);
  };

  const appendEntries = (container: HTMLElement, entries: MenuEntry[]): void => {
    for (const entry of entries) {
      if (entry.kind === 'separator') {
        const separator = document.createElement('div');
        separator.className = 'menu-separator';
        container.appendChild(separator);
      } else if (entry.kind === 'command') {
        appendCommand(container, entry.command);
      } else {
        const submenuAction = document.createElement('div');
        submenuAction.className = 'menu-action has-submenu';
        const label = document.createElement('span');
        label.textContent = entry.label;
        submenuAction.appendChild(label);
        const arrow = document.createElement('span');
        arrow.className = 'submenu-arrow';
        arrow.textContent = '\u203a';
        submenuAction.appendChild(arrow);
        const submenu = document.createElement('div');
        submenu.className = 'menu-dropdown menu-submenu';
        for (const command of entry.commands) appendCommand(submenu, command);
        submenuAction.appendChild(submenu);
        submenuAction.addEventListener('mouseenter', () => submenuAction.classList.add('submenu-open'));
        submenuAction.addEventListener('mouseleave', () => submenuAction.classList.remove('submenu-open'));
        submenuAction.addEventListener('mousedown', event => {
          event.stopPropagation();
          submenuAction.classList.toggle('submenu-open');
        });
        container.appendChild(submenuAction);
      }
    }
  };

  for (const [name, commands] of menus) {
    const menuItem = document.createElement('div');
    menuItem.className = 'menu-item';
    menuItem.textContent = name;
    const dropdown = document.createElement('div');
    dropdown.className = 'menu-dropdown';
    appendEntries(dropdown, menuEntries(commands));
    menuItem.appendChild(dropdown);

    menuItem.addEventListener('mouseenter', () => {
      const openMenu = ctx.getOpenMenu();
      if (openMenu && openMenu !== menuItem) {
        for (const refresh of refreshState) refresh();
        openMenu.classList.remove('open');
        menuItem.classList.add('open');
        ctx.setOpenMenu(menuItem);
      }
    });
    menuItem.addEventListener('mousedown', event => {
      event.stopPropagation();
      if (ctx.getOpenMenu() === menuItem) ctx.closeMenus();
      else {
        for (const refresh of refreshState) refresh();
        ctx.closeMenus();
        menuItem.classList.add('open');
        ctx.setOpenMenu(menuItem);
      }
    });
    bar.appendChild(menuItem);
  }

  const sidebarToggle = document.createElement('button');
  sidebarToggle.type = 'button';
  sidebarToggle.className = 'menubar-icon-button menubar-sidebar-toggle';
  sidebarToggle.dataset.command = 'view.sidebar';
  sidebarToggle.innerHTML = '<i class="ph ph-sidebar-simple"></i>';
  const refreshSidebarToggle = () => {
    const state = ctx.commands.getState('view.sidebar');
    sidebarToggle.classList.toggle('active', state.checked);
    sidebarToggle.title = state.checked ? 'Hide right sidebar' : 'Show right sidebar';
    sidebarToggle.setAttribute('aria-label', sidebarToggle.title);
    sidebarToggle.setAttribute('aria-pressed', String(state.checked));
  };
  refreshSidebarToggle();
  refreshState.push(refreshSidebarToggle);
  sidebarToggle.addEventListener('mousedown', event => {
    event.stopPropagation();
    ctx.closeMenus();
    void ctx.commands.execute('view.sidebar');
  });
  bar.appendChild(sidebarToggle);

  document.addEventListener('mousedown', () => ctx.closeMenus());
  const refresh = () => { for (const update of refreshState) update(); };
  ctx.commands.subscribe(refresh);
  return refresh;
}
