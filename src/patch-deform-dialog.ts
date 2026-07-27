import type { Editor } from './editor';

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = primary ? 'btn primary' : 'btn';
  result.textContent = label;
  result.onclick = action;
  return result;
}

export function openPatchDeformDialog(editor: Editor): void {
  document.getElementById('patch-deform-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'patch-deform-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'patch-deform-title');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog patch-deform-dialog';
  const title = document.createElement('div');
  title.id = 'patch-deform-title';
  title.className = 'editor-dialog-title';
  title.textContent = 'Deform Patch';
  const description = document.createElement('p');
  description.className = 'editor-dialog-description';
  description.textContent = 'Randomly offset each selected patch control point within a symmetric range on one axis.';
  const fields = document.createElement('div');
  fields.className = 'patch-deform-fields';
  const amountLabel = document.createElement('label');
  amountLabel.className = 'surface-alignment-field';
  const amount = document.createElement('input');
  amount.type = 'number';
  amount.min = '0';
  amount.step = '1';
  amount.value = '16';
  amountLabel.append(Object.assign(document.createElement('span'), { textContent: 'Maximum offset' }), amount);
  const axisLabel = document.createElement('label');
  axisLabel.className = 'surface-alignment-field';
  const axis = document.createElement('select');
  axis.className = 'app-select';
  axis.append(
    Object.assign(document.createElement('option'), { value: '0', textContent: 'X axis' }),
    Object.assign(document.createElement('option'), { value: '1', textContent: 'Y axis' }),
    Object.assign(document.createElement('option'), { value: '2', textContent: 'Z axis', selected: true }),
  );
  axisLabel.append(Object.assign(document.createElement('span'), { textContent: 'Axis' }), axis);
  fields.append(amountLabel, axisLabel);
  const error = document.createElement('div');
  error.className = 'patch-deform-error';
  const close = () => overlay.remove();
  const apply = () => {
    const value = Number(amount.value);
    if (!Number.isFinite(value) || value < 0) {
      error.textContent = 'Maximum offset must be zero or greater.';
      amount.focus();
      return;
    }
    editor.deformPatches(value, Number(axis.value) as 0 | 1 | 2);
    close();
  };
  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  actions.append(button('Cancel', close), button('Deform', apply, true));
  dialog.append(title, description, fields, error, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      close();
      event.stopPropagation();
    } else if (event.key === 'Enter') {
      apply();
      event.preventDefault();
    }
  });
  amount.focus();
  amount.select();
}
