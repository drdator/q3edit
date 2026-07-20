import type { Editor } from './editor';
import { removeEntityProperty, setEntitySpawnflag, setTypedEntityProperty } from './editor-properties';
import type { Entity } from './entity';
import type { EntityClassDefinition, EntityPropertyDefinition } from './entity-definitions';
import { openModelBrowser } from './model-browser';

export const ENTITY_PROPERTY_COMMAND_IDS = {
  set: 'entity.property.set',
  remove: 'entity.property.remove',
  spawnflag: 'entity.spawnflag.set',
} as const;

function addHelp(container: HTMLElement, definition: EntityPropertyDefinition): void {
  if (!definition.description) return;
  const help = document.createElement('small');
  help.className = 'entity-property-help';
  help.textContent = definition.description;
  container.appendChild(help);
}

function entityReferenceList(editor: Editor, key: string): string {
  const id = `entity-reference-${key.replace(/[^\w-]/g, '-')}`;
  document.getElementById(id)?.remove();
  const list = document.createElement('datalist');
  list.id = id;
  const names = new Set(editor.entities.flatMap(entity =>
    [entity.properties.targetname, entity.properties.name].filter((value): value is string => Boolean(value))));
  for (const name of [...names].sort()) {
    const option = document.createElement('option');
    option.value = name;
    list.appendChild(option);
  }
  document.body.appendChild(list);
  return id;
}

function valueControl(
  editor: Editor,
  entity: Entity,
  definition: EntityPropertyDefinition,
  value: string,
): HTMLElement {
  const commit = (next: string) => setTypedEntityProperty(editor, entity, definition.key, next, definition.type);
  if (definition.type === 'choice' && definition.choices?.length) {
    const select = document.createElement('select');
    if (value && !definition.choices.some(choice => choice.value === value)) {
      select.appendChild(new Option(`${value} (custom)`, value));
    }
    for (const choice of definition.choices) select.appendChild(new Option(choice.label, choice.value));
    select.value = value;
    select.addEventListener('change', () => commit(select.value));
    return select;
  }

  const wrapper = document.createElement('div');
  wrapper.className = `entity-value entity-value-${definition.type}`;
  const input = document.createElement('input');
  input.type = definition.type === 'number' || definition.type === 'angle' ? 'number' : 'text';
  input.value = value;
  input.spellcheck = false;
  input.dataset.commandId = ENTITY_PROPERTY_COMMAND_IDS.set;
  if (definition.type === 'vector' || definition.type === 'color') input.placeholder = 'x y z';
  if (definition.type === 'asset') input.placeholder = 'path/to/asset';
  if (definition.type === 'asset') {
    const choices = definition.key.toLowerCase() === 'skin'
      ? editor.modelManager?.listSkins()
      : editor.modelManager?.listModels();
    if (choices?.length) {
      const id = `entity-assets-${definition.key}`;
      document.getElementById(id)?.remove();
      const list = document.createElement('datalist'); list.id = id;
      for (const path of choices) list.appendChild(new Option(path, path));
      document.body.appendChild(list); input.setAttribute('list', id);
    }
  }
  if (definition.type === 'entity-reference') input.setAttribute('list', entityReferenceList(editor, definition.key));
  input.addEventListener('change', () => commit(input.value));
  wrapper.appendChild(input);

  if (definition.type === 'asset' && definition.key.toLowerCase() === 'model') {
    const browse = document.createElement('button');
    browse.type = 'button'; browse.className = 'btn'; browse.textContent = 'Browse…';
    browse.addEventListener('click', () => openModelBrowser(editor, input.value, path => {
      input.value = path; commit(path);
    }, entity.properties.skin));
    wrapper.appendChild(browse);
  }

  if (definition.type === 'color') {
    const picker = document.createElement('input');
    picker.type = 'color';
    const parts = value.trim().split(/\s+/).map(Number);
    const hex = parts.length >= 3 && parts.every(Number.isFinite)
      ? `#${parts.slice(0, 3).map(part => Math.round(Math.max(0, Math.min(1, part)) * 255).toString(16).padStart(2, '0')).join('')}`
      : '#ffffff';
    picker.value = hex;
    picker.addEventListener('input', () => {
      const rgb = [1, 3, 5].map(offset => parseInt(picker.value.slice(offset, offset + 2), 16) / 255);
      input.value = rgb.map(component => component.toFixed(3)).join(' ');
      commit(input.value);
    });
    wrapper.appendChild(picker);
  }

  if (definition.type === 'angle') {
    const directions: Array<[string, string]> = [['N', '90'], ['E', '0'], ['S', '270'], ['W', '180'], ['Up', '-1'], ['Down', '-2']];
    const directionsRow = document.createElement('div');
    directionsRow.className = 'entity-angle-directions';
    for (const [label, angle] of directions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.textContent = label;
      button.addEventListener('click', () => { input.value = angle; commit(angle); });
      directionsRow.appendChild(button);
    }
    wrapper.appendChild(directionsRow);
  }
  return wrapper;
}

