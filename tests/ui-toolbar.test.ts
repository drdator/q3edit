import { describe, expect, it } from 'vitest';
import { modeToolPanelClickAction } from '../src/ui-toolbar';

describe('mode toolbar options interaction', () => {
  it('activates a mode without opening options, then toggles options on later clicks', () => {
    expect(modeToolPanelClickAction(false, false)).toBe('activate');
    expect(modeToolPanelClickAction(true, false)).toBe('open');
    expect(modeToolPanelClickAction(true, true)).toBe('close');
  });
});
