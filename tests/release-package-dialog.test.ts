import { describe, expect, it } from 'vitest';
import type { BuildRecord } from '../src/build-history';
import { selectReleaseBuild } from '../src/release-package-dialog';

function build(documentRevision: number): BuildRecord {
  return {
    id: String(documentRevision),
    fileName: 'test.map',
    documentRevision,
    quality: 'normal',
    region: false,
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
});
