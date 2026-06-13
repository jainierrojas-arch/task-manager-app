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
// v3.11.160: STRICT por default. Si no podemos confirmar 100% que somos default,
// asumimos non-default → solo mostramos docs CON workspaceId === WS_ID.
// La data legacy SIN workspaceId NO se muestra a menos que el URL diga isDefault=1.
// Antes el default era 'unknown' y eso causaba leak de legacy data en workspaces nuevos.
let _ws_status = 'non-default';
if (_wsParams.get('isDefault') === '1' || (DEFAULT_WS_ID && WS_ID === DEFAULT_WS_ID)) {
  _ws_status = 'default';
}
console.log('[ws] iframe init: WS_ID=' + WS_ID + ' DEFAULT_WS_ID=' + DEFAULT_WS_ID + ' status=' + _ws_status);
const WS_SCOPED_COLLECTIONS = new Set(['tasks', 'projects', 'depositEntries', 'depositCategories', 'scheduledPosts', 'chatMessages', 'captionTemplates', 'sceneInstructionTemplates', 'scriptSkills', 'ideas']);
function _belongsToWs(d) {
  // v3.11.160: aislamiento ABSOLUTO.
  // - Sin WS_ID: standalone mode, mostrar todo (no debería pasar en producción).
  // - DEFAULT workspace: muestra entries con su workspaceId Y legacy sin workspaceId.
  // - Cualquier otro caso (non-default O cuando no podemos confirmar): SOLO entries
  //   con su workspaceId exacto. La data legacy queda en el default y nada más.
  if (!WS_ID) return true;
  if (_ws_status === 'default') {
    return !d.workspaceId || d.workspaceId === WS_ID;
  }
  return d.workspaceId === WS_ID;
}

