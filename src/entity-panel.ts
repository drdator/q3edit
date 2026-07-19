import type { Editor } from './editor';
import { getEntityClassRegistry } from './entity-definitions';
import { createEntityClassPicker } from './entity-class-picker';

export function buildEntityPanel(body: HTMLElement, editor: Editor): void {
  body.innerHTML = '';
  const registry = getEntityClassRegistry();

  const label = document.createElement('label');
  label.textContent = 'Entity Class';
  body.appendChild(label);

  const picker = createEntityClassPicker(editor, { idPrefix: 'entity-class' });
  body.appendChild(picker.element);

  const brushLabel = document.createElement('label');
  brushLabel.textContent = 'Brush Entity Class';
  brushLabel.style.marginTop = '10px';
  body.appendChild(brushLabel);

  const brushSelect = document.createElement('select');
  brushSelect.id = 'brush-entity-class-select';
  for (const definition of registry.list().filter(definition => definition.type === 'brush')) {
    const option = document.createElement('option');
    option.value = definition.classname;
    option.textContent = definition.classname;
    option.title = definition.description;
    if (definition.classname === editor.currentBrushEntityClass) option.selected = true;
    brushSelect.appendChild(option);
  }
  brushSelect.addEventListener('change', () => { editor.currentBrushEntityClass = brushSelect.value; });
  body.appendChild(brushSelect);

  const actions = document.createElement('div');
  actions.className = 'kv-row';
  const group = document.createElement('div');
  group.className = 'btn';
  group.textContent = 'Group Selection';
  group.addEventListener('mousedown', () => editor.groupSelectionIntoEntity());
  const ungroup = document.createElement('div');
  ungroup.className = 'btn';
  ungroup.textContent = 'To Worldspawn';
  ungroup.addEventListener('mousedown', () => editor.moveSelectionToWorldspawn());
  actions.append(group, ungroup);
  body.appendChild(actions);

  const props = document.createElement('div');
  props.id = 'entity-props';
  props.style.marginTop = '8px';
  body.appendChild(props);
}
