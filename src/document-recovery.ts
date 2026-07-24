import type { Editor } from './editor';
import { isActivityEntry, type ActivityEntry } from './activity-history';
import type { OriginalMapSource } from './editor-document';
import { parseMapWithDiagnostics } from './mapfile';

const DB_NAME = 'q3edit-recovery';
const DB_VERSION = 2;
const STORE_NAME = 'documents';
const HISTORY_STORE_NAME = 'history';
const SNAPSHOT_VERSION = 1;
const DEFAULT_HISTORY_LIMIT = 20;
const HISTORY_LIMIT_KEY = 'q3edit.recovery.historyLimit';
export const DOCUMENT_RECOVERY_DEBOUNCE_MS = 500;

function loadHistoryLimit(): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(HISTORY_LIMIT_KEY));
    return Number.isFinite(stored) ? Math.max(5, Math.min(100, Math.round(stored))) : DEFAULT_HISTORY_LIMIT;
  } catch {
    return DEFAULT_HISTORY_LIMIT;
  }
}

export interface DocumentRecoveryStats {
  entities: number;
  brushes: number;
  patches: number;
  bytes: number;
}

export interface DocumentRecoverySnapshot {
  version: 1;
  snapshotId: string;
  editorSessionId: string;
  fileName: string;
  mapText: string;
  documentRevision: number;
  savedDocumentRevision: number;
  documentSessionStartedAt: number;
  updatedAt: number;
  label: string;
  protected: boolean;
  stats: DocumentRecoveryStats;
  originalMapSource?: OriginalMapSource | null;
  activityEntries?: ActivityEntry[];
}

export interface DocumentRecoveryStorage {
  load(editorSessionId: string): Promise<DocumentRecoverySnapshot | null>;
  save(snapshot: DocumentRecoverySnapshot): Promise<void>;
  remove(editorSessionId: string): Promise<void>;
  list?(editorSessionId: string): Promise<DocumentRecoverySnapshot[]>;
  removeSnapshot?(snapshotId: string): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Document recovery request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Document recovery transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Document recovery transaction was aborted'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'editorSessionId' });
      }
      if (!database.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        const history = database.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'snapshotId' });
        history.createIndex('editorSessionId', 'editorSessionId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open document recovery storage'));
  });
}

function normalizeRecoverySnapshot(value: unknown): DocumentRecoverySnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<DocumentRecoverySnapshot>;
  const valid = snapshot.version === SNAPSHOT_VERSION
    && typeof snapshot.editorSessionId === 'string'
    && typeof snapshot.fileName === 'string'
    && typeof snapshot.mapText === 'string'
    && Number.isInteger(snapshot.documentRevision)
    && Number.isInteger(snapshot.savedDocumentRevision)
    && typeof snapshot.documentSessionStartedAt === 'number'
    && Number.isFinite(snapshot.documentSessionStartedAt)
    && typeof snapshot.updatedAt === 'number'
    && Number.isFinite(snapshot.updatedAt)
    && (snapshot.activityEntries === undefined
      || (Array.isArray(snapshot.activityEntries) && snapshot.activityEntries.every(isActivityEntry)));
  if (!valid) return null;
  return {
    ...snapshot,
    version: SNAPSHOT_VERSION,
    snapshotId: typeof snapshot.snapshotId === 'string'
      ? snapshot.snapshotId
      : `${snapshot.editorSessionId}:legacy:${snapshot.updatedAt}`,
    editorSessionId: snapshot.editorSessionId!,
    fileName: snapshot.fileName!,
    mapText: snapshot.mapText!,
    documentRevision: snapshot.documentRevision!,
    savedDocumentRevision: snapshot.savedDocumentRevision!,
    documentSessionStartedAt: snapshot.documentSessionStartedAt!,
    updatedAt: snapshot.updatedAt!,
    label: typeof snapshot.label === 'string' ? snapshot.label : `Recovered revision ${snapshot.documentRevision}`,
    protected: snapshot.protected === true,
    stats: snapshot.stats
      && Number.isInteger(snapshot.stats.entities)
      && Number.isInteger(snapshot.stats.brushes)
      && Number.isInteger(snapshot.stats.patches)
      && Number.isInteger(snapshot.stats.bytes)
      ? snapshot.stats
      : { entities: 0, brushes: 0, patches: 0, bytes: new Blob([snapshot.mapText!]).size },
    originalMapSource: snapshot.originalMapSource ?? null,
    activityEntries: snapshot.activityEntries,
  };
}

