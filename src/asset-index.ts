import { unzipSync } from 'fflate';

export type AssetKind =
  | 'image'
  | 'shader'
  | 'model'
  | 'skin'
  | 'entity-definition'
  | 'map'
  | 'text'
  | 'binary';

export interface AssetArchive {
  name: string;
  data: ArrayBuffer;
  enabled?: boolean;
}

export interface AssetSource {
  archiveName: string;
  archiveIndex: number;
  path: string;
  normalizedPath: string;
  compressedSize: number;
  size: number;
}

export interface IndexedAsset {
  path: string;
  normalizedPath: string;
  kind: AssetKind;
  source: AssetSource;
  overriddenSources: readonly AssetSource[];
}

export interface AssetIndexOptions {
  /** Refuse unexpectedly large compressed archives before indexing them. */
  maxArchiveBytes?: number;
  /** Refuse to decode a single entry beyond this size. */
  maxEntryBytes?: number;
  /** Maximum total decoded bytes retained by the LRU cache. */
  maxDecodedCacheBytes?: number;
}

const DEFAULT_MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const DEFAULT_CACHE_BYTES = 128 * 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

function viewOf(data: ArrayBuffer): DataView {
  return new DataView(data);
}

function decodeZipName(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

export function normalizeAssetPath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
  if (!normalized || normalized.endsWith('/') || normalized.split('/').includes('..')) return '';
  return normalized;
}

export function classifyAsset(path: string): AssetKind {
  const normalized = normalizeAssetPath(path);
  if (/\.(?:tga|jpe?g|png|webp)$/.test(normalized)) return 'image';
  if (/\.shader$/.test(normalized)) return 'shader';
  if (/\.(?:md3|mdc)$/.test(normalized)) return 'model';
  if (/\.skin$/.test(normalized)) return 'skin';
  if (/\.(?:def|ent|fgd)$/.test(normalized)) return 'entity-definition';
  if (/\.map$/.test(normalized)) return 'map';
  if (/\.(?:txt|cfg|arena|menu|bot|aas|script|shaderlist)$/.test(normalized)) return 'text';
  return 'binary';
}

