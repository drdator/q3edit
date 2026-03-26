import { Vec3, vec3Copy, snapAxisDelta, findNearestSnap } from './math';
import { Editor } from './editor';
import { Brush, scaleBrushFaces, rotateBrush } from './brush';
import { Patch, PatchControlPoint, scalePatchControlPoints, rotatePatch } from './patch';
import { pickVertex2D } from './vertex';
import { rotateBrushLocked } from './texture-lock';
import {
  getSelectedBrushItems,
  getSelectedPatchItems,
  hasDirectGeometrySelection,
  isBrushDirectlySelected,
  isPatchDirectlySelected,
} from './editor-selection';
import {
  detectResizeEdge as detectResizeEdge2D,
  getResizeCursor as getResizeCursor2D,
  pickAt as pickAt2D,
  ResizeEdges,
} from './viewport2d-picking';

interface RotateBrushOriginal {
  brush: Brush;
  points: [Vec3, Vec3, Vec3][];
  planes: { normal: Vec3; dist: number }[];
  polygons: Vec3[][];
  textures: { offsetX: number; offsetY: number; rotation: number; scaleX: number; scaleY: number }[];
}

interface RotatePatchOriginal {
  patch: Patch;
  ctrl: { xyz: Vec3; uv: [number, number] }[][];
}

export interface Viewport2DInteractionState {
  spaceDown: boolean;
  dragging: boolean;
  panning: boolean;
  dragStart: [number, number];
  dragWorldStart: [number, number];
  panStart: [number, number];
  panCenterStart: [number, number];
  hasDragged: boolean;
  moveSnapshotTaken: boolean;
  resizing: boolean;
  resizeEdges: ResizeEdges;
  resizeBrushes: { brush: Brush; origPoints: [Vec3, Vec3, Vec3][] }[];
  resizePatches: { patch: Patch; origCtrl: PatchControlPoint[][] }[];
  resizeOrigMins: Vec3;
  resizeOrigMaxs: Vec3;
  resizeSnapshotTaken: boolean;
  rubberBanding: boolean;
  rubberBandStart: [number, number];
  rubberBandEnd: [number, number];
  rubberBandAdditive: boolean;
  vertexDragging: boolean;
  vertexDragSnapshotTaken: boolean;
  geoSnapTargets: [number[], number[], number[]] | null;
  geoSnapLines: { axis: 'h' | 'v'; value: number }[];
  rotating: boolean;
  rotateStartAngle: number;
  rotateAppliedAngle: number;
  rotateBrushOriginals: RotateBrushOriginal[];
  rotatePatchOriginals: RotatePatchOriginal[];
  rotateSnapshotTaken: boolean;
  anchorDragging: boolean;
}

export interface Viewport2DInteractionContext {
  canvas: HTMLCanvasElement;
  editor: Editor;
  axisH: number;
  axisV: number;
  axisDepth: number;
  axisLabels: [string, string];
  centerX: number;
  centerY: number;
  zoom: number;
  interaction: Viewport2DInteractionState;
  screenToWorld: (sx: number, sy: number) => [number, number];
}

export function createViewport2DInteractionState(): Viewport2DInteractionState {
  return {
    spaceDown: false,
    dragging: false,
    panning: false,
    dragStart: [0, 0],
    dragWorldStart: [0, 0],
    panStart: [0, 0],
    panCenterStart: [0, 0],
    hasDragged: false,
    moveSnapshotTaken: false,
    resizing: false,
    resizeEdges: { minH: false, maxH: false, minV: false, maxV: false },
    resizeBrushes: [],
    resizePatches: [],
    resizeOrigMins: [0, 0, 0],
    resizeOrigMaxs: [0, 0, 0],
    resizeSnapshotTaken: false,
    rubberBanding: false,
    rubberBandStart: [0, 0],
    rubberBandEnd: [0, 0],
    rubberBandAdditive: false,
    vertexDragging: false,
    vertexDragSnapshotTaken: false,
    geoSnapTargets: null,
    geoSnapLines: [],
    rotating: false,
    rotateStartAngle: 0,
    rotateAppliedAngle: 0,
    rotateBrushOriginals: [],
    rotatePatchOriginals: [],
    rotateSnapshotTaken: false,
    anchorDragging: false,
  };
}

export function setupViewport2DInteraction(ctx: Viewport2DInteractionContext): void {
  const el = ctx.canvas.parentElement!;

  el.addEventListener('mousedown', (e) => handleViewport2DMouseDown(ctx, e));
  el.addEventListener('dblclick', (e) => handleViewport2DDoubleClick(ctx, e));
  document.addEventListener('mousemove', (e) => {
    if (ctx.interaction.panning || ctx.interaction.dragging || ctx.interaction.resizing || ctx.interaction.rubberBanding) {
      handleViewport2DMouseMove(ctx, e);
    } else {
      const rect = ctx.canvas.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        handleViewport2DMouseMove(ctx, e);
      }
    }
  });
  document.addEventListener('mouseup', (e) => handleViewport2DMouseUp(ctx, e));
  el.addEventListener('wheel', (e) => handleViewport2DWheel(ctx, e), { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) {
      ctx.interaction.spaceDown = true;
      el.style.cursor = 'grab';
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      ctx.interaction.spaceDown = false;
      if (!ctx.interaction.panning) el.style.cursor = '';
    }
  });
}

