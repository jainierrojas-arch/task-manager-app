// ===== Multi-workspace bridge (v3.9.3) =====
// URL params del iframe: ?workspace=XXX&defaultWs=YYY&isDefault=1
// - workspace: ID del workspace activo
// - defaultWs: ID del workspace default (el que ve data legacy sin workspaceId)
// - isDefault=1: flag explícito (backward compat con v3.8.2)
const _wsParams = (() => {
  try { return new URLSearchParams(window.location.search); }
  catch (e) { return new URLSearchParams(); }
})();
const WS_ID = _wsParams.get('workspace') || null;
const DEFAULT_WS_ID = _wsParams.get('defaultWs') || null;
// v3.9.5: estado de 3 valores. 'unknown' por defecto → permisivo (muestra legacy + WS_ID).
// 'default' → permisivo. 'non-default' → estricto (solo WS_ID).
// Filosofía: WORST case es mostrar data extra (UX confusa pero no data loss). NO mostrar
// data correcta es mucho peor para el usuario.
let _ws_status = 'unknown';
if (_wsParams.get('isDefault') === '1' || (DEFAULT_WS_ID && WS_ID === DEFAULT_WS_ID)) {
  _ws_status = 'default';
} else if (DEFAULT_WS_ID && WS_ID !== DEFAULT_WS_ID) {
  _ws_status = 'non-default';
}
console.log('[ws] iframe init: WS_ID=' + WS_ID + ' DEFAULT_WS_ID=' + DEFAULT_WS_ID + ' status=' + _ws_status);
const WS_SCOPED_COLLECTIONS = new Set(['tasks', 'projects', 'depositEntries', 'depositCategories', 'scheduledPosts', 'chatMessages', 'captionTemplates', 'ideas']);
function _belongsToWs(d) {
  // v3.11.18: aislamiento real entre workspaces.
  // - Sin WS_ID: mostrar todo (modo standalone, no debería pasar normalmente).
  // - Workspace DEFAULT (o unknown al inicio): muestra entries con su workspaceId
  //   más entries SIN workspaceId (legacy data, antes de la era multi-workspace).
  // - Workspace NON-DEFAULT: muestra SOLO entries con su workspaceId exacto.
  if (!WS_ID) return true;
  if (_ws_status === 'default' || _ws_status === 'unknown') {
    return !d.workspaceId || d.workspaceId === WS_ID;
  }
  return d.workspaceId === WS_ID;
}

// v3.9.5: verificación async — sólo confirma si somos default o no.
// El estado por defecto es permisivo (muestra todo), así que esto solo
// ajusta a 'non-default' si hace falta restringir.
window._verifyWsIsDefault = async function(dbRef) {
  if (!WS_ID) return;
  if (_ws_status !== 'unknown') return; // ya conocemos el estado
  try {
    const snap = await dbRef.collection('workspaces').get();
    if (snap.empty) return;
    const docs = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    let defId = null;
    const explicit = docs.find(w => w.isDefault === true);
    if (explicit) defId = explicit.id;
    else if (docs.length === 1) defId = docs[0].id;
    else {
      const sorted = docs.sort((a, b) => {
        const at = (a.createdAt && a.createdAt.toDate) ? a.createdAt.toDate().getTime() : 0;
        const bt = (b.createdAt && b.createdAt.toDate) ? b.createdAt.toDate().getTime() : 0;
        return at - bt;
      });
      defId = sorted[0] ? sorted[0].id : null;
    }
    if (defId === WS_ID) {
      _ws_status = 'default';
      console.log('[ws] verify: este WS es default');
      // Ya estábamos permisivos, no hace falta re-renderizar
    } else if (defId) {
      _ws_status = 'non-default';
      console.log('[ws] verify: este WS NO es default — re-renderizando con filtro estricto');
      try { if (typeof renderCategories === 'function') renderCategories(); } catch (e) {}
      try { if (typeof renderEntries === 'function') renderEntries(); } catch (e) {}
    }
  } catch (e) { console.warn('[ws] verify failed:', e.message); }
};
// v3.9.10: cuando deposit-renderer.js corre dentro de un iframe del side panel,
// no tiene su propio preload — window.api es undefined. Heredamos del parent
// (mismo origen, accesible via window.parent). Si no hay parent (modo standalone)
// se usa el window.api del preload propio. Stubs de fallback para no romper.
if (!window.api && window.parent && window.parent !== window) {
  try {
    if (window.parent.api) window.api = window.parent.api;
  } catch (e) { /* cross-origin? */ }
}
if (!window.api) {
  window.api = {
    openExternal: (url) => { try { window.open(url, '_blank', 'noopener'); } catch (e) {} },
    onThemeChanged: () => {},
    minimizeWindow: () => {},
    closeWindow: () => { try { window.parent.postMessage({ type: 'close-deposit-panel' }, '*'); } catch (e) {} },
    refreshAllWindows: () => location.reload(),
    fetchOgData: async () => ({}),
    openScheduleFromEntry: null,
    onSetViewMode: () => {},
    onNavigate: () => {}
  };
}

// v3.9.8: helper de debug visible en el subtitle — definido al INICIO del módulo
// para que esté disponible cuando se llame antes de subscribeAll
function _setDebugBanner(text, color) {
  try {
    const el = document.getElementById('mainSubtitle');
    if (el) {
      el.textContent = text;
      el.style.color = color || '';
      el.style.fontSize = '11px';
    }
  } catch (e) {}
}

window._installWsScopeWrapper = function(db) {
  if (!db || !db.collection) return;
  const orig = db.collection.bind(db);
  db.collection = function(name) {
    const ref = orig(name);
    if (!WS_SCOPED_COLLECTIONS.has(name)) return ref;
    const origAdd = ref.add.bind(ref);
    ref.add = function(data) {
      const enriched = (data && WS_ID && !data.workspaceId)
        ? Object.assign({}, data, { workspaceId: WS_ID })
        : data;
      return origAdd(enriched);
    };
    return ref;
  };
};

// ===== TEMA — sincronizado con la app principal =====
const THEME_KEY = 'app-theme';
function applyDepositTheme(theme) {
  const valid = ['default', 'dark', 'light'];
  if (!valid.includes(theme)) theme = 'default';
  document.documentElement.classList.remove('theme-default', 'theme-dark', 'theme-light');
  document.documentElement.classList.add(`theme-${theme}`);
  document.body.classList.remove('theme-default', 'theme-dark', 'theme-light');
  document.body.classList.add(`theme-${theme}`);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}
(function loadInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY) || 'default';
    applyDepositTheme(saved);
  } catch (e) { applyDepositTheme('default'); }
})();
if (window.api && window.api.onThemeChanged) {
  window.api.onThemeChanged((theme) => applyDepositTheme(theme));
}

// ===== STATE =====
let currentUser = null;
let currentUserData = null;
let categories = [];
let entries = [];
let projects = [];
let teamMembers = [];
let selectedCategoryId = null;
let selectedSubcategoryId = null; // null=mostrar grid de subs, '__unsorted__'=ideas sin sub, ID=ideas de esa sub
let editingEntryId = null;
let assigningEntry = null;
let assignMode = 'single';
let unsubscribers = [];
// Snapshot del timestamp "depositLastViewedAt" al cargar la sesion. Se usa para
// marcar entries como "nuevas" en globos rojos. Solo se actualiza la marca al
// cerrar el deposito (manejado en renderer.js de la app principal).
let sessionLastViewedAt = null;

function isNewEntry(e) {
  if (!e || !e.createdAt) return false;
  if (e.createdBy === (currentUser && currentUser.uid)) return false;
  if (!sessionLastViewedAt) return true; // primera vez: todas las de otros son nuevas
  const lastMs = sessionLastViewedAt.toDate
    ? sessionLastViewedAt.toDate().getTime()
    : new Date(sessionLastViewedAt).getTime();
  const ms = e.createdAt.toDate ? e.createdAt.toDate().getTime() : new Date(e.createdAt).getTime();
  return ms > lastMs;
}

function newCountIn(catId, subId) {
  const arr = entriesIn(catId, subId);
  return arr.filter(isNewEntry).length;
}

// Estados de un depositEntry:
//   'idea'      - pendiente, visible en Tareas por hacer
//   'converted' - asignada a tarea, en proceso, OCULTA del deposito
//   'finalized' - tarea completada, archivada en Trabajos Finalizados

// Cuenta items pendientes por asignar (status === 'idea') en una categoria.
function pendingCountIn(catId, subId) {
  return entriesIn(catId, subId).filter(e => e.status === 'idea' || !e.status).length;
}

// Cuenta items finalizados (status === 'finalized') en una categoria/subcategoria.
function finalizedCountIn(catId, subId) {
  return entriesIn(catId, subId).filter(e => e.status === 'finalized').length;
}

function rootCategories() { return categories.filter(c => !c.parentId); }
function subcategoriesOf(parentId) { return categories.filter(c => c.parentId === parentId); }

// Devuelve entries en una categoria/subcategoria. Por default OCULTA las que
// estan en proceso (status='converted') porque ya fueron asignadas a tarea
// y deben aparecer "fuera del deposito" hasta que se completen o se cancelen.
function entriesIn(catId, subId) {
  const visible = (e) => e.status !== 'converted';
  if (subId === '__unsorted__') return entries.filter(e => e.categoryId === catId && !e.subcategoryId && visible(e));
  if (subId) return entries.filter(e => e.categoryId === catId && e.subcategoryId === subId && visible(e));
  return entries.filter(e => e.categoryId === catId && visible(e));
}

const userColors = [
  '#FF4757', '#1E90FF', '#2ED573', '#FFA502', '#BE2EDD',
  '#FFD93D', '#00D2D3', '#FF6348', '#70A1FF', '#EE5A6F'
];

// ===== HELPERS =====
function esc(text) {
  if (text == null) return '';
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function getUserColor(userId) {
  const idx = teamMembers.findIndex(m => m.id === userId);
  return userColors[idx >= 0 ? idx % userColors.length : 0];
}

function toast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

function timeAgo(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `hace ${days}d`;
  return date.toLocaleDateString('es-ES');
}

function parseUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

// ===== AUTH =====
const defaultCatsInFlight = new Set();

// v3.9.8: capturar errores no manejados para mostrarlos al usuario (útil para
// diagnosticar bugs en producción donde no se puede abrir DevTools).
window.addEventListener('error', (ev) => {
  try { _setDebugBanner('❌ JS error: ' + (ev.message || 'unknown'), '#ff6b6b'); } catch (e) {}
});
window.addEventListener('unhandledrejection', (ev) => {
  try { _setDebugBanner('❌ Promise rejection: ' + (ev.reason && ev.reason.message ? ev.reason.message : ev.reason), '#ff6b6b'); } catch (e) {}
});
_setDebugBanner('⏳ Esperando autenticación...', '#9d9db5');
auth.onAuthStateChanged((user) => {
  if (!user) {
    document.getElementById('mainTitle').textContent = 'No has iniciado sesion';
    _setDebugBanner('❌ No autenticado en el iframe — auth state es null', '#ff6b6b');
    document.getElementById('entriesArea').innerHTML = '';
    return;
  }
  _setDebugBanner('✅ Autenticado como ' + (user.email || user.uid), '#4ecdc4');
  currentUser = user;
  // Arranque no-bloqueante: datos minimos y suscripciones en paralelo
  currentUserData = { id: user.uid, name: user.email.split('@')[0], email: user.email };
  subscribeAll();
  // Fetch completo del user doc en background y congelar el timestamp de "ultima visita"
  // para marcar globos de "nueva" durante esta sesion del deposito.
  db.collection('users').doc(user.uid).get().then(snap => {
    if (snap.exists) {
      currentUserData = { id: user.uid, ...snap.data() };
      sessionLastViewedAt = currentUserData.depositLastViewedAt || null;
      renderCategories();
      renderEntries();
    }
  }).catch(() => {});
});

async function ensureDefaultCategories() {
  // Solo Trabajos Finalizados y Referencias son predeterminadas / no borrables.
  // Reels y Carruseles eran defaults antes pero ahora son categorias normales
  // que el usuario puede borrar libremente.
  const defaults = [
    { id: 'trabajos-finalizados', name: 'Trabajos Finalizados' },
    { id: 'referencias', name: 'Referencias' }
  ];
  // Subcategoria predeterminada "Publicados" dentro de Trabajos Finalizados.
  // Es donde caen automaticamente las tareas finalizadas.
  const defaultSubs = [
    { id: 'tf-publicados', name: 'Publicados', parentId: 'trabajos-finalizados' }
  ];
  // Migracion: si existen reels/carruseles con isDefault=true, quitarles el
  // flag para que se puedan borrar.
  const legacyDefaults = ['reels', 'carruseles'];
  for (const id of legacyDefaults) {
    const existing = categories.find(c => c.id === id);
    if (existing && existing.isDefault) {
      try {
        await db.collection('depositCategories').doc(id).update({ isDefault: false });
      } catch (e) { /* ignore */ }
    }
  }
  const existingIds = new Set(categories.map(c => c.id));
  const toCreate = defaults.filter(d => !existingIds.has(d.id) && !defaultCatsInFlight.has(d.id));
  await Promise.all(toCreate.map(async d => {
    defaultCatsInFlight.add(d.id);
    try {
      const ref = db.collection('depositCategories').doc(d.id);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          name: d.name,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: currentUser.uid,
          isDefault: true
        });
      }
    } catch (e) { /* ignore */ }
    // no borramos de in-flight para no re-intentar cada snapshot si ya lo hicimos una vez
  }));
  // Crear subcategoria "Publicados" dentro de Trabajos Finalizados
  const subsToCreate = defaultSubs.filter(s => !existingIds.has(s.id) && !defaultCatsInFlight.has(s.id));
  await Promise.all(subsToCreate.map(async s => {
    defaultCatsInFlight.add(s.id);
    try {
      const ref = db.collection('depositCategories').doc(s.id);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          name: s.name,
          parentId: s.parentId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: currentUser.uid,
          isDefault: true
        });
      }
    } catch (e) { /* ignore */ }
  }));
}

function subscribeAll() {
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  _setDebugBanner('🔍 Conectando a Firestore...', '#ffd93d');

  unsubscribers.push(db.collection('depositCategories').orderBy('name').onSnapshot(snap => {
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(_belongsToWs);
    if (!selectedCategoryId && categories.length > 0) selectedCategoryId = categories[0].id;
    _setDebugBanner(`✅ ${categories.length} categorías + ${entries.length} entries · WS=${WS_ID || 'none'} · auth=${currentUser ? 'OK' : 'NO'}`, categories.length > 0 ? '#4ecdc4' : '#ff6b6b');
    renderCategories();
    renderEntries();
    ensureDefaultCategories().catch(() => {});
  }, err => {
    _setDebugBanner('❌ Error categorías: ' + err.message, '#ff6b6b');
    console.error('[deposit] depositCategories error:', err);
  }));

  unsubscribers.push(db.collection('depositEntries').orderBy('createdAt', 'desc').onSnapshot(snap => {
    entries = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(_belongsToWs);
    _setDebugBanner(`✅ ${categories.length} categorías + ${entries.length} entries · WS=${WS_ID || 'none'} · auth=${currentUser ? 'OK' : 'NO'}`, entries.length > 0 ? '#4ecdc4' : '#ff6b6b');
    renderCategories();
    renderEntries();
  }, err => {
    _setDebugBanner('❌ Error entries: ' + err.message, '#ff6b6b');
    console.error('[deposit] depositEntries error:', err);
  }));

  unsubscribers.push(db.collection('projects').orderBy('name').onSnapshot(snap => {
    projects = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(_belongsToWs);
    renderProjectSelect();
  }, err => console.error('[deposit] projects error:', err)));

  unsubscribers.push(db.collection('users').onSnapshot(snap => {
    teamMembers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMemberSelects();
  }, err => console.error('[deposit] users error:', err)));
}

