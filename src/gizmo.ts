import { Vec3, Mat4, vec3Add, vec3Sub, vec3Scale, vec3Length, vec3Copy, snapAxisDelta } from './math';
import { Editor } from './editor';
import { cloneTextureProjection, type BrushTextureProjection } from './brush';
import { PatchControlPoint } from './patch';
import { getSelectedBrushItems, getSelectedPatchItems } from './editor-selection';
import { createLineBuffer } from './gl-utils';
import { moveSelectedFaces, scaleGeometryFromOriginals } from './editor-transforms';
import { appendBoxTriangles, appendConeTriangles, appendTubeTriangles } from './geometry-primitives';
import {
  DEFAULT_ORTHOGRAPHIC_SCALE,
  type Viewport3DProjection,
} from './viewport3d-projection';

export interface GizmoSegment {
  start: number;
  count: number;
  color: Vec3;
}

function gizmoLength(
  center: Vec3,
  cameraPos: Vec3,
  projection: Viewport3DProjection,
  orthographicScale: number,
): number {
  return projection === 'orthographic'
    ? orthographicScale * 0.21
    : vec3Length(vec3Sub(center, cameraPos)) * 0.12;
}

export function buildGizmoAxisTriangles(center: Vec3, axis: number, length: number, scaleMode: boolean): number[] {
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const direction = axes[axis];
  if (!direction || length <= 0) return [];
  const vertices: number[] = [];
  const tip = vec3Add(center, vec3Scale(direction, length));
  const tipSize = length * 0.15;
  const shaftRadius = length * 0.028;

  if (scaleMode) {
    const halfSize = tipSize * 0.5;
    const shaftEnd = vec3Add(tip, vec3Scale(direction, -halfSize));
    appendTubeTriangles(vertices, center, shaftEnd, shaftRadius);
    appendBoxTriangles(vertices, tip, halfSize);
  } else {
    const coneBase = vec3Add(tip, vec3Scale(direction, -tipSize * 1.8));
    appendTubeTriangles(vertices, center, coneBase, shaftRadius);
    appendConeTriangles(vertices, coneBase, tip, tipSize * 0.65);
  }
  return vertices;
}

export class Gizmo {
  // GL resources
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  segments: GizmoSegment[] = [];

  // Drag state (public for viewport3d to read)
  dragging = false;
  axis = -1; // 0=X, 1=Y, 2=Z
  center: Vec3 = [0, 0, 0];

  private dragLast: [number, number] = [0, 0];
  private snapshotTaken = false;
  private origMins: Vec3 = [0, 0, 0];
  private origMaxs: Vec3 = [0, 0, 0];
  private origPoints: [Vec3, Vec3, Vec3][][] = [];
  private origTextureProjections: BrushTextureProjection[][] = [];
  private origPatchCtrls: PatchControlPoint[][][] = [];
  private screenDir: [number, number] = [0, 0];
  private screenDirLen = 0;
  private worldPerPixel = 1;

  private geoSnapTargets: [number[], number[], number[]] | null = null;
  private gl: WebGL2RenderingContext;
  private editor: Editor;

  constructor(gl: WebGL2RenderingContext, editor: Editor) {
    this.gl = gl;
    this.editor = editor;
    const buf = createLineBuffer(gl);
    this.vao = buf.vao;
    this.vbo = buf.vbo;
  }

  build(
    cameraPos: Vec3,
    projection: Viewport3DProjection = 'perspective',
    orthographicScale = DEFAULT_ORTHOGRAPHIC_SCALE,
  ): void {
    const gl = this.gl;
    const center = this.editor.vertexMode
      ? this.editor.vertexSelectionCenter()
      : this.editor.patchEditMode
        ? this.editor.patchControlSelectionCenter()
        : this.editor.selectionCenter();
    this.segments = [];

    if (!center) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
      return;
    }

    // Don't update center during an active drag — it must stay fixed
    if (!this.dragging) {
      this.center = center;
    }

