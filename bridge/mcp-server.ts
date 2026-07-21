import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { BridgeHub } from './bridge-hub';
import { inspectMapObjects } from './map-inspection';
import { inspectMapGroups, queryMap, type MapQueryOptions } from './map-query';
import type { MapDocumentRef, MapOperation } from '../src/map-operations';
import { lintGameplay } from './gameplay-lint';
import { analyzeJumpPad } from './jump-analysis';
import { lintRoutes } from './route-lint';
import { collectMapStatistics } from './map-statistics';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const compatibleVec3 = z.array(z.number()).length(3);
const objectRef = z.string().regex(/^E\d+(?::[BP]\d+)?(?::F\d+)?$/, 'Expected an object reference such as E1, E0:B2, E0:B2:F4, or E0:P0');
const operationRef = z.string().regex(/^(?:E\d+(?::[BP]\d+)?|@[A-Za-z][A-Za-z0-9_-]{0,63})$/, 'Expected an object reference or symbolic reference such as @north_tower');
const faceRef = z.string().regex(/^(?:E\d+:B\d+:F\d+|@[A-Za-z][A-Za-z0-9_-]{0,63}(?::F\d+)?)$/, 'Expected a face reference such as E0:B2:F4, @trim, or @trim:F4');
const compatibleTargetRef = z.string().regex(/^(?:E\d+(?::[BP]\d+)?(?::F\d+)?|@[A-Za-z][A-Za-z0-9_-]{0,63}(?::F\d+)?)$/);
const symbolicId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const editorSessionId = z.string().min(1).max(160);
const sessionInput = { sessionId: editorSessionId.optional().describe('Explicit editor session; otherwise uses this MCP connection’s selected session or the sole connected editor') };
const groupId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const creationMetadataSchema = {
  id: symbolicId.optional(),
  group: z.string().min(1).max(120).optional(),
  groupId: groupId.optional(),
};
const screenshotBounds = z.object({ mins: vec3, maxs: vec3 });
const MAX_BATCH_OPERATIONS = 128;
const SUPPORTED_MAP_OPERATIONS = [
  'create_entity', 'create_entity_array', 'set_entity_properties', 'create_box', 'create_box_array', 'create_room', 'create_primitive',
  'create_wedge', 'create_stairs', 'create_brush', 'translate', 'rotate', 'mirror', 'clone',
  'array', 'set_texture', 'edit_faces', 'set_brush_classification', 'clip_brushes',
  'hollow_brushes', 'csg_subtract', 'create_jump_pad', 'create_teleporter', 'delete',
  'assign_group', 'remove_from_group',
] as const;

