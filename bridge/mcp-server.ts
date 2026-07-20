import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { BridgeHub } from './bridge-hub';
import { inspectMapObjects } from './map-inspection';
import type { MapObjectRef, MapOperation } from '../src/map-operations';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const compatibleVec3 = z.array(z.number()).length(3);
const objectRef = z.string().regex(/^E\d+(?::[BP]\d+)?$/, 'Expected an object reference such as E1, E0:B2, or E0:P0');

const mapOperation = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_entity'),
    classname: z.string().min(1),
    origin: vec3.optional(),
    properties: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('set_entity_properties'),
    target: objectRef,
    classname: z.string().min(1).optional(),
    properties: z.record(z.string(), z.string()).optional(),
    unset: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('create_box'),
    parent: objectRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('create_room'),
    parent: objectRef.optional(),
    mins: vec3,
    maxs: vec3,
    wallThickness: z.number().positive().optional(),
    textures: z.object({
      walls: z.string().min(1).optional(),
      floor: z.string().min(1).optional(),
      ceiling: z.string().min(1).optional(),
    }).optional(),
  }),
  z.object({ type: z.literal('translate'), targets: z.array(objectRef).min(1), delta: vec3 }),
  z.object({ type: z.literal('set_texture'), targets: z.array(objectRef).min(1), texture: z.string().min(1) }),
  z.object({ type: z.literal('delete'), targets: z.array(objectRef).min(1) }),
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
  classname: z.string().optional(),
  origin: compatibleVec3.optional(),
  properties: z.record(z.string(), z.string()).optional(),
  unset: z.array(z.string()).optional(),
  target: objectRef.optional(),
  targets: z.array(objectRef).optional(),
  parent: objectRef.optional(),
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
    instructions: 'Inspect map_status before editing. Use the returned revision as expectedRevision in map_apply. Group related changes into one map_apply call so they appear as one undo step in Q3Edit. Object references are revision-sensitive.',
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

  server.registerTool('map_apply', {
    title: 'Apply live map operations',
    description: 'Apply one atomic, undoable batch in the connected Q3Edit browser. Supported operation types: create_entity(classname, origin?, properties?), set_entity_properties(target, classname?, properties?, unset?), create_box(parent?, mins, maxs, texture?), create_room(parent?, mins, maxs, wallThickness?, textures?), translate(targets, delta), set_texture(targets, texture), delete(targets).',
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
