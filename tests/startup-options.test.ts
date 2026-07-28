import { describe, expect, it } from 'vitest';
import { startupDialogsEnabled, startupTheme } from '../src/startup-options';

describe('startup options', () => {
  it('disables optional startup dialogs only for startupDialogs=0', () => {
    expect(startupDialogsEnabled('?editor')).toBe(true);
    expect(startupDialogsEnabled('?editor&startupDialogs=1')).toBe(true);
    expect(startupDialogsEnabled('?editor&startupDialogs=0')).toBe(false);
  });

  it('accepts built-in theme overrides and ignores invalid values', () => {
    expect(startupTheme('?editor&theme=dark')).toBe('dark');
    expect(startupTheme('?editor&theme=light')).toBe('light');
    expect(startupTheme('?editor&theme=high-contrast')).toBe('high-contrast');
    expect(startupTheme('?editor&theme=custom')).toBeNull();
    expect(startupTheme('?editor&theme=unknown')).toBeNull();
    expect(startupTheme('?editor')).toBeNull();
  });
});
