import { describe, expect, it, vi } from 'vitest';
import {
  installDialogEscapeDismissal,
  isDialogDismissLabel,
} from '../src/dialog-dismissal';

interface FakeKeyEvent {
  key: string;
  defaultPrevented: boolean;
  isComposing: boolean;
  preventDefault: ReturnType<typeof vi.fn>;
  stopImmediatePropagation: ReturnType<typeof vi.fn>;
}

function fakeEscapeEvent(): FakeKeyEvent {
  return {
    key: 'Escape',
    defaultPrevented: false,
    isComposing: false,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

function dismissalFixture(labels: string[]) {
  const listeners = new Map<string, EventListener>();
  const buttons = labels.map(textContent => ({
    textContent,
    disabled: false,
    hidden: false,
    click: vi.fn(),
    getAttribute: () => null,
    hasAttribute: () => false,
  }));
  const overlay = {
    isConnected: true,
    hidden: false,
    querySelectorAll: () => buttons,
  };
  const document = {
    querySelectorAll: () => [overlay],
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  } as unknown as Document;
  return { buttons, document, listeners };
}

describe('dialog Escape dismissal', () => {
  it('recognizes only explicit Cancel and Close actions', () => {
    expect(isDialogDismissLabel(' Cancel ')).toBe(true);
    expect(isDialogDismissLabel('CLOSE')).toBe(true);
    expect(isDialogDismissLabel('Save')).toBe(false);
    expect(isDialogDismissLabel('OK')).toBe(false);
  });

  it('clicks the topmost dialog dismissal action and consumes Escape', () => {
    const fixture = dismissalFixture(['Save', 'Cancel']);
    const dispose = installDialogEscapeDismissal(fixture.document);
    const event = fakeEscapeEvent();

    fixture.listeners.get('keydown')!(event as unknown as Event);

    expect(fixture.buttons[0].click).not.toHaveBeenCalled();
    expect(fixture.buttons[1].click).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    dispose();
    expect(fixture.listeners.has('keydown')).toBe(false);
  });

  it('leaves Escape alone when a dialog has no Cancel or Close action', () => {
    const fixture = dismissalFixture(['Save', 'OK']);
    installDialogEscapeDismissal(fixture.document);
    const event = fakeEscapeEvent();

    fixture.listeners.get('keydown')!(event as unknown as Event);

    expect(fixture.buttons.every(button => button.click.mock.calls.length === 0)).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
