import { localCompanionBridgeUrl } from './configuration';

const ENDPOINT_STORAGE_KEY = 'q3edit.mcpBridge.endpoint';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:8765/editor';

export interface McpConnectionDialogOptions {
  currentUrl: string | null;
  onConnect: (url: string) => void | Promise<void>;
  onDisconnect: () => void;
}

function storedEndpoint(): string {
  try {
    return localStorage.getItem(ENDPOINT_STORAGE_KEY) || DEFAULT_ENDPOINT;
  } catch {
    return DEFAULT_ENDPOINT;
  }
}

function rememberEndpoint(value: string): void {
  try { localStorage.setItem(ENDPOINT_STORAGE_KEY, value); } catch { /* Storage is optional. */ }
}

function displayAddress(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.delete('token');
    url.searchParams.delete('sessionId');
    return url.toString();
  } catch {
    return value;
  }
}

export function openMcpConnectionDialog(options: McpConnectionDialogOptions): void {
  document.getElementById('mcp-connection-dialog')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'mcp-connection-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'mcp-connection-title');

  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog mcp-connection-dialog';
  const title = document.createElement('div');
  title.id = 'mcp-connection-title';
  title.className = 'editor-dialog-title';
  title.textContent = 'Local MCP Companion';
  const description = document.createElement('div');
  description.className = 'editor-dialog-description';
  description.textContent = 'Run the Q3Edit bridge on this computer, then enter the pairing code printed in its terminal. The map stays in this browser while Codex or Claude connects to the local MCP endpoint.';

  const fields = document.createElement('div');
  fields.className = 'mcp-connection-fields';
  const endpointLabel = document.createElement('label');
  endpointLabel.textContent = 'Local bridge address';
  const endpoint = document.createElement('input');
  endpoint.type = 'url';
  endpoint.spellcheck = false;
  endpoint.value = options.currentUrl ? displayAddress(options.currentUrl) : storedEndpoint();
  endpointLabel.appendChild(endpoint);
  const codeLabel = document.createElement('label');
  codeLabel.textContent = 'Pairing code';
  const code = document.createElement('input');
  code.type = 'text';
  code.autocomplete = 'off';
  code.spellcheck = false;
  code.placeholder = 'Code shown by npm run bridge';
  codeLabel.appendChild(code);
  fields.append(endpointLabel, codeLabel);

  const permission = document.createElement('div');
  permission.className = 'mcp-connection-note';
  permission.textContent = 'Your browser may ask whether q3edit.com may access devices on your local network. Allow it to connect to the companion.';
  const status = document.createElement('div');
  status.className = 'mcp-connection-status';
  status.setAttribute('role', 'status');
  if (options.currentUrl) status.textContent = `Current connection: ${displayAddress(options.currentUrl)}`;

  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  const disconnect = document.createElement('button');
  disconnect.type = 'button';
  disconnect.className = 'btn';
  disconnect.textContent = 'Disconnect';
  disconnect.disabled = !options.currentUrl;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  const connect = document.createElement('button');
  connect.type = 'button';
  connect.className = 'btn primary';
  connect.textContent = options.currentUrl ? 'Reconnect' : 'Connect';
  actions.append(disconnect, cancel, connect);

  const close = () => overlay.remove();
  disconnect.onclick = () => { options.onDisconnect(); close(); };
  cancel.onclick = close;
  connect.onclick = () => {
    if (!endpoint.value.trim() || !code.value.trim()) {
      status.textContent = 'Enter both the local bridge address and pairing code.';
      return;
    }
    try {
      const url = localCompanionBridgeUrl(endpoint.value, code.value);
      rememberEndpoint(displayAddress(url));
      void options.onConnect(url);
      close();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Enter') { event.preventDefault(); connect.click(); }
  });

  dialog.append(title, description, fields, permission, status, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  code.focus();
}
