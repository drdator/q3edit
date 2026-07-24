const EDITOR_SESSION_STORAGE_KEY = 'q3edit.editorSessionId';
let cachedEditorSessionId: string | null = null;

function createEditorSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function currentEditorSessionId(): string {
  if (cachedEditorSessionId) return cachedEditorSessionId;
  try {
    const existing = window.sessionStorage.getItem(EDITOR_SESSION_STORAGE_KEY);
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    // sessionStorage survives reloads but can be copied into a duplicated tab.
    // A fresh navigation gets a new identity; reload/back-forward keeps routing stable.
    if (existing && navigation?.type !== 'navigate') {
      cachedEditorSessionId = existing;
      return existing;
    }
    cachedEditorSessionId = createEditorSessionId();
    window.sessionStorage.setItem(EDITOR_SESSION_STORAGE_KEY, cachedEditorSessionId);
    return cachedEditorSessionId;
  } catch {
    cachedEditorSessionId = createEditorSessionId();
    return cachedEditorSessionId;
  }
}
