// =============================================================================
// Chrome Embed via CDP (Chrome DevTools Protocol)
// v3.11.134 — multi-tab
//
// Lanza el Chrome del sistema con un perfil dedicado y lo controla via CDP.
// Stream de frames JPEG de la pestaña ACTIVA → canvas. Soporta múltiples tabs:
// cada una es una puppeteer.Page separada. Switch entre tabs = stop screencast
// en la actual + start en la nueva.
// =============================================================================

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let puppeteer = null;
let puppeteerLoadError = null;
try {
  puppeteer = require('puppeteer-core');
  console.log('[chrome-embed] puppeteer-core loaded OK, version:', (require('puppeteer-core/package.json') || {}).version);
} catch (e) {
  puppeteerLoadError = e.message || String(e);
  console.error('[chrome-embed] puppeteer-core REQUIRE FAILED:', puppeteerLoadError);
}

let state = {
  browser: null,
  sender: null,
  width: 1280,
  height: 720,
  quality: 85,
  tabs: [],          // [{ id, page, cdp, title, url, screencasting }]
  activeId: null,
  active: false
};

function profileDir() {
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'chrome-profile');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function downloadsDir() {
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'chrome-downloads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// v3.11.135: setup de download interception via CDP. Chrome guarda al disco;
// cuando completa avisamos al renderer para crear entry en Depósito.
async function _setupDownloads() {
  if (!state.browser) return;
  const bClient = await state.browser.target().createCDPSession();
  await bClient.send('Browser.setDownloadBehavior', {
    behavior: 'allowAndName',
    downloadPath: downloadsDir(),
    eventsEnabled: true
  });
  const activeDownloads = new Map(); // guid → { suggestedFilename, url }
  bClient.on('Browser.downloadWillBegin', (ev) => {
    activeDownloads.set(ev.guid, { filename: ev.suggestedFilename || 'archivo', url: ev.url || '' });
    if (state.sender) {
      try { state.sender.send('chrome-embed-download-start', { guid: ev.guid, filename: ev.suggestedFilename, url: ev.url }); } catch (_) {}
    }
  });
  bClient.on('Browser.downloadProgress', (ev) => {
    const d = activeDownloads.get(ev.guid);
    if (!d) return;
    if (ev.state === 'completed') {
      // Con 'allowAndName' Chrome guarda como ev.guid (sin extensión). Renombrar
      // al suggestedFilename para conservar la extensión correcta.
      const tmpPath = path.join(downloadsDir(), ev.guid);
      let finalPath = tmpPath;
      try {
        const safeFn = (d.filename || 'archivo').replace(/[\/\\:*?"<>|]/g, '_');
        const unique = Date.now() + '-' + safeFn;
        finalPath = path.join(downloadsDir(), unique);
        if (fs.existsSync(tmpPath)) fs.renameSync(tmpPath, finalPath);
      } catch (e) { console.warn('[chrome-embed] download rename warn:', e.message); }
      if (state.sender) {
        try {
          state.sender.send('chrome-embed-download-complete', {
            guid: ev.guid,
            filename: d.filename,
            filePath: finalPath,
            size: ev.receivedBytes || 0,
            url: d.url
          });
        } catch (_) {}
      }
      activeDownloads.delete(ev.guid);
    } else if (ev.state === 'canceled') {
      activeDownloads.delete(ev.guid);
      if (state.sender) { try { state.sender.send('chrome-embed-download-cancel', { guid: ev.guid }); } catch (_) {} }
    } else if (state.sender) {
      try {
        state.sender.send('chrome-embed-download-progress', {
          guid: ev.guid,
          progress: ev.totalBytes ? ev.receivedBytes / ev.totalBytes : 0,
          receivedBytes: ev.receivedBytes
        });
      } catch (_) {}
    }
  });
}

function findTab(id) { return state.tabs.find(t => t.id === id); }
function tabsSummary() {
  return state.tabs.map(t => ({ id: t.id, title: t.title || t.url || 'Pestaña', url: t.url || '', isActive: t.id === state.activeId }));
}
function notifyTabs() {
  if (state.sender) {
    try { state.sender.send('chrome-embed-tabs', tabsSummary()); } catch (_) {}
  }
}

function _handleFrame(tab) {
  return async (ev) => {
    if (state.activeId !== tab.id) return;
    try {
      if (state.sender) {
        state.sender.send('chrome-embed-frame', {
          data: ev.data,
          sessionId: ev.sessionId,
          metadata: ev.metadata
        });
      }
      await tab.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId });
    } catch (_) {}
  };
}

async function _setupTab(tab) {
  await tab.page.setViewport({
    width: state.width,
    height: state.height,
    deviceScaleFactor: 1
  }).catch(() => {});
  tab.cdp = await tab.page.target().createCDPSession();
  await tab.cdp.send('Page.enable');
  await tab.cdp.send('Runtime.enable');

  tab.page.on('framenavigated', (frame) => {
    if (frame !== tab.page.mainFrame()) return;
    tab.url = frame.url();
    if (tab.id === state.activeId && state.sender) {
      try { state.sender.send('chrome-embed-url-changed', tab.url); } catch (_) {}
    }
    notifyTabs();
  });
  tab.page.on('load', async () => {
    try { tab.title = (await tab.page.title()) || tab.url; } catch (_) {}
    notifyTabs();
  });

  tab._frameHandler = _handleFrame(tab);
}

async function _startScreencastOn(tab) {
  if (!tab || !tab.cdp) return;
  if (tab.screencasting) return;
  try { await tab.page.bringToFront(); } catch (_) {}
  tab.cdp.on('Page.screencastFrame', tab._frameHandler);
  await tab.cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: state.quality,
    maxWidth: state.width,
    maxHeight: state.height,
    everyNthFrame: 1
  });
  tab.screencasting = true;
}
async function _stopScreencastOn(tab) {
  if (!tab || !tab.cdp || !tab.screencasting) return;
  try { await tab.cdp.send('Page.stopScreencast'); } catch (_) {}
  try { tab.cdp.off('Page.screencastFrame', tab._frameHandler); } catch (_) {}
  tab.screencasting = false;
}

