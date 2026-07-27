import { strToU8, unzipSync, zipSync } from 'fflate';
import type { AssetIndex, AssetKind, IndexedAsset } from './asset-index';
import { normalizeAssetPath } from './asset-index';
import type { Entity } from './entity';
import type { TextureManager } from './textures';
import { decodeMd3 } from './md3';

export interface ArenaMetadata {
  title: string;
  gameTypes: string[];
  botSupport: boolean;
  recommendedPlayers: string;
  author: string;
  description: string;
}

export interface ReleaseFiles {
  readme: string;
  license: string;
  attribution: string;
}

export type DependencyDisposition = 'base-game' | 'redistributable' | 'unlicensed' | 'missing';

export interface AssetDependency {
  requestedPath: string;
  resolvedPath: string | null;
  kind: AssetKind | 'sound' | 'music' | 'environment';
  disposition: DependencyDisposition;
  archive: string | null;
  licensed: boolean;
  caseMismatch: boolean;
  ambiguous: boolean;
  duplicateSources: string[];
  usedBy: string[];
}

export interface ProjectAssetManifest {
  dependencies: AssetDependency[];
  missing: AssetDependency[];
  ambiguous: AssetDependency[];
  caseMismatches: AssetDependency[];
  unlicensed: AssetDependency[];
  unusedProjectAssets: Array<{ path: string; archive: string }>;
}

export interface ReleasePackageInput {
  mapName: string;
  bsp: Uint8Array;
  aas?: Uint8Array | null;
  entities: readonly Entity[];
  assets: AssetIndex;
  textures: TextureManager;
  metadata: ArenaMetadata;
  levelshot?: Uint8Array | null;
  levelshotExtension?: 'png' | 'jpg';
  files?: Partial<ReleaseFiles>;
  includeSourceMap?: string | null;
  allowUnlicensed?: boolean;
}

export interface PackageReport {
  mapName: string;
  deterministic: true;
  entries: Array<{ path: string; bytes: number }>;
  totalBytes: number;
  manifest: ProjectAssetManifest;
  archiveValidation: { valid: boolean; errors: string[]; baseGameDependencies: string[] };
}

export interface ReleasePackageResult {
  pk3: Uint8Array;
  report: PackageReport;
  arenaText: string;
}

const IMAGE_EXTENSIONS = ['.tga', '.jpg', '.jpeg', '.png', '.webp'];
const SOUND_EXTENSIONS = ['.wav', '.ogg'];

