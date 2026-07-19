import { Editor } from './editor';
import { Brush } from './brush';
import { Entity, entityColor, entityOrigin, lightColorCSS } from './entity';
import { getSelectedBrushItems, getSelectedPatchItems } from './editor-selection';
import { Patch } from './patch';
import { collectBrushEdges } from './vertex';

interface GeoSnapLine {
  axis: 'h' | 'v';
  value: number;
}

export interface Viewport2DRenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  editor: Editor;
  axisH: number;
  axisV: number;
  axisDepth: number;
  centerX: number;
  centerY: number;
  zoom: number;
  rotating: boolean;
  rotateStartAngle: number;
  rotateAppliedAngle: number;
  geoSnapLines: GeoSnapLine[];
  rubberBanding: boolean;
  rubberBandStart: [number, number];
  rubberBandEnd: [number, number];
  worldToScreen: (wx: number, wy: number) => [number, number];
  screenToWorld: (sx: number, sy: number) => [number, number];
}

export function renderViewport2D(ctx: Viewport2DRenderContext): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = ctx.canvas.getBoundingClientRect();
  ctx.canvas.width = rect.width * dpr;
  ctx.canvas.height = rect.height * dpr;
  ctx.ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;

  ctx.ctx.fillStyle = '#1e1e1e';
  ctx.ctx.fillRect(0, 0, w, h);

  drawGrid(ctx, w, h);

  for (const { entity, brush } of ctx.editor.allBrushes()) {
    if (!ctx.editor.isBrushVisible(brush, entity)) continue;
    drawBrush(ctx, brush, ctx.editor.isSelected(brush, entity));
  }

  for (const { entity, patch } of ctx.editor.allPatches()) {
    if (!ctx.editor.isPatchVisible(patch, entity)) continue;
    drawPatch(ctx, patch, ctx.editor.isPatchSelected(patch, entity));
  }

  if (ctx.editor.display.categories.paths) drawPathLines(ctx);
  if (ctx.editor.display.categories.paths && ctx.editor.display.categories.curves) drawPathCurves(ctx);
  drawPointfile(ctx);

  if (ctx.editor.patchEditMode) {
    drawTerrainBrushPreview(ctx);
    if (ctx.editor.terrainBrushMode !== 'texture') {
      drawPatchControlPoints(ctx);
    }
  }

  for (const entity of ctx.editor.nonWorldspawnEntities()) {
    if (!ctx.editor.isEntityVisible(entity)) continue;
    drawEntity(ctx, entity, ctx.editor.isEntitySelected(entity));
  }

  const selectedBrushItems = getSelectedBrushItems(ctx.editor);
  const selectedPatchItems = getSelectedPatchItems(ctx.editor);

  if (ctx.editor.activeTool === 'select' && ctx.editor.selection.length > 0 &&
      !ctx.editor.vertexMode && !ctx.editor.patchEditMode &&
      (selectedBrushItems.length > 0 || selectedPatchItems.length > 0)) {
    drawSelectionBox(ctx);
  }

  if (ctx.editor.vertexMode) {
    drawVertexHandles(ctx);
  }

  if (ctx.editor.creating && ctx.editor.createAxisH === ctx.axisH && ctx.editor.createAxisV === ctx.axisV) {
    drawCreationPreview(ctx);
  }

  if (ctx.editor.activeTool === 'clip' && ctx.editor.clipPoints.length > 0 && ctx.editor.clipDepthAxis === ctx.axisDepth) {
    drawClipPreview(ctx, w, h);
  }

  if (ctx.editor.activeTool === 'rotate' && ctx.editor.rotateAnchor) {
    drawRotateAnchor(ctx);
  }

  if (ctx.geoSnapLines.length > 0) {
    drawGeoSnapLines(ctx, w, h);
  }

  if (ctx.rubberBanding) {
    drawRubberBand(ctx);
  }

  drawCamera(ctx);

  ctx.ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawGrid(ctx: Viewport2DRenderContext, w: number, h: number): void {
  const gridSize = ctx.editor.gridSize;
  const [wMinX, wMaxY] = ctx.screenToWorld(0, 0);
  const [wMaxX, wMinY] = ctx.screenToWorld(w, h);

  const minorAlpha = Math.min(1, ctx.zoom * gridSize / 8);
  if (minorAlpha > 0.1) {
    ctx.ctx.strokeStyle = `rgba(50, 50, 50, ${minorAlpha * 0.6})`;
    ctx.ctx.lineWidth = 0.5;
    ctx.ctx.beginPath();
    const startX = Math.floor(wMinX / gridSize) * gridSize;
    const startY = Math.floor(wMinY / gridSize) * gridSize;
    for (let x = startX; x <= wMaxX; x += gridSize) {
      const [sx] = ctx.worldToScreen(x, 0);
      ctx.ctx.moveTo(sx, 0);
      ctx.ctx.lineTo(sx, h);
    }
    for (let y = startY; y <= wMaxY; y += gridSize) {
      const [, sy] = ctx.worldToScreen(0, y);
      ctx.ctx.moveTo(0, sy);
      ctx.ctx.lineTo(w, sy);
    }
    ctx.ctx.stroke();
  }

  const majorSize = Math.max(gridSize * 8, 64);
  ctx.ctx.strokeStyle = 'rgba(70, 70, 70, 0.8)';
  ctx.ctx.lineWidth = 0.5;
  ctx.ctx.beginPath();
  const majorStartX = Math.floor(wMinX / majorSize) * majorSize;
  const majorStartY = Math.floor(wMinY / majorSize) * majorSize;
  for (let x = majorStartX; x <= wMaxX; x += majorSize) {
    const [sx] = ctx.worldToScreen(x, 0);
    ctx.ctx.moveTo(sx, 0);
    ctx.ctx.lineTo(sx, h);
  }
  for (let y = majorStartY; y <= wMaxY; y += majorSize) {
    const [, sy] = ctx.worldToScreen(0, y);
    ctx.ctx.moveTo(0, sy);
    ctx.ctx.lineTo(w, sy);
  }
  ctx.ctx.stroke();

  const [ox, oy] = ctx.worldToScreen(0, 0);
  ctx.ctx.strokeStyle = 'rgba(0, 100, 180, 0.5)';
  ctx.ctx.lineWidth = 1;
  ctx.ctx.beginPath();
  ctx.ctx.moveTo(ox, 0);
  ctx.ctx.lineTo(ox, h);
  ctx.ctx.moveTo(0, oy);
  ctx.ctx.lineTo(w, oy);
  ctx.ctx.stroke();
}

