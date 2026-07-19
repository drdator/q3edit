import { AssetArchive, AssetIndex } from './asset-index';

export type { AssetArchive as PakArchive } from './asset-index';
export type PakProgressCallback = (message: string, completed?: number, total?: number) => void;

export interface PakManifest {
  archives: string[];
  label?: string;
  license?: string;
  source?: string;
}

export function isPk3Data(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  return (bytes[2] === 0x03 && bytes[3] === 0x04)
    || (bytes[2] === 0x05 && bytes[3] === 0x06)
    || (bytes[2] === 0x07 && bytes[3] === 0x08);
}

export async function loadPak(url: string, onProgress?: PakProgressCallback): Promise<AssetArchive> {
  onProgress?.(`Fetching ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

  const data = await response.arrayBuffer();
  if (!isPk3Data(data)) throw new Error(`${url} is not a valid PK3/ZIP archive`);
  const sizeMB = (data.byteLength / 1024 / 1024).toFixed(1);
  onProgress?.(`Indexed ${url} (${sizeMB} MB)`);
  return { name: decodeURIComponent(new URL(url, window.location.href).pathname.split('/').pop() ?? url), data };
}

export async function loadPakManifest(
  manifestUrl: string,
  onProgress?: PakProgressCallback,
  fallbackManifest?: PakManifest,
): Promise<{ archives: AssetArchive[]; manifest: PakManifest }> {
  let manifest: PakManifest;
  try {
    const response = await fetch(manifestUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    if (text.trimStart().startsWith('<')) throw new Error('server returned HTML instead of JSON');
    try {
      manifest = JSON.parse(text) as PakManifest;
    } catch {
      throw new Error('server returned malformed JSON');
    }
  } catch (error) {
    if (!fallbackManifest) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load ${manifestUrl}: ${detail}`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Could not load ${manifestUrl}; using the built-in asset list: ${detail}`);
    onProgress?.('Asset manifest unavailable; using built-in OpenArena list...');
    manifest = fallbackManifest;
  }

  if (!Array.isArray(manifest.archives) || manifest.archives.length === 0) {
    throw new Error(`${manifestUrl} does not list any PK3 archives`);
  }

  const baseUrl = new URL('.', new URL(manifestUrl, window.location.href));
  const archives: AssetArchive[] = [];
  for (let index = 0; index < manifest.archives.length; index++) {
    const archivePath = manifest.archives[index];
    onProgress?.(`Loading ${archivePath} (${index + 1} of ${manifest.archives.length})...`, index, manifest.archives.length);
    archives.push(await loadPak(new URL(archivePath, baseUrl).toString(), onProgress));
    onProgress?.(`Loaded ${archivePath}`, index + 1, manifest.archives.length);
  }
  return { archives, manifest };
}

export async function indexPakArchives(
  archives: AssetArchive[],
  onProgress?: PakProgressCallback,
): Promise<AssetIndex> {
  for (let index = 0; index < archives.length; index++) {
    const archive = archives[index];
    const sizeMB = (archive.data.byteLength / 1024 / 1024).toFixed(1);
    onProgress?.(
      `Indexing ${archive.name} (${index + 1} of ${archives.length}, ${sizeMB} MB)...`,
      index,
      archives.length,
    );
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const assetIndex = new AssetIndex(archives);
  onProgress?.(`Indexed ${assetIndex.size} assets`, archives.length, archives.length);
  return assetIndex;
}
