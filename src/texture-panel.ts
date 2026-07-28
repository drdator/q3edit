import type { Editor } from './editor';
import { getCachedTextureTags, saveTextureTags } from './pak-storage';
import type { TextureManager } from './textures';
import { textureSearchScore } from './texture-search';
import { listTextureTags, setTextureTags, textureTagsFor, type TextureTagMap } from './texture-tags';
import { openTextureTagsDialog } from './texture-tags-dialog';
import { panelSubhead } from './ui-controls';

const COMMON_TEXTURES = [
  'common/caulk',
  'common/clip',
  'common/trigger',
  'common/nodraw',
  'base_wall/basewall03',
  'base_wall/basewall04',
  'base_wall/concrete',
  'base_floor/concrete',
  'base_floor/diamond2c',
  'base_floor/pjgrate1',
  'base_trim/pewter_shiney',
  'base_trim/dirty_pewter',
  'gothic_wall/iron01_e',
  'gothic_wall/skull4',
  'gothic_floor/blocks17floor',
  'gothic_trim/baseboard09',
  'skies/earthsky01',
];

export class TexturePanel {
  private textureManager: TextureManager | null = null;
  private showThumbnails = false;
  private directory = '';
  private search = '';
  private tagFilter = '';
  private tags: TextureTagMap = getCachedTextureTags();
  private find = '';
  private replace = '';
  private replaceScope: 'selection' | 'map' = 'selection';
  private replaceMatch: 'exact' | 'contains' = 'exact';
  private assetStatus = 'Loading OpenArena assets…';
  private importedPakNames: string[] = [];

  constructor(
    private readonly editor: Editor,
    private readonly managePakFiles: () => Promise<void> | void,
  ) {}

  mount(): void {
    this.rebuild();
  }

  setTextureManager(textureManager: TextureManager): void {
    this.textureManager = textureManager;
    this.rebuild();
  }

  setAssetStatus(status: string, importedPakNames: string[] = this.importedPakNames): void {
    this.assetStatus = status;
    this.importedPakNames = importedPakNames;
    this.rebuild();
  }

