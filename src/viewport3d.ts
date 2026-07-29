import {
  Vec3, vec3Add, vec3Cross, vec3Dot, vec3Scale, vec3Sub,
  Mat4, mat4Identity,
} from './math';
import { Editor } from './editor';
import { Brush, BrushFace } from './brush';
import { Entity } from './entity';
import { Patch } from './patch';
import {
  VERT_SRC, FRAG_SRC, LINE_VERT_SRC, LINE_FRAG_SRC,
  createProgram, createLineBuffer, createSolidBuffer,
} from './gl-utils';
import { Gizmo } from './gizmo';
import { WalkState, VIEWHEIGHT } from './q3-movement';
import {
  getRay3D,
  pickBrushAt3D,
  pickEntityAt3D,
  pickPatchAt3D,
} from './viewport3d-picking';
import {
  DrawGroup,
  EntityMarkerWireDraw,
  LightRadiusDraw,
  renderViewport3D,
} from './viewport3d-render';
import { buildViewport3DGeometry } from './viewport3d-geometry';
import {
  getViewport3DForward,
  getViewport3DRight,
  updateViewport3DCamera,
} from './viewport3d-navigation';
import {
  clampOrthographicScale,
  DEFAULT_ORTHOGRAPHIC_SCALE,
  isometricCameraAngles,
  orthographicScaleForPerspectiveDistance,
  perspectiveDistanceForOrthographicScale,
  type IsometricDirection,
  type Viewport3DProjection,
} from './viewport3d-projection';
import { handleViewport3DDoublePick, handleViewport3DPick } from './viewport3d-selection';
import {
  createViewport3DFullscreenUI,
  enterViewport3DFullscreen,
  exitViewport3DFullscreen,
  setViewport3DFullscreenMode,
  Viewport3DFullscreenMode,
} from './viewport3d-fullscreen';
import { buildViewport3DGridVertices } from './viewport3d-grid';

const ISOMETRIC_DIRECTION_LABELS: Record<IsometricDirection, string> = {
  northeast: 'NE',
  northwest: 'NW',
  southeast: 'SE',
  southwest: 'SW',
};

export class Viewport3D {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  editor: Editor;

  // Camera
  position: Vec3 = [80, 80, 120];
  yaw = Math.PI * 0.25;
  pitch = -0.2;
  fov = Math.PI / 3;
  moveSpeed = 200;
  projection: Viewport3DProjection = 'perspective';
  orthographicScale = DEFAULT_ORTHOGRAPHIC_SCALE;
  private projectionFocus: Vec3 = [0, 0, 0];
  private projectionDistance = DEFAULT_ORTHOGRAPHIC_SCALE;
  private isometricDirection: IsometricDirection | null = null;
  private projectionLabel: HTMLElement;

  // GL resources
  private solidProg!: WebGLProgram;
  private solidPVLoc!: WebGLUniformLocation;
  private solidTexLoc!: WebGLUniformLocation;
  private solidSelLoc!: WebGLUniformLocation;
  private solidFaceSelLoc!: WebGLUniformLocation;
  private solidUseAlphaLoc!: WebGLUniformLocation;
  private solidAlphaOverrideLoc!: WebGLUniformLocation;
  private solidSolidOverrideLoc!: WebGLUniformLocation;
  private solidDiagnosticModeLoc!: WebGLUniformLocation;
  private solidDynamicLightingEnabledLoc!: WebGLUniformLocation;
  private solidDynamicLightCountLoc!: WebGLUniformLocation;
  private solidDynamicLightPosLoc!: WebGLUniformLocation;
  private solidDynamicLightColorLoc!: WebGLUniformLocation;
  private solidDynamicLightRadiusLoc!: WebGLUniformLocation;
  private lineProg!: WebGLProgram;
  private linePVLoc!: WebGLUniformLocation;
  private lineColorLoc!: WebGLUniformLocation;
  private lineAlphaLoc!: WebGLUniformLocation;

  private solidVAO!: WebGLVertexArrayObject;
  private solidVBO!: WebGLBuffer;
  private drawGroups: DrawGroup[] = [];

