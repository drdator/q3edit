import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Allow serving large PK3 files
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Serve baseq3/ as static files at /baseq3/
  publicDir: false,
});
