// =============================================================================
// Chrome Embed via CDP (Chrome DevTools Protocol)
// v3.11.130
//
// Lanza el Chrome del sistema con un perfil dedicado en
// ~/Library/Application Support/task-manager-app/chrome-profile/ y lo controla
// via CDP. Stream de frames JPEG via Page.startScreencast → canvas en el
// renderer. Input forwarding via Input.dispatchMouseEvent / dispatchKeyEvent.
//
// Por qué: Google bloquea el login en webviews embebidos (Electron). El Chrome
// del sistema es Chrome de verdad → Google lo acepta. CDP nos deja "embeber"
// visualmente esa instancia dentro del Task Manager.
// =============================================================================

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (e) { /* opcional */ }

let state = {
  browser: null,
  page: null,
  cdp: null,
  active: false,
  sender: null, // webContents donde enviar frames
  width: 1280,
  height: 720,
  quality: 70,
  everyNthFrame: 1
};

function profileDir() {
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'chrome-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function start({ url, sender, width, height, quality }) {
  if (!puppeteer) throw new Error('puppeteer-core no está instalado');
  if (state.active) await stop();
  state.sender = sender || null;
  state.width = Math.max(640, Math.min(2560, parseInt(width) || 1280));
  state.height = Math.max(480, Math.min(1440, parseInt(height) || 720));
  state.quality = Math.max(40, Math.min(95, parseInt(quality) || 70));

  console.log('[chrome-embed] launching system Chrome...');
  // Lanzamos Chrome del sistema con perfil dedicado, headed (para que el debug
  // protocol funcione bien) pero la ventana queda oculta visualmente con
  // posición offscreen + size mínimo. El usuario solo ve el canvas dentro de
  // la app, no la ventana real de Chrome.
  const launchOpts = {
    channel: 'chrome',                              // auto-detect Chrome del sistema
    headless: false,                                // no headless — necesitamos render real para screencast
    userDataDir: profileDir(),                      // perfil dedicado de Task Manager
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=PrivacySandboxSettings4',
      '--window-position=-2400,-2400',              // fuera de pantalla
      `--window-size=${state.width},${state.height}`
    ],
    defaultViewport: { width: state.width, height: state.height }
  };
  try {
    state.browser = await puppeteer.launch(launchOpts);
  } catch (e) {
    console.error('[chrome-embed] launch failed:', e.message);
    throw new Error('No se pudo lanzar Chrome. Asegurate de tener Google Chrome instalado. Detalle: ' + e.message);
  }
  state.page = (await state.browser.pages())[0] || await state.browser.newPage();
  state.cdp = await state.page.target().createCDPSession();
  await state.cdp.send('Page.enable');
  await state.cdp.send('Runtime.enable');

  // Notificar cambios de URL/título
  state.cdp.on('Page.frameNavigated', async (ev) => {
    if (!ev.frame || ev.frame.parentId) return;
    if (state.sender) {
      try { state.sender.send('chrome-embed-url-changed', ev.frame.url); } catch (_) {}
    }
  });
  state.page.on('framenavigated', (frame) => {
    if (frame !== state.page.mainFrame()) return;
    if (state.sender) {
      try { state.sender.send('chrome-embed-url-changed', frame.url()); } catch (_) {}
    }
  });

  // Screencast: frames JPEG
  state.cdp.on('Page.screencastFrame', async (ev) => {
    try {
      if (state.sender) {
        state.sender.send('chrome-embed-frame', {
          data: ev.data,        // base64 JPEG
          sessionId: ev.sessionId,
          metadata: ev.metadata // { deviceWidth, deviceHeight, pageScaleFactor, ... }
        });
      }
      await state.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId });
    } catch (e) { /* frame perdido, no fatal */ }
  });

  // Navegar a la URL inicial
  const startUrl = url || 'https://www.google.com/';
  try { await state.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
  catch (e) { console.warn('[chrome-embed] initial goto warn:', e.message); }

  // Iniciar screencast
  await state.cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: state.quality,
    maxWidth: state.width,
    maxHeight: state.height,
    everyNthFrame: state.everyNthFrame
  });

  state.active = true;
  console.log('[chrome-embed] started, profile:', profileDir());
  return { ok: true, url: state.page.url(), profile: profileDir() };
}

async function navigate(url) {
  if (!state.active || !state.page) throw new Error('Chrome embed no está activo');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  await state.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  return { ok: true, url: state.page.url() };
}

async function back() {
  if (!state.page) return;
  await state.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
}
async function forward() {
  if (!state.page) return;
  await state.page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
}
async function reload() {
  if (!state.page) return;
  await state.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
}

// ===== Input forwarding =====
const MOUSE_BUTTONS = { 0: 'left', 1: 'middle', 2: 'right' };
async function dispatchMouse({ type, x, y, button, clickCount, modifiers }) {
  if (!state.cdp) return;
  // type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel'
  const params = {
    type,
    x: Math.round(x),
    y: Math.round(y),
    modifiers: modifiers || 0
  };
  if (type === 'mousePressed' || type === 'mouseReleased') {
    params.button = MOUSE_BUTTONS[button] || 'left';
    params.clickCount = clickCount || 1;
  } else if (type === 'mouseMoved') {
    params.button = 'none';
  }
  await state.cdp.send('Input.dispatchMouseEvent', params).catch(() => {});
}

async function dispatchWheel({ x, y, deltaX, deltaY, modifiers }) {
  if (!state.cdp) return;
  await state.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: Math.round(x),
    y: Math.round(y),
    deltaX: deltaX || 0,
    deltaY: deltaY || 0,
    modifiers: modifiers || 0
  }).catch(() => {});
}

async function dispatchKey({ type, key, code, keyCode, modifiers, text }) {
  if (!state.cdp) return;
  // type: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char'
  await state.cdp.send('Input.dispatchKeyEvent', {
    type,
    key,
    code,
    windowsVirtualKeyCode: keyCode || 0,
    nativeVirtualKeyCode: keyCode || 0,
    modifiers: modifiers || 0,
    text: text || (type === 'char' ? key : ''),
    unmodifiedText: text || (type === 'char' ? key : '')
  }).catch(() => {});
}

async function stop() {
  state.active = false;
  if (state.cdp) {
    try { await state.cdp.send('Page.stopScreencast'); } catch (_) {}
    try { await state.cdp.detach(); } catch (_) {}
    state.cdp = null;
  }
  if (state.browser) {
    try { await state.browser.close(); } catch (_) {}
    state.browser = null;
  }
  state.page = null;
  state.sender = null;
  console.log('[chrome-embed] stopped');
}

function isActive() { return state.active; }
function getUrl() { try { return state.page ? state.page.url() : ''; } catch (_) { return ''; } }

async function resize({ width, height }) {
  if (!state.cdp) return;
  state.width = Math.max(640, Math.min(2560, parseInt(width) || state.width));
  state.height = Math.max(480, Math.min(1440, parseInt(height) || state.height));
  try {
    await state.page.setViewport({ width: state.width, height: state.height });
    // Reiniciar screencast con nuevas dimensiones
    await state.cdp.send('Page.stopScreencast').catch(() => {});
    await state.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: state.quality,
      maxWidth: state.width,
      maxHeight: state.height,
      everyNthFrame: state.everyNthFrame
    });
  } catch (e) { console.warn('[chrome-embed] resize warn:', e.message); }
}

module.exports = {
  start, stop, navigate, back, forward, reload, resize,
  dispatchMouse, dispatchWheel, dispatchKey,
  isActive, getUrl
};
