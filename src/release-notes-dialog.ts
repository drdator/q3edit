export interface ReleaseNotesSection {
  title: string;
  items: readonly string[];
}

export interface ReleaseNotes {
  title: string;
  label: string;
  summary: string;
  sections: readonly ReleaseNotesSection[];
}

export const LATEST_RELEASE_NOTES: ReleaseNotes = {
  title: 'July 21, 2026 Update',
  label: 'Latest release',
  summary: 'A focused workflow and rendering update with faster multi-object editing, a more flexible workspace, and closer agreement between the editor and Quick Play.',
  sections: [
    {
      title: 'Editing workflow',
      items: [
        'Edit shared entity properties across multiple selected entities from the Entity Inspector, including adding and removing keys for the whole selection.',
        'Start marquee selections over brushes in locked groups while the locked geometry itself remains protected from selection and editing.',
      ],
    },
    {
      title: 'Workspace',
      items: [
        'Show or hide the right sidebar from the View menu or the top-right toolbar button, and drag its edge to choose a comfortable width.',
        'Solo any sidebar panel to temporarily collapse the others, with sidebar visibility, width, and panel states remembered between sessions.',
      ],
    },
    {
      title: 'Rendering & Quick Play',
      items: [
        'Dynamic-light preview now chooses up to 16 lights by their influence on the current view, keeping large and heavily lit maps accurate as you move around.',
        'Quick Play now resolves mixed-case shader image paths correctly, preventing fitted textures such as jump pads from compiling at the wrong scale.',
      ],
    },
  ],
};

export const JULY_2026_RELEASE_NOTES: ReleaseNotes = {
  title: 'July 2026 Update',
  label: 'Previous release',
  summary: 'A major editor update with richer Quake III compatibility, modern entity and model workflows, advanced geometry tools, camera paths, project configuration, and a more dependable editing core.',
  sections: [
    {
      title: 'Entities & models',
      items: [
        'Search game entity definitions while placing entities, then edit typed properties in the Entity Inspector.',
        'Choose MD3 models and skins with textured, drag-to-rotate previews in both the browser and editor view.',
        'Compile misc_model entities with Q3Map2-compatible origin, scale, yaw, pitch, and roll transforms.',
      ],
    },
    {
      title: 'Maps & assets',
      items: [
        'Load, edit, and round-trip classic brushes and brushDef map formats with clearer parser diagnostics.',
        'Manage an ordered PK3 asset stack with shader-aware texture lookup and JPEG image support.',
        'Quick Play now keeps base-game assets separate and handles browser mouse capture more reliably.',
      ],
    },
    {
      title: 'Geometry & terrain',
      items: [
        'Create precisely sized boxes, cylinders, cones, spheres, and pyramids with the Exact Primitive dialog.',
        'Use expanded patch operations for rows, columns, subdivisions, caps, thickening, fitting, and alignment.',
        'Sculpt, smooth, erode, stitch, and texture terrain with a dedicated inspector and brush controls.',
      ],
    },
    {
      title: 'Organization & paths',
      items: [
        'Create persistent named groups, then select, hide, lock, and manage their members from the sidebar.',
        'Build open or closed camera splines with timing, FOV, look targets, actions, scrubbing, and looping playback.',
        'Generate smart camera paths and func_train paths directly from the editor.',
      ],
    },
    {
      title: 'View & customization',
      items: [
        'Switch renderer modes, texture filtering, display categories, and a tuned dynamic-light preview.',
        'Customize shortcuts, themes, viewport layouts, and editor defaults in global Preferences.',
        'Keep game paths, assets, compiler options, entity sources, and overrides in separate Project Settings.',
      ],
    },
    {
      title: 'Reliability & diagnostics',
      items: [
        'Document revisions, unsaved-state tracking, centralized mutations, and consistent undo transactions protect edits.',
        'Inspect map and entity diagnostics, find brushes by address, and run JSON brush macros as one undoable action.',
        'Expanded regression coverage protects map round-tripping, geometry editing, assets, entities, and editor workflows.',
      ],
    },
  ],
};

export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  LATEST_RELEASE_NOTES,
  JULY_2026_RELEASE_NOTES,
];

export function openReleaseNotesDialog(
  releaseNotes: ReleaseNotes | readonly ReleaseNotes[] = RELEASE_NOTES,
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
  title.textContent = 'Release Notes';

  const content = document.createElement('div');
  content.className = 'release-notes-content';
  const releases: readonly ReleaseNotes[] = Array.isArray(releaseNotes)
    ? releaseNotes
    : [releaseNotes as ReleaseNotes];
  for (const release of releases) {
    const article = document.createElement('article');
    article.className = 'release-notes-release';
    const intro = document.createElement('header');
    intro.className = 'release-notes-intro';
    const label = document.createElement('span');
    label.className = 'release-notes-label';
    label.textContent = release.label;
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
      section.append(sectionTitle, list); sections.appendChild(section);
    }
    article.append(intro, sections);
    content.appendChild(article);
  }

  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'btn primary'; close.textContent = 'Close';
  const closeDialog = () => overlay.remove();
  close.addEventListener('click', closeDialog);
  actions.appendChild(close);

  dialog.append(title, content, actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeDialog(); event.stopPropagation(); }
  });
  close.focus();
}
