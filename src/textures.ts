import { AssetIndex, type IndexedAsset } from './asset-index';
import { decodeTGA } from './tga';
import type { TextureFiltering } from './display-policy';

export type BlendMode = 'opaque' | 'add' | 'blend';

export interface ShaderStageMetadata {
  images: string[];
  blendFunc: string[];
}

export interface ShaderMetadata {
  name: string;
  sourcePath: string;
  editorImage: string | null;
  previewImage: string | null;
  surfaceParms: string[];
  q3mapDirectives: Array<{ name: string; args: string[] }>;
  sky: { outerBox: string; cloudHeight: string; innerBox: string } | null;
  stages: ShaderStageMetadata[];
  referencedImages: string[];
  blendMode: BlendMode;
  semantics: {
    sky: boolean;
    nodraw: boolean;
    trigger: boolean;
    transparent: boolean;
    nonsolid: boolean;
    emissive: boolean;
    emission: number | null;
    compileSafe: boolean;
    contentFlags: number;
    surfaceFlags: number;
  };
}

export interface TextureInfo {
  glTexture: WebGLTexture;
  width: number;
  height: number;
}

const IMAGE_EXTENSION = /\.(tga|jpe?g|png|webp)$/i;
const IMAGE_EXTENSIONS = ['.tga', '.jpg', '.jpeg', '.png', '.webp'] as const;

const SURFACE_PARM_FLAGS: Record<string, { content?: number; surface?: number }> = {
  sky: { surface: 0x00000004 }, noimpact: { surface: 0x00000010 }, nomarks: { surface: 0x00000020 },
  nodraw: { surface: 0x00000080 }, nolightmap: { surface: 0x00000400 }, metalsteps: { surface: 0x00001000 },
  nosteps: { surface: 0x00002000 }, nodlight: { surface: 0x00020000 },
  areaportal: { content: 0x00008000 }, playerclip: { content: 0x00010000 }, monsterclip: { content: 0x00020000 },
  clusterportal: { content: 0x00100000 }, donotenter: { content: 0x00200000 }, origin: { content: 0x01000000 },
  detail: { content: 0x08000000 }, structural: { content: 0x10000000 }, trans: { content: 0x20000000 },
  trigger: { content: 0x40000000 }, nodrop: { content: 0x80000000 },
  lava: { content: 0x00000008 }, slime: { content: 0x00000010 }, water: { content: 0x00000020 }, fog: { content: 0x00000040 },
};

function shaderSemantics(surfaceParms: string[], directives: ShaderMetadata['q3mapDirectives']): ShaderMetadata['semantics'] {
  const parms = new Set(surfaceParms);
  let contentFlags = parms.has('nonsolid') ? 0 : 1;
  let surfaceFlags = 0;
  for (const parm of parms) {
    contentFlags |= SURFACE_PARM_FLAGS[parm]?.content ?? 0;
    surfaceFlags |= SURFACE_PARM_FLAGS[parm]?.surface ?? 0;
  }
  const surfaceLight = directives.find(directive => directive.name === 'q3map_surfacelight');
  const emission = surfaceLight && Number.isFinite(Number(surfaceLight.args[0])) ? Number(surfaceLight.args[0]) : null;
  return {
    sky: parms.has('sky'), nodraw: parms.has('nodraw'), trigger: parms.has('trigger'),
    transparent: parms.has('trans'), nonsolid: parms.has('nonsolid'),
    emissive: emission !== null && emission > 0, emission,
    compileSafe: true, contentFlags: contentFlags >>> 0, surfaceFlags: surfaceFlags >>> 0,
  };
}

function normalizedImageName(name: string): string {
  return name.toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
}

function encodedImageDimensions(path: string, data: Uint8Array): { width: number; height: number } | null {
  if (/\.png$/i.test(path) && data.length >= 24) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (/\.tga$/i.test(path) && data.length >= 16) {
    return { width: data[12] | data[13] << 8, height: data[14] | data[15] << 8 };
  }
  if (/\.jpe?g$/i.test(path)) {
    let offset = 2;
    while (offset + 8 < data.length) {
      if (data[offset] !== 0xff) { offset++; continue; }
      const marker = data[offset + 1];
      const length = data[offset + 2] << 8 | data[offset + 3];
      if (length < 2) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
        return { width: data[offset + 7] << 8 | data[offset + 8], height: data[offset + 5] << 8 | data[offset + 6] };
      }
      offset += 2 + length;
    }
  }
  if (/\.webp$/i.test(path) && data.length >= 30 && String.fromCharCode(...data.slice(12, 16)) === 'VP8X') {
    return {
      width: 1 + data[24] + (data[25] << 8) + (data[26] << 16),
      height: 1 + data[27] + (data[28] << 8) + (data[29] << 16),
    };
  }
  return null;
}

