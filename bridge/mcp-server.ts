import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { BridgeHub } from './bridge-hub';
import { inspectMapObjects } from './map-inspection';
import { queryMap, type MapQueryOptions } from './map-query';
import type { MapObjectRef, MapOperation } from '../src/map-operations';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const compatibleVec3 = z.array(z.number()).length(3);
const objectRef = z.string().regex(/^E\d+(?::[BP]\d+)?$/, 'Expected an object reference such as E1, E0:B2, or E0:P0');
const operationRef = z.string().regex(/^(?:E\d+(?::[BP]\d+)?|@[A-Za-z][A-Za-z0-9_-]{0,63})$/, 'Expected an object reference or symbolic reference such as @north_tower');
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
  z.object({ type: z.literal('translate'), targets: z.array(operationRef).min(1), delta: vec3 }),
  z.object({ type: z.literal('set_texture'), targets: z.array(operationRef).min(1), texture: z.string().min(1) }),
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
    'translate',
    'set_texture',
    'delete',
  ]),
  id: symbolicId.optional(),
  classname: z.string().optional(),
  origin: compatibleVec3.optional(),
  properties: z.record(z.string(), z.string()).optional(),
  unset: z.array(z.string()).optional(),
  target: operationRef.optional(),
  targets: z.array(operationRef).optional(),
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
  delta: compatibleVec3.optional(),
});

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

export function createQ3EditMcpServer(hub: BridgeHub): McpServer {
  const server = new McpServer({ name: 'q3edit-live', version: '0.1.0' }, {
    instructions: 'Inspect map_status before editing. Use map_query and the texture/entity discovery tools instead of guessing object, asset, or classname data. Use the returned revision as expectedRevision in map_apply. Group related changes into one map_apply call so they appear as one undo step in Q3Edit. Object references are revision-sensitive. Creation operations may declare id and later operations in the same batch may target @id.',
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
        objects: inspectMapObjects(snapshot.mapText, refs as MapObjectRef[], includeGeometry),
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

  server.registerTool('map_query', {
    title: 'Query live map objects',
    description: 'Find entities, brushes, or patches by classname, texture, entity property, and optional world-space bounds. Returns current-revision object references suitable for map_inspect or map_apply.',
    inputSchema: {
      kind: z.enum(['entity', 'brush', 'patch']).optional(),
      classname: z.string().optional().describe('Exact entity classname; geometry results are limited to geometry owned by matching entities'),
      texture: z.string().optional().describe('Case-insensitive texture name substring'),
      propertyKey: z.string().optional().describe('Entity property key that must exist'),
      propertyValue: z.string().optional().describe('Case-insensitive value substring; requires propertyKey'),
      mins: compatibleVec3.optional().describe('Minimum world-space bounds; must be provided together with maxs'),
      maxs: compatibleVec3.optional().describe('Maximum world-space bounds; must be provided together with mins'),
      boundsMode: z.enum(['intersects', 'inside']).optional().default('intersects'),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ kind, classname, texture, propertyKey, propertyValue, mins, maxs, boundsMode, limit }) => {
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
    description: 'Return the full live definition, defaults, typed properties, and spawnflags for an exact entity classname.',
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

  server.registerTool('editor_screenshot', {
    title: 'Capture the Q3Edit 3D viewport',
    description: 'Render and return a PNG of the live textured 3D viewport for visual review. Use editor_frame_objects or editor_set_camera first to control the view.',
    inputSchema: {
      width: z.number().int().min(64).max(2048).optional(),
      height: z.number().int().min(64).max(2048).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ width, height }) => {
    try {
      const screenshot = await hub.screenshot(width, height);
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

  server.registerTool('map_apply', {
    title: 'Apply live map operations',
    description: 'Apply one atomic, undoable batch in the connected Q3Edit browser. Creation operations accept an optional symbolic id; later operations in the batch can target @id. Supported types: create_entity(id?, classname, origin?, properties?), set_entity_properties(target, classname?, properties?, unset?), create_box(id?, parent?, mins, maxs, texture?), create_room(id?, parent?, mins, maxs, wallThickness?, textures?), translate(targets, delta), set_texture(targets, texture), delete(targets).',
    inputSchema: {
      expectedRevision: z.number().int().nonnegative(),
      label: z.string().min(1).max(120).describe('Undo label, for example MCP: Add side room'),
      operations: z.array(compatibleMapOperationInput).min(1).max(128),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ expectedRevision, label, operations }) => {
    try {
      const validatedOperations = operations.map((operation, index) => {
        const parsed = mapOperation.safeParse(operation);
        if (!parsed.success) {
          throw new Error(`Invalid operation ${index + 1}: ${z.prettifyError(parsed.error)}`);
        }
        return parsed.data as MapOperation;
      });
      const applied = await hub.applyOperations(expectedRevision, label, validatedOperations);
      return toolResult({
        ...applied.result,
        mapInfo: applied.snapshot.mapInfo,
        diagnostics: applied.snapshot.diagnostics,
      }, `${applied.result.summary}\nRevision: ${applied.result.revision}`);
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
