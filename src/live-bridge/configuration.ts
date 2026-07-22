export interface BridgeLocation {
  search: string;
  protocol: string;
  host: string;
  href: string;
}

export function configuredBridgeUrl(location: BridgeLocation = window.location): string | null {
  const value = new URLSearchParams(location.search).get('bridge');
  if (!value) return null;
  if (value === '1' || value === 'true') {
    return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/editor`;
  }
  try {
    const url = new URL(value, location.href);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    return url.toString();
  } catch {
    return null;
  }
}
