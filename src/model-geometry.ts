import type { Entity } from './entity';
import type { ResolvedModel } from './model-manager';
import type { Vec3 } from './math';

export interface ModelSurfaceGeometry {
  texture: string;
  vertices: number[];
}

function entityScale(entity: Entity): Vec3 {
  const vector = entity.properties.modelscale_vec?.trim().split(/\s+/).map(Number);
  if (vector?.length === 3 && vector.every(Number.isFinite)) return [vector[0], vector[1], vector[2]];
  const uniform = Number(entity.properties.modelscale ?? entity.properties.scale ?? 1);
  const scale = Number.isFinite(uniform) ? uniform : 1;
  return [scale, scale, scale];
}

function entityAngles(entity: Entity): Vec3 {
  const vector = entity.properties.angles?.trim().split(/\s+/).map(Number);
  if (vector?.length === 3 && vector.every(Number.isFinite)) return [vector[0], vector[1], vector[2]];
  const yaw = Number(entity.properties.angle ?? 0);
  return [0, Number.isFinite(yaw) ? yaw : 0, 0];
}

function rotate(position: Vec3, angles: Vec3): Vec3 {
  let [x, y, z] = position;
  const [pitch, yaw, roll] = angles.map(value => value * Math.PI / 180);
  let c = Math.cos(roll); let s = Math.sin(roll);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(pitch); s = Math.sin(pitch);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(yaw); s = Math.sin(yaw);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

export function transformModelPoint(entity: Entity, point: Vec3, normal = false): Vec3 {
  const scale = entityScale(entity);
  const scaled: Vec3 = normal
    ? [point[0] / (scale[0] || 1), point[1] / (scale[1] || 1), point[2] / (scale[2] || 1)]
    : [point[0] * scale[0], point[1] * scale[1], point[2] * scale[2]];
  const rotated = rotate(scaled, entityAngles(entity));
  if (normal) {
    const length = Math.hypot(...rotated) || 1;
    return [rotated[0] / length, rotated[1] / length, rotated[2] / length];
  }
  const origin = entity.properties.origin?.trim().split(/\s+/).map(Number);
  return origin?.length === 3 && origin.every(Number.isFinite)
    ? [rotated[0] + origin[0], rotated[1] + origin[1], rotated[2] + origin[2]]
    : rotated;
}

export function buildModelGeometry(entity: Entity, resolved: ResolvedModel): ModelSurfaceGeometry[] {
  return resolved.model.surfaces.map(surface => {
    const vertices: number[] = [];
    const frame = surface.frames[resolved.frame] ?? surface.frames[0] ?? [];
    for (const triangle of surface.triangles) {
      for (const index of triangle) {
        const vertex = frame[index];
        const uv = surface.uvs[index] ?? [0, 0];
        if (!vertex) continue;
        const position = transformModelPoint(entity, vertex.position);
        const normal = transformModelPoint(entity, vertex.normal, true);
        vertices.push(...position, ...normal, uv[0], uv[1]);
      }
    }
    return {
      texture: resolved.surfaceTextures.get(surface.name.toLowerCase()) ?? surface.shaders[0] ?? 'common/caulk',
      vertices,
    };
  });
}

export function transformedModelBounds(entity: Entity, resolved: ResolvedModel): { mins: Vec3; maxs: Vec3 } {
  const frame = resolved.model.frames[resolved.frame] ?? resolved.model.frames[0];
  const corners: Vec3[] = [];
  for (const x of [frame.mins[0], frame.maxs[0]]) for (const y of [frame.mins[1], frame.maxs[1]]) for (const z of [frame.mins[2], frame.maxs[2]]) {
    corners.push(transformModelPoint(entity, [x, y, z]));
  }
  return {
    mins: [Math.min(...corners.map(point => point[0])), Math.min(...corners.map(point => point[1])), Math.min(...corners.map(point => point[2]))],
    maxs: [Math.max(...corners.map(point => point[0])), Math.max(...corners.map(point => point[1])), Math.max(...corners.map(point => point[2]))],
  };
}
