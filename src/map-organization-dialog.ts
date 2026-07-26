import type { Editor } from './editor';
import {
  applyObjectFilter,
  collectFilterObjects,
  type FilteredObject,
  type MapOrganizationController,
  type ObjectFilter,
} from './map-organization';
import { readSpatialPlan } from './spatial-plan';

type Tab = 'sets' | 'groups' | 'filters' | 'bookmarks';

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button'; result.className = primary ? 'btn primary' : 'btn'; result.textContent = label; result.onclick = action;
  return result;
}

function input(placeholder: string): HTMLInputElement {
  const result = document.createElement('input');
  result.type = 'text'; result.placeholder = placeholder;
  return result;
}

function select(options: Array<[string, string]>, value = ''): HTMLSelectElement {
  const result = document.createElement('select');
  for (const [optionValue, label] of options) {
    const option = document.createElement('option');
    option.value = optionValue; option.textContent = label; option.selected = optionValue === value;
    result.appendChild(option);
  }
  return result;
}

function row(title: string, description: string, actions: HTMLElement[]): HTMLElement {
  const result = document.createElement('article');
  result.className = 'organization-row';
  const text = document.createElement('div');
  text.innerHTML = `<strong>${title}</strong><span>${description}</span>`;
  const controls = document.createElement('div');
  controls.append(...actions);
  result.append(text, controls);
  return result;
}

