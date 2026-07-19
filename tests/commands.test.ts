import { describe, expect, it, vi } from 'vitest';
import {
  CommandRegistry,
  formatShortcut,
  normalizeShortcut,
  shortcutFromKeyboardEvent,
  type KeyboardShortcutEvent,
} from '../src/commands';

const keyEvent = (key: string, overrides: Partial<KeyboardShortcutEvent> = {}): KeyboardShortcutEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('CommandRegistry', () => {
  it('rejects duplicate command IDs', () => {
    const registry = new CommandRegistry({});
    registry.register({ id: 'file.save', label: 'Save', execute: () => {} });

    expect(() => registry.register({ id: 'file.save', label: 'Save again', execute: () => {} }))
      .toThrow('Duplicate command ID: file.save');
  });

  it('rejects equivalent conflicting shortcuts', () => {
    const registry = new CommandRegistry({});
    registry.register({ id: 'file.save', label: 'Save', defaultShortcut: 'Mod+S', execute: () => {} });

    expect(() => registry.register({ id: 'other.save', label: 'Other', defaultShortcut: 'Ctrl+s', execute: () => {} }))
      .toThrow('Shortcut Mod+S is already registered by file.save');
  });

  it('dispatches Control and Command through the same Mod shortcut', () => {
    const execute = vi.fn();
    const registry = new CommandRegistry({});
    registry.register({ id: 'file.save', label: 'Save', defaultShortcut: 'Mod+S', execute });

    expect(registry.dispatchKeyboardEvent(keyEvent('s', { ctrlKey: true }))).toBe(true);
    expect(registry.dispatchKeyboardEvent(keyEvent('s', { metaKey: true }))).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch disabled commands and exposes shared state', () => {
    const context = { enabled: false, checked: true, label: 'Dynamic' };
    const execute = vi.fn();
    const registry = new CommandRegistry(context);
    registry.register({
      id: 'view.dynamic',
      label: ctx => ctx.label,
      defaultShortcut: 'D',
      execute,
      enabled: ctx => ctx.enabled,
      checked: ctx => ctx.checked,
    });

    expect(registry.getState('view.dynamic')).toEqual({
      label: 'Dynamic',
      description: undefined,
      shortcut: 'D',
      enabled: false,
      checked: true,
    });
    expect(registry.dispatchKeyboardEvent(keyEvent('d'))).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('notifies all subscribed UI surfaces of state changes', () => {
    const registry = new CommandRegistry({});
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = registry.subscribe(first);
    registry.subscribe(second);

    registry.notifyStateChanged();
    unsubscribe();
    registry.notifyStateChanged();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});

describe('command shortcuts', () => {
  it('normalizes aliases and modifier order', () => {
    expect(normalizeShortcut('Shift+Ctrl+s')).toBe('Mod+Shift+S');
    expect(normalizeShortcut('Command+Option+1')).toBe('Mod+Alt+1');
    expect(normalizeShortcut('PgDn')).toBe('PageDown');
  });

  it('normalizes keyboard events independently of Control or Command', () => {
    expect(shortcutFromKeyboardEvent(keyEvent('S', { ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+S');
    expect(shortcutFromKeyboardEvent(keyEvent('[', { code: 'BracketLeft' }))).toBe('BracketLeft');
  });

  it('formats shortcuts for the current platform', () => {
    expect(formatShortcut('Mod+Shift+S', 'Win32')).toBe('Ctrl+Shift+S');
    expect(formatShortcut('Mod+Shift+S', 'MacIntel')).toBe('⌘⇧S');
  });
});
