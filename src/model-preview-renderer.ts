import { createProgram, createSolidBuffer } from './gl-utils';
import type { ResolvedModel } from './model-manager';
import { decodeTGA } from './tga';
import { imageMimeType, type TextureManager } from './textures';

interface PreviewSurface {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  count: number;
  textureName: string;
}

const VERTEX_SHADER = `#version 300 es
precision mediump float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform vec3 uCenter;
uniform float uScale;
uniform float uAspectScale;
uniform vec2 uRotation;
out vec3 vNormal;
out vec2 vUV;

vec3 rotateForView(vec3 value) {
  float cy = cos(uRotation.x);
  float sy = sin(uRotation.x);
  float cp = cos(uRotation.y);
  float sp = sin(uRotation.y);
  vec3 yawed = vec3(
    value.x * cy - value.y * sy,
    value.x * sy + value.y * cy,
    value.z
  );
  return vec3(yawed.x, yawed.z * cp - yawed.y * sp, yawed.y * cp + yawed.z * sp);
}

void main() {
  vec3 position = rotateForView((aPos - uCenter) * uScale);
  vNormal = rotateForView(aNormal);
  vUV = aUV;
  gl_Position = vec4(position.x * uAspectScale, position.y, position.z * 0.35, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec2 vUV;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec4 texel = texture(uTexture, vUV);
  if (texel.a < 0.05) discard;
  vec3 normal = normalize(vNormal);
  float lighting = 0.8 + 0.25 * abs(dot(normal, normalize(vec3(-0.35, 0.45, 0.82))));
  fragColor = vec4(texel.rgb * lighting, texel.a);
}
`;

