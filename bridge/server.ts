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

interface ServerOptions {
  host: string;
  port: number;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const options: ServerOptions = {
  host: optionValue('--host') ?? '127.0.0.1',
  port: Number(optionValue('--port') ?? 8765),
};

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distPath = resolve(projectRoot, 'dist');
if (!existsSync(distPath)) throw new Error(`Missing ${distPath}; run npm run build first`);

const hub = new BridgeHub();
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
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: id => {
          transports.set(id, transport!);
        },
      });
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };
      await createQ3EditMcpServer(hub).connect(transport);
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

app.get('/bridge/status', (_, res) => res.json(hub.status()));
app.use(express.static(distPath));

const httpServer = app.listen(options.port, options.host, error => {
  if (error) throw error;
  console.log(`Q3Edit live bridge: http://${options.host}:${options.port}/?editor&bridge=1`);
  console.log(`MCP endpoint:       http://${options.host}:${options.port}/mcp`);
});

const webSockets = new WebSocketServer({ server: httpServer, path: '/editor' });
webSockets.on('connection', socket => hub.attachEditor(socket));

process.on('SIGINT', async () => {
  for (const transport of transports.values()) await transport.close();
  webSockets.close();
  httpServer.close(() => process.exit(0));
});