export function textureImageCandidates(name: string): string[] {
  const normalized = normalizedImageName(name);
  const explicitExtension = normalized.match(IMAGE_EXTENSION)?.[0].toLowerCase();
  const baseName = normalized.replace(IMAGE_EXTENSION, '');
  const roots = baseName.startsWith('textures/') ? [baseName] : [baseName, `textures/${baseName}`];
  const extensions = explicitExtension
    ? [explicitExtension, ...IMAGE_EXTENSIONS.filter(extension => extension !== explicitExtension)]
    : [...IMAGE_EXTENSIONS];
  return [...new Set(roots.flatMap(root => extensions.map(extension => root + extension)))];
}

export function imageMimeType(path: string): string {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'image/jpeg';
}

export class TextureManager {
  private gl: WebGL2RenderingContext;
  private assets: AssetIndex;
  private cache = new Map<string, TextureInfo>();
  private loading = new Set<string>();
  private pendingLoads = new Set<Promise<void>>();
  private white!: TextureInfo;
  private missing!: TextureInfo;
  // shader name → image path resolved from .shader files
  private shaderImages = new Map<string, string>();
  // shader name → blend mode resolved from .shader files
  private shaderBlendModes = new Map<string, BlendMode>();
  // All declared shader names, including tool shaders with no preview image.
  private shaderNames = new Set<string>();
  private shaderSourcePaths = new Map<string, string>();
  private shaderMetadata = new Map<string, ShaderMetadata>();

  // Callback when a texture finishes loading (triggers redraw)
  onTextureLoaded: (() => void) | null = null;

  constructor(gl: WebGL2RenderingContext, assets: AssetIndex) {
    this.gl = gl;
    this.assets = assets;
    this.white = this.createSolid(255, 255, 255, 255, '__white');
    this.missing = this.createCheckerboard();
    this.parseShaders();
  }

  dispose(): void {
    const textures = new Set<WebGLTexture>();
    for (const info of this.cache.values()) textures.add(info.glTexture);
    textures.add(this.white.glTexture);
    textures.add(this.missing.glTexture);
    for (const texture of textures) this.gl.deleteTexture(texture);
    for (const url of this.thumbnailCache.values()) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    this.cache.clear();
    this.thumbnailCache.clear();
    this.loading.clear();
    this.pendingLoads.clear();
  }

