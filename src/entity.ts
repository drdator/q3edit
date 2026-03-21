import { Vec3, vec3, vec3Copy, vec3Add } from './math';
import { Brush, cloneBrush, translateBrush } from './brush';

export interface Entity {
  classname: string;
  properties: Record<string, string>;
  brushes: Brush[];
}

export function createEntity(classname: string, origin?: Vec3): Entity {
  const properties: Record<string, string> = { classname };
  if (origin) {
    properties['origin'] = `${origin[0]} ${origin[1]} ${origin[2]}`;
  }
  return { classname, properties, brushes: [] };
}

export function entityOrigin(entity: Entity): Vec3 | null {
  const o = entity.properties['origin'];
  if (!o) return null;
  const parts = o.trim().split(/\s+/).map(Number);
  if (parts.length >= 3 && parts.every(n => !isNaN(n))) {
    return [parts[0], parts[1], parts[2]];
  }
  return null;
}

export function setEntityOrigin(entity: Entity, origin: Vec3): void {
  entity.properties['origin'] = `${origin[0]} ${origin[1]} ${origin[2]}`;
}

export function cloneEntity(entity: Entity): Entity {
  return {
    classname: entity.classname,
    properties: { ...entity.properties },
    brushes: entity.brushes.map(cloneBrush),
  };
}

export function translateEntity(entity: Entity, delta: Vec3): void {
  const origin = entityOrigin(entity);
  if (origin) {
    setEntityOrigin(entity, vec3Add(origin, delta));
  }
  for (const brush of entity.brushes) {
    translateBrush(brush, delta);
  }
}

// Common entity classnames for the editor
export const ENTITY_CLASSES = [
  'info_player_deathmatch',
  'info_player_start',
  'info_player_intermission',
  'light',
  'target_position',
  'target_speaker',
  'misc_model',
  'misc_teleporter_dest',
  'trigger_push',
  'trigger_teleport',
  'trigger_hurt',
  'trigger_multiple',
  'weapon_rocketlauncher',
  'weapon_railgun',
  'weapon_lightning',
  'weapon_shotgun',
  'weapon_plasmagun',
  'weapon_bfg',
  'weapon_grenadelauncher',
  'ammo_rockets',
  'ammo_slugs',
  'ammo_lightning',
  'ammo_shells',
  'ammo_cells',
  'ammo_bfg',
  'ammo_grenades',
  'item_health',
  'item_health_large',
  'item_health_mega',
  'item_armor_shard',
  'item_armor_combat',
  'item_armor_body',
  'item_quad',
  'item_haste',
  'item_invis',
  'item_regen',
];