export class IndexedDbDocumentRecoveryStorage implements DocumentRecoveryStorage {
  async load(editorSessionId: string): Promise<DocumentRecoverySnapshot | null> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const value = await requestResult(transaction.objectStore(STORE_NAME).get(editorSessionId));
      return normalizeRecoverySnapshot(value);
    } finally {
      database.close();
    }
  }

  async save(snapshot: DocumentRecoverySnapshot): Promise<void> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction([STORE_NAME, HISTORY_STORE_NAME], 'readwrite');
      transaction.objectStore(STORE_NAME).put(snapshot);
      transaction.objectStore(HISTORY_STORE_NAME).put(snapshot);
      await transactionComplete(transaction);
    } finally {
      database.close();
    }
  }

  async remove(editorSessionId: string): Promise<void> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(editorSessionId);
      await transactionComplete(transaction);
    } finally {
      database.close();
    }
  }

  async list(editorSessionId: string): Promise<DocumentRecoverySnapshot[]> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(HISTORY_STORE_NAME, 'readonly');
      const request = transaction.objectStore(HISTORY_STORE_NAME).index('editorSessionId').getAll(editorSessionId);
      const values = await requestResult(request);
      return values
        .map(normalizeRecoverySnapshot)
        .filter((snapshot): snapshot is DocumentRecoverySnapshot => snapshot !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } finally {
      database.close();
    }
  }

  async removeSnapshot(snapshotId: string): Promise<void> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(HISTORY_STORE_NAME, 'readwrite');
      transaction.objectStore(HISTORY_STORE_NAME).delete(snapshotId);
      await transactionComplete(transaction);
    } finally {
      database.close();
    }
  }
}

export function createDocumentRecoverySnapshot(
  editor: Editor,
  editorSessionId: string,
  updatedAt = Date.now(),
  options: { label?: string; protected?: boolean; uniqueId?: string } = {},
): DocumentRecoverySnapshot {
  const mapText = editor.serializeMap();
  const activityEntries = editor.activityHistory.list();
  const latestActivity = activityEntries[activityEntries.length - 1];
  const brushes = editor.entities.reduce((sum, entity) => sum + entity.brushes.length, 0);
  const patches = editor.entities.reduce((sum, entity) => sum + entity.patches.length, 0);
  return {
    version: SNAPSHOT_VERSION,
    snapshotId: options.uniqueId ?? `${editorSessionId}:revision:${editor.documentRevision}`,
    editorSessionId,
    fileName: editor.fileName,
    mapText,
    documentRevision: editor.documentRevision,
    savedDocumentRevision: editor.savedDocumentRevision,
    documentSessionStartedAt: editor.documentSessionStartedAt,
    updatedAt,
    label: options.label ?? latestActivity?.title ?? `Revision ${editor.documentRevision}`,
    protected: options.protected ?? false,
    stats: {
      entities: editor.entities.length,
      brushes,
      patches,
      bytes: new Blob([mapText]).size,
    },
    originalMapSource: editor.originalMapSource ? structuredClone(editor.originalMapSource) : null,
    activityEntries: editor.activityHistory.snapshot(),
  };
}

export function restoreDocumentRecoverySnapshot(editor: Editor, snapshot: DocumentRecoverySnapshot): void {
  editor.restoreRecoveredMap(
    snapshot.mapText,
    snapshot.fileName,
    snapshot.documentRevision,
    snapshot.savedDocumentRevision,
    snapshot.documentSessionStartedAt,
    snapshot.originalMapSource ?? null,
  );
  editor.activityHistory.restore(snapshot.activityEntries ?? []);
}

