import { entityOrigin, type Entity } from './entity';
import { effectiveDynamicLightRadius } from './dynamic-lighting';
import type { Vec3 } from './math';

export type LightVolume =
  | { kind: 'point'; origin: Vec3; radius: number }
  | { kind: 'spot'; origin: Vec3; target: Vec3; targetRadius: number };

export type LightVolumeSegment = [Vec3, Vec3];

export function resolveLightVolume(entities: readonly Entity[], light: Entity): LightVolume | null {
  if (light.classname !== 'light') return null;
  const origin = entityOrigin(light);
  if (!origin) return null;

  const targetName = light.properties.target?.trim();
  if (targetName) {
    const targetEntity = entities.find(entity => entity.properties.targetname === targetName);
    const target = targetEntity ? entityOrigin(targetEntity) : null;
    if (target) {
      const configuredRadius = Number(light.properties.radius);
      return {
        kind: 'spot',
        origin,
        target,
        targetRadius: Number.isFinite(configuredRadius) && configuredRadius > 0 ? configuredRadius : 64,
      };
    }
  }

  const intensity = Number(light.properties.light);
  return {
    kind: 'point',
    origin,
    radius: effectiveDynamicLightRadius(Number.isFinite(intensity) && intensity > 0 ? intensity : 300),
  };
}

export function lightVolumeSegments(volume: LightVolume, circleSegments = 48): LightVolumeSegment[] {
  const segmentCount = Math.max(8, Math.floor(circleSegments));
  if (volume.kind === 'point') {
    const lines: LightVolumeSegment[] = [];
    for (let axis = 0; axis < 3; axis++) {
      for (let index = 0; index < segmentCount; index++) {
        const angle0 = index / segmentCount * Math.PI * 2;
        const angle1 = (index + 1) / segmentCount * Math.PI * 2;
        lines.push([
          pointOnAxisCircle(volume.origin, volume.radius, axis, angle0),
          pointOnAxisCircle(volume.origin, volume.radius, axis, angle1),
        ]);
      }
    }
    return lines;
  }

  const direction: Vec3 = [
    volume.target[0] - volume.origin[0],
    volume.target[1] - volume.origin[1],
    volume.target[2] - volume.origin[2],
  ];
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length < 0.001) return [];
  const forward: Vec3 = [direction[0] / length, direction[1] / length, direction[2] / length];
  const reference: Vec3 = Math.abs(forward[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const right = normalizedCross(forward, reference);
  const up = normalizedCross(right, forward);
  const ring: Vec3[] = [];
  for (let index = 0; index < segmentCount; index++) {
    const angle = index / segmentCount * Math.PI * 2;
    ring.push([
      volume.target[0] + (right[0] * Math.cos(angle) + up[0] * Math.sin(angle)) * volume.targetRadius,
      volume.target[1] + (right[1] * Math.cos(angle) + up[1] * Math.sin(angle)) * volume.targetRadius,
      volume.target[2] + (right[2] * Math.cos(angle) + up[2] * Math.sin(angle)) * volume.targetRadius,
    ]);
  }

  const lines: LightVolumeSegment[] = [];
  for (let index = 0; index < segmentCount; index++) {
    lines.push([ring[index], ring[(index + 1) % segmentCount]]);
  }
  for (let index = 0; index < segmentCount; index += Math.max(1, Math.floor(segmentCount / 8))) {
    lines.push([volume.origin, ring[index]]);
  }
  return lines;
}

function pointOnAxisCircle(origin: Vec3, radius: number, axis: number, angle: number): Vec3 {
  const point: Vec3 = [...origin];
  if (axis === 0) {
    point[0] += Math.cos(angle) * radius;
    point[1] += Math.sin(angle) * radius;
  } else if (axis === 1) {
    point[0] += Math.cos(angle) * radius;
    point[2] += Math.sin(angle) * radius;
  } else {
    point[1] += Math.cos(angle) * radius;
    point[2] += Math.sin(angle) * radius;
  }
  return point;
}

function normalizedCross(left: Vec3, right: Vec3): Vec3 {
  const cross: Vec3 = [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
  const length = Math.hypot(cross[0], cross[1], cross[2]) || 1;
  return [cross[0] / length, cross[1] / length, cross[2] / length];
}
