export interface PakManagerEntry {
  name: string;
  size: number;
  file?: File;
}

export interface PakManagerResult {
  entries: PakManagerEntry[];
  openArenaEnabled: boolean;
}

/** Mutable dialog model kept separate from the editor UI shell. */
export class PakManagerModel {
  readonly entries: PakManagerEntry[];
  openArenaEnabled: boolean;

  constructor(initialEntries: readonly PakManagerEntry[], openArenaEnabled: boolean) {
    this.entries = initialEntries.map(entry => ({ ...entry }));
    this.openArenaEnabled = openArenaEnabled;
  }

  move(index: number, offset: -1 | 1): void {
    const target = index + offset;
    if (index < 0 || index >= this.entries.length || target < 0 || target >= this.entries.length) return;
    [this.entries[index], this.entries[target]] = [this.entries[target], this.entries[index]];
  }

  remove(index: number): void {
    if (index >= 0 && index < this.entries.length) this.entries.splice(index, 1);
  }

  clear(): void {
    this.entries.splice(0, this.entries.length);
  }

  upsertFiles(files: readonly File[]): void {
    for (const file of files) {
      const index = this.entries.findIndex(entry => entry.name.toLowerCase() === file.name.toLowerCase());
      const next: PakManagerEntry = { name: file.name, size: file.size, file };
      if (index >= 0) this.entries[index] = next;
      else this.entries.push(next);
    }
  }

  sortByFilename(): Set<string> {
    const previousPositions = new Map(this.entries.map((entry, index) => [entry.name, index]));
    this.entries.sort((a, b) => a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    }));
    return new Set(this.entries
      .filter((entry, index) => previousPositions.get(entry.name) !== index)
      .map(entry => entry.name));
  }

  result(): PakManagerResult {
    return {
      entries: this.entries.map(entry => ({ ...entry })),
      openArenaEnabled: this.openArenaEnabled,
    };
  }
}
