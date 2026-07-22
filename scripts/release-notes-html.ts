import { releaseNotesLabel, type ReleaseNotes } from '../src/release-notes-types';

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
  return releases.map((release, index) => `
        <article class="release-notes-entry" data-release-id="${escapeHtml(release.id)}">
          <span class="release-notes-entry-label${index === 0 ? ' latest' : ''}">${escapeHtml(releaseNotesLabel(index))}</span>
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