function cleanReference(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function isBaseGameArchive(name: string): boolean {
  return /^(?:pak[0-9]+(?:-[a-z0-9_-]+)?|demoq3)\.pk3$/i.test(name.split(/[\\/]/).pop() ?? name);
}

function licenseAssets(assets: AssetIndex): Map<string, IndexedAsset[]> {
  const result = new Map<string, IndexedAsset[]>();
  for (const asset of assets.list()) {
    if (!/(?:^|\/)(?:copying|license|licence)(?:\.[a-z0-9]+)?$/i.test(asset.path)) continue;
    const rows = result.get(asset.source.archiveName) ?? [];
    rows.push(asset);
    result.set(asset.source.archiveName, rows);
  }
  return result;
}

function candidates(path: string, kind: AssetDependency['kind']): string[] {
  const normalized = cleanReference(path);
  if (!normalized || normalized.startsWith('*') || normalized.startsWith('$')) return [];
  const extension = /\.[a-z0-9]+$/i.test(normalized);
  if (kind === 'image' || kind === 'environment') {
    const roots = normalized.startsWith('textures/') ? [normalized] : [normalized, `textures/${normalized}`];
    return extension ? roots : roots.flatMap(root => IMAGE_EXTENSIONS.map(ext => root + ext));
  }
  if (kind === 'sound' || kind === 'music') {
    const root = normalized.startsWith('sound/') ? normalized : `sound/${normalized}`;
    return extension ? [normalized, root] : SOUND_EXTENSIONS.flatMap(ext => [normalized + ext, root + ext]);
  }
  if (kind === 'model') {
    const withExtension = /\.md3$/i.test(normalized) ? normalized : `${normalized}.md3`;
    return withExtension.startsWith('models/') ? [withExtension] : [withExtension, `models/${withExtension}`];
  }
  if (kind === 'skin') {
    return normalized.startsWith('models/') ? [normalized] : [normalized, `models/${normalized}`];
  }
  return [normalized];
}

function resolveDependency(
  requestedPath: string,
  kind: AssetDependency['kind'],
  usedBy: string[],
  assets: AssetIndex,
  licenses: Map<string, IndexedAsset[]>,
): AssetDependency {
  const requested = cleanReference(requestedPath);
  const candidatePaths = candidates(requested, kind);
  const matched = candidatePaths
    .map(path => ({ path, asset: assets.get(path) }))
    .find((value): value is { path: string; asset: IndexedAsset } => value.asset !== null) ?? null;
  const asset = matched?.asset ?? null;
  const sources = asset ? assets.getSources(asset.normalizedPath) : [];
  const archive = asset?.source.archiveName ?? null;
  const baseGame = archive ? isBaseGameArchive(archive) : false;
  const licensed = archive ? baseGame || licenses.has(archive) : false;
  return {
    requestedPath: requested,
    resolvedPath: asset?.path ?? null,
    kind,
    disposition: !asset ? 'missing' : baseGame ? 'base-game' : licensed ? 'redistributable' : 'unlicensed',
    archive,
    licensed,
    caseMismatch: Boolean(asset && matched
      && normalizeAssetPath(matched.path) === asset.normalizedPath
      && matched.path !== asset.path),
    ambiguous: sources.length > 1,
    duplicateSources: sources.map(source => `${source.archiveName}:${source.path}`),
    usedBy,
  };
}

function mergeDependency(target: Map<string, AssetDependency>, dependency: AssetDependency): void {
  const key = `${dependency.kind}:${normalizeAssetPath(dependency.requestedPath)}`;
  const existing = target.get(key);
  if (!existing) target.set(key, dependency);
  else existing.usedBy = [...new Set([...existing.usedBy, ...dependency.usedBy])];
}

export function scanProjectAssets(
  entities: readonly Entity[],
  assets: AssetIndex,
  textures: TextureManager,
): ProjectAssetManifest {
  const licenses = licenseAssets(assets);
  const dependencies = new Map<string, AssetDependency>();
  const textureRefs = new Map<string, string[]>();
  const addTexture = (texture: string, usedBy: string) => {
    const refs = textureRefs.get(texture) ?? [];
    refs.push(usedBy);
    textureRefs.set(texture, refs);
  };
  const addSkinMaterials = (dependency: AssetDependency, usedBy: string) => {
    if (!dependency.resolvedPath) return;
    const text = assets.readText(dependency.resolvedPath);
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.replace(/\/\/.*$/, '').trim();
      const comma = trimmed.indexOf(',');
      if (comma <= 0) continue;
      const surface = trimmed.slice(0, comma).trim();
      const material = trimmed.slice(comma + 1).trim();
      if (surface && material && !surface.toLowerCase().startsWith('tag_')) {
        addTexture(material, `${usedBy}:${surface}`);
      }
    }
  };

  entities.forEach((entity, entityIndex) => {
    entity.brushes.forEach((brush, brushIndex) => brush.faces.forEach((face, faceIndex) =>
      addTexture(face.texture, `E${entityIndex}:B${brushIndex}:F${faceIndex}`)));
    entity.patches.forEach((patch, patchIndex) => addTexture(patch.texture, `E${entityIndex}:P${patchIndex}`));
    for (const [key, value] of Object.entries(entity.properties)) {
      if (!value || key.startsWith('_q3edit_')) continue;
      const usedBy = [`E${entityIndex}:${key}`];
      if (key === 'model' && !value.startsWith('*')) mergeDependency(dependencies, resolveDependency(value, 'model', usedBy, assets, licenses));
      else if (key === 'skin' || key === '_skin') mergeDependency(dependencies, resolveDependency(value, 'skin', usedBy, assets, licenses));
      else if (/^(?:noise|sound|soundLoop|soundStart|soundEnd)$/i.test(key)) mergeDependency(dependencies, resolveDependency(value, 'sound', usedBy, assets, licenses));
      else if (/^music$/i.test(key)) {
        for (const track of value.split(/\s+/).filter(Boolean)) {
          mergeDependency(dependencies, resolveDependency(track, 'music', usedBy, assets, licenses));
        }
      }
    }

    const modelPath = entity.properties.model;
    if (modelPath && !modelPath.startsWith('*')) {
      const modelDependency = resolveDependency(modelPath, 'model', [`E${entityIndex}:model`], assets, licenses);
      if (modelDependency.resolvedPath) {
        const bytes = assets.readBytes(modelDependency.resolvedPath);
        if (bytes) {
          try {
            const model = decodeMd3(bytes);
            for (const surface of model.surfaces) {
              for (const material of surface.shaders.filter(Boolean)) {
                addTexture(material, `E${entityIndex}:model:${surface.name}`);
              }
            }
          } catch {
            // The model dependency itself remains in the manifest; compiler/model
            // diagnostics report malformed MD3 data with more useful context.
          }
        }
        const explicitSkin = entity.properties.skin || entity.properties._skin;
        const defaultSkin = modelDependency.resolvedPath.replace(/\.md3$/i, '_default.skin');
        const skinPath = explicitSkin || (assets.get(defaultSkin) ? defaultSkin : '');
        if (skinPath) {
          const skinDependency = resolveDependency(skinPath, 'skin', [`E${entityIndex}:skin`], assets, licenses);
          mergeDependency(dependencies, skinDependency);
          addSkinMaterials(skinDependency, `E${entityIndex}:skin`);
        }
      }
    }
  });

  for (const [texture, usedBy] of textureRefs) {
    const shaderPath = textures.getShaderSourcePath(texture);
    const projectShaderFiles = textures.getProjectShaderFiles?.() ?? {};
    if (shaderPath && projectShaderFiles[shaderPath] === undefined) {
      mergeDependency(dependencies, resolveDependency(shaderPath, 'shader', usedBy, assets, licenses));
    }
    const metadata = textures.getShaderMetadata(texture);
    const imageReferences = new Set<string>([
      ...(metadata?.referencedImages ?? []),
      ...(metadata?.sky?.outerBox && metadata.sky.outerBox !== '-'
        ? ['rt', 'lf', 'bk', 'ft', 'up', 'dn'].map(face => `${metadata.sky!.outerBox}_${face}`)
        : []),
    ]);
    if (imageReferences.size === 0) {
      const image = textures.findImageFile(texture);
      mergeDependency(dependencies, image
        ? resolveDependency(image[0], 'image', usedBy, assets, licenses)
        : resolveDependency(texture, 'image', usedBy, assets, licenses));
    } else {
      for (const image of imageReferences) {
        if (image.startsWith('$') || image.startsWith('*')) continue;
        mergeDependency(dependencies, resolveDependency(image, metadata?.semantics.sky ? 'environment' : 'image', usedBy, assets, licenses));
      }
    }
  }

  const rows = [...dependencies.values()].sort((a, b) =>
    (a.resolvedPath ?? a.requestedPath).localeCompare(b.resolvedPath ?? b.requestedPath));
  const usedPaths = new Set(rows.map(row => row.resolvedPath && normalizeAssetPath(row.resolvedPath)).filter(Boolean));
  const unusedProjectAssets = assets.list()
    .filter(asset => !isBaseGameArchive(asset.source.archiveName) && !usedPaths.has(asset.normalizedPath))
    .map(asset => ({ path: asset.path, archive: asset.source.archiveName }));
  return {
    dependencies: rows,
    missing: rows.filter(row => row.disposition === 'missing'),
    ambiguous: rows.filter(row => row.ambiguous),
    caseMismatches: rows.filter(row => row.caseMismatch),
    unlicensed: rows.filter(row => row.disposition === 'unlicensed'),
    unusedProjectAssets,
  };
}

