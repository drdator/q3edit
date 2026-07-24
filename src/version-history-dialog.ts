import type {
  DocumentRecoveryService,
  DocumentRecoverySnapshot,
} from './document-recovery';

function button(label: string, action: () => void | Promise<void>, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = primary ? 'btn primary' : 'btn';
  result.textContent = label;
  result.onclick = () => { void action(); };
  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function exportSnapshot(snapshot: DocumentRecoverySnapshot): void {
  const url = URL.createObjectURL(new Blob([snapshot.mapText], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = snapshot.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function openVersionHistoryDialog(recovery: DocumentRecoveryService): void {
  document.getElementById('version-history-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'version-history-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'version-history-title');

  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog version-history-dialog';
  const title = document.createElement('div');
  title.id = 'version-history-title';
  title.className = 'editor-dialog-title';
  title.textContent = 'Version History';
  const toolbar = document.createElement('div');
  toolbar.className = 'version-history-toolbar';
  const status = document.createElement('span');
  status.className = 'version-history-status';
  const list = document.createElement('div');
  list.className = 'version-history-list';

  const render = async () => {
    const [versions, usage] = await Promise.all([recovery.listVersions(), recovery.storageUsage()]);
    list.replaceChildren();
    status.textContent = `${usage.snapshots} versions · ${formatBytes(usage.bytes)} · ${usage.protectedSnapshots} protected`;
    if (versions.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No recovery versions have been recorded yet.';
      list.appendChild(empty);
      return;
    }
    for (const snapshot of versions) {
      const row = document.createElement('article');
      row.className = 'version-history-row';
      const info = document.createElement('div');
      info.className = 'version-history-info';
      const heading = document.createElement('strong');
      heading.textContent = snapshot.label;
      const meta = document.createElement('span');
      const dirty = snapshot.documentRevision === snapshot.savedDocumentRevision ? 'saved' : 'unsaved';
      meta.textContent = `${new Date(snapshot.updatedAt).toLocaleString()} · rev ${snapshot.documentRevision} · ${dirty}`;
      const counts = document.createElement('span');
      counts.textContent = `${snapshot.stats.entities} entities · ${snapshot.stats.brushes} brushes · ${snapshot.stats.patches} patches · ${formatBytes(snapshot.stats.bytes)}`;
      info.append(heading, meta, counts);
      const actions = document.createElement('div');
      actions.className = 'version-history-actions';
      actions.append(
        button('Restore', () => {
          if (globalThis.confirm?.(`Restore “${snapshot.label}” as a new undoable map state?`) ?? true) {
            recovery.restoreVersion(snapshot);
            overlay.remove();
          }
        }, true),
        button('Export .map', () => exportSnapshot(snapshot)),
        button(snapshot.protected ? 'Unprotect' : 'Protect', async () => {
          await recovery.setProtected(snapshot.snapshotId, !snapshot.protected);
          await render();
        }),
        button('Delete', async () => {
          if (!(globalThis.confirm?.(`Delete “${snapshot.label}” from recovery history?`) ?? false)) return;
          await recovery.removeVersion(snapshot.snapshotId);
          await render();
        }),
      );
      row.append(info, actions);
      list.appendChild(row);
    }
  };

  const checkpoint = button('Create Checkpoint', async () => {
    const label = globalThis.prompt?.('Checkpoint name', 'Manual checkpoint');
    if (label === null || label === undefined) return;
    await recovery.createCheckpoint(label);
    await render();
  }, true);
  const retentionLabel = document.createElement('label');
  retentionLabel.textContent = 'Keep automatic versions';
  const retention = document.createElement('input');
  retention.type = 'number';
  retention.min = '5';
  retention.max = '100';
  retention.value = String(recovery.retentionLimit);
  retention.onchange = () => {
    recovery.setRetentionLimit(Number(retention.value));
    retention.value = String(recovery.retentionLimit);
    void render();
  };
  retentionLabel.appendChild(retention);
  toolbar.append(checkpoint, retentionLabel, status);

  const footer = document.createElement('div');
  footer.className = 'editor-dialog-actions';
  footer.appendChild(button('Close', () => overlay.remove()));
  dialog.append(title, toolbar, list, footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  void render();
}
