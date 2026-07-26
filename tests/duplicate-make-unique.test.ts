import { describe, expect, it } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';

function entity(classname: string, properties: Record<string, string>) {
  const result = createEntity(classname, [0, 0, 0]);
  Object.assign(result.properties, properties);
  return result;
}

describe('duplicate and make unique', () => {
  it('remaps internal target chains while preserving external links', () => {
    const editor = new Editor();
    const trigger = entity('trigger_once', { target: 'relay' });
    const relay = entity('target_relay', { targetname: 'relay', target: 'external_door' });
    const externalDoor = entity('func_door', { targetname: 'external_door' });
    const collision = entity('target_relay', { targetname: 'relay_1' });
    editor.entities.push(trigger, relay, externalDoor, collision);
    editor.selection = [
      { type: 'entity', entity: trigger },
      { type: 'entity', entity: relay },
    ];

    editor.duplicateSelectionAndMakeUnique();

    const [triggerCopy, relayCopy] = editor.selection.map(item => item.entity);
    expect(triggerCopy.properties.target).toBe('relay_2');
    expect(relayCopy.properties.targetname).toBe('relay_2');
    expect(relayCopy.properties.target).toBe('external_door');
    expect(trigger.properties.target).toBe('relay');
    expect(relay.properties.targetname).toBe('relay');
    expect(editor.statusMessage).toContain('1 relationship name');
  });

  it('keeps intentionally shared targetnames shared within the duplicated selection', () => {
    const editor = new Editor();
    const first = entity('func_door', { targetname: 'paired_doors' });
    const second = entity('func_door', { targetname: 'paired_doors' });
    editor.entities.push(first, second);
    editor.selection = [
      { type: 'entity', entity: first },
      { type: 'entity', entity: second },
    ];

    editor.duplicateSelectionAndMakeUnique();

    const names = editor.selection.map(item => item.entity.properties.targetname);
    expect(names[0]).toBe(names[1]);
    expect(names[0]).not.toBe('paired_doors');
  });
});
