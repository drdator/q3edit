import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Plugin } from 'vite';

const VIRTUAL_MODULE_ID = 'virtual:phosphor-icons.css';
const RESOLVED_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;
const SOURCE_EXTENSIONS = new Set(['.html', '.js', '.jsx', '.ts', '.tsx']);
const ICON_CLASS_PATTERN = /\bph-([a-z0-9-]+)\b/g;
const ICON_HELPER_PATTERN = /\bicon\(\s*['"]([a-z0-9-]+)['"]/g;
const ICON_MAP_PATTERN = /\b[A-Z][A-Z0-9_]*ICON_NAMES\b[^=]*=\s*{([\s\S]*?)};/g;
const ICON_MAP_VALUE_PATTERN = /:\s*['"]([a-z0-9-]+)['"]/g;

interface PhosphorIconDefinition {
  icon: {
    paths: string[];
  };
  properties: {
    name: string;
  };
}

interface PhosphorSelection {
  icons: PhosphorIconDefinition[];
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function usedIconNames(root: string): string[] {
  const files = [join(root, 'index.html'), ...sourceFiles(join(root, 'src'))];
  const names = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(ICON_CLASS_PATTERN)) names.add(match[1]);
    for (const match of source.matchAll(ICON_HELPER_PATTERN)) names.add(match[1]);
    for (const iconMap of source.matchAll(ICON_MAP_PATTERN)) {
      for (const match of iconMap[1].matchAll(ICON_MAP_VALUE_PATTERN)) names.add(match[1]);
    }
  }
  return [...names].sort();
}

function svgDataUrl(paths: string[]): string {
  const body = paths.map(path => `<path d="${path}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function subsetCss(root: string): { css: string; count: number } {
  const require = createRequire(import.meta.url);
  const selectionPath = require.resolve('@phosphor-icons/web/regular/selection.json');
  const selection = JSON.parse(readFileSync(selectionPath, 'utf8')) as PhosphorSelection;
  const iconsByName = new Map(selection.icons.map(icon => [icon.properties.name, icon]));
  const names = usedIconNames(root);
  const missing = names.filter(name => !iconsByName.has(name));
  if (missing.length > 0) {
    throw new Error(`Unknown Phosphor icon${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }

  const rules = names.map(name => {
    const icon = iconsByName.get(name)!;
    return `.ph.ph-${name}::before {\n  --ph-icon: url("${svgDataUrl(icon.icon.paths)}");\n}`;
  });

  return {
    count: names.length,
    css: `
.ph {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
  font-style: normal;
  line-height: 1;
  vertical-align: -0.125em;
}

.ph::before {
  content: "";
  display: block;
  width: 100%;
  height: 100%;
  background-color: currentColor;
  -webkit-mask-image: var(--ph-icon);
  mask-image: var(--ph-icon);
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: contain;
  mask-size: contain;
}

${rules.join('\n\n')}
`,
  };
}

export function phosphorIconSubset(root: string): Plugin {
  return {
    name: 'phosphor-icon-subset',
    resolveId(id) {
      return id === VIRTUAL_MODULE_ID ? RESOLVED_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_MODULE_ID) return null;
      const subset = subsetCss(root);
      console.log(`Phosphor icon subset: ${subset.count} icons`);
      return subset.css;
    },
  };
}
