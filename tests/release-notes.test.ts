import { describe, expect, it } from 'vitest';
import {
  dismissReleaseNotes,
  isReleaseNotesDismissed,
  JULY_2026_RELEASE_NOTES,
  JULY_21_RELEASE_NOTES,
  JULY_22_UPDATE_RELEASE_NOTES,
  MCP_PREVIEW_RELEASE_NOTES,
  RELEASE_NOTES_DISMISSED_KEY,
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

  it('dismisses only the current entry so a future release becomes unread', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };

    expect(isReleaseNotesDismissed(JULY_22_UPDATE_RELEASE_NOTES, storage)).toBe(false);
    dismissReleaseNotes(JULY_22_UPDATE_RELEASE_NOTES, storage);
    expect(values.get(RELEASE_NOTES_DISMISSED_KEY)).toBe(JULY_22_UPDATE_RELEASE_NOTES.id);
    expect(isReleaseNotesDismissed(JULY_22_UPDATE_RELEASE_NOTES, storage)).toBe(true);
    expect(isReleaseNotesDismissed(MCP_PREVIEW_RELEASE_NOTES, storage)).toBe(false);
  });
});