export function buildDefinedEntityProperties(
  container: HTMLElement,
  editor: Editor,
  entity: Entity,
  definition: EntityClassDefinition,
): void {
  if (definition.description) {
    const description = document.createElement('p');
    description.className = 'entity-class-description';
    description.textContent = definition.description;
    container.appendChild(description);
  }

  const definedProperties = { ...definition.properties };
  if ((definition.classname === 'misc_model' || definition.model) && !definedProperties.model) {
    definedProperties.model = { key: 'model', name: 'Model', type: 'asset', description: 'MD3 model path.' };
  }
  if ((definition.classname === 'misc_model' || definition.model) && !definedProperties.skin) {
    definedProperties.skin = { key: 'skin', name: 'Skin', type: 'asset', description: 'Optional surface-to-shader skin file.' };
  }
  for (const property of Object.values(definedProperties)) {
    const hasValue = property.key in entity.properties;
    const alwaysShowControl = definition.classname === 'misc_model'
      && (property.key === 'model' || property.key === 'skin');
    const row = document.createElement('div');
    row.className = 'entity-defined-property';
    const label = document.createElement('label');
    label.textContent = property.name || property.key;
    label.title = property.key;
    row.appendChild(label);
    const controls = document.createElement('div');
    controls.className = 'entity-property-controls';
    if (hasValue || alwaysShowControl) {
      controls.appendChild(valueControl(editor, entity, property, entity.properties[property.key] ?? ''));
    }
    if (hasValue) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn icon-btn kv-del';
      remove.title = `Remove ${property.name || property.key}`;
      remove.setAttribute('aria-label', remove.title);
      remove.dataset.commandId = ENTITY_PROPERTY_COMMAND_IDS.remove;
      remove.innerHTML = '<i class="ph ph-trash"></i>';
      remove.addEventListener('click', () => removeEntityProperty(editor, entity, property.key));
      controls.appendChild(remove);
    } else if (!alwaysShowControl) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn';
      add.textContent = `Add ${property.name || property.key}`;
      add.addEventListener('click', () => setTypedEntityProperty(
        editor, entity, property.key, property.default ?? definition.defaults[property.key] ?? '', property.type));
      controls.appendChild(add);
    }
    row.appendChild(controls);
    addHelp(row, property);
    container.appendChild(row);
  }

  if (definition.spawnflags.length > 0) {
    const flags = document.createElement('fieldset');
    flags.className = 'entity-spawnflags';
    const legend = document.createElement('legend');
    legend.textContent = 'Spawnflags';
    flags.appendChild(legend);
    const current = Number.parseInt(entity.properties.spawnflags ?? '0', 10) || 0;
    const rawRow = document.createElement('label');
    rawRow.textContent = 'Raw value';
    const rawInput = document.createElement('input');
    rawInput.type = 'number';
    rawInput.value = String(current);
    rawInput.dataset.commandId = ENTITY_PROPERTY_COMMAND_IDS.set;
    rawInput.addEventListener('change', () => setTypedEntityProperty(
      editor, entity, 'spawnflags', rawInput.value, 'number'));
    rawRow.appendChild(rawInput);
    flags.appendChild(rawRow);
    for (const flag of definition.spawnflags) {
      const label = document.createElement('label');
      label.title = flag.description ?? '';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = (current & flag.bit) !== 0;
      checkbox.dataset.commandId = ENTITY_PROPERTY_COMMAND_IDS.spawnflag;
      checkbox.addEventListener('change', () => setEntitySpawnflag(editor, entity, flag.bit, checkbox.checked));
      label.append(checkbox, document.createTextNode(flag.name));
      flags.appendChild(label);
    }
    container.appendChild(flags);
  }
}
