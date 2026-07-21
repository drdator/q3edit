import type { Vec3 } from './math';

export const SPATIAL_PLAN_KEY = '_q3edit_spatial_plan';
export const SPATIAL_PLAN_VERSION = 1;

export type SpatialAreaShape = 'rectangular' | 'octagonal' | 'radial' | 'curved' | 'terraced' | 'irregular';
export type SpatialRouteType = 'corridor' | 'bridge' | 'stairs' | 'ramp' | 'jump' | 'teleporter' | 'open';

export interface SpatialOpening {
  side: 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
  width: number;
  offset?: number;
  note?: string;
}

export interface SpatialArea {
  id: string;
  purpose: string;
  shape: SpatialAreaShape;
  center: Vec3;
  bounds?: { mins: Vec3; maxs: Vec3 };
  radius?: number;
  height: number;
  levels: number[];
  footprint?: Vec3[];
  openings: SpatialOpening[];
  landmarkIntent?: string;
  groupId?: string;
}

export interface SpatialConnection {
  id: string;
  fromArea: string;
  toArea: string;
  routeType: SpatialRouteType;
  width: number;
  verticalChange?: number;
  curvature?: number;
  cover?: 'open' | 'partial' | 'enclosed';
  visibility?: 'hidden' | 'glimpse' | 'visible';
  traversalIntent?: string;
  groupId?: string;
}

export interface SpatialPlan {
  version: typeof SPATIAL_PLAN_VERSION;
  areas: SpatialArea[];
  connections: SpatialConnection[];
}

export interface SpatialPlanIssue {
  severity: 'error' | 'warning' | 'info';
  code: 'duplicate-area' | 'duplicate-connection' | 'missing-area' | 'self-connection' | 'overlapping-area' | 'disconnected-area';
  message: string;
  ids: string[];
}

const EMPTY_PLAN: SpatialPlan = { version: SPATIAL_PLAN_VERSION, areas: [], connections: [] };
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function finiteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(component => typeof component === 'number' && Number.isFinite(component));
}

function validArea(value: unknown): value is SpatialArea {
  if (!value || typeof value !== 'object') return false;
  const area = value as Partial<SpatialArea>;
  return typeof area.id === 'string' && idPattern.test(area.id) && typeof area.purpose === 'string' && area.purpose.length > 0 &&
    ['rectangular', 'octagonal', 'radial', 'curved', 'terraced', 'irregular'].includes(area.shape ?? '') &&
    finiteVec3(area.center) && typeof area.height === 'number' && area.height > 0 &&
    Array.isArray(area.levels) && area.levels.every(level => typeof level === 'number' && Number.isFinite(level)) &&
    Array.isArray(area.openings);
}

function validConnection(value: unknown): value is SpatialConnection {
  if (!value || typeof value !== 'object') return false;
  const connection = value as Partial<SpatialConnection>;
  return typeof connection.id === 'string' && idPattern.test(connection.id) &&
    typeof connection.fromArea === 'string' && typeof connection.toArea === 'string' &&
    ['corridor', 'bridge', 'stairs', 'ramp', 'jump', 'teleporter', 'open'].includes(connection.routeType ?? '') &&
    typeof connection.width === 'number' && connection.width > 0;
}

export function emptySpatialPlan(): SpatialPlan {
  return structuredClone(EMPTY_PLAN);
}

export function readSpatialPlan(properties: Record<string, string>): SpatialPlan {
  const serialized = properties[SPATIAL_PLAN_KEY];
  if (!serialized) return emptySpatialPlan();
  try {
    const parsed = JSON.parse(serialized) as Partial<SpatialPlan>;
    if (parsed.version !== SPATIAL_PLAN_VERSION || !Array.isArray(parsed.areas) || !Array.isArray(parsed.connections)) return emptySpatialPlan();
    return {
      version: SPATIAL_PLAN_VERSION,
      areas: parsed.areas.filter(validArea),
      connections: parsed.connections.filter(validConnection),
    };
  } catch {
    return emptySpatialPlan();
  }
}

export function serializeSpatialPlan(plan: SpatialPlan): string {
  return JSON.stringify({ version: SPATIAL_PLAN_VERSION, areas: plan.areas, connections: plan.connections });
}

export function upsertSpatialArea(plan: SpatialPlan, area: SpatialArea): SpatialPlan {
  const existing = plan.areas.findIndex(candidate => candidate.id === area.id);
  const areas = [...plan.areas];
  if (existing >= 0) areas[existing] = area; else areas.push(area);
  return { ...plan, areas };
}

export function upsertSpatialConnection(plan: SpatialPlan, connection: SpatialConnection): SpatialPlan {
  const existing = plan.connections.findIndex(candidate => candidate.id === connection.id);
  const connections = [...plan.connections];
  if (existing >= 0) connections[existing] = connection; else connections.push(connection);
  return { ...plan, connections };
}

