import { entityOrigin } from '../src/entity';
import { effectiveDynamicLightRadius } from '../src/dynamic-lighting';
import { parseMapWithDiagnostics } from '../src/mapfile';
import { CONTENTS_DETAIL } from '../src/map-flags';
import type { Vec3 } from '../src/math';
import { isGroupInfoEntity } from '../src/named-groups';

function pointBounds(points: Vec3[]): { mins: Vec3; maxs: Vec3 } | null {
  if (points.length === 0) return null;
  return {
    mins: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]))) as Vec3,
    maxs: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]))) as Vec3,
  };
}

function distribution(points: Array<{ ref: string; classname: string; origin: Vec3 }>): Record<string, unknown> {
  const bounds = pointBounds(points.map(point => point.origin));
  const centroid = points.length > 0
    ? [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point.origin[axis], 0) / points.length)
    : null;
  const distances: number[] = [];
  for (let first = 0; first < points.length; first++) for (let second = first + 1; second < points.length; second++) {
    distances.push(Math.hypot(...points[first].origin.map((value, axis) => value - points[second].origin[axis])));
  }
  const byClass = Object.entries(points.reduce<Record<string, number>>((counts, point) => {
    counts[point.classname] = (counts[point.classname] ?? 0) + 1; return counts;
  }, {})).map(([classname, count]) => ({ classname, count })).sort((a, b) => a.classname.localeCompare(b.classname));
  return {
    count: points.length, bounds, centroid, byClass,
    nearestNeighbor: distances.length > 0 ? {
      minimum: Math.min(...distances), average: distances.reduce((sum, value) => sum + value, 0) / distances.length,
    } : null,
    objects: points,
  };
}

export function collectMapStatistics(mapText: string): Record<string, unknown> {
  const entities = parseMapWithDiagnostics(mapText).document.entities;
  const worldPoints: Vec3[] = [];
  let structuralBrushes = 0;
  let detailBrushes = 0;
  let structuralPatches = 0;
  let detailPatches = 0;
  const textures = new Set<string>();
  entities.forEach(entity => {
    if (isGroupInfoEntity(entity)) return;
    const origin = entityOrigin(entity);
    if (origin) worldPoints.push(origin);
    for (const brush of entity.brushes) {
      worldPoints.push(brush.mins, brush.maxs);
      if (brush.faces.some(face => (face.contentFlags & CONTENTS_DETAIL) !== 0)) detailBrushes++;
      else structuralBrushes++;
      brush.faces.forEach(face => textures.add(face.texture));
    }
    for (const patch of entity.patches) {
      worldPoints.push(patch.mins, patch.maxs);
      if ((patch.contentFlags & CONTENTS_DETAIL) !== 0) detailPatches++;
      else structuralPatches++;
      textures.add(patch.texture);
    }
  });
  const worldBounds = pointBounds(worldPoints);
  const worldVolume = worldBounds
    ? (worldBounds.maxs[0] - worldBounds.mins[0]) * (worldBounds.maxs[1] - worldBounds.mins[1]) * (worldBounds.maxs[2] - worldBounds.mins[2])
    : 0;
  const lights = entities.flatMap((entity, entityIndex) => {
    if (entity.classname !== 'light') return [];
    const origin = entityOrigin(entity);
    if (!origin) return [];
    const intensity = Number(entity.properties.light) || 300;
    return [{ ref: `E${entityIndex}`, origin, intensity, radius: effectiveDynamicLightRadius(intensity) }];
  });
  const totalLightSphereVolume = lights.reduce((sum, light) => sum + 4 / 3 * Math.PI * light.radius ** 3, 0);
  const spawns = entities.flatMap((entity, entityIndex) => {
    if (!(entity.classname.startsWith('info_player_') || /spawn$/i.test(entity.classname))) return [];
    const origin = entityOrigin(entity);
    return origin ? [{ ref: `E${entityIndex}`, classname: entity.classname, origin }] : [];
  });
  const items = entities.flatMap((entity, entityIndex) => {
    if (!/^(?:item|weapon|ammo|holdable)_/.test(entity.classname)) return [];
    const origin = entityOrigin(entity);
    return origin ? [{ ref: `E${entityIndex}`, classname: entity.classname, origin }] : [];
  });
  return {
    worldBounds,
    worldSize: worldBounds ? worldBounds.maxs.map((value, axis) => value - worldBounds.mins[axis]) : null,
    geometry: {
      structuralBrushes, detailBrushes, structuralPatches, detailPatches,
      totalBrushes: structuralBrushes + detailBrushes, totalPatches: structuralPatches + detailPatches,
    },
    textures: { uniqueCount: textures.size, names: [...textures].sort() },
    lighting: {
      count: lights.length,
      radius: lights.length > 0 ? {
        minimum: Math.min(...lights.map(light => light.radius)), maximum: Math.max(...lights.map(light => light.radius)),
        average: lights.reduce((sum, light) => sum + light.radius, 0) / lights.length,
      } : null,
      summedSphereVolume: totalLightSphereVolume,
      worldVolumeUpperBoundPercent: worldVolume > 0 ? Math.min(100, totalLightSphereVolume / worldVolume * 100) : null,
      note: 'Coverage is an upper bound from summed editor-preview influence spheres; overlap and occlusion are not subtracted.',
      lights,
    },
    spawns: distribution(spawns),
    items: distribution(items),
  };
}
