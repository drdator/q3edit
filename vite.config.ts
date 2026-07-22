import { defineConfig, type Plugin } from 'vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { phosphorIconSubset } from './scripts/phosphor-icon-subset';
import { RELEASE_NOTES_HTML_MARKER, renderReleaseNotesHtml } from './scripts/release-notes-html';
import { loadReleaseNotes } from './scripts/release-notes-loader';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const RELEASE_NOTES_DIRECTORY = resolve(PROJECT_ROOT, 'src/release-notes');
const RELEASE_NOTES_MODULE_ID = 'virtual:q3edit-release-notes';
const RESOLVED_RELEASE_NOTES_MODULE_ID = `\0${RELEASE_NOTES_MODULE_ID}`;

function releaseNotes(): Plugin {
  return {
    name: 'q3edit-release-notes',
    resolveId(id) {
      if (id === RELEASE_NOTES_MODULE_ID) return RESOLVED_RELEASE_NOTES_MODULE_ID;
    },
    load(id) {
      if (id !== RESOLVED_RELEASE_NOTES_MODULE_ID) return;
      return `export const RELEASE_NOTES = ${JSON.stringify(loadReleaseNotes(RELEASE_NOTES_DIRECTORY))};`;
    },
    configureServer(server) {
      server.watcher.add(RELEASE_NOTES_DIRECTORY);
      let restarting = false;
      const restartForReleaseNotes = async (path: string) => {
        if (restarting || !path.startsWith(`${RELEASE_NOTES_DIRECTORY}/`) || !path.endsWith('.md')) return;
        restarting = true;
        await server.restart();
      };
      server.watcher.on('add', restartForReleaseNotes);
      server.watcher.on('change', restartForReleaseNotes);
      server.watcher.on('unlink', restartForReleaseNotes);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!context.filename.endsWith('release-notes.html')) return html;
        return html.replace(
          RELEASE_NOTES_HTML_MARKER,
          renderReleaseNotesHtml(loadReleaseNotes(RELEASE_NOTES_DIRECTORY)),
        );
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
  plugins: [releaseNotes(), phosphorIconSubset(PROJECT_ROOT)],
});
