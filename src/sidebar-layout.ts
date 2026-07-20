export const DEFAULT_SIDEBAR_WIDTH = 200;
export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 600;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

export function resizedSidebarWidth(startWidth: number, startX: number, currentX: number): number {
  return clampSidebarWidth(startWidth + startX - currentX);
}