// ===== CATEGORIES =====
function renderCategories() {
  const list = document.getElementById('categoryList');
  const roots = rootCategories();
  const normalRoots = roots.filter(c => c.id !== 'trabajos-finalizados' && c.id !== 'referencias');
  const tfRoot = roots.find(c => c.id === 'trabajos-finalizados');
  const refRoot = roots.find(c => c.id === 'referencias');

  let html = '';

  // Badge rojo PERSISTENTE: cuenta items pendientes (status !== 'converted')
  // y se queda fijo hasta que alguien los asigne como tarea.
  const pendingBadge = (n) => n > 0
    ? `<span class="new-badge" title="${n} pendiente${n === 1 ? '' : 's'} por asignar">${n > 99 ? '99+' : n}</span>`
    : '';

  // Item especial "Todos" — excluye Trabajos Finalizados y REFERENCIAS del conteo
  if (normalRoots.length > 0) {
    const totalCount = entries.filter(e => e.categoryId !== 'trabajos-finalizados' && e.categoryId !== 'referencias').length;
    const totalPending = entries.filter(e => e.categoryId !== 'trabajos-finalizados' && e.categoryId !== 'referencias' && e.status !== 'converted').length;
    const active = selectedCategoryId === '__all_categories__' ? ' active' : '';
    html += `
      <div class="category-item${active}" data-all-cats="1">
        <span class="cat-name">&#128230; Todos</span>
        <span class="cat-badges">
          ${pendingBadge(totalPending)}
          <span class="cat-count">${totalCount}</span>
        </span>
      </div>`;
  }

  // Seccion: Categorias normales (badge rojo de pendientes en cada una)
  normalRoots.forEach(c => {
    const count = entries.filter(e => e.categoryId === c.id).length;
    const pending = entries.filter(e => e.categoryId === c.id && e.status !== 'converted').length;
    const active = c.id === selectedCategoryId && !selectedSubcategoryId ? ' active' : '';
    const canDelete = !c.isDefault;
    html += `
      <div class="category-item${active}" data-id="${esc(c.id)}">
        <span class="cat-name">${esc(c.name)}</span>
        <span class="cat-badges">
          ${pendingBadge(pending)}
          <span class="cat-count">${count}</span>
          ${canDelete ? `<button class="cat-delete" data-delete="${esc(c.id)}" title="Eliminar categoria">&#10005;</button>` : ''}
        </span>
      </div>`;
  });

  // Item "+ Nueva categoria" dentro del listado
  html += `
    <div class="category-item add-cat-inline" data-add-root-cat="1" style="opacity:0.7">
      <span class="cat-name" style="color:var(--text-dim)">+ Nueva categoria</span>
    </div>`;

  // Seccion separada: Trabajos Finalizados — el final del final, NO muestra
  // badges rojos de notificacion (ya estan completadas, no son tareas pendientes).
  // Solo muestra cat-count con el total de items finalizados.
  if (tfRoot) {
    const tfSubs = subcategoriesOf('trabajos-finalizados');
    const tfTotalCount = entries.filter(e => e.categoryId === 'trabajos-finalizados' && e.status !== 'converted').length;
    const tfActive = selectedCategoryId === 'trabajos-finalizados' && !selectedSubcategoryId ? ' active' : '';
    html += `
      <div class="category-section-header">TRABAJOS FINALIZADOS</div>
      <div class="category-item${tfActive}" data-tf-root="1">
        <span class="cat-name" style="opacity:0.85">&#128230; Todos</span>
        <span class="cat-badges">
          <span class="cat-count">${tfTotalCount}</span>
        </span>
      </div>`;
    tfSubs.forEach(s => {
      const c = entries.filter(e => e.subcategoryId === s.id && e.status !== 'converted').length;
      const sActive = selectedSubcategoryId === s.id ? ' active' : '';
      const canDeleteSub = !s.isDefault;
      html += `
        <div class="category-item${sActive}" data-tf-sub="${esc(s.id)}" style="padding-left:18px">
          <span class="cat-name">${esc(s.name)}</span>
          <span class="cat-badges">
            <span class="cat-count">${c}</span>
            ${canDeleteSub ? `<button class="cat-delete" data-delete-tf-sub="${esc(s.id)}" title="Eliminar categoria">&#10005;</button>` : ''}
          </span>
        </div>`;
    });
    html += `
      <div class="category-item add-tf-sub" data-add-tf-sub="1" style="padding-left:18px;opacity:0.7">
        <span class="cat-name" style="color:var(--text-dim)">+ Nueva categoria</span>
      </div>`;
  }

  // Seccion separada: REFERENCIAS (banco de contenido — SIN badge rojo, SIN sumar al total)
  if (refRoot) {
    const refSubs = subcategoriesOf('referencias');
    const refTotalCount = entries.filter(e => e.categoryId === 'referencias').length;
    const refActive = selectedCategoryId === 'referencias' && !selectedSubcategoryId ? ' active' : '';
    // REFERENCIAS — sigue las mismas reglas de TAREAS: badge rojo con conteo
    // de items en cada subcategoria, y total sumado en "Todos".
    html += `
      <div class="category-section-header">REFERENCIAS</div>
      <div class="category-item${refActive}" data-ref-root="1">
        <span class="cat-name" style="opacity:0.85">&#128230; Todos</span>
        <span class="cat-badges">
          ${pendingBadge(refTotalCount)}
          <span class="cat-count">${refTotalCount}</span>
        </span>
      </div>`;
    refSubs.forEach(s => {
      const c = entries.filter(e => e.subcategoryId === s.id).length;
      const sActive = selectedSubcategoryId === s.id ? ' active' : '';
      html += `
        <div class="category-item${sActive}" data-ref-sub="${esc(s.id)}" style="padding-left:18px">
          <span class="cat-name">${esc(s.name)}</span>
          <span class="cat-badges">
            ${pendingBadge(c)}
            <span class="cat-count">${c}</span>
            <button class="cat-delete" data-delete-ref-sub="${esc(s.id)}" title="Eliminar categoria">&#10005;</button>
          </span>
        </div>`;
    });
    html += `
      <div class="category-item add-ref-sub" data-add-ref-sub="1" style="padding-left:18px;opacity:0.7">
        <span class="cat-name" style="color:var(--text-dim)">+ Nueva categoria</span>
      </div>`;
  }

  list.innerHTML = html;

  // Listener del item "Todos"
  const allEl = list.querySelector('[data-all-cats]');
  if (allEl) {
    allEl.addEventListener('click', () => {
      selectedCategoryId = '__all_categories__';
      selectedSubcategoryId = null;
      renderCategories();
      renderEntries();
    });
  }

  // Listener del "+ Nueva categoria" inline
  const addRootEl = list.querySelector('[data-add-root-cat]');
  if (addRootEl) {
    addRootEl.addEventListener('click', showCategoryModal);
  }

  list.querySelectorAll('.category-item[data-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.dataset.delete) return;
      selectedCategoryId = el.dataset.id;
      selectedSubcategoryId = null;
      renderCategories();
      renderEntries();
    });
  });
  list.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCategory(btn.dataset.delete);
    });
  });

  // Trabajos Finalizados - raiz
  const tfRootEl = list.querySelector('[data-tf-root]');
  if (tfRootEl) {
    tfRootEl.addEventListener('click', () => {
      selectedCategoryId = 'trabajos-finalizados';
      selectedSubcategoryId = null;
      renderCategories();
      renderEntries();
    });
  }
  // Trabajos Finalizados - sub (listadas como categorias aqui)
  list.querySelectorAll('[data-tf-sub]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.dataset.deleteTfSub) return;
      selectedCategoryId = 'trabajos-finalizados';
      selectedSubcategoryId = el.dataset.tfSub;
      renderCategories();
      renderEntries();
    });
  });
  list.querySelectorAll('[data-delete-tf-sub]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSubcategory(btn.dataset.deleteTfSub);
    });
  });
  const addTfSubEl = list.querySelector('[data-add-tf-sub]');
  if (addTfSubEl) {
    addTfSubEl.addEventListener('click', () => {
      const prev = selectedCategoryId;
      selectedCategoryId = 'trabajos-finalizados';
      showSubcategoryModal();
      // restauracion ocurre via onSnapshot
    });
  }

  // REFERENCIAS - raiz
  const refRootEl = list.querySelector('[data-ref-root]');
  if (refRootEl) {
    refRootEl.addEventListener('click', () => {
      selectedCategoryId = 'referencias';
      selectedSubcategoryId = null;
      renderCategories();
      renderEntries();
    });
  }
  // REFERENCIAS - subcategorias
  list.querySelectorAll('[data-ref-sub]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.dataset.deleteRefSub) return;
      selectedCategoryId = 'referencias';
      selectedSubcategoryId = el.dataset.refSub;
      renderCategories();
      renderEntries();
    });
  });
  list.querySelectorAll('[data-delete-ref-sub]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSubcategory(btn.dataset.deleteRefSub);
    });
  });
  const addRefSubEl = list.querySelector('[data-add-ref-sub]');
  if (addRefSubEl) {
    addRefSubEl.addEventListener('click', () => {
      selectedCategoryId = 'referencias';
      showSubcategoryModal();
    });
  }
}

async function deleteCategory(catId) {
  const cat = categories.find(c => c.id === catId);
  if (!cat) return;
  const inCat = entries.filter(e => e.categoryId === catId);
  const msg = inCat.length > 0
    ? `Eliminar categoria "${cat.name}"? Sus ${inCat.length} idea(s) tambien se eliminaran.`
    : `Eliminar categoria "${cat.name}"?`;
  if (!confirm(msg)) return;
  const batch = db.batch();
  inCat.forEach(e => batch.delete(db.collection('depositEntries').doc(e.id)));
  batch.delete(db.collection('depositCategories').doc(catId));
  await batch.commit();
  if (selectedCategoryId === catId) selectedCategoryId = categories.find(c => c.id !== catId)?.id || null;
}

// Boton "newCategoryBtn" del footer ya no existe; ahora es item inline en la lista.
const newCategoryBtnEl = document.getElementById('newCategoryBtn');
if (newCategoryBtnEl) newCategoryBtnEl.addEventListener('click', () => showCategoryModal());
document.getElementById('cancelCategory').addEventListener('click', () => hideCategoryModal());
document.getElementById('confirmCategory').addEventListener('click', async () => {
  const name = document.getElementById('categoryNameInput').value.trim();
  if (!name) return;
  const modal = document.getElementById('categoryModal');
  const mode = modal.dataset.mode;

  if (mode === 'edit-sub') {
    const subId = modal.dataset.editId;
    const sub = categories.find(c => c.id === subId);
    if (!sub) { hideCategoryModal(); return; }
    if (name === sub.name) { hideCategoryModal(); return; }
    await db.collection('depositCategories').doc(subId).update({ name });
    const inSub = entries.filter(e => e.subcategoryId === subId);
    if (inSub.length > 0) {
      const batch = db.batch();
      inSub.forEach(e => batch.update(db.collection('depositEntries').doc(e.id), { subcategoryName: name }));
      await batch.commit();
    }
    hideCategoryModal();
    toast('Subcategoria renombrada');
    return;
  }

  const isSub = mode === 'sub';
  const data = {
    name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: currentUser.uid
  };
  if (isSub && selectedCategoryId) data.parentId = selectedCategoryId;
  await db.collection('depositCategories').add(data);
  hideCategoryModal();
  toast(isSub ? `Subcategoria "${name}" creada` : `Categoria "${name}" creada`);
});

function showCategoryModal() {
  document.getElementById('categoryModal').dataset.mode = 'root';
  document.getElementById('categoryModal').querySelector('.modal-title').textContent = 'Nueva categoria';
  document.getElementById('categoryNameInput').value = '';
  document.getElementById('categoryNameInput').placeholder = 'Nombre (ej. Tutoriales, Diseno...)';
  document.getElementById('categoryModal').classList.add('active');
  setTimeout(() => document.getElementById('categoryNameInput').focus(), 100);
}

function showSubcategoryModal() {
  if (!selectedCategoryId) return;
  const cat = categories.find(c => c.id === selectedCategoryId);
  document.getElementById('categoryModal').dataset.mode = 'sub';
  document.getElementById('categoryModal').querySelector('.modal-title').textContent = `Nueva subcategoria en "${cat ? cat.name : ''}"`;
  document.getElementById('categoryNameInput').value = '';
  document.getElementById('categoryNameInput').placeholder = 'Nombre (ej. Mes Abril, Cliente X...)';
  document.getElementById('categoryModal').classList.add('active');
  setTimeout(() => document.getElementById('categoryNameInput').focus(), 100);
}

function hideCategoryModal() {
  document.getElementById('categoryModal').classList.remove('active');
}

function renameSubcategory(subId) {
  const sub = categories.find(c => c.id === subId);
  if (!sub) return;
  const modal = document.getElementById('categoryModal');
  modal.dataset.mode = 'edit-sub';
  modal.dataset.editId = subId;
  modal.querySelector('.modal-title').textContent = `Renombrar subcategoria`;
  const input = document.getElementById('categoryNameInput');
  input.value = sub.name;
  input.placeholder = 'Nuevo nombre';
  modal.classList.add('active');
  setTimeout(() => { input.focus(); input.select(); }, 100);
}

async function deleteSubcategory(subId) {
  const sub = categories.find(c => c.id === subId);
  if (!sub) return;
  const inSub = entries.filter(e => e.subcategoryId === subId);
  const msg = inSub.length > 0
    ? `Eliminar la subcategoria "${sub.name}"? Sus ${inSub.length} idea(s) pasaran a "Sin clasificar".`
    : `Eliminar la subcategoria "${sub.name}"?`;
  if (!confirm(msg)) return;
  const batch = db.batch();
  inSub.forEach(e => batch.update(db.collection('depositEntries').doc(e.id), {
    subcategoryId: firebase.firestore.FieldValue.delete()
  }));
  batch.delete(db.collection('depositCategories').doc(subId));
  await batch.commit();
  if (selectedSubcategoryId === subId) selectedSubcategoryId = null;
  toast('Subcategoria eliminada');
}

// ===== ENTRIES =====
function renderEntries() {
  const area = document.getElementById('entriesArea');
  const title = document.getElementById('mainTitle');
  const sub = document.getElementById('mainSubtitle');
  const newBtn = document.getElementById('newEntryBtn');

  if (!selectedCategoryId || rootCategories().length === 0) {
    title.textContent = 'Crea una categoria primero';
    sub.textContent = '';
    newBtn.style.display = 'none';
    area.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128230;</div>
        <div class="empty-state-text">El deposito esta vacio</div>
        <div class="empty-state-sub">Crea una categoria y empieza a agregar ideas</div>
      </div>`;
    return;
  }

  // Vista "Todos": grid con tarjetas de cada categoria normal
  if (selectedCategoryId === '__all_categories__') {
    const normalRoots = rootCategories().filter(c => c.id !== 'trabajos-finalizados' && c.id !== 'referencias');
    const allEntries = entries.filter(e => e.categoryId !== 'trabajos-finalizados' && e.categoryId !== 'referencias');
    title.textContent = 'Todas las categorias';
    sub.textContent = `${normalRoots.length} categoria${normalRoots.length === 1 ? '' : 's'} - ${allEntries.length} idea${allEntries.length === 1 ? '' : 's'} en total`;
    newBtn.style.display = 'none';
    let cardsHtml = '';
    normalRoots.forEach(c => {
      const count = entries.filter(e => e.categoryId === c.id).length;
      const pending = entries.filter(e => e.categoryId === c.id && e.status !== 'converted').length;
      const canDelete = !c.isDefault;
      cardsHtml += `
        <div class="sub-card" data-cat-card="${esc(c.id)}">
          ${pending > 0 ? `<span class="sub-card-new" title="${pending} pendiente${pending === 1 ? '' : 's'} por asignar">${pending > 99 ? '99+' : pending}</span>` : ''}
          ${canDelete ? `<button class="sub-card-delete" data-delete-root-cat="${esc(c.id)}" title="Eliminar categoria">&#10005;</button>` : ''}
          <div class="sub-card-icon">&#128193;</div>
          <div class="sub-card-name">${esc(c.name)}</div>
          <div class="sub-card-count">${count} idea${count === 1 ? '' : 's'}</div>
        </div>`;
    });
    cardsHtml += `
      <div class="sub-card add-card" id="addRootCatCard">
        <div class="sub-card-icon">&#10133;</div>
        <div class="sub-card-name">Nueva categoria</div>
      </div>`;
    area.innerHTML = `<div class="sub-grid">${cardsHtml}</div>`;
    area.querySelectorAll('[data-cat-card]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.dataset.deleteRootCat) return;
        selectedCategoryId = card.dataset.catCard;
        selectedSubcategoryId = null;
        renderCategories();
        renderEntries();
      });
    });
    area.querySelectorAll('[data-delete-root-cat]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCategory(btn.dataset.deleteRootCat);
      });
    });
    const addBtn = document.getElementById('addRootCatCard');
    if (addBtn) addBtn.addEventListener('click', showCategoryModal);
    return;
  }

  const cat = categories.find(c => c.id === selectedCategoryId);
  if (!cat) { selectedCategoryId = null; renderEntries(); return; }

  // VISTA 1: Grid de subcategorias (cuando no hay sub seleccionada)
  if (!selectedSubcategoryId) {
    const subs = subcategoriesOf(selectedCategoryId);
    const totalIdeas = entriesIn(selectedCategoryId).length;
    const unsortedCount = entriesIn(selectedCategoryId, '__unsorted__').length;
    title.textContent = cat.name;
    sub.textContent = `${subs.length} subcategoria${subs.length === 1 ? '' : 's'} - ${totalIdeas} idea${totalIdeas === 1 ? '' : 's'} en total`;
    newBtn.style.display = 'none';

    // REFERENCIAS es banco de contenido — no muestra badges rojos en las cards
    const showPendingBadge = selectedCategoryId !== 'referencias';

    let cardsHtml = '';
    // Tarjeta "Sin clasificar" siempre visible si hay ideas sin sub o si no hay subs aun
    if (unsortedCount > 0 || subs.length === 0) {
      const unsortedPending = showPendingBadge ? pendingCountIn(selectedCategoryId, '__unsorted__') : 0;
      cardsHtml += `
        <div class="sub-card" data-sub-id="__unsorted__">
          ${unsortedPending > 0 ? `<span class="sub-card-new" title="${unsortedPending} pendiente${unsortedPending === 1 ? '' : 's'} por asignar">${unsortedPending > 99 ? '99+' : unsortedPending}</span>` : ''}
          <div class="sub-card-icon">&#128196;</div>
          <div class="sub-card-name">Sin clasificar</div>
          <div class="sub-card-count">${unsortedCount} idea${unsortedCount === 1 ? '' : 's'}</div>
        </div>`;
    }
    subs.forEach(s => {
      const count = entriesIn(selectedCategoryId, s.id).length;
      const pending = showPendingBadge ? pendingCountIn(selectedCategoryId, s.id) : 0;
      cardsHtml += `
        <div class="sub-card" data-sub-id="${esc(s.id)}">
          ${pending > 0 ? `<span class="sub-card-new" title="${pending} pendiente${pending === 1 ? '' : 's'} por asignar">${pending > 99 ? '99+' : pending}</span>` : ''}
          <button class="sub-card-edit" data-edit-sub="${esc(s.id)}" title="Renombrar subcategoria">&#9998;</button>
          <button class="sub-card-delete" data-delete-sub="${esc(s.id)}" title="Eliminar subcategoria">&#10005;</button>
          <div class="sub-card-icon">&#128193;</div>
          <div class="sub-card-name">${esc(s.name)}</div>
          <div class="sub-card-count">${count} idea${count === 1 ? '' : 's'}</div>
        </div>`;
    });
    cardsHtml += `
      <div class="sub-card add-card" id="addSubCardBtn">
        <div class="sub-card-icon">&#10133;</div>
        <div class="sub-card-name">Nueva subcategoria</div>
      </div>`;
    area.innerHTML = `<div class="sub-grid">${cardsHtml}</div>`;

    area.querySelectorAll('.sub-card[data-sub-id]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.dataset.deleteSub) return;
        selectedSubcategoryId = card.dataset.subId;
        renderEntries();
      });
    });
    area.querySelectorAll('[data-delete-sub]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSubcategory(btn.dataset.deleteSub);
      });
    });
    area.querySelectorAll('[data-edit-sub]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameSubcategory(btn.dataset.editSub);
      });
    });
    const addBtn = document.getElementById('addSubCardBtn');
    if (addBtn) addBtn.addEventListener('click', showSubcategoryModal);
    return;
  }

  // VISTA 2: Ideas de una subcategoria
  const isUnsorted = selectedSubcategoryId === '__unsorted__';
  const subName = isUnsorted ? 'Sin clasificar' : (categories.find(c => c.id === selectedSubcategoryId)?.name || '?');
  const subEntries = entriesIn(selectedCategoryId, selectedSubcategoryId);
  title.innerHTML = `<button class="back-btn" id="backToSubs" title="Volver a subcategorias">&#8592;</button> ${esc(cat.name)} <span style="opacity:0.5">/</span> ${esc(subName)}`;
  sub.textContent = `${subEntries.length} idea${subEntries.length === 1 ? '' : 's'} aqui`;
  newBtn.style.display = 'inline-flex';

  if (subEntries.length === 0) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128161;</div>
        <div class="empty-state-text">No hay ideas en "${esc(subName)}"</div>
        <div class="empty-state-sub">Click en "+ Nueva idea" para empezar</div>
      </div>`;
  } else {
    area.innerHTML = `<div class="entry-grid">${subEntries.map(e => renderEntryHtml(e)).join('')}</div>`;
    lazyFetchCovers(subEntries);
    ensureCoverDimensions(subEntries);
    area.querySelectorAll('[data-link-open]').forEach(chip => {
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const u = chip.dataset.linkOpen;
        if (u) window.api.openExternal(u);
      });
    });
    area.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => showEntryModal(btn.dataset.edit));
    });
    area.querySelectorAll('[data-assign]').forEach(btn => {
      btn.addEventListener('click', () => showAssignModal(btn.dataset.assign));
    });
    area.querySelectorAll('[data-take]').forEach(btn => {
      btn.addEventListener('click', () => showAssignModal(btn.dataset.take, { takeForMe: true }));
    });
    area.querySelectorAll('[data-delete-entry]').forEach(btn => {
      btn.addEventListener('click', () => deleteEntry(btn.dataset.deleteEntry));
    });
    area.querySelectorAll('[data-reuse]').forEach(btn => {
      btn.addEventListener('click', () => reuseEntry(btn.dataset.reuse));
    });
    area.querySelectorAll('[data-move]').forEach(btn => {
      btn.addEventListener('click', () => showMoveModal(btn.dataset.move));
    });
    area.querySelectorAll('[data-schedule-entry]').forEach(btn => {
      btn.addEventListener('click', () => scheduleFromEntry(btn.dataset.scheduleEntry));
    });
  }

  const backBtn = document.getElementById('backToSubs');
  if (backBtn) backBtn.addEventListener('click', () => {
    selectedSubcategoryId = null;
    renderEntries();
  });
}

// Cloudinary video → URL de thumbnail (.jpg del primer frame). Cloudinary lo
// genera al vuelo, sin que tengamos que subirlo. Devuelve null si no es video.
function cloudinaryVideoThumb(url) {
  if (!url || !/\/video\/upload\//.test(url)) return null;
  if (!/res\.cloudinary\.com/i.test(url)) return null;
  return url
    .replace(/\/video\/upload\//, '/video/upload/so_auto,w_600/')
    .replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, '.jpg');
}

// Helpers para servicios conocidos cuando no hay og:image
function serviceFromUrl(url) {
  if (!url) return null;
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return null; }
  if (host.includes('instagram.com')) return { name: 'Instagram', icon: '&#128247;', gradient: 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af,#515bd4)' };
  if (host.includes('tiktok.com')) return { name: 'TikTok', icon: '&#127908;', gradient: 'linear-gradient(135deg,#25f4ee,#000000,#fe2c55)' };
  if (host.includes('youtube.com') || host.includes('youtu.be')) return { name: 'YouTube', icon: '&#9654;&#65039;', gradient: 'linear-gradient(135deg,#ff0000,#cc0000)' };
  if (host.includes('twitter.com') || host.includes('x.com')) return { name: 'X / Twitter', icon: '&#119813;', gradient: 'linear-gradient(135deg,#000000,#1da1f2)' };
  if (host.includes('facebook.com') || host.includes('fb.com')) return { name: 'Facebook', icon: '&#119819;', gradient: 'linear-gradient(135deg,#1877f2,#0d47a1)' };
  if (host.includes('drive.google.com')) return { name: 'Google Drive', icon: '&#128190;', gradient: 'linear-gradient(135deg,#4285f4,#0f9d58,#f4b400,#db4437)' };
  if (host.includes('vimeo.com')) return { name: 'Vimeo', icon: '&#127916;', gradient: 'linear-gradient(135deg,#1ab7ea,#0f7fa3)' };
  return { name: host, icon: '&#128279;', gradient: 'linear-gradient(135deg,#6c63ff,#4a52e0)' };
}

function renderEntryHtml(e) {
  const author = e.createdByName || 'Anonimo';
  const color = getUserColor(e.createdBy);
  const links = (e.links || []);
  // Si la entry tiene un Carrusel, la card usa aspect-ratio 4:3 (no 4:5 vertical)
  const hasCarrusel = links.some(l => l.type === 'carrusel');
  // Chips compactos sin URL larga
  const linkChips = links.map(l => {
    const isVideo = l.type === 'video';
    const isCarrusel = l.type === 'carrusel';
    let cls = 'entry-link-chip';
    if (isVideo) cls += ' video';
    if (isCarrusel) cls += ' carrusel';
    let icon = '&#128279;'; // link
    if (isVideo) icon = '&#127916;'; // film
    if (isCarrusel) icon = '&#127912;'; // framed picture
    const label = l.label && l.label.length > 0
      ? l.label
      : (isVideo ? 'Video' : (isCarrusel ? 'Carrusel' : (l.type === 'recurso' ? 'Recurso' : 'Link')));
    return `<span class="${cls}" data-link-open="${esc(l.url)}" title="${esc(l.url)}">${icon} ${esc(label)}</span>`;
  }).join('');
  const convertedBadge = e.status === 'converted'
    ? `<span class="entry-badge success">&#10003; Convertida en tarea</span>`
    : '';
  const descHtml = e.description ? `<div class="entry-desc">${esc(e.description)}</div>` : '';
  // Cover: imagen Open Graph del primer link (cacheada en e.coverImage).
  // Si no hay og:image (ej. Instagram bloquea scraping), pintar placeholder con
  // gradiente del servicio + icono + dominio para que SIEMPRE haya portada.
  // Safety net: si no hay coverImage cacheado pero el primer link es un video
  // de Cloudinary, generamos el thumb on-the-fly. lazyFetchCovers va a persistir
  // este mismo valor despues, pero asi el primer render ya muestra portada.
  const cover = e.coverImage || cloudinaryVideoThumb(links[0]?.url || '');
  const firstUrl = links[0]?.url || '';
  let coverHtml = '';
  if (firstUrl) {
    if (cover) {
      // Si tenemos las dimensiones reales de la imagen (Microlink las devuelve),
      // forzamos el aspect-ratio del card a las dimensiones reales para que la
      // imagen llene 100% sin recortar ni dejar barras grandes.
      let arStyle = '';
      if (e.coverWidth && e.coverHeight) {
        arStyle = `aspect-ratio:${e.coverWidth} / ${e.coverHeight};`;
      }
      coverHtml = `<div class="entry-cover" data-link-open="${esc(firstUrl)}" style="background-image:url('${esc(cover)}');${arStyle}"></div>`;
    } else {
      const svc = serviceFromUrl(firstUrl);
      let domain = firstUrl;
      try { domain = new URL(firstUrl).hostname.replace(/^www\./, ''); } catch (_) {}
      coverHtml = `
        <div class="entry-cover entry-cover-placeholder" data-link-open="${esc(firstUrl)}" style="background:${svc.gradient}">
          <div class="entry-cover-icon">${svc.icon}</div>
          <div class="entry-cover-domain">${esc(svc.name)}</div>
        </div>`;
    }
  }
  // v3.9.2: mostrar botón Transcribir en CUALQUIER entry que tenga al menos
  // un link (transcribible o no). Al click la función transcribeEntry decide
  // si se puede o muestra error claro al usuario.
  const hasAnyLink = Array.isArray(e.links) && e.links.some(l => l && l.url);
  const transcript = e.transcription || null;
  const variations = Array.isArray(e.scriptVariations) ? e.scriptVariations : [];
  // v3.10.2: videos grabados desde el celular — visible como botón aparte
  const recordedVideos = Array.isArray(e.recordedVideos) ? e.recordedVideos : [];
  let recordedHtml = '';
  if (recordedVideos.length > 0) {
    const last = recordedVideos[recordedVideos.length - 1];
    const lbl = recordedVideos.length === 1 ? '🎥 Ver video grabado' : `🎥 Ver videos grabados (${recordedVideos.length})`;
    recordedHtml = `<button class="btn btn-ghost btn-small" data-open-recorded="${esc(e.id)}" data-recorded-url="${esc(last.url)}" title="Ver video grabado desde el celular" style="background:rgba(255,128,64,0.12);color:#ff9866;border:1px solid rgba(255,128,64,0.35);font-weight:600">${lbl}</button>`;
  }
  let transcriptHtml = '';
  if (hasAnyLink || transcript || recordedVideos.length > 0) {
    if (transcript) {
      const variationLabel = variations.length > 0 ? ` · ${variations.length} variación(es)` : '';
      transcriptHtml = `
        <div class="entry-transcript" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
          <button class="btn btn-ghost btn-small" data-open-transcript="${esc(e.id)}" title="Abrir editor de transcripción con teleprompter y variaciones" style="background:rgba(78,205,196,0.12);color:#4ecdc4;border:1px solid rgba(78,205,196,0.35);font-weight:600">🎤 Ver transcripción${variationLabel}</button>
          ${recordedHtml}
        </div>`;
    } else if (hasAnyLink) {
      transcriptHtml = `
        <div class="entry-transcript" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
          <button class="btn btn-ghost btn-small" data-transcribe="${esc(e.id)}" title="Transcribir audio del video con OpenAI Whisper">🎤 Transcribir video</button>
          ${recordedHtml}
        </div>`;
    } else if (recordedVideos.length > 0) {
      transcriptHtml = `
        <div class="entry-transcript" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
          ${recordedHtml}
        </div>`;
    }
  }
  return `
    <div class="entry-card ${e.status === 'converted' ? 'converted' : ''} ${hasCarrusel ? 'is-carrusel' : ''}" data-entry-id="${esc(e.id)}">
      ${coverHtml}
      <div class="entry-card-body">
        <div class="entry-card-head">
          <div class="entry-title">${esc(e.title || '(sin titulo)')}</div>
          ${convertedBadge}
        </div>
        ${descHtml}
        ${linkChips ? `<div class="entry-links">${linkChips}</div>` : ''}
        ${transcriptHtml}
        <div class="entry-card-foot">
          <div class="entry-author">Por <span style="color:${color};font-weight:600">${esc(author)}</span> &middot; ${timeAgo(e.createdAt)}</div>
          <div class="entry-actions">
            ${e.status === 'finalized' ? `
              <button class="btn btn-ghost btn-small" data-edit="${esc(e.id)}" title="Editar">&#9998;</button>
              <button class="btn btn-danger btn-small" data-delete-entry="${esc(e.id)}" title="Eliminar">&#10005;</button>
              <button class="btn btn-info btn-small" data-move="${esc(e.id)}" title="Mover a otra categoria">&#128194; Mover</button>
              <button class="btn btn-primary btn-small" data-schedule-entry="${esc(e.id)}" title="Programar en Instagram via Make">&#128241; Programar</button>
              <button class="btn btn-primary btn-small" data-reuse="${esc(e.id)}" title="Volver a Tareas por hacer">&#128260; Reutilizar</button>
            ` : `
              <button class="btn btn-ghost btn-small" data-edit="${esc(e.id)}" title="Editar">&#9998;</button>
              <button class="btn btn-danger btn-small" data-delete-entry="${esc(e.id)}" title="Eliminar">&#10005;</button>
              <button class="btn btn-info btn-small" data-move="${esc(e.id)}" title="Mover a otra categoria">&#128194; Mover</button>
              <button class="btn btn-primary btn-small" data-take="${esc(e.id)}" title="Tomarla yo (solo o cadena)">&#128587; Tomar</button>
              <button class="btn btn-success btn-small" data-assign="${esc(e.id)}">&#10140; Asignar</button>
            `}
          </div>
        </div>
      </div>
    </div>`;
}

// Programar una entry finalizada en Instagram. Envia la data via IPC al main
// window (que es donde vive el modal y el flujo de scheduling completo).
async function scheduleFromEntry(entryId) {
  const entry = entries.find(e => e.id === entryId);
  if (!entry) { toast('Entry no encontrada', 'error'); return; }
  if (!window.api || !window.api.openScheduleFromEntry) {
    toast('Esta version aun no soporta programar desde el deposito. Actualiza la app.', 'error');
    return;
  }
  try {
    await window.api.openScheduleFromEntry({
      id: entry.id,
      title: entry.title || '',
      description: entry.description || '',
      coverImage: entry.coverImage || '',
      links: entry.links || [],
      mediaUrls: Array.isArray(entry.mediaUrls) ? entry.mediaUrls : [],
      categoryId: entry.categoryId || '',
      subcategoryId: entry.subcategoryId || ''
    });
  } catch (e) {
    toast('Error abriendo modal de programacion: ' + e.message, 'error');
  }
}

// Reutilizar una entry finalizada: la regresa a "Tareas por hacer" con su
// categoria original (si la tenemos). Asi vuelve a sumar al badge rojo y se
// puede asignar de nuevo. Cuando se complete otra vez, regresa a Publicados.
async function reuseEntry(entryId) {
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return;
  if (entry.status !== 'finalized') {
    toast('Solo se pueden reutilizar tareas finalizadas', 'error');
    return;
  }
  if (!confirm(`Reutilizar "${entry.title}"?\n\nVolvera a "Tareas por hacer" y sumara al badge rojo. Cuando se complete otra vez regresa a Publicados.`)) return;
  const update = {
    status: 'idea',
    finalizedAt: firebase.firestore.FieldValue.delete(),
    finalizedTaskId: firebase.firestore.FieldValue.delete()
  };
  // Restaurar a categoria original si la tenemos
  if (entry.originalCategoryId) {
    update.categoryId = entry.originalCategoryId;
    update.categoryName = entry.originalCategoryName || '';
    if (entry.originalSubcategoryId) {
      update.subcategoryId = entry.originalSubcategoryId;
      update.subcategoryName = entry.originalSubcategoryName || '';
    } else {
      update.subcategoryId = firebase.firestore.FieldValue.delete();
      update.subcategoryName = firebase.firestore.FieldValue.delete();
    }
  }
  // Limpiar referencias inversas a la tarea anterior para que se pueda crear una nueva
  update.convertedTaskIds = firebase.firestore.FieldValue.delete();
  update.convertedAt = firebase.firestore.FieldValue.delete();
  await db.collection('depositEntries').doc(entryId).update(update);
  toast('Tarea reutilizada — ahora aparece en Tareas por hacer');
}

// Mover entry a otra categoria / subcategoria. Util sobre todo para mover
// items de Referencias (banco de contenido sin notificaciones) a una categoria
// normal donde se cuenten como Tareas por hacer.
let movingEntryId = null;
function showMoveModal(entryId) {
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return;
  movingEntryId = entryId;
  const select = document.getElementById('moveDestinationSelect');
  // Construir un select con TODAS las categorias y sub-categorias visibles
  // agrupadas en secciones (TAREAS POR HACER, REFERENCIAS, TRABAJOS FINALIZADOS).
  // El value codifica catId + subId separados por "|".
  const roots = rootCategories();
  const normalRoots = roots.filter(c => c.id !== 'trabajos-finalizados' && c.id !== 'referencias');
  const refRoot = roots.find(c => c.id === 'referencias');
  const tfRoot = roots.find(c => c.id === 'trabajos-finalizados');

  const currentValue = `${entry.categoryId || ''}|${entry.subcategoryId || ''}`;
  const buildOption = (catId, subId, label) => {
    const value = `${catId}|${subId || ''}`;
    const sel = value === currentValue ? ' selected' : '';
    return `<option value="${esc(value)}"${sel}>${esc(label)}</option>`;
  };

  let html = '';

  // Seccion: TAREAS POR HACER (categorias normales)
  if (normalRoots.length > 0) {
    html += `<optgroup label="📋 TAREAS POR HACER">`;
    normalRoots.forEach(c => {
      html += buildOption(c.id, null, c.name);
      const subs = subcategoriesOf(c.id);
      subs.forEach(s => {
        html += buildOption(c.id, s.id, `   ${c.name} / ${s.name}`);
      });
    });
    html += `</optgroup>`;
  }

  // Seccion: REFERENCIAS
  if (refRoot) {
    html += `<optgroup label="📚 REFERENCIAS">`;
    html += buildOption(refRoot.id, null, refRoot.name);
    subcategoriesOf(refRoot.id).forEach(s => {
      html += buildOption(refRoot.id, s.id, `   ${refRoot.name} / ${s.name}`);
    });
    html += `</optgroup>`;
  }

  // Seccion: TRABAJOS FINALIZADOS (permitida solo para mover manualmente)
  if (tfRoot) {
    html += `<optgroup label="✅ TRABAJOS FINALIZADOS">`;
    html += buildOption(tfRoot.id, null, tfRoot.name);
    subcategoriesOf(tfRoot.id).forEach(s => {
      html += buildOption(tfRoot.id, s.id, `   ${tfRoot.name} / ${s.name}`);
    });
    html += `</optgroup>`;
  }

  select.innerHTML = html;
  document.getElementById('moveModal').classList.add('active');
}

async function confirmMoveEntry() {
  if (!movingEntryId) return;
  const entry = entries.find(e => e.id === movingEntryId);
  if (!entry) { hideMoveModal(); return; }
  const value = document.getElementById('moveDestinationSelect').value;
  if (!value) { toast('Elige un destino', 'error'); return; }
  const [newCatId, newSubIdRaw] = value.split('|');
  const newSubId = newSubIdRaw || null;
  if (!newCatId) { toast('Elige un destino', 'error'); return; }
  const newCat = categories.find(c => c.id === newCatId);
  const newSub = newSubId ? categories.find(c => c.id === newSubId) : null;
  const update = {
    categoryId: newCatId,
    categoryName: newCat ? newCat.name : ''
  };
  if (newSubId) {
    update.subcategoryId = newSubId;
    update.subcategoryName = newSub ? newSub.name : '';
  } else {
    update.subcategoryId = firebase.firestore.FieldValue.delete();
    update.subcategoryName = firebase.firestore.FieldValue.delete();
  }
  // Determinar el status segun el destino:
  //   - TF        -> 'finalized' (se considera como completada y archivada)
  //   - cualquier otra categoria -> 'idea' (se vuelve Tarea por hacer y suma al badge)
  if (newCatId === 'trabajos-finalizados') {
    update.status = 'finalized';
    update.finalizedAt = firebase.firestore.FieldValue.serverTimestamp();
  } else {
    update.status = 'idea';
    update.finalizedAt = firebase.firestore.FieldValue.delete();
    update.finalizedTaskId = firebase.firestore.FieldValue.delete();
    update.convertedAt = firebase.firestore.FieldValue.delete();
    update.convertedTaskIds = firebase.firestore.FieldValue.delete();
  }
  await db.collection('depositEntries').doc(movingEntryId).update(update);
  hideMoveModal();
  toast(`Movida a "${newCat.name}${newSub ? ' / ' + newSub.name : ''}"`);
}

function hideMoveModal() {
  document.getElementById('moveModal').classList.remove('active');
  movingEntryId = null;
}

document.getElementById('cancelMove').addEventListener('click', hideMoveModal);
document.getElementById('confirmMove').addEventListener('click', confirmMoveEntry);
document.getElementById('moveModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('moveModal')) hideMoveModal();
});

// Attachea listeners comunes a los entry cards dentro de un contenedor
function bindEntryHandlers(area) {
  area.querySelectorAll('[data-link-open]').forEach(chip => {
    chip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const u = chip.dataset.linkOpen;
      if (u) window.api.openExternal(u);
    });
  });
  area.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => showEntryModal(btn.dataset.edit));
  });
  area.querySelectorAll('[data-assign]').forEach(btn => {
    btn.addEventListener('click', () => showAssignModal(btn.dataset.assign));
  });
  area.querySelectorAll('[data-take]').forEach(btn => {
    btn.addEventListener('click', () => showAssignModal(btn.dataset.take, { takeForMe: true }));
  });
  area.querySelectorAll('[data-delete-entry]').forEach(btn => {
    btn.addEventListener('click', () => deleteEntry(btn.dataset.deleteEntry));
  });
  // v3.9.13: usamos event delegation a nivel document (más abajo, una sola vez)
  // así no dependemos de re-bindear cada renderEntries.
  area.querySelectorAll('[data-reuse]').forEach(btn => {
    btn.addEventListener('click', () => reuseEntry(btn.dataset.reuse));
  });
  area.querySelectorAll('[data-move]').forEach(btn => {
    btn.addEventListener('click', () => showMoveModal(btn.dataset.move));
  });
}