function escapeArena(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

export function serializeArena(mapName: string, metadata: ArenaMetadata): string {
  const types = metadata.gameTypes.length > 0 ? metadata.gameTypes.join(' ') : 'ffa';
  const lines = [
    '{',
    `  map "${escapeArena(mapName)}"`,
    `  longname "${escapeArena(metadata.title || mapName)}"`,
    `  type "${escapeArena(types)}"`,
  ];
  if (metadata.botSupport) lines.push('  bots "1"');
  if (metadata.recommendedPlayers) lines.push(`  players "${escapeArena(metadata.recommendedPlayers)}"`);
  if (metadata.author) lines.push(`  author "${escapeArena(metadata.author)}"`);
  if (metadata.description) lines.push(`  description "${escapeArena(metadata.description)}"`);
  lines.push('}', '');
  return lines.join('\n');
}

function addEntry(entries: Map<string, Uint8Array>, path: string, data: Uint8Array | string): void {
  const normalized = cleanReference(path);
  if (!normalized || normalized.split('/').includes('..')) throw new Error(`Unsafe package path: ${path}`);
  const collision = [...entries.keys()].find(existing => existing.toLowerCase() === normalized.toLowerCase());
  if (collision && collision !== normalized) throw new Error(`Case-colliding package paths: ${collision} and ${normalized}`);
  entries.set(normalized, typeof data === 'string' ? strToU8(data) : data);
}

export function buildReleasePackage(input: ReleasePackageInput): ReleasePackageResult {
  const mapName = input.mapName.replace(/[^a-zA-Z0-9_-]/g, '') || 'release';
  const manifest = scanProjectAssets(input.entities, input.assets, input.textures);
  const errors = manifest.missing.map(item => `Missing ${item.requestedPath}`);
  if (!input.allowUnlicensed) errors.push(...manifest.unlicensed.map(item => `No redistribution license found for ${item.resolvedPath}`));
  if (errors.length > 0) throw new Error(errors.join('\n'));

  const entries = new Map<string, Uint8Array>();
  addEntry(entries, `maps/${mapName}.bsp`, input.bsp);
  if (input.aas) addEntry(entries, `maps/${mapName}.aas`, input.aas);
  const arenaText = serializeArena(mapName, input.metadata);
  addEntry(entries, `scripts/${mapName}.arena`, arenaText);
  if (input.levelshot) addEntry(entries, `levelshots/${mapName}.${input.levelshotExtension ?? 'png'}`, input.levelshot);
  if (input.includeSourceMap) addEntry(entries, `maps/${mapName}.map`, input.includeSourceMap);
  for (const [path, source] of Object.entries(input.textures.getProjectShaderFiles?.() ?? {})) {
    addEntry(entries, path, source);
  }
  if (input.files?.readme) addEntry(entries, 'README.txt', input.files.readme);
  if (input.files?.license) addEntry(entries, 'LICENSE.txt', input.files.license);
  if (input.files?.attribution) addEntry(entries, 'ATTRIBUTION.txt', input.files.attribution);

  const includedArchives = new Set<string>();
  for (const dependency of manifest.dependencies) {
    if (dependency.disposition === 'base-game' || !dependency.resolvedPath) continue;
    const data = input.assets.readBytes(dependency.resolvedPath);
    if (data) addEntry(entries, dependency.resolvedPath, data);
    if (dependency.archive) includedArchives.add(dependency.archive);
  }
  for (const archive of includedArchives) {
    for (const asset of input.assets.list().filter(asset =>
      asset.source.archiveName === archive
      && /(?:^|\/)(?:copying|license|licence)(?:\.[a-z0-9]+)?$/i.test(asset.path))) {
      const data = input.assets.readBytes(asset.path);
      if (data) addEntry(entries, `licenses/${archive}/${asset.path.split('/').pop()}`, data);
    }
  }

  const reportPath = `reports/${mapName}-package-report.json`;
  const sortedBeforeReport = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));
  const preliminary = {
    mapName,
    deterministic: true as const,
    entries: sortedBeforeReport.map(([path, data]) => ({ path, bytes: data.byteLength })),
    totalBytes: sortedBeforeReport.reduce((sum, [, data]) => sum + data.byteLength, 0),
    manifest,
    archiveValidation: {
      valid: true,
      errors: [] as string[],
      baseGameDependencies: manifest.dependencies.filter(item => item.disposition === 'base-game').map(item => item.requestedPath),
    },
  };
  addEntry(entries, reportPath, JSON.stringify(preliminary, null, 2));
  const sorted = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));
  const zipInput: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const [path, data] of sorted) zipInput[path] = [data, { mtime: new Date('1980-01-01T00:00:00Z') }];
  const pk3 = zipSync(zipInput, { level: 6 });
  const unpacked = unzipSync(pk3);
  const validationErrors = [
    `maps/${mapName}.bsp`,
    `scripts/${mapName}.arena`,
    ...manifest.dependencies.filter(item => item.disposition === 'redistributable' || item.disposition === 'unlicensed')
      .map(item => item.resolvedPath!)
  ].filter(path => !unpacked[path]).map(path => `Package is missing ${path}`);
  const report: PackageReport = {
    ...preliminary,
    entries: sorted.map(([path, data]) => ({ path, bytes: data.byteLength })),
    totalBytes: sorted.reduce((sum, [, data]) => sum + data.byteLength, 0),
    archiveValidation: { ...preliminary.archiveValidation, valid: validationErrors.length === 0, errors: validationErrors },
  };
  if (!report.archiveValidation.valid) throw new Error(validationErrors.join('\n'));
  return { pk3, report, arenaText };
}
