import { describe, expect, test, vi } from 'vitest';
import { Editor } from '../src/editor';
import { loadMapAsync } from '../src/editor-document';
import { parseMapWithDiagnostics } from '../src/mapfile';
import { MAP_PROJECT_CONFIG_KEY } from '../src/project-config';

describe('editor map loading', () => {
  test('keeps parser diagnostics available and reports them in the status', () => {
    const editor = new Editor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    editor.loadMap(`
{
"classname" "worldspawn"
{
brushDef3
{
}
}
}
`);

    expect(editor.mapDiagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning',
      line: 5,
      message: expect.stringContaining("Unsupported map block 'brushDef3'"),
    }));
    expect(editor.statusMessage).toContain('Map loaded with 1 warning');
    expect(editor.statusMessage).toContain('line 5');
    expect(warn).toHaveBeenCalledWith('Map parse diagnostics', editor.mapDiagnostics);

    editor.newMap();
    expect(editor.mapDiagnostics).toEqual([]);
    expect(editor.entities).toHaveLength(1);
    expect(editor.worldspawn.classname).toBe('worldspawn');
    warn.mockRestore();
  });

  test('normalizes an empty map to the worldspawn document invariant', () => {
    const editor = new Editor();

    editor.loadMap('');

    expect(editor.entities).toHaveLength(1);
    expect(editor.worldspawn.properties.classname).toBe('worldspawn');
  });

  test('restores filename and source metadata when open and new map are undone', async () => {
    const editor = new Editor();
    editor.fileName = 'before.map';
    editor.worldspawn.properties.message = 'before';
    editor.originalMapSource = {
      text: editor.serializeMap(),
      revision: editor.documentRevision,
      unsupportedConstructs: [],
      hasComments: false,
    };
    editor.markDocumentSaved();

    await loadMapAsync(editor, `
{
"classname" "worldspawn"
"message" "opened"
}
`, 'opened.map');
    expect(editor.fileName).toBe('opened.map');
    editor.undo();
    expect(editor.fileName).toBe('before.map');
    expect(editor.worldspawn.properties.message).toBe('before');
    expect(editor.originalMapSource?.text).toContain('"message" "before"');
    expect(editor.hasUnsavedChanges).toBe(false);
    editor.redo();
    expect(editor.fileName).toBe('opened.map');
    expect(editor.worldspawn.properties.message).toBe('opened');

    editor.newMap();
    expect(editor.fileName).toBe('untitled.map');
    editor.undo();
    expect(editor.fileName).toBe('opened.map');
    expect(editor.worldspawn.properties.message).toBe('opened');
  });

  test('ignores an asynchronous map parse superseded by a newer open request', async () => {
    type WorkerMessage = {
      requestId: string;
      result: ReturnType<typeof parseMapWithDiagnostics>;
    };
    class FakeWorker {
      static instances: FakeWorker[] = [];
      onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      requestId = '';
      text = '';

      constructor() { FakeWorker.instances.push(this); }
      postMessage(message: { requestId: string; text: string }): void {
        this.requestId = message.requestId;
        this.text = message.text;
      }
      terminate(): void {}
      resolve(): void {
        this.onmessage?.({
          data: { requestId: this.requestId, result: parseMapWithDiagnostics(this.text) },
        } as MessageEvent<WorkerMessage>);
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const editor = new Editor();
    const first = loadMapAsync(editor, '{\n"classname" "worldspawn"\n"message" "first"\n}\n', 'first.map');
    const second = loadMapAsync(editor, '{\n"classname" "worldspawn"\n"message" "second"\n}\n', 'second.map');

    FakeWorker.instances[1].resolve();
    await expect(second).resolves.toBe(true);
    FakeWorker.instances[0].resolve();
    await expect(first).resolves.toBe(false);

    expect(editor.fileName).toBe('second.map');
    expect(editor.worldspawn.properties.message).toBe('second');
    vi.unstubAllGlobals();
  });

  test('embeds project settings, restores them on open, and excludes them from compile maps', () => {
    const editor = new Editor();
    const project = structuredClone(editor.projectConfiguration);
    project.name = 'Map-local project';
    project.game.gameDirectory = 'arena';
    project.assets.archives = ['pak0.pk3', 'arena.pk3'];
    project.compile.bspArgs = ['-meta'];
    project.overrides.gridSize = 32;

    editor.updateProjectConfiguration(project, { notify: false });
    const mapText = editor.serializeMap();
    expect(mapText).toContain(`"${MAP_PROJECT_CONFIG_KEY}"`);
    expect(editor.serializeCompileMap()).not.toContain(MAP_PROJECT_CONFIG_KEY);
    expect(editor.hasUnsavedChanges).toBe(true);

    const reopened = new Editor();
    reopened.loadMap(mapText);
    expect(reopened.projectConfiguration).toEqual(project);
    expect(reopened.gridSize).toBe(32);
    expect(reopened.hasUnsavedChanges).toBe(false);
  });

  test('restores project settings and embedded metadata through undo and redo', () => {
    const editor = new Editor();
    const original = structuredClone(editor.projectConfiguration);
    const changed = structuredClone(original);
    changed.name = 'Undoable project';
    changed.compile.lightArgs = ['-fast'];

    editor.updateProjectConfiguration(changed, { notify: false });
    expect(editor.projectConfiguration).toEqual(changed);
    expect(editor.worldspawn.properties[MAP_PROJECT_CONFIG_KEY]).toBeTruthy();

    editor.undo();
    expect(editor.projectConfiguration).toEqual(original);
    expect(editor.worldspawn.properties[MAP_PROJECT_CONFIG_KEY]).toBeUndefined();

    editor.redo();
    expect(editor.projectConfiguration).toEqual(changed);
    expect(editor.worldspawn.properties[MAP_PROJECT_CONFIG_KEY]).toBeTruthy();
  });
});