function drawBrush(ctx: Viewport2DRenderContext, brush: Brush, selected: boolean): void {
  ctx.ctx.fillStyle = selected ? 'rgba(255, 102, 0, 0.15)' : 'rgba(60, 80, 100, 0.2)';
  ctx.ctx.strokeStyle = selected ? '#ff6600' : '#4488bb';
  ctx.ctx.lineWidth = selected ? 1.5 : 1;

  for (const face of brush.faces) {
    if (face.polygon.length < 3) continue;
    ctx.ctx.beginPath();
    const [firstX, firstY] = ctx.worldToScreen(face.polygon[0][ctx.axisH], face.polygon[0][ctx.axisV]);
    ctx.ctx.moveTo(firstX, firstY);
    for (let i = 1; i < face.polygon.length; i++) {
      const [px, py] = ctx.worldToScreen(face.polygon[i][ctx.axisH], face.polygon[i][ctx.axisV]);
      ctx.ctx.lineTo(px, py);
    }
    ctx.ctx.closePath();
    ctx.ctx.fill();
    ctx.ctx.stroke();
  }
}

function drawPatch(ctx: Viewport2DRenderContext, patch: Patch, selected: boolean): void {
  const textureTerrainMode = ctx.editor.patchEditMode && ctx.editor.terrainBrushMode === 'texture';
  ctx.ctx.strokeStyle = textureTerrainMode
    ? selected ? 'rgba(255, 170, 96, 0.5)' : 'rgba(68, 136, 187, 0.22)'
    : selected ? '#ff6600' : '#4488bb';
  ctx.ctx.lineWidth = textureTerrainMode
    ? selected ? 1 : 0.75
    : selected ? 1.5 : 1;
  ctx.ctx.fillStyle = textureTerrainMode
    ? selected ? 'rgba(255, 102, 0, 0.015)' : 'rgba(60, 80, 100, 0.04)'
    : selected ? 'rgba(255, 102, 0, 0.08)' : 'rgba(60, 80, 100, 0.1)';

  const [x0, y0] = ctx.worldToScreen(patch.mins[ctx.axisH], patch.maxs[ctx.axisV]);
  const [x1, y1] = ctx.worldToScreen(patch.maxs[ctx.axisH], patch.mins[ctx.axisV]);
  ctx.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  if (!textureTerrainMode) {
    ctx.ctx.beginPath();
    if (patch.terrainDef) {
      for (let r = 0; r < patch.height; r++) {
        for (let c = 0; c < patch.width; c++) {
          const p = patch.ctrl[r]?.[c]?.xyz;
          if (!p) continue;
          const [sx, sy] = ctx.worldToScreen(p[ctx.axisH], p[ctx.axisV]);
          if (c < patch.width - 1) {
            const q = patch.ctrl[r]?.[c + 1]?.xyz;
            if (q) {
              const [qx, qy] = ctx.worldToScreen(q[ctx.axisH], q[ctx.axisV]);
              ctx.ctx.moveTo(sx, sy);
              ctx.ctx.lineTo(qx, qy);
            }
          }
          if (r < patch.height - 1) {
            const q = patch.ctrl[r + 1]?.[c]?.xyz;
            if (q) {
              const [qx, qy] = ctx.worldToScreen(q[ctx.axisH], q[ctx.axisV]);
              ctx.ctx.moveTo(sx, sy);
              ctx.ctx.lineTo(qx, qy);
            }
          }
        }
      }
    } else {
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
              const [sx, sy] = ctx.worldToScreen(p[ctx.axisH], p[ctx.axisV]);
              if (ui < n - 1) {
                const q = patch.tessVerts[idx + 1]?.position;
                if (q) {
                  const [qx, qy] = ctx.worldToScreen(q[ctx.axisH], q[ctx.axisV]);
                  ctx.ctx.moveTo(sx, sy);
                  ctx.ctx.lineTo(qx, qy);
                }
              }
              if (vi < n - 1) {
                const q = patch.tessVerts[idx + n]?.position;
                if (q) {
                  const [qx, qy] = ctx.worldToScreen(q[ctx.axisH], q[ctx.axisV]);
                  ctx.ctx.moveTo(sx, sy);
                  ctx.ctx.lineTo(qx, qy);
                }
              }
            }
          }
        }
      }
    }
    ctx.ctx.stroke();
  } else if (selected) {
    ctx.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  if (selected && !textureTerrainMode) {
    ctx.ctx.strokeStyle = 'rgba(200, 80, 200, 0.6)';
    ctx.ctx.lineWidth = 0.75;
    ctx.ctx.beginPath();
    for (let r = 0; r < patch.height; r++) {
      for (let c = 0; c < patch.width; c++) {
        const p = patch.ctrl[r][c].xyz;
        const [sx, sy] = ctx.worldToScreen(p[ctx.axisH], p[ctx.axisV]);
        if (c < patch.width - 1) {
          const q = patch.ctrl[r][c + 1].xyz;
          const [qx, qy] = ctx.worldToScreen(q[ctx.axisH], q[ctx.axisV]);
          ctx.ctx.moveTo(sx, sy);
          ctx.ctx.lineTo(qx, qy);
        }
        if (r < patch.height - 1) {
          const q = patch.ctrl[r + 1][c].xyz;
          const [qx, qy] = ctx.worldToScreen(q[ctx.axisH], q[ctx.axisV]);
          ctx.ctx.moveTo(sx, sy);
          ctx.ctx.lineTo(qx, qy);
        }
      }
    }
    ctx.ctx.stroke();
  }
}

