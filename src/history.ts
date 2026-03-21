import { Entity, cloneEntity } from './entity';

export type MapSnapshot = Entity[];

export class History {
  private undoStack: MapSnapshot[] = [];
  private redoStack: MapSnapshot[] = [];
  private maxSize = 100;

  snapshot(entities: Entity[]): void {
    this.undoStack.push(entities.map(cloneEntity));
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  undo(currentEntities: Entity[]): Entity[] | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(currentEntities.map(cloneEntity));
    return this.undoStack.pop()!;
  }

  redo(currentEntities: Entity[]): Entity[] | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(currentEntities.map(cloneEntity));
    return this.redoStack.pop()!;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoCount(): number { return this.undoStack.length; }
  get redoCount(): number { return this.redoStack.length; }
}
