import { afterEach, describe, expect, test, vi } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { setEntityProperty } from '../src/editor-properties';

afterEach(() => {
  vi.useRealTimers();
});

describe('document revisions', () => {
  test('redraw-only selection state does not modify the document', () => {
    const editor = new Editor();
    const initialRevision = editor.documentRevision;
    editor.redrawRequested = false;

    editor.selectEntity(editor.worldspawn);

    expect(editor.redrawRequested).toBe(true);
    expect(editor.documentRevision).toBe(initialRevision);
    expect(editor.hasUnsavedChanges).toBe(false);

    editor.redrawRequested = false;
    editor.toggleTextureLock();
    expect(editor.redrawRequested).toBe(true);
    expect(editor.documentRevision).toBe(initialRevision);
    expect(editor.hasUnsavedChanges).toBe(false);
  });

  test('advances only for committed document changes', () => {
    const editor = new Editor();
    const initialRevision = editor.documentRevision;

    editor.transact('No-op', () => undefined);
    expect(editor.documentRevision).toBe(initialRevision);

    editor.transact('Edit message', () => {
      editor.worldspawn.properties.message = 'changed';
    });

    expect(editor.documentRevision).toBeGreaterThan(initialRevision);
    expect(editor.hasUnsavedChanges).toBe(true);
  });

  test('cancelled transactions preserve the current revision', () => {
    const editor = new Editor();
    const initialRevision = editor.documentRevision;

    editor.beginTransaction('Cancelled edit');
    editor.worldspawn.properties.message = 'temporary';
    editor.cancelTransaction();

    expect(editor.documentRevision).toBe(initialRevision);
    expect(editor.hasUnsavedChanges).toBe(false);
  });

  test('save identity follows undo and redo exactly', () => {
    const editor = new Editor();
    editor.markDocumentSaved();
    const worldspawn = editor.worldspawn;

    editor.addBrush([0, 0, 0], [64, 64, 64], 2);
    editor.markDocumentSaved();
    const savedRevision = editor.documentRevision;
    const brush = editor.worldspawn.brushes[0];
    editor.selection = [{ type: 'brush', entity: editor.worldspawn, brush }];

    editor.moveSelection([16, 0, 0]);
    expect(editor.hasUnsavedChanges).toBe(true);

    editor.undo();
    expect(editor.documentRevision).toBe(savedRevision);
    expect(editor.hasUnsavedChanges).toBe(false);
    expect(editor.worldspawn.brushes[0].mins[0]).toBeCloseTo(0);

    editor.redo();
    expect(editor.hasUnsavedChanges).toBe(true);
    expect(editor.worldspawn.brushes[0].mins[0]).toBeCloseTo(16);
    expect(worldspawn).not.toBe(editor.worldspawn);
  });

  test('saving breaks coalescing so undo can restore the saved value', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T10:00:00Z'));
    const editor = new Editor();
    const entity = createEntity('light');
    entity.properties.light = '300';
    editor.entities.push(entity);

    setEntityProperty(editor, entity, 'light', '350');
    editor.markDocumentSaved();
    vi.advanceTimersByTime(100);
    setEntityProperty(editor, entity, 'light', '400');

    expect(editor.history.undoCount).toBe(2);
    expect(editor.hasUnsavedChanges).toBe(true);
    editor.undo();
    expect(editor.entities[1].properties.light).toBe('350');
    expect(editor.hasUnsavedChanges).toBe(false);
  });

  test('Open establishes a saved revision while New remains unsaved', () => {
    const editor = new Editor();
    editor.transact('Local edit', () => {
      editor.worldspawn.properties.message = 'local';
    });
    expect(editor.hasUnsavedChanges).toBe(true);

    editor.loadMap(`
{
"classname" "worldspawn"
"message" "opened"
}
`);
    expect(editor.worldspawn.properties.message).toBe('opened');
    expect(editor.hasUnsavedChanges).toBe(false);

    editor.undo();
    expect(editor.worldspawn.properties.message).toBe('local');
    expect(editor.hasUnsavedChanges).toBe(true);
    editor.redo();
    expect(editor.worldspawn.properties.message).toBe('opened');
    expect(editor.hasUnsavedChanges).toBe(false);

    editor.fileName = 'opened.map';
    editor.newMap();
    expect(editor.fileName).toBe('untitled.map');
    expect(editor.hasUnsavedChanges).toBe(true);
  });
});
