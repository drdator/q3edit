import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  editorThemeColors,
  refreshEditorThemeColors,
  themeRgba,
} from '../src/theme-colors';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('editor theme render colors', () => {
  it('reads CSS colors for canvas and WebGL rendering', () => {
    const values = new Map([
      ['--viewport-bg', '#abc'],
      ['--grid-major', 'rgba(10, 20, 30, 0.5)'],
      ['--grid-minor', 'rgba(40, 50, 60, 0.4)'],
      ['--grid-origin', '#123456'],
      ['--selection', '#ff00aa'],
    ]);
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => values.get(name) ?? '',
    }));

    refreshEditorThemeColors({} as Element);

    expect(editorThemeColors()).toMatchObject({
      viewport: '#abc',
      gridMajor: 'rgba(10, 20, 30, 0.5)',
      gridMinor: 'rgba(40, 50, 60, 0.4)',
      gridOrigin: '#123456',
      selection: '#ff00aa',
      viewportRgb: [170 / 255, 187 / 255, 204 / 255],
      gridMajorRgb: [
        10 / 255 * 0.5 + 170 / 255 * 0.5,
        20 / 255 * 0.5 + 187 / 255 * 0.5,
        30 / 255 * 0.5 + 204 / 255 * 0.5,
      ],
      selectionRgb: [1, 0, 170 / 255],
    });
  });

  it('formats cached RGB values for translucent canvas drawing', () => {
    expect(themeRgba([1, 0.5, 0], 0.15)).toBe('rgba(255, 128, 0, 0.15)');
  });
});
