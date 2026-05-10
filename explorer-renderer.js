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

  // ===== Categorías + subcategorías (v3.11.4) =====
  // Render jerárquico con <optgroup> — categorías padre como group label,
  // subcategorías como options dentro. Value format: "catId|subId" o "catId"
  // para "toda la categoría" (sin subcategoría específica).
  let categoriesLoaded = false;
  let _allCats = [];
  function escAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function buildCategoryOptions(cats) {
    // Top-level: parentId vacío/null. Subcategorías: parentId = id del padre.
    const tops = cats.filter(c => !c.parentId).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const subsByParent = {};
    cats.filter(c => c.parentId).forEach(c => {
      if (!subsByParent[c.parentId]) subsByParent[c.parentId] = [];
      subsByParent[c.parentId].push(c);
    });
    Object.values(subsByParent).forEach(arr => arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')));

    const html = ['<option value="">Sin categoría — General</option>'];
    tops.forEach(top => {
      const subs = subsByParent[top.id] || [];
      const topLabel = (top.icon || '📁') + ' ' + (top.name || '(sin nombre)');
      if (subs.length === 0) {
        html.push(`<option value="${escAttr(top.id)}">${escHtml(topLabel)}</option>`);
      } else {
        html.push(`<optgroup label="${escAttr(topLabel)}">`);
        // Opción "toda la categoría" — sin subcategoría específica
        html.push(`<option value="${escAttr(top.id)}">${escHtml('— toda ' + (top.name || ''))}</option>`);
        subs.forEach(s => {
          const sLabel = (s.icon || '↳') + ' ' + (s.name || '');
          html.push(`<option value="${escAttr(top.id)}|${escAttr(s.id)}">${escHtml(sLabel)}</option>`);
        });
        html.push('</optgroup>');
      }
    });
    return html.join('');
  }
  window._explorerLoadCategories = async function() {
    if (categoriesLoaded) return;
    if (typeof db === 'undefined') return;
    try {
      const snap = await db.collection('depositCategories').orderBy('name').get();
      _allCats = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      const current = categorySelect.value;
      categorySelect.innerHTML = buildCategoryOptions(_allCats);
      if (current) categorySelect.value = current;
      categoriesLoaded = true;
    } catch (e) {
      console.warn('[explorer] failed to load categories', e);
    }
  };
  // Permitir refresh manual desde fuera (ej: workspace switch)
  window._explorerReloadCategories = function() {
    categoriesLoaded = false;
    return window._explorerLoadCategories();
  };

  // ===== Extraer datos de la página actual del webview =====
  // En lugar de depender solo de fetchOgData (que falla cuando IG pide login
  // o tiene throttling), leemos el DOM ya renderizado del webview — el usuario
  // está logueado dentro del webview, todos los datos están disponibles.
  async function extractPageData() {
    if (!webviewReady) return null;
    try {
      const script = `
        (() => {
          function meta(prop) {
            const el = document.querySelector('meta[property="' + prop + '"]') ||
                       document.querySelector('meta[name="' + prop + '"]');
            return el ? (el.content || '') : '';
          }
          const ogImage = meta('og:image') || meta('twitter:image') || meta('og:image:secure_url');
          const ogDescription = meta('og:description') || meta('description') || meta('twitter:description');
          const ogTitle = meta('og:title') || meta('twitter:title');
          // Look for the largest visible image in the article — IG renders the
          // post photo as <img> inside <article>.
          let domImage = '';
          try {
            const article = document.querySelector('article') || document.body;
            const imgs = Array.from(article.querySelectorAll('img'));
            // Excluir avatares chicos. Quedarnos con la imagen más grande visible.
            const candidates = imgs.filter(i => {
              const r = i.getBoundingClientRect();
              return r.width > 200 && r.height > 200 && i.src && !i.src.startsWith('data:');
            }).sort((a, b) => {
              const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
              return (rb.width * rb.height) - (ra.width * ra.height);
            });
            if (candidates.length > 0) domImage = candidates[0].src;
          } catch (e) {}
          let videoPoster = '';
          try {
            const v = document.querySelector('video');
            if (v && v.poster) videoPoster = v.poster;
            else if (v && v.getAttribute('poster')) videoPoster = v.getAttribute('poster');
          } catch (e) {}
          // Carousel detection: Instagram IG posts con varias slides tienen
          // botones "Next" o paginación con dots. Buscar señales heurísticas.
          let isCarousel = false;
          try {
            const ariaLabels = Array.from(document.querySelectorAll('[aria-label]')).map(el => (el.getAttribute('aria-label') || '').toLowerCase());
            isCarousel = ariaLabels.some(l => l.includes('siguiente') || l.includes('next') || l.includes('go to slide') || l.includes('ir a la diapositiva'));
            // También: si hay más de 1 ul role="tablist" o dots de paginación
            if (!isCarousel) {
              const dots = document.querySelectorAll('[role="tablist"] > *, ul[role="presentation"] > li');
              if (dots && dots.length > 1) isCarousel = true;
            }
          } catch (e) {}
          // Caption: h1 dentro del article (IG) o og:description
          let caption = '';
          try {
            const h1 = document.querySelector('article h1') || document.querySelector('h1');
            if (h1 && h1.textContent) caption = h1.textContent.trim();
          } catch (e) {}
          if (!caption) caption = ogDescription || '';
          return {
            url: location.href,
            image: ogImage || videoPoster || domImage || '',
            title: (ogTitle || document.title || '').trim(),
            description: caption.trim().slice(0, 2000),
            ogDescription: (ogDescription || '').trim(),
            isCarousel
          };
        })();
      `;
      const data = await browser.executeJavaScript(script, false);
      return data || null;
    } catch (e) {
      console.warn('[explorer] extractPageData failed', e);
      return null;
    }
  }

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
    saveBtn.textContent = '⏳ Extrayendo datos...';

    try {
      // 1) Correr en PARALELO: fetchOgData (Microlink server-side, mejor cover)
      //    Y extractPageData (DOM del webview, mejor caption porque user logueado).
      //    Mergeamos los resultados después.
      const [ogResult, pageResult] = await Promise.allSettled([
        (window.api && window.api.fetchOgData) ? window.api.fetchOgData(url) : Promise.resolve(null),
        extractPageData()
      ]);
      const og = ogResult.status === 'fulfilled' ? ogResult.value : null;
      const pageData = pageResult.status === 'fulfilled' ? pageResult.value : null;
      saveBtn.textContent = '⏳ Guardando...';

      const lower = url.toLowerCase();
      const isReel = /instagram\.com\/(reel|reels)\//.test(lower);
      const isTikTokVideo = /tiktok\.com\/.+\/video\//.test(lower) || /tiktok\.com\/v\//.test(lower);
      const isYouTubeShort = /youtube\.com\/shorts/.test(lower);
      const isYouTubeWatch = /youtube\.com\/watch|youtu\.be\//.test(lower);
      const isIGPost = /instagram\.com\/p\//.test(lower);
      const isVideo = isReel || isTikTokVideo || isYouTubeShort || isYouTubeWatch || isIGPost;
      // /p/ posts en IG pueden ser carrusel (1+ slides). Detectamos heurísticamente
      // por el DOM — si vemos paginación de carrusel, lo marcamos.
      let linkType = isVideo ? 'video' : 'material';
      if (isIGPost && pageData && pageData.isCarousel) linkType = 'carrusel';

      function cleanPageTitle(t) {
        if (!t) return '';
        return t.replace(/\s*[•|·\-—]\s*(Instagram|TikTok|YouTube|Facebook|X|Twitter)\s*$/i, '').trim();
      }
      // Title: og (server-side) primero, después pageData, después browser.getTitle()
      let finalTitle = cleanPageTitle(og && og.title) ||
                       cleanPageTitle(pageData && pageData.title) ||
                       cleanPageTitle(title) ||
                       (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'Referencia'; } })();
      const description = (pageData && pageData.description) || (og && og.description) || '';
      if (/^(instagram|tiktok|youtube|\(\d+\)\s*instagram)$/i.test(finalTitle.trim()) && description) {
        const firstLine = description.split('\n')[0].slice(0, 120);
        if (firstLine) finalTitle = firstLine;
      }

      // Cover image: og.image (server-side via Microlink) PRIMERO, después pageData.image
      // (DOM del webview), después capturePage screenshot del webview como último recurso.
      let coverImage = (og && og.image) || (pageData && pageData.image) || '';
      if (!coverImage && webviewReady) {
        try {
          const native = await browser.capturePage();
          if (native && typeof native.toDataURL === 'function') {
            // Convertir a JPEG comprimido para no inflar Firestore
            const jpeg = native.resize ? native.resize({ width: 720, quality: 'good' }) : native;
            coverImage = (jpeg.toDataURL ? jpeg.toDataURL() : native.toDataURL()).replace('image/png', 'image/jpeg');
          }
        } catch (e) { console.warn('[explorer] capturePage failed', e); }
      }

      const rawValue = categorySelect.value || '';
      let categoryId = null, subcategoryId = null;
      if (rawValue) {
        const parts = rawValue.split('|');
        categoryId = parts[0] || null;
        subcategoryId = parts[1] || null;
      }

      const data = {
        title: finalTitle.slice(0, 200),
        description: description.slice(0, 2000),
        links: [{ type: linkType, url, label: linkType === 'video' ? 'Video' : (linkType === 'carrusel' ? 'Carrusel' : 'Material') }],
        categoryId,
        status: 'idea',
        createdBy: currentUser.uid,
        createdByName: (typeof currentUserData !== 'undefined' && currentUserData ? currentUserData.name : null) || (currentUser.email || '').split('@')[0],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (coverImage) {
        data.coverImage = coverImage;
        data.coverFetcherV = 6;
      }
      if (categoryId) {
        const cat = _allCats.find(c => c.id === categoryId);
        if (cat) data.categoryName = cat.name || '';
      }
      if (subcategoryId) {
        const sub = _allCats.find(c => c.id === subcategoryId);
        if (sub) {
          data.subcategoryId = subcategoryId;
          data.subcategoryName = sub.name || '';
        }
      }
      await db.collection('depositEntries').add(data);

      const summary = [];
      if (coverImage) summary.push('portada');
      if (description) summary.push('caption');
      const detail = summary.length ? ` (con ${summary.join(' + ')})` : '';
      showToast('✓ Guardado como ' + linkType + detail);
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