async function start({ url, sender, width, height, quality }) {
  if (!puppeteer) {
    throw new Error('puppeteer-core no cargó. Detalle del require: ' + (puppeteerLoadError || 'desconocido'));
  }
  if (state.active) await stop();
  state.sender = sender || null;
  state.width = Math.max(640, Math.min(2560, parseInt(width) || 1280));
  state.height = Math.max(480, Math.min(1440, parseInt(height) || 720));
  state.quality = Math.max(40, Math.min(95, parseInt(quality) || 85));
  state.tabs = [];
  state.activeId = null;

  console.log('[chrome-embed] launching system Chrome (headless)...');
  const launchOpts = {
    channel: 'chrome',
    headless: 'new',
    userDataDir: profileDir(),
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=PrivacySandboxSettings4',
      `--window-size=${state.width},${state.height}`
    ],
    defaultViewport: { width: state.width, height: state.height, deviceScaleFactor: 1 }
  };
  try {
    state.browser = await puppeteer.launch(launchOpts);
  } catch (e) {
    console.error('[chrome-embed] launch failed:', e.message);
    throw new Error('No se pudo lanzar Chrome. Asegurate de tener Google Chrome instalado. Detalle: ' + e.message);
  }
  state.active = true;
  await _setupDownloads();

  // Crear primera pestaña
  const startUrl = url || 'https://www.google.com/';
  const firstPage = (await state.browser.pages())[0] || await state.browser.newPage();
  const firstTab = { id: 'tab-' + Date.now(), page: firstPage, title: 'Cargando…', url: startUrl, screencasting: false };
  await _setupTab(firstTab);
  state.tabs.push(firstTab);
  state.activeId = firstTab.id;
  try { await firstPage.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
  catch (e) { console.warn('[chrome-embed] initial goto warn:', e.message); }
  await _startScreencastOn(firstTab);
  notifyTabs();

  console.log('[chrome-embed] started, profile:', profileDir());
  return { ok: true, url: firstPage.url(), profile: profileDir(), tabId: firstTab.id };
}

async function newTab(url) {
  if (!state.active || !state.browser) throw new Error('Chrome embed no está activo');
  const page = await state.browser.newPage();
  const tab = { id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), page, title: 'Nueva pestaña', url: '', screencasting: false };
  await _setupTab(tab);
  state.tabs.push(tab);
  const targetUrl = url || 'https://www.google.com/';
  try { await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
  catch (e) { console.warn('[chrome-embed] newTab goto warn:', e.message); }
  await switchTab(tab.id);
  return { ok: true, id: tab.id };
}

async function switchTab(id) {
  if (state.activeId === id) return { ok: true };
  const newActive = findTab(id);
  if (!newActive) return { ok: false, error: 'tab no encontrado' };
  const oldActive = findTab(state.activeId);
  if (oldActive) await _stopScreencastOn(oldActive);
  state.activeId = id;
  await _startScreencastOn(newActive);
  if (state.sender) {
    try { state.sender.send('chrome-embed-url-changed', newActive.url || ''); } catch (_) {}
  }
  notifyTabs();
  return { ok: true };
}