function drawPointfile(ctx: Viewport2DRenderContext): void {
  const points = ctx.editor.pointfilePoints;
  if (points.length === 0) return;

  ctx.ctx.save();
  ctx.ctx.strokeStyle = '#ff4040';
  ctx.ctx.lineWidth = 2;
  ctx.ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const [sx, sy] = ctx.worldToScreen(points[i][ctx.axisH], points[i][ctx.axisV]);
    if (i === 0) ctx.ctx.moveTo(sx, sy);
    else ctx.ctx.lineTo(sx, sy);
  }
  ctx.ctx.stroke();

  const current = points[Math.max(0, Math.min(ctx.editor.pointfileIndex, points.length - 1))];
  if (current) {
    const [sx, sy] = ctx.worldToScreen(current[ctx.axisH], current[ctx.axisV]);
    ctx.ctx.fillStyle = '#ffcc00';
    ctx.ctx.strokeStyle = '#ff4040';
    ctx.ctx.lineWidth = 1.5;
    ctx.ctx.beginPath();
    ctx.ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.ctx.fill();
    ctx.ctx.stroke();
  }
  ctx.ctx.restore();
}

function drawTerrainBrushPreview(ctx: Viewport2DRenderContext): void {
  if (ctx.editor.terrainBrushMode === 'texture') {
    const previewTargets = ctx.editor.hoveredTerrainPaintTargets();
    if (previewTargets.length === 0) return;
    const needsPreparation = previewTargets.some(target => target.needsPreparation);

    ctx.ctx.save();
    ctx.ctx.strokeStyle = needsPreparation ? 'rgba(255, 128, 64, 0.95)' : 'rgba(255, 214, 92, 0.95)';
    ctx.ctx.fillStyle = needsPreparation ? 'rgba(255, 128, 64, 0.08)' : 'rgba(255, 214, 92, 0.12)';
    ctx.ctx.lineWidth = 2;
    if (needsPreparation) ctx.ctx.setLineDash([6, 4]);

    for (const target of previewTargets) {
      const [x0, y0] = ctx.worldToScreen(target.mins[ctx.axisH], target.maxs[ctx.axisV]);
      const [x1, y1] = ctx.worldToScreen(target.maxs[ctx.axisH], target.mins[ctx.axisV]);
      ctx.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }

    ctx.ctx.restore();
    return;
  }

  const screenRadius = ctx.editor.currentTerrainRadius() * ctx.zoom;
  if (screenRadius < 4) return;

  ctx.ctx.save();
  ctx.ctx.strokeStyle = 'rgba(255, 170, 0, 0.8)';
  ctx.ctx.fillStyle = 'rgba(255, 170, 0, 0.08)';
  ctx.ctx.lineWidth = 1;
  ctx.ctx.setLineDash([6, 4]);

  const brushAxes = ctx.editor.terrainBrushAxes;
  const brushCenter = ctx.editor.terrainBrushCenter;
  if (brushAxes && brushCenter && brushAxes[0] === ctx.axisH && brushAxes[1] === ctx.axisV) {
    const [sx, sy] = ctx.worldToScreen(brushCenter[ctx.axisH], brushCenter[ctx.axisV]);
    ctx.ctx.beginPath();
    ctx.ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
    ctx.ctx.fill();
    ctx.ctx.stroke();
    ctx.ctx.restore();
    return;
  }

  for (const cp of ctx.editor.patchControlSelection) {
    const data = ctx.editor.patchEditData[cp.dataIndex];
    if (!data) continue;
    const point = data.patch.ctrl[cp.row]?.[cp.col]?.xyz;
    if (!point) continue;
    const [sx, sy] = ctx.worldToScreen(point[ctx.axisH], point[ctx.axisV]);
    ctx.ctx.beginPath();
    ctx.ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
    ctx.ctx.fill();
    ctx.ctx.stroke();
  }

  ctx.ctx.restore();
}

