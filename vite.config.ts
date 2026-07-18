import { defineConfig } from 'vite';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { phosphorIconSubset } from './scripts/phosphor-icon-subset';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: 'public',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    hmr: false,
  },
  plugins: [phosphorIconSubset(PROJECT_ROOT)],
});
