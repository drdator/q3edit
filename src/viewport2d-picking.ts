import { Editor } from './editor';
import { Brush } from './brush';
import { Entity } from './entity';
import { Patch } from './patch';

export interface Viewport2DPickingContext {
  editor: Editor;
  axisH: number;
  axisV: number;
  axisDepth: number;
  zoom: number;
}

export interface ResizeEdges {
  minH: boolean;
  maxH: boolean;
  minV: boolean;
  maxV: boolean;
}

export interface ResizeEdgeHit {
  edges: ResizeEdges;
}

export type Viewport2DPick =
  | { type: 'brush'; entity: Entity; brush: Brush }
  | { type: 'entity'; entity: Entity }
  | { type: 'patch'; entity: Entity; patch: Patch };

export function detectResizeEdge(ctx: Viewport2DPickingContext, wx: number, wy: number): ResizeEdgeHit | null {
  const bounds = ctx.editor.selectionBounds();
  if (!bounds) return null;
  const threshold = 6 / ctx.zoom;

  const inH = wx >= bounds.mins[ctx.axisH] - threshold && wx <= bounds.maxs[ctx.axisH] + threshold;
  const inV = wy >= bounds.mins[ctx.axisV] - threshold && wy <= bounds.maxs[ctx.axisV] + threshold;
  if (!inH || !inV) return null;

  const nearMinH = Math.abs(wx - bounds.mins[ctx.axisH]) < threshold;
  const nearMaxH = Math.abs(wx - bounds.maxs[ctx.axisH]) < threshold;
  const nearMinV = Math.abs(wy - bounds.mins[ctx.axisV]) < threshold;
  const nearMaxV = Math.abs(wy - bounds.maxs[ctx.axisV]) < threshold;

  if (nearMinH || nearMaxH || nearMinV || nearMaxV) {
    return { edges: { minH: nearMinH, maxH: nearMaxH, minV: nearMinV, maxV: nearMaxV } };
  }
  return null;
}

export function getResizeCursor(edges: ResizeEdges): string {
  const h = edges.minH || edges.maxH;
  const v = edges.minV || edges.maxV;
  if (h && v) {
    if ((edges.minH && edges.maxV) || (edges.maxH && edges.minV)) return 'nwse-resize';
    return 'nesw-resize';
  }
  if (h) return 'ew-resize';
  if (v) return 'ns-resize';
  return '';
}

function pointInBrush2D(brush: Brush, wx: number, wy: number, axisH: number, axisV: number): boolean {
  if (wx < brush.mins[axisH] || wx > brush.maxs[axisH] ||
      wy < brush.mins[axisV] || wy > brush.maxs[axisV]) return false;
  for (const face of brush.faces) {
    const poly = face.polygon;
    if (poly.length < 3) continue;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i][axisV], yj = poly[j][axisV];
      const xi = poly[i][axisH], xj = poly[j][axisH];
      if ((yi > wy) !== (yj > wy) &&
          wx < (xj - xi) * (wy - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

export function pickEntityAt(
  ctx: Viewport2DPickingContext,
  wx: number,
  wy: number,
  includeBrushEntities: boolean,
): { type: 'entity'; entity: Entity } | null {
  let bestEntity: Entity | null = null;
  let bestArea = Infinity;
  let bestDepth = -Infinity;

  for (const entity of ctx.editor.nonWorldspawnEntities()) {
    if (!ctx.editor.isEntityVisible(entity)) continue;
    if (!includeBrushEntities && !ctx.editor.isPointEntity(entity)) continue;

    const origin = ctx.editor.entityDisplayOrigin(entity);
    if (origin) {
      const dx = Math.abs(wx - origin[ctx.axisH]);
      const dy = Math.abs(wy - origin[ctx.axisV]);
      if (dx < 12 / ctx.zoom && dy < 12 / ctx.zoom) {
        return { type: 'entity', entity };
      }
    }

    if (!includeBrushEntities && !ctx.editor.isPointEntity(entity)) continue;

    const bounds = ctx.editor.entityBounds(entity);
    if (!bounds) continue;
    if (wx < bounds.mins[ctx.axisH] || wx > bounds.maxs[ctx.axisH] ||
        wy < bounds.mins[ctx.axisV] || wy > bounds.maxs[ctx.axisV]) {
      continue;
    }

    const area = (bounds.maxs[ctx.axisH] - bounds.mins[ctx.axisH]) *
      (bounds.maxs[ctx.axisV] - bounds.mins[ctx.axisV]);
    const depth = bounds.maxs[ctx.axisDepth];
    if (area < bestArea || (area === bestArea && depth > bestDepth)) {
      bestArea = area;
      bestDepth = depth;
      bestEntity = entity;
    }
  }

  return bestEntity ? { type: 'entity', entity: bestEntity } : null;
}

export function pickAt(ctx: Viewport2DPickingContext, wx: number, wy: number): Viewport2DPick | null {
  const filter = ctx.editor.selectionFilter;

  if (filter === 'entities') {
    return pickEntityAt(ctx, wx, wy, true);
  }

  if (filter === 'all') {
    const pointEntityHit = pickEntityAt(ctx, wx, wy, false);
    if (pointEntityHit) return pointEntityHit;
  }

  let bestBrush: { entity: Entity; brush: Brush } | null = null;
  let bestPatch: { entity: Entity; patch: Patch } | null = null;
  let bestArea = Infinity;
  let bestDepth = -Infinity;

  if (filter === 'all' || filter === 'brushes') {
    for (const { entity, brush } of ctx.editor.allBrushes()) {
      if (!ctx.editor.isBrushVisible(brush, entity)) continue;
      if (pointInBrush2D(brush, wx, wy, ctx.axisH, ctx.axisV)) {
        const area = (brush.maxs[ctx.axisH] - brush.mins[ctx.axisH]) *
          (brush.maxs[ctx.axisV] - brush.mins[ctx.axisV]);
        const depth = brush.maxs[ctx.axisDepth];
        if (area < bestArea || (area === bestArea && depth > bestDepth)) {
          bestArea = area;
          bestDepth = depth;
          bestBrush = { entity, brush };
          bestPatch = null;
        }
      }
    }
  }

  if (filter === 'all' || filter === 'patches') {
    for (const { entity, patch } of ctx.editor.allPatches()) {
      if (!ctx.editor.isPatchVisible(patch, entity)) continue;
      if (wx >= patch.mins[ctx.axisH] && wx <= patch.maxs[ctx.axisH] &&
          wy >= patch.mins[ctx.axisV] && wy <= patch.maxs[ctx.axisV]) {
        const area = (patch.maxs[ctx.axisH] - patch.mins[ctx.axisH]) *
          (patch.maxs[ctx.axisV] - patch.mins[ctx.axisV]);
        const depth = patch.maxs[ctx.axisDepth];
        if (area < bestArea || (area === bestArea && depth > bestDepth)) {
          bestArea = area;
          bestDepth = depth;
          bestPatch = { entity, patch };
          bestBrush = null;
        }
      }
    }
  }

  if (bestBrush) {
    return { type: 'brush', entity: bestBrush.entity, brush: bestBrush.brush };
  }
  if (bestPatch) {
    return { type: 'patch', entity: bestPatch.entity, patch: bestPatch.patch };
  }

  return null;
}