    // Gizmo length scales with distance from camera for consistent screen size
    const len = gizmoLength(center, cameraPos, projection, orthographicScale);
    const colors: Vec3[] = [[1, 0.2, 0.2], [0.2, 1, 0.2], [0.4, 0.4, 1]];
    const isScale = this.editor.gizmoMode === 'scale';
    const verts: number[] = [];

    for (let a = 0; a < 3; a++) {
      const start = verts.length / 3;
      verts.push(...buildGizmoAxisTriangles(center, a, len, isScale));

      const count = verts.length / 3 - start;
      this.segments.push({ start, count, color: colors[a] });
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
  }

  pickAxis(
    screenX: number,
    screenY: number,
    pv: Mat4,
    canvasRect: DOMRect,
    cameraPos: Vec3,
    projection: Viewport3DProjection = 'perspective',
    orthographicScale = DEFAULT_ORTHOGRAPHIC_SCALE,
  ): number {
    const center = this.center;
    const len = gizmoLength(center, cameraPos, projection, orthographicScale);
    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const threshold = 10; // pixels

    const cScreen = this.worldToScreen(center, pv, canvasRect);
    if (!cScreen) return -1;

    let bestAxis = -1;
    let bestDist = threshold;

    for (let a = 0; a < 3; a++) {
      const tip = vec3Add(center, vec3Scale(axes[a], len));
      const tScreen = this.worldToScreen(tip, pv, canvasRect);
      if (!tScreen) continue;

      const d = this.pointToSegmentDist(screenX, screenY, cScreen[0], cScreen[1], tScreen[0], tScreen[1]);
      if (d < bestDist) {
        bestDist = d;
        bestAxis = a;
      }
    }
    return bestAxis;
  }

