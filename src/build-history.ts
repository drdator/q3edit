import type { BspStatistics } from './bsp-inspection';
import type { StructuredCompilerDiagnostic } from './compile-diagnostics';
import type { CompileStageResult } from './q3map';

const DB_NAME = 'q3edit-build-history';
const DB_VERSION = 1;
const STORE_NAME = 'builds';
const DEFAULT_LIMIT = 12;

export interface BuildRecord {
  id: string;
  fileName: string;
  documentRevision: number;
  quality: string;
  region: boolean;
  settings?: {
    bspArgs: string[];
    vis: boolean;
    visArgs: string[];
    light: boolean;
    lightArgs: string[];
  };
  startedAt: number;
  durationMs: number;
  success: boolean;
  reused: boolean;
  stages: CompileStageResult[];
  statistics: BspStatistics | null;
  diagnostics: StructuredCompilerDiagnostic[];
  output: string[];
  bsp: Uint8Array | null;
  aas: Uint8Array | null;
  portalFileText: string | null;
}

export interface BuildHistoryStorage {
  list(): Promise<BuildRecord[]>;
  save(record: BuildRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Build history request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Build history transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Build history transaction was aborted'));
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
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open build history storage'));
  });
}

export class IndexedDbBuildHistoryStorage implements BuildHistoryStorage {
  async list(): Promise<BuildRecord[]> {
    const database = await openDatabase();
    try {
      const values = await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
      return values.sort((a, b) => b.startedAt - a.startedAt);
    } finally {
      database.close();
    }
  }

  async save(record: BuildRecord): Promise<void> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      await transactionComplete(transaction);
    } finally {
      database.close();
    }
  }

  async remove(id: string): Promise<void> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      await transactionComplete(transaction);
    } finally {
      database.close();
    }
  }
}

export class BuildHistoryService {
  constructor(
    private readonly storage: BuildHistoryStorage = new IndexedDbBuildHistoryStorage(),
    private readonly limit = DEFAULT_LIMIT,
  ) {}

  async list(fileName?: string): Promise<BuildRecord[]> {
    const records = await this.storage.list();
    return fileName ? records.filter(record => record.fileName === fileName) : records;
  }

  async add(record: BuildRecord): Promise<void> {
    await this.storage.save(record);
    const records = await this.storage.list();
    for (const old of records.slice(this.limit)) await this.storage.remove(old.id);
  }

  async previous(fileName: string, excludingId?: string): Promise<BuildRecord | null> {
    return (await this.list(fileName)).find(record => record.id !== excludingId) ?? null;
  }

  async clear(): Promise<void> {
    for (const record of await this.storage.list()) await this.storage.remove(record.id);
  }

  async remove(id: string): Promise<void> {
    await this.storage.remove(id);
  }
}
