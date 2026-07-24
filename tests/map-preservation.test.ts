import { describe, expect, it } from 'vitest';
import { Editor } from '../src/editor';
import { analyzeMapSaveSafety } from '../src/editor-document';

const sourceWithUnsupportedBlock = `// preserved heading
{
"classname" "worldspawn"
{
brushDef3
{
opaque payload
}
}
}
`;

describe('map source preservation', () => {
  it('returns the original source byte-for-byte before the document changes', () => {
    const editor = new Editor();
    editor.loadMap(sourceWithUnsupportedBlock);

    expect(editor.serializeMap()).toBe(sourceWithUnsupportedBlock);
    expect(editor.unsupportedMapConstructs).toEqual([
      expect.objectContaining({ keyword: 'brushDef3', line: 5, endLine: 9 }),
    ]);
    expect(analyzeMapSaveSafety(editor)).toMatchObject({
      safe: true,
      preservesOriginalText: true,
      requiresReviewedExport: false,
    });
  });

  it('requires reviewed export after an edit would drop unsupported source or comments', () => {
    const editor = new Editor();
    editor.loadMap(sourceWithUnsupportedBlock);
    editor.transact('Edit message', () => {
      editor.worldspawn.properties.message = 'changed';
    });

    const safety = analyzeMapSaveSafety(editor);
    expect(safety.safe).toBe(false);
    expect(safety.requiresReviewedExport).toBe(true);
    expect(safety.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('unsupported map block'),
      expect.stringContaining('comments and formatting'),
    ]));
    expect(editor.serializeMap()).toContain('"message" "changed"');
    expect(editor.serializeMap()).not.toContain('brushDef3');
  });

  it('allows normal structural serialization for edited maps without lossy source content', () => {
    const editor = new Editor();
    editor.loadMap('{\n"classname" "worldspawn"\n}\n');
    editor.transact('Edit message', () => {
      editor.worldspawn.properties.message = 'safe';
    });
    expect(analyzeMapSaveSafety(editor)).toMatchObject({
      safe: true,
      requiresReviewedExport: false,
    });
  });
});
