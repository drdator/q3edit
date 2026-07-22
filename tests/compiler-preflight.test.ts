import { describe, expect, test } from 'vitest';
import { inspectCompilerPreflight } from '../bridge/compiler-preflight';
import { createBoxBrush } from '../src/brush';
import { createEntity } from '../src/entity';
import { serializeMap } from '../src/mapfile';
import { GROUP_ID_KEY, GROUP_INFO_CLASSNAME, GROUP_NAME_KEY } from '../src/named-groups';

describe('compiler preflight', () => {
  test('reports exact editor-only constructs removed from compiler input', () => {
    const world = createEntity('worldspawn');
    world.properties._q3edit_style_brief = JSON.stringify({ notes: 'x'.repeat(10_000) });
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'common/caulk');
    brush.editorGroupId = 'architecture';
    world.brushes.push(brush);
    const group = createEntity(GROUP_INFO_CLASSNAME);
    group.properties[GROUP_ID_KEY] = 'architecture';
    group.properties[GROUP_NAME_KEY] = 'Architecture';

    const result = inspectCompilerPreflight(serializeMap([world, group]));
    expect(result).toMatchObject({ ready: true, compilerSafeExport: true });
    expect(result.source.maxLineLength).toBeGreaterThan(10_000);
    expect(result.compilerInput.maxLineLength).toBeLessThan(4096);
    expect(result.sanitizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'entity-metadata', ref: 'E0', keys: ['_q3edit_style_brief'] }),
      expect.objectContaining({ kind: 'group-membership', ref: 'E0:B0' }),
      expect.objectContaining({ kind: 'group-record', ref: 'E1' }),
    ]));
  });
});
