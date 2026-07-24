import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentRecoverySnapshot,
  DocumentRecoveryService,
  restoreDocumentRecoverySnapshot,
  type DocumentRecoverySnapshot,
  type DocumentRecoveryStorage,
} from '../src/document-recovery';
import { Editor } from '../src/editor';

class MemoryRecoveryStorage implements DocumentRecoveryStorage {
  snapshot: DocumentRecoverySnapshot | null = null;

  async load(editorSessionId: string): Promise<DocumentRecoverySnapshot | null> {
    return this.snapshot?.editorSessionId === editorSessionId ? structuredClone(this.snapshot) : null;
  }

  async save(snapshot: DocumentRecoverySnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
  }

  async remove(editorSessionId: string): Promise<void> {
    if (this.snapshot?.editorSessionId === editorSessionId) this.snapshot = null;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('document recovery', () => {
  it('restores map content, filename, revisions, dirty state, and historical activity', () => {
    const source = new Editor();
    source.createDefaultMap();
    source.fileName = 'recovery-test.map';
    source.markDocumentSaved();
    source.beginDocumentSession(123_456);
    source.transact('Change message', () => {
      source.worldspawn.properties.message = 'Recovered';
    });

    const snapshot = createDocumentRecoverySnapshot(source, 'editor-session', 999_000);
    const restored = new Editor();
    restoreDocumentRecoverySnapshot(restored, snapshot);

    expect(restored.serializeMap()).toBe(source.serializeMap());
    expect(restored.fileName).toBe('recovery-test.map');
    expect(restored.documentRevision).toBe(source.documentRevision);
    expect(restored.savedDocumentRevision).toBe(source.savedDocumentRevision);
    expect(restored.documentSessionStartedAt).toBe(123_456);
    expect(restored.hasUnsavedChanges).toBe(true);
    expect(restored.statusMessage).toBe('Recovered unsaved changes to recovery-test.map');
    expect(restored.activityHistory.list()).toEqual([
      expect.objectContaining({
        title: 'Change message',
        historical: true,
        undoable: false,
      }),
    ]);
  });

  it('debounces edits and updates the snapshot after an explicit save', async () => {
    vi.useFakeTimers();
    const editor = new Editor();
    editor.fileName = 'autosave.map';
    const storage = new MemoryRecoveryStorage();
    const recovery = new DocumentRecoveryService(editor, 'editor-session', storage, 50);
    recovery.start();

    editor.transact('Edit map', () => {
      editor.worldspawn.properties.message = 'Autosaved';
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(storage.snapshot?.mapText).toContain('"message" "Autosaved"');
    expect(storage.snapshot?.documentRevision).not.toBe(storage.snapshot?.savedDocumentRevision);
    expect(storage.snapshot?.activityEntries).toEqual([
      expect.objectContaining({ title: 'Edit map', historical: false, undoable: true }),
    ]);

    editor.markDocumentSaved();
    await vi.advanceTimersByTimeAsync(50);
    expect(storage.snapshot?.documentRevision).toBe(storage.snapshot?.savedDocumentRevision);
    recovery.dispose();
  });
});