  /** Parse all scripts/*.shader files to build shader name → editor image mapping */
  private parseShaders(): void {
    for (const asset of this.assets.shaders()) {
      const path = asset.normalizedPath;
      if (!path.startsWith('scripts/') || !path.endsWith('.shader')) continue;
      const text = this.assets.readText(path) ?? '';
      let i = 0;
      const len = text.length;

      const skipWhitespace = () => {
        while (i < len) {
          if (text[i] === '/' && text[i + 1] === '/') {
            while (i < len && text[i] !== '\n') i++;
          } else if (text[i] === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < len - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i += 2;
          } else if (text[i] <= ' ') {
            i++;
          } else break;
        }
      };

      const readToken = (): string => {
        skipWhitespace();
        if (i >= len) return '';
        const start = i;
        while (i < len && text[i] > ' ') i++;
        return text.substring(start, i);
      };
      const readLineArgs = (): string[] => {
        const start = i;
        while (i < len && text[i] !== '\n' && text[i] !== '\r' && text[i] !== '}') i++;
        return text.substring(start, i).replace(/\/\/.*$/, '').trim().split(/\s+/).filter(Boolean).map(value => value.toLowerCase());
      };

      while (i < len) {
        const shaderName = readToken();
        if (!shaderName || shaderName === '{' || shaderName === '}') continue;

        skipWhitespace();
        if (i >= len || text[i] !== '{') continue;
        i++; // skip opening {

        let editorImage = '';
        let firstMapImage = '';
        let hasTrans = false;
        let stageBlend: BlendMode | null = null;
        let depth = 1;
        const surfaceParms = new Set<string>();
        const q3mapDirectives: ShaderMetadata['q3mapDirectives'] = [];
        const stages: ShaderStageMetadata[] = [];
        let activeStage: ShaderStageMetadata | null = null;
        let sky: ShaderMetadata['sky'] = null;

        while (i < len && depth > 0) {
          skipWhitespace();
          if (i >= len) break;

          if (text[i] === '{') {
            depth++;
            if (depth === 2) { activeStage = { images: [], blendFunc: [] }; stages.push(activeStage); }
            i++;
            continue;
          }
          if (text[i] === '}') {
            if (depth === 2) activeStage = null;
            depth--; i++; continue;
          }

          const token = readToken();
          const tokenLower = token.toLowerCase();

          if (tokenLower === 'qer_editorimage' && depth === 1) {
            editorImage = readToken().toLowerCase();
          } else if (tokenLower === 'surfaceparm' && depth === 1) {
            skipWhitespace();
            if (i < len && text[i] !== '{' && text[i] !== '}') {
              const parm = readToken().toLowerCase();
              surfaceParms.add(parm);
              if (parm === 'trans') hasTrans = true;
            }
          } else if (tokenLower === 'skyparms' && depth === 1) {
            const args = readLineArgs();
            sky = { outerBox: args[0] ?? '-', cloudHeight: args[1] ?? '-', innerBox: args[2] ?? '-' };
          } else if (tokenLower.startsWith('q3map_') && depth === 1) {
            q3mapDirectives.push({ name: tokenLower, args: readLineArgs() });
          } else if (tokenLower === 'blendfunc' && depth === 2) {
            const args = readLineArgs();
            activeStage?.blendFunc.push(...args);
            if (!stageBlend && args.length > 0) {
              const arg1 = args[0];
              if (arg1 === 'add') {
                stageBlend = 'add';
              } else if (arg1 === 'blend') {
                stageBlend = 'blend';
              } else if (arg1 === 'filter') {
                stageBlend = 'blend';
              } else if (arg1.startsWith('gl_')) {
                if (args[1]) {
                  const arg2 = args[1];
                  stageBlend = (arg1 === 'gl_one' && arg2 === 'gl_one') ? 'add' : 'blend';
                } else {
                  stageBlend = 'blend';
                }
              } else {
                // Unknown single-arg shorthand
                stageBlend = 'blend';
              }
            }
          } else if ((tokenLower === 'map' || tokenLower === 'clampmap') && depth === 2) {
            const val = readToken().toLowerCase();
            if (val) activeStage?.images.push(val);
            if (!firstMapImage && val && val[0] !== '$' && val !== 'textures') firstMapImage = val;
          } else if (tokenLower === 'animmap' && depth === 2) {
            const args = readLineArgs();
            const images = args.slice(1);
            activeStage?.images.push(...images);
            if (!firstMapImage) firstMapImage = images.find(value => value[0] !== '$') ?? '';
          }
        }

        const key = shaderName.toLowerCase();
        const shortKey = key.startsWith('textures/') ? key.substring(9) : key;
        this.shaderNames.add(shortKey);
        this.shaderSourcePaths.set(shortKey, path);

        // Store blend mode (transparent only if both surfaceparm trans AND blendfunc present)
        const finalBlend = (hasTrans && stageBlend) ? stageBlend : 'opaque';
        if (finalBlend !== 'opaque') {
          this.shaderBlendModes.set(shortKey, finalBlend);
          this.shaderBlendModes.set(key, finalBlend);
        }

        const image = editorImage || firstMapImage;
        if (image) {
          const imagePath = image.replace(IMAGE_EXTENSION, '');
          this.shaderImages.set(shortKey, imagePath);
          this.shaderImages.set(key, imagePath);
        }
        const referencedImages = [...new Set(stages.flatMap(stage => stage.images))];
        const metadata: ShaderMetadata = {
          name: shortKey,
          sourcePath: path,
          editorImage: editorImage || null,
          previewImage: image ? image.replace(IMAGE_EXTENSION, '') : null,
          surfaceParms: [...surfaceParms],
          q3mapDirectives,
          sky,
          stages,
          referencedImages,
          blendMode: finalBlend,
          semantics: shaderSemantics([...surfaceParms], q3mapDirectives),
        };
        this.shaderMetadata.set(shortKey, metadata);
        this.shaderMetadata.set(key, metadata);
      }
    }
  }

  getBlendMode(name: string): BlendMode {
    const key = name.toLowerCase().replace(/\\/g, '/').replace(IMAGE_EXTENSION, '');
    return this.shaderBlendModes.get(key) ?? this.shaderBlendModes.get('textures/' + key) ?? 'opaque';
  }

