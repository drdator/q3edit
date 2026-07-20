import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { BridgeHub } from './bridge-hub';
import { inspectMapObjects } from './map-inspection';
import { inspectMapGroups, queryMap, type MapQueryOptions } from './map-query';
import type { MapDocumentRef, MapOperation } from '../src/map-operations';
import { lintGameplay } from './gameplay-lint';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const compatibleVec3 = z.array(z.number()).length(3);
const objectRef = z.string().regex(/^E\d+(?::[BP]\d+)?(?::F\d+)?$/, 'Expected an object reference such as E1, E0:B2, E0:B2:F4, or E0:P0');
const operationRef = z.string().regex(/^(?:E\d+(?::[BP]\d+)?|@[A-Za-z][A-Za-z0-9_-]{0,63})$/, 'Expected an object reference or symbolic reference such as @north_tower');
const faceRef = z.string().regex(/^(?:E\d+:B\d+:F\d+|@[A-Za-z][A-Za-z0-9_-]{0,63}(?::F\d+)?)$/, 'Expected a face reference such as E0:B2:F4, @trim, or @trim:F4');
const compatibleTargetRef = z.string().regex(/^(?:E\d+(?::[BP]\d+)?(?::F\d+)?|@[A-Za-z][A-Za-z0-9_-]{0,63}(?::F\d+)?)$/);
const symbolicId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);

const mapOperation = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_entity'),
    id: symbolicId.optional(),
    classname: z.string().min(1),
    origin: vec3.optional(),
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
    id: symbolicId.optional(),
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('create_room'),
    id: symbolicId.optional(),
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
    type: z.literal('create_primitive'),
    id: symbolicId.optional(),
    parent: operationRef.optional(),
    primitive: z.enum(['box', 'cylinder', 'cone', 'sphere', 'pyramid']),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    axis: z.enum(['x', 'y', 'z']).optional(),
    sides: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('create_wedge'),
    id: symbolicId.optional(),
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    direction: z.enum(['x+', 'x-', 'y+', 'y-']).optional(),
  }),
  z.object({
    type: z.literal('create_stairs'),
    id: symbolicId.optional(),
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    direction: z.enum(['x+', 'x-', 'y+', 'y-']).optional(),
    steps: z.number().int().min(2).max(64),
  }),
  z.object({
    type: z.literal('create_brush'),
    id: symbolicId.optional(),
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
  z.object({ type: z.literal('clone'), id: symbolicId.optional(), targets: z.array(operationRef).min(1), delta: vec3.optional() }),
  z.object({ type: z.literal('array'), id: symbolicId.optional(), targets: z.array(operationRef).min(1), copies: z.number().int().min(1).max(64), delta: vec3 }),
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
    type: z.literal('assign_group'),
    targets: z.array(operationRef).min(1),
    group: z.string().min(1).max(120),
    groupId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).optional(),
  }),
  z.object({ type: z.literal('remove_from_group'), targets: z.array(operationRef).min(1) }),
  z.object({ type: z.literal('delete'), targets: z.array(operationRef).min(1) }),
]);

// Keep the client-facing schema flat. Some MCP hosts omit tools whose JSON
// Schema contains nested oneOf/anyOf unions. Strict per-operation validation
// still happens in the handler through mapOperation below.
const compatibleMapOperationInput = z.object({
  type: z.enum([
    'create_entity',
    'set_entity_properties',
    'create_box',
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
    'assign_group',
    'remove_from_group',
    'delete',
  ]),
  id: symbolicId.optional(),
  classname: z.string().optional(),
  origin: compatibleVec3.optional(),
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
  group: z.string().optional(),
  groupId: z.string().optional(),
});