export class ModelPreviewRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly centerLocation: WebGLUniformLocation;
  private readonly scaleLocation: WebGLUniformLocation;
  private readonly aspectLocation: WebGLUniformLocation;
  private readonly rotationLocation: WebGLUniformLocation;
  private readonly textureLocation: WebGLUniformLocation;
  private readonly missingTexture: WebGLTexture;
  private surfaces: PreviewSurface[] = [];
  private textures = new Map<string, WebGLTexture>();
  private loading = new Set<string>();
  private center: [number, number, number] = [0, 0, 0];
  private baseScale = 1;
  private yaw = -0.65;
  private pitch = 0.38;
  private zoom = 1;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly textureManager: TextureManager | null) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is unavailable for model preview');
    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.centerLocation = gl.getUniformLocation(this.program, 'uCenter')!;
    this.scaleLocation = gl.getUniformLocation(this.program, 'uScale')!;
    this.aspectLocation = gl.getUniformLocation(this.program, 'uAspectScale')!;
    this.rotationLocation = gl.getUniformLocation(this.program, 'uRotation')!;
    this.textureLocation = gl.getUniformLocation(this.program, 'uTexture')!;
    this.missingTexture = this.createCheckerboard();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.08, 0.08, 0.08, 1);
  }

  setModel(resolved: ResolvedModel | null): void {
    this.clearSurfaces();
    if (!resolved) {
      this.render();
      return;
    }
    const frameBounds = resolved.model.frames[resolved.frame] ?? resolved.model.frames[0];
    this.center = [
      (frameBounds.mins[0] + frameBounds.maxs[0]) / 2,
      (frameBounds.mins[1] + frameBounds.maxs[1]) / 2,
      (frameBounds.mins[2] + frameBounds.maxs[2]) / 2,
    ];
    const extent = Math.max(...frameBounds.maxs.map((value, axis) => value - frameBounds.mins[axis]), 1);
    this.baseScale = 1.5 / extent;

    for (const surface of resolved.model.surfaces) {
      const frame = surface.frames[resolved.frame] ?? surface.frames[0] ?? [];
      const vertices: number[] = [];
      for (const triangle of surface.triangles) {
        for (const index of triangle) {
          const vertex = frame[index];
          if (!vertex) continue;
          const uv = surface.uvs[index] ?? [0, 0];
          vertices.push(...vertex.position, ...vertex.normal, uv[0], uv[1]);
        }
      }
      if (vertices.length === 0) continue;
      const buffer = createSolidBuffer(this.gl);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer.vbo);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);
      this.surfaces.push({
        ...buffer,
        count: vertices.length / 8,
        textureName: resolved.surfaceTextures.get(surface.name.toLowerCase()) ?? surface.shaders[0] ?? '',
      });
    }
    this.render();
  }

  rotate(deltaX: number, deltaY: number): void {
    this.yaw += deltaX * 0.012;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + deltaY * 0.012));
    this.render();
  }

  zoomBy(delta: number): void {
    this.zoom = Math.max(0.45, Math.min(3, this.zoom * Math.exp(-delta * 0.001)));
    this.render();
  }

  resetView(): void {
    this.yaw = -0.65;
    this.pitch = 0.38;
    this.zoom = 1;
    this.render();
  }

  render(): void {
    if (this.disposed) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.surfaces.length === 0) return;
    gl.useProgram(this.program);
    gl.uniform3f(this.centerLocation, ...this.center);
    gl.uniform1f(this.scaleLocation, this.baseScale * this.zoom);
    gl.uniform1f(this.aspectLocation, height / width);
    gl.uniform2f(this.rotationLocation, this.yaw, this.pitch);
    gl.uniform1i(this.textureLocation, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const surface of this.surfaces) {
      gl.bindTexture(gl.TEXTURE_2D, this.textureFor(surface.textureName));
      gl.bindVertexArray(surface.vao);
      gl.drawArrays(gl.TRIANGLES, 0, surface.count);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearSurfaces();
    for (const texture of new Set(this.textures.values())) {
      if (texture !== this.missingTexture) this.gl.deleteTexture(texture);
    }
    this.gl.deleteTexture(this.missingTexture);
    this.gl.deleteProgram(this.program);
    this.textures.clear();
  }

  private clearSurfaces(): void {
    for (const surface of this.surfaces) {
      this.gl.deleteVertexArray(surface.vao);
      this.gl.deleteBuffer(surface.vbo);
    }
    this.surfaces = [];
  }

  private textureFor(name: string): WebGLTexture {
    const key = name.toLowerCase().replace(/\\/g, '/');
    const cached = this.textures.get(key);
    if (cached) return cached;
    if (!this.loading.has(key)) {
      this.loading.add(key);
      void this.loadTexture(key).finally(() => this.loading.delete(key));
    }
    return this.missingTexture;
  }

  private async loadTexture(key: string): Promise<void> {
    const source = this.textureManager?.findImageFile(key);
    if (!source) {
      this.textures.set(key, this.missingTexture);
      return;
    }
    const [path, data] = source;
    let texture: WebGLTexture | null = null;
    if (path.endsWith('.tga')) {
      const decoded = decodeTGA(data);
      if (decoded) texture = this.uploadPixels(decoded.pixels, decoded.width, decoded.height);
    } else {
      try {
        const bitmap = await createImageBitmap(new Blob([data as BlobPart], { type: imageMimeType(path) }));
        if (!this.disposed) texture = this.uploadBitmap(bitmap);
        bitmap.close();
      } catch { /* retain the checkerboard fallback */ }
    }
    if (this.disposed) {
      if (texture) this.gl.deleteTexture(texture);
      return;
    }
    this.textures.set(key, texture ?? this.missingTexture);
    this.render();
  }

  private uploadBitmap(bitmap: ImageBitmap): WebGLTexture {
    const texture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, bitmap);
    this.configureTexture();
    return texture;
  }

  private uploadPixels(pixels: Uint8Array, width: number, height: number): WebGLTexture {
    const texture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
    this.configureTexture();
    return texture;
  }

  private configureTexture(): void {
    const gl = this.gl;
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  private createCheckerboard(): WebGLTexture {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const bright = ((x >> 3) + (y >> 3)) % 2 === 0;
      pixels[offset] = bright ? 90 : 45;
      pixels[offset + 1] = bright ? 90 : 45;
      pixels[offset + 2] = bright ? 90 : 45;
      pixels[offset + 3] = 255;
    }
    return this.uploadPixels(pixels, size, size);
  }
}
