import { Mat4, mat4LookAt, mat4Multiply, mat4Perspective, vec3Add } from './math';
import { Editor } from './editor';
import { BlendMode } from './textures';
import { entityOrigin, parseLightColor } from './entity';

export interface DrawGroup {
  textureName: string;
  start: number;
  count: number;
  selected: boolean;
  faceSelected: boolean;
  blendMode: BlendMode;
  invisible: boolean;
  solidOverride: boolean;
}

export interface LightRadiusDraw {
  start: number;
  count: number;
  color: [number, number, number];
}

interface GizmoSegment {
  start: number;
  count: number;
  color: [number, number, number];
}

interface GizmoRenderData {
  vao: WebGLVertexArrayObject;
  segments: GizmoSegment[];
  dragging: boolean;
  axis: number;
}

export interface Viewport3DRenderContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  editor: Editor;
  fullscreen: boolean;
  fullscreenMode: 'walk' | 'fly' | 'edit';
  position: [number, number, number];
  fov: number;
  getForward: () => [number, number, number];
  solidProg: WebGLProgram;
  solidPVLoc: WebGLUniformLocation;
  solidTexLoc: WebGLUniformLocation;
  solidSelLoc: WebGLUniformLocation;
  solidFaceSelLoc: WebGLUniformLocation;
  solidUseAlphaLoc: WebGLUniformLocation;
  solidAlphaOverrideLoc: WebGLUniformLocation;
  solidSolidOverrideLoc: WebGLUniformLocation;
  solidDynamicLightCountLoc: WebGLUniformLocation;
  solidDynamicLightPosLoc: WebGLUniformLocation;
  solidDynamicLightColorLoc: WebGLUniformLocation;
  solidDynamicLightRadiusLoc: WebGLUniformLocation;
  lineProg: WebGLProgram;
  linePVLoc: WebGLUniformLocation;
  lineColorLoc: WebGLUniformLocation;
  solidVAO: WebGLVertexArrayObject;
  drawGroups: DrawGroup[];
  clipBoxVAO: WebGLVertexArrayObject;
  clipBoxCount: number;
  pathLineVAO: WebGLVertexArrayObject;
  pathLineCount: number;
  pathLineSelVAO: WebGLVertexArrayObject;
  pathLineSelCount: number;
  pathCurveVAO: WebGLVertexArrayObject;
  pathCurveCount: number;
  pathCurveSelVAO: WebGLVertexArrayObject;
  pathCurveSelCount: number;
  pointfileLineVAO: WebGLVertexArrayObject;
  pointfileLineCount: number;
  pointfileMarkerVAO: WebGLVertexArrayObject;
  pointfileMarkerCount: number;
  paintPreviewVAO: WebGLVertexArrayObject;
  paintPreviewCount: number;
  lineVAO: WebGLVertexArrayObject;
  lineCount: number;
  wireVAO: WebGLVertexArrayObject;
  wireCount: number;
  faceSelVAO: WebGLVertexArrayObject;
  faceSelCount: number;
  vtxHandleVAO: WebGLVertexArrayObject;
  vtxHandleCount: number;
  vtxHandleSelVAO: WebGLVertexArrayObject;
  vtxHandleSelCount: number;
  gridVAO: WebGLVertexArrayObject;
  gridCount: number;
  lightRadiusVAO: WebGLVertexArrayObject;
  lightRadiusDraws: LightRadiusDraw[];
  gizmo: GizmoRenderData;
}

