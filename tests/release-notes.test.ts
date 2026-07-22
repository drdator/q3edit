import { describe, expect, it } from 'vitest';
import {
  dismissReleaseNotes,
  isReleaseNotesDismissed,
  JULY_2026_RELEASE_NOTES,
  JULY_21_RELEASE_NOTES,
  JULY_22_UPDATE_RELEASE_NOTES,
  MCP_PREVIEW_RELEASE_NOTES,
  RELEASE_NOTES_DISMISSED_KEY,
  RELEASE_NOTES_NEVER_SHOW_KEY,
  RELEASE_NOTES,
} from '../src/release-notes-dialog';

describe('release notes', () => {
  it('keeps the newest update first and preserves the previous release', () => {
    expect(RELEASE_NOTES).toEqual([
      JULY_22_UPDATE_RELEASE_NOTES,
      MCP_PREVIEW_RELEASE_NOTES,
      JULY_21_RELEASE_NOTES,
      JULY_2026_RELEASE_NOTES,
    ]);
    expect(new Set(RELEASE_NOTES.map(release => release.id)).size).toBe(RELEASE_NOTES.length);
  });

  it('marks the current entry read while allowing a permanent automatic-display opt-out', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };

    expect(isReleaseNotesDismissed(JULY_22_UPDATE_RELEASE_NOTES, storage)).toBe(false);
    dismissReleaseNotes(JULY_22_UPDATE_RELEASE_NOTES, storage);
    expect(values.get(RELEASE_NOTES_DISMISSED_KEY)).toBe(JULY_22_UPDATE_RELEASE_NOTES.id);
    expect(isReleaseNotesDismissed(JULY_22_UPDATE_RELEASE_NOTES, storage)).toBe(true);
    expect(isReleaseNotesDismissed(MCP_PREVIEW_RELEASE_NOTES, storage)).toBe(false);

    dismissReleaseNotes(JULY_22_UPDATE_RELEASE_NOTES, storage, true);
    expect(values.get(RELEASE_NOTES_NEVER_SHOW_KEY)).toBe('1');
    expect(isReleaseNotesDismissed(MCP_PREVIEW_RELEASE_NOTES, storage)).toBe(true);

    dismissReleaseNotes(JULY_22_UPDATE_RELEASE_NOTES, storage, false);
    expect(values.has(RELEASE_NOTES_NEVER_SHOW_KEY)).toBe(false);
    expect(isReleaseNotesDismissed(MCP_PREVIEW_RELEASE_NOTES, storage)).toBe(false);
  });
});
