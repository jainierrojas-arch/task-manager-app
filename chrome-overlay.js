// =============================================================================
// Chrome Overlay (v3.11.140)
//
// Lanza TU Google Chrome real (no puppeteer, no CDP) con --app=URL y un perfil
// dedicado. Usa AppleScript via osascript para posicionar la ventana de Chrome
// EXACTAMENTE sobre el área del Explorer dentro del Task Manager. La ventana
// de Chrome se mueve/redimensiona con el Task Manager via polling.
//
// Por qué: Chrome real (no automatizado) NO es detectado por Google. El user
// puede loguearse normal en Google, performance nativa, su perfil con
// extensiones, todo. La integración visual es por superposición — Chrome
// "vive" en su propia ventana pero se ve adentro del Task Manager.
//
// Limitaciones aceptadas:
// - Solo macOS (Windows necesita otra impl con AccessibilityAPI)
// - Cuando el usuario cambia a otra pestaña del Task Manager, Chrome se oculta
// - Requiere permisos de Accessibility (System Settings > Privacy)
// =============================================================================

const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { app, BrowserWindow } = require('electron');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let state = {
  chromeProc: null,
  active: false,
  syncInterval: null,
  hideTimeout: null,
  mainWindowRef: null,
  explorerOffset: { top: 130, left: 220, right: 0, bottom: 80 } // px desde los bordes del mainWindow
};

function profileDir() {
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'chrome-overlay-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function chromeAvailable() {
  return fs.existsSync(CHROME_PATH);
}

async function start({ url, mainWindow, explorerOffset }) {
  if (state.active) await stop();
  if (!chromeAvailable()) {
    throw new Error('Google Chrome no está instalado en /Applications/Google Chrome.app');
  }
  state.mainWindowRef = mainWindow;

  const startUrl = url || 'https://www.google.com/';
  // v3.11.141: SIMPLE. Lanzamos Chrome como ventana normal con perfil dedicado.
  // SIN AppleScript positioning, SIN Accessibility permissions, SIN polling.
  // El usuario tiene su Chrome separado pero funciona INSTANTÁNEAMENTE.
  console.log('[chrome-overlay] launching Chrome (simple mode) --app=' + startUrl);
  state.chromeProc = spawn(CHROME_PATH, [
    `--app=${startUrl}`,
    `--user-data-dir=${profileDir()}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=PrivacySandboxSettings4'
  ], { detached: false, stdio: 'ignore' });

  state.chromeProc.on('exit', () => {
    console.log('[chrome-overlay] Chrome process exited');
    state.chromeProc = null;
    state.active = false;
  });

  state.active = true;
  return { ok: true, profile: profileDir(), pid: state.chromeProc && state.chromeProc.pid };
}

function _calcBounds() {
  if (!state.mainWindowRef || state.mainWindowRef.isDestroyed()) return null;
  const b = state.mainWindowRef.getBounds();
  const off = state.explorerOffset;
  return {
    x: b.x + off.left,
    y: b.y + off.top,
    width: Math.max(400, b.width - off.left - off.right),
    height: Math.max(300, b.height - off.top - off.bottom)
  };
}

function _startWindowSync() {
  if (state.syncInterval) clearInterval(state.syncInterval);
  let lastBoundsStr = '';
  state.syncInterval = setInterval(() => {
    if (!state.active) return;
    if (!state.mainWindowRef || state.mainWindowRef.isDestroyed()) return;
    // Si la ventana principal no está visible, ocultar Chrome
    const mw = state.mainWindowRef;
    if (mw.isMinimized() || !mw.isVisible()) {
      _hideChrome();
      return;
    }
    const bounds = _calcBounds();
    if (!bounds) return;
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    if (key === lastBoundsStr) return; // sin cambios
    lastBoundsStr = key;
    _positionChromeWindow(bounds);
  }, 150);
}

function _positionChromeWindow({ x, y, width, height }) {
  if (!state.chromeProc || !state.chromeProc.pid) return;
  const pid = state.chromeProc.pid;
  const script = `
    tell application "System Events"
      try
        set chromeProcs to (every process whose unix id is ${pid})
        repeat with p in chromeProcs
          tell p
            if (count of windows) > 0 then
              set position of window 1 to {${x}, ${y}}
              set size of window 1 to {${width}, ${height}}
            end if
          end tell
        end repeat
      end try
    end tell
  `;
  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 800 }, (err) => {
    if (err && !err.killed) {
      // Probablemente necesite permisos de Accessibility
      if ((err.message || '').includes('1002') || (err.message || '').includes('not allowed')) {
        console.warn('[chrome-overlay] Necesita permisos de Accessibility. System Settings → Privacy & Security → Accessibility → permitir Task Manager');
      }
    }
  });
}

function _hideChrome() {
  if (!state.chromeProc || !state.chromeProc.pid) return;
  const pid = state.chromeProc.pid;
  const script = `
    tell application "System Events"
      try
        set chromeProcs to (every process whose unix id is ${pid})
        repeat with p in chromeProcs
          tell p
            set visible to false
          end tell
        end repeat
      end try
    end tell
  `;
  exec(`osascript -e '${script}'`, { timeout: 500 }, () => {});
}

async function show() {
  // Forzar re-posicionamiento ya
  if (state.chromeProc && state.chromeProc.pid) {
    const pid = state.chromeProc.pid;
    const script = `
      tell application "System Events"
        try
          set chromeProcs to (every process whose unix id is ${pid})
          repeat with p in chromeProcs
            tell p
              set visible to true
            end tell
          end repeat
        end try
      end tell
    `;
    exec(`osascript -e '${script}'`, () => {});
  }
  const bounds = _calcBounds();
  if (bounds) _positionChromeWindow(bounds);
}

async function navigate(url) {
  if (!state.active || !state.chromeProc) throw new Error('Chrome overlay no activo');
  // Abrir una nueva pestaña en el Chrome existente con la URL
  // (en modo --app no hay URL bar, así que usamos `open` que reusa el Chrome corriendo)
  exec(`open -na "Google Chrome" --args --user-data-dir="${profileDir()}" --app="${url}"`, () => {});
}

async function stop() {
  state.active = false;
  if (state.syncInterval) { clearInterval(state.syncInterval); state.syncInterval = null; }
  if (state.chromeProc) {
    try { state.chromeProc.kill('SIGTERM'); } catch (_) {}
    // Si no muere en 2s, SIGKILL
    setTimeout(() => {
      try { if (state.chromeProc && !state.chromeProc.killed) state.chromeProc.kill('SIGKILL'); } catch (_) {}
    }, 2000);
    state.chromeProc = null;
  }
  state.mainWindowRef = null;
  console.log('[chrome-overlay] stopped');
}

function isActive() { return state.active; }

module.exports = {
  start, stop, navigate, show, isActive, chromeAvailable
};