  private clipBoxVAO!: WebGLVertexArrayObject;
  private clipBoxVBO!: WebGLBuffer;
  private clipBoxCount = 0;
  private clipPreviewVAO!: WebGLVertexArrayObject;
  private clipPreviewVBO!: WebGLBuffer;
  private clipPreviewCount = 0;
  private pathLineVAO!: WebGLVertexArrayObject;
  private pathLineVBO!: WebGLBuffer;
  private pathLineCount = 0;
  private pathLineSelVAO!: WebGLVertexArrayObject;
  private pathLineSelVBO!: WebGLBuffer;
  private pathLineSelCount = 0;
  private pathCurveVAO!: WebGLVertexArrayObject;
  private pathCurveVBO!: WebGLBuffer;
  private pathCurveCount = 0;
  private pathCurveSelVAO!: WebGLVertexArrayObject;
  private pathCurveSelVBO!: WebGLBuffer;
  private pathCurveSelCount = 0;
  private pointfileLineVAO!: WebGLVertexArrayObject;
  private pointfileLineVBO!: WebGLBuffer;
  private pointfileLineCount = 0;
  private pointfileMarkerVAO!: WebGLVertexArrayObject;
  private pointfileMarkerVBO!: WebGLBuffer;
  private pointfileMarkerCount = 0;
  private bspOverlayVAO!: WebGLVertexArrayObject;
  private bspOverlayVBO!: WebGLBuffer;
  private bspOverlayCount = 0;
  private textureUAxisVAO!: WebGLVertexArrayObject;
  private textureUAxisVBO!: WebGLBuffer;
  private textureUAxisCount = 0;
  private textureVAxisVAO!: WebGLVertexArrayObject;
  private textureVAxisVBO!: WebGLBuffer;
  private textureVAxisCount = 0;
  private textureNormalVAO!: WebGLVertexArrayObject;
  private textureNormalVBO!: WebGLBuffer;
  private textureNormalCount = 0;
  private paintPreviewVAO!: WebGLVertexArrayObject;
  private paintPreviewVBO!: WebGLBuffer;
  private paintPreviewCount = 0;

  private lineVAO!: WebGLVertexArrayObject;
  private lineVBO!: WebGLBuffer;
  private lineCount = 0;

  private wireVAO!: WebGLVertexArrayObject;
  private wireVBO!: WebGLBuffer;
  private wireCount = 0;
  private entityMarkerWireDraws: EntityMarkerWireDraw[] = [];

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
  private gridBuiltForSize = Number.NaN;

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
  private captureXray = false;
  private lastPV: Mat4 = mat4Identity();
  private terrainHoverOwned = false;
  private terrainHoverCenter: Vec3 | null = null;
  private terrainHoverAxes: [number, number] | null = null;

