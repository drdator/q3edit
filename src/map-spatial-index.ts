import type { Brush } from './brush';
import type { Editor } from './editor';
import type { Entity } from './entity';
import type { Vec3 } from './math';
import type { Patch } from './patch';

export type MapSpatialEntry =
  | { kind: 'brush'; entity: Entity; brush: Brush; mins: Vec3; maxs: Vec3 }
  | { kind: 'patch'; entity: Entity; patch: Patch; mins: Vec3; maxs: Vec3 }
  | { kind: 'entity'; entity: Entity; mins: Vec3; maxs: Vec3 };

type Projection = '01' | '02' | '12';

function projection(axisH: number, axisV: number): Projection {
  const key = [axisH, axisV].sort().join('');
  if (key === '01' || key === '02' || key === '12') return key;
  throw new Error(`Unsupported spatial projection ${axisH}/${axisV}`);
}

function cell(value: number, size: number): number {
  return Math.floor(value / size);
}

export class MapSpatialIndex {
  readonly entries: MapSpatialEntry[];
  private readonly cells = new Map<Projection, Map<string, MapSpatialEntry[]>>();
  private readonly broad = new Map<Projection, MapSpatialEntry[]>();

  constructor(editor: Editor, readonly cellSize = 256) {
    const entries: MapSpatialEntry[] = [];
    for (const { entity, brush } of editor.allBrushes()) {
      entries.push({ kind: 'brush', entity, brush, mins: brush.mins, maxs: brush.maxs });
    }
    for (const { entity, patch } of editor.allPatches()) {
      entries.push({ kind: 'patch', entity, patch, mins: patch.mins, maxs: patch.maxs });
    }
    for (const entity of editor.nonWorldspawnEntities()) {
      const bounds = editor.entityBounds(entity);
      if (bounds) entries.push({ kind: 'entity', entity, ...bounds });
    }
    this.entries = entries;
    for (const [key, axes] of [['01', [0, 1]], ['02', [0, 2]], ['12', [1, 2]]] as const) {
      const grid = new Map<string, MapSpatialEntry[]>();
      const broad: MapSpatialEntry[] = [];
      for (const entry of entries) {
        const minA = cell(entry.mins[axes[0]], cellSize);
        const maxA = cell(entry.maxs[axes[0]], cellSize);
        const minB = cell(entry.mins[axes[1]], cellSize);
        const maxB = cell(entry.maxs[axes[1]], cellSize);
        if ((maxA - minA + 1) * (maxB - minB + 1) > 256) {
          broad.push(entry);
          continue;
        }
        for (let a = minA; a <= maxA; a++) for (let b = minB; b <= maxB; b++) {
          const id = `${a}:${b}`;
          const bucket = grid.get(id) ?? [];
          bucket.push(entry); grid.set(id, bucket);
        }
      }
      this.cells.set(key, grid);
      this.broad.set(key, broad);
    }
  }

  queryPoint2D(axisH: number, axisV: number, x: number, y: number, radius = 0): MapSpatialEntry[] {
    return this.queryBounds2D(axisH, axisV, x - radius, y - radius, x + radius, y + radius);
  }

  queryBounds2D(
    axisH: number,
    axisV: number,
    minH: number,
    minV: number,
    maxH: number,
    maxV: number,
  ): MapSpatialEntry[] {
    const key = projection(axisH, axisV);
    const grid = this.cells.get(key)!;
    const axes = key.split('').map(Number);
    const candidates = new Set<MapSpatialEntry>(this.broad.get(key));
    for (let a = cell(minH, this.cellSize); a <= cell(maxH, this.cellSize); a++) {
      for (let b = cell(minV, this.cellSize); b <= cell(maxV, this.cellSize); b++) {
        for (const entry of grid.get(`${a}:${b}`) ?? []) candidates.add(entry);
      }
    }
    return [...candidates].filter(entry =>
      entry.maxs[axisH] >= minH && entry.mins[axisH] <= maxH &&
      entry.maxs[axisV] >= minV && entry.mins[axisV] <= maxV);
  }

  estimatedBytes(): number {
    let references = 0;
    for (const grid of this.cells.values()) for (const bucket of grid.values()) references += bucket.length;
    for (const broad of this.broad.values()) references += broad.length;
    return this.entries.length * 96 + references * 8;
  }
}
