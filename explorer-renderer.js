// Explorer (v3.11.2) — corre directamente en el renderer principal de index.html.
// Tiene acceso directo a db, currentUser, y el resto del estado global (no necesita
// postMessage ni iframes). Webview tag funciona porque webviewTag=true en el
// BrowserWindow principal.

(function setupExplorer() {
  const browser = document.getElementById('explorerBrowser');
  if (!browser) return;
  const urlBar = document.getElementById('explorerUrlBar');
  const loadingBar = document.getElementById('explorerLoadingBar');
  const categorySelect = document.getElementById('explorerCategorySelect');
  const toastEl = document.getElementById('explorerToast');
  const saveBtn = document.getElementById('explorerSaveToDeposit');

  function showToast(msg, kind) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', kind === 'error');
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2500);
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
    try {
      const p = browser.loadURL(targetUrl);
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          console.warn('[explorer] loadURL failed', err);
          try { browser.setAttribute('src', targetUrl); }
          catch (e) { showToast('Error: ' + e.message, 'error'); }
        });
      }
    } catch (e) {
      console.warn('[explorer] loadURL threw', e);
      try { browser.setAttribute('src', targetUrl); }
      catch (e2) { showToast('Error: ' + e2.message, 'error'); }
    }
  }

  browser.addEventListener('dom-ready', () => {
    webviewReady = true;
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
    if (ev.errorCode === -3) return; // ABORTED es normal cuando se inicia otra navegación
    console.warn('[explorer] did-fail-load', ev.errorCode, ev.errorDescription, ev.validatedURL);
    showToast(`Error ${ev.errorCode}: ${ev.errorDescription || 'No se pudo cargar'}`, 'error');
  });
  function syncUrlBar() {
    try { urlBar.value = browser.getURL(); } catch (e) {}
  }
  browser.addEventListener('did-navigate', syncUrlBar);
  browser.addEventListener('did-navigate-in-page', syncUrlBar);
  browser.addEventListener('did-finish-load', syncUrlBar);

  document.getElementById('explorerBack').addEventListener('click', () => {
    try { if (browser.canGoBack()) browser.goBack(); } catch (e) {}
  });
  document.getElementById('explorerForward').addEventListener('click', () => {
    try { if (browser.canGoForward()) browser.goForward(); } catch (e) {}
  });
  document.getElementById('explorerReload').addEventListener('click', () => {
    try { browser.reload(); } catch (e) {}
  });
  document.getElementById('explorerGo').addEventListener('click', () => {
    const u = (urlBar.value || '').trim();
    if (!u) return;
    navigate(u);
  });
  urlBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('explorerGo').click();
  });

  document.querySelectorAll('[data-explorer-quick]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.explorerQuick));
  });

  // ===== Categorías =====
  // Las categorías de depósito se cargan al primer abrir la pestaña Explorer.
  // Llamamos a esto desde el handler de la pestaña en renderer.js.
  let categoriesLoaded = false;
  window._explorerLoadCategories = async function() {
    if (categoriesLoaded) return;
    if (typeof db === 'undefined') return;
    try {
      const snap = await db.collection('depositCategories').orderBy('name').get();
      const cats = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      const current = categorySelect.value;
      categorySelect.innerHTML = '<option value="">Sin categoría — General</option>' +
        cats.map(c => `<option value="${c.id}">${(c.icon || '📁') + ' ' + (c.name || '(sin nombre)')}</option>`).join('');
      if (current) categorySelect.value = current;
      categoriesLoaded = true;
    } catch (e) {
      console.warn('[explorer] failed to load categories', e);
    }
  };

  // ===== Save to Deposit =====
  saveBtn.addEventListener('click', async () => {
    if (typeof currentUser === 'undefined' || !currentUser) {
      showToast('No estás logueado', 'error');
      return;
    }
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
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Guardando...';

    try {
      const lower = url.toLowerCase();
      const isVideo = /instagram\.com\/(reel|p|tv)\/|tiktok\.com\/.+\/video\/|youtube\.com\/(shorts|watch)|youtu\.be\//.test(lower);
      const linkType = isVideo ? 'video' : 'material';
      const cleanTitle = (title || '').trim() || (() => {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'Referencia'; }
      })();
      const data = {
        title: cleanTitle.slice(0, 200),
        description: '',
        links: [{ type: linkType, url, label: linkType === 'video' ? 'Video' : 'Material' }],
        categoryId: categorySelect.value || null,
        status: 'idea',
        createdBy: currentUser.uid,
        createdByName: (typeof currentUserData !== 'undefined' && currentUserData ? currentUserData.name : null) || (currentUser.email || '').split('@')[0],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (categorySelect.value) {
        try {
          const cs = await db.collection('depositCategories').doc(categorySelect.value).get();
          if (cs.exists) data.categoryName = cs.data().name || '';
        } catch (e) {}
      }
      const ref = await db.collection('depositEntries').add(data);
      // Best-effort: fetch OG metadata para la cover (no esperar)
      if (window.api && window.api.fetchOgData) {
        window.api.fetchOgData(url).then(og => {
          if (og && (og.image || og.title || og.description)) {
            const upd = { coverFetcherV: 6 };
            if (og.image) upd.coverImage = og.image;
            if (og.title && !data.title) upd.title = og.title.slice(0, 200);
            if (og.description) upd.description = og.description.slice(0, 500);
            db.collection('depositEntries').doc(ref.id).update(upd).catch(() => {});
          }
        }).catch(() => {});
      }
      showToast('✓ Guardado en el Depósito');
    } catch (e) {
      console.error('[explorer] save failed', e);
      showToast('Error: ' + (e.message || 'desconocido'), 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Guardar URL actual al Depósito';
    }
  });

  // Inicializar URL bar (después de un momento)
  setTimeout(syncUrlBar, 500);
})();