function drawPatchControlPoints(ctx: Viewport2DRenderContext): void {
  for (let di = 0; di < ctx.editor.patchEditData.length; di++) {
    const patch = ctx.editor.patchEditData[di].patch;
    for (let r = 0; r < patch.height; r++) {
      for (let c = 0; c < patch.width; c++) {
        const p = patch.ctrl[r][c].xyz;
        const [sx, sy] = ctx.worldToScreen(p[ctx.axisH], p[ctx.axisV]);
        const isSel = ctx.editor.isControlPointSelected(di, r, c);
        ctx.ctx.fillStyle = isSel ? '#ffffff' : '#00cc00';
        ctx.ctx.fillRect(sx - 3, sy - 3, 6, 6);
      }
    }
  }
}

function drawPathLines(ctx: Viewport2DRenderContext): void {
  const links = ctx.editor.collectEntityLinks();
  if (links.length === 0) return;

  for (const link of links) {
    const [sx0, sy0] = ctx.worldToScreen(link.from[ctx.axisH], link.from[ctx.axisV]);
    const [sx1, sy1] = ctx.worldToScreen(link.to[ctx.axisH], link.to[ctx.axisV]);
    const dx = sx1 - sx0;
    const dy = sy1 - sy0;
    const len = Math.hypot(dx, dy);
    if (len < 8) continue;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const startInset = 10;
    const tipInset = 10;
    const arrowLength = link.highlighted ? 9 : 8;
    const arrowWidth = link.highlighted ? 4 : 3;

    if (len <= startInset + tipInset + arrowLength) continue;

    const startX = sx0 + ux * startInset;
    const startY = sy0 + uy * startInset;
    const tipX = sx1 - ux * tipInset;
    const tipY = sy1 - uy * tipInset;
    const baseX = tipX - ux * arrowLength;
    const baseY = tipY - uy * arrowLength;
    const color = link.highlighted ? '#ffaa00' : '#7dc8ff';

    ctx.ctx.strokeStyle = color;
    ctx.ctx.fillStyle = color;
    ctx.ctx.lineWidth = link.highlighted ? 1.5 : 1;

    ctx.ctx.beginPath();
    ctx.ctx.moveTo(startX, startY);
    ctx.ctx.lineTo(baseX, baseY);
    ctx.ctx.stroke();

    ctx.ctx.beginPath();
    ctx.ctx.moveTo(tipX, tipY);
    ctx.ctx.lineTo(baseX + nx * arrowWidth, baseY + ny * arrowWidth);
    ctx.ctx.lineTo(baseX - nx * arrowWidth, baseY - ny * arrowWidth);
    ctx.ctx.closePath();
    ctx.ctx.fill();
  }
}

