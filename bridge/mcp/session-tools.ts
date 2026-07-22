import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { McpActivityLog } from '../activity-log';
import type { BridgeHub } from '../bridge-hub';
import { toolError, toolResult } from './tool-result';

const editorSessionId = z.string().min(1).max(160);
const activityLogOutputSchema = z.object({
  enabled: z.boolean(), filePath: z.string().nullable(), mcpSessionId: z.string().nullable(), count: z.number().int(),
  filteredCount: z.number().int(), returnedCount: z.number().int(), nextCursor: z.string().nullable(),
  entries: z.array(z.object({
    id: z.string(), timestamp: z.string(), mcpSessionId: z.string(), editorSessionId: z.string().nullable(), tool: z.string(),
    readOnly: z.boolean(),
    durationMs: z.number(), status: z.enum(['success', 'error']),
    revisionBefore: z.number().int().nullable(), revisionAfter: z.number().int().nullable(), revisionDelta: z.number().int().nullable(),
    arguments: z.unknown().optional(), result: z.unknown().optional(),
  })),
});

export interface EditorSessionSelection {
  selectedEditorSessionId?: string;
}

export function registerSessionTools(
  server: McpServer,
  hub: BridgeHub,
  selection: EditorSessionSelection,
  activityLog?: McpActivityLog,
): void {
  server.registerTool('editor_sessions', {
    title: 'List connected Q3Edit editor sessions',
    description: 'List stable browser-tab session IDs with filenames, revisions, active save paths, and activity timestamps. Use this before document tools when multiple editors are open.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => toolResult({
    selectedSessionId: selection.selectedEditorSessionId ?? null,
    sessions: hub.listSessions(),
  }));

  server.registerTool('activity_log', {
    title: 'Inspect this MCP session activity log',
    description: 'Return recent tool calls from this MCP connection, including target editor session, duration, status, summarized arguments/results, and revision deltas. The complete append-only JSONL transcript is written to filePath.',
    inputSchema: z.object({
      editorSessionId: editorSessionId.optional().describe('Optionally filter entries to one editor tab'),
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Maximum entries in this page; defaults to 50'),
      cursor: z.string().min(1).optional().describe('Opaque nextCursor from the previous response for older activity'),
      responseDetail: z.enum(['summary', 'full']).optional().default('summary')
        .describe('summary omits recorded arguments and results; full includes their bounded activity-log representations'),
    }).meta({ required: [] }),
    outputSchema: activityLogOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ editorSessionId: requestedSessionId, limit, cursor, responseDetail }) => {
    try {
      const page = activityLog?.page(limit, cursor, requestedSessionId) ?? { entries: [], nextCursor: null, filteredCount: 0 };
      const entries = responseDetail === 'full' ? page.entries : page.entries.map(({ arguments: _arguments, result: _result, ...entry }) => entry);
      return toolResult({
        enabled: Boolean(activityLog), filePath: activityLog?.filePath ?? null,
        mcpSessionId: activityLog?.mcpSessionId ?? null, count: activityLog?.count ?? 0,
        filteredCount: page.filteredCount, returnedCount: entries.length, nextCursor: page.nextCursor, entries,
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_session_select', {
    title: 'Select a Q3Edit editor session',
    description: 'Set the default editor session for subsequent tools on this MCP connection; explicit sessionId arguments still override it. Returns the selected session ID and its current map status.',
    inputSchema: {
      sessionId: editorSessionId.describe('Stable browser-tab session ID returned by editor_sessions, e.g. "editor-7f3a"'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      selection.selectedEditorSessionId = hub.resolveSessionId(sessionId);
      return toolResult({
        selectedSessionId: selection.selectedEditorSessionId,
        status: hub.status(selection.selectedEditorSessionId),
      });
    } catch (error) {
      return toolError(error);
    }
  });
}
