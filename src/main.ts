import './style.css';
import { Editor } from './editor';
import { Viewport2D } from './viewport2d';
import { Viewport3D } from './viewport3d';
import { UI } from './ui';
import { loadAllPaks } from './pak';
import { TextureManager } from './textures';

// ── Loading screen ──

const loadingEl = document.createElement('div');
loadingEl.id = 'loading-screen';
loadingEl.innerHTML = `
  <div class="loading-content">
    <div class="loading-title">Q3 MAP EDITOR</div>
    <div class="loading-status" id="loading-status">Initializing...</div>
    <div class="loading-bar"><div class="loading-fill" id="loading-fill"></div></div>
  </div>
`;
document.body.appendChild(loadingEl);

function setLoadingStatus(msg: string) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = msg;
  console.log(msg);
}

// ── Bootstrap ──

async function init() {
  const editor = new Editor();
  editor.createDefaultMap();

  // Get canvases
  const xyCanvas = document.querySelector('#vp-xy canvas') as HTMLCanvasElement;
  const xzCanvas = document.querySelector('#vp-xz canvas') as HTMLCanvasElement;
  const yzCanvas = document.querySelector('#vp-yz canvas') as HTMLCanvasElement;
  const tdCanvas = document.querySelector('#vp-3d canvas') as HTMLCanvasElement;

  // Create viewports
  const vpXY = new Viewport2D(xyCanvas, editor, 'xy');
  const vpXZ = new Viewport2D(xzCanvas, editor, 'xz');
  const vpYZ = new Viewport2D(yzCanvas, editor, 'yz');
  const vp3D = new Viewport3D(tdCanvas, editor);

  // Create UI
  const ui = new UI(editor);

  // Start render loop immediately (untextured)
  function frame(time: number): void {
    vp3D.render(time);
    vpXY.render();
    vpXZ.render();
    vpYZ.render();
    ui.update();
    editor.dirty = false;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Load pak files in the background
  setLoadingStatus('Loading pak files...');
  try {
    const pak = await loadAllPaks('/baseq3', setLoadingStatus);

    setLoadingStatus('Initializing texture manager...');
    const texMgr = new TextureManager(vp3D.gl, pak);

    // Create a small green texture for entity markers
    const greenPixels = new Uint8Array([40, 180, 40, 255]);
    const greenTex = vp3D.gl.createTexture()!;
    vp3D.gl.bindTexture(vp3D.gl.TEXTURE_2D, greenTex);
    vp3D.gl.texImage2D(vp3D.gl.TEXTURE_2D, 0, vp3D.gl.RGBA, 1, 1, 0,
      vp3D.gl.RGBA, vp3D.gl.UNSIGNED_BYTE, greenPixels);
    (texMgr as any).cache.set('__entity_green', { glTexture: greenTex, width: 1, height: 1 });

    vp3D.textureManager = texMgr;

    // Wire up texture manager to editor for the texture browser
    (editor as any)._textureManager = texMgr;

    // Trigger redraw when textures load
    texMgr.onTextureLoaded = () => { editor.dirty = true; };

    // Update texture browser with real pak textures
    ui.updateTextureBrowser(texMgr);

    setLoadingStatus('Ready');
  } catch (err) {
    console.warn('Failed to load pak files:', err);
    setLoadingStatus('Running without textures (pak files not found)');
  }

  // Hide loading screen
  setTimeout(() => {
    loadingEl.style.opacity = '0';
    setTimeout(() => loadingEl.remove(), 500);
  }, 500);
}

init();
