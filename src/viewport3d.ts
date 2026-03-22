import {
  Vec3, vec3, vec3Add, vec3Sub, vec3Scale, vec3Cross, vec3Dot,
  vec3Normalize, vec3Length, vec3Copy, vec3Snap,
  Mat4, mat4Perspective, mat4LookAt, mat4Multiply, mat4Identity,
  rayTriangleIntersect,
} from './math';
import { Editor } from './editor';
import { Brush, BrushFace, computeFaceUV, scaleBrushFaces, computeBrushGeometry } from './brush';
import { Entity, entityOrigin } from './entity';
import { TextureManager, TextureInfo } from './textures';

// ── Shaders ──

const VERT_SRC = `#version 300 es
precision mediump float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uPV;
out vec3 vNormal;
out vec2 vUV;
out vec3 vWorldPos;
void main() {
  vNormal = aNormal;
  vUV = aUV;
  vWorldPos = aPos;
  gl_Position = uPV * vec4(aPos, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec2 vUV;
in vec3 vWorldPos;
uniform sampler2D uTexture;
uniform float uSelected;
uniform float uFaceSelected;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.3, 0.5, 0.7));
  float diff = abs(dot(n, lightDir)) * 0.5 + 0.45;

  vec4 texColor = texture(uTexture, vUV);
  vec3 color = texColor.rgb * diff;

  // Orange tint for selected brushes
  color = mix(color, vec3(1.0, 0.6, 0.2), uSelected * 0.25);
  // Cyan tint for selected face
  color = mix(color, vec3(0.2, 0.7, 1.0), uFaceSelected * 0.35);

  fragColor = vec4(color, 1.0);
}
`;

const LINE_VERT_SRC = `#version 300 es
precision mediump float;
layout(location=0) in vec3 aPos;
uniform mat4 uPV;
void main() {
  gl_Position = uPV * vec4(aPos, 1.0);
}
`;

