import {
  Vec3, vec3Add, vec3Sub, vec3Scale, vec3Dot,
  vec3Copy,
  Mat4, mat4Identity,
  rayTriangleIntersect,
} from './math';
import { Editor } from './editor';
import { Brush, BrushFace } from './brush';
import { Entity } from './entity';
import { Patch } from './patch';
import { pickVertex3D } from './vertex';
import {
  VERT_SRC, FRAG_SRC, LINE_VERT_SRC, LINE_FRAG_SRC,
  createProgram, createLineBuffer, createSolidBuffer,
} from './gl-utils';
import { Gizmo } from './gizmo';
import {
  WalkState, createWalkState, VIEWHEIGHT,
} from './q3-movement';
import {
  getRay3D,
  pickBrushAt3D,
  pickEntityAt3D,
  pickPatchAt3D,
} from './viewport3d-picking';
import { DrawGroup, LightRadiusDraw, renderViewport3D } from './viewport3d-render';
import { buildViewport3DGeometry } from './viewport3d-geometry';
import {
  centerViewport3DOnSelection,
  getViewport3DForward,
  getViewport3DRight,
  updateViewport3DCamera,
} from './viewport3d-navigation';

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
  private lightRadiusDraws: LightRadiusDraw[] = [];

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

  // Walk physics (Q3 movement)
  private walkState: WalkState | null = null;
  private physicsAccum = 0;
  private walkStepSmooth = 0;     // decaying step offset for view smoothing
  private walkViewH = VIEWHEIGHT; // smooth view height (for crouch transitions)
  private walkLandChange = 0;     // landing deflect amount
  private walkLandTime = 0;       // when landing started (ms, from performance.now)
  private walkBobCycle = 0;       // head bob phase (radians)

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
        <span>WASD</span>
        <span class="hud-sep"></span>
        <span>Space jump</span>
        <span class="hud-sep"></span>
        <span>C crouch</span>
        <span class="hud-sep"></span>
        <span>V mode</span>
        <span class="hud-sep"></span>
        <span>Esc exit</span>
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
    this.physicsAccum = 0;
    this.editor.dirty = true;
  }

  private setFullscreenMode(mode: 'walk' | 'fly' | 'edit'): void {
    this.fullscreenMode = mode;
    this.hudModeEl.textContent = mode.toUpperCase();

    if (mode === 'walk') {
      // Create Q3 walk state from current eye position
      this.walkState = createWalkState(this.position);
      this.walkStepSmooth = 0;
      this.walkViewH = VIEWHEIGHT;
      this.physicsAccum = 0;
    } else {
      this.walkState = null;
    }

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
    const position = centerViewport3DOnSelection(this.editor, this.yaw, this.pitch);
    if (position) this.position = position;
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
    const result = buildViewport3DGeometry({
      gl: this.gl,
      editor: this.editor,
      solidVBO: this.solidVBO,
      lineVBO: this.lineVBO,
      wireVBO: this.wireVBO,
      faceSelVBO: this.faceSelVBO,
      vtxHandleVBO: this.vtxHandleVBO,
      vtxHandleSelVBO: this.vtxHandleSelVBO,
      lightRadiusVBO: this.lightRadiusVBO,
    });
    this.drawGroups = result.drawGroups;
    this.lineCount = result.lineCount;
    this.wireCount = result.wireCount;
    this.faceSelCount = result.faceSelCount;
    this.vtxHandleCount = result.vtxHandleCount;
    this.vtxHandleSelCount = result.vtxHandleSelCount;
    this.lightRadiusDraws = result.lightRadiusDraws;
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
    this.lastPV = renderViewport3D({
      gl: this.gl,
      canvas: this.canvas,
      editor: this.editor,
      fullscreen: this.fullscreen,
      fullscreenMode: this.fullscreenMode,
      position: this.position,
      getForward: () => this.getForward(),
      solidProg: this.solidProg,
      solidPVLoc: this.solidPVLoc,
      solidTexLoc: this.solidTexLoc,
      solidSelLoc: this.solidSelLoc,
      solidFaceSelLoc: this.solidFaceSelLoc,
      solidUseAlphaLoc: this.solidUseAlphaLoc,
      solidAlphaOverrideLoc: this.solidAlphaOverrideLoc,
      solidSolidOverrideLoc: this.solidSolidOverrideLoc,
      lineProg: this.lineProg,
      linePVLoc: this.linePVLoc,
      lineColorLoc: this.lineColorLoc,
      solidVAO: this.solidVAO,
      drawGroups: this.drawGroups,
      lineVAO: this.lineVAO,
      lineCount: this.lineCount,
      wireVAO: this.wireVAO,
      wireCount: this.wireCount,
      faceSelVAO: this.faceSelVAO,
      faceSelCount: this.faceSelCount,
      vtxHandleVAO: this.vtxHandleVAO,
      vtxHandleCount: this.vtxHandleCount,
      vtxHandleSelVAO: this.vtxHandleSelVAO,
      vtxHandleSelCount: this.vtxHandleSelCount,
      gridVAO: this.gridVAO,
      gridCount: this.gridCount,
      lightRadiusVAO: this.lightRadiusVAO,
      lightRadiusDraws: this.lightRadiusDraws,
      gizmo: {
        vao: this.gizmo.vao,
        segments: this.gizmo.segments,
        dragging: this.gizmo.dragging,
        axis: this.gizmo.axis,
      },
    });
  }

  private getForward(): Vec3 {
    return getViewport3DForward(this.yaw, this.pitch);
  }

  private getRight(): Vec3 {
    return getViewport3DRight(this.yaw);
  }

  private updateCamera(dt: number): void {
    const result = updateViewport3DCamera({
      editor: this.editor,
      fullscreen: this.fullscreen,
      fullscreenMode: this.fullscreenMode,
      looking: this.looking,
      keys: this.keys,
      moveSpeed: this.moveSpeed,
      position: this.position,
      yaw: this.yaw,
      pitch: this.pitch,
      walkState: this.walkState,
      physicsAccum: this.physicsAccum,
      walkStepSmooth: this.walkStepSmooth,
      walkViewH: this.walkViewH,
      walkLandChange: this.walkLandChange,
      walkLandTime: this.walkLandTime,
      walkBobCycle: this.walkBobCycle,
    }, dt);
    if (!result.dirty) return;
    this.position = result.position;
    this.physicsAccum = result.physicsAccum;
    this.walkStepSmooth = result.walkStepSmooth;
    this.walkViewH = result.walkViewH;
    this.walkLandChange = result.walkLandChange;
    this.walkLandTime = result.walkLandTime;
    this.walkBobCycle = result.walkBobCycle;
    this.editor.dirty = true;
  }

  // ── Ray picking in 3D ──

  private getRay(screenX: number, screenY: number): { rayOrigin: Vec3; rayDir: Vec3 } {
    return getRay3D({
      canvas: this.canvas,
      editor: this.editor,
      position: this.position,
      getForward: () => this.getForward(),
    }, screenX, screenY);
  }

  pickBrushAt(screenX: number, screenY: number): { entity: Entity; brush: Brush; face: BrushFace } | null {
    return pickBrushAt3D({
      canvas: this.canvas,
      editor: this.editor,
      position: this.position,
      getForward: () => this.getForward(),
    }, screenX, screenY);
  }

  pickPatchAt(screenX: number, screenY: number): { entity: Entity; patch: Patch; dist: number } | null {
    return pickPatchAt3D({
      canvas: this.canvas,
      editor: this.editor,
      position: this.position,
      getForward: () => this.getForward(),
    }, screenX, screenY);
  }

  pickEntityAt(screenX: number, screenY: number): { entity: Entity; dist: number } | null {
    return pickEntityAt3D({
      canvas: this.canvas,
      editor: this.editor,
      position: this.position,
      getForward: () => this.getForward(),
    }, screenX, screenY);
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
      const entityHit = (filter === 'all' || filter === 'entities') ? this.pickEntityAt(sx, sy) : null;

      if (filter === 'entities') {
        const additive = e.ctrlKey || e.metaKey || e.shiftKey;
        if (entityHit) {
          this.editor.selectEntity(entityHit.entity, additive);
        } else if (!additive) {
          this.editor.clearSelection();
        }
        return;
      }

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
      } else if (entityHit) {
        const additive = e.ctrlKey || e.metaKey || e.shiftKey;
        this.editor.selectEntity(entityHit.entity, additive);
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
