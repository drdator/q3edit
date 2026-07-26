import { createBuildInspector } from './build-inspector';
import type { BspInspection } from './bsp-inspection';
import type { BuildRecord } from './build-history';
import type { Editor } from './editor';
import {
  clampMcpActivityPanelHeight,
  DEFAULT_MCP_ACTIVITY_PANEL_HEIGHT,
  MAX_MCP_ACTIVITY_PANEL_HEIGHT,
  MIN_MCP_ACTIVITY_PANEL_HEIGHT,
  resizedMcpActivityPanelHeight,
} from './live-bridge/activity-panel';

export interface BuildPanelActions {
  compileAgain: () => void;
  play?: () => void;
  saveBsp?: () => void;
  saveAas?: () => void;
}

export interface BuildPanelOptions {
  editor: Editor;
  initialHeight?: number;
  onCompile?: () => void;
  onOpenActivity?: () => void;
  onVisibilityChange?: (visible: boolean) => void;
  onHeightChange?: (height: number, committed: boolean) => void;
  onLayoutChange?: () => void;
}

type BuildPanelTone = 'info' | 'success' | 'warning' | 'error';

function actionButton(label: string, action: () => void, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = `mcp-activity-button${primary ? ' primary' : ''}`;
  result.textContent = label;
  result.onclick = action;
  return result;
}

export class BuildPanel {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly body: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly resizer: HTMLElement;
  private visible = false;
  private available = false;
  private height: number;
  private sessionStartedAt: number | null = null;
  private buildRevision: number | null = null;
  private record: BuildRecord | null = null;
  private log: HTMLPreElement | null = null;
  private cancelBuild: (() => void) | null = null;
  private baseStatus = 'No build has been run for this document.';
  private tone: BuildPanelTone = 'info';

  constructor(private readonly options: BuildPanelOptions) {
    const root = document.getElementById('build-panel');
    if (!root) throw new Error('Missing #build-panel');
    this.root = root;
    this.height = clampMcpActivityPanelHeight(
      options.initialHeight ?? DEFAULT_MCP_ACTIVITY_PANEL_HEIGHT,
      window.innerHeight,
    );

    this.resizer = document.createElement('div');
    this.resizer.className = 'mcp-activity-resizer';
    this.resizer.setAttribute('role', 'separator');
    this.resizer.setAttribute('aria-label', 'Resize Build panel');
    this.resizer.setAttribute('aria-orientation', 'horizontal');
    this.resizer.tabIndex = 0;
    this.resizer.title = 'Drag to resize. Double-click to reset.';

    const header = document.createElement('header');
    header.className = 'mcp-activity-panel-header build-panel-header';
    const tabs = document.createElement('div');
    tabs.className = 'bottom-dock-tabs';
    const activityTab = actionButton('Activity', () => this.options.onOpenActivity?.());
    activityTab.classList.add('bottom-dock-tab');
    const buildTab = actionButton('Build', () => this.open());
    buildTab.classList.add('bottom-dock-tab', 'active');
    buildTab.setAttribute('aria-current', 'page');
    tabs.append(activityTab, buildTab);

    this.status = document.createElement('div');
    this.status.className = 'build-panel-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    this.actions = document.createElement('div');
    this.actions.className = 'mcp-activity-panel-actions build-panel-actions';
    const close = actionButton('×', () => this.close());
    close.classList.add('mcp-activity-close');
    close.setAttribute('aria-label', 'Close Build');
    this.actions.append(close);
    header.append(tabs, this.status, this.actions);

    this.body = document.createElement('div');
    this.body.className = 'build-panel-body';
    this.root.replaceChildren(this.resizer, header, this.body);
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Build results');

    this.setupResize();
    window.addEventListener('resize', () => this.setHeight(this.height, false));
    options.editor.subscribeDocumentSessions(() => this.clearForDocument());
    options.editor.subscribeDocumentChanges(() => this.handleDocumentChange());
    this.setHeight(this.height, false);
    this.applyVisibility(false);
    this.renderEmptyState();
  }

