import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  resizedSidebarWidth,
} from '../src/sidebar-layout';

describe('sidebar layout', () => {
  it('normalizes invalid and out-of-range widths', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(40)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(900)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(284.6)).toBe(285);
  });

  it('grows when the divider moves left and shrinks when it moves right', () => {
    expect(resizedSidebarWidth(200, 1000, 900)).toBe(300);
    expect(resizedSidebarWidth(300, 900, 1000)).toBe(200);
  });
});
