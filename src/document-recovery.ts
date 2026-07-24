import type { Editor } from './editor';
import { isActivityEntry, type ActivityEntry } from './activity-history';

const DB_NAME = 'q3edit-recovery';
const DB_VERSION = 1;
const STORE_NAME = 'documents';
const SNAPSHOT_VERSION = 1;
export const DOCUMENT_RECOVERY_DEBOUNCE_MS = 500;

export interface DocumentRecoverySnapshot {
  version: 1;
  editorSessionId: string;
  fileName: string;
  mapText: string;
  documentRevision: number;
  savedDocumentRevision: number;
  documentSessionStartedAt: number;
  updatedAt: number;
  activityEntries?: ActivityEntry[];
}

export interface DocumentRecoveryStorage {
  load(editorSessionId: string): Promise<DocumentRecoverySnapshot | null>;
  save(snapshot: DocumentRecoverySnapshot): Promise<void>;
  remove(editorSessionId: string): Promise<void>;
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open document recovery storage'));
  });
}

function isRecoverySnapshot(value: unknown): value is DocumentRecoverySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<DocumentRecoverySnapshot>;
  return snapshot.version === SNAPSHOT_VERSION
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
}

export class IndexedDbDocumentRecoveryStorage implements DocumentRecoveryStorage {
  async load(editorSessionId: string): Promise<DocumentRecoverySnapshot | null> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const value = await requestResult(transaction.objectStore(STORE_NAME).get(editorSessionId));
      return isRecoverySnapshot(value) ? value : null;
    } finally {
      database.close();
    }
  }

  async save(snapshot: DocumentRecoverySnapshot): Promise<void> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(snapshot);
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
}

export function createDocumentRecoverySnapshot(
  editor: Editor,
  editorSessionId: string,
  updatedAt = Date.now(),
): DocumentRecoverySnapshot {
  return {
    version: SNAPSHOT_VERSION,
    editorSessionId,
    fileName: editor.fileName,
    mapText: editor.serializeMap(),
    documentRevision: editor.documentRevision,
    savedDocumentRevision: editor.savedDocumentRevision,
    documentSessionStartedAt: editor.documentSessionStartedAt,
    updatedAt,
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
  ) {}

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
      .catch(error => {
        console.warn('Could not autosave document recovery snapshot', error);
      });
    return this.writeChain;
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
