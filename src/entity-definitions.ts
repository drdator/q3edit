import type { AssetIndex, IndexedAsset } from './asset-index';
import type { Vec3 } from './math';

export type EntityClassType = 'point' | 'brush';
export type EntityPropertyType =
  | 'string'
  | 'number'
  | 'vector'
  | 'color'
  | 'choice'
  | 'asset'
  | 'entity-reference'
  | 'angle';

export interface EntityPropertyDefinition {
  key: string;
  name: string;
  type: EntityPropertyType;
  description?: string;
  default?: string;
  choices?: Array<{ value: string; label: string }>;
}

export interface EntitySpawnflagDefinition {
  bit: number;
  name: string;
  description?: string;
}

export interface EntityRelationshipDefinition {
  key: string;
  direction: 'outgoing' | 'incoming';
  required: boolean;
  targetClasses?: string[];
  description: string;
}

export interface EntityClassDefinition {
  classname: string;
  type: EntityClassType;
  color: [number, number, number];
  bounds?: { mins: Vec3; maxs: Vec3 };
  description: string;
  model?: string;
  category: string;
  properties: Record<string, EntityPropertyDefinition>;
  defaults: Record<string, string>;
  spawnflags: EntitySpawnflagDefinition[];
  relationships?: EntityRelationshipDefinition[];
  source?: { path: string; archiveName: string };
}

export interface EntityDefinitionDiagnostic {
  source: string;
  message: string;
  offset?: number;
}

export interface EntityDefinitionParseResult {
  classes: EntityClassDefinition[];
  diagnostics: EntityDefinitionDiagnostic[];
}

const DEFAULT_COLOR: [number, number, number] = [0.53, 0.53, 0.53];

function numbers(value: string): number[] {
  return value.trim().split(/\s+/).map(Number).filter(Number.isFinite);
}

function inferPropertyType(key: string): EntityPropertyType {
  const lower = key.toLowerCase();
  if (lower === 'angle' || lower === 'angles') return 'angle';
  if (lower === '_color' || lower === 'color') return 'color';
  if (lower === 'origin' || lower.endsWith('_vector') || lower === 'movedir') return 'vector';
  if (lower === 'target' || lower === 'targetname' || lower === 'killtarget') return 'entity-reference';
  if (lower === 'model' || lower === 'skin' || lower.endsWith('sound') || lower.endsWith('shader')) return 'asset';
  if (/^(?:light|wait|random|speed|count|damage|health|radius|lip|height)$/.test(lower)) return 'number';
  return 'string';
}

function parseVec3(text: string): Vec3 | null {
  const values = numbers(text);
  return values.length === 3 ? [values[0], values[1], values[2]] : null;
}

function categoryFor(classname: string, type: EntityClassType): string {
  const prefix = classname.split('_')[0];
  const categories: Record<string, string> = {
    info: 'Info', team: 'Team', light: 'Lights', weapon: 'Weapons', ammo: 'Ammo',
    item: 'Items', holdable: 'Items', target: 'Targets', path: 'Paths', trigger: 'Triggers',
    func: 'Brush Entities', misc: 'Misc', shooter: 'Shooters', worldspawn: 'World',
  };
  return categories[prefix] ?? (type === 'brush' ? 'Brush Entities' : 'Other');
}

function parsePropertyDocumentation(description: string): {
  description: string;
  properties: Record<string, EntityPropertyDefinition>;
  defaults: Record<string, string>;
  model?: string;
} {
  const properties: Record<string, EntityPropertyDefinition> = {};
  const defaults: Record<string, string> = {};
  const prose: string[] = [];
  let model: string | undefined;
  for (const line of description.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^\*\s?/, '');
    const property = trimmed.match(/^"?([A-Za-z_][\w.]*)"?\s*(?::|-|=)\s*(.+)$/);
    if (!property) {
      if (trimmed) prose.push(trimmed);
      continue;
    }
    const key = property[1];
    let help = property[2].trim();
    const defaultMatch = help.match(/\(default(?:s to)?\s*[:=]?\s*([^\)]+)\)/i);
    if (defaultMatch) {
      defaults[key] = defaultMatch[1].trim().replace(/^['"]|['"]$/g, '');
      help = help.replace(defaultMatch[0], '').trim();
    }
    const choicesMatch = help.match(/\{([^}]+)\}/);
    const choices = choicesMatch?.[1].split(/[,|]/).map(choice => {
      const [value, label] = choice.trim().split(/\s*:\s*/, 2);
      return { value, label: label ?? value };
    });
    const type = choices ? 'choice' : inferPropertyType(key);
    properties[key] = { key, name: key, type, description: help, default: defaults[key], choices };
    if (key.toLowerCase() === 'model' && defaults[key]) model = defaults[key];
  }
  return { description: prose.join('\n'), properties, defaults, model };
}

