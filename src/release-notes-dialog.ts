import { RELEASE_NOTES as GENERATED_RELEASE_NOTES } from 'virtual:q3edit-release-notes';
import { releaseNotesLabel, type ReleaseNotes, type ReleaseNotesSection } from './release-notes-types';

export type { ReleaseNotes, ReleaseNotesSection } from './release-notes-types';

export const RELEASE_NOTES_DISMISSED_KEY = 'q3edit.releaseNotes.dismissed';
export const RELEASE_NOTES_NEVER_SHOW_KEY = 'q3edit.releaseNotes.neverShow';

export const RELEASE_NOTES: readonly ReleaseNotes[] = GENERATED_RELEASE_NOTES;

type ReleaseNotesReadStorage = Pick<Storage, 'getItem'>;
type ReleaseNotesWriteStorage = Pick<Storage, 'setItem' | 'removeItem'>;

function currentStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isReleaseNotesDismissed(
  release: ReleaseNotes = RELEASE_NOTES[0],
  storage: ReleaseNotesReadStorage | null = currentStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(RELEASE_NOTES_NEVER_SHOW_KEY) === '1'
      || storage.getItem(RELEASE_NOTES_DISMISSED_KEY) === release.id;
  } catch {
    return false;
  }
}

export function areAutomaticReleaseNotesDisabled(
  storage: ReleaseNotesReadStorage | null = currentStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(RELEASE_NOTES_NEVER_SHOW_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissReleaseNotes(
  release: ReleaseNotes = RELEASE_NOTES[0],
  storage: ReleaseNotesWriteStorage | null = currentStorage(),
  neverShowAgain = false,
): void {
  if (!storage) return;
  try {
    storage.setItem(RELEASE_NOTES_DISMISSED_KEY, release.id);
    if (neverShowAgain) storage.setItem(RELEASE_NOTES_NEVER_SHOW_KEY, '1');
    else storage.removeItem(RELEASE_NOTES_NEVER_SHOW_KEY);
  } catch {
    // The dialog remains usable when browser storage is unavailable.
  }
}

export interface ReleaseNotesDialogOptions {
  dialogTitle?: string;
  showDismissCheckbox?: boolean;
  dismissChecked?: boolean;
  onClose?: (dismissed: boolean) => void;
}

export function openReleaseNotesDialog(
  releaseNotes: ReleaseNotes | readonly ReleaseNotes[] = RELEASE_NOTES,
  options: ReleaseNotesDialogOptions = {},
): void {
  document.getElementById('release-notes-dialog')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'release-notes-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'release-notes-title');

  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog release-notes-dialog';
  const title = document.createElement('div');
  title.id = 'release-notes-title';
  title.className = 'editor-dialog-title';
  title.textContent = options.dialogTitle ?? 'Release Notes';

  const content = document.createElement('div');
  content.className = 'release-notes-content';
  const releases: readonly ReleaseNotes[] = Array.isArray(releaseNotes)
    ? releaseNotes
    : [releaseNotes as ReleaseNotes];
  for (const release of releases) {
    const releaseIndex = RELEASE_NOTES.findIndex(candidate => candidate.id === release.id);
    const isLatestRelease = releaseIndex === 0;
    const article = document.createElement('article');
    article.className = 'release-notes-release';
    article.classList.toggle('latest', isLatestRelease);
    const intro = document.createElement('header');
    intro.className = 'release-notes-intro';
    const label = document.createElement('span');
    label.className = 'release-notes-label';
    label.classList.toggle('latest', isLatestRelease);
    label.textContent = releaseNotesLabel(releaseIndex);
    const heading = document.createElement('h2');
    heading.textContent = release.title;
    const summary = document.createElement('p');
    summary.textContent = release.summary;
    intro.append(label, heading, summary);

    const sections = document.createElement('div');
    sections.className = 'release-notes-sections';
    for (const releaseSection of release.sections) {
      const section = document.createElement('section');
      section.className = 'release-notes-section';
      const sectionTitle = document.createElement('h3');
      sectionTitle.textContent = releaseSection.title;
      const list = document.createElement('ul');
      for (const itemText of releaseSection.items) {
        const item = document.createElement('li');
        item.textContent = itemText;
        list.appendChild(item);
      }
      section.append(sectionTitle, list);
      sections.appendChild(section);
    }
    article.append(intro, sections);
    content.appendChild(article);
  }

  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  let dismissCheckbox: HTMLInputElement | null = null;
  if (options.showDismissCheckbox ?? true) {
    const dismissLabel = document.createElement('label');
    dismissLabel.className = 'release-notes-dismiss';
    dismissCheckbox = document.createElement('input');
    dismissCheckbox.type = 'checkbox';
    dismissCheckbox.checked = options.dismissChecked ?? areAutomaticReleaseNotesDisabled();
    const dismissText = document.createElement('span');
    dismissText.textContent = 'Don’t show release notes automatically';
    dismissLabel.append(dismissCheckbox, dismissText);
    actions.appendChild(dismissLabel);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn primary';
  close.textContent = 'Close';
  const closeDialog = () => {
    const dismissed = dismissCheckbox?.checked ?? false;
    overlay.remove();
    if (options.onClose) options.onClose(dismissed);
    else dismissReleaseNotes(releases[0], currentStorage(), dismissed);
  };
  close.addEventListener('click', closeDialog);
  actions.appendChild(close);

  dialog.append(title, content, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeDialog();
      event.stopPropagation();
    }
  });
  close.focus();
}

export function openUnreadReleaseNotesDialog(
  release: ReleaseNotes = RELEASE_NOTES[0],
  storage: (ReleaseNotesReadStorage & ReleaseNotesWriteStorage) | null = currentStorage(),
): boolean {
  if (isReleaseNotesDismissed(release, storage)) return false;
  openReleaseNotesDialog(RELEASE_NOTES, {
    dialogTitle: 'Q3Edit has been updated',
    showDismissCheckbox: true,
    dismissChecked: false,
    onClose: neverShowAgain => dismissReleaseNotes(release, storage, neverShowAgain),
  });
  return true;
}