// Tracking de fetches en curso para no repetir DENTRO de esta sesion.
// Reintenta entries con coverImage=null en cada arranque por si mejoramos el
// fetcher (asi entries viejas de Instagram pueden recuperar su thumbnail).
const ogFetchInFlight = new Set();
const ogFetchedThisSession = new Set();
const dimensionsFetchInFlight = new Set();

// Para entries que tienen coverImage pero les faltan las dimensiones (porque
// se guardaron antes de v2.47), las detectamos del lado del cliente cargando
// la imagen y leyendo naturalWidth/naturalHeight.
async function ensureCoverDimensions(entries) {
  for (const entry of entries) {
    if (!entry.coverImage) continue;
    if (entry.coverWidth && entry.coverHeight) continue;
    if (dimensionsFetchInFlight.has(entry.id)) continue;
    dimensionsFetchInFlight.add(entry.id);
    const img = new Image();
    img.onload = async () => {
      try {
        if (img.naturalWidth && img.naturalHeight) {
          await db.collection('depositEntries').doc(entry.id).update({
            coverWidth: img.naturalWidth,
            coverHeight: img.naturalHeight
          });
        }
      } catch (e) { /* ignore */ }
      dimensionsFetchInFlight.delete(entry.id);
    };
    img.onerror = () => dimensionsFetchInFlight.delete(entry.id);
    img.src = entry.coverImage;
  }
}