const mapOperationVariants = [
  z.object({
    type: z.literal('create_entity'),
    ...creationMetadataSchema,
    classname: z.string().min(1),
    origin: vec3.optional(),
    properties: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('create_entity_array'),
    ...creationMetadataSchema,
    classname: z.string().min(1),
    start: vec3,
    count: z.number().int().min(1).max(128),
    delta: vec3,
    properties: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('set_entity_properties'),
    target: operationRef,
    classname: z.string().min(1).optional(),
    properties: z.record(z.string(), z.string()).optional(),
    unset: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('create_box'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    textures: z.object({
      top: z.string().min(1).optional(), bottom: z.string().min(1).optional(), sides: z.string().min(1).optional(),
    }).optional(),
  }),
  z.object({
    type: z.literal('create_room'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    wallThickness: z.number().positive().optional(),
    textures: z.object({
      walls: z.string().min(1).optional(),
      floor: z.string().min(1).optional(),
      ceiling: z.string().min(1).optional(),
    }).optional(),
  }),
  z.object({
    type: z.literal('create_box_array'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    count: z.number().int().min(1).max(128),
    delta: vec3,
    texture: z.string().min(1).optional(),
    textures: z.object({
      top: z.string().min(1).optional(), bottom: z.string().min(1).optional(), sides: z.string().min(1).optional(),
    }).optional(),
    classification: z.enum(['detail', 'structural']).optional(),
  }),
  z.object({
    type: z.literal('create_primitive'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    primitive: z.enum(['box', 'cylinder', 'cone', 'sphere', 'pyramid']),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    textures: z.object({
      top: z.string().min(1).optional(), bottom: z.string().min(1).optional(), sides: z.string().min(1).optional(),
    }).optional(),
    axis: z.enum(['x', 'y', 'z']).optional(),
    sides: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('create_wedge'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    direction: z.enum(['x+', 'x-', 'y+', 'y-']).optional(),
  }),
  z.object({
    type: z.literal('create_stairs'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    textures: z.object({
      treads: z.string().min(1).optional(), risers: z.string().min(1).optional(),
      sides: z.string().min(1).optional(), underside: z.string().min(1).optional(),
    }).optional(),
    direction: z.enum(['x+', 'x-', 'y+', 'y-']).optional(),
    steps: z.number().int().min(2).max(64),
  }),
  z.object({
    type: z.literal('create_brush'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    texture: z.string().min(1).optional(),
    faces: z.array(z.object({
      points: z.tuple([vec3, vec3, vec3]),
      texture: z.string().min(1).optional(),
    })).min(4).max(128),
  }),
  z.object({ type: z.literal('translate'), targets: z.array(operationRef).min(1), delta: vec3 }),
  z.object({ type: z.literal('rotate'), targets: z.array(operationRef).min(1), center: vec3, axis: z.enum(['x', 'y', 'z']), angleDegrees: z.number() }),
  z.object({ type: z.literal('mirror'), targets: z.array(operationRef).min(1), center: vec3, axis: z.enum(['x', 'y', 'z']) }),
  z.object({ type: z.literal('clone'), ...creationMetadataSchema, targets: z.array(operationRef).min(1), delta: vec3.optional() }),
  z.object({ type: z.literal('array'), ...creationMetadataSchema, targets: z.array(operationRef).min(1), copies: z.number().int().min(1).max(64), delta: vec3 }),
  z.object({ type: z.literal('set_texture'), targets: z.array(operationRef).min(1), texture: z.string().min(1) }),
  z.object({
    type: z.literal('edit_faces'),
    targets: z.array(faceRef).min(1),
    texture: z.string().min(1).optional(),
    shift: z.tuple([z.number(), z.number()]).optional(),
    scale: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    rotateDegrees: z.number().optional(),
    fit: z.boolean().optional(),
    contentFlags: z.number().int().nonnegative().optional(),
    surfaceFlags: z.number().int().nonnegative().optional(),
    value: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('set_brush_classification'),
    targets: z.array(operationRef).min(1),
    classification: z.enum(['detail', 'structural']),
  }),
  z.object({
    type: z.literal('clip_brushes'),
    id: symbolicId.optional(),
    targets: z.array(operationRef).min(1),
    planePoints: z.tuple([vec3, vec3, vec3]),
    keep: z.enum(['front', 'back', 'both']).optional(),
    texture: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('hollow_brushes'),
    id: symbolicId.optional(),
    targets: z.array(operationRef).min(1),
    thickness: z.number().positive(),
  }),
  z.object({
    type: z.literal('csg_subtract'),
    id: symbolicId.optional(),
    targets: z.array(operationRef).min(1),
    carvers: z.array(operationRef).min(1),
    deleteCarvers: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('create_jump_pad'),
    ...creationMetadataSchema,
    mins: vec3,
    maxs: vec3,
    apex: vec3,
    targetname: z.string().min(1).max(64).optional(),
    texture: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('create_teleporter'),
    ...creationMetadataSchema,
    mins: vec3,
    maxs: vec3,
    destination: vec3,
    exitAngle: z.number().optional(),
    targetname: z.string().min(1).max(64).optional(),
    texture: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('assign_group'),
    targets: z.array(operationRef).min(1),
    group: z.string().min(1).max(120),
    groupId: groupId.optional(),
  }),
  z.object({ type: z.literal('remove_from_group'), targets: z.array(operationRef).min(1) }),
  z.object({ type: z.literal('delete'), targets: z.array(operationRef).min(1) }),
] as const;
const mapOperation = z.discriminatedUnion('type', mapOperationVariants);
const operationSchemaByType = new Map(mapOperationVariants.map(schema => [schema.shape.type.value, schema]));
const OPERATION_SCHEMA_NOTES: Partial<Record<(typeof SUPPORTED_MAP_OPERATIONS)[number], string[]>> = {
  create_jump_pad: [
    'apex is required and is the target_position at the top of the trajectory; destination is not valid.',
    'The operation creates and wires trigger_push, its trigger brush, and target_position atomically.',
  ],
  create_teleporter: [
    'destination is required and is the misc_teleporter_dest origin; apex is not valid.',
    'exitAngle controls the destination facing angle in degrees.',
  ],
  create_brush: ['Each face is a plane defined by three points. Point winding must face outward.'],
  create_entity_array: ['Creates count entities at start + delta × index in one operation and one undo transaction.'],
  create_box_array: ['Creates count evenly spaced brushes at mins/maxs + delta × index; classification can mark every brush detail immediately.'],
  edit_faces: ['Targets must be face references such as E0:B2:F4 or a symbolic brush reference with an optional :F suffix.'],
  assign_group: ['The group name reuses an existing case-insensitive match or creates a persistent named group.'],
};

// Keep the client-facing schema flat. Some MCP hosts omit tools whose JSON
// Schema contains nested oneOf/anyOf unions. Strict per-operation validation
// still happens in the handler through mapOperation below.
const compatibleMapOperationInput = z.object({
  type: z.enum([
    'create_entity',
    'create_entity_array',
    'set_entity_properties',
    'create_box',
    'create_box_array',
    'create_room',
    'create_primitive',
    'create_wedge',
    'create_stairs',
    'create_brush',
    'translate',
    'rotate',
    'mirror',
    'clone',
    'array',
    'set_texture',
    'edit_faces',
    'set_brush_classification',
    'clip_brushes',
    'hollow_brushes',
    'csg_subtract',
    'create_jump_pad',
    'create_teleporter',
    'assign_group',
    'remove_from_group',
    'delete',
  ]),
  id: symbolicId.optional(),
  classname: z.string().optional(),
  origin: compatibleVec3.optional(),
  start: compatibleVec3.optional(),
  count: z.number().int().optional(),
  properties: z.record(z.string(), z.string()).optional(),
  unset: z.array(z.string()).optional(),
  target: operationRef.optional(),
  targets: z.array(compatibleTargetRef).optional(),
  parent: operationRef.optional(),
  mins: compatibleVec3.optional(),
  maxs: compatibleVec3.optional(),
  texture: z.string().optional(),
  wallThickness: z.number().optional(),
  textures: z.object({
    walls: z.string().optional(),
    floor: z.string().optional(),
    ceiling: z.string().optional(),
    top: z.string().optional(),
    bottom: z.string().optional(),
    sides: z.string().optional(),
    treads: z.string().optional(),
    risers: z.string().optional(),
    underside: z.string().optional(),
  }).optional(),
  primitive: z.enum(['box', 'cylinder', 'cone', 'sphere', 'pyramid']).optional(),
  axis: z.enum(['x', 'y', 'z']).optional(),
  sides: z.number().int().optional(),
  direction: z.enum(['x+', 'x-', 'y+', 'y-']).optional(),
  steps: z.number().int().optional(),
  faces: z.array(z.object({
    points: z.array(compatibleVec3).length(3),
    texture: z.string().optional(),
  })).optional(),
  center: compatibleVec3.optional(),
  angleDegrees: z.number().optional(),
  copies: z.number().int().optional(),
  delta: compatibleVec3.optional(),
  shift: z.array(z.number()).length(2).optional(),
  scale: z.array(z.number()).length(2).optional(),
  rotateDegrees: z.number().optional(),
  fit: z.boolean().optional(),
  contentFlags: z.number().int().optional(),
  surfaceFlags: z.number().int().optional(),
  value: z.number().int().optional(),
  classification: z.enum(['detail', 'structural']).optional(),
  planePoints: z.array(compatibleVec3).length(3).optional(),
  keep: z.enum(['front', 'back', 'both']).optional(),
  thickness: z.number().optional(),
  carvers: z.array(operationRef).optional(),
  deleteCarvers: z.boolean().optional(),
  apex: compatibleVec3.optional(),
  destination: compatibleVec3.optional(),
  exitAngle: z.number().optional(),
  targetname: z.string().optional(),
  group: z.string().optional(),
  groupId: z.string().optional(),
});

const mapOperationBatchInputSchema = {
  ...sessionInput,
  expectedRevision: z.number().int().nonnegative(),
  label: z.string().min(1).max(120).describe('Undo or preview label, for example MCP: Add side room'),
  operations: z.array(compatibleMapOperationInput).min(1).max(MAX_BATCH_OPERATIONS),
  responseDetail: z.enum(['full', 'compact']).optional().default('full'),
};

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function toolResult(value: unknown, text?: string) {
  return {
    content: [{ type: 'text' as const, text: text ?? JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function validatedMapOperations(operations: unknown[]): MapOperation[] {
  return operations.map((operation, index) => {
    const parsed = mapOperation.safeParse(operation);
    if (!parsed.success) throw new Error(`Invalid operation ${index + 1}: ${z.prettifyError(parsed.error)}`);
    return parsed.data as MapOperation;
  });
}

function compactRefs(refs: string[]): { count: number; refs: string[]; truncated: boolean } {
  if (refs.length <= 8) return { count: refs.length, refs, truncated: false };
  return { count: refs.length, refs: [...refs.slice(0, 4), ...refs.slice(-4)], truncated: true };
}

function compactApplyResult(result: {
  revision: number; operationCount: number; summary: string; created: string[]; changed: string[]; aliases: Record<string, string[]>;
}): Record<string, unknown> {
  return {
    revision: result.revision, operationCount: result.operationCount, summary: result.summary,
    created: compactRefs(result.created), changed: compactRefs(result.changed),
    aliases: Object.fromEntries(Object.entries(result.aliases).map(([alias, refs]) => [alias, compactRefs(refs)])),
  };
}

export function createQ3EditMcpServer(hub: BridgeHub): McpServer {
  let selectedEditorSessionId: string | undefined;
  const session = (requested?: string): string => hub.resolveSessionId(requested ?? selectedEditorSessionId);
  const sessionValue = (sessionId: string, value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return { sessionId, ...(value as Record<string, unknown>) };
    return { sessionId, result: value };
  };
  const server = new McpServer({ name: 'q3edit-live', version: '0.1.0' }, {
    instructions: 'Call editor_sessions first when more than one Q3Edit browser may be open, then pass sessionId or select one with editor_session_select. Inspect map_status before editing. Use map_query, map_groups, and the texture/entity discovery tools instead of guessing object, asset, or classname data. Use the returned revision as expectedRevision in map_apply. Group related changes into one map_apply call so they appear as one undo step in Q3Edit. Object references and revisions belong to one editor session. Creation operations may declare id and later operations in the same batch may target @id.',
  });

  server.registerTool('editor_sessions', {
    title: 'List connected Q3Edit editor sessions',
    description: 'List stable browser-tab session IDs with filenames, revisions, active save paths, and activity timestamps. Use this before document tools when multiple editors are open.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => toolResult({ selectedSessionId: selectedEditorSessionId ?? null, sessions: hub.listSessions() }));

  server.registerTool('editor_session_select', {
    title: 'Select a Q3Edit editor session',
    description: 'Set the default editor session for subsequent tools on this MCP connection. Explicit sessionId arguments still override it.',
    inputSchema: { sessionId: editorSessionId },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      selectedEditorSessionId = hub.resolveSessionId(sessionId);
      return toolResult({ selectedSessionId: selectedEditorSessionId, status: hub.status(selectedEditorSessionId) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_status', {
    title: 'Get live Q3Edit map status',
    description: 'Return the connected editor, active map, revision, map counts, and diagnostics summary.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(hub.status(resolved));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_capabilities', {
    title: 'Describe Q3Edit MCP capabilities and limits',
    description: 'Return batch limits, supported operation versions, screenshot constraints, compiler availability, and the selected editor’s loaded project/game profile.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const editor = await hub.editorCapabilities(resolved);
      return toolResult({
        sessionId: resolved,
        protocolVersion: 2,
        operations: { version: 1, maxPerBatch: MAX_BATCH_OPERATIONS, supported: SUPPORTED_MAP_OPERATIONS },
        coordinates: {
          finiteNumbersRequired: true,
          enforcedRange: null,
          recommendedRange: [-32768, 32768],
          note: 'Q3Edit accepts finite coordinates; the recommended range avoids common Quake III compiler and precision problems.',
        },
        screenshots: {
          minWidth: 64, minHeight: 64, maxWidth: 2048, maxHeight: 2048,
          modes: ['perspective', 'top', 'front', 'side'],
          controls: ['frameBounds', 'frameGroup', 'hideGroups', 'hideToolBrushes', 'hideSkyBrushes', 'sectionBounds', 'xray'],
        },
        compiler: { available: hub.compilerAvailable, qualities: ['fast', 'normal', 'full'] },
        editor,
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('operation_schema', {
    title: 'Get the exact schema for one map operation',
    description: 'Return the discriminated JSON Schema, required fields, constraints, and semantic notes for one operation accepted by map_apply and map_preview. Use this instead of inferring fields from the compatibility-oriented flat batch schema.',
    inputSchema: { type: z.enum(SUPPORTED_MAP_OPERATIONS) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ type }) => {
    const schema = operationSchemaByType.get(type);
    if (!schema) return toolError(new Error(`Unknown map operation ${type}`));
    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
    return toolResult({
      type,
      acceptedBy: ['map_apply', 'map_preview'],
      jsonSchema,
      required: jsonSchema.required ?? [],
      notes: OPERATION_SCHEMA_NOTES[type] ?? [],
    });
  });

  server.registerTool('map_entities', {
    title: 'List live map entities',
    description: 'List entity references, classnames, property counts, geometry counts, targets, and diagnostics.',
    inputSchema: {
      ...sessionInput,
      classname: z.string().optional().describe('Optional exact classname filter'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, classname }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const entities = classname ? snapshot.entities.filter(entity => entity.classname === classname) : snapshot.entities;
      return toolResult({ sessionId: resolved, revision: snapshot.revision, entities });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_statistics', {
    title: 'Summarize map geometry and gameplay distribution',
    description: 'Return world bounds/size, structural versus detail geometry, texture usage, approximate light influence coverage, and spawn/item counts, bounds, class distribution, spacing, and object references.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, ...collectMapStatistics(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_inspect', {
    title: 'Inspect live map objects',
    description: 'Return properties, bounds, textures, and optional geometry for current revision object references.',
    inputSchema: {
      ...sessionInput,
      refs: z.array(objectRef).min(1).max(50),
      includeGeometry: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, refs, includeGeometry }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({
        sessionId: resolved,
        revision: snapshot.revision,
        objects: inspectMapObjects(snapshot.mapText, refs as MapDocumentRef[], includeGeometry),
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_validate', {
    title: 'Validate live map',
    description: 'Return all current parser, geometry, entity-link, texture, and model diagnostics from Q3Edit.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, diagnostics: snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_gameplay_lint', {
    title: 'Lint gameplay placement',
    description: 'Run approximate gameplay checks for point entities embedded in solids, player-spawn hull clearance, and pickup support height. Results include implicated object references.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const issues = lintGameplay(snapshot.mapText);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, issueCount: issues.length, issues });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_analyze_jump_pad', {
    title: 'Analyze a Quake III jump-pad trajectory',
    description: 'Reproduce the engine AimAtTarget velocity for an existing trigger_push or proposed trigger bounds/apex. Returns timing, velocity, nominal landing, first plausible landing surface, and approximate player-hull clearance collisions.',
    inputSchema: {
      ...sessionInput,
      triggerRef: z.string().regex(/^E\d+$/, 'Expected a trigger_push entity reference such as E12').optional(),
      mins: vec3.optional().describe('Proposed trigger bounds; required with maxs and apex when triggerRef is omitted'),
      maxs: vec3.optional(),
      apex: vec3.optional().describe('The target_position is the trajectory apex, not the landing point'),
      gravity: z.number().positive().optional().describe('Defaults to worldspawn gravity or Quake III default 800'),
      sampleCount: z.number().int().min(4).max(128).optional().default(32),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, triggerRef, mins, maxs, apex, gravity, sampleCount }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const analysis = analyzeJumpPad(snapshot.mapText, { triggerRef, mins, maxs, apex, gravity, sampleCount });
      return toolResult({ sessionId: resolved, revision: snapshot.revision, ...analysis });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_route_lint', {
    title: 'Lint jump pads and approximate gameplay routes',
    description: 'Analyze every trigger_push trajectory and landing, then build a conservative platform graph connecting spawns, pickups, ordinary walk/jump transitions, and directed jump-pad routes. Results are editor heuristics, not AAS or engine playtest proof.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, ...lintRoutes(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_compile', {
    title: 'Compile the live map',
    description: 'Run the browser-based q3map toolchain against the current document and return BSP success, leak status, byte size, structured diagnostics with implicated references where possible, and complete compiler output. Fast runs BSP only; normal adds fast VIS and LIGHT; full uses configured full VIS and LIGHT settings.',
    inputSchema: {
      ...sessionInput,
      quality: z.enum(['fast', 'normal', 'full']).optional().default('fast'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, quality }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.compileMap(quality, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_play', {
    title: 'Compile and playtest the live map',
    description: 'Compile the current map and launch the resulting BSP in Q3Edit’s browser ioquake3 preview. Noclip enables cheats and starts the noclip command for route inspection.',
    inputSchema: {
      ...sessionInput,
      quality: z.enum(['fast', 'normal', 'full']).optional().default('normal'),
      noclip: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, quality, noclip }) => {
    try {
      const resolved = session(sessionId);
      const compile = await hub.compileMap(quality, resolved) as { success?: boolean; output?: string[] };
      if (!compile.success) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(compile, null, 2) }],
          structuredContent: sessionValue(resolved, compile),
        };
      }
      const launch = await hub.playMap(noclip, resolved);
      return toolResult({ sessionId: resolved, compile, launch }, `Compiled and launched editor session ${resolved} (${quality}${noclip ? ', noclip' : ''}).`);
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_groups', {
    title: 'List persistent map groups',
    description: 'List stable named groups and their current member references. Group names and IDs survive revisions, save, and reload.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, groups: inspectMapGroups(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_query', {
    title: 'Query live map objects',
    description: 'Find entities, brushes, or patches by classname, texture, entity property, and optional world-space bounds. Returns current-revision object references suitable for map_inspect or map_apply.',
    inputSchema: {
      ...sessionInput,
      kind: z.enum(['entity', 'brush', 'face', 'patch']).optional(),
      classname: z.string().optional().describe('Exact entity classname; geometry results are limited to geometry owned by matching entities'),
      texture: z.string().optional().describe('Case-insensitive texture name substring'),
      propertyKey: z.string().optional().describe('Entity property key that must exist'),
      propertyValue: z.string().optional().describe('Case-insensitive value substring; requires propertyKey'),
      group: z.string().optional().describe('Exact persistent group name or ID'),
      mins: compatibleVec3.optional().describe('Minimum world-space bounds; must be provided together with maxs'),
      maxs: compatibleVec3.optional().describe('Maximum world-space bounds; must be provided together with mins'),
      boundsMode: z.enum(['intersects', 'inside']).optional().default('intersects'),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, kind, classname, texture, propertyKey, propertyValue, group, mins, maxs, boundsMode, limit }) => {
    try {
      if ((mins && !maxs) || (!mins && maxs)) throw new Error('mins and maxs must be provided together');
      if (propertyValue !== undefined && !propertyKey) throw new Error('propertyValue requires propertyKey');
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const options: MapQueryOptions = {
        kind,
        classname,
        texture,
        propertyKey,
        propertyValue,
        group,
        bounds: mins && maxs ? {
          mins: mins as [number, number, number],
          maxs: maxs as [number, number, number],
          mode: boundsMode,
        } : undefined,
        limit,
      };
      const matches = queryMap(snapshot.mapText, options);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, count: matches.length, matches });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_search', {
    title: 'Search loaded textures',
    description: 'Search the texture assets currently loaded by Q3Edit. Use returned names when creating or texturing geometry.',
    inputSchema: {
      ...sessionInput,
      query: z.string().optional().default(''),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, query, limit }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.textureSearch(query, limit, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_preview', {
    title: 'Preview a loaded texture',
    description: 'Return an image preview for an exact texture name from texture_search.',
    inputSchema: { ...sessionInput, name: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, name }) => {
    try {
      const resolved = session(sessionId);
      const preview = await hub.texturePreview(name, resolved);
      return {
        content: [
          { type: 'text' as const, text: `Texture preview: ${preview.name}` },
          { type: 'image' as const, data: preview.data, mimeType: preview.mimeType },
        ],
        structuredContent: { sessionId: resolved, name: preview.name, mimeType: preview.mimeType },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_inspect', {
    title: 'Inspect texture and shader semantics',
    description: 'Return resolved image dimensions/source, complete parsed shader surfaceparms and q3map directives, stages and referenced images, skybox metadata, content/surface flags, transparency, emission, preview consistency, and compiler availability.',
    inputSchema: { ...sessionInput, name: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, name }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.textureInspect(name, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_preview_many', {
    title: 'Preview several loaded textures',
    description: 'Return image previews for up to 12 exact previewable names from texture_search, useful for choosing a coherent palette in one call.',
    inputSchema: { ...sessionInput, names: z.array(z.string().min(1)).min(1).max(12) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, names }) => {
    try {
      const resolved = session(sessionId);
      const previews = await hub.texturePreviews(names, resolved);
      return {
        content: previews.flatMap(preview => [
          { type: 'text' as const, text: preview.name },
          { type: 'image' as const, data: preview.data, mimeType: preview.mimeType },
        ]),
        structuredContent: { sessionId: resolved, textures: previews.map(({ name, mimeType }) => ({ name, mimeType })) },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('entity_class_search', {
    title: 'Search entity classes',
    description: 'Search Q3Edit entity definitions by classname, category, or description before creating an entity.',
    inputSchema: {
      ...sessionInput,
      query: z.string().optional().default(''),
      classType: z.enum(['point', 'brush']).optional(),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, query, classType, limit }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.entityClassSearch(query, classType, limit, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('entity_class_schema', {
    title: 'Get an entity class schema',
    description: 'Return the full live definition, defaults, typed properties, spawnflags, and required incoming/outgoing target relationships for an exact entity classname.',
    inputSchema: { ...sessionInput, classname: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, classname }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.entityClassSchema(classname, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_select', {
    title: 'Select objects in Q3Edit',
    description: 'Select current-revision entity, brush, or patch references in the live editor so the user can inspect them.',
    inputSchema: {
      ...sessionInput,
      refs: z.array(objectRef).min(1).max(100),
      replace: z.boolean().optional().default(true).describe('Replace the current selection; false adds to it'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, refs, replace }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.selectObjects(refs, replace, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_frame_objects', {
    title: 'Frame objects in Q3Edit',
    description: 'Select object references and move all editor viewports to frame that selection.',
    inputSchema: { ...sessionInput, refs: z.array(objectRef).min(1).max(100) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, refs }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.frameObjects(refs, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_set_camera', {
    title: 'Position the Q3Edit 3D camera',
    description: 'Set the live 3D viewport camera using world coordinates and degree angles. Yaw is rotation around Z; pitch is positive when looking upward.',
    inputSchema: {
      ...sessionInput,
      position: compatibleVec3,
      yawDegrees: z.number(),
      pitchDegrees: z.number().min(-89.8).max(89.8),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, position, yawDegrees, pitchDegrees }) => {
    try {
      const resolved = session(sessionId);
      await hub.setCamera(
        position as [number, number, number],
        yawDegrees * Math.PI / 180,
        pitchDegrees * Math.PI / 180,
        resolved,
      );
      return toolResult({ sessionId: resolved, position, yawDegrees, pitchDegrees });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_look_at', {
    title: 'Point the Q3Edit 3D camera at a target',
    description: 'Position the 3D camera and calculate yaw/pitch so it looks directly at a world-space target.',
    inputSchema: { ...sessionInput, position: compatibleVec3, target: compatibleVec3 },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, position, target }) => {
    try {
      const resolved = session(sessionId);
      const delta = target.map((value, axis) => value - position[axis]);
      const horizontal = Math.hypot(delta[0], delta[1]);
      if (horizontal < 1e-9 && Math.abs(delta[2]) < 1e-9) throw new Error('position and target must differ');
      const yaw = Math.atan2(delta[1], delta[0]);
      const pitch = Math.atan2(delta[2], horizontal);
      await hub.setCamera(position as [number, number, number], yaw, pitch, resolved);
      return toolResult({
        sessionId: resolved, position, target,
        yawDegrees: yaw * 180 / Math.PI,
        pitchDegrees: pitch * 180 / Math.PI,
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_screenshot', {
    title: 'Capture a controlled Q3Edit viewport',
    description: 'Render a perspective or orthographic PNG. The call can frame bounds/a named group and temporarily hide groups, entity markers, tool/sky brushes, or objects outside sectionBounds without modifying the document. xray produces a depth-free wireframe perspective.',
    inputSchema: {
      ...sessionInput,
      mode: z.enum(['perspective', 'top', 'front', 'side']).optional().default('perspective'),
      width: z.number().int().min(64).max(2048).optional(),
      height: z.number().int().min(64).max(2048).optional(),
      hideEntityMarkers: z.boolean().optional().default(false),
      hideGroups: z.array(z.string().min(1)).max(64).optional(),
      hideToolBrushes: z.boolean().optional().default(false),
      hideSkyBrushes: z.boolean().optional().default(false),
      sectionBounds: screenshotBounds.optional(),
      frameBounds: screenshotBounds.optional(),
      frameGroup: z.string().min(1).optional(),
      xray: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, ...options }) => {
    try {
      const resolved = session(sessionId);
      const screenshot = await hub.screenshot(options, resolved);
      return {
        content: [
          { type: 'text' as const, text: `Q3Edit ${options.mode} viewport · ${screenshot.width} × ${screenshot.height}` },
          { type: 'image' as const, data: screenshot.data, mimeType: screenshot.mimeType },
        ],
        structuredContent: {
          sessionId: resolved,
          mimeType: screenshot.mimeType,
          width: screenshot.width,
          height: screenshot.height,
          mode: options.mode,
        },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_screenshot', {
    title: 'Capture the compiled BSP playtest',
    description: 'Return a PNG from the browser ioquake3 preview with current lifecycle state, sampled mean luminance, and explicit black-frame detection. Call game_wait_ready first.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const screenshot = await hub.gameScreenshot(resolved);
      const warning = screenshot.blackFrame
        ? ` Warning: the captured frame is effectively black (mean luminance ${screenshot.meanLuminance.toFixed(2)}); inspect game_status for loading or renderer errors.`
        : '';
      return {
        content: [
          { type: 'text' as const, text: `Compiled BSP preview · ${screenshot.width} × ${screenshot.height}.${warning}` },
          { type: 'image' as const, data: screenshot.data, mimeType: screenshot.mimeType },
        ],
        structuredContent: {
          sessionId: resolved, mimeType: screenshot.mimeType, width: screenshot.width, height: screenshot.height,
          blackFrame: screenshot.blackFrame, meanLuminance: screenshot.meanLuminance, status: screenshot.status,
        },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_status', {
    title: 'Inspect compiled BSP preview status',
    description: 'Return ioquake3 lifecycle state, current map, noclip state, timestamps, last error, and recent stdout/stderr lines.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      return toolResult({ sessionId: resolved, ...(await hub.gameStatus(resolved)) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_wait_ready', {
    title: 'Wait for compiled BSP preview readiness',
    description: 'Wait until the ioquake3 preview reports running, fails, closes, or reaches the timeout. Use before game_screenshot.',
    inputSchema: {
      ...sessionInput,
      timeoutMs: z.number().int().min(100).max(120_000).optional().default(30_000),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, timeoutMs }) => {
    try {
      const resolved = session(sessionId);
      return toolResult({ sessionId: resolved, ...(await hub.waitForGameReady(timeoutMs, resolved)) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_command', {
    title: 'Run a safe compiled-preview command',
    description: 'Reliably relaunch the current compiled preview with a safe command. noclip enables cheats/noclip; restart reloads the current BSP.',
    inputSchema: { ...sessionInput, command: z.enum(['noclip', 'restart']) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, command }) => {
    try {
      const resolved = session(sessionId);
      return toolResult({ sessionId: resolved, ...(await hub.gameCommand(command, resolved)) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_set_view', {
    title: 'Position the compiled-preview player',
    description: 'Relaunch the current BSP in noclip at a world-space position and yaw. Follow with game_wait_ready before capturing a screenshot.',
    inputSchema: { ...sessionInput, position: vec3, yawDegrees: z.number() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, position, yawDegrees }) => {
    try {
      const resolved = session(sessionId);
      const status = await hub.setGameView(position, yawDegrees * Math.PI / 180, resolved);
      return toolResult({ sessionId: resolved, position, yawDegrees, ...status });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_preview', {
    title: 'Preview map operations without committing',
    description: 'Run an operation batch against an in-memory clone of the current revision. Returns generated references, aliases, object bounds, map counts, and diagnostics without changing the live document or undo history.',
    inputSchema: mapOperationBatchInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, label, operations, responseDetail }) => {
    try {
      const resolved = session(sessionId);
      const beforeSnapshot = hub.snapshot(resolved);
      const beforeGameplay = lintGameplay(beforeSnapshot.mapText);
      const preview = await hub.previewOperations(expectedRevision, label, validatedMapOperations(operations), resolved) as Record<string, unknown>;
      const previewMapText = typeof preview.mapText === 'string' ? preview.mapText : beforeSnapshot.mapText;
      const afterGameplay = lintGameplay(previewMapText);
      const issueKey = (issue: { code: string; message: string; refs: string[] }) => JSON.stringify([issue.code, issue.message, issue.refs]);
      const beforeKeys = new Set(beforeGameplay.map(issueKey));
      const afterKeys = new Set(afterGameplay.map(issueKey));
      const safePreview = { ...preview };
      delete safePreview.mapText;
      const gameplayLint = {
        beforeCount: beforeGameplay.length,
        afterCount: afterGameplay.length,
        added: afterGameplay.filter(issue => !beforeKeys.has(issueKey(issue))),
        resolved: beforeGameplay.filter(issue => !afterKeys.has(issueKey(issue))),
      };
      const previewResult: Record<string, unknown> = {
        ...safePreview,
        gameplayLint,
      };
      if (responseDetail === 'compact') {
        const created = Array.isArray(previewResult.created) ? previewResult.created as string[] : [];
        const changed = Array.isArray(previewResult.changed) ? previewResult.changed as string[] : [];
        const aliases = previewResult.aliases && typeof previewResult.aliases === 'object'
          ? previewResult.aliases as Record<string, string[]> : {};
        const objects = Array.isArray(previewResult.objects) ? previewResult.objects : [];
        return toolResult(sessionValue(resolved, {
          ...compactApplyResult({
            revision: Number(previewResult.revision), operationCount: Number(previewResult.operationCount),
            summary: `${previewResult.operationCount} operation preview`, created, changed, aliases,
          }),
          objects: { count: objects.length, sample: objects.slice(0, 8), truncated: objects.length > 8 },
          mapInfo: previewResult.mapInfo, diagnostics: previewResult.diagnostics, gameplayLint,
        }));
      }
      return toolResult(sessionValue(resolved, previewResult));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_create_jump_pad', {
    title: 'Create a wired jump pad',
    description: 'Atomically create a trigger_push volume and its target_position apex, wire their target keys, and place both in a persistent named group.',
    inputSchema: {
      ...sessionInput,
      expectedRevision: z.number().int().nonnegative(),
      mins: compatibleVec3,
      maxs: compatibleVec3,
      apex: compatibleVec3,
      targetname: z.string().min(1).max(64).optional(),
      group: z.string().min(1).max(120).optional().default('Jump Pad'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, mins, maxs, apex, targetname, group }) => {
    try {
      const resolved = session(sessionId);
      const link = targetname ?? `mcp_jump_${expectedRevision}`;
      const applied = await hub.applyOperations(expectedRevision, 'MCP: Create jump pad', [
        {
          type: 'create_jump_pad', id: 'jump_pad', mins: mins as [number, number, number],
          maxs: maxs as [number, number, number], apex: apex as [number, number, number], targetname: link, group,
        },
      ], resolved);
      return toolResult({ sessionId: resolved, ...applied.result, targetname: link, mapInfo: applied.snapshot.mapInfo, diagnostics: applied.snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_create_teleporter', {
    title: 'Create a wired teleporter',
    description: 'Atomically create a trigger_teleport volume and misc_teleporter_dest, wire their target keys, and place both in a persistent named group.',
    inputSchema: {
      ...sessionInput,
      expectedRevision: z.number().int().nonnegative(),
      mins: compatibleVec3,
      maxs: compatibleVec3,
      destination: compatibleVec3,
      exitAngle: z.number().optional().default(0),
      targetname: z.string().min(1).max(64).optional(),
      group: z.string().min(1).max(120).optional().default('Teleporter'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, mins, maxs, destination, exitAngle, targetname, group }) => {
    try {
      const resolved = session(sessionId);
      const link = targetname ?? `mcp_teleport_${expectedRevision}`;
      const applied = await hub.applyOperations(expectedRevision, 'MCP: Create teleporter', [
        {
          type: 'create_teleporter', id: 'teleporter', mins: mins as [number, number, number],
          maxs: maxs as [number, number, number], destination: destination as [number, number, number],
          exitAngle, targetname: link, group,
        },
      ], resolved);
      return toolResult({ sessionId: resolved, ...applied.result, targetname: link, mapInfo: applied.snapshot.mapInfo, diagnostics: applied.snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_apply', {
    title: 'Apply live map operations',
    description: 'Apply one atomic, undoable batch in the connected Q3Edit browser. Creation/clone/array operations accept an optional symbolic id; later operations in the batch can target @id. assign_group gives objects a stable persistent group for later map_query calls. Geometry includes primitives, wedges, stairs, convex plane brushes, and bulk entity/box arrays. edit_faces controls individual face textures, UV transforms, fit, and flags; set_brush_classification marks geometry detail or structural. Set responseDetail to compact for large batches and call operation_schema for exact fields.',
    inputSchema: mapOperationBatchInputSchema,
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, label, operations, responseDetail }) => {
    try {
      const resolved = session(sessionId);
      const validatedOperations = validatedMapOperations(operations);
      const applied = await hub.applyOperations(expectedRevision, label, validatedOperations, resolved);
      const result = responseDetail === 'compact' ? compactApplyResult(applied.result) : applied.result;
      const value = {
        sessionId: resolved,
        ...result,
        mapInfo: applied.snapshot.mapInfo,
        diagnostics: applied.snapshot.diagnostics,
      };
      const aliases = Object.keys(applied.result.aliases).length > 0
        ? `\nAliases: ${JSON.stringify((result as { aliases?: unknown }).aliases)}`
        : '';
      return toolResult(value, `${applied.result.summary}\nEditor session: ${resolved}\nRevision: ${applied.result.revision}${aliases}`);
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_new', {
    title: 'Create a new map document',
    description: 'Atomically replace one editor session with an empty or starter document. Requires the current revision, always preserves a valid worldspawn, resets the active save path, and can retain or override worldspawn properties.',
    inputSchema: {
      ...sessionInput,
      expectedRevision: z.number().int().nonnegative(),
      template: z.enum(['empty', 'starter']).optional().default('empty'),
      preserveWorldspawn: z.boolean().optional().default(true),
      worldspawnProperties: z.record(z.string(), z.string()).optional(),
      fileName: z.string().min(1).max(200).optional().default('untitled.map'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, template, preserveWorldspawn, worldspawnProperties, fileName }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = await hub.newMap({
        expectedRevision, template, preserveWorldspawn, worldspawnProperties, fileName,
      }, resolved);
      return toolResult({
        sessionId: resolved, fileName: snapshot.fileName, revision: snapshot.revision,
        mapInfo: snapshot.mapInfo, diagnostics: snapshot.diagnostics,
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_open', {
    title: 'Open map in Q3Edit',
    description: 'Read a local .map file and replace the connected browser document with it.',
    inputSchema: { ...sessionInput, path: z.string().min(1) },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, path }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = await hub.openMap(path, resolved);
      return toolResult({ sessionId: resolved, path, revision: snapshot.revision, mapInfo: snapshot.mapInfo, diagnostics: snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_save', {
    title: 'Save live map',
    description: 'Atomically save the connected browser document to the active path or a supplied local path.',
    inputSchema: { ...sessionInput, path: z.string().min(1).optional() },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, path }) => {
    try {
      const resolved = session(sessionId);
      const result = await hub.saveMap(path, resolved);
      return toolResult({ sessionId: resolved, ...result }, `Saved editor session ${resolved} revision ${result.revision} to ${result.path}`);
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_save_and_compile', {
    title: 'Save and compile the current map revision',
    description: 'Revision-check the selected document, atomically save it to the active or supplied path, then compile that live revision and return the save result plus structured compiler diagnostics.',
    inputSchema: {
      ...sessionInput,
      expectedRevision: z.number().int().nonnegative(),
      path: z.string().min(1).optional(),
      quality: z.enum(['fast', 'normal', 'full']).optional().default('normal'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, path, quality }) => {
    try {
      const resolved = session(sessionId);
      const current = hub.snapshot(resolved);
      if (current.revision !== expectedRevision) throw new Error(`Revision conflict: expected ${expectedRevision}, current revision is ${current.revision}`);
      const saved = await hub.saveMap(path, resolved);
      const compile = await hub.compileMap(quality, resolved) as Record<string, unknown>;
      return toolResult({ sessionId: resolved, saved, compile },
        `Saved revision ${saved.revision} to ${saved.path}; compile ${compile.success ? 'succeeded' : 'failed'} (${quality}).`);
    } catch (error) {
      return toolError(error);
    }
  });

  return server;
}
