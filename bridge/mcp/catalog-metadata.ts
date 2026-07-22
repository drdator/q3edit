import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

type SchemaLike = z.ZodType | z.ZodRawShape;

function asObjectSchema(schema: SchemaLike): z.ZodType {
  return typeof (schema as z.ZodType).safeParse === 'function'
    ? schema as z.ZodType
    : z.object(schema as z.ZodRawShape);
}

/**
 * Zod omits JSON Schema's `required` keyword when every top-level field is
 * optional. The meaning is valid but less explicit to tool consumers. Preserve
 * runtime parsing while publishing `required: []` for those schemas.
 */
export function installExplicitRequiredArrays(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as any;
  server.registerTool = ((name: string, config: any, callback: (...args: any[]) => any) => {
    const inputSchema = config.inputSchema as SchemaLike | undefined;
    if (!inputSchema) return registerTool(name, config, callback);
    const objectSchema = asObjectSchema(inputSchema);
    const publishedSchema = objectSchema.safeParse({}).success
      ? objectSchema.meta({ required: [] })
      : objectSchema;
    return registerTool(name, { ...config, inputSchema: publishedSchema }, callback);
  }) as typeof server.registerTool;
}
