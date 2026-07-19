import type { Brush } from './brush';
import type { Entity } from './entity';
import type { Editor, SelectionItem } from './editor';
import type { Patch } from './patch';
import { CONTENTS_DETAIL, CONTENTS_STRUCTURAL } from './map-flags';

function selectedEntitySet(editor: Editor): Set<Entity> {
  return new Set(
    editor.selection
      .filter((item): item is Extract<SelectionItem, { type: 'entity' }> => item.type === 'entity')
      .map(item => item.entity)
  );
}

function collectSelectedGeometry(editor: Editor): { brushes: Brush[]; patches: Patch[] } {
  const selectedEntities = selectedEntitySet(editor);
  const brushes = new Set<Brush>();
  const patches = new Set<Patch>();

  for (const item of editor.selection) {
    if (item.type === 'entity') {
      for (const brush of item.entity.brushes) brushes.add(brush);
      for (const patch of item.entity.patches) patches.add(patch);
      continue;
    }

    if (selectedEntities.has(item.entity)) continue;

    if (item.type === 'brush' || item.type === 'face') {
      brushes.add(item.brush);
    } else if (item.type === 'patch') {
      patches.add(item.patch);
    }
  }

  return {
    brushes: [...brushes],
    patches: [...patches],
  };
}

export function brushDetailState(brush: Brush): boolean | null {
  let hasDetail = false;
  let hasStructural = false;

  for (const face of brush.faces) {
    if ((face.contentFlags & CONTENTS_DETAIL) !== 0) hasDetail = true;
    else hasStructural = true;
  }

  if (hasDetail && hasStructural) return null;
  return hasDetail;
}

export function patchDetailState(patch: Patch): boolean {
  return (patch.contentFlags & CONTENTS_DETAIL) !== 0;
}

export function makeDetail(editor: Editor): void {
  const { brushes, patches } = collectSelectedGeometry(editor);
  const total = brushes.length + patches.length;
  if (total === 0) {
    editor.statusMessage = 'No brush or patch selection';
    return;
  }

  editor.transact('Make detail', () => {
    for (const brush of brushes) {
      for (const face of brush.faces) {
        face.contentFlags = (face.contentFlags | CONTENTS_DETAIL) & ~CONTENTS_STRUCTURAL;
      }
    }

    for (const patch of patches) {
      patch.contentFlags = (patch.contentFlags | CONTENTS_DETAIL) & ~CONTENTS_STRUCTURAL;
    }

    editor.redrawRequested = true;
    editor.statusMessage = `Marked ${total} item${total === 1 ? '' : 's'} detail`;
  });
}

export function makeStructural(editor: Editor): void {
  const { brushes, patches } = collectSelectedGeometry(editor);
  const total = brushes.length + patches.length;
  if (total === 0) {
    editor.statusMessage = 'No brush or patch selection';
    return;
  }

  editor.transact('Make structural', () => {
    for (const brush of brushes) {
      for (const face of brush.faces) {
        face.contentFlags &= ~(CONTENTS_DETAIL | CONTENTS_STRUCTURAL);
      }
    }

    for (const patch of patches) {
      patch.contentFlags &= ~(CONTENTS_DETAIL | CONTENTS_STRUCTURAL);
    }

    editor.redrawRequested = true;
    editor.statusMessage = `Marked ${total} item${total === 1 ? '' : 's'} structural`;
  });
}
