import { describe, expect, test } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { structureCompilerOutput } from '../src/compile-diagnostics';
import { createEntity } from '../src/entity';

describe('structured compiler diagnostics', () => {
  test('links missing shader images and positioned warnings to map references', () => {
    const world = createEntity('worldspawn');
    world.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64], 'custom/reactor_trim'));
    const light = createEntity('light', [32, 32, 96]);
    const diagnostics = structureCompilerOutput([
      "WARNING: Couldn't find image for shader custom/reactor_trim",
      'WARNING: light at (32 32 96) has missing target',
      'q3map exited with code 1',
    ], [world, light]);

    expect(diagnostics[0]).toMatchObject({
      severity: 'warning', code: 'missing-shader-image',
      refs: ['E0:B0:F0', 'E0:B0:F1', 'E0:B0:F2', 'E0:B0:F3', 'E0:B0:F4', 'E0:B0:F5'],
    });
    expect(diagnostics[1]).toMatchObject({ severity: 'warning', refs: ['E1'] });
    expect(diagnostics[2]).toMatchObject({ severity: 'error', code: 'compiler-error' });
  });
});