  startDrag(
    axis: number,
    clientX: number,
    clientY: number,
    pv: Mat4,
    canvasRect: DOMRect,
    cameraPos: Vec3,
    projection: Viewport3DProjection = 'perspective',
    orthographicScale = DEFAULT_ORTHOGRAPHIC_SCALE,
  ): void {
    this.dragging = true;
    this.axis = axis;
    this.dragLast = [clientX, clientY];
    this.snapshotTaken = false;
    this.geoSnapTargets = this.editor.snapToGeometry ? this.editor.collectSnapTargets() : null;

    // Cache screen direction and worldPerPixel at drag start
    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const cScreen = this.worldToScreen(this.center, pv, canvasRect);
    const tipWorld = vec3Add(this.center, vec3Scale(axes[axis], 100));
    const tScreen = this.worldToScreen(tipWorld, pv, canvasRect);
    if (cScreen && tScreen) {
      this.screenDir = [tScreen[0] - cScreen[0], tScreen[1] - cScreen[1]];
      this.screenDirLen = Math.sqrt(this.screenDir[0] ** 2 + this.screenDir[1] ** 2);
    }
    const dist = vec3Length(vec3Sub(this.center, cameraPos));
    this.worldPerPixel = projection === 'orthographic'
      ? 2 * orthographicScale / canvasRect.height
      : (2 * dist * Math.tan(Math.PI / 6)) / canvasRect.height;

    // Store original state for scale mode
    if (this.editor.gizmoMode === 'scale') {
      const center = this.editor.selectionCenter();
      if (center) this.center = center;
      this.origPoints = [];
      this.origTextureProjections = [];
      this.origPatchCtrls = [];
      const selectedBrushItems = getSelectedBrushItems(this.editor);
      const selectedPatchItems = getSelectedPatchItems(this.editor);
      let mins: Vec3 = [Infinity, Infinity, Infinity];
      let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const { brush } of selectedBrushItems) {
        this.origPoints.push(
          brush.faces.map((f: { points: [Vec3, Vec3, Vec3] }) =>
            [vec3Copy(f.points[0]), vec3Copy(f.points[1]), vec3Copy(f.points[2])] as [Vec3, Vec3, Vec3]
          )
        );
        this.origTextureProjections.push(
          brush.faces.map(face => cloneTextureProjection(face.textureProjection)),
        );
        for (let i = 0; i < 3; i++) {
          if (brush.mins[i] < mins[i]) mins[i] = brush.mins[i];
          if (brush.maxs[i] > maxs[i]) maxs[i] = brush.maxs[i];
        }
      }
      for (const { patch } of selectedPatchItems) {
        this.origPatchCtrls.push(
          patch.ctrl.map(row =>
            row.map(cp => ({ xyz: vec3Copy(cp.xyz), uv: [cp.uv[0], cp.uv[1]] as [number, number] }))
          )
        );
        for (let i = 0; i < 3; i++) {
          if (patch.mins[i] < mins[i]) mins[i] = patch.mins[i];
          if (patch.maxs[i] > maxs[i]) maxs[i] = patch.maxs[i];
        }
      }
      this.origMins = mins;
      this.origMaxs = maxs;
    }
  }

  handleDrag(e: MouseEvent): void {
    if (!this.snapshotTaken) {
      const label = this.editor.vertexMode
        ? 'Move brush vertices'
        : this.editor.patchEditMode
          ? 'Move patch control points'
          : this.editor.selectedFaces.length > 0
            ? 'Move brush faces'
          : this.editor.gizmoMode === 'scale' ? 'Scale selection' : 'Move selection';
      this.editor.beginTransaction(label);
      if (e.altKey && this.editor.gizmoMode === 'move' && this.editor.selectedFaces.length === 0) {
        this.editor.duplicateSelectionInPlace();
      }
      this.snapshotTaken = true;
    }

    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const axis = axes[this.axis];

    const screenDirX = this.screenDir[0];
    const screenDirY = this.screenDir[1];
    const screenDirLen = this.screenDirLen;
    if (screenDirLen < 0.1) return;

    // Mouse delta projected onto axis screen direction
    const mdx = e.clientX - this.dragLast[0];
    const mdy = e.clientY - this.dragLast[1];
    const projected = (mdx * screenDirX + mdy * screenDirY) / screenDirLen;

    const worldDelta = projected * this.worldPerPixel;

    if (this.editor.vertexMode) {
      const grid = this.editor.effectiveGrid(e.ctrlKey);
      const a = this.axis;
      const abs = this.editor.gridAbsolute;
      const threshold = grid * 0.5;
      const geo = this.geoSnapTargets ? this.geoSnapTargets[a] : null;
      const vtxCenter = this.editor.vertexSelectionCenter();
      const snapped = vtxCenter
        ? snapAxisDelta(worldDelta, [vtxCenter[a] + worldDelta], grid, abs, geo, threshold).delta
        : Math.round(worldDelta / grid) * grid;
      if (snapped !== 0) {
        const delta: Vec3 = vec3Scale(axis, snapped);
        this.editor.moveSelectedVertices(delta);
        this.center = vec3Add(this.center, delta);
        this.dragLast = [e.clientX, e.clientY];
      }
    } else if (this.editor.patchEditMode) {
      const grid = this.editor.effectiveGrid(e.ctrlKey);
      const a = this.axis;
      const abs = this.editor.gridAbsolute;
      const threshold = grid * 0.5;
      const geo = this.geoSnapTargets ? this.geoSnapTargets[a] : null;
      const cpCenter = this.editor.patchControlSelectionCenter();
      const snapped = cpCenter
        ? snapAxisDelta(worldDelta, [cpCenter[a] + worldDelta], grid, abs, geo, threshold).delta
        : Math.round(worldDelta / grid) * grid;
      if (snapped !== 0) {
        const delta: Vec3 = vec3Scale(axis, snapped);
        this.editor.moveSelectedControlPoints(delta);
        this.center = vec3Add(this.center, delta);
        this.dragLast = [e.clientX, e.clientY];
      }
    } else if (this.editor.gizmoMode === 'move') {
      const grid = this.editor.effectiveGrid(e.ctrlKey);
      const a = this.axis;
      const abs = this.editor.gridAbsolute;
      const threshold = grid * 0.5;
      const geo = this.geoSnapTargets ? this.geoSnapTargets[a] : null;
      const bounds = this.editor.selectionBounds();
      let refs: number[];
      if (bounds) {
        const rawMin = bounds.mins[a] + worldDelta;
        const rawMax = bounds.maxs[a] + worldDelta;
        refs = [rawMin, rawMax, (rawMin + rawMax) / 2];
      } else {
        refs = [this.center[a] + worldDelta];
      }
      const snapped = snapAxisDelta(worldDelta, refs, grid, abs, geo, threshold).delta;
      if (snapped !== 0) {
        const delta: Vec3 = vec3Scale(axis, snapped);
        if (this.editor.selectedFaces.length > 0) moveSelectedFaces(this.editor, delta);
        else this.editor.moveSelection(delta);
        this.center = vec3Add(this.center, delta);
        this.dragLast = [e.clientX, e.clientY];
      }
    } else {
      // Scale along axis from selection center
      const a = this.axis;
      const origExtent = (this.origMaxs[a] - this.origMins[a]) / 2;
      if (Math.abs(origExtent) < 0.01) return;

      const totalDx = e.clientX - this.dragLast[0];
      const totalDy = e.clientY - this.dragLast[1];
      const totalProjected = (totalDx * screenDirX + totalDy * screenDirY) / screenDirLen;
      const totalWorld = totalProjected * this.worldPerPixel;

      const grid = this.editor.effectiveGrid(e.ctrlKey);
      let newExtent = origExtent + totalWorld;
      newExtent = Math.round(newExtent / grid) * grid;
      if (Math.abs(newExtent) < grid) newExtent = newExtent >= 0 ? grid : -grid;
      const scaleFactor = newExtent / origExtent;
      if (scaleFactor < 0.1) return;

      const scale: Vec3 = [1, 1, 1];
      scale[a] = scaleFactor;
      const origin: Vec3 = vec3Copy(this.center);

      const selectedBrushItems = getSelectedBrushItems(this.editor);
      const selectedPatchItems = getSelectedPatchItems(this.editor);

      scaleGeometryFromOriginals(
        this.editor,
        selectedBrushItems.flatMap((item, index) => {
          const origPoints = this.origPoints[index];
          const textureProjections = this.origTextureProjections[index];
          return origPoints?.length && textureProjections?.length
            ? [{ brush: item.brush, origPoints, textureProjections }]
            : [];
        }),
        selectedPatchItems.flatMap((item, index) => {
          const origCtrl = this.origPatchCtrls[index];
          return origCtrl?.length ? [{ patch: item.patch, origCtrl }] : [];
        }),
        origin,
        scale,
      );
      this.editor.recordTransactionTransform({ kind: 'scale', scale, centerMode: 'selection' });
    }
  }

  endDrag(): void {
    if (this.snapshotTaken) {
      this.editor.commitTransaction();
      this.snapshotTaken = false;
    }
    this.dragging = false;
    this.axis = -1;
    this.geoSnapTargets = null;
    this.editor.redrawRequested = true;
  }

  private worldToScreen(p: Vec3, pv: Mat4, rect: DOMRect): [number, number] | null {
    const x = pv[0]*p[0] + pv[4]*p[1] + pv[8]*p[2] + pv[12];
    const y = pv[1]*p[0] + pv[5]*p[1] + pv[9]*p[2] + pv[13];
    const w = pv[3]*p[0] + pv[7]*p[1] + pv[11]*p[2] + pv[15];
    if (w < 0.01) return null;
    return [
      (x / w * 0.5 + 0.5) * rect.width + rect.left,
      (-y / w * 0.5 + 0.5) * rect.height + rect.top,
    ];
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
}
