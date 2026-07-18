import { Editor, Tool } from './editor';
import { Vec3 } from './math';
import { getSelectedPatchItems } from './editor-selection';

export interface KeyboardContext {
  editor: Editor;
  handleExitVertexMode: () => void;
  openRotateDialog: () => void;
  openScaleDialog: () => void;
  setTool: (tool: Tool) => void;
  increaseGrid: () => void;
  decreaseGrid: () => void;
  toggleGeoSnap: () => void;
  cycleInvisibleMode: () => void;
  quickPlay: (quality: 'fast' | 'normal' | 'full') => void | Promise<void>;
}

export function setupKeyboard(ctx: KeyboardContext): void {
  document.addEventListener('keydown', (e) => {
    if (ctx.editor.fullscreen3d) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.altKey && (e.code === 'Digit1' || e.key === '1')) { e.preventDefault(); void ctx.quickPlay('fast'); return; }
    if (ctrl && e.altKey && (e.code === 'Digit2' || e.key === '2')) { e.preventDefault(); void ctx.quickPlay('normal'); return; }
    if (ctrl && e.altKey && (e.code === 'Digit3' || e.key === '3')) { e.preventDefault(); void ctx.quickPlay('full'); return; }

    if (ctrl && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); ctx.editor.redo(); return; }
    if (ctrl && e.key === 'z') { e.preventDefault(); ctx.editor.undo(); return; }
    if (ctrl && e.key === 'y') { e.preventDefault(); ctx.editor.redo(); return; }
    if (ctrl && e.shiftKey && e.key === 'R') { e.preventDefault(); ctx.openRotateDialog(); return; }
    if (ctrl && e.shiftKey && e.key === 'E') { e.preventDefault(); ctx.openScaleDialog(); return; }
    if (ctrl && e.key === 's') { e.preventDefault(); ctx.editor.saveMapToFile(); return; }
    if (ctrl && e.key === 'o') { e.preventDefault(); ctx.editor.openMapFromFile(); return; }
    if (ctrl && e.key === 'c') { e.preventDefault(); void ctx.editor.copySelection(); return; }
    if (ctrl && e.key === 'v') { e.preventDefault(); void ctx.editor.pasteClipboard(); return; }
    if (ctrl && e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); ctx.editor.connectSelectedEntitiesAsClosedPath(); return; }
    if (ctrl && e.key === 'k') { e.preventDefault(); ctx.editor.connectSelectedEntities(); return; }
    if (ctrl && e.shiftKey && e.key === 'K') { e.preventDefault(); ctx.editor.connectSelectedEntitiesAsPath(); return; }
    if (ctrl && e.key === 'a') { e.preventDefault(); ctx.editor.selectAll(); return; }
    if (ctrl && e.shiftKey && e.key === 'I') { e.preventDefault(); ctx.editor.invertSelection(); return; }
    if (ctrl && e.key === 'd') { e.preventDefault(); ctx.editor.duplicateSelection(); return; }
    if (ctrl && e.shiftKey && e.key === 'G') { e.preventDefault(); ctx.editor.groupSelectionIntoEntity(); return; }
    if (ctrl && e.shiftKey && e.key === 'U') { e.preventDefault(); ctx.editor.moveSelectionToWorldspawn(); return; }
    if (ctrl && e.key === 'g') { e.preventDefault(); ctx.editor.snapSelectionToGrid(); return; }

    if (ctrl && e.shiftKey && e.key === 'S') { e.preventDefault(); ctx.editor.csgSubtract(); return; }
    if (ctrl && e.shiftKey && e.key === 'H') { e.preventDefault(); ctx.editor.csgHollow(); return; }
    if (ctrl && e.shiftKey && e.key === 'M') { e.preventDefault(); ctx.editor.csgMerge(); return; }

    if (e.key === 'Escape') {
      if (ctx.editor.vertexMode) {
        ctx.handleExitVertexMode();
      } else if (ctx.editor.patchEditMode) {
        ctx.editor.exitPatchEditMode();
      } else if (ctx.editor.activeTool === 'clip' && ctx.editor.clipPoints.length > 0) {
        ctx.editor.cancelClip();
      } else if (ctx.editor.activeTool === 'rotate' && ctx.editor.rotateAnchor) {
        ctx.editor.rotateAnchor = null;
        ctx.editor.dirty = true;
      } else {
        ctx.editor.clearSelection();
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { ctx.editor.deleteSelection(); return; }

    if (e.key === '1') { ctx.setTool('select'); return; }
    if (e.key === '2') { ctx.setTool('create'); return; }
    if (e.key === '3') { ctx.setTool('entity'); return; }
    if (e.key === '4') { ctx.setTool('clip'); return; }
    if (e.key === '5') { ctx.setTool('rotate'); return; }

    if (e.key === 'v' && !ctrl) {
      const selectedPatchItems = getSelectedPatchItems(ctx.editor);
      if (ctx.editor.vertexMode) {
        ctx.handleExitVertexMode();
      } else if (ctx.editor.patchEditMode) {
        ctx.editor.exitPatchEditMode();
      } else if (selectedPatchItems.length > 0) {
        ctx.editor.enterPatchEditMode();
      } else if (ctx.editor.selection.length > 0) {
        ctx.editor.enterVertexMode();
      }
      return;
    }

    if (e.key === '[') { ctx.decreaseGrid(); return; }
    if (e.key === ']') { ctx.increaseGrid(); return; }

    if (e.key === 'p' && !ctrl && ctx.editor.selection.length > 0) {
      ctx.editor.createPatch('flat');
      return;
    }
    if (e.key === 'P' && !ctrl && ctx.editor.selection.length > 0) {
      ctx.editor.createPatch('cylinder');
      return;
    }
    if (e.key === 'p' && ctrl && !e.shiftKey && ctx.editor.selection.length > 0) {
      e.preventDefault();
      ctx.editor.createPatch('cone');
      return;
    }
    if (e.key === 'p' && ctrl && e.shiftKey && ctx.editor.selection.length > 0) {
      e.preventDefault();
      ctx.editor.createPatch('bevel');
      return;
    }

    if ((e.key === '+' || e.key === '=') && getSelectedPatchItems(ctx.editor).length > 0) {
      ctx.editor.changeSubdivisions(1);
      return;
    }
    if ((e.key === '-' || e.key === '_') && getSelectedPatchItems(ctx.editor).length > 0) {
      ctx.editor.changeSubdivisions(-1);
      return;
    }

    if (ctx.editor.patchEditMode) {
      if (e.key === 'PageUp' && !ctrl && !e.shiftKey) { e.preventDefault(); ctx.editor.raiseTerrain(); return; }
      if (e.key === 'PageDown' && !ctrl && !e.shiftKey) { e.preventDefault(); ctx.editor.lowerTerrain(); return; }
      if (e.key === 'Home' && !ctrl && !e.shiftKey) { e.preventDefault(); ctx.editor.smoothTerrain(); return; }
    }

    if (e.key === 'Enter' && ctx.editor.activeTool === 'clip') { ctx.editor.executeClip(); return; }
    if (e.key === 'Tab' && ctx.editor.activeTool === 'clip') { e.preventDefault(); ctx.editor.cycleClipMode(); return; }

    if (e.key === 'i' && !ctrl) { ctx.cycleInvisibleMode(); return; }
    if (e.key === 't' && !ctrl) { ctx.editor.toggleTextureLock(); return; }

    if (e.key === 'h' && !ctrl) { ctx.editor.hideSelected(); return; }
    if (e.key === 'H' && !ctrl) { ctx.editor.showHidden(); return; }

    if (e.key === 'g' && !ctrl) { ctx.toggleGeoSnap(); return; }

    if (e.key === 'f' && !ctrl) { ctx.editor.centerOnSelection(); return; }

    if (e.key === 'w' && !ctrl) { ctx.editor.gizmoMode = 'move'; ctx.editor.dirty = true; return; }
    if (e.key === 'e' && !ctrl) { ctx.editor.gizmoMode = 'scale'; ctx.editor.dirty = true; return; }

    if (e.key === 'r' && !ctrl) { ctx.editor.rotateSelection(90); return; }
    if (e.key === 'R' && !ctrl) { ctx.editor.rotateSelection(15); return; }
    if (e.key === 'X' && !ctrl) { e.preventDefault(); ctx.editor.flipSelection(0); return; }
    if (e.key === 'Y' && !ctrl) { e.preventDefault(); ctx.editor.flipSelection(1); return; }
    if (e.key === 'Z' && !ctrl) { e.preventDefault(); ctx.editor.flipSelection(2); return; }

    if (e.key.startsWith('Arrow') && e.shiftKey && ctx.editor.selectedFaces.length > 0) {
      e.preventDefault();
      const step = ctrl ? 1 : 8;
      const du = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      const dv = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
      ctx.editor.shiftTexture(du, dv);
      return;
    }

    if (e.key === 'F' && ctrl && e.shiftKey) { e.preventDefault(); ctx.editor.fitTexture(); return; }
    if (e.key === 'N' && ctrl && e.shiftKey) { e.preventDefault(); ctx.editor.resetTextureAlignment(); return; }
    if (e.key === 'PageUp' && e.shiftKey) { ctx.editor.rotateTexture(e.ctrlKey ? 1 : 15); return; }
    if (e.key === 'PageDown' && e.shiftKey) { ctx.editor.rotateTexture(e.ctrlKey ? -1 : -15); return; }
    if (e.key === 'PageUp' && ctrl && !e.shiftKey) { ctx.editor.scaleTexture(0.05); return; }
    if (e.key === 'PageDown' && ctrl && !e.shiftKey) { ctx.editor.scaleTexture(-0.05); return; }

    if (e.key.startsWith('Arrow') && ctx.editor.selection.length > 0) {
      e.preventDefault();
      const grid = e.ctrlKey ? 1 : e.shiftKey ? ctx.editor.gridSize * 4 : ctx.editor.gridSize;
      const delta: Vec3 = [0, 0, 0];
      const h = ctx.editor.nudgeAxisH;
      const v = ctx.editor.nudgeAxisV;
      if (e.key === 'ArrowRight') delta[h] = grid;
      else if (e.key === 'ArrowLeft') delta[h] = -grid;
      else if (e.key === 'ArrowUp') delta[v] = grid;
      else if (e.key === 'ArrowDown') delta[v] = -grid;
      ctx.editor.snapshot();
      if (ctx.editor.vertexMode && ctx.editor.vertexSelection.length > 0) {
        ctx.editor.moveSelectedVertices(delta);
      } else if (ctx.editor.patchEditMode && ctx.editor.patchControlSelection.length > 0) {
        ctx.editor.moveSelectedControlPoints(delta);
      } else {
        ctx.editor.moveSelection(delta);
      }
      return;
    }
  });
}
