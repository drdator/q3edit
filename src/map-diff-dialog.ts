import type { DocumentRecoverySnapshot } from './document-recovery';
import type { Editor, SelectionItem } from './editor';
import {
  acceptBaselineEntry,
  diffMaps,
  mergeMapsThreeWay,
  type MapDiffChange,
  type MapDiffEntry,
  type MapDiffKind,
  type MapMergeResult,
} from './map-diff';
import { parseMapWithDiagnostics } from './mapfile';

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = primary ? 'btn primary' : 'btn';
  element.textContent = label;
  element.onclick = action;
  return element;
}

function select<T extends string>(
  label: string,
  options: Array<{ value: T | ''; text: string }>,
): { wrapper: HTMLLabelElement; control: HTMLSelectElement } {
  const wrapper = document.createElement('label');
  wrapper.className = 'map-diff-filter';
  const caption = document.createElement('span');
  caption.textContent = label;
  const control = document.createElement('select');
  control.className = 'app-select';
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.text;
    control.appendChild(item);
  }
  wrapper.append(caption, control);
  return { wrapper, control };
}

function resolveCurrentRef(editor: Editor, ref: string | undefined): SelectionItem | null {
  const match = /^E(\d+)(?::([BP])(\d+))?$/.exec(ref ?? '');
  if (!match) return null;
  const entity = editor.entities[Number(match[1])];
  if (!entity) return null;
  if (match[2] === 'B') {
    const brush = entity.brushes[Number(match[3])];
    return brush ? { type: 'brush', entity, brush } : null;
  }
  if (match[2] === 'P') {
    const patch = entity.patches[Number(match[3])];
    return patch ? { type: 'patch', entity, patch } : null;
  }
  return { type: 'entity', entity };
}

function focusEntry(editor: Editor, entry: MapDiffEntry): void {
  const item = resolveCurrentRef(editor, entry.currentRef);
  if (!item) {
    editor.statusMessage = 'This object exists only in the older version';
    return;
  }
  editor.selection = [item];
  editor.redrawRequested = true;
  editor.centerOnSelection();
  editor.statusMessage = `Selected ${entry.label}`;
}

function changeLabel(change: MapDiffChange): string {
  if (change === 'added') return 'Added';
  if (change === 'removed') return 'Removed';
  return 'Modified';
}

function kindLabel(kind: MapDiffKind): string {
  return kind[0].toUpperCase() + kind.slice(1);
}

export function openMapDiffDialog(editor: Editor, snapshot: DocumentRecoverySnapshot): void {
  document.getElementById('map-diff-dialog')?.remove();
  const baseline = parseMapWithDiagnostics(snapshot.mapText).document.entities;
  const overlay = document.createElement('div');
  overlay.id = 'map-diff-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'map-diff-title');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog map-diff-dialog';
  const title = document.createElement('div');
  title.id = 'map-diff-title';
  title.className = 'editor-dialog-title';
  title.textContent = `Compare with ${snapshot.label}`;
  const help = document.createElement('p');
  help.className = 'editor-dialog-description';
  help.textContent = 'Review object-level changes from this version to the current map. “Use version” is one undoable change per object.';
  const toolbar = document.createElement('div');
  toolbar.className = 'map-diff-toolbar';
  const changeFilter = select<MapDiffChange>('Change', [
    { value: '', text: 'All changes' },
    { value: 'added', text: 'Added' },
    { value: 'removed', text: 'Removed' },
    { value: 'modified', text: 'Modified' },
  ]);
  const kindFilter = select<MapDiffKind>('Object', [
    { value: '', text: 'All objects' },
    { value: 'entity', text: 'Entities' },
    { value: 'brush', text: 'Brushes' },
    { value: 'patch', text: 'Patches' },
  ]);
  const summary = document.createElement('span');
  summary.className = 'map-diff-summary';
  toolbar.append(changeFilter.wrapper, kindFilter.wrapper, summary);
  const warning = document.createElement('p');
  warning.className = 'map-diff-warning';
  const list = document.createElement('div');
  list.className = 'map-diff-list';

  const render = () => {
    const result = diffMaps(editor.entities, baseline);
    summary.textContent = `${result.counts.added} added · ${result.counts.removed} removed · ${result.counts.modified} modified`;
    warning.hidden = !result.limitedCorrelation;
    warning.textContent = result.limitedCorrelation
      ? 'Some older objects have no persistent Q3Edit ID. They are shown conservatively as added/removed instead of being guessed as modified.'
      : '';
    const change = changeFilter.control.value as MapDiffChange | '';
    const kind = kindFilter.control.value as MapDiffKind | '';
    const entries = result.entries.filter(entry => (!change || entry.change === change) && (!kind || entry.kind === kind));
    list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'map-diff-empty';
      empty.textContent = result.entries.length === 0
        ? 'The current map matches this version.'
        : 'No changes match the current filters.';
      list.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement('article');
      row.className = `map-diff-row ${entry.change}`;
      const badge = document.createElement('span');
      badge.className = `map-diff-badge ${entry.change}`;
      badge.textContent = changeLabel(entry.change);
      const info = document.createElement('div');
      info.className = 'map-diff-info';
      const heading = document.createElement('strong');
      heading.textContent = entry.label;
      const detail = document.createElement('span');
      detail.textContent = `${kindLabel(entry.kind)} · ${entry.detail}`;
      const correlation = document.createElement('span');
      correlation.className = 'map-diff-correlation';
      correlation.textContent = entry.stableKey ? 'Persistent ID match' : `${entry.correlation} correlation`;
      info.append(heading, detail, correlation);
      const actions = document.createElement('div');
      actions.className = 'map-diff-actions';
      const show = button(entry.currentRef ? 'Show' : 'Not in current map', () => focusEntry(editor, entry));
      show.disabled = !entry.currentRef;
      actions.append(
        show,
        button('Use version', () => {
          editor.transact(`Use ${snapshot.label}: ${entry.label}`, () => {
            if (!acceptBaselineEntry(editor.entities, baseline, entry)) {
              throw new Error(`Could not apply ${entry.label}`);
            }
            editor.clearSelection();
            editor.redrawRequested = true;
          });
          render();
        }, true),
      );
      row.append(badge, info, actions);
      list.appendChild(row);
    }
  };
  changeFilter.control.onchange = render;
  kindFilter.control.onchange = render;

  const footer = document.createElement('div');
  footer.className = 'editor-dialog-actions';
  footer.append(button('Close', () => overlay.remove()));
  dialog.append(title, help, toolbar, warning, list, footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  render();
}