function parseQuakedHeader(header: string, description: string, source: string): EntityClassDefinition | null {
  const match = header.match(/^\s*([^\s]+)\s+\(([^)]*)\)\s+([\s\S]*)$/);
  if (!match) return null;
  const classname = match[1];
  const colorValues = numbers(match[2]);
  if (colorValues.length !== 3) return null;
  let rest = match[3].trim();
  let type: EntityClassType = 'brush';
  let bounds: EntityClassDefinition['bounds'];
  const boundsMatch = rest.match(/^\(([^)]*)\)\s+\(([^)]*)\)\s*(.*)$/s);
  if (boundsMatch) {
    const mins = parseVec3(boundsMatch[1]);
    const maxs = parseVec3(boundsMatch[2]);
    if (!mins || !maxs) return null;
    type = 'point';
    bounds = { mins, maxs };
    rest = boundsMatch[3].trim();
  } else if (rest.startsWith('?')) {
    rest = rest.slice(1).trim();
  }

  const spawnflags: EntitySpawnflagDefinition[] = [];
  rest.split(/\s+/).filter(Boolean).forEach((name, index) => {
    if (name !== '-' && name.toLowerCase() !== 'x') {
      spawnflags.push({ bit: 1 << index, name });
    }
  });
  const docs = parsePropertyDocumentation(description);
  return {
    classname,
    type,
    color: [colorValues[0], colorValues[1], colorValues[2]],
    bounds,
    description: docs.description,
    model: docs.model,
    category: categoryFor(classname, type),
    properties: docs.properties,
    defaults: docs.defaults,
    spawnflags,
    source: { path: source, archiveName: source },
  };
}

export function parseQuakedDefinitions(text: string, source = '<text>'): EntityDefinitionParseResult {
  const classes: EntityClassDefinition[] = [];
  const diagnostics: EntityDefinitionDiagnostic[] = [];
  const marker = /\/\*\s*QUAKED\s+([^\r\n]*)([\s\S]*?)\*\//gi;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) {
    const parsed = parseQuakedHeader(match[1], match[2], source);
    if (parsed) classes.push(parsed);
    else diagnostics.push({ source, offset: match.index, message: `Malformed QUAKED definition: ${match[1].trim()}` });
  }
  if (classes.length === 0 && text.trim()) {
    diagnostics.push({ source, message: 'No QUAKED entity definitions found' });
  }
  return { classes, diagnostics };
}

function xmlAttribute(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
}

function decodeXml(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function parseEntDefinitions(text: string, source = '<text>'): EntityDefinitionParseResult {
  const classes: EntityClassDefinition[] = [];
  const diagnostics: EntityDefinitionDiagnostic[] = [];
  const classPattern = /<(point|group|brush)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = classPattern.exec(text))) {
    const attrs = match[2];
    const body = match[3];
    const classname = xmlAttribute(attrs, 'name');
    if (!classname) {
      diagnostics.push({ source, offset: match.index, message: 'Entity class is missing a name attribute' });
      continue;
    }
    const type: EntityClassType = match[1].toLowerCase() === 'point' ? 'point' : 'brush';
    const color = parseVec3(xmlAttribute(attrs, 'color') ?? '') ?? DEFAULT_COLOR;
    const box = numbers(xmlAttribute(attrs, 'box') ?? '');
    const properties: Record<string, EntityPropertyDefinition> = {};
    const defaults: Record<string, string> = {};
    const spawnflags: EntitySpawnflagDefinition[] = [];
    const childPattern = /<(string|integer|real|vector3|color|angle|model|target|targetname|flag|list)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
    let child: RegExpExecArray | null;
    while ((child = childPattern.exec(body))) {
      const tag = child[1].toLowerCase();
      const childAttrs = child[2];
      const key = xmlAttribute(childAttrs, 'key') ?? '';
      const name = xmlAttribute(childAttrs, 'name') ?? key;
      const help = decodeXml((child[3] ?? '').replace(/<[^>]+>/g, '').trim());
      if (tag === 'flag') {
        const bit = Number(key);
        if (Number.isInteger(bit) && bit > 0) spawnflags.push({ bit, name, description: help });
        else diagnostics.push({ source, offset: match.index + child.index, message: `Invalid spawnflag bit '${key}' in ${classname}` });
        continue;
      }
      if (!key) continue;
      const types: Record<string, EntityPropertyType> = {
        string: 'string', integer: 'number', real: 'number', vector3: 'vector', color: 'color',
        angle: 'angle', model: 'asset', target: 'entity-reference', targetname: 'entity-reference', list: 'choice',
      };
      const defaultValue = xmlAttribute(childAttrs, 'value') ?? xmlAttribute(childAttrs, 'default');
      if (defaultValue !== undefined) defaults[key] = defaultValue;
      const choices = tag === 'list'
        ? [...(child[3] ?? '').matchAll(/<item\b([^>]*)\/?\s*>/gi)].map(item => ({
          value: xmlAttribute(item[1], 'value') ?? '',
          label: xmlAttribute(item[1], 'name') ?? xmlAttribute(item[1], 'value') ?? '',
        })).filter(item => item.value)
        : undefined;
      properties[key] = { key, name, type: types[tag], description: help, default: defaultValue, choices };
    }
    classes.push({
      classname,
      type,
      color: [color[0], color[1], color[2]],
      bounds: box.length === 6 ? { mins: [box[0], box[1], box[2]], maxs: [box[3], box[4], box[5]] } : undefined,
      description: decodeXml(body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()),
      model: xmlAttribute(attrs, 'model'),
      category: xmlAttribute(attrs, 'group') ?? categoryFor(classname, type),
      properties,
      defaults,
      spawnflags,
      source: { path: source, archiveName: source },
    });
  }
  if (classes.length === 0 && text.trim()) diagnostics.push({ source, message: 'No Radiant XML entity definitions found' });
  return { classes, diagnostics };
}