// Migracion v5: detecta covers ROTOS de Instagram y los limpia para re-fetch.
// Casos detectados:
//   - URL lookaside.instagram.com (302 redirige a HTML, no carga como imagen)
//   - URL static.cdninstagram.com/rsrc.php (logo generico de IG, fallback de
//     Microlink cuando no consigue scrapear)
// Tras el clear, lazyFetchCovers corre el fetcher mejorado (extrae srcset del
// embed que devuelve URLs scontent.cdninstagram.com REALES que sí cargan).
const coverMigratedThisSession = new Set();
function looksLikeBrokenIgCover(entry) {
  const img = (entry.coverImage || '').toLowerCase();
  if (!img) return false;
  if (img.includes('lookaside.instagram.com')) return true;
  if (img.includes('static.cdninstagram.com/rsrc.php')) return true;
  if (img.includes('static.xx.fbcdn.net/rsrc.php')) return true;
  return false;
}
async function migrateCovers(visibleEntries) {
  for (const entry of visibleEntries) {
    if (coverMigratedThisSession.has(entry.id)) continue;
    if (entry.coverFetcherV >= 6) continue;
    coverMigratedThisSession.add(entry.id);

    const isInstagramLink = (entry.links || []).some(l => /instagram\.com\//.test(l.url || ''));
    const isBroken = looksLikeBrokenIgCover(entry);

    if (isInstagramLink && isBroken) {
      try {
        await db.collection('depositEntries').doc(entry.id).update({
          coverImage: firebase.firestore.FieldValue.delete(),
          coverWidth: firebase.firestore.FieldValue.delete(),
          coverHeight: firebase.firestore.FieldValue.delete(),
          coverFetcherV: 6
        });
      } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
    } else {
      try { await db.collection('depositEntries').doc(entry.id).update({ coverFetcherV: 6 }); } catch (_) {}
    }
  }
}

async function lazyFetchCovers(visibleEntries) {
  // Antes de re-fetchear lo que falta, migrar covers viejos (logos de marca,
  // carruseles 1:1 recortados, etc.) — los limpia para que se re-descarguen
  migrateCovers(visibleEntries);
  for (const entry of visibleEntries) {
    if (entry.coverImage) continue; // ya tiene imagen real, no reintentamos
    const links = entry.links || [];
    if (links.length === 0) continue;
    if (ogFetchInFlight.has(entry.id) || ogFetchedThisSession.has(entry.id)) continue;
    ogFetchInFlight.add(entry.id);
    const url = links[0].url;
    // Atajo Cloudinary video: thumb por transformacion de URL, sin fetcher.
    // Asumimos 9:16 porque la mayoria de los videos subidos a Cloudinary son
    // reels verticales — si no, la imagen se ajusta igual con object-fit.
    const cdnThumb = cloudinaryVideoThumb(url);
    if (cdnThumb) {
      try {
        await db.collection('depositEntries').doc(entry.id).update({
          coverImage: cdnThumb,
          coverWidth: 1080,
          coverHeight: 1920,
          coverFetcherV: 6
        });
        try {
          const tasksSnap = await db.collection('tasks').where('depositEntryId', '==', entry.id).get();
          const batch = db.batch();
          let count = 0;
          tasksSnap.forEach(d => {
            batch.update(d.ref, { coverImage: cdnThumb, coverWidth: 1080, coverHeight: 1920 });
            count++;
          });
          if (count > 0) await batch.commit();
        } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }
      ogFetchInFlight.delete(entry.id);
      ogFetchedThisSession.add(entry.id);
      continue;
    }
    try {
      const og = await window.api.fetchOgData(url);
      const update = { coverImage: og.image || null, coverFetcherV: 6 };
      if (og.imageWidth && og.imageHeight) {
        update.coverWidth = og.imageWidth;
        update.coverHeight = og.imageHeight;
      }
      await db.collection('depositEntries').doc(entry.id).update(update);
      // Propagar la portada a tareas vinculadas (depositEntryId === entry.id).
      // Asi tareas que ya estan creadas y mostraban placeholder se actualizan
      // con la imagen real cuando el fetcher funciona.
      if (update.coverImage) {
        try {
          const tasksSnap = await db.collection('tasks').where('depositEntryId', '==', entry.id).get();
          const batch = db.batch();
          let count = 0;
          tasksSnap.forEach(d => {
            const taskUpdate = { coverImage: update.coverImage };
            if (update.coverWidth) taskUpdate.coverWidth = update.coverWidth;
            if (update.coverHeight) taskUpdate.coverHeight = update.coverHeight;
            batch.update(d.ref, taskUpdate);
            count++;
          });
          if (count > 0) await batch.commit();
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    ogFetchInFlight.delete(entry.id);
    ogFetchedThisSession.add(entry.id);
  }
}

function shortUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.slice(0, 18) + (u.pathname.length > 18 ? '...' : '') : '');
  } catch (e) { return url.slice(0, 30); }
}

async function deleteEntry(entryId) {
  const e = entries.find(x => x.id === entryId);
  if (!e) return;
  if (!confirm(`Eliminar la idea "${e.title || 'sin titulo'}"?`)) return;
  await db.collection('depositEntries').doc(entryId).delete();
  toast('Idea eliminada');
}

// Modal: nueva/editar entrada
document.getElementById('newEntryBtn').addEventListener('click', () => showEntryModal());
// Preview en vivo de las URLs publicas (Cloudinary) al escribir
const entryMediaUrlsInputEl = document.getElementById('entryMediaUrlsInput');
if (entryMediaUrlsInputEl) {
  entryMediaUrlsInputEl.addEventListener('input', () => {
    const lines = entryMediaUrlsInputEl.value.split(/\r?\n/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s));
    updateMediaUrlsPreview(lines[0] || '');
  });
}
document.getElementById('cancelEntry').addEventListener('click', hideEntryModal);
document.getElementById('addLinkBtn').addEventListener('click', () => addLinkRow());
document.getElementById('confirmEntry').addEventListener('click', saveEntry);

function showEntryModal(entryId) {
  editingEntryId = entryId || null;
  document.getElementById('entryModalTitle').textContent = entryId ? 'Editar idea' : 'Nueva idea';
  document.getElementById('entryLinksWrap').innerHTML = '';

  // Llenar selector de subcategoria segun la categoria de la idea (o la actualmente seleccionada)
  const e = entryId ? entries.find(x => x.id === entryId) : null;
  const contextCatId = e ? e.categoryId : selectedCategoryId;
  const subSel = document.getElementById('entrySubcategorySelect');
  const subs = (contextCatId && contextCatId !== '__all_categories__')
    ? subcategoriesOf(contextCatId)
    : [];
  subSel.innerHTML = '<option value="">Sin clasificar</option>' +
    subs.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  // Mostrar el row solo si hay subcategorias disponibles o la idea ya tiene una
  const hasSubsAvailable = subs.length > 0;
  document.getElementById('entrySubcategoryRow').style.display = hasSubsAvailable ? 'block' : 'none';

  if (entryId && e) {
    document.getElementById('entryTitleInput').value = e.title || '';
    document.getElementById('entryDescInput').value = e.description || '';
    if (e.subcategoryId) subSel.value = e.subcategoryId;
    (e.links || []).forEach(l => addLinkRow(l));
    // Pre-rellenar URLs publicas si la entry ya tiene
    const urls = Array.isArray(e.mediaUrls) ? e.mediaUrls : [];
    document.getElementById('entryMediaUrlsInput').value = urls.join('\n');
    updateMediaUrlsPreview(urls[0] || '');
  } else {
    document.getElementById('entryTitleInput').value = '';
    document.getElementById('entryDescInput').value = '';
    // Si estamos en una sub, pre-seleccionarla
    if (selectedSubcategoryId && selectedSubcategoryId !== '__unsorted__') {
      subSel.value = selectedSubcategoryId;
    }
    addLinkRow({ type: 'video', url: '', label: '' });
    document.getElementById('entryMediaUrlsInput').value = '';
    updateMediaUrlsPreview('');
  }
  document.getElementById('entryModal').classList.add('active');
  setTimeout(() => document.getElementById('entryTitleInput').focus(), 100);
}

function updateMediaUrlsPreview(firstUrl) {
  const preview = document.getElementById('entryMediaUrlsPreview');
  const img = document.getElementById('entryMediaUrlsPreviewImg');
  if (firstUrl && /^https?:\/\//i.test(firstUrl)) {
    preview.style.display = 'block';
    img.src = firstUrl;
  } else {
    preview.style.display = 'none';
    img.src = '';
  }
}

function hideEntryModal() {
  document.getElementById('entryModal').classList.remove('active');
  editingEntryId = null;
}

function addLinkRow(link) {
  link = link || { type: 'material', url: '', label: '' };
  const wrap = document.getElementById('entryLinksWrap');
  const row = document.createElement('div');
  row.className = 'link-row';
  row.innerHTML = `
    <div class="link-row-top">
      <select class="link-type">
        <option value="video"${link.type === 'video' ? ' selected' : ''}>Video</option>
        <option value="carrusel"${link.type === 'carrusel' ? ' selected' : ''}>Carrusel</option>
        <option value="material"${link.type === 'material' ? ' selected' : ''}>Material</option>
        <option value="recurso"${link.type === 'recurso' ? ' selected' : ''}>Recurso</option>
      </select>
      <button class="remove-link" title="Quitar este link">&times;</button>
    </div>
    <input type="url" class="link-url" placeholder="https://..." value="${esc(link.url || '')}">
    <input type="text" class="link-label" placeholder="Etiqueta o descripcion (opcional)" value="${esc(link.label || '')}">
    <div class="link-preview" style="display:none"></div>`;
  row.querySelector('.remove-link').addEventListener('click', () => row.remove());

  // Vista previa Open Graph (estilo WhatsApp) — se actualiza al pegar/escribir el URL
  const urlInput = row.querySelector('.link-url');
  const previewEl = row.querySelector('.link-preview');
  let previewTimer = null;
  let lastFetchedUrl = '';
  const renderPreviewCard = (url, og) => {
    const svc = serviceFromUrl(url);
    let domain = url;
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
    const imgHtml = og && og.image
      ? `<div class="link-preview-img" style="background-image:url('${esc(og.image)}')"></div>`
      : `<div class="link-preview-img link-preview-img-placeholder" style="background:${svc.gradient}">${svc.icon}</div>`;
    const title = (og && og.title) ? og.title : svc.name;
    const descHtml = (og && og.description) ? `<div class="link-preview-desc">${esc(og.description)}</div>` : '';
    previewEl.innerHTML = `
      <div class="link-preview-card" data-preview-open="${esc(url)}">
        ${imgHtml}
        <div class="link-preview-body">
          <div class="link-preview-title">${esc(title)}</div>
          ${descHtml}
          <div class="link-preview-domain">${esc(domain)}</div>
        </div>
      </div>`;
    previewEl.style.display = 'block';
    const card = previewEl.querySelector('[data-preview-open]');
    if (card) card.addEventListener('click', () => window.api.openExternal(url));
  };
  const updatePreview = async () => {
    const url = parseUrl(urlInput.value);
    if (!url || !/^https?:\/\//i.test(url)) {
      previewEl.style.display = 'none';
      previewEl.innerHTML = '';
      lastFetchedUrl = '';
      return;
    }
    if (url === lastFetchedUrl) return;
    lastFetchedUrl = url;
    // Atajo Cloudinary video: la URL del thumbnail se genera por transformacion,
    // no necesitamos pegarle al fetcher.
    const cdnThumb = cloudinaryVideoThumb(url);
    if (cdnThumb) {
      renderPreviewCard(url, { image: cdnThumb, title: 'Video' });
      return;
    }
    // Pintar INMEDIATAMENTE el placeholder con dominio/icono. El usuario nunca
    // ve "Cargando..." colgado: ve la card al instante y se actualiza despues
    // si el fetcher logra obtener la imagen real.
    renderPreviewCard(url, null);
    try {
      const og = await window.api.fetchOgData(url);
      if (lastFetchedUrl !== url) return; // cambio mientras esperabamos
      if (og && (og.image || og.title || og.description)) {
        renderPreviewCard(url, og);
      }
      // Si og no trajo nada, dejamos el placeholder que ya esta pintado
    } catch (e) { /* placeholder ya pintado */ }
  };
  urlInput.addEventListener('input', () => {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 700);
  });
  urlInput.addEventListener('paste', () => {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 100); // mas rapido al pegar
  });
  // Si la fila se carga ya con un URL (modo edicion), disparar preview inmediato
  if (link.url) setTimeout(updatePreview, 50);

  wrap.appendChild(row);
}

