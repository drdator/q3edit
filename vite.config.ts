import { defineConfig, type Plugin } from 'vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { phosphorIconSubset } from './scripts/phosphor-icon-subset';
import { RELEASE_NOTES } from './src/release-notes-dialog';
import { RELEASE_NOTES_HTML_MARKER, renderReleaseNotesHtml } from './scripts/release-notes-html';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

function releaseNotesPage(): Plugin {
  return {
    name: 'q3edit-release-notes-page',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!context.filename.endsWith('release-notes.html')) return html;
        return html.replace(RELEASE_NOTES_HTML_MARKER, renderReleaseNotesHtml(RELEASE_NOTES));
      },
    },
  };
}

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
  plugins: [releaseNotesPage(), phosphorIconSubset(PROJECT_ROOT)],
});
