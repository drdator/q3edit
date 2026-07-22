export interface ReleaseNotesSection {
  title: string;
  items: readonly string[];
}

export interface ReleaseNotes {
  id: string;
  title: string;
  label: string;
  summary: string;
  sections: readonly ReleaseNotesSection[];
}

export const RELEASE_NOTES_DISMISSED_KEY = 'q3edit.releaseNotes.dismissed';

export const JULY_22_UPDATE_RELEASE_NOTES: ReleaseNotes = {
  id: '2026-07-22-bots-and-workflow',
  title: 'July 22, 2026 Update',
  label: 'Latest release',
  summary: 'Bot-ready Quick Play, clearer MCP onboarding, and editing refinements that make testing maps and everyday construction more dependable.',
  sections: [
    {
      title: 'Quick Play with bots',
      items: [
        'Generate Quake III AAS navigation alongside compiled BSP files through the bundled browser-based BSPC port, so custom maps can support bots.',
        'Configure Quick Play quality, bot count, and bot skill once, then automatically compile, launch, and add up to three opponents with the remembered settings.',
        'Start Quick Play from the persistent play button at the bottom of the tool strip or press F5, while keeping detailed options and manual BSP compilation available from the File menu.',
      ],
    },
    {
      title: 'MCP & website',
      items: [
        'Open the MCP installation guide directly from the Connect MCP dialog, with the same local AI map-authoring workflow now introduced on the public landing page.',
        'Use clearer, non-wrapping landing-page actions with consistent Phosphor icons to reach Q3Edit, the MCP setup guide, and release notes.',
      ],
    },
    {
      title: 'Editing refinements',
      items: [
        'Resize texture-locked brushes without stretching their materials or accumulating texture drift during a drag, for both classic and brush-primitive projections.',
        'Selecting Move or Resize now returns to the Select tool instead of leaving a conflicting placement tool active.',
        'Choosing a point entity class closes the Place Entity picker immediately, while filtering the list keeps it open.',
      ],
    },
  ],
};

export const MCP_PREVIEW_RELEASE_NOTES: ReleaseNotes = {
  id: '2026-07-22-mcp-preview',
  title: 'July 22, 2026 — MCP Preview',
  label: 'Previous release',
  summary: 'A complete local AI map-authoring workflow for Codex and Claude, with live editing, richer construction tools, visual review, diagnostics, compilation, and play-preview control.',
  sections: [
    {
      title: 'Live AI authoring',
      items: [
        'Connect Codex or Claude to the current Q3Edit document through the experimental local MCP companion and see atomic map edits appear immediately in every viewport.',
        'Target multiple open editor sessions reliably by filename, revision, connection ID, and last-active time instead of depending on whichever tab connected most recently.',
        'Use revision-checked previews, symbolic references, persistent named groups, normal undo and redo, and exact selection references for safer iterative editing.',
        'Follow every MCP request, result, failure, and revision change in the docked activity console or its append-only local transcript.',
      ],
    },
    {
      title: 'Construction & discovery',
      items: [
        'Create boxes, wedges, cylinders, stairs, arbitrary convex brushes, curved patches, paths, rooms, gameplay helpers, controlled patterns, and semantic areas and connections.',
        'Refine geometry with clipping, hollowing, CSG subtraction, chamfers, face offsets, transforms, detail or structural classification, per-face materials, and patch thickening.',
        'Search and inspect textures, shaders, entity classes, properties, groups, spatial plans, construction paths, map objects, and the user’s current selection without guessing names or references.',
        'Carry structured style and spatial intent between agent sessions, with texture-projection guidance and abstract design patterns that encourage more varied layouts.',
      ],
    },
    {
      title: 'Review, compile & play',
      items: [
        'Capture perspective, top, front, and side editor views with shared framing, coordinate overlays, sections, x-ray rendering, and optional sky, tool, group, or marker hiding.',
        'Review geometry, textures, gameplay placement, jump trajectories, routes, spatial composition, and overall design through structured diagnostics linked back to map references.',
        'Run compiler-safe preflight checks, save and compile maps, export BSP artifacts, reuse unchanged builds, and inspect structured BSP, VIS, and lighting results.',
        'Launch the compiled map, wait for renderer readiness, position the game camera at coordinates, entities, or player spawns, and detect unusable black screenshots.',
      ],
    },
    {
      title: 'Local companion',
      items: [
        'Use the deployed q3edit.com editor while the MCP server, files, compiler, and logs remain on the user’s computer.',
        'Pair the browser with a per-start code from the View menu or status bar; local and q3edit.com editor origins are validated before a document can connect.',
        'Install Q3Edit plugins for Codex and Claude Code so ordinary map-editing prompts route to the MCP tools instead of generic browser automation.',
      ],
    },
  ],
};

export const JULY_21_RELEASE_NOTES: ReleaseNotes = {
  id: '2026-07-21-editor-workflow',
  title: 'July 21, 2026 Update',
  label: 'Earlier release',
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
  id: '2026-07-editor-foundations',
  title: 'July 2026 Update',
  label: 'Earlier release',
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
        'Review live MCP tool activity, arguments, results, failures, and revision changes from the View menu.',
        'Expanded regression coverage protects map round-tripping, geometry editing, assets, entities, and editor workflows.',
      ],
    },
  ],
};

export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  JULY_22_UPDATE_RELEASE_NOTES,
  MCP_PREVIEW_RELEASE_NOTES,
  JULY_21_RELEASE_NOTES,
  JULY_2026_RELEASE_NOTES,
];

type ReleaseNotesReadStorage = Pick<Storage, 'getItem'>;
type ReleaseNotesWriteStorage = Pick<Storage, 'setItem'>;

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
    return storage.getItem(RELEASE_NOTES_DISMISSED_KEY) === release.id;
  } catch {
    return false;
  }
}

export function dismissReleaseNotes(
  release: ReleaseNotes = RELEASE_NOTES[0],
  storage: ReleaseNotesWriteStorage | null = currentStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(RELEASE_NOTES_DISMISSED_KEY, release.id);
  } catch {
    // The dialog remains usable when browser storage is unavailable.
  }
}

export interface ReleaseNotesDialogOptions {
  showDismissCheckbox?: boolean;
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
  let dismissCheckbox: HTMLInputElement | null = null;
  if (options.showDismissCheckbox) {
    const dismissLabel = document.createElement('label');
    dismissLabel.className = 'release-notes-dismiss';
    dismissCheckbox = document.createElement('input');
    dismissCheckbox.type = 'checkbox';
    const dismissText = document.createElement('span');
    dismissText.textContent = 'Don’t show this update again';
    dismissLabel.append(dismissCheckbox, dismissText);
    actions.appendChild(dismissLabel);
  }
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'btn primary'; close.textContent = 'Close';
  const closeDialog = () => {
    const dismissed = dismissCheckbox?.checked ?? false;
    overlay.remove();
    options.onClose?.(dismissed);
  };
  close.addEventListener('click', closeDialog);
  actions.appendChild(close);

  dialog.append(title, content, actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeDialog(); event.stopPropagation(); }
  });
  close.focus();
}

export function openUnreadReleaseNotesDialog(
  release: ReleaseNotes = RELEASE_NOTES[0],
  storage: (ReleaseNotesReadStorage & ReleaseNotesWriteStorage) | null = currentStorage(),
): boolean {
  if (isReleaseNotesDismissed(release, storage)) return false;
  openReleaseNotesDialog(release, {
    showDismissCheckbox: true,
    onClose: dismissed => {
      if (dismissed) dismissReleaseNotes(release, storage);
    },
  });
  return true;
}
