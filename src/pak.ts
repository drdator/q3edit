import { unzipSync } from 'fflate';

export type PakFiles = Map<string, Uint8Array>;
export type PakProgressCallback = (message: string, completed?: number, total?: number) => void;

export interface PakArchive {
  name: string;
  data: ArrayBuffer;
}

export interface PakManifest {
  archives: string[];
  label?: string;
  license?: string;
  source?: string;
}

const ASSET_PATH = /^(?:textures|models)\/.*\.(?:tga|jpg|jpeg)$/i;
const SHADER_PATH = /^scripts\/.*(?:\.shader|shaderlist\.txt)$/i;

export function isPk3Data(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  // Local file header, empty archive, or spanning archive signatures.
  return (bytes[2] === 0x03 && bytes[3] === 0x04)
    || (bytes[2] === 0x05 && bytes[3] === 0x06)
    || (bytes[2] === 0x07 && bytes[3] === 0x08);
}

function isEditorAsset(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return ASSET_PATH.test(normalized) || SHADER_PATH.test(normalized);
}

export function extractPak(data: ArrayBuffer | Uint8Array, name: string): PakFiles {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isPk3Data(bytes)) throw new Error(`${name} is not a valid PK3/ZIP archive`);

  const files = unzipSync(bytes, { filter: file => isEditorAsset(file.name) });
  const pak: PakFiles = new Map();
  for (const [path, content] of Object.entries(files)) {
    pak.set(path.replace(/\\/g, '/').toLowerCase(), content);
  }
  return pak;
}

export function mergePak(target: PakFiles, source: PakFiles): void {
  for (const [path, content] of source) target.set(path, content);
}

export async function loadPak(url: string, onProgress?: PakProgressCallback): Promise<PakFiles> {
  onProgress?.(`Fetching ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  const sizeMB = (arrayBuffer.byteLength / 1024 / 1024).toFixed(1);
  onProgress?.(`Extracting ${url} (${sizeMB} MB)...`);
  const pak = extractPak(arrayBuffer, url);
  onProgress?.(`Loaded ${pak.size} editor assets from ${url}`);
  return pak;
}

export async function loadPakManifest(
  manifestUrl: string,
  onProgress?: PakProgressCallback,
  fallbackManifest?: PakManifest,
): Promise<{ files: PakFiles; manifest: PakManifest }> {
  let manifest: PakManifest;
  try {
    const response = await fetch(manifestUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    if (text.trimStart().startsWith('<')) {
      throw new Error('server returned HTML instead of JSON');
    }
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
  const merged: PakFiles = new Map();
  for (const archive of manifest.archives) {
    const pak = await loadPak(new URL(archive, baseUrl).toString(), onProgress);
    mergePak(merged, pak);
  }
  return { files: merged, manifest };
}

export async function loadPakArchives(
  archives: PakArchive[],
  onProgress?: PakProgressCallback,
): Promise<PakFiles> {
  const merged: PakFiles = new Map();
  for (let index = 0; index < archives.length; index++) {
    const archive = archives[index];
    const sizeMB = (archive.data.byteLength / 1024 / 1024).toFixed(1);
    onProgress?.(
      `Extracting ${archive.name} (${index + 1} of ${archives.length}, ${sizeMB} MB)...`,
      index,
      archives.length,
    );
    // Let status/progress UI paint before synchronous ZIP extraction begins.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    mergePak(merged, extractPak(archive.data, archive.name));
    onProgress?.(`Loaded ${archive.name}`, index + 1, archives.length);
  }
  return merged;
}
