import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';

const Q3_DATA = join(process.env.HOME || '', 'Library/Application Support/Quake3');
const Q3_MAPS = join(Q3_DATA, 'baseq3/maps');
const IOQUAKE3 = '/Applications/ioquake3/ioquake3.app/Contents/MacOS/ioquake3';

export default defineConfig({
  publicDir: 'public',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    hmr: false,
  },
  plugins: [{
    name: 'run-map',
    configureServer(server) {
      server.middlewares.use('/api/run-map', async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end('Method not allowed');
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString());

        const mapName: string = (body.name || 'compile').replace(/[^a-zA-Z0-9_-]/g, '');
        const bspData: number[] = body.bsp;

        try {
          mkdirSync(Q3_MAPS, { recursive: true });
          const bspPath = join(Q3_MAPS, `${mapName}.bsp`);
          writeFileSync(bspPath, Buffer.from(bspData));

          // Launch ioquake3 directly; sv_pure 0 allows loading loose BSP files
          spawn(IOQUAKE3, ['+set', 'sv_pure', '0', '+devmap', mapName], {
            detached: true,
            stdio: 'ignore',
          }).unref();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: bspPath }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    }
  }],
});
