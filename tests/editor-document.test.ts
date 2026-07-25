import { describe, expect, test, vi } from 'vitest';
import { Editor } from '../src/editor';
import { loadMapAsync } from '../src/editor-document';
import { parseMapWithDiagnostics } from '../src/mapfile';

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
});