const FALLBACK_CLASSES: Array<[string, string, string, Record<string, string>?]> = [
  ['worldspawn', 'World', '#888888', { gravity: '800', enableDust: '0', enableBreath: '0' }],
  ['info_player_deathmatch', 'Spawns', '#44cc44', { angle: '0' }],
  ['info_player_start', 'Spawns', '#44cc44', { angle: '0' }],
  ['info_player_intermission', 'Spawns', '#44cc44', { angle: '0' }],
  ['info_camp', 'Spawns', '#44cc44'], ['team_CTF_redspawn', 'Team Spawns', '#44cc44', { angle: '0' }],
  ['team_CTF_bluespawn', 'Team Spawns', '#44cc44', { angle: '0' }], ['team_CTF_redflag', 'Team Spawns', '#44cc44'],
  ['team_CTF_blueflag', 'Team Spawns', '#44cc44'], ['light', 'Lights', '#ffcc00', { light: '300', _color: '1 1 1' }],
  ...['weapon_rocketlauncher','weapon_railgun','weapon_lightning','weapon_shotgun','weapon_plasmagun','weapon_bfg','weapon_grenadelauncher','weapon_gauntlet'].map(name => [name, 'Weapons', '#ff6644'] as [string,string,string]),
  ...['ammo_rockets','ammo_slugs','ammo_lightning','ammo_shells','ammo_cells','ammo_bfg','ammo_grenades','ammo_bullets'].map(name => [name, 'Ammo', '#cc8844'] as [string,string,string]),
  ...['item_health_small','item_health','item_health_large','item_health_mega','item_armor_shard','item_armor_combat','item_armor_body'].map(name => [name, 'Items', '#44bbff'] as [string,string,string]),
  ...['item_quad','item_haste','item_invis','item_regen','item_enviro','item_flight','holdable_medkit','holdable_teleporter'].map(name => [name, 'Items', '#cc44ff'] as [string,string,string]),
  ...['target_position','target_speaker','target_delay','target_relay','target_give','info_notnull'].map(name => [name, 'Targets', '#888888'] as [string,string,string]),
  ['path_corner', 'Paths', '#66cc88'], ['info_null', 'Paths', '#66cc88'],
  ...['misc_model','misc_teleporter_dest'].map(name => [name, 'Misc', '#888888'] as [string,string,string]),
  ...['func_group','func_detail','func_door','func_button','func_plat','func_rotating','func_bobbing','func_train','trigger_multiple','trigger_push','trigger_teleport','trigger_hurt'].map(name => [name, name.startsWith('trigger_') ? 'Triggers' : 'Brush Entities', '#888888'] as [string,string,string]),
];

type BuiltInProperty = Omit<EntityPropertyDefinition, 'key'>;

