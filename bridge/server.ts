import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { WebSocketServer } from 'ws';
import { BridgeHub } from './bridge-hub';
import { createQ3EditMcpServer } from './mcp-server';
import { McpActivityLog } from './activity-log';
import {
  allowedEditorOrigins,
  authorizeEditorConnection,
  createEditorPairingToken,
  DEFAULT_PRODUCTION_EDITOR_URL,
  editorCompanionUrls,
} from './editor-companion';

interface ServerOptions {
  host: string;
  port: number;
  logDirectory?: string;
  editorUrl: string;
  editorOrigins: string[];
  pairingToken: string;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const options: ServerOptions = {
  host: optionValue('--host') ?? '127.0.0.1',
  port: Number(optionValue('--port') ?? 8765),
  logDirectory: optionValue('--log-dir'),
  editorUrl: optionValue('--editor-url') ?? process.env.Q3EDIT_EDITOR_URL ?? DEFAULT_PRODUCTION_EDITOR_URL,
  editorOrigins: (optionValue('--editor-origins') ?? process.env.Q3EDIT_EDITOR_ORIGINS ?? '').split(',').filter(Boolean),
  pairingToken: optionValue('--pairing-token') ?? createEditorPairingToken(),
};

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distPath = resolve(projectRoot, 'dist');
const q3mapDistPath = resolve(projectRoot, 'q3map-compiler/dist');
const bspcDistPath = resolve(projectRoot, 'bspc-compiler/dist');
const activityLogPath = resolve(options.logDirectory ?? resolve(projectRoot, '.q3edit/mcp-logs'));
const companionUrls = editorCompanionUrls(options.host, options.port, options.pairingToken, options.editorUrl);
const permittedEditorOrigins = allowedEditorOrigins(options.host, options.port, options.editorUrl, options.editorOrigins);
if (!existsSync(distPath)) throw new Error(`Missing ${distPath}; run npm run build first`);

const hub = new BridgeHub(existsSync(q3mapDistPath));
const app = createMcpExpressApp({ host: options.host });
const transports = new Map<string, StreamableHTTPServerTransport>();

app.use((_, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport && !sessionId && isInitializeRequest(req.body)) {
      const newSessionId = randomUUID();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: id => {
          transports.set(id, transport!);
        },
      });
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };
      const activityLog = new McpActivityLog(activityLogPath, newSessionId, entry => hub.publishMcpActivity(entry));
      await createQ3EditMcpServer(hub, activityLog).connect(transport);
    }
    if (!transport) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid or missing MCP session' }, id: null });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request failed', error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  }
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Missing or invalid MCP session');
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Missing or invalid MCP session');
    return;
  }
  await transport.handleRequest(req, res);
});

app.get('/bridge/status', (_, res) => res.json({ sessions: hub.listSessions() }));
if (existsSync(q3mapDistPath)) app.use('/q3map-compiler/dist', express.static(q3mapDistPath));
else console.warn(`q3map artifacts are unavailable at ${q3mapDistPath}; run npm run build:q3map to enable map_compile`);
if (existsSync(bspcDistPath)) app.use('/bspc-compiler/dist', express.static(bspcDistPath));
else console.warn(`BSPC artifacts are unavailable at ${bspcDistPath}; run npm run build:bspc to enable bot navigation generation`);
app.use(express.static(distPath));

const httpServer = app.listen(options.port, options.host, error => {
  if (error) throw error;
  console.log(`Q3Edit pairing code: ${options.pairingToken}`);
  console.log(`Production editor:   ${companionUrls.productionEditorUrl}`);
  console.log(`Local editor:        ${companionUrls.localEditorUrl}`);
  console.log(`MCP endpoint:        http://${options.host}:${options.port}/mcp`);
  console.log(`MCP activity logs:  ${activityLogPath}`);
});

const webSockets = new WebSocketServer({
  server: httpServer,
  path: '/editor',
  verifyClient: (info, done) => {
    const authorization = authorizeEditorConnection({ requestUrl: info.req.url ?? '/editor', origin: info.origin }, options.pairingToken, permittedEditorOrigins);
    if (!authorization.allowed) console.warn(`Rejected editor connection: ${authorization.message}`);
    done(authorization.allowed, authorization.statusCode, authorization.message);
  },
});
webSockets.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/editor', `http://${request.headers.host ?? '127.0.0.1'}`);
  hub.attachEditor(socket, url.searchParams.get('sessionId') ?? undefined);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal}: shutting down Q3Edit live bridge...`);

  const forcedExit = setTimeout(() => {
    console.error('Bridge shutdown timed out; forcing exit');
    process.exit(1);
  }, 2_000);
  forcedExit.unref();

  await Promise.allSettled([...transports.values()].map(transport => transport.close()));
  transports.clear();

  // WebSocketServer.close() waits for connected clients. Explicitly terminate
  // the live editor sockets so an open browser tab cannot keep Ctrl-C hanging.
  for (const socket of webSockets.clients) socket.terminate();

  await Promise.all([
    new Promise<void>(resolveClose => webSockets.close(() => resolveClose())),
    new Promise<void>(resolveClose => httpServer.close(() => resolveClose())),
  ]);
  clearTimeout(forcedExit);
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
