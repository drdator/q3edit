import { Vec3, vec3Copy } from './math';
import { Editor } from './editor';
import { VIEWHEIGHT, WalkState, createWalkState } from './q3-movement';

export type Viewport3DFullscreenMode = 'walk' | 'fly' | 'edit';

export interface Viewport3DFullscreenUI {
  fullscreenBtn: HTMLButtonElement;
  fullscreenOverlay: HTMLDivElement;
  hudModeEl: HTMLSpanElement;
}

export interface Viewport3DFullscreenModeState {
  fullscreenMode: Viewport3DFullscreenMode;
  walkState: WalkState | null;
  walkStepSmooth: number;
  walkViewH: number;
  physicsAccum: number;
}

export interface Viewport3DFullscreenEnterState {
  fullscreen: boolean;
  savedCamera: { position: Vec3; yaw: number; pitch: number };
  physicsAccum: number;
}

export interface Viewport3DFullscreenExitState {
  position: Vec3;
  yaw: number;
  pitch: number;
  savedCamera: null;
  fullscreen: boolean;
}

export function createViewport3DFullscreenUI(container: HTMLElement, onEnter: () => void): Viewport3DFullscreenUI {
  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.className = 'vp-fullscreen-btn';
  fullscreenBtn.title = 'Fullscreen walkthrough';
  fullscreenBtn.innerHTML = '<i class="ph ph-arrows-out"></i>';
  fullscreenBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onEnter();
  });
  container.appendChild(fullscreenBtn);

  const fullscreenOverlay = document.createElement('div');
  fullscreenOverlay.className = 'vp-fullscreen-overlay';
  fullscreenOverlay.innerHTML = `
    <div class="fullscreen-crosshair"></div>
    <div class="fullscreen-hud">
      <span class="hud-mode">WALK</span>
      <span class="hud-sep"></span>
      <span>WASD</span>
      <span class="hud-sep"></span>
      <span>Space jump</span>
      <span class="hud-sep"></span>
      <span>C crouch</span>
      <span class="hud-sep"></span>
      <span>V mode</span>
      <span class="hud-sep"></span>
      <span>Esc exit</span>
    </div>
  `;
  const hudModeEl = fullscreenOverlay.querySelector('.hud-mode') as HTMLSpanElement;
  container.appendChild(fullscreenOverlay);

  return { fullscreenBtn, fullscreenOverlay, hudModeEl };
}

export function enterViewport3DFullscreen(opts: {
  position: Vec3;
  yaw: number;
  pitch: number;
  editor: Editor;
  fullscreenBtn: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  keys: Set<string>;
}): Viewport3DFullscreenEnterState {
  opts.editor.fullscreen3d = true;
  document.getElementById('app')!.classList.add('fullscreen-3d');
  opts.fullscreenBtn.style.display = 'none';
  opts.canvas.requestPointerLock();
  opts.keys.clear();
  return {
    fullscreen: true,
    savedCamera: { position: vec3Copy(opts.position), yaw: opts.yaw, pitch: opts.pitch },
    physicsAccum: 0,
  };
}

export function setViewport3DFullscreenMode(opts: {
  mode: Viewport3DFullscreenMode;
  position: Vec3;
  canvas: HTMLCanvasElement;
  fullscreenOverlay: HTMLDivElement;
  hudModeEl: HTMLSpanElement;
}): Viewport3DFullscreenModeState {
  opts.hudModeEl.textContent = opts.mode.toUpperCase();

  let walkState: WalkState | null;
  let walkStepSmooth = 0;
  let walkViewH = VIEWHEIGHT;
  let physicsAccum = 0;

  if (opts.mode === 'walk') {
    walkState = createWalkState(opts.position);
  } else {
    walkState = null;
  }

  if (opts.mode === 'edit') {
    if (document.pointerLockElement) document.exitPointerLock();
    opts.fullscreenOverlay.classList.add('edit-mode');
  } else {
    opts.fullscreenOverlay.classList.remove('edit-mode');
    if (!document.pointerLockElement) opts.canvas.requestPointerLock();
  }

  return {
    fullscreenMode: opts.mode,
    walkState,
    walkStepSmooth,
    walkViewH,
    physicsAccum,
  };
}

export function exitViewport3DFullscreen(opts: {
  fullscreen: boolean;
  fullscreenMode: Viewport3DFullscreenMode;
  savedCamera: { position: Vec3; yaw: number; pitch: number } | null;
  position: Vec3;
  yaw: number;
  pitch: number;
  editor: Editor;
  fullscreenOverlay: HTMLDivElement;
  fullscreenBtn: HTMLButtonElement;
  keys: Set<string>;
}): Viewport3DFullscreenExitState {
  let position = opts.position;
  let yaw = opts.yaw;
  let pitch = opts.pitch;

  if (!opts.fullscreen) {
    return {
      position,
      yaw,
      pitch,
      savedCamera: null,
      fullscreen: false,
    };
  }

  if (opts.fullscreenMode !== 'edit' && opts.savedCamera) {
    position = opts.savedCamera.position;
    yaw = opts.savedCamera.yaw;
    pitch = opts.savedCamera.pitch;
  }

  opts.editor.fullscreen3d = false;
  opts.fullscreenOverlay.classList.remove('edit-mode');
  document.getElementById('app')!.classList.remove('fullscreen-3d');
  opts.fullscreenBtn.style.display = '';
  opts.keys.clear();
  if (document.pointerLockElement) document.exitPointerLock();

  return {
    position,
    yaw,
    pitch,
    savedCamera: null,
    fullscreen: false,
  };
}