async function closeTab(id) {
  const tab = findTab(id);
  if (!tab) return { ok: false };
  await _stopScreencastOn(tab);
  try { await tab.page.close(); } catch (_) {}
  state.tabs = state.tabs.filter(t => t.id !== id);
  if (state.tabs.length === 0) {
    // Si cerramos la última, abrimos una nueva
    await newTab('https://www.google.com/');
    return { ok: true };
  }
  if (state.activeId === id) {
    await switchTab(state.tabs[state.tabs.length - 1].id);
  } else {
    notifyTabs();
  }
  return { ok: true };
}

async function listTabs() { return tabsSummary(); }

async function navigate(url) {
  if (!state.active) throw new Error('Chrome embed no está activo');
  const tab = findTab(state.activeId);
  if (!tab) throw new Error('No hay tab activa');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  await tab.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  return { ok: true, url: tab.page.url() };
}

async function back() {
  const tab = findTab(state.activeId); if (!tab) return;
  await tab.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
}
async function forward() {
  const tab = findTab(state.activeId); if (!tab) return;
  await tab.page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
}
async function reload() {
  const tab = findTab(state.activeId); if (!tab) return;
  await tab.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
}

// ===== Input forwarding (al tab activo) =====
const MOUSE_BUTTONS = { 0: 'left', 1: 'middle', 2: 'right' };
async function dispatchMouse({ type, x, y, button, clickCount, modifiers }) {
  const tab = findTab(state.activeId); if (!tab || !tab.cdp) return;
  const params = { type, x: Math.round(x), y: Math.round(y), modifiers: modifiers || 0 };
  if (type === 'mousePressed' || type === 'mouseReleased') {
    params.button = MOUSE_BUTTONS[button] || 'left';
    params.clickCount = clickCount || 1;
  } else if (type === 'mouseMoved') {
    params.button = 'none';
  }
  await tab.cdp.send('Input.dispatchMouseEvent', params).catch(() => {});
}
async function dispatchWheel({ x, y, deltaX, deltaY, modifiers }) {
  const tab = findTab(state.activeId); if (!tab || !tab.cdp) return;
  await tab.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: Math.round(x), y: Math.round(y),
    deltaX: deltaX || 0, deltaY: deltaY || 0,
    modifiers: modifiers || 0
  }).catch(() => {});
}
async function dispatchKey({ type, key, code, keyCode, modifiers, text }) {
  const tab = findTab(state.activeId); if (!tab || !tab.cdp) return;
  await tab.cdp.send('Input.dispatchKeyEvent', {
    type, key, code,
    windowsVirtualKeyCode: keyCode || 0,
    nativeVirtualKeyCode: keyCode || 0,
    modifiers: modifiers || 0,
    text: text || (type === 'char' ? key : ''),
    unmodifiedText: text || (type === 'char' ? key : '')
  }).catch(() => {});
}

async function stop() {
  state.active = false;
  for (const tab of state.tabs) {
    await _stopScreencastOn(tab);
    try { if (tab.cdp) await tab.cdp.detach(); } catch (_) {}
  }
  state.tabs = [];
  state.activeId = null;
  if (state.browser) {
    try { await state.browser.close(); } catch (_) {}
    state.browser = null;
  }
  state.sender = null;
  console.log('[chrome-embed] stopped');
}

function isActive() { return state.active; }
function getUrl() {
  const tab = findTab(state.activeId);
  try { return tab && tab.page ? tab.page.url() : ''; } catch (_) { return ''; }
}

async function resize({ width, height }) {
  state.width = Math.max(640, Math.min(2560, parseInt(width) || state.width));
  state.height = Math.max(480, Math.min(1440, parseInt(height) || state.height));
  for (const tab of state.tabs) {
    try {
      await tab.page.setViewport({ width: state.width, height: state.height, deviceScaleFactor: 1 });
    } catch (_) {}
  }
  // Reiniciar screencast del activo con nuevas dimensiones
  const active = findTab(state.activeId);
  if (active && active.screencasting) {
    await _stopScreencastOn(active);
    await _startScreencastOn(active);
  }
}

module.exports = {
  start, stop, navigate, back, forward, reload, resize,
  newTab, switchTab, closeTab, listTabs,
  dispatchMouse, dispatchWheel, dispatchKey,
  isActive, getUrl
};
