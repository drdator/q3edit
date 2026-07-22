import { describe, expect, it } from 'vitest';
import {
  allowedEditorOrigins,
  authorizeEditorConnection,
  createEditorPairingToken,
  editorCompanionUrls,
} from '../bridge/editor-companion';

describe('local MCP editor companion', () => {
  it('creates copyable per-start pairing codes with enough entropy for local use', () => {
    expect(createEditorPairingToken()).toMatch(/^[A-F0-9]{12}$/);
  });

  it('builds paired local and production editor URLs', () => {
    const urls = editorCompanionUrls('127.0.0.1', 8765, 'A1B2C3D4');
    const local = new URL(urls.localEditorUrl);
    const production = new URL(urls.productionEditorUrl);

    expect(local.origin).toBe('http://127.0.0.1:8765');
    expect(local.searchParams.has('editor')).toBe(true);
    expect(local.searchParams.get('bridge')).toBe('1');
    expect(local.searchParams.get('bridgeToken')).toBe('A1B2C3D4');
    expect(production.origin).toBe('https://q3edit.com');
    expect(production.searchParams.get('bridge')).toBe('http://127.0.0.1:8765/editor');
    expect(production.searchParams.get('bridgeToken')).toBe('A1B2C3D4');
  });

  it('accepts only a matching pairing code from an allowed editor origin', () => {
    const origins = allowedEditorOrigins('127.0.0.1', 8765);
    expect(authorizeEditorConnection({
      requestUrl: '/editor?token=a1b2c3d4', origin: 'https://q3edit.com',
    }, 'A1B2C3D4', origins)).toMatchObject({ allowed: true, statusCode: 101 });
    expect(authorizeEditorConnection({
      requestUrl: '/editor?token=wrong', origin: 'https://q3edit.com',
    }, 'A1B2C3D4', origins)).toMatchObject({ allowed: false, statusCode: 401 });
    expect(authorizeEditorConnection({
      requestUrl: '/editor?token=A1B2C3D4', origin: 'https://example.com',
    }, 'A1B2C3D4', origins)).toMatchObject({ allowed: false, statusCode: 403 });
  });

  it('allows configured production origins and both common loopback names', () => {
    const origins = allowedEditorOrigins('0.0.0.0', 9000, 'https://staging.q3edit.com/editor', ['https://preview.q3edit.com/path']);
    expect(origins).toEqual(new Set([
      'http://0.0.0.0:9000',
      'http://127.0.0.1:9000',
      'http://localhost:9000',
      'https://staging.q3edit.com',
      'https://www.q3edit.com',
      'https://preview.q3edit.com',
    ]));
  });
});