function areaExtent(area: SpatialArea): { mins: Vec3; maxs: Vec3 } {
  if (area.bounds) return area.bounds;
  const radius = area.radius ?? 128;
  return {
    mins: [area.center[0] - radius, area.center[1] - radius, area.center[2]],
    maxs: [area.center[0] + radius, area.center[1] + radius, area.center[2] + area.height],
  };
}

function overlapVolume(a: SpatialArea, b: SpatialArea): number {
  const first = areaExtent(a); const second = areaExtent(b);
  return [0, 1, 2].reduce((volume, axis) => volume * Math.max(0, Math.min(first.maxs[axis], second.maxs[axis]) - Math.max(first.mins[axis], second.mins[axis])), 1);
}

export function inspectSpatialPlan(plan: SpatialPlan): {
  bounds: { mins: Vec3; maxs: Vec3 } | null;
  levels: number[];
  routeTypes: Record<SpatialRouteType, number>;
  connectedComponents: string[][];
  issues: SpatialPlanIssue[];
} {
  const issues: SpatialPlanIssue[] = [];
  const areaCounts = new Map<string, number>();
  const connectionCounts = new Map<string, number>();
  for (const area of plan.areas) areaCounts.set(area.id, (areaCounts.get(area.id) ?? 0) + 1);
  for (const connection of plan.connections) connectionCounts.set(connection.id, (connectionCounts.get(connection.id) ?? 0) + 1);
  for (const [id, count] of areaCounts) if (count > 1) issues.push({ severity: 'error', code: 'duplicate-area', message: `Area id ${id} occurs ${count} times.`, ids: [id] });
  for (const [id, count] of connectionCounts) if (count > 1) issues.push({ severity: 'error', code: 'duplicate-connection', message: `Connection id ${id} occurs ${count} times.`, ids: [id] });

  const areaIds = new Set(plan.areas.map(area => area.id));
  const adjacency = new Map(plan.areas.map(area => [area.id, new Set<string>()]));
  for (const connection of plan.connections) {
    const missing = [connection.fromArea, connection.toArea].filter(id => !areaIds.has(id));
    if (missing.length > 0) issues.push({
      severity: 'error', code: 'missing-area', ids: [connection.id, ...missing],
      message: `Connection ${connection.id} references missing area${missing.length === 1 ? '' : 's'} ${missing.join(', ')}.`,
    });
    if (connection.fromArea === connection.toArea) issues.push({
      severity: 'warning', code: 'self-connection', ids: [connection.id, connection.fromArea],
      message: `Connection ${connection.id} links area ${connection.fromArea} to itself.`,
    });
    if (missing.length === 0 && connection.fromArea !== connection.toArea) {
      adjacency.get(connection.fromArea)!.add(connection.toArea);
      adjacency.get(connection.toArea)!.add(connection.fromArea);
    }
  }

  for (let first = 0; first < plan.areas.length; first++) for (let second = first + 1; second < plan.areas.length; second++) {
    const volume = overlapVolume(plan.areas[first], plan.areas[second]);
    if (volume <= 0) continue;
    issues.push({
      severity: 'info', code: 'overlapping-area', ids: [plan.areas[first].id, plan.areas[second].id],
      message: `Areas ${plan.areas[first].id} and ${plan.areas[second].id} overlap by approximately ${Math.round(volume)} cubic units.`,
    });
  }

  const connectedComponents: string[][] = [];
  const visited = new Set<string>();
  for (const id of areaIds) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const queue = [id]; visited.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!; component.push(current);
      for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
    connectedComponents.push(component);
  }
  if (plan.areas.length > 1) for (const component of connectedComponents.filter(item => item.length === 1)) issues.push({
    severity: 'warning', code: 'disconnected-area', ids: component,
    message: `Area ${component[0]} has no semantic connection to another area.`,
  });

  const extents = plan.areas.map(areaExtent);
  const bounds = extents.length > 0 ? {
    mins: [0, 1, 2].map(axis => Math.min(...extents.map(extent => extent.mins[axis]))) as Vec3,
    maxs: [0, 1, 2].map(axis => Math.max(...extents.map(extent => extent.maxs[axis]))) as Vec3,
  } : null;
  const levels = [...new Set(plan.areas.flatMap(area => [area.center[2], ...area.levels]))].sort((a, b) => a - b);
  const routeTypes = Object.fromEntries(
    (['corridor', 'bridge', 'stairs', 'ramp', 'jump', 'teleporter', 'open'] as SpatialRouteType[]).map(type => [type, plan.connections.filter(connection => connection.routeType === type).length]),
  ) as Record<SpatialRouteType, number>;
  return { bounds, levels, routeTypes, connectedComponents, issues };
}
