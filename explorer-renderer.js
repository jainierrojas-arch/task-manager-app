// Explorer (v3.11.9) — multi-tab + sidebar lateral.
// Cada tab es su propio <webview> stackeado en el browser-wrap; solo el
// activo se muestra. Toolbar a la izquierda libera todo el ancho horizontal
// para el webview.

(function setupExplorer() {
  const browserWrap = document.getElementById('explorerBrowserWrap');
  if (!browserWrap) return;
  const tabsBar = document.getElementById('explorerTabs');
  const addTabBtn = document.getElementById('explorerAddTab');
  const urlBar = document.getElementById('explorerUrlBar');
  const loadingBar = document.getElementById('explorerLoadingBar');
  const categorySelect = document.getElementById('explorerCategorySelect');
  const toastEl = document.getElementById('explorerToast');
  const saveBtn = document.getElementById('explorerSaveToDeposit');

  // ===== State =====
  // Cada tab: { id, title, webview, ready, active }
  const tabs = [];
  let activeTabId = null;
  let nextTabId = 1;

  function showToast(msg, kind) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', kind === 'error');
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  function escAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

  // ===== Tab management =====
  function getActiveTab() {
    return tabs.find(t => t.id === activeTabId) || null;
  }
  function getActiveBrowser() {
    const t = getActiveTab();
    return t ? t.webview : null;
  }

  function createTab(initialUrl) {
    const id = nextTabId++;
    const webview = document.createElement('webview');
    webview.setAttribute('src', initialUrl || 'https://www.google.com/');
    webview.setAttribute('partition', 'persist:explorer');
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('useragent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    webview.dataset.tabId = String(id);
    browserWrap.appendChild(webview);

    const tab = { id, title: 'Cargando...', webview, ready: false };
    tabs.push(tab);
    setupWebviewEvents(tab);
    renderTabs();
    switchTab(id);
    return tab;
  }

  function switchTab(id) {
    activeTabId = id;
    tabs.forEach(t => {
      t.webview.classList.toggle('active', t.id === id);
    });
    renderTabs();
    syncUrlBar();
  }

  function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];
    try { tab.webview.remove(); } catch (e) {}
    tabs.splice(idx, 1);
    if (tabs.length === 0) {
      // No dejar nunca cero tabs — abrir uno nuevo de Google
      createTab('https://www.google.com/');
      return;
    }
    if (activeTabId === id) {
      // Activar el siguiente (o el último si era el último)
      const newActive = tabs[Math.min(idx, tabs.length - 1)];
      switchTab(newActive.id);
    } else {
      renderTabs();
    }
  }

  function renderTabs() {
    if (!tabsBar) return;
    tabsBar.innerHTML = tabs.map(t => `
      <div class="explorer-tab ${t.id === activeTabId ? 'active' : ''}" data-tab-id="${t.id}" title="${escAttr(t.title)}">
        <span class="explorer-tab-title">${escHtml(t.title || 'Pestaña')}</span>
        <button class="explorer-tab-close" data-tab-close="${t.id}" title="Cerrar">×</button>
      </div>
    `).join('');
    tabsBar.querySelectorAll('.explorer-tab').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-tab-close]')) return;
        switchTab(parseInt(el.dataset.tabId, 10));
      });
    });
    tabsBar.querySelectorAll('[data-tab-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(parseInt(btn.dataset.tabClose, 10));
      });
    });
  }

  function setupWebviewEvents(tab) {
    const w = tab.webview;
    w.addEventListener('dom-ready', () => {
      tab.ready = true;
      if (tab.id === activeTabId) syncUrlBar();
    });
    w.addEventListener('did-start-loading', () => {
      if (tab.id === activeTabId) {
        loadingBar.classList.remove('done');
        loadingBar.classList.add('active');
      }
    });
    w.addEventListener('did-stop-loading', () => {
      if (tab.id === activeTabId) {
        loadingBar.classList.remove('active');
        loadingBar.classList.add('done');
        setTimeout(() => loadingBar.classList.remove('done'), 600);
      }
    });
    w.addEventListener('did-fail-load', (ev) => {
      if (ev.errorCode === -3) return;
      console.warn('[explorer] did-fail-load', ev.errorCode, ev.errorDescription);
      if (tab.id === activeTabId) showToast(`Error ${ev.errorCode}: ${ev.errorDescription || 'No se pudo cargar'}`, 'error');
    });
    w.addEventListener('page-title-updated', (ev) => {
      tab.title = (ev.title || '').slice(0, 40) || 'Pestaña';
      renderTabs();
    });
    w.addEventListener('did-navigate', () => {
      if (tab.id === activeTabId) syncUrlBar();
    });
    w.addEventListener('did-navigate-in-page', () => {
      if (tab.id === activeTabId) syncUrlBar();
    });
    w.addEventListener('did-finish-load', () => {
      if (tab.id === activeTabId) syncUrlBar();
    });
  }

  function syncUrlBar() {
    const browser = getActiveBrowser();
    if (browser) {
      try { urlBar.value = browser.getURL(); } catch (e) {}
    }
  }

  // ===== Navigation helpers =====
  function navigate(targetUrl) {
    if (!targetUrl) return;
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
    const browser = getActiveBrowser();
    if (!browser) return;
    if (!browser.isReady && !getActiveTab().ready) {
      // Si todavía no está dom-ready, setear el src directamente
      try { browser.setAttribute('src', targetUrl); } catch (e) {}
      return;
    }
    try {
      const p = browser.loadURL(targetUrl);
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          try { browser.setAttribute('src', targetUrl); } catch (e) {}
        });
      }
    } catch (e) {
      try { browser.setAttribute('src', targetUrl); }
      catch (e2) { showToast('Error: ' + e2.message, 'error'); }
    }
  }

  document.getElementById('explorerBack').addEventListener('click', () => {
    const b = getActiveBrowser();
    try { if (b && b.canGoBack()) b.goBack(); } catch (e) {}
  });
  document.getElementById('explorerForward').addEventListener('click', () => {
    const b = getActiveBrowser();
    try { if (b && b.canGoForward()) b.goForward(); } catch (e) {}
  });
  document.getElementById('explorerReload').addEventListener('click', () => {
    const b = getActiveBrowser();
    try { if (b) b.reload(); } catch (e) {}
  });
  document.getElementById('explorerGo').addEventListener('click', () => {
    const u = (urlBar.value || '').trim();
    if (u) navigate(u);
  });
  urlBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('explorerGo').click();
  });
  document.querySelectorAll('[data-explorer-quick]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.explorerQuick));
  });
  addTabBtn.addEventListener('click', () => createTab('https://www.google.com/'));

  // v3.11.129: abrir la URL actual en el Chrome / navegador del sistema.
  // Útil para login de Google (que bloquea webviews embebidos) o pagar
  // subscripciones, OAuth, etc.
  const openSystemBtn = document.getElementById('explorerOpenSystem');
  if (openSystemBtn) {
    openSystemBtn.addEventListener('click', () => {
      const b = getActiveBrowser();
      let u = '';
      try { u = b ? b.getURL() : (urlBar.value || '').trim(); } catch (_) { u = (urlBar.value || '').trim(); }
      if (!u || !/^https?:/i.test(u)) {
        showToast('URL inválida', 'error');
        return;
      }
      try {
        if (window.api && window.api.openExternal) {
          window.api.openExternal(u);
          showToast('Abriendo en Chrome del sistema...');
        } else {
          window.open(u, '_blank', 'noopener');
        }
      } catch (e) {
        console.warn('[explorer] openExternal failed', e.message);
        try { window.open(u, '_blank', 'noopener'); } catch (_) {}
      }
    });
  }

  // ===== Categorías + subcategorías =====
  let categoriesLoaded = false;
  let _allCats = [];
  function buildCategoryOptions(cats) {
    const tops = cats.filter(c => !c.parentId).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const subsByParent = {};
    cats.filter(c => c.parentId).forEach(c => {
      if (!subsByParent[c.parentId]) subsByParent[c.parentId] = [];
      subsByParent[c.parentId].push(c);
    });
    Object.values(subsByParent).forEach(arr => arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')));

    const html = ['<option value="">Sin categoría</option>'];
    tops.forEach(top => {
      const subs = subsByParent[top.id] || [];
      const topLabel = (top.icon || '📁') + ' ' + (top.name || '(sin nombre)');
      if (subs.length === 0) {
        html.push(`<option value="${escAttr(top.id)}">${escHtml(topLabel)}</option>`);
      } else {
        html.push(`<optgroup label="${escAttr(topLabel)}">`);
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
  window._explorerReloadCategories = function() {
    categoriesLoaded = false;
    return window._explorerLoadCategories();
  };

  // ===== Page data extraction (igual que antes pero contra el active webview) =====
  // Timeout helper para no colgar la app si el webview no responde
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout: ' + label + ' tardó más de ' + ms + 'ms')), ms))
    ]);
  }
  // ===== Fetch reel HTML from inside the webview (uses authenticated session) =====
  // Cuando detectamos una URL específica de reel (ej via img walk-up), pero el
  // DOM actual no tiene la caption (porque estamos en /explore/, no abrimos el
  // reel), hacemos un fetch desde adentro del webview. La fetch desde el webview
  // usa SUS cookies (estás logueado en IG), bypasses CORS porque es same-origin
  // (instagram.com → instagram.com), y devuelve el HTML real del reel con meta
  // tags llenos.
  async function fetchUrlHtmlMeta(targetUrl) {
    const browser = getActiveBrowser();
    if (!browser) return null;
    try {
      const script = `
        (async () => {
          try {
            const res = await fetch(${JSON.stringify(targetUrl)}, { credentials: 'include' });
            if (!res.ok) return null;
            const html = await res.text();
            // Helper: encuentra el <meta> tag completo donde uno de sus atributos
            // es property|name="<prop>", después extrae el atributo content.
            // Order-independent: maneja cuando content viene antes de property.
            function meta(prop) {
              const escaped = prop.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
              // Match cualquier <meta ...> que tenga (property|name)="prop" en cualquier
              // posición de los atributos.
              const tagRe = new RegExp('<meta\\\\s+[^>]*?(?:property|name)=["\\']' + escaped + '["\\'][^>]*>', 'i');
              const tag = html.match(tagRe);
              if (!tag) return '';
              const contentRe = /content=["']([^"']*)["']/i;
              const m = tag[0].match(contentRe);
              return m ? m[1] : '';
            }
            // <link rel="image_src" href="..."> también es usado por algunos sitios
            function linkImageSrc() {
              const re = /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i;
              const m = html.match(re);
              if (m) return m[1];
              const re2 = /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i;
              const m2 = html.match(re2);
              return m2 ? m2[1] : '';
            }
            function decode(s) {
              if (!s) return '';
              return s.replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&quot;/g, '"')
                      .replace(/&#039;/g, "'")
                      .replace(/&#39;/g, "'")
                      .replace(/&#x27;/g, "'")
                      .replace(/&apos;/g, "'");
            }
            const image = decode(
              meta('og:image:secure_url') ||
              meta('og:image') ||
              meta('twitter:image:src') ||
              meta('twitter:image') ||
              linkImageSrc()
            );
            const title = decode(meta('og:title') || meta('twitter:title'));
            const description = decode(meta('og:description') || meta('twitter:description') || meta('description'));
            return { image, title, description };
          } catch (e) { return null; }
        })()
      `;
      const data = await withTimeout(browser.executeJavaScript(script, false), 8000, 'fetchUrlHtmlMeta');
      return data || null;
    } catch (e) {
      console.warn('[explorer] fetchUrlHtmlMeta failed', e.message);
      return null;
    }
  }

  async function extractPageData() {
    const browser = getActiveBrowser();
    if (!browser) return null;
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
          let domImage = '';
          try {
            const article = document.querySelector('article') || document.body;
            const imgs = Array.from(article.querySelectorAll('img'));
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
          let hasVideo = false;
          try { hasVideo = !!(document.querySelector('article video') || document.querySelector('video')); } catch (e) {}
          let isCarousel = false;
          try {
            if (!hasVideo) {
              const labels = Array.from(document.querySelectorAll('[aria-label]')).map(el => (el.getAttribute('aria-label') || '').toLowerCase());
              isCarousel = labels.some(l => /^(go to|ir a la? )?slide\\s+\\d+/i.test(l) || /^diapositiva\\s+\\d+/i.test(l));
              if (!isCarousel) {
                const article = document.querySelector('article');
                if (article) {
                  const dots = article.querySelectorAll('[role="tablist"] [role="tab"], ul[role="presentation"] > li');
                  if (dots && dots.length > 1) isCarousel = true;
                }
              }
            }
          } catch (e) {}
          let detectedUrl = '';
          let detectedPoster = '';
          try {
            const allVideos = Array.from(document.querySelectorAll('video'));
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
            // Si NO hay video visible (caso típico: feed /explore/ donde los reels
            // se muestran como <img> hasta que hacés hover/click), buscar la imagen
            // VISIBLE más cercana al centro del viewport — es la que el usuario está
            // mirando. Threshold bajo (100x100) para capturar thumbnails chicos.
            let primaryImg = null;
            if (!primary) {
              const imgs = Array.from(document.querySelectorAll('img'));
              const vpCenterY = window.innerHeight / 2;
              const visibleNotData = imgs.filter(i => {
                const r = i.getBoundingClientRect();
                return r.top < window.innerHeight && r.bottom > 0 && r.width > 0 && r.height > 0 &&
                       i.src && !i.src.startsWith('data:');
              });
              // Pasada 1: imágenes "grandes" (>= 200x200), priorizando centro del viewport
              let candidates = visibleNotData.filter(i => {
                const r = i.getBoundingClientRect();
                return r.width >= 200 && r.height >= 200;
              });
              // Pasada 2: si no hay grandes, bajar a 100x100
              if (candidates.length === 0) {
                candidates = visibleNotData.filter(i => {
                  const r = i.getBoundingClientRect();
                  return r.width >= 100 && r.height >= 100;
                });
              }
              // Pasada 3: si igual no hay, todas las visibles
              if (candidates.length === 0) candidates = visibleNotData.slice();
              candidates.sort((a, b) => {
                const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
                const da = Math.abs((ra.top + ra.bottom) / 2 - vpCenterY);
                const db = Math.abs((rb.top + rb.bottom) / 2 - vpCenterY);
                if (Math.abs(da - db) < 40) {
                  return (rb.width * rb.height) - (ra.width * ra.height);
                }
                return da - db;
              });
              primaryImg = candidates[0];
            }
            const primaryEl = primary || primaryImg;
            if (primaryEl) {
              if (primary && primary.poster) detectedPoster = primary.poster;
              else if (primaryImg && primaryImg.src) detectedPoster = primaryImg.src;
              // Walk up del DOM hasta encontrar <a href> que apunte a un reel/post
              // ESPECÍFICO (NO /reels/audio/ que es la página del audio).
              const RE_SPECIFIC_HREF = /\\/(?:(?:reel|p|tv)\\/[A-Za-z0-9_-]+|reels\\/(?!audio\\/)[A-Za-z0-9_-]+)/;
              let el = primaryEl;
              while (el && el !== document.body) {
                if (el.tagName === 'A' && el.href && RE_SPECIFIC_HREF.test(el.href)) {
                  detectedUrl = el.href; break;
                }
                el = el.parentElement;
              }
              // Fallback: buscar <a> hermanos/descendientes en containers cercanos
              if (!detectedUrl) {
                const containers = [primaryEl.closest('article'), primaryEl.closest('[role="presentation"]'), primaryEl.closest('div[class*="x"]')].filter(Boolean);
                for (const c of containers) {
                  const links = c.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"], a[href*="/p/"], a[href*="/tv/"]');
                  for (const a of links) {
                    if (a.href && RE_SPECIFIC_HREF.test(a.href)) {
                      detectedUrl = a.href; break;
                    }
                  }
                  if (detectedUrl) break;
                }
              }
            }
          } catch (e) {}
          let caption = '';
          try {
            const h1 = document.querySelector('article h1') || document.querySelector('h1');
            if (h1 && h1.textContent) caption = h1.textContent.trim();
          } catch (e) {}
          if (!caption) caption = ogDescription || '';
          const finalUrl = detectedUrl || location.href;
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
      // Timeout 6s — si el webview no responde, abortamos sin colgar la app
      const data = await withTimeout(browser.executeJavaScript(script, false), 6000, 'extractPageData');
      return data || null;
    } catch (e) {
      console.warn('[explorer] extractPageData failed', e.message);
      return null;
    }
  }

  // ===== Save to Deposit =====
  saveBtn.addEventListener('click', async () => {
    if (typeof currentUser === 'undefined' || !currentUser) {
      showToast('No estás logueado', 'error');
      return;
    }
    const browser = getActiveBrowser();
    if (!browser) { showToast('No hay pestaña activa', 'error'); return; }
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
    console.log('[explorer-save] START', { url, title });

    try {
      const pageData = await extractPageData();
      console.log('[explorer-save] pageData', pageData ? { hasUrl: !!pageData.url, hasImage: !!pageData.image, hasDescription: !!pageData.description, isCarousel: pageData.isCarousel, hasVideo: pageData.hasVideo } : 'NULL');
      // v3.11.17: detectar URLs específicas excluyendo /reels/audio/ (página del
      // audio, NO un reel específico — su og:image es la carátula del álbum/audio).
      // Acepta: /reel/CXXX/, /p/CXXX/, /tv/CXXX/, /reels/CXXX/ (NOT /reels/audio/CXXX/)
      const RE_SPECIFIC = /\/(?:(?:reel|p|tv)\/[A-Za-z0-9_-]+|reels\/(?!audio\/)[A-Za-z0-9_-]+)/;
      const targetUrl = (pageData && pageData.url && RE_SPECIFIC.test(pageData.url))
        ? pageData.url
        : url;
      const usingDetectedReel = targetUrl !== url;
      // Detectar si la URL final es genérica (feed/explore/home/audio page)
      const isGenericFeedUrl =
        /^https?:\/\/(www\.)?instagram\.com\/(explore|reels|reel)\/?(\?|#|$)/i.test(targetUrl) ||
        /^https?:\/\/(www\.)?instagram\.com\/reels\/audio\//i.test(targetUrl) ||
        /^https?:\/\/(www\.)?instagram\.com\/?(\?|#|$)/i.test(targetUrl) ||
        /^https?:\/\/(www\.)?tiktok\.com\/(foryou|explore|trending|music|sound)\/?(\?|#|$)/i.test(targetUrl) ||
        /^https?:\/\/(www\.)?tiktok\.com\/(music|sound)\//i.test(targetUrl) ||
        /^https?:\/\/(www\.)?tiktok\.com\/?(\?|#|$)/i.test(targetUrl) ||
        /^https?:\/\/(www\.)?youtube\.com\/(shorts|feed)\/?(\?|#|$)/i.test(targetUrl);

      saveBtn.textContent = '⏳ Buscando portada...';
      // Estrategia para URL específica:
      // 1) Fetch desde adentro del webview con cookies autenticadas (most reliable)
      // 2) Si falla, Microlink server-side (fetch-og-data)
      let og = null;
      if (!isGenericFeedUrl) {
        // 1) Same-domain fetch desde el webview (autenticado)
        try {
          const browserUrl = getActiveBrowser() ? getActiveBrowser().getURL() : '';
          // Solo si el target y el browser actual son del mismo dominio (CORS)
          const sameDomain = (() => {
            try {
              return new URL(browserUrl).hostname === new URL(targetUrl).hostname;
            } catch (e) { return false; }
          })();
          if (sameDomain) {
            og = await fetchUrlHtmlMeta(targetUrl);
          }
        } catch (e) { /* ignore */ }
        // 2) Fallback a Microlink si falta image O description
        if ((!og || !og.image || !og.description) && window.api && window.api.fetchOgData) {
          try {
            // v3.11.128: timeout subido a 20s para redes Windows lentas / VPNs corporativas
            console.log('[explorer-save] Microlink fetch start', targetUrl);
            const ogMicro = await withTimeout(window.api.fetchOgData(targetUrl), 20000, 'fetchOgData');
            console.log('[explorer-save] Microlink response', ogMicro ? { hasImage: !!ogMicro.image, hasTitle: !!ogMicro.title, hasDesc: !!ogMicro.description } : 'NULL');
            if (ogMicro) {
              og = {
                image: (og && og.image) || ogMicro.image,
                title: (og && og.title) || ogMicro.title,
                description: (og && og.description) || ogMicro.description
              };
            }
          } catch (e) {
            console.warn('[explorer-save] Microlink failed:', e.message);
          }
        }
      }
      console.log('[explorer-save] final og', og ? { hasImage: !!og.image, hasTitle: !!og.title, hasDesc: !!og.description } : 'NULL');
      saveBtn.textContent = '⏳ Guardando...';

      const lower = targetUrl.toLowerCase();
      const isReel = /instagram\.com\/(reel|reels)\//.test(lower);
      const isTikTokVideo = /tiktok\.com\/.+\/video\//.test(lower) || /tiktok\.com\/v\//.test(lower);
      const isYouTubeShort = /youtube\.com\/shorts/.test(lower);
      const isYouTubeWatch = /youtube\.com\/watch|youtu\.be\//.test(lower);
      const isIGPost = /instagram\.com\/p\//.test(lower);

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
        linkType = 'video';
      } else {
        linkType = 'material';
      }

      function cleanPageTitle(t) {
        if (!t) return '';
        return t.replace(/\s*[•|·\-—]\s*(Instagram|TikTok|YouTube|Facebook|X|Twitter)\s*$/i, '').trim();
      }
      let finalTitle = cleanPageTitle(og && og.title) ||
                       cleanPageTitle(pageData && pageData.title) ||
                       cleanPageTitle(title) ||
                       (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'Referencia'; } })();
      const description = (pageData && pageData.description) || (og && og.description) || '';
      // v3.11.13: regex de "título genérico" más permisiva — matchea cualquier
      // variante de IG/TikTok/YouTube como prefijo, y también si el título es
      // muy corto (<3 chars). Si la página tiene título genérico Y tenemos
      // caption, usar la primera línea del caption como título de la entry.
      const isGenericTitle = !finalTitle ||
        finalTitle.trim().length < 3 ||
        /^(\(\d+\)\s*)?(instagram|tiktok|youtube|explora|reels?|explore|shorts?|for ?you|para ti)\b/i.test(finalTitle.trim());
      if (isGenericTitle && description) {
        const firstLine = description.split('\n').find(l => l.trim().length > 0) || '';
        const cleaned = firstLine.trim().slice(0, 120);
        if (cleaned) finalTitle = cleaned;
      }

      // En feed genérico, preferir pageData.image (poster del video visible) sobre og.image.
      // En URL específica, og.image (Microlink server-side) es más confiable.
      let coverImage, coverSource = '';
      if (isGenericFeedUrl) {
        coverImage = (pageData && pageData.image) || (og && og.image) || '';
        if (coverImage) coverSource = 'webview-dom';
      } else {
        coverImage = (og && og.image) || (pageData && pageData.image) || '';
        if (coverImage) {
          if (og && og.image && og.image === coverImage) coverSource = 'microlink';
          else coverSource = 'webview-dom';
        }
      }
      if (!coverImage && getActiveTab() && getActiveTab().ready) {
        try {
          // Timeout 5s — si capturePage cuelga, abortamos
          const native = await withTimeout(browser.capturePage(), 5000, 'capturePage');
          if (native && typeof native.toDataURL === 'function') {
            // Resize a 480px ancho — más chico para no inflar Firestore con docs
            // de 1MB+ que pueden ralentizar la UI cuando se renderizan.
            const resized = (native.resize && !native.isEmpty()) ? native.resize({ width: 480 }) : native;
            if (typeof resized.toJPEG === 'function') {
              try {
                const buf = resized.toJPEG(60);
                if (buf && buf.length > 0 && buf.length < 600 * 1024) {
                  // Cap a 600KB para evitar docs Firestore monstruosos
                  const bytes = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
                  let binary = '';
                  const CHUNK = 0x8000;
                  for (let i = 0; i < bytes.length; i += CHUNK) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
                  }
                  coverImage = 'data:image/jpeg;base64,' + btoa(binary);
                  coverSource = 'screenshot-jpeg';
                } else if (buf && buf.length >= 600 * 1024) {
                  console.warn('[explorer] screenshot too large, skipping', buf.length);
                }
              } catch (e) { console.warn('[explorer] toJPEG failed', e); }
            }
          }
        } catch (e) { console.warn('[explorer] capturePage failed', e.message); }
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
        // Safety: si coverImage es base64 enorme (>700KB), descartarlo para no
        // crear docs Firestore que cuelguen la UI al renderizarse.
        if (coverImage.length > 700 * 1024) {
          console.warn('[explorer] coverImage too large, dropping', coverImage.length);
        } else {
          // v3.11.117: si la URL es firmada (scontent.cdninstagram, tiktokcdn, fbcdn
          // con x-expires), persistir a Cloudinary para que NO expire. La URL
          // original carga UNA vez mientras tu session es válida, después da 403
          // y la card queda con placeholder. Cloudinary la deja permanente.
          if (coverImage.startsWith('http') && window.api && window.api.persistCoverUrl) {
            try {
              const persisted = await window.api.persistCoverUrl(coverImage);
              if (persisted && persisted !== coverImage) {
                console.log('[explorer] cover persisted to Cloudinary:', persisted.substring(0, 80));
                coverImage = persisted;
                coverSource = (coverSource || 'unknown') + '+cloudinary';
              }
            } catch (e) { console.warn('[explorer] persistCoverUrl failed:', e.message); }
          }
          data.coverImage = coverImage;
          data.coverFetcherV = 14;
        }
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
      console.log('[explorer-save] writing to Firestore', { hasCover: !!data.coverImage, coverLen: data.coverImage ? data.coverImage.length : 0, hasDesc: !!data.description, title: data.title.slice(0, 60), categoryId, subcategoryId });
      try {
        await db.collection('depositEntries').add(data);
        console.log('[explorer-save] ✓ Firestore add OK');
      } catch (fsErr) {
        console.error('[explorer-save] Firestore add FAILED', fsErr);
        const code = fsErr.code || '';
        if (code === 'permission-denied') {
          showToast('Error de permisos en Firestore. Avisá al admin.', 'error');
        } else if (code === 'unavailable' || code.includes('network')) {
          showToast('Sin conexión a Firestore. Reintentá en un momento.', 'error');
        } else {
          showToast('Error guardando: ' + (fsErr.message || code || 'desconocido'), 'error');
        }
        return;
      }

      const summary = [];
      if (coverImage) summary.push('portada=' + (coverSource || 'sí'));
      else summary.push('⚠ SIN portada');
      if (description) summary.push('caption');
      if (usingDetectedReel) summary.push('reel detectado');
      if (isGenericFeedUrl && !usingDetectedReel) summary.push('⚠ feed genérico');
      const detail = summary.length ? ` (${summary.join(', ')})` : '';
      showToast('✓ ' + linkType + detail);
      const ts = document.getElementById('explorerTypeSelect');
      if (ts) ts.value = 'auto';
    } catch (e) {
      console.error('[explorer-save] FATAL', e);
      showToast('Error: ' + (e.message || 'desconocido') + '. Abrí DevTools (F12) para detalles.', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Guardar al Depósito';
    }
  });

  // ===== Initial tab =====
  createTab('https://www.google.com/');

  // v3.11.123: cuando el Deposito pide abrir un link en el Explorer,
  // renderer.js dispatcha 'explorer-open-url'. Creamos una nueva tab con esa URL.
  window.addEventListener('explorer-open-url', (e) => {
    const url = e.detail && e.detail.url;
    if (!url) return;
    console.log('[explorer] open-url', url);
    createTab(url);
  });

  // ===== v3.11.130: Chrome Real Embed (CDP screencast) =====
  const chromeBtn = document.getElementById('explorerToggleChromeReal');
  const chromeWrap = document.getElementById('chromeEmbedWrap');
  const chromeCanvas = document.getElementById('chromeEmbedCanvas');
  const chromeStatus = document.getElementById('chromeEmbedStatus');
  let chromeActive = false;
  let chromeImg = new Image();
  let chromeFrameMeta = { deviceWidth: 1280, deviceHeight: 720, pageScaleFactor: 1, offsetTop: 0 };

  async function startChromeReal() {
    if (chromeActive) return;
    if (!window.api || !window.api.chromeEmbed) {
      showToast('Chrome Real no disponible (preload viejo)', 'error');
      return;
    }
    chromeStatus.textContent = '⏳ Lanzando tu Chrome...';
    chromeStatus.style.display = '';
    chromeWrap.style.display = 'flex';
    chromeWrap.style.alignItems = 'stretch';
    chromeWrap.style.justifyContent = 'stretch';
    browserWrap.style.display = 'none';
    // Tomar el URL del tab activo como punto de partida
    let initialUrl = 'https://www.google.com/';
    try {
      const b = getActiveBrowser();
      if (b) initialUrl = b.getURL() || initialUrl;
    } catch (_) {}
    // v3.11.132: medir el canvas wrap DESPUÉS de mostrarlo para tener dims reales
    await new Promise(r => setTimeout(r, 50));
    const rect = chromeWrap.getBoundingClientRect();
    const w = Math.max(800, Math.floor(rect.width));
    const h = Math.max(500, Math.floor(rect.height));
    console.log('[chrome-real] starting at', w, 'x', h);
    const result = await window.api.chromeEmbed.start({ url: initialUrl, width: w, height: h, quality: 85 });
    if (!result || !result.ok) {
      chromeStatus.textContent = '❌ ' + ((result && result.error) || 'Error al lanzar Chrome');
      setTimeout(() => stopChromeReal(), 2500);
      return;
    }
    chromeActive = true;
    chromeBtn.textContent = '✕ Volver al Explorer';
    chromeBtn.style.background = 'rgba(244,67,54,0.18)';
    chromeBtn.style.borderColor = 'rgba(244,67,54,0.55)';
    chromeBtn.style.color = '#ff8b8b';
    chromeStatus.textContent = '✓ Chrome activo · perfil: ' + (result.profile || 'task-manager');
    setTimeout(() => { if (chromeStatus) chromeStatus.style.display = 'none'; }, 2500);
    if (urlBar) urlBar.value = result.url || initialUrl;
    setupChromeInput();
  }

  async function stopChromeReal() {
    chromeActive = false;
    if (window.api && window.api.chromeEmbed) {
      try { await window.api.chromeEmbed.stop(); } catch (_) {}
    }
    chromeWrap.style.display = 'none';
    browserWrap.style.display = '';
    chromeBtn.textContent = '🌐 Chrome Real';
    chromeBtn.style.background = 'rgba(76,175,80,0.18)';
    chromeBtn.style.borderColor = 'rgba(76,175,80,0.55)';
    chromeBtn.style.color = '#9ee49e';
  }

  if (chromeBtn) {
    chromeBtn.addEventListener('click', async () => {
      if (chromeActive) { await stopChromeReal(); }
      else { await startChromeReal(); }
    });
  }

  // v3.11.132: cuando cambia el tamaño de la ventana, re-dimensionar Chrome embed
  let _chromeResizeTimer = null;
  function _scheduleChromeResize() {
    if (!chromeActive || !window.api || !window.api.chromeEmbed) return;
    if (_chromeResizeTimer) clearTimeout(_chromeResizeTimer);
    _chromeResizeTimer = setTimeout(async () => {
      const rect = chromeWrap.getBoundingClientRect();
      const w = Math.max(640, Math.floor(rect.width));
      const h = Math.max(480, Math.floor(rect.height));
      console.log('[chrome-real] resize to', w, 'x', h);
      try { await window.api.chromeEmbed.resize({ width: w, height: h }); } catch (e) {}
    }, 300);
  }
  window.addEventListener('resize', _scheduleChromeResize);
  if (typeof ResizeObserver !== 'undefined' && chromeWrap) {
    const ro = new ResizeObserver(_scheduleChromeResize);
    ro.observe(chromeWrap);
  }

  // Recibir frames del main process y pintarlos
  let _frameCount = 0;
  if (window.api && window.api.chromeEmbed) {
    window.api.chromeEmbed.onFrame((payload) => {
      if (!chromeActive || !payload || !payload.data) return;
      chromeFrameMeta = payload.metadata || chromeFrameMeta;
      const dataUri = 'data:image/jpeg;base64,' + payload.data;
      chromeImg.onload = () => {
        const ctx = chromeCanvas.getContext('2d');
        const rect = chromeCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const targetW = Math.floor(rect.width * dpr);
        const targetH = Math.floor(rect.height * dpr);
        if (chromeCanvas.width !== targetW || chromeCanvas.height !== targetH) {
          chromeCanvas.width = targetW;
          chromeCanvas.height = targetH;
        }
        // v3.11.133: STRETCH puro (object-fit:fill). Sin letterbox. Si Chrome
        // se lanza con el viewport del tamaño del canvas, la diferencia de
        // aspect ratio es mínima — mejor un mini stretch invisible que
        // barras negras gigantes.
        if (_frameCount < 3) {
          console.log('[chrome-real] frame', _frameCount, '— img:', chromeImg.width + 'x' + chromeImg.height, '· canvas:', chromeCanvas.width + 'x' + chromeCanvas.height, '· css:', Math.floor(rect.width) + 'x' + Math.floor(rect.height), '· dpr:', dpr);
        }
        _frameCount++;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(chromeImg, 0, 0, chromeCanvas.width, chromeCanvas.height);
      };
      chromeImg.src = dataUri;
    });

    window.api.chromeEmbed.onUrlChanged((url) => {
      if (urlBar) urlBar.value = url || '';
    });

    // v3.11.134: tabs del Chrome embed
    const tabsBar = document.getElementById('chromeEmbedTabsBar');
    function renderChromeTabs(tabs) {
      if (!tabsBar) return;
      const list = Array.isArray(tabs) ? tabs : [];
      const tabsHtml = list.map(t => {
        const isActive = t.isActive;
        const safeTitle = (t.title || t.url || 'Pestaña').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const tip = (t.url || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `
          <div class="cr-tab" data-cr-tab="${t.id}" title="${tip}" style="display:inline-flex;align-items:center;gap:6px;max-width:200px;padding:6px 10px;background:${isActive ? '#0c0c0e' : '#252530'};border:1px solid #2a2a32;border-bottom:${isActive ? '1px solid #0c0c0e' : '1px solid #2a2a32'};border-radius:8px 8px 0 0;font-size:12px;color:${isActive ? '#fff' : '#aaa'};cursor:pointer;white-space:nowrap;position:relative;${isActive ? 'top:1px;font-weight:600' : ''}">
            <span style="overflow:hidden;text-overflow:ellipsis;max-width:140px">${safeTitle}</span>
            <span class="cr-tab-close" data-cr-close="${t.id}" style="opacity:0.6;padding:0 4px;border-radius:4px;font-size:14px;line-height:1">×</span>
          </div>`;
      }).join('');
      const newTabBtn = `<button id="crNewTab" title="Nueva pestaña" style="background:transparent;border:1px solid #2a2a32;color:#999;padding:4px 12px;border-radius:6px;font-size:18px;cursor:pointer;margin-bottom:2px">+</button>`;
      tabsBar.innerHTML = tabsHtml + newTabBtn;
      tabsBar.querySelectorAll('[data-cr-tab]').forEach(el => {
        el.addEventListener('click', (ev) => {
          if (ev.target.dataset.crClose) {
            ev.stopPropagation();
            window.api.chromeEmbed.closeTab(ev.target.dataset.crClose);
          } else {
            window.api.chromeEmbed.switchTab(el.dataset.crTab);
          }
        });
      });
      const ntb = document.getElementById('crNewTab');
      if (ntb) ntb.addEventListener('click', () => window.api.chromeEmbed.newTab('https://www.google.com/'));
    }
    window.api.chromeEmbed.onTabs(renderChromeTabs);

    // ===== v3.11.135: Downloads de Chrome Real → Depósito =====
    window.api.chromeEmbed.onDownloadStart((info) => {
      console.log('[chrome-real] download START', info);
      showToast(`⏳ Descargando: ${info.filename}…`);
    });
    window.api.chromeEmbed.onDownloadProgress((info) => {
      // Throttle simple — solo cada 25% para no spammear
      const pct = Math.round((info.progress || 0) * 100);
      if (pct % 25 === 0 && pct > 0) {
        console.log('[chrome-real] download progress', pct + '%');
      }
    });
    window.api.chromeEmbed.onDownloadComplete(async (info) => {
      console.log('[chrome-real] download COMPLETE', info);
      showToast(`✓ Descarga completada — guardando al Depósito…`);
      try {
        // 1) Subir a Cloudinary
        let publicUrl = '';
        let resourceType = 'raw';
        let extra = {};
        if (window.api && window.api.uploadLocalFileToCloudinary) {
          const up = await window.api.uploadLocalFileToCloudinary(info.filePath);
          if (up && up.ok && up.url) {
            publicUrl = up.url;
            resourceType = up.resourceType || 'raw';
            extra = up;
          } else {
            console.warn('[chrome-real] Cloudinary upload failed:', up && up.error);
            showToast('⚠ Descarga: Cloudinary no configurado — entry sin URL pública', 'error');
          }
        }
        // 2) Buscar/crear categoría "Descargas Chrome"
        const catName = 'Descargas Chrome';
        const catId = await _ensureDownloadCategory(catName);
        // 3) Detectar tipo de link según extensión
        const ext = (info.filename || '').toLowerCase().split('.').pop() || '';
        const isVideo = ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'].includes(ext);
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext);
        const linkType = isVideo ? 'video' : (isImage ? 'carrusel' : 'material');
        // 4) Crear entry
        const data = {
          title: info.filename || 'Descarga sin nombre',
          description: '',
          links: publicUrl
            ? [{ type: linkType, url: publicUrl, label: linkType === 'video' ? 'Video' : (linkType === 'carrusel' ? 'Imagen' : 'Archivo') }]
            : [{ type: linkType, url: 'file://' + info.filePath, label: 'Archivo local' }],
          categoryId: catId,
          status: 'idea',
          source: 'chrome-download',
          sourceUrl: info.url || '',
          createdBy: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : null,
          createdByName: (typeof currentUserData !== 'undefined' && currentUserData ? currentUserData.name : null) || ((typeof currentUser !== 'undefined' && currentUser && currentUser.email) ? currentUser.email.split('@')[0] : 'Anónimo'),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        // Cover si es video — usamos transformación de Cloudinary
        if (publicUrl && isVideo && resourceType === 'video') {
          try {
            data.coverImage = publicUrl.replace('/upload/', '/upload/so_0,w_640,h_1138,c_fill,f_jpg/').replace(/\.(mp4|mov|webm|m4v|mkv|avi)$/i, '.jpg');
            data.coverWidth = 640;
            data.coverHeight = 1138;
          } catch (_) {}
        } else if (publicUrl && isImage) {
          data.coverImage = publicUrl;
          if (extra.width) data.coverWidth = extra.width;
          if (extra.height) data.coverHeight = extra.height;
        }
        await db.collection('depositEntries').add(data);
        showToast(`✓ Guardado en Depósito → "${catName}"`);
      } catch (e) {
        console.error('[chrome-real] download → deposit FAILED', e);
        showToast('❌ Error guardando al Depósito: ' + (e.message || e), 'error');
      }
    });

    async function _ensureDownloadCategory(name) {
      try {
        const snap = await db.collection('depositCategories').where('name', '==', name).limit(1).get();
        if (!snap.empty) return snap.docs[0].id;
        const doc = await db.collection('depositCategories').add({
          name,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : null,
          icon: '⬇'
        });
        return doc.id;
      } catch (e) {
        console.warn('[chrome-real] _ensureDownloadCategory failed:', e.message);
        return null;
      }
    }
  }

  // ===== Input forwarding (mouse + keyboard + wheel) =====
  function canvasToPagePos(e) {
    // v3.11.133: con stretch puro (sin letterbox), la traducción es lineal.
    // Mouse en CSS pixels → viewport de Chrome (que es del MISMO tamaño CSS).
    const rect = chromeCanvas.getBoundingClientRect();
    const imgW = chromeImg.width || rect.width;
    const imgH = chromeImg.height || rect.height;
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(imgW, xRatio * imgW)),
      y: Math.max(0, Math.min(imgH, yRatio * imgH))
    };
  }
  function modifiersOf(e) {
    let m = 0;
    if (e.altKey) m |= 1;
    if (e.ctrlKey) m |= 2;
    if (e.metaKey) m |= 4;
    if (e.shiftKey) m |= 8;
    return m;
  }

  function setupChromeInput() {
    if (chromeCanvas._inputBound) return;
    chromeCanvas._inputBound = true;

    chromeCanvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const { x, y } = canvasToPagePos(e);
      window.api.chromeEmbed.sendMouse({ type: 'mousePressed', x, y, button: e.button, clickCount: e.detail || 1, modifiers: modifiersOf(e) });
      chromeCanvas.focus();
    });
    chromeCanvas.addEventListener('mouseup', (e) => {
      const { x, y } = canvasToPagePos(e);
      window.api.chromeEmbed.sendMouse({ type: 'mouseReleased', x, y, button: e.button, clickCount: e.detail || 1, modifiers: modifiersOf(e) });
    });
    let _lastMove = 0;
    chromeCanvas.addEventListener('mousemove', (e) => {
      const now = performance.now();
      if (now - _lastMove < 16) return; // throttle ~60fps
      _lastMove = now;
      const { x, y } = canvasToPagePos(e);
      window.api.chromeEmbed.sendMouse({ type: 'mouseMoved', x, y, modifiers: modifiersOf(e) });
    });
    chromeCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x, y } = canvasToPagePos(e);
      window.api.chromeEmbed.sendWheel({ x, y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: modifiersOf(e) });
    }, { passive: false });
    chromeCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // v3.11.136: Teclado — UN solo evento keyDown con el text para letras
    // imprimibles. CDP interpreta y mete la letra en la página. Para teclas
    // especiales (Tab/Enter/Backspace/flechas) usamos rawKeyDown sin text.
    chromeCanvas.addEventListener('keydown', (e) => {
      e.preventDefault();
      const keyCode = e.keyCode || e.which || 0;
      const isPrintable = e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey;
      window.api.chromeEmbed.sendKey({
        type: isPrintable ? 'keyDown' : 'rawKeyDown',
        key: e.key,
        code: e.code,
        keyCode,
        text: isPrintable ? e.key : '',
        modifiers: modifiersOf(e)
      });
    });
    chromeCanvas.addEventListener('keyup', (e) => {
      e.preventDefault();
      const keyCode = e.keyCode || e.which || 0;
      window.api.chromeEmbed.sendKey({
        type: 'keyUp',
        key: e.key,
        code: e.code,
        keyCode,
        modifiers: modifiersOf(e)
      });
    });
  }

  // Re-routear los botones de Atrás/Adelante/Recargar/URL al Chrome embed cuando está activo
  const origGoClick = document.getElementById('explorerGo').onclick;
  document.getElementById('explorerGo').addEventListener('click', () => {
    if (!chromeActive) return;
    const u = (urlBar.value || '').trim();
    if (u && window.api.chromeEmbed) window.api.chromeEmbed.navigate(u);
  }, true);
  document.getElementById('explorerBack').addEventListener('click', () => {
    if (chromeActive && window.api.chromeEmbed) window.api.chromeEmbed.back();
  }, true);
  document.getElementById('explorerForward').addEventListener('click', () => {
    if (chromeActive && window.api.chromeEmbed) window.api.chromeEmbed.forward();
  }, true);
  document.getElementById('explorerReload').addEventListener('click', () => {
    if (chromeActive && window.api.chromeEmbed) window.api.chromeEmbed.reload();
  }, true);
})();

// ===== ManyChat embed via webview (v3.11.9) =====
// Lazy-load: solo crear el webview cuando el usuario abre la pestaña ManyChat.
// Se llama desde renderer.js cuando currentTab === 'manychat'.
window._setupManyChat = function() {
  const shell = document.getElementById('manychatShell');
  if (!shell) return;
  if (shell.dataset.loaded === '1') return;
  shell.dataset.loaded = '1';
  const webview = document.createElement('webview');
  webview.setAttribute('src', 'https://app.manychat.com/');
  webview.setAttribute('partition', 'persist:manychat');
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('useragent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  webview.style.flex = '1';
  webview.style.minHeight = '0';
  shell.appendChild(webview);
};