export function renderViewport3D(ctx: Viewport3DRenderContext): Mat4 {
  const dpr = window.devicePixelRatio || 1;
  const rect = ctx.canvas.getBoundingClientRect();
  ctx.canvas.width = rect.width * dpr;
  ctx.canvas.height = rect.height * dpr;
  ctx.gl.viewport(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.gl.clear(ctx.gl.COLOR_BUFFER_BIT | ctx.gl.DEPTH_BUFFER_BIT);

  const aspect = ctx.canvas.width / ctx.canvas.height || 1;
  const proj = mat4Perspective(ctx.fov, aspect, 1, 16384);
  const forward = ctx.getForward();
  const target = vec3Add(ctx.position, forward);
  const view = mat4LookAt(ctx.position, target, [0, 0, 1]);
  const pv = mat4Multiply(proj, view);

  const isGameView = ctx.fullscreen && ctx.fullscreenMode !== 'edit';
  if (!isGameView) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.uniform3f(ctx.lineColorLoc, 0.2, 0.2, 0.22);
    ctx.gl.bindVertexArray(ctx.gridVAO);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.gridCount);
  }

  if (ctx.drawGroups.length > 0 && ctx.editor.display.rendererMode !== 'wireframe') {
    ctx.gl.useProgram(ctx.solidProg);
    ctx.gl.uniformMatrix4fv(ctx.solidPVLoc, false, pv);
    ctx.gl.uniform1i(ctx.solidTexLoc, 0);
    const lights = ctx.editor.display.dynamicLights
      ? [...ctx.editor.pointEntities()].filter(entity => entity.classname === 'light' && ctx.editor.isEntityVisibleIn3D(entity)).slice(0, 4)
      : [];
    const positions = new Float32Array(12); const colors = new Float32Array(12); const radii = new Float32Array(4);
    lights.forEach((entity, index) => {
      const origin = entityOrigin(entity) ?? [0, 0, 0]; const color = parseLightColor(entity) ?? [1, 1, 1];
      positions.set(origin, index * 3); colors.set(color, index * 3);
      radii[index] = Math.max(1, Number(entity.properties.light) || 300);
    });
    ctx.gl.uniform1i(ctx.solidDynamicLightCountLoc, lights.length);
    ctx.gl.uniform3fv(ctx.solidDynamicLightPosLoc, positions);
    ctx.gl.uniform3fv(ctx.solidDynamicLightColorLoc, colors);
    ctx.gl.uniform1fv(ctx.solidDynamicLightRadiusLoc, radii);
    ctx.gl.activeTexture(ctx.gl.TEXTURE0);
    ctx.gl.bindVertexArray(ctx.solidVAO);

    const drawGroup = (group: DrawGroup) => {
      const tm = ctx.editor.textureManager;
      if (tm) {
        const textureName = ctx.editor.display.rendererMode === 'textured' ? group.textureName : '__white';
        const texInfo = tm.get(textureName);
        tm.bind(texInfo, ctx.editor.display.textureFiltering);
      }
      const hideSelection = ctx.fullscreen && ctx.fullscreenMode !== 'edit';
      ctx.gl.uniform1f(ctx.solidSelLoc, !hideSelection && group.selected ? 1.0 : 0.0);
      ctx.gl.uniform1f(ctx.solidFaceSelLoc, !hideSelection && group.faceSelected ? 1.0 : 0.0);
      const isDimInvis = group.invisible && ctx.editor.invisibleMode === 'dim';
      ctx.gl.uniform1f(ctx.solidAlphaOverrideLoc, isDimInvis ? 0.3 : 0.0);
      ctx.gl.uniform1f(ctx.solidSolidOverrideLoc, group.solidOverride ? 1.0 : 0.0);
      ctx.gl.drawArrays(ctx.gl.TRIANGLES, group.start, group.count);
    };

    ctx.gl.uniform1f(ctx.solidUseAlphaLoc, 0.0);
    ctx.gl.uniform1f(ctx.solidAlphaOverrideLoc, 0.0);
    for (const group of ctx.drawGroups) {
      if (group.blendMode !== 'opaque') continue;
      drawGroup(group);
    }

    let hasTransparent = false;
    for (const group of ctx.drawGroups) {
      if (group.blendMode === 'opaque') continue;
      if (!hasTransparent) {
        ctx.gl.enable(ctx.gl.BLEND);
        hasTransparent = true;
      }
      const isDimInvis = group.invisible && ctx.editor.invisibleMode === 'dim';
      ctx.gl.depthMask(isDimInvis);
      if (group.blendMode === 'add') {
        ctx.gl.blendFunc(ctx.gl.ONE, ctx.gl.ONE);
        ctx.gl.uniform1f(ctx.solidUseAlphaLoc, 0.0);
      } else {
        ctx.gl.blendFunc(ctx.gl.SRC_ALPHA, ctx.gl.ONE_MINUS_SRC_ALPHA);
        ctx.gl.uniform1f(ctx.solidUseAlphaLoc, 1.0);
      }
      drawGroup(group);
    }
    if (hasTransparent) {
      ctx.gl.disable(ctx.gl.BLEND);
      ctx.gl.depthMask(true);
    }
  }

  if ((!isGameView || ctx.editor.display.rendererMode === 'wireframe') && ctx.wireCount > 0) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.uniform3f(ctx.lineColorLoc, 0.0, 0.0, 0.0);
    ctx.gl.bindVertexArray(ctx.wireVAO);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.wireCount);
  }

  if (!isGameView && ctx.clipBoxCount > 0) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.uniform3f(ctx.lineColorLoc, 0.45, 0.7, 1.0);
    ctx.gl.disable(ctx.gl.DEPTH_TEST);
    ctx.gl.bindVertexArray(ctx.clipBoxVAO);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.clipBoxCount);
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
  }

  if (!isGameView && (ctx.pathLineCount > 0 || ctx.pathLineSelCount > 0)) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.disable(ctx.gl.DEPTH_TEST);
    if (ctx.pathLineCount > 0) {
      ctx.gl.uniform3f(ctx.lineColorLoc, 0.45, 0.76, 1.0);
      ctx.gl.bindVertexArray(ctx.pathLineVAO);
      ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.pathLineCount);
    }
    if (ctx.pathLineSelCount > 0) {
      ctx.gl.uniform3f(ctx.lineColorLoc, 1.0, 0.67, 0.0);
      ctx.gl.bindVertexArray(ctx.pathLineSelVAO);
      ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.pathLineSelCount);
    }
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
  }

  if (!isGameView && (ctx.pathCurveCount > 0 || ctx.pathCurveSelCount > 0)) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.disable(ctx.gl.DEPTH_TEST);
    if (ctx.pathCurveCount > 0) {
      ctx.gl.uniform3f(ctx.lineColorLoc, 0.38, 0.85, 0.55);
      ctx.gl.bindVertexArray(ctx.pathCurveVAO);
      ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.pathCurveCount);
    }
    if (ctx.pathCurveSelCount > 0) {
      ctx.gl.uniform3f(ctx.lineColorLoc, 1.0, 0.88, 0.3);
      ctx.gl.bindVertexArray(ctx.pathCurveSelVAO);
      ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.pathCurveSelCount);
    }
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
  }

  if (!isGameView && (ctx.pointfileLineCount > 0 || ctx.pointfileMarkerCount > 0)) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.disable(ctx.gl.DEPTH_TEST);
    if (ctx.pointfileLineCount > 0) {
      ctx.gl.uniform3f(ctx.lineColorLoc, 1.0, 0.25, 0.25);
      ctx.gl.bindVertexArray(ctx.pointfileLineVAO);
      ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.pointfileLineCount);
    }
    if (ctx.pointfileMarkerCount > 0) {
      ctx.gl.uniform3f(ctx.lineColorLoc, 1.0, 0.8, 0.1);
      ctx.gl.bindVertexArray(ctx.pointfileMarkerVAO);
      ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.pointfileMarkerCount);
    }
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
  }

  if (!isGameView && ctx.lightRadiusDraws.length > 0) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.bindVertexArray(ctx.lightRadiusVAO);
    for (const draw of ctx.lightRadiusDraws) {
      ctx.gl.uniform3f(ctx.lineColorLoc, draw.color[0], draw.color[1], draw.color[2]);
      ctx.gl.drawArrays(ctx.gl.LINES, draw.start, draw.count);
    }
  }

  const showSelection = !ctx.fullscreen || ctx.fullscreenMode === 'edit';

  if (showSelection && ctx.lineCount > 0) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.uniform3f(ctx.lineColorLoc, 1.0, 0.5, 0.0);
    ctx.gl.disable(ctx.gl.DEPTH_TEST);
    ctx.gl.bindVertexArray(ctx.lineVAO);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.lineCount);
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
  }

  if (showSelection && ctx.paintPreviewCount > 0) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.uniform3f(ctx.lineColorLoc, 0.96, 0.86, 0.24);
    ctx.gl.disable(ctx.gl.DEPTH_TEST);
    ctx.gl.bindVertexArray(ctx.paintPreviewVAO);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.paintPreviewCount);
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
  }

  if (showSelection && ctx.faceSelCount > 0) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.uniform3f(ctx.lineColorLoc, 0.2, 0.8, 1.0);
    ctx.gl.disable(ctx.gl.DEPTH_TEST);
    ctx.gl.lineWidth(2);
    ctx.gl.bindVertexArray(ctx.faceSelVAO);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.faceSelCount);
    ctx.gl.lineWidth(1);
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
  }

  if (showSelection && (ctx.vtxHandleCount > 0 || ctx.vtxHandleSelCount > 0)) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.disable(ctx.gl.DEPTH_TEST);
    if (ctx.vtxHandleCount > 0) {
      ctx.gl.uniform3f(ctx.lineColorLoc, 0.2, 0.9, 0.2);
      ctx.gl.bindVertexArray(ctx.vtxHandleVAO);
      ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.vtxHandleCount);
    }
    if (ctx.vtxHandleSelCount > 0) {
      ctx.gl.uniform3f(ctx.lineColorLoc, 1.0, 1.0, 1.0);
      ctx.gl.bindVertexArray(ctx.vtxHandleSelVAO);
      ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.vtxHandleSelCount);
    }
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
  }

  if (showSelection && ctx.gizmo.segments.length > 0) {
    ctx.gl.useProgram(ctx.lineProg);
    ctx.gl.uniformMatrix4fv(ctx.linePVLoc, false, pv);
    ctx.gl.disable(ctx.gl.DEPTH_TEST);
    ctx.gl.bindVertexArray(ctx.gizmo.vao);
    for (let i = 0; i < ctx.gizmo.segments.length; i++) {
      const seg = ctx.gizmo.segments[i];
      const c = seg.color;
      const bright = ctx.gizmo.dragging && ctx.gizmo.axis === i ? 1.5 : 1.0;
      ctx.gl.uniform3f(ctx.lineColorLoc, c[0] * bright, c[1] * bright, c[2] * bright);
      ctx.gl.drawArrays(ctx.gl.LINES, seg.start, seg.count);
    }
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
  }

  ctx.gl.bindVertexArray(null);
  return pv;
}