const BUILT_IN_PROPERTIES: Record<string, Record<string, BuiltInProperty>> = {
  worldspawn: {
    message: { name: 'Map title', type: 'string', description: 'Text shown while the map is loading.' },
    music: { name: 'Music', type: 'asset', description: 'Background music track, normally a path below music/.' },
    gravity: { name: 'Gravity', type: 'number', default: '800', description: 'Map gravity. Quake 3 defaults to 800.' },
    enableDust: { name: 'Enable dust', type: 'choice', default: '0', description: 'Allow dust effects on suitable surfaces.', choices: [{ value: '0', label: 'No' }, { value: '1', label: 'Yes' }] },
    enableBreath: { name: 'Enable breath', type: 'choice', default: '0', description: 'Allow cold-breath effects.', choices: [{ value: '0', label: 'No' }, { value: '1', label: 'Yes' }] },
  },
  light: {
    light: { name: 'Intensity', type: 'number', default: '300', description: 'Light intensity.' },
    _color: { name: 'Color', type: 'color', default: '1 1 1', description: 'RGB light color, with each component from 0 to 1.' },
    target: { name: 'Target', type: 'entity-reference', description: 'Optional targetname used to turn this light into a spotlight.' },
    radius: { name: 'Spot radius', type: 'number', default: '64', description: 'Spotlight radius at the target point.' },
  },
  target_position: {
    targetname: { name: 'Target name', type: 'entity-reference', description: 'Name used by a trigger_push or another entity to reference this position.' },
  },
  info_notnull: {
    targetname: { name: 'Target name', type: 'entity-reference', description: 'Name used by another entity to reference this calculation point.' },
  },
  misc_teleporter_dest: {
    targetname: { name: 'Target name', type: 'entity-reference', description: 'Name used by a trigger_teleport to reference this destination.' },
    angle: { name: 'Exit yaw', type: 'angle', default: '0', description: 'Direction the player faces after teleporting.' },
  },
  trigger_push: {
    target: { name: 'Target', type: 'entity-reference', description: 'Required targetname of the target_position at the jump apex.' },
  },
  trigger_teleport: {
    target: { name: 'Target', type: 'entity-reference', description: 'Required targetname of the teleport destination.' },
  },
  trigger_multiple: {
    target: { name: 'Target', type: 'entity-reference', description: 'Required targetname of one or more entities to activate.' },
    wait: { name: 'Wait', type: 'number', default: '0.5', description: 'Seconds between activations; -1 makes the trigger single-use.' },
    random: { name: 'Random', type: 'number', default: '0', description: 'Random variance added to or subtracted from wait.' },
  },
};

const BUILT_IN_RELATIONSHIPS: Record<string, EntityRelationshipDefinition[]> = {
  light: [{ key: 'target', direction: 'outgoing', required: false, description: 'Points the light at a named entity to create a spotlight.' }],
  target_position: [{ key: 'targetname', direction: 'incoming', required: false, description: 'Referenced by jump pads and other positional targeting entities.' }],
  info_notnull: [{ key: 'targetname', direction: 'incoming', required: false, description: 'Referenced by entities that need an in-game calculation point.' }],
  misc_teleporter_dest: [{ key: 'targetname', direction: 'incoming', required: true, description: 'Referenced by a trigger_teleport.' }],
  trigger_push: [{ key: 'target', direction: 'outgoing', required: true, targetClasses: ['target_position', 'info_notnull'], description: 'Must resolve to the apex position used to calculate launch velocity.' }],
  trigger_teleport: [{ key: 'target', direction: 'outgoing', required: true, targetClasses: ['misc_teleporter_dest', 'target_position'], description: 'Must resolve to the player destination.' }],
  trigger_multiple: [{ key: 'target', direction: 'outgoing', required: true, description: 'Must resolve to one or more entities to activate.' }],
};

const BUILT_IN_SPAWNFLAGS: Record<string, EntitySpawnflagDefinition[]> = {
  light: [{ bit: 1, name: 'LINEAR', description: 'Use linear attenuation instead of inverse-square falloff.' }],
  trigger_teleport: [{ bit: 1, name: 'SPECTATOR', description: 'Only spectators can use this teleporter.' }],
};

