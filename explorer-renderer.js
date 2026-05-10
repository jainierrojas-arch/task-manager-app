// Explorer renderer (v3.11.0)
// Embebido como iframe del side-panel principal. Tiene un <webview> Electron que
// puede navegar IG/TikTok/YouTube libremente. Cuando el usuario quiere guardar
// la URL actual al Depósito, postMessage al parent (renderer.js) que escribe a
// /depositEntries en Firestore.

const browser = document.getElementById('browser');
const urlBar = document.getElementById('urlBar');
const loadingBar = document.getElementById('loadingBar');
const categorySelect = document.getElementById('categorySelect');
const toastEl = document.getElementById('toast');

// ===== Heredar workspace flags del parent (igual que deposit/chat) =====
const wsParams = new URLSearchParams(window.location.search);
const WS_ID = wsParams.get('workspace') || null;
const DEFAULT_WS_ID = wsParams.get('defaultWs') || null;
const IS_DEFAULT = wsParams.get('isDefault') === '1';

function showToast(msg, kind) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', kind === 'error');
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ===== Webview navigation =====
let webviewReady = false;
const pendingNavQueue = [];

function navigate(targetUrl) {
  if (!targetUrl) return;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
  if (!webviewReady) {
    pendingNavQueue.push(targetUrl);
    return;
  }
  // Intentar loadURL primero. Si falla, fallback a setAttribute('src').
  try {
    const p = browser.loadURL(targetUrl);
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        console.warn('[explorer] loadURL failed', err);
        try { browser.setAttribute('src', targetUrl); } catch (e) { showToast('Error al navegar: ' + e.message, 'error'); }
      });
    }
  } catch (e) {
    console.warn('[explorer] loadURL threw', e);
    try { browser.setAttribute('src', targetUrl); }
    catch (e2) { showToast('Error al navegar: ' + e2.message, 'error'); }
  }
}

browser.addEventListener('dom-ready', () => {
  webviewReady = true;
  // Procesar cola de navegaciones pendientes
  while (pendingNavQueue.length) navigate(pendingNavQueue.shift());
  syncUrlBar();
});
browser.addEventListener('did-start-loading', () => {
  loadingBar.classList.remove('done');
  loadingBar.classList.add('active');
});
browser.addEventListener('did-stop-loading', () => {
  loadingBar.classList.remove('active');
  loadingBar.classList.add('done');
  setTimeout(() => loadingBar.classList.remove('done'), 600);
});
browser.addEventListener('did-fail-load', (ev) => {
  // -3 = ABORTED (normal cuando se inicia otra navegación). Ignorar.
  if (ev.errorCode === -3) return;
  console.warn('[explorer] did-fail-load', ev.errorCode, ev.errorDescription, ev.validatedURL);
  showToast(`Error ${ev.errorCode}: ${ev.errorDescription || 'No se pudo cargar'}`, 'error');
});
function syncUrlBar() {
  try { urlBar.value = browser.getURL(); } catch (e) {}
}
browser.addEventListener('did-navigate', syncUrlBar);
browser.addEventListener('did-navigate-in-page', syncUrlBar);
browser.addEventListener('did-finish-load', syncUrlBar);

document.getElementById('navBack').addEventListener('click', () => {
  try { if (browser.canGoBack()) browser.goBack(); } catch (e) {}
});
document.getElementById('navForward').addEventListener('click', () => {
  try { if (browser.canGoForward()) browser.goForward(); } catch (e) {}
});
document.getElementById('navReload').addEventListener('click', () => {
  try { browser.reload(); } catch (e) {}
});
document.getElementById('navGo').addEventListener('click', () => {
  const u = urlBar.value.trim();
  if (!u) return;
  navigate(u);
});
urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('navGo').click();
});

document.querySelectorAll('[data-quick]').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.quick));
});

// ===== Save current URL to Deposit =====
const saveBtn = document.getElementById('saveToDeposit');
saveBtn.addEventListener('click', async () => {
  let url, title;
  try {
    url = browser.getURL();
    title = browser.getTitle() || '';
  } catch (e) {
    showToast('No se pudo leer la URL del explorador', 'error');
    return;
  }
  if (!url || !/^https?:/i.test(url)) {
    showToast('URL inválida', 'error');
    return;
  }
  // Permite seguir clickeando otra; deshabilitar mientras se guarda
  saveBtn.disabled = true;
  saveBtn.textContent = '⏳ Guardando...';

  // postMessage al parent — renderer.js escribe a depositEntries en Firestore.
  // Usamos un id de request para asociar la respuesta al click correcto.
  const reqId = 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const onReply = (ev) => {
    const d = ev.data;
    if (!d || d.type !== 'explorer-save-reply' || d.reqId !== reqId) return;
    window.removeEventListener('message', onReply);
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Guardar URL actual al Depósito';
    if (d.ok) showToast('✓ Guardado en el Depósito');
    else showToast('Error: ' + (d.error || 'desconocido'), 'error');
  };
  window.addEventListener('message', onReply);
  // Timeout de seguridad
  setTimeout(() => {
    window.removeEventListener('message', onReply);
    if (saveBtn.disabled) {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Guardar URL actual al Depósito';
      showToast('Timeout — probá de nuevo', 'error');
    }
  }, 15000);

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'explorer-save-to-deposit',
      reqId,
      url,
      title,
      categoryId: categorySelect.value || null,
      workspaceId: WS_ID || null
    }, '*');
  }
});

// ===== Recibir lista de categorías del parent =====
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d) return;
  if (d.type === 'explorer-categories' && Array.isArray(d.categories)) {
    const current = categorySelect.value;
    categorySelect.innerHTML = '<option value="">Sin categoría — General</option>' +
      d.categories.map(c => `<option value="${c.id}">${(c.icon || '📁') + ' ' + (c.name || '(sin nombre)')}</option>`).join('');
    if (current) categorySelect.value = current;
  }
});

// Pedir categorías al parent al cargar
function requestCategories() {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'explorer-request-categories', workspaceId: WS_ID || null }, '*');
  }
}
requestCategories();

// Inicializar URL bar
setTimeout(syncUrlBar, 500);
