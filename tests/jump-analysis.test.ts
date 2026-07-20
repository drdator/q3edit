import { describe, expect, test } from 'vitest';
import { analyzeJumpPad } from '../bridge/jump-analysis';
import { createBoxBrush } from '../src/brush';
import { createEntity, createWorldspawn } from '../src/entity';
import { serializeMap } from '../src/mapfile';

function jumpMap(obstacle = false): string {
  const world = createWorldspawn();
  world.brushes.push(
    createBoxBrush([-64, -64, -16], [64, 64, 0], 'base_floor/stone'),
    createBoxBrush([224, -64, -32], [288, 64, -16], 'base_floor/stone'),
  );
  if (obstacle) world.brushes.push(createBoxBrush([110, -32, 0], [130, 32, 160], 'base_wall/metal'));
  const trigger = createEntity('trigger_push');
  trigger.properties.target = 'jump_apex';
  trigger.brushes.push(createBoxBrush([-32, -32, 0], [32, 32, 16], 'common/trigger'));
  const target = createEntity('target_position', [128, 0, 136]);
  target.properties.targetname = 'jump_apex';
  return serializeMap([world, trigger, target]);
}

describe('jump pad analysis', () => {
  test('matches Quake III AimAtTarget and finds the descending landing platform', () => {
    const result = analyzeJumpPad(jumpMap(), { triggerRef: 'E1' });

    expect(result).toMatchObject({
      triggerRef: 'E1', targetRef: 'E2', gravity: 800,
      launchOrigin: [0, 0, 8], apex: [128, 0, 136],
      landing: { supported: true, brushRef: 'E0:B1' },
      clearance: { clear: true, collisions: [] },
      warnings: [],
    });
    expect(result.timeToApex).toBeCloseTo(Math.sqrt(128 / 400));
    expect(result.velocity).toEqual([
      expect.closeTo(226.274, 3), 0, expect.closeTo(452.548, 3),
    ]);
    expect((result.landing as { origin: number[] }).origin[0]).toBeCloseTo(256);
  });

  test('reports approximate player-hull obstructions', () => {
    const result = analyzeJumpPad(jumpMap(true), { triggerRef: 'E1' });

    expect(result).toMatchObject({
      clearance: { clear: false, collisions: [expect.objectContaining({ ref: 'E0:B2' })] },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('intersects 1 brush')]));
  });

  test('can analyze proposed bounds before a jump pad is created', () => {
    const result = analyzeJumpPad(jumpMap(), {
      mins: [-32, -32, 0], maxs: [32, 32, 16], apex: [128, 0, 136], gravity: 800,
    });
    expect(result).toMatchObject({ triggerRef: null, targetRef: null, nominalLandingOrigin: [256, 0, 8] });
  });
});