function openMergeResultDialog(
  editor: Editor,
  snapshot: DocumentRecoverySnapshot,
  incomingName: string,
  result: MapMergeResult,
): void {
  document.getElementById('map-merge-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'map-merge-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog map-merge-dialog';
  const title = document.createElement('div');
  title.className = 'editor-dialog-title';
  title.textContent = `Merge ${incomingName}`;
  const description = document.createElement('p');
  description.className = 'editor-dialog-description';
  description.textContent = `Common ancestor: ${snapshot.label}. ${result.applied} safe incoming change${result.applied === 1 ? '' : 's'} can be applied; current values win every conflict.`;
  const summary = document.createElement('div');
  summary.className = 'map-merge-summary';
  summary.innerHTML = `<span>${result.applied}<small>Safe changes</small></span><span>${result.conflicts.length}<small>Conflicts</small></span><span>${result.skipped.length}<small>Uncorrelated</small></span>`;
  const list = document.createElement('div');
  list.className = 'map-diff-list';
  for (const item of [...result.conflicts, ...result.skipped]) {
    const row = document.createElement('article');
    row.className = 'map-diff-row conflict';
    const badge = document.createElement('span');
    badge.className = 'map-diff-badge conflict';
    badge.textContent = result.conflicts.includes(item) ? 'Conflict' : 'Skipped';
    const info = document.createElement('div');
    info.className = 'map-diff-info';
    const heading = document.createElement('strong');
    heading.textContent = item.label;
    const detail = document.createElement('span');
    detail.textContent = item.reason;
    info.append(heading, detail);
    row.append(badge, info);
    list.appendChild(row);
  }
  if (list.childElementCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'map-diff-empty';
    empty.textContent = 'No conflicts or uncorrelated objects.';
    list.appendChild(empty);
  }
  const footer = document.createElement('div');
  footer.className = 'editor-dialog-actions';
  footer.append(
    button('Cancel', () => overlay.remove()),
    button(`Apply ${result.applied} Safe Change${result.applied === 1 ? '' : 's'}`, () => {
      editor.transact(`Merge ${incomingName}`, () => {
        editor.entities = result.entities;
        editor.clearSelection();
        editor.redrawRequested = true;
      });
      editor.statusMessage = `Merged ${result.applied} safe change${result.applied === 1 ? '' : 's'} from ${incomingName}`;
      overlay.remove();
    }, true),
  );
  (footer.lastElementChild as HTMLButtonElement).disabled = result.applied === 0;
  dialog.append(title, description, summary, list, footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

export function chooseMapToMerge(editor: Editor, snapshot: DocumentRecoverySnapshot): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.map,text/plain';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const baseline = parseMapWithDiagnostics(snapshot.mapText).document.entities;
      const incoming = parseMapWithDiagnostics(await file.text()).document.entities;
      const result = mergeMapsThreeWay(baseline, editor.entities, incoming);
      openMergeResultDialog(editor, snapshot, file.name, result);
    } catch (error) {
      editor.statusMessage = error instanceof Error ? error.message : 'Could not read merge map';
    }
  };
  input.click();
}
