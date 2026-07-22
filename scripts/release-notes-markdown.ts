import type { ReleaseNotes, ReleaseNotesSection } from '../src/release-notes-types';

const FRONTMATTER_DELIMITER = '---';

function parseFrontmatter(markdown: string, sourceName: string): {
  attributes: Map<string, string>;
  body: string[];
} {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error(`${sourceName}: release notes must begin with YAML-style frontmatter`);
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER);
  if (closingIndex < 0) throw new Error(`${sourceName}: release notes frontmatter is not closed`);

  const attributes = new Map<string, string>();
  for (const [offset, line] of lines.slice(1, closingIndex).entries()) {
    if (!line.trim()) continue;
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error(`${sourceName}:${offset + 2}: invalid frontmatter field`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!value) throw new Error(`${sourceName}:${offset + 2}: ${key} cannot be empty`);
    if (attributes.has(key)) throw new Error(`${sourceName}:${offset + 2}: duplicate ${key} field`);
    attributes.set(key, value);
  }
  return { attributes, body: lines.slice(closingIndex + 1) };
}

function requiredAttribute(attributes: ReadonlyMap<string, string>, key: string, sourceName: string): string {
  const value = attributes.get(key);
  if (!value) throw new Error(`${sourceName}: missing ${key} frontmatter field`);
  return value;
}

function parseBody(lines: readonly string[], sourceName: string): {
  summary: string;
  sections: readonly ReleaseNotesSection[];
} {
  const summaryLines: string[] = [];
  const sections: { title: string; items: string[] }[] = [];
  let currentSection: { title: string; items: string[] } | null = null;

  for (const [offset, originalLine] of lines.entries()) {
    const line = originalLine.trim();
    if (!line) continue;

    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      currentSection = { title: heading[1].trim(), items: [] };
      sections.push(currentSection);
      continue;
    }

    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item) {
      if (!currentSection) throw new Error(`${sourceName}:${offset + 1}: list item must follow a section heading`);
      currentSection.items.push(item[1].trim());
      continue;
    }

    if (currentSection) {
      if (currentSection.items.length === 0) {
        throw new Error(`${sourceName}:${offset + 1}: section content must be a Markdown list`);
      }
      currentSection.items[currentSection.items.length - 1] += ` ${line}`;
    } else {
      summaryLines.push(line);
    }
  }

  const summary = summaryLines.join(' ');
  if (!summary) throw new Error(`${sourceName}: release summary is missing`);
  if (sections.length === 0) throw new Error(`${sourceName}: at least one section is required`);
  for (const section of sections) {
    if (section.items.length === 0) throw new Error(`${sourceName}: section "${section.title}" has no list items`);
  }
  return { summary, sections };
}

export function parseReleaseNotesMarkdown(markdown: string, sourceName = 'release notes'): ReleaseNotes {
  const { attributes, body } = parseFrontmatter(markdown, sourceName);
  const id = requiredAttribute(attributes, 'id', sourceName);
  const title = requiredAttribute(attributes, 'title', sourceName);
  const date = requiredAttribute(attributes, 'date', sourceName);
  const orderText = attributes.get('order') ?? '0';
  const order = Number(orderText);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${sourceName}: date must use YYYY-MM-DD`);
  if (!Number.isInteger(order)) throw new Error(`${sourceName}: order must be an integer`);
  const { summary, sections } = parseBody(body, sourceName);
  return { id, title, date, order, summary, sections };
}

export function sortReleaseNotes(releases: readonly ReleaseNotes[]): ReleaseNotes[] {
  return [...releases].sort((left, right) =>
    right.date.localeCompare(left.date)
    || right.order - left.order
    || left.id.localeCompare(right.id));
}
