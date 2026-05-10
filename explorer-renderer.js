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
          // Detectar si hay un <video> en el article — si lo hay, ES VIDEO,
          // independiente de la URL. Esto evita el falso positivo donde un
          // reel /p/ se detecta como carrusel por el flecha "Next" del feed.
          let hasVideo = false;
          try {
            hasVideo = !!(document.querySelector('article video') || document.querySelector('video'));
          } catch (e) {}

          // ===== Detectar el URL del reel/post ESPECÍFICO al que estás mirando.
          // Si estás en /explore/ o /reels/ (feed), location.href es genérico;
          // pero el reel específico que está en pantalla tiene un <a> con su URL.
          // Estrategia: tomar el video más visible/grande, subir por el DOM hasta
          // encontrar un <a href="/reel/...">, y usar esa URL en vez de location.href.
          let detectedUrl = '';
          let detectedPoster = '';
          try {
            const allVideos = Array.from(document.querySelectorAll('video'));
            // Prefer playing video, sino el más grande visible
            let primary = allVideos.find(v => !v.paused && v.currentTime > 0);
            if (!primary) {
              const visible = allVideos.filter(v => {
                const r = v.getBoundingClientRect();
                return r.width > 100 && r.height > 100 && r.top < window.innerHeight && r.bottom > 0;
              }).sort((a, b) => {
                const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
                return (rb.width * rb.height) - (ra.width * ra.height);
              });
              primary = visible[0];
            }
            if (primary) {
              if (primary.poster) detectedPoster = primary.poster;
              // Walk up para encontrar <a> con /reel/ o /p/ en el href
              let el = primary;
              while (el && el !== document.body) {
                if (el.tagName === 'A' && el.href && /\/(reel|reels|p|tv)\//.test(el.href)) {
                  detectedUrl = el.href;
                  break;
                }
                el = el.parentElement;
              }
              // Si no, buscar el primer <a> /reel/|/p/ DESCENDIENTE del padre cercano
              if (!detectedUrl) {
                const containers = [primary.closest('article'), primary.closest('[role="presentation"]'), primary.closest('div[class*="x"]')].filter(Boolean);
                for (const c of containers) {
                  const a = c.querySelector('a[href*="/reel/"], a[href*="/reels/"], a[href*="/p/"]');
                  if (a && a.href) { detectedUrl = a.href; break; }
                }
              }
            }
          } catch (e) {}
          // Carousel detection: SOLO si NO hay video Y hay señales claras de
          // múltiples slides. Buscamos aria-labels específicas de "go to slide N".
          let isCarousel = false;
          try {
            if (!hasVideo) {
              const labels = Array.from(document.querySelectorAll('[aria-label]')).map(el => (el.getAttribute('aria-label') || '').toLowerCase());
              isCarousel = labels.some(l => /^(go to|ir a la? )?slide\s+\d+/i.test(l) || /^diapositiva\s+\d+/i.test(l));
              if (!isCarousel) {
                // Dots de paginación dentro de article
                const article = document.querySelector('article');
                if (article) {
                  const dots = article.querySelectorAll('[role="tablist"] [role="tab"], ul[role="presentation"] > li');
                  if (dots && dots.length > 1) isCarousel = true;
                }
              }
            }
          } catch (e) {}
          // Caption: h1 dentro del article (IG) o og:description
          let caption = '';
          try {
            const h1 = document.querySelector('article h1') || document.querySelector('h1');
            if (h1 && h1.textContent) caption = h1.textContent.trim();
          } catch (e) {}
          if (!caption) caption = ogDescription || '';
          // URL final: si detectamos un reel específico, usar ESA en vez de
          // location.href (que puede ser /explore/ genérico).
          const finalUrl = detectedUrl || location.href;
          // Si detectamos un poster del primary video, preferirlo sobre el og:image
          // genérico de la página (especialmente útil en feeds con varios reels).
          const finalImage = detectedPoster || videoPoster || ogImage || domImage || '';
          return {
            url: finalUrl,
            originalPageUrl: location.href,
            image: finalImage,
            title: (ogTitle || document.title || '').trim(),
            description: caption.trim().slice(0, 2000),
            ogDescription: (ogDescription || '').trim(),
            hasVideo,
            isCarousel,
            detectedReelUrl: detectedUrl
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
    saveBtn.textContent = '⏳ Detectando reel...';

    try {
      // 1) Primero extraer del DOM — esto nos da la URL ESPECÍFICA del reel
      // que el usuario está viendo (incluso si la URL del browser es genérica
      // como /explore/ o /reels/).
      const pageData = await extractPageData();
      // Si encontramos un reel específico en el DOM, usar ESA URL para todo.
      const targetUrl = (pageData && pageData.url && /\/(reel|reels|p|tv)\//.test(pageData.url))
        ? pageData.url
        : url;
      const usingDetectedReel = targetUrl !== url;

      saveBtn.textContent = '⏳ Buscando portada...';
      // 2) Microlink en background sobre la URL específica del reel
      const og = await ((window.api && window.api.fetchOgData)
        ? window.api.fetchOgData(targetUrl).catch(() => null)
        : Promise.resolve(null));
      saveBtn.textContent = '⏳ Guardando...';

      const lower = targetUrl.toLowerCase();
      const isReel = /instagram\.com\/(reel|reels)\//.test(lower);
      const isTikTokVideo = /tiktok\.com\/.+\/video\//.test(lower) || /tiktok\.com\/v\//.test(lower);
      const isYouTubeShort = /youtube\.com\/shorts/.test(lower);
      const isYouTubeWatch = /youtube\.com\/watch|youtu\.be\//.test(lower);
      const isIGPost = /instagram\.com\/p\//.test(lower);

      // ===== Detección de tipo (Auto) =====
      // Prioridad: 1) override manual del usuario, 2) URL específica de reel/short,
      // 3) presencia de <video> en el DOM, 4) signals de carrusel, 5) URL /p/ default.
      const typeSelect = document.getElementById('explorerTypeSelect');
      const manualType = typeSelect ? typeSelect.value : 'auto';
      let linkType;
      if (manualType !== 'auto') {
        linkType = manualType;
      } else if (isReel || isTikTokVideo || isYouTubeShort || isYouTubeWatch) {
        linkType = 'video';
      } else if (pageData && pageData.hasVideo) {
        linkType = 'video';
      } else if (pageData && pageData.isCarousel) {
        linkType = 'carrusel';
      } else if (isIGPost) {
        // /p/ por defecto: si llegamos acá y NO hay video ni carrusel detectable,
        // lo marcamos como carrusel (típico cuando es post con 1 imagen es 'video'
        // técnicamente pero IG pone /p/ para todo). Dejamos 'video' como mejor default.
        linkType = 'video';
      } else {
        linkType = 'material';
      }

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
      let coverSource = '';
      if (coverImage) {
        if (og && og.image && og.image === coverImage) coverSource = 'microlink';
        else coverSource = 'webview-dom';
      }
      if (!coverImage && webviewReady) {
        try {
          const native = await browser.capturePage();
          if (native && typeof native.toDataURL === 'function') {
            const resized = (native.resize && !native.isEmpty()) ? native.resize({ width: 720 }) : native;
            // toJPEG devuelve Buffer (Uint8Array); convertir a base64 en el navegador
            // sin depender de Buffer global (que puede no estar con contextIsolation).
            if (typeof resized.toJPEG === 'function') {
              try {
                const buf = resized.toJPEG(75);
                if (buf && buf.length > 0) {
                  const bytes = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
                  let binary = '';
                  // chunks para evitar stack overflow en imágenes grandes
                  const CHUNK = 0x8000;
                  for (let i = 0; i < bytes.length; i += CHUNK) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
                  }
                  coverImage = 'data:image/jpeg;base64,' + btoa(binary);
                  coverSource = 'screenshot-jpeg';
                }
              } catch (e) { console.warn('[explorer] toJPEG failed', e); }
            }
            // Fallback PNG vía toDataURL si JPEG no funcionó
            if (!coverImage) {
              coverImage = resized.toDataURL();
              coverSource = 'screenshot-png';
            }
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
        links: [{ type: linkType, url: targetUrl, label: linkType === 'video' ? 'Video' : (linkType === 'carrusel' ? 'Carrusel' : 'Material') }],
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
      if (coverImage) summary.push('portada=' + (coverSource || 'sí'));
      if (description) summary.push('caption');
      if (usingDetectedReel) summary.push('reel detectado');
      const detail = summary.length ? ` (${summary.join(', ')})` : '';
      showToast('✓ ' + linkType + detail);
      // Reset al "Auto" para el próximo guardado
      const ts = document.getElementById('explorerTypeSelect');
      if (ts) ts.value = 'auto';
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