  isOpen(): boolean {
    return this.visible;
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  open(): void {
    if (this.visible) return;
    this.visible = true;
    this.applyVisibility(true);
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.applyVisibility(true);
  }

  syncHeight(height: number): void {
    this.setHeight(height, false, false);
  }

  start(label: string, onCancel: () => void): void {
    this.cancelBuild?.();
    this.sessionStartedAt = this.options.editor.documentSessionStartedAt;
    this.buildRevision = this.options.editor.documentRevision;
    this.record = null;
    this.cancelBuild = onCancel;
    this.options.editor.compiledBspInspection = null;
    this.options.editor.compiledBspOverlay = 'none';
    this.options.editor.redrawRequested = true;
    this.setAvailable(true);
    this.setStatus(label, 'info');
    this.log = document.createElement('pre');
    this.log.className = 'build-panel-live-output';
    this.log.textContent = '';
    this.body.replaceChildren(this.log);
    const cancel = actionButton('Cancel Compile', () => {
      cancel.disabled = true;
      this.setStatus('Cancelling compilation…', 'warning');
      this.cancelBuild?.();
    });
    const close = actionButton('×', () => this.close());
    close.classList.add('mcp-activity-close');
    close.setAttribute('aria-label', 'Close Build');
    this.setActions([cancel, close]);
    this.open();
  }

  appendOutput(line: string): void {
    if (!this.log) return;
    this.log.textContent += `${line}\n`;
    this.log.scrollTop = this.log.scrollHeight;
  }

  finish(
    record: BuildRecord,
    inspection: BspInspection | null,
    previous: BuildRecord | null,
    history: BuildRecord[],
    status: string,
    tone: BuildPanelTone,
    actions: BuildPanelActions,
  ): boolean {
    if (this.sessionStartedAt !== this.options.editor.documentSessionStartedAt) return false;
    this.cancelBuild = null;
    this.record = record;
    this.buildRevision = record.documentRevision;
    this.log = null;
    this.options.editor.compiledBspInspection = inspection;
    this.options.editor.redrawRequested = true;
    this.setStatus(status, tone);
    this.body.replaceChildren(createBuildInspector(this.options.editor, record, inspection, previous, history));
    const buttons = [
      ...(actions.play ? [actionButton('Play', actions.play)] : []),
      ...(actions.saveAas ? [actionButton('Save .aas', actions.saveAas)] : []),
      ...(actions.saveBsp ? [actionButton('Save .bsp', actions.saveBsp)] : []),
      actionButton('Compile Again', actions.compileAgain, true),
      actionButton('×', () => this.close()),
    ];
    buttons[buttons.length - 1].classList.add('mcp-activity-close');
    buttons[buttons.length - 1].setAttribute('aria-label', 'Close Build');
    this.setActions(buttons);
    this.handleDocumentChange();
    return true;
  }

  private handleDocumentChange(): void {
    if (!this.available || this.sessionStartedAt === null) return;
    if (this.sessionStartedAt !== this.options.editor.documentSessionStartedAt) {
      this.clearForDocument();
      return;
    }
    if (this.record && this.buildRevision !== this.options.editor.documentRevision) {
      this.status.textContent = `${this.baseStatus} · Out of date`;
      this.status.className = 'build-panel-status warning';
    } else {
      this.renderStatus();
    }
  }

  private clearForDocument(): void {
    this.cancelBuild?.();
    this.cancelBuild = null;
    this.sessionStartedAt = null;
    this.buildRevision = null;
    this.record = null;
    this.log = null;
    this.body.replaceChildren();
    this.setAvailable(false);
    this.options.editor.compiledBspInspection = null;
    this.options.editor.compiledBspOverlay = 'none';
    this.options.editor.redrawRequested = true;
    this.renderEmptyState();
  }

  private setAvailable(available: boolean): void {
    this.available = available;
  }

  private renderEmptyState(): void {
    this.setStatus('No build has been run for this document.', 'info');
    const empty = document.createElement('div');
    empty.className = 'build-panel-empty';
    const message = document.createElement('p');
    message.textContent = 'Compile the map to see build results, diagnostics, BSP/VIS overlays, and lightmaps.';
    const compile = actionButton('Compile BSP…', () => this.options.onCompile?.(), true);
    empty.append(message, compile);
    this.body.replaceChildren(empty);
    const close = actionButton('×', () => this.close());
    close.classList.add('mcp-activity-close');
    close.setAttribute('aria-label', 'Close Build');
    this.setActions([close]);
  }

  private setStatus(message: string, tone: BuildPanelTone): void {
    this.baseStatus = message;
    this.tone = tone;
    this.renderStatus();
  }

  private renderStatus(): void {
    this.status.textContent = this.baseStatus;
    this.status.className = `build-panel-status ${this.tone}`;
  }

  private setActions(actions: HTMLElement[]): void {
    this.actions.replaceChildren(...actions);
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

  private setHeight(height: number, committed: boolean, notify = true): void {
    this.height = clampMcpActivityPanelHeight(height, window.innerHeight);
    this.root.style.height = `${this.height}px`;
    this.resizer.setAttribute('aria-valuenow', String(this.height));
    if (notify) this.options.onHeightChange?.(this.height, committed);
    this.options.onLayoutChange?.();
  }
}
