import { afterEach, describe, expect, test, vi } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';

function editorWithMessage(message = 'before'): Editor {
  const editor = new Editor();
  const worldspawn = createEntity('worldspawn');
  worldspawn.properties.message = message;
  editor.entities = [worldspawn];
  return editor;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('document transactions', () => {
  test('creates a labeled undo and redo entry for a committed mutation', () => {
    const editor = editorWithMessage();

    editor.transact('Edit worldspawn message', () => {
      editor.entities[0].properties.message = 'after';
    });

    expect(editor.history.undoLabel).toBe('Edit worldspawn message');
    editor.undo();
    expect(editor.entities[0].properties.message).toBe('before');
    expect(editor.statusMessage).toBe('Undo: Edit worldspawn message');
    editor.redo();
    expect(editor.entities[0].properties.message).toBe('after');
    expect(editor.statusMessage).toBe('Redo: Edit worldspawn message');
  });

  test('does not create history for a no-op', () => {
    const editor = editorWithMessage();

    editor.transact('No change', () => {
      editor.entities[0].properties.message = 'before';
    });

    expect(editor.history.canUndo).toBe(false);
  });

  test('rolls back the document when a mutation throws', () => {
    const editor = editorWithMessage();

    expect(() => editor.transact('Broken edit', () => {
      editor.entities[0].properties.message = 'partial';
      throw new Error('stop');
    })).toThrow('stop');

    expect(editor.entities[0].properties.message).toBe('before');
    expect(editor.history.canUndo).toBe(false);
  });

  test('combines nested and explicit multi-step mutations into one entry', () => {
    const editor = editorWithMessage();

    editor.beginTransaction('Compound edit');
    editor.entities[0].properties.message = 'middle';
    editor.transact('Nested edit', () => {
      editor.entities[0].properties.message = 'after';
    });
    expect(editor.history.canUndo).toBe(false);
    expect(editor.commitTransaction()).toBe(true);

    expect(editor.history.undoCount).toBe(1);
    expect(editor.history.undoLabel).toBe('Compound edit');
    editor.undo();
    expect(editor.entities[0].properties.message).toBe('before');
  });

  test('can cancel an explicit transaction', () => {
    const editor = editorWithMessage();

    editor.beginTransaction('Cancelled edit');
    editor.entities[0].properties.message = 'after';
    expect(editor.cancelTransaction()).toBe(true);

    expect(editor.entities[0].properties.message).toBe('before');
    expect(editor.history.canUndo).toBe(false);
  });

  test('commits an active interaction before undoing it and clears stale edit state', () => {
    const editor = editorWithMessage();
    editor.patchEditMode = true;
    editor.patchEditData = [];
    editor.patchControlSelection = [{ dataIndex: 0, row: 0, col: 0 }];

    editor.beginTransaction('Active drag');
    editor.entities[0].properties.message = 'dragged';
    editor.undo();

    expect(editor.entities[0].properties.message).toBe('before');
    expect(editor.history.canUndo).toBe(false);
    expect(editor.history.redoLabel).toBe('Active drag');
    expect(editor.patchEditMode).toBe(false);
    expect(editor.patchControlSelection).toEqual([]);
  });

  test('coalesces repeated edits with the same key inside a bounded window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T10:00:00Z'));
    const editor = editorWithMessage();

    editor.transact('Edit message', () => {
      editor.entities[0].properties.message = 'first';
    }, { coalesceKey: 'entity:message' });
    vi.advanceTimersByTime(500);
    editor.transact('Edit message', () => {
      editor.entities[0].properties.message = 'second';
    }, { coalesceKey: 'entity:message' });

    expect(editor.history.undoCount).toBe(1);
    editor.undo();
    expect(editor.entities[0].properties.message).toBe('before');

    editor.redo();
    vi.advanceTimersByTime(1000);
    editor.transact('Edit message', () => {
      editor.entities[0].properties.message = 'third';
    }, { coalesceKey: 'entity:message' });
    expect(editor.history.undoCount).toBe(2);
  });
});
