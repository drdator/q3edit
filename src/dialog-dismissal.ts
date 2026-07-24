const DIALOG_DISMISS_LABELS = new Set(['cancel', 'close']);

export function isDialogDismissLabel(label: string | null | undefined): boolean {
  return DIALOG_DISMISS_LABELS.has((label ?? '').trim().toLowerCase());
}

function topmostDialog(document: Document): HTMLElement | null {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('.editor-dialog-overlay'))
    .filter(overlay => overlay.isConnected && !overlay.hidden);
  return overlays[overlays.length - 1] ?? null;
}

function dialogDismissButton(overlay: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(overlay.querySelectorAll<HTMLButtonElement>('button'));
  return buttons.find(button => (
    !button.disabled
    && !button.hidden
    && button.getAttribute('aria-disabled') !== 'true'
    && (button.hasAttribute('data-dialog-dismiss') || isDialogDismissLabel(button.textContent))
  )) ?? null;
}

/**
 * Makes Escape activate the topmost dialog's real Cancel/Close action.
 * Clicking the existing button preserves dialog-specific cleanup and callbacks.
 */
export function installDialogEscapeDismissal(document: Document = globalThis.document): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    const overlay = topmostDialog(document);
    const dismiss = overlay ? dialogDismissButton(overlay) : null;
    if (!dismiss) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dismiss.click();
  };

  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}