function hexColor(value: string): [number, number, number] {
  return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

export function createFallbackEntityDefinitions(): EntityClassDefinition[] {
  return FALLBACK_CLASSES.map(([classname, category, color, defaults = {}]) => {
    const documented = BUILT_IN_PROPERTIES[classname] ?? {};
    const properties = Object.fromEntries(Object.entries({
      ...Object.fromEntries(Object.keys(defaults).map(key => [key, { name: key, type: inferPropertyType(key), default: defaults[key] }])),
      ...documented,
    }).map(([key, property]) => [key, { key, ...property }]));
    const documentedDefaults = Object.fromEntries(
      Object.entries(properties).filter(([, property]) => property.default !== undefined)
        .map(([key, property]) => [key, property.default as string]),
    );
    return {
      classname,
      type: classname === 'worldspawn' || classname.startsWith('func_') || classname.startsWith('trigger_') ? 'brush' : 'point',
      color: hexColor(color),
      description: classname === 'worldspawn' ? 'The map world entity. Every map has exactly one.' : 'Built-in fallback definition.',
      category,
      properties,
      defaults: { ...defaults, ...documentedDefaults },
      spawnflags: BUILT_IN_SPAWNFLAGS[classname] ?? [],
      relationships: BUILT_IN_RELATIONSHIPS[classname] ?? [],
      source: { path: '<built-in>', archiveName: 'Q3Edit fallback' },
    };
  });
}

export class EntityClassRegistry {
  private classes = new Map<string, EntityClassDefinition>();
  readonly diagnostics: EntityDefinitionDiagnostic[] = [];

  constructor(fallbacks: readonly EntityClassDefinition[] = createFallbackEntityDefinitions()) {
    for (const definition of fallbacks) this.classes.set(definition.classname.toLowerCase(), definition);
  }

  add(definition: EntityClassDefinition): void {
    const key = definition.classname.toLowerCase();
    const existing = this.classes.get(key);
    this.classes.set(key, existing ? {
      ...definition,
      properties: { ...existing.properties, ...definition.properties },
      defaults: { ...existing.defaults, ...definition.defaults },
      relationships: definition.relationships?.length ? definition.relationships : existing.relationships,
    } : definition);
  }

  get(classname: string): EntityClassDefinition | null {
    return this.classes.get(classname.toLowerCase()) ?? null;
  }

  list(): EntityClassDefinition[] {
    return [...this.classes.values()].sort((a, b) => a.classname.localeCompare(b.classname));
  }

  categories(type?: EntityClassType): Array<{ name: string; classes: EntityClassDefinition[] }> {
    const grouped = new Map<string, EntityClassDefinition[]>();
    for (const definition of this.list()) {
      if (type && definition.type !== type) continue;
      const classes = grouped.get(definition.category) ?? [];
      classes.push(definition);
      grouped.set(definition.category, classes);
    }
    return [...grouped].map(([name, classes]) => ({ name, classes }));
  }

  loadSource(text: string, source: string, format: 'def' | 'ent'): void {
    const result = format === 'ent' ? parseEntDefinitions(text, source) : parseQuakedDefinitions(text, source);
    this.diagnostics.push(...result.diagnostics);
    for (const definition of result.classes) this.add(definition);
  }
}

function definitionAssets(index: AssetIndex): IndexedAsset[] {
  return index.entityDefinitions().sort((a, b) =>
    a.source.archiveIndex - b.source.archiveIndex || a.normalizedPath.localeCompare(b.normalizedPath));
}

export function loadEntityClassRegistry(index: AssetIndex, configuredSources: readonly string[] = []): EntityClassRegistry {
  const registry = new EntityClassRegistry();
  const sourceSet = new Set(configuredSources.map(source => source.replace(/\\/g, '/').toLowerCase()));
  const assets = definitionAssets(index).filter(asset => sourceSet.size === 0 ||
    sourceSet.has(asset.normalizedPath) || sourceSet.has(`${asset.source.archiveName}:${asset.normalizedPath}`.toLowerCase()));
  for (const asset of assets) {
    const text = index.readText(asset.normalizedPath);
    if (text === null) continue;
    const format = asset.normalizedPath.endsWith('.ent') ? 'ent' : 'def';
    const source = `${asset.source.archiveName}:${asset.path}`;
    const result = format === 'ent' ? parseEntDefinitions(text, source) : parseQuakedDefinitions(text, source);
    registry.diagnostics.push(...result.diagnostics);
    for (const definition of result.classes) {
      definition.source = { path: asset.path, archiveName: asset.source.archiveName };
      registry.add(definition);
    }
  }
  return registry;
}

let activeRegistry = new EntityClassRegistry();
export function getEntityClassRegistry(): EntityClassRegistry { return activeRegistry; }
export function setEntityClassRegistry(registry: EntityClassRegistry): void { activeRegistry = registry; }
