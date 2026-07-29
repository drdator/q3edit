import { describe, expect, it } from 'vitest';
import type { Editor } from '../src/editor';
import { updateViewport3DCamera } from '../src/viewport3d-navigation';
import { getRay3D } from '../src/viewport3d-picking';
import {
  ISOMETRIC_PITCH,
  isometricCameraAngles,
  orthographicScaleForPerspectiveDistance,
  perspectiveDistanceForOrthographicScale,
  viewport3DCameraBasis,
  viewport3DProjectionMatrix,
} from '../src/viewport3d-projection';

describe('3D viewport projection', () => {
  it('uses equal world-axis foreshortening for isometric presets', () => {
    const northeast = isometricCameraAngles('northeast');
    const basis = viewport3DCameraBasis(northeast.yaw, northeast.pitch);

    expect(northeast.pitch).toBeCloseTo(ISOMETRIC_PITCH);
    expect(basis.forward[0]).toBeCloseTo(-1 / Math.sqrt(3));
    expect(basis.forward[1]).toBeCloseTo(-1 / Math.sqrt(3));
    expect(basis.forward[2]).toBeCloseTo(-1 / Math.sqrt(3));
    expect(isometricCameraAngles('southwest').yaw).toBeCloseTo(Math.PI * 0.25);
  });

  it('preserves apparent framing when converting between projection modes', () => {
    const fov = Math.PI / 3;
    const distance = 640;
    const scale = orthographicScaleForPerspectiveDistance(distance, fov);

    expect(scale).toBeCloseTo(distance * Math.tan(fov / 2));
    expect(perspectiveDistanceForOrthographicScale(scale, fov)).toBeCloseTo(distance);

    const perspective = viewport3DProjectionMatrix('perspective', 2, fov, scale);
    const orthographic = viewport3DProjectionMatrix('orthographic', 2, fov, scale);
    expect(perspective[11]).toBe(-1);
    expect(orthographic[11]).toBe(0);
    expect(orthographic[5]).toBeCloseTo(1 / scale);
  });

  it('creates parallel, screen-offset picking rays in orthographic mode', () => {
    const canvas = {
      getBoundingClientRect: () => ({
        left: 0, top: 0, width: 200, height: 100,
      }),
    } as HTMLCanvasElement;
    const context = {
      canvas,
      editor: {} as Editor,
      position: [10, 20, 30] as [number, number, number],
      projection: 'orthographic' as const,
      orthographicScale: 100,
      fov: Math.PI / 3,
      getForward: () => [1, 0, 0] as [number, number, number],
    };

    const center = getRay3D(context, 100, 50);
    const topRight = getRay3D(context, 200, 0);

    expect(center).toEqual({ rayOrigin: [10, 20, 30], rayDir: [1, 0, 0] });
    expect(topRight.rayDir).toEqual(center.rayDir);
    expect(topRight.rayOrigin).toEqual([10, -180, 130]);
  });

  it('moves through the screen plane instead of invisible depth with WASD', () => {
    const result = updateViewport3DCamera({
      editor: {} as Editor,
      fullscreen: false,
      fullscreenMode: 'edit',
      looking: true,
      keys: new Set(['w', 'd']),
      moveSpeed: 100,
      projection: 'orthographic',
      position: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      walkState: null,
      physicsAccum: 0,
      walkStepSmooth: 0,
      walkViewH: 0,
      walkLandChange: 0,
      walkLandTime: 0,
      walkBobCycle: 0,
    }, 1);

    expect(result.position[0]).toBeCloseTo(0);
    expect(result.position[1]).toBeCloseTo(-100);
    expect(result.position[2]).toBeCloseTo(100);
  });
});
