import { describe, expect, it } from 'vitest';
import { configuredBridgeUrl, type BridgeLocation } from '../src/live-bridge/configuration';

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
});
