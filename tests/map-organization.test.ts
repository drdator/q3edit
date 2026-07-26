import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
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
    expect(data.selectionSets[0].name).toBe('Wall face');
    expect(data.selectionSets[0].refs[0]).toMatch(/^OF:/);
    expect(data.visibilityPresets[0].hiddenRefs[0]).toMatch(/^OB:/);
    expect(data.filterPresets[0].filter.texture).toBe('metal');
    expect(data.bookmarks[0].navigation.views2d.yz.zoom).toBe(9);

    editor.selection = [];
    organization.restoreSelectionSet(data.selectionSets[0]);
    expect(editor.selection[0]?.type).toBe('face');
  });

  it('does not silently retarget persistent sets after object indices change', () => {
    const editor = new Editor();
    const saved = createBoxBrush([128, 0, 0], [192, 64, 64], 'base_wall/metal');
    editor.worldspawn.brushes.push(saved);
    editor.selection = [{ type: 'brush', entity: editor.worldspawn, brush: saved }];
    const organization = controller(editor);
    organization.saveSelectionSet('Saved brush');
    editor.worldspawn.brushes.unshift(createBoxBrush([0, 0, 0], [64, 64, 64], 'base_floor/stone'));
    editor.selection = [];

    organization.restoreSelectionSet(readOrganization(editor).selectionSets[0]);

    expect(editor.selection).toEqual([{ type: 'brush', entity: editor.worldspawn, brush: saved }]);
  });

  it('reports deleted selection-set members as stale instead of retargeting them', () => {
    const editor = new Editor();
    const saved = createBoxBrush([0, 0, 0], [64, 64, 64]);
    editor.worldspawn.brushes.push(saved);
    editor.selection = [{ type: 'brush', entity: editor.worldspawn, brush: saved }];
    const organization = controller(editor);
    organization.saveSelectionSet('Temporary brush');
    const set = readOrganization(editor).selectionSets[0];
    editor.worldspawn.brushes.splice(editor.worldspawn.brushes.indexOf(saved), 1);
    editor.worldspawn.brushes.push(createBoxBrush([128, 0, 0], [192, 64, 64]));

    organization.restoreSelectionSet(set);

    expect(editor.selection).toEqual([]);
    expect(editor.statusMessage).toContain('1 stale reference skipped');
  });

  it('keeps persistent selections attached after movement and same-class entity reordering', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const first = createEntity('light', [0, 0, 64]);
    const second = createEntity('light', [256, 0, 64]);
    editor.worldspawn.brushes.push(brush);
    editor.entities.push(first, second);
    const organization = controller(editor);

    editor.selection = [{ type: 'brush', entity: editor.worldspawn, brush }];
    organization.saveSelectionSet('Moving brush');
    editor.moveSelection([128, 0, 0]);
    editor.selection = [];
    organization.restoreSelectionSet(readOrganization(editor).selectionSets[0]);
    expect(editor.selection).toEqual([{ type: 'brush', entity: editor.worldspawn, brush }]);

    editor.duplicateSelection();
    const duplicate = editor.selection[0];
    expect(duplicate?.type === 'brush' ? duplicate.brush.editorObjectId : null)
      .not.toBe(brush.editorObjectId);
    editor.selection = [];
    organization.restoreSelectionSet(readOrganization(editor).selectionSets[0]);
    expect(editor.selection).toEqual([{ type: 'brush', entity: editor.worldspawn, brush }]);

    editor.selection = [{ type: 'entity', entity: second }];
    organization.saveSelectionSet('Second light');
    editor.entities.splice(1, 2, second, first);
    editor.selection = [];
    organization.restoreSelectionSet(readOrganization(editor).selectionSets[1]);
    expect(editor.selection).toEqual([{ type: 'entity', entity: second }]);
  });

  it('preserves persistent face references through map serialization', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    editor.worldspawn.brushes.push(brush);
    editor.selection = [{ type: 'face', entity: editor.worldspawn, brush, face: brush.faces[2] }];
    controller(editor).saveSelectionSet('Serialized face');

    const reopened = new Editor();
    reopened.loadMap(editor.serializeMap());
    const organization = controller(reopened);
    organization.restoreSelectionSet(readOrganization(reopened).selectionSets[0]);

    expect(reopened.selection).toEqual([{
      type: 'face',
      entity: reopened.worldspawn,
      brush: reopened.worldspawn.brushes[0],
      face: reopened.worldspawn.brushes[0].faces[2],
    }]);
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
    expect(collectFilterObjects(editor).find(item => item.kind === 'brush')?.visible).toBe(false);

    editor.setNamedGroupHidden(parent.id, false);
    editor.setNamedGroupLocked(parent.id, true);
    editor.selection = [];
    editor.selectNamedGroup(child.id);
    expect(editor.selection).toEqual([]);
    expect(editor.statusMessage).toContain('locked');
  });
});