function drawPathCurves(ctx: Viewport2DRenderContext): void {
  const curves = ctx.editor.collectEntityPathCurves();
  if (curves.length === 0) return;

  ctx.ctx.save();
  for (const curve of curves) {
    if (curve.points.length < 2) continue;
    ctx.ctx.strokeStyle = curve.highlighted ? '#ffe066' : '#62d88b';
    ctx.ctx.lineWidth = curve.highlighted ? 2 : 1.5;
    ctx.ctx.beginPath();
    for (let i = 0; i < curve.points.length; i++) {
      const [sx, sy] = ctx.worldToScreen(curve.points[i][ctx.axisH], curve.points[i][ctx.axisV]);
      if (i === 0) ctx.ctx.moveTo(sx, sy);
      else ctx.ctx.lineTo(sx, sy);
    }
    ctx.ctx.stroke();
  }
  ctx.ctx.restore();
}

function drawSelectionBox(ctx: Viewport2DRenderContext): void {
  const bounds = ctx.editor.selectionBounds();
  if (!bounds) return;
  const [x0, y0] = ctx.worldToScreen(bounds.mins[ctx.axisH], bounds.maxs[ctx.axisV]);
  const [x1, y1] = ctx.worldToScreen(bounds.maxs[ctx.axisH], bounds.mins[ctx.axisV]);
  const bw = x1 - x0;
  const bh = y1 - y0;

  if (ctx.editor.selection.length > 1) {
    ctx.ctx.strokeStyle = 'rgba(255, 170, 0, 0.6)';
    ctx.ctx.lineWidth = 1;
    ctx.ctx.setLineDash([4, 4]);
    ctx.ctx.strokeRect(x0, y0, bw, bh);
    ctx.ctx.setLineDash([]);
  }

  if (ctx.editor.gizmoMode === 'scale') {
    const hs = 3;
    ctx.ctx.fillStyle = '#ffaa00';
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const handles = [
      [midX, y0], [midX, y1],
      [x0, midY], [x1, midY],
      [x0, y0], [x1, y0],
      [x0, y1], [x1, y1],
    ];
    for (const [hx, hy] of handles) {
      ctx.ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
    }
  }
}

function drawVertexHandles(ctx: Viewport2DRenderContext): void {
  const handles: { sx: number; sy: number; selected: boolean; depth: number }[] = [];
  ctx.ctx.save();
  ctx.ctx.strokeStyle = '#ffe066';
  ctx.ctx.lineWidth = 3;
  for (let di = 0; di < ctx.editor.vertexData.length; di++) {
    const data = ctx.editor.vertexData[di];
    for (const edge of collectBrushEdges(data.brush, data.vertices)) {
      const [aIndex, bIndex] = edge.vertexIndices;
      if (!ctx.editor.isVertexSelected(di, aIndex) || !ctx.editor.isVertexSelected(di, bIndex)) continue;
      const a = data.vertices[aIndex]?.position;
      const b = data.vertices[bIndex]?.position;
      if (!a || !b) continue;
      const [ax, ay] = ctx.worldToScreen(a[ctx.axisH], a[ctx.axisV]);
      const [bx, by] = ctx.worldToScreen(b[ctx.axisH], b[ctx.axisV]);
      ctx.ctx.beginPath();
      ctx.ctx.moveTo(ax, ay);
      ctx.ctx.lineTo(bx, by);
      ctx.ctx.stroke();
    }
  }
  ctx.ctx.restore();

  for (let di = 0; di < ctx.editor.vertexData.length; di++) {
    const data = ctx.editor.vertexData[di];
    for (let vi = 0; vi < data.vertices.length; vi++) {
      const pos = data.vertices[vi].position;
      const [sx, sy] = ctx.worldToScreen(pos[ctx.axisH], pos[ctx.axisV]);
      handles.push({
        sx,
        sy,
        selected: ctx.editor.isVertexSelected(di, vi),
        depth: pos[ctx.axisDepth],
      });
    }
  }

  handles.sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? 1 : -1;
    return a.depth - b.depth;
  });

  for (const handle of handles) {
    ctx.ctx.fillStyle = handle.selected ? '#ffffff' : '#44dd44';
    ctx.ctx.fillRect(handle.sx - 3, handle.sy - 3, 6, 6);
  }
}

