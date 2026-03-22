import { Vec3, vec3, vec3Snap, vec3Copy } from './math';
import { Editor, SelectionItem } from './editor';
import { Brush, brushContainsPoint2D, scaleBrushFaces } from './brush';
import { Entity, entityOrigin } from './entity';
import { pickVertex2D } from './vertex';

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
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    // Background
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, w, h);

    // Grid
    this.drawGrid(w, h);

    // Brushes
    for (const { entity, brush } of this.editor.allBrushes()) {
      this.drawBrush(brush, this.editor.isSelected(brush));
    }

    // Point entities
    for (const entity of this.editor.pointEntities()) {
      this.drawEntity(entity, this.editor.isEntitySelected(entity));
    }

    // Selection resize box (not in vertex mode)
    if (this.editor.activeTool === 'select' && this.editor.selection.length > 0 && !this.editor.vertexMode) {
      this.drawSelectionBox();
    }

    // Vertex handles
    if (this.editor.vertexMode) {
      this.drawVertexHandles();
    }

    // Creation preview
    if (this.editor.creating && this.editor.createAxisH === this.axisH && this.editor.createAxisV === this.axisV) {
      this.drawCreationPreview();
    }

    // Clip line preview
    if (this.editor.activeTool === 'clip' && this.editor.clipPoints.length > 0 && this.editor.clipDepthAxis === this.axisDepth) {
      this.drawClipPreview(w, h);
    }

    // Rubber band selection rectangle
    if (this.rubberBanding) {
      this.drawRubberBand();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawGrid(w: number, h: number): void {
    const { ctx } = this;
    const gridSize = this.editor.gridSize;

    // Visible world bounds
    const [wMinX, wMaxY] = this.screenToWorld(0, 0);
    const [wMaxX, wMinY] = this.screenToWorld(w, h);

    // Minor grid
    const minorAlpha = Math.min(1, this.zoom * gridSize / 8);
    if (minorAlpha > 0.1) {
      ctx.strokeStyle = `rgba(50, 50, 50, ${minorAlpha * 0.6})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      const startX = Math.floor(wMinX / gridSize) * gridSize;
      const startY = Math.floor(wMinY / gridSize) * gridSize;
      for (let x = startX; x <= wMaxX; x += gridSize) {
        const [sx] = this.worldToScreen(x, 0);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      for (let y = startY; y <= wMaxY; y += gridSize) {
        const [, sy] = this.worldToScreen(0, y);
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.stroke();
    }

    // Major grid (every 8 minor units or 64 units minimum)
    const majorSize = Math.max(gridSize * 8, 64);
    ctx.strokeStyle = 'rgba(70, 70, 70, 0.8)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const majorStartX = Math.floor(wMinX / majorSize) * majorSize;
    const majorStartY = Math.floor(wMinY / majorSize) * majorSize;
    for (let x = majorStartX; x <= wMaxX; x += majorSize) {
      const [sx] = this.worldToScreen(x, 0);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = majorStartY; y <= wMaxY; y += majorSize) {
      const [, sy] = this.worldToScreen(0, y);
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    // Origin lines
    const [ox, oy] = this.worldToScreen(0, 0);
    ctx.strokeStyle = 'rgba(0, 100, 180, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox, 0); ctx.lineTo(ox, h);
    ctx.moveTo(0, oy); ctx.lineTo(w, oy);
    ctx.stroke();
  }

  private drawBrush(brush: Brush, selected: boolean): void {
    const { ctx } = this;
    const h = this.axisH;
    const v = this.axisV;

    // Fill and stroke each face polygon
    ctx.fillStyle = selected ? 'rgba(255, 102, 0, 0.15)' : 'rgba(60, 80, 100, 0.2)';
    ctx.strokeStyle = selected ? '#ff6600' : '#4488bb';
    ctx.lineWidth = selected ? 1.5 : 1;

    for (const face of brush.faces) {
      if (face.polygon.length < 3) continue;
      ctx.beginPath();
      const [firstX, firstY] = this.worldToScreen(face.polygon[0][h], face.polygon[0][v]);
      ctx.moveTo(firstX, firstY);
      for (let i = 1; i < face.polygon.length; i++) {
        const [px, py] = this.worldToScreen(face.polygon[i][h], face.polygon[i][v]);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

  }

  private drawSelectionBox(): void {
    const bounds = this.editor.selectionBounds();
    if (!bounds) return;
    const { ctx } = this;
    const h = this.axisH, v = this.axisV;
    const [x0, y0] = this.worldToScreen(bounds.mins[h], bounds.maxs[v]);
    const [x1, y1] = this.worldToScreen(bounds.maxs[h], bounds.mins[v]);
    const bw = x1 - x0, bh = y1 - y0;

    // Dashed outline only for multi-selection
    if (this.editor.selection.length > 1) {
      ctx.strokeStyle = 'rgba(255, 170, 0, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x0, y0, bw, bh);
      ctx.setLineDash([]);
    }

    // Resize handles
    const hs = 3;
    ctx.fillStyle = '#ffaa00';
    const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
    const handles = [
      [midX, y0], [midX, y1],   // top, bottom
      [x0, midY], [x1, midY],   // left, right
      [x0, y0], [x1, y0],       // top-left, top-right
      [x0, y1], [x1, y1],       // bottom-left, bottom-right
    ];
    for (const [hx, hy] of handles) {
      ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
    }
  }

  private drawVertexHandles(): void {
    const { ctx } = this;
    const h = this.axisH, v = this.axisV, d = this.axisDepth;
    const r = 3;

    // Collect all vertices with their screen positions and state
    const handles: { sx: number; sy: number; selected: boolean; depth: number }[] = [];
    for (let di = 0; di < this.editor.vertexData.length; di++) {
      const data = this.editor.vertexData[di];
      for (let vi = 0; vi < data.vertices.length; vi++) {
        const pos = data.vertices[vi].position;
        const [sx, sy] = this.worldToScreen(pos[h], pos[v]);
        handles.push({
          sx, sy,
          selected: this.editor.isVertexSelected(di, vi),
          depth: pos[d],
        });
      }
    }

    // Sort: unselected first, then selected; within each group, lowest depth first
    // so highest depth (closest to camera) and selected draws on top
    handles.sort((a, b) => {
      if (a.selected !== b.selected) return a.selected ? 1 : -1;
      return a.depth - b.depth;
    });

    for (const handle of handles) {
      ctx.fillStyle = handle.selected ? '#ffffff' : '#44dd44';
      ctx.fillRect(handle.sx - r, handle.sy - r, r * 2, r * 2);
    }
  }

  private drawEntity(entity: Entity, selected: boolean): void {
    const { ctx } = this;
    const origin = entityOrigin(entity);
    if (!origin) return;

    const [sx, sy] = this.worldToScreen(origin[this.axisH], origin[this.axisV]);
    const size = 8;

    // Diamond shape
    ctx.fillStyle = selected ? '#ff6600' : '#44cc44';
    ctx.strokeStyle = selected ? '#ffaa00' : '#66ee66';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy - size);
    ctx.lineTo(sx + size, sy);
    ctx.lineTo(sx, sy + size);
    ctx.lineTo(sx - size, sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle = selected ? '#ffaa00' : '#88cc88';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(entity.classname, sx + size + 3, sy + 3);
  }

  private drawCreationPreview(): void {
    const { ctx, editor } = this;
    const [sx0, sy0] = this.worldToScreen(
      Math.min(editor.createStart[this.axisH], editor.createEnd[this.axisH]),
      Math.max(editor.createStart[this.axisV], editor.createEnd[this.axisV])
    );
    const [sx1, sy1] = this.worldToScreen(
      Math.max(editor.createStart[this.axisH], editor.createEnd[this.axisH]),
      Math.min(editor.createStart[this.axisV], editor.createEnd[this.axisV])
    );

    ctx.fillStyle = 'rgba(255, 200, 0, 0.15)';
    ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    ctx.setLineDash([]);
  }

  private drawClipPreview(viewW: number, viewH: number): void {
    const { ctx, editor } = this;
    const pts = editor.clipPoints;
    const aH = this.axisH;
    const aV = this.axisV;

    // Draw clip points
    ctx.fillStyle = '#ff3333';
    for (const p of pts) {
      const [sx, sy] = this.worldToScreen(p[aH], p[aV]);
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw clip line extending across the viewport
    if (pts.length === 2) {
      const [sx1, sy1] = this.worldToScreen(pts[0][aH], pts[0][aV]);
      const [sx2, sy2] = this.worldToScreen(pts[1][aH], pts[1][aV]);

      // Extend the line far beyond the viewport
      const dx = sx2 - sx1;
      const dy = sy2 - sy1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.1) {
        const ext = Math.max(viewW, viewH) * 2;
        const nx = dx / len;
        const ny = dy / len;

        ctx.strokeStyle = '#ff3333';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(sx1 - nx * ext, sy1 - ny * ext);
        ctx.lineTo(sx2 + nx * ext, sy2 + ny * ext);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw "keep" indicator — small arrow on the kept side
        const midX = (sx1 + sx2) / 2;
        const midY = (sy1 + sy2) / 2;
        // Perpendicular direction (left side of line direction = "front")
        const perpX = -ny;
        const perpY = nx;
        const arrowDist = 12;
        const isFront = editor.clipMode === 'front' || editor.clipMode === 'both';
        const isBack = editor.clipMode === 'back' || editor.clipMode === 'both';

        if (isFront) {
          ctx.fillStyle = 'rgba(100, 255, 100, 0.8)';
          ctx.beginPath();
          ctx.arc(midX + perpX * arrowDist, midY + perpY * arrowDist, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (isBack) {
          ctx.fillStyle = 'rgba(100, 255, 100, 0.8)';
          ctx.beginPath();
          ctx.arc(midX - perpX * arrowDist, midY - perpY * arrowDist, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private drawRubberBand(): void {
    const { ctx } = this;
    const x = Math.min(this.rubberBandStart[0], this.rubberBandEnd[0]);
    const y = Math.min(this.rubberBandStart[1], this.rubberBandEnd[1]);
    const w = Math.abs(this.rubberBandEnd[0] - this.rubberBandStart[0]);
    const h = Math.abs(this.rubberBandEnd[1] - this.rubberBandStart[1]);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = 'rgba(0, 120, 255, 0.1)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0, 120, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Input handling ──

  private setupEvents(): void {
    const el = this.canvas.parentElement!;

    el.addEventListener('mousedown', (e) => this.onMouseDown(e));
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
        this.editor.addClipPoint(point, this.axisDepth);
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
          }
        } else {
          if (!additive) this.editor.clearVertexSelection();
        }
        return;
      }

      // Check for resize edge on combined selection AABB
      if (this.editor.activeTool === 'select' && this.editor.selection.length > 0) {
        const edge = this.detectResizeEdge(wx, wy);
        if (edge) {
          const bounds = this.editor.selectionBounds()!;
          this.resizing = true;
          this.resizeEdges = edge.edges;
          this.resizeBrushes = this.editor.selection
            .filter(s => s.type === 'brush')
            .map(s => ({
              brush: s.brush,
              origPoints: s.brush.faces.map(f =>
                [vec3Copy(f.points[0]), vec3Copy(f.points[1]), vec3Copy(f.points[2])] as [Vec3, Vec3, Vec3]
              ),
            }));
          this.resizeOrigMins = vec3Copy(bounds.mins);
          this.resizeOrigMaxs = vec3Copy(bounds.maxs);
          this.resizeSnapshotTaken = false;
          this.dragWorldStart = [wx, wy];
          return;
        }
      }

      // Select tool: try to pick a brush or entity
      const picked = this.pickAt(wx, wy);
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (picked) {
        const alreadySelected = picked.type === 'brush'
          ? this.editor.isSelected(picked.brush)
          : this.editor.isEntitySelected(picked.entity);

        if (!additive && !alreadySelected) {
          this.editor.clearSelection();
        }

        // If already selected without modifier, just start dragging (preserve multi-selection)
        if (additive || !alreadySelected) {
          if (picked.type === 'brush') {
            this.editor.selectBrush(picked.entity, picked.brush, additive);
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
        const edge = this.editor.activeTool === 'select' && this.editor.selection.length > 0 && !this.editor.vertexMode
          ? this.detectResizeEdge(wx, wy) : null;
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

    if (this.resizing && this.resizeBrushes.length > 0) {
      const dx = wx - this.dragWorldStart[0];
      const dy = wy - this.dragWorldStart[1];
      const grid = this.editor.effectiveGrid(e.ctrlKey);
      const snappedDx = Math.round(dx / grid) * grid;
      const snappedDy = Math.round(dy / grid) * grid;

      if (!this.resizeSnapshotTaken) {
        this.editor.snapshot();
        this.resizeSnapshotTaken = true;
      }

      // Compute new edge positions
      const origMins = this.resizeOrigMins;
      const origMaxs = this.resizeOrigMaxs;
      const H = this.axisH;
      const V = this.axisV;

      let newMinH = origMins[H], newMaxH = origMaxs[H];
      let newMinV = origMins[V], newMaxV = origMaxs[V];
      if (this.resizeEdges.minH) newMinH += snappedDx;
      if (this.resizeEdges.maxH) newMaxH += snappedDx;
      if (this.resizeEdges.minV) newMinV += snappedDy;
      if (this.resizeEdges.maxV) newMaxV += snappedDy;

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
      this.editor.dirty = true;
      return;
    }

    if (this.dragging) {
      if (this.editor.creating) {
        // Update creation preview
        const grid = this.editor.effectiveGrid(e.ctrlKey);
        const snapped: Vec3 = vec3Copy(this.editor.createEnd);
        snapped[this.axisH] = Math.round(wx / grid) * grid;
        snapped[this.axisV] = Math.round(wy / grid) * grid;
        this.editor.createEnd = snapped;
        this.editor.dirty = true;
      } else if (this.vertexDragging) {
        // Move selected vertices
        const dx = wx - this.dragWorldStart[0];
        const dy = wy - this.dragWorldStart[1];
        const grid = this.editor.effectiveGrid(e.ctrlKey);
        const snappedDx = Math.round(dx / grid) * grid;
        const snappedDy = Math.round(dy / grid) * grid;

        if (snappedDx !== 0 || snappedDy !== 0) {
          if (!this.vertexDragSnapshotTaken) {
            this.editor.snapshot();
            this.vertexDragSnapshotTaken = true;
          }
          this.hasDragged = true;
          const delta: Vec3 = [0, 0, 0];
          delta[this.axisH] = snappedDx;
          delta[this.axisV] = snappedDy;
          this.editor.moveSelectedVertices(delta);
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
        const snappedDx = Math.round(dx / grid) * grid;
        const snappedDy = Math.round(dy / grid) * grid;

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
        for (const { entity, brush } of this.editor.allBrushes()) {
          if (brush.maxs[this.axisH] >= minH && brush.mins[this.axisH] <= maxH &&
              brush.maxs[this.axisV] >= minV && brush.mins[this.axisV] <= maxV) {
            this.editor.addBrushToSelection(entity, brush);
          }
        }
        for (const entity of this.editor.pointEntities()) {
          const origin = entityOrigin(entity);
          if (!origin) continue;
          if (origin[this.axisH] >= minH && origin[this.axisH] <= maxH &&
              origin[this.axisV] >= minV && origin[this.axisV] <= maxV) {
            this.editor.addEntityToSelection(entity);
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
      this.canvas.parentElement!.style.cursor = '';
      this.editor.statusMessage = 'Resized';
      return;
    }

    if (this.dragging) {
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
    const bounds = this.editor.selectionBounds();
    if (!bounds) return null;
    const threshold = 6 / this.zoom;

    const inH = wx >= bounds.mins[this.axisH] - threshold && wx <= bounds.maxs[this.axisH] + threshold;
    const inV = wy >= bounds.mins[this.axisV] - threshold && wy <= bounds.maxs[this.axisV] + threshold;
    if (!inH || !inV) return null;

    const nearMinH = Math.abs(wx - bounds.mins[this.axisH]) < threshold;
    const nearMaxH = Math.abs(wx - bounds.maxs[this.axisH]) < threshold;
    const nearMinV = Math.abs(wy - bounds.mins[this.axisV]) < threshold;
    const nearMaxV = Math.abs(wy - bounds.maxs[this.axisV]) < threshold;

    if (nearMinH || nearMaxH || nearMinV || nearMaxV) {
      return { edges: { minH: nearMinH, maxH: nearMaxH, minV: nearMinV, maxV: nearMaxV } };
    }
    return null;
  }

  private getResizeCursor(edges: { minH: boolean; maxH: boolean; minV: boolean; maxV: boolean }): string {
    const h = edges.minH || edges.maxH;
    const v = edges.minV || edges.maxV;
    if (h && v) {
      // Corner: NW/SE diagonal vs NE/SW diagonal
      if ((edges.minH && edges.maxV) || (edges.maxH && edges.minV)) return 'nwse-resize';
      return 'nesw-resize';
    }
    if (h) return 'ew-resize';
    if (v) return 'ns-resize';
    return '';
  }

  // Point-in-polygon test (ray casting) projected onto the 2D viewport axes
  private pointInBrush2D(brush: Brush, wx: number, wy: number): boolean {
    const h = this.axisH;
    const v = this.axisV;
    // Quick AABB reject
    if (wx < brush.mins[h] || wx > brush.maxs[h] ||
        wy < brush.mins[v] || wy > brush.maxs[v]) return false;
    // Test each face polygon — if point is inside any face's 2D projection, it's a hit
    for (const face of brush.faces) {
      const poly = face.polygon;
      if (poly.length < 3) continue;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i][v], yj = poly[j][v];
        const xi = poly[i][h], xj = poly[j][h];
        if ((yi > wy) !== (yj > wy) &&
            wx < (xj - xi) * (wy - yi) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  private pickAt(wx: number, wy: number): { type: 'brush'; entity: Entity; brush: Brush } | { type: 'entity'; entity: Entity } | null {
    // Check point entities first (smaller targets)
    for (const entity of this.editor.pointEntities()) {
      const origin = entityOrigin(entity);
      if (!origin) continue;
      const dx = Math.abs(wx - origin[this.axisH]);
      const dy = Math.abs(wy - origin[this.axisV]);
      if (dx < 12 / this.zoom && dy < 12 / this.zoom) {
        return { type: 'entity', entity };
      }
    }

    // Check brushes (pick smallest containing)
    let bestBrush: { entity: Entity; brush: Brush } | null = null;
    let bestArea = Infinity;

    for (const { entity, brush } of this.editor.allBrushes()) {
      if (this.pointInBrush2D(brush, wx, wy)) {
        const area = (brush.maxs[this.axisH] - brush.mins[this.axisH]) *
                     (brush.maxs[this.axisV] - brush.mins[this.axisV]);
        if (area < bestArea) {
          bestArea = area;
          bestBrush = { entity, brush };
        }
      }
    }

    if (bestBrush) {
      return { type: 'brush', entity: bestBrush.entity, brush: bestBrush.brush };
    }

    return null;
  }
}
