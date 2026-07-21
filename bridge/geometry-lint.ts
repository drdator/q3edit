import type { Brush, BrushFace } from '../src/brush';
import { parseMapWithDiagnostics } from '../src/mapfile';
import { CONTENTS_DETAIL } from '../src/map-flags';
import { vec3Cross, vec3Length, vec3Sub } from '../src/math';
import { isGroupInfoEntity } from '../src/named-groups';
import { readConstructionPaths } from '../src/construction-paths';

export interface GeometryLintIssue {
  severity: 'warning' | 'info';
  code: 'duplicate-brush' | 'coplanar-overlap' | 'thin-brush' | 'sliver-face' | 'off-grid-geometry' | 'likely-structural-detail';
  message: string;
  refs: string[];
}

interface BrushEntry {
  ref: string;
  brush: Brush;
  structural: boolean;
  worldspawn: boolean;
  groupId?: string;
}

interface PlanarFace {
  ref: string;
  brushRef: string;
  axis: number;
  sign: number;
  distance: number;
  mins: [number, number];
  maxs: [number, number];
}

function rounded(value: number, precision = 4): number {
  return Number(value.toFixed(precision));
}

function polygonArea(face: BrushFace): number {
  if (face.polygon.length < 3) return 0;
  let area = 0;
  const origin = face.polygon[0];
  for (let index = 1; index < face.polygon.length - 1; index++) {
    area += vec3Length(vec3Cross(vec3Sub(face.polygon[index], origin), vec3Sub(face.polygon[index + 1], origin))) / 2;
  }
  return area;
}

function brushSignature(brush: Brush): string {
  return brush.faces.map(face => [
    ...face.plane.normal.map(value => rounded(value)), rounded(face.plane.dist),
  ].join(',')).sort().join('|');
}

function axisAlignedFace(ref: string, brushRef: string, face: BrushFace): PlanarFace | null {
  const absolute = face.plane.normal.map(Math.abs);
  const axis = absolute.findIndex(value => value > 0.9999);
  if (axis < 0 || absolute.some((value, index) => index !== axis && value > 0.0001) || face.polygon.length < 3) return null;
  const projectedAxes = [0, 1, 2].filter(index => index !== axis);
  return {
    ref, brushRef, axis, sign: Math.sign(face.plane.normal[axis]), distance: rounded(face.plane.dist, 3),
    mins: projectedAxes.map(projectedAxis => Math.min(...face.polygon.map(point => point[projectedAxis]))) as [number, number],
    maxs: projectedAxes.map(projectedAxis => Math.max(...face.polygon.map(point => point[projectedAxis]))) as [number, number],
  };
}

function overlapArea(first: PlanarFace, second: PlanarFace): number {
  const width = Math.min(first.maxs[0], second.maxs[0]) - Math.max(first.mins[0], second.mins[0]);
  const height = Math.min(first.maxs[1], second.maxs[1]) - Math.max(first.mins[1], second.mins[1]);
  return Math.max(0, width) * Math.max(0, height);
}