function drawEntity(ctx: Viewport2DRenderContext, entity: Entity, selected: boolean): void {
  const origin = ctx.editor.entityDisplayOrigin(entity);
  if (!origin) return;
  const bounds = ctx.editor.entityBounds(entity);
  const hasGeometry = ctx.editor.hasEntityGeometry(entity);
  const [sx, sy] = ctx.worldToScreen(origin[ctx.axisH], origin[ctx.axisV]);
  const size = hasGeometry ? 6 : 8;
  const catColor = entityColor(entity.classname);

  if ((hasGeometry || ctx.editor.modelManager?.resolveEntity(entity)) && bounds) {
    const [x0, y0] = ctx.worldToScreen(bounds.mins[ctx.axisH], bounds.maxs[ctx.axisV]);
    const [x1, y1] = ctx.worldToScreen(bounds.maxs[ctx.axisH], bounds.mins[ctx.axisV]);
    ctx.ctx.strokeStyle = selected ? '#ffaa00' : catColor;
    ctx.ctx.lineWidth = selected ? 1.5 : 1;
    ctx.ctx.globalAlpha = selected ? 0.9 : 0.5;
    ctx.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.ctx.globalAlpha = 1.0;
  }

  ctx.ctx.fillStyle = selected ? '#ff6600' : catColor;
  ctx.ctx.strokeStyle = selected ? '#ffaa00' : catColor;
  ctx.ctx.globalAlpha = selected ? 1.0 : 0.85;
  ctx.ctx.lineWidth = 1;
  ctx.ctx.beginPath();
  ctx.ctx.moveTo(sx, sy - size);
  ctx.ctx.lineTo(sx + size, sy);
  ctx.ctx.lineTo(sx, sy + size);
  ctx.ctx.lineTo(sx - size, sy);
  ctx.ctx.closePath();
  ctx.ctx.fill();
  ctx.ctx.globalAlpha = 1.0;
  ctx.ctx.stroke();

  if (ctx.editor.display.categories.angles) {
    const angle = Number(entity.properties.angle);
    if (Number.isFinite(angle)) {
      const radians = angle * Math.PI / 180;
      const direction: [number, number, number] = [Math.cos(radians), Math.sin(radians), 0];
      const end = [...origin] as [number, number, number];
      end[ctx.axisH] += direction[ctx.axisH] * 24;
      end[ctx.axisV] += direction[ctx.axisV] * 24;
      const [ex, ey] = ctx.worldToScreen(end[ctx.axisH], end[ctx.axisV]);
      ctx.ctx.beginPath(); ctx.ctx.moveTo(sx, sy); ctx.ctx.lineTo(ex, ey); ctx.ctx.stroke();
    }
  }

  const entityLightOrigin = entityOrigin(entity);
  if (selected && entity.classname === 'light' && entity.properties['light'] && entityLightOrigin) {
    const radius = parseFloat(entity.properties['light']);
    if (radius > 0) {
      const screenRadius = radius * ctx.zoom;
      const lc = lightColorCSS(entity) ?? '#ffcc00';
      ctx.ctx.strokeStyle = lc;
      ctx.ctx.globalAlpha = 0.5;
      ctx.ctx.lineWidth = 1;
      ctx.ctx.setLineDash([4, 4]);
      ctx.ctx.beginPath();
      ctx.ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
      ctx.ctx.stroke();
      ctx.ctx.setLineDash([]);
      ctx.ctx.globalAlpha = 1.0;
    }
  }

  if (ctx.editor.display.categories.names || ctx.editor.display.categories.coordinates) {
    ctx.ctx.fillStyle = selected ? '#ffaa00' : catColor;
    ctx.ctx.font = '9px monospace';
    ctx.ctx.textAlign = 'left';
    const name = ctx.editor.display.categories.names ? entity.classname : '';
    const coordinates = ctx.editor.display.categories.coordinates && entityLightOrigin
      ? `${name ? ' ' : ''}(${entityLightOrigin.map(value => Math.round(value)).join(' ')})` : '';
    ctx.ctx.fillText(name + coordinates, sx + size + 3, sy + 3);
  }
}

