import { Entity, cloneEntity } from './entity';

export type MapSnapshot = Entity[];

export interface HistoryEntry {
  entities: MapSnapshot;
  revision: number;
  label: string;
  auxiliary?: unknown;
  coalesceKey?: string;
  committedAt: number;
}

export interface HistoryResult {
  entities: MapSnapshot;
  revision: number;
  label: string;
  auxiliary?: unknown;
}

export interface HistoryRecordOptions {
  auxiliary?: unknown;
  coalesceKey?: string;
  coalesceWindowMs?: number;
}

export function cloneMapSnapshot(entities: Entity[]): MapSnapshot {
  return entities.map(cloneEntity);
}

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxSize = 100;

  record(
    entities: Entity[],
    revision: number,
    label: string,
    options: HistoryRecordOptions = {},
  ): void {
    const now = Date.now();
    const previous = this.undoStack[this.undoStack.length - 1];
    const coalesceWindowMs = options.coalesceWindowMs ?? 750;
    const canCoalesce = this.redoStack.length === 0 &&
      options.coalesceKey !== undefined &&
      previous?.coalesceKey === options.coalesceKey &&
      now - previous.committedAt <= coalesceWindowMs;

    if (canCoalesce) {
      previous.label = label;
      previous.committedAt = now;
      this.redoStack.length = 0;
      return;
    }

    this.undoStack.push({
      entities: cloneMapSnapshot(entities),
      revision,
      label,
      auxiliary: options.auxiliary === undefined ? undefined : structuredClone(options.auxiliary),
      coalesceKey: options.coalesceKey,
      committedAt: now,
    });
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  undo(currentEntities: Entity[], currentRevision: number, currentAuxiliary?: unknown): HistoryResult | null {
    if (this.undoStack.length === 0) return null;
    const entry = this.undoStack.pop()!;
    this.redoStack.push({
      entities: cloneMapSnapshot(currentEntities),
      revision: currentRevision,
      label: entry.label,
      auxiliary: entry.auxiliary === undefined || currentAuxiliary === undefined
        ? undefined
        : structuredClone(currentAuxiliary),
      committedAt: Date.now(),
    });
    return {
      entities: entry.entities,
      revision: entry.revision,
      label: entry.label,
      auxiliary: entry.auxiliary === undefined ? undefined : structuredClone(entry.auxiliary),
    };
  }

  redo(currentEntities: Entity[], currentRevision: number, currentAuxiliary?: unknown): HistoryResult | null {
    if (this.redoStack.length === 0) return null;
    const entry = this.redoStack.pop()!;
    this.undoStack.push({
      entities: cloneMapSnapshot(currentEntities),
      revision: currentRevision,
      label: entry.label,
      auxiliary: entry.auxiliary === undefined || currentAuxiliary === undefined
        ? undefined
        : structuredClone(currentAuxiliary),
      committedAt: Date.now(),
    });
    return {
      entities: entry.entities,
      revision: entry.revision,
      label: entry.label,
      auxiliary: entry.auxiliary === undefined ? undefined : structuredClone(entry.auxiliary),
    };
  }

  breakCoalescing(): void {
    const latest = this.undoStack[this.undoStack.length - 1];
    if (latest) latest.coalesceKey = undefined;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoCount(): number { return this.undoStack.length; }
  get redoCount(): number { return this.redoStack.length; }
  get undoLabel(): string | null { return this.undoStack[this.undoStack.length - 1]?.label ?? null; }
  get redoLabel(): string | null { return this.redoStack[this.redoStack.length - 1]?.label ?? null; }
}