  // Fullscreen walkthrough mode
  private fullscreen = false;
  private fullscreenMode: Viewport3DFullscreenMode = 'walk';
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
    this.projectionLabel = this.canvas.parentElement!.querySelector('.vp-label') as HTMLElement;
    this.projectionFocus = vec3Add(
      this.position,
      vec3Scale(this.getForward(), this.projectionDistance),
    );
    this.initGL();
    this.gizmo = new Gizmo(this.gl, editor);
    this.buildGrid();
    this.createFullscreenUI();
    this.setupEvents();
    this.editor.onCenterOnSelection(() => this.centerOnSelection());
    this.editor.onLocatePoint((point, lookAt) => {
      this.position = [point[0], point[1], point[2]];
      if (lookAt) {
        const dx = lookAt[0] - point[0];
        const dy = lookAt[1] - point[1];
        const dz = lookAt[2] - point[2];
        const len = Math.hypot(dx, dy, dz);
        if (len > 1e-6) {
          this.yaw = Math.atan2(dy, dx);
          this.pitch = Math.asin(Math.max(-1, Math.min(1, dz / len)));
        }
      }
      this.editor.redrawRequested = true;
    });
    this.editor.onCameraPlaybackSeek(pose => {
      if (this.projection !== 'perspective') this.editor.setCameraProjection3D('perspective');
      this.position = [...pose.position];
      this.yaw = pose.yaw;
      this.pitch = pose.pitch;
      this.fov = pose.fov * Math.PI / 180;
      this.editor.redrawRequested = true;
    });
    this.editor.onCameraProjection3DChange((projection, direction) => {
      this.applyProjection(projection, direction);
    });
    this.updateProjectionLabel();
  }

  private createFullscreenUI(): void {
    const ui = createViewport3DFullscreenUI(this.canvas.parentElement!, () => this.enterFullscreen());
    this.fullscreenBtn = ui.fullscreenBtn;
    this.fullscreenOverlay = ui.fullscreenOverlay;
    this.hudModeEl = ui.hudModeEl;
  }

  private updateProjectionLabel(): void {
    const direction = this.isometricDirection
      ? ` · ISO ${ISOMETRIC_DIRECTION_LABELS[this.isometricDirection]}`
      : '';
    this.projectionLabel.textContent = this.projection === 'perspective'
      ? '3D Camera'
      : `3D Orthographic${direction}`;
    this.canvas.parentElement!.dataset.projection = this.projection;
  }

  private syncEditorCamera(): void {
    this.editor.camera3d = {
      position: [...this.position],
      yaw: this.yaw,
      pitch: this.pitch,
    };
    this.editor.cameraPlayback = null;
  }

  private initializeOrthographicFocus(): void {
    const forward = this.getForward();
    const selectionCenter = this.editor.selectionCenter();
    const selectionDepth = selectionCenter
      ? vec3Dot(vec3Sub(selectionCenter, this.position), forward)
      : -1;
    this.projectionDistance = selectionDepth > 16 ? selectionDepth : DEFAULT_ORTHOGRAPHIC_SCALE;
    this.projectionFocus = selectionDepth > 16 && selectionCenter
      ? [...selectionCenter]
      : vec3Add(this.position, vec3Scale(forward, this.projectionDistance));
    this.orthographicScale = orthographicScaleForPerspectiveDistance(
      this.projectionDistance,
      this.fov,
    );
  }

  private applyProjection(
    projection: Viewport3DProjection,
    direction?: IsometricDirection,
  ): void {
    const previousProjection = this.projection;
    if (projection === 'orthographic' && previousProjection === 'perspective') {
      this.initializeOrthographicFocus();
    }

    this.projection = projection;
    if (projection === 'orthographic' && direction) {
      const angles = isometricCameraAngles(direction);
      this.yaw = angles.yaw;
      this.pitch = angles.pitch;
      const forward = this.getForward();
      this.position = vec3Sub(
        this.projectionFocus,
        vec3Scale(forward, this.projectionDistance),
      );
      this.isometricDirection = direction;
    } else if (projection === 'orthographic') {
      this.isometricDirection = null;
    } else {
      if (previousProjection === 'orthographic') {
        this.projectionDistance = perspectiveDistanceForOrthographicScale(
          this.orthographicScale,
          this.fov,
        );
        this.position = vec3Sub(
          this.projectionFocus,
          vec3Scale(this.getForward(), this.projectionDistance),
        );
      }
      this.isometricDirection = null;
    }

    this.syncEditorCamera();
    this.updateProjectionLabel();
    this.editor.redrawRequested = true;
  }

  enterFullscreen(): void {
    if (this.projection !== 'perspective') {
      this.editor.setCameraProjection3D('perspective');
    }
    const enterState = enterViewport3DFullscreen({
      position: this.position,
      yaw: this.yaw,
      pitch: this.pitch,
      editor: this.editor,
      fullscreenBtn: this.fullscreenBtn,
      canvas: this.canvas,
      keys: this.keys,
    });
    this.fullscreen = enterState.fullscreen;
    this.savedCamera = enterState.savedCamera;
    this.setFullscreenMode('walk');
    this.physicsAccum = enterState.physicsAccum;
    this.editor.redrawRequested = true;
  }

  private setFullscreenMode(mode: Viewport3DFullscreenMode): void {
    const modeState = setViewport3DFullscreenMode({
      mode,
      position: this.position,
      canvas: this.canvas,
      fullscreenOverlay: this.fullscreenOverlay,
      hudModeEl: this.hudModeEl,
    });
    this.fullscreenMode = modeState.fullscreenMode;
    this.walkState = modeState.walkState;
    this.walkStepSmooth = modeState.walkStepSmooth;
    this.walkViewH = modeState.walkViewH;
    this.physicsAccum = modeState.physicsAccum;
  }

  exitFullscreen(): void {
    const exitState = exitViewport3DFullscreen({
      fullscreen: this.fullscreen,
      fullscreenMode: this.fullscreenMode,
      savedCamera: this.savedCamera,
      position: this.position,
      yaw: this.yaw,
      pitch: this.pitch,
      editor: this.editor,
      fullscreenOverlay: this.fullscreenOverlay,
      fullscreenBtn: this.fullscreenBtn,
      keys: this.keys,
    });
    this.position = exitState.position;
    this.yaw = exitState.yaw;
    this.pitch = exitState.pitch;
    this.savedCamera = exitState.savedCamera;
    this.fullscreen = exitState.fullscreen;
    this.editor.redrawRequested = true;
  }

  centerOnSelection(): void {
    const bounds = this.editor.selectionBounds();
    if (bounds) this.frameBounds(bounds);
  }

  setCamera(position: Vec3, yaw: number, pitch: number): void {
    this.position = [...position];
    this.yaw = yaw;
    this.pitch = Math.max(-Math.PI * 0.499, Math.min(Math.PI * 0.499, pitch));
    this.projectionFocus = vec3Add(
      this.position,
      vec3Scale(this.getForward(), this.projectionDistance),
    );
    this.isometricDirection = null;
    this.syncEditorCamera();
    this.editor.redrawRequested = true;
  }

  frameBounds(bounds: { mins: Vec3; maxs: Vec3 }): void {
    const center: Vec3 = [
      (bounds.mins[0] + bounds.maxs[0]) / 2,
      (bounds.mins[1] + bounds.maxs[1]) / 2,
      (bounds.mins[2] + bounds.maxs[2]) / 2,
    ];
    const size = Math.hypot(
      bounds.maxs[0] - bounds.mins[0],
      bounds.maxs[1] - bounds.mins[1],
      bounds.maxs[2] - bounds.mins[2],
    );
    const forward = this.getForward();
    if (this.projection === 'orthographic') {
      this.projectionFocus = center;
      this.orthographicScale = clampOrthographicScale(Math.max(size * 0.65, 32));
      this.projectionDistance = perspectiveDistanceForOrthographicScale(
        this.orthographicScale,
        this.fov,
      );
    } else {
      this.projectionDistance = Math.max(size * 1.5, 128);
      this.projectionFocus = center;
    }
    this.position = vec3Sub(
      this.projectionFocus,
      vec3Scale(forward, this.projectionDistance),
    );
    this.syncEditorCamera();
    this.editor.redrawRequested = true;
  }

  capturePng(width?: number, height?: number, xray = false): { mimeType: string; data: string; width: number; height: number } {
    const rendererMode = this.editor.display.rendererMode;
    if (xray) this.editor.display.rendererMode = 'wireframe';
    try {
      this.captureXray = xray;
      this.render(performance.now());
    } finally {
      this.captureXray = false;
      if (xray) this.editor.display.rendererMode = rendererMode;
    }
    const sourceWidth = this.gl.drawingBufferWidth;
    const sourceHeight = this.gl.drawingBufferHeight;
    if (sourceWidth < 1 || sourceHeight < 1) throw new Error('The 3D viewport has no drawable area');

    const pixels = new Uint8Array(sourceWidth * sourceHeight * 4);
    this.gl.readPixels(0, 0, sourceWidth, sourceHeight, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
    const source = document.createElement('canvas');
    source.width = sourceWidth;
    source.height = sourceHeight;
    source.getContext('2d')!.putImageData(
      new ImageData(new Uint8ClampedArray(pixels.buffer), sourceWidth, sourceHeight), 0, 0,
    );

    const outputWidth = Math.max(64, Math.min(Math.round(width ?? sourceWidth), 2048));
    const outputHeight = Math.max(64, Math.min(Math.round(height ?? sourceHeight), 2048));
    const output = document.createElement('canvas');
    output.width = outputWidth;
    output.height = outputHeight;
    const context = output.getContext('2d')!;
    context.translate(0, outputHeight);
    context.scale(1, -1);
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
    const dataUrl = output.toDataURL('image/png');
    return {
      mimeType: 'image/png',
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      width: outputWidth,
      height: outputHeight,
    };
  }

  private initGL(): void {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);

    this.solidProg = createProgram(gl, VERT_SRC, FRAG_SRC);
    this.solidPVLoc = gl.getUniformLocation(this.solidProg, 'uPV')!;
    this.solidTexLoc = gl.getUniformLocation(this.solidProg, 'uTexture')!;
    this.solidSelLoc = gl.getUniformLocation(this.solidProg, 'uSelected')!;
    this.solidFaceSelLoc = gl.getUniformLocation(this.solidProg, 'uFaceSelected')!;
    this.solidUseAlphaLoc = gl.getUniformLocation(this.solidProg, 'uUseAlpha')!;
    this.solidAlphaOverrideLoc = gl.getUniformLocation(this.solidProg, 'uAlphaOverride')!;
    this.solidSolidOverrideLoc = gl.getUniformLocation(this.solidProg, 'uSolidOverride')!;
    this.solidDiagnosticModeLoc = gl.getUniformLocation(this.solidProg, 'uDiagnosticMode')!;
    this.solidDynamicLightingEnabledLoc = gl.getUniformLocation(this.solidProg, 'uDynamicLightingEnabled')!;
    this.solidDynamicLightCountLoc = gl.getUniformLocation(this.solidProg, 'uDynamicLightCount')!;
    this.solidDynamicLightPosLoc = gl.getUniformLocation(this.solidProg, 'uDynamicLightPos[0]')!;
    this.solidDynamicLightColorLoc = gl.getUniformLocation(this.solidProg, 'uDynamicLightColor[0]')!;
    this.solidDynamicLightRadiusLoc = gl.getUniformLocation(this.solidProg, 'uDynamicLightRadius[0]')!;

    this.lineProg = createProgram(gl, LINE_VERT_SRC, LINE_FRAG_SRC);
    this.linePVLoc = gl.getUniformLocation(this.lineProg, 'uPV')!;
    this.lineColorLoc = gl.getUniformLocation(this.lineProg, 'uColor')!;
    this.lineAlphaLoc = gl.getUniformLocation(this.lineProg, 'uAlpha')!;

    const solid = createSolidBuffer(gl);
    this.solidVAO = solid.vao; this.solidVBO = solid.vbo;

    const clipBox = createLineBuffer(gl);
    this.clipBoxVAO = clipBox.vao; this.clipBoxVBO = clipBox.vbo;
    const clipPreview = createLineBuffer(gl);
    this.clipPreviewVAO = clipPreview.vao; this.clipPreviewVBO = clipPreview.vbo;
    const path = createLineBuffer(gl);
    this.pathLineVAO = path.vao; this.pathLineVBO = path.vbo;
    const pathSel = createLineBuffer(gl);
    this.pathLineSelVAO = pathSel.vao; this.pathLineSelVBO = pathSel.vbo;
    const pathCurve = createLineBuffer(gl);
    this.pathCurveVAO = pathCurve.vao; this.pathCurveVBO = pathCurve.vbo;
    const pathCurveSel = createLineBuffer(gl);
    this.pathCurveSelVAO = pathCurveSel.vao; this.pathCurveSelVBO = pathCurveSel.vbo;
    const pointfile = createLineBuffer(gl);
    this.pointfileLineVAO = pointfile.vao; this.pointfileLineVBO = pointfile.vbo;
    const pointfileMarker = createLineBuffer(gl);
    this.pointfileMarkerVAO = pointfileMarker.vao; this.pointfileMarkerVBO = pointfileMarker.vbo;
    const bspOverlay = createLineBuffer(gl);
    this.bspOverlayVAO = bspOverlay.vao; this.bspOverlayVBO = bspOverlay.vbo;
    const textureUAxis = createLineBuffer(gl);
    this.textureUAxisVAO = textureUAxis.vao; this.textureUAxisVBO = textureUAxis.vbo;
    const textureVAxis = createLineBuffer(gl);
    this.textureVAxisVAO = textureVAxis.vao; this.textureVAxisVBO = textureVAxis.vbo;
    const textureNormal = createLineBuffer(gl);
    this.textureNormalVAO = textureNormal.vao; this.textureNormalVBO = textureNormal.vbo;
    const paintPreview = createLineBuffer(gl);
    this.paintPreviewVAO = paintPreview.vao; this.paintPreviewVBO = paintPreview.vbo;
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
    const verts = buildViewport3DGridVertices(this.editor.gridSize);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    this.gridCount = verts.length / 3;
    this.gridBuiltForSize = this.editor.gridSize;
  }

  private buildGeometry(): void {
    const result = buildViewport3DGeometry({
      gl: this.gl,
      editor: this.editor,
      solidVBO: this.solidVBO,
      clipBoxVBO: this.clipBoxVBO,
      clipPreviewVBO: this.clipPreviewVBO,
      pathLineVBO: this.pathLineVBO,
      pathLineSelVBO: this.pathLineSelVBO,
      pathCurveVBO: this.pathCurveVBO,
      pathCurveSelVBO: this.pathCurveSelVBO,
      pointfileLineVBO: this.pointfileLineVBO,
      pointfileMarkerVBO: this.pointfileMarkerVBO,
      bspOverlayVBO: this.bspOverlayVBO,
      textureUAxisVBO: this.textureUAxisVBO,
      textureVAxisVBO: this.textureVAxisVBO,
      textureNormalVBO: this.textureNormalVBO,
      paintPreviewVBO: this.paintPreviewVBO,
      lineVBO: this.lineVBO,
      wireVBO: this.wireVBO,
      faceSelVBO: this.faceSelVBO,
      vtxHandleVBO: this.vtxHandleVBO,
      vtxHandleSelVBO: this.vtxHandleSelVBO,
      lightRadiusVBO: this.lightRadiusVBO,
    });
    this.drawGroups = result.drawGroups;
    this.clipBoxCount = result.clipBoxCount;
    this.clipPreviewCount = result.clipPreviewCount;
    this.pathLineCount = result.pathLineCount;
    this.pathLineSelCount = result.pathLineSelCount;
    this.pathCurveCount = result.pathCurveCount;
    this.pathCurveSelCount = result.pathCurveSelCount;
    this.pointfileLineCount = result.pointfileLineCount;
    this.pointfileMarkerCount = result.pointfileMarkerCount;
    this.bspOverlayCount = result.bspOverlayCount;
    this.textureUAxisCount = result.textureUAxisCount;
    this.textureVAxisCount = result.textureVAxisCount;
    this.textureNormalCount = result.textureNormalCount;
    this.paintPreviewCount = result.paintPreviewCount;
    this.lineCount = result.lineCount;
    this.wireCount = result.wireCount;
    this.entityMarkerWireDraws = result.entityMarkerWireDraws;
    this.faceSelCount = result.faceSelCount;
    this.vtxHandleCount = result.vtxHandleCount;
    this.vtxHandleSelCount = result.vtxHandleSelCount;
    this.lightRadiusDraws = result.lightRadiusDraws;
  }

  render(time: number): void {
    const dt = this.lastTime ? (time - this.lastTime) / 1000 : 0;
    this.lastTime = time;

    const cameraPose = this.editor.advanceCameraPlayback(dt);
    if (cameraPose) {
      if (this.projection !== 'perspective') {
        this.editor.setCameraProjection3D('perspective');
      }
      this.position = [...cameraPose.position];
      this.yaw = cameraPose.yaw;
      this.pitch = cameraPose.pitch;
      this.fov = cameraPose.fov * Math.PI / 180;
      if (cameraPose.action) this.editor.statusMessage = `Camera action: ${cameraPose.action}`;
    } else {
      this.updateCamera(dt);
      this.fov = Math.PI / 3;
    }
    // Sync camera state so 2D viewports can draw the camera icon
    const cam = this.editor.camera3d;
    cam.position = this.position;
    cam.yaw = this.yaw;
    cam.pitch = this.pitch;
    if (this.gridBuiltForSize !== this.editor.gridSize) {
      this.buildGrid();
    }
    if (this.editor.redrawRequested) {
      this.buildGeometry();
    }
    this.gizmo.build(this.position, this.projection, this.orthographicScale);
    this.lastPV = renderViewport3D({
      gl: this.gl,
      canvas: this.canvas,
      editor: this.editor,
      fullscreen: this.fullscreen,
      fullscreenMode: this.fullscreenMode,
      position: this.position,
      fov: this.fov,
      projection: this.projection,
      orthographicScale: this.orthographicScale,
      getForward: () => this.getForward(),
      solidProg: this.solidProg,
      solidPVLoc: this.solidPVLoc,
      solidTexLoc: this.solidTexLoc,
      solidSelLoc: this.solidSelLoc,
      solidFaceSelLoc: this.solidFaceSelLoc,
      solidUseAlphaLoc: this.solidUseAlphaLoc,
      solidAlphaOverrideLoc: this.solidAlphaOverrideLoc,
      solidSolidOverrideLoc: this.solidSolidOverrideLoc,
      solidDiagnosticModeLoc: this.solidDiagnosticModeLoc,
      solidDynamicLightingEnabledLoc: this.solidDynamicLightingEnabledLoc,
      solidDynamicLightCountLoc: this.solidDynamicLightCountLoc,
      solidDynamicLightPosLoc: this.solidDynamicLightPosLoc,
      solidDynamicLightColorLoc: this.solidDynamicLightColorLoc,
      solidDynamicLightRadiusLoc: this.solidDynamicLightRadiusLoc,
      lineProg: this.lineProg,
      linePVLoc: this.linePVLoc,
      lineColorLoc: this.lineColorLoc,
      lineAlphaLoc: this.lineAlphaLoc,
      solidVAO: this.solidVAO,
      drawGroups: this.drawGroups,
      clipBoxVAO: this.clipBoxVAO,
      clipBoxCount: this.clipBoxCount,
      clipPreviewVAO: this.clipPreviewVAO,
      clipPreviewCount: this.clipPreviewCount,
      pathLineVAO: this.pathLineVAO,
      pathLineCount: this.pathLineCount,
      pathLineSelVAO: this.pathLineSelVAO,
      pathLineSelCount: this.pathLineSelCount,
      pathCurveVAO: this.pathCurveVAO,
      pathCurveCount: this.pathCurveCount,
      pathCurveSelVAO: this.pathCurveSelVAO,
      pathCurveSelCount: this.pathCurveSelCount,
      pointfileLineVAO: this.pointfileLineVAO,
      pointfileLineCount: this.pointfileLineCount,
      pointfileMarkerVAO: this.pointfileMarkerVAO,
      pointfileMarkerCount: this.pointfileMarkerCount,
      bspOverlayVAO: this.bspOverlayVAO,
      bspOverlayCount: this.bspOverlayCount,
      textureUAxisVAO: this.textureUAxisVAO,
      textureUAxisCount: this.textureUAxisCount,
      textureVAxisVAO: this.textureVAxisVAO,
      textureVAxisCount: this.textureVAxisCount,
      textureNormalVAO: this.textureNormalVAO,
      textureNormalCount: this.textureNormalCount,
      paintPreviewVAO: this.paintPreviewVAO,
      paintPreviewCount: this.paintPreviewCount,
      lineVAO: this.lineVAO,
      lineCount: this.lineCount,
      wireVAO: this.wireVAO,
      wireCount: this.wireCount,
      entityMarkerWireDraws: this.entityMarkerWireDraws,
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
      xray: this.captureXray,
    });
  }

  private getForward(): Vec3 {
    return getViewport3DForward(this.yaw, this.pitch);
  }

  private getRight(): Vec3 {
    return getViewport3DRight(this.yaw);
  }

  private updateCamera(dt: number): void {
    const previousPosition: Vec3 = [...this.position];
    const result = updateViewport3DCamera({
      editor: this.editor,
      fullscreen: this.fullscreen,
      fullscreenMode: this.fullscreenMode,
      looking: this.looking,
      keys: this.keys,
      moveSpeed: this.moveSpeed,
      projection: this.projection,
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
    if (this.projection === 'orthographic') {
      this.projectionFocus = vec3Add(
        this.projectionFocus,
        vec3Sub(this.position, previousPosition),
      );
    }
    this.physicsAccum = result.physicsAccum;
    this.walkStepSmooth = result.walkStepSmooth;
    this.walkViewH = result.walkViewH;
    this.walkLandChange = result.walkLandChange;
    this.walkLandTime = result.walkLandTime;
    this.walkBobCycle = result.walkBobCycle;
    this.editor.redrawRequested = true;
  }

  // ── Ray picking in 3D ──

  private getRay(screenX: number, screenY: number): { rayOrigin: Vec3; rayDir: Vec3 } {
    return getRay3D({
      canvas: this.canvas,
      editor: this.editor,
      position: this.position,
      projection: this.projection,
      orthographicScale: this.orthographicScale,
      fov: this.fov,
      getForward: () => this.getForward(),
    }, screenX, screenY);
  }

  private terrainHeightAxis(patch: Patch): number {
    const extents = [
      patch.maxs[0] - patch.mins[0],
      patch.maxs[1] - patch.mins[1],
      patch.maxs[2] - patch.mins[2],
    ];
    let axis = 0;
    for (let i = 1; i < 3; i++) {
      if (extents[i] < extents[axis]) axis = i;
    }
    return axis;
  }

  private terrainPlanarAxes(patch: Patch): [number, number] {
    const heightAxis = this.terrainHeightAxis(patch);
    if (heightAxis === 0) return [1, 2];
    if (heightAxis === 1) return [0, 2];
    return [0, 1];
  }

  private isPatchInPatchEdit(patch: Patch): boolean {
    return this.editor.patchEditData.some(data => data.patch === patch);
  }

  private terrainHoverMatchesOwnedState(): boolean {
    if (!this.terrainHoverOwned || !this.terrainHoverCenter || !this.terrainHoverAxes) return false;
    if (!this.editor.terrainBrushCenter || !this.editor.terrainBrushAxes) return false;
    return this.editor.terrainBrushAxes[0] === this.terrainHoverAxes[0]
      && this.editor.terrainBrushAxes[1] === this.terrainHoverAxes[1]
      && this.editor.terrainBrushCenter[0] === this.terrainHoverCenter[0]
      && this.editor.terrainBrushCenter[1] === this.terrainHoverCenter[1]
      && this.editor.terrainBrushCenter[2] === this.terrainHoverCenter[2];
  }

  private clearTerrainHover(): void {
    if (!this.terrainHoverOwned) return;
    if (this.terrainHoverMatchesOwnedState()) {
      this.editor.terrainBrushCenter = null;
      this.editor.terrainBrushAxes = null;
      this.editor.redrawRequested = true;
    }
    this.terrainHoverOwned = false;
    this.terrainHoverCenter = null;
    this.terrainHoverAxes = null;
  }

  private updateTerrainHover(screenX: number, screenY: number): void {
    if (this.looking || this.gizmo.dragging) return;
    if (!this.editor.patchEditMode || this.editor.terrainBrushMode !== 'texture') {
      this.clearTerrainHover();
      return;
    }

    const hit = this.pickPatchAt(screenX, screenY);
    if (!hit || !this.isPatchInPatchEdit(hit.patch)) {
      this.clearTerrainHover();
      return;
    }

    const axes = this.terrainPlanarAxes(hit.patch);
    const center: Vec3 = [hit.point[0], hit.point[1], hit.point[2]];
    const changed = !this.terrainHoverOwned
      || !this.terrainHoverCenter
      || !this.terrainHoverAxes
      || this.terrainHoverAxes[0] !== axes[0]
      || this.terrainHoverAxes[1] !== axes[1]
      || this.terrainHoverCenter[0] !== center[0]
      || this.terrainHoverCenter[1] !== center[1]
      || this.terrainHoverCenter[2] !== center[2];
    if (!changed) return;

    this.terrainHoverOwned = true;
    this.terrainHoverAxes = axes;
    this.terrainHoverCenter = center;
    this.editor.terrainBrushAxes = [axes[0], axes[1]];
    this.editor.terrainBrushCenter = [center[0], center[1], center[2]];
    this.editor.redrawRequested = true;
  }

  pickBrushAt(screenX: number, screenY: number): { entity: Entity; brush: Brush; face: BrushFace } | null {
    return pickBrushAt3D({
      canvas: this.canvas,
      editor: this.editor,
      position: this.position,
      projection: this.projection,
      orthographicScale: this.orthographicScale,
      fov: this.fov,
      getForward: () => this.getForward(),
    }, screenX, screenY);
  }

  pickPatchAt(screenX: number, screenY: number): { entity: Entity; patch: Patch; dist: number; point: Vec3 } | null {
    return pickPatchAt3D({
      canvas: this.canvas,
      editor: this.editor,
      position: this.position,
      projection: this.projection,
      orthographicScale: this.orthographicScale,
      fov: this.fov,
      getForward: () => this.getForward(),
    }, screenX, screenY);
  }

  pickEntityAt(screenX: number, screenY: number): { entity: Entity; dist: number } | null {
    return pickEntityAt3D({
      canvas: this.canvas,
      editor: this.editor,
      position: this.position,
      projection: this.projection,
      orthographicScale: this.orthographicScale,
      fov: this.fov,
      getForward: () => this.getForward(),
    }, screenX, screenY);
  }

  // ── Picking / selection on click ──

  private handlePick(e: MouseEvent): void {
    handleViewport3DPick({
      editor: this.editor,
      dragStart: this.dragStart,
      getRay: (screenX, screenY) => this.getRay(screenX, screenY),
      pickBrushAt: (screenX, screenY) => this.pickBrushAt(screenX, screenY),
      pickPatchAt: (screenX, screenY) => this.pickPatchAt(screenX, screenY),
      pickEntityAt: (screenX, screenY) => this.pickEntityAt(screenX, screenY),
    }, e);
  }

  private handleDoublePick(e: MouseEvent): void {
    handleViewport3DDoublePick({
      editor: this.editor,
      dragStart: this.dragStart,
      getRay: (screenX, screenY) => this.getRay(screenX, screenY),
      pickBrushAt: (screenX, screenY) => this.pickBrushAt(screenX, screenY),
      pickPatchAt: (screenX, screenY) => this.pickPatchAt(screenX, screenY),
      pickEntityAt: (screenX, screenY) => this.pickEntityAt(screenX, screenY),
    }, e);
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
        const axis = this.gizmo.pickAxis(
          e.clientX,
          e.clientY,
          this.lastPV,
          rect,
          this.position,
          this.projection,
          this.orthographicScale,
        );
        if (axis >= 0) {
          this.gizmo.startDrag(
            axis,
            e.clientX,
            e.clientY,
            this.lastPV,
            rect,
            this.position,
            this.projection,
            this.orthographicScale,
          );
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

    el.addEventListener('mousemove', (e) => {
      this.updateTerrainHover(e.clientX, e.clientY);
    });
    el.addEventListener('mouseleave', () => {
      this.clearTerrainHover();
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
      if (this.projection === 'orthographic') {
        this.position = vec3Sub(
          this.projectionFocus,
          vec3Scale(this.getForward(), this.projectionDistance),
        );
        this.isometricDirection = null;
        this.updateProjectionLabel();
      }
      this.editor.redrawRequested = true;
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
          if (e.detail >= 2) this.handleDoublePick(e);
          else this.handlePick(e);
        }
        return;
      }

      // Edit mode: left-click selects geometry directly (no pointer lock involved)
      if (isEditMode && e.button === 0 && !this.didDrag) {
        if (e.detail >= 2) this.handleDoublePick(e);
        else this.handlePick(e);
      }
    });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.projection === 'orthographic' && !this.fullscreen) {
        const worldPerPixel = 2 * this.orthographicScale
          / Math.max(1, this.canvas.getBoundingClientRect().height);
        const right = this.getRight();
        const up = vec3Cross(right, this.getForward());
        let pan: Vec3 = vec3Scale(right, e.deltaX * worldPerPixel);
        if (e.shiftKey) {
          pan = vec3Add(pan, vec3Scale(up, e.deltaY * worldPerPixel));
        } else {
          this.orthographicScale = clampOrthographicScale(
            this.orthographicScale * Math.exp(e.deltaY * 0.0015),
          );
        }
        this.position = vec3Add(this.position, pan);
        this.projectionFocus = vec3Add(this.projectionFocus, pan);
      } else if (e.ctrlKey || e.metaKey) {
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
      this.editor.redrawRequested = true;
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