function drawCreationPreview(ctx: Viewport2DRenderContext): void {
  const [sx0, sy0] = ctx.worldToScreen(
    Math.min(ctx.editor.createStart[ctx.axisH], ctx.editor.createEnd[ctx.axisH]),
    Math.max(ctx.editor.createStart[ctx.axisV], ctx.editor.createEnd[ctx.axisV]),
  );
  const [sx1, sy1] = ctx.worldToScreen(
    Math.max(ctx.editor.createStart[ctx.axisH], ctx.editor.createEnd[ctx.axisH]),
    Math.min(ctx.editor.createStart[ctx.axisV], ctx.editor.createEnd[ctx.axisV]),
  );

  ctx.ctx.fillStyle = 'rgba(255, 200, 0, 0.15)';
  ctx.ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
  ctx.ctx.strokeStyle = '#ffcc00';
  ctx.ctx.lineWidth = 1;
  ctx.ctx.setLineDash([4, 4]);
  ctx.ctx.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
  ctx.ctx.setLineDash([]);
}

function drawClipPreview(ctx: Viewport2DRenderContext, viewW: number, viewH: number): void {
  const pts = ctx.editor.clipPoints;

  ctx.ctx.fillStyle = '#ff3333';
  for (const p of pts) {
    const [sx, sy] = ctx.worldToScreen(p[ctx.axisH], p[ctx.axisV]);
    ctx.ctx.beginPath();
    ctx.ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.ctx.fill();
  }

  if (pts.length === 2) {
    const [sx1, sy1] = ctx.worldToScreen(pts[0][ctx.axisH], pts[0][ctx.axisV]);
    const [sx2, sy2] = ctx.worldToScreen(pts[1][ctx.axisH], pts[1][ctx.axisV]);
    const dx = sx2 - sx1;
    const dy = sy2 - sy1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.1) {
      const ext = Math.max(viewW, viewH) * 2;
      const nx = dx / len;
      const ny = dy / len;

      ctx.ctx.strokeStyle = '#ff3333';
      ctx.ctx.lineWidth = 1.5;
      ctx.ctx.setLineDash([6, 4]);
      ctx.ctx.beginPath();
      ctx.ctx.moveTo(sx1 - nx * ext, sy1 - ny * ext);
      ctx.ctx.lineTo(sx2 + nx * ext, sy2 + ny * ext);
      ctx.ctx.stroke();
      ctx.ctx.setLineDash([]);

      const midX = (sx1 + sx2) / 2;
      const midY = (sy1 + sy2) / 2;
      const perpX = -ny;
      const perpY = nx;
      const arrowDist = 12;
      const isFront = ctx.editor.clipMode === 'front' || ctx.editor.clipMode === 'both';
      const isBack = ctx.editor.clipMode === 'back' || ctx.editor.clipMode === 'both';

      if (isFront) {
        ctx.ctx.fillStyle = 'rgba(100, 255, 100, 0.8)';
        ctx.ctx.beginPath();
        ctx.ctx.arc(midX + perpX * arrowDist, midY + perpY * arrowDist, 4, 0, Math.PI * 2);
        ctx.ctx.fill();
      }
      if (isBack) {
        ctx.ctx.fillStyle = 'rgba(100, 255, 100, 0.8)';
        ctx.ctx.beginPath();
        ctx.ctx.arc(midX - perpX * arrowDist, midY - perpY * arrowDist, 4, 0, Math.PI * 2);
        ctx.ctx.fill();
      }
    }
  }
}

function drawCamera(ctx: Viewport2DRenderContext): void {
  const cam = ctx.editor.camera3d;
  const [cx, cy] = ctx.worldToScreen(cam.position[ctx.axisH], cam.position[ctx.axisV]);
  const cosPitch = Math.cos(cam.pitch);
  const forward3d: [number, number, number] = [
    Math.cos(cam.yaw) * cosPitch,
    Math.sin(cam.yaw) * cosPitch,
    Math.sin(cam.pitch),
  ];
  const fh = forward3d[ctx.axisH];
  const fv = forward3d[ctx.axisV];
  const len = Math.sqrt(fh * fh + fv * fv);
  const size = 12;
  const fov = Math.PI / 3;

  ctx.ctx.save();
  ctx.ctx.translate(cx, cy);

  if (len > 0.001) {
    ctx.ctx.rotate(Math.atan2(-fv, fh));
  } else {
    ctx.ctx.fillStyle = 'rgba(0, 200, 0, 0.9)';
    ctx.ctx.beginPath();
    ctx.ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.ctx.fill();
    ctx.ctx.restore();
    return;
  }

  const coneLen = size * 3;
  const halfFov = fov / 2;
  ctx.ctx.strokeStyle = 'rgba(0, 200, 0, 0.3)';
  ctx.ctx.lineWidth = 1;
  ctx.ctx.beginPath();
  ctx.ctx.moveTo(0, 0);
  ctx.ctx.lineTo(coneLen * Math.cos(-halfFov), coneLen * Math.sin(-halfFov));
  ctx.ctx.moveTo(0, 0);
  ctx.ctx.lineTo(coneLen * Math.cos(halfFov), coneLen * Math.sin(halfFov));
  ctx.ctx.stroke();

  ctx.ctx.strokeStyle = 'rgba(0, 255, 0, 0.9)';
  ctx.ctx.lineWidth = 1;
  const hw = size * 0.5;
  const hh = size * 0.4;
  ctx.ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
  ctx.ctx.restore();
}

