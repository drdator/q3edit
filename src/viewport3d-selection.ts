import { vec3Add, vec3Dot, vec3Scale, vec3Sub, rayTriangleIntersect, Vec3 } from './math';
import { Editor } from './editor';
import { Brush, BrushFace } from './brush';
import { Entity } from './entity';
import { Patch } from './patch';
import { pickVertex3D } from './vertex';

export interface Viewport3DSelectionContext {
  editor: Editor;
  dragStart: [number, number];
  getRay: (screenX: number, screenY: number) => { rayOrigin: Vec3; rayDir: Vec3 };
  pickBrushAt: (screenX: number, screenY: number) => { entity: Entity; brush: Brush; face: BrushFace } | null;
  pickPatchAt: (screenX: number, screenY: number) => { entity: Entity; patch: Patch; dist: number } | null;
  pickEntityAt: (screenX: number, screenY: number) => { entity: Entity; dist: number } | null;
}

export function handleViewport3DPick(ctx: Viewport3DSelectionContext, e: MouseEvent): void {
  const [sx, sy] = ctx.dragStart;
  if (ctx.editor.vertexMode) {
    const { rayOrigin, rayDir } = ctx.getRay(sx, sy);
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    let hitDi = -1;
    let hitVi = -1;
    for (let di = 0; di < ctx.editor.vertexData.length; di++) {
      const vi = pickVertex3D(ctx.editor.vertexData[di].vertices, rayOrigin, rayDir, 8);
      if (vi >= 0) {
        hitDi = di;
        hitVi = vi;
        break;
      }
    }
    if (hitDi >= 0) {
      ctx.editor.selectVertex(hitDi, hitVi, additive);
    } else if (!additive) {
      ctx.editor.clearVertexSelection();
    }
    return;
  }

  if (ctx.editor.patchEditMode) {
    const { rayOrigin, rayDir } = ctx.getRay(sx, sy);
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    let hitDi = -1;
    let hitR = -1;
    let hitC = -1;
    let bestDistSq = 64;
    for (let di = 0; di < ctx.editor.patchEditData.length; di++) {
      const patch = ctx.editor.patchEditData[di].patch;
      for (let r = 0; r < patch.height; r++) {
        for (let c = 0; c < patch.width; c++) {
          const p = patch.ctrl[r][c].xyz;
          const toP = vec3Sub(p, rayOrigin);
          const t = vec3Dot(toP, rayDir);
          if (t < 0) continue;
          const proj = vec3Add(rayOrigin, vec3Scale(rayDir, t));
          const d = vec3Sub(p, proj);
          const distSq = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            hitDi = di;
            hitR = r;
            hitC = c;
          }
        }
      }
    }
    if (hitDi >= 0) {
      ctx.editor.selectControlPoint(hitDi, hitR, hitC, additive);
    } else if (!additive) {
      ctx.editor.clearControlPointSelection();
    }
    return;
  }

  const filter = ctx.editor.selectionFilter;
  const brushHit = (filter === 'all' || filter === 'brushes') ? ctx.pickBrushAt(sx, sy) : null;
  const patchHit = (filter === 'all' || filter === 'patches') ? ctx.pickPatchAt(sx, sy) : null;
  const entityHit = (filter === 'all' || filter === 'entities') ? ctx.pickEntityAt(sx, sy) : null;

  if (filter === 'entities') {
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (entityHit) {
      ctx.editor.selectEntity(entityHit.entity, additive);
    } else if (!additive) {
      ctx.editor.clearSelection();
    }
    return;
  }

  let usePatch = false;
  if (patchHit && brushHit) {
    const { rayOrigin, rayDir: dir } = ctx.getRay(sx, sy);
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
    ctx.editor.selectPatch(patchHit.entity, patchHit.patch, additive);
  } else if (brushHit) {
    if (e.altKey) {
      const additive = e.shiftKey;
      ctx.editor.selectFace(brushHit.entity, brushHit.brush, brushHit.face, additive);
    } else {
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (!additive) ctx.editor.clearSelection();
      ctx.editor.selectBrush(brushHit.entity, brushHit.brush, additive);
    }
  } else if (entityHit) {
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    ctx.editor.selectEntity(entityHit.entity, additive);
  } else if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
    ctx.editor.clearSelection();
  }
}
