import { vec3Copy, type Vec3 } from './math';
import type { Editor } from './editor';

export interface LoadPointfileOptions {
  autoLocate?: boolean;
  statusPrefix?: string;
}

function parsePointfileText(text: string): Vec3[] {
  const points: Vec3[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    points.push([x, y, z]);
  }
  return points;
}

function currentPointIndex(editor: Editor): number {
  return Math.max(0, Math.min(editor.pointfileIndex, editor.pointfilePoints.length - 1));
}

function currentPointLookAt(editor: Editor): Vec3 | null {
  if (editor.pointfilePoints.length < 2) return null;
  const index = currentPointIndex(editor);
  if (index < editor.pointfilePoints.length - 1) return vec3Copy(editor.pointfilePoints[index + 1]);
  if (index > 0) return vec3Copy(editor.pointfilePoints[index - 1]);
  return null;
}

function locateCurrentPoint(editor: Editor): void {
  if (editor.pointfilePoints.length === 0) return;
  const point = vec3Copy(editor.pointfilePoints[currentPointIndex(editor)]);
  editor.locatePoint(point, currentPointLookAt(editor));
}

export function loadPointfileText(
  editor: Editor,
  text: string,
  options: LoadPointfileOptions = {},
): boolean {
  const points = parsePointfileText(text);
  if (points.length === 0) {
    editor.statusMessage = 'Pointfile contained no valid points';
    return false;
  }

  editor.pointfilePoints = points;
  editor.pointfileIndex = 0;
  editor.dirty = true;
  if (options.autoLocate !== false) locateCurrentPoint(editor);
  editor.statusMessage = `${options.statusPrefix ?? 'Loaded pointfile'} (${points.length} point${points.length === 1 ? '' : 's'})`;
  return true;
}

export function openPointfileFromFile(editor: Editor): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.lin,.pts,.txt';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const loaded = loadPointfileText(editor, reader.result as string, {
        statusPrefix: `Loaded pointfile ${file.name}`,
      });
      if (!loaded) return;
    };
    reader.readAsText(file);
  };
  input.click();
}

export function clearPointfile(editor: Editor, updateStatus = true): void {
  const hadPointfile = editor.pointfilePoints.length > 0;
  editor.pointfilePoints = [];
  editor.pointfileIndex = 0;
  editor.dirty = true;
  if (updateStatus) {
    editor.statusMessage = hadPointfile ? 'Pointfile cleared' : 'No pointfile loaded';
  }
}

export function nextPointfilePoint(editor: Editor): void {
  if (editor.pointfilePoints.length === 0) {
    editor.statusMessage = 'No pointfile loaded';
    return;
  }
  if (editor.pointfileIndex >= editor.pointfilePoints.length - 1) {
    editor.statusMessage = 'End of pointfile';
    return;
  }
  editor.pointfileIndex++;
  editor.dirty = true;
  locateCurrentPoint(editor);
  editor.statusMessage = `Leak spot ${editor.pointfileIndex + 1}/${editor.pointfilePoints.length}`;
}

export function prevPointfilePoint(editor: Editor): void {
  if (editor.pointfilePoints.length === 0) {
    editor.statusMessage = 'No pointfile loaded';
    return;
  }
  if (editor.pointfileIndex <= 0) {
    editor.statusMessage = 'Start of pointfile';
    return;
  }
  editor.pointfileIndex--;
  editor.dirty = true;
  locateCurrentPoint(editor);
  editor.statusMessage = `Leak spot ${editor.pointfileIndex + 1}/${editor.pointfilePoints.length}`;
}