export class DocumentRecoveryService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private unsubscribeDocumentChanges: (() => void) | null = null;
  private unsubscribeDocumentState: (() => void) | null = null;
  private unsubscribeActivity: (() => void) | null = null;
  private readonly onPageHide = () => { void this.flush(); };
  private readonly onVisibilityChange = () => {
    if (globalThis.document?.visibilityState === 'hidden') void this.flush();
  };

  constructor(
    private readonly editor: Editor,
    private readonly editorSessionId: string,
    private readonly storage: DocumentRecoveryStorage = new IndexedDbDocumentRecoveryStorage(),
    private readonly debounceMs = DOCUMENT_RECOVERY_DEBOUNCE_MS,
    private historyLimit = loadHistoryLimit(),
  ) {}

  get retentionLimit(): number {
    return this.historyLimit;
  }

  setRetentionLimit(limit: number): void {
    this.historyLimit = Math.max(5, Math.min(100, Math.round(limit)));
    try {
      globalThis.localStorage?.setItem(HISTORY_LIMIT_KEY, String(this.historyLimit));
    } catch {
      // The setting still applies for this session when storage is unavailable.
    }
    void this.prune();
  }

  async listVersions(): Promise<DocumentRecoverySnapshot[]> {
    if (this.storage.list) return this.storage.list(this.editorSessionId);
    const latest = await this.storage.load(this.editorSessionId);
    return latest ? [latest] : [];
  }

  async createCheckpoint(label: string): Promise<DocumentRecoverySnapshot> {
    const now = Date.now();
    const snapshot = createDocumentRecoverySnapshot(this.editor, this.editorSessionId, now, {
      label: label.trim() || `Checkpoint ${new Date(now).toLocaleString()}`,
      protected: true,
      uniqueId: `${this.editorSessionId}:checkpoint:${now}`,
    });
    await this.storage.save(snapshot);
    await this.prune();
    return snapshot;
  }

  async setProtected(snapshotId: string, protectedSnapshot: boolean): Promise<void> {
    const snapshot = (await this.listVersions()).find(candidate => candidate.snapshotId === snapshotId);
    if (!snapshot) return;
    snapshot.protected = protectedSnapshot;
    await this.storage.save(snapshot);
    await this.prune();
  }

  async removeVersion(snapshotId: string): Promise<void> {
    await this.storage.removeSnapshot?.(snapshotId);
    const remaining = await this.listVersions();
    if (remaining.length > 0) await this.storage.save(remaining[0]);
    else await this.storage.remove(this.editorSessionId);
  }

  restoreVersion(snapshot: DocumentRecoverySnapshot): void {
    const currentFileName = this.editor.fileName;
    const parsed = parseMapWithDiagnostics(snapshot.mapText);
    this.editor.transact(`Restore ${snapshot.label}`, () => {
      this.editor.entities = parsed.document.entities;
    });
    this.editor.fileName = snapshot.fileName || currentFileName;
    this.editor.originalMapSource = snapshot.originalMapSource ? structuredClone(snapshot.originalMapSource) : null;
    this.editor.mapDiagnostics = parsed.diagnostics;
    this.editor.unsupportedMapConstructs = snapshot.originalMapSource?.unsupportedConstructs
      ? structuredClone(snapshot.originalMapSource.unsupportedConstructs)
      : [];
    this.editor.clearSelection();
    this.editor.redrawRequested = true;
    this.editor.statusMessage = `Restored ${snapshot.label} as an undoable change`;
  }

  async storageUsage(): Promise<{ snapshots: number; bytes: number; protectedSnapshots: number }> {
    const snapshots = await this.listVersions();
    return {
      snapshots: snapshots.length,
      bytes: snapshots.reduce((sum, snapshot) => sum + snapshot.stats.bytes, 0),
      protectedSnapshots: snapshots.filter(snapshot => snapshot.protected).length,
    };
  }

  async restore(): Promise<DocumentRecoverySnapshot | null> {
    let snapshot: DocumentRecoverySnapshot | null;
    try {
      snapshot = await this.storage.load(this.editorSessionId);
    } catch (error) {
      console.warn('Could not load document recovery snapshot', error);
      return null;
    }
    if (!snapshot) return null;
    try {
      restoreDocumentRecoverySnapshot(this.editor, snapshot);
      return snapshot;
    } catch (error) {
      console.warn('Discarded an invalid document recovery snapshot', error);
      try {
        await this.storage.remove(this.editorSessionId);
      } catch (removeError) {
        console.warn('Could not remove invalid document recovery snapshot', removeError);
      }
      return null;
    }
  }

  start(): void {
    if (this.unsubscribeDocumentChanges) return;
    this.unsubscribeDocumentChanges = this.editor.subscribeDocumentChanges(() => this.schedule());
    this.unsubscribeDocumentState = this.editor.subscribeDocumentStateChanges(() => this.schedule());
    this.unsubscribeActivity = this.editor.activityHistory.subscribe(() => this.schedule());
    globalThis.window?.addEventListener('pagehide', this.onPageHide);
    globalThis.document?.addEventListener('visibilitychange', this.onVisibilityChange);
    this.schedule();
  }

  schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const snapshot = createDocumentRecoverySnapshot(this.editor, this.editorSessionId);
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.storage.save(snapshot))
      .then(() => this.prune())
      .catch(error => {
        console.warn('Could not autosave document recovery snapshot', error);
      });
    return this.writeChain;
  }

  private async prune(): Promise<void> {
    if (!this.storage.list || !this.storage.removeSnapshot) return;
    const snapshots = await this.storage.list(this.editorSessionId);
    const removable = snapshots.filter(snapshot => !snapshot.protected);
    for (const snapshot of removable.slice(this.historyLimit)) {
      await this.storage.removeSnapshot(snapshot.snapshotId);
    }
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribeDocumentChanges?.();
    this.unsubscribeDocumentState?.();
    this.unsubscribeActivity?.();
    this.unsubscribeDocumentChanges = null;
    this.unsubscribeDocumentState = null;
    this.unsubscribeActivity = null;
    globalThis.window?.removeEventListener('pagehide', this.onPageHide);
    globalThis.document?.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}