function getLocalPos(ctx: Viewport2DInteractionContext, e: { clientX: number; clientY: number }): [number, number] {
  const rect = ctx.canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

function snapPlanarPoint(
  ctx: Viewport2DInteractionContext,
  wx: number,
  wy: number,
  ctrlKey: boolean,
  snapToGeometry: boolean,
  targets: [number[], number[], number[]] | null = null,
): Vec3 {
  const grid = ctx.editor.effectiveGrid(ctrlKey);
  const point: Vec3 = [0, 0, 0];
  point[ctx.axisH] = Math.round(wx / grid) * grid;
  point[ctx.axisV] = Math.round(wy / grid) * grid;

  if (snapToGeometry) {
    const snapTargets = targets ?? ctx.editor.collectSnapTargets(true);
    const threshold = 8 / ctx.zoom;
    const snapH = findNearestSnap(wx, snapTargets[ctx.axisH], threshold);
    const snapV = findNearestSnap(wy, snapTargets[ctx.axisV], threshold);
    if (snapH !== null && Math.abs(snapH - wx) < Math.abs(point[ctx.axisH] - wx)) point[ctx.axisH] = snapH;
    if (snapV !== null && Math.abs(snapV - wy) < Math.abs(point[ctx.axisV] - wy)) point[ctx.axisV] = snapV;
  }

  return point;
}

export function handleViewport2DMouseDown(ctx: Viewport2DInteractionContext, e: MouseEvent): void {
  const state = ctx.interaction;
  ctx.editor.rotationAxis = ctx.axisDepth;
  ctx.editor.nudgeAxisH = ctx.axisH;
  ctx.editor.nudgeAxisV = ctx.axisV;
  const [mx, my] = getLocalPos(ctx, e);

  if (e.button === 2 || e.button === 1 || (e.button === 0 && state.spaceDown)) {
    state.panning = true;
    state.panStart = [mx, my];
    state.panCenterStart = [ctx.centerX, ctx.centerY];
    ctx.canvas.parentElement!.style.cursor = 'grabbing';
    return;
  }

  if (e.button !== 0) return;

  const [wx, wy] = ctx.screenToWorld(mx, my);

  if (ctx.editor.activeTool === 'create') {
    const snapped = snapPlanarPoint(ctx, wx, wy, e.ctrlKey, false);
    snapped[ctx.axisDepth] = 0;
    ctx.editor.creating = true;
    ctx.editor.createStart = vec3Copy(snapped);
    ctx.editor.createEnd = vec3Copy(snapped);
    ctx.editor.createAxisH = ctx.axisH;
    ctx.editor.createAxisV = ctx.axisV;
    state.dragging = true;
    state.hasDragged = false;
    return;
  }

  if (ctx.editor.activeTool === 'entity') {
    ctx.editor.snapshot();
    const origin = snapPlanarPoint(ctx, wx, wy, e.ctrlKey, false);
    origin[ctx.axisDepth] = 0;
    const entity = ctx.editor.addEntity(ctx.editor.currentEntityClass, origin, e.ctrlKey);
    ctx.editor.clearSelection();
    ctx.editor.selectEntity(entity);
    ctx.editor.statusMessage = `Placed ${ctx.editor.currentEntityClass}`;
    return;
  }

  if (ctx.editor.activeTool === 'clip') {
    const point = snapPlanarPoint(ctx, wx, wy, e.ctrlKey, ctx.editor.snapToGeometry);
    ctx.editor.addClipPoint(point, ctx.axisDepth);
    return;
  }

  if (ctx.editor.activeTool === 'rotate') {
    if (!ctx.editor.rotateAnchor || e.altKey) {
      ctx.editor.rotateAnchor = snapPlanarPoint(ctx, wx, wy, e.ctrlKey, ctx.editor.snapToGeometry);
      state.anchorDragging = true;
      state.geoSnapTargets = ctx.editor.snapToGeometry ? ctx.editor.collectSnapTargets(true) : null;
      state.dragging = true;
      state.hasDragged = false;
      ctx.editor.statusMessage = 'Drag to position anchor';
      ctx.editor.dirty = true;
    } else if (ctx.editor.selection.length > 0) {
      const anchor = ctx.editor.rotateAnchor;
      state.rotateStartAngle = Math.atan2(wy - anchor[ctx.axisV], wx - anchor[ctx.axisH]);
      state.rotateAppliedAngle = 0;
      state.rotating = true;
      state.rotateSnapshotTaken = false;
      state.dragging = true;
      state.hasDragged = false;
      state.rotateBrushOriginals = getSelectedBrushItems(ctx.editor).map(({ brush }) => ({
        brush,
        points: brush.faces.map(f =>
          [vec3Copy(f.points[0]), vec3Copy(f.points[1]), vec3Copy(f.points[2])] as [Vec3, Vec3, Vec3]
        ),
        planes: brush.faces.map(f => ({
          normal: vec3Copy(f.plane.normal),
          dist: f.plane.dist,
        })),
        polygons: brush.faces.map(f => f.polygon.map(v => vec3Copy(v))),
        textures: brush.faces.map(f => ({
          offsetX: f.offsetX,
          offsetY: f.offsetY,
          rotation: f.rotation,
          scaleX: f.scaleX,
          scaleY: f.scaleY,
        })),
      }));
      state.rotatePatchOriginals = getSelectedPatchItems(ctx.editor).map(({ patch }) => ({
        patch,
        ctrl: patch.ctrl.map(row =>
          row.map(cp => ({ xyz: vec3Copy(cp.xyz), uv: [cp.uv[0], cp.uv[1]] as [number, number] }))
        ),
      }));
    }
    return;
  }

  if (ctx.editor.vertexMode) {
    const threshold = 8 / ctx.zoom;
    let hitDi = -1;
    let hitVi = -1;
    for (let di = 0; di < ctx.editor.vertexData.length; di++) {
      const vi = pickVertex2D(ctx.editor.vertexData[di].vertices, wx, wy, ctx.axisH, ctx.axisV, ctx.axisDepth, threshold);
      if (vi >= 0) {
        hitDi = di;
        hitVi = vi;
        break;
      }
    }
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (hitDi >= 0) {
      const wasSelected = ctx.editor.isVertexSelected(hitDi, hitVi);
      ctx.editor.selectVertex(hitDi, hitVi, additive);
      if (wasSelected || !additive) {
        state.vertexDragging = true;
        state.vertexDragSnapshotTaken = false;
        state.dragging = true;
        state.hasDragged = false;
        state.dragWorldStart = [wx, wy];
        state.geoSnapTargets = ctx.editor.snapToGeometry ? ctx.editor.collectSnapTargets() : null;
        state.geoSnapLines = [];
      }
    } else if (!additive) {
      ctx.editor.clearVertexSelection();
    }
    return;
  }

  if (ctx.editor.patchEditMode) {
    const threshold = 8 / ctx.zoom;
    let hitDi = -1;
    let hitR = -1;
    let hitC = -1;
    let bestDist = threshold;
    for (let di = 0; di < ctx.editor.patchEditData.length; di++) {
      const patch = ctx.editor.patchEditData[di].patch;
      for (let r = 0; r < patch.height; r++) {
        for (let c = 0; c < patch.width; c++) {
          const p = patch.ctrl[r][c].xyz;
          const dx = Math.abs(wx - p[ctx.axisH]);
          const dy = Math.abs(wy - p[ctx.axisV]);
          const dist = Math.max(dx, dy);
          if (dist < bestDist) {
            bestDist = dist;
            hitDi = di;
            hitR = r;
            hitC = c;
          }
        }
      }
    }
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (hitDi >= 0) {
      const wasSelected = ctx.editor.isControlPointSelected(hitDi, hitR, hitC);
      ctx.editor.selectControlPoint(hitDi, hitR, hitC, additive);
      if (wasSelected || !additive) {
        state.vertexDragging = true;
        state.vertexDragSnapshotTaken = false;
        state.dragging = true;
        state.hasDragged = false;
        state.dragWorldStart = [wx, wy];
        state.geoSnapTargets = ctx.editor.snapToGeometry ? ctx.editor.collectSnapTargets() : null;
        state.geoSnapLines = [];
      }
    } else if (!additive) {
      ctx.editor.clearControlPointSelection();
    }
    return;
  }

  const selectedBrushItems = getSelectedBrushItems(ctx.editor);
  const selectedPatchItems = getSelectedPatchItems(ctx.editor);
  const canResize = ctx.editor.activeTool === 'select' && ctx.editor.gizmoMode === 'scale' && ctx.editor.selection.length > 0
    && (selectedBrushItems.length > 0 || selectedPatchItems.length > 0);
  if (canResize) {
    const edge = detectResizeEdge2D(ctx, wx, wy);
    if (edge) {
      const bounds = ctx.editor.selectionBounds()!;
      state.resizing = true;
      state.resizeEdges = edge.edges;
      state.resizeBrushes = selectedBrushItems.map(({ brush }) => ({
        brush,
        origPoints: brush.faces.map(f =>
          [vec3Copy(f.points[0]), vec3Copy(f.points[1]), vec3Copy(f.points[2])] as [Vec3, Vec3, Vec3]
        ),
      }));
      state.resizePatches = selectedPatchItems.map(({ patch }) => ({
        patch,
        origCtrl: patch.ctrl.map(row =>
          row.map(cp => ({ xyz: vec3Copy(cp.xyz), uv: [cp.uv[0], cp.uv[1]] as [number, number] }))
        ),
      }));
      state.resizeOrigMins = vec3Copy(bounds.mins);
      state.resizeOrigMaxs = vec3Copy(bounds.maxs);
      state.resizeSnapshotTaken = false;
      state.dragWorldStart = [wx, wy];
      state.geoSnapTargets = ctx.editor.snapToGeometry ? ctx.editor.collectSnapTargets() : null;
      state.geoSnapLines = [];
      return;
    }
  }

  const picked = pickAt2D(ctx, wx, wy);
  const additive = e.ctrlKey || e.metaKey || e.shiftKey;
  if (picked) {
    const directGroupEditing = picked.type !== 'entity' &&
      picked.entity !== ctx.editor.worldspawn &&
      hasDirectGeometrySelection(ctx.editor, picked.entity);
    const alreadySelected = picked.type === 'brush'
      ? (directGroupEditing ? isBrushDirectlySelected(ctx.editor, picked.brush) : ctx.editor.isSelected(picked.brush))
      : picked.type === 'patch'
        ? (directGroupEditing ? isPatchDirectlySelected(ctx.editor, picked.patch) : ctx.editor.isPatchSelected(picked.patch))
        : ctx.editor.isEntitySelected(picked.entity);

    if (!additive && !alreadySelected) {
      ctx.editor.clearSelection();
    }

    if (additive || !alreadySelected) {
      if (picked.type === 'brush') {
        if (directGroupEditing) ctx.editor.selectBrushDirect(picked.entity, picked.brush, additive);
        else ctx.editor.selectBrush(picked.entity, picked.brush, additive);
      } else if (picked.type === 'patch') {
        if (directGroupEditing) ctx.editor.selectPatchDirect(picked.entity, picked.patch, additive);
        else ctx.editor.selectPatch(picked.entity, picked.patch, additive);
      } else {
        ctx.editor.selectEntity(picked.entity, additive);
      }
    }

    state.dragging = true;
    state.hasDragged = false;
    state.moveSnapshotTaken = false;
    state.dragStart = [mx, my];
    state.dragWorldStart = [wx, wy];
    state.geoSnapTargets = ctx.editor.snapToGeometry ? ctx.editor.collectSnapTargets() : null;
    state.geoSnapLines = [];
  } else {
    state.rubberBanding = true;
    state.rubberBandStart = [mx, my];
    state.rubberBandEnd = [mx, my];
    state.rubberBandAdditive = additive;
    if (!additive) {
      ctx.editor.clearSelection();
    }
  }
}

export function handleViewport2DDoubleClick(ctx: Viewport2DInteractionContext, e: MouseEvent): void {
  if (e.button !== 0 || ctx.editor.activeTool !== 'select') return;
  if (ctx.editor.vertexMode || ctx.editor.patchEditMode) return;

  const [mx, my] = getLocalPos(ctx, e);
  const [wx, wy] = ctx.screenToWorld(mx, my);
  const picked = pickAt2D(ctx, wx, wy);
  if (!picked) return;

  if (picked.type === 'brush') {
    const grouped = picked.entity !== ctx.editor.worldspawn && ctx.editor.hasEntityGeometry(picked.entity);
    const alreadyDirect = ctx.editor.selection.length === 1 &&
      ctx.editor.selection[0].type === 'brush' &&
      ctx.editor.selection[0].brush === picked.brush;
    if (grouped) {
      ctx.editor.selectBrushDirect(picked.entity, picked.brush);
      if (alreadyDirect) {
        ctx.editor.enterVertexMode();
      } else {
        ctx.editor.statusMessage = 'Brush selected inside group';
      }
      return;
    }
    ctx.editor.selectBrush(picked.entity, picked.brush);
    ctx.editor.enterVertexMode();
  } else if (picked.type === 'patch') {
    const grouped = picked.entity !== ctx.editor.worldspawn && ctx.editor.hasEntityGeometry(picked.entity);
    const alreadyDirect = ctx.editor.selection.length === 1 &&
      ctx.editor.selection[0].type === 'patch' &&
      ctx.editor.selection[0].patch === picked.patch;
    if (grouped) {
      ctx.editor.selectPatchDirect(picked.entity, picked.patch);
      if (alreadyDirect) {
        ctx.editor.enterPatchEditMode();
      } else {
        ctx.editor.statusMessage = 'Patch selected inside group';
      }
      return;
    }
    ctx.editor.selectPatch(picked.entity, picked.patch);
    ctx.editor.enterPatchEditMode();
  }
}

export function handleViewport2DMouseMove(ctx: Viewport2DInteractionContext, e: MouseEvent): void {
  const state = ctx.interaction;
  const [mx, my] = getLocalPos(ctx, e);
  const [wx, wy] = ctx.screenToWorld(mx, my);

  ctx.editor.statusMessage = `${ctx.axisLabels[0]}: ${wx.toFixed(0)}  ${ctx.axisLabels[1]}: ${wy.toFixed(0)}  Grid: ${ctx.editor.gridSize}`;

  if (!state.panning && !state.dragging && !state.resizing) {
    if (state.spaceDown) {
      ctx.canvas.parentElement!.style.cursor = 'grab';
    } else {
      const canResize = ctx.editor.activeTool === 'select' && ctx.editor.gizmoMode === 'scale' && ctx.editor.selection.length > 0
        && !ctx.editor.vertexMode && !ctx.editor.patchEditMode
        && (getSelectedBrushItems(ctx.editor).length > 0 || getSelectedPatchItems(ctx.editor).length > 0);
      const edge = canResize ? detectResizeEdge2D(ctx, wx, wy) : null;
      ctx.canvas.parentElement!.style.cursor = edge ? getResizeCursor2D(edge.edges) : '';
    }
  }

  if (state.panning) {
    const dx = (mx - state.panStart[0]) / ctx.zoom;
    const dy = (my - state.panStart[1]) / ctx.zoom;
    ctx.centerX = state.panCenterStart[0] - dx;
    ctx.centerY = state.panCenterStart[1] + dy;
    ctx.editor.dirty = true;
    return;
  }

  if (state.rubberBanding) {
    state.rubberBandEnd = [mx, my];
    ctx.editor.dirty = true;
    return;
  }

  if (state.resizing && (state.resizeBrushes.length > 0 || state.resizePatches.length > 0)) {
    const dx = wx - state.dragWorldStart[0];
    const dy = wy - state.dragWorldStart[1];
    const grid = ctx.editor.effectiveGrid(e.ctrlKey);

    if (!state.resizeSnapshotTaken) {
      ctx.editor.snapshot();
      state.resizeSnapshotTaken = true;
    }

    const origMins = state.resizeOrigMins;
    const origMaxs = state.resizeOrigMaxs;
    const H = ctx.axisH;
    const V = ctx.axisV;
    const threshold = 8 / ctx.zoom;

    let newMinH = origMins[H];
    let newMaxH = origMaxs[H];
    let newMinV = origMins[V];
    let newMaxV = origMaxs[V];
    state.geoSnapLines = [];
    const abs = ctx.editor.gridAbsolute;
    const geoH = state.geoSnapTargets ? state.geoSnapTargets[H] : null;
    const geoV = state.geoSnapTargets ? state.geoSnapTargets[V] : null;

    if (state.resizeEdges.minH) {
      const r = snapAxisDelta(dx, [origMins[H] + dx], grid, abs, geoH, threshold);
      newMinH += r.delta;
      if (r.snapLine !== null) state.geoSnapLines.push({ axis: 'h', value: r.snapLine });
    }
    if (state.resizeEdges.maxH) {
      const r = snapAxisDelta(dx, [origMaxs[H] + dx], grid, abs, geoH, threshold);
      newMaxH += r.delta;
      if (r.snapLine !== null) state.geoSnapLines.push({ axis: 'h', value: r.snapLine });
    }
    if (state.resizeEdges.minV) {
      const r = snapAxisDelta(dy, [origMins[V] + dy], grid, abs, geoV, threshold);
      newMinV += r.delta;
      if (r.snapLine !== null) state.geoSnapLines.push({ axis: 'v', value: r.snapLine });
    }
    if (state.resizeEdges.maxV) {
      const r = snapAxisDelta(dy, [origMaxs[V] + dy], grid, abs, geoV, threshold);
      newMaxV += r.delta;
      if (r.snapLine !== null) state.geoSnapLines.push({ axis: 'v', value: r.snapLine });
    }

    const minSize = Math.max(1, grid);
    if (newMaxH - newMinH < minSize) {
      if (state.resizeEdges.minH) newMinH = newMaxH - minSize;
      else newMaxH = newMinH + minSize;
    }
    if (newMaxV - newMinV < minSize) {
      if (state.resizeEdges.minV) newMinV = newMaxV - minSize;
      else newMaxV = newMinV + minSize;
    }

    const scaleOrigin: Vec3 = [0, 0, 0];
    const scale: Vec3 = [1, 1, 1];

    if (state.resizeEdges.minH || state.resizeEdges.maxH) {
      const anchor = state.resizeEdges.minH ? origMaxs[H] : origMins[H];
      const oldExtent = (state.resizeEdges.minH ? origMins[H] : origMaxs[H]) - anchor;
      const newExtent = (state.resizeEdges.minH ? newMinH : newMaxH) - anchor;
      scaleOrigin[H] = anchor;
      scale[H] = Math.abs(oldExtent) > 0.01 ? newExtent / oldExtent : 1;
    }

    if (state.resizeEdges.minV || state.resizeEdges.maxV) {
      const anchor = state.resizeEdges.minV ? origMaxs[V] : origMins[V];
      const oldExtent = (state.resizeEdges.minV ? origMins[V] : origMaxs[V]) - anchor;
      const newExtent = (state.resizeEdges.minV ? newMinV : newMaxV) - anchor;
      scaleOrigin[V] = anchor;
      scale[V] = Math.abs(oldExtent) > 0.01 ? newExtent / oldExtent : 1;
    }

    if (e.shiftKey) {
      let uniformScale = scale[H] !== 1 ? scale[H] : scale[V];
      if (scale[H] !== 1 && scale[V] !== 1) {
        uniformScale = Math.abs(scale[H] - 1) > Math.abs(scale[V] - 1) ? scale[H] : scale[V];
      }
      if (!state.resizeEdges.minH && !state.resizeEdges.maxH) {
        scaleOrigin[H] = (origMins[H] + origMaxs[H]) / 2;
      }
      if (!state.resizeEdges.minV && !state.resizeEdges.maxV) {
        scaleOrigin[V] = (origMins[V] + origMaxs[V]) / 2;
      }
      scale[H] = uniformScale;
      scale[V] = uniformScale;
    }
    if (e.altKey) {
      scaleOrigin[H] = (origMins[H] + origMaxs[H]) / 2;
      scaleOrigin[V] = (origMins[V] + origMaxs[V]) / 2;
    }

    for (const { brush, origPoints } of state.resizeBrushes) {
      scaleBrushFaces(brush, origPoints, scaleOrigin, scale);
    }
    for (const { patch, origCtrl } of state.resizePatches) {
      scalePatchControlPoints(patch, origCtrl, scaleOrigin, scale);
    }
    ctx.editor.dirty = true;
    return;
  }

  if (!state.dragging) return;

  if (state.rotating) {
    const anchor = ctx.editor.rotateAnchor!;
    const currentAngle = Math.atan2(wy - anchor[ctx.axisV], wx - anchor[ctx.axisH]);
    let totalAngle = currentAngle - state.rotateStartAngle;

    if (e.shiftKey) {
      const snap = (15 / 180) * Math.PI;
      totalAngle = Math.round(totalAngle / snap) * snap;
    }

    if (totalAngle !== state.rotateAppliedAngle) {
      if (!state.rotateSnapshotTaken) {
        ctx.editor.snapshot();
        state.rotateSnapshotTaken = true;
      }
      state.hasDragged = true;

      const axis = ctx.axisDepth;
      const center3d: Vec3 = [0, 0, 0];
      center3d[ctx.axisH] = anchor[ctx.axisH];
      center3d[ctx.axisV] = anchor[ctx.axisV];
      const selCenter = ctx.editor.selectionCenter();
      if (selCenter) center3d[ctx.axisDepth] = selCenter[ctx.axisDepth];

      for (const { brush, points, planes, polygons, textures } of state.rotateBrushOriginals) {
        for (let fi = 0; fi < brush.faces.length; fi++) {
          brush.faces[fi].points[0] = vec3Copy(points[fi][0]);
          brush.faces[fi].points[1] = vec3Copy(points[fi][1]);
          brush.faces[fi].points[2] = vec3Copy(points[fi][2]);
          brush.faces[fi].plane = { normal: vec3Copy(planes[fi].normal), dist: planes[fi].dist };
          brush.faces[fi].polygon = polygons[fi].map(v => vec3Copy(v));
          brush.faces[fi].offsetX = textures[fi].offsetX;
          brush.faces[fi].offsetY = textures[fi].offsetY;
          brush.faces[fi].rotation = textures[fi].rotation;
          brush.faces[fi].scaleX = textures[fi].scaleX;
          brush.faces[fi].scaleY = textures[fi].scaleY;
        }
        if (ctx.editor.textureLock) {
          rotateBrushLocked(brush, center3d, axis, totalAngle);
        } else {
          rotateBrush(brush, center3d, axis, totalAngle);
        }
      }
      for (const { patch, ctrl } of state.rotatePatchOriginals) {
        for (let r = 0; r < patch.height; r++) {
          for (let c = 0; c < patch.width; c++) {
            patch.ctrl[r][c].xyz = vec3Copy(ctrl[r][c].xyz);
          }
        }
        rotatePatch(patch, center3d, axis, totalAngle);
      }

      state.rotateAppliedAngle = totalAngle;
      const degrees = totalAngle * 180 / Math.PI;
      ctx.editor.statusMessage = `Rotating ${degrees.toFixed(1)}°`;
      ctx.editor.dirty = true;
    }
    return;
  }

  if (state.anchorDragging) {
    const anchor = snapPlanarPoint(ctx, wx, wy, e.ctrlKey, false, state.geoSnapTargets);
    ctx.editor.rotateAnchor![ctx.axisH] = anchor[ctx.axisH];
    ctx.editor.rotateAnchor![ctx.axisV] = anchor[ctx.axisV];
    ctx.editor.dirty = true;
    return;
  }

  if (ctx.editor.creating) {
    const snapped = vec3Copy(ctx.editor.createEnd);
    const grid = ctx.editor.effectiveGrid(e.ctrlKey);
    snapped[ctx.axisH] = Math.round(wx / grid) * grid;
    snapped[ctx.axisV] = Math.round(wy / grid) * grid;
    ctx.editor.createEnd = snapped;
    ctx.editor.dirty = true;
    return;
  }

  if (state.vertexDragging) {
    const dx = wx - state.dragWorldStart[0];
    const dy = wy - state.dragWorldStart[1];
    const grid = ctx.editor.effectiveGrid(e.ctrlKey);
    const H = ctx.axisH;
    const V = ctx.axisV;
    let snappedDx: number;
    let snappedDy: number;

    state.geoSnapLines = [];
    const vtxCenter = ctx.editor.vertexMode
      ? ctx.editor.vertexSelectionCenter()
      : ctx.editor.patchControlSelectionCenter();
    if (vtxCenter) {
      const threshold = 8 / ctx.zoom;
      const abs = ctx.editor.gridAbsolute;
      const geoH = state.geoSnapTargets ? state.geoSnapTargets[H] : null;
      const geoV = state.geoSnapTargets ? state.geoSnapTargets[V] : null;
      const rH = snapAxisDelta(dx, [vtxCenter[H] + dx], grid, abs, geoH, threshold);
      const rV = snapAxisDelta(dy, [vtxCenter[V] + dy], grid, abs, geoV, threshold);
      snappedDx = rH.delta;
      snappedDy = rV.delta;
      if (rH.snapLine !== null) state.geoSnapLines.push({ axis: 'h', value: rH.snapLine });
      if (rV.snapLine !== null) state.geoSnapLines.push({ axis: 'v', value: rV.snapLine });
    } else {
      snappedDx = Math.round(dx / grid) * grid;
      snappedDy = Math.round(dy / grid) * grid;
    }

    if (snappedDx !== 0 || snappedDy !== 0) {
      if (!state.vertexDragSnapshotTaken) {
        ctx.editor.snapshot();
        state.vertexDragSnapshotTaken = true;
      }
      state.hasDragged = true;
      const delta: Vec3 = [0, 0, 0];
      delta[ctx.axisH] = snappedDx;
      delta[ctx.axisV] = snappedDy;
      if (ctx.editor.patchEditMode) {
        ctx.editor.moveSelectedControlPoints(delta);
      } else {
        ctx.editor.moveSelectedVertices(delta);
      }
      state.dragWorldStart = [
        state.dragWorldStart[0] + snappedDx,
        state.dragWorldStart[1] + snappedDy,
      ];
    }
    return;
  }

  if (ctx.editor.selection.length === 0) return;

  const dx = wx - state.dragWorldStart[0];
  const dy = wy - state.dragWorldStart[1];
  const grid = ctx.editor.effectiveGrid(e.ctrlKey);
  const H = ctx.axisH;
  const V = ctx.axisV;
  let snappedDx: number;
  let snappedDy: number;

  state.geoSnapLines = [];
  const bounds = ctx.editor.selectionBounds();
  if (bounds) {
    const threshold = 8 / ctx.zoom;
    const abs = ctx.editor.gridAbsolute;
    const rawMinH = bounds.mins[H] + dx;
    const rawMaxH = bounds.maxs[H] + dx;
    const rawMinV = bounds.mins[V] + dy;
    const rawMaxV = bounds.maxs[V] + dy;
    const geoH = state.geoSnapTargets ? state.geoSnapTargets[H] : null;
    const geoV = state.geoSnapTargets ? state.geoSnapTargets[V] : null;
    const rH = snapAxisDelta(dx, [rawMinH, rawMaxH, (rawMinH + rawMaxH) / 2], grid, abs, geoH, threshold);
    const rV = snapAxisDelta(dy, [rawMinV, rawMaxV, (rawMinV + rawMaxV) / 2], grid, abs, geoV, threshold);
    snappedDx = rH.delta;
    snappedDy = rV.delta;
    if (rH.snapLine !== null) state.geoSnapLines.push({ axis: 'h', value: rH.snapLine });
    if (rV.snapLine !== null) state.geoSnapLines.push({ axis: 'v', value: rV.snapLine });
  } else {
    snappedDx = Math.round(dx / grid) * grid;
    snappedDy = Math.round(dy / grid) * grid;
  }

  if (snappedDx === 0 && snappedDy === 0) return;

  if (!state.moveSnapshotTaken) {
    ctx.editor.snapshot();
    if (e.altKey) {
      ctx.editor.duplicateSelectionInPlace();
    }
    state.moveSnapshotTaken = true;
  }
  state.hasDragged = true;
  const delta: Vec3 = [0, 0, 0];
  delta[ctx.axisH] = snappedDx;
  delta[ctx.axisV] = snappedDy;
  ctx.editor.moveSelection(delta);
  state.dragWorldStart = [
    state.dragWorldStart[0] + snappedDx,
    state.dragWorldStart[1] + snappedDy,
  ];
}

export function handleViewport2DMouseUp(ctx: Viewport2DInteractionContext, e: MouseEvent): void {
  const state = ctx.interaction;

  if (state.rubberBanding) {
    state.rubberBanding = false;
    const [w0x, w0y] = ctx.screenToWorld(state.rubberBandStart[0], state.rubberBandStart[1]);
    const [w1x, w1y] = ctx.screenToWorld(state.rubberBandEnd[0], state.rubberBandEnd[1]);
    const minH = Math.min(w0x, w1x);
    const maxH = Math.max(w0x, w1x);
    const minV = Math.min(w0y, w1y);
    const maxV = Math.max(w0y, w1y);

    const dx = state.rubberBandEnd[0] - state.rubberBandStart[0];
    const dy = state.rubberBandEnd[1] - state.rubberBandStart[1];
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      const filter = ctx.editor.selectionFilter;
      if (filter === 'all' || filter === 'brushes') {
        for (const { entity, brush } of ctx.editor.allBrushes()) {
          if (!ctx.editor.isBrushVisible(brush, entity)) continue;
          if (brush.maxs[ctx.axisH] >= minH && brush.mins[ctx.axisH] <= maxH &&
              brush.maxs[ctx.axisV] >= minV && brush.mins[ctx.axisV] <= maxV) {
            ctx.editor.addBrushToSelection(entity, brush);
          }
        }
      }
      if (filter === 'all' || filter === 'patches') {
        for (const { entity, patch } of ctx.editor.allPatches()) {
          if (!ctx.editor.isPatchVisible(patch, entity)) continue;
          if (patch.maxs[ctx.axisH] >= minH && patch.mins[ctx.axisH] <= maxH &&
              patch.maxs[ctx.axisV] >= minV && patch.mins[ctx.axisV] <= maxV) {
            ctx.editor.addPatchToSelection(entity, patch);
          }
        }
      }
      if (filter === 'all' || filter === 'entities') {
        for (const entity of ctx.editor.nonWorldspawnEntities()) {
          if (!ctx.editor.isEntityVisible(entity)) continue;
          const bounds = ctx.editor.entityBounds(entity);
          if (!bounds) continue;
          if (bounds.maxs[ctx.axisH] >= minH && bounds.mins[ctx.axisH] <= maxH &&
              bounds.maxs[ctx.axisV] >= minV && bounds.mins[ctx.axisV] <= maxV) {
            ctx.editor.addEntityToSelection(entity);
          }
        }
      }
    }
    ctx.editor.dirty = true;
    return;
  }

  if (state.panning) {
    state.panning = false;
    ctx.canvas.parentElement!.style.cursor = state.spaceDown ? 'grab' : '';
    return;
  }

  if (state.resizing) {
    state.resizing = false;
    state.resizeBrushes = [];
    state.resizePatches = [];
    state.geoSnapTargets = null;
    state.geoSnapLines = [];
    ctx.canvas.parentElement!.style.cursor = '';
    ctx.editor.statusMessage = 'Resized';
    return;
  }

  if (!state.dragging) return;

  state.geoSnapTargets = null;
  state.geoSnapLines = [];
  if (state.anchorDragging) {
    state.anchorDragging = false;
    state.dragging = false;
    ctx.editor.statusMessage = 'Anchor placed — click and drag to rotate';
    return;
  }
  if (state.rotating) {
    state.rotating = false;
    state.dragging = false;
    state.rotateBrushOriginals = [];
    state.rotatePatchOriginals = [];
    if (state.hasDragged) {
      const degrees = (state.rotateAppliedAngle * 180 / Math.PI).toFixed(1);
      ctx.editor.statusMessage = `Rotated ${degrees}°`;
    }
    return;
  }
  if (state.vertexDragging) {
    state.vertexDragging = false;
    state.dragging = false;
    if (state.hasDragged) ctx.editor.statusMessage = 'Vertex moved';
    return;
  }
  if (ctx.editor.creating) {
    ctx.editor.creating = false;
    ctx.editor.snapshot();
    const mins: Vec3 = [0, 0, 0];
    const maxs: Vec3 = [0, 0, 0];
    mins[ctx.axisH] = Math.min(ctx.editor.createStart[ctx.axisH], ctx.editor.createEnd[ctx.axisH]);
    mins[ctx.axisV] = Math.min(ctx.editor.createStart[ctx.axisV], ctx.editor.createEnd[ctx.axisV]);
    maxs[ctx.axisH] = Math.max(ctx.editor.createStart[ctx.axisH], ctx.editor.createEnd[ctx.axisH]);
    maxs[ctx.axisV] = Math.max(ctx.editor.createStart[ctx.axisV], ctx.editor.createEnd[ctx.axisV]);
    mins[ctx.axisDepth] = 0;
    maxs[ctx.axisDepth] = ctx.editor.createDepth;

    const grid = ctx.editor.effectiveGrid(e.ctrlKey);
    if (maxs[ctx.axisH] - mins[ctx.axisH] >= grid &&
        maxs[ctx.axisV] - mins[ctx.axisV] >= grid) {
      const brush = ctx.editor.addBrush(mins, maxs, ctx.axisDepth, e.ctrlKey);
      ctx.editor.clearSelection();
      ctx.editor.selectBrush(ctx.editor.worldspawn, brush);
      ctx.editor.statusMessage = `${ctx.editor.currentBrushPrimitive} brush created`;
    }
  }
  state.dragging = false;
}

export function handleViewport2DWheel(ctx: Viewport2DInteractionContext, e: WheelEvent): void {
  e.preventDefault();

  if (e.ctrlKey || e.metaKey) {
    const [mx, my] = getLocalPos(ctx, e);
    const [wxBefore, wyBefore] = ctx.screenToWorld(mx, my);
    const factor = e.deltaY > 0 ? 0.95 : 1.05;
    ctx.zoom = Math.max(0.05, Math.min(50, ctx.zoom * factor));
    const [wxAfter, wyAfter] = ctx.screenToWorld(mx, my);
    ctx.centerX += wxBefore - wxAfter;
    ctx.centerY += wyBefore - wyAfter;
  } else {
    const panSpeed = 1 / ctx.zoom;
    ctx.centerX += e.deltaX * panSpeed;
    ctx.centerY -= e.deltaY * panSpeed;
  }

  ctx.editor.dirty = true;
}
