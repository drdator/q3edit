import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  JULY_2026_RELEASE_NOTES,
  LATEST_RELEASE_NOTES,
  RELEASE_NOTES,
} from '../src/release-notes-dialog';

describe('release notes', () => {
  it('keeps the newest update first and preserves the previous release', () => {
    expect(RELEASE_NOTES).toEqual([
      LATEST_RELEASE_NOTES,
      JULY_2026_RELEASE_NOTES,
    ]);
    expect(LATEST_RELEASE_NOTES.title).toBe('July 21, 2026 Update');
    expect(JULY_2026_RELEASE_NOTES.label).toBe('Previous release');
  });

  it('covers every user-facing change merged since the previous entry', () => {
    const notes = LATEST_RELEASE_NOTES.sections.flatMap(section => section.items).join(' ');
    expect(notes).toContain('multiple selected entities');
    expect(notes).toContain('locked groups');
    expect(notes).toContain('right sidebar');
    expect(notes).toContain('Solo any sidebar panel');
    expect(notes).toContain('Dynamic-light preview');
    expect(notes).toContain('mixed-case shader image paths');
  });

  it('publishes both entries as static, crawlable HTML', () => {
    const html = readFileSync(new URL('../release-notes.html', import.meta.url), 'utf8');
    expect(html).toContain('<title>Q3Edit Release Notes');
    expect(html).toContain(LATEST_RELEASE_NOTES.title);
    expect(html).toContain(JULY_2026_RELEASE_NOTES.title);
    expect(html).toContain('Edit shared entity properties across multiple selected entities');
  });
});
