import { describe, expect, it } from 'vitest';
import { buildSourceFingerprint, type BuildRecord } from '../src/build-history';
import { selectReleaseBuild } from '../src/release-package-dialog';

function build(documentRevision: number, source?: string, region = false): BuildRecord {
  return {
    id: String(documentRevision),
    fileName: 'test.map',
    documentRevision,
    quality: 'normal',
    region,
    compileSourceFingerprint: source ? buildSourceFingerprint(source) : undefined,
    startedAt: documentRevision,
    durationMs: 1,
    success: true,
    reused: false,
    stages: [],
    statistics: null,
    diagnostics: [],
    output: [],
    bsp: new Uint8Array([documentRevision]),
    aas: null,
    portalFileText: null,
  };
}

describe('release package build selection', () => {
  it('uses only a successful build from the current document revision', () => {
    expect(selectReleaseBuild([build(3), build(2)], 2)?.documentRevision).toBe(2);
    expect(selectReleaseBuild([build(3), build(2)], 4)).toBeNull();
  });

  it('reuses a non-region build when only compiler-neutral metadata changed', () => {
    const source = '{\n"classname" "worldspawn"\n}\n';
    expect(selectReleaseBuild([build(2, source)], 3, buildSourceFingerprint(source))?.documentRevision).toBe(2);
    expect(selectReleaseBuild([build(2, source)], 3, buildSourceFingerprint(`${source}// changed`))).toBeNull();
    expect(selectReleaseBuild([build(3, source, true)], 3, buildSourceFingerprint(source))).toBeNull();
  });
});
