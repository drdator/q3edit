import type { Editor } from './editor';
import {
  getEntityClassRegistry,
  type EntityClassDefinition,
  type EntityClassRegistry,
} from './entity-definitions';

export interface EntityClassGroup {
  name: string;
  classes: EntityClassDefinition[];
}

export interface EntityClassPickerOptions {
  idPrefix: string;
  listSize?: number;
  onConfirm?: (classname: string) => void;
  onSelectionChanged?: (classname: string) => void;
}

export interface EntityClassPicker {
  element: HTMLElement;
  search: HTMLInputElement;
  select: HTMLSelectElement;
  refresh: () => void;
  focus: () => void;
}

interface MountedPicker extends EntityClassPicker {
  render: (adoptFirstMatch: boolean) => void;
}

const mountedPickers = new WeakMap<Editor, Set<MountedPicker>>();

export function filterPointEntityClasses(registry: EntityClassRegistry, query: string): EntityClassGroup[] {
  const normalized = query.trim().toLowerCase();
  return registry.categories('point').flatMap(category => {
    const classes = category.classes.filter(definition =>
      !normalized || definition.classname.toLowerCase().includes(normalized)
        || definition.description.toLowerCase().includes(normalized)
        || definition.category.toLowerCase().includes(normalized));
    return classes.length > 0 ? [{ name: category.name, classes }] : [];
  });
}

export function visibleEntityClassSelection(current: string, groups: readonly EntityClassGroup[]): string | null {
  const classes = groups.flatMap(group => group.classes);
  if (classes.some(definition => definition.classname === current)) return current;
  return classes[0]?.classname ?? null;
}

function notifyPickers(editor: Editor, source: MountedPicker): void {
  const pickers = mountedPickers.get(editor);
  if (!pickers) return;
  for (const picker of pickers) {
    if (!picker.element.isConnected) {
      pickers.delete(picker);
      continue;
    }
    if (picker !== source) picker.render(false);
  }
}

export function refreshEntityClassPickers(editor: Editor): void {
  const pickers = mountedPickers.get(editor);
  if (!pickers) return;
  let first = true;
  for (const picker of pickers) {
    if (!picker.element.isConnected) {
      pickers.delete(picker);
      continue;
    }
    picker.render(first);
    first = false;
  }
}

export function createEntityClassPicker(editor: Editor, options: EntityClassPickerOptions): EntityClassPicker {
  const element = document.createElement('div');
  element.className = 'entity-class-picker';

  const search = document.createElement('input');
  search.id = `${options.idPrefix}-search`;
  search.type = 'search';
  search.placeholder = 'Search point entities…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  element.appendChild(search);

  const select = document.createElement('select');
  select.id = `${options.idPrefix}-select`;
  if (options.listSize) {
    select.size = options.listSize;
    select.className = 'entity-class-results';
  }
  element.appendChild(select);

  const description = document.createElement('div');
  description.className = 'entity-class-description';
  element.appendChild(description);

  const updateDescription = () => {
    const definition = getEntityClassRegistry().get(editor.currentEntityClass);
    description.textContent = definition?.description || editor.currentEntityClass;
    description.title = description.textContent;
  };

  const picker: MountedPicker = {
    element,
    search,
    select,
    focus: () => { search.focus(); search.select(); },
    refresh: () => picker.render(false),
    render: (adoptFirstMatch: boolean) => {
      const groups = filterPointEntityClasses(getEntityClassRegistry(), search.value);
      select.innerHTML = '';
      for (const group of groups) {
        const optionGroup = document.createElement('optgroup');
        optionGroup.label = group.name;
        for (const definition of group.classes) {
          const option = document.createElement('option');
          option.value = definition.classname;
          option.textContent = definition.classname;
          option.title = definition.description;
          optionGroup.appendChild(option);
        }
        select.appendChild(optionGroup);
      }

      const visibleSelection = visibleEntityClassSelection(editor.currentEntityClass, groups);
      if (visibleSelection === editor.currentEntityClass) {
        select.value = visibleSelection;
      } else if (adoptFirstMatch && visibleSelection) {
        editor.currentEntityClass = visibleSelection;
        select.value = editor.currentEntityClass;
        notifyPickers(editor, picker);
      } else {
        select.selectedIndex = -1;
      }
      select.disabled = visibleSelection === null;
      updateDescription();
      options.onSelectionChanged?.(editor.currentEntityClass);
    },
  };

  const setSelection = () => {
    if (!select.value) return;
    editor.currentEntityClass = select.value;
    updateDescription();
    options.onSelectionChanged?.(editor.currentEntityClass);
    notifyPickers(editor, picker);
  };
  search.addEventListener('input', () => picker.render(true));
  search.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && !select.disabled) {
      select.focus();
      event.preventDefault();
    } else if (event.key === 'Enter' && select.value) {
      options.onConfirm?.(select.value);
      event.preventDefault();
    }
  });
  select.addEventListener('change', setSelection);
  select.addEventListener('dblclick', () => { setSelection(); options.onConfirm?.(select.value); });
  select.addEventListener('keydown', event => {
    if (event.key === 'Enter' && select.value) {
      setSelection();
      options.onConfirm?.(select.value);
      event.preventDefault();
    }
  });

  const pickers = mountedPickers.get(editor) ?? new Set<MountedPicker>();
  pickers.add(picker);
  mountedPickers.set(editor, pickers);
  picker.render(true);
  return picker;
}
