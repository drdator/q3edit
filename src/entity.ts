import { Vec3, vec3, vec3Copy, vec3Add } from './math';
import { Brush, cloneBrush, translateBrush } from './brush';
import { Patch, clonePatch, translatePatch } from './patch';

export interface Entity {
  classname: string;
  properties: Record<string, string>;
  brushes: Brush[];
  patches: Patch[];
}

export function createEntity(classname: string, origin?: Vec3): Entity {
  const properties: Record<string, string> = { classname };
  if (origin) {
    properties['origin'] = `${origin[0]} ${origin[1]} ${origin[2]}`;
  }
  return { classname, properties, brushes: [], patches: [] };
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
    patches: entity.patches.map(clonePatch),
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
  for (const patch of entity.patches) {
    translatePatch(patch, delta);
  }
}

// Entity definition with optional default properties
export interface EntityClassDef {
  classname: string;
  defaults?: Record<string, string>;
}

export interface EntityCategory {
  name: string;
  color: string; // color for 2D/3D viewport rendering
  classes: EntityClassDef[];
}

export const ENTITY_CATEGORIES: EntityCategory[] = [
  {
    name: 'Spawns',
    color: '#44cc44',
    classes: [
      { classname: 'info_player_deathmatch', defaults: { angle: '0' } },
      { classname: 'info_player_start', defaults: { angle: '0' } },
      { classname: 'info_player_intermission', defaults: { angle: '0' } },
      { classname: 'info_camp' },
    ],
  },
  {
    name: 'Team Spawns',
    color: '#44cc44',
    classes: [
      { classname: 'team_CTF_redspawn', defaults: { angle: '0' } },
      { classname: 'team_CTF_bluespawn', defaults: { angle: '0' } },
      { classname: 'team_CTF_redflag' },
      { classname: 'team_CTF_blueflag' },
    ],
  },
  {
    name: 'Lights',
    color: '#ffcc00',
    classes: [
      { classname: 'light', defaults: { light: '300', _color: '1 1 1' } },
    ],
  },
  {
    name: 'Weapons',
    color: '#ff6644',
    classes: [
      { classname: 'weapon_rocketlauncher' },
      { classname: 'weapon_railgun' },
      { classname: 'weapon_lightning' },
      { classname: 'weapon_shotgun' },
      { classname: 'weapon_plasmagun' },
      { classname: 'weapon_bfg' },
      { classname: 'weapon_grenadelauncher' },
      { classname: 'weapon_gauntlet' },
    ],
  },
  {
    name: 'Ammo',
    color: '#cc8844',
    classes: [
      { classname: 'ammo_rockets' },
      { classname: 'ammo_slugs' },
      { classname: 'ammo_lightning' },
      { classname: 'ammo_shells' },
      { classname: 'ammo_cells' },
      { classname: 'ammo_bfg' },
      { classname: 'ammo_grenades' },
      { classname: 'ammo_bullets' },
    ],
  },
  {
    name: 'Health',
    color: '#44bbff',
    classes: [
      { classname: 'item_health_small' },
      { classname: 'item_health' },
      { classname: 'item_health_large' },
      { classname: 'item_health_mega' },
    ],
  },
  {
    name: 'Armor',
    color: '#44bbff',
    classes: [
      { classname: 'item_armor_shard' },
      { classname: 'item_armor_combat' },
      { classname: 'item_armor_body' },
    ],
  },
  {
    name: 'Powerups',
    color: '#cc44ff',
    classes: [
      { classname: 'item_quad' },
      { classname: 'item_haste' },
      { classname: 'item_invis' },
      { classname: 'item_regen' },
      { classname: 'item_enviro' },
      { classname: 'item_flight' },
      { classname: 'holdable_medkit' },
      { classname: 'holdable_teleporter' },
    ],
  },
  {
    name: 'Targets',
    color: '#888888',
    classes: [
      { classname: 'target_position' },
      { classname: 'target_speaker' },
      { classname: 'target_delay' },
      { classname: 'target_relay' },
      { classname: 'target_give' },
      { classname: 'info_notnull' },
    ],
  },
  {
    name: 'Triggers',
    color: '#888888',
    classes: [
      { classname: 'trigger_push' },
      { classname: 'trigger_teleport' },
      { classname: 'trigger_hurt' },
      { classname: 'trigger_multiple' },
    ],
  },
  {
    name: 'Misc',
    color: '#888888',
    classes: [
      { classname: 'misc_model' },
      { classname: 'misc_teleporter_dest' },
    ],
  },
];

// Flat list of all entity classnames (for backward compat)
export const ENTITY_CLASSES = ENTITY_CATEGORIES.flatMap(cat => cat.classes.map(c => c.classname));

// Lookup maps built from categories
const _entityDefMap = new Map<string, EntityClassDef>();
const _entityColorMap = new Map<string, string>();
for (const cat of ENTITY_CATEGORIES) {
  for (const cls of cat.classes) {
    _entityDefMap.set(cls.classname, cls);
    _entityColorMap.set(cls.classname, cat.color);
  }
}

/** Get the default properties for an entity classname */
export function entityDefaults(classname: string): Record<string, string> {
  return _entityDefMap.get(classname)?.defaults ?? {};
}

/** Get the category color for an entity classname */
export function entityColor(classname: string): string {
  return _entityColorMap.get(classname) ?? '#888888';
}

/** Parse a Q3 _color value ("r g b" in 0-1 range) to [r, g, b]. Returns null on failure. */
export function parseLightColor(entity: Entity): [number, number, number] | null {
  const c = entity.properties['_color'];
  if (!c) return null;
  const parts = c.trim().split(/\s+/).map(Number);
  if (parts.length >= 3 && parts.every(n => !isNaN(n))) {
    return [parts[0], parts[1], parts[2]];
  }
  return null;
}

/** Convert Q3 _color [0-1] to a CSS hex string */
export function lightColorCSS(entity: Entity): string | null {
  const c = parseLightColor(entity);
  if (!c) return null;
  const r = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
