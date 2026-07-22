export interface ReleaseNotesSection {
  title: string;
  items: readonly string[];
}

export interface ReleaseNotes {
  id: string;
  title: string;
  date: string;
  order: number;
  summary: string;
  sections: readonly ReleaseNotesSection[];
}

export function releaseNotesLabel(index: number): string {
  if (index === 0) return 'Latest release';
  if (index === 1) return 'Previous release';
  return 'Earlier release';
}
