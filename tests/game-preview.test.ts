import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createQuickPlayPk3, quickPlayRuntimeMapName } from '../src/game-preview';

describe('Quick Play runtime map names', () => {
  it('uses BSP contents to avoid collisions with maps in enabled PK3 files', () => {
    const first = quickPlayRuntimeMapName('test-map', new Uint8Array([1, 2, 3]));
    const same = quickPlayRuntimeMapName('test-map', new Uint8Array([1, 2, 3]));
    const rebuilt = quickPlayRuntimeMapName('test-map', new Uint8Array([1, 2, 4]));

    expect(first).toBe(same);
    expect(first).toMatch(/^test-map_q3e_[0-9a-f]{8}$/);
    expect(rebuilt).not.toBe(first);
  });

  it('produces a valid Quake path component within MAX_QPATH', () => {
    const name = quickPlayRuntimeMapName('a very/long map name!'.repeat(8), new Uint8Array([9]));

    expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(`maps/${name}.bsp`.length).toBeLessThan(64);
  });

  it('packages the current BSP and AAS under the runtime name', () => {
    const bsp = new Uint8Array([1, 2, 3]);
    const aas = new Uint8Array([4, 5]);
    const files = unzipSync(createQuickPlayPk3('test-map_q3e_12345678', bsp, aas));

    expect(files['maps/test-map_q3e_12345678.bsp']).toEqual(bsp);
    expect(files['maps/test-map_q3e_12345678.aas']).toEqual(aas);
  });

});
