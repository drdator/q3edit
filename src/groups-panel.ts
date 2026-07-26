import type { Editor } from './editor';
import { countNamedGroupMembers } from './named-groups';
import type { Vec3 } from './math';

const NAMED_GROUP_ICON_NAMES = {
  select: 'selection-all',
  add: 'selection-plus',
  hide: 'eye-slash',
  show: 'eye',
  lock: 'lock',
  unlock: 'lock-open',
  delete: 'trash',
  link: 'link-simple-horizontal',
  moveLink: 'arrows-out-cardinal',
  unlink: 'link-break',
};

function promptOffset(label: string, initial: Vec3): Vec3 | null {
  const value = globalThis.prompt?.(label, initial.join(' '));
  if (value === undefined || value === null) return null;
  const parts = value.trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? [parts[0], parts[1], parts[2]]
    : null;
}

function button(icon: string, label: string, title: string, action: () => void, className = ''): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `btn icon-btn named-group-action ${className}`.trim();
  element.innerHTML = `<i class="ph ph-${icon}" aria-hidden="true"></i>`;
  element.setAttribute('aria-label', label);
  element.title = title;
  element.addEventListener('mousedown', event => { event.stopPropagation(); action(); });
  return element;
}

export function buildGroupsPanel(container: HTMLElement, editor: Editor): void {
  container.innerHTML = '';
  container.classList.add('named-groups-panel');
  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'btn named-group-create';
  create.textContent = 'New Named Group';
  create.addEventListener('mousedown', () => {
    const name = globalThis.prompt?.('Named group', 'Group');
    if (name) editor.createNamedGroup(name);
  });
  container.appendChild(create);

  const groups = editor.namedGroups();
  if (groups.length === 0) {
    const empty = document.createElement('label');
    empty.textContent = 'No named groups';
    empty.style.color = '#666';
    container.appendChild(empty);
    return;
  }

  const ordered = [...groups].sort((a, b) => {
    const path = (id: string): string => {
      const names: string[] = [];
      const visited = new Set<string>();
      let current = groups.find(group => group.id === id);
      while (current && !visited.has(current.id)) {
        names.unshift(current.name.toLowerCase());
        visited.add(current.id);
        current = groups.find(group => group.id === current?.parentId);
      }
      return names.join('/');
    };
    return path(a.id).localeCompare(path(b.id));
  });
  const depth = (id: string): number => {
    let result = 0;
    const visited = new Set<string>();
    let current = groups.find(group => group.id === id);
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id); result++;
      current = groups.find(group => group.id === current?.parentId);
    }
    return result;
  };
  for (const group of ordered) {
    const item = document.createElement('div');
    item.className = 'named-group-item';
    item.style.setProperty('--group-depth', String(depth(group.id)));
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'named-group-name';
    name.value = group.name;
    name.title = `Stable ID: ${group.id}`;
    name.addEventListener('change', () => editor.renameNamedGroup(group.id, name.value));
    item.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'named-group-meta';
    const members = countNamedGroupMembers(editor.entities, group.id);
    const parent = groups.find(candidate => candidate.id === group.parentId);
    const linkedSource = group.linkedSourceId
      ? groups.find(candidate => candidate.id === group.linkedSourceId)
      : undefined;
    const sourceInstances = groups.filter(candidate => candidate.linkedSourceId === group.id).length;
    const linkStatus = group.linkedSourceId
      ? linkedSource
        ? ` · linked to ${linkedSource.name}`
        : ' · broken link'
      : sourceInstances > 0
        ? ` · source for ${sourceInstances} instance${sourceInstances === 1 ? '' : 's'}`
        : '';
    meta.textContent = `${members} member${members === 1 ? '' : 's'} · ${group.hidden ? 'hidden' : 'visible'} · ${group.locked ? 'locked' : 'unlocked'}${parent ? ` · in ${parent.name}` : ''}${linkStatus}`;
    if (group.linkedSourceId && !linkedSource) {
      meta.classList.add('named-group-link-broken');
      meta.title = 'The source metadata is missing. Unlink to keep this geometry as an independent group.';
    }
    item.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'named-group-actions';
    actions.append(
      button(NAMED_GROUP_ICON_NAMES.select, 'Select group', 'Select all group members', () => editor.selectNamedGroup(group.id)),
      button(NAMED_GROUP_ICON_NAMES.add, 'Add selection', 'Add current selection to group', () => editor.addSelectionToNamedGroup(group.id)),
      button(group.hidden ? NAMED_GROUP_ICON_NAMES.show : NAMED_GROUP_ICON_NAMES.hide,
        group.hidden ? 'Show group' : 'Hide group', 'Toggle group visibility', () => editor.setNamedGroupHidden(group.id, !group.hidden)),
      button(group.locked ? NAMED_GROUP_ICON_NAMES.unlock : NAMED_GROUP_ICON_NAMES.lock,
        group.locked ? 'Unlock group' : 'Lock group', 'Toggle group selection lock', () => editor.setNamedGroupLocked(group.id, !group.locked)),
      ...(group.linkedSourceId ? [
        button(NAMED_GROUP_ICON_NAMES.moveLink, 'Set linked offset', 'Set this instance offset from its source', () => {
          const offset = promptOffset('Linked instance offset (X Y Z)', group.linkedOffset ?? [0, 0, 0]);
          if (offset) editor.setLinkedGroupOffset(group.id, offset);
          else editor.statusMessage = 'Linked group offset must contain three numbers';
        }),
        button(NAMED_GROUP_ICON_NAMES.unlink, 'Unlink group', 'Keep the geometry but stop mirroring the source',
          () => editor.unlinkNamedGroup(group.id)),
      ] : [
        button(NAMED_GROUP_ICON_NAMES.link, 'Create linked copy', 'Create a locked geometry copy that mirrors this group', () => {
          const offset = promptOffset('Linked copy offset (X Y Z)', [editor.gridSize, editor.gridSize, 0]);
          if (offset) editor.createLinkedGroupCopy(group.id, offset);
          else editor.statusMessage = 'Linked group offset must contain three numbers';
        }),
      ]),
      button(NAMED_GROUP_ICON_NAMES.delete, 'Delete group', 'Delete group but keep its objects',
        () => editor.deleteNamedGroup(group.id), 'named-group-delete'),
    );
    (actions.children[0] as HTMLButtonElement).disabled = members === 0;
    (actions.children[1] as HTMLButtonElement).disabled = editor.selection.length === 0;
    if (group.linkedSourceId) {
      (actions.children[1] as HTMLButtonElement).disabled = true;
      (actions.children[3] as HTMLButtonElement).disabled = true;
    }
    item.appendChild(actions);
    container.appendChild(item);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn named-group-remove-selection';
  remove.textContent = 'Remove Selection from Groups';
  remove.disabled = editor.selection.length === 0;
  remove.addEventListener('mousedown', () => editor.removeSelectionFromNamedGroups());
  container.appendChild(remove);
}
