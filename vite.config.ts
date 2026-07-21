import { defineConfig } from 'vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { phosphorIconSubset } from './scripts/phosphor-icon-subset';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: 'public',
  build: {
    rollupOptions: {
      input: {
        main: resolve(PROJECT_ROOT, 'index.html'),
        releaseNotes: resolve(PROJECT_ROOT, 'release-notes.html'),
      },
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    hmr: false,
  },
  plugins: [phosphorIconSubset(PROJECT_ROOT)],
});
