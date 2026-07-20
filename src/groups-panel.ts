import type { Editor } from './editor';
import { countNamedGroupMembers } from './named-groups';

function button(label: string, title: string, action: () => void, className = ''): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `btn named-group-action ${className}`.trim();
  element.textContent = label;
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

  for (const group of groups) {
    const item = document.createElement('div');
    item.className = 'named-group-item';
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
    meta.textContent = `${members} member${members === 1 ? '' : 's'} · ${group.hidden ? 'hidden' : 'visible'} · ${group.locked ? 'locked' : 'unlocked'}`;
    item.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'named-group-actions';
    actions.append(
      button('Select', 'Select all group members', () => editor.selectNamedGroup(group.id)),
      button('Add', 'Add current selection', () => editor.addSelectionToNamedGroup(group.id)),
      button(group.hidden ? 'Show' : 'Hide', 'Toggle group visibility', () => editor.setNamedGroupHidden(group.id, !group.hidden)),
      button(group.locked ? 'Unlock' : 'Lock', 'Toggle group selection lock', () => editor.setNamedGroupLocked(group.id, !group.locked)),
      button('Delete', 'Delete group but keep its objects', () => editor.deleteNamedGroup(group.id), 'named-group-delete'),
    );
    (actions.children[0] as HTMLButtonElement).disabled = members === 0;
    (actions.children[1] as HTMLButtonElement).disabled = editor.selection.length === 0;
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