const LINE_FRAG_SRC = `#version 300 es
precision mediump float;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(uColor, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
  }
  return prog;
}

// ── Texture draw group ──

interface DrawGroup {
  textureName: string;
  start: number;
  count: number;
  selected: boolean;
  faceSelected: boolean;
}

export class Viewport3D {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  editor: Editor;
  textureManager: TextureManager | null = null;

  // Camera
  position: Vec3 = [80, 80, 120];
  yaw = Math.PI * 0.25;
  pitch = -0.2;
  moveSpeed = 200;

  // GL resources
  private solidProg!: WebGLProgram;
  private solidPVLoc!: WebGLUniformLocation;
  private solidTexLoc!: WebGLUniformLocation;
  private solidSelLoc!: WebGLUniformLocation;
  private solidFaceSelLoc!: WebGLUniformLocation;
  private lineProg!: WebGLProgram;
  private linePVLoc!: WebGLUniformLocation;
  private lineColorLoc!: WebGLUniformLocation;

  private solidVAO!: WebGLVertexArrayObject;
  private solidVBO!: WebGLBuffer;
  private drawGroups: DrawGroup[] = [];

  private lineVAO!: WebGLVertexArrayObject;
  private lineVBO!: WebGLBuffer;
  private lineCount = 0;

  private wireVAO!: WebGLVertexArrayObject;
  private wireVBO!: WebGLBuffer;
  private wireCount = 0;

  private faceSelVAO!: WebGLVertexArrayObject;
  private faceSelVBO!: WebGLBuffer;
  private faceSelCount = 0;

  private gridVAO!: WebGLVertexArrayObject;
  private gridVBO!: WebGLBuffer;
  private gridCount = 0;

  private gizmoVAO!: WebGLVertexArrayObject;
  private gizmoVBO!: WebGLBuffer;
  private gizmoSegments: { start: number; count: number; color: Vec3 }[] = [];

  // Interaction
  private looking = false;
  private dragStart: [number, number] = [0, 0];
  private didDrag = false;
  private lastMouse: [number, number] = [0, 0];
  private keys = new Set<string>();
  private lastTime = 0;

  // Gizmo drag state
  private gizmoDragging = false;
  private gizmoAxis = -1; // 0=X, 1=Y, 2=Z
  private gizmoCenter: Vec3 = [0, 0, 0];
  private gizmoDragLast: [number, number] = [0, 0];
  private gizmoSnapshotTaken = false;
  private gizmoOrigMins: Vec3 = [0, 0, 0];
  private gizmoOrigMaxs: Vec3 = [0, 0, 0];
  private gizmoOrigPoints: [Vec3, Vec3, Vec3][][] = []; // per brush, per face
  // Cached screen-space axis direction and world-per-pixel at drag start
  private gizmoScreenDir: [number, number] = [0, 0];
  private gizmoScreenDirLen = 0;
  private gizmoWorldPerPixel = 1;
  private lastPV: Mat4 = mat4Identity();

  constructor(canvas: HTMLCanvasElement, editor: Editor) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
    this.editor = editor;
    this.initGL();
    this.buildGrid();
    this.setupEvents();
  }

  private initGL(): void {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.12, 0.12, 0.14, 1);

    this.solidProg = createProgram(gl, VERT_SRC, FRAG_SRC);
    this.solidPVLoc = gl.getUniformLocation(this.solidProg, 'uPV')!;
    this.solidTexLoc = gl.getUniformLocation(this.solidProg, 'uTexture')!;
    this.solidSelLoc = gl.getUniformLocation(this.solidProg, 'uSelected')!;
    this.solidFaceSelLoc = gl.getUniformLocation(this.solidProg, 'uFaceSelected')!;

    this.lineProg = createProgram(gl, LINE_VERT_SRC, LINE_FRAG_SRC);
    this.linePVLoc = gl.getUniformLocation(this.lineProg, 'uPV')!;
    this.lineColorLoc = gl.getUniformLocation(this.lineProg, 'uColor')!;

    // Solid geometry: pos(3) + normal(3) + uv(2) = 8 floats = 32 bytes
    this.solidVAO = gl.createVertexArray()!;
    this.solidVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindVertexArray(null);

    // Line geometry
    this.lineVAO = gl.createVertexArray()!;
    this.lineVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    // Wire geometry
    this.wireVAO = gl.createVertexArray()!;
    this.wireVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.wireVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.wireVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    // Gizmo geometry
    this.gizmoVAO = gl.createVertexArray()!;
    this.gizmoVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.gizmoVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gizmoVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    // Face selection wireframe
    this.faceSelVAO = gl.createVertexArray()!;
    this.faceSelVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.faceSelVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.faceSelVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    // Grid geometry
    this.gridVAO = gl.createVertexArray()!;
    this.gridVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.gridVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
  }

  private buildGrid(): void {
    const gl = this.gl;
    const verts: number[] = [];
    const size = 2048;
    const step = 64;
    for (let x = -size; x <= size; x += step) {
      verts.push(x, -size, 0, x, size, 0);
    }
    for (let y = -size; y <= size; y += step) {
      verts.push(-size, y, 0, size, y, 0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    this.gridCount = verts.length / 3;
  }

  private buildGeometry(): void {
    const gl = this.gl;
    const tm = this.textureManager;

    // Collect faces grouped by texture, sorted so selected faces draw last
    const facesByTex = new Map<string, { verts: number[]; selected: boolean; faceSelected: boolean }[]>();

    const addFace = (face: BrushFace, selected: boolean, faceSelected: boolean) => {
      if (face.polygon.length < 3) return;
      const suffix = faceSelected ? '|fsel' : selected ? '|sel' : '';
      const key = face.texture.toLowerCase() + suffix;
      let group = facesByTex.get(key);
      if (!group) {
        group = [];
        facesByTex.set(key, group);
      }

      const n = face.plane.normal;
      // Get texture dimensions for UV computation
      const texInfo = tm?.getIfLoaded(face.texture);
      const tw = texInfo?.width ?? 64;
      const th = texInfo?.height ?? 64;

      const verts: number[] = [];
      for (let i = 1; i < face.polygon.length - 1; i++) {
        const tri = [face.polygon[0], face.polygon[i], face.polygon[i + 1]];
        for (const v of tri) {
          const [u, uv] = computeFaceUV(v, face, tw, th);
          verts.push(v[0], v[1], v[2], n[0], n[1], n[2], u, uv);
        }
      }
      group.push({ verts, selected, faceSelected });
    };

    for (const { entity, brush } of this.editor.allBrushes()) {
      const brushSelected = this.editor.isSelected(brush);
      for (const face of brush.faces) {
        const fsel = this.editor.isFaceSelected(face);
        addFace(face, brushSelected, fsel);
      }
    }

    // Build entity marker geometry as a special "__entity" group
    const entityVerts: number[] = [];
    for (const entity of this.editor.pointEntities()) {
      const origin = entityOrigin(entity);
      if (!origin) continue;
      const s = 8;
      const top: Vec3    = [origin[0], origin[1], origin[2] + s];
      const bottom: Vec3 = [origin[0], origin[1], origin[2] - s];
      const front: Vec3  = [origin[0], origin[1] + s, origin[2]];
      const back: Vec3   = [origin[0], origin[1] - s, origin[2]];
      const right: Vec3  = [origin[0] + s, origin[1], origin[2]];
      const left: Vec3   = [origin[0] - s, origin[1], origin[2]];

      const tris: [Vec3, Vec3, Vec3, Vec3][] = [
        [top, front, right, [0.33, 0.33, 0.57]],
        [top, right, back, [0.33, -0.33, 0.57]],
        [top, back, left, [-0.33, -0.33, 0.57]],
        [top, left, front, [-0.33, 0.33, 0.57]],
        [bottom, right, front, [0.33, 0.33, -0.57]],
        [bottom, back, right, [0.33, -0.33, -0.57]],
        [bottom, left, back, [-0.33, -0.33, -0.57]],
        [bottom, front, left, [-0.33, 0.33, -0.57]],
      ];
      for (const [v0, v1, v2, n] of tris) {
        for (const v of [v0, v1, v2]) {
          entityVerts.push(v[0], v[1], v[2], n[0], n[1], n[2], 0, 0);
        }
      }
    }

    // Flatten into single VBO, tracking draw groups
    const allVerts: number[] = [];
    this.drawGroups = [];

    for (const [key, groups] of facesByTex) {
      const texName = key.replace(/\|(sel|fsel)$/, '');
      const selected = key.endsWith('|sel');
      const faceSelected = key.endsWith('|fsel');
      const start = allVerts.length / 8;
      for (const g of groups) {
        for (const v of g.verts) allVerts.push(v);
      }
      const count = allVerts.length / 8 - start;
      if (count > 0) {
        this.drawGroups.push({ textureName: texName, start, count, selected, faceSelected });
      }
    }

    // Entity markers
    if (entityVerts.length > 0) {
      const start = allVerts.length / 8;
      for (const v of entityVerts) allVerts.push(v);
      const count = entityVerts.length / 8;
      this.drawGroups.push({ textureName: '__entity', start, count, selected: false, faceSelected: false });
    }

    // Upload solid VBO
    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(allVerts), gl.DYNAMIC_DRAW);

    // Build wireframe lines
    const selLineVerts: number[] = [];
    const wireVerts: number[] = [];
    const faceSelLineVerts: number[] = [];

    for (const { entity, brush } of this.editor.allBrushes()) {
      const brushSelected = this.editor.isSelected(brush);
      for (const face of brush.faces) {
        if (face.polygon.length < 3) continue;
        const fsel = this.editor.isFaceSelected(face);
        for (let i = 0; i < face.polygon.length; i++) {
          const a = face.polygon[i];
          const b = face.polygon[(i + 1) % face.polygon.length];
          if (fsel) {
            faceSelLineVerts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
          } else if (brushSelected) {
            selLineVerts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
          } else {
            wireVerts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
          }
        }
      }
    }

    // Entity selection wireframe
    for (const entity of this.editor.pointEntities()) {
      if (!this.editor.isEntitySelected(entity)) continue;
      const origin = entityOrigin(entity);
      if (!origin) continue;
      const s = 8;
      const pts: Vec3[] = [
        [origin[0], origin[1], origin[2]+s],
        [origin[0], origin[1]+s, origin[2]],
        [origin[0]+s, origin[1], origin[2]],
        [origin[0], origin[1]-s, origin[2]],
        [origin[0]-s, origin[1], origin[2]],
        [origin[0], origin[1], origin[2]-s],
      ];
      const edges = [[0,1],[0,2],[0,3],[0,4],[5,1],[5,2],[5,3],[5,4],[1,2],[2,3],[3,4],[4,1]];
      for (const [a, b] of edges) {
        selLineVerts.push(pts[a][0], pts[a][1], pts[a][2], pts[b][0], pts[b][1], pts[b][2]);
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(selLineVerts), gl.DYNAMIC_DRAW);
    this.lineCount = selLineVerts.length / 3;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.wireVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wireVerts), gl.DYNAMIC_DRAW);
    this.wireCount = wireVerts.length / 3;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.faceSelVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(faceSelLineVerts), gl.DYNAMIC_DRAW);
    this.faceSelCount = faceSelLineVerts.length / 3;
  }

  private buildGizmo(): void {
    const gl = this.gl;
    const center = this.editor.selectionCenter();
    this.gizmoSegments = [];

    if (!center) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gizmoVBO);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
      return;
    }

    // Don't update center during an active drag — it must stay fixed
    if (!this.gizmoDragging) {
      this.gizmoCenter = center;
    }

    // Gizmo length scales with distance from camera for consistent screen size
    const dist = vec3Length(vec3Sub(center, this.position));
    const len = dist * 0.12;
    const tipSize = len * 0.15;

    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const colors: Vec3[] = [[1, 0.2, 0.2], [0.2, 1, 0.2], [0.4, 0.4, 1]];
    const isScale = this.editor.gizmoMode === 'scale';
    const verts: number[] = [];

    for (let a = 0; a < 3; a++) {
      const dir = axes[a];
      const tip: Vec3 = vec3Add(center, vec3Scale(dir, len));
      const start = verts.length / 3;

      // Main axis line
      verts.push(center[0], center[1], center[2]);
      verts.push(tip[0], tip[1], tip[2]);

      if (isScale) {
        // Small cube at tip (3 line pairs for a box outline)
        const s = tipSize;
        for (let i = 0; i < 3; i++) {
          const d: Vec3 = [0, 0, 0];
          d[i] = s;
          verts.push(tip[0] - d[0], tip[1] - d[1], tip[2] - d[2]);
          verts.push(tip[0] + d[0], tip[1] + d[1], tip[2] + d[2]);
        }
      } else {
        // Arrowhead: two short lines from tip angled back
        const perp1 = axes[(a + 1) % 3];
        const perp2 = axes[(a + 2) % 3];
        const back = vec3Add(tip, vec3Scale(dir, -tipSize * 2));
        for (const p of [perp1, vec3Scale(perp1, -1) as Vec3, perp2, vec3Scale(perp2, -1) as Vec3]) {
          const wing = vec3Add(back, vec3Scale(p, tipSize));
          verts.push(tip[0], tip[1], tip[2]);
          verts.push(wing[0], wing[1], wing[2]);
        }
      }

      const count = verts.length / 3 - start;
      this.gizmoSegments.push({ start, count, color: colors[a] });
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.gizmoVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
  }

  render(time: number): void {
    const dt = this.lastTime ? (time - this.lastTime) / 1000 : 0;
    this.lastTime = time;

    this.updateCamera(dt);
    this.buildGeometry();
    this.buildGizmo();

    const { gl, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height || 1;
    const proj = mat4Perspective(Math.PI / 3, aspect, 1, 16384);
    const forward = this.getForward();
    const target = vec3Add(this.position, forward);
    const view = mat4LookAt(this.position, target, [0, 0, 1]);
    const pv = mat4Multiply(proj, view);
    this.lastPV = pv;

    // Draw grid
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(this.linePVLoc, false, pv);
    gl.uniform3f(this.lineColorLoc, 0.2, 0.2, 0.22);
    gl.bindVertexArray(this.gridVAO);
    gl.drawArrays(gl.LINES, 0, this.gridCount);

    // Draw textured geometry by group
    if (this.drawGroups.length > 0) {
      gl.useProgram(this.solidProg);
      gl.uniformMatrix4fv(this.solidPVLoc, false, pv);
      gl.uniform1i(this.solidTexLoc, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(this.solidVAO);

      for (const group of this.drawGroups) {
        // Bind texture
        const tm = this.textureManager;
        if (tm && group.textureName !== '__entity') {
          const texInfo = tm.get(group.textureName);
          gl.bindTexture(gl.TEXTURE_2D, texInfo.glTexture);
        } else {
          // Entity markers — use a green-ish solid color
          // We'll just bind a white texture; the shader lighting gives color
          const tm2 = this.textureManager;
          if (tm2) {
            gl.bindTexture(gl.TEXTURE_2D, tm2.get('__entity_green').glTexture);
          }
        }

        gl.uniform1f(this.solidSelLoc, group.selected ? 1.0 : 0.0);
        gl.uniform1f(this.solidFaceSelLoc, group.faceSelected ? 1.0 : 0.0);
        gl.drawArrays(gl.TRIANGLES, group.start, group.count);
      }
    }

    // Draw unselected wireframe
    if (this.wireCount > 0) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(this.linePVLoc, false, pv);
      gl.uniform3f(this.lineColorLoc, 0.0, 0.0, 0.0);
      gl.bindVertexArray(this.wireVAO);
      gl.drawArrays(gl.LINES, 0, this.wireCount);
    }

    // Draw selected wireframe overlay (no depth test)
    if (this.lineCount > 0) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(this.linePVLoc, false, pv);
      gl.uniform3f(this.lineColorLoc, 1.0, 0.5, 0.0);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(this.lineVAO);
      gl.drawArrays(gl.LINES, 0, this.lineCount);
      gl.enable(gl.DEPTH_TEST);
    }

    // Draw face-selected wireframe overlay (cyan, no depth test)
    if (this.faceSelCount > 0) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(this.linePVLoc, false, pv);
      gl.uniform3f(this.lineColorLoc, 0.2, 0.8, 1.0);
      gl.disable(gl.DEPTH_TEST);
      gl.lineWidth(2);
      gl.bindVertexArray(this.faceSelVAO);
      gl.drawArrays(gl.LINES, 0, this.faceSelCount);
      gl.lineWidth(1);
      gl.enable(gl.DEPTH_TEST);
    }

    // Draw gizmo (on top of everything)
    if (this.gizmoSegments.length > 0) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(this.linePVLoc, false, pv);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(this.gizmoVAO);
      for (const seg of this.gizmoSegments) {
        const c = seg.color;
        // Highlight the active drag axis
        const bright = this.gizmoDragging && this.gizmoAxis === this.gizmoSegments.indexOf(seg) ? 1.5 : 1.0;
        gl.uniform3f(this.lineColorLoc, c[0] * bright, c[1] * bright, c[2] * bright);
        gl.drawArrays(gl.LINES, seg.start, seg.count);
      }
      gl.enable(gl.DEPTH_TEST);
    }

    gl.bindVertexArray(null);
  }

  private getForward(): Vec3 {
    return [
      Math.cos(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
    ];
  }

  private getRight(): Vec3 {
    return [
      Math.cos(this.yaw - Math.PI / 2),
      Math.sin(this.yaw - Math.PI / 2),
      0,
    ];
  }

  private updateCamera(dt: number): void {
    if (!this.looking && this.keys.size === 0) return;

    const speed = this.moveSpeed * dt;
    const forward = this.getForward();
    const right = this.getRight();

    if (this.keys.has('w')) this.position = vec3Add(this.position, vec3Scale(forward, speed));
    if (this.keys.has('s')) this.position = vec3Add(this.position, vec3Scale(forward, -speed));
    if (this.keys.has('d')) this.position = vec3Add(this.position, vec3Scale(right, speed));
    if (this.keys.has('a')) this.position = vec3Add(this.position, vec3Scale(right, -speed));
    if (this.keys.has('q') || this.keys.has(' ')) this.position[2] += speed;
    if (this.keys.has('e') || this.keys.has('shift')) this.position[2] -= speed;

    this.editor.dirty = true;
  }

  // ── Ray picking in 3D ──

  pickBrushAt(screenX: number, screenY: number): { entity: Entity; brush: Brush; face: BrushFace } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = (screenX - rect.left) / rect.width * 2 - 1;
    const y = 1 - (screenY - rect.top) / rect.height * 2;

    const aspect = rect.width / rect.height || 1;
    const fovY = Math.PI / 3;
    const tanHalf = Math.tan(fovY / 2);

    const forward = this.getForward();
    const right = vec3Normalize(vec3Cross(forward, [0, 0, 1]));
    const up = vec3Cross(right, forward);

    const dir = vec3Normalize(vec3Add(
      vec3Add(forward, vec3Scale(right, x * tanHalf * aspect)),
      vec3Scale(up, y * tanHalf)
    ));

    let bestDist = Infinity;
    let bestHit: { entity: Entity; brush: Brush; face: BrushFace } | null = null;

    for (const { entity, brush } of this.editor.allBrushes()) {
      for (const face of brush.faces) {
        if (face.polygon.length < 3) continue;
        for (let i = 1; i < face.polygon.length - 1; i++) {
          const t = rayTriangleIntersect(
            this.position, dir,
            face.polygon[0], face.polygon[i], face.polygon[i + 1]
          );
          if (t !== null && t < bestDist) {
            bestDist = t;
            bestHit = { entity, brush, face };
          }
        }
      }
    }

    return bestHit;
  }

  // ── Gizmo hit testing ──

  private worldToScreen(p: Vec3): [number, number] | null {
    const pv = this.lastPV;
    // Transform by PV matrix
    const x = pv[0]*p[0] + pv[4]*p[1] + pv[8]*p[2] + pv[12];
    const y = pv[1]*p[0] + pv[5]*p[1] + pv[9]*p[2] + pv[13];
    const w = pv[3]*p[0] + pv[7]*p[1] + pv[11]*p[2] + pv[15];
    if (w < 0.01) return null; // behind camera
    const rect = this.canvas.getBoundingClientRect();
    return [
      (x / w * 0.5 + 0.5) * rect.width + rect.left,
      (-y / w * 0.5 + 0.5) * rect.height + rect.top,
    ];
  }

  private pickGizmoAxis(screenX: number, screenY: number): number {
    const center = this.gizmoCenter;
    const dist = vec3Length(vec3Sub(center, this.position));
    const len = dist * 0.12;
    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const threshold = 10; // pixels

    const cScreen = this.worldToScreen(center);
    if (!cScreen) return -1;

    let bestAxis = -1;
    let bestDist = threshold;

    for (let a = 0; a < 3; a++) {
      const tip = vec3Add(center, vec3Scale(axes[a], len));
      const tScreen = this.worldToScreen(tip);
      if (!tScreen) continue;

      // Distance from point to line segment (center → tip) in screen space
      const d = this.pointToSegmentDist(screenX, screenY, cScreen[0], cScreen[1], tScreen[0], tScreen[1]);
      if (d < bestDist) {
        bestDist = d;
        bestAxis = a;
      }
    }
    return bestAxis;
  }

  private pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.01) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  }

  // ── Input ──

  private handleGizmoDrag(e: MouseEvent): void {
    if (!this.gizmoSnapshotTaken) {
      this.editor.snapshot();
      this.gizmoSnapshotTaken = true;
    }

    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const axis = axes[this.gizmoAxis];

    // Use cached screen direction and worldPerPixel from drag start
    const screenDirX = this.gizmoScreenDir[0];
    const screenDirY = this.gizmoScreenDir[1];
    const screenDirLen = this.gizmoScreenDirLen;
    if (screenDirLen < 0.1) return;

    // Mouse delta projected onto axis screen direction
    const mdx = e.clientX - this.gizmoDragLast[0];
    const mdy = e.clientY - this.gizmoDragLast[1];
    const projected = (mdx * screenDirX + mdy * screenDirY) / screenDirLen;

    const worldDelta = projected * this.gizmoWorldPerPixel;

    if (this.editor.gizmoMode === 'move') {
      // Move selection along axis
      const grid = this.editor.effectiveGrid(e.ctrlKey);
      const snapped = Math.round(worldDelta / grid) * grid;
      if (snapped !== 0) {
        const delta: Vec3 = vec3Scale(axis, snapped);
        this.editor.moveSelection(delta);
        this.gizmoCenter = vec3Add(this.gizmoCenter, delta);
        this.gizmoDragLast = [e.clientX, e.clientY];
      }
    } else {
      // Scale along axis from selection center
      const a = this.gizmoAxis;
      const origExtent = (this.gizmoOrigMaxs[a] - this.gizmoOrigMins[a]) / 2;
      if (Math.abs(origExtent) < 0.01) return;

      const totalDx = e.clientX - this.gizmoDragLast[0];
      const totalDy = e.clientY - this.gizmoDragLast[1];
      const totalProjected = (totalDx * screenDirX + totalDy * screenDirY) / screenDirLen;
      const totalWorld = totalProjected * this.gizmoWorldPerPixel;

      // Snap the new extent to grid
      const grid = this.editor.effectiveGrid(e.ctrlKey);
      let newExtent = origExtent + totalWorld;
      newExtent = Math.round(newExtent / grid) * grid;
      if (Math.abs(newExtent) < grid) newExtent = newExtent >= 0 ? grid : -grid;
      const scaleFactor = newExtent / origExtent;
      if (scaleFactor < 0.1) return;

      const scale: Vec3 = [1, 1, 1];
      scale[a] = scaleFactor;
      const origin: Vec3 = vec3Copy(this.gizmoCenter);

      let idx = 0;
      for (const item of this.editor.selection) {
        if (item.type === 'entity') { idx++; continue; }
        const origPts = this.gizmoOrigPoints[idx];
        if (origPts.length > 0) {
          scaleBrushFaces(item.brush, origPts, origin, scale);
        }
        idx++;
      }
      this.editor.dirty = true;
    }
  }

  private setupEvents(): void {
    const el = this.canvas.parentElement!;

    el.addEventListener('mousedown', (e) => {
      // Left click: check gizmo first
      if (e.button === 0 && this.editor.selection.length > 0) {
        const axis = this.pickGizmoAxis(e.clientX, e.clientY);
        if (axis >= 0) {
          this.gizmoDragging = true;
          this.gizmoAxis = axis;
          this.gizmoDragLast = [e.clientX, e.clientY];
          this.gizmoSnapshotTaken = false;
          // Cache screen direction and worldPerPixel at drag start
          {
            const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
            const cScreen = this.worldToScreen(this.gizmoCenter);
            const tipWorld = vec3Add(this.gizmoCenter, vec3Scale(axes[axis], 100));
            const tScreen = this.worldToScreen(tipWorld);
            if (cScreen && tScreen) {
              this.gizmoScreenDir = [tScreen[0] - cScreen[0], tScreen[1] - cScreen[1]];
              this.gizmoScreenDirLen = Math.sqrt(this.gizmoScreenDir[0] ** 2 + this.gizmoScreenDir[1] ** 2);
            }
            const dist = vec3Length(vec3Sub(this.gizmoCenter, this.position));
            const rect = this.canvas.getBoundingClientRect();
            this.gizmoWorldPerPixel = (2 * dist * Math.tan(Math.PI / 6)) / rect.height;
          }
          // Store original state for scale mode
          if (this.editor.gizmoMode === 'scale') {
            const center = this.editor.selectionCenter();
            if (center) this.gizmoCenter = center;
            this.gizmoOrigPoints = [];
            let mins: Vec3 = [Infinity, Infinity, Infinity];
            let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
            for (const item of this.editor.selection) {
              if (item.type === 'entity') { this.gizmoOrigPoints.push([]); continue; }
              this.gizmoOrigPoints.push(
                item.brush.faces.map(f =>
                  [vec3Copy(f.points[0]), vec3Copy(f.points[1]), vec3Copy(f.points[2])] as [Vec3, Vec3, Vec3]
                )
              );
              for (let i = 0; i < 3; i++) {
                if (item.brush.mins[i] < mins[i]) mins[i] = item.brush.mins[i];
                if (item.brush.maxs[i] > maxs[i]) maxs[i] = item.brush.maxs[i];
              }
            }
            this.gizmoOrigMins = mins;
            this.gizmoOrigMaxs = maxs;
          }
          e.preventDefault();
          return;
        }
      }
      if (e.button === 0 || e.button === 2) {
        this.looking = true;
        this.didDrag = false;
        this.dragStart = [e.clientX, e.clientY];
        this.lastMouse = [e.clientX, e.clientY];
        el.requestPointerLock();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (this.gizmoDragging) {
        this.handleGizmoDrag(e);
        return;
      }
      if (!this.looking) return;
      const dx = e.movementX;
      const dy = e.movementY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        this.didDrag = true;
      }
      const sensitivity = 0.003;
      this.yaw -= dx * sensitivity;
      this.pitch = Math.max(-Math.PI * 0.49, Math.min(Math.PI * 0.49,
        this.pitch - dy * sensitivity
      ));
      this.editor.dirty = true;
    });

    document.addEventListener('mouseup', (e) => {
      if (this.gizmoDragging && e.button === 0) {
        this.gizmoDragging = false;
        this.gizmoAxis = -1;
        this.editor.dirty = true;
        return;
      }
      if ((e.button === 0 || e.button === 2) && this.looking) {
        this.looking = false;
        this.keys.clear();
        document.exitPointerLock();
        if (!this.didDrag && e.button === 0) {
          const hit = this.pickBrushAt(this.dragStart[0], this.dragStart[1]);
          if (hit) {
            if (e.altKey) {
              // Alt+click: select individual face, Shift+Alt: additive face select
              const additive = e.shiftKey;
              this.editor.selectFace(hit.entity, hit.brush, hit.face, additive);
            } else {
              const additive = e.ctrlKey || e.metaKey || e.shiftKey;
              if (!additive) this.editor.clearSelection();
              this.editor.selectBrush(hit.entity, hit.brush, additive);
            }
          } else {
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey) this.editor.clearSelection();
          }
        }
      }
    });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const forward = this.getForward();
        this.position = vec3Add(this.position, vec3Scale(forward, -e.deltaY * 0.5));
      } else if (e.shiftKey) {
        this.position[2] -= e.deltaY * 0.5;
      } else {
        const forward = this.getForward();
        const right = this.getRight();
        this.position = vec3Add(this.position, vec3Scale(forward, -e.deltaY * 0.5));
        this.position = vec3Add(this.position, vec3Scale(right, e.deltaX * 0.5));
      }
      this.editor.dirty = true;
    }, { passive: false });

    el.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('keydown', (e) => {
      if (this.looking) {
        this.keys.add(e.key.toLowerCase());
        e.preventDefault();
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
  }
}
