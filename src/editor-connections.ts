import type { Editor } from './editor';
import type { Entity } from './entity';
import { entityDisplayOrigin } from './editor-queries';
import type { Vec3 } from './math';

export interface EntityLink {
  source: Entity;
  target: Entity;
  value: string;
  from: Vec3;
  to: Vec3;
  highlighted: boolean;
}

function trimProperty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function selectedEntitiesInOrder(editor: Editor): Entity[] {
  const ordered: Entity[] = [];
  const seen = new Set<Entity>();

  for (const item of editor.selection) {
    if (seen.has(item.entity)) continue;
    seen.add(item.entity);
    ordered.push(item.entity);
  }

  return ordered;
}

function nextTargetName(editor: Editor): string {
  let maxIndex = 0;

  for (const entity of editor.nonWorldspawnEntities()) {
    for (const key of ['target', 'targetname'] as const) {
      const value = trimProperty(entity.properties[key]);
      if (!value) continue;
      const match = value.match(/^t(\d+)$/i);
      if (!match) continue;
      maxIndex = Math.max(maxIndex, Number(match[1]) || 0);
    }
  }

  return `t${maxIndex + 1}`;
}

function entityLabel(entity: Entity): string {
  const name = trimProperty(entity.properties['targetname']) ?? trimProperty(entity.properties['name']);
  return name ? `${entity.classname} "${name}"` : entity.classname;
}

function entitySelected(editor: Editor, entity: Entity): boolean {
  return editor.selection.some(item => item.entity === entity);
}

export function collectEntityLinks(editor: Editor): EntityLink[] {
  const targetnameMap = new Map<string, { entity: Entity; origin: Vec3 }[]>();

  for (const entity of editor.nonWorldspawnEntities()) {
    if (!editor.isEntityVisible(entity)) continue;
    const targetname = trimProperty(entity.properties['targetname']);
    if (!targetname) continue;
    const origin = entityDisplayOrigin(entity);
    if (!origin) continue;
    const matches = targetnameMap.get(targetname) ?? [];
    matches.push({ entity, origin });
    targetnameMap.set(targetname, matches);
  }

  const links: EntityLink[] = [];

  for (const entity of editor.nonWorldspawnEntities()) {
    if (!editor.isEntityVisible(entity)) continue;
    const target = trimProperty(entity.properties['target']);
    if (!target) continue;
    const origin = entityDisplayOrigin(entity);
    if (!origin) continue;
    const destinations = targetnameMap.get(target);
    if (!destinations) continue;

    for (const destination of destinations) {
      if (destination.entity === entity) continue;
      links.push({
        source: entity,
        target: destination.entity,
        value: target,
        from: [...origin],
        to: [...destination.origin],
        highlighted: entitySelected(editor, entity) || entitySelected(editor, destination.entity),
      });
    }
  }

  return links;
}

export function connectSelectedEntities(editor: Editor): void {
  const entities = selectedEntitiesInOrder(editor).filter(entity => entity !== editor.worldspawn);

  if (entities.length !== 2) {
    editor.statusMessage = 'Select exactly two entities to connect';
    return;
  }

  const [source, target] = entities;
  if (source === target) {
    editor.statusMessage = 'Select two different entities to connect';
    return;
  }

  const linkName = trimProperty(source.properties['target'])
    ?? trimProperty(target.properties['targetname'])
    ?? nextTargetName(editor);

  editor.snapshot();
  source.properties['target'] = linkName;
  target.properties['targetname'] = linkName;
  editor.selection = [{ type: 'entity', entity: target }];
  editor.dirty = true;
  editor.statusMessage = `Connected ${entityLabel(source)} -> ${entityLabel(target)} (${linkName})`;
}
