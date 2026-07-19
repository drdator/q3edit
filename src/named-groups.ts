import type { Brush } from './brush';
import { createEntity, type Entity } from './entity';
import type { Editor, SelectionItem } from './editor';
import type { Patch } from './patch';

export const GROUP_INFO_CLASSNAME = 'group_info';
export const GROUP_ID_KEY = '_q3edit_group_id';
export const GROUP_NAME_KEY = 'group';
export const GROUP_HIDDEN_KEY = '_q3edit_hidden';
export const GROUP_LOCKED_KEY = '_q3edit_locked';
export const Q3RADIANT_NAMED_GROUP_SERIALIZATION =
  'Q3Radiant group_info/group epairs with q3edit-group comment fallback for classic brushes and terrain' as const;

export interface NamedGroup {
  id: string;
  name: string;
  hidden: boolean;
  locked: boolean;
  entity: Entity;
}

const VALID_GROUP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isGroupInfoEntity(entity: Entity): boolean {
  return entity.classname === GROUP_INFO_CLASSNAME;
}

function parseBoolean(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function listNamedGroups(entities: Entity[]): NamedGroup[] {
  return entities.filter(isGroupInfoEntity).map(entity => ({
    id: entity.properties[GROUP_ID_KEY] ?? '',
    name: entity.properties[GROUP_NAME_KEY]?.trim() || 'Unnamed Group',
    hidden: parseBoolean(entity.properties[GROUP_HIDDEN_KEY]),
    locked: parseBoolean(entity.properties[GROUP_LOCKED_KEY]),
    entity,
  }));
}

function nextGroupId(used: Set<string>): string {
  let index = 1;
  while (used.has(`group-${index}`)) index++;
  return `group-${index}`;
}

function objectGroupIds(entities: Entity[]): string[] {
  const ids: string[] = [];
  for (const entity of entities) {
    if (!isGroupInfoEntity(entity) && entity.properties[GROUP_ID_KEY]) ids.push(entity.properties[GROUP_ID_KEY]);
    for (const brush of entity.brushes) if (brush.editorGroupId) ids.push(brush.editorGroupId);
    for (const patch of entity.patches) if (patch.editorGroupId) ids.push(patch.editorGroupId);
  }
  return ids;
}

/** Repairs malformed IDs/collisions and retains unknown memberships as recovered groups. */
export function reconcileNamedGroups(entities: Entity[]): void {
  const used = new Set<string>();
  const byName = new Map<string, string>();
  for (const group of listNamedGroups(entities)) {
    let id = group.id;
    if (!VALID_GROUP_ID.test(id) || used.has(id)) id = nextGroupId(used);
    used.add(id);
    group.entity.properties.classname = GROUP_INFO_CLASSNAME;
    group.entity.classname = GROUP_INFO_CLASSNAME;
    group.entity.properties[GROUP_ID_KEY] = id;
    group.entity.properties[GROUP_NAME_KEY] = group.name;
    byName.set(group.name, id);
  }

  for (const entity of entities) {
    if (isGroupInfoEntity(entity)) continue;
    const legacyName = entity.properties[GROUP_NAME_KEY];
    if (!entity.properties[GROUP_ID_KEY] && legacyName && byName.has(legacyName)) {
      entity.properties[GROUP_ID_KEY] = byName.get(legacyName)!;
    }
    for (const brush of entity.brushes) {
      const legacyBrushName = brush.properties?.[GROUP_NAME_KEY];
      if (!brush.editorGroupId && legacyBrushName && byName.has(legacyBrushName)) {
        brush.editorGroupId = byName.get(legacyBrushName);
      }
    }
  }

  for (const unknownId of new Set(objectGroupIds(entities))) {
    if (!VALID_GROUP_ID.test(unknownId)) {
      for (const entity of entities) {
        if (!isGroupInfoEntity(entity) && entity.properties[GROUP_ID_KEY] === unknownId) delete entity.properties[GROUP_ID_KEY];
        for (const brush of entity.brushes) if (brush.editorGroupId === unknownId) brush.editorGroupId = undefined;
        for (const patch of entity.patches) if (patch.editorGroupId === unknownId) patch.editorGroupId = undefined;
      }
      continue;
    }
    if (used.has(unknownId)) continue;
    const recovered = createEntity(GROUP_INFO_CLASSNAME);
    recovered.properties[GROUP_ID_KEY] = unknownId;
    recovered.properties[GROUP_NAME_KEY] = `Recovered ${unknownId}`;
    entities.push(recovered);
    used.add(unknownId);
  }
}

export function groupNameMap(entities: Entity[]): Map<string, string> {
  return new Map(listNamedGroups(entities).map(group => [group.id, group.name]));
}

export function entityGroupId(entity: Entity): string | undefined {
  return isGroupInfoEntity(entity) ? undefined : entity.properties[GROUP_ID_KEY];
}

export function objectGroupId(object: Entity | Brush | Patch): string | undefined {
  return 'classname' in object ? entityGroupId(object) : object.editorGroupId;
}

export function namedGroupForId(entities: Entity[], id: string | undefined): NamedGroup | null {
  if (!id) return null;
  return listNamedGroups(entities).find(group => group.id === id) ?? null;
}

export function countNamedGroupMembers(entities: Entity[], id: string): number {
  let count = 0;
  for (const entity of entities) {
    if (isGroupInfoEntity(entity)) continue;
    if (entityGroupId(entity) === id) { count++; continue; }
    count += entity.brushes.filter(brush => brush.editorGroupId === id).length;
    count += entity.patches.filter(patch => patch.editorGroupId === id).length;
  }
  return count;
}

export function isObjectInHiddenGroup(editor: Editor, object: Entity | Brush | Patch, owner?: Entity): boolean {
  const own = namedGroupForId(editor.entities, objectGroupId(object));
  const inherited = owner && owner !== object ? namedGroupForId(editor.entities, entityGroupId(owner)) : null;
  return !!(own?.hidden || inherited?.hidden);
}

export function isObjectInLockedGroup(editor: Editor, object: Entity | Brush | Patch, owner?: Entity): boolean {
  const own = namedGroupForId(editor.entities, objectGroupId(object));
  const inherited = owner && owner !== object ? namedGroupForId(editor.entities, entityGroupId(owner)) : null;
  return !!(own?.locked || inherited?.locked);
}

function setItemGroup(item: SelectionItem, groupId: string | undefined): void {
  if (item.type === 'entity') {
    if (groupId) item.entity.properties[GROUP_ID_KEY] = groupId;
    else delete item.entity.properties[GROUP_ID_KEY];
  } else if (item.type === 'patch') {
    item.patch.editorGroupId = groupId;
  } else {
    item.brush.editorGroupId = groupId;
  }
}

export function createNamedGroup(editor: Editor, name: string): NamedGroup | null {
  const trimmed = name.trim();
  if (!trimmed) { editor.statusMessage = 'Group name cannot be empty'; return null; }
  if (listNamedGroups(editor.entities).some(group => group.name.toLowerCase() === trimmed.toLowerCase())) {
    editor.statusMessage = `A group named ${trimmed} already exists`;
    return null;
  }
  return editor.transact('Create named group', () => {
    const used = new Set(listNamedGroups(editor.entities).map(group => group.id));
    const entity = createEntity(GROUP_INFO_CLASSNAME);
    entity.properties[GROUP_ID_KEY] = nextGroupId(used);
    entity.properties[GROUP_NAME_KEY] = trimmed;
    editor.entities.push(entity);
    for (const item of editor.selection) setItemGroup(item, entity.properties[GROUP_ID_KEY]);
    editor.redrawRequested = true;
    editor.statusMessage = `Created group ${trimmed}`;
    return listNamedGroups([entity])[0];
  });
}

export function renameNamedGroup(editor: Editor, id: string, name: string): void {
  const group = namedGroupForId(editor.entities, id); const trimmed = name.trim();
  if (!group || !trimmed) return;
  if (listNamedGroups(editor.entities).some(other => other.id !== id && other.name.toLowerCase() === trimmed.toLowerCase())) {
    editor.statusMessage = `A group named ${trimmed} already exists`; return;
  }
  editor.transact('Rename named group', () => {
    group.entity.properties[GROUP_NAME_KEY] = trimmed;
    editor.redrawRequested = true; editor.statusMessage = `Renamed group to ${trimmed}`;
  });
}

export function deleteNamedGroup(editor: Editor, id: string): void {
  const group = namedGroupForId(editor.entities, id); if (!group) return;
  editor.transact('Delete named group', () => {
    for (const entity of editor.entities) {
      if (entity.properties[GROUP_ID_KEY] === id) delete entity.properties[GROUP_ID_KEY];
      for (const brush of entity.brushes) if (brush.editorGroupId === id) brush.editorGroupId = undefined;
      for (const patch of entity.patches) if (patch.editorGroupId === id) patch.editorGroupId = undefined;
    }
    editor.entities.splice(editor.entities.indexOf(group.entity), 1);
    editor.redrawRequested = true; editor.statusMessage = `Deleted group ${group.name}`;
  });
}

export function addSelectionToNamedGroup(editor: Editor, id: string): void {
  const group = namedGroupForId(editor.entities, id); if (!group || editor.selection.length === 0) return;
  editor.transact('Add selection to named group', () => {
    for (const item of editor.selection) setItemGroup(item, id);
    editor.redrawRequested = true; editor.statusMessage = `Added selection to ${group.name}`;
  });
}

export function removeSelectionFromNamedGroups(editor: Editor): void {
  if (editor.selection.length === 0) return;
  editor.transact('Remove selection from named groups', () => {
    for (const item of editor.selection) setItemGroup(item, undefined);
    editor.redrawRequested = true; editor.statusMessage = 'Removed selection from named groups';
  });
}

export function selectNamedGroup(editor: Editor, id: string): void {
  const selection: SelectionItem[] = [];
  for (const entity of editor.entities) {
    if (isGroupInfoEntity(entity)) continue;
    if (entityGroupId(entity) === id) { selection.push({ type: 'entity', entity }); continue; }
    for (const brush of entity.brushes) if (brush.editorGroupId === id) selection.push({ type: 'brush', entity, brush });
    for (const patch of entity.patches) if (patch.editorGroupId === id) selection.push({ type: 'patch', entity, patch });
  }
  editor.selection = selection;
  editor.redrawRequested = true;
  editor.statusMessage = `Selected ${selection.length} group item${selection.length === 1 ? '' : 's'}`;
}

export function setNamedGroupHidden(editor: Editor, id: string, hidden: boolean): void {
  const group = namedGroupForId(editor.entities, id); if (!group) return;
  editor.transact(hidden ? 'Hide named group' : 'Show named group', () => {
    if (hidden) group.entity.properties[GROUP_HIDDEN_KEY] = '1'; else delete group.entity.properties[GROUP_HIDDEN_KEY];
    if (hidden) editor.selection = editor.selection.filter(item => objectGroupId(item.type === 'entity' ? item.entity : item.type === 'patch' ? item.patch : item.brush) !== id);
    editor.redrawRequested = true; editor.statusMessage = `${hidden ? 'Hidden' : 'Shown'} group ${group.name}`;
  });
}

export function setNamedGroupLocked(editor: Editor, id: string, locked: boolean): void {
  const group = namedGroupForId(editor.entities, id); if (!group) return;
  editor.transact(locked ? 'Lock named group' : 'Unlock named group', () => {
    if (locked) group.entity.properties[GROUP_LOCKED_KEY] = '1'; else delete group.entity.properties[GROUP_LOCKED_KEY];
    if (locked) editor.selection = editor.selection.filter(item => objectGroupId(item.type === 'entity' ? item.entity : item.type === 'patch' ? item.patch : item.brush) !== id);
    editor.redrawRequested = true; editor.statusMessage = `${locked ? 'Locked' : 'Unlocked'} group ${group.name}`;
  });
}
