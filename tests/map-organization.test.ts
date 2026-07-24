import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import {
  applyObjectFilter,
  collectFilterObjects,
  MapOrganizationController,
  readOrganization,
} from '../src/map-organization';
import { isObjectInHiddenGroup } from '../src/named-groups';

function controller(editor: Editor) {
  return new MapOrganizationController(
    editor,
    () => ({
      camera3d: { position: [1, 2, 3], yaw: 0.5, pitch: -0.2 },
      views2d: {
        xy: { centerX: 1, centerY: 2, zoom: 3 },
        xz: { centerX: 4, centerY: 5, zoom: 6 },
        yz: { centerX: 7, centerY: 8, zoom: 9 },
      },
    }),
    () => {},
  );
}

describe('large-map organization', () => {
  it('round-trips selection sets, visibility presets, filters, and bookmarks in editor metadata', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/metal');
    editor.worldspawn.brushes.push(brush);
    editor.selection = [{ type: 'face', entity: editor.worldspawn, brush, face: brush.faces[0] }];
    const organization = controller(editor);
    organization.saveSelectionSet('Wall face');
    editor.hiddenBrushes.add(brush);
    organization.saveVisibilityPreset('Hidden details');
    organization.saveFilterPreset('Metal', {
      ...organization.newFilter(), texture: 'metal', kinds: ['face'],
    });
    organization.saveBookmark('Overview');

    const data = readOrganization(editor);
    expect(data.selectionSets[0]).toMatchObject({ name: 'Wall face', refs: ['E0:B0:F0'] });
    expect(data.visibilityPresets[0].hiddenRefs).toEqual(['E0:B0']);
    expect(data.filterPresets[0].filter.texture).toBe('metal');
    expect(data.bookmarks[0].navigation.views2d.yz.zoom).toBe(9);

    editor.selection = [];
    organization.restoreSelectionSet(data.selectionSets[0]);
    expect(editor.selection[0]?.type).toBe('face');
  });

  it('filters objects with AND/OR semantics and aggregate object kinds', () => {
    const editor = new Editor();
    editor.worldspawn.brushes.push(
      createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/metal'),
      createBoxBrush([128, 0, 0], [192, 64, 64], 'base_floor/stone'),
    );
    const objects = collectFilterObjects(editor);
    const organization = controller(editor);
    expect(applyObjectFilter(objects, {
      ...organization.newFilter(), texture: 'metal', kinds: ['face'], combine: 'and',
    })).toHaveLength(6);
    expect(applyObjectFilter(objects, {
      ...organization.newFilter(), texture: 'metal', classname: 'no-match', kinds: ['face'], combine: 'or',
    })).toHaveLength(6);
  });

  it('supports nested group visibility without changing entity ownership', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    editor.worldspawn.brushes.push(brush);
    editor.selection = [{ type: 'brush', entity: editor.worldspawn, brush }];
    const child = editor.createNamedGroup('Child')!;
    editor.selection = [];
    const parent = editor.createNamedGroup('Parent')!;
    editor.setNamedGroupParent(child.id, parent.id);
    editor.setNamedGroupHidden(parent.id, true);
    expect(brush.editorGroupId).toBe(child.id);
    expect(isObjectInHiddenGroup(editor, brush, editor.worldspawn)).toBe(true);
    expect(editor.worldspawn.brushes).toContain(brush);
  });
});
