import type { Brush } from './brush';
import type { Editor } from './editor';
import { entityBounds as getEntityBounds } from './editor-queries';
import type { Entity } from './entity';
import type { Vec3 } from './math';
import type { Patch } from './patch';

export interface CubicClipBounds {
  mins: Vec3;
  maxs: Vec3;
}

const MIN_CUBIC_CLIP_SIZE = 128;
const MAX_CUBIC_CLIP_SIZE = 16384;

function boundsIntersect(bounds: CubicClipBounds, clip: CubicClipBounds): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (bounds.mins[axis] > clip.maxs[axis]) return false;
    if (bounds.maxs[axis] < clip.mins[axis]) return false;
  }
  return true;
}

function pointInsideBounds(point: Vec3, bounds: CubicClipBounds): boolean {
  return point[0] >= bounds.mins[0] && point[0] <= bounds.maxs[0]
    && point[1] >= bounds.mins[1] && point[1] <= bounds.maxs[1]
    && point[2] >= bounds.mins[2] && point[2] <= bounds.maxs[2];
}

function segmentIntersectsBounds(start: Vec3, end: Vec3, bounds: CubicClipBounds): boolean {
  if (pointInsideBounds(start, bounds) || pointInsideBounds(end, bounds)) return true;

  let tMin = 0;
  let tMax = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-8) {
      if (start[axis] < bounds.mins[axis] || start[axis] > bounds.maxs[axis]) return false;
      continue;
    }

    let t0 = (bounds.mins[axis] - start[axis]) / delta;
    let t1 = (bounds.maxs[axis] - start[axis]) / delta;
    if (t0 > t1) {
      const temp = t0;
      t0 = t1;
      t1 = temp;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMax < tMin) return false;
  }
  return true;
}

function cubicClipStatus(editor: Editor): string {
  return `Cubic clipping: ${editor.cubicClipSize} cube`;
}

export function cubicClipBounds(editor: Editor): CubicClipBounds | null {
  if (!editor.cubicClipEnabled) return null;
  const half = editor.cubicClipSize / 2;
  const position = editor.camera3d.position;
  return {
    mins: [position[0] - half, position[1] - half, position[2] - half],
    maxs: [position[0] + half, position[1] + half, position[2] + half],
  };
}

export function toggleCubicClip(editor: Editor): void {
  editor.cubicClipEnabled = !editor.cubicClipEnabled;
  editor.dirty = true;
  editor.statusMessage = editor.cubicClipEnabled ? cubicClipStatus(editor) : 'Cubic clipping: off';
}

export function adjustCubicClipSize(editor: Editor, direction: -1 | 1): void {
  const next = direction < 0
    ? Math.max(MIN_CUBIC_CLIP_SIZE, Math.floor(editor.cubicClipSize / 2))
    : Math.min(MAX_CUBIC_CLIP_SIZE, editor.cubicClipSize * 2);
  editor.cubicClipSize = next;
  editor.cubicClipEnabled = true;
  editor.dirty = true;
  editor.statusMessage = cubicClipStatus(editor);
}

export function isBrushVisibleIn3D(editor: Editor, brush: Brush, entity?: Entity): boolean {
  if (!editor.isBrushVisible(brush, entity)) return false;
  const clip = cubicClipBounds(editor);
  if (!clip) return true;
  return boundsIntersect({ mins: brush.mins, maxs: brush.maxs }, clip);
}

export function isPatchVisibleIn3D(editor: Editor, patch: Patch, entity?: Entity): boolean {
  if (!editor.isPatchVisible(patch, entity)) return false;
  const clip = cubicClipBounds(editor);
  if (!clip) return true;
  return boundsIntersect({ mins: patch.mins, maxs: patch.maxs }, clip);
}

export function isEntityVisibleIn3D(editor: Editor, entity: Entity): boolean {
  if (!editor.isEntityVisible(entity)) return false;
  const clip = cubicClipBounds(editor);
  if (!clip) return true;
  const bounds = getEntityBounds(entity);
  return bounds ? boundsIntersect(bounds, clip) : false;
}

export function isPointVisibleIn3D(editor: Editor, point: Vec3): boolean {
  const clip = cubicClipBounds(editor);
  return clip ? pointInsideBounds(point, clip) : true;
}

export function isSegmentVisibleIn3D(editor: Editor, start: Vec3, end: Vec3): boolean {
  const clip = cubicClipBounds(editor);
  return clip ? segmentIntersectsBounds(start, end, clip) : true;
}
