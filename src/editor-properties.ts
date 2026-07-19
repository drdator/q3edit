import type { BrushFace } from './brush';
import type { Editor } from './editor';
import type { Entity } from './entity';

export type FacePropertyChanges = Partial<Pick<BrushFace,
  | 'texture'
  | 'offsetX'
  | 'offsetY'
  | 'rotation'
  | 'scaleX'
  | 'scaleY'
  | 'contentFlags'
  | 'surfaceFlags'
  | 'value'
>>;

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

function objectId(value: object): number {
  let id = objectIds.get(value);
  if (id === undefined) {
    id = nextObjectId++;
    objectIds.set(value, id);
  }
  return id;
}

export function setEntityClassname(editor: Editor, entity: Entity, classname: string): boolean {
  const nextClassname = classname.trim();
  if (!nextClassname) return false;
  editor.transact('Change entity classname', () => {
    entity.classname = nextClassname;
    entity.properties.classname = nextClassname;
  });
  return true;
}

export function renameEntityProperty(
  editor: Editor,
  entity: Entity,
  currentKey: string,
  newKey: string,
): boolean {
  const nextKey = newKey.trim();
  if (!nextKey || nextKey === currentKey || nextKey in entity.properties) return false;
  if (!(currentKey in entity.properties)) return false;

  editor.transact('Rename entity property', () => {
    entity.properties[nextKey] = entity.properties[currentKey];
    delete entity.properties[currentKey];
  });
  return true;
}

export function setEntityProperty(editor: Editor, entity: Entity, key: string, value: string): void {
  editor.transact('Edit entity property', () => {
    entity.properties[key] = value;
  }, {
    coalesceKey: `entity-property:${objectId(entity)}:${key}`,
  });
}

export function removeEntityProperty(editor: Editor, entity: Entity, key: string): void {
  editor.transact('Remove entity property', () => {
    delete entity.properties[key];
  });
}

export function addEntityProperty(editor: Editor, entity: Entity): string {
  let n = 1;
  while (`key${n}` in entity.properties) n++;
  const key = `key${n}`;
  editor.transact('Add entity property', () => {
    entity.properties[key] = '';
  });
  return key;
}

export function updateFaceProperties(
  editor: Editor,
  faces: BrushFace[],
  label: string,
  changes: FacePropertyChanges,
): void {
  const ids = faces.map(face => objectId(face)).sort((a, b) => a - b).join(',');
  const fields = Object.keys(changes).sort().join(',');
  editor.transact(label, () => {
    for (const face of faces) Object.assign(face, changes);
  }, {
    coalesceKey: `face-properties:${ids}:${fields}`,
  });
}
