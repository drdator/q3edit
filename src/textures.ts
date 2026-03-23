import { PakFiles } from './pak';
import { decodeTGA } from './tga';

export type BlendMode = 'opaque' | 'add' | 'blend';

export interface TextureInfo {
  glTexture: WebGLTexture;
  width: number;
  height: number;
}

export class TextureManager {
  private gl: WebGL2RenderingContext;
  private pak: PakFiles;
  private cache = new Map<string, TextureInfo>();
  private loading = new Set<string>();
  private white!: TextureInfo;
  private missing!: TextureInfo;
  // shader name → image path resolved from .shader files
  private shaderImages = new Map<string, string>();
  // shader name → blend mode resolved from .shader files
  private shaderBlendModes = new Map<string, BlendMode>();

  // Callback when a texture finishes loading (triggers redraw)
  onTextureLoaded: (() => void) | null = null;

  constructor(gl: WebGL2RenderingContext, pak: PakFiles) {
    this.gl = gl;
    this.pak = pak;
    this.white = this.createSolid(255, 255, 255, 255, '__white');
    this.missing = this.createCheckerboard();
    this.parseShaders();
  }

  /** Parse all scripts/*.shader files to build shader name → editor image mapping */
  private parseShaders(): void {
    for (const [path, data] of this.pak) {
      if (!path.startsWith('scripts/') || !path.endsWith('.shader')) continue;

      const text = new TextDecoder().decode(data);
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

        while (i < len && depth > 0) {
          skipWhitespace();
          if (i >= len) break;

          if (text[i] === '{') { depth++; i++; continue; }
          if (text[i] === '}') { depth--; i++; continue; }

          const token = readToken();
          const tokenLower = token.toLowerCase();

          if (tokenLower === 'qer_editorimage' && depth === 1) {
            editorImage = readToken().toLowerCase();
          } else if (tokenLower === 'surfaceparm' && depth === 1) {
            skipWhitespace();
            if (i < len && text[i] !== '{' && text[i] !== '}') {
              const parm = readToken().toLowerCase();
              if (parm === 'trans') hasTrans = true;
            }
          } else if (tokenLower === 'blendfunc' && depth === 2 && !stageBlend) {
            skipWhitespace();
            if (i < len && text[i] !== '{' && text[i] !== '}') {
              const arg1 = readToken().toLowerCase();
              if (arg1 === 'add') {
                stageBlend = 'add';
              } else if (arg1 === 'blend') {
                stageBlend = 'blend';
              } else if (arg1 === 'filter') {
                stageBlend = 'blend';
              } else if (arg1.startsWith('gl_')) {
                // Explicit two-arg form: blendfunc GL_X GL_Y
                skipWhitespace();
                if (i < len && text[i] !== '{' && text[i] !== '}') {
                  const arg2 = readToken().toLowerCase();
                  stageBlend = (arg1 === 'gl_one' && arg2 === 'gl_one') ? 'add' : 'blend';
                } else {
                  stageBlend = 'blend';
                }
              } else {
                // Unknown single-arg shorthand
                stageBlend = 'blend';
              }
            }
          } else if (tokenLower === 'map' && depth === 2 && !firstMapImage) {
            const val = readToken().toLowerCase();
            if (val && val[0] !== '$' && val !== 'textures') {
              firstMapImage = val;
            }
          }
        }

        const key = shaderName.toLowerCase();
        const shortKey = key.startsWith('textures/') ? key.substring(9) : key;

        // Store blend mode (transparent only if both surfaceparm trans AND blendfunc present)
        const finalBlend = (hasTrans && stageBlend) ? stageBlend : 'opaque';
        if (finalBlend !== 'opaque') {
          this.shaderBlendModes.set(shortKey, finalBlend);
          this.shaderBlendModes.set(key, finalBlend);
        }

        const image = editorImage || firstMapImage;
        if (image) {
          const imagePath = image.replace(/\.(tga|jpg|jpeg)$/i, '');
          this.shaderImages.set(shortKey, imagePath);
          this.shaderImages.set(key, imagePath);
        }
      }
    }
  }

  getBlendMode(name: string): BlendMode {
    const key = name.toLowerCase().replace(/\\/g, '/').replace(/\.(tga|jpg|jpeg)$/i, '');
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
      this.loadTexture(key);
    }

    return this.missing;
  }

  getIfLoaded(name: string): TextureInfo | null {
    return this.cache.get(name.toLowerCase().replace(/\\/g, '/')) ?? null;
  }

  registerTexture(name: string, glTexture: WebGLTexture, width: number, height: number): void {
    this.cache.set(name, { glTexture, width, height });
  }

  private async loadTexture(name: string): Promise<void> {
    // Strip extension if present
    const baseName = name.replace(/\.(tga|jpg|jpeg)$/i, '');

    // Try various paths to find the texture file
    const candidates = [
      baseName + '.tga',
      baseName + '.jpg',
      'textures/' + baseName + '.tga',
      'textures/' + baseName + '.jpg',
    ];

    for (const path of candidates) {
      const data = this.pak.get(path);
      if (!data) continue;

      if (path.endsWith('.tga')) {
        const result = decodeTGA(data);
        if (result) {
          const info = this.uploadRGBA(result.pixels, result.width, result.height);
          this.cache.set(name, info);
          this.onTextureLoaded?.();
          return;
        }
      } else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
        try {
          const info = await this.loadJPG(data);
          this.cache.set(name, info);
          this.onTextureLoaded?.();
          return;
        } catch { /* try next */ }
      }
    }

    // Try shader-defined image as fallback
    const shaderImage = this.shaderImages.get(baseName);
    if (shaderImage && shaderImage !== baseName) {
      const shaderCandidates = [
        shaderImage + '.tga',
        shaderImage + '.jpg',
        'textures/' + shaderImage + '.tga',
        'textures/' + shaderImage + '.jpg',
      ];
      for (const path of shaderCandidates) {
        const data = this.pak.get(path);
        if (!data) continue;

        if (path.endsWith('.tga')) {
          const result = decodeTGA(data);
          if (result) {
            const info = this.uploadRGBA(result.pixels, result.width, result.height);
            this.cache.set(name, info);
            this.onTextureLoaded?.();
            return;
          }
        } else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
          try {
            const info = await this.loadJPG(data);
            this.cache.set(name, info);
            this.onTextureLoaded?.();
            return;
          } catch { /* try next */ }
        }
      }
    }

    // Not found — use missing texture placeholder
    this.cache.set(name, this.missing);
  }

  private async loadJPG(data: Uint8Array): Promise<TextureInfo> {
    const blob = new Blob([data.buffer as ArrayBuffer], { type: 'image/jpeg' });
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

    const baseName = key.replace(/\.(tga|jpg|jpeg)$/i, '');
    const candidates = [
      baseName + '.tga',
      baseName + '.jpg',
      'textures/' + baseName + '.tga',
      'textures/' + baseName + '.jpg',
    ];

    for (const path of candidates) {
      const data = this.pak.get(path);
      if (!data) continue;

      if (path.endsWith('.tga')) {
        const result = decodeTGA(data);
        if (result) {
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
      } else {
        const blob = new Blob([data as BlobPart], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        this.thumbnailCache.set(key, url);
        return url;
      }
    }

    // Try shader-defined image as fallback
    const shaderImage = this.shaderImages.get(baseName);
    if (shaderImage && shaderImage !== baseName) {
      const shaderCandidates = [
        shaderImage + '.tga',
        shaderImage + '.jpg',
        'textures/' + shaderImage + '.tga',
        'textures/' + shaderImage + '.jpg',
      ];
      for (const path of shaderCandidates) {
        const data = this.pak.get(path);
        if (!data) continue;

        if (path.endsWith('.tga')) {
          const result = decodeTGA(data);
          if (result) {
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
        } else {
          const blob = new Blob([data as BlobPart], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          this.thumbnailCache.set(key, url);
          return url;
        }
      }
    }

    return null;
  }

  /**
   * Find the raw image file data for a texture name (as used in .map files).
   * Returns [pakPath, data] or null if not found.
   */
  findImageFile(name: string): [string, Uint8Array] | null {
    const baseName = name.replace(/\.(tga|jpg|jpeg)$/i, '');
    const candidates = [
      baseName + '.tga',
      baseName + '.jpg',
      'textures/' + baseName + '.tga',
      'textures/' + baseName + '.jpg',
    ];
    for (const path of candidates) {
      const data = this.pak.get(path);
      if (data) return [path, data];
    }
    return null;
  }

  // List all texture paths available in the pak (for the texture browser)
  listTextures(): string[] {
    const textures: string[] = [];
    for (const path of this.pak.keys()) {
      if ((path.startsWith('textures/') || path.startsWith('models/')) &&
          (path.endsWith('.tga') || path.endsWith('.jpg'))) {
        // Strip extension and 'textures/' prefix
        const name = path.replace(/\.(tga|jpg)$/, '').replace(/^textures\//, '');
        if (!textures.includes(name)) {
          textures.push(name);
        }
      }
    }
    textures.sort();
    return textures;
  }

  // List texture directories (for folder-based browsing)
  listTextureDirectories(): string[] {
    const dirs = new Set<string>();
    for (const path of this.pak.keys()) {
      if (path.startsWith('textures/') && (path.endsWith('.tga') || path.endsWith('.jpg'))) {
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
    for (const path of this.pak.keys()) {
      if (path.startsWith(prefix) && (path.endsWith('.tga') || path.endsWith('.jpg'))) {
        textures.add(path.replace(/\.(tga|jpg)$/, '').replace(/^textures\//, ''));
      }
    }
    return [...textures].sort();
  }
}
