import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpActivityLog } from '../activity-log';
import type { BridgeHub } from '../bridge-hub';

export function installMcpActivityLogging(
  server: McpServer,
  hub: BridgeHub,
  activityLog: McpActivityLog | undefined,
  selectedEditorSessionId: () => string | undefined,
): void {
  if (!activityLog) return;
  const registerTool = server.registerTool.bind(server) as any;
  server.registerTool = ((name: string, config: unknown, callback: (...args: any[]) => any) => {
    const readOnly = (config as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint === true;
    return registerTool(name, config as any, async (args: Record<string, unknown>, extra: unknown) => {
      const startedAt = Date.now();
      const requestedSessionId = typeof args.sessionId === 'string' ? args.sessionId : selectedEditorSessionId();
      let editorSessionId: string | null = null;
      try { editorSessionId = hub.resolveSessionId(requestedSessionId); } catch { /* Tools may not target an editor. */ }
      const revision = (): number | null => {
        if (!editorSessionId) return null;
        try { return hub.status(editorSessionId).snapshot?.revision ?? null; } catch { return null; }
      };
      const revisionBefore = revision();
      let result: any;
      try {
        result = await callback(args, extra);
      } catch (error) {
        try {
          await activityLog.record({
            editorSessionId, tool: name, readOnly, durationMs: Date.now() - startedAt, status: 'error',
            revisionBefore, revisionAfter: revision(), revisionDelta: null,
            arguments: args, result: { thrown: error instanceof Error ? error.message : String(error) },
          });
        } catch (logError) {
          console.error('Failed to record MCP activity', logError);
        }
        throw error;
      }
      const revisionAfter = revision();
      try {
        await activityLog.record({
          editorSessionId, tool: name, readOnly, durationMs: Date.now() - startedAt, status: result?.isError ? 'error' : 'success',
          revisionBefore, revisionAfter,
          revisionDelta: revisionBefore === null || revisionAfter === null ? null : revisionAfter - revisionBefore,
          arguments: args,
          result: result?.structuredContent ?? { isError: result?.isError === true, content: result?.content },
        });
      } catch (logError) {
        console.error('Failed to record MCP activity', logError);
      }
      return result;
    });
  }) as typeof server.registerTool;
}
