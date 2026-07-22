import { strToU8, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AssetIndex } from '../src/asset-index';
import {
  EntityClassRegistry,
  loadEntityClassRegistry,
  parseEntDefinitions,
  parseQuakedDefinitions,
  setEntityClassRegistry,
} from '../src/entity-definitions';
import { Editor } from '../src/editor';
import type { Entity } from '../src/entity';
import { createBoxBrush } from '../src/brush';

const fixture = readFileSync(new URL('./fixtures/entities.def', import.meta.url), 'utf8');

function archive(name: string, files: Record<string, string>) {
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)])));
  return { name, data: new Uint8Array(zipped).buffer };
}

describe('entity definitions', () => {
  it('parses Q3Radiant QUAKED headers, bounds, docs, defaults, models, and flags', () => {
    const result = parseQuakedDefinitions(fixture, 'entities.def');
    expect(result.classes).toHaveLength(3);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.classes[0]).toMatchObject({
      classname: 'info_player_deathmatch',
      type: 'point',
      color: [1, 0, 1],
      bounds: { mins: [-16, -16, -24], maxs: [16, 16, 32] },
      defaults: { angle: '0' },
      spawnflags: [{ bit: 1, name: 'initial' }],
    });
    expect(result.classes[0].properties.angle.type).toBe('angle');
    expect(result.classes[0].properties.target.type).toBe('entity-reference');
    expect(result.classes[1].spawnflags.map(flag => flag.bit)).toEqual([1, 4, 8, 16]);
    expect(result.classes[2].model).toBe('models/mapobjects/tree.md3');
    expect(result.classes[2].properties._color.type).toBe('color');
  });

  it('parses Radiant XML ent types, choices, and flags while retaining valid classes', () => {
    const result = parseEntDefinitions(`<classes>
      <point name="light" color="0 1 0" box="-8 -8 -8 8 8 8" group="Lights">
        Dynamic light
        <integer key="light" name="Intensity" value="300">Brightness</integer>
        <color key="_color" name="Color" />
        <list key="style" name="Style"><item value="0" name="Normal"/><item value="1" name="Flicker"/></list>
        <flag key="1" name="START_OFF">Initially disabled</flag>
        <flag key="bad" name="BROKEN" />
      </point>
      <point color="1 1 1">missing name</point>
    </classes>`, 'entities.ent');
    expect(result.classes).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.classes[0].properties.light).toMatchObject({ type: 'number', default: '300' });
    expect(result.classes[0].properties.style.choices).toEqual([
      { value: '0', label: 'Normal' }, { value: '1', label: 'Flicker' },
    ]);
  });

  it('loads definitions in deterministic archive precedence order with fallbacks', () => {
    const index = new AssetIndex([
      archive('pak0.pk3', { 'scripts/base.def': '/*QUAKED light (0 1 0) (-8 -8 -8) (8 8 8)\nbase\n*/' }),
      archive('pak1.pk3', { 'scripts/override.def': '/*QUAKED light (1 0 0) (-4 -4 -4) (4 4 4)\noverride\n*/' }),
    ]);
    const registry = loadEntityClassRegistry(index);
    expect(registry.get('light')?.color).toEqual([1, 0, 0]);
    expect(registry.get('light')?.source).toEqual({ path: 'scripts/override.def', archiveName: 'pak1.pk3' });
    expect(registry.get('info_player_start')?.source?.archiveName).toBe('Q3Edit fallback');
    expect(registry.get('unknown')).toBeNull();
  });

  it('limits definitions to project-configured source paths', () => {
    const index = new AssetIndex([
      archive('pak0.pk3', {
        'scripts/base.def': '/*QUAKED base_only (0 1 0) ?\nbase\n*/',
        'scripts/mod.def': '/*QUAKED mod_only (1 0 0) ?\nmod\n*/',
      }),
    ]);
    const registry = loadEntityClassRegistry(index, ['pak0.pk3:scripts/mod.def']);
    expect(registry.get('mod_only')).not.toBeNull();
    expect(registry.get('base_only')).toBeNull();
  });

  it('replaces duplicate classes without deleting unrelated fallback classes', () => {
    const registry = new EntityClassRegistry();
    registry.loadSource('/*QUAKED custom (0 0 1) ?\nCustom class\n*/', 'custom.def', 'def');
    expect(registry.get('custom')).not.toBeNull();
    expect(registry.get('light')).not.toBeNull();
  });

  it('provides complete built-in world and gameplay-link schemas', () => {
    const registry = new EntityClassRegistry();
    expect(registry.get('worldspawn')).toMatchObject({
      type: 'brush',
      defaults: { gravity: '800' },
      properties: {
        message: { type: 'string' },
        music: { type: 'asset' },
        gravity: { type: 'number', default: '800' },
      },
    });
    expect(registry.get('trigger_push')).toMatchObject({
      properties: { target: { type: 'entity-reference' } },
      relationships: [{ key: 'target', direction: 'outgoing', required: true, targetClasses: ['target_position', 'info_notnull'] }],
    });
    expect(registry.get('target_position')).toMatchObject({
      properties: { targetname: { type: 'entity-reference' } },
      relationships: [{ key: 'targetname', direction: 'incoming' }],
    });
    expect(registry.get('trigger_teleport')).toMatchObject({
      properties: { target: { type: 'entity-reference' } },
      spawnflags: [{ bit: 1, name: 'SPECTATOR' }],
    });
    expect(registry.get('trigger_hurt')).toMatchObject({
      properties: { dmg: { type: 'number', default: '5', name: 'Damage' } },
      spawnflags: expect.arrayContaining([
        { bit: 1, name: 'START_OFF', description: expect.any(String) },
        { bit: 16, name: 'SLOW', description: expect.any(String) },
      ]),
    });
    expect(registry.get('func_door')).toMatchObject({
      properties: { speed: { default: '400' }, wait: { default: '2' }, lip: { default: '8' } },
    });
  });

  it('keeps built-in relationship properties when a source definition omits them', () => {
    const registry = new EntityClassRegistry();
    registry.loadSource('/*QUAKED trigger_push (.5 .5 .5) ?\nMust point at a target_position.\n*/', 'game.def', 'def');
    expect(registry.get('trigger_push')).toMatchObject({
      source: { path: 'game.def' },
      properties: { target: { type: 'entity-reference' } },
      relationships: [{ key: 'target', required: true }],
    });
  });

  it('applies defaults only when creating an entity', () => {
    const registry = new EntityClassRegistry([]);
    const definition = parseQuakedDefinitions(
      '/*QUAKED custom (1 1 1) (-8 -8 -8) (8 8 8)\ncount: amount (default: 3)\n*/',
    ).classes[0];
    registry.add(definition);
    setEntityClassRegistry(registry);
    const editor = new Editor();
    editor.createDefaultMap();
    const created = editor.addEntity('custom', [0, 0, 0]);
    expect(created.properties.count).toBe('3');
    const loaded: Entity = { classname: 'custom', properties: { classname: 'custom' }, brushes: [], patches: [] };
    editor.entities.push(loaded);
    expect(loaded.properties.count).toBeUndefined();

    const brushDefinition = parseQuakedDefinitions(
      '/*QUAKED custom_func (0 0 1) ?\nspeed: movement speed (default: 100)\n*/',
    ).classes[0];
    registry.add(brushDefinition);
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    editor.worldspawn.brushes.push(brush);
    editor.selectBrush(editor.worldspawn, brush);
    editor.groupSelectionIntoEntity('custom_func');
    expect(editor.entities[editor.entities.length - 1]?.properties.speed).toBe('100');
    setEntityClassRegistry(new EntityClassRegistry());
  });
});
