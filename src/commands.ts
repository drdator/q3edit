export type CommandId = string;

export interface CommandMenuPlacement {
  menu: string;
  order: number;
  group?: string;
  submenu?: string;
}

export interface CommandToolbarPlacement {
  order: number;
  group?: string;
}

export interface CommandDefinition<Context> {
  id: CommandId;
  label: string | ((context: Context) => string);
  description?: string;
  defaultShortcut?: string;
  alternateShortcuts?: readonly string[];
  execute: (context: Context) => void | Promise<void>;
  enabled?: (context: Context) => boolean;
  checked?: (context: Context) => boolean;
  menu?: CommandMenuPlacement;
  toolbar?: CommandToolbarPlacement;
}

export interface CommandState {
  label: string;
  description?: string;
  shortcut?: string;
  enabled: boolean;
  checked: boolean;
}

export interface KeyboardShortcutEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type CommandStateListener = () => void;

const MODIFIER_ORDER = ['Mod', 'Alt', 'Shift'] as const;

function normalizeKeyName(key: string): string {
  const aliases: Record<string, string> = {
    ' ': 'Space',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    ArrowUp: 'ArrowUp',
    Backspace: 'Backspace',
    Del: 'Delete',
    Delete: 'Delete',
    Down: 'ArrowDown',
    Enter: 'Enter',
    Esc: 'Escape',
    Escape: 'Escape',
    Home: 'Home',
    Left: 'ArrowLeft',
    Minus: 'Minus',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
    PgDn: 'PageDown',
    PgUp: 'PageUp',
    Plus: 'Plus',
    Return: 'Enter',
    Right: 'ArrowRight',
    Spacebar: 'Space',
    Tab: 'Tab',
    Up: 'ArrowUp',
    '[': 'BracketLeft',
    ']': 'BracketRight',
  };
  if (aliases[key]) return aliases[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error('Shortcut cannot be empty');

  const modifiers = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'command' ||
        lower === 'meta' || lower === 'mod' || lower === 'cmdorctrl') {
      modifiers.add('Mod');
    } else if (lower === 'alt' || lower === 'option') {
      modifiers.add('Alt');
    } else if (lower === 'shift') {
      modifiers.add('Shift');
    } else {
      if (key !== null) throw new Error(`Shortcut has multiple keys: ${shortcut}`);
      key = normalizeKeyName(part);
    }
  }
  if (key === null) throw new Error(`Shortcut has no key: ${shortcut}`);

  return [...MODIFIER_ORDER.filter(modifier => modifiers.has(modifier)), key].join('+');
}

export function shortcutFromKeyboardEvent(event: KeyboardShortcutEvent): string | null {
  if (event.key === 'Control' || event.key === 'Meta' || event.key === 'Alt' || event.key === 'Shift') {
    return null;
  }

  let key = event.key;
  if (event.code === 'BracketLeft') key = 'BracketLeft';
  else if (event.code === 'BracketRight') key = 'BracketRight';
  else if (event.key === '+') key = 'Plus';
  else if (event.key === '-') key = 'Minus';

  return [
    ...(event.ctrlKey || event.metaKey ? ['Mod'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
    normalizeKeyName(key),
  ].join('+');
}

export function formatShortcut(shortcut: string, platform = globalThis.navigator?.platform ?? ''): string {
  const normalized = normalizeShortcut(shortcut);
  const parts = normalized.split('+');
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  if (!isMac) {
    return parts.map(part => part === 'Mod' ? 'Ctrl' : part === 'BracketLeft' ? '[' : part === 'BracketRight' ? ']' : part).join('+');
  }
  const symbols: Record<string, string> = {
    Mod: '⌘',
    Alt: '⌥',
    Shift: '⇧',
    BracketLeft: '[',
    BracketRight: ']',
    Escape: 'Esc',
  };
  return parts.map(part => symbols[part] ?? part).join('');
}

export class CommandRegistry<Context> {
  private readonly commands = new Map<CommandId, CommandDefinition<Context>>();
  private readonly shortcutOwners = new Map<string, CommandId>();
  private readonly listeners = new Set<CommandStateListener>();

  constructor(private readonly context: Context) {}

  register(command: CommandDefinition<Context>): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Duplicate command ID: ${command.id}`);
    }

    const shortcuts = [command.defaultShortcut, ...(command.alternateShortcuts ?? [])]
      .filter((shortcut): shortcut is string => shortcut !== undefined)
      .map(normalizeShortcut);
    for (const shortcut of shortcuts) {
      const owner = this.shortcutOwners.get(shortcut);
      if (owner) throw new Error(`Shortcut ${shortcut} is already registered by ${owner}`);
    }

    this.commands.set(command.id, command);
    for (const shortcut of shortcuts) this.shortcutOwners.set(shortcut, command.id);
  }

  registerAll(commands: readonly CommandDefinition<Context>[]): void {
    for (const command of commands) this.register(command);
  }

  get(id: CommandId): CommandDefinition<Context> {
    const command = this.commands.get(id);
    if (!command) throw new Error(`Unknown command: ${id}`);
    return command;
  }

  list(): readonly CommandDefinition<Context>[] {
    return [...this.commands.values()];
  }

  getState(id: CommandId): CommandState {
    const command = this.get(id);
    return {
      label: typeof command.label === 'function' ? command.label(this.context) : command.label,
      description: command.description,
      shortcut: command.defaultShortcut,
      enabled: command.enabled?.(this.context) ?? true,
      checked: command.checked?.(this.context) ?? false,
    };
  }

  execute(id: CommandId): void | Promise<void> {
    const command = this.get(id);
    if (command.enabled && !command.enabled(this.context)) return;
    return command.execute(this.context);
  }

  commandForKeyboardEvent(event: KeyboardShortcutEvent): CommandId | null {
    const shortcut = shortcutFromKeyboardEvent(event);
    return shortcut ? this.shortcutOwners.get(shortcut) ?? null : null;
  }

  dispatchKeyboardEvent(event: KeyboardShortcutEvent): boolean {
    const id = this.commandForKeyboardEvent(event);
    if (!id || !this.getState(id).enabled) return false;
    void this.execute(id);
    return true;
  }

  subscribe(listener: CommandStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyStateChanged(): void {
    for (const listener of this.listeners) listener();
  }
}
