import { Vec3, vec3, vec3Snap, vec3Copy } from './math';
import { Editor, SelectionItem } from './editor';
import { Brush, brushContainsPoint2D, scaleBrushFaces } from './brush';
import { Entity, entityOrigin } from './entity';

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
  private resizeBrush: Brush | null = null;
  private resizeOrigMins: Vec3 = [0, 0, 0];
  private resizeOrigMaxs: Vec3 = [0, 0, 0];
  private resizeOrigPoints: [Vec3, Vec3, Vec3][] = [];
  private resizeSnapshotTaken = false;

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

    // Creation preview
    if (this.editor.creating && this.editor.createAxisH === this.axisH && this.editor.createAxisV === this.axisV) {
      this.drawCreationPreview();
    }

    // Clip line preview
    if (this.editor.activeTool === 'clip' && this.editor.clipPoints.length > 0 && this.editor.clipDepthAxis === this.axisDepth) {
      this.drawClipPreview(w, h);
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

    // Draw resize handles on selected brushes
    if (selected) {
      const hs = 3; // handle half-size in pixels
      ctx.fillStyle = '#ffaa00';
      const midH = (brush.mins[h] + brush.maxs[h]) / 2;
      const midV = (brush.mins[v] + brush.maxs[v]) / 2;
      // Edge midpoints
      const handles: [number, number][] = [
        [midH, brush.maxs[v]], // top
        [midH, brush.mins[v]], // bottom
        [brush.mins[h], midV], // left
        [brush.maxs[h], midV], // right
      ];
      // Corners
      handles.push(
        [brush.mins[h], brush.maxs[v]], // top-left
        [brush.maxs[h], brush.maxs[v]], // top-right
        [brush.mins[h], brush.mins[v]], // bottom-left
        [brush.maxs[h], brush.mins[v]], // bottom-right
      );
      for (const [wh, wv] of handles) {
        const [shx, shy] = this.worldToScreen(wh, wv);
        ctx.fillRect(shx - hs, shy - hs, hs * 2, hs * 2);
      }
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

  // ── Input handling ──

  private setupEvents(): void {
    const el = this.canvas.parentElement!;

    el.addEventListener('mousedown', (e) => this.onMouseDown(e));
    // Use document for move/up so drag continues even when mouse leaves viewport
    document.addEventListener('mousemove', (e) => {
      // Only process if we're actively interacting with this viewport
      if (this.panning || this.dragging || this.resizing) {
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
  }

  private getLocalPos(e: MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private onMouseDown(e: MouseEvent): void {
    // Track active viewport for rotation axis
    this.editor.rotationAxis = this.axisDepth;
    const [mx, my] = this.getLocalPos(e);

    // Right mouse, middle mouse, or shift+left: pan
    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
      this.panning = true;
      this.panStart = [mx, my];
      this.panCenterStart = [this.centerX, this.centerY];
      return;
    }

    if (e.button === 0) {
      const [wx, wy] = this.screenToWorld(mx, my);

      if (this.editor.activeTool === 'create') {
        // Start creating brush
        const snapped: Vec3 = [0, 0, 0];
        snapped[this.axisH] = Math.round(wx / this.editor.gridSize) * this.editor.gridSize;
        snapped[this.axisV] = Math.round(wy / this.editor.gridSize) * this.editor.gridSize;
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
        const origin: Vec3 = [0, 0, 0];
        origin[this.axisH] = Math.round(wx / this.editor.gridSize) * this.editor.gridSize;
        origin[this.axisV] = Math.round(wy / this.editor.gridSize) * this.editor.gridSize;
        origin[this.axisDepth] = 0;
        const entity = this.editor.addEntity(this.editor.currentEntityClass, origin);
        this.editor.clearSelection();
        this.editor.selectEntity(entity);
        this.editor.statusMessage = `Placed ${this.editor.currentEntityClass}`;
        return;
      }

      if (this.editor.activeTool === 'clip') {
        // Place clip point
        const point: Vec3 = [0, 0, 0];
        point[this.axisH] = Math.round(wx / this.editor.gridSize) * this.editor.gridSize;
        point[this.axisV] = Math.round(wy / this.editor.gridSize) * this.editor.gridSize;
        this.editor.addClipPoint(point, this.axisDepth);
        return;
      }

      // Check for resize edge on selected brush
      if (this.editor.activeTool === 'select' && this.editor.selection.length > 0) {
        const edge = this.detectResizeEdge(wx, wy);
        if (edge) {
          this.resizing = true;
          this.resizeEdges = edge.edges;
          this.resizeBrush = edge.brush;
          this.resizeOrigMins = vec3Copy(edge.brush.mins);
          this.resizeOrigMaxs = vec3Copy(edge.brush.maxs);
          this.resizeOrigPoints = edge.brush.faces.map(f =>
            [vec3Copy(f.points[0]), vec3Copy(f.points[1]), vec3Copy(f.points[2])] as [Vec3, Vec3, Vec3]
          );
          this.resizeSnapshotTaken = false;
          this.dragWorldStart = [wx, wy];
          return;
        }
      }

      // Select tool: try to pick a brush or entity
      const picked = this.pickAt(wx, wy);
      if (picked) {
        if (!e.ctrlKey && !e.metaKey) {
          // Check if already selected — if so, start dragging
          const alreadySelected = picked.type === 'brush'
            ? this.editor.isSelected(picked.brush)
            : this.editor.isEntitySelected(picked.entity);

          if (!alreadySelected) {
            this.editor.clearSelection();
          }
        }

        if (picked.type === 'brush') {
          this.editor.selectBrush(picked.entity, picked.brush, e.ctrlKey || e.metaKey);
        } else {
          this.editor.selectEntity(picked.entity, e.ctrlKey || e.metaKey);
        }

        // Start drag-move
        this.dragging = true;
        this.hasDragged = false;
        this.moveSnapshotTaken = false;
        this.dragStart = [mx, my];
        this.dragWorldStart = [wx, wy];
      } else {
        if (!e.ctrlKey && !e.metaKey) {
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
      const edge = this.editor.activeTool === 'select' && this.editor.selection.length > 0
        ? this.detectResizeEdge(wx, wy) : null;
      this.canvas.parentElement!.style.cursor = edge ? this.getResizeCursor(edge.edges) : '';
    }

    if (this.panning) {
      const dx = (mx - this.panStart[0]) / this.zoom;
      const dy = (my - this.panStart[1]) / this.zoom;
      this.centerX = this.panCenterStart[0] - dx;
      this.centerY = this.panCenterStart[1] + dy;
      this.editor.dirty = true;
      return;
    }

    if (this.resizing && this.resizeBrush) {
      const dx = wx - this.dragWorldStart[0];
      const dy = wy - this.dragWorldStart[1];
      const grid = this.editor.gridSize;
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

      // Enforce minimum size
      const minSize = grid;
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

      // Shift held during drag: uniform scale from brush center
      if (e.shiftKey) {
        // Pick the scale factor from the dragged axis
        let uniformScale = scale[H] !== 1 ? scale[H] : scale[V];
        if (scale[H] !== 1 && scale[V] !== 1) {
          // Corner drag: use the axis with the larger change
          uniformScale = Math.abs(scale[H] - 1) > Math.abs(scale[V] - 1) ? scale[H] : scale[V];
        }
        const center: Vec3 = [0, 0, 0];
        center[H] = (origMins[H] + origMaxs[H]) / 2;
        center[V] = (origMins[V] + origMaxs[V]) / 2;
        scale[H] = uniformScale;
        scale[V] = uniformScale;
        scaleOrigin[H] = center[H];
        scaleOrigin[V] = center[V];
      }

      scaleBrushFaces(this.resizeBrush, this.resizeOrigPoints, scaleOrigin, scale);
      this.editor.dirty = true;
      return;
    }

    if (this.dragging) {
      if (this.editor.creating) {
        // Update creation preview
        const snapped: Vec3 = vec3Copy(this.editor.createEnd);
        snapped[this.axisH] = Math.round(wx / this.editor.gridSize) * this.editor.gridSize;
        snapped[this.axisV] = Math.round(wy / this.editor.gridSize) * this.editor.gridSize;
        this.editor.createEnd = snapped;
        this.editor.dirty = true;
      } else if (this.editor.selection.length > 0) {
        // Move selection
        const dx = wx - this.dragWorldStart[0];
        const dy = wy - this.dragWorldStart[1];
        const grid = this.editor.gridSize;
        const snappedDx = Math.round(dx / grid) * grid;
        const snappedDy = Math.round(dy / grid) * grid;

        if (snappedDx !== 0 || snappedDy !== 0) {
          if (!this.moveSnapshotTaken) {
            this.editor.snapshot();
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
    if (this.panning) {
      this.panning = false;
      return;
    }

    if (this.resizing) {
      this.resizing = false;
      this.resizeBrush = null;
      this.canvas.parentElement!.style.cursor = '';
      this.editor.statusMessage = 'Resized';
      return;
    }

    if (this.dragging) {
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

        if (maxs[this.axisH] - mins[this.axisH] >= this.editor.gridSize &&
            maxs[this.axisV] - mins[this.axisV] >= this.editor.gridSize) {
          const brush = this.editor.addBrush(mins, maxs);
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
    brush: Brush;
    entity: Entity;
    edges: { minH: boolean; maxH: boolean; minV: boolean; maxV: boolean };
  } | null {
    const threshold = 6 / this.zoom; // 6 pixels in world units

    for (const item of this.editor.selection) {
      if (item.type === 'entity') continue;
      const brush = item.brush;
      const entity = item.entity;

      // Check if cursor is near the brush AABB
      const inH = wx >= brush.mins[this.axisH] - threshold && wx <= brush.maxs[this.axisH] + threshold;
      const inV = wy >= brush.mins[this.axisV] - threshold && wy <= brush.maxs[this.axisV] + threshold;
      if (!inH || !inV) continue;

      const nearMinH = Math.abs(wx - brush.mins[this.axisH]) < threshold;
      const nearMaxH = Math.abs(wx - brush.maxs[this.axisH]) < threshold;
      const nearMinV = Math.abs(wy - brush.mins[this.axisV]) < threshold;
      const nearMaxV = Math.abs(wy - brush.maxs[this.axisV]) < threshold;

      if (nearMinH || nearMaxH || nearMinV || nearMaxV) {
        return { brush, entity, edges: { minH: nearMinH, maxH: nearMaxH, minV: nearMinV, maxV: nearMaxV } };
      }
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
