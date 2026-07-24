import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import {
  analyzeEntityRelationships,
  entityRelationshipOverlayLines,
} from '../src/entity-relationship-analysis';
import { createEntity } from '../src/entity';

describe('entity relationship analysis', () => {
  it('builds a searchable graph and diagnoses missing, ambiguous, and cyclic relationships', () => {
    const editor = new Editor();
    const trigger = createEntity('trigger_once'); trigger.properties.target = 'relay';
    const first = createEntity('target_relay', [0, 0, 32]);
    first.properties.targetname = 'relay'; first.properties.target = 'second';
    const duplicate = createEntity('target_relay', [64, 0, 32]);
    duplicate.properties.targetname = 'relay'; duplicate.properties.target = 'second';
    const second = createEntity('target_relay', [128, 0, 32]);
    second.properties.targetname = 'second'; second.properties.target = 'relay';
    const broken = createEntity('trigger_multiple'); broken.properties.target = 'absent';
    editor.entities.push(trigger, first, duplicate, second, broken);

    const result = analyzeEntityRelationships(editor);
    expect(result.edges.length).toBe(6);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'duplicate-targetname', 'ambiguous-target', 'missing-target', 'cycle',
    ]));
    expect(result.issues.find(issue => issue.code === 'cycle')?.severity).toBe('warning');
  });

  it('recognizes intentional train cycles and simulates delay and one-shot chains', () => {
    const editor = new Editor();
    const root = createEntity('trigger_once'); root.properties.target = 'delay';
    const delay = createEntity('target_delay'); delay.properties.targetname = 'delay';
    delay.properties.target = 'speaker'; delay.properties.wait = '2'; delay.properties.random = '0.5';
    const speaker = createEntity('target_speaker'); speaker.properties.targetname = 'speaker';
    const a = createEntity('path_corner', [0, 0, 0]); a.properties.targetname = 'a'; a.properties.target = 'b';
    const b = createEntity('path_corner', [128, 0, 0]); b.properties.targetname = 'b'; b.properties.target = 'a';
    editor.entities.push(root, delay, speaker, a, b);

    const result = analyzeEntityRelationships(editor);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'intentional-cycle', severity: 'info' }));
    expect(result.simulations[0].steps).toContainEqual(expect.objectContaining({
      classname: 'target_delay', earliestSeconds: 1.5, latestSeconds: 2.5,
    }));
    expect(result.simulations[0].steps[0].oneShot).toBe(true);
  });

  it('previews movers, validates teleporter clearance, links runtime errors, and produces overlays', () => {
    const editor = new Editor();
    const door = createEntity('func_door');
    door.brushes.push(createBoxBrush([0, 0, 0], [64, 16, 96], 'base_wall/metal'));
    door.properties.angle = '0'; door.properties.lip = '8';
    const trigger = createEntity('trigger_teleport');
    trigger.brushes.push(createBoxBrush([128, 0, 0], [192, 64, 64], 'common/trigger'));
    trigger.properties.target = 'exit';
    const destination = createEntity('misc_teleporter_dest', [300, 0, 24]); destination.properties.targetname = 'exit';
    editor.worldspawn.brushes.push(createBoxBrush([290, -16, 0], [310, 16, 80], 'base_wall/metal'));
    editor.entities.push(door, trigger, destination);
    editor.runtimeEntityMessages = ['ERROR target exit is blocked'];

    const result = analyzeEntityRelationships(editor);
    expect(result.movements[0]).toMatchObject({ classname: 'func_door', note: '56 unit door travel' });
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['teleporter-clearance', 'runtime-error']));
    expect(entityRelationshipOverlayLines(result, {
      links: true, triggers: true, movement: true, jumps: false,
    }).length).toBeGreaterThan(20);
  });
});