async function saveEntry() {
  const title = document.getElementById('entryTitleInput').value.trim();
  if (!title) { document.getElementById('entryTitleInput').focus(); return; }
  const description = document.getElementById('entryDescInput').value.trim();
  const rows = document.querySelectorAll('#entryLinksWrap .link-row');
  const links = [];
  rows.forEach(r => {
    const url = parseUrl(r.querySelector('.link-url').value);
    if (!url) return;
    links.push({
      type: r.querySelector('.link-type').value,
      url,
      label: r.querySelector('.link-label').value.trim()
    });
  });

  // Parsear URLs publicas (Cloudinary etc.) para programar
  const mediaUrlsRaw = document.getElementById('entryMediaUrlsInput').value || '';
  const mediaUrls = mediaUrlsRaw.split(/\r?\n/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s));

  if (editingEntryId) {
    // Editar: cambia campos editables, permite mover entre subcategorias
    const chosenSubId = document.getElementById('entrySubcategorySelect').value;
    const updateData = { title, description, links };
    // Guardar mediaUrls (array). Si no hay, borrar campo.
    if (mediaUrls.length > 0) {
      updateData.mediaUrls = mediaUrls;
      // Si el usuario pone URLs publicas, usamos la primera como cover (mejor que el OG scrape).
      updateData.coverImage = mediaUrls[0];
      updateData.coverFetcherV = 99; // marca para no re-scrapear OG
    } else {
      updateData.mediaUrls = firebase.firestore.FieldValue.delete();
    }
    if (chosenSubId) {
      const subCat = categories.find(c => c.id === chosenSubId);
      updateData.subcategoryId = chosenSubId;
      updateData.subcategoryName = subCat ? subCat.name : '';
    } else {
      updateData.subcategoryId = firebase.firestore.FieldValue.delete();
      updateData.subcategoryName = firebase.firestore.FieldValue.delete();
    }
    await db.collection('depositEntries').doc(editingEntryId).update(updateData);
    toast('Idea actualizada');
  } else {
    // Crear: usar la categoria actual y la sub del selector (si hay)
    const catId = selectedCategoryId === '__all_categories__' ? null : selectedCategoryId;
    if (!catId) { toast('Entra a una categoria primero para crear la idea', 'error'); return; }
    const chosenSubId = document.getElementById('entrySubcategorySelect').value;
    const data = {
      title, description, links,
      categoryId: catId,
      categoryName: categories.find(c => c.id === catId)?.name || '',
      status: 'idea',
      createdBy: currentUser.uid,
      createdByName: currentUserData.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (mediaUrls.length > 0) {
      data.mediaUrls = mediaUrls;
      data.coverImage = mediaUrls[0];
      data.coverFetcherV = 99;
    }
    if (chosenSubId) {
      const subCat = categories.find(c => c.id === chosenSubId);
      data.subcategoryId = chosenSubId;
      data.subcategoryName = subCat ? subCat.name : '';
    } else if (selectedSubcategoryId && selectedSubcategoryId !== '__unsorted__') {
      data.subcategoryId = selectedSubcategoryId;
      data.subcategoryName = categories.find(c => c.id === selectedSubcategoryId)?.name || '';
    }
    await db.collection('depositEntries').add(data);
    toast('Idea agregada al deposito');
  }
  hideEntryModal();
}

// ===== ASSIGN AS TASK =====
function renderProjectSelect() {
  const s = document.getElementById('assignProject');
  if (!s) return;
  const current = s.value;
  s.innerHTML = '<option value="">Elige proyecto...</option>' +
    projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (current) s.value = current;
}

function renderMemberSelects() {
  const memberOptions = '<option value="">Elige miembro...</option>' +
    teamMembers.map(m => `<option value="${esc(m.id)}">${esc(m.name)}${m.id === (currentUser && currentUser.uid) ? ' (yo)' : ''}</option>`).join('');
  const single = document.getElementById('assignSingleMember');
  if (single) {
    const v = single.value;
    single.innerHTML = memberOptions;
    if (v) single.value = v;
  }
  // Refrescar selects de cadena
  document.querySelectorAll('#chainSteps .chain-member').forEach(sel => {
    const v = sel.value;
    sel.innerHTML = memberOptions;
    if (v) sel.value = v;
  });
}

document.querySelectorAll('.assign-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    assignMode = btn.dataset.mode;
    document.querySelectorAll('.assign-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === assignMode);
      b.style.background = b.dataset.mode === assignMode ? 'var(--accent)' : '';
      b.style.color = b.dataset.mode === assignMode ? 'white' : '';
    });
    document.getElementById('assignSingleWrap').style.display = assignMode === 'single' ? 'block' : 'none';
    document.getElementById('assignChainWrap').style.display = assignMode === 'chain' ? 'block' : 'none';
    const multiWrap = document.getElementById('assignMultiWrap');
    if (multiWrap) multiWrap.style.display = assignMode === 'multi' ? 'block' : 'none';
    if (assignMode === 'multi') renderMultiMembersList();
    // Si entro a modo cadena en "Tomar Tarea", pre-cargar el primer paso con el usuario actual
    if (assignMode === 'chain') {
      const chainWrap = document.getElementById('chainSteps');
      const takeForMe = document.getElementById('assignModal').dataset.takeForMe === '1';
      if (chainWrap.children.length === 0) {
        addChainStep();
        if (takeForMe) {
          const firstSelect = chainWrap.querySelector('.chain-member');
          if (firstSelect) firstSelect.value = currentUser.uid;
        }
      }
    }
  });
});