// v3.11.160: SIEMPRE verifica. El estado por defecto es STRICT (non-default).
// Esta función solo PROMUEVE a default si resulta que SÍ somos el default —
// y entonces re-renderiza para mostrar también la legacy data sin workspaceId.
window._verifyWsIsDefault = async function(dbRef) {
  if (!WS_ID) return;
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
    if (defId === WS_ID && _ws_status !== 'default') {
      _ws_status = 'default';
      console.log('[ws] verify: este WS ES default → promoviendo a permisivo + re-renderizando para mostrar legacy data');
      try { if (typeof renderCategories === 'function') renderCategories(); } catch (e) {}
      try { if (typeof renderEntries === 'function') renderEntries(); } catch (e) {}
    } else if (defId !== WS_ID && _ws_status === 'default') {
      // Safety: si algo nos puso en default incorrectamente, volver a strict
      _ws_status = 'non-default';
      console.log('[ws] verify: este WS NO es default — bajando a strict');
      try { if (typeof renderCategories === 'function') renderCategories(); } catch (e) {}
      try { if (typeof renderEntries === 'function') renderEntries(); } catch (e) {}
    } else {
      console.log('[ws] verify: estado correcto (' + _ws_status + ')');
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
// v3.11.126: plantillas reutilizables para las instrucciones de "Dividir en escenas"
let sceneInstructionTemplates = [];
let editingSceneTplId = null;
let _sceneTplTargetVariation = null;
// v3.11.147: skills — instrucciones que SE INYECTAN al prompt de Claude cuando
// se divide con AI. Ejemplo: "varía planos de cámara por escena".
let scriptSkills = [];
let editingSkillId = null;
let _activeSkillsByVariation = {}; // { variationIdx: Set<skillId> } — activos en cada variación
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
// v3.11.152: ENTRIES NUEVAS van al PRIMER lugar (no al ultimo). El orden:
// 1. Primero las entries SIN manualOrder, ordenadas por createdAt DESC (newest top).
//    Cada vez que entra una nueva, se inserta al tope y empuja al resto.
// 2. Después las entries CON manualOrder (las que vos arrastraste manualmente),
//    en el orden que las dejaste.
// Asi el drag-and-drop sigue funcionando para "fijar" un orden custom abajo,
// y los nuevos quedan arriba listos para revisar.
function entriesIn(catId, subId) {
  const visible = (e) => e.status !== 'converted';
  let arr;
  if (subId === '__unsorted__') arr = entries.filter(e => e.categoryId === catId && !e.subcategoryId && visible(e));
  else if (subId) arr = entries.filter(e => e.categoryId === catId && e.subcategoryId === subId && visible(e));
  else arr = entries.filter(e => e.categoryId === catId && visible(e));
  return arr.slice().sort((a, b) => {
    const aHas = typeof a.manualOrder === 'number';
    const bHas = typeof b.manualOrder === 'number';
    // Entries SIN manualOrder van primero
    if (!aHas && bHas) return -1;
    if (aHas && !bHas) return 1;
    if (!aHas && !bHas) {
      // Ambas nuevas: createdAt desc (la más nueva al tope)
      const at = (a.createdAt && a.createdAt.toMillis) ? a.createdAt.toMillis() : 0;
      const bt = (b.createdAt && b.createdAt.toMillis) ? b.createdAt.toMillis() : 0;
      return bt - at;
    }
    // Ambas con manualOrder: el orden que les diste arrastrando
    return a.manualOrder - b.manualOrder;
  });
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

  // v3.11.147: skills para AI Split
  unsubscribers.push(db.collection('scriptSkills').onSnapshot(snap => {
    scriptSkills = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(_belongsToWs);
    scriptSkills.sort((a, b) => {
      const al = a.lastUsedAt && a.lastUsedAt.toMillis ? a.lastUsedAt.toMillis() : 0;
      const bl = b.lastUsedAt && b.lastUsedAt.toMillis ? b.lastUsedAt.toMillis() : 0;
      if (al !== bl) return bl - al;
      return (a.name || '').localeCompare(b.name || '');
    });
    updateSkillFolderOptions();
    const mod = document.getElementById('transcriptionModal');
    if (mod && mod.classList.contains('active')) {
      // v3.11.149: PASAR _currentTranscriptionEntryId — sin esto data-skill-entry queda vacío y click no hace nada
      document.querySelectorAll('[data-skills-list]').forEach(el => renderSkillsPills(el, parseInt(el.dataset.skillsList, 10), _currentTranscriptionEntryId));
    }
  }, err => console.error('[deposit] scriptSkills error:', err)));

  // v3.11.126: plantillas de instrucciones para "Dividir en escenas"
  unsubscribers.push(db.collection('sceneInstructionTemplates').onSnapshot(snap => {
    sceneInstructionTemplates = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(_belongsToWs);
    sceneInstructionTemplates.sort((a, b) => {
      const al = a.lastUsedAt && a.lastUsedAt.toMillis ? a.lastUsedAt.toMillis() : 0;
      const bl = b.lastUsedAt && b.lastUsedAt.toMillis ? b.lastUsedAt.toMillis() : 0;
      if (al !== bl) return bl - al;
      return (a.name || '').localeCompare(b.name || '');
    });
    updateSceneTplFolderOptions();
    // Refrescar modal abierto si está visible
    const mod = document.getElementById('transcriptionModal');
    if (mod && mod.classList.contains('active')) {
      document.querySelectorAll('[data-scene-tpl-list]').forEach(el => renderSceneTplPills(el, parseInt(el.dataset.sceneTplList, 10)));
    }
  }, err => console.error('[deposit] sceneInstructionTemplates error:', err)));
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
  // v3.11.123: contador permissivo — incluye CUALQUIER entry de IG/TikTok/YouTube/FB que tenga cover problemático o sin cover.
  const socialEntries = subEntries.filter(e => {
    const firstUrl = (e.links && e.links[0] && e.links[0].url) || '';
    return /tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch/i.test(firstUrl);
  });
  const needsRepair = socialEntries.filter(e => {
    const cover = e.coverImage || '';
    if (!cover) return true;
    if (/lookaside\.instagram\.com|cdninstagram\.com\/rsrc|fbcdn\.net\/rsrc|^data:/i.test(cover)) return true;
    return false;
  });
  const repairBtn = socialEntries.length > 0
    ? ` <button id="repairCoversBtn" class="btn btn-ghost btn-small" style="margin-left:10px;font-size:11px;background:rgba(255,128,64,0.15);border:1px solid rgba(255,128,64,0.4);color:#ff9866;font-weight:600;cursor:pointer" title="Re-fetch portadas + título + descripción">🔄 Reparar portadas (${needsRepair.length}/${socialEntries.length})</button>`
    : '';
  sub.innerHTML = `${subEntries.length} idea${subEntries.length === 1 ? '' : 's'} aqui${repairBtn}`;
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
    // v3.11.127: drag-and-drop para reordenar las cards
    enableEntryDragAndDrop(area, subEntries);
    // v3.11.124: handler para botón "Reparar portadas" — con feedback visible
    const _repairBtn = document.getElementById('repairCoversBtn');
    console.log('[repair-covers] button render check:', { found: !!_repairBtn, socialEntries: socialEntries.length, needsRepair: needsRepair.length });
    if (_repairBtn) {
      _repairBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        console.log('[repair-covers] CLICK received');
        if (socialEntries.length === 0) {
          alert('No hay entries de IG/TikTok/YouTube/FB en esta subcategoría.');
          return;
        }
        const confirmMsg = `Reparar ${socialEntries.length} entries sociales? \n\nVa a re-fetchear título, descripción y portada de:\n- Instagram (necesitás estar logueado en Explorer)\n- TikTok (oEmbed oficial, no requiere login)\n- YouTube/Facebook\n\nSeguir?`;
        if (!confirm(confirmMsg)) {
          console.log('[repair-covers] user cancelled');
          return;
        }
        _repairBtn.disabled = true;
        _repairBtn.textContent = '⏳ Iniciando...';
        try {
          const result = await repairSocialCovers(socialEntries, (done, total, label) => {
            _repairBtn.textContent = `⏳ ${done}/${total}${label ? ' ' + label : ''}`;
          });
          _repairBtn.textContent = `✅ ${result.ok}/${result.total}`;
          console.log('[repair-covers] FINAL result', result);
          alert(`Listo: ${result.ok} de ${result.total} entries actualizadas.\n\n${result.ok === 0 ? 'Motivos comunes si no actualiza ninguna:\n• No logueado en IG dentro del Explorer\n• fetchOgData no devolvió datos\n• Sin internet\n\nAbrí DevTools (Cmd+Opt+I) y revisá Console para los logs [repair-covers].' : 'Refrescando vista...'}`);
        } catch (err) {
          console.error('[repair-covers] FATAL', err);
          _repairBtn.textContent = '❌ Error';
          alert('Error reparando portadas: ' + (err.message || err));
        } finally {
          _repairBtn.disabled = false;
          setTimeout(() => renderEntries(), 1500);
        }
      });
    }
    area.querySelectorAll('[data-link-open]').forEach(chip => {
      chip.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const u = chip.dataset.linkOpen;
        if (!u) return;
        // v3.11.125: dos paths — si estoy en iframe (dentro del main window),
        // mando postMessage directo al parent. Si soy ventana standalone, IPC.
        const inIframe = window.parent && window.parent !== window;
        console.log('[link-open] click', u, { inIframe, hasOpenInExplorer: !!(window.api && window.api.openInExplorer) });
        if (inIframe) {
          try {
            window.parent.postMessage({ type: 'open-in-explorer', url: u }, '*');
            console.log('[link-open] postMessage sent to parent');
            return;
          } catch (e) {
            console.error('[link-open] postMessage failed:', e.message || e);
          }
        }
        if (window.api && window.api.openInExplorer) {
          try {
            const ok = await window.api.openInExplorer(u);
            console.log('[link-open] openInExplorer result:', ok);
            if (!ok) window.api.openExternal(u);
          } catch (e) {
            console.error('[link-open] failed:', e.message || e);
            window.api.openExternal(u);
          }
        } else {
          console.warn('[link-open] no openInExplorer — fallback external');
          window.api.openExternal(u);
        }
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
    // v3.11.98: re-fetch manual de portada
    area.querySelectorAll('[data-refetch-cover]').forEach(btn => {
      btn.addEventListener('click', () => refetchEntryCover(btn.dataset.refetchCover, btn));
    });
  }

  const backBtn = document.getElementById('backToSubs');
  if (backBtn) backBtn.addEventListener('click', () => {
    selectedSubcategoryId = null;
    renderEntries();
  });
}

// Cloudinary video → URL de thumbnail (.jpg). Cloudinary genera la imagen al vuelo.
// v3.11.99: combo robusta — so_2 (frame al segundo 2, lo bastante adentro para
// esquivar splash negro pero suficientemente temprano para que videos de 3s+
// lo tengan), q_auto y f_jpg garantizan formato/calidad universal. Pequeño
// width=600 mantiene la imagen liviana. Antes usabamos so_3 que fallaba en
// videos cortos o con splash de >3s — saliendo negros.
function cloudinaryVideoThumb(url) {
  if (!url || !/\/video\/upload\//.test(url)) return null;
  if (!/res\.cloudinary\.com/i.test(url)) return null;
  return url
    .replace(/\/video\/upload\//, '/video/upload/so_2,w_600,q_auto,f_jpg/')
    .replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, '.jpg');
}

// v3.11.94: detecta thumbnails viejos de Cloudinary con transformaciones que
// salen negras (so_auto en cuentas free, so_0 que es el frame 0/negro,
// so_3 que falla en videos cortos). Se usa para invalidar covers viejos y
// forzar re-generación con la nueva URL.
function isOldCloudinaryThumb(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/res\.cloudinary\.com/.test(url)) return false;
  if (!/\/video\/upload\//.test(url)) return false;
  // Cualquier so_X que NO sea exactamente so_2,w_600,q_auto,f_jpg es viejo
  return /\/video\/upload\/[^/]*so_(auto|0|1|3|4|5)\b/.test(url) ||
         /\/video\/upload\/[^/]*so_2(?!,w_600,q_auto,f_jpg)/.test(url);
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
  //
  // v3.11.95: PRIORIZAR el thumb de Cloudinary generado AHORA por sobre el
  // coverImage cached. Razón: covers viejos pueden tener so_auto/so_0 que salen
  // negros, o la transformación cambió. Regenerar siempre garantiza que use la
  // URL actualizada del código. Si el primer link NO es Cloudinary video,
  // respetamos el coverImage cached (microlink, og:image, etc).
  const fresh = cloudinaryVideoThumb(links[0]?.url || '');
  const cover = fresh || e.coverImage;
  const firstUrl = links[0]?.url || '';
  let coverHtml = '';
  if (firstUrl) {
    const svc = serviceFromUrl(firstUrl);
    if (cover) {
      // v3.11.101: gradiente de marca SIEMPRE como background del wrapper.
      // El <img> va encima — si carga tapa el gradiente, si falla (404, token
      // expirado, etc.) queda el gradiente visible (nunca cuadro negro).
      // onerror simple: solo esconde el img, el gradiente del wrapper queda.
      let arStyle = '';
      if (e.coverWidth && e.coverHeight) {
        arStyle = `aspect-ratio:${e.coverWidth} / ${e.coverHeight};`;
      }
      coverHtml = `<div class="entry-cover" data-link-open="${esc(firstUrl)}" style="background:${svc.gradient};${arStyle}"><img src="${esc(cover)}" alt="" loading="lazy" onerror="this.style.display='none'" style="width:100%;height:100%;object-fit:cover;display:block"></div>`;
    } else {
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
    <div class="entry-card ${e.status === 'converted' ? 'converted' : ''} ${hasCarrusel ? 'is-carrusel' : ''}" data-entry-id="${esc(e.id)}" draggable="true">
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
              <button class="btn btn-ghost btn-small" data-refetch-cover="${esc(e.id)}" title="Re-fetchear portada (cuando salió placeholder negro/Instagram)" style="opacity:0.7">&#128260;</button>
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
    // v3.11.96: bumped a 8 — fuerza re-fetch de TODAS las entries de Instagram
    // porque las URLs de scontent.cdninstagram.com tienen tokens firmados que
    // vencen tras días/semanas y la portada queda muerta (sale negra).
    if (entry.coverFetcherV >= 14) continue;
    coverMigratedThisSession.add(entry.id);

    const isInstagramLink = (entry.links || []).some(l => /instagram\.com\//.test(l.url || ''));
    const isTiktokLink = (entry.links || []).some(l => /tiktok\.com\//.test(l.url || ''));
    const isOldCloudinaryCover = isOldCloudinaryThumb(entry.coverImage || '');
    // v3.11.114: detectar URLs de CDN con tokens expirables (IG/FB/TikTok firmados).
    // No incluir res.cloudinary.com porque esas son permanentes (las nuestras).
    const cover = entry.coverImage || '';
    const isExpirableCdnUrl = /scontent.*cdninstagram\.com|scontent.*fbcdn\.net|tiktokcdn/.test(cover)
      && !/res\.cloudinary\.com/.test(cover);

    if (isInstagramLink || isTiktokLink || isOldCloudinaryCover || isExpirableCdnUrl) {
      try {
        await db.collection('depositEntries').doc(entry.id).update({
          coverImage: firebase.firestore.FieldValue.delete(),
          coverWidth: firebase.firestore.FieldValue.delete(),
          coverHeight: firebase.firestore.FieldValue.delete(),
          coverFetcherV: 14
        });
      } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    } else {
      try { await db.collection('depositEntries').doc(entry.id).update({ coverFetcherV: 14 }); } catch (_) {}
    }
  }
}

// v3.11.122: reparación manual disparada por botón "Reparar portadas".
// Itera entries de IG/TikTok sin cover real (o con cover broken tipo
// lookaside/rsrc.php) y fuerza un re-fetch via fetchOgData (que ya persiste
// a Cloudinary internamente). Bypassa ogFetchedThisSession.
async function repairSocialCovers(entries, onProgress) {
  // entries ya filtradas como sociales — procesamos TODAS (cover ok o no)
  console.log(`[repair-covers] start - ${entries.length} social entries`);
  let done = 0;
  let okCount = 0;
  for (const entry of entries) {
    const url = entry.links && entry.links[0] && entry.links[0].url;
    if (!url) { done++; continue; }
    const label = url.includes('instagram') ? 'IG' : url.includes('tiktok') ? 'TT' : url.includes('youtube') || url.includes('youtu.be') ? 'YT' : 'FB';
    if (onProgress) onProgress(done, entries.length, label);
    try {
      console.log(`[repair-covers] fetching`, entry.id, url);
      const og = await window.api.fetchOgData(url);
      console.log(`[repair-covers] got og for ${entry.id}:`, og ? { hasImage: !!og.image, hasTitle: !!og.title, hasDesc: !!og.description } : 'NULL');
      const update = {};
      if (og && og.image) {
        update.coverImage = og.image;
        if (og.imageWidth) update.coverWidth = og.imageWidth;
        if (og.imageHeight) update.coverHeight = og.imageHeight;
      }
      if (og && og.title) update.title = og.title.slice(0, 200);
      if (og && og.description) update.description = og.description.slice(0, 2000);
      update.coverFetcherV = 15;
      const hasUpdate = Object.keys(update).length > 1;
      if (hasUpdate) {
        await db.collection('depositEntries').doc(entry.id).update(update);
        console.log(`[repair-covers] updated`, entry.id, Object.keys(update));
        okCount++;
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
          } catch (_) {}
        }
      } else {
        console.warn(`[repair-covers] no useful data returned for`, entry.id);
      }
    } catch (e) {
      console.error(`[repair-covers] failed for`, entry.id, e.message || e);
    }
    done++;
    if (onProgress) onProgress(done, entries.length, label);
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`[repair-covers] done - ${okCount}/${entries.length} ok`);
  return { ok: okCount, total: entries.length };
}

// =============================================================================
// v3.11.127: drag-and-drop para reordenar entries en el grid
// Persiste el orden via manualOrder en Firestore (0..n-1 secuencial).
// =============================================================================
let _draggingEntryId = null;

function enableEntryDragAndDrop(area, subEntries) {
  const grid = area.querySelector('.entry-grid');
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll('.entry-card[draggable="true"]'));
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      _draggingEntryId = card.dataset.entryId;
      card.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
      try { e.dataTransfer.setData('text/plain', _draggingEntryId); } catch (_) {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      grid.querySelectorAll('.entry-card.drag-over').forEach(c => c.classList.remove('drag-over'));
      _draggingEntryId = null;
    });
    card.addEventListener('dragover', (e) => {
      if (!_draggingEntryId || card.dataset.entryId === _draggingEntryId) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const sourceId = _draggingEntryId;
      const targetId = card.dataset.entryId;
      _draggingEntryId = null;
      if (!sourceId || sourceId === targetId) return;
      const sourceIdx = subEntries.findIndex(en => en.id === sourceId);
      const targetIdx = subEntries.findIndex(en => en.id === targetId);
      if (sourceIdx < 0 || targetIdx < 0) return;
      // Insertar source antes de target. Si source estaba antes que target,
      // al sacarlo el index de target baja en 1.
      const newOrder = subEntries.slice();
      const [moved] = newOrder.splice(sourceIdx, 1);
      const insertAt = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx;
      newOrder.splice(insertAt, 0, moved);
      // Mover DOM inmediatamente (UI optimista)
      const draggedEl = grid.querySelector(`[data-entry-id="${CSS.escape(sourceId)}"]`);
      const targetEl = grid.querySelector(`[data-entry-id="${CSS.escape(targetId)}"]`);
      if (draggedEl && targetEl) {
        if (sourceIdx < targetIdx) targetEl.after(draggedEl);
        else targetEl.before(draggedEl);
      }
      // Persistir manualOrder secuencial en Firestore
      try {
        const batch = db.batch();
        newOrder.forEach((en, idx) => {
          if (en.manualOrder !== idx) {
            batch.update(db.collection('depositEntries').doc(en.id), { manualOrder: idx });
          }
        });
        await batch.commit();
      } catch (err) {
        console.error('[dnd] save manualOrder failed', err);
      }
    });
  });
}