  locateTexture(texture: string): void {
    const directorySelect = document.getElementById('texture-dir-select') as HTMLSelectElement | null;
    if (!directorySelect) return;

    const stripped = texture.replace(/^textures\//, '');
    const slashIndex = stripped.lastIndexOf('/');
    const directory = slashIndex >= 0 ? stripped.slice(0, slashIndex) : '';
    const matchingOption = Array.from(directorySelect.options)
      .find(option => option.value.replace(/^textures\//, '') === directory);
    directorySelect.value = matchingOption?.value ?? '';
    directorySelect.dispatchEvent(new Event('change'));

    requestAnimationFrame(() => {
      const list = document.getElementById('texture-list');
      if (!list) return;
      const textureName = stripped.slice(slashIndex + 1);
      const item = Array.from(list.children)
        .find(candidate => {
          const text = candidate.textContent ?? '';
          return text === textureName || text === stripped || text === texture;
        }) as HTMLElement | undefined;
      if (!item) return;
      list.querySelectorAll('.texture-item').forEach(element => element.classList.remove('selected'));
      item.classList.add('selected');
      item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  private rebuild(): void {
    const body = document.getElementById('texture-body');
    if (!body) return;
    body.replaceChildren();
    this.buildSourceControls(body);
    this.buildReplaceControls(body);
    this.buildBrowser(body);
  }

  private buildSourceControls(body: HTMLElement): void {
    const section = document.createElement('div');
    section.className = 'texture-tools texture-source-tools';
    section.appendChild(panelSubhead('Asset source'));

    const status = document.createElement('div');
    status.className = 'texture-source-status';
    status.textContent = this.assetStatus;
    section.appendChild(status);

    const attribution = document.createElement('a');
    attribution.className = 'texture-source-attribution';
    attribution.href = '/openarena/OPENARENA.md';
    attribution.target = '_blank';
    attribution.rel = 'noreferrer';
    attribution.textContent = 'OpenArena license and source';
    section.appendChild(attribution);

    if (this.importedPakNames.length > 0) {
      const names = document.createElement('div');
      names.className = 'texture-source-files';
      names.textContent = this.importedPakNames.join(', ');
      names.title = this.importedPakNames.join('\n');
      section.appendChild(names);
    }

    const actions = document.createElement('div');
    actions.className = 'texture-source-actions';
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'btn';
    manage.innerHTML = '<i class="ph ph-files" aria-hidden="true"></i><span>Manage PK3 Files…</span>';
    manage.title = 'Add, remove, or reorder PK3 files from your Quake III Arena installation';
    manage.addEventListener('click', async () => {
      manage.disabled = true;
      try {
        await this.managePakFiles();
      } finally {
        manage.disabled = false;
      }
    });
    actions.appendChild(manage);
    section.appendChild(actions);
    body.appendChild(section);
  }

  private buildReplaceControls(body: HTMLElement): void {
    const section = document.createElement('div');
    section.className = 'texture-tools';
    section.appendChild(panelSubhead('Find / replace'));

    const replaceOnEnter = (input: HTMLInputElement) => {
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.applyReplace();
      });
    };

    const findLabel = document.createElement('label');
    findLabel.textContent = 'Find';
    const findRow = document.createElement('div');
    findRow.className = 'kv-row';
    const findInput = document.createElement('input');
    findInput.type = 'text';
    findInput.value = this.find;
    findInput.spellcheck = false;
    findInput.autocomplete = 'off';
    findInput.addEventListener('input', () => { this.find = findInput.value; });
    replaceOnEnter(findInput);
    const useCurrentFind = document.createElement('div');
    useCurrentFind.className = 'btn';
    useCurrentFind.textContent = 'Current';
    useCurrentFind.addEventListener('mousedown', () => {
      this.find = this.editor.currentTexture;
      findInput.value = this.find;
    });
    findRow.append(findInput, useCurrentFind);

    const replaceLabel = document.createElement('label');
    replaceLabel.textContent = 'Replace With';
    const replaceRow = document.createElement('div');
    replaceRow.className = 'kv-row';
    const replaceInput = document.createElement('input');
    replaceInput.type = 'text';
    replaceInput.value = this.replace;
    replaceInput.spellcheck = false;
    replaceInput.autocomplete = 'off';
    replaceInput.addEventListener('input', () => { this.replace = replaceInput.value; });
    replaceOnEnter(replaceInput);
    const useCurrentReplace = document.createElement('div');
    useCurrentReplace.className = 'btn';
    useCurrentReplace.textContent = 'Current';
    useCurrentReplace.addEventListener('mousedown', () => {
      this.replace = this.editor.currentTexture;
      replaceInput.value = this.replace;
    });
    replaceRow.append(replaceInput, useCurrentReplace);

    const options = document.createElement('div');
    options.className = 'kv-row';
    const scope = document.createElement('select');
    for (const [value, label] of [['selection', 'Selection'], ['map', 'Whole Map']] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === this.replaceScope;
      scope.appendChild(option);
    }
    scope.addEventListener('change', () => {
      this.replaceScope = scope.value as 'selection' | 'map';
    });
    const match = document.createElement('select');
    for (const [value, label] of [['exact', 'Exact Match'], ['contains', 'Name Contains']] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === this.replaceMatch;
      match.appendChild(option);
    }
    match.addEventListener('change', () => {
      this.replaceMatch = match.value as 'exact' | 'contains';
    });
    options.append(scope, match);

    const apply = document.createElement('div');
    apply.className = 'btn texture-apply-btn';
    apply.textContent = 'Replace Textures';
    apply.addEventListener('mousedown', () => this.applyReplace());
    section.append(findLabel, findRow, replaceLabel, replaceRow, options, apply);
    body.appendChild(section);
  }

  private applyReplace(): void {
    this.editor.replaceTextures(this.find, this.replace, this.replaceScope, this.replaceMatch);
  }

  private buildBrowser(body: HTMLElement): void {
    if (this.textureManager) {
      this.buildManagedBrowser(body, this.textureManager);
      return;
    }

    const list = document.createElement('div');
    list.className = 'texture-list';
    list.id = 'texture-list';
    this.populateTextureList(list, COMMON_TEXTURES, null);
    body.appendChild(list);
  }

  private buildManagedBrowser(body: HTMLElement, textureManager: TextureManager): void {
    const directoryRow = document.createElement('div');
    directoryRow.className = 'texture-directory-row';

    const directorySelect = document.createElement('select');
    directorySelect.id = 'texture-dir-select';
    directorySelect.style.flex = '1';
    directorySelect.appendChild(Object.assign(document.createElement('option'), {
      value: '',
      textContent: '-- select folder --',
    }));
    for (const directory of textureManager.listTextureDirectories()) {
      directorySelect.appendChild(Object.assign(document.createElement('option'), {
        value: directory,
        textContent: directory,
      }));
    }
    if (Array.from(directorySelect.options).some(option => option.value === this.directory)) {
      directorySelect.value = this.directory;
    }

    const toggle = document.createElement('button');
    toggle.className = 'texture-view-toggle';
    toggle.title = 'Toggle thumbnail view';
    toggle.setAttribute('aria-label', 'Show texture thumbnails');
    toggle.setAttribute('aria-pressed', String(this.showThumbnails));
    toggle.innerHTML = '<i class="ph ph-image" aria-hidden="true"></i>';
    toggle.addEventListener('click', () => {
      this.showThumbnails = !this.showThumbnails;
      toggle.classList.toggle('active', this.showThumbnails);
      toggle.setAttribute('aria-pressed', String(this.showThumbnails));
      repopulate();
    });
    toggle.classList.toggle('active', this.showThumbnails);
    directoryRow.append(directorySelect, toggle);
    body.appendChild(directoryRow);

    const search = document.createElement('input');
    search.type = 'text';
    search.id = 'texture-search';
    search.placeholder = 'Search textures…';
    search.value = this.search;
    search.style.marginTop = '4px';
    body.appendChild(search);

    const tagRow = document.createElement('div');
    tagRow.className = 'texture-tag-row';
    const tagSelect = document.createElement('select');
    tagSelect.setAttribute('aria-label', 'Texture tag filter');
    tagSelect.append(
      Object.assign(document.createElement('option'), { value: '', textContent: 'All tags' }),
      Object.assign(document.createElement('option'), { value: '__untagged__', textContent: 'Untagged' }),
    );
    for (const tag of listTextureTags(this.tags)) {
      tagSelect.appendChild(Object.assign(document.createElement('option'), { value: tag, textContent: tag }));
    }
    tagSelect.value = Array.from(tagSelect.options).some(option => option.value === this.tagFilter)
      ? this.tagFilter
      : '';
    const tagCurrent = document.createElement('button');
    tagCurrent.type = 'button';
    tagCurrent.className = 'btn texture-tag-current';
    tagCurrent.textContent = 'Tag Current…';
    tagCurrent.title = `Edit tags for ${this.editor.currentTexture}`;
    tagCurrent.onclick = () => {
      const texture = this.editor.currentTexture;
      openTextureTagsDialog(texture, this.tags, values => {
        this.tags = setTextureTags(this.tags, texture, values);
        void saveTextureTags(this.tags);
        this.editor.statusMessage = values.some(value => value.trim())
          ? `Tagged ${texture}`
          : `Removed tags from ${texture}`;
        this.rebuild();
      });
    };
    tagRow.append(tagSelect, tagCurrent);
    body.appendChild(tagRow);

    const list = document.createElement('div');
    list.className = 'texture-list';
    list.id = 'texture-list';
    body.appendChild(list);
    const allTextures = textureManager.listTextures();

    const repopulate = () => {
      const query = this.search.trim().toLowerCase();
      const filterByTag = (texture: string) => {
        const textureTags = textureTagsFor(this.tags, texture);
        return !this.tagFilter
          || (this.tagFilter === '__untagged__'
            ? textureTags.length === 0
            : textureTags.includes(this.tagFilter));
      };
      if (query) {
        const filtered = allTextures.filter(texture => {
          if (!filterByTag(texture)) return false;
          const metadata = textureManager.getShaderMetadata(texture);
          return textureSearchScore(
            texture,
            query,
            metadata?.semantics as unknown as Record<string, unknown> | null,
            metadata?.surfaceParms ?? [],
            textureTagsFor(this.tags, texture),
          ) !== null;
        });
        this.populateTextureList(list, filtered, null);
        return;
      }
      const baseTextures = this.directory
        ? textureManager.listTexturesInDir(this.directory)
        : this.tagFilter
          ? allTextures
          : COMMON_TEXTURES;
      this.populateTextureList(list, baseTextures.filter(filterByTag), this.directory || null);
    };

    repopulate();
    directorySelect.addEventListener('change', () => {
      this.directory = directorySelect.value;
      this.search = '';
      search.value = '';
      repopulate();
    });
    search.addEventListener('input', () => {
      this.search = search.value;
      repopulate();
    });
    tagSelect.addEventListener('change', () => {
      this.tagFilter = tagSelect.value;
      repopulate();
    });
  }

  private populateTextureList(list: HTMLElement, textures: string[], selectedDirectory: string | null): void {
    list.replaceChildren();
    list.classList.toggle('texture-grid', this.showThumbnails && Boolean(this.textureManager));

    for (const texture of textures) {
      const item = document.createElement('div');
      item.className = `texture-item${texture === this.editor.currentTexture ? ' selected' : ''}`;
      const asset = this.textureManager?.getTextureAsset(texture);
      const tags = textureTagsFor(this.tags, texture);
      if (asset) {
        const overrides = asset.overriddenSources.length > 0
          ? `; overrides ${asset.overriddenSources.map(source => source.archiveName).join(', ')}`
          : '';
        item.title = `${asset.path} — ${asset.source.archiveName}${overrides}`;
      }
      if (tags.length > 0) {
        item.title = `${item.title ? `${item.title}\n` : ''}Tags: ${tags.join(', ')}`;
        item.dataset.tags = tags.join(' ');
      }

      let displayName = texture.replace(/^textures\//, '');
      if (selectedDirectory) {
        const prefix = `${selectedDirectory.replace(/^textures\//, '')}/`;
        if (displayName.startsWith(prefix)) displayName = displayName.slice(prefix.length);
      }

      if (this.showThumbnails && this.textureManager) {
        item.classList.add('texture-thumb');
        const image = document.createElement('img');
        const thumbnailUrl = this.textureManager.getThumbnailUrl(texture);
        if (thumbnailUrl) image.src = thumbnailUrl;
        item.appendChild(image);
        const name = document.createElement('span');
        name.className = 'texture-thumb-name';
        name.textContent = displayName.split('/').pop() || displayName;
        item.appendChild(name);
      } else {
        item.textContent = displayName;
      }

      item.addEventListener('mousedown', () => {
        this.editor.setTexture(texture);
        list.querySelectorAll('.texture-item').forEach(element => element.classList.remove('selected'));
        item.classList.add('selected');
      });
      list.appendChild(item);
    }
  }
}
