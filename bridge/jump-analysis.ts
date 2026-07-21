import type { Brush } from '../src/brush';
import { entityOrigin } from '../src/entity';
import { parseMapWithDiagnostics } from '../src/mapfile';
import { vec3Dot, type Vec3 } from '../src/math';
import { isGroupInfoEntity } from '../src/named-groups';

export interface JumpPadAnalysisInput {
  triggerRef?: string;
  mins?: Vec3;
  maxs?: Vec3;
  apex?: Vec3;
  gravity?: number;
  sampleCount?: number;
}

interface CollisionBrush {
  ref: string;
  brush: Brush;
}

const PLAYER_MINS: Vec3 = [-15, -15, -24];
const PLAYER_MAXS: Vec3 = [15, 15, 32];
const PLAYER_CENTER: Vec3 = [0, 0, 4];
const PLAYER_HALF_EXTENTS: Vec3 = [15, 15, 28];

function finiteVec3(name: string, value: Vec3 | undefined): Vec3 {
  if (!value || value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${name} must contain three finite numbers`);
  return value;
}

function center(mins: Vec3, maxs: Vec3): Vec3 {
  return mins.map((value, axis) => (value + maxs[axis]) * 0.5) as Vec3;
}

function mergedBrushBounds(brushes: Brush[]): { mins: Vec3; maxs: Vec3 } {
  if (brushes.length === 0) throw new Error('The jump trigger has no brushes');
  return {
    mins: [0, 1, 2].map(axis => Math.min(...brushes.map(brush => brush.mins[axis]))) as Vec3,
    maxs: [0, 1, 2].map(axis => Math.max(...brushes.map(brush => brush.maxs[axis]))) as Vec3,
  };
}

function boundsOverlap(a: { mins: Vec3; maxs: Vec3 }, b: { mins: Vec3; maxs: Vec3 }): boolean {
  return a.maxs.every((value, axis) => value >= b.mins[axis]) && a.mins.every((value, axis) => value <= b.maxs[axis]);
}

function playerHullIntersectsBrush(origin: Vec3, brush: Brush): boolean {
  const hullCenter: Vec3 = origin.map((value, axis) => value + PLAYER_CENTER[axis]) as Vec3;
  return brush.faces.every(face => {
    const radius = PLAYER_HALF_EXTENTS.reduce((sum, extent, axis) => sum + extent * Math.abs(face.plane.normal[axis]), 0);
    return vec3Dot(face.plane.normal, hullCenter) - face.plane.dist <= radius + 0.1;
  });
}

function trajectoryPoint(origin: Vec3, velocity: Vec3, gravity: number, time: number): Vec3 {
  return [
    origin[0] + velocity[0] * time,
    origin[1] + velocity[1] * time,
    origin[2] + velocity[2] * time - 0.5 * gravity * time * time,
  ];
}

function landingOnBrush(
  origin: Vec3,
  velocity: Vec3,
  gravity: number,
  apexTime: number,
  candidate: CollisionBrush,
): { time: number; origin: Vec3 } | null {
  const desiredOriginZ = candidate.brush.maxs[2] - PLAYER_MINS[2];
  const discriminant = velocity[2] * velocity[2] - 2 * gravity * (desiredOriginZ - origin[2]);
  if (discriminant < 0) return null;
  const time = (velocity[2] + Math.sqrt(discriminant)) / gravity;
  if (!Number.isFinite(time) || time <= apexTime + 0.01) return null;
  const point = trajectoryPoint(origin, velocity, gravity, time);
  const overlapsX = point[0] + PLAYER_MAXS[0] >= candidate.brush.mins[0] && point[0] + PLAYER_MINS[0] <= candidate.brush.maxs[0];
  const overlapsY = point[1] + PLAYER_MAXS[1] >= candidate.brush.mins[1] && point[1] + PLAYER_MINS[1] <= candidate.brush.maxs[1];
  return overlapsX && overlapsY ? { time, origin: point } : null;
}

export function analyzeJumpPad(mapText: string, input: JumpPadAnalysisInput): Record<string, unknown> {
  const entities = parseMapWithDiagnostics(mapText).document.entities;
  let triggerBounds: { mins: Vec3; maxs: Vec3 };
  let apex: Vec3;
  let triggerRef: string | null = null;
  let targetRef: string | null = null;
  let targetMatches = 0;

  if (input.triggerRef) {
    const match = /^E(\d+)$/.exec(input.triggerRef);
    if (!match) throw new Error('triggerRef must identify an entity such as E12');
    const entityIndex = Number(match[1]);
    const trigger = entities[entityIndex];
    if (!trigger) throw new Error(`Jump trigger ${input.triggerRef} does not exist`);
    if (trigger.classname !== 'trigger_push') throw new Error(`${input.triggerRef} is ${trigger.classname}, not trigger_push`);
    triggerBounds = mergedBrushBounds(trigger.brushes);
    const targetname = trigger.properties.target;
    if (!targetname) throw new Error(`${input.triggerRef} has no target property`);
    const targets = entities.map((entity, index) => ({ entity, index }))
      .filter(item => item.entity.properties.targetname === targetname);
    targetMatches = targets.length;
    const target = targets.find(item => entityOrigin(item.entity));
    if (!target) throw new Error(`${input.triggerRef} target ${targetname} has no entity with an origin`);
    apex = entityOrigin(target.entity)!;
    triggerRef = input.triggerRef;
    targetRef = `E${target.index}`;
  } else {
    const mins = finiteVec3('mins', input.mins);
    const maxs = finiteVec3('maxs', input.maxs);
    if (mins.some((value, axis) => value >= maxs[axis])) throw new Error('mins must be smaller than maxs on every axis');
    triggerBounds = { mins, maxs };
    apex = finiteVec3('apex', input.apex);
  }

  const launchOrigin = center(triggerBounds.mins, triggerBounds.maxs);
  const gravityProperty = entities.find(entity => entity.classname === 'worldspawn')?.properties.gravity;
  const gravity = input.gravity ?? Number(gravityProperty || 800);
  if (!Number.isFinite(gravity) || gravity <= 0) throw new Error('gravity must be a positive finite number');
  const height = apex[2] - launchOrigin[2];
  if (height <= 0) throw new Error(`The apex must be above the trigger center (height is ${height})`);

  // This matches Quake III's AimAtTarget in code/game/g_trigger.c.
  const timeToApex = Math.sqrt(height / (0.5 * gravity));
  const velocity: Vec3 = [
    (apex[0] - launchOrigin[0]) / timeToApex,
    (apex[1] - launchOrigin[1]) / timeToApex,
    timeToApex * gravity,
  ];
  const collisionBrushes: CollisionBrush[] = entities.flatMap((entity, entityIndex) => {
    if (entity.classname.startsWith('trigger_') || isGroupInfoEntity(entity)) return [];
    return entity.brushes.map((brush, brushIndex) => ({ ref: `E${entityIndex}:B${brushIndex}`, brush }));
  });
  const launchBrushes = new Set(collisionBrushes
    .filter(candidate => boundsOverlap(triggerBounds, { mins: candidate.brush.mins, maxs: candidate.brush.maxs }))
    .map(candidate => candidate.ref));
  const landingCandidates = collisionBrushes
    .map(candidate => ({ candidate, landing: landingOnBrush(launchOrigin, velocity, gravity, timeToApex, candidate) }))
    .filter((item): item is { candidate: CollisionBrush; landing: { time: number; origin: Vec3 } } => item.landing !== null)
    .sort((a, b) => a.landing.time - b.landing.time);
  const landing = landingCandidates[0] ?? null;
  const nominalFlightTime = timeToApex * 2;
  const analysisEndTime = landing?.landing.time ?? nominalFlightTime;
  const collisionMap = new Map<string, { ref: string; firstTime: number; position: Vec3 }>();
  const samples = 96;
  for (let index = 1; index < samples; index++) {
    const time = analysisEndTime * index / samples;
    if (time < 0.04 || analysisEndTime - time < 0.04) continue;
    const position = trajectoryPoint(launchOrigin, velocity, gravity, time);
    for (const candidate of collisionBrushes) {
      if (launchBrushes.has(candidate.ref) || candidate.ref === landing?.candidate.ref || collisionMap.has(candidate.ref)) continue;
      if (playerHullIntersectsBrush(position, candidate.brush)) {
        collisionMap.set(candidate.ref, { ref: candidate.ref, firstTime: time, position });
      }
    }
  }

  const nominalLandingOrigin = trajectoryPoint(launchOrigin, velocity, gravity, nominalFlightTime);
  const sampleCount = Math.max(4, Math.min(128, Math.round(input.sampleCount ?? 32)));
  const trajectory = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const time = analysisEndTime * index / sampleCount;
    return { time, position: trajectoryPoint(launchOrigin, velocity, gravity, time) };
  });
  const landingBlockers = landing ? collisionBrushes.filter(candidate =>
    candidate.ref !== landing.candidate.ref && !launchBrushes.has(candidate.ref) &&
    playerHullIntersectsBrush([
      landing.landing.origin[0], landing.landing.origin[1], landing.landing.origin[2] + 0.25,
    ], candidate.brush)
  ).map(candidate => candidate.ref) : [];
  const warnings: string[] = [];
  if (targetMatches > 1) warnings.push(`The target name resolves to ${targetMatches} entities; Quake III may choose any of them`);
  if (!landing) warnings.push('No plausible landing surface was found on the descending trajectory');
  if (collisionMap.size > 0) warnings.push(`The approximate player hull intersects ${collisionMap.size} brush${collisionMap.size === 1 ? '' : 'es'} before landing`);
  if (landingBlockers.length > 0) warnings.push(`The standing player hull at landing overlaps ${landingBlockers.length} brush${landingBlockers.length === 1 ? '' : 'es'}`);
  return {
    model: 'Quake III AimAtTarget with an approximate 30×30×56 player hull',
    triggerRef,
    targetRef,
    targetMatches,
    gravity,
    triggerBounds,
    launchOrigin,
    apex,
    velocity,
    horizontalSpeed: Math.hypot(velocity[0], velocity[1]),
    verticalSpeed: velocity[2],
    timeToApex,
    nominalFlightTime,
    nominalLandingOrigin,
    landing: landing ? {
      supported: true,
      brushRef: landing.candidate.ref,
      time: landing.landing.time,
      origin: landing.landing.origin,
      feetPosition: [landing.landing.origin[0], landing.landing.origin[1], landing.candidate.brush.maxs[2]],
      hullClear: landingBlockers.length === 0,
      blockers: landingBlockers,
    } : { supported: false },
    clearance: { clear: collisionMap.size === 0, collisions: [...collisionMap.values()] },
    trajectory,
    warnings,
  };
}