function drawRotateAnchor(ctx: Viewport2DRenderContext): void {
  const anchor = ctx.editor.rotateAnchor!;
  const [sx, sy] = ctx.worldToScreen(anchor[ctx.axisH], anchor[ctx.axisV]);
  const size = 10;

  ctx.ctx.strokeStyle = '#ff4444';
  ctx.ctx.lineWidth = 1;
  ctx.ctx.beginPath();
  ctx.ctx.moveTo(sx - size, sy);
  ctx.ctx.lineTo(sx + size, sy);
  ctx.ctx.moveTo(sx, sy - size);
  ctx.ctx.lineTo(sx, sy + size);
  ctx.ctx.stroke();

  ctx.ctx.beginPath();
  ctx.ctx.arc(sx, sy, size, 0, Math.PI * 2);
  ctx.ctx.stroke();

  if (ctx.rotating) {
    const arcRadius = 40;
    ctx.ctx.strokeStyle = 'rgba(255, 68, 68, 0.6)';
    ctx.ctx.lineWidth = 1;
    const drawStart = -ctx.rotateStartAngle;
    const drawEnd = -(ctx.rotateStartAngle + ctx.rotateAppliedAngle);
    ctx.ctx.beginPath();
    ctx.ctx.arc(sx, sy, arcRadius, drawStart, drawEnd, false);
    ctx.ctx.stroke();

    ctx.ctx.fillStyle = 'rgba(255, 68, 68, 0.1)';
    ctx.ctx.beginPath();
    ctx.ctx.moveTo(sx, sy);
    ctx.ctx.arc(sx, sy, arcRadius, drawStart, drawEnd, false);
    ctx.ctx.closePath();
    ctx.ctx.fill();
  }
}

function drawGeoSnapLines(ctx: Viewport2DRenderContext, w: number, h: number): void {
  ctx.ctx.save();
  ctx.ctx.strokeStyle = 'rgba(0, 220, 120, 0.7)';
  ctx.ctx.lineWidth = 1;
  ctx.ctx.setLineDash([4, 4]);
  for (const line of ctx.geoSnapLines) {
    if (line.axis === 'h') {
      const [sx] = ctx.worldToScreen(line.value, 0);
      ctx.ctx.beginPath();
      ctx.ctx.moveTo(sx, 0);
      ctx.ctx.lineTo(sx, h);
      ctx.ctx.stroke();
    } else {
      const [, sy] = ctx.worldToScreen(0, line.value);
      ctx.ctx.beginPath();
      ctx.ctx.moveTo(0, sy);
      ctx.ctx.lineTo(w, sy);
      ctx.ctx.stroke();
    }
  }
  ctx.ctx.setLineDash([]);
  ctx.ctx.restore();
}

function drawRubberBand(ctx: Viewport2DRenderContext): void {
  const x = Math.min(ctx.rubberBandStart[0], ctx.rubberBandEnd[0]);
  const y = Math.min(ctx.rubberBandStart[1], ctx.rubberBandEnd[1]);
  const w = Math.abs(ctx.rubberBandEnd[0] - ctx.rubberBandStart[0]);
  const h = Math.abs(ctx.rubberBandEnd[1] - ctx.rubberBandStart[1]);
  ctx.ctx.save();
  ctx.ctx.setTransform(1, 0, 0, 1, 0, 0);
  const dpr = window.devicePixelRatio || 1;
  ctx.ctx.scale(dpr, dpr);
  ctx.ctx.fillStyle = 'rgba(0, 120, 255, 0.1)';
  ctx.ctx.fillRect(x, y, w, h);
  ctx.ctx.strokeStyle = 'rgba(0, 120, 255, 0.8)';
  ctx.ctx.lineWidth = 1;
  ctx.ctx.setLineDash([4, 4]);
  ctx.ctx.strokeRect(x, y, w, h);
  ctx.ctx.setLineDash([]);
  ctx.ctx.restore();
}
