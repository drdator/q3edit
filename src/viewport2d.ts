import { Vec3, vec3, vec3Snap, vec3Copy, snapAxisDelta, findNearestSnap } from './math';
import { Editor } from './editor';
import { Brush, scaleBrushFaces, rotateBrush } from './brush';
import { Entity } from './entity';
import { Patch, PatchControlPoint, scalePatchControlPoints, rotatePatch } from './patch';
import { pickVertex2D } from './vertex';
import { rotateBrushLocked } from './texture-lock';
import {
  detectResizeEdge as detectResizeEdge2D,
  getResizeCursor as getResizeCursor2D,
  pickAt as pickAt2D,
  pickEntityAt as pickEntityAt2D,
} from './viewport2d-picking';
import { renderViewport2D } from './viewport2d-render';

export type ViewAxis = 'xy' | 'xz' | 'yz';

const AXIS_MAP: Record<ViewAxis, { h: number; v: number; depth: number; labels: [string, string] }> = {
  xy: { h: 0, v: 1, depth: 2, labels: ['X', 'Y'] },
  xz: { h: 0, v: 2, depth: 1, labels: ['X', 'Z'] },
  yz: { h: 1, v: 2, depth: 0, labels: ['Y', 'Z'] },
};

export class Viewport2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  editor: Editor;
  axis: ViewAxis;
  axisH: number;
  axisV: number;
  axisDepth: number;

  // Camera
  centerX = 256;
  centerY = 128;
  zoom = 1; // pixels per world unit

  // Interaction state
  private spaceDown = false;
  private dragging = false;
  private panning = false;
  private dragStart: [number, number] = [0, 0];
  private dragWorldStart: [number, number] = [0, 0];
  private panStart: [number, number] = [0, 0];
  private panCenterStart: [number, number] = [0, 0];
  private hasDragged = false;
  private moveSnapshotTaken = false;

  // Resize state
  private resizing = false;
  private resizeEdges = { minH: false, maxH: false, minV: false, maxV: false };
  private resizeBrushes: { brush: Brush; origPoints: [Vec3, Vec3, Vec3][] }[] = [];
  private resizePatches: { patch: Patch; origCtrl: PatchControlPoint[][] }[] = [];
  private resizeOrigMins: Vec3 = [0, 0, 0];
  private resizeOrigMaxs: Vec3 = [0, 0, 0];
  private resizeSnapshotTaken = false;

  // Rubber band selection state
  private rubberBanding = false;
  private rubberBandStart: [number, number] = [0, 0];
  private rubberBandEnd: [number, number] = [0, 0];
  private rubberBandAdditive = false;

  // Vertex drag state
  private vertexDragging = false;
  private vertexDragSnapshotTaken = false;

  // Geometry snap state
  private geoSnapTargets: [number[], number[], number[]] | null = null;
  private geoSnapLines: { axis: 'h' | 'v'; value: number }[] = [];

  // Rotation tool drag state
  private rotating = false;
  private rotateStartAngle = 0;
  private rotateAppliedAngle = 0;
  private rotateBrushOriginals: {
    brush: Brush;
    points: [Vec3, Vec3, Vec3][];
    planes: { normal: Vec3; dist: number }[];
    polygons: Vec3[][];
    textures: { offsetX: number; offsetY: number; rotation: number; scaleX: number; scaleY: number }[];
  }[] = [];
  private rotatePatchOriginals: { patch: Patch; ctrl: { xyz: Vec3; uv: [number, number] }[][] }[] = [];
  private rotateSnapshotTaken = false;
  private anchorDragging = false;

  constructor(canvas: HTMLCanvasElement, editor: Editor, axis: ViewAxis) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.editor = editor;
    this.axis = axis;
    const info = AXIS_MAP[axis];
    this.axisH = info.h;
    this.axisV = info.v;
    this.axisDepth = info.depth;

    this.setupEvents();
    this.editor.onCenterOnSelection(() => this.centerOnSelection());
  }

  centerOnSelection(): void {
    const bounds = this.editor.selectionBounds();
    if (!bounds) return;
    this.centerX = (bounds.mins[this.axisH] + bounds.maxs[this.axisH]) / 2;
    this.centerY = (bounds.mins[this.axisV] + bounds.maxs[this.axisV]) / 2;
  }

  // ── Coordinate conversion ──

  worldToScreen(wx: number, wy: number): [number, number] {
    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;
    return [
      cx + (wx - this.centerX) * this.zoom,
      cy - (wy - this.centerY) * this.zoom, // Y is flipped
    ];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;
    return [
      (sx - cx) / this.zoom + this.centerX,
      -(sy - cy) / this.zoom + this.centerY,
    ];
  }

  // ── Drawing ──

  render(): void {
    renderViewport2D({
      canvas: this.canvas,
      ctx: this.ctx,
      editor: this.editor,
      axisH: this.axisH,
      axisV: this.axisV,
      axisDepth: this.axisDepth,
      centerX: this.centerX,
      centerY: this.centerY,
      zoom: this.zoom,
      rotating: this.rotating,
      rotateStartAngle: this.rotateStartAngle,
      rotateAppliedAngle: this.rotateAppliedAngle,
      geoSnapLines: this.geoSnapLines,
      rubberBanding: this.rubberBanding,
      rubberBandStart: this.rubberBandStart,
      rubberBandEnd: this.rubberBandEnd,
      worldToScreen: (wx, wy) => this.worldToScreen(wx, wy),
      screenToWorld: (sx, sy) => this.screenToWorld(sx, sy),
    });
  }

  // ── Input handling ──

  private setupEvents(): void {
    const el = this.canvas.parentElement!;

    el.addEventListener('mousedown', (e) => this.onMouseDown(e));
    el.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    // Use document for move/up so drag continues even when mouse leaves viewport
    document.addEventListener('mousemove', (e) => {
      // Only process if we're actively interacting with this viewport
      if (this.panning || this.dragging || this.resizing || this.rubberBanding) {
        this.onMouseMove(e);
      } else {
        // Only update status if mouse is over this viewport
        const rect = this.canvas.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
          this.onMouseMove(e);
        }
      }
    });
    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) {
        this.spaceDown = true;
        el.style.cursor = 'grab';
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        if (!this.panning) el.style.cursor = '';
      }
    });
  }

  private getLocalPos(e: MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private onMouseDown(e: MouseEvent): void {
    // Track active viewport axes
    this.editor.rotationAxis = this.axisDepth;
    this.editor.nudgeAxisH = this.axisH;
    this.editor.nudgeAxisV = this.axisV;
    const [mx, my] = this.getLocalPos(e);

    // Right mouse, middle mouse, or space+left: pan
    if (e.button === 2 || e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.panning = true;
      this.panStart = [mx, my];
      this.panCenterStart = [this.centerX, this.centerY];
      this.canvas.parentElement!.style.cursor = 'grabbing';
      return;
    }

    if (e.button === 0) {
      const [wx, wy] = this.screenToWorld(mx, my);

      if (this.editor.activeTool === 'create') {
        // Start creating brush
        const grid = this.editor.effectiveGrid(e.ctrlKey);
        const snapped: Vec3 = [0, 0, 0];
        snapped[this.axisH] = Math.round(wx / grid) * grid;
        snapped[this.axisV] = Math.round(wy / grid) * grid;
        snapped[this.axisDepth] = 0; // Will be set based on view center

        this.editor.creating = true;
        this.editor.createStart = vec3Copy(snapped);
        this.editor.createEnd = vec3Copy(snapped);
        this.editor.createAxisH = this.axisH;
        this.editor.createAxisV = this.axisV;
        this.dragging = true;
        this.hasDragged = false;
        return;
      }

      if (this.editor.activeTool === 'entity') {
        // Place entity
        this.editor.snapshot();
        const grid = this.editor.effectiveGrid(e.ctrlKey);
        const origin: Vec3 = [0, 0, 0];
        origin[this.axisH] = Math.round(wx / grid) * grid;
        origin[this.axisV] = Math.round(wy / grid) * grid;
        origin[this.axisDepth] = 0;
        const entity = this.editor.addEntity(this.editor.currentEntityClass, origin, e.ctrlKey);
        this.editor.clearSelection();
        this.editor.selectEntity(entity);
        this.editor.statusMessage = `Placed ${this.editor.currentEntityClass}`;
        return;
      }

      if (this.editor.activeTool === 'clip') {
        // Place clip point
        const grid = this.editor.effectiveGrid(e.ctrlKey);
        const point: Vec3 = [0, 0, 0];
        point[this.axisH] = Math.round(wx / grid) * grid;
        point[this.axisV] = Math.round(wy / grid) * grid;
        if (this.editor.snapToGeometry) {
          const targets = this.editor.collectSnapTargets(true);
          const threshold = 8 / this.zoom;
          const snapH = findNearestSnap(wx, targets[this.axisH], threshold);
          const snapV = findNearestSnap(wy, targets[this.axisV], threshold);
          if (snapH !== null && Math.abs(snapH - wx) < Math.abs(point[this.axisH] - wx)) point[this.axisH] = snapH;
          if (snapV !== null && Math.abs(snapV - wy) < Math.abs(point[this.axisV] - wy)) point[this.axisV] = snapV;
        }
        this.editor.addClipPoint(point, this.axisDepth);
        return;
      }

      if (this.editor.activeTool === 'rotate') {
        if (!this.editor.rotateAnchor || e.altKey) {
          // Place or reposition anchor (click+drag to position)
          const grid = this.editor.effectiveGrid(e.ctrlKey);
          const anchor: Vec3 = [0, 0, 0];
          anchor[this.axisH] = Math.round(wx / grid) * grid;
          anchor[this.axisV] = Math.round(wy / grid) * grid;
          if (this.editor.snapToGeometry) {
            const targets = this.editor.collectSnapTargets(true);
            const threshold = 8 / this.zoom;
            const snapH = findNearestSnap(wx, targets[this.axisH], threshold);
            const snapV = findNearestSnap(wy, targets[this.axisV], threshold);
            if (snapH !== null && Math.abs(snapH - wx) < Math.abs(anchor[this.axisH] - wx)) anchor[this.axisH] = snapH;
            if (snapV !== null && Math.abs(snapV - wy) < Math.abs(anchor[this.axisV] - wy)) anchor[this.axisV] = snapV;
          }
          this.editor.rotateAnchor = anchor;
          this.anchorDragging = true;
          this.geoSnapTargets = this.editor.snapToGeometry ? this.editor.collectSnapTargets(true) : null;
          this.dragging = true;
          this.hasDragged = false;
          this.editor.statusMessage = 'Drag to position anchor';
          this.editor.dirty = true;
        } else if (this.editor.selection.length > 0) {
          // Start rotation drag
          const anchor = this.editor.rotateAnchor;
          this.rotateStartAngle = Math.atan2(wy - anchor[this.axisV], wx - anchor[this.axisH]);
          this.rotateAppliedAngle = 0;
          this.rotating = true;
          this.rotateSnapshotTaken = false;
          this.dragging = true;
          this.hasDragged = false;

          // Store originals for non-destructive rotation
          this.rotateBrushOriginals = this.editor.selection
            .filter(s => s.type === 'brush' || s.type === 'face')
            .map(s => {
              const brush = (s as { brush: Brush }).brush;
              return {
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
              };
            });
          this.rotatePatchOriginals = this.editor.selection
            .filter(s => s.type === 'patch')
            .map(s => {
              const patch = (s as { patch: Patch }).patch;
              return {
                patch,
                ctrl: patch.ctrl.map(row =>
                  row.map(cp => ({ xyz: vec3Copy(cp.xyz), uv: [cp.uv[0], cp.uv[1]] as [number, number] }))
                ),
              };
            });
        }
        return;
      }

      // Vertex mode: pick/drag vertices
      if (this.editor.vertexMode) {
        const threshold = 8 / this.zoom; // 8px in world coords
        let hitDi = -1, hitVi = -1;
        for (let di = 0; di < this.editor.vertexData.length; di++) {
          const vi = pickVertex2D(this.editor.vertexData[di].vertices, wx, wy, this.axisH, this.axisV, this.axisDepth, threshold);
          if (vi >= 0) { hitDi = di; hitVi = vi; break; }
        }
        const additive = e.ctrlKey || e.metaKey || e.shiftKey;
        if (hitDi >= 0) {
          const wasSelected = this.editor.isVertexSelected(hitDi, hitVi);
          this.editor.selectVertex(hitDi, hitVi, additive);
          // Start vertex drag
          if (wasSelected || !additive) {
            this.vertexDragging = true;
            this.vertexDragSnapshotTaken = false;
            this.dragging = true;
            this.hasDragged = false;
            this.dragWorldStart = [wx, wy];
            this.geoSnapTargets = this.editor.snapToGeometry ? this.editor.collectSnapTargets() : null;
            this.geoSnapLines = [];
          }
        } else {
          if (!additive) this.editor.clearVertexSelection();
        }
        return;
      }

      // Patch control point mode: pick/drag control points
      if (this.editor.patchEditMode) {
        const threshold = 8 / this.zoom;
        let hitDi = -1, hitR = -1, hitC = -1;
        let bestDist = threshold;
        for (let di = 0; di < this.editor.patchEditData.length; di++) {
          const patch = this.editor.patchEditData[di].patch;
          for (let r = 0; r < patch.height; r++) {
            for (let c = 0; c < patch.width; c++) {
              const p = patch.ctrl[r][c].xyz;
              const dx = Math.abs(wx - p[this.axisH]);
              const dy = Math.abs(wy - p[this.axisV]);
              const dist = Math.max(dx, dy);
              if (dist < bestDist) {
                bestDist = dist;
                hitDi = di; hitR = r; hitC = c;
              }
            }
          }
        }
        const additive = e.ctrlKey || e.metaKey || e.shiftKey;
        if (hitDi >= 0) {
          const wasSelected = this.editor.isControlPointSelected(hitDi, hitR, hitC);
          this.editor.selectControlPoint(hitDi, hitR, hitC, additive);
          if (wasSelected || !additive) {
            this.vertexDragging = true;
            this.vertexDragSnapshotTaken = false;
            this.dragging = true;
            this.hasDragged = false;
            this.dragWorldStart = [wx, wy];
            this.geoSnapTargets = this.editor.snapToGeometry ? this.editor.collectSnapTargets() : null;
            this.geoSnapLines = [];
          }
        } else {
          if (!additive) this.editor.clearControlPointSelection();
        }
        return;
      }

      // Check for resize edge on combined selection AABB (only in scale mode, skip entity-only selections)
      if (this.editor.activeTool === 'select' && this.editor.gizmoMode === 'scale' && this.editor.selection.length > 0
          && this.editor.selection.some(s => s.type === 'brush' || s.type === 'patch' || s.type === 'face')) {
        const edge = this.detectResizeEdge(wx, wy);
        if (edge) {
          const bounds = this.editor.selectionBounds()!;
          this.resizing = true;
          this.resizeEdges = edge.edges;
          this.resizeBrushes = this.editor.selection
            .filter(s => s.type === 'brush')
            .map(s => ({
              brush: (s as { brush: Brush }).brush,
              origPoints: (s as { brush: Brush }).brush.faces.map(f =>
                [vec3Copy(f.points[0]), vec3Copy(f.points[1]), vec3Copy(f.points[2])] as [Vec3, Vec3, Vec3]
              ),
            }));
          this.resizePatches = this.editor.selection
            .filter(s => s.type === 'patch')
            .map(s => ({
              patch: (s as { patch: Patch }).patch,
              origCtrl: (s as { patch: Patch }).patch.ctrl.map(row =>
                row.map(cp => ({ xyz: vec3Copy(cp.xyz), uv: [cp.uv[0], cp.uv[1]] as [number, number] }))
              ),
            }));
          this.resizeOrigMins = vec3Copy(bounds.mins);
          this.resizeOrigMaxs = vec3Copy(bounds.maxs);
          this.resizeSnapshotTaken = false;
          this.dragWorldStart = [wx, wy];
          this.geoSnapTargets = this.editor.snapToGeometry ? this.editor.collectSnapTargets() : null;
          this.geoSnapLines = [];
          return;
        }
      }

      // Select tool: try to pick a brush or entity
      const picked = this.pickAt(wx, wy);
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (picked) {
        const alreadySelected = picked.type === 'brush'
          ? this.editor.isSelected(picked.brush)
          : picked.type === 'patch'
            ? this.editor.isPatchSelected(picked.patch)
            : this.editor.isEntitySelected(picked.entity);

        if (!additive && !alreadySelected) {
          this.editor.clearSelection();
        }

        // If already selected without modifier, just start dragging (preserve multi-selection)
        if (additive || !alreadySelected) {
          if (picked.type === 'brush') {
            this.editor.selectBrush(picked.entity, picked.brush, additive);
          } else if (picked.type === 'patch') {
            this.editor.selectPatch(picked.entity, picked.patch, additive);
          } else {
            this.editor.selectEntity(picked.entity, additive);
          }
        }

        // Start drag-move
        this.dragging = true;
        this.hasDragged = false;
        this.moveSnapshotTaken = false;
        this.dragStart = [mx, my];
        this.dragWorldStart = [wx, wy];
        this.geoSnapTargets = this.editor.snapToGeometry ? this.editor.collectSnapTargets() : null;
        this.geoSnapLines = [];
      } else {
        // Nothing picked — start rubber band selection
        this.rubberBanding = true;
        this.rubberBandStart = [mx, my];
        this.rubberBandEnd = [mx, my];
        this.rubberBandAdditive = additive;
        if (!additive) {
          this.editor.clearSelection();
        }
      }
    }
  }

  private onDoubleClick(e: MouseEvent): void {
    if (e.button !== 0 || this.editor.activeTool !== 'select') return;
    if (this.editor.vertexMode || this.editor.patchEditMode) return;

    const [mx, my] = this.getLocalPos(e);
    const [wx, wy] = this.screenToWorld(mx, my);
    const picked = this.pickAt(wx, wy);
    if (!picked) return;

    if (picked.type === 'brush') {
      this.editor.selectBrush(picked.entity, picked.brush);
      this.editor.enterVertexMode();
    } else if (picked.type === 'patch') {
      this.editor.selectPatch(picked.entity, picked.patch);
      this.editor.enterPatchEditMode();
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const [mx, my] = this.getLocalPos(e);
    const [wx, wy] = this.screenToWorld(mx, my);

    // Update status with world coordinates
    const coords: Vec3 = [0, 0, 0];
    coords[this.axisH] = wx;
    coords[this.axisV] = wy;
    this.editor.statusMessage = `${AXIS_MAP[this.axis].labels[0]}: ${wx.toFixed(0)}  ${AXIS_MAP[this.axis].labels[1]}: ${wy.toFixed(0)}  Grid: ${this.editor.gridSize}`;

    // Cursor feedback for resize when hovering
    if (!this.panning && !this.dragging && !this.resizing) {
      if (this.spaceDown) {
        this.canvas.parentElement!.style.cursor = 'grab';
      } else {
        const canResize = this.editor.activeTool === 'select' && this.editor.gizmoMode === 'scale' && this.editor.selection.length > 0 && !this.editor.vertexMode && !this.editor.patchEditMode
          && this.editor.selection.some(s => s.type === 'brush' || s.type === 'patch' || s.type === 'face');
        const edge = canResize ? this.detectResizeEdge(wx, wy) : null;
        this.canvas.parentElement!.style.cursor = edge ? this.getResizeCursor(edge.edges) : '';
      }
    }

    if (this.panning) {
      const dx = (mx - this.panStart[0]) / this.zoom;
      const dy = (my - this.panStart[1]) / this.zoom;
      this.centerX = this.panCenterStart[0] - dx;
      this.centerY = this.panCenterStart[1] + dy;
      this.editor.dirty = true;
      return;
    }

    if (this.rubberBanding) {
      this.rubberBandEnd = [mx, my];
      this.editor.dirty = true;
      return;
    }

    if (this.resizing && (this.resizeBrushes.length > 0 || this.resizePatches.length > 0)) {
      const dx = wx - this.dragWorldStart[0];
      const dy = wy - this.dragWorldStart[1];
      const grid = this.editor.effectiveGrid(e.ctrlKey);

      if (!this.resizeSnapshotTaken) {
        this.editor.snapshot();
        this.resizeSnapshotTaken = true;
      }

      // Compute new edge positions, snapping each edge via grid or geometry
      const origMins = this.resizeOrigMins;
      const origMaxs = this.resizeOrigMaxs;
      const H = this.axisH;
      const V = this.axisV;
      const threshold = 8 / this.zoom;

      let newMinH = origMins[H], newMaxH = origMaxs[H];
      let newMinV = origMins[V], newMaxV = origMaxs[V];
      this.geoSnapLines = [];
      const abs = this.editor.gridAbsolute;
      const geoH = this.geoSnapTargets ? this.geoSnapTargets[H] : null;
      const geoV = this.geoSnapTargets ? this.geoSnapTargets[V] : null;

      if (this.resizeEdges.minH) {
        const r = snapAxisDelta(dx, [origMins[H] + dx], grid, abs, geoH, threshold);
        newMinH += r.delta;
        if (r.snapLine !== null) this.geoSnapLines.push({ axis: 'h', value: r.snapLine });
      }
      if (this.resizeEdges.maxH) {
        const r = snapAxisDelta(dx, [origMaxs[H] + dx], grid, abs, geoH, threshold);
        newMaxH += r.delta;
        if (r.snapLine !== null) this.geoSnapLines.push({ axis: 'h', value: r.snapLine });
      }
      if (this.resizeEdges.minV) {
        const r = snapAxisDelta(dy, [origMins[V] + dy], grid, abs, geoV, threshold);
        newMinV += r.delta;
        if (r.snapLine !== null) this.geoSnapLines.push({ axis: 'v', value: r.snapLine });
      }
      if (this.resizeEdges.maxV) {
        const r = snapAxisDelta(dy, [origMaxs[V] + dy], grid, abs, geoV, threshold);
        newMaxV += r.delta;
        if (r.snapLine !== null) this.geoSnapLines.push({ axis: 'v', value: r.snapLine });
      }

      // Enforce minimum size (at least 1 unit)
      const minSize = Math.max(1, grid);
      if (newMaxH - newMinH < minSize) {
        if (this.resizeEdges.minH) newMinH = newMaxH - minSize;
        else newMaxH = newMinH + minSize;
      }
      if (newMaxV - newMinV < minSize) {
        if (this.resizeEdges.minV) newMinV = newMaxV - minSize;
        else newMaxV = newMinV + minSize;
      }

      // Scale from opposite edge as anchor
      const scaleOrigin: Vec3 = [0, 0, 0];
      const scale: Vec3 = [1, 1, 1];

      if (this.resizeEdges.minH || this.resizeEdges.maxH) {
        const anchor = this.resizeEdges.minH ? origMaxs[H] : origMins[H];
        const oldExtent = (this.resizeEdges.minH ? origMins[H] : origMaxs[H]) - anchor;
        const newExtent = (this.resizeEdges.minH ? newMinH : newMaxH) - anchor;
        scaleOrigin[H] = anchor;
        scale[H] = Math.abs(oldExtent) > 0.01 ? newExtent / oldExtent : 1;
      }

      if (this.resizeEdges.minV || this.resizeEdges.maxV) {
        const anchor = this.resizeEdges.minV ? origMaxs[V] : origMins[V];
        const oldExtent = (this.resizeEdges.minV ? origMins[V] : origMaxs[V]) - anchor;
        const newExtent = (this.resizeEdges.minV ? newMinV : newMaxV) - anchor;
        scaleOrigin[V] = anchor;
        scale[V] = Math.abs(oldExtent) > 0.01 ? newExtent / oldExtent : 1;
      }

      // Shift: uniform scale (keep proportions), anchored from opposite edge
      // Alt/Option: scale from center
      // Shift+Alt: uniform scale from center
      if (e.shiftKey) {
        let uniformScale = scale[H] !== 1 ? scale[H] : scale[V];
        if (scale[H] !== 1 && scale[V] !== 1) {
          uniformScale = Math.abs(scale[H] - 1) > Math.abs(scale[V] - 1) ? scale[H] : scale[V];
        }
        // Set center anchor for axes that weren't being resized
        if (!this.resizeEdges.minH && !this.resizeEdges.maxH) {
          scaleOrigin[H] = (origMins[H] + origMaxs[H]) / 2;
        }
        if (!this.resizeEdges.minV && !this.resizeEdges.maxV) {
          scaleOrigin[V] = (origMins[V] + origMaxs[V]) / 2;
        }
        scale[H] = uniformScale;
        scale[V] = uniformScale;
      }
      if (e.altKey) {
        scaleOrigin[H] = (origMins[H] + origMaxs[H]) / 2;
        scaleOrigin[V] = (origMins[V] + origMaxs[V]) / 2;
      }

      for (const { brush, origPoints } of this.resizeBrushes) {
        scaleBrushFaces(brush, origPoints, scaleOrigin, scale);
      }
      for (const { patch, origCtrl } of this.resizePatches) {
        scalePatchControlPoints(patch, origCtrl, scaleOrigin, scale);
      }
      this.editor.dirty = true;
      return;
    }

    if (this.dragging) {
      if (this.rotating) {
        // Rotation tool drag
        const anchor = this.editor.rotateAnchor!;
        const currentAngle = Math.atan2(wy - anchor[this.axisV], wx - anchor[this.axisH]);
        let totalAngle = currentAngle - this.rotateStartAngle;

        // Shift: snap to 15° increments
        if (e.shiftKey) {
          const snap = (15 / 180) * Math.PI;
          totalAngle = Math.round(totalAngle / snap) * snap;
        }

        if (totalAngle !== this.rotateAppliedAngle) {
          if (!this.rotateSnapshotTaken) {
            this.editor.snapshot();
            this.rotateSnapshotTaken = true;
          }
          this.hasDragged = true;

          const axis = this.axisDepth;
          // Build 3D anchor with depth from selection center
          const center3d: Vec3 = [0, 0, 0];
          center3d[this.axisH] = anchor[this.axisH];
          center3d[this.axisV] = anchor[this.axisV];
          const selCenter = this.editor.selectionCenter();
          if (selCenter) center3d[this.axisDepth] = selCenter[this.axisDepth];

          // Restore originals and apply total rotation
          for (const { brush, points, planes, polygons, textures } of this.rotateBrushOriginals) {
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
            if (this.editor.textureLock) {
              rotateBrushLocked(brush, center3d, axis, totalAngle);
            } else {
              rotateBrush(brush, center3d, axis, totalAngle);
            }
          }
          for (const { patch, ctrl } of this.rotatePatchOriginals) {
            for (let r = 0; r < patch.height; r++) {
              for (let c = 0; c < patch.width; c++) {
                patch.ctrl[r][c].xyz = vec3Copy(ctrl[r][c].xyz);
              }
            }
            rotatePatch(patch, center3d, axis, totalAngle);
          }

          this.rotateAppliedAngle = totalAngle;
          const degrees = (totalAngle * 180 / Math.PI);
          this.editor.statusMessage = `Rotating ${degrees.toFixed(1)}°`;
          this.editor.dirty = true;
        }
        return;
      } else if (this.anchorDragging) {
        // Drag to reposition rotation anchor
        const grid = this.editor.effectiveGrid(e.ctrlKey);
        const anchor = this.editor.rotateAnchor!;
        anchor[this.axisH] = Math.round(wx / grid) * grid;
        anchor[this.axisV] = Math.round(wy / grid) * grid;
        if (this.geoSnapTargets) {
          const threshold = 8 / this.zoom;
          const snapH = findNearestSnap(wx, this.geoSnapTargets[this.axisH], threshold);
          const snapV = findNearestSnap(wy, this.geoSnapTargets[this.axisV], threshold);
          if (snapH !== null && Math.abs(snapH - wx) < Math.abs(anchor[this.axisH] - wx)) anchor[this.axisH] = snapH;
          if (snapV !== null && Math.abs(snapV - wy) < Math.abs(anchor[this.axisV] - wy)) anchor[this.axisV] = snapV;
        }
        this.editor.dirty = true;
        return;
      } else if (this.editor.creating) {
        // Update creation preview
        const grid = this.editor.effectiveGrid(e.ctrlKey);
        const snapped: Vec3 = vec3Copy(this.editor.createEnd);
        snapped[this.axisH] = Math.round(wx / grid) * grid;
        snapped[this.axisV] = Math.round(wy / grid) * grid;
        this.editor.createEnd = snapped;
        this.editor.dirty = true;
      } else if (this.vertexDragging) {
        // Move selected vertices or control points
        const dx = wx - this.dragWorldStart[0];
        const dy = wy - this.dragWorldStart[1];
        const grid = this.editor.effectiveGrid(e.ctrlKey);
        const H = this.axisH, V = this.axisV;
        let snappedDx: number, snappedDy: number;

        this.geoSnapLines = [];
        const vtxCenter = this.editor.vertexMode
          ? this.editor.vertexSelectionCenter()
          : this.editor.patchControlSelectionCenter();
        if (vtxCenter) {
          const threshold = 8 / this.zoom;
          const abs = this.editor.gridAbsolute;
          const geoH = this.geoSnapTargets ? this.geoSnapTargets[H] : null;
          const geoV = this.geoSnapTargets ? this.geoSnapTargets[V] : null;
          const rH = snapAxisDelta(dx, [vtxCenter[H] + dx], grid, abs, geoH, threshold);
          const rV = snapAxisDelta(dy, [vtxCenter[V] + dy], grid, abs, geoV, threshold);
          snappedDx = rH.delta; snappedDy = rV.delta;
          if (rH.snapLine !== null) this.geoSnapLines.push({ axis: 'h', value: rH.snapLine });
          if (rV.snapLine !== null) this.geoSnapLines.push({ axis: 'v', value: rV.snapLine });
        } else {
          snappedDx = Math.round(dx / grid) * grid;
          snappedDy = Math.round(dy / grid) * grid;
        }

        if (snappedDx !== 0 || snappedDy !== 0) {
          if (!this.vertexDragSnapshotTaken) {
            this.editor.snapshot();
            this.vertexDragSnapshotTaken = true;
          }
          this.hasDragged = true;
          const delta: Vec3 = [0, 0, 0];
          delta[this.axisH] = snappedDx;
          delta[this.axisV] = snappedDy;
          if (this.editor.patchEditMode) {
            this.editor.moveSelectedControlPoints(delta);
          } else {
            this.editor.moveSelectedVertices(delta);
          }
          this.dragWorldStart = [
            this.dragWorldStart[0] + snappedDx,
            this.dragWorldStart[1] + snappedDy,
          ];
        }
      } else if (this.editor.selection.length > 0) {
        // Move selection
        const dx = wx - this.dragWorldStart[0];
        const dy = wy - this.dragWorldStart[1];
        const grid = this.editor.effectiveGrid(e.ctrlKey);
        const H = this.axisH, V = this.axisV;
        let snappedDx: number, snappedDy: number;

        this.geoSnapLines = [];
        const bounds = this.editor.selectionBounds();
        if (bounds) {
          const threshold = 8 / this.zoom;
          const abs = this.editor.gridAbsolute;
          const rawMinH = bounds.mins[H] + dx, rawMaxH = bounds.maxs[H] + dx;
          const rawMinV = bounds.mins[V] + dy, rawMaxV = bounds.maxs[V] + dy;
          const geoH = this.geoSnapTargets ? this.geoSnapTargets[H] : null;
          const geoV = this.geoSnapTargets ? this.geoSnapTargets[V] : null;
          const rH = snapAxisDelta(dx, [rawMinH, rawMaxH, (rawMinH + rawMaxH) / 2], grid, abs, geoH, threshold);
          const rV = snapAxisDelta(dy, [rawMinV, rawMaxV, (rawMinV + rawMaxV) / 2], grid, abs, geoV, threshold);
          snappedDx = rH.delta; snappedDy = rV.delta;
          if (rH.snapLine !== null) this.geoSnapLines.push({ axis: 'h', value: rH.snapLine });
          if (rV.snapLine !== null) this.geoSnapLines.push({ axis: 'v', value: rV.snapLine });
        } else {
          snappedDx = Math.round(dx / grid) * grid;
          snappedDy = Math.round(dy / grid) * grid;
        }

        if (snappedDx !== 0 || snappedDy !== 0) {
          if (!this.moveSnapshotTaken) {
            this.editor.snapshot();
            if (e.altKey) {
              this.editor.duplicateSelectionInPlace();
            }
            this.moveSnapshotTaken = true;
          }
          this.hasDragged = true;
          const delta: Vec3 = [0, 0, 0];
          delta[this.axisH] = snappedDx;
          delta[this.axisV] = snappedDy;
          this.editor.moveSelection(delta);
          this.dragWorldStart = [
            this.dragWorldStart[0] + snappedDx,
            this.dragWorldStart[1] + snappedDy,
          ];
        }
      }
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (this.rubberBanding) {
      this.rubberBanding = false;
      const [w0x, w0y] = this.screenToWorld(this.rubberBandStart[0], this.rubberBandStart[1]);
      const [w1x, w1y] = this.screenToWorld(this.rubberBandEnd[0], this.rubberBandEnd[1]);
      const minH = Math.min(w0x, w1x), maxH = Math.max(w0x, w1x);
      const minV = Math.min(w0y, w1y), maxV = Math.max(w0y, w1y);

      // Only select if drag was substantial (>4px)
      const dx = this.rubberBandEnd[0] - this.rubberBandStart[0];
      const dy = this.rubberBandEnd[1] - this.rubberBandStart[1];
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        const filter = this.editor.selectionFilter;
        if (filter === 'all' || filter === 'brushes') {
          for (const { entity, brush } of this.editor.allBrushes()) {
            if (!this.editor.isBrushVisible(brush, entity)) continue;
            if (brush.maxs[this.axisH] >= minH && brush.mins[this.axisH] <= maxH &&
                brush.maxs[this.axisV] >= minV && brush.mins[this.axisV] <= maxV) {
              this.editor.addBrushToSelection(entity, brush);
            }
          }
        }
        if (filter === 'all' || filter === 'patches') {
          for (const { entity, patch } of this.editor.allPatches()) {
            if (!this.editor.isPatchVisible(patch, entity)) continue;
            if (patch.maxs[this.axisH] >= minH && patch.mins[this.axisH] <= maxH &&
                patch.maxs[this.axisV] >= minV && patch.mins[this.axisV] <= maxV) {
              this.editor.addPatchToSelection(entity, patch);
            }
          }
        }
        if (filter === 'all' || filter === 'entities') {
          for (const entity of this.editor.nonWorldspawnEntities()) {
            if (!this.editor.isEntityVisible(entity)) continue;
            const bounds = this.editor.entityBounds(entity);
            if (!bounds) continue;
            if (bounds.maxs[this.axisH] >= minH && bounds.mins[this.axisH] <= maxH &&
                bounds.maxs[this.axisV] >= minV && bounds.mins[this.axisV] <= maxV) {
              this.editor.addEntityToSelection(entity);
            }
          }
        }
      }
      this.editor.dirty = true;
      return;
    }

    if (this.panning) {
      this.panning = false;
      this.canvas.parentElement!.style.cursor = this.spaceDown ? 'grab' : '';
      return;
    }

    if (this.resizing) {
      this.resizing = false;
      this.resizeBrushes = [];
      this.resizePatches = [];
      this.geoSnapTargets = null;
      this.geoSnapLines = [];
      this.canvas.parentElement!.style.cursor = '';
      this.editor.statusMessage = 'Resized';
      return;
    }

    if (this.dragging) {
      this.geoSnapTargets = null;
      this.geoSnapLines = [];
      if (this.anchorDragging) {
        this.anchorDragging = false;
        this.dragging = false;
        this.editor.statusMessage = 'Anchor placed — click and drag to rotate';
        return;
      }
      if (this.rotating) {
        this.rotating = false;
        this.dragging = false;
        this.rotateBrushOriginals = [];
        this.rotatePatchOriginals = [];
        if (this.hasDragged) {
          const degrees = (this.rotateAppliedAngle * 180 / Math.PI).toFixed(1);
          this.editor.statusMessage = `Rotated ${degrees}°`;
        }
        return;
      }
      if (this.vertexDragging) {
        this.vertexDragging = false;
        this.dragging = false;
        if (this.hasDragged) this.editor.statusMessage = 'Vertex moved';
        return;
      }
      if (this.editor.creating) {
        // Finish creating brush
        this.editor.creating = false;
        this.editor.snapshot();
        const mins: Vec3 = [0, 0, 0];
        const maxs: Vec3 = [0, 0, 0];
        mins[this.axisH] = Math.min(this.editor.createStart[this.axisH], this.editor.createEnd[this.axisH]);
        mins[this.axisV] = Math.min(this.editor.createStart[this.axisV], this.editor.createEnd[this.axisV]);
        maxs[this.axisH] = Math.max(this.editor.createStart[this.axisH], this.editor.createEnd[this.axisH]);
        maxs[this.axisV] = Math.max(this.editor.createStart[this.axisV], this.editor.createEnd[this.axisV]);

        // Depth from the missing axis
        mins[this.axisDepth] = 0;
        maxs[this.axisDepth] = this.editor.createDepth;

        const grid = this.editor.effectiveGrid(e.ctrlKey);
        if (maxs[this.axisH] - mins[this.axisH] >= grid &&
            maxs[this.axisV] - mins[this.axisV] >= grid) {
          const brush = this.editor.addBrush(mins, maxs, e.ctrlKey);
          this.editor.clearSelection();
          this.editor.selectBrush(this.editor.worldspawn, brush);
          this.editor.statusMessage = 'Brush created';
        }
      }
      this.dragging = false;
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Pinch-to-zoom (trackpad) or Ctrl+scroll (mouse) → zoom toward cursor
      const [mx, my] = this.getLocalPos(e);
      const [wxBefore, wyBefore] = this.screenToWorld(mx, my);

      // Pinch events have small deltaY, use gentler factor
      const factor = e.deltaY > 0 ? 0.95 : 1.05;
      this.zoom = Math.max(0.05, Math.min(50, this.zoom * factor));

      const [wxAfter, wyAfter] = this.screenToWorld(mx, my);
      this.centerX += wxBefore - wxAfter;
      this.centerY += wyBefore - wyAfter;
    } else {
      // Regular scroll → pan (natural for trackpad two-finger scroll)
      const panSpeed = 1 / this.zoom;
      this.centerX += e.deltaX * panSpeed;
      this.centerY -= e.deltaY * panSpeed;
    }

    this.editor.dirty = true;
  }

  // ── Resize edge detection ──

  private detectResizeEdge(wx: number, wy: number): {
    edges: { minH: boolean; maxH: boolean; minV: boolean; maxV: boolean };
  } | null {
    return detectResizeEdge2D(this, wx, wy);
  }

  private getResizeCursor(edges: { minH: boolean; maxH: boolean; minV: boolean; maxV: boolean }): string {
    return getResizeCursor2D(edges);
  }

  private pickEntityAt(wx: number, wy: number, includeBrushEntities: boolean): { type: 'entity'; entity: Entity } | null {
    return pickEntityAt2D(this, wx, wy, includeBrushEntities);
  }

  private pickAt(wx: number, wy: number): { type: 'brush'; entity: Entity; brush: Brush } | { type: 'entity'; entity: Entity } | { type: 'patch'; entity: Entity; patch: Patch } | null {
    return pickAt2D(this, wx, wy);
  }
}
