import { exportBrushMacro, importBrushMacro, runBrushMacro } from './brush-macros';
import {
  collectEditorDiagnostics,
  collectEntityInfo,
  collectMapInfo,
  applyDiagnosticFixes,
  findDocumentObject,
  navigateToDiagnostic,
  type EditorDiagnostic,
} from './diagnostics';
import type { Editor } from './editor';
import { createDesignReviewWorkspace } from './design-review-workspace';
import { createEntityRelationshipWorkspace } from './entity-relationship-workspace';
import { createPerformanceWorkspace } from './performance-workspace';
import { saveProjectConfiguration } from './project-config';

export type DiagnosticsTab = 'map' | 'design-review' | 'entity-logic' | 'performance' | 'entities' | 'find' | 'brush-macros';

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

function diagnosticRow(
  editor: Editor,
  diagnostic: EditorDiagnostic,
  selected: Set<EditorDiagnostic>,
  onSelectionChange: () => void,
  onMute: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = `diagnostic-row ${diagnostic.severity}`;
  const severity = document.createElement('span'); severity.className = 'diagnostic-severity'; severity.textContent = diagnostic.severity;
  const message = document.createElement('span');
  message.textContent = `${diagnostic.message}${diagnostic.line ? ` (line ${diagnostic.line}:${diagnostic.column})` : ''}`;
  const actions = document.createElement('span');
  actions.className = 'diagnostic-row-actions';
  if (diagnostic.fix) {
    const choose = document.createElement('input');
    choose.type = 'checkbox';
    choose.checked = selected.has(diagnostic);
    choose.title = diagnostic.fix.label;
    choose.setAttribute('aria-label', `Select fix: ${diagnostic.fix.label}`);
    choose.onchange = () => {
      if (choose.checked) selected.add(diagnostic);
      else selected.delete(diagnostic);
      onSelectionChange();
    };
    actions.append(choose);
  }
  if (diagnostic.target) actions.append(button('Locate', () => navigateToDiagnostic(editor, diagnostic)));
  actions.append(button('Mute type', onMute));
  row.append(severity, message, actions);
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
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Diagnostics views');
  const content = document.createElement('div'); content.id = 'diagnostics-content'; content.className = 'diagnostics-content'; content.setAttribute('role', 'tabpanel');
  const selectedFixes = new Set<EditorDiagnostic>();

  const render = () => {
    content.innerHTML = '';
    if (activeTab !== 'entity-logic' && editor.entityRelationshipOverlayLines.length > 0) {
      editor.entityRelationshipOverlayLines = [];
      editor.redrawRequested = true;
    }
    content.setAttribute('aria-labelledby', `diagnostics-tab-${activeTab}`);
    for (const tabButton of tabs.children) {
      const element = tabButton as HTMLElement;
      const selected = element.dataset.tab === activeTab;
      element.classList.toggle('active', selected);
      element.setAttribute('aria-selected', String(selected));
      element.tabIndex = selected ? 0 : -1;
    }
    const allDiagnostics = collectEditorDiagnostics(editor);
    const mutedCodes = new Set(editor.projectConfiguration.diagnostics.mutedCodes);
    const diagnostics = allDiagnostics.filter(diagnostic => !mutedCodes.has(diagnostic.code));
    for (const selected of selectedFixes) if (!diagnostics.includes(selected)) selectedFixes.delete(selected);
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
      else {
        const fixBar = document.createElement('div');
        fixBar.className = 'diagnostic-fix-bar';
        const fixStatus = document.createElement('span');
        const updateFixStatus = () => {
          fixStatus.textContent = `${selectedFixes.size} ${selectedFixes.size === 1 ? 'fix' : 'fixes'} selected`;
          applySelected.disabled = selectedFixes.size === 0;
        };
        const applySelected = button('Apply selected fixes', () => {
          applyDiagnosticFixes(editor, [...selectedFixes]);
          selectedFixes.clear();
          render();
        }, true);
        const selectSafe = button('Select safe fixes', () => {
          for (const diagnostic of diagnostics) {
            if (diagnostic.fix && !diagnostic.fix.destructive) selectedFixes.add(diagnostic);
          }
          render();
        });
        fixBar.append(fixStatus, selectSafe, applySelected);
        updateFixStatus();
        list.append(fixBar);
        for (const diagnostic of diagnostics.slice(0, 500)) {
          list.appendChild(diagnosticRow(editor, diagnostic, selectedFixes, updateFixStatus, () => {
            if (!editor.projectConfiguration.diagnostics.mutedCodes.includes(diagnostic.code)) {
              editor.projectConfiguration.diagnostics.mutedCodes.push(diagnostic.code);
              saveProjectConfiguration(editor.projectConfiguration);
            }
            render();
          }));
        }
        if (diagnostics.length > 500) list.appendChild(Object.assign(document.createElement('p'), {
          textContent: `${diagnostics.length - 500} additional diagnostics omitted from this view. Use the filters and source-linked review workspaces to narrow the result.`,
        }));
      }
      if (mutedCodes.size > 0) {
        const muted = document.createElement('details');
        const mutedTitle = document.createElement('summary');
        mutedTitle.textContent = `Muted issue types (${mutedCodes.size})`;
        muted.append(mutedTitle);
        for (const code of [...mutedCodes].sort()) {
          const row = document.createElement('div');
          row.className = 'diagnostic-muted-row';
          row.append(code, button('Unmute', () => {
            editor.projectConfiguration.diagnostics.mutedCodes =
              editor.projectConfiguration.diagnostics.mutedCodes.filter(item => item !== code);
            saveProjectConfiguration(editor.projectConfiguration);
            render();
          }));
          muted.append(row);
        }
        list.append(muted);
      }
      const classes = document.createElement('details');
      const classesTitle = document.createElement('summary'); classesTitle.textContent = `Entity class breakdown (${info.entityClasses.length})`; classes.appendChild(classesTitle);
      for (const item of info.entityClasses) { const row = document.createElement('div'); row.textContent = `${item.classname}: ${item.count}`; classes.appendChild(row); }
      content.append(summary, heading, list, classes);
    } else if (activeTab === 'design-review') {
      content.appendChild(createDesignReviewWorkspace(editor));
    } else if (activeTab === 'entity-logic') {
      content.appendChild(createEntityRelationshipWorkspace(editor));
    } else if (activeTab === 'performance') {
      content.appendChild(createPerformanceWorkspace(editor));
    } else if (activeTab === 'entities') {
      const list = document.createElement('div'); list.className = 'entity-info-list';
      const entityInfo = collectEntityInfo(editor, diagnostics);
      for (const info of entityInfo.slice(0, 500)) {
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
      if (entityInfo.length > 500) list.appendChild(Object.assign(document.createElement('p'), {
        textContent: `${entityInfo.length - 500} additional entities omitted. Use Object Filters to narrow large maps.`,
      }));
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
      help.textContent = 'Brush macros automate repeatable edits to selected brushes. Define duplicate, translate, and rotate steps in JSON, then run the entire sequence as one undoable action.';
      const editorArea = document.createElement('textarea'); editorArea.className = 'brush-macro-editor';
      editorArea.value = JSON.stringify({ version: 1, name: 'Offset copy', steps: [
        { operation: 'duplicate' }, { operation: 'translate', offset: [128, 0, 0] },
      ] }, null, 2);
      const status = document.createElement('div'); status.className = 'diagnostics-inline-status';
      const actions = document.createElement('div'); actions.className = 'brush-macro-actions';
      actions.append(
        button('Import…', () => { void chooseFile().then(json => { if (json) { try { editorArea.value = exportBrushMacro(importBrushMacro(json)); status.textContent = 'Macro imported'; } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); } } }); }),
        button('Export', () => { try { const macro = importBrushMacro(editorArea.value); download(`${macro.name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'brush-macro'}.json`, exportBrushMacro(macro)); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); } }),
        button('Run on selected brushes', () => { try { const result = runBrushMacro(editor, importBrushMacro(editorArea.value)); status.textContent = result.changed ? `Updated ${result.selectedBrushes} selected brush${result.selectedBrushes === 1 ? '' : 'es'}` : 'Select at least one brush first'; } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); } }, true),
      );
      content.append(help, editorArea, actions, status);
    }
  };

  for (const [tab, label] of [['map', 'Map Info'], ['design-review', 'Design Review'], ['entity-logic', 'Entity Logic'], ['performance', 'Performance'], ['entities', 'Entity Info'], ['find', 'Find Brush'], ['brush-macros', 'Brush Macros']] as const) {
    const tabButton = button(label, () => { activeTab = tab; render(); });
    tabButton.id = `diagnostics-tab-${tab}`;
    tabButton.classList.add('diagnostics-tab');
    tabButton.dataset.tab = tab;
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-controls', content.id);
    tabs.appendChild(tabButton);
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabButtons = [...tabs.querySelectorAll<HTMLButtonElement>('.diagnostics-tab')];
    const current = Math.max(0, tabButtons.findIndex(tabButton => tabButton.dataset.tab === activeTab));
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabButtons.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabButtons.length) % tabButtons.length;
    activeTab = tabButtons[next].dataset.tab as DiagnosticsTab;
    render(); tabButtons[next].focus(); event.preventDefault();
  });
  const close = () => {
    editor.entityRelationshipOverlayLines = [];
    editor.redrawRequested = true;
    overlay.remove();
  };
  const actions = document.createElement('div'); actions.className = 'editor-dialog-actions'; actions.appendChild(button('Close', close));
  dialog.append(title, tabs, content, actions); overlay.appendChild(dialog); document.body.appendChild(overlay); render();
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); event.stopPropagation(); } });
}