const mapOperationBatchInputSchema = {
  expectedRevision: z.number().int().nonnegative(),
  label: z.string().min(1).max(120).describe('Undo or preview label, for example MCP: Add side room'),
  operations: z.array(compatibleMapOperationInput).min(1).max(128),
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

export function createQ3EditMcpServer(hub: BridgeHub): McpServer {
  const server = new McpServer({ name: 'q3edit-live', version: '0.1.0' }, {
    instructions: 'Inspect map_status before editing. Use map_query, map_groups, and the texture/entity discovery tools instead of guessing object, asset, or classname data. Use the returned revision as expectedRevision in map_apply. Group related changes into one map_apply call so they appear as one undo step in Q3Edit. Object references are revision-sensitive. Creation operations may declare id and later operations in the same batch may target @id. Use assign_group when objects need a stable identity across later revisions or reloads.',
  });

  server.registerTool('map_status', {
    title: 'Get live Q3Edit map status',
    description: 'Return the connected editor, active map, revision, map counts, and diagnostics summary.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => toolResult(hub.status()));

  server.registerTool('map_entities', {
    title: 'List live map entities',
    description: 'List entity references, classnames, property counts, geometry counts, targets, and diagnostics.',
    inputSchema: {
      classname: z.string().optional().describe('Optional exact classname filter'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ classname }) => {
    try {
      const snapshot = hub.snapshot();
      const entities = classname ? snapshot.entities.filter(entity => entity.classname === classname) : snapshot.entities;
      return toolResult({ revision: snapshot.revision, entities });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_inspect', {
    title: 'Inspect live map objects',
    description: 'Return properties, bounds, textures, and optional geometry for current revision object references.',
    inputSchema: {
      refs: z.array(objectRef).min(1).max(50),
      includeGeometry: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ refs, includeGeometry }) => {
    try {
      const snapshot = hub.snapshot();
      return toolResult({
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
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try {
      const snapshot = hub.snapshot();
      return toolResult({ revision: snapshot.revision, diagnostics: snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_gameplay_lint', {
    title: 'Lint gameplay placement',
    description: 'Run approximate gameplay checks for point entities embedded in solids, player-spawn hull clearance, and pickup support height. Results include implicated object references.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try {
      const snapshot = hub.snapshot();
      const issues = lintGameplay(snapshot.mapText);
      return toolResult({ revision: snapshot.revision, issueCount: issues.length, issues });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_compile', {
    title: 'Compile the live map',
    description: 'Run the browser-based q3map toolchain against the current document and return BSP success, leak status, byte size, structured diagnostics with implicated references where possible, and complete compiler output. Fast runs BSP only; normal adds fast VIS and LIGHT; full uses configured full VIS and LIGHT settings.',
    inputSchema: {
      quality: z.enum(['fast', 'normal', 'full']).optional().default('fast'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ quality }) => {
    try {
      return toolResult(await hub.compileMap(quality));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_play', {
    title: 'Compile and playtest the live map',
    description: 'Compile the current map and launch the resulting BSP in Q3Edit’s browser ioquake3 preview. Noclip enables cheats and starts the noclip command for route inspection.',
    inputSchema: {
      quality: z.enum(['fast', 'normal', 'full']).optional().default('normal'),
      noclip: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ quality, noclip }) => {
    try {
      const compile = await hub.compileMap(quality) as { success?: boolean; output?: string[] };
      if (!compile.success) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(compile, null, 2) }],
          structuredContent: compile as Record<string, unknown>,
        };
      }
      const launch = await hub.playMap(noclip);
      return toolResult({ compile, launch }, `Compiled and launched the current map (${quality}${noclip ? ', noclip' : ''}).`);
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_groups', {
    title: 'List persistent map groups',
    description: 'List stable named groups and their current member references. Group names and IDs survive revisions, save, and reload.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try {
      const snapshot = hub.snapshot();
      return toolResult({ revision: snapshot.revision, groups: inspectMapGroups(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_query', {
    title: 'Query live map objects',
    description: 'Find entities, brushes, or patches by classname, texture, entity property, and optional world-space bounds. Returns current-revision object references suitable for map_inspect or map_apply.',
    inputSchema: {
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
  }, async ({ kind, classname, texture, propertyKey, propertyValue, group, mins, maxs, boundsMode, limit }) => {
    try {
      if ((mins && !maxs) || (!mins && maxs)) throw new Error('mins and maxs must be provided together');
      if (propertyValue !== undefined && !propertyKey) throw new Error('propertyValue requires propertyKey');
      const snapshot = hub.snapshot();
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
      return toolResult({ revision: snapshot.revision, count: matches.length, matches });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_search', {
    title: 'Search loaded textures',
    description: 'Search the texture assets currently loaded by Q3Edit. Use returned names when creating or texturing geometry.',
    inputSchema: {
      query: z.string().optional().default(''),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, limit }) => {
    try {
      return toolResult(await hub.textureSearch(query, limit));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_preview', {
    title: 'Preview a loaded texture',
    description: 'Return an image preview for an exact texture name from texture_search.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ name }) => {
    try {
      const preview = await hub.texturePreview(name);
      return {
        content: [
          { type: 'text' as const, text: `Texture preview: ${preview.name}` },
          { type: 'image' as const, data: preview.data, mimeType: preview.mimeType },
        ],
        structuredContent: { name: preview.name, mimeType: preview.mimeType },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_preview_many', {
    title: 'Preview several loaded textures',
    description: 'Return image previews for up to 12 exact previewable names from texture_search, useful for choosing a coherent palette in one call.',
    inputSchema: { names: z.array(z.string().min(1)).min(1).max(12) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ names }) => {
    try {
      const previews = await hub.texturePreviews(names);
      return {
        content: previews.flatMap(preview => [
          { type: 'text' as const, text: preview.name },
          { type: 'image' as const, data: preview.data, mimeType: preview.mimeType },
        ]),
        structuredContent: { textures: previews.map(({ name, mimeType }) => ({ name, mimeType })) },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('entity_class_search', {
    title: 'Search entity classes',
    description: 'Search Q3Edit entity definitions by classname, category, or description before creating an entity.',
    inputSchema: {
      query: z.string().optional().default(''),
      classType: z.enum(['point', 'brush']).optional(),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, classType, limit }) => {
    try {
      return toolResult(await hub.entityClassSearch(query, classType, limit));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('entity_class_schema', {
    title: 'Get an entity class schema',
    description: 'Return the full live definition, defaults, typed properties, spawnflags, and required incoming/outgoing target relationships for an exact entity classname.',
    inputSchema: { classname: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ classname }) => {
    try {
      return toolResult(await hub.entityClassSchema(classname));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_select', {
    title: 'Select objects in Q3Edit',
    description: 'Select current-revision entity, brush, or patch references in the live editor so the user can inspect them.',
    inputSchema: {
      refs: z.array(objectRef).min(1).max(100),
      replace: z.boolean().optional().default(true).describe('Replace the current selection; false adds to it'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ refs, replace }) => {
    try {
      return toolResult(await hub.selectObjects(refs, replace));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_frame_objects', {
    title: 'Frame objects in Q3Edit',
    description: 'Select object references and move all editor viewports to frame that selection.',
    inputSchema: { refs: z.array(objectRef).min(1).max(100) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ refs }) => {
    try {
      return toolResult(await hub.frameObjects(refs));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_set_camera', {
    title: 'Position the Q3Edit 3D camera',
    description: 'Set the live 3D viewport camera using world coordinates and degree angles. Yaw is rotation around Z; pitch is positive when looking upward.',
    inputSchema: {
      position: compatibleVec3,
      yawDegrees: z.number(),
      pitchDegrees: z.number().min(-89.8).max(89.8),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ position, yawDegrees, pitchDegrees }) => {
    try {
      await hub.setCamera(
        position as [number, number, number],
        yawDegrees * Math.PI / 180,
        pitchDegrees * Math.PI / 180,
      );
      return toolResult({ position, yawDegrees, pitchDegrees });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_look_at', {
    title: 'Point the Q3Edit 3D camera at a target',
    description: 'Position the 3D camera and calculate yaw/pitch so it looks directly at a world-space target.',
    inputSchema: { position: compatibleVec3, target: compatibleVec3 },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ position, target }) => {
    try {
      const delta = target.map((value, axis) => value - position[axis]);
      const horizontal = Math.hypot(delta[0], delta[1]);
      if (horizontal < 1e-9 && Math.abs(delta[2]) < 1e-9) throw new Error('position and target must differ');
      const yaw = Math.atan2(delta[1], delta[0]);
      const pitch = Math.atan2(delta[2], horizontal);
      await hub.setCamera(position as [number, number, number], yaw, pitch);
      return toolResult({
        position, target,
        yawDegrees: yaw * 180 / Math.PI,
        pitchDegrees: pitch * 180 / Math.PI,
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_screenshot', {
    title: 'Capture the Q3Edit 3D viewport',
    description: 'Render and return a PNG of the live textured 3D viewport for visual review. Use editor_frame_objects or editor_set_camera first to control the view.',
    inputSchema: {
      width: z.number().int().min(64).max(2048).optional(),
      height: z.number().int().min(64).max(2048).optional(),
      hideEntityMarkers: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ width, height, hideEntityMarkers }) => {
    try {
      const screenshot = await hub.screenshot(width, height, hideEntityMarkers);
      return {
        content: [
          { type: 'text' as const, text: `Q3Edit 3D viewport · ${screenshot.width} × ${screenshot.height}` },
          { type: 'image' as const, data: screenshot.data, mimeType: screenshot.mimeType },
        ],
        structuredContent: {
          mimeType: screenshot.mimeType,
          width: screenshot.width,
          height: screenshot.height,
        },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_screenshot', {
    title: 'Capture the compiled BSP playtest',
    description: 'Return a PNG from the currently running browser ioquake3 preview started by map_play.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try {
      const screenshot = await hub.gameScreenshot();
      return {
        content: [
          { type: 'text' as const, text: `Compiled BSP preview · ${screenshot.width} × ${screenshot.height}` },
          { type: 'image' as const, data: screenshot.data, mimeType: screenshot.mimeType },
        ],
        structuredContent: { mimeType: screenshot.mimeType, width: screenshot.width, height: screenshot.height },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_preview', {
    title: 'Preview map operations without committing',
    description: 'Run an operation batch against an in-memory clone of the current revision. Returns generated references, aliases, object bounds, map counts, and diagnostics without changing the live document or undo history.',
    inputSchema: mapOperationBatchInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ expectedRevision, label, operations }) => {
    try {
      return toolResult(await hub.previewOperations(expectedRevision, label, validatedMapOperations(operations)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_create_jump_pad', {
    title: 'Create a wired jump pad',
    description: 'Atomically create a trigger_push volume and its target_position apex, wire their target keys, and place both in a persistent named group.',
    inputSchema: {
      expectedRevision: z.number().int().nonnegative(),
      mins: compatibleVec3,
      maxs: compatibleVec3,
      apex: compatibleVec3,
      targetname: z.string().min(1).max(64).optional(),
      group: z.string().min(1).max(120).optional().default('Jump Pad'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ expectedRevision, mins, maxs, apex, targetname, group }) => {
    try {
      const link = targetname ?? `mcp_jump_${expectedRevision}`;
      const applied = await hub.applyOperations(expectedRevision, 'MCP: Create jump pad', [
        { type: 'create_entity', id: 'jump_trigger', classname: 'trigger_push', properties: { target: link } },
        { type: 'create_box', id: 'jump_volume', parent: '@jump_trigger', mins: mins as [number, number, number], maxs: maxs as [number, number, number], texture: 'common/trigger' },
        { type: 'create_entity', id: 'jump_apex', classname: 'target_position', origin: apex as [number, number, number], properties: { targetname: link } },
        { type: 'assign_group', targets: ['@jump_trigger', '@jump_apex'], group },
      ]);
      return toolResult({ ...applied.result, targetname: link, mapInfo: applied.snapshot.mapInfo, diagnostics: applied.snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_create_teleporter', {
    title: 'Create a wired teleporter',
    description: 'Atomically create a trigger_teleport volume and misc_teleporter_dest, wire their target keys, and place both in a persistent named group.',
    inputSchema: {
      expectedRevision: z.number().int().nonnegative(),
      mins: compatibleVec3,
      maxs: compatibleVec3,
      destination: compatibleVec3,
      exitAngle: z.number().optional().default(0),
      targetname: z.string().min(1).max(64).optional(),
      group: z.string().min(1).max(120).optional().default('Teleporter'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ expectedRevision, mins, maxs, destination, exitAngle, targetname, group }) => {
    try {
      const link = targetname ?? `mcp_teleport_${expectedRevision}`;
      const applied = await hub.applyOperations(expectedRevision, 'MCP: Create teleporter', [
        { type: 'create_entity', id: 'teleport_trigger', classname: 'trigger_teleport', properties: { target: link } },
        { type: 'create_box', id: 'teleport_volume', parent: '@teleport_trigger', mins: mins as [number, number, number], maxs: maxs as [number, number, number], texture: 'common/trigger' },
        { type: 'create_entity', id: 'teleport_destination', classname: 'misc_teleporter_dest', origin: destination as [number, number, number], properties: { targetname: link, angle: String(exitAngle) } },
        { type: 'assign_group', targets: ['@teleport_trigger', '@teleport_destination'], group },
      ]);
      return toolResult({ ...applied.result, targetname: link, mapInfo: applied.snapshot.mapInfo, diagnostics: applied.snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_apply', {
    title: 'Apply live map operations',
    description: 'Apply one atomic, undoable batch in the connected Q3Edit browser. Creation/clone/array operations accept an optional symbolic id; later operations in the batch can target @id. assign_group gives objects a stable persistent group for later map_query calls. Geometry includes primitives, wedges, stairs, and convex plane brushes. edit_faces controls individual face textures, UV transforms, fit, and flags; set_brush_classification marks geometry detail or structural. Use the advertised schema for exact fields.',
    inputSchema: mapOperationBatchInputSchema,
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ expectedRevision, label, operations }) => {
    try {
      const validatedOperations = validatedMapOperations(operations);
      const applied = await hub.applyOperations(expectedRevision, label, validatedOperations);
      const value = {
        ...applied.result,
        mapInfo: applied.snapshot.mapInfo,
        diagnostics: applied.snapshot.diagnostics,
      };
      const aliases = Object.keys(applied.result.aliases).length > 0
        ? `\nAliases: ${JSON.stringify(applied.result.aliases)}`
        : '';
      return toolResult(value, `${applied.result.summary}\nRevision: ${applied.result.revision}${aliases}`);
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_open', {
    title: 'Open map in Q3Edit',
    description: 'Read a local .map file and replace the connected browser document with it.',
    inputSchema: { path: z.string().min(1) },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ path }) => {
    try {
      const snapshot = await hub.openMap(path);
      return toolResult({ path, revision: snapshot.revision, mapInfo: snapshot.mapInfo, diagnostics: snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_save', {
    title: 'Save live map',
    description: 'Atomically save the connected browser document to the active path or a supplied local path.',
    inputSchema: { path: z.string().min(1).optional() },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ path }) => {
    try {
      const result = await hub.saveMap(path);
      return toolResult(result, `Saved revision ${result.revision} to ${result.path}`);
    } catch (error) {
      return toolError(error);
    }
  });

  return server;
}
