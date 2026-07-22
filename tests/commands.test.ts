import { describe, expect, it, vi } from 'vitest';
import {
  CommandRegistry,
  formatShortcut,
  normalizeShortcut,
  shortcutFromKeyboardEvent,
  type KeyboardShortcutEvent,
} from '../src/commands';
import { createEditorCommandRegistry, type EditorCommandContext } from '../src/editor-commands';
import { Editor } from '../src/editor';

const keyEvent = (key: string, overrides: Partial<KeyboardShortcutEvent> = {}): KeyboardShortcutEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('CommandRegistry', () => {
  it('registers the complete editor command set without conflicts', () => {
    const noop = () => {};
    const context: EditorCommandContext = {
      editor: {} as Editor,
      handleExitVertexMode: noop,
      openRotateDialog: noop,
      openScaleDialog: noop,
      compileBSP: noop,
      quickPlay: noop,
      managePakFiles: noop,
      openPreferences: noop,
      openProjectSettings: noop,
      openDiagnostics: noop,
      toggleMcpActivity: noop,
      isMcpActivityOpen: () => false,
      openMcpConnection: noop,
      openTerrainPanel: noop,
      toggleSidebar: noop,
      cycleInvisibleMode: noop,
      setTool: noop,
      setGrid: noop,
      increaseGrid: noop,
      decreaseGrid: noop,
      toggleSnap: noop,
      toggleGeoSnap: noop,
    };

    const registry = createEditorCommandRegistry(context);
    expect(registry.list().length).toBeGreaterThan(100);
    expect(registry.getState('edit.preferences').label).toBe('Preferences...');
    expect(registry.getState('file.project-settings').label).toBe('Project Settings...');
    expect(registry.getState('view.release-notes').label).toBe('Release Notes...');
    expect(registry.getState('view.mcp-activity').label).toBe('MCP Activity');
    expect(registry.getState('view.mcp-activity').checked).toBe(false);
  });

  it('exposes checked state for display categories, renderer modes, and lighting', () => {
    const noop = () => {};
    const editor = new Editor();
    const registry = createEditorCommandRegistry({
      editor, handleExitVertexMode: noop, openRotateDialog: noop, openScaleDialog: noop,
      compileBSP: noop, quickPlay: noop, managePakFiles: noop, openPreferences: noop, openProjectSettings: noop, openDiagnostics: noop,
      toggleMcpActivity: noop, isMcpActivityOpen: () => false, openMcpConnection: noop, openTerrainPanel: noop,
      toggleSidebar: () => { editor.preferences.sidebar.visible = !editor.preferences.sidebar.visible; },
      cycleInvisibleMode: noop, setTool: noop, setGrid: noop, increaseGrid: noop,
      decreaseGrid: noop, toggleSnap: noop, toggleGeoSnap: noop,
    });
    expect(registry.getState('view.display.lights').checked).toBe(true);
    registry.execute('view.display.lights');
    expect(registry.getState('view.display.lights').checked).toBe(false);
    registry.execute('view.renderer.flat');
    expect(registry.getState('view.renderer.flat').checked).toBe(true);
    registry.execute('view.texture-filter.nearest');
    expect(registry.getState('view.texture-filter.nearest').checked).toBe(true);
    registry.execute('view.dynamic-lights');
    expect(registry.getState('view.dynamic-lights').checked).toBe(true);
    expect(registry.getState('view.sidebar').checked).toBe(true);
    registry.execute('view.sidebar');
    expect(registry.getState('view.sidebar').checked).toBe(false);
  });

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

  it('supports normalized shortcut overrides, conflicts, disabling, and reset', () => {
    const registry = new CommandRegistry({});
    registry.register({ id: 'file.save', label: 'Save', defaultShortcut: 'Mod+S', execute: () => {} });
    registry.register({ id: 'file.open', label: 'Open', defaultShortcut: 'Mod+O', execute: () => {} });

    expect(registry.setShortcut('file.save', 'Shift+Ctrl+s')).toBeNull();
    expect(registry.shortcutFor('file.save')).toBe('Mod+Shift+S');
    expect(registry.findShortcutConflict('file.open', 'Ctrl+Shift+S')).toEqual({
      shortcut: 'Mod+Shift+S', commandId: 'file.open', conflictingCommandId: 'file.save',
    });
    expect(registry.setShortcut('file.open', 'Ctrl+Shift+S')).not.toBeNull();
    expect(registry.shortcutFor('file.open')).toBe('Mod+O');

    registry.setShortcut('file.save', null);
    expect(registry.shortcutFor('file.save')).toBeUndefined();
    registry.resetShortcut('file.save');
    expect(registry.shortcutFor('file.save')).toBe('Mod+S');
  });

  it('ignores missing commands and reports conflicts while applying stored overrides', () => {
    const registry = new CommandRegistry({});
    registry.register({ id: 'first', label: 'First', defaultShortcut: '1', execute: () => {} });
    registry.register({ id: 'second', label: 'Second', defaultShortcut: '2', execute: () => {} });

    expect(registry.applyShortcutOverrides({ missing: '3', first: '4', second: '4' })).toEqual([
      { shortcut: '4', commandId: 'second', conflictingCommandId: 'first' },
    ]);
    expect(registry.shortcutOverrideEntries()).toEqual({ first: '4' });
  });

  it('replaces shortcut overrides atomically so assignments can be swapped', () => {
    const registry = new CommandRegistry({});
    registry.register({ id: 'first', label: 'First', defaultShortcut: '1', execute: () => {} });
    registry.register({ id: 'second', label: 'Second', defaultShortcut: '2', execute: () => {} });
    expect(registry.replaceShortcutOverrides({ first: '2', second: '1' })).toEqual([]);
    expect(registry.shortcutFor('first')).toBe('2');
    expect(registry.shortcutFor('second')).toBe('1');
    expect(registry.replaceShortcutOverrides({ first: '3', second: '3' })).toHaveLength(1);
    expect(registry.shortcutFor('first')).toBe('2');
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
