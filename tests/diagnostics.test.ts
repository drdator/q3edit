import { describe, expect, it, vi } from 'vitest';
import { createBoxBrush } from '../src/brush';
import {
  brushId,
  collectEditorDiagnostics,
  collectEntityInfo,
  collectMapInfo,
  documentObjectReferences,
  findDocumentObject,
  navigateToDiagnostic,
} from '../src/diagnostics';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { loadMap } from '../src/editor-document';

describe('map diagnostics', () => {
  it('treats intrinsic worldspawn as a documented map class', () => {
    const editor = new Editor();
    editor.entities = [createEntity('worldspawn')];
    expect(collectEditorDiagnostics(editor).map(item => item.code)).not.toContain('unknown-class');
  });

  it('counts map contents, classes, textures, terrain/groups, and unsupported constructs', () => {
    const editor = new Editor();
    editor.entities = [createEntity('worldspawn'), createEntity('light')];
    editor.entities[0].brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64], 'common/caulk'));
    editor.unsupportedMapConstructs = [{ keyword: 'patchDef3', line: 4, column: 2, rawSource: 'patchDef3 {}' }];
    const info = collectMapInfo(editor);
    expect(info).toMatchObject({ entities: 2, brushes: 1, patches: 0, terrain: 0, textures: 1, groups: 0, unsupportedConstructs: 1 });
    expect(info.entityClasses).toContainEqual({ classname: 'light', count: 1 });
  });

  it('derives compatibility-safe entity/brush addresses and accepts Radiant-style number input', () => {
    const editor = new Editor();
    editor.entities = [createEntity('worldspawn'), createEntity('func_door')];
    editor.entities[1].brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64]));
    expect(documentObjectReferences(editor).map(item => item.id)).toEqual(['E0', 'E1', 'E1:B0']);
    expect(brushId(1, 0)).toBe('E1:B0');
    expect(findDocumentObject(editor, '1 0')?.brush).toBe(editor.entities[1].brushes[0]);
    expect(findDocumentObject(editor, 'entity 1 brush 0')?.id).toBe('E1:B0');
    expect(findDocumentObject(editor, 'E99:B0')).toBeNull();
  });

  it('validates brushes, targets, duplicate targetnames, origins, textures, models, and unsupported saves', () => {
    const editor = new Editor();
    const world = createEntity('worldspawn');
    const invalid = createBoxBrush([0, 0, 0], [64, 64, 64], 'missing/wall');
    invalid.faces.length = 3;
    world.brushes.push(invalid);
    const first = createEntity('info_null'); first.properties.targetname = 'same'; first.properties.target = 'gone'; first.properties.origin = 'bad';
    const second = createEntity('info_null'); second.properties.targetname = 'same'; second.properties.model = 'models/missing.md3';
    editor.entities = [world, first, second];
    editor.textureManager = { hasTextureSource: () => false } as never;
    editor.modelManager = { resolveEntity: () => null } as never;
    editor.unsupportedMapConstructs = [{ keyword: 'customDef', line: 2, column: 1, rawSource: '' }];
    const codes = collectEditorDiagnostics(editor).map(item => item.code);
    expect(codes).toEqual(expect.arrayContaining([
      'invalid-brush', 'missing-texture', 'broken-target', 'duplicate-targetname', 'invalid-origin', 'missing-model', 'unsupported-construct',
    ]));
    expect(collectEntityInfo(editor)[1].diagnostics.map(item => item.code)).toContain('broken-target');
  });

  it('preserves unsupported parser records for dedicated reporting', () => {
    const editor = new Editor();
    loadMap(editor, '{\n"classname" "worldspawn"\n{\nbrushDef3\n{\nvalue\n}\n}\n}');
    expect(editor.unsupportedMapConstructs).toHaveLength(1);
    expect(collectMapInfo(editor).unsupportedConstructs).toBe(1);
  });

  it('navigates diagnostics without creating an undo entry', () => {
    const editor = new Editor();
    editor.entities = [createEntity('worldspawn')];
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    editor.entities[0].brushes.push(brush);
    const center = vi.fn(); editor.onCenterOnSelection(center);
    expect(navigateToDiagnostic(editor, { target: { kind: 'brush', entityIndex: 0, brushIndex: 0 } })).toBe(true);
    expect(editor.selection[0]).toMatchObject({ type: 'brush', brush });
    expect(center).toHaveBeenCalled();
    expect(editor.history.canUndo).toBe(false);
  });
});