  get(name: string): TextureInfo {
    // Normalize name
    const key = name.toLowerCase().replace(/\\/g, '/');

    const cached = this.cache.get(key);
    if (cached) return cached;

    // Start async load if not already loading
    if (!this.loading.has(key)) {
      this.loading.add(key);
      const pending = this.loadTexture(key).finally(() => {
        this.loading.delete(key);
        this.pendingLoads.delete(pending);
      });
      this.pendingLoads.add(pending);
    }

    return this.missing;
  }

  async waitForIdle(): Promise<void> {
    while (this.pendingLoads.size > 0) {
      await Promise.allSettled([...this.pendingLoads]);
    }
  }

  getIfLoaded(name: string): TextureInfo | null {
    return this.cache.get(name.toLowerCase().replace(/\\/g, '/')) ?? null;
  }

  registerTexture(name: string, glTexture: WebGLTexture, width: number, height: number): void {
    this.cache.set(name, { glTexture, width, height });
  }

  bind(info: TextureInfo, filtering: TextureFiltering): void {
    this.gl.bindTexture(this.gl.TEXTURE_2D, info.glTexture);
    const min = filtering === 'nearest' ? this.gl.NEAREST
      : filtering === 'linear' ? this.gl.LINEAR : this.gl.LINEAR_MIPMAP_LINEAR;
    const mag = filtering === 'nearest' ? this.gl.NEAREST : this.gl.LINEAR;
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, min);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, mag);
  }

  private async loadTexture(name: string): Promise<void> {
    const source = this.findImageFile(name);
    if (source) {
      try {
        const info = source[0].endsWith('.tga')
          ? this.loadTGA(source[1])
          : await this.loadBitmap(source[1], imageMimeType(source[0]));
        if (info) {
          this.cache.set(name, info);
          this.onTextureLoaded?.();
          return;
        }
      } catch { /* use the missing texture below */ }
    }

    // Not found — use missing texture placeholder
    this.cache.set(name, this.missing);
  }

  private loadTGA(data: Uint8Array): TextureInfo | null {
    const result = decodeTGA(data);
    return result ? this.uploadRGBA(result.pixels, result.width, result.height) : null;
  }

  private async loadBitmap(data: Uint8Array, mimeType: string): Promise<TextureInfo> {
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    const gl = this.gl;

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    const info: TextureInfo = { glTexture: tex, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return info;
  }

  private uploadRGBA(pixels: Uint8Array, width: number, height: number): TextureInfo {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return { glTexture: tex, width, height };
  }

  private createSolid(r: number, g: number, b: number, a: number, key: string): TextureInfo {
    const pixels = new Uint8Array([r, g, b, a]);
    const info = this.uploadRGBA(pixels, 1, 1);
    this.cache.set(key, info);
    return info;
  }

  private createCheckerboard(): TextureInfo {
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    const checkSize = 8;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const check = ((Math.floor(x / checkSize) + Math.floor(y / checkSize)) & 1) === 0;
        const v = check ? 80 : 50;
        pixels[i] = v; pixels[i + 1] = v; pixels[i + 2] = v; pixels[i + 3] = 255;
      }
    }
    return this.uploadRGBA(pixels, size, size);
  }

  // Get a thumbnail URL for displaying in the UI panel
  private thumbnailCache = new Map<string, string>();

  getThumbnailUrl(name: string): string | null {
    const key = name.toLowerCase().replace(/\\/g, '/');
    const cached = this.thumbnailCache.get(key);
    if (cached) return cached;
    const source = this.findImageFile(name);
    if (!source) return null;
    const [path, data] = source;
    if (path.endsWith('.tga')) {
      const result = decodeTGA(data);
      if (!result) return null;
      const canvas = document.createElement('canvas');
      canvas.width = result.width;
      canvas.height = result.height;
      const ctx = canvas.getContext('2d')!;
      const imageData = ctx.createImageData(result.width, result.height);
      imageData.data.set(result.pixels);
      ctx.putImageData(imageData, 0, 0);
      const url = canvas.toDataURL();
      this.thumbnailCache.set(key, url);
      return url;
    }
    const blob = new Blob([data as BlobPart], { type: imageMimeType(path) });
    const url = URL.createObjectURL(blob);
    this.thumbnailCache.set(key, url);
    return url;
  }

  /** Get all .shader files from the pak as { 'scripts/foo.shader': 'contents...' } */
  getShaderFiles(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const asset of this.assets.shaders()) {
      const path = asset.normalizedPath;
      if (path.startsWith('scripts/') && path.endsWith('.shader')) {
        result[path] = this.assets.readText(path) ?? '';
      }
    }
    return result;
  }

  /**
   * Find the raw image file data for a texture name (as used in .map files).
   * Returns [pakPath, data] or null if not found.
   */
  findImageFile(name: string): [string, Uint8Array] | null {
    const normalized = normalizedImageName(name);
    const baseName = normalized.replace(IMAGE_EXTENSION, '');
    for (const path of textureImageCandidates(normalized)) {
      const data = this.assets.readBytes(path);
      if (data) return [path, data];
    }
    const shaderImage = this.shaderImages.get(baseName)
      ?? this.shaderImages.get(baseName.startsWith('textures/') ? baseName.slice(9) : `textures/${baseName}`);
    if (shaderImage && shaderImage !== baseName) {
      for (const path of textureImageCandidates(shaderImage)) {
        const data = this.assets.readBytes(path);
        if (data) return [path, data];
      }
    }
    return null;
  }

  // List all texture paths available in the pak (for the texture browser)
  listTextures(): string[] {
    const textures = new Set<string>(this.shaderNames);
    for (const { normalizedPath: path } of this.assets.images()) {
      if ((path.startsWith('textures/') || path.startsWith('models/')) &&
          IMAGE_EXTENSION.test(path)) {
        // Strip extension and 'textures/' prefix
        const name = path.replace(IMAGE_EXTENSION, '').replace(/^textures\//, '');
        textures.add(name);
      }
    }
    return [...textures].sort();
  }

  // List texture directories (for folder-based browsing)
  listTextureDirectories(): string[] {
    const dirs = new Set<string>();
    for (const { normalizedPath: path } of this.assets.images()) {
      if (path.startsWith('textures/') && IMAGE_EXTENSION.test(path)) {
        const parts = path.split('/');
        if (parts.length >= 3) {
          dirs.add(parts[1]); // e.g., 'base_wall', 'gothic_floor', etc.
        }
      }
    }
    return [...dirs].sort();
  }

  // List textures in a specific directory
  listTexturesInDir(dir: string): string[] {
    const prefix = `textures/${dir}/`;
    const textures = new Set<string>();
    for (const { normalizedPath: path } of this.assets.images()) {
      if (path.startsWith(prefix) && IMAGE_EXTENSION.test(path)) {
        textures.add(path.replace(IMAGE_EXTENSION, '').replace(/^textures\//, ''));
      }
    }
    return [...textures].sort();
  }

  getTextureAsset(name: string): IndexedAsset | null {
    for (const path of textureImageCandidates(name)) {
      const asset = this.assets.get(path);
      if (asset) return asset;
    }
    return null;
  }

  isShader(name: string): boolean {
    return this.shaderNames.has(name.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, ''));
  }

  getShaderSourcePath(name: string): string | null {
    return this.shaderSourcePaths.get(name.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '')) ?? null;
  }

  getShaderMetadata(name: string): ShaderMetadata | null {
    const key = name.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '');
    const metadata = this.shaderMetadata.get(key) ?? this.shaderMetadata.get(`textures/${key}`);
    return metadata ? structuredClone(metadata) : null;
  }

  inspectTexture(name: string): Record<string, unknown> {
    const shader = this.getShaderMetadata(name);
    const preview = this.findImageFile(name);
    const asset = preview ? this.assets.get(preview[0]) : null;
    const dimensions = preview ? encodedImageDimensions(preview[0], preview[1]) : null;
    const skyOuter = shader?.sky?.outerBox;
    const skyFaces = skyOuter && skyOuter !== '-'
      ? ['rt', 'lf', 'bk', 'ft', 'up', 'dn'].map(face => {
          const texture = `${skyOuter}_${face}`;
          return { face, texture, available: this.findImageFile(texture) !== null };
        })
      : [];
    return {
      name,
      found: this.hasTextureSource(name),
      shader: shader !== null,
      shaderMetadata: shader,
      image: preview ? {
        path: preview[0], archive: asset?.source.archiveName ?? null,
        mimeType: imageMimeType(preview[0]), width: dimensions?.width ?? null, height: dimensions?.height ?? null,
      } : null,
      previewAvailable: preview !== null,
      compilerAvailable: this.hasTextureSource(name),
      skyPreview: skyFaces.length > 0 ? { complete: skyFaces.every(face => face.available), faces: skyFaces } : null,
    };
  }

  hasPreviewSource(name: string): boolean {
    return this.findImageFile(name) !== null;
  }

  hasTextureSource(name: string): boolean {
    if (this.isShader(name)) return true;
    if (this.getTextureAsset(name)) return true;
    const key = name.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '');
    return this.shaderImages.has(key) || this.shaderImages.has(`textures/${key}`);
  }
}
