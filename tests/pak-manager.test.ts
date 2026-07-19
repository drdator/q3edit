import { describe, expect, it } from 'vitest';
import { PakManagerModel } from '../src/pak-manager';

describe('PakManagerModel', () => {
  it('reorders, sorts, removes, and snapshots archive configuration', () => {
    const model = new PakManagerModel([
      { name: 'pak10.pk3', size: 10 },
      { name: 'pak2.pk3', size: 2 },
    ], true);
    model.move(1, -1);
    expect(model.entries.map(entry => entry.name)).toEqual(['pak2.pk3', 'pak10.pk3']);
    model.move(0, -1);
    expect(model.entries.map(entry => entry.name)).toEqual(['pak2.pk3', 'pak10.pk3']);
    model.sortByFilename();
    expect(model.entries.map(entry => entry.name)).toEqual(['pak2.pk3', 'pak10.pk3']);
    model.remove(0);
    model.openArenaEnabled = false;
    expect(model.result()).toEqual({
      entries: [{ name: 'pak10.pk3', size: 10 }],
      openArenaEnabled: false,
    });
  });
});
