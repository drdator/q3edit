export const DYNAMIC_LIGHT_AMBIENT = 0.05;
export const DYNAMIC_LIGHT_RADIUS_SCALE = 1.5;
export const DYNAMIC_LIGHT_LIMIT = 16;

export interface DynamicLightInfluence<T> {
  value: T;
  origin: readonly [number, number, number];
  radius: number;
}

export function effectiveDynamicLightRadius(intensity: number): number {
  return Math.max(1, intensity) * DYNAMIC_LIGHT_RADIUS_SCALE;
}

/**
 * Keep the shader's bounded light list relevant to the current view. The
 * normalized distance mirrors the shader attenuation, so a broad light can
 * outrank a physically closer light whose influence does not reach the view.
 */
export function selectDynamicLightInfluences<T>(
  lights: readonly DynamicLightInfluence<T>[],
  viewPosition: readonly [number, number, number],
  limit = DYNAMIC_LIGHT_LIMIT,
): DynamicLightInfluence<T>[] {
  return [...lights]
    .sort((a, b) => normalizedDistance(a, viewPosition) - normalizedDistance(b, viewPosition))
    .slice(0, Math.max(0, limit));
}

function normalizedDistance<T>(
  light: DynamicLightInfluence<T>,
  viewPosition: readonly [number, number, number],
): number {
  const dx = light.origin[0] - viewPosition[0];
  const dy = light.origin[1] - viewPosition[1];
  const dz = light.origin[2] - viewPosition[2];
  return Math.hypot(dx, dy, dz) / Math.max(light.radius, 1);
}
