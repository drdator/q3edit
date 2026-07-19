import { exportBrushMacro, importBrushMacro, runBrushMacro } from './brush-macros';
import {
  collectEditorDiagnostics,
  collectEntityInfo,
  collectMapInfo,
  findDocumentObject,
  navigateToDiagnostic,
  type EditorDiagnostic,
} from './diagnostics';
import type { Editor } from './editor';

export type DiagnosticsTab = 'map' | 'entities' | 'find' | 'brush-macros';

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button'; result.className = primary ? 'btn primary' : 'btn'; result.textContent = label; result.onclick = action;
  return result;
}

function download(name: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

function chooseFile(): Promise<string | null> {
  return new Promise(resolve => {
    const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.json,application/json';
    picker.onchange = async () => resolve(picker.files?.[0] ? picker.files[0].text() : null); picker.click();
  });
}

function diagnosticRow(editor: Editor, diagnostic: EditorDiagnostic): HTMLElement {
  const row = document.createElement(diagnostic.target ? 'button' : 'div');
  row.className = `diagnostic-row ${diagnostic.severity}`;
  const severity = document.createElement('span'); severity.className = 'diagnostic-severity'; severity.textContent = diagnostic.severity;
  const message = document.createElement('span');
  message.textContent = `${diagnostic.message}${diagnostic.line ? ` (line ${diagnostic.line}:${diagnostic.column})` : ''}`;
  row.append(severity, message);
  if (row instanceof HTMLButtonElement) row.onclick = () => navigateToDiagnostic(editor, diagnostic);
  return row;
}

export function openDiagnosticsDialog(editor: Editor, initialTab: DiagnosticsTab = 'map'): void {
  document.getElementById('diagnostics-dialog')?.remove();
  let activeTab = initialTab;
  const overlay = document.createElement('div'); overlay.id = 'diagnostics-dialog'; overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'diagnostics-title');
  const dialog = document.createElement('div'); dialog.className = 'editor-dialog diagnostics-dialog';
  const title = document.createElement('div'); title.id = 'diagnostics-title'; title.className = 'editor-dialog-title'; title.textContent = 'Map Diagnostics & Brush Utilities';
  const tabs = document.createElement('div'); tabs.className = 'diagnostics-tabs';
  const content = document.createElement('div'); content.className = 'diagnostics-content';

  const render = () => {
    content.innerHTML = '';
    for (const tabButton of tabs.children) (tabButton as HTMLElement).classList.toggle('active', (tabButton as HTMLElement).dataset.tab === activeTab);
    const diagnostics = collectEditorDiagnostics(editor);
    if (activeTab === 'map') {
      const info = collectMapInfo(editor, diagnostics);
      const summary = document.createElement('div'); summary.className = 'diagnostics-summary';
      for (const [label, value] of [
        ['Entities', info.entities], ['Brushes', info.brushes], ['Patches', info.patches], ['Terrain meshes', info.terrain],
        ['Textures', info.textures], ['Named groups', info.groups], ['Unsupported constructs', info.unsupportedConstructs],
        ['Errors', info.diagnostics.errors], ['Warnings', info.diagnostics.warnings], ['Info', info.diagnostics.info],
      ] as const) {
        const item = document.createElement('div'); item.innerHTML = `<span>${label}</span><strong>${value}</strong>`; summary.appendChild(item);
      }
      const heading = document.createElement('h3'); heading.textContent = 'Validation results';
      const list = document.createElement('div'); list.className = 'diagnostics-list';
      if (diagnostics.length === 0) { const empty = document.createElement('p'); empty.textContent = 'No issues found.'; list.appendChild(empty); }
      else for (const diagnostic of diagnostics) list.appendChild(diagnosticRow(editor, diagnostic));
      const classes = document.createElement('details');
      const classesTitle = document.createElement('summary'); classesTitle.textContent = `Entity class breakdown (${info.entityClasses.length})`; classes.appendChild(classesTitle);
      for (const item of info.entityClasses) { const row = document.createElement('div'); row.textContent = `${item.classname}: ${item.count}`; classes.appendChild(row); }
      content.append(summary, heading, list, classes);
    } else if (activeTab === 'entities') {
      const list = document.createElement('div'); list.className = 'entity-info-list';
      for (const info of collectEntityInfo(editor, diagnostics)) {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'entity-info-row';
        const label = document.createElement('strong'); label.textContent = `${info.id} · ${info.classname}`;
        const details = document.createElement('span');
        details.textContent = `${info.propertyCount} properties · ${info.brushCount} brushes · ${info.patchCount} patches${info.targetname ? ` · targetname ${info.targetname}` : ''}${info.target ? ` → ${info.target}` : ''}`;
        const issue = document.createElement('span'); issue.className = info.diagnostics.length ? 'has-issues' : '';
        issue.textContent = `${info.diagnostics.length} diagnostic${info.diagnostics.length === 1 ? '' : 's'}`;
        row.append(label, details, issue);
        row.onclick = () => navigateToDiagnostic(editor, { target: { kind: 'entity', entityIndex: info.index } });
        list.appendChild(row);
      }
      content.appendChild(list);
    } else if (activeTab === 'find') {
      const form = document.createElement('div'); form.className = 'find-brush-form';
      const help = document.createElement('p'); help.textContent = 'Enter an entity number, entity/brush pair, or document address such as “1 3” or “E1:B3”. Addresses are derived from map order and do not add compatibility epairs.';
      const query = document.createElement('input'); query.placeholder = 'E0:B0';
      const status = document.createElement('div'); status.className = 'diagnostics-inline-status';
      const find = () => {
        const reference = findDocumentObject(editor, query.value);
        if (!reference) { status.textContent = 'No matching entity or brush.'; return; }
        const target = reference.brushIndex === undefined
          ? { kind: 'entity' as const, entityIndex: reference.entityIndex }
          : { kind: 'brush' as const, entityIndex: reference.entityIndex, brushIndex: reference.brushIndex };
        navigateToDiagnostic(editor, { target }); status.textContent = `Selected ${reference.id}`;
      };
      query.onkeydown = event => { if (event.key === 'Enter') find(); };
      form.append(help, query, button('Find & select', find, true), status); content.appendChild(form); query.focus();
    } else {
      const help = document.createElement('p');
      help.textContent = 'Q3Radiant Brush Scripts were an unstable INI macro engine. Q3Edit supports its useful copy/move/rotate subset as validated JSON: no arbitrary code, at most 64 steps, and one undo transaction.';
      const editorArea = document.createElement('textarea'); editorArea.className = 'brush-macro-editor';
      editorArea.value = JSON.stringify({ version: 1, name: 'Offset copy', steps: [
        { operation: 'duplicate' }, { operation: 'translate', offset: [128, 0, 0] },
      ] }, null, 2);
      const status = document.createElement('div'); status.className = 'diagnostics-inline-status';
      const actions = document.createElement('div'); actions.className = 'brush-macro-actions';
      actions.append(
        button('Import...', () => { void chooseFile().then(json => { if (json) { try { editorArea.value = exportBrushMacro(importBrushMacro(json)); status.textContent = 'Macro imported'; } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); } } }); }),
        button('Export', () => { try { const macro = importBrushMacro(editorArea.value); download(`${macro.name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'brush-macro'}.json`, exportBrushMacro(macro)); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); } }),
        button('Run on selected brushes', () => { try { const result = runBrushMacro(editor, importBrushMacro(editorArea.value)); status.textContent = result.changed ? `Updated ${result.selectedBrushes} selected brush${result.selectedBrushes === 1 ? '' : 'es'}` : 'Select at least one brush first'; } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); } }, true),
      );
      content.append(help, editorArea, actions, status);
    }
  };

  for (const [tab, label] of [['map', 'Map Info'], ['entities', 'Entity Info'], ['find', 'Find Brush'], ['brush-macros', 'Brush Macros']] as const) {
    const tabButton = button(label, () => { activeTab = tab; render(); }); tabButton.dataset.tab = tab; tabs.appendChild(tabButton);
  }
  const actions = document.createElement('div'); actions.className = 'editor-dialog-actions'; actions.appendChild(button('Close', () => overlay.remove()));
  dialog.append(title, tabs, content, actions); overlay.appendChild(dialog); document.body.appendChild(overlay); render();
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { overlay.remove(); event.stopPropagation(); } });
}
