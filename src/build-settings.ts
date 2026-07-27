import type {
  QuickPlayBuildScope,
  QuickPlayPreferences,
  QuickPlayQuality,
} from './preferences';

export interface BuildSettings {
  quality: QuickPlayQuality;
  generateAas: boolean;
  scope: QuickPlayBuildScope;
}

export interface BuildSettingsControls {
  element: HTMLDivElement;
  read: () => BuildSettings;
  set: (settings: BuildSettings) => void;
  onChange: (listener: () => void) => void;
  setAasRequired: (required: boolean) => void;
  setDisabled: (disabled: boolean) => void;
  focus: () => void;
}

function option(value: string, label: string, selected: boolean): HTMLOptionElement {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  item.selected = selected;
  return item;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'preferences-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  row.append(caption, control);
  return row;
}

export function buildSettingsFromPreferences(preferences: QuickPlayPreferences): BuildSettings {
  return {
    quality: preferences.quality,
    generateAas: preferences.generateAas,
    scope: preferences.scope,
  };
}

export function createBuildSettingsControls(
  initial: BuildSettings,
  regionActive: boolean,
): BuildSettingsControls {
  const element = document.createElement('div');
  element.className = 'build-settings-fields';

  const quality = document.createElement('select');
  quality.setAttribute('aria-label', 'Build quality');
  quality.append(
    option('fast', 'Fast — BSP only, no lighting', initial.quality === 'fast'),
    option('normal', 'Normal — BSP, fast VIS, and lighting', initial.quality === 'normal'),
    option('full', 'Full — BSP, full VIS, and lighting', initial.quality === 'full'),
  );

  const generateAas = document.createElement('input');
  generateAas.type = 'checkbox';
  generateAas.checked = initial.generateAas;
  generateAas.setAttribute('aria-label', 'Generate bot navigation');

  element.append(
    field('Quality', quality),
    field('Bot navigation', generateAas),
  );

  let scope: HTMLSelectElement | null = null;
  if (regionActive) {
    scope = document.createElement('select');
    scope.setAttribute('aria-label', 'Build scope');
    scope.append(
      option('region', 'Active region', initial.scope === 'region'),
      option('full', 'Full map', initial.scope === 'full'),
    );
    element.append(field('Scope', scope));
  }

  let aasRequired = false;
  let disabled = false;
  let changeListener = () => {};
  quality.onchange = () => changeListener();
  generateAas.onchange = () => changeListener();
  if (scope) scope.onchange = () => changeListener();
  const updateDisabledState = (): void => {
    quality.disabled = disabled;
    if (scope) scope.disabled = disabled;
    generateAas.disabled = disabled || aasRequired;
    generateAas.title = aasRequired ? 'Bot navigation is required when Quick Play adds bots.' : '';
  };

  return {
    element,
    read: () => ({
      quality: quality.value as QuickPlayQuality,
      generateAas: generateAas.checked,
      scope: regionActive ? scope?.value as QuickPlayBuildScope ?? initial.scope : initial.scope,
    }),
    set: (settings) => {
      quality.value = settings.quality;
      generateAas.checked = settings.generateAas;
      if (scope) scope.value = settings.scope;
      updateDisabledState();
    },
    onChange: (listener) => { changeListener = listener; },
    setAasRequired: (required) => {
      aasRequired = required;
      if (required) generateAas.checked = true;
      updateDisabledState();
    },
    setDisabled: (nextDisabled) => {
      disabled = nextDisabled;
      updateDisabledState();
    },
    focus: () => quality.focus(),
  };
}
