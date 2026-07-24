import type { McpActivityEntry } from './protocol';

export interface McpActivityFilter {
  query: string;
  status: 'all' | 'success' | 'error';
  kind: 'all' | 'action' | 'read';
}

export const DEFAULT_MCP_ACTIVITY_PANEL_HEIGHT = 280;
export const MIN_MCP_ACTIVITY_PANEL_HEIGHT = 140;
export const MAX_MCP_ACTIVITY_PANEL_HEIGHT = 800;
export const MCP_ACTIVITY_TAIL_THRESHOLD = 24;

export interface McpActivityScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function isMcpActivityAtTail(
  metrics: McpActivityScrollMetrics,
  threshold = MCP_ACTIVITY_TAIL_THRESHOLD,
): boolean {
  if (metrics.scrollHeight <= metrics.clientHeight) return true;
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold;
}

export function clampMcpActivityPanelHeight(height: number, viewportHeight = Number.POSITIVE_INFINITY): number {
  const finiteHeight = Number.isFinite(height) ? height : DEFAULT_MCP_ACTIVITY_PANEL_HEIGHT;
  const viewportMaximum = Number.isFinite(viewportHeight)
    ? Math.max(MIN_MCP_ACTIVITY_PANEL_HEIGHT, viewportHeight - 180)
    : MAX_MCP_ACTIVITY_PANEL_HEIGHT;
  return Math.round(Math.min(MAX_MCP_ACTIVITY_PANEL_HEIGHT, viewportMaximum, Math.max(MIN_MCP_ACTIVITY_PANEL_HEIGHT, finiteHeight)));
}

export function resizedMcpActivityPanelHeight(
  startHeight: number,
  startY: number,
  currentY: number,
  viewportHeight = Number.POSITIVE_INFINITY,
): number {
  return clampMcpActivityPanelHeight(startHeight + startY - currentY, viewportHeight);
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

function compactButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'mcp-activity-button';
  element.textContent = label;
  element.title = title;
  element.addEventListener('click', onClick);
  return element;
}

function activitySelect(select: HTMLSelectElement): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'mcp-activity-select';
  const caret = document.createElement('i');
  caret.className = 'ph ph-caret-down';
  caret.setAttribute('aria-hidden', 'true');
  wrapper.append(select, caret);
  return wrapper;
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

export interface McpActivityPanelOptions {
  initialVisible?: boolean;
  initialHeight?: number;
  onVisibilityChange?: (visible: boolean) => void;
  onHeightChange?: (height: number, committed: boolean) => void;
  onLayoutChange?: () => void;
}

export class McpActivityPanel {
  private entries = new Map<string, McpActivityEntry>();
  private dismissedIds = new Set<string>();
  private expandedIds = new Set<string>();
  private readonly root: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly status: HTMLSelectElement;
  private readonly kind: HTMLSelectElement;
  private readonly summary: HTMLElement;
  private readonly list: HTMLElement;
  private readonly resizer: HTMLElement;
  private visible: boolean;
  private height: number;
  private followTail = true;

