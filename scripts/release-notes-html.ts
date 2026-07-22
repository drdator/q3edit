import type { ReleaseNotes } from '../src/release-notes-dialog';

export const RELEASE_NOTES_HTML_MARKER = '<!-- Q3EDIT_RELEASE_NOTES -->';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderReleaseNotesHtml(releases: readonly ReleaseNotes[]): string {
  return releases.map(release => `
        <article class="release-notes-entry" data-release-id="${escapeHtml(release.id)}">
          <span class="release-notes-entry-label">${escapeHtml(release.label)}</span>
          <h2>${escapeHtml(release.title)}</h2>
          <p class="release-notes-entry-summary">${escapeHtml(release.summary)}</p>
${release.sections.map(section => `
          <section>
            <h3>${escapeHtml(section.title)}</h3>
            <ul>
${section.items.map(item => `              <li>${escapeHtml(item)}</li>`).join('\n')}
            </ul>
          </section>`).join('\n')}
        </article>`).join('\n');
}
