import type { CommandRegistry } from './commands';
import type { EditorCommandContext } from './editor-commands';

export interface KeyboardContext {
  commands: CommandRegistry<EditorCommandContext>;
  isFullscreen3d: () => boolean;
}

export function setupKeyboard(ctx: KeyboardContext): void {
  document.addEventListener('keydown', event => {
    if (ctx.isFullscreen3d()) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (ctx.commands.dispatchKeyboardEvent(event)) event.preventDefault();
  });
}
