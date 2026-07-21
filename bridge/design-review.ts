import type { EditorDiagnostic, MapInfo } from '../src/diagnostics';
import type { Vec3 } from '../src/math';
import { lintGameplay, type GameplayLintIssue } from './gameplay-lint';
import { collectMapStatistics, type MapStatistics } from './map-statistics';
import { lintRoutes, type RouteLintIssue } from './route-lint';
import { lintGeometry, type GeometryLintIssue } from './geometry-lint';
import { reviewStyleBrief, type StyleFinding } from './style-brief';

export interface CompactMapSummary {
  world: { bounds: { mins: Vec3; maxs: Vec3 } | null; size: number[] | null };
  counts: {
    entities: number; brushes: number; patches: number; terrain: number; groups: number;
    structuralBrushes: number; detailBrushes: number; structuralPatches: number; detailPatches: number;
    textures: number; lights: number; spawns: number; items: number;
  };
  diagnostics: { errors: number; warnings: number; info: number };
  entityClasses: { count: number; sample: Array<{ classname: string; count: number }>; truncated: boolean };
  distributions: {
    spawnBounds: { mins: Vec3; maxs: Vec3 } | null;
    itemBounds: { mins: Vec3; maxs: Vec3 } | null;
    spawnNearestNeighbor: { minimum: number; average: number } | null;
    itemNearestNeighbor: { minimum: number; average: number } | null;
  };
}

export interface DesignFinding {
  source: 'validation' | 'geometry' | 'style' | 'gameplay' | 'routes';
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  refs: string[];
}

function sampled<T>(items: T[], limit: number): { count: number; sample: T[]; truncated: boolean } {
  return { count: items.length, sample: items.slice(0, limit), truncated: items.length > limit };
}

function diagnosticRefs(diagnostic: EditorDiagnostic): string[] {
  const target = diagnostic.target;
  if (!target) return [];
  if (target.kind === 'entity') return [`E${target.entityIndex}`];
  if (target.kind === 'brush') return [`E${target.entityIndex}:B${target.brushIndex}`];
  return [`E${target.entityIndex}:P${target.patchIndex}`];
}

export function compactMapSummary(mapInfo: MapInfo, statistics: MapStatistics): CompactMapSummary {
  const entityClasses = [...mapInfo.entityClasses].sort((a, b) => b.count - a.count || a.classname.localeCompare(b.classname));
  return {
    world: { bounds: statistics.worldBounds, size: statistics.worldSize },
    counts: {
      entities: mapInfo.entities,
      brushes: mapInfo.brushes,
      patches: mapInfo.patches,
      terrain: mapInfo.terrain,
      groups: mapInfo.groups,
      structuralBrushes: statistics.geometry.structuralBrushes,
      detailBrushes: statistics.geometry.detailBrushes,
      structuralPatches: statistics.geometry.structuralPatches,
      detailPatches: statistics.geometry.detailPatches,
      textures: statistics.textures.uniqueCount,
      lights: statistics.lighting.count,
      spawns: statistics.spawns.count,
      items: statistics.items.count,
    },
    diagnostics: mapInfo.diagnostics,
    entityClasses: sampled(entityClasses, 12),
    distributions: {
      spawnBounds: statistics.spawns.bounds,
      itemBounds: statistics.items.bounds,
      spawnNearestNeighbor: statistics.spawns.nearestNeighbor,
      itemNearestNeighbor: statistics.items.nearestNeighbor,
    },
  };
}

export function reviewMap(
  mapText: string,
  mapInfo: MapInfo,
  diagnostics: EditorDiagnostic[],
  detail: 'compact' | 'full' = 'compact',
): Record<string, unknown> {
  const limit = detail === 'full' ? Number.MAX_SAFE_INTEGER : 20;
  const statistics = collectMapStatistics(mapText);
  const gameplayIssues = lintGameplay(mapText);
  const geometry = lintGeometry(mapText);
  const style = reviewStyleBrief(mapText);
  const routes = lintRoutes(mapText);
  const validationFindings: DesignFinding[] = diagnostics.map(diagnostic => ({
    source: 'validation', severity: diagnostic.severity, code: diagnostic.code,
    message: diagnostic.message, refs: diagnosticRefs(diagnostic),
  }));
  const gameplayFindings: DesignFinding[] = gameplayIssues.map((issue: GameplayLintIssue) => ({ source: 'gameplay', ...issue }));
  const geometryFindings: DesignFinding[] = geometry.issues.map((issue: GeometryLintIssue) => ({ source: 'geometry', ...issue }));
  const styleFindings: DesignFinding[] = style.issues.map((issue: StyleFinding) => ({ source: 'style', ...issue }));
  const routeFindings: DesignFinding[] = routes.issues.map((issue: RouteLintIssue) => ({ source: 'routes', ...issue }));
  const findings = [...validationFindings, ...geometryFindings, ...styleFindings, ...gameplayFindings, ...routeFindings];
  const severityCounts = {
    errors: findings.filter(finding => finding.severity === 'error').length,
    warnings: findings.filter(finding => finding.severity === 'warning').length,
    info: findings.filter(finding => finding.severity === 'info').length,
  };
  const reachablePickups = routes.connectivity.pickups.filter(pickup => pickup.reachableFromSpawn);
  const edgeKinds = routes.connectivity.edges.reduce<Record<string, number>>((counts, edge) => {
    counts[edge.kind] = (counts[edge.kind] ?? 0) + 1;
    return counts;
  }, { walk: 0, jump: 0, 'jump-pad': 0 });
  const jumpPads = routes.jumpPads.map(analysis => ({
    triggerRef: analysis.triggerRef,
    targetRef: analysis.targetRef,
    clearance: { clear: analysis.clearance.clear, collisionCount: analysis.clearance.collisions.length },
    landing: analysis.landing.supported ? {
      supported: true, brushRef: analysis.landing.brushRef, hullClear: analysis.landing.hullClear,
      blockers: analysis.landing.blockers,
    } : { supported: false },
    warnings: analysis.warnings,
  }));
  return {
    model: 'Combined editor validation, geometry quality, placement lint, and approximate platform-route review; findings are authoring heuristics, not compiler or playtest proof.',
    detail,
    status: severityCounts.errors > 0 ? 'blocked' : severityCounts.warnings > 0 ? 'needs-attention' : 'pass',
    severityCounts,
    findingCount: findings.length,
    findings: sampled(findings, limit),
    map: compactMapSummary(mapInfo, statistics),
    validation: sampled(validationFindings, limit),
    geometry: { issueCount: geometry.issueCount, issues: sampled(geometry.issues, limit) },
    style: { ...style, issues: sampled(style.issues, limit) },
    gameplay: { issueCount: gameplayIssues.length, issues: sampled(gameplayIssues, limit) },
    routes: {
      issueCount: routes.issueCount,
      issues: sampled(routes.issues, limit),
      jumpPads: sampled(jumpPads, limit),
      connectivity: {
        platformCount: routes.connectivity.platformCount,
        edgeCount: routes.connectivity.edgeCount,
        reachablePlatformCount: routes.connectivity.reachablePlatformCount,
        spawnCount: routes.connectivity.spawnPlatforms.length,
        pickupCount: routes.connectivity.pickups.length,
        reachablePickupCount: reachablePickups.length,
        unreachablePickupRefs: routes.connectivity.pickups.filter(pickup => !pickup.reachableFromSpawn).map(pickup => pickup.entityRef),
        edgeKinds,
      },
    },
  };
}
