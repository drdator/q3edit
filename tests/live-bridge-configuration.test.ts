import { describe, expect, it } from 'vitest';
import { configuredBridgeUrl, localCompanionBridgeUrl, type BridgeLocation } from '../src/live-bridge/configuration';

function location(search: string, protocol = 'http:'): BridgeLocation {
  const host = '127.0.0.1:8765';
  return { search, protocol, host, href: `${protocol}//${host}/?editor${search}` };
}

describe('live bridge configuration', () => {
  it('keeps the normal editor disconnected unless bridge mode is requested', () => {
    expect(configuredBridgeUrl(location(''))).toBeNull();
  });

  it('resolves local bridge mode using the page transport', () => {
    expect(configuredBridgeUrl(location('?bridge=1'))).toBe('ws://127.0.0.1:8765/editor');
    expect(configuredBridgeUrl(location('?bridge=true', 'https:'))).toBe('wss://127.0.0.1:8765/editor');
  });

  it('normalizes explicitly configured HTTP bridge URLs', () => {
    expect(configuredBridgeUrl(location('?bridge=http%3A%2F%2Flocalhost%3A9000%2Feditor')))
      .toBe('ws://localhost:9000/editor');
  });

  it('adds a pairing token without discarding bridge query parameters', () => {
    expect(configuredBridgeUrl(location('?bridge=1&bridgeToken=A1B2C3D4')))
      .toBe('ws://127.0.0.1:8765/editor?token=A1B2C3D4');
    expect(localCompanionBridgeUrl('http://127.0.0.1:9000/editor?channel=local', 'CODE', 'https://q3edit.com/?editor'))
      .toBe('ws://127.0.0.1:9000/editor?channel=local&token=CODE');
  });

  it('rejects bridge addresses using unrelated URL schemes', () => {
    expect(() => localCompanionBridgeUrl('file:///tmp/editor.sock', 'CODE', 'https://q3edit.com/?editor')).toThrow(/HTTP/);
  });
});
