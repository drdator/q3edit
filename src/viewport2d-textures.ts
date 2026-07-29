import type { Editor } from './editor';

export interface AffineTransform2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export type Point2D = readonly [number, number];

interface TextureImageEntry {
  image: HTMLImageElement | null;
  ready: boolean;
}

const textureImages = new WeakMap<object, Map<string, TextureImageEntry>>();

export function affineTransformFromTriangles(
  source: readonly [Point2D, Point2D, Point2D],
  destination: readonly [Point2D, Point2D, Point2D],
): AffineTransform2D | null {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const su1 = s1[0] - s0[0];
  const sv1 = s1[1] - s0[1];
  const su2 = s2[0] - s0[0];
  const sv2 = s2[1] - s0[1];
  const determinant = su1 * sv2 - su2 * sv1;
  if (Math.abs(determinant) < 1e-9) return null;

  const dx1 = d1[0] - d0[0];
  const dy1 = d1[1] - d0[1];
  const dx2 = d2[0] - d0[0];
  const dy2 = d2[1] - d0[1];
  const inverse = 1 / determinant;
  const a = (dx1 * sv2 - dx2 * sv1) * inverse;
  const c = (dx2 * su1 - dx1 * su2) * inverse;
  const b = (dy1 * sv2 - dy2 * sv1) * inverse;
  const d = (dy2 * su1 - dy1 * su2) * inverse;
  return {
    a,
    b,
    c,
    d,
    e: d0[0] - a * s0[0] - c * s0[1],
    f: d0[1] - b * s0[0] - d * s0[1],
  };
}

export function viewport2DTextureImage(editor: Editor, texture: string): HTMLImageElement | null {
  const manager = editor.textureManager;
  if (!manager || typeof Image === 'undefined') return null;
  let cache = textureImages.get(manager);
  if (!cache) {
    cache = new Map();
    textureImages.set(manager, cache);
  }

  const key = texture.toLowerCase().replace(/\\/g, '/');
  const existing = cache.get(key);
  if (existing) return existing.ready ? existing.image : null;

  const url = manager.getThumbnailUrl(texture);
  if (!url) {
    cache.set(key, { image: null, ready: false });
    return null;
  }

  const entry: TextureImageEntry = { image: null, ready: false };
  cache.set(key, entry);
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    entry.image = image;
    entry.ready = true;
    editor.redrawRequested = true;
  };
  image.onerror = () => {
    entry.image = null;
    entry.ready = false;
  };
  image.src = url;
  return null;
}
