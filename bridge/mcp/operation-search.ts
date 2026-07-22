export const OPERATION_CATEGORIES = ['entities', 'geometry', 'planning', 'transform', 'materials', 'refinement', 'gameplay', 'organization'] as const;
export type OperationCategory = (typeof OPERATION_CATEGORIES)[number];

export interface OperationDiscoveryEntry {
  type: string;
  category: OperationCategory;
  summary: string;
  keywords: string[];
}

const entries: OperationDiscoveryEntry[] = [
  { type: 'create_entity', category: 'entities', summary: 'Create one point or brush entity with typed properties.', keywords: ['light', 'spawn', 'item', 'model', 'trigger'] },
  { type: 'create_entity_array', category: 'entities', summary: 'Create an evenly spaced linear array of entities.', keywords: ['repeat', 'lights', 'items', 'spawns'] },
  { type: 'set_entity_properties', category: 'entities', summary: 'Set, unset, or change properties on an existing entity.', keywords: ['key', 'value', 'classname', 'angle', 'model', 'skin'] },
  { type: 'create_box', category: 'geometry', summary: 'Create one axis-aligned box brush with semantic top, bottom, and side materials.', keywords: ['block', 'cube', 'platform', 'wall', 'floor'] },
  { type: 'create_box_array', category: 'geometry', summary: 'Create repeated evenly spaced box brushes in one operation.', keywords: ['repeat', 'columns', 'beams', 'platforms'] },
  { type: 'create_room', category: 'geometry', summary: 'Create a sealed rectangular room shell with separate wall, floor, and ceiling materials.', keywords: ['shell', 'arena', 'interior'] },
  { type: 'create_primitive', category: 'geometry', summary: 'Create a box, cylinder, cone, sphere, or pyramid brush primitive.', keywords: ['round', 'circular', 'column', 'dome'] },
  { type: 'create_wedge', category: 'geometry', summary: 'Create a sloped wedge brush.', keywords: ['ramp', 'slope', 'triangle'] },
  { type: 'create_tapered', category: 'geometry', summary: 'Create a tapered or offset convex brush.', keywords: ['trapezoid', 'slanted', 'leaning'] },
  { type: 'create_stairs', category: 'geometry', summary: 'Create a run of stairs with semantic tread, riser, side, and underside materials.', keywords: ['steps', 'staircase', 'vertical route'] },
  { type: 'create_brush', category: 'geometry', summary: 'Create an arbitrary convex brush from plane point triples.', keywords: ['planes', 'custom', 'convex', 'non axial'] },
  { type: 'create_prefab', category: 'geometry', summary: 'Create a small procedural pillar, door frame, or jump-pad base assembly.', keywords: ['pillar', 'doorway', 'trim', 'module'] },
  { type: 'create_patch', category: 'geometry', summary: 'Create curved bevel, endcap, cylinder, arch, pipe, or ramp patch geometry with detail/structural classification.', keywords: ['curve', 'curved', 'gothic', 'archway', 'tube', 'patch detail', 'structural', 'vis'] },
  { type: 'create_area', category: 'planning', summary: 'Declare a semantic gameplay area and optionally realize its floor or room geometry.', keywords: ['zone', 'space', 'layout', 'plan'] },
  { type: 'connect_areas', category: 'planning', summary: 'Declare a semantic route between planned areas and optionally create its floor.', keywords: ['connection', 'route', 'flow', 'corridor'] },
  { type: 'create_path', category: 'geometry', summary: 'Generate corridors, walls, railings, pipes, beams, trim, stairs, or supports along a path.', keywords: ['spline', 'catmull rom', 'curved bridge', 'sweep'] },
  { type: 'reshape_room', category: 'refinement', summary: 'Replace a rectangular room shell with an octagonal room while preserving materials.', keywords: ['less boxy', 'octagon', 'shape language'] },
  { type: 'translate', category: 'transform', summary: 'Move selected objects by a world-space delta.', keywords: ['move', 'offset', 'position'] },
  { type: 'rotate', category: 'transform', summary: 'Rotate selected objects around a center and axis.', keywords: ['turn', 'angle', 'yaw', 'pitch', 'roll'] },
  { type: 'mirror', category: 'transform', summary: 'Mirror selected objects across an axis-aligned plane.', keywords: ['flip', 'symmetry'] },
  { type: 'clone', category: 'transform', summary: 'Duplicate selected objects with an optional translation.', keywords: ['copy', 'duplicate'] },
  { type: 'array', category: 'transform', summary: 'Create evenly offset copies of selected geometry.', keywords: ['repeat', 'linear array', 'duplicate'] },
  { type: 'repeat_variation', category: 'transform', summary: 'Repeat geometry with linear, radial, or mirrored distribution and controlled variation.', keywords: ['radial array', 'scatter', 'pattern', 'organic', 'variation'] },
  { type: 'set_texture', category: 'materials', summary: 'Replace the texture on complete selected objects.', keywords: ['material', 'skin', 'surface'] },
  { type: 'edit_faces', category: 'materials', summary: 'Edit selected brush faces, including material, fit, shift, scale, rotation, and flags.', keywords: ['uv', 'projection', 'texel', 'align texture', 'surface flags'] },
  { type: 'edit_patches', category: 'materials', summary: 'Edit patch material, projection, transforms, subdivisions, and detail/structural classification.', keywords: ['curve texture', 'patch uv', 'patch detail', 'structural', 'vis'] },
  { type: 'thicken_patch', category: 'refinement', summary: 'Give selected patch surfaces thickness and optional caps.', keywords: ['solid curve', 'shell'] },
  { type: 'set_brush_classification', category: 'refinement', summary: 'Convert brushes between structural and detail classification.', keywords: ['detail brush', 'structural', 'vis'] },
  { type: 'clip_brushes', category: 'refinement', summary: 'Split or clip convex brushes with an arbitrary plane.', keywords: ['cut', 'slice', 'diagonal'] },
  { type: 'hollow_brushes', category: 'refinement', summary: 'Replace solid brushes with hollow shells of a chosen thickness.', keywords: ['room', 'shell', 'inside'] },
  { type: 'csg_subtract', category: 'refinement', summary: 'Subtract carver brushes to make openings and recesses.', keywords: ['carve', 'door', 'window', 'hole', 'boolean'] },
  { type: 'offset_faces', category: 'refinement', summary: 'Move selected convex brush planes inward or outward.', keywords: ['extrude', 'inset', 'resize face'] },
  { type: 'chamfer_brushes', category: 'refinement', summary: 'Bevel selected corners on axis-aligned box brushes.', keywords: ['bevel', 'trim corner', 'less boxy'] },
  { type: 'taper_brushes', category: 'refinement', summary: 'Taper existing axis-aligned brushes while preserving their materials.', keywords: ['slant', 'trapezoid', 'less boxy'] },
  { type: 'create_jump_pad', category: 'gameplay', summary: 'Create and wire a jump-pad trigger and trajectory apex.', keywords: ['bounce', 'trigger push', 'target position'] },
  { type: 'create_teleporter', category: 'gameplay', summary: 'Create and wire a teleporter trigger and destination.', keywords: ['portal', 'transport'] },
  { type: 'assign_group', category: 'organization', summary: 'Assign objects to a stable persistent named group.', keywords: ['tag', 'name', 'collection'] },
  { type: 'remove_from_group', category: 'organization', summary: 'Remove objects from their persistent named group.', keywords: ['ungroup', 'tag'] },
  { type: 'delete', category: 'organization', summary: 'Delete selected entities, brushes, or patches.', keywords: ['remove', 'erase'] },
];

const normalizedTokens = (value: string): string[] => value.toLowerCase().replace(/[_-]/g, ' ').match(/[a-z0-9]+/g) ?? [];

export function searchOperations(query: string, category?: OperationCategory, limit = 8): OperationDiscoveryEntry[] {
  const queryTokens = normalizedTokens(query);
  return entries
    .filter(entry => !category || entry.category === category)
    .map((entry, index) => {
      const type = normalizedTokens(entry.type);
      const summary = normalizedTokens(entry.summary);
      const keywords = normalizedTokens(entry.keywords.join(' '));
      const searchable = new Set([...type, ...summary, ...keywords]);
      const score = queryTokens.length === 0 ? 1 : queryTokens.reduce((total, token) => {
        if (type.includes(token)) return total + 8;
        if (keywords.includes(token)) return total + 5;
        if (summary.includes(token)) return total + 3;
        if ([...searchable].some(value => value.startsWith(token) || token.startsWith(value))) return total + 1;
        return total;
      }, 0);
      return { entry, index, score };
    })
    .filter(match => queryTokens.length === 0 || match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(match => match.entry);
}

export function operationDiscoveryEntries(): readonly OperationDiscoveryEntry[] {
  return entries;
}
