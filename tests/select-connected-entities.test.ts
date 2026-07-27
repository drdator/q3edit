import { describe, expect, it } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';

function linkedEntity(classname: string, properties: Record<string, string>) {
  const entity = createEntity(classname, [0, 0, 0]);
  Object.assign(entity.properties, properties);
  return entity;
}

describe('select connected entities', () => {
  it('selects one-hop incoming and outgoing target relationships', () => {
    const editor = new Editor();
    const trigger = linkedEntity('trigger_once', { target: 'relay' });
    const relay = linkedEntity('target_relay', { targetname: 'relay', target: 'door' });
    const door = linkedEntity('func_door', { targetname: 'door' });
    editor.entities.push(trigger, relay, door);
    editor.selection = [{ type: 'entity', entity: relay }];

    editor.selectConnectedEntities(false);

    expect(editor.selection.map(item => item.entity)).toEqual([trigger, relay, door]);
  });

  it('selects a complete transitive chain while excluding hidden or locked entities', () => {
    const editor = new Editor();
    const trigger = linkedEntity('trigger_once', { target: 'relay' });
    const relay = linkedEntity('target_relay', { targetname: 'relay', target: 'door' });
    const door = linkedEntity('func_door', { targetname: 'door', target: 'speaker' });
    const speaker = linkedEntity('target_speaker', { targetname: 'speaker' });
    const hidden = linkedEntity('target_speaker', { targetname: 'speaker' });
    editor.entities.push(trigger, relay, door, speaker, hidden);
    editor.hiddenEntities.add(hidden);
    editor.selection = [{ type: 'entity', entity: trigger }];

    editor.selectConnectedEntities(true);

    expect(editor.selection.map(item => item.entity)).toEqual([trigger, relay, door, speaker]);
    expect(editor.statusMessage).toContain('4 entities');
  });

  it('keeps the selection when every seed is locked', () => {
    const editor = new Editor();
    const trigger = linkedEntity('trigger_once', { target: 'relay' });
    const relay = linkedEntity('target_relay', { targetname: 'relay' });
    editor.entities.push(trigger, relay);
    editor.selection = [{ type: 'entity', entity: trigger }];
    const group = editor.createNamedGroup('Locked chain')!;
    editor.setNamedGroupLocked(group.id, true);
    editor.selection = [{ type: 'entity', entity: trigger }];

    editor.selectConnectedEntities(true);

    expect(editor.selection).toEqual([{ type: 'entity', entity: trigger }]);
    expect(editor.statusMessage).toContain('hidden or locked');
  });
});
