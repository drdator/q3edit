import { entityOrigin } from '../src/entity';
import { parseMapWithDiagnostics } from '../src/mapfile';
import type { Vec3 } from '../src/math';
import { isGroupInfoEntity } from '../src/named-groups';
import { analyzeJumpPad } from './jump-analysis';

interface Platform {
  ref: string;
  mins: Vec3;
  maxs: Vec3;
  z: number;
}

export interface RouteLintIssue {
  severity: 'error' | 'warning' | 'info';
  code: 'invalid-jump-pad' | 'blocked-jump-pad' | 'unsupported-jump-landing' | 'blocked-jump-landing' | 'unreachable-pickup' | 'missing-spawn';
  message: string;
  refs: string[];
}

function horizontalGap(a: Platform, b: Platform): number {
  const dx = Math.max(0, a.mins[0] - b.maxs[0], b.mins[0] - a.maxs[0]);
  const dy = Math.max(0, a.mins[1] - b.maxs[1], b.mins[1] - a.maxs[1]);
  return Math.hypot(dx, dy);
}

function supportPlatform(platforms: Platform[], point: Vec3, maxGap = 96): Platform | null {
  return platforms.filter(platform =>
    point[0] >= platform.mins[0] - 16 && point[0] <= platform.maxs[0] + 16 &&
    point[1] >= platform.mins[1] - 16 && point[1] <= platform.maxs[1] + 16 &&
    platform.z <= point[2] && point[2] - platform.z <= maxGap
  ).sort((a, b) => b.z - a.z)[0] ?? null;
}

function isSpawn(classname: string): boolean {
  return classname.startsWith('info_player_') || /spawn$/i.test(classname);
}

function isPickup(classname: string): boolean {
  return /^(?:item|weapon|ammo|holdable)_/.test(classname);
}

export function lintRoutes(mapText: string): Record<string, unknown> {
  const entities = parseMapWithDiagnostics(mapText).document.entities;
  const platforms: Platform[] = entities.flatMap((entity, entityIndex) => {
    if (entity.classname.startsWith('trigger_') || isGroupInfoEntity(entity)) return [];
    return entity.brushes.flatMap((brush, brushIndex) => brush.faces.some(face => face.plane.normal[2] > 0.7)
      ? [{ ref: `E${entityIndex}:B${brushIndex}`, mins: brush.mins, maxs: brush.maxs, z: brush.maxs[2] }]
      : []);
  });
  const edges = new Map<string, Set<string>>(platforms.map(platform => [platform.ref, new Set()]));
  const edgeDetails: Array<{ from: string; to: string; kind: 'walk' | 'jump' | 'jump-pad' }> = [];
  const connect = (from: string, to: string, kind: 'walk' | 'jump' | 'jump-pad', bidirectional = true) => {
    if (!edges.has(from) || !edges.has(to) || edges.get(from)!.has(to)) return;
    edges.get(from)!.add(to); edgeDetails.push({ from, to, kind });
    if (bidirectional) { edges.get(to)!.add(from); edgeDetails.push({ from: to, to: from, kind }); }
  };
  for (let a = 0; a < platforms.length; a++) {
    for (let b = a + 1; b < platforms.length; b++) {
      const gap = horizontalGap(platforms[a], platforms[b]);
      const height = Math.abs(platforms[a].z - platforms[b].z);
      if (gap <= 48 && height <= 18) connect(platforms[a].ref, platforms[b].ref, 'walk');
      else if (gap <= 128 && height <= 64) connect(platforms[a].ref, platforms[b].ref, 'jump');
    }
  }

  const issues: RouteLintIssue[] = [];
  const jumpPads: unknown[] = [];
  entities.forEach((entity, entityIndex) => {
    if (entity.classname !== 'trigger_push') return;
    const triggerRef = `E${entityIndex}`;
    try {
      const analysis = analyzeJumpPad(mapText, { triggerRef, sampleCount: 32 });
      jumpPads.push(analysis);
      const clearance = analysis.clearance as { clear: boolean; collisions: Array<{ ref: string }> };
      const landing = analysis.landing as { supported: boolean; brushRef?: string; hullClear?: boolean; blockers?: string[] };
      if (!clearance.clear) issues.push({
        severity: 'error', code: 'blocked-jump-pad', refs: [triggerRef, ...clearance.collisions.map(collision => collision.ref)],
        message: `${triggerRef} player hull intersects geometry along its trajectory`,
      });
      if (!landing.supported) issues.push({
        severity: 'error', code: 'unsupported-jump-landing', refs: [triggerRef],
        message: `${triggerRef} has no plausible landing surface`,
      });
      if (landing.supported && landing.hullClear === false) issues.push({
        severity: 'error', code: 'blocked-jump-landing', refs: [triggerRef, landing.brushRef!, ...(landing.blockers ?? [])],
        message: `${triggerRef} landing does not have a clear standing player hull`,
      });
      const launch = supportPlatform(platforms, analysis.launchOrigin as Vec3);
      if (launch && landing.brushRef) connect(launch.ref, landing.brushRef, 'jump-pad', false);
    } catch (error) {
      issues.push({
        severity: 'error', code: 'invalid-jump-pad', refs: [triggerRef],
        message: `${triggerRef}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  const spawnPlatforms = entities.flatMap((entity, entityIndex) => {
    if (!isSpawn(entity.classname)) return [];
    const origin = entityOrigin(entity);
    const platform = origin ? supportPlatform(platforms, origin) : null;
    return platform ? [{ entityRef: `E${entityIndex}`, platformRef: platform.ref }] : [];
  });
  if (spawnPlatforms.length === 0) issues.push({
    severity: 'warning', code: 'missing-spawn', refs: [], message: 'No player spawn could be assigned to a supporting platform',
  });
  const reachable = new Set(spawnPlatforms.map(spawn => spawn.platformRef));
  const queue = [...reachable];
  while (queue.length > 0) {
    for (const neighbor of edges.get(queue.shift()!) ?? []) {
      if (reachable.has(neighbor)) continue;
      reachable.add(neighbor); queue.push(neighbor);
    }
  }
  const pickups = entities.flatMap((entity, entityIndex) => {
    if (!isPickup(entity.classname)) return [];
    const origin = entityOrigin(entity);
    const platform = origin ? supportPlatform(platforms, origin) : null;
    const reachableFromSpawn = Boolean(platform && reachable.has(platform.ref));
    if (!reachableFromSpawn) issues.push({
      severity: 'warning', code: 'unreachable-pickup', refs: [`E${entityIndex}`, ...(platform ? [platform.ref] : [])],
      message: `E${entityIndex} (${entity.classname}) is not connected to a spawn by the approximate platform graph`,
    });
    return [{ entityRef: `E${entityIndex}`, classname: entity.classname, platformRef: platform?.ref ?? null, reachableFromSpawn }];
  });

  return {
    model: 'Approximate platform graph: 48-unit walk gaps/18-unit steps, 128-unit jump gaps/64-unit rises, plus directed trigger_push edges',
    issueCount: issues.length,
    issues,
    jumpPads,
    connectivity: {
      platformCount: platforms.length,
      edgeCount: edgeDetails.length,
      spawnPlatforms,
      reachablePlatformCount: reachable.size,
      pickups,
      edges: edgeDetails,
    },
  };
}