export function openMapOrganizationDialog(editor: Editor, controller: MapOrganizationController): void {
  document.getElementById('map-organization-dialog')?.remove();
  let active: Tab = 'sets';
  let filter = controller.newFilter();
  let filtered: FilteredObject[] = [];
  let filteredIndex = -1;
  const overlay = document.createElement('div');
  overlay.id = 'map-organization-dialog'; overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog map-organization-dialog';
  const title = document.createElement('div');
  title.className = 'editor-dialog-title'; title.textContent = 'Map Organization';
  const tabs = document.createElement('div');
  tabs.className = 'diagnostics-tabs';
  const content = document.createElement('div');
  content.className = 'map-organization-content';
  const tabButtons = new Map<Tab, HTMLButtonElement>();

  const refreshTabs = () => {
    for (const [tab, tabButton] of tabButtons) tabButton.classList.toggle('active', tab === active);
  };
  const renderSets = () => {
    const data = controller.data();
    const toolbar = document.createElement('div');
    toolbar.className = 'organization-toolbar';
    const name = input('Set or preset name');
    toolbar.append(
      name,
      button('Save Selection', () => {
        controller.saveSelectionSet(name.value); render();
      }, true),
      button('Save Visibility / Locks', () => {
        controller.saveVisibilityPreset(name.value); render();
      }),
      button('Isolate Selection', () => { controller.isolateSelection(); render(); }),
      button('Restore Before Isolate', () => { controller.restoreIsolate(); render(); }),
    );
    (toolbar.lastElementChild as HTMLButtonElement).disabled = !controller.canRestoreIsolate;
    content.appendChild(toolbar);
    const heading = document.createElement('h3'); heading.textContent = 'Selection sets'; content.appendChild(heading);
    for (const set of data.selectionSets) content.appendChild(row(set.name, `${set.refs.length} saved reference${set.refs.length === 1 ? '' : 's'}`, [
      button('Select & Frame', () => controller.restoreSelectionSet(set)),
      button('Delete', () => { controller.deleteSelectionSet(set.id); render(); }),
    ]));
    const groups = editor.namedGroups();
    if (groups.length > 0) {
      const groupHeading = document.createElement('h3'); groupHeading.textContent = 'Save a whole group as a selection set'; content.appendChild(groupHeading);
      for (const group of groups) content.appendChild(row(group.name, `Stable group ${group.id}`, [
        button('Save as Set', () => {
          const savedName = globalThis.prompt?.('Selection set name', group.name);
          if (savedName) { controller.saveSelectionSet(savedName, group.id); render(); }
        }),
      ]));
    }
    const visibilityHeading = document.createElement('h3'); visibilityHeading.textContent = 'Visibility and lock presets'; content.appendChild(visibilityHeading);
    for (const preset of data.visibilityPresets) content.appendChild(row(preset.name, `${preset.hiddenRefs.length} hidden objects · ${preset.groups.filter(group => group.locked).length} locked groups`, [
      button('Apply', () => controller.applyVisibilityPreset(preset)),
      button('Delete', () => { controller.deleteVisibilityPreset(preset.id); render(); }),
    ]));
  };
  const renderGroups = () => {
    const groups = editor.namedGroups();
    const help = document.createElement('p');
    help.textContent = 'Nested groups are organizational only. They do not change .map entity ownership or compiled output. Parent visibility and locks apply to descendants.';
    content.appendChild(help);
    for (const group of groups) {
      const parent = select([['', 'Root'], ...groups.filter(candidate => candidate.id !== group.id).map(candidate => [candidate.id, candidate.name] as [string, string])], group.parentId ?? '');
      parent.onchange = () => { editor.setNamedGroupParent(group.id, parent.value || undefined); render(); };
      content.appendChild(row(group.name, `${group.id} · ${group.hidden ? 'hidden' : 'visible'} · ${group.locked ? 'locked' : 'unlocked'}`, [parent]));
    }
    if (groups.length === 0) content.append('Create named groups from the Groups side panel first.');
  };
  const renderFilters = () => {
    const groups = editor.namedGroups();
    const areas = readSpatialPlan(editor.worldspawn.properties).areas;
    const connections = readSpatialPlan(editor.worldspawn.properties).connections;
    const controls = document.createElement('div');
    controls.className = 'organization-filter-grid';
    const classname = input('Classname contains'); classname.value = filter.classname;
    const texture = input('Texture / shader contains'); texture.value = filter.texture;
    const group = select([['', 'Any group'], ...groups.map(item => [item.id, item.name] as [string, string])], filter.groupId);
    const area = select([['', 'Any area'], ...areas.map(item => [item.id, item.purpose || item.id] as [string, string])], filter.areaId);
    const connection = select([['', 'Any connection'], ...connections.map(item => [item.id, `${item.fromArea} → ${item.toArea}`] as [string, string])], filter.connectionId);
    const structural = select([['all', 'Structural or detail'], ['structural', 'Structural only'], ['detail', 'Detail only']], filter.structural);
    const visibility = select([['all', 'Visible or hidden'], ['visible', 'Visible only'], ['hidden', 'Hidden only']], filter.visibility);
    const diagnostic = select([['all', 'With or without diagnostics'], ['with-issues', 'With diagnostics'], ['without-issues', 'Without diagnostics']], filter.diagnostic);
    const combine = select([['and', 'Match all filters (AND)'], ['or', 'Match any filter (OR)']], filter.combine);
    const kindControls = document.createElement('div');
    kindControls.className = 'organization-kind-filters';
    const kindChecks = (['entity', 'brush', 'patch', 'face'] as const).map(kind => {
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = filter.kinds.includes(kind);
      const label = document.createElement('label'); label.append(checkbox, document.createTextNode(kind));
      kindControls.appendChild(label); return [kind, checkbox] as const;
    });
    controls.append(classname, texture, group, area, connection, structural, visibility, diagnostic, combine, kindControls);
    const status = document.createElement('div');
    status.className = 'organization-filter-status';
    const update = () => {
      filter = {
        classname: classname.value, texture: texture.value, groupId: group.value, areaId: area.value, connectionId: connection.value,
        structural: structural.value as ObjectFilter['structural'],
        visibility: visibility.value as ObjectFilter['visibility'],
        diagnostic: diagnostic.value as ObjectFilter['diagnostic'],
        combine: combine.value as ObjectFilter['combine'],
        kinds: kindChecks.filter(([, checkbox]) => checkbox.checked).map(([kind]) => kind),
      };
      filtered = applyObjectFilter(collectFilterObjects(editor), filter);
      const counts = filtered.reduce<Record<string, number>>((result, object) => {
        result[object.kind] = (result[object.kind] ?? 0) + 1; return result;
      }, {});
      status.textContent = `${filtered.length} results · ${Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(' · ') || 'no objects'}`;
    };
    for (const element of [classname, texture, group, area, connection, structural, visibility, diagnostic, combine, ...kindChecks.map(([, checkbox]) => checkbox)]) {
      element.addEventListener('input', update); element.addEventListener('change', update);
    }
    const actions = document.createElement('div');
    actions.className = 'organization-toolbar';
    actions.append(
      button('Select Results', () => controller.selectRefs(filtered.map(item => item.ref)), true),
      button('Previous', () => {
        if (!filtered.length) return; filteredIndex = (filteredIndex - 1 + filtered.length) % filtered.length; controller.selectRefs([filtered[filteredIndex].ref]);
      }),
      button('Next', () => {
        if (!filtered.length) return; filteredIndex = (filteredIndex + 1) % filtered.length; controller.selectRefs([filtered[filteredIndex].ref]);
      }),
      button('Save Filter…', () => {
        update(); const name = globalThis.prompt?.('Filter preset name', 'Filter');
        if (name) { controller.saveFilterPreset(name, filter); render(); }
      }),
    );
    content.append(controls, status, actions);
    const heading = document.createElement('h3'); heading.textContent = 'Saved filters'; content.appendChild(heading);
    for (const preset of controller.data().filterPresets) content.appendChild(row(preset.name, `${preset.filter.combine.toUpperCase()} · ${preset.filter.kinds.join(', ')}`, [
      button('Load', () => { filter = structuredClone(preset.filter); render(); }),
      button('Delete', () => { controller.deleteFilterPreset(preset.id); render(); }),
    ]));
    update();
  };
  const renderBookmarks = () => {
    const data = controller.data();
    const groups = editor.namedGroups();
    const areas = readSpatialPlan(editor.worldspawn.properties).areas;
    const toolbar = document.createElement('div');
    toolbar.className = 'organization-toolbar';
    const name = input('Bookmark name');
    const area = select([['', 'No area'], ...areas.map(item => [item.id, item.purpose || item.id] as [string, string])]);
    const group = select([['', 'No group'], ...groups.map(item => [item.id, item.name] as [string, string])]);
    toolbar.append(name, area, group, button('Save Current Views', () => {
      controller.saveBookmark(name.value, area.value, group.value); render();
    }, true));
    content.appendChild(toolbar);
    for (const bookmark of data.bookmarks) content.appendChild(row(bookmark.name, [bookmark.areaId && `area ${bookmark.areaId}`, bookmark.groupId && `group ${bookmark.groupId}`].filter(Boolean).join(' · ') || 'Unscoped', [
      button('Go', () => controller.restoreBookmark(bookmark)),
      button('Delete', () => { controller.deleteBookmark(bookmark.id); render(); }),
    ]));
    const recent = document.createElement('div');
    recent.className = 'organization-toolbar';
    recent.append(
      button('Previous Selection', () => controller.navigateRecentSelection(1)),
      button('Next Selection', () => controller.navigateRecentSelection(-1)),
      button('Previous Location', () => controller.navigateRecentLocation(1)),
      button('Next Location', () => controller.navigateRecentLocation(-1)),
      button('Previous Diagnostic', () => controller.navigateDiagnostic(-1)),
      button('Next Diagnostic', () => controller.navigateDiagnostic(1)),
    );
    content.appendChild(document.createElement('h3')).textContent = 'Recent navigation';
    content.appendChild(recent);
  };
  const render = () => {
    content.replaceChildren();
    refreshTabs();
    if (active === 'sets') renderSets();
    else if (active === 'groups') renderGroups();
    else if (active === 'filters') renderFilters();
    else renderBookmarks();
  };
  for (const [tab, label] of [['sets', 'Sets & Visibility'], ['groups', 'Group Hierarchy'], ['filters', 'Object Filters'], ['bookmarks', 'Bookmarks']] as Array<[Tab, string]>) {
    const tabButton = button(label, () => { active = tab; render(); });
    tabButton.classList.add('diagnostics-tab'); tabButtons.set(tab, tabButton); tabs.appendChild(tabButton);
  }
  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  actions.appendChild(button('Close', () => overlay.remove()));
  dialog.append(title, tabs, content, actions); overlay.appendChild(dialog); document.body.appendChild(overlay); render();
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { overlay.remove(); event.stopPropagation(); } });
}
