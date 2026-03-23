import {
  Vec3, vec3Add, vec3Sub, vec3Scale, vec3Cross, vec3Dot,
  vec3Normalize, vec3Length,
  Mat4, mat4Perspective, mat4LookAt, mat4Multiply, mat4Identity,
  rayTriangleIntersect,
} from './math';
import { Editor } from './editor';
import { Brush, BrushFace, computeFaceUV } from './brush';
import { Entity, entityOrigin } from './entity';
import { pickVertex3D } from './vertex';
import { TextureManager, TextureInfo } from './textures';
import {
  VERT_SRC, FRAG_SRC, LINE_VERT_SRC, LINE_FRAG_SRC,
  createProgram, createLineBuffer, createSolidBuffer,
} from './gl-utils';
import { Gizmo } from './gizmo';

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

  private vtxHandleVAO!: WebGLVertexArrayObject;
  private vtxHandleVBO!: WebGLBuffer;
  private vtxHandleCount = 0;
  private vtxHandleSelVAO!: WebGLVertexArrayObject;
  private vtxHandleSelVBO!: WebGLBuffer;
  private vtxHandleSelCount = 0;

  private gridVAO!: WebGLVertexArrayObject;
  private gridVBO!: WebGLBuffer;
  private gridCount = 0;

  // Gizmo
  private gizmo!: Gizmo;

  // Interaction
  private looking = false;
  private dragStart: [number, number] = [0, 0];
  private didDrag = false;
  private lastMouse: [number, number] = [0, 0];
  private keys = new Set<string>();
  private lastTime = 0;
  private lastPV: Mat4 = mat4Identity();

  constructor(canvas: HTMLCanvasElement, editor: Editor) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
    this.editor = editor;
    this.initGL();
    this.gizmo = new Gizmo(this.gl, editor);
    this.buildGrid();
    this.setupEvents();
    this.editor.onCenterOnSelection(() => this.centerOnSelection());
  }

  centerOnSelection(): void {
    const bounds = this.editor.selectionBounds();
    if (!bounds) return;
    const center: Vec3 = [
      (bounds.mins[0] + bounds.maxs[0]) / 2,
      (bounds.mins[1] + bounds.maxs[1]) / 2,
      (bounds.mins[2] + bounds.maxs[2]) / 2,
    ];
    const size = vec3Length(vec3Sub(bounds.maxs, bounds.mins));
    const dist = Math.max(size * 1.5, 128);
    const forward = this.getForward();
    this.position = vec3Sub(center, vec3Scale(forward, dist));
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

    const solid = createSolidBuffer(gl);
    this.solidVAO = solid.vao; this.solidVBO = solid.vbo;

    const line = createLineBuffer(gl);
    this.lineVAO = line.vao; this.lineVBO = line.vbo;
    const wire = createLineBuffer(gl);
    this.wireVAO = wire.vao; this.wireVBO = wire.vbo;
    const faceSel = createLineBuffer(gl);
    this.faceSelVAO = faceSel.vao; this.faceSelVBO = faceSel.vbo;
    const vtxH = createLineBuffer(gl);
    this.vtxHandleVAO = vtxH.vao; this.vtxHandleVBO = vtxH.vbo;
    const vtxHS = createLineBuffer(gl);
    this.vtxHandleSelVAO = vtxHS.vao; this.vtxHandleSelVBO = vtxHS.vbo;
    const grid = createLineBuffer(gl);
    this.gridVAO = grid.vao; this.gridVBO = grid.vbo;
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
    const tm = this.editor.textureManager;

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
      if (!this.editor.isBrushVisible(brush)) continue;
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
      if (!this.editor.isBrushVisible(brush)) continue;
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

    // Build vertex handle geometry (small 3D crosses)
    const vtxVerts: number[] = [];
    const vtxSelVerts: number[] = [];
    if (this.editor.vertexMode) {
      const s = 4; // cross half-size in world units
      for (let di = 0; di < this.editor.vertexData.length; di++) {
        const data = this.editor.vertexData[di];
        for (let vi = 0; vi < data.vertices.length; vi++) {
          const p = data.vertices[vi].position;
          const arr = this.editor.isVertexSelected(di, vi) ? vtxSelVerts : vtxVerts;
          // 3 axis-aligned line segments forming a cross
          arr.push(p[0]-s, p[1], p[2], p[0]+s, p[1], p[2]);
          arr.push(p[0], p[1]-s, p[2], p[0], p[1]+s, p[2]);
          arr.push(p[0], p[1], p[2]-s, p[0], p[1], p[2]+s);
        }
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxHandleVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vtxVerts), gl.DYNAMIC_DRAW);
    this.vtxHandleCount = vtxVerts.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxHandleSelVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vtxSelVerts), gl.DYNAMIC_DRAW);
    this.vtxHandleSelCount = vtxSelVerts.length / 3;
  }

  render(time: number): void {
    const dt = this.lastTime ? (time - this.lastTime) / 1000 : 0;
    this.lastTime = time;

    this.updateCamera(dt);
    if (this.editor.dirty) {
      this.buildGeometry();
    }
    this.gizmo.build(this.position);

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
        const tm = this.editor.textureManager;
        if (tm && group.textureName !== '__entity') {
          const texInfo = tm.get(group.textureName);
          gl.bindTexture(gl.TEXTURE_2D, texInfo.glTexture);
        } else {
          // Entity markers — use a green-ish solid color
          // We'll just bind a white texture; the shader lighting gives color
          const tm2 = this.editor.textureManager;
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

    // Draw vertex handles (no depth test, on top)
    if (this.vtxHandleCount > 0 || this.vtxHandleSelCount > 0) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(this.linePVLoc, false, pv);
      gl.disable(gl.DEPTH_TEST);
      if (this.vtxHandleCount > 0) {
        gl.uniform3f(this.lineColorLoc, 0.2, 0.9, 0.2);
        gl.bindVertexArray(this.vtxHandleVAO);
        gl.drawArrays(gl.LINES, 0, this.vtxHandleCount);
      }
      if (this.vtxHandleSelCount > 0) {
        gl.uniform3f(this.lineColorLoc, 1.0, 1.0, 1.0);
        gl.bindVertexArray(this.vtxHandleSelVAO);
        gl.drawArrays(gl.LINES, 0, this.vtxHandleSelCount);
      }
      gl.enable(gl.DEPTH_TEST);
    }

    // Draw gizmo (on top of everything)
    if (this.gizmo.segments.length > 0) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(this.linePVLoc, false, pv);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(this.gizmo.vao);
      for (const seg of this.gizmo.segments) {
        const c = seg.color;
        const bright = this.gizmo.dragging && this.gizmo.axis === this.gizmo.segments.indexOf(seg) ? 1.5 : 1.0;
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

    const speed = this.moveSpeed * dt * (this.keys.has('control') || this.keys.has('meta') ? 3 : 1);
    const forward = this.getForward();
    const right = this.getRight();

    if (this.keys.has('w')) this.position = vec3Add(this.position, vec3Scale(forward, speed));
    if (this.keys.has('s')) this.position = vec3Add(this.position, vec3Scale(forward, -speed));
    if (this.keys.has('d')) this.position = vec3Add(this.position, vec3Scale(right, speed));
    if (this.keys.has('a')) this.position = vec3Add(this.position, vec3Scale(right, -speed));
    if (this.keys.has('q') || this.keys.has(' ')) this.position[2] += speed;
    if (this.keys.has('e') || this.keys.has('shift') || this.keys.has('c')) this.position[2] -= speed;

    this.editor.dirty = true;
  }

  // ── Ray picking in 3D ──

  private getRay(screenX: number, screenY: number): { rayOrigin: Vec3; rayDir: Vec3 } {
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
    return { rayOrigin: this.position, rayDir: dir };
  }

  pickBrushAt(screenX: number, screenY: number): { entity: Entity; brush: Brush; face: BrushFace } | null {
    const { rayOrigin, rayDir: dir } = this.getRay(screenX, screenY);

    let bestDist = Infinity;
    let bestHit: { entity: Entity; brush: Brush; face: BrushFace } | null = null;

    for (const { entity, brush } of this.editor.allBrushes()) {
      if (!this.editor.isBrushVisible(brush)) continue;
      for (const face of brush.faces) {
        if (face.polygon.length < 3) continue;
        for (let i = 1; i < face.polygon.length - 1; i++) {
          const t = rayTriangleIntersect(
            rayOrigin, dir,
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

  // ── Input ──

  private setupEvents(): void {
    const el = this.canvas.parentElement!;

    el.addEventListener('mousedown', (e) => {
      // Left click: check gizmo first
      if (e.button === 0 && this.editor.selection.length > 0) {
        const rect = this.canvas.getBoundingClientRect();
        const axis = this.gizmo.pickAxis(e.clientX, e.clientY, this.lastPV, rect, this.position);
        if (axis >= 0) {
          this.gizmo.startDrag(axis, e.clientX, e.clientY, this.lastPV, rect, this.position);
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
      if (this.gizmo.dragging) {
        this.gizmo.handleDrag(e);
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
      if (this.gizmo.dragging && e.button === 0) {
        this.gizmo.endDrag();
        return;
      }
      if ((e.button === 0 || e.button === 2) && this.looking) {
        this.looking = false;
        this.keys.clear();
        document.exitPointerLock();
        if (!this.didDrag && e.button === 0) {
          if (this.editor.vertexMode) {
            // Vertex picking in 3D
            const { rayOrigin, rayDir } = this.getRay(this.dragStart[0], this.dragStart[1]);
            const additive = e.ctrlKey || e.metaKey || e.shiftKey;
            let hitDi = -1, hitVi = -1;
            for (let di = 0; di < this.editor.vertexData.length; di++) {
              const vi = pickVertex3D(this.editor.vertexData[di].vertices, rayOrigin, rayDir, 8);
              if (vi >= 0) { hitDi = di; hitVi = vi; break; }
            }
            if (hitDi >= 0) {
              this.editor.selectVertex(hitDi, hitVi, additive);
            } else {
              if (!additive) this.editor.clearVertexSelection();
            }
          } else {
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
