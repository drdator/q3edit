import { describe, expect, it } from 'vitest';
import { startupDialogsEnabled } from '../src/startup-options';

describe('startup options', () => {
  it('disables optional startup dialogs only for startupDialogs=0', () => {
    expect(startupDialogsEnabled('?editor')).toBe(true);
    expect(startupDialogsEnabled('?editor&startupDialogs=1')).toBe(true);
    expect(startupDialogsEnabled('?editor&startupDialogs=0')).toBe(false);
  });
});
