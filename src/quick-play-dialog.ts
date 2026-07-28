import type { Editor } from './editor';
import {
  normalizeGlobalPreferences,
  saveGlobalPreferences,
  type QuickPlayPreferences,
} from './preferences';
import {
  buildSettingsFromPreferences,
  createBuildSettingsControls,
} from './build-settings';
import { openEditorDialog } from './ui-dialog';

export interface QuickPlayDialogOptions {
  editor: Editor;
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

export function openQuickPlayDialog({ editor }: QuickPlayDialogOptions): void {
  const current = editor.preferences.quickPlay;
  const description = document.createElement('div');
  description.className = 'editor-dialog-description';
  description.textContent = 'Choose how the current map is compiled and launched. These settings are remembered.';

  const fields = document.createElement('div');
  fields.className = 'quick-play-fields';

  const buildHeading = document.createElement('h3');
  buildHeading.className = 'quick-play-section-title';
  buildHeading.textContent = 'Build';
  const buildControls = createBuildSettingsControls(
    buildSettingsFromPreferences(current),
    editor.isRegionActive(),
  );

  const playHeading = document.createElement('h3');
  playHeading.className = 'quick-play-section-title';
  playHeading.textContent = 'Play';

  const bots = document.createElement('input');
  bots.type = 'checkbox';
  bots.checked = current.botsEnabled;
  bots.setAttribute('aria-controls', 'quick-play-bot-settings');

  const botSettings = document.createElement('div');
  botSettings.id = 'quick-play-bot-settings';
  botSettings.className = 'quick-play-bot-settings';
  const botCount = document.createElement('select');
  for (let count = 1; count <= 3; count++) {
    botCount.appendChild(option(String(count), String(count), current.botCount === count));
  }
  const botSkill = document.createElement('select');
  const skills = ['Easy', 'Casual', 'Normal', 'Hard', 'Nightmare'];
  skills.forEach((label, index) => botSkill.appendChild(option(String(index + 1), label, current.botSkill === index + 1)));
  botSettings.append(field('Bot count', botCount), field('Bot skill', botSkill));

  const summary = document.createElement('div');
  summary.className = 'quick-play-summary';
  const updateBotState = (): void => {
    botCount.disabled = !bots.checked;
    botSkill.disabled = !bots.checked;
    botSettings.classList.toggle('disabled', !bots.checked);
    bots.setAttribute('aria-expanded', String(bots.checked));
    buildControls.setAasRequired(bots.checked);
    summary.textContent = bots.checked
      ? 'Bot navigation will be generated and opponents will be added when the map starts.'
      : 'Launches alone for movement, lighting, and geometry checks.';
  };
  bots.onchange = updateBotState;
  updateBotState();

  fields.append(
    buildHeading,
    buildControls.element,
    playHeading,
    field('Add bots', bots),
    botSettings,
    summary,
  );

  const persist = (): QuickPlayPreferences => {
    const build = buildControls.read();
    const preferences = normalizeGlobalPreferences({
      ...editor.preferences,
      quickPlay: {
        quality: build.quality,
        generateAas: build.generateAas,
        scope: build.scope,
        botsEnabled: bots.checked,
        botCount: Number(botCount.value),
        botSkill: Number(botSkill.value),
      },
    }).quickPlay;
    editor.preferences.quickPlay = preferences;
    saveGlobalPreferences(editor.preferences);
    return preferences;
  };

  openEditorDialog({
    id: 'quick-play-dialog',
    title: 'Quick Play Options',
    titleId: 'quick-play-title',
    className: 'quick-play-dialog',
    form: true,
    body: [description, fields],
    actions: [
      { label: 'Cancel', dismiss: true },
      { label: 'Save', primary: true, type: 'submit' },
    ],
    initialFocus: buildControls.element.querySelector<HTMLElement>('input, select, button') ?? undefined,
    onSubmit: handle => {
      persist();
      editor.statusMessage = 'Quick Play settings saved';
      handle.close();
    },
  });
}
