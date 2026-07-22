import { randomBytes, timingSafeEqual } from 'node:crypto';

export const DEFAULT_PRODUCTION_EDITOR_URL = 'https://q3edit.com/?editor';

export interface EditorCompanionUrls {
  localEditorUrl: string;
  productionEditorUrl: string;
  bridgeUrl: string;
}

export interface EditorConnectionRequest {
  requestUrl: string;
  origin?: string;
}

export interface EditorConnectionAuthorization {
  allowed: boolean;
  statusCode: number;
  message: string;
}

export function createEditorPairingToken(): string {
  return randomBytes(6).toString('hex').toUpperCase();
}

function tokenMatches(candidate: string | null, expected: string): boolean {
  if (!candidate) return false;
  const normalizedCandidate = candidate.trim().toUpperCase();
  const normalizedExpected = expected.trim().toUpperCase();
  const candidateBytes = Buffer.from(normalizedCandidate);
  const expectedBytes = Buffer.from(normalizedExpected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

export function allowedEditorOrigins(
  host: string,
  port: number,
  productionEditorUrl = DEFAULT_PRODUCTION_EDITOR_URL,
  configuredOrigins: readonly string[] = [],
): Set<string> {
  const origins = new Set<string>([
    `http://${host}:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    new URL(productionEditorUrl).origin,
    'https://www.q3edit.com',
  ]);
  for (const value of configuredOrigins) {
    const trimmed = value.trim();
    if (trimmed) origins.add(new URL(trimmed).origin);
  }
  return origins;
}

export function authorizeEditorConnection(
  request: EditorConnectionRequest,
  pairingToken: string,
  allowedOrigins: ReadonlySet<string>,
): EditorConnectionAuthorization {
  let url: URL;
  try {
    url = new URL(request.requestUrl, 'http://127.0.0.1');
  } catch {
    return { allowed: false, statusCode: 400, message: 'Invalid editor connection URL' };
  }
  if (!request.origin || !allowedOrigins.has(request.origin)) {
    return { allowed: false, statusCode: 403, message: `Editor origin is not allowed: ${request.origin ?? '(missing)'}` };
  }
  if (!tokenMatches(url.searchParams.get('token'), pairingToken)) {
    return { allowed: false, statusCode: 401, message: 'Invalid or missing Q3Edit pairing code' };
  }
  return { allowed: true, statusCode: 101, message: 'Accepted' };
}

export function editorCompanionUrls(
  host: string,
  port: number,
  pairingToken: string,
  productionEditorUrl = DEFAULT_PRODUCTION_EDITOR_URL,
): EditorCompanionUrls {
  const browserHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const localOrigin = `http://${browserHost}:${port}`;
  const bridgeUrl = `${localOrigin}/editor`;

  const localEditor = new URL('/', localOrigin);
  localEditor.searchParams.set('editor', '');
  localEditor.searchParams.set('bridge', '1');
  localEditor.searchParams.set('bridgeToken', pairingToken);

  const productionEditor = new URL(productionEditorUrl);
  productionEditor.searchParams.set('editor', '');
  productionEditor.searchParams.set('bridge', bridgeUrl);
  productionEditor.searchParams.set('bridgeToken', pairingToken);

  return {
    localEditorUrl: localEditor.toString(),
    productionEditorUrl: productionEditor.toString(),
    bridgeUrl,
  };
}
