import type { AssetIndex } from './asset-index';
import { getEntityClassRegistry } from './entity-definitions';
import type { Entity } from './entity';
import { decodeMd3, type Md3Model } from './md3';

export interface ResolvedModel {
  path: string;
  model: Md3Model;
  frame: number;
  skinPath?: string;
  surfaceTextures: Map<string, string>;
}

function normalizeModelPath(path: string): string[] {
  const cleaned = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const withExtension = /\.md3$/i.test(cleaned) ? cleaned : `${cleaned}.md3`;
  return withExtension.startsWith('models/') ? [withExtension] : [withExtension, `models/${withExtension}`];
}

export class ModelManager {
  private cache = new Map<string, Md3Model | Error>();

  constructor(private assets: AssetIndex) {}

  setAssetIndex(assets: AssetIndex): void {
    this.assets = assets;
    this.clear();
  }

  clear(): void { this.cache.clear(); }

  listModels(): string[] { return this.assets.models().map(asset => asset.normalizedPath); }

  get(path: string): Md3Model | null {
    const resolved = normalizeModelPath(path).find(candidate => this.assets.get(candidate));
    if (!resolved) return null;
    const cached = this.cache.get(resolved);
    if (cached) return cached instanceof Error ? null : cached;
    try {
      const bytes = this.assets.readBytes(resolved);
      if (!bytes) return null;
      const model = decodeMd3(bytes);
      this.cache.set(resolved, model);
      return model;
    } catch (error) {
      this.cache.set(resolved, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  error(path: string): Error | null {
    const resolved = normalizeModelPath(path).find(candidate => this.assets.get(candidate));
    if (!resolved) return null;
    const cached = this.cache.get(resolved);
    return cached instanceof Error ? cached : null;
  }

  resolveEntity(entity: Entity): ResolvedModel | null {
    const definition = getEntityClassRegistry().get(entity.classname);
    const requestedPath = entity.properties.model || definition?.model;
    if (!requestedPath) return null;
    const path = normalizeModelPath(requestedPath).find(candidate => this.assets.get(candidate));
    if (!path) return null;
    const model = this.get(path);
    if (!model || model.frames.length === 0) return null;
    const requestedFrame = Number.parseInt(entity.properties.frame ?? '0', 10) || 0;
    const frame = Math.max(0, Math.min(model.frames.length - 1, requestedFrame));
    const requestedSkin = entity.properties.skin;
    const defaultSkin = path.replace(/\.md3$/i, '_default.skin');
    const skinPath = requestedSkin
      ? [requestedSkin, requestedSkin.startsWith('models/') ? '' : `models/${requestedSkin}`].find(candidate => candidate && this.assets.get(candidate))
      : this.assets.get(defaultSkin) ? defaultSkin : undefined;
    const surfaceTextures = this.readSkin(skinPath);
    for (const surface of model.surfaces) {
      if (!surfaceTextures.has(surface.name.toLowerCase()) && surface.shaders[0]) {
        surfaceTextures.set(surface.name.toLowerCase(), surface.shaders[0]);
      }
    }
    return { path, model, frame, skinPath, surfaceTextures };
  }

  private readSkin(path?: string): Map<string, string> {
    const result = new Map<string, string>();
    if (!path) return result;
    const text = this.assets.readText(path);
    if (!text) return result;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.replace(/\/\/.*$/, '').trim();
      const comma = trimmed.indexOf(',');
      if (comma <= 0) continue;
      const surface = trimmed.slice(0, comma).trim().toLowerCase();
      const shader = trimmed.slice(comma + 1).trim();
      if (surface && shader && !surface.startsWith('tag_')) result.set(surface, shader);
    }
    return result;
  }
}
