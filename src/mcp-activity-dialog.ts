import type { McpActivityEntry } from './live-bridge-protocol';

export interface McpActivityFilter {
  query: string;
  status: 'all' | 'success' | 'error';
  kind: 'all' | 'action' | 'read';
}

export function filterMcpActivity(entries: McpActivityEntry[], filter: McpActivityFilter): McpActivityEntry[] {
  const query = filter.query.trim().toLowerCase();
  return entries.filter(entry => {
    if (filter.status !== 'all' && entry.status !== filter.status) return false;
    if (filter.kind === 'action' && entry.readOnly) return false;
    if (filter.kind === 'read' && !entry.readOnly) return false;
    if (!query) return true;
    return [entry.tool, entry.editorSessionId ?? '', JSON.stringify(entry.arguments), JSON.stringify(entry.result)]
      .some(value => value.toLowerCase().includes(query));
  });
}

export function summarizeMcpActivity(entries: McpActivityEntry[]): {
  total: number; actions: number; errors: number; revisions: number;
} {
  return {
    total: entries.length,
    actions: entries.filter(entry => !entry.readOnly).length,
    errors: entries.filter(entry => entry.status === 'error').length,
    revisions: entries.filter(entry => (entry.revisionDelta ?? 0) !== 0).length,
  };
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `btn${primary ? ' primary' : ''}`;
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

function formatRevision(entry: McpActivityEntry): string {
  if (entry.revisionBefore === null && entry.revisionAfter === null) return 'No document revision';
  if (entry.revisionBefore === entry.revisionAfter) return `Revision ${entry.revisionAfter}`;
  const delta = entry.revisionDelta === null ? '' : ` (${entry.revisionDelta > 0 ? '+' : ''}${entry.revisionDelta})`;
  return `Revision ${entry.revisionBefore ?? '—'} → ${entry.revisionAfter ?? '—'}${delta}`;
}

function prettyJson(value: unknown): string {
  if (value === undefined) return '—';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export class McpActivityDialog {
  private entries = new Map<string, McpActivityEntry>();
  private dismissedIds = new Set<string>();
  private overlay: HTMLElement | null = null;
  private renderList: (() => void) | null = null;

  add(entry: McpActivityEntry): void {
    if (this.dismissedIds.has(entry.id)) return;
    this.entries.set(entry.id, entry);
    while (this.entries.size > 1_000) this.entries.delete(this.entries.keys().next().value!);
    this.renderList?.();
  }

  open(): void {
    if (this.overlay) {
      (this.overlay.querySelector('.mcp-activity-search') as HTMLInputElement | null)?.focus();
      return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'mcp-activity-dialog';
    overlay.className = 'editor-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mcp-activity-title');
    const dialog = document.createElement('div');
    dialog.className = 'editor-dialog mcp-activity-dialog';

    const header = document.createElement('div');
    header.className = 'mcp-activity-header';
    const title = document.createElement('div');
    title.id = 'mcp-activity-title'; title.className = 'editor-dialog-title'; title.textContent = 'MCP Activity';
    const live = document.createElement('span');
    live.className = 'mcp-activity-live'; live.textContent = 'LIVE';
    header.append(title, live);
    const description = document.createElement('div');
    description.className = 'editor-dialog-description';
    description.textContent = 'Tool calls received by this editor. Expand an entry to inspect its summarized arguments and result.';

    const controls = document.createElement('div');
    controls.className = 'mcp-activity-controls';
    const search = document.createElement('input');
    search.className = 'mcp-activity-search'; search.type = 'search'; search.placeholder = 'Filter tools, sessions, or values…';
    search.setAttribute('aria-label', 'Filter MCP activity');
    const status = document.createElement('select');
    status.setAttribute('aria-label', 'Filter by status');
    status.innerHTML = '<option value="all">All statuses</option><option value="success">Success</option><option value="error">Errors</option>';
    const kind = document.createElement('select');
    kind.setAttribute('aria-label', 'Filter by tool kind');
    kind.innerHTML = '<option value="all">All calls</option><option value="action">Actions</option><option value="read">Read-only</option>';
    controls.append(search, status, kind);

    const summary = document.createElement('div');
    summary.className = 'mcp-activity-summary';
    const list = document.createElement('div');
    list.className = 'mcp-activity-list';

    const closeDialog = () => {
      overlay.remove();
      this.overlay = null;
      this.renderList = null;
    };
    const render = () => {
      const all = [...this.entries.values()];
      const totals = summarizeMcpActivity(all);
      summary.innerHTML = '';
      for (const [label, value] of [
        ['Calls', totals.total], ['Actions', totals.actions], ['Errors', totals.errors], ['Revisions', totals.revisions],
      ] as const) {
        const item = document.createElement('div');
        const number = document.createElement('strong'); number.textContent = String(value);
        const caption = document.createElement('span'); caption.textContent = label;
        item.append(number, caption); summary.appendChild(item);
      }
      const filtered = filterMcpActivity(all, {
        query: search.value,
        status: status.value as McpActivityFilter['status'],
        kind: kind.value as McpActivityFilter['kind'],
      }).reverse();
      list.innerHTML = '';
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'mcp-activity-empty';
        empty.textContent = all.length === 0 ? 'No MCP calls have been received yet.' : 'No calls match the current filters.';
        list.appendChild(empty);
        return;
      }
      for (const entry of filtered) {
        const details = document.createElement('details');
        details.className = `mcp-activity-entry ${entry.status} ${entry.readOnly ? 'read-only' : 'action'}`;
        const row = document.createElement('summary');
        const timestamp = document.createElement('time');
        timestamp.dateTime = entry.timestamp;
        timestamp.title = new Date(entry.timestamp).toLocaleString();
        timestamp.textContent = new Date(entry.timestamp).toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });
        const badge = document.createElement('span');
        badge.className = 'mcp-activity-kind'; badge.textContent = entry.readOnly ? 'READ' : 'ACTION';
        const tool = document.createElement('strong'); tool.textContent = entry.tool;
        const revision = document.createElement('span'); revision.className = 'mcp-activity-revision'; revision.textContent = formatRevision(entry);
        const duration = document.createElement('span'); duration.className = 'mcp-activity-duration'; duration.textContent = `${entry.durationMs} ms`;
        row.append(timestamp, badge, tool, revision, duration);
        const body = document.createElement('div'); body.className = 'mcp-activity-entry-body';
        const meta = document.createElement('div'); meta.className = 'mcp-activity-meta';
        meta.textContent = `${entry.status.toUpperCase()} · Editor ${entry.editorSessionId ?? 'unscoped'} · MCP ${entry.mcpSessionId}`;
        const argumentsTitle = document.createElement('h3'); argumentsTitle.textContent = 'Arguments';
        const argumentsJson = document.createElement('pre'); argumentsJson.textContent = prettyJson(entry.arguments);
        const resultTitle = document.createElement('h3'); resultTitle.textContent = 'Result';
        const resultJson = document.createElement('pre'); resultJson.textContent = prettyJson(entry.result);
        body.append(meta, argumentsTitle, argumentsJson, resultTitle, resultJson);
        details.append(row, body); list.appendChild(details);
      }
    };
    search.addEventListener('input', render); status.addEventListener('change', render); kind.addEventListener('change', render);

    const footer = document.createElement('div');
    footer.className = 'editor-dialog-actions mcp-activity-actions';
    const note = document.createElement('span');
    note.textContent = 'Clear View does not delete the bridge JSONL transcript.';
    const clear = button('Clear View', () => {
      for (const id of this.entries.keys()) this.dismissedIds.add(id);
      this.entries.clear(); render();
    });
    footer.append(note, clear, button('Close', closeDialog, true));
    dialog.append(header, description, controls, summary, list, footer);
    overlay.appendChild(dialog); document.body.appendChild(overlay);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { closeDialog(); event.stopPropagation(); }
    });
    this.overlay = overlay;
    this.renderList = render;
    render(); search.focus();
  }
}
