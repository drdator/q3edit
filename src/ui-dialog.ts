export interface EditorDialogHandle {
  overlay: HTMLDivElement;
  dialog: HTMLElement;
  close: () => void;
}

export interface EditorDialogAction {
  label: string;
  primary?: boolean;
  dismiss?: boolean;
  type?: 'button' | 'submit';
  onClick?: (handle: EditorDialogHandle, event: MouseEvent) => void;
}

export interface EditorDialogOptions {
  id: string;
  title: string;
  titleId?: string;
  className?: string;
  form?: boolean;
  body?: Node | readonly Node[];
  actions?: readonly EditorDialogAction[];
  initialFocus?: HTMLElement;
  onSubmit?: (handle: EditorDialogHandle, event: SubmitEvent) => void;
  onClose?: () => void;
}

export function openEditorDialog(options: EditorDialogOptions): EditorDialogHandle {
  document.getElementById(options.id)?.remove();

  const overlay = document.createElement('div');
  overlay.id = options.id;
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const titleId = options.titleId ?? `${options.id}-title`;
  overlay.setAttribute('aria-labelledby', titleId);

  const dialog = document.createElement(options.form ? 'form' : 'div');
  dialog.className = `editor-dialog ${options.className ?? ''}`.trim();

  const title = document.createElement('div');
  title.id = titleId;
  title.className = 'editor-dialog-title';
  title.textContent = options.title;
  dialog.appendChild(title);

  const body = options.body
    ? Array.isArray(options.body) ? options.body : [options.body]
    : [];
  dialog.append(...body);

  let closed = false;
  const handle: EditorDialogHandle = {
    overlay,
    dialog,
    close: () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      options.onClose?.();
    },
  };

  if (options.actions?.length) {
    const actions = document.createElement('div');
    actions.className = 'editor-dialog-actions';
    for (const action of options.actions) {
      const button = document.createElement('button');
      button.type = action.type ?? 'button';
      button.className = `btn${action.primary ? ' primary' : ''}`;
      button.textContent = action.label;
      if (action.dismiss) button.dataset.dialogDismiss = '';
      button.addEventListener('click', event => {
        action.onClick?.(handle, event);
        if (action.dismiss && !event.defaultPrevented) handle.close();
      });
      actions.appendChild(button);
    }
    dialog.appendChild(actions);
  }

  if (options.form && options.onSubmit) {
    dialog.addEventListener('submit', event => {
      event.preventDefault();
      options.onSubmit?.(handle, event as SubmitEvent);
    });
  }

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    if (!overlay.isConnected) return;
    (options.initialFocus ?? dialog.querySelector<HTMLElement>('input, select, textarea, button'))?.focus();
  });
  return handle;
}
