import type { ThemePreset } from './preferences';

export function startupDialogsEnabled(search: string): boolean {
  return new URLSearchParams(search).get('startupDialogs') !== '0';
}

export function startupTheme(search: string): Exclude<ThemePreset, 'custom'> | null {
  const theme = new URLSearchParams(search).get('theme');
  return theme === 'dark' || theme === 'light' || theme === 'high-contrast' ? theme : null;
}