  constructor(private readonly options: McpActivityPanelOptions = {}) {
    const root = document.getElementById('mcp-activity-panel');
    if (!root) throw new Error('Missing #mcp-activity-panel');
    this.root = root;
    this.visible = options.initialVisible ?? false;
    this.height = clampMcpActivityPanelHeight(options.initialHeight ?? DEFAULT_MCP_ACTIVITY_PANEL_HEIGHT, window.innerHeight);

    this.resizer = document.createElement('div');
    this.resizer.className = 'mcp-activity-resizer';
    this.resizer.setAttribute('role', 'separator');
    this.resizer.setAttribute('aria-label', 'Resize MCP activity panel');
    this.resizer.setAttribute('aria-orientation', 'horizontal');
    this.resizer.tabIndex = 0;
    this.resizer.title = 'Drag to resize. Double-click to reset.';

    const header = document.createElement('header');
    header.className = 'mcp-activity-panel-header';
    const identity = document.createElement('div');
    identity.className = 'mcp-activity-identity';
    const title = document.createElement('strong');
    title.id = 'mcp-activity-title';
    title.textContent = 'MCP Activity';
    const live = document.createElement('span');
    live.className = 'mcp-activity-live';
    live.textContent = 'LIVE';
    identity.append(title, live);

    const controls = document.createElement('div');
    controls.className = 'mcp-activity-controls';
    this.search = document.createElement('input');
    this.search.className = 'mcp-activity-search';
    this.search.type = 'search';
    this.search.placeholder = 'Filter activity…';
    this.search.setAttribute('aria-label', 'Filter MCP activity');
    this.status = document.createElement('select');
    this.status.setAttribute('aria-label', 'Filter by status');
    this.status.innerHTML = '<option value="all">All statuses</option><option value="success">Success</option><option value="error">Errors</option>';
    this.kind = document.createElement('select');
    this.kind.setAttribute('aria-label', 'Filter by tool kind');
    this.kind.innerHTML = '<option value="all">All calls</option><option value="action">Actions</option><option value="read">Read-only</option>';
    controls.append(this.search, activitySelect(this.status), activitySelect(this.kind));

    this.summary = document.createElement('div');
    this.summary.className = 'mcp-activity-summary';
    const actions = document.createElement('div');
    actions.className = 'mcp-activity-panel-actions';
    const clear = compactButton('Clear', 'Clear the panel view without deleting the bridge JSONL transcript', () => this.clear());
    const close = compactButton('×', 'Close MCP Activity', () => this.close());
    close.classList.add('mcp-activity-close');
    close.setAttribute('aria-label', 'Close MCP Activity');
    actions.append(clear, close);
    header.append(identity, controls, this.summary, actions);

    this.list = document.createElement('div');
    this.list.className = 'mcp-activity-list';
    this.root.replaceChildren(this.resizer, header, this.list);
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-labelledby', 'mcp-activity-title');

    this.search.addEventListener('input', () => this.render());
    this.status.addEventListener('change', () => this.render());
    this.kind.addEventListener('change', () => this.render());
    this.list.addEventListener('scroll', () => {
      this.followTail = isMcpActivityAtTail(this.list);
    }, { passive: true });
    this.root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    });
    this.setupResize();
    window.addEventListener('resize', () => this.setHeight(this.height, false));
    this.applyVisibility(false);
    this.setHeight(this.height, false);
    this.render();
  }

  add(entry: McpActivityEntry): void {
    if (this.dismissedIds.has(entry.id)) return;
    this.entries.set(entry.id, entry);
    while (this.entries.size > 1_000) {
      const oldestId = this.entries.keys().next().value!;
      this.entries.delete(oldestId);
      this.expandedIds.delete(oldestId);
    }
    this.render();
  }

  isOpen(): boolean {
    return this.visible;
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  open(): void {
    if (this.visible) {
      this.search.focus();
      return;
    }
    this.visible = true;
    this.applyVisibility(true);
    if (this.followTail) this.scrollToTail();
    this.search.focus();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.applyVisibility(true);
  }

  private clear(): void {
    for (const id of this.entries.keys()) this.dismissedIds.add(id);
    this.entries.clear();
    this.expandedIds.clear();
    this.followTail = true;
    this.render();
  }

  private applyVisibility(notify: boolean): void {
    this.root.hidden = !this.visible;
    this.root.setAttribute('aria-hidden', String(!this.visible));
    if (notify) this.options.onVisibilityChange?.(this.visible);
    this.options.onLayoutChange?.();
  }

  private setupResize(): void {
    this.resizer.setAttribute('aria-valuemin', String(MIN_MCP_ACTIVITY_PANEL_HEIGHT));
    this.resizer.setAttribute('aria-valuemax', String(MAX_MCP_ACTIVITY_PANEL_HEIGHT));
    this.resizer.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = this.height;
      document.body.classList.add('mcp-activity-resizing');
      const move = (moveEvent: MouseEvent) => {
        this.setHeight(resizedMcpActivityPanelHeight(startHeight, startY, moveEvent.clientY, window.innerHeight), false);
      };
      const finish = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', finish);
        document.body.classList.remove('mcp-activity-resizing');
        this.options.onHeightChange?.(this.height, true);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', finish);
    });
    this.resizer.addEventListener('dblclick', () => this.setHeight(DEFAULT_MCP_ACTIVITY_PANEL_HEIGHT, true));
    this.resizer.addEventListener('keydown', event => {
      const step = event.shiftKey ? 40 : 16;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.setHeight(this.height + step, true);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.setHeight(this.height - step, true);
      } else if (event.key === 'Home') {
        event.preventDefault();
        this.setHeight(DEFAULT_MCP_ACTIVITY_PANEL_HEIGHT, true);
      }
    });
  }

  private setHeight(height: number, committed: boolean): void {
    this.height = clampMcpActivityPanelHeight(height, window.innerHeight);
    this.root.style.height = `${this.height}px`;
    this.resizer.setAttribute('aria-valuenow', String(this.height));
    this.options.onHeightChange?.(this.height, committed);
    this.options.onLayoutChange?.();
    if (this.followTail) this.scrollToTail();
  }

  private render(): void {
    const previousScrollTop = this.list.scrollTop;
    const shouldFollowTail = this.followTail;
    const all = [...this.entries.values()];
    const totals = summarizeMcpActivity(all);
    this.summary.innerHTML = '';
    for (const [label, value] of [
      ['Calls', totals.total], ['Actions', totals.actions], ['Errors', totals.errors], ['Revisions', totals.revisions],
    ] as const) {
      const item = document.createElement('span');
      const number = document.createElement('strong'); number.textContent = String(value);
      const caption = document.createElement('span'); caption.textContent = label;
      item.append(number, caption); this.summary.appendChild(item);
    }

    const filtered = filterMcpActivity(all, {
      query: this.search.value,
      status: this.status.value as McpActivityFilter['status'],
      kind: this.kind.value as McpActivityFilter['kind'],
    });
    this.list.innerHTML = '';
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mcp-activity-empty';
      empty.textContent = all.length === 0 ? 'No MCP calls have been received yet.' : 'No calls match the current filters.';
      this.list.appendChild(empty);
      this.restoreScrollPosition(shouldFollowTail, previousScrollTop);
      return;
    }
    for (const entry of filtered) {
      const details = document.createElement('details');
      details.className = `mcp-activity-entry ${entry.status} ${entry.readOnly ? 'read-only' : 'action'}`;
      details.open = this.expandedIds.has(entry.id);
      details.addEventListener('toggle', () => {
        if (details.open) this.expandedIds.add(entry.id);
        else this.expandedIds.delete(entry.id);
        if (this.followTail) this.scrollToTail();
      });
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
      const argumentsJson = document.createElement('pre'); argumentsJson.className = 'mcp-activity-arguments'; argumentsJson.textContent = prettyJson(entry.arguments);
      const resultTitle = document.createElement('h3'); resultTitle.textContent = 'Result';
      const resultJson = document.createElement('pre'); resultJson.className = 'mcp-activity-result'; resultJson.textContent = prettyJson(entry.result);
      body.append(meta, argumentsTitle, argumentsJson, resultTitle, resultJson);
      details.append(row, body); this.list.appendChild(details);
    }
    this.restoreScrollPosition(shouldFollowTail, previousScrollTop);
  }

  private restoreScrollPosition(followTail: boolean, scrollTop: number): void {
    if (followTail) this.scrollToTail();
    else this.list.scrollTop = scrollTop;
  }

  private scrollToTail(): void {
    const scroll = () => {
      if (!this.followTail) return;
      this.list.scrollTop = this.list.scrollHeight;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll);
    else scroll();
  }
}
