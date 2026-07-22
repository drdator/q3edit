import type { Editor } from './editor';
import {
  normalizeGlobalPreferences,
  saveGlobalPreferences,
  type QuickPlayPreferences,
  type QuickPlayQuality,
} from './preferences';

export interface QuickPlayDialogOptions {
  editor: Editor;
  onPlay: (preferences: QuickPlayPreferences) => void | Promise<void>;
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

function button(label: string, primary = false): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = `btn${primary ? ' primary' : ''}`;
  control.textContent = label;
  return control;
}

export function quickPlayLabel(preferences: QuickPlayPreferences): string {
  const quality = preferences.quality[0].toUpperCase() + preferences.quality.slice(1);
  if (!preferences.botsEnabled) return `Quick Play — ${quality}`;
  return `Quick Play — ${quality}, ${preferences.botCount} ${preferences.botCount === 1 ? 'Bot' : 'Bots'}`;
}

export function openQuickPlayDialog({ editor, onPlay }: QuickPlayDialogOptions): void {
  document.getElementById('quick-play-dialog')?.remove();
  const current = editor.preferences.quickPlay;

  const overlay = document.createElement('div');
  overlay.id = 'quick-play-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'quick-play-title');

  const dialog = document.createElement('form');
  dialog.className = 'editor-dialog quick-play-dialog';
  const title = document.createElement('div');
  title.id = 'quick-play-title';
  title.className = 'editor-dialog-title';
  title.textContent = 'Quick Play Options';
  const description = document.createElement('div');
  description.className = 'editor-dialog-description';
  description.textContent = 'Choose how the current map is compiled and launched. These settings are remembered.';

  const fields = document.createElement('div');
  fields.className = 'quick-play-fields';

  const quality = document.createElement('select');
  quality.append(
    option('fast', 'Fast — BSP and bot navigation', current.quality === 'fast'),
    option('normal', 'Normal — BSP, VIS, and fast lighting', current.quality === 'normal'),
    option('full', 'Full — BSP, VIS, and final lighting', current.quality === 'full'),
  );

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
    summary.textContent = bots.checked
      ? 'Bot navigation will be generated and opponents will be added when the map starts.'
      : 'Launches alone for movement, lighting, and geometry checks.';
  };
  bots.onchange = updateBotState;
  updateBotState();

  fields.append(field('Compile quality', quality), field('Add bots', bots), botSettings, summary);

  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  const cancel = button('Cancel');
  const save = button('Save');
  const play = button('Play Now', true);

  const persist = (): QuickPlayPreferences => {
    const preferences = normalizeGlobalPreferences({
      ...editor.preferences,
      quickPlay: {
        quality: quality.value as QuickPlayQuality,
        botsEnabled: bots.checked,
        botCount: Number(botCount.value),
        botSkill: Number(botSkill.value),
      },
    }).quickPlay;
    editor.preferences.quickPlay = preferences;
    saveGlobalPreferences(editor.preferences);
    return preferences;
  };

  cancel.onclick = () => overlay.remove();
  save.onclick = () => {
    persist();
    editor.statusMessage = 'Quick Play settings saved';
    overlay.remove();
  };
  const playNow = (): void => {
    const preferences = persist();
    overlay.remove();
    void onPlay(preferences);
  };
  play.onclick = playNow;
  dialog.onsubmit = event => { event.preventDefault(); playNow(); };

  actions.append(cancel, save, play);
  dialog.append(title, description, fields, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { overlay.remove(); event.stopPropagation(); }
  });
  quality.focus();
}
