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
  snapshots: DocumentRecoverySnapshot[] = [];

  async load(editorSessionId: string): Promise<DocumentRecoverySnapshot | null> {
    return this.snapshot?.editorSessionId === editorSessionId ? structuredClone(this.snapshot) : null;
  }

  async save(snapshot: DocumentRecoverySnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
    await this.updateHistory(snapshot);
  }

  async updateHistory(snapshot: DocumentRecoverySnapshot): Promise<void> {
    const index = this.snapshots.findIndex(candidate => candidate.snapshotId === snapshot.snapshotId);
    if (index >= 0) this.snapshots[index] = structuredClone(snapshot);
    else this.snapshots.push(structuredClone(snapshot));
  }

  async remove(editorSessionId: string): Promise<void> {
    if (this.snapshot?.editorSessionId === editorSessionId) this.snapshot = null;
  }

  async list(editorSessionId: string): Promise<DocumentRecoverySnapshot[]> {
    return this.snapshots
      .filter(snapshot => snapshot.editorSessionId === editorSessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(snapshot => structuredClone(snapshot));
  }

  async removeSnapshot(snapshotId: string): Promise<void> {
    this.snapshots = this.snapshots.filter(snapshot => snapshot.snapshotId !== snapshotId);
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

  it('keeps bounded automatic history while retaining protected checkpoints', async () => {
    const editor = new Editor();
    const storage = new MemoryRecoveryStorage();
    const recovery = new DocumentRecoveryService(editor, 'editor-session', storage, 50, 5);

    for (let revision = 0; revision < 7; revision++) {
      editor.transact(`Edit ${revision}`, () => {
        editor.worldspawn.properties.message = String(revision);
      });
      await recovery.flush();
    }
    const checkpoint = await recovery.createCheckpoint('Before risky edit');
    editor.transact('Final edit', () => {
      editor.worldspawn.properties.message = 'final';
    });
    await recovery.flush();

    const versions = await recovery.listVersions();
    expect(versions.filter(snapshot => !snapshot.protected)).toHaveLength(5);
    expect(versions).toContainEqual(expect.objectContaining({
      snapshotId: checkpoint.snapshotId,
      label: 'Before risky edit',
      protected: true,
    }));
    expect((await recovery.storageUsage()).snapshots).toBe(6);
  });

  it('does not replace the latest recovery state when protecting an older version', async () => {
    const editor = new Editor();
    const storage = new MemoryRecoveryStorage();
    const recovery = new DocumentRecoveryService(editor, 'editor-session', storage);
    editor.transact('First', () => { editor.worldspawn.properties.message = 'first'; });
    await recovery.flush();
    const first = (await recovery.listVersions())[0];
    editor.transact('Second', () => { editor.worldspawn.properties.message = 'second'; });
    await recovery.flush();
    const latestId = storage.snapshot?.snapshotId;

    await recovery.setProtected(first.snapshotId, true);

    expect(storage.snapshot?.snapshotId).toBe(latestId);
    expect((await recovery.listVersions()).find(item => item.snapshotId === first.snapshotId)?.protected).toBe(true);
  });

  it('restores an earlier version as an undoable change', async () => {
    const editor = new Editor();
    editor.worldspawn.properties.message = 'before';
    const storage = new MemoryRecoveryStorage();
    const recovery = new DocumentRecoveryService(editor, 'editor-session', storage);
    const checkpoint = await recovery.createCheckpoint('Before');
    editor.transact('Change', () => {
      editor.worldspawn.properties.message = 'after';
    });

    recovery.restoreVersion(checkpoint);
    expect(editor.worldspawn.properties.message).toBe('before');
    expect(editor.history.canUndo).toBe(true);
    editor.undo();
    expect(editor.worldspawn.properties.message).toBe('after');
  });

  it('restores filename and source metadata through undo and redo', async () => {
    const editor = new Editor();
    editor.fileName = 'before.map';
    const storage = new MemoryRecoveryStorage();
    const recovery = new DocumentRecoveryService(editor, 'editor-session', storage);
    const checkpoint = await recovery.createCheckpoint('Before');
    editor.fileName = 'after.map';
    editor.originalMapSource = null;
    editor.transact('Change', () => { editor.worldspawn.properties.message = 'after'; });

    recovery.restoreVersion({ ...checkpoint, fileName: 'checkpoint.map' });
    expect(editor.fileName).toBe('checkpoint.map');
    editor.undo();
    expect(editor.fileName).toBe('after.map');
    editor.redo();
    expect(editor.fileName).toBe('checkpoint.map');
  });
});
