import {
  Vec3, vec3Add, vec3Sub, vec3Scale, vec3Cross, vec3Dot,
  vec3Normalize, vec3Length, vec3Copy,
  Mat4, mat4Perspective, mat4LookAt, mat4Multiply, mat4Identity,
  rayTriangleIntersect,
} from './math';
import { Editor } from './editor';
import { Brush, BrushFace, computeFaceUV } from './brush';
import { Entity, entityOrigin, entityColor, parseLightColor } from './entity';
import { Patch } from './patch';
import { pickVertex3D } from './vertex';
import { TextureManager, TextureInfo, BlendMode } from './textures';
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
  blendMode: BlendMode;
  invisible: boolean;
  solidOverride: boolean; // render as solid color (no texture)
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
  private solidUseAlphaLoc!: WebGLUniformLocation;
  private solidAlphaOverrideLoc!: WebGLUniformLocation;
  private solidSolidOverrideLoc!: WebGLUniformLocation;
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

  private lightRadiusVAO!: WebGLVertexArrayObject;
  private lightRadiusVBO!: WebGLBuffer;
  private lightRadiusDraws: { start: number; count: number; color: [number, number, number] }[] = [];

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

  // Fullscreen walkthrough mode
  private fullscreen = false;
  private fullscreenMode: 'walk' | 'fly' | 'edit' = 'walk';
  private savedCamera: { position: Vec3; yaw: number; pitch: number } | null = null;
  private fullscreenBtn!: HTMLButtonElement;
  private fullscreenOverlay!: HTMLDivElement;
  private hudModeEl!: HTMLSpanElement;

  // Walk physics
  private velocityZ = 0;          // vertical velocity (units/sec)
  private onGround = false;
  private static readonly GRAVITY = -800;       // units/sec²
  private static readonly JUMP_SPEED = 270;     // units/sec
  private static readonly EYE_HEIGHT = 50;      // eye above feet
  private static readonly PLAYER_HALF_W = 14;   // half-width of player AABB
  private static readonly STEP_HEIGHT = 18;     // max step-up height

  constructor(canvas: HTMLCanvasElement, editor: Editor) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
    this.editor = editor;
    this.initGL();
    this.gizmo = new Gizmo(this.gl, editor);
    this.buildGrid();
    this.createFullscreenUI();
    this.setupEvents();
    this.editor.onCenterOnSelection(() => this.centerOnSelection());
  }

  private createFullscreenUI(): void {
    const container = this.canvas.parentElement!;

    // Fullscreen button (top-right corner of 3D viewport)
    this.fullscreenBtn = document.createElement('button');
    this.fullscreenBtn.className = 'vp-fullscreen-btn';
    this.fullscreenBtn.title = 'Fullscreen walkthrough';
    this.fullscreenBtn.innerHTML = '<i class="ph ph-arrows-out"></i>';
    this.fullscreenBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation(); // prevent viewport3d from grabbing pointer lock
    });
    this.fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.enterFullscreen();
    });
    container.appendChild(this.fullscreenBtn);

    // Fullscreen overlay (crosshair + HUD, visible only in fullscreen)
    this.fullscreenOverlay = document.createElement('div');
    this.fullscreenOverlay.className = 'vp-fullscreen-overlay';
    this.fullscreenOverlay.innerHTML = `
      <div class="fullscreen-crosshair"></div>
      <div class="fullscreen-hud">
        <span class="hud-mode">WALK</span>
        <span class="hud-sep"></span>
        <span>WASD move</span>
        <span class="hud-sep"></span>
        <span>V cycle mode</span>
        <span class="hud-sep"></span>
        <span>ESC exit</span>
      </div>
    `;
    this.hudModeEl = this.fullscreenOverlay.querySelector('.hud-mode')!;
    container.appendChild(this.fullscreenOverlay);
  }

  enterFullscreen(): void {
    this.fullscreen = true;
    this.savedCamera = { position: vec3Copy(this.position), yaw: this.yaw, pitch: this.pitch };
    this.setFullscreenMode('walk');
    this.editor.fullscreen3d = true;
    document.getElementById('app')!.classList.add('fullscreen-3d');
    this.fullscreenBtn.style.display = 'none';
    this.canvas.requestPointerLock();
    this.keys.clear();
    this.editor.dirty = true;
  }

  private setFullscreenMode(mode: 'walk' | 'fly' | 'edit'): void {
    this.fullscreenMode = mode;
    this.hudModeEl.textContent = mode.toUpperCase();
    this.velocityZ = 0;
    this.onGround = false;

    if (mode === 'edit') {
      // Release pointer lock so the cursor is visible for clicking
      if (document.pointerLockElement) document.exitPointerLock();
      this.fullscreenOverlay.classList.add('edit-mode');
    } else {
      this.fullscreenOverlay.classList.remove('edit-mode');
      // Re-acquire pointer lock for walk/fly
      if (!document.pointerLockElement) this.canvas.requestPointerLock();
    }
  }

  exitFullscreen(): void {
    if (!this.fullscreen) return;
    // Restore camera if exiting from walk/fly (not edit)
    if (this.fullscreenMode !== 'edit' && this.savedCamera) {
      this.position = this.savedCamera.position;
      this.yaw = this.savedCamera.yaw;
      this.pitch = this.savedCamera.pitch;
    }
    this.savedCamera = null;
    this.fullscreen = false;
    this.editor.fullscreen3d = false;
    this.fullscreenOverlay.classList.remove('edit-mode');
    document.getElementById('app')!.classList.remove('fullscreen-3d');
    this.fullscreenBtn.style.display = '';
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.editor.dirty = true;
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
    this.solidUseAlphaLoc = gl.getUniformLocation(this.solidProg, 'uUseAlpha')!;
    this.solidAlphaOverrideLoc = gl.getUniformLocation(this.solidProg, 'uAlphaOverride')!;
    this.solidSolidOverrideLoc = gl.getUniformLocation(this.solidProg, 'uSolidOverride')!;

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
    const lr = createLineBuffer(gl);
    this.lightRadiusVAO = lr.vao; this.lightRadiusVBO = lr.vbo;
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
        // In 'hide' mode, skip invisible faces on mixed brushes (unless selected)
        if (this.editor.invisibleMode === 'hide' && !fsel && !brushSelected &&
            Editor.INVISIBLE_TEXTURES.has(face.texture.toLowerCase())) continue;
        addFace(face, brushSelected, fsel);
      }
    }

    // Patch tessellation triangles — same VBO format as brush faces
    for (const { entity, patch } of this.editor.allPatches()) {
      if (!this.editor.isPatchVisible(patch)) continue;
      const patchSelected = this.editor.isPatchSelected(patch);
      const suffix = patchSelected ? '|sel' : '';
      const texName = patch.texture.toLowerCase();
      const key = texName + suffix;
      let group = facesByTex.get(key);
      if (!group) {
        group = [];
        facesByTex.set(key, group);
      }
      const verts: number[] = [];
      for (let ti = 0; ti < patch.tessIndices.length; ti += 3) {
        const i0 = patch.tessIndices[ti];
        const i1 = patch.tessIndices[ti + 1];
        const i2 = patch.tessIndices[ti + 2];
        for (const idx of [i0, i1, i2]) {
          const v = patch.tessVerts[idx];
          verts.push(
            v.position[0], v.position[1], v.position[2],
            v.normal[0], v.normal[1], v.normal[2],
            v.uv[0], v.uv[1]
          );
        }
      }
      group.push({ verts, selected: patchSelected, faceSelected: false });
    }

    // Build entity marker geometry grouped by category color
    const entityVertsByColor = new Map<string, number[]>();
    for (const entity of this.editor.pointEntities()) {
      const origin = entityOrigin(entity);
      if (!origin) continue;
      const color = entityColor(entity.classname);
      let verts = entityVertsByColor.get(color);
      if (!verts) { verts = []; entityVertsByColor.set(color, verts); }

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
          verts.push(v[0], v[1], v[2], n[0], n[1], n[2], 0, 0);
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
        const invisible = Editor.INVISIBLE_TEXTURES.has(texName.toLowerCase());
        let blendMode = tm?.getBlendMode(texName) ?? 'opaque';
        if (invisible && this.editor.invisibleMode === 'dim' && blendMode === 'opaque') {
          blendMode = 'blend';
        }
        const solidOverride = invisible && this.editor.invisibleMode === 'hide' && (selected || faceSelected);
        this.drawGroups.push({ textureName: texName, start, count, selected, faceSelected, blendMode, invisible, solidOverride });
      }
    }

    // Entity markers (one draw group per category color)
    for (const [color, verts] of entityVertsByColor) {
      if (verts.length === 0) continue;
      const start = allVerts.length / 8;
      for (const v of verts) allVerts.push(v);
      const count = verts.length / 8;
      this.drawGroups.push({ textureName: `__entity_${color}`, start, count, selected: false, faceSelected: false, blendMode: 'opaque', invisible: false, solidOverride: false });
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

    // Patch wireframe: boundary edges of the tessellation grid
    for (const { entity, patch } of this.editor.allPatches()) {
      if (!this.editor.isPatchVisible(patch)) continue;
      const patchSel = this.editor.isPatchSelected(patch);
      const arr = patchSel ? selLineVerts : wireVerts;
      const n = patch.subdivisions + 1;
      const subCols = (patch.width - 1) / 2;
      const subRows = (patch.height - 1) / 2;
      for (let spr = 0; spr < subRows; spr++) {
        for (let spc = 0; spc < subCols; spc++) {
          const base = (spr * subCols + spc) * n * n;
          for (let vi = 0; vi < n; vi++) {
            for (let ui = 0; ui < n; ui++) {
              const idx = base + vi * n + ui;
              const p = patch.tessVerts[idx]?.position;
              if (!p) continue;
              // Horizontal edge
              if (ui < n - 1) {
                const q = patch.tessVerts[idx + 1].position;
                arr.push(p[0], p[1], p[2], q[0], q[1], q[2]);
              }
              // Vertical edge
              if (vi < n - 1) {
                const q = patch.tessVerts[idx + n].position;
                arr.push(p[0], p[1], p[2], q[0], q[1], q[2]);
              }
            }
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

    // Build light radius circle geometry (per-light for individual colors)
    const lightRadiusVerts: number[] = [];
    this.lightRadiusDraws = [];
    const CIRCLE_SEGMENTS = 48;
    for (const entity of this.editor.pointEntities()) {
      if (entity.classname !== 'light' || !entity.properties['light']) continue;
      if (!this.editor.isEntitySelected(entity)) continue;
      const radius = parseFloat(entity.properties['light']);
      if (!(radius > 0)) continue;
      const origin = entityOrigin(entity);
      if (!origin) continue;
      const lc = parseLightColor(entity);
      const color: [number, number, number] = lc ?? [1.0, 1.0, 0.4];
      const start = lightRadiusVerts.length / 3;
      // Draw 3 circles: XY, XZ, YZ planes
      for (let axis = 0; axis < 3; axis++) {
        for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
          const a0 = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
          const a1 = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
          const p0: Vec3 = [origin[0], origin[1], origin[2]];
          const p1: Vec3 = [origin[0], origin[1], origin[2]];
          if (axis === 0) { // XY
            p0[0] += Math.cos(a0) * radius; p0[1] += Math.sin(a0) * radius;
            p1[0] += Math.cos(a1) * radius; p1[1] += Math.sin(a1) * radius;
          } else if (axis === 1) { // XZ
            p0[0] += Math.cos(a0) * radius; p0[2] += Math.sin(a0) * radius;
            p1[0] += Math.cos(a1) * radius; p1[2] += Math.sin(a1) * radius;
          } else { // YZ
            p0[1] += Math.cos(a0) * radius; p0[2] += Math.sin(a0) * radius;
            p1[1] += Math.cos(a1) * radius; p1[2] += Math.sin(a1) * radius;
          }
          lightRadiusVerts.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
        }
      }
      const count = lightRadiusVerts.length / 3 - start;
      this.lightRadiusDraws.push({ start, count, color });
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightRadiusVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lightRadiusVerts), gl.DYNAMIC_DRAW);

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
    // Patch control point handles
    if (this.editor.patchEditMode) {
      const s = 4;
      for (let di = 0; di < this.editor.patchEditData.length; di++) {
        const patch = this.editor.patchEditData[di].patch;
        for (let r = 0; r < patch.height; r++) {
          for (let c = 0; c < patch.width; c++) {
            const p = patch.ctrl[r][c].xyz;
            const arr = this.editor.isControlPointSelected(di, r, c) ? vtxSelVerts : vtxVerts;
            arr.push(p[0]-s, p[1], p[2], p[0]+s, p[1], p[2]);
            arr.push(p[0], p[1]-s, p[2], p[0], p[1]+s, p[2]);
            arr.push(p[0], p[1], p[2]-s, p[0], p[1], p[2]+s);
          }
        }
        // Control lattice lines (connecting adjacent control points)
        for (let r = 0; r < patch.height; r++) {
          for (let c = 0; c < patch.width; c++) {
            const p = patch.ctrl[r][c].xyz;
            if (c < patch.width - 1) {
              const q = patch.ctrl[r][c + 1].xyz;
              selLineVerts.push(p[0], p[1], p[2], q[0], q[1], q[2]);
            }
            if (r < patch.height - 1) {
              const q = patch.ctrl[r + 1][c].xyz;
              selLineVerts.push(p[0], p[1], p[2], q[0], q[1], q[2]);
            }
          }
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
    // Sync camera state so 2D viewports can draw the camera icon
    const cam = this.editor.camera3d;
    cam.position = this.position;
    cam.yaw = this.yaw;
    cam.pitch = this.pitch;
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

    // Draw grid (hidden in fullscreen walk/fly for clean game-like view)
    const isGameView = this.fullscreen && this.fullscreenMode !== 'edit';
    if (!isGameView) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(this.linePVLoc, false, pv);
      gl.uniform3f(this.lineColorLoc, 0.2, 0.2, 0.22);
      gl.bindVertexArray(this.gridVAO);
      gl.drawArrays(gl.LINES, 0, this.gridCount);
    }

    // Draw textured geometry by group (two-pass: opaque first, then transparent)
    if (this.drawGroups.length > 0) {
      gl.useProgram(this.solidProg);
      gl.uniformMatrix4fv(this.solidPVLoc, false, pv);
      gl.uniform1i(this.solidTexLoc, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(this.solidVAO);

      const drawGroup = (group: DrawGroup) => {
        const tm = this.editor.textureManager;
        if (tm) {
          const texInfo = tm.get(group.textureName);
          gl.bindTexture(gl.TEXTURE_2D, texInfo.glTexture);
        }
        const hideSelection = this.fullscreen && this.fullscreenMode !== 'edit';
        gl.uniform1f(this.solidSelLoc, !hideSelection && group.selected ? 1.0 : 0.0);
        gl.uniform1f(this.solidFaceSelLoc, !hideSelection && group.faceSelected ? 1.0 : 0.0);
        const isDimInvis = group.invisible && this.editor.invisibleMode === 'dim';
        gl.uniform1f(this.solidAlphaOverrideLoc, isDimInvis ? 0.3 : 0.0);
        gl.uniform1f(this.solidSolidOverrideLoc, group.solidOverride ? 1.0 : 0.0);
        gl.drawArrays(gl.TRIANGLES, group.start, group.count);
      };

      // Pass 1: opaque
      gl.uniform1f(this.solidUseAlphaLoc, 0.0);
      gl.uniform1f(this.solidAlphaOverrideLoc, 0.0);
      for (const group of this.drawGroups) {
        if (group.blendMode !== 'opaque') continue;
        drawGroup(group);
      }

      // Pass 2: transparent (blended)
      let hasTransparent = false;
      for (const group of this.drawGroups) {
        if (group.blendMode === 'opaque') continue;
        if (!hasTransparent) {
          gl.enable(gl.BLEND);
          hasTransparent = true;
        }
        // Dimmed invisible faces keep depth writes so back faces are occluded
        const isDimInvis = group.invisible && this.editor.invisibleMode === 'dim';
        gl.depthMask(isDimInvis);
        if (group.blendMode === 'add') {
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.uniform1f(this.solidUseAlphaLoc, 0.0);
        } else {
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.uniform1f(this.solidUseAlphaLoc, 1.0);
        }
        drawGroup(group);
      }
      if (hasTransparent) {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }
    }

    // Draw unselected wireframe (hidden in fullscreen walk/fly)
    if (!isGameView && this.wireCount > 0) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(this.linePVLoc, false, pv);
      gl.uniform3f(this.lineColorLoc, 0.0, 0.0, 0.0);
      gl.bindVertexArray(this.wireVAO);
      gl.drawArrays(gl.LINES, 0, this.wireCount);
    }

    // Draw light radius circles (per-light color, hidden in walk/fly)
    if (!isGameView && this.lightRadiusDraws.length > 0) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(this.linePVLoc, false, pv);
      gl.bindVertexArray(this.lightRadiusVAO);
      for (const draw of this.lightRadiusDraws) {
        gl.uniform3f(this.lineColorLoc, draw.color[0], draw.color[1], draw.color[2]);
        gl.drawArrays(gl.LINES, draw.start, draw.count);
      }
    }

    // Skip selection overlays and gizmo in fullscreen walk/fly
    const showSelection = !this.fullscreen || this.fullscreenMode === 'edit';

    // Draw selected wireframe overlay (no depth test)
    if (showSelection && this.lineCount > 0) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(this.linePVLoc, false, pv);
      gl.uniform3f(this.lineColorLoc, 1.0, 0.5, 0.0);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(this.lineVAO);
      gl.drawArrays(gl.LINES, 0, this.lineCount);
      gl.enable(gl.DEPTH_TEST);
    }

    // Draw face-selected wireframe overlay (cyan, no depth test)
    if (showSelection && this.faceSelCount > 0) {
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
    if (showSelection && (this.vtxHandleCount > 0 || this.vtxHandleSelCount > 0)) {
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
    if (showSelection && this.gizmo.segments.length > 0) {
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

  // ── Walk-mode collision ──

  /**
   * Trace an AABB from `start` along `delta` against all brush geometry.
   * Returns the clipped end position using slide-move (up to 3 clip planes).
   * The AABB is defined by the player half-width and height below the eye.
   *
   * `start` and return value are the eye position (top-center of AABB).
   */
  private clipMove(start: Vec3, delta: Vec3): Vec3 {
    const hw = Viewport3D.PLAYER_HALF_W;
    const eyeH = Viewport3D.EYE_HEIGHT;

    // Expand each brush face plane by the player AABB half-extents projected onto the face normal.
    // Then do a point trace against the expanded planes.
    let remaining: Vec3 = vec3Copy(delta);
    let pos: Vec3 = vec3Copy(start);

    for (let bounce = 0; bounce < 4; bounce++) {
      const moveLen = vec3Length(remaining);
      if (moveLen < 0.001) break;

      // Find the earliest collision along `remaining`
      let bestFrac = 1.0;
      let hitNormal: Vec3 | null = null;

      for (const { brush } of this.editor.allBrushes()) {
        // Quick AABB reject: skip brush if it's nowhere near the sweep
        const endPos = vec3Add(pos, remaining);
        const sweepMins: Vec3 = [
          Math.min(pos[0], endPos[0]) - hw,
          Math.min(pos[1], endPos[1]) - hw,
          Math.min(pos[2], endPos[2]) - eyeH,
        ];
        const sweepMaxs: Vec3 = [
          Math.max(pos[0], endPos[0]) + hw,
          Math.max(pos[1], endPos[1]) + hw,
          Math.max(pos[2], endPos[2]),
        ];
        if (brush.maxs[0] < sweepMins[0] || brush.mins[0] > sweepMaxs[0] ||
            brush.maxs[1] < sweepMins[1] || brush.mins[1] > sweepMaxs[1] ||
            brush.maxs[2] < sweepMins[2] || brush.mins[2] > sweepMaxs[2]) continue;

        // Trace against expanded brush using Minkowski-expanded half-space intersection
        let enterFrac = -1.0;
        let leaveFrac = 1.0;
        let enterNormal: Vec3 | null = null;
        let startsOut = false;

        for (const face of brush.faces) {
          const n = face.plane.normal;
          // AABB half-extent projection onto plane normal
          const expand = hw * Math.abs(n[0]) + hw * Math.abs(n[1]) + eyeH * Math.abs(n[2]);
          // Offset for eye being at top of AABB: shift by (eyeH/2 - eyeH) in Z = -eyeH/2
          // Actually, eye is at top of AABB, feet at (pos - [0,0,eyeH]).
          // Center of AABB = pos - [0,0, eyeH/2]. The half-extent in Z is eyeH/2.
          // So we trace from the AABB center, with half-extents [hw, hw, eyeH/2].
          const centerOffset = n[2] * (-eyeH / 2);  // dot(n, [0,0,-eyeH/2])
          const halfH = eyeH / 2;
          const expandFull = hw * Math.abs(n[0]) + hw * Math.abs(n[1]) + halfH * Math.abs(n[2]);

          const d1 = vec3Dot(n, pos) + centerOffset - face.plane.dist - expandFull;
          const d2 = vec3Dot(n, vec3Add(pos, remaining)) + centerOffset - face.plane.dist - expandFull;

          if (d1 > 0) startsOut = true;

          // Both in front → outside this plane, can skip
          if (d1 > 0 && d2 > 0) { enterFrac = 2; break; }
          // Both behind → inside this plane, continue
          if (d1 <= 0 && d2 <= 0) continue;

          const f = d1 / (d1 - d2);
          if (d1 > 0) {
            // Entering the brush
            if (f > enterFrac) {
              enterFrac = f;
              enterNormal = n;
            }
          } else {
            // Leaving the brush
            if (f < leaveFrac) leaveFrac = f;
          }
        }

        if (!startsOut) continue;  // started inside brush, ignore
        if (enterFrac < leaveFrac && enterFrac >= -0.01 && enterFrac < bestFrac) {
          bestFrac = Math.max(0, enterFrac - 0.03 / moveLen); // pull back slightly
          hitNormal = enterNormal;
        }
      }

      if (bestFrac >= 1.0) {
        // No collision, apply full remaining move
        pos = vec3Add(pos, remaining);
        break;
      }

      // Move to collision point
      pos = vec3Add(pos, vec3Scale(remaining, bestFrac));

      if (!hitNormal) break;

      // Slide: remove the component of remaining velocity along the hit normal
      const leftover = vec3Scale(remaining, 1 - bestFrac);
      const backoff = vec3Dot(leftover, hitNormal);
      remaining = vec3Sub(leftover, vec3Scale(hitNormal, backoff));
    }

    return pos;
  }

  /**
   * Trace downward from `eyePos` to find the ground height.
   * Returns the Z of the eye if standing on ground, or null if no ground within range.
   */
  private traceGround(eyePos: Vec3): number | null {
    const hw = Viewport3D.PLAYER_HALF_W;
    const eyeH = Viewport3D.EYE_HEIGHT;
    const halfH = eyeH / 2;
    const probeDepth = 4; // how far below feet to check

    // Trace the AABB downward by probeDepth
    const delta: Vec3 = [0, 0, -(probeDepth)];

    let bestFrac = 1.0;

    for (const { brush } of this.editor.allBrushes()) {
      // Quick AABB reject
      if (brush.maxs[0] < eyePos[0] - hw || brush.mins[0] > eyePos[0] + hw ||
          brush.maxs[1] < eyePos[1] - hw || brush.mins[1] > eyePos[1] + hw ||
          brush.maxs[2] < eyePos[2] - eyeH - probeDepth || brush.mins[2] > eyePos[2]) continue;

      let enterFrac = -1.0;
      let leaveFrac = 1.0;
      let enterNormal: Vec3 | null = null;
      let startsOut = false;

      for (const face of brush.faces) {
        const n = face.plane.normal;
        const centerOffset = n[2] * (-halfH);
        const expandFull = hw * Math.abs(n[0]) + hw * Math.abs(n[1]) + halfH * Math.abs(n[2]);

        const d1 = vec3Dot(n, eyePos) + centerOffset - face.plane.dist - expandFull;
        const d2 = vec3Dot(n, vec3Add(eyePos, delta)) + centerOffset - face.plane.dist - expandFull;

        if (d1 > 0) startsOut = true;
        if (d1 > 0 && d2 > 0) { enterFrac = 2; break; }
        if (d1 <= 0 && d2 <= 0) continue;

        const f = d1 / (d1 - d2);
        if (d1 > 0) {
          if (f > enterFrac) { enterFrac = f; enterNormal = n; }
        } else {
          if (f < leaveFrac) leaveFrac = f;
        }
      }

      if (!startsOut) continue;
      if (enterFrac < leaveFrac && enterFrac >= -0.01 && enterFrac < bestFrac) {
        // Only count as ground if the hit surface is mostly horizontal (walkable)
        if (enterNormal && enterNormal[2] > 0.7) {
          bestFrac = Math.max(0, enterFrac);
        }
      }
    }

    if (bestFrac < 1.0) {
      // Ground hit: return the eye Z at that contact point
      return eyePos[2] + delta[2] * bestFrac;
    }
    return null;
  }

  private updateCamera(dt: number): void {
    const isWalkMode = this.fullscreen && this.fullscreenMode === 'walk';

    // In walk mode, always run physics (gravity) even without key input
    if (!isWalkMode) {
      if (!this.looking && !this.fullscreen && this.keys.size === 0) return;
      if (this.keys.size === 0) return;
    }

    const sprint = this.keys.has('shift') ? 2.5 : 1;
    const speed = this.moveSpeed * dt * sprint;

    if (isWalkMode) {
      // Walk mode: movement on horizontal plane, gravity, collision
      const flatForward: Vec3 = [Math.cos(this.yaw), Math.sin(this.yaw), 0];
      const flatRight: Vec3 = [Math.cos(this.yaw - Math.PI / 2), Math.sin(this.yaw - Math.PI / 2), 0];

      // Build horizontal move delta
      let moveH: Vec3 = [0, 0, 0];
      if (this.keys.has('w')) moveH = vec3Add(moveH, vec3Scale(flatForward, speed));
      if (this.keys.has('s')) moveH = vec3Add(moveH, vec3Scale(flatForward, -speed));
      if (this.keys.has('d')) moveH = vec3Add(moveH, vec3Scale(flatRight, speed));
      if (this.keys.has('a')) moveH = vec3Add(moveH, vec3Scale(flatRight, -speed));

      // Try step-up: move upward by STEP_HEIGHT, do horizontal move, then settle down
      const stepH = Viewport3D.STEP_HEIGHT;
      const steppedUp = this.clipMove(this.position, [0, 0, stepH]);
      const actualStep = steppedUp[2] - this.position[2];

      // Horizontal move (at stepped-up height)
      const afterH = this.clipMove(steppedUp, moveH);

      // Step back down
      const afterDown = this.clipMove(afterH, [0, 0, -actualStep]);
      this.position = afterDown;

      // Apply gravity
      this.velocityZ += Viewport3D.GRAVITY * dt;
      // Clamp terminal velocity
      if (this.velocityZ < -1200) this.velocityZ = -1200;

      const gravityDelta: Vec3 = [0, 0, this.velocityZ * dt];
      const afterGrav = this.clipMove(this.position, gravityDelta);

      // If we didn't move the full gravity amount, we hit something
      const actualDz = afterGrav[2] - this.position[2];
      if (Math.abs(actualDz - gravityDelta[2]) > 0.01) {
        if (this.velocityZ < 0) {
          // Hit ground
          this.onGround = true;
        }
        this.velocityZ = 0;
      } else {
        this.onGround = false;
      }

      this.position = afterGrav;

      // Ground snapping: if we think we're on ground, do a small trace to stay attached
      if (this.onGround) {
        const groundZ = this.traceGround(this.position);
        if (groundZ !== null) {
          this.position[2] = groundZ;
        }
      }

      // Jump
      if (this.keys.has(' ') && this.onGround) {
        this.velocityZ = Viewport3D.JUMP_SPEED;
        this.onGround = false;
      }
    } else {
      // Fly mode (or normal editor camera): movement follows look direction
      const forward = this.getForward();
      const right = this.getRight();
      const boostSpeed = !this.fullscreen && (this.keys.has('control') || this.keys.has('meta')) ? speed * 3 / sprint : speed;

      if (this.keys.has('w')) this.position = vec3Add(this.position, vec3Scale(forward, boostSpeed));
      if (this.keys.has('s')) this.position = vec3Add(this.position, vec3Scale(forward, -boostSpeed));
      if (this.keys.has('d')) this.position = vec3Add(this.position, vec3Scale(right, boostSpeed));
      if (this.keys.has('a')) this.position = vec3Add(this.position, vec3Scale(right, -boostSpeed));
      if (this.keys.has('q') || this.keys.has(' ')) this.position[2] += boostSpeed;
      if (this.keys.has('e') || this.keys.has('c') || (!this.fullscreen && this.keys.has('shift'))) this.position[2] -= boostSpeed;
    }

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

  pickPatchAt(screenX: number, screenY: number): { entity: Entity; patch: Patch; dist: number } | null {
    const { rayOrigin, rayDir: dir } = this.getRay(screenX, screenY);

    let bestDist = Infinity;
    let bestHit: { entity: Entity; patch: Patch; dist: number } | null = null;

    for (const { entity, patch } of this.editor.allPatches()) {
      if (!this.editor.isPatchVisible(patch)) continue;
      for (let ti = 0; ti < patch.tessIndices.length; ti += 3) {
        const v0 = patch.tessVerts[patch.tessIndices[ti]].position;
        const v1 = patch.tessVerts[patch.tessIndices[ti + 1]].position;
        const v2 = patch.tessVerts[patch.tessIndices[ti + 2]].position;
        const t = rayTriangleIntersect(rayOrigin, dir, v0, v1, v2);
        if (t !== null && t < bestDist) {
          bestDist = t;
          bestHit = { entity, patch, dist: t };
        }
      }
    }

    return bestHit;
  }

  // ── Picking / selection on click ──

  private handlePick(e: MouseEvent): void {
    const sx = this.dragStart[0], sy = this.dragStart[1];
    if (this.editor.vertexMode) {
      const { rayOrigin, rayDir } = this.getRay(sx, sy);
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
    } else if (this.editor.patchEditMode) {
      const { rayOrigin, rayDir } = this.getRay(sx, sy);
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      let hitDi = -1, hitR = -1, hitC = -1;
      let bestDistSq = 64;
      for (let di = 0; di < this.editor.patchEditData.length; di++) {
        const patch = this.editor.patchEditData[di].patch;
        for (let r = 0; r < patch.height; r++) {
          for (let c = 0; c < patch.width; c++) {
            const p = patch.ctrl[r][c].xyz;
            const toP = vec3Sub(p, rayOrigin);
            const t = vec3Dot(toP, rayDir);
            if (t < 0) continue;
            const proj = vec3Add(rayOrigin, vec3Scale(rayDir, t));
            const d = vec3Sub(p, proj);
            const distSq = d[0]*d[0] + d[1]*d[1] + d[2]*d[2];
            if (distSq < bestDistSq) {
              bestDistSq = distSq;
              hitDi = di; hitR = r; hitC = c;
            }
          }
        }
      }
      if (hitDi >= 0) {
        this.editor.selectControlPoint(hitDi, hitR, hitC, additive);
      } else {
        if (!additive) this.editor.clearControlPointSelection();
      }
    } else {
      const filter = this.editor.selectionFilter;
      const brushHit = (filter === 'all' || filter === 'brushes') ? this.pickBrushAt(sx, sy) : null;
      const patchHit = (filter === 'all' || filter === 'patches') ? this.pickPatchAt(sx, sy) : null;

      let usePatch = false;
      if (patchHit && brushHit) {
        const { rayOrigin, rayDir: dir } = this.getRay(sx, sy);
        let brushDist = Infinity;
        for (const face of brushHit.brush.faces) {
          if (face.polygon.length < 3) continue;
          for (let ii = 1; ii < face.polygon.length - 1; ii++) {
            const t = rayTriangleIntersect(rayOrigin, dir, face.polygon[0], face.polygon[ii], face.polygon[ii + 1]);
            if (t !== null && t < brushDist) brushDist = t;
          }
        }
        usePatch = patchHit.dist < brushDist;
      } else if (patchHit && !brushHit) {
        usePatch = true;
      }

      if (usePatch && patchHit) {
        const additive = e.ctrlKey || e.metaKey || e.shiftKey;
        this.editor.selectPatch(patchHit.entity, patchHit.patch, additive);
      } else if (brushHit) {
        if (e.altKey) {
          const additive = e.shiftKey;
          this.editor.selectFace(brushHit.entity, brushHit.brush, brushHit.face, additive);
        } else {
          const additive = e.ctrlKey || e.metaKey || e.shiftKey;
          if (!additive) this.editor.clearSelection();
          this.editor.selectBrush(brushHit.entity, brushHit.brush, additive);
        }
      } else {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) this.editor.clearSelection();
      }
    }
  }

  // ── Input ──

  private setupEvents(): void {
    const el = this.canvas.parentElement!;

    el.addEventListener('mousedown', (e) => {
      // In fullscreen walk/fly, pointer is locked — no click interaction
      if (this.fullscreen && this.fullscreenMode !== 'edit') return;
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
      if (e.button === 2 || (e.button === 0 && !this.fullscreen)) {
        // Right-click look (always), or left-click look (only outside fullscreen edit)
        this.looking = true;
        this.didDrag = false;
        this.dragStart = [e.clientX, e.clientY];
        this.lastMouse = [e.clientX, e.clientY];
        el.requestPointerLock();
      } else if (e.button === 0 && this.fullscreen && this.fullscreenMode === 'edit') {
        // Left click in fullscreen edit: start potential selection click
        this.didDrag = false;
        this.dragStart = [e.clientX, e.clientY];
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (this.gizmo.dragging) {
        this.gizmo.handleDrag(e);
        return;
      }
      // In fullscreen edit mode, only rotate camera while right-click looking
      if (this.fullscreen && this.fullscreenMode === 'edit') {
        if (!this.looking) return;
      } else if (!this.looking && !this.fullscreen) {
        return;
      }
      if (this.fullscreen && this.fullscreenMode !== 'edit' && !document.pointerLockElement) return;
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

    // Detect pointer lock loss in fullscreen → exit fullscreen (but not in edit mode)
    document.addEventListener('pointerlockchange', () => {
      if (this.fullscreen && !document.pointerLockElement) {
        if (this.fullscreenMode === 'edit') {
          // In edit mode, pointer lock release is from ending right-click look — stay fullscreen
          if (this.looking) {
            this.looking = false;
            this.keys.clear();
          }
        } else {
          this.exitFullscreen();
        }
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (this.fullscreen && this.fullscreenMode !== 'edit') return;
      if (this.gizmo.dragging && e.button === 0) {
        this.gizmo.endDrag();
        return;
      }

      const isEditMode = this.fullscreen && this.fullscreenMode === 'edit';

      // Right-click look release (both regular and edit mode)
      if (this.looking && (e.button === 2 || (e.button === 0 && !isEditMode))) {
        this.looking = false;
        this.keys.clear();
        document.exitPointerLock();
        // In regular mode, left-click non-drag selects geometry
        if (!isEditMode && !this.didDrag && e.button === 0) {
          this.handlePick(e);
        }
        return;
      }

      // Edit mode: left-click selects geometry directly (no pointer lock involved)
      if (isEditMode && e.button === 0 && !this.didDrag) {
        this.handlePick(e);
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
      if (this.fullscreen) {
        if (this.fullscreenMode === 'edit') {
          // In edit mode, only capture V to cycle mode, ESC to exit, and movement keys while looking
          if (e.key.toLowerCase() === 'v' && !this.looking) {
            this.setFullscreenMode('walk');
            e.preventDefault();
          } else if (e.key === 'Escape') {
            this.exitFullscreen();
            e.preventDefault();
          } else if (this.looking) {
            this.keys.add(e.key.toLowerCase());
            e.preventDefault();
          }
          return;
        }
        // Walk/fly mode: capture all keys for movement
        this.keys.add(e.key.toLowerCase());
        if (e.key.toLowerCase() === 'v') {
          const next = this.fullscreenMode === 'walk' ? 'fly'
                     : this.fullscreenMode === 'fly' ? 'edit' : 'walk';
          this.setFullscreenMode(next);
        }
        e.preventDefault();
        return;
      }
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
