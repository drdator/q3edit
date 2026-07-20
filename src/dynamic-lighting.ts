export const DYNAMIC_LIGHT_AMBIENT = 0.05;
export const DYNAMIC_LIGHT_RADIUS_SCALE = 1.5;

export function effectiveDynamicLightRadius(intensity: number): number {
  return Math.max(1, intensity) * DYNAMIC_LIGHT_RADIUS_SCALE;
}
