import { listTextureTags, textureTagsFor, type TextureTagMap } from './texture-tags';

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = primary ? 'btn primary' : 'btn';
  result.textContent = label;
  result.onclick = action;
  return result;
}

export function openTextureTagsDialog(
  texture: string,
  tags: TextureTagMap,
  onSave: (tags: string[]) => void,
): void {
  document.getElementById('texture-tags-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'texture-tags-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog texture-tags-dialog';
  const title = document.createElement('div');
  title.className = 'editor-dialog-title';
  title.textContent = 'Texture Tags';
  const description = document.createElement('div');
  description.className = 'editor-dialog-description';
  description.textContent = texture;
  const label = document.createElement('label');
  label.className = 'texture-tags-field';
  label.appendChild(Object.assign(document.createElement('span'), { textContent: 'Tags' }));
  const input = document.createElement('input');
  input.setAttribute('aria-label', 'Texture tags');
  input.placeholder = 'rusty metal, warm, trim';
  input.value = textureTagsFor(tags, texture).join(', ');
  label.appendChild(input);
  const existing = document.createElement('div');
  existing.className = 'texture-tags-existing';
  const allTags = listTextureTags(tags);
  existing.textContent = allTags.length > 0 ? `Existing tags: ${allTags.join(', ')}` : 'No tags have been created yet.';
  const close = () => overlay.remove();
  const save = () => {
    onSave(input.value.split(','));
    close();
  };
  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  actions.append(button('Cancel', close), button('Save Tags', save, true));
  dialog.append(title, description, label, existing, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      close();
      event.stopPropagation();
    } else if (event.key === 'Enter') {
      save();
      event.preventDefault();
    }
  });
  input.focus();
  input.select();
}
