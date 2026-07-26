import type { Brush, BrushFace } from './brush';
import type { Entity } from './entity';
import type { Patch } from './patch';

export const ENTITY_OBJECT_ID_KEY = '_q3edit_object_id';

let fallbackId = 0;

export function newEditorObjectId(kind: 'entity' | 'brush' | 'face' | 'patch'): string {
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(fallbackId++).toString(36)}`;
  return `${kind}-${unique}`;
}

export function entityObjectId(entity: Entity): string | undefined {
  return entity.properties[ENTITY_OBJECT_ID_KEY];
}

export function setEntityObjectId(entity: Entity, value: string): void {
  entity.properties[ENTITY_OBJECT_ID_KEY] = value;
}

type IdentifiedObject = Entity | Brush | BrushFace | Patch;

function existingId(object: IdentifiedObject): string | undefined {
  return 'classname' in object ? entityObjectId(object) : object.editorObjectId;
}

function replaceId(object: IdentifiedObject, kind: 'entity' | 'brush' | 'face' | 'patch'): void {
  const value = newEditorObjectId(kind);
  if ('classname' in object) setEntityObjectId(object, value);
  else object.editorObjectId = value;
}

/**
 * Cloning is used both for history snapshots and authoring duplicates. Preserve
 * IDs in snapshots, then make duplicate IDs unique at transaction commit.
 */
export function deduplicateEditorObjectIds(entities: Entity[]): void {
  const used = new Set<string>();
  const visit = (object: IdentifiedObject, kind: 'entity' | 'brush' | 'face' | 'patch') => {
    const value = existingId(object);
    if (!value) return;
    if (used.has(value)) replaceId(object, kind);
    else used.add(value);
  };
  for (const entity of entities) {
    visit(entity, 'entity');
    for (const brush of entity.brushes) {
      visit(brush, 'brush');
      for (const face of brush.faces) visit(face, 'face');
    }
    for (const patch of entity.patches) visit(patch, 'patch');
  }
}
