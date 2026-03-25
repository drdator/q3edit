import type { Brush } from './brush';
import type { Patch } from './patch';
import type { Editor } from './editor';

export const INVISIBLE_TEXTURES = new Set([
  'common/clip', 'common/weapclip', 'common/trigger',
  'common/hint', 'common/skip', 'common/nodraw',
  'common/areaportal', 'common/donotenter', 'common/caulk',
]);

export function isBrushVisible(editor: Editor, brush: Brush): boolean {
  if (editor.invisibleMode === 'hide' && brush.faces.length > 0 &&
      brush.faces.every(face => INVISIBLE_TEXTURES.has(face.texture.toLowerCase()))) {
    return false;
  }
  if (!editor.renderSelectedOnly || editor.selection.length === 0) return true;
  return editor.selection.some(item =>
    (item.type === 'brush' || item.type === 'face') && item.brush === brush
  );
}

export function isPatchVisible(editor: Editor, patch: Patch): boolean {
  if (!editor.renderSelectedOnly || editor.selection.length === 0) return true;
  return editor.selection.some(item => item.type === 'patch' && item.patch === patch);
}