// v3.11.118: detecta si una entry tiene metadata pobre (sin descripción y/o
// con título genérico tipo "Instagram", "TikTok", o el hostname). Esas entries
// se benefician de un re-fetch que les ponga título y descripción reales.
function hasGenericMetadata(entry) {
  const desc = (entry.description || '').trim();
  const title = (entry.title || '').trim();
  if (!desc) return true; // sin descripción → re-fetch
  if (title.length < 3) return true;
  if (/^(instagram|tiktok|youtube|facebook|x|twitter)\b/i.test(title)) return true;
  if (/^https?:\/\//.test(title)) return true; // título es solo el URL
  return false;
}

async function lazyFetchCovers(visibleEntries) {
  // Antes de re-fetchear lo que falta, migrar covers viejos (logos de marca,
  // carruseles 1:1 recortados, etc.) — los limpia para que se re-descarguen
  migrateCovers(visibleEntries);
  for (const entry of visibleEntries) {
    // v3.11.118: si la entry YA tiene cover pero metadata pobre (sin descripción
    // o título genérico) Y el link es de TikTok/IG, re-fetch para enriquecer.
    if (entry.coverImage && hasGenericMetadata(entry)) {
      const url = (entry.links && entry.links[0] && entry.links[0].url) || '';
      const isSocial = /tiktok\.com|instagram\.com/i.test(url);
      if (isSocial && !ogFetchInFlight.has(entry.id) && !ogFetchedThisSession.has(entry.id)) {
        ogFetchInFlight.add(entry.id);
        try {
          const og = await window.api.fetchOgData(url);
          if (og && (og.title || og.description)) {
            const update = {};
            if (og.title && hasGenericMetadata(entry)) update.title = og.title.slice(0, 200);
            if (og.description && !entry.description) update.description = og.description.slice(0, 2000);
            if (Object.keys(update).length > 0) {
              console.log('[lazy-meta] enriching entry', entry.id, Object.keys(update));
              await db.collection('depositEntries').doc(entry.id).update(update);
            }
          }
        } catch (e) { /* ignore */ }
        ogFetchInFlight.delete(entry.id);
        ogFetchedThisSession.add(entry.id);
      }
      continue;
    }
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
          coverFetcherV: 14
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
      const update = { coverImage: og.image || null, coverFetcherV: 14 };
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
    // v3.11.113: igual que las cards — gradient siempre de fondo, <img> encima
    // con onerror. Si la URL falla a cargar (token expirado, 403 de CDN), el
    // gradient queda visible y no se ve cuadro negro/vacío.
    const imgHtml = og && og.image
      ? `<div class="link-preview-img" style="background:${svc.gradient}"><img src="${esc(og.image)}" alt="" loading="lazy" onerror="this.style.display='none'" style="width:100%;height:100%;object-fit:cover;display:block"></div>`
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
      // v3.11.90: si el idioma detectado por Whisper NO es español, traducimos
      // automáticamente con Groq Llama. El campo language viene en ipcRes.language.
      const detectedLang = (ipcRes.language || '').toLowerCase();
      const isSpanish = !detectedLang || detectedLang === 'es' || detectedLang === 'spanish' || detectedLang === 'castellano';
      var translationMeta = null;
      if (!isSpanish && transcript) {
        _setTranscriptionStatus('🌍 Idioma detectado: ' + detectedLang + ' — traduciendo al español...');
        try {
          const trRes = await window.api.translateToSpanish({
            apiKey,
            text: transcript,
            sourceLanguage: detectedLang
          });
          if (trRes && trRes.ok && trRes.text) {
            translationMeta = { sourceLanguage: detectedLang, originalText: transcript };
            transcript = trRes.text.trim();
          } else {
            console.warn('[transcribe] traducción falló, dejando texto original:', trRes && trRes.error);
          }
        } catch (e) {
          console.warn('[transcribe] error traduciendo:', e);
        }
      }
    } else {
      throw new Error('callTranscriptionApi no expuesto. Cerrá y reabrí la app (Quit completo) para que cargue el preload nuevo.');
    }
    if (!transcript) throw new Error('Transcripción vacía. ¿El video tiene audio?');
    const updateData = {
      transcription: transcript,
      transcribedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (typeof translationMeta !== 'undefined' && translationMeta) {
      updateData.transcriptionSourceLanguage = translationMeta.sourceLanguage;
      updateData.transcriptionOriginal = translationMeta.originalText;
    }
    await db.collection('depositEntries').doc(entryId).update(updateData);
    const statusMsg = (typeof translationMeta !== 'undefined' && translationMeta)
      ? '✓ Transcripción lista (traducido desde ' + translationMeta.sourceLanguage + ')'
      : '✓ Transcripción lista';
    _setTranscriptionStatus(statusMsg, 'success');
    setTimeout(() => _renderTranscriptionModalContent(entryId), 200);
  } catch (e) {
    _setTranscriptionStatus('❌ Error: ' + e.message, 'error');
  }
}

// v3.9.22: Tonos y estilos predefinidos para guiar la variación.
// Todos los guiones DEBEN empezar con hook viral de retención, mantener la idea
// pero presentarla distinto. Estos profiles ajustan tono y estructura.
const SCRIPT_TONOS = {
  educativo:     { label: 'Educativo',     desc: 'Tono claro, didáctico, como un profesor explicando' },
  energetico:    { label: 'Energético',    desc: 'Ritmo rápido, frases cortas, mucha energía' },
  motivacional:  { label: 'Motivacional',  desc: 'Inspirador, llamado a la acción, transforma al espectador' },
  storytelling:  { label: 'Storytelling',  desc: 'Narrativo con conflicto y resolución, cuenta una historia' },
  controversial: { label: 'Controversial', desc: 'Provoca, cuestiona lo obvio, opina fuerte' },
  casual:        { label: 'Casual',        desc: 'Como charla con un amigo cercano, lenguaje coloquial' },
  dramatico:     { label: 'Dramático',     desc: 'Suspenso, tensión, pausas estratégicas' },
  neutro:        { label: 'Neutro',        desc: 'Tono balanceado, ni emocional ni frío' }
};
const SCRIPT_ESTILOS = {
  hook_dato:     { label: 'Hook + dato impactante', desc: 'Comienza con un dato o cifra que sorprenda' },
  pregunta:      { label: 'Pregunta provocadora',   desc: 'Comienza con una pregunta que active al espectador' },
  pasos:         { label: 'Lista de pasos',         desc: 'Estructura "1, 2, 3..." con cada paso accionable' },
  mito_realidad: { label: 'Mito vs realidad',       desc: 'Desmiente algo que la mayoría cree erróneamente' },
  antes_despues: { label: 'Antes / Después',        desc: 'Contraste de transformación, narrativa de cambio' },
  caso_real:     { label: 'Caso real',              desc: 'Ejemplo concreto narrado, alguien específico' },
  tutorial:      { label: 'Tutorial directo',       desc: 'Cómo hacer X en pocos pasos, sin rodeos' },
  comparativa:   { label: 'Comparativa',            desc: 'Compara 2 opciones / 2 enfoques / 2 resultados' }
};

// v3.11.106: longitud del guion generado por Claude.
// Promedio hablado en español neutro: ~2.3 palabras/seg.
const SCRIPT_LONGITUDES = {
  corto: { label: 'Corto', seconds: 30, words: 70, desc: 'corto y directo, ~30 segundos hablado' },
  medio: { label: 'Medio', seconds: 60, words: 140, desc: 'mediano, ~60 segundos hablado' },
  largo: { label: 'Largo', seconds: 90, words: 210, desc: 'extendido, ~90 segundos hablado, espacio para desarrollar más' }
};

// v3.11.107: opciones de CTA (Call To Action) integradas en el guion.
const SCRIPT_CTAS = {
  ninguno: { label: 'Sin CTA', instruction: null },
  seguir: { label: 'Seguir cuenta', instruction: 'Sigue la cuenta para más contenido como este' },
  comentar: { label: 'Comentar', instruction: 'Comenta tu opinión / experiencia / qué se te ocurre con esto' },
  aprender: { label: 'Aprender más', instruction: 'Aprende más en el link en la bio / link en mi perfil' },
  guardar: { label: 'Guardar video', instruction: 'Guarda este video para volver a verlo cuando lo necesites' },
  guardar_seguir: { label: 'Guardar + Seguir', instruction: 'Guarda este video y sigue la cuenta para no perderte más' },
  comentar_seguir: { label: 'Comentar + Seguir', instruction: 'Comenta abajo + Sigue la cuenta para más' },
  compartir: { label: 'Compartir', instruction: 'Comparte este video con alguien que lo necesita ver' },
  // v3.11.154: CTA con palabra clave para automatización ManyChat/DM trigger.
  // Claude ELIGE la palabra basándose en el contenido del video.
  comentar_palabra: { label: 'Comenta + palabra clave (IA elige · envío automático)', instruction: 'Pide a la audiencia que comente UNA PALABRA CLAVE específica para recibir un recurso gratis relacionado al tema del video. La palabra la ELIGES TÚ basándote en el contenido — debe cumplir TODAS estas reglas:\n- 4 a 8 letras (corta y memorable)\n- EN MAYÚSCULAS\n- Fácil de tipear sin errores (sin acentos, sin ñ, sin caracteres especiales)\n- Una sola palabra (NO frases compuestas)\n- Temáticamente conectada con el tema del video o el recurso ofrecido\n- Que invite a la acción y refuerce el valor del recurso\n\nEjemplos del formato del CTA:\n- "Comenta GUIA y te envío la guía completa gratis"\n- "Comenta CHECK y te mando la checklist al privado"\n- "Comenta TIP y te llega el resumen en 30 segundos"\n- "Comenta PLAN y recibes mi plantilla gratis"\n\nIMPORTANTE: la palabra que elijas debe estar pensada para automatización (ManyChat o similar): cuando alguien comenta esa palabra exacta, un bot le envía el recurso por DM automático. Por eso debe ser ÚNICA, corta, sin ambigüedad, y memorable.' }
};
const SCRIPT_CTA_POSICIONES = {
  final: { label: 'Al final', instruction: 'EXACTAMENTE en la última frase del guion, como cierre' },
  medio: { label: 'En el medio', instruction: 'ESTRATÉGICAMENTE integrado en el medio del guion, en una transición natural — no que rompa el flujo' },
  ambos: { label: 'Medio + final', instruction: 'integrado SUTILMENTE en el medio Y reforzado EXPLÍCITAMENTE en el cierre final' }
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
  const longitudKey = (opts && opts.longitud) || 'medio';
  const ctaKey = (opts && opts.cta) || 'ninguno';
  const ctaPosKey = (opts && opts.ctaPos) || 'final';
  const tono = SCRIPT_TONOS[tonoKey] || SCRIPT_TONOS.educativo;
  const estilo = SCRIPT_ESTILOS[estiloKey] || SCRIPT_ESTILOS.hook_dato;
  const longitud = SCRIPT_LONGITUDES[longitudKey] || SCRIPT_LONGITUDES.medio;
  const cta = SCRIPT_CTAS[ctaKey] || SCRIPT_CTAS.ninguno;
  const ctaPos = SCRIPT_CTA_POSICIONES[ctaPosKey] || SCRIPT_CTA_POSICIONES.final;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando...'; }
  _setTranscriptionStatus(`⏳ Claude generando variación ${longitud.label.toLowerCase()} (${tono.label} · ${estilo.label}${cta.instruction ? ' · CTA: ' + cta.label : ''})...`);
  try {
    const ctaBlock = cta.instruction
      ? `5. CTA OBLIGATORIO: integra un Call To Action que diga "${cta.instruction}". Posición: ${ctaPos.instruction}. El CTA debe sentirse natural — NO suena a comercial barato, suena a invitación honesta del creador.`
      : `5. NO incluyas CTA. Ciérralo con un cliffhanger, reflexión o pregunta que mantenga al espectador hasta el final.`;
    const prompt = `Recrea el siguiente guion de video.

⚠️ REGLA #1 ABSOLUTA — ESPAÑOL NEUTRO INTERNACIONAL ⚠️
El guion DEBE estar escrito en español NEUTRO LATINOAMERICANO, sin ningún regionalismo.
PROHIBIDO ABSOLUTAMENTE:
- Voseo argentino: NO uses "vos", "tenés", "mirá", "andá", "querés", "sabés", "podés", "decí", "fijate", "dale", "che", "boludo".
- Castellano de España: NO uses "vosotros", "os", "tío", "guay", "vale" (como muletilla), "joder", "molar", "currar".
- Mexicanismos extremos: NO "wey", "chido", "chingón", "neta", "padre" (como adjetivo).
- Chileno/colombiano/peruano marcados: NO "weón", "parcero", "bacán", "pana", "chévere" en exceso.

USA SIEMPRE:
- "Tú" como segunda persona singular (formal/informal universal). Conjugación neutra: "tú tienes", "tú puedes", "tú sabes".
- "Ustedes" para plural (NUNCA "vosotros").
- Verbos en imperativo neutro: "comenta", "guarda", "comparte", "sigue", "mira", "haz", "dile" (NO "comentá/comentad/comenten").
- Cuando sea posible, usa construcciones impersonales que evitan tomar lado: "se logra", "hay que", "es importante", "lo que pasa es...".
- Vocabulario universal: "video" (no "vídeo"), "celular" (no "móvil"/"teléfono"), "computadora" (o "computador"), "auto" (no "coche"/"carro" salvo contexto).

Este es el español que usan los doblajes latinoamericanos profesionales (películas de Disney, Netflix LATAM, etc.). NEUTRO = entendible por cualquier hispanohablante de cualquier país sin que suene a "extranjero".

REGLAS DE CONTENIDO:
1. EMPIEZA con un HOOK VIRAL de retención de audiencia — los primeros 3 segundos definen si la persona se queda o pasa de largo. Sé contundente: dato impactante, pregunta provocadora, frase polémica, o lo que aplique según el estilo.
2. LONGITUD: el guion debe ser ${longitud.desc}. Apunta a aproximadamente ${longitud.words} palabras (${longitud.seconds} segundos hablados). NO te quedes corto NI te excedas — esa es la duración objetivo. Si el original es mucho más largo o más corto, ajústalo a esa medida sin perder la idea central.
3. Mantén la MISMA idea/tema central que el original, pero adaptada a la longitud pedida.
4. Cambia las palabras, el ángulo, el orden — que NO sea reconocible como copia del original.
${ctaBlock}
6. Reitera: español NEUTRO LATINOAMERICANO, listo para grabar. SIN regionalismos.

PERFIL DE ESTA VARIACIÓN:
- Tono: ${tono.label} — ${tono.desc}
- Estilo: ${estilo.label} — ${estilo.desc}
- Longitud: ${longitud.label} (~${longitud.seconds}s / ~${longitud.words} palabras)
${cta.instruction ? `- CTA: ${cta.label} — "${cta.instruction}" — ${ctaPos.label}` : '- CTA: ninguno'}

DEVUELVE SOLO el guion nuevo, sin explicaciones, sin encabezados, sin comillas. Texto plano listo para leer en cámara, en español neutro internacional.

GUION ORIGINAL:
${entry.transcription}`;
    const result = await window.api.generateWithClaude({
      prompt: prompt,
      model: 'claude-sonnet-4-6',
      maxTokens: 2500
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
      longitud: longitudKey,
      cta: ctaKey,
      ctaPos: ctaPosKey,
      tonoLabel: tono.label,
      estiloLabel: estilo.label,
      longitudLabel: longitud.label,
      ctaLabel: cta.instruction ? cta.label : null,
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

// v3.11.98: re-fetchear manualmente la portada de una entry específica.
// Útil cuando el lazy fetcher falló y el usuario quiere forzar un nuevo intento.
// Logguea todo el flow en la consola para diagnosticar problemas.
async function refetchEntryCover(entryId, btn) {
  console.log('[refetch-cover] start for entry:', entryId);
  const entry = entries.find(e => e.id === entryId);
  if (!entry) {
    console.error('[refetch-cover] entry not found:', entryId);
    return;
  }
  const links = entry.links || [];
  if (links.length === 0) {
    alert('Esta entry no tiene links — no hay desde dónde fetchear.');
    return;
  }
  const url = links[0].url;
  console.log('[refetch-cover] first link:', url);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    // 1) Si es video de Cloudinary, generar thumb por URL
    const cdn = cloudinaryVideoThumb(url);
    if (cdn) {
      console.log('[refetch-cover] cloudinary thumb generated:', cdn);
      await db.collection('depositEntries').doc(entryId).update({
        coverImage: cdn,
        coverWidth: 1080,
        coverHeight: 1920,
        coverFetcherV: 149
      });
      console.log('[refetch-cover] DONE (cloudinary path)');
      return;
    }
    // 2) Llamar a fetch-og-data (cascada completa)
    console.log('[refetch-cover] calling fetchOgData...');
    const og = await window.api.fetchOgData(url);
    console.log('[refetch-cover] fetchOgData result:', og);
    if (!og || !og.image) {
      alert('No se pudo obtener portada del link.\n\nURL: ' + url + '\n\nProbablemente la red bloquea Instagram embed o el link no es público. Mirá la consola para detalles.');
      return;
    }
    const update = { coverImage: og.image, coverFetcherV: 149 };
    if (og.imageWidth && og.imageHeight) {
      update.coverWidth = og.imageWidth;
      update.coverHeight = og.imageHeight;
    }
    await db.collection('depositEntries').doc(entryId).update(update);
    console.log('[refetch-cover] DONE (og path), image:', og.image);
  } catch (e) {
    console.error('[refetch-cover] ERROR:', e);
    alert('Error: ' + (e.message || e));
  } finally {
    if (btn) { btn.textContent = '🔄'; btn.disabled = false; }
  }
}

// v3.11.98: copy al portapapeles con fallback robusto. navigator.clipboard.writeText
// puede fallar silenciosamente en Electron iframes (sin foco, sin permisos, contexto
// no-secure). Si falla, caemos a document.execCommand('copy') con un textarea temporal.
async function copyToClipboardRobust(text) {
  if (!text) return false;
  // Intento 1: API moderna
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    console.warn('[copy] navigator.clipboard falló, intentando fallback:', e.message);
  }
  // Intento 2: textarea + execCommand (legacy pero funciona en cualquier contexto)
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch (e) {
    console.error('[copy] execCommand fallback falló:', e);
  }
  return false;
}

// v3.11.96: dividir un guion transcrito en escenas cortas para HeyGen o Veo 3
async function splitTranscriptionIntoScenes(entryId, btn) {
  const entry = entries.find(e => e.id === entryId);
  if (!entry || !entry.transcription) {
    alert('Primero transcribí el video.');
    return;
  }
  if (!window.api || !window.api.generateWithClaude) {
    _setTranscriptionStatus('❌ generateWithClaude no disponible. Actualizá la app.', 'error');
    return;
  }
  const durationSel = document.getElementById('sceneDuration');
  const targetSel = document.getElementById('sceneTarget');
  const sceneDuration = parseInt((durationSel && durationSel.value) || '15', 10);
  const target = (targetSel && targetSel.value) || 'heygen';
  const targetLabel = target === 'flashomni' ? 'Google Flash Omni' : 'HeyGen';

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando escenas...'; }
  _setTranscriptionStatus(`⏳ Claude dividiendo el guion en escenas de ${sceneDuration}s para ${targetLabel}...`);

  // Promedio de palabras por segundo hablado en español neutro: ~2.3 palabras/seg
  const wordsPerScene = Math.round(sceneDuration * 2.3);

  let prompt;
  if (target === 'heygen') {
    prompt = `Te paso un guion de video. Divídelo en ESCENAS de ${sceneDuration} segundos cada una, para usarse con HeyGen y que un avatar AI las narre.

⚠️ IDIOMA OBLIGATORIO — ESPAÑOL NEUTRO INTERNACIONAL:
- PROHIBIDO voseo argentino (vos/tenés/mirá/podés/decí), castellano de España (vosotros/os/tío/vale/molar), mexicanismos (wey/chido/neta), o cualquier regionalismo marcado.
- USA "tú" universal, imperativos neutros (comenta/guarda/mira/sigue), vocabulario universal (video, celular, computadora).
- Es el español de los doblajes profesionales de Disney/Netflix LATAM — entendible por TODOS los hispanohablantes.

REGLAS:
1. Cada escena tiene que sonar natural hablada por una persona — frases completas, no fragmentos cortados.
2. Cada escena debe durar aproximadamente ${sceneDuration} segundos al ser leída — eso son ~${wordsPerScene} palabras por escena.
3. Mantén el HOOK al inicio de la escena 1. Que cada escena cierre dejando ganas de pasar a la siguiente (cliffhangers, preguntas, tensión).
4. NO cortes ideas a la mitad. Cada escena debe ser una unidad coherente.
5. Mantén el sentido y el orden del guion original.

FORMATO de salida — JSON válido, SIN nada antes o después:
{"scenes":[
  {"n":1,"text":"texto de la escena 1, listo para que el avatar lo lea"},
  {"n":2,"text":"texto de la escena 2"},
  ...
]}

GUION ORIGINAL:
${entry.transcription}`;
  } else {
    prompt = `Te paso un guion de video. Conviértelo en una serie de PROMPTS visuales para Google Flash Omni, donde cada prompt genera un clip de ${sceneDuration} segundos.

CONTEXTO IMPORTANTE: El usuario va a generar clips secuenciales con su CLON AI como protagonista. Los clips deben mantener continuidad visual entre escenas (mismo personaje, mismo estilo, transiciones suaves).

⚠️ IDIOMA OBLIGATORIO en los voiceover — ESPAÑOL NEUTRO INTERNACIONAL:
- PROHIBIDO voseo argentino, castellano de España, o regionalismos marcados.
- USA "tú" universal e imperativos neutros (comenta/guarda/mira/sigue).
- Los prompts visuales pueden ir en inglés si es estándar para video gen (ok), pero los voiceovers SIEMPRE en español neutro.

REGLAS para cada prompt:
1. Describe la escena VISUALMENTE — qué se ve, cómo se mueve la cámara, ambiente, iluminación, vestuario del personaje (el clon).
2. Incluye en cada escena: "Mantener el mismo personaje (clon del usuario) con la misma apariencia y vestuario que en escenas anteriores" para asegurar continuidad.
3. Acción específica del personaje + diálogo o voiceover que va sobre el clip.
4. Cada escena dura ${sceneDuration}s — no más, no menos.
5. Estilo cinematográfico, lenguaje claro de prompts de generación de video.

FORMATO de salida — JSON válido, SIN nada antes o después:
{"scenes":[
  {"n":1,"text":"prompt completo para Google Flash Omni escena 1","voiceover":"qué se escucha hablando en esta escena (español neutro)"},
  {"n":2,"text":"prompt para Google Flash Omni escena 2","voiceover":"..."},
  ...
]}

GUION ORIGINAL:
${entry.transcription}`;
  }

  try {
    const result = await window.api.generateWithClaude({
      prompt,
      model: 'claude-sonnet-4-6',
      maxTokens: 4000
    });
    if (!result || !result.ok) {
      throw new Error(result && result.error ? result.error : 'No se pudo conectar con Claude');
    }
    const raw = (result.text || '').trim();
    // Extraer JSON aunque venga con texto extra antes/después
    let json;
    try {
      json = JSON.parse(raw);
    } catch (_) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Claude no devolvió JSON válido. Probá de nuevo.');
      json = JSON.parse(m[0]);
    }
    const scenes = (json && Array.isArray(json.scenes)) ? json.scenes : [];
    if (scenes.length === 0) throw new Error('Claude no devolvió escenas. Probá de nuevo.');

    const currentEntry = entries.find(e => e.id === entryId);
    const sceneSplits = Array.isArray(currentEntry.sceneSplits) ? currentEntry.sceneSplits : [];
    sceneSplits.push({
      target,
      targetLabel,
      duration: sceneDuration,
      scenes,
      createdAt: new Date().toISOString()
    });
    await db.collection('depositEntries').doc(entryId).update({ sceneSplits });
    _setTranscriptionStatus(`✓ ${scenes.length} escenas generadas para ${targetLabel}`, 'success');
    setTimeout(() => _renderTranscriptionModalContent(entryId), 200);
  } catch (e) {
    _setTranscriptionStatus('❌ Error generando escenas: ' + (e.message || e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🎬 Dividir en escenas'; }
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
  // v3.11.106: bloque global de split (HeyGen/Flash Omni) eliminado.
  // El split ahora se hace por variación individual con splitTextByDuration.

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
        if (v.longitudLabel) tagBits.push(esc(v.longitudLabel));
        if (v.ctaLabel) tagBits.push('CTA: ' + esc(v.ctaLabel));
        const tags = tagBits.length > 0
          ? `<span style="font-size:9px;color:var(--text-secondary);background:var(--bg-card);padding:2px 6px;border-radius:4px;margin-left:6px;font-weight:500">${tagBits.join(' · ')}</span>`
          : '';
        // v3.11.104: panel "Dividir esta variación en escenas" + render de escenas.
        // El split es TEXTUAL puro (sin Claude) — toma EXACTAMENTE el texto de la
        // variación elegida y lo parte en chunks por word count, sin agregar nada.
        const scenes = Array.isArray(v.scenes) ? v.scenes : [];
        const currentDur = v.sceneDuration || 15;
        const instructions = v.sceneInstructions || '';
        // v3.11.148: si hay perSceneInstructions (skill aplicado), usar esas EN VEZ
        // de las instrucciones compartidas. Cada escena muestra su instrucción
        // específica generada por Claude basada en el skill.
        const perSceneInstr = Array.isArray(v.perSceneInstructions) ? v.perSceneInstructions : null;
        const appliedSkillName = v.appliedSkillName || '';
        const globalPromptText = v.skillGlobalPrompt || '';
        const skillBanner = perSceneInstr && appliedSkillName
          ? `<div style="background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.35);border-radius:6px;padding:6px 10px;font-size:10.5px;color:#c4b5fd;margin-bottom:8px;display:flex;align-items:center;gap:6px"><span style="font-weight:700">⚡ Skill aplicado:</span> ${esc(appliedSkillName)} <span style="margin-left:auto;font-size:9.5px;opacity:0.7">click en la pill de nuevo para quitar</span></div>`
          : '';
        const globalPromptHtml = globalPromptText
          ? `<div style="background:linear-gradient(135deg,rgba(167,139,250,0.15),rgba(139,92,246,0.1));border:1px solid rgba(167,139,250,0.4);border-left:4px solid #a78bfa;border-radius:6px;padding:10px 12px;margin-bottom:10px"><div style="font-size:10px;color:#c4b5fd;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:6px">🌐 Super Prompt Global (aplica a TODAS las escenas) <button data-copy-global-prompt="${i}" class="btn btn-ghost btn-small" style="margin-left:auto;padding:2px 6px;font-size:9.5px;background:rgba(167,139,250,0.2);border:1px solid rgba(167,139,250,0.4);color:#c4b5fd">📋 Copiar global</button></div><div style="font-size:11.5px;line-height:1.5;color:var(--text-primary);white-space:pre-wrap">${esc(globalPromptText)}</div></div>`
          : '';
        const scenesHtml = scenes.length === 0 ? '' : `
          <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <span style="font-size:10px;color:#ff9866;font-weight:700;letter-spacing:0.3px;text-transform:uppercase">🎬 ${scenes.length} escenas de ${currentDur}s · El botón "📋 Copiar" de arriba copia TODAS juntas</span>
              <button class="btn btn-danger btn-small" data-clear-var-scenes="${i}" style="padding:2px 8px;font-size:10px">🗑</button>
            </div>
            ${skillBanner}
            ${globalPromptHtml}
            <div style="display:flex;flex-direction:column;gap:6px">
              ${scenes.map((sc, sIdx) => {
                const sceneInstr = perSceneInstr ? (perSceneInstr[sIdx] || '') : instructions;
                const isPerScene = perSceneInstr && sceneInstr;
                const instrColor = isPerScene ? '#a78bfa' : '#ff9866';
                const instrBg = isPerScene ? 'rgba(167,139,250,0.08)' : 'rgba(255,128,64,0.04)';
                return `
                <div style="background:var(--bg-card);padding:8px 10px;border-radius:6px;border-left:3px solid ${isPerScene ? '#a78bfa' : '#ff9866'}">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">
                    <span style="font-size:10px;color:${instrColor};font-weight:700">Escena ${sIdx + 1} · ${currentDur}s${isPerScene ? ' · ⚡' : ''}</span>
                    <button class="btn btn-ghost btn-small" data-copy-var-scene="${i}-${sIdx}" style="padding:2px 8px;font-size:10px">📋 Copiar</button>
                  </div>
                  ${sceneInstr ? `<div style="font-size:11.5px;line-height:1.5;color:var(--text-secondary);background:${instrBg};padding:6px 8px;border-radius:4px;margin-bottom:6px;white-space:pre-wrap">${esc(sceneInstr)}</div>` : ''}
                  ${sceneInstr ? `<div style="font-size:10px;color:${instrColor};font-weight:700;margin-bottom:3px">Guion en español:</div>` : ''}
                  <div style="font-size:12px;line-height:1.5;color:var(--text-primary)">${esc(sc)}</div>
                </div>`;
              }).join('')}
            </div>
          </div>`;
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
            <div style="margin-top:10px;padding:10px 12px;background:rgba(255,128,64,0.06);border:1px solid rgba(255,128,64,0.2);border-radius:6px">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
                <span style="font-size:10px;color:#ff9866;font-weight:700;letter-spacing:0.3px;text-transform:uppercase">🎬 Dividir en escenas</span>
                <select data-var-scene-dur="${i}" style="padding:4px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-family:inherit;font-size:11px">
                  <option value="8" ${currentDur===8?'selected':''}>8 segundos</option>
                  <option value="10" ${currentDur===10?'selected':''}>10 segundos</option>
                  <option value="15" ${currentDur===15?'selected':''}>15 segundos</option>
                </select>
                <button class="btn btn-primary btn-small" data-split-var="${i}" style="padding:4px 10px;font-size:10px;background:#ff9866;border-color:#ff7a3d">✂️ Dividir esta variación</button>
              </div>
              <!-- v3.11.150: removidas las "Instrucciones manuales" y "Mis plantillas".
                   Skills hace todo: escribís el contenido como instrucción del skill
                   (sea estático o variable) y al click se aplica a las escenas. -->

              <!-- v3.11.150: Skills — click en pill = aplicar a las escenas ya divididas -->
              <div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
                  <span style="font-size:10px;color:#a78bfa;font-weight:700;letter-spacing:0.3px;text-transform:uppercase">🎯 Mis Skills (instrucciones para cada escena)</span>
                  <button class="btn btn-ghost btn-small" data-new-skill="1" style="padding:2px 8px;font-size:10px;background:rgba(167,139,250,0.18);border:1px solid rgba(167,139,250,0.45);color:#c4b5fd;font-weight:600">🧠 Nuevo skill</button>
                </div>
                <div data-skills-list="${i}" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;padding:6px;background:var(--bg-card);border:1px dashed rgba(167,139,250,0.25);border-radius:4px;min-height:30px;align-items:center"></div>
                <div style="font-size:9.5px;color:var(--text-dim);margin-top:4px;font-style:italic">Primero dividí en escenas con ✂️. Después click en un skill (⚡) y Claude le aplica la indicación a CADA escena (no cambia el guion, solo agrega arriba). Click de nuevo lo quita.</div>
              </div>
            </div>
            ${scenesHtml}
          </div>`;
      }).join('');
    // v3.11.126: renderizar pills de plantillas + bindear botón guardar
    list.querySelectorAll('[data-scene-tpl-list]').forEach(el => {
      renderSceneTplPills(el, parseInt(el.dataset.sceneTplList, 10));
    });
    list.querySelectorAll('[data-save-scene-tpl]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = parseInt(btn.dataset.saveSceneTpl, 10);
        openSceneTplModalForCreate(idx, entryId);
      });
    });
    // v3.11.148: pills de skills (click = aplicar a escenas) + botón Nuevo skill
    list.querySelectorAll('[data-skills-list]').forEach(el => {
      renderSkillsPills(el, parseInt(el.dataset.skillsList, 10), entryId);
    });
    list.querySelectorAll('[data-new-skill]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openSkillModalForCreate();
      });
    });
    // v3.11.153: copiar super prompt global solo
    list.querySelectorAll('[data-copy-global-prompt]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const idx = parseInt(btn.dataset.copyGlobalPrompt, 10);
        const v = variations[idx];
        if (!v || !v.skillGlobalPrompt) return;
        const ok = await copyToClipboardRobust(v.skillGlobalPrompt);
        btn.textContent = ok ? '✓ Copiado' : '⚠ Error';
        setTimeout(() => { btn.textContent = '📋 Copiar global'; }, 1500);
      });
    });
    list.querySelectorAll('[data-tp-variation]').forEach(b => b.addEventListener('click', () => {
      openTeleprompter(variations[parseInt(b.dataset.tpVariation)].text, entryId);
    }));
    list.querySelectorAll('[data-copy-variation]').forEach(b => b.addEventListener('click', async () => {
      const idx = parseInt(b.dataset.copyVariation);
      const v = variations[idx] || {};
      // v3.11.105: si la variación tiene escenas generadas, "Copiar" copia
      // TODAS las escenas concatenadas (junto con título de escena) listas
      // para pegar. Si no hay escenas, copia el texto plano de la variación.
      let text = '';
      if (Array.isArray(v.scenes) && v.scenes.length > 0) {
        const dur = v.sceneDuration || 15;
        const instr = v.sceneInstructions || '';
        const perScene = Array.isArray(v.perSceneInstructions) ? v.perSceneInstructions : null;
        const globalP = (v.skillGlobalPrompt || '').trim();
        // v3.11.153: si hay super prompt global, lo ponemos al tope del copy
        const header = globalP ? `🌐 SUPER PROMPT GLOBAL (aplica a TODAS las escenas)\n${'='.repeat(60)}\n${globalP}\n${'='.repeat(60)}\n\n` : '';
        text = header + v.scenes.map((s, i) => {
          const sceneInstr = perScene ? (perScene[i] || '') : instr;
          return `=== Escena ${i + 1} (${dur}s) ===\n${formatSceneForCopy(s, sceneInstr)}`;
        }).join('\n\n');
      } else {
        text = v.text || '';
      }
      const ok = await copyToClipboardRobust(text);
      b.textContent = ok ? '✓ Copiado' : '⚠ Error';
      setTimeout(() => { b.textContent = '📋 Copiar'; }, 1500);
    }));
    list.querySelectorAll('[data-del-variation]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Borrar esta variación?')) return;
      const idx = parseInt(b.dataset.delVariation);
      const newVars = variations.slice();
      newVars.splice(idx, 1);
      await db.collection('depositEntries').doc(entryId).update({ scriptVariations: newVars });
    }));
    // v3.11.110: bind LOCAL directo para split-var (además del delegate global).
    // Doble protección. Los bind locales son los que históricamente funcionan
    // para los otros botones (tp-variation, copy-variation, del-variation).
    const splitBtns = list.querySelectorAll('[data-split-var]');
    console.log('[render-vars] binding', splitBtns.length, 'split-var buttons');
    splitBtns.forEach(btn => btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const idx = parseInt(btn.dataset.splitVar, 10);
      console.log('[split-var LOCAL] click idx=', idx);
      const currentEntry = entries.find(e => e.id === entryId);
      if (!currentEntry || !Array.isArray(currentEntry.scriptVariations)) {
        _setTranscriptionStatus('⚠ Entry no encontrada', 'error');
        return;
      }
      const v = currentEntry.scriptVariations[idx];
      if (!v || !v.text) { _setTranscriptionStatus('⚠ Variación vacía', 'error'); return; }
      const durSel = list.querySelector(`[data-var-scene-dur="${idx}"]`);
      const duration = parseInt((durSel && durSel.value) || '15', 10);
      const scenes = splitTextByDuration(v.text, duration);
      console.log('[split-var LOCAL] split into', scenes.length, 'scenes');
      if (scenes.length === 0) { _setTranscriptionStatus('⚠ Texto muy corto', 'error'); return; }
      const newVars = currentEntry.scriptVariations.slice();
      newVars[idx] = { ...v, scenes, sceneDuration: duration };
      btn.disabled = true;
      btn.textContent = '⏳ Dividiendo...';
      _setTranscriptionStatus(`⏳ Dividiendo en ${scenes.length} escenas de ${duration}s...`);
      try {
        await db.collection('depositEntries').doc(entryId).update({ scriptVariations: newVars });
        _setTranscriptionStatus(`✓ Variación dividida en ${scenes.length} escenas`, 'success');
        setTimeout(() => _renderTranscriptionModalContent(entryId), 200);
      } catch (e) {
        console.error('[split-var LOCAL] save error', e);
        _setTranscriptionStatus('❌ Error: ' + (e.message || e), 'error');
        btn.disabled = false;
        btn.textContent = '✂️ Dividir esta variación';
      }
    }));
  }
}

// v3.11.109: formatea una escena para copiar/exportar — si la variación tiene
// sceneInstructions, las antepone con "Guion en español:" como separador.
// Si no, devuelve solo el texto de la escena.
function formatSceneForCopy(sceneText, instructions) {
  const instr = (instructions || '').trim();
  if (!instr) return sceneText || '';
  return `${instr}\n\nGuion en español:\n${sceneText || ''}`;
}

// =============================================================================
// v3.11.126: PLANTILLAS de instrucciones de "Dividir en escenas"
// Estructura igual a captionTemplates: { name, folder, text, usageCount,
// createdBy, createdByName, createdAt, editedAt, lastUsedAt, workspaceId }
// =============================================================================
function _sceneTplFolderColor(folder) {
  if (!folder) return '#ff9866';
  let hash = 0;
  for (let i = 0; i < folder.length; i++) hash = folder.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  const h = hue / 360, s = 0.62, l = 0.58;
  const k = n => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}
function _hexToRgba(hex, a) {
  const m = (hex || '').replace('#', '');
  if (m.length !== 6) return `rgba(255,152,102,${a})`;
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Pinta la fila de pills debajo de la textarea de instrucciones de una variación.
function renderSceneTplPills(containerEl, variationIdx) {
  if (!containerEl) return;
  if (!Array.isArray(sceneInstructionTemplates) || sceneInstructionTemplates.length === 0) {
    containerEl.innerHTML = '<span style="font-size:10px;color:var(--text-dim);font-style:italic">Sin plantillas guardadas. Escribí instrucciones arriba y dale 💾.</span>';
    return;
  }
  containerEl.innerHTML = sceneInstructionTemplates.map(t => {
    const folder = t.folder || 'General';
    const c = _sceneTplFolderColor(folder);
    const name = t.name || (t.text || '').slice(0, 32);
    const titleAttr = esc((t.text || '').slice(0, 240) + ((t.text || '').length > 240 ? '...' : ''));
    return `
      <div class="scene-tpl-pill" data-scene-tpl="${esc(t.id)}" data-scene-tpl-var="${variationIdx}" title="${titleAttr}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 4px 3px 4px;background:${_hexToRgba(c, 0.15)};border:1px solid ${_hexToRgba(c, 0.45)};border-radius:14px;font-size:10.5px;cursor:pointer;line-height:1.4;user-select:none;color:var(--text-primary)">
        <span style="background:${_hexToRgba(c, 0.32)};color:${c};font-weight:700;font-size:9px;padding:2px 6px;border-radius:10px;letter-spacing:0.2px">${esc(folder)}</span>
        <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
        <span class="scene-tpl-edit" data-edit-scene-tpl="${esc(t.id)}" title="Editar" style="opacity:0.55;padding:0 2px;font-size:11px">&#9998;</span>
        <span class="scene-tpl-delete" data-delete-scene-tpl="${esc(t.id)}" data-delete-scene-name="${esc(t.name || 'esta plantilla')}" title="Eliminar plantilla" style="opacity:0.55;padding:0 5px 1px 5px;font-size:13px;border-radius:50%;color:#ff6b6b;font-weight:700;line-height:1">×</span>
      </div>`;
  }).join('');
  containerEl.querySelectorAll('[data-scene-tpl]').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.dataset.deleteSceneTpl) {
        e.stopPropagation();
        const tplId = e.target.dataset.deleteSceneTpl;
        const tplName = e.target.dataset.deleteSceneName;
        if (!confirm(`Borrar la plantilla "${tplName}"?\n\nEsta acción no se puede deshacer.`)) return;
        try {
          await db.collection('sceneInstructionTemplates').doc(tplId).delete();
          _setTranscriptionStatus(`✓ Plantilla "${tplName}" eliminada`, 'success');
        } catch (err) {
          alert('Error borrando plantilla: ' + (err.message || err));
        }
        return;
      }
      if (e.target.dataset.editSceneTpl) {
        e.stopPropagation();
        openSceneTplModalForEdit(e.target.dataset.editSceneTpl);
      } else {
        useSceneTpl(el.dataset.sceneTpl, parseInt(el.dataset.sceneTplVar, 10));
      }
    });
  });
}

// Aplica la plantilla a la textarea de instrucciones de la variación.
function useSceneTpl(tplId, variationIdx) {
  const tpl = sceneInstructionTemplates.find(t => t.id === tplId);
  if (!tpl) return;
  const ta = document.querySelector(`[data-var-scene-instructions="${variationIdx}"]`);
  if (!ta) return;
  if (ta.value.trim() && !confirm('Ya hay instrucciones escritas. Reemplazarlas con esta plantilla?')) return;
  ta.value = tpl.text || '';
  ta.focus();
  try {
    db.collection('sceneInstructionTemplates').doc(tplId).update({
      usageCount: (tpl.usageCount || 0) + 1,
      lastUsedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
  } catch (_) {}
}

function updateSceneTplFolderOptions() {
  const dl = document.getElementById('sceneTplFolderList');
  if (!dl) return;
  const folders = [...new Set(sceneInstructionTemplates.map(t => t.folder || 'General'))].sort();
  dl.innerHTML = folders.map(f => `<option value="${esc(f)}">`).join('');
}

function openSceneTplModalForCreate(variationIdx, entryId) {
  editingSceneTplId = null;
  _sceneTplTargetVariation = { entryId, variationIdx };
  const ta = document.querySelector(`[data-var-scene-instructions="${variationIdx}"]`);
  const currentText = ta ? ta.value.trim() : '';
  document.getElementById('sceneTplModalTitle').innerHTML = '&#128190; Guardar plantilla de instrucciones';
  document.getElementById('sceneTplName').value = '';
  document.getElementById('sceneTplFolder').value = '';
  document.getElementById('sceneTplText').value = currentText;
  document.getElementById('deleteSceneTpl').style.display = 'none';
  document.getElementById('sceneTplModal').classList.add('active');
  setTimeout(() => document.getElementById('sceneTplName').focus(), 100);
}

function openSceneTplModalForEdit(id) {
  const tpl = sceneInstructionTemplates.find(t => t.id === id);
  if (!tpl) return;
  editingSceneTplId = id;
  document.getElementById('sceneTplModalTitle').innerHTML = '&#9998; Editar plantilla';
  document.getElementById('sceneTplName').value = tpl.name || '';
  document.getElementById('sceneTplFolder').value = tpl.folder || '';
  document.getElementById('sceneTplText').value = tpl.text || '';
  document.getElementById('deleteSceneTpl').style.display = '';
  document.getElementById('sceneTplModal').classList.add('active');
  setTimeout(() => document.getElementById('sceneTplName').focus(), 100);
}

async function saveSceneTpl() {
  const name = document.getElementById('sceneTplName').value.trim();
  const folder = document.getElementById('sceneTplFolder').value.trim() || 'General';
  const text = document.getElementById('sceneTplText').value.trim();
  if (!name) { alert('Ponle un nombre corto a la plantilla (lo que aparece en la pill)'); return; }
  if (!text) { alert('La plantilla está vacía. Escribí las instrucciones que querés reusar.'); return; }
  const payload = {
    name,
    folder,
    text,
    editedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (WS_ID) payload.workspaceId = WS_ID;
  try {
    if (editingSceneTplId) {
      await db.collection('sceneInstructionTemplates').doc(editingSceneTplId).update(payload);
    } else {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      payload.lastUsedAt = firebase.firestore.FieldValue.serverTimestamp();
      payload.usageCount = 0;
      if (currentUser) {
        payload.createdBy = currentUser.uid;
        const me = teamMembers.find(m => m.id === currentUser.uid);
        if (me) payload.createdByName = me.name || me.email || '';
      }
      await db.collection('sceneInstructionTemplates').add(payload);
    }
    document.getElementById('sceneTplModal').classList.remove('active');
    editingSceneTplId = null;
  } catch (e) {
    console.error('[scene-tpl] save error', e);
    alert('Error guardando la plantilla: ' + (e.message || e));
  }
}

async function deleteSceneTpl() {
  if (!editingSceneTplId) return;
  if (!confirm('Borrar esta plantilla? No se puede deshacer.')) return;
  try {
    await db.collection('sceneInstructionTemplates').doc(editingSceneTplId).delete();
    document.getElementById('sceneTplModal').classList.remove('active');
    editingSceneTplId = null;
  } catch (e) {
    alert('Error borrando: ' + (e.message || e));
  }
}

// =============================================================================
// v3.11.147: SKILLS — instrucciones que MODIFICAN CÓMO Claude divide el guion.
// A diferencia de las plantillas (que solo se repiten en el copy de cada escena),
// los skills se INYECTAN al prompt de Claude para que el AI las aplique.
// Multi-select: cuando hacés AI Split, podés tener N skills activos a la vez.
// =============================================================================
function _skillFolderColor(folder) {
  if (!folder) return '#a78bfa';
  let hash = 0;
  for (let i = 0; i < folder.length; i++) hash = folder.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  const h = hue / 360, s = 0.62, l = 0.58;
  const k = n => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}

function renderSkillsPills(containerEl, variationIdx, entryId) {
  if (!containerEl) return;
  if (!Array.isArray(scriptSkills) || scriptSkills.length === 0) {
    containerEl.innerHTML = '<span style="font-size:10px;color:var(--text-dim);font-style:italic">Sin skills guardados. Ejemplo: "Variar planos de cámara por escena", "Aumentar tensión", "Cliffhangers escalados". Tocá 🧠 para crear el primero.</span>';
    return;
  }
  // Saber qué skill está aplicado actualmente en esta variación
  const entry = entries.find(e => e.id === entryId);
  let appliedSkillId = null;
  if (entry && Array.isArray(entry.scriptVariations) && entry.scriptVariations[variationIdx]) {
    appliedSkillId = entry.scriptVariations[variationIdx].appliedSkillId || null;
  }
  containerEl.innerHTML = scriptSkills.map(s => {
    const folder = s.folder || 'General';
    const c = _skillFolderColor(folder);
    const name = s.name || (s.text || '').slice(0, 32);
    const titleAttr = esc((s.text || '').slice(0, 240) + ((s.text || '').length > 240 ? '...' : ''));
    const isApplied = appliedSkillId === s.id;
    return `
      <div class="skill-pill" data-skill-id="${esc(s.id)}" data-skill-var="${variationIdx}" data-skill-entry="${esc(entryId || '')}" title="${titleAttr}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 4px 3px 4px;background:${isApplied ? _hexToRgba(c, 0.5) : _hexToRgba(c, 0.12)};border:1px solid ${isApplied ? c : _hexToRgba(c, 0.45)};border-radius:14px;font-size:10.5px;cursor:pointer;line-height:1.4;user-select:none;color:var(--text-primary);${isApplied ? 'box-shadow:0 0 0 2px ' + _hexToRgba(c, 0.35) + ';font-weight:600' : ''}">
        ${isApplied ? '<span style="color:' + c + ';font-weight:700">⚡</span>' : ''}
        <span style="background:${_hexToRgba(c, 0.32)};color:${c};font-weight:700;font-size:9px;padding:2px 6px;border-radius:10px;letter-spacing:0.2px">${esc(folder)}</span>
        <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
        <span class="skill-edit" data-edit-skill="${esc(s.id)}" title="Editar" style="opacity:0.55;padding:0 2px;font-size:11px">&#9998;</span>
        <span class="skill-delete" data-delete-skill="${esc(s.id)}" data-delete-skill-name="${esc(s.name || 'este skill')}" title="Eliminar" style="opacity:0.55;padding:0 5px 1px 5px;font-size:13px;border-radius:50%;color:#ff6b6b;font-weight:700;line-height:1">×</span>
      </div>`;
  }).join('');
  containerEl.querySelectorAll('[data-skill-id]').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.dataset.deleteSkill) {
        e.stopPropagation();
        const id = e.target.dataset.deleteSkill;
        const name = e.target.dataset.deleteSkillName;
        if (!confirm(`Borrar el skill "${name}"?\n\nEsta acción no se puede deshacer.`)) return;
        try {
          await db.collection('scriptSkills').doc(id).delete();
          _setTranscriptionStatus(`✓ Skill "${name}" eliminado`, 'success');
        } catch (err) {
          alert('Error borrando skill: ' + (err.message || err));
        }
        return;
      }
      if (e.target.dataset.editSkill) {
        e.stopPropagation();
        openSkillModalForEdit(e.target.dataset.editSkill);
        return;
      }
      // CLICK = aplicar skill a las escenas (o quitar si ya está aplicado)
      const id = el.dataset.skillId;
      const varIdx = parseInt(el.dataset.skillVar, 10);
      const entId = el.dataset.skillEntry;
      console.log('[skill-click] id=', id, 'var=', varIdx, 'entry=', entId);
      if (!entId) {
        alert('Error interno: entryId vacío. Cerrá el modal y volvelo a abrir.');
        return;
      }
      // Feedback visual inmediato
      el.style.opacity = '0.6';
      el.style.cursor = 'wait';
      try {
        await applySkillToScenes(entId, varIdx, id);
      } finally {
        el.style.opacity = '';
        el.style.cursor = '';
      }
    });
  });
}

function updateSkillFolderOptions() {
  const dl = document.getElementById('skillFolderList');
  if (!dl) return;
  const folders = [...new Set(scriptSkills.map(t => t.folder || 'General'))].sort();
  dl.innerHTML = folders.map(f => `<option value="${esc(f)}">`).join('');
}

function openSkillModalForCreate() {
  editingSkillId = null;
  document.getElementById('skillModalTitle').innerHTML = '&#129504; Nuevo skill';
  document.getElementById('skillName').value = '';
  document.getElementById('skillFolder').value = '';
  document.getElementById('skillText').value = '';
  document.getElementById('deleteSkill').style.display = 'none';
  document.getElementById('skillModal').classList.add('active');
  setTimeout(() => document.getElementById('skillName').focus(), 100);
}

function openSkillModalForEdit(id) {
  const s = scriptSkills.find(x => x.id === id);
  if (!s) return;
  editingSkillId = id;
  document.getElementById('skillModalTitle').innerHTML = '&#9998; Editar skill';
  document.getElementById('skillName').value = s.name || '';
  document.getElementById('skillFolder').value = s.folder || '';
  document.getElementById('skillText').value = s.text || '';
  document.getElementById('deleteSkill').style.display = '';
  document.getElementById('skillModal').classList.add('active');
  setTimeout(() => document.getElementById('skillName').focus(), 100);
}

async function saveSkill() {
  const name = document.getElementById('skillName').value.trim();
  const folder = document.getElementById('skillFolder').value.trim() || 'General';
  const text = document.getElementById('skillText').value.trim();
  if (!name) { alert('Ponele un nombre corto al skill (lo que aparece en la pill)'); return; }
  if (!text) { alert('El skill está vacío. Escribí la instrucción que querés que Claude aplique al dividir.'); return; }
  const payload = {
    name,
    folder,
    text,
    editedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (WS_ID) payload.workspaceId = WS_ID;
  try {
    if (editingSkillId) {
      await db.collection('scriptSkills').doc(editingSkillId).update(payload);
    } else {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      payload.lastUsedAt = firebase.firestore.FieldValue.serverTimestamp();
      payload.usageCount = 0;
      if (currentUser) {
        payload.createdBy = currentUser.uid;
        const me = teamMembers.find(m => m.id === currentUser.uid);
        if (me) payload.createdByName = me.name || me.email || '';
      }
      await db.collection('scriptSkills').add(payload);
    }
    document.getElementById('skillModal').classList.remove('active');
    editingSkillId = null;
  } catch (e) {
    console.error('[skill] save error', e);
    alert('Error guardando skill: ' + (e.message || e));
  }
}

async function deleteSkillFromModal() {
  if (!editingSkillId) return;
  if (!confirm('Borrar este skill? No se puede deshacer.')) return;
  try {
    await db.collection('scriptSkills').doc(editingSkillId).delete();
    document.getElementById('skillModal').classList.remove('active');
    editingSkillId = null;
  } catch (e) {
    alert('Error borrando: ' + (e.message || e));
  }
}

function _setupSkillModal() {
  const cancelBtn = document.getElementById('cancelSkill');
  const confirmBtn = document.getElementById('confirmSkill');
  const deleteBtn = document.getElementById('deleteSkill');
  const overlay = document.getElementById('skillModal');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { overlay.classList.remove('active'); editingSkillId = null; });
  if (confirmBtn) confirmBtn.addEventListener('click', saveSkill);
  if (deleteBtn) deleteBtn.addEventListener('click', deleteSkillFromModal);
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.classList.remove('active'); editingSkillId = null; } });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _setupSkillModal);
} else {
  _setupSkillModal();
}

// =============================================================================
// v3.11.148: Aplicar skill a escenas YA divididas. NO toca el guion ni la
// división — solo genera per-scene instructions con Claude basado en el skill,
// que se inyectan ARRIBA de cada escena al copiar. Click en pill = aplicar.
// =============================================================================
async function applySkillToScenes(entryId, variationIdx, skillId) {
  const entry = entries.find(e => e.id === entryId);
  if (!entry || !Array.isArray(entry.scriptVariations)) return;
  const v = entry.scriptVariations[variationIdx];
  if (!v) return;
  if (!Array.isArray(v.scenes) || v.scenes.length === 0) {
    _setTranscriptionStatus('⚠ Primero dividí la variación en escenas con ✂️', 'error');
    return;
  }
  const skill = scriptSkills.find(s => s.id === skillId);
  if (!skill) return;
  if (!window.api || !window.api.generateWithClaude) {
    _setTranscriptionStatus('❌ generateWithClaude no disponible.', 'error');
    return;
  }

  // Si ya está aplicado este mismo skill → quitarlo (toggle)
  if (v.appliedSkillId === skillId) {
    const currentEntry = entries.find(e => e.id === entryId);
    const newVars = currentEntry.scriptVariations.slice();
    newVars[variationIdx] = {
      ...v,
      perSceneInstructions: firebase.firestore.FieldValue.delete(),
      appliedSkillId: firebase.firestore.FieldValue.delete(),
      appliedSkillName: firebase.firestore.FieldValue.delete()
    };
    try {
      // Firestore FieldValue.delete() en array de objetos no funciona, hacemos limpieza local
      const cleanVar = { ...v };
      delete cleanVar.perSceneInstructions;
      delete cleanVar.skillGlobalPrompt;
      delete cleanVar.appliedSkillId;
      delete cleanVar.appliedSkillName;
      newVars[variationIdx] = cleanVar;
      await db.collection('depositEntries').doc(entryId).update({ scriptVariations: newVars });
      _setTranscriptionStatus(`✓ Skill "${skill.name}" removido`, 'success');
      setTimeout(() => _renderTranscriptionModalContent(entryId), 200);
    } catch (e) {
      _setTranscriptionStatus('❌ Error removiendo skill: ' + (e.message || e), 'error');
    }
    return;
  }

  _setTranscriptionStatus(`⏳ Claude aplicando skill "${skill.name}" a ${v.scenes.length} escenas...`);

  const scenesList = v.scenes.map((text, i) => `═══ ESCENA ${i + 1} ═══\n${text}`).join('\n\n');

  const prompt = `Te paso un skill y N escenas ya divididas. Tu trabajo: leer TODAS las reglas del skill y generar instrucciones CONCISAS para cada escena.

🎯 SKILL — "${skill.name}"
═══════════════════════════════════════════════════════════════
${skill.text}
═══════════════════════════════════════════════════════════════

PROCESO:
1. ANALIZA el skill: identificá cada regla, objetivo y restricción. Lista mental: regla A, regla B, regla C...
2. Para cada escena, generá una instrucción CONCISA que respete TODAS las reglas. Si el skill tiene 5 reglas, las 5 aparecen — pero EN FORMATO COMPACTO, no en párrafos largos.
3. Generá un super prompt global CORTO (1 párrafo de 3-5 líneas máximo) que resuma el contexto universal del skill.

⚠️ REGLAS DE FORMATO (críticas):
- CONCISO: cada instrucción de escena = 2-4 líneas máximo, o un bloque de bullets cortos. Nada de explicaciones largas.
- COMPLETO: si el skill tiene 5 reglas, las 5 deben estar PRESENTES en cada instrucción (aunque sea como bullet de 1 línea cada una). No omitas reglas por brevedad.
- EJECUTABLE: el productor lee tu instrucción y sabe exactamente qué hacer SIN releer el skill. Formato directo, sin padding.
- VARIACIÓN: si el skill pide cambios escena a escena (ej. distintos planos), VARIÁ — no repitas misma cosa.
- IDIOMA: español neutro internacional. NO voseo (vos/tenés), NO España (vosotros/os), NO regionalismos. Usá "tú".

FORMATO PREFERIDO POR ESCENA (ejemplo):
[PLANO: close-up rostro]
[ILUMINACIÓN: cálida lateral]
[TENSIÓN: alta — pausa de 1s al inicio]
[TRANSICIÓN: cut seco hacia escena siguiente]

Eso es lo que queremos: bloques compactos, cada uno una regla del skill aplicada a la escena específica. NO párrafos explicativos.

ESCENAS (no las modifiques, solo generás los prompts compactos ARRIBA):
${scenesList}

══════════════════════════════════════════════════════════════
FORMATO DE SALIDA — JSON estricto, SIN nada antes o después, SIN markdown:

{
  "globalPrompt": "Super prompt CORTO (1 párrafo de 3-5 líneas) que sintetiza el contexto universal del skill aplicado a toda la variación.",
  "instructions": [
    "Instrucción CONCISA para escena 1 — bloque compacto con TODAS las reglas del skill aplicadas a esta escena. 2-4 líneas o bullets cortos. SIN padding.",
    "Instrucción CONCISA para escena 2 — distinta a la 1 si hay variación, con TODAS las reglas.",
    "...EXACTAMENTE ${v.scenes.length} instrucciones, ninguna salteada."
  ]
}

EXACTAMENTE ${v.scenes.length} instrucciones. Concisas pero completas — todas las reglas presentes en formato compacto.`;

  try {
    const result = await window.api.generateWithClaude({
      prompt,
      model: 'claude-sonnet-4-6',
      maxTokens: 2500
    });
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : 'No se pudo conectar con Claude');
    let parsed;
    try {
      const cleaned = (result.text || '').replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error('Claude devolvió JSON inválido: ' + (result.text || '').slice(0, 200));
    }
    if (!parsed || !Array.isArray(parsed.instructions) || parsed.instructions.length === 0) {
      throw new Error('Claude no devolvió instrucciones');
    }
    const globalPrompt = (parsed.globalPrompt || '').trim();
    // Pad o trim para matchear cantidad de escenas
    const perScene = v.scenes.map((_, i) => (parsed.instructions[i] || '').trim());
    if (perScene.filter(x => x).length !== v.scenes.length) {
      console.warn('[apply-skill] count mismatch — got', perScene.filter(x => x).length, 'expected', v.scenes.length);
    }

    const currentEntry = entries.find(e => e.id === entryId);
    const newVars = currentEntry.scriptVariations.slice();
    newVars[variationIdx] = {
      ...v,
      perSceneInstructions: perScene,
      skillGlobalPrompt: globalPrompt,
      appliedSkillId: skillId,
      appliedSkillName: skill.name
    };
    await db.collection('depositEntries').doc(entryId).update({ scriptVariations: newVars });

    // Incrementar usage del skill
    try {
      await db.collection('scriptSkills').doc(skillId).update({
        usageCount: (skill.usageCount || 0) + 1,
        lastUsedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (_) {}

    _setTranscriptionStatus(`✓ Skill "${skill.name}" aplicado a ${v.scenes.length} escenas`, 'success');
    setTimeout(() => _renderTranscriptionModalContent(entryId), 200);
  } catch (e) {
    console.error('[apply-skill] error', e);
    _setTranscriptionStatus('❌ Error aplicando skill: ' + (e.message || e), 'error');
  }
}

// Bind modal buttons (una sola vez al cargar deposit)
function _setupSceneTplModal() {
  const cancelBtn = document.getElementById('cancelSceneTpl');
  const confirmBtn = document.getElementById('confirmSceneTpl');
  const deleteBtn = document.getElementById('deleteSceneTpl');
  const overlay = document.getElementById('sceneTplModal');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { overlay.classList.remove('active'); editingSceneTplId = null; });
  if (confirmBtn) confirmBtn.addEventListener('click', saveSceneTpl);
  if (deleteBtn) deleteBtn.addEventListener('click', deleteSceneTpl);
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.classList.remove('active'); editingSceneTplId = null; } });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _setupSceneTplModal);
} else {
  _setupSceneTplModal();
}

// v3.11.104: split textual puro del guion en chunks por word count.
// NO usa Claude — solo agrupa oraciones del texto original hasta alcanzar
// el target de palabras por escena. NO agrega ni reescribe nada.
// Promedio hablado en español neutro: ~2.3 palabras/seg.
function splitTextByDuration(text, durationSec) {
  if (!text || !text.trim()) return [];
  const wordsTarget = Math.round(durationSec * 2.3); // 8s≈18, 10s≈23, 15s≈35
  // Parte el texto en oraciones manteniendo signos de puntuación
  const sentences = text.match(/[^.!?¡¿\n]+[.!?¡¿]+|[^.!?¡¿\n]+(?=\n|$)/g) || [text];
  const scenes = [];
  let current = '';
  let currentWords = 0;
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const w = s.split(/\s+/).length;
    if (currentWords === 0) {
      current = s;
      currentWords = w;
      continue;
    }
    // Cabe si total ≤ wordsTarget * 1.3 (tolerancia 30% para no quedarse corto)
    if (currentWords + w <= Math.round(wordsTarget * 1.3)) {
      current += ' ' + s;
      currentWords += w;
    } else {
      scenes.push(current);
      current = s;
      currentWords = w;
    }
  }
  if (current) scenes.push(current);
  return scenes;
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
      openTranscriptionModal(openRecordedBtn.dataset.openRecorded);
    }
    return;
  }
  // v3.11.107: handlers del split por variación (delegate global, no depende del wireup local)
  const splitVarBtn = ev.target.closest('[data-split-var]');
  if (splitVarBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    const idx = parseInt(splitVarBtn.dataset.splitVar, 10);
    const entryId = _currentTranscriptionEntryId;
    const entry = entries.find(e => e.id === entryId);
    if (!entry || !Array.isArray(entry.scriptVariations) || !entry.scriptVariations[idx]) {
      console.warn('[split-var] no entry / variation', { entryId, idx });
      _setTranscriptionStatus('⚠ No se pudo dividir: variación no encontrada', 'error');
      return;
    }
    const durSel = document.querySelector(`[data-var-scene-dur="${idx}"]`);
    const duration = parseInt((durSel && durSel.value) || '15', 10);
    const v = entry.scriptVariations[idx];
    if (!v || !v.text) { _setTranscriptionStatus('⚠ La variación está vacía', 'error'); return; }
    console.log('[split-var] splitting variation', idx, 'duration', duration, 'words', v.text.split(/\s+/).length);
    const scenes = splitTextByDuration(v.text, duration);
    console.log('[split-var] split returned', scenes.length, 'scenes');
    if (scenes.length === 0) { _setTranscriptionStatus('⚠ El split devolvió 0 escenas — texto muy corto', 'error'); return; }
    const newVars = entry.scriptVariations.slice();
    newVars[idx] = { ...v, scenes, sceneDuration: duration };
    splitVarBtn.disabled = true;
    splitVarBtn.textContent = '⏳ Dividiendo...';
    _setTranscriptionStatus(`⏳ Dividiendo variación en ${scenes.length} escenas de ${duration}s...`);
    db.collection('depositEntries').doc(entryId).update({ scriptVariations: newVars })
      .then(() => {
        console.log('[split-var] saved', scenes.length, 'scenes');
        _setTranscriptionStatus(`✓ Variación dividida en ${scenes.length} escenas`, 'success');
        // v3.11.108: forzar re-render del modal para que aparezcan las escenas
        // (onSnapshot actualiza el array `entries` pero el modal no es reactivo)
        setTimeout(() => _renderTranscriptionModalContent(entryId), 200);
      })
      .catch(e => {
        console.error('[split-var] save error', e);
        _setTranscriptionStatus('❌ Error guardando escenas: ' + (e.message || e), 'error');
      })
      .finally(() => { splitVarBtn.disabled = false; splitVarBtn.textContent = '✂️ Dividir esta variación'; });
    return;
  }
  const copyVarSceneBtn = ev.target.closest('[data-copy-var-scene]');
  if (copyVarSceneBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    const [varIdx, sIdx] = copyVarSceneBtn.dataset.copyVarScene.split('-').map(n => parseInt(n, 10));
    const entry = entries.find(e => e.id === _currentTranscriptionEntryId);
    const v = entry && entry.scriptVariations && entry.scriptVariations[varIdx];
    const sceneText = (v && v.scenes && v.scenes[sIdx]) || '';
    // v3.11.148: si la variación tiene perSceneInstructions (skill aplicado), usar
    // la instrucción específica de esta escena. Sino, fallback a la compartida.
    const perScene = v && Array.isArray(v.perSceneInstructions) ? v.perSceneInstructions[sIdx] : null;
    const instr = perScene || (v && v.sceneInstructions) || '';
    const text = formatSceneForCopy(sceneText, instr);
    copyToClipboardRobust(text).then(ok => {
      copyVarSceneBtn.textContent = ok ? '✓ Copiado' : '⚠ Error';
      setTimeout(() => { copyVarSceneBtn.textContent = '📋 Copiar'; }, 1500);
    });
    return;
  }
  const clearVarScenesBtn = ev.target.closest('[data-clear-var-scenes]');
  if (clearVarScenesBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!confirm('Borrar las escenas de esta variación?')) return;
    const idx = parseInt(clearVarScenesBtn.dataset.clearVarScenes, 10);
    const entryId = _currentTranscriptionEntryId;
    const entry = entries.find(e => e.id === entryId);
    if (!entry || !Array.isArray(entry.scriptVariations)) return;
    const newVars = entry.scriptVariations.slice();
    const { scenes, sceneDuration, ...rest } = newVars[idx] || {};
    newVars[idx] = rest;
    db.collection('depositEntries').doc(entryId).update({ scriptVariations: newVars })
      .then(() => setTimeout(() => _renderTranscriptionModalContent(entryId), 200));
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
  const longitudSelect = document.getElementById('variationLongitud');
  const ctaSelect = document.getElementById('variationCta');
  const ctaPosSelect = document.getElementById('variationCtaPos');
  function updateVariationDesc() {
    if (!descEl || !tonoSelect || !estiloSelect) return;
    const t = SCRIPT_TONOS[tonoSelect.value];
    const e = SCRIPT_ESTILOS[estiloSelect.value];
    const l = longitudSelect ? SCRIPT_LONGITUDES[longitudSelect.value] : null;
    const c = ctaSelect ? SCRIPT_CTAS[ctaSelect.value] : null;
    const cp = ctaPosSelect ? SCRIPT_CTA_POSICIONES[ctaPosSelect.value] : null;
    if (t && e) {
      const lDesc = l ? ` · ${l.label} (~${l.seconds}s)` : '';
      const ctaDesc = (c && c.instruction) ? ` · CTA "${c.label}" ${cp ? cp.label.toLowerCase() : ''}` : '';
      descEl.textContent = `→ ${t.desc} · ${e.desc}${lDesc}${ctaDesc}`;
    }
  }
  if (tonoSelect) tonoSelect.addEventListener('change', updateVariationDesc);
  if (estiloSelect) estiloSelect.addEventListener('change', updateVariationDesc);
  if (longitudSelect) longitudSelect.addEventListener('change', updateVariationDesc);
  if (ctaSelect) ctaSelect.addEventListener('change', updateVariationDesc);
  if (ctaPosSelect) ctaPosSelect.addEventListener('change', updateVariationDesc);
  updateVariationDesc();

  const generate = document.getElementById('transcriptionGenerate');
  if (generate) generate.addEventListener('click', () => {
    if (!_currentTranscriptionEntryId) return;
    const opts = {
      tono: tonoSelect ? tonoSelect.value : 'educativo',
      estilo: estiloSelect ? estiloSelect.value : 'hook_dato',
      longitud: longitudSelect ? longitudSelect.value : 'medio',
      cta: ctaSelect ? ctaSelect.value : 'ninguno',
      ctaPos: ctaPosSelect ? ctaPosSelect.value : 'final'
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
  // v3.11.64: activar el listener de teclado para controlar con Space/Enter desde la Mac
  attachKeyboardControl();

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

// v3.11.64: handler de teclado para controlar el celu desde la Mac.
// Space/Enter en cualquier parte de la ventana (mientras el modal está abierto)
// → manda toggle al celu vía Firestore. Mucho más confiable que volume keys
// (que Apple bloquea a nivel sistema en macOS y iOS).
let _phoneRecKeyboardHandler = null;
function attachKeyboardControl() {
  if (_phoneRecKeyboardHandler) return; // ya enganchado
  _phoneRecKeyboardHandler = (e) => {
    if (!_phoneRecSessionId) return;
    // Ignorar si el foco está en un input/textarea (no robar typing)
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    const k = e.key || '';
    const c = e.code || '';
    if (k === ' ' || c === 'Space' || k === 'Enter') {
      e.preventDefault();
      console.log('[mac-kb] Space/Enter → toggle celu');
      const btn = document.getElementById('phoneRecToggleBtn');
      sendRemoteCommandFromKeyboard('toggle', btn);
    }
  };
  document.addEventListener('keydown', _phoneRecKeyboardHandler);
  // También en el documento del parent (porque deposit puede estar en iframe)
  try {
    if (window.parent && window.parent !== window && window.parent.document) {
      window.parent.document.addEventListener('keydown', _phoneRecKeyboardHandler);
    }
  } catch (e) { console.warn('[mac-kb] parent doc unreachable', e.message); }
}
function detachKeyboardControl() {
  if (!_phoneRecKeyboardHandler) return;
  try { document.removeEventListener('keydown', _phoneRecKeyboardHandler); } catch (e) {}
  try {
    if (window.parent && window.parent !== window && window.parent.document) {
      window.parent.document.removeEventListener('keydown', _phoneRecKeyboardHandler);
    }
  } catch (e) {}
  _phoneRecKeyboardHandler = null;
}
async function sendRemoteCommandFromKeyboard(action, btn) {
  if (!_phoneRecSessionId) return;
  if (btn) {
    btn.style.background = 'rgba(108,99,255,0.4)';
    setTimeout(() => { btn.style.background = ''; }, 400);
  }
  try {
    await db.collection('recordingSessions').doc(_phoneRecSessionId).update({
      remoteCommand: { action, ts: Date.now() }
    });
  } catch (e) { console.warn('[mac-kb] send failed', e.message); }
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
  // v3.11.64: liberar el listener de teclado al cerrar
  detachKeyboardControl();
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