export function lintGeometry(mapText: string): { issueCount: number; issues: GeometryLintIssue[] } {
  const entities = parseMapWithDiagnostics(mapText).document.entities;
  const worldspawn = entities.find(entity => entity.classname === 'worldspawn');
  const constructionPathGroups = new Set(readConstructionPaths(worldspawn?.properties ?? {}).paths.map(path => path.groupId));
  const brushes: BrushEntry[] = [];
  entities.forEach((entity, entityIndex) => {
    if (isGroupInfoEntity(entity)) return;
    entity.brushes.forEach((brush, brushIndex) => brushes.push({
      ref: `E${entityIndex}:B${brushIndex}`,
      brush,
      structural: !brush.faces.some(face => (face.contentFlags & CONTENTS_DETAIL) !== 0),
      worldspawn: entity.classname === 'worldspawn',
      groupId: brush.editorGroupId,
    }));
  });

  const issues: GeometryLintIssue[] = [];
  const duplicatePairs = new Set<string>();
  const signatures = new Map<string, BrushEntry[]>();
  for (const entry of brushes) {
    const signature = brushSignature(entry.brush);
    const matching = signatures.get(signature) ?? [];
    for (const other of matching) {
      const pair = [other.ref, entry.ref].sort().join('|');
      duplicatePairs.add(pair);
      issues.push({
        severity: 'warning', code: 'duplicate-brush', refs: [other.ref, entry.ref],
        message: `${other.ref} and ${entry.ref} occupy the same convex volume and are likely accidental duplicates.`,
      });
    }
    matching.push(entry); signatures.set(signature, matching);
  }

  const planarFaces: PlanarFace[] = [];
  for (const entry of brushes) {
    const dimensions = entry.brush.maxs.map((value, axis) => value - entry.brush.mins[axis]);
    const minimumDimension = Math.min(...dimensions);
    if (minimumDimension < 1) {
      issues.push({
        severity: 'warning', code: 'thin-brush', refs: [entry.ref],
        message: `${entry.ref} is only ${rounded(minimumDimension, 3)} units thick; it may collapse or compile unreliably.`,
      });
    }

    entry.brush.faces.forEach((face, faceIndex) => {
      const faceRef = `${entry.ref}:F${faceIndex}`;
      const area = polygonArea(face);
      const edges = face.polygon.map((point, index) => vec3Length(vec3Sub(face.polygon[(index + 1) % face.polygon.length], point)));
      const shortest = edges.length > 0 ? Math.min(...edges) : 0;
      const longest = edges.length > 0 ? Math.max(...edges) : 0;
      if (area > 0 && (area < 4 || (shortest < 1 && longest / Math.max(shortest, 0.0001) > 64))) {
        issues.push({
          severity: 'warning', code: 'sliver-face', refs: [faceRef],
          message: `${faceRef} is a sliver (${rounded(area, 3)} square units, shortest edge ${rounded(shortest, 3)}); simplify or snap the brush.`,
        });
      }
      const planar = axisAlignedFace(faceRef, entry.ref, face);
      if (planar) planarFaces.push(planar);
    });

    const offGrid = new Set<string>();
    for (const face of entry.brush.faces) for (const point of face.points) for (const coordinate of point) {
      if (Math.abs(coordinate * 8 - Math.round(coordinate * 8)) > 0.001) offGrid.add(String(rounded(coordinate, 4)));
    }
    if (offGrid.size > 0) {
      issues.push({
        severity: 'info', code: 'off-grid-geometry', refs: [entry.ref],
        message: `${entry.ref} has ${offGrid.size} defining coordinates outside the 0.125-unit compiler grid (for example ${[...offGrid].slice(0, 3).join(', ')}).`,
      });
    }

    const volume = dimensions.reduce((product, value) => product * Math.max(0, value), 1);
    if (entry.worldspawn && entry.structural && volume > 0 && volume <= 64 ** 3 && Math.max(...dimensions) <= 128) {
      issues.push({
        severity: 'info', code: 'likely-structural-detail', refs: [entry.ref],
        message: `${entry.ref} is a small structural brush (${dimensions.map(value => rounded(value, 1)).join(' × ')}); mark decorative geometry detail unless it seals the world or controls visibility.`,
      });
    }
  }

  const planeGroups = new Map<string, PlanarFace[]>();
  const groupByBrushRef = new Map(brushes.map(entry => [entry.ref, entry.groupId]));
  for (const face of planarFaces) {
    const key = `${face.axis}:${face.sign}:${face.distance}`;
    const group = planeGroups.get(key) ?? [];
    group.push(face); planeGroups.set(key, group);
  }
  for (const group of planeGroups.values()) for (let first = 0; first < group.length; first++) {
    for (let second = first + 1; second < group.length; second++) {
      const a = group[first]; const b = group[second];
      if (a.brushRef === b.brushRef || duplicatePairs.has([a.brushRef, b.brushRef].sort().join('|'))) continue;
      const aGroup = groupByBrushRef.get(a.brushRef); const bGroup = groupByBrushRef.get(b.brushRef);
      if (aGroup && aGroup === bGroup && constructionPathGroups.has(aGroup)) continue;
      const area = overlapArea(a, b);
      if (area <= 0.01) continue;
      issues.push({
        severity: 'warning', code: 'coplanar-overlap', refs: [a.ref, b.ref],
        message: `${a.ref} and ${b.ref} overlap by ${rounded(area, 2)} square units on the same outward plane and may z-fight.`,
      });
    }
  }

  return { issueCount: issues.length, issues };
}
