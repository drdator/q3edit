import type { Vec3 } from './math';

export const CONSTRUCTION_PATHS_KEY = '_q3edit_construction_paths';
export const CONSTRUCTION_PATHS_VERSION = 1;

export type ConstructionPathKind = 'corridor' | 'wall' | 'railing' | 'pipe' | 'beam' | 'trim' | 'stairs' | 'supports';
export type ConstructionPathCurve = 'polyline' | 'catmull-rom';

export interface ConstructionPathRecord {
  id: string;
  kind: ConstructionPathKind;
  curve: ConstructionPathCurve;
  controlPoints: Vec3[];
  sampledPointCount: number;
  width: number;
  height?: number;
  thickness: number;
  spacing?: number;
  subdivisions: number;
  sides?: number;
  join: 'overlap' | 'bevel';
  capEnds: boolean;
  bankDegrees: number;
  texture: string;
  classification: 'detail' | 'structural';
  groupId: string;
  objectCount: number;
  replacedObjectCount?: number;
  bounds: { mins: Vec3; maxs: Vec3 };
}

export interface ConstructionPathDocument {
  version: typeof CONSTRUCTION_PATHS_VERSION;
  paths: ConstructionPathRecord[];
}

const emptyDocument = (): ConstructionPathDocument => ({ version: CONSTRUCTION_PATHS_VERSION, paths: [] });

function finiteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(component => typeof component === 'number' && Number.isFinite(component));
}

function validRecord(value: unknown): value is ConstructionPathRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ConstructionPathRecord>;
  return typeof record.id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(record.id) &&
    ['corridor', 'wall', 'railing', 'pipe', 'beam', 'trim', 'stairs', 'supports'].includes(record.kind ?? '') &&
    ['polyline', 'catmull-rom'].includes(record.curve ?? '') && Array.isArray(record.controlPoints) && record.controlPoints.every(finiteVec3) &&
    typeof record.groupId === 'string' && typeof record.objectCount === 'number' &&
    Boolean(record.bounds && finiteVec3(record.bounds.mins) && finiteVec3(record.bounds.maxs));
}

export function readConstructionPaths(properties: Record<string, string>): ConstructionPathDocument {
  const serialized = properties[CONSTRUCTION_PATHS_KEY];
  if (!serialized) return emptyDocument();
  try {
    const parsed = JSON.parse(serialized) as Partial<ConstructionPathDocument>;
    if (parsed.version !== CONSTRUCTION_PATHS_VERSION || !Array.isArray(parsed.paths)) return emptyDocument();
    return { version: CONSTRUCTION_PATHS_VERSION, paths: parsed.paths.filter(validRecord) };
  } catch {
    return emptyDocument();
  }
}

export function serializeConstructionPaths(document: ConstructionPathDocument): string {
  return JSON.stringify(document);
}

export function upsertConstructionPath(document: ConstructionPathDocument, record: ConstructionPathRecord): ConstructionPathDocument {
  const paths = [...document.paths];
  const index = paths.findIndex(path => path.id === record.id);
  if (index >= 0) paths[index] = record; else paths.push(record);
  return { version: CONSTRUCTION_PATHS_VERSION, paths };
}

export function constructionPathSummary(document: ConstructionPathDocument): {
  count: number;
  totalObjects: number;
  byKind: Record<ConstructionPathKind, number>;
  bounds: { mins: Vec3; maxs: Vec3 } | null;
} {
  const kinds = ['corridor', 'wall', 'railing', 'pipe', 'beam', 'trim', 'stairs', 'supports'] as ConstructionPathKind[];
  const bounds = document.paths.length > 0 ? {
    mins: [0, 1, 2].map(axis => Math.min(...document.paths.map(path => path.bounds.mins[axis]))) as Vec3,
    maxs: [0, 1, 2].map(axis => Math.max(...document.paths.map(path => path.bounds.maxs[axis]))) as Vec3,
  } : null;
  return {
    count: document.paths.length,
    totalObjects: document.paths.reduce((sum, path) => sum + path.objectCount, 0),
    byKind: Object.fromEntries(kinds.map(kind => [kind, document.paths.filter(path => path.kind === kind).length])) as Record<ConstructionPathKind, number>,
    bounds,
  };
}
