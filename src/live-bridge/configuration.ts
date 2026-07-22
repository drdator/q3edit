export interface BridgeLocation {
  search: string;
  protocol: string;
  host: string;
  href: string;
}

export function normalizedBridgeUrl(value: string, baseHref: string): string {
  const url = new URL(value, baseHref);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Bridge address must use HTTP, HTTPS, WS, or WSS');
  return url.toString();
}

export function localCompanionBridgeUrl(address: string, pairingCode: string, baseHref = window.location.href): string {
  const url = new URL(normalizedBridgeUrl(address.trim(), baseHref));
  url.searchParams.set('token', pairingCode.trim());
  return url.toString();
}

export function configuredBridgeUrl(location: BridgeLocation = window.location): string | null {
  const params = new URLSearchParams(location.search);
  const value = params.get('bridge');
  if (!value) return null;
  let target: string;
  if (value === '1' || value === 'true') {
    target = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/editor`;
  } else {
    try {
      target = normalizedBridgeUrl(value, location.href);
    } catch {
      return null;
    }
  }
  const token = params.get('bridgeToken');
  return token ? localCompanionBridgeUrl(target, token, location.href) : target;
}
