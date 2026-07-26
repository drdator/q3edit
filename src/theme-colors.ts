export interface EditorThemeRenderColors {
  viewport: string;
  gridMajor: string;
  gridMinor: string;
  gridOrigin: string;
  selection: string;
  viewportRgb: [number, number, number];
  gridMajorRgb: [number, number, number];
  selectionRgb: [number, number, number];
}

const FALLBACK_COLORS: EditorThemeRenderColors = {
  viewport: '#1e1e1e',
  gridMajor: 'rgba(100, 100, 100, 0.8)',
  gridMinor: 'rgba(60, 60, 60, 0.5)',
  gridOrigin: 'rgba(0, 120, 215, 0.6)',
  selection: '#ff6600',
  viewportRgb: [30 / 255, 30 / 255, 30 / 255],
  gridMajorRgb: [100 / 255, 100 / 255, 100 / 255],
  selectionRgb: [1, 102 / 255, 0],
};

let current = FALLBACK_COLORS;

function cssRgba(
  value: string,
  fallback: [number, number, number],
): { rgb: [number, number, number]; alpha: number } {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (hex) {
    const expanded = hex[1].length === 3
      ? [...hex[1]].map(character => character + character).join('')
      : hex[1];
    return {
      rgb: [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16) / 255) as [number, number, number],
      alpha: 1,
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i.exec(value);
  return rgb
    ? {
        rgb: [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255],
        alpha: rgb[4] === undefined ? 1 : Number(rgb[4]),
      }
    : { rgb: fallback, alpha: 1 };
}

function cssRgb(value: string, fallback: [number, number, number]): [number, number, number] {
  return cssRgba(value, fallback).rgb;
}

function cssRgbOver(
  value: string,
  background: [number, number, number],
  fallback: [number, number, number],
): [number, number, number] {
  const parsed = cssRgba(value, fallback);
  return parsed.rgb.map((component, index) =>
    component * parsed.alpha + background[index] * (1 - parsed.alpha)) as [number, number, number];
}

export function refreshEditorThemeColors(root: Element = document.documentElement): void {
  const styles = getComputedStyle(root);
  const value = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  const viewport = value('--viewport-bg', FALLBACK_COLORS.viewport);
  const gridMajor = value('--grid-major', FALLBACK_COLORS.gridMajor);
  const gridMinor = value('--grid-minor', FALLBACK_COLORS.gridMinor);
  const gridOrigin = value('--grid-origin', FALLBACK_COLORS.gridOrigin);
  const selection = value('--selection', FALLBACK_COLORS.selection);
  const viewportRgb = cssRgb(viewport, FALLBACK_COLORS.viewportRgb);
  current = {
    viewport,
    gridMajor,
    gridMinor,
    gridOrigin,
    selection,
    viewportRgb,
    gridMajorRgb: cssRgbOver(gridMajor, viewportRgb, FALLBACK_COLORS.gridMajorRgb),
    selectionRgb: cssRgb(selection, FALLBACK_COLORS.selectionRgb),
  };
}

export function editorThemeColors(): EditorThemeRenderColors {
  return current;
}

export function themeRgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb.map(value => Math.round(value * 255)).join(', ')}, ${alpha})`;
}