function findEndOfCentralDirectory(data: ArrayBuffer): number {
  const view = viewOf(data);
  const lowerBound = Math.max(0, data.byteLength - 22 - 0xffff);
  for (let offset = data.byteLength - 22; offset >= lowerBound; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('ZIP central directory was not found');
}

export function listArchiveEntries(archive: AssetArchive, archiveIndex: number): AssetSource[] {
  const view = viewOf(archive.data);
  const eocd = findEndOfCentralDirectory(archive.data);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: AssetSource[] = [];

  for (let index = 0; index < count; index++) {
    if (offset + 46 > archive.data.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error(`${archive.name} has a malformed ZIP central directory`);
    }
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > archive.data.byteLength) {
      throw new Error(`${archive.name} has a truncated ZIP entry name`);
    }
    const path = decodeZipName(new Uint8Array(archive.data, nameStart, nameLength));
    const normalizedPath = normalizeAssetPath(path);
    if (normalizedPath) {
      entries.push({
        archiveName: archive.name,
        archiveIndex,
        path: path.replace(/\\/g, '/'),
        normalizedPath,
        compressedSize,
        size,
      });
    }
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

interface CacheEntry {
  data: Uint8Array;
  size: number;
}

/** Ordered, case-insensitive PK3 virtual filesystem. Later enabled archives win. */
export class AssetIndex {
  private archives: AssetArchive[] = [];
  private winners = new Map<string, IndexedAsset>();
  private allSources = new Map<string, AssetSource[]>();
  private decoded = new Map<string, CacheEntry>();
  private decodedBytes = 0;
  readonly maxArchiveBytes: number;
  readonly maxEntryBytes: number;
  readonly maxDecodedCacheBytes: number;

  constructor(archives: readonly AssetArchive[] = [], options: AssetIndexOptions = {}) {
    this.maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
    this.maxDecodedCacheBytes = options.maxDecodedCacheBytes ?? DEFAULT_CACHE_BYTES;
    this.setArchives(archives);
  }

  setArchives(archives: readonly AssetArchive[]): void {
    this.archives = archives.map(archive => ({ ...archive }));
    this.winners.clear();
    this.allSources.clear();
    this.clearDecodedCache();

    this.archives.forEach((archive, archiveIndex) => {
      if (archive.enabled === false) return;
      if (archive.data.byteLength > this.maxArchiveBytes) {
        throw new Error(`${archive.name} exceeds the ${this.maxArchiveBytes}-byte archive limit`);
      }
      for (const source of listArchiveEntries(archive, archiveIndex)) {
        const sources = this.allSources.get(source.normalizedPath) ?? [];
        sources.push(source);
        this.allSources.set(source.normalizedPath, sources);
        this.winners.set(source.normalizedPath, {
          path: source.path,
          normalizedPath: source.normalizedPath,
          kind: classifyAsset(source.normalizedPath),
          source,
          overriddenSources: sources.slice(0, -1),
        });
      }
    });
  }

  get archiveCount(): number {
    return this.archives.filter(archive => archive.enabled !== false).length;
  }

  get size(): number {
    return this.winners.size;
  }

  get(path: string): IndexedAsset | null {
    return this.winners.get(normalizeAssetPath(path)) ?? null;
  }

  getSources(path: string): readonly AssetSource[] {
    return this.allSources.get(normalizeAssetPath(path)) ?? [];
  }

  list(kind?: AssetKind): IndexedAsset[] {
    return [...this.winners.values()]
      .filter(asset => !kind || asset.kind === kind)
      .sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));
  }

  images(): IndexedAsset[] { return this.list('image'); }
  shaders(): IndexedAsset[] { return this.list('shader'); }
  models(): IndexedAsset[] { return this.list('model'); }
  skins(): IndexedAsset[] { return this.list('skin'); }
  entityDefinitions(): IndexedAsset[] { return this.list('entity-definition'); }
  maps(): IndexedAsset[] { return this.list('map'); }

  readBytes(path: string): Uint8Array | null {
    const asset = this.get(path);
    if (!asset) return null;
    if (asset.source.size > this.maxEntryBytes) {
      throw new Error(`${asset.path} exceeds the ${this.maxEntryBytes}-byte decoded-entry limit`);
    }
    const cacheKey = `${asset.source.archiveIndex}:${asset.normalizedPath}`;
    const cached = this.decoded.get(cacheKey);
    if (cached) {
      this.decoded.delete(cacheKey);
      this.decoded.set(cacheKey, cached);
      return cached.data;
    }

    const archive = this.archives[asset.source.archiveIndex];
    const files = unzipSync(new Uint8Array(archive.data), {
      filter: file => file.name.replace(/\\/g, '/') === asset.source.path,
    });
    const matched = Object.entries(files).find(([entryPath]) =>
      entryPath.replace(/\\/g, '/') === asset.source.path);
    if (!matched) throw new Error(`${asset.path} could not be decoded from ${archive.name}`);
    const data = matched[1];
    this.remember(cacheKey, data);
    return data;
  }

  readText(path: string): string | null {
    const data = this.readBytes(path);
    return data ? new TextDecoder().decode(data) : null;
  }

  clearDecodedCache(): void {
    this.decoded.clear();
    this.decodedBytes = 0;
  }

  private remember(key: string, data: Uint8Array): void {
    if (data.byteLength > this.maxDecodedCacheBytes) return;
    while (this.decodedBytes + data.byteLength > this.maxDecodedCacheBytes) {
      const oldest = this.decoded.entries().next().value as [string, CacheEntry] | undefined;
      if (!oldest) break;
      this.decoded.delete(oldest[0]);
      this.decodedBytes -= oldest[1].size;
    }
    this.decoded.set(key, { data, size: data.byteLength });
    this.decodedBytes += data.byteLength;
  }
}
