import { describe, expect, test, vi } from 'vitest';
import { Editor } from '../src/editor';

describe('editor map loading', () => {
  test('keeps parser diagnostics available and reports them in the status', () => {
    const editor = new Editor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    editor.loadMap(`
{
"classname" "worldspawn"
{
brushDef
{
}
}
}
`);

    expect(editor.mapDiagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning',
      line: 5,
      message: expect.stringContaining("Unsupported map block 'brushDef'"),
    }));
    expect(editor.statusMessage).toContain('Map loaded with 1 warning');
    expect(editor.statusMessage).toContain('line 5');
    expect(warn).toHaveBeenCalledWith('Map parse diagnostics', editor.mapDiagnostics);

    editor.newMap();
    expect(editor.mapDiagnostics).toEqual([]);
    warn.mockRestore();
  });
});