// Render lista de miembros con checkbox + input rol para modo multi-tarea
function renderMultiMembersList() {
  const wrap = document.getElementById('multiMembersList');
  if (!wrap) return;
  if (wrap.children.length > 0) return; // ya renderizado
  wrap.innerHTML = teamMembers.map(m => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;cursor:pointer">
      <input type="checkbox" class="multi-member-check" value="${esc(m.id)}" data-name="${esc(m.name)}" style="margin:0">
      <span style="flex:1;font-size:13px">${esc(m.name)}</span>
      <input type="text" class="multi-member-role" placeholder="Rol (ej: guion, edicion)" style="flex:1;min-width:140px;font-size:12px;padding:4px 8px">
    </label>
  `).join('');
}

document.getElementById('addChainStep').addEventListener('click', () => addChainStep());

function addChainStep() {
  const wrap = document.getElementById('chainSteps');
  const row = document.createElement('div');
  row.className = 'assign-step';
  const memberOptions = '<option value="">Miembro...</option>' +
    teamMembers.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  row.innerHTML = `
    <span style="font-size:11px;color:var(--text-secondary);min-width:22px">${wrap.children.length + 1}.</span>
    <select class="chain-member">${memberOptions}</select>
    <input type="number" class="chain-days" placeholder="Dias" min="1" style="width:75px">
    <button class="remove-step" title="Quitar">&times;</button>`;
  row.querySelector('.remove-step').addEventListener('click', () => {
    row.remove();
    renumberChainSteps();
  });
  wrap.appendChild(row);
}

function renumberChainSteps() {
  document.querySelectorAll('#chainSteps .assign-step').forEach((row, i) => {
    row.querySelector('span').textContent = `${i + 1}.`;
  });
}

function showAssignModal(entryId, opts) {
  const e = entries.find(x => x.id === entryId);
  if (!e) return;
  assigningEntry = e;
  const takeForMe = !!(opts && opts.takeForMe);
  document.getElementById('assignIdeaPreview').textContent = e.title;
  document.getElementById('assignSingleMember').value = takeForMe ? currentUser.uid : '';
  document.getElementById('assignSingleAmount').value = '';
  document.getElementById('assignSingleUnit').value = 'days';
  document.getElementById('assignProject').value = '';
  document.getElementById('chainSteps').innerHTML = '';
  assignMode = 'single';
  document.querySelectorAll('.assign-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === 'single');
    b.style.background = b.dataset.mode === 'single' ? 'var(--accent)' : '';
    b.style.color = b.dataset.mode === 'single' ? 'white' : '';
  });
  document.getElementById('assignSingleWrap').style.display = 'block';
  document.getElementById('assignChainWrap').style.display = 'none';
  // Si es "tomar para mi", al cambiar a cadena, el primer paso sera el usuario actual
  document.getElementById('assignModal').dataset.takeForMe = takeForMe ? '1' : '0';
  document.getElementById('assignModal').classList.add('active');
}

document.getElementById('cancelAssign').addEventListener('click', () => {
  document.getElementById('assignModal').classList.remove('active');
  assigningEntry = null;
});

document.getElementById('confirmAssign').addEventListener('click', async () => {
  if (!assigningEntry) return;
  const projectId = document.getElementById('assignProject').value;
  if (!projectId) { toast('Elige un proyecto', 'error'); return; }
  const project = projects.find(p => p.id === projectId);

  // Tomar solo el primer link de cada tipo para las casillas de la tarea.
  // Carruseles tambien se mapean al slot videoLink para que la preview se muestre.
  const links = assigningEntry.links || [];
  const recordedVids = Array.isArray(assigningEntry.recordedVideos) ? assigningEntry.recordedVideos : [];
  const lastRecordedUrl = recordedVids.length > 0 ? recordedVids[recordedVids.length - 1].url : null;
  // v3.11.54: cambio de prioridad — videoLink ahora prefiere el LINK DE REFERENCIA
  // (reel de IG / TikTok original) sobre la grabación. La grabación ya queda
  // en task.recordedVideos como "🎬 Grabación" (chip naranja). videoLink se
  // renderiza como "🎬 Video de referencia" (chip rojo). El editor ve los dos.
  let videoLink = links.find(l => l.type === 'video')?.url
    || links.find(l => l.type === 'carrusel')?.url;
  let materialLink = links.find(l => l.type === 'material')?.url
    || links.find(l => l.type === 'recurso')?.url;
  // Si NO hay link de video pero SÍ grabación: la grabación va también como videoLink
  // (así el editor tiene preview ya sea por la grabación, ya sea por el reel).
  if (!videoLink && lastRecordedUrl) videoLink = lastRecordedUrl;
  // Fallback total: si no se mapeo nada, usar el primer link de cualquier tipo
  if (!videoLink && !materialLink && links.length > 0) {
    videoLink = links[0].url;
  }

  const baseText = assigningEntry.title;
  const createdTaskIds = [];

  if (assignMode === 'single') {
    const memberId = document.getElementById('assignSingleMember').value;
    if (!memberId) { toast('Elige a quien asignar', 'error'); return; }
    const member = teamMembers.find(m => m.id === memberId);
    const amount = parseInt(document.getElementById('assignSingleAmount').value);
    const unit = document.getElementById('assignSingleUnit').value || 'days';

    const taskData = {
      text: baseText,
      projectId,
      projectName: project.name,
      projectColor: project.color || '#666',
      assignedTo: memberId,
      assignedToName: member.name,
      createdBy: currentUser.uid,
      createdByName: currentUserData.name,
      status: 'pending',
      source: 'deposito',
      notes: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (videoLink) taskData.videoLink = videoLink;
    if (materialLink) taskData.link = materialLink;
    // Referencia inversa para sincronizar el deposito con el ciclo de vida de la tarea
    taskData.depositEntryId = assigningEntry.id;
    // Copiar la portada (OG image) y dimensiones para que la tarea muestre la
    // misma miniatura que la entry en el deposito.
    if (assigningEntry.coverImage) {
      taskData.coverImage = assigningEntry.coverImage;
      if (assigningEntry.coverWidth) taskData.coverWidth = assigningEntry.coverWidth;
      if (assigningEntry.coverHeight) taskData.coverHeight = assigningEntry.coverHeight;
    }
    // v3.10.2: propagar mediaUrls + videos grabados para que el editor los vea en su tarea
    if (Array.isArray(assigningEntry.mediaUrls) && assigningEntry.mediaUrls.length > 0) {
      taskData.mediaUrls = assigningEntry.mediaUrls.slice();
    }
    if (recordedVids.length > 0) {
      taskData.recordedVideos = recordedVids.slice();
    }
    if (amount && amount > 0) {
      const deadline = new Date();
      if (unit === 'minutes') deadline.setMinutes(deadline.getMinutes() + amount);
      else if (unit === 'hours') deadline.setHours(deadline.getHours() + amount);
      else deadline.setDate(deadline.getDate() + amount);
      taskData.deadline = firebase.firestore.Timestamp.fromDate(deadline);
      taskData.deadlineUnit = unit;
      taskData.deadlineAmount = amount;
    }
    const ref = await db.collection('tasks').add(taskData);
    createdTaskIds.push(ref.id);
    toast(`Tarea asignada a ${member.name}`);
  } else if (assignMode === 'multi') {
    // Multi-tarea: una sola tarea con varios asignados. Cada uno marca su parte.
    const checks = Array.from(document.querySelectorAll('.multi-member-check:checked'));
    if (checks.length < 2) { toast('Selecciona al menos 2 miembros para multi-tarea', 'error'); return; }
    const memberIds = checks.map(c => c.value);
    const memberNames = checks.map(c => c.dataset.name);
    const roles = {};
    const completions = {};
    checks.forEach(c => {
      const role = c.parentElement.querySelector('.multi-member-role').value.trim();
      if (role) roles[c.value] = role;
      completions[c.value] = false;
    });
    const amount = parseInt(document.getElementById('assignMultiAmount').value);
    const unit = document.getElementById('assignMultiUnit').value || 'days';
    // El primer asignado va en assignedTo (compat con UI existente).
    const firstId = memberIds[0];
    const firstName = memberNames[0];
    const taskData = {
      text: baseText,
      projectId,
      projectName: project.name,
      projectColor: project.color || '#666',
      assignedTo: firstId,
      assignedToName: firstName,
      assignmentType: 'multi',
      assignedToMulti: memberIds,
      assignedToMultiNames: memberNames,
      multiCompletions: completions,
      multiRoles: roles,
      createdBy: currentUser.uid,
      createdByName: currentUserData.name,
      status: 'pending',
      source: 'deposito',
      notes: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (videoLink) taskData.videoLink = videoLink;
    if (materialLink) taskData.link = materialLink;
    taskData.depositEntryId = assigningEntry.id;
    if (assigningEntry.coverImage) {
      taskData.coverImage = assigningEntry.coverImage;
      if (assigningEntry.coverWidth) taskData.coverWidth = assigningEntry.coverWidth;
      if (assigningEntry.coverHeight) taskData.coverHeight = assigningEntry.coverHeight;
    }
    if (assigningEntry.mediaUrls) taskData.mediaUrls = assigningEntry.mediaUrls;
    if (recordedVids.length > 0) taskData.recordedVideos = recordedVids.slice();
    if (amount && amount > 0) {
      const deadline = new Date();
      if (unit === 'minutes') deadline.setMinutes(deadline.getMinutes() + amount);
      else if (unit === 'hours') deadline.setHours(deadline.getHours() + amount);
      else deadline.setDate(deadline.getDate() + amount);
      taskData.deadline = firebase.firestore.Timestamp.fromDate(deadline);
      taskData.deadlineUnit = unit;
      taskData.deadlineAmount = amount;
    }
    const ref = await db.collection('tasks').add(taskData);
    createdTaskIds.push(ref.id);
    // Notificar a TODOS via Telegram (encolar via Firestore notif queue)
    for (const memberId of memberIds) {
      const m = teamMembers.find(x => x.id === memberId);
      if (m && m.telegramChatId && m.id !== currentUser.uid) {
        const role = roles[memberId];
        const otherNames = memberNames.filter(n => n !== m.name).join(', ');
        const roleLine = role ? `\nTu rol: *${role}*` : '';
        const msg = `*${currentUserData.name}* te asigno una multi-tarea junto a ${otherNames}:\n*${baseText}*\nProyecto: *${project.name}*${roleLine}\n\nLa tarea queda completada cuando TODOS marquen su parte como hecha.`;
        try {
          await db.collection('notifications').add({
            chatId: String(m.telegramChatId),
            message: msg,
            status: 'pending',
            createdBy: currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) { /* fallback silenciosamente */ }
      }
    }
    toast(`Multi-tarea asignada a ${memberIds.length} miembros`);
  } else {
    // Cadena multi-paso
    const steps = [];
    document.querySelectorAll('#chainSteps .assign-step').forEach(row => {
      const mid = row.querySelector('.chain-member').value;
      const days = parseInt(row.querySelector('.chain-days').value) || null;
      if (mid) steps.push({ memberId: mid, days });
    });
    if (steps.length === 0) { toast('Agrega al menos un paso a la cadena', 'error'); return; }

    let prevTaskId = null;
    let prevText = null;
    let prevName = null;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const member = teamMembers.find(m => m.id === s.memberId);
      if (!member) continue;
      const stepLabel = steps.length > 1 ? ` (paso ${i + 1}/${steps.length})` : '';
      const taskData = {
        text: baseText + stepLabel,
        projectId,
        projectName: project.name,
        projectColor: project.color || '#666',
        assignedTo: s.memberId,
        assignedToName: member.name,
        createdBy: currentUser.uid,
        createdByName: currentUserData.name,
        status: 'pending',
        source: 'deposito',
        notes: [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (videoLink) taskData.videoLink = videoLink;
      if (materialLink) taskData.link = materialLink;
      if (s.days) {
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + s.days);
        taskData.deadline = firebase.firestore.Timestamp.fromDate(deadline);
        taskData.deadlineUnit = 'days';
        taskData.deadlineAmount = s.days;
      }
      if (prevTaskId) {
        taskData.dependsOn = prevTaskId;
        taskData.dependsOnText = prevText;
        taskData.dependsOnAssigneeName = prevName;
      }
      const ref = await db.collection('tasks').add(taskData);
      createdTaskIds.push(ref.id);
      prevTaskId = ref.id;
      prevText = taskData.text;
      prevName = member.name;
    }
    toast(`Cadena de ${createdTaskIds.length} tareas creada`);
  }

  // Marcar entrada como convertida (en proceso). Guardar categoria original
  // para poder restaurarla si la tarea se cancela/elimina antes de completarse.
  const conversionUpdate = {
    status: 'converted',
    convertedAt: firebase.firestore.FieldValue.serverTimestamp(),
    convertedTaskIds: firebase.firestore.FieldValue.arrayUnion(...createdTaskIds)
  };
  // Solo guardar originalCategoryId la PRIMERA vez (no sobrescribir si ya existe
  // por una asignacion-restauracion anterior).
  if (!assigningEntry.originalCategoryId) {
    conversionUpdate.originalCategoryId = assigningEntry.categoryId;
    conversionUpdate.originalCategoryName = assigningEntry.categoryName || null;
    conversionUpdate.originalSubcategoryId = assigningEntry.subcategoryId || null;
    conversionUpdate.originalSubcategoryName = assigningEntry.subcategoryName || null;
  }
  await db.collection('depositEntries').doc(assigningEntry.id).update(conversionUpdate);

  document.getElementById('assignModal').classList.remove('active');
  assigningEntry = null;
});

// Toggle vista sidebar vertical/horizontal (un solo boton que alterna)
// Aplicamos estilos inline directamente para no depender del CSS (mas robusto)
const SIDEBAR_MODE_KEY = 'deposit-sidebar-mode';
const SIDEBAR_HORIZONTAL_HEIGHT_KEY = 'deposit-sidebar-horizontal-height';
const SIDEBAR_HORIZONTAL_DEFAULT_HEIGHT = 210;
const SIDEBAR_HORIZONTAL_MIN_HEIGHT = 80;
const SIDEBAR_HORIZONTAL_MAX_HEIGHT_RATIO = 0.7; // max 70% de la altura de la ventana
let currentSidebarMode = 'vertical';

function getSavedHorizontalHeight() {
  try {
    const v = parseInt(localStorage.getItem(SIDEBAR_HORIZONTAL_HEIGHT_KEY), 10);
    if (Number.isFinite(v) && v >= SIDEBAR_HORIZONTAL_MIN_HEIGHT) return v;
  } catch (e) {}
  return SIDEBAR_HORIZONTAL_DEFAULT_HEIGHT;
}

function applySidebarHorizontalHeight(px) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const maxAllowed = Math.floor(window.innerHeight * SIDEBAR_HORIZONTAL_MAX_HEIGHT_RATIO);
  const h = Math.max(SIDEBAR_HORIZONTAL_MIN_HEIGHT, Math.min(maxAllowed, Math.round(px)));
  sidebar.style.height = h + 'px';
  sidebar.style.maxHeight = h + 'px';
  return h;
}

function applySidebarMode(mode, persist = true) {
  currentSidebarMode = mode;
  const app = document.querySelector('.app');
  const sidebar = document.querySelector('.sidebar');
  const catList = document.getElementById('categoryList');
  if (!app || !sidebar) return;

  if (mode === 'horizontal') {
    app.classList.add('horizontal');
    app.style.flexDirection = 'column';
    sidebar.style.width = '100%';
    sidebar.style.minHeight = '0';
    sidebar.style.borderRight = 'none';
    sidebar.style.borderBottom = '1px solid var(--border)';
    if (catList) {
      catList.style.display = 'flex';
      catList.style.flexWrap = 'wrap';
      catList.style.gap = '6px';
      catList.style.overflowY = 'auto';
      catList.style.alignContent = 'flex-start';
    }
    // Restaurar altura guardada (o default) — el handle permite ajustarla
    applySidebarHorizontalHeight(getSavedHorizontalHeight());
  } else {
    app.classList.remove('horizontal');
    app.style.flexDirection = '';
    sidebar.style.width = '';
    sidebar.style.height = '';
    sidebar.style.maxHeight = '';
    sidebar.style.minHeight = '';
    sidebar.style.borderRight = '';
    sidebar.style.borderBottom = '';
    if (catList) {
      catList.style.display = '';
      catList.style.flexWrap = '';
      catList.style.gap = '';
      catList.style.overflowY = '';
      catList.style.alignContent = '';
    }
  }

  // El boton muestra la opcion a la que cambiaria al clic
  const icon = document.getElementById('viewToggleIcon');
  const label = document.getElementById('viewToggleLabel');
  if (icon && label) {
    if (mode === 'horizontal') { icon.innerHTML = '&#8801;'; label.textContent = 'Vertical'; }
    else { icon.innerHTML = '&#9776;'; label.textContent = 'Horizontal'; }
  }
  if (persist) {
    try { localStorage.setItem(SIDEBAR_MODE_KEY, mode); } catch (e) {}
  }
}

window.toggleSidebarMode = function () {
  console.log('[deposit] toggleSidebarMode antes:', currentSidebarMode);
  applySidebarMode(currentSidebarMode === 'horizontal' ? 'vertical' : 'horizontal');
  console.log('[deposit] toggleSidebarMode despues:', currentSidebarMode);
};
try { applySidebarMode(localStorage.getItem(SIDEBAR_MODE_KEY) || 'vertical'); } catch (e) {}

// Drag del divisor: solo funciona en modo horizontal. Permite ajustar la altura
// del area de categorias arrastrando la linea inferior.
(function setupSidebarResize() {
  const handle = document.getElementById('sidebarResizeHandle');
  const sidebar = document.querySelector('.sidebar');
  if (!handle || !sidebar) return;
  let dragging = false;
  let startY = 0;
  let startH = 0;
  handle.addEventListener('mousedown', (e) => {
    if (currentSidebarMode !== 'horizontal') return;
    dragging = true;
    startY = e.clientY;
    startH = sidebar.getBoundingClientRect().height;
    handle.classList.add('dragging');
    document.body.classList.add('sidebar-resizing');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const next = startH + (e.clientY - startY);
    applySidebarHorizontalHeight(next);
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.classList.remove('sidebar-resizing');
    const finalH = sidebar.getBoundingClientRect().height;
    try { localStorage.setItem(SIDEBAR_HORIZONTAL_HEIGHT_KEY, String(Math.round(finalH))); } catch (e) {}
  });
  // Si se redimensiona la ventana, re-clampear la altura para no exceder el max
  window.addEventListener('resize', () => {
    if (currentSidebarMode !== 'horizontal') return;
    applySidebarHorizontalHeight(sidebar.getBoundingClientRect().height);
  });
})();

// Escuchar cambios de modo enviados desde el proceso principal (modo PRO).
// payload: { mode: 'horizontal' | 'vertical' | 'restore', persist: boolean }
if (window.api && window.api.onSetViewMode) {
  window.api.onSetViewMode((payload) => {
    if (!payload || typeof payload !== 'object') return;
    const persist = payload.persist !== false;
    if (payload.mode === 'restore') {
      let saved = 'vertical';
      try { saved = localStorage.getItem(SIDEBAR_MODE_KEY) || 'vertical'; } catch (e) {}
      applySidebarMode(saved, false);
    } else if (payload.mode === 'horizontal' || payload.mode === 'vertical') {
      applySidebarMode(payload.mode, persist);
    }
  });
}

// Recibe instrucciones del proceso principal para navegar a una categoria
// especifica al abrir el deposito (ej. boton "Referencias" del main app)
if (window.api && window.api.onNavigate) {
  window.api.onNavigate((payload) => {
    if (!payload || !payload.categoryId) return;
    selectedCategoryId = payload.categoryId;
    selectedSubcategoryId = null;
    try { renderCategories(); } catch (e) {}
    try { renderEntries(); } catch (e) {}
  });
}

// Window controls
document.getElementById('btnMinimize').addEventListener('click', () => window.api.minimizeWindow());
document.getElementById('btnClose').addEventListener('click', () => window.api.closeWindow());
const btnRefreshAllD = document.getElementById('btnRefreshAll');
if (btnRefreshAllD) {
  btnRefreshAllD.addEventListener('click', () => {
    btnRefreshAllD.style.transition = 'transform 0.6s';
    btnRefreshAllD.style.transform = 'rotate(360deg)';
    setTimeout(() => { try { window.api.refreshAllWindows(); } catch (e) { location.reload(); } }, 200);
  });
}

// ESC: 1) si hay modal abierto, lo cierra; 2) si no, navega hacia atras
//   - Estoy dentro de una subcategoria  -> volver a la grilla de subs
//   - Estoy en la grilla de subs (cat seleccionada sin sub) -> deseleccionar categoria
//   - Estoy en "Todos las categorias" o nada seleccionado -> no-op
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const moveModalEl = document.getElementById('moveModal');
  const openModalEl = document.querySelector('.modal-overlay.active');
  if (openModalEl) {
    // Cerrar el modal abierto y no navegar
    hideCategoryModal();
    hideEntryModal();
    if (document.getElementById('assignModal')) document.getElementById('assignModal').classList.remove('active');
    if (moveModalEl) moveModalEl.classList.remove('active');
    return;
  }
  // No hay modal: navegar hacia atras
  if (selectedSubcategoryId) {
    selectedSubcategoryId = null;
    renderEntries();
    return;
  }
  if (selectedCategoryId && selectedCategoryId !== '__all_categories__') {
    selectedCategoryId = '__all_categories__';
    renderCategories();
    renderEntries();
    return;
  }
});

// Modal overlay click to close
['categoryModal', 'entryModal', 'assignModal'].forEach(id => {
  const m = document.getElementById(id);
  m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.remove('active');
  });
});

document.getElementById('categoryNameInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmCategory').click();
});


// ===== v3.9.0: Transcripción de videos via OpenAI Whisper + reescritura via Claude =====
// La API key se guarda en config/openai_{wsId} desde Settings de la app principal.
// El iframe lee la key via window.parent._getOpenaiApiKey() (mismo origen file://).

// v3.9.1: detecta si un link es transcribible (Whisper soporta archivos
// descargables — Cloudinary, direct URLs a mp4/mov/mp3/wav, etc).
// NO soporta: Instagram, TikTok, YouTube (URLs protegidas).
function isTranscribableLink(l) {
  if (!l || !l.url) return false;
  const url = l.url;
  // v3.9.15: ahora aceptamos plataformas protegidas — usamos Cobalt.tools para extraer
  // el URL real del video antes de mandarlo a Whisper.
  // Cloudinary video/raw — descargable directo
  if (/res\.cloudinary\.com\/.+\/(video|raw)\/upload\//i.test(url)) return true;
  // URL directa a archivo de audio/video
  if (/\.(mp4|mov|webm|m4v|m4a|mp3|wav|mpga|mpeg|flac|ogg|oga)(\?.*)?$/i.test(url)) return true;
  // Plataformas protegidas — Cobalt extrae
  if (/(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.com|twitter\.com|x\.com|reddit\.com|vimeo\.com|soundcloud\.com|twitch\.tv)/i.test(url)) return true;
  // Marcado como video — intentamos
  if (l.type === 'video') return true;
  return false;
}

// v3.9.15: detecta si el URL es de plataforma protegida que necesita extracción
function isProtectedPlatformUrl(url) {
  return /(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.com|twitter\.com|x\.com|reddit\.com|vimeo\.com|soundcloud\.com|twitch\.tv)/i.test(url);
}

// v3.9.19: devuelve { blob, ext } — necesitamos el ext correcto para Whisper.
async function extractAudioBlob(platformUrl) {
  if (!window.api || !window.api.extractAudioViaYtDlp) {
    throw new Error('extractAudioViaYtDlp no disponible. Update la app.');
  }
  const result = await window.api.extractAudioViaYtDlp(platformUrl);
  if (!result || !result.ok) {
    if (result && result.errorCode === 'NOT_INSTALLED') {
      // v3.11.38: la app intenta auto-descargar yt-dlp. Si llegamos acá es porque
      // la descarga también falló (sin internet, firewall, etc). Mensaje OS-aware.
      const isWin = /windows/i.test(navigator.userAgent) || /win64|win32/i.test(navigator.platform || '');
      const installCmd = isWin
        ? 'Probá con: winget install yt-dlp.yt-dlp (en PowerShell)\nO descargá yt-dlp.exe de github.com/yt-dlp/yt-dlp/releases'
        : 'Probá con: brew install yt-dlp (en Terminal)';
      throw new Error('No se pudo descargar yt-dlp automáticamente. ' + installCmd + '\n\nRevisá tu conexión y reintenta.');
    }
    throw new Error(result && result.error ? result.error : 'Extracción falló');
  }
  const binary = atob(result.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return {
    blob: new Blob([bytes.buffer], { type: result.mimeType || 'application/octet-stream' }),
    ext: result.ext || 'mp3',
    mimeType: result.mimeType || 'audio/mpeg'
  };
}

// v3.9.1: helper que devuelve la URL óptima de audio para mandar a Whisper.
// Para Cloudinary: usa transformación a mp3 64kbps (re-comprime).
// Para todo lo demás: devuelve la URL tal cual (Whisper acepta cualquier
// formato de audio/video soportado siempre que se pueda descargar).
function audioFetchUrl(videoUrl) {
  if (!videoUrl) return null;
  // Cloudinary: extraer audio comprimido
  if (/res\.cloudinary\.com\/.+\/video\/upload\//i.test(videoUrl)) {
    return videoUrl
      .replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, '.mp3')
      .replace(/\/video\/upload\//, '/video/upload/f_mp3,br_64k/');
  }
  // Otros: devolver URL tal cual
  return videoUrl;
}

// Mantener nombre legacy por compatibilidad con código v3.9.0
function cloudinaryAudioUrl(videoUrl) { return audioFetchUrl(videoUrl); }

async function getOpenaiKeyForIframe() {
  // El iframe corre dentro de la app principal — accedemos a la función expuesta
  try {
    if (window.parent && window.parent._getOpenaiApiKey) {
      return await window.parent._getOpenaiApiKey();
    }
  } catch (e) {}
  return null;
}

// v3.9.11: el botón Transcribir ahora abre el modal completo. Si la entry ya
// tiene transcripción, la muestra directo. Si no, ejecuta Whisper.
async function transcribeEntry(entryId, btn) {
  console.log('[transcribe] click received entryId=', entryId);
  const entry = entries.find(e => e.id === entryId);
  if (!entry) {
    alert('No se encontró la entry. Recargá la app.');
    return;
  }
  // Abrir modal con estado actual
  console.log('[transcribe] opening modal');
  openTranscriptionModal(entryId);
  // Si ya hay transcripción, no re-transcribir (a menos que sea desde "Re-transcribir")
  if (entry.transcription && (!btn || btn.dataset.action !== 'retry')) return;
  // Verificar video transcribible
  const videoLink = (entry.links || []).find(l => isTranscribableLink(l));
  if (!videoLink) {
    const protectedPlatforms = (entry.links || []).find(l => l && l.url && /(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com)/i.test(l.url));
    _setTranscriptionStatus(protectedPlatforms
      ? '❌ Video en plataforma protegida (IG/TikTok/YouTube). Subilo a Cloudinary primero.'
      : '❌ No hay video transcribible (necesito Cloudinary o URL directa a archivo).', 'error');
    return;
  }
  // v3.11.44: declaramos con `let` porque después hacemos trim sobre la key
  // antes de detectar el provider. v3.11.42 tenía `const` y `apiKey = ...trim()`
  // tiraba "Assignment to constant variable" — rompía toda la transcripción.
  let apiKey = await getOpenaiKeyForIframe();
  if (!apiKey) {
    _setTranscriptionStatus('❌ Configurá tu OpenAI API key en Settings de la app principal.', 'error');
    return;
  }
  try {
    let audioBlob;
    let filename = 'audio.mp3';
    // v3.9.17: si es URL de plataforma protegida (IG/TikTok/YouTube), usar yt-dlp
    // para descargar el audio directamente. yt-dlp maneja la extracción.
    if (isProtectedPlatformUrl(videoLink.url)) {
      const platform = videoLink.url.match(/(instagram|tiktok|youtube|youtu|facebook|twitter|x\.com|vimeo)/i)[0];
      // v3.11.38: la primera vez en esta máquina, la app descarga yt-dlp (~12MB win / 30MB mac)
      // antes de extraer — puede tardar 30-60s. Después queda cacheado y < 10s.
      _setTranscriptionStatus('🔄 Descargando audio con yt-dlp (' + platform + ')... Primera vez puede tardar hasta 60s, después es rápido.');
      const result = await extractAudioBlob(videoLink.url);
      audioBlob = result.blob;
      filename = 'audio.' + result.ext;
      _setTranscriptionStatus('🎤 Enviando ' + Math.round(audioBlob.size / 1024) + 'KB (' + result.ext + ') a Whisper...');
    } else {
      // URL directa o Cloudinary — fetch normal
      const audioUrl = audioFetchUrl(videoLink.url);
      _setTranscriptionStatus('⏳ Descargando audio...');
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) throw new Error('No se pudo bajar el audio (HTTP ' + audioRes.status + ')');
      const contentType = audioRes.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error('El URL devolvió HTML, no audio. Verificá que sea link directo a archivo o Cloudinary.');
      }
      audioBlob = await audioRes.blob();
      if (audioBlob.size < 1000) throw new Error('Archivo muy chico (' + audioBlob.size + ' bytes)');
      if (audioBlob.size > 25 * 1024 * 1024) throw new Error('Audio muy grande (>25MB)');
      // Filename según content-type para que Whisper acepte
      if (contentType.includes('video/mp4') || /\.mp4(\?|$)/i.test(audioUrl)) filename = 'audio.mp4';
      else if (contentType.includes('video/quicktime') || /\.mov(\?|$)/i.test(audioUrl)) filename = 'audio.mov';
      else if (contentType.includes('audio/wav') || /\.wav(\?|$)/i.test(audioUrl)) filename = 'audio.wav';
      else if (contentType.includes('video/webm') || /\.webm(\?|$)/i.test(audioUrl)) filename = 'audio.webm';
      _setTranscriptionStatus('🎤 Enviando a Whisper...');
    }
    // v3.11.42: trim defensivo
    apiKey = (apiKey || '').trim();
    const isGroqKey = apiKey.startsWith('gsk_');
    const providerLabel = isGroqKey ? 'Groq' : 'Whisper';
    const sizeKb = Math.round(audioBlob.size / 1024);
    _setTranscriptionStatus('📤 Enviando ' + sizeKb + 'KB a ' + providerLabel + ' (via Node)...');

    // v3.11.46: llamada via IPC al main process (Node https) en vez del XHR
    // del renderer. En Windows con firewall corporativo, Chromium fetch se
    // cuelga silenciosamente; Node usa el stack OS-nativo y suele funcionar.
    // Fallback a XHR si la IPC no está expuesta (versión vieja del preload).
    let transcript = '';
    if (window.api && typeof window.api.callTranscriptionApi === 'function') {
      // Convertir blob a base64 para enviar por IPC (Buffer no funciona en renderer)
      const audioBase64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result || '').toString().split(',')[1] || '';
          res(b64);
        };
        reader.onerror = () => rej(new Error('No se pudo convertir audio a base64'));
        reader.readAsDataURL(audioBlob);
      });
      const startedAt = Date.now();
      let heartbeat = setInterval(() => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        if (elapsed > 3) _setTranscriptionStatus('⏳ ' + providerLabel + ' transcribiendo... ' + elapsed + 's (audio ' + sizeKb + 'KB, ruta Node).');
      }, 2000);
      const ipcRes = await window.api.callTranscriptionApi({
        apiKey,
        audioBase64,
        mimeType: audioBlob.type || 'audio/mpeg',
        filename,
        isGroq: isGroqKey
      });
      clearInterval(heartbeat);
      if (!ipcRes || !ipcRes.ok) {
        const errMsg = (ipcRes && ipcRes.error) || 'Error desconocido';
        if (ipcRes && ipcRes.status === 403 && /country|region|territory/i.test(errMsg)) {
          throw new Error('OpenAI bloqueó por país (403). Pegá una key de Groq (gsk_...) en Settings → OpenAI API Key. console.groq.com es gratis.');
        }
        throw new Error(providerLabel + ' API: ' + errMsg);
      }
      transcript = (ipcRes.text || '').trim();
    } else {
      throw new Error('callTranscriptionApi no expuesto. Cerrá y reabrí la app (Quit completo) para que cargue el preload nuevo.');
    }
    if (!transcript) throw new Error('Transcripción vacía. ¿El video tiene audio?');
    await db.collection('depositEntries').doc(entryId).update({
      transcription: transcript,
      transcribedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    _setTranscriptionStatus('✓ Transcripción lista', 'success');
    setTimeout(() => _renderTranscriptionModalContent(entryId), 200);
  } catch (e) {
    _setTranscriptionStatus('❌ Error: ' + e.message, 'error');
  }
}

// v3.9.22: Tonos y estilos predefinidos para guiar la variación.
// Todos los guiones DEBEN empezar con hook viral de retención, mantener la idea
// pero presentarla distinto. Estos profiles ajustan tono y estructura.
const SCRIPT_TONOS = {
  educativo:     { label: 'Educativo',     desc: 'Tono claro, didáctico, como un profe explicando' },
  energetico:    { label: 'Energético',    desc: 'Ritmo rápido, frases cortas, mucha energía' },
  motivacional:  { label: 'Motivacional',  desc: 'Inspirador, llamado a la acción, transforma al espectador' },
  storytelling:  { label: 'Storytelling',  desc: 'Narrativo con conflicto y resolución, contás una historia' },
  controversial: { label: 'Controversial', desc: 'Provoca, cuestiona lo obvio, opina fuerte' },
  casual:        { label: 'Casual',        desc: 'Como charla con un amigo cercano, lenguaje coloquial' },
  dramatico:     { label: 'Dramático',     desc: 'Suspenso, tensión, pausas estratégicas' },
  neutro:        { label: 'Neutro',        desc: 'Tono balanceado, ni emocional ni frío' }
};
const SCRIPT_ESTILOS = {
  hook_dato:     { label: 'Hook + dato impactante', desc: 'Empezá con un dato/cifra que sorprenda' },
  pregunta:      { label: 'Pregunta provocadora',   desc: 'Empezá con una pregunta que active al espectador' },
  pasos:         { label: 'Lista de pasos',         desc: 'Estructura "1, 2, 3..." con cada paso accionable' },
  mito_realidad: { label: 'Mito vs realidad',       desc: 'Desmentí algo que la mayoría cree erróneamente' },
  antes_despues: { label: 'Antes / Después',        desc: 'Contraste de transformación, narrativa de cambio' },
  caso_real:     { label: 'Caso real',              desc: 'Ejemplo concreto narrado, alguien específico' },
  tutorial:      { label: 'Tutorial directo',       desc: 'Cómo hacer X en pocos pasos, sin rodeos' },
  comparativa:   { label: 'Comparativa',            desc: 'Comparás 2 opciones / 2 enfoques / 2 resultados' }
};

async function rewriteScriptForEntry(entryId, btn, opts) {
  const entry = entries.find(e => e.id === entryId);
  if (!entry || !entry.transcription) { alert('Primero transcribí el video.'); return; }
  if (!window.api || !window.api.generateWithClaude) {
    _setTranscriptionStatus('❌ generateWithClaude no disponible. Update la app.', 'error');
    return;
  }
  const tonoKey = (opts && opts.tono) || 'educativo';
  const estiloKey = (opts && opts.estilo) || 'hook_dato';
  const tono = SCRIPT_TONOS[tonoKey] || SCRIPT_TONOS.educativo;
  const estilo = SCRIPT_ESTILOS[estiloKey] || SCRIPT_ESTILOS.hook_dato;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando...'; }
  _setTranscriptionStatus(`⏳ Claude generando variación (${tono.label} · ${estilo.label})...`);
  try {
    const prompt = `Recreá el siguiente guion de video.

REGLAS OBLIGATORIAS:
1. EMPEZÁ con un HOOK VIRAL de retención de audiencia — los primeros 3 segundos definen si la persona se queda o pasa de largo. Sé brutal: dato impactante, pregunta provocadora, frase polémica, o lo que aplique según el estilo.
2. Mantené la MISMA idea/tema central y la duración aproximada (similar cantidad de palabras).
3. Cambiá las palabras, el ángulo, el orden — que NO sea reconocible como copia del original.
4. Cerralo con un cliffhanger, CTA o pregunta que mantenga al espectador hasta el final.
5. Escribilo en español neutro, listo para grabar.

PERFIL DE ESTA VARIACIÓN:
- Tono: ${tono.label} — ${tono.desc}
- Estilo: ${estilo.label} — ${estilo.desc}

DEVOLVÉ SOLO el guion nuevo, sin explicaciones, sin encabezados, sin comillas. Texto plano listo para leer en cámara.

GUION ORIGINAL:
${entry.transcription}`;
    const result = await window.api.generateWithClaude({
      prompt: prompt,
      model: 'claude-sonnet-4-6',
      maxTokens: 2000
    });
    if (!result || !result.ok) {
      throw new Error(result && result.error ? result.error : 'No se pudo conectar con Claude');
    }
    const newText = (result.text || '').trim();
    if (!newText) throw new Error('Claude devolvió respuesta vacía');
    const currentEntry = entries.find(e => e.id === entryId);
    const variations = Array.isArray(currentEntry.scriptVariations) ? currentEntry.scriptVariations : [];
    variations.push({
      text: newText,
      tono: tonoKey,
      estilo: estiloKey,
      tonoLabel: tono.label,
      estiloLabel: estilo.label,
      createdAt: new Date().toISOString(),
      createdBy: (window.parent && window.parent.currentUser) ? window.parent.currentUser.uid : null
    });
    await db.collection('depositEntries').doc(entryId).update({ scriptVariations: variations });
    _setTranscriptionStatus('✓ Variación generada', 'success');
    setTimeout(() => _renderTranscriptionModalContent(entryId), 200);
    if (btn) { btn.disabled = false; btn.textContent = '✨ Generar variación con Claude'; }
  } catch (e) {
    _setTranscriptionStatus('❌ Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✨ Generar variación con Claude'; }
  }
}

// ===== Modal de transcripción + teleprompter (v3.9.11) =====
let _currentTranscriptionEntryId = null;

function _setTranscriptionStatus(text, kind) {
  const el = document.getElementById('transcriptionStatus');
  if (!el) return;
  el.textContent = text;
  el.style.color = kind === 'error' ? '#ff6b6b' : kind === 'success' ? '#4ecdc4' : 'var(--text-secondary)';
}

function openTranscriptionModal(entryId) {
  console.log('[modal] open() called for entry', entryId);
  _currentTranscriptionEntryId = entryId;
  const modal = document.getElementById('transcriptionModal');
  if (!modal) {
    console.error('[modal] transcriptionModal element NOT FOUND in DOM');
    alert('Error: el modal de transcripción no existe en el DOM. Avisá a soporte (v3.9.12).');
    return;
  }
  console.log('[modal] adding active class');
  modal.classList.add('active');
  // Asegurar visibilidad por si CSS está cacheado mal
  modal.style.display = 'flex';
  _renderTranscriptionModalContent(entryId);
}

function closeTranscriptionModal() {
  const modal = document.getElementById('transcriptionModal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = ''; // resetear inline display que puse al abrir
  }
  _currentTranscriptionEntryId = null;
}

function _renderTranscriptionModalContent(entryId) {
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return;
  document.getElementById('transcriptionEntryName').textContent = entry.title || '(sin titulo)';
  const original = document.getElementById('transcriptionOriginalSection');
  const text = document.getElementById('transcriptionOriginalText');
  if (entry.transcription) {
    original.style.display = 'block';
    text.textContent = entry.transcription;
    if (!_setTranscriptionStatus._userMsg) _setTranscriptionStatus('');
  } else {
    original.style.display = 'none';
    if (!_setTranscriptionStatus._userMsg) _setTranscriptionStatus('⏳ Iniciando transcripción...');
  }
  // v3.10.2: sección de videos grabados desde el celular — visible siempre que existan
  const recSec = document.getElementById('transcriptionRecordedSection');
  if (recSec) {
    const recs = Array.isArray(entry.recordedVideos) ? entry.recordedVideos : [];
    if (recs.length === 0) {
      recSec.style.display = 'none';
      recSec.innerHTML = '';
    } else {
      recSec.style.display = 'block';
      recSec.innerHTML = `
        <div style="font-size:11px;font-weight:700;color:#ff9866;letter-spacing:0.5px;text-transform:uppercase;margin:14px 0 8px">🎥 Videos grabados desde el celular (${recs.length})</div>
        ${recs.map((rv, i) => `
          <div style="margin-bottom:10px;padding:10px;background:rgba(255,128,64,0.05);border:1px solid rgba(255,128,64,0.2);border-radius:8px">
            <video src="${esc(rv.url)}" controls preload="metadata" playsinline style="width:100%;max-height:240px;background:#000;border-radius:6px;margin-bottom:6px"></video>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
              <span style="font-size:10px;color:var(--text-dim);flex:1;min-width:120px">Grabación ${i + 1}${rv.recordedAt ? ' · ' + new Date(rv.recordedAt).toLocaleString() : ''}</span>
              <button class="btn btn-ghost btn-small" data-copy-recorded="${esc(rv.url)}" style="padding:2px 8px;font-size:10px">📋 Copiar link</button>
              <button class="btn btn-ghost btn-small" data-open-recorded-ext="${esc(rv.url)}" style="padding:2px 8px;font-size:10px">🔗 Abrir</button>
              <button class="btn btn-danger btn-small" data-del-recorded="${i}" style="padding:2px 8px;font-size:10px">🗑</button>
            </div>
            <div style="font-size:9px;color:var(--text-dim);font-family:monospace;margin-top:4px;word-break:break-all">${esc(rv.url)}</div>
          </div>
        `).join('')}
      `;
      recSec.querySelectorAll('[data-copy-recorded]').forEach(b => b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.copyRecorded);
        b.textContent = '✓';
        setTimeout(() => { b.textContent = '📋 Copiar link'; }, 1500);
      }));
      recSec.querySelectorAll('[data-open-recorded-ext]').forEach(b => b.addEventListener('click', () => {
        try { window.api.openExternal(b.dataset.openRecordedExt); } catch (e) { window.open(b.dataset.openRecordedExt, '_blank', 'noopener'); }
      }));
      recSec.querySelectorAll('[data-del-recorded]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Borrar esta grabación de la entry? (El archivo en Cloudinary queda)')) return;
        const idx = parseInt(b.dataset.delRecorded);
        const newRecs = recs.slice(); newRecs.splice(idx, 1);
        const removedUrl = recs[idx].url;
        const newMedia = (Array.isArray(entry.mediaUrls) ? entry.mediaUrls : []).filter(u => u !== removedUrl);
        await db.collection('depositEntries').doc(entryId).update({
          recordedVideos: newRecs,
          mediaUrls: newMedia
        });
      }));
    }
  }
  // Variaciones
  const list = document.getElementById('transcriptionVariationsList');
  const variations = Array.isArray(entry.scriptVariations) ? entry.scriptVariations : [];
  if (variations.length === 0) {
    list.innerHTML = '';
  } else {
    list.innerHTML = '<div style="font-size:11px;font-weight:700;color:var(--accent);letter-spacing:0.5px;text-transform:uppercase;margin:14px 0 8px">✨ Variaciones generadas</div>' +
      variations.map((v, i) => {
        const safeText = esc(v.text || '');
        const tagBits = [];
        if (v.tonoLabel) tagBits.push(esc(v.tonoLabel));
        if (v.estiloLabel) tagBits.push(esc(v.estiloLabel));
        const tags = tagBits.length > 0
          ? `<span style="font-size:9px;color:var(--text-secondary);background:var(--bg-card);padding:2px 6px;border-radius:4px;margin-left:6px;font-weight:500">${tagBits.join(' · ')}</span>`
          : '';
        return `
          <div class="transcript-variation">
            <div class="transcript-variation-header">
              <span>Variación ${i + 1}${tags}</span>
              <div style="display:flex;gap:6px">
                <button class="btn btn-ghost btn-small" data-tp-variation="${i}" style="padding:2px 8px;font-size:10px">🎬 Teleprompter</button>
                <button class="btn btn-ghost btn-small" data-copy-variation="${i}" style="padding:2px 8px;font-size:10px">📋 Copiar</button>
                <button class="btn btn-danger btn-small" data-del-variation="${i}" style="padding:2px 8px;font-size:10px">🗑</button>
              </div>
            </div>
            <div class="transcript-variation-text">${safeText}</div>
          </div>`;
      }).join('');
    list.querySelectorAll('[data-tp-variation]').forEach(b => b.addEventListener('click', () => {
      openTeleprompter(variations[parseInt(b.dataset.tpVariation)].text, entryId);
    }));
    list.querySelectorAll('[data-copy-variation]').forEach(b => b.addEventListener('click', () => {
      navigator.clipboard.writeText(variations[parseInt(b.dataset.copyVariation)].text);
      b.textContent = '✓';
      setTimeout(() => { b.textContent = '📋 Copiar'; }, 1500);
    }));
    list.querySelectorAll('[data-del-variation]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Borrar esta variación?')) return;
      const idx = parseInt(b.dataset.delVariation);
      const newVars = variations.slice();
      newVars.splice(idx, 1);
      await db.collection('depositEntries').doc(entryId).update({ scriptVariations: newVars });
    }));
  }
}

// v3.9.13: event delegation global para los botones de transcribir/recrear
// — robusto contra re-renders del entries area
document.addEventListener('click', (ev) => {
  const transcribeBtn = ev.target.closest('[data-transcribe]');
  if (transcribeBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    console.log('[delegate] transcribe click on', transcribeBtn.dataset.transcribe);
    transcribeEntry(transcribeBtn.dataset.transcribe, transcribeBtn);
    return;
  }
  const retransBtn = ev.target.closest('[data-retranscribe]');
  if (retransBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    transcribeEntry(retransBtn.dataset.retranscribe, retransBtn);
    return;
  }
  const rewriteBtn = ev.target.closest('[data-rewrite-script]');
  if (rewriteBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    rewriteScriptForEntry(rewriteBtn.dataset.rewriteScript, rewriteBtn);
    return;
  }
  const openTranscriptBtn = ev.target.closest('[data-open-transcript]');
  if (openTranscriptBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    openTranscriptionModal(openTranscriptBtn.dataset.openTranscript);
    return;
  }
  const openRecordedBtn = ev.target.closest('[data-open-recorded]');
  if (openRecordedBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    const entry = entries.find(en => en.id === openRecordedBtn.dataset.openRecorded);
    const recs = entry && Array.isArray(entry.recordedVideos) ? entry.recordedVideos : [];
    if (recs.length === 1) {
      try { window.api.openExternal(recs[0].url); } catch (e) { window.open(recs[0].url, '_blank', 'noopener'); }
    } else if (recs.length > 1) {
      // Múltiples videos: abrir el modal de transcripción que ahora muestra la sección de grabados
      openTranscriptionModal(openRecordedBtn.dataset.openRecorded);
    }
    return;
  }
});

// Wireup del modal y teleprompter — si DOMContentLoaded ya disparó, ejecutar directo
function _wireupTranscriptionAndTeleprompter() {
  const closeBtn = document.getElementById('transcriptionClose');
  if (closeBtn) closeBtn.addEventListener('click', closeTranscriptionModal);
  const modal = document.getElementById('transcriptionModal');
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeTranscriptionModal(); });
  const retry = document.getElementById('transcriptionRetry');
  if (retry) retry.addEventListener('click', async () => {
    if (!_currentTranscriptionEntryId) return;
    if (!confirm('Re-transcribir este video desde cero? La transcripción actual se sobrescribe.')) return;
    await db.collection('depositEntries').doc(_currentTranscriptionEntryId).update({
      transcription: firebase.firestore.FieldValue.delete()
    });
    const entry = entries.find(e => e.id === _currentTranscriptionEntryId);
    if (entry) entry.transcription = null;
    transcribeEntry(_currentTranscriptionEntryId, { dataset: { action: 'retry' } });
  });
  // v3.9.22: poblar selects de Tono y Estilo + descripción dinámica
  const tonoSelect = document.getElementById('variationTono');
  const estiloSelect = document.getElementById('variationEstilo');
  const descEl = document.getElementById('variationDesc');
  if (tonoSelect) {
    tonoSelect.innerHTML = Object.entries(SCRIPT_TONOS).map(([k, v]) =>
      `<option value="${k}">${v.label}</option>`
    ).join('');
    tonoSelect.value = 'educativo';
  }
  if (estiloSelect) {
    estiloSelect.innerHTML = Object.entries(SCRIPT_ESTILOS).map(([k, v]) =>
      `<option value="${k}">${v.label}</option>`
    ).join('');
    estiloSelect.value = 'hook_dato';
  }
  function updateVariationDesc() {
    if (!descEl || !tonoSelect || !estiloSelect) return;
    const t = SCRIPT_TONOS[tonoSelect.value];
    const e = SCRIPT_ESTILOS[estiloSelect.value];
    if (t && e) descEl.textContent = `→ ${t.desc} · ${e.desc}`;
  }
  if (tonoSelect) tonoSelect.addEventListener('change', updateVariationDesc);
  if (estiloSelect) estiloSelect.addEventListener('change', updateVariationDesc);
  updateVariationDesc();

  const generate = document.getElementById('transcriptionGenerate');
  if (generate) generate.addEventListener('click', () => {
    if (!_currentTranscriptionEntryId) return;
    const opts = {
      tono: tonoSelect ? tonoSelect.value : 'educativo',
      estilo: estiloSelect ? estiloSelect.value : 'hook_dato'
    };
    rewriteScriptForEntry(_currentTranscriptionEntryId, generate, opts);
  });
  const tpBtn = document.getElementById('transcriptionTeleprompter');
  if (tpBtn) tpBtn.addEventListener('click', () => {
    const entry = entries.find(e => e.id === _currentTranscriptionEntryId);
    if (entry && entry.transcription) openTeleprompter(entry.transcription, _currentTranscriptionEntryId);
  });
  const copyBtn = document.getElementById('transcriptionCopyOriginal');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const entry = entries.find(e => e.id === _currentTranscriptionEntryId);
    if (entry && entry.transcription) {
      navigator.clipboard.writeText(entry.transcription);
      copyBtn.textContent = '✓ Copiado';
      setTimeout(() => { copyBtn.textContent = '📋 Copiar'; }, 1500);
    }
  });
  // ESC para cerrar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const tp = document.getElementById('teleprompter');
      if (tp && tp.classList.contains('active')) { closeTeleprompter(); return; }
      const tm = document.getElementById('transcriptionModal');
      if (tm && tm.classList.contains('active')) closeTranscriptionModal();
    }
  });
  // Teleprompter wireup
  setupTeleprompter();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _wireupTranscriptionAndTeleprompter);
} else {
  _wireupTranscriptionAndTeleprompter();
}

// ===== Teleprompter =====
let _tpScrollHandle = null;
let _tpPlaying = false;
// v3.10.0: trackeo del entry y texto activos en el teleprompter para que el
// flujo "📱 Grabar desde celular" sepa a qué entry asociar el video.
let _tpEntryId = null;
let _tpScript = '';
function openTeleprompter(text, entryId) {
  const tp = document.getElementById('teleprompter');
  const txt = document.getElementById('tpText');
  const wrap = document.getElementById('tpTextWrap');
  if (!tp || !txt || !wrap) return;
  txt.textContent = text || '';
  wrap.scrollTop = 0;
  tp.classList.add('active');
  _tpPlaying = false;
  _tpScript = text || '';
  _tpEntryId = entryId || _currentTranscriptionEntryId || null;
  document.getElementById('tpPlayPause').textContent = '▶ Play';
  if (_tpScrollHandle) { clearInterval(_tpScrollHandle); _tpScrollHandle = null; }
}
function closeTeleprompter() {
  const tp = document.getElementById('teleprompter');
  if (tp) tp.classList.remove('active');
  if (_tpScrollHandle) { clearInterval(_tpScrollHandle); _tpScrollHandle = null; }
  _tpPlaying = false;
}
function setupTeleprompter() {
  const playBtn = document.getElementById('tpPlayPause');
  const resetBtn = document.getElementById('tpReset');
  const closeBtn = document.getElementById('tpClose');
  const speedInput = document.getElementById('tpSpeed');
  const fontInput = document.getElementById('tpFontSize');
  const mirrorChk = document.getElementById('tpMirror');
  if (!playBtn) return;
  function getSpeed() { return parseInt(speedInput.value) || 60; }
  function updateScroll() {
    if (!_tpPlaying) return;
    const wrap = document.getElementById('tpTextWrap');
    if (!wrap) return;
    // Velocidad: 60 = scroll de 1px cada 30ms aprox. Slider 10-200.
    const px = Math.max(0.5, getSpeed() / 60);
    wrap.scrollTop += px;
    if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 5) {
      _tpPlaying = false;
      playBtn.textContent = '▶ Play';
      if (_tpScrollHandle) { clearInterval(_tpScrollHandle); _tpScrollHandle = null; }
    }
  }
  playBtn.addEventListener('click', () => {
    _tpPlaying = !_tpPlaying;
    playBtn.textContent = _tpPlaying ? '⏸ Pausa' : '▶ Play';
    if (_tpPlaying) {
      if (_tpScrollHandle) clearInterval(_tpScrollHandle);
      _tpScrollHandle = setInterval(updateScroll, 30);
    } else if (_tpScrollHandle) {
      clearInterval(_tpScrollHandle); _tpScrollHandle = null;
    }
  });
  resetBtn.addEventListener('click', () => {
    const wrap = document.getElementById('tpTextWrap');
    if (wrap) wrap.scrollTop = 0;
    _tpPlaying = false;
    playBtn.textContent = '▶ Play';
    if (_tpScrollHandle) { clearInterval(_tpScrollHandle); _tpScrollHandle = null; }
  });
  closeBtn.addEventListener('click', closeTeleprompter);
  fontInput.addEventListener('input', () => {
    const txt = document.getElementById('tpText');
    if (txt) txt.style.fontSize = fontInput.value + 'px';
  });
  mirrorChk.addEventListener('change', () => {
    const txt = document.getElementById('tpText');
    if (txt) txt.classList.toggle('mirror', mirrorChk.checked);
  });
  // v3.10.0: botón "📱 Grabar desde celular" — abre el modal con QR
  const recordPhoneBtn = document.getElementById('tpRecordPhone');
  if (recordPhoneBtn) recordPhoneBtn.addEventListener('click', () => openPhoneRecorderModal());
}

// ===== Phone recorder via QR (v3.10.0) =====
// Crea un doc en /recordingSessions con el guion + cloudinary creds, muestra QR
// con la URL del PWA recorder, y escucha cuando el doc cambie a status=completed
// para attachar el video al entry.
const RECORDER_PUBLIC_URL = 'https://jainierrojas-arch.github.io/task-manager-app/recorder/';

let _phoneRecSessionId = null;
let _phoneRecUnsub = null;

function _phoneRecRandomId() {
  return 'rs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

async function openPhoneRecorderModal() {
  const modal = document.getElementById('phoneRecModal');
  if (!modal) return;
  if (!_tpEntryId) {
    alert('Abrí el teleprompter desde una transcripción o variación primero.');
    return;
  }
  if (!_tpScript || !_tpScript.trim()) {
    alert('No hay guion cargado en el teleprompter.');
    return;
  }
  if (typeof qrcode !== 'function') {
    alert('La librería QR no se cargó. Recargá la app.');
    return;
  }

  // Reset UI
  document.getElementById('phoneRecCloudinaryWarn').style.display = 'none';
  document.getElementById('phoneRecStatusText').textContent = 'Generando enlace seguro...';
  document.getElementById('phoneRecQrWrap').innerHTML = '';
  document.getElementById('phoneRecLink').textContent = '';
  document.getElementById('phoneRecBody').style.display = '';
  const resultEl = document.getElementById('phoneRecResult');
  if (resultEl) resultEl.style.display = 'none';
  modal.classList.add('active');
  modal.style.display = 'flex';
  // v3.11.61: activar captura del gimbal BT remote pareado a la Mac
  if (window.api && window.api.registerGimbalShortcuts) {
    window.api.registerGimbalShortcuts().then(r => {
      if (r && r.registered) {
        const ok = Object.values(r.registered).some(v => v);
        console.log('[gimbal] shortcuts registered:', r.registered, '— captura activa:', ok);
      }
    }).catch(e => console.warn('[gimbal] register failed', e.message));
  }

  // Cloudinary config (heredado del parent vía window.api)
  let cfg = null;
  try {
    cfg = window.api && window.api.getCloudinaryConfig ? await window.api.getCloudinaryConfig() : null;
  } catch (e) { cfg = null; }
  if (!cfg || !cfg.cloudName || !cfg.uploadPreset) {
    document.getElementById('phoneRecCloudinaryWarn').style.display = 'block';
    document.getElementById('phoneRecStatusText').textContent = 'Configurá Cloudinary y volvé a intentar.';
    return;
  }

  // Crear doc de sesión
  _phoneRecSessionId = _phoneRecRandomId();
  const sessionData = {
    entryId: _tpEntryId,
    workspaceId: WS_ID || null,
    scriptText: _tpScript,
    status: 'pending',
    cloudName: cfg.cloudName,
    uploadPreset: cfg.uploadPreset,
    createdBy: (currentUser && currentUser.uid) || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await db.collection('recordingSessions').doc(_phoneRecSessionId).set(sessionData);
  } catch (e) {
    console.error('[phoneRec] failed to create session', e);
    document.getElementById('phoneRecStatusText').textContent = 'Error: ' + e.message + '. Verificá que las reglas de Firestore estén actualizadas.';
    return;
  }

  // Generar QR
  const url = RECORDER_PUBLIC_URL + '?session=' + encodeURIComponent(_phoneRecSessionId);
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    document.getElementById('phoneRecQrWrap').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    const svg = document.querySelector('#phoneRecQrWrap svg');
    if (svg) { svg.style.width = '220px'; svg.style.height = '220px'; svg.style.maxWidth = '100%'; }
  } catch (e) {
    console.error('[phoneRec] QR gen failed', e);
    document.getElementById('phoneRecQrWrap').innerHTML = '<div style="color:#333;font-size:13px;text-align:center">No se pudo generar el QR.<br>Abrí esta URL en el celular:</div>';
  }
  document.getElementById('phoneRecLink').textContent = url;
  document.getElementById('phoneRecStatusText').textContent = 'Esperando que abras el QR en el celular...';

  // Listener
  if (_phoneRecUnsub) { try { _phoneRecUnsub(); } catch (e) {} _phoneRecUnsub = null; }
  _phoneRecUnsub = db.collection('recordingSessions').doc(_phoneRecSessionId).onSnapshot(async (snap) => {
    if (!snap.exists) return;
    const d = snap.data();
    // v3.11.55: mostrar/ocultar panel de control remoto según el estado del celu
    const remoteCtl = document.getElementById('phoneRecRemoteCtl');
    if (remoteCtl) {
      const isLive = ['connected', 'recording', 'paused'].includes(d.status);
      remoteCtl.style.display = isLive ? '' : 'none';
      const toggleBtn = document.getElementById('phoneRecToggleBtn');
      if (toggleBtn) {
        if (d.status === 'recording') toggleBtn.textContent = '⏸ Pausar';
        else if (d.status === 'paused') toggleBtn.textContent = '▶ Continuar';
        else toggleBtn.textContent = '⏺ Grabar';
      }
    }
    if (d.status === 'connected') {
      document.getElementById('phoneRecStatusText').textContent = '📱 Celular conectado — listo para grabar.';
    } else if (d.status === 'recording') {
      document.getElementById('phoneRecStatusText').textContent = '🔴 Grabando en el celular...';
    } else if (d.status === 'paused') {
      document.getElementById('phoneRecStatusText').textContent = '⏸ Pausado.';
    } else if (d.status === 'uploading') {
      document.getElementById('phoneRecStatusText').textContent = '📤 Subiendo video a Cloudinary...';
    } else if (d.status === 'completed' && d.videoUrl) {
      document.getElementById('phoneRecStatusText').textContent = '✓ Video recibido! Asociando al entry...';
      try {
        // v3.11.32: el recorder ahora merges clips con ffmpeg.wasm antes de subir,
        // así que d.videoUrl ya es UN solo video con todos los clips unidos.
        await _attachRecordedVideoToEntry(d.entryId, d.videoUrl);
        const merged = (typeof d.mergedFrom === 'number' && d.mergedFrom > 1)
          ? ` (${d.mergedFrom} clips unidos en uno)`
          : '';
        try { showToast && showToast(`🎬 Video del celular agregado al entry${merged}`); } catch (e) {}
        _showPhoneRecResult(d.videoUrl);
      } catch (e) {
        console.error('[phoneRec] attach failed', e);
        document.getElementById('phoneRecStatusText').textContent = 'Error al asociar video: ' + e.message;
      }
    }
  });
}

function _showPhoneRecResult(videoUrl) {
  // Cambiar la UI del modal: ocultar QR / status, mostrar player + link.
  document.getElementById('phoneRecBody').style.display = 'none';
  const resultEl = document.getElementById('phoneRecResult');
  if (!resultEl) return;
  resultEl.style.display = 'block';
  const player = document.getElementById('phoneRecVideoPlayer');
  if (player) {
    player.src = videoUrl;
    player.load();
  }
  const urlText = document.getElementById('phoneRecVideoUrlText');
  if (urlText) urlText.textContent = videoUrl;
  // Cerrar el listener — la sesión ya está completada
  if (_phoneRecUnsub) { try { _phoneRecUnsub(); } catch (e) {} _phoneRecUnsub = null; }
}

function closePhoneRecorderModal() {
  const modal = document.getElementById('phoneRecModal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = '';
  }
  if (_phoneRecUnsub) { try { _phoneRecUnsub(); } catch (e) {} _phoneRecUnsub = null; }
  _phoneRecSessionId = null;
  // v3.11.61: liberar VolumeUp/Down al cerrar para no robarle los volume keys
  // al sistema cuando ya no usamos el gimbal remote.
  if (window.api && window.api.unregisterGimbalShortcuts) {
    window.api.unregisterGimbalShortcuts().catch(() => {});
  }
}

async function _attachRecordedVideoToEntry(entryId, videoUrl) {
  if (!entryId || !videoUrl) return;
  const ref = db.collection('depositEntries').doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('El entry ya no existe');
  const data = snap.data() || {};
  const mediaUrls = Array.isArray(data.mediaUrls) ? data.mediaUrls.slice() : [];
  if (!mediaUrls.includes(videoUrl)) mediaUrls.push(videoUrl);
  // v3.10.2: trackeo separado de videos grabados desde el celular para mostrarlos
  // como botón visible en la card y propagarlos al asignar tarea.
  const recordedVideos = Array.isArray(data.recordedVideos) ? data.recordedVideos.slice() : [];
  const newRec = {
    url: videoUrl,
    recordedAt: new Date().toISOString(),
    sessionId: _phoneRecSessionId || null
  };
  recordedVideos.push(newRec);
  const update = { mediaUrls, recordedVideos };
  // Si no había cover, usar el video como cover (Cloudinary genera thumb)
  if (!data.coverImage) update.coverImage = videoUrl;
  await ref.update(update);
  // v3.11.39: propagar a tareas existentes ya creadas desde esta entry. Antes,
  // si grababas DESPUÉS de asignar, la tarea quedaba sin el botón "🎬 Grabación".
  try {
    const tasksSnap = await db.collection('tasks').where('depositEntryId', '==', entryId).get();
    for (const tDoc of tasksSnap.docs) {
      const t = tDoc.data() || {};
      const tRecs = Array.isArray(t.recordedVideos) ? t.recordedVideos.slice() : [];
      if (tRecs.some(r => r && r.url === videoUrl)) continue;
      tRecs.push(newRec);
      const tUpdate = { recordedVideos: tRecs };
      // Si la tarea no tenía videoLink, usar el grabado para que también sea su preview.
      if (!t.videoLink) tUpdate.videoLink = videoUrl;
      await tDoc.ref.update(tUpdate);
    }
  } catch (e) { console.warn('[recorded->tasks] no se pudo propagar:', e.message); }
}

// Wireup del modal phone recorder
(function wireupPhoneRec() {
  function attach() {
    const closeBtn = document.getElementById('phoneRecClose');
    if (closeBtn) closeBtn.addEventListener('click', closePhoneRecorderModal);
    const modal = document.getElementById('phoneRecModal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closePhoneRecorderModal(); });

    const copyBtn = document.getElementById('phoneRecCopyLink');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const url = (document.getElementById('phoneRecVideoUrlText') || {}).textContent || '';
      if (!url) return;
      navigator.clipboard.writeText(url);
      copyBtn.textContent = '✓ Copiado';
      setTimeout(() => { copyBtn.textContent = '📋 Copiar link'; }, 1500);
    });
    const openBtn = document.getElementById('phoneRecOpenLink');
    if (openBtn) openBtn.addEventListener('click', () => {
      const url = (document.getElementById('phoneRecVideoUrlText') || {}).textContent || '';
      if (!url) return;
      try { window.api.openExternal(url); } catch (e) { window.open(url, '_blank', 'noopener'); }
    });
    const anotherBtn = document.getElementById('phoneRecAnother');
    if (anotherBtn) anotherBtn.addEventListener('click', () => {
      // Reusar el mismo entry/script: abrir una sesión nueva.
      openPhoneRecorderModal();
    });

    // v3.11.55+v3.11.57: control remoto desde la PC.
    // Feedback visual inmediato (flash) para que el usuario sepa que el click registró,
    // aunque el round-trip a Firestore tarde 200-500ms.
    async function sendRemoteCommand(action, btn) {
      if (!_phoneRecSessionId) return;
      if (btn) {
        const orig = btn.textContent;
        btn.style.opacity = '0.6';
        btn.disabled = true;
        btn.textContent = '⏳ Enviando...';
        setTimeout(() => {
          btn.style.opacity = '';
          btn.disabled = false;
          btn.textContent = orig;
        }, 800);
      }
      try {
        await db.collection('recordingSessions').doc(_phoneRecSessionId).update({
          remoteCommand: { action, ts: Date.now() }
        });
      } catch (e) {
        console.warn('[remote] send failed', e.message);
        if (btn) btn.textContent = '⚠ Error';
      }
    }
    const toggleBtn = document.getElementById('phoneRecToggleBtn');
    if (toggleBtn) toggleBtn.addEventListener('click', () => sendRemoteCommand('toggle', toggleBtn));
    const discardBtn = document.getElementById('phoneRecDiscardBtn');
    if (discardBtn) discardBtn.addEventListener('click', () => sendRemoteCommand('discard', discardBtn));
    const doneBtn = document.getElementById('phoneRecDoneBtn');
    if (doneBtn) doneBtn.addEventListener('click', () => sendRemoteCommand('done', doneBtn));

    // v3.11.61: gimbal BT remote pareado a la Mac → VolumeUp/Down → toggle
    if (window.api && window.api.onGimbalShortcut) {
      window.api.onGimbalShortcut(() => {
        console.log('[gimbal] Mac globalShortcut → toggle');
        sendRemoteCommand('toggle', null);
        // Flash visual del botón para feedback
        const btn = document.getElementById('phoneRecToggleBtn');
        if (btn) {
          btn.style.background = 'rgba(108,99,255,0.4)';
          setTimeout(() => { btn.style.background = ''; }, 400);
        }
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})();

