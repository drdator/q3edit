import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ReleaseNotes } from '../src/release-notes-types';
import { parseReleaseNotesMarkdown, sortReleaseNotes } from './release-notes-markdown';

export function loadReleaseNotes(directory: string): ReleaseNotes[] {
  const releases = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => {
      const path = join(directory, entry.name);
      return parseReleaseNotesMarkdown(readFileSync(path, 'utf8'), basename(path));
    });

  const ids = new Set<string>();
  for (const release of releases) {
    if (ids.has(release.id)) throw new Error(`Duplicate release notes id: ${release.id}`);
    ids.add(release.id);
  }
  if (releases.length === 0) throw new Error(`No release notes found in ${directory}`);
  return sortReleaseNotes(releases);
}
