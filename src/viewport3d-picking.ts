import {
  Vec3,
  rayTriangleIntersect,
  vec3Add,
  vec3Cross,
  vec3Normalize,
  vec3Scale,
} from './math';
import { Editor } from './editor';
import { Brush, BrushFace } from './brush';
import { Entity } from './entity';
import { Patch } from './patch';

export interface Viewport3DPickingContext {
  canvas: HTMLCanvasElement;
  editor: Editor;
  position: Vec3;
  getForward: () => Vec3;
}

export function getRay3D(ctx: Viewport3DPickingContext, screenX: number, screenY: number): { rayOrigin: Vec3; rayDir: Vec3 } {
  const rect = ctx.canvas.getBoundingClientRect();
  const x = (screenX - rect.left) / rect.width * 2 - 1;
  const y = 1 - (screenY - rect.top) / rect.height * 2;

  const aspect = rect.width / rect.height || 1;
  const fovY = Math.PI / 3;
  const tanHalf = Math.tan(fovY / 2);

  const forward = ctx.getForward();
  const right = vec3Normalize(vec3Cross(forward, [0, 0, 1]));
  const up = vec3Cross(right, forward);

  const dir = vec3Normalize(vec3Add(
    vec3Add(forward, vec3Scale(right, x * tanHalf * aspect)),
    vec3Scale(up, y * tanHalf),
  ));
  return { rayOrigin: ctx.position, rayDir: dir };
}

export function pickBrushAt3D(
  ctx: Viewport3DPickingContext,
  screenX: number,
  screenY: number,
): { entity: Entity; brush: Brush; face: BrushFace } | null {
  const { rayOrigin, rayDir: dir } = getRay3D(ctx, screenX, screenY);

  let bestDist = Infinity;
  let bestHit: { entity: Entity; brush: Brush; face: BrushFace } | null = null;

  for (const { entity, brush } of ctx.editor.allBrushes()) {
    if (!ctx.editor.isBrushVisible(brush, entity)) continue;
    for (const face of brush.faces) {
      if (face.polygon.length < 3) continue;
      for (let i = 1; i < face.polygon.length - 1; i++) {
        const t = rayTriangleIntersect(
          rayOrigin,
          dir,
          face.polygon[0],
          face.polygon[i],
          face.polygon[i + 1],
        );
        if (t !== null && t < bestDist) {
          bestDist = t;
          bestHit = { entity, brush, face };
        }
      }
    }
  }

  return bestHit;
}

export function pickPatchAt3D(
  ctx: Viewport3DPickingContext,
  screenX: number,
  screenY: number,
): { entity: Entity; patch: Patch; dist: number } | null {
  const { rayOrigin, rayDir: dir } = getRay3D(ctx, screenX, screenY);

  let bestDist = Infinity;
  let bestHit: { entity: Entity; patch: Patch; dist: number } | null = null;

  for (const { entity, patch } of ctx.editor.allPatches()) {
    if (!ctx.editor.isPatchVisible(patch, entity)) continue;
    for (let ti = 0; ti < patch.tessIndices.length; ti += 3) {
      const v0 = patch.tessVerts[patch.tessIndices[ti]].position;
      const v1 = patch.tessVerts[patch.tessIndices[ti + 1]].position;
      const v2 = patch.tessVerts[patch.tessIndices[ti + 2]].position;
      const t = rayTriangleIntersect(rayOrigin, dir, v0, v1, v2);
      if (t !== null && t < bestDist) {
        bestDist = t;
        bestHit = { entity, patch, dist: t };
      }
    }
  }

  return bestHit;
}

export function pickEntityAt3D(
  ctx: Viewport3DPickingContext,
  screenX: number,
  screenY: number,
): { entity: Entity; dist: number } | null {
  const { rayOrigin, rayDir } = getRay3D(ctx, screenX, screenY);

  let bestDist = Infinity;
  let bestHit: { entity: Entity; dist: number } | null = null;

  for (const entity of ctx.editor.nonWorldspawnEntities()) {
    if (!ctx.editor.isEntityVisible(entity)) continue;

    let bounds = ctx.editor.entityBounds(entity);
    if (ctx.editor.isPointEntity(entity)) {
      const origin = ctx.editor.entityDisplayOrigin(entity);
      if (!origin) continue;
      const size = 8;
      bounds = {
        mins: [origin[0] - size, origin[1] - size, origin[2] - size] as Vec3,
        maxs: [origin[0] + size, origin[1] + size, origin[2] + size] as Vec3,
      };
    }
    if (!bounds) continue;

    const dist = rayAabbIntersect(rayOrigin, rayDir, bounds.mins, bounds.maxs);
    if (dist !== null && dist < bestDist) {
      bestDist = dist;
      bestHit = { entity, dist };
    }
  }

  return bestHit;
}

function rayAabbIntersect(origin: Vec3, dir: Vec3, mins: Vec3, maxs: Vec3): number | null {
  let tMin = -Infinity;
  let tMax = Infinity;

  for (let axis = 0; axis < 3; axis++) {
    const invDir = Math.abs(dir[axis]) < 1e-8 ? Infinity : 1 / dir[axis];
    let t0 = (mins[axis] - origin[axis]) * invDir;
    let t1 = (maxs[axis] - origin[axis]) * invDir;

    if (t0 > t1) {
      const temp = t0;
      t0 = t1;
      t1 = temp;
    }

    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMax < tMin) return null;
  }

  if (tMax < 0) return null;
  return tMin >= 0 ? tMin : tMax;
}
