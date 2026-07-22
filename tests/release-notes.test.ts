import { describe, expect, it } from 'vitest';
import {
  dismissReleaseNotes,
  isReleaseNotesDismissed,
  RELEASE_NOTES_DISMISSED_KEY,
  RELEASE_NOTES_NEVER_SHOW_KEY,
  RELEASE_NOTES,
} from '../src/release-notes-dialog';

describe('release notes', () => {
  it('loads unique releases in descending chronological order', () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(1);
    expect(new Set(RELEASE_NOTES.map(release => release.id)).size).toBe(RELEASE_NOTES.length);
    for (let index = 1; index < RELEASE_NOTES.length; index += 1) {
      const previous = RELEASE_NOTES[index - 1];
      const current = RELEASE_NOTES[index];
      expect(previous.date > current.date || (previous.date === current.date && previous.order >= current.order)).toBe(true);
    }
  });

  it('marks the current entry read while allowing a permanent automatic-display opt-out', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const currentRelease = RELEASE_NOTES[0];
    const previousRelease = RELEASE_NOTES[1];

    expect(isReleaseNotesDismissed(currentRelease, storage)).toBe(false);
    dismissReleaseNotes(currentRelease, storage);
    expect(values.get(RELEASE_NOTES_DISMISSED_KEY)).toBe(currentRelease.id);
    expect(isReleaseNotesDismissed(currentRelease, storage)).toBe(true);
    expect(isReleaseNotesDismissed(previousRelease, storage)).toBe(false);

    dismissReleaseNotes(currentRelease, storage, true);
    expect(values.get(RELEASE_NOTES_NEVER_SHOW_KEY)).toBe('1');
    expect(isReleaseNotesDismissed(previousRelease, storage)).toBe(true);

    dismissReleaseNotes(currentRelease, storage, false);
    expect(values.has(RELEASE_NOTES_NEVER_SHOW_KEY)).toBe(false);
    expect(isReleaseNotesDismissed(previousRelease, storage)).toBe(false);
  });
});
