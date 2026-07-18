import { isPk3Data, PakArchive } from './pak';

const DB_NAME = 'q3edit-assets';
const DB_VERSION = 3;
const STORE_NAME = 'pk3-files';
const SETTINGS_STORE_NAME = 'settings';
const OPENARENA_ENABLED_KEY = 'openarena-enabled';

interface StoredPak extends PakArchive {
  updatedAt: number;
  order?: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open asset storage'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Asset storage request failed'));
  });
}

function pakOrder(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export async function loadStoredPaks(): Promise<PakArchive[]> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const records = await requestResult(tx.objectStore(STORE_NAME).getAll()) as StoredPak[];
    records.sort((a, b) => {
      if (typeof a.order === 'number' && typeof b.order === 'number') return a.order - b.order;
      if (typeof a.order === 'number') return -1;
      if (typeof b.order === 'number') return 1;
      return pakOrder(a, b);
    });
    return records.map(({ name, data }) => ({ name, data }));
  } finally {
    db.close();
  }
}

export async function preparePakFiles(
  files: File[],
  onProgress?: (message: string, completed?: number, total?: number) => void,
): Promise<PakArchive[]> {
  const archives: PakArchive[] = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (!file.name.toLowerCase().endsWith('.pk3')) {
      throw new Error(`${file.name} is not a .pk3 file`);
    }
    onProgress?.(`Reading ${file.name} (${index + 1} of ${files.length})...`, index, files.length);
    const data = await file.arrayBuffer();
    if (!isPk3Data(data)) throw new Error(`${file.name} is not a valid PK3/ZIP archive`);
    archives.push({ name: file.name, data });
    onProgress?.(`Read ${file.name}`, index + 1, files.length);
  }
  return archives;
}

export async function replaceStoredAssetConfiguration(
  archives: PakArchive[],
  openArenaEnabled: boolean,
): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction([STORE_NAME, SETTINGS_STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    archives.forEach((archive, order) => {
      const record: StoredPak = { ...archive, order, updatedAt: Date.now() };
      store.put(record);
    });
    tx.objectStore(SETTINGS_STORE_NAME).put({
      key: OPENARENA_ENABLED_KEY,
      value: openArenaEnabled,
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not store asset configuration'));
      tx.onabort = () => reject(tx.error ?? new Error('Asset configuration storage was aborted'));
    });
  } finally {
    db.close();
  }
}

export async function loadOpenArenaEnabled(): Promise<boolean> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(SETTINGS_STORE_NAME, 'readonly');
    const record = await requestResult(tx.objectStore(SETTINGS_STORE_NAME).get(OPENARENA_ENABLED_KEY)) as
      { key: string; value: boolean } | undefined;
    return record?.value ?? true;
  } finally {
    db.close();
  }
}
