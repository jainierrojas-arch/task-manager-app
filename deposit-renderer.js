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

function rootCategories() { return categories.filter(c => !c.parentId); }
function subcategoriesOf(parentId) { return categories.filter(c => c.parentId === parentId); }
function entriesIn(catId, subId) {
  if (subId === '__unsorted__') return entries.filter(e => e.categoryId === catId && !e.subcategoryId);
  if (subId) return entries.filter(e => e.categoryId === catId && e.subcategoryId === subId);
  return entries.filter(e => e.categoryId === catId);
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

auth.onAuthStateChanged((user) => {
  if (!user) {
    document.getElementById('mainTitle').textContent = 'No has iniciado sesion';
    document.getElementById('mainSubtitle').textContent = 'Inicia sesion en la app principal y vuelve a abrir el deposito.';
    document.getElementById('entriesArea').innerHTML = '';
    return;
  }
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
  const defaults = [
    { id: 'reels', name: 'Reels' },
    { id: 'carruseles', name: 'Carruseles' },
    { id: 'trabajos-finalizados', name: 'Trabajos Finalizados' }
  ];
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
}

function subscribeAll() {
  unsubscribers.forEach(u => u());
  unsubscribers = [];

  unsubscribers.push(db.collection('depositCategories').orderBy('name').onSnapshot(snap => {
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!selectedCategoryId && categories.length > 0) selectedCategoryId = categories[0].id;
    renderCategories();
    renderEntries();
    // Seed default categories si falta alguna (idempotente)
    ensureDefaultCategories().catch(() => {});
  }));

  unsubscribers.push(db.collection('depositEntries').orderBy('createdAt', 'desc').onSnapshot(snap => {
    entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCategories();
    renderEntries();
  }));

  unsubscribers.push(db.collection('projects').orderBy('name').onSnapshot(snap => {
    projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProjectSelect();
  }));

  unsubscribers.push(db.collection('users').onSnapshot(snap => {
    teamMembers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMemberSelects();
  }));
}

// ===== CATEGORIES =====
function renderCategories() {
  const list = document.getElementById('categoryList');
  const roots = rootCategories();
  const normalRoots = roots.filter(c => c.id !== 'trabajos-finalizados');
  const tfRoot = roots.find(c => c.id === 'trabajos-finalizados');

  let html = '';

  // Helper para badge rojo de "nuevas"
  const newBadge = (n) => n > 0
    ? `<span class="new-badge" title="${n} idea${n === 1 ? '' : 's'} nueva${n === 1 ? '' : 's'}">${n > 99 ? '99+' : n}</span>`
    : '';

  // Item especial "Todos" para categorias normales
  if (normalRoots.length > 0) {
    const totalCount = entries.filter(e => e.categoryId !== 'trabajos-finalizados').length;
    const totalNew = entries.filter(e => e.categoryId !== 'trabajos-finalizados' && isNewEntry(e)).length;
    const active = selectedCategoryId === '__all_categories__' ? ' active' : '';
    html += `
      <div class="category-item${active}" data-all-cats="1">
        <span class="cat-name">&#128230; Todos</span>
        ${newBadge(totalNew)}
        <span class="cat-count">${totalCount}</span>
      </div>`;
  }

  // Seccion: Categorias normales
  normalRoots.forEach(c => {
    const count = entries.filter(e => e.categoryId === c.id).length;
    const newCount = entries.filter(e => e.categoryId === c.id && isNewEntry(e)).length;
    const active = c.id === selectedCategoryId && !selectedSubcategoryId ? ' active' : '';
    const canDelete = !c.isDefault;
    html += `
      <div class="category-item${active}" data-id="${esc(c.id)}">
        <span class="cat-name">${esc(c.name)}</span>
        ${newBadge(newCount)}
        <span class="cat-count">${count}</span>
        ${canDelete ? `<button class="cat-delete" data-delete="${esc(c.id)}" title="Eliminar categoria">&#10005;</button>` : ''}
      </div>`;
  });

  // Item "+ Nueva categoria" dentro del listado
  html += `
    <div class="category-item add-cat-inline" data-add-root-cat="1" style="opacity:0.7">
      <span class="cat-name" style="color:var(--text-dim)">+ Nueva categoria</span>
    </div>`;

  // Seccion separada: Trabajos Finalizados con sus subcategorias como items
  if (tfRoot) {
    const tfSubs = subcategoriesOf('trabajos-finalizados');
    const tfTotalCount = entries.filter(e => e.categoryId === 'trabajos-finalizados').length;
    const tfTotalNew = entries.filter(e => e.categoryId === 'trabajos-finalizados' && isNewEntry(e)).length;
    const tfActive = selectedCategoryId === 'trabajos-finalizados' && !selectedSubcategoryId ? ' active' : '';
    html += `
      <div class="category-section-header">TRABAJOS FINALIZADOS</div>
      <div class="category-item${tfActive}" data-tf-root="1">
        <span class="cat-name" style="opacity:0.85">&#128230; Todos</span>
        ${newBadge(tfTotalNew)}
        <span class="cat-count">${tfTotalCount}</span>
      </div>`;
    tfSubs.forEach(s => {
      const c = entries.filter(e => e.subcategoryId === s.id).length;
      const cNew = entries.filter(e => e.subcategoryId === s.id && isNewEntry(e)).length;
      const sActive = selectedSubcategoryId === s.id ? ' active' : '';
      html += `
        <div class="category-item${sActive}" data-tf-sub="${esc(s.id)}" style="padding-left:18px">
          <span class="cat-name">${esc(s.name)}</span>
          ${newBadge(cNew)}
          <span class="cat-count">${c}</span>
          <button class="cat-delete" data-delete-tf-sub="${esc(s.id)}" title="Eliminar categoria">&#10005;</button>
        </div>`;
    });
    html += `
      <div class="category-item add-tf-sub" data-add-tf-sub="1" style="padding-left:18px;opacity:0.7">
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
    const normalRoots = rootCategories().filter(c => c.id !== 'trabajos-finalizados');
    const allEntries = entries.filter(e => e.categoryId !== 'trabajos-finalizados');
    title.textContent = 'Todas las categorias';
    sub.textContent = `${normalRoots.length} categoria${normalRoots.length === 1 ? '' : 's'} - ${allEntries.length} idea${allEntries.length === 1 ? '' : 's'} en total`;
    newBtn.style.display = 'none';
    let cardsHtml = '';
    normalRoots.forEach(c => {
      const count = entries.filter(e => e.categoryId === c.id).length;
      const newCount = entries.filter(e => e.categoryId === c.id && isNewEntry(e)).length;
      const canDelete = !c.isDefault;
      cardsHtml += `
        <div class="sub-card" data-cat-card="${esc(c.id)}">
          ${newCount > 0 ? `<span class="sub-card-new">${newCount} nueva${newCount === 1 ? '' : 's'}</span>` : ''}
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

    let cardsHtml = '';
    // Tarjeta "Sin clasificar" siempre visible si hay ideas sin sub o si no hay subs aun
    if (unsortedCount > 0 || subs.length === 0) {
      const unsortedNew = newCountIn(selectedCategoryId, '__unsorted__');
      cardsHtml += `
        <div class="sub-card" data-sub-id="__unsorted__">
          ${unsortedNew > 0 ? `<span class="sub-card-new">${unsortedNew} nueva${unsortedNew === 1 ? '' : 's'}</span>` : ''}
          <div class="sub-card-icon">&#128196;</div>
          <div class="sub-card-name">Sin clasificar</div>
          <div class="sub-card-count">${unsortedCount} idea${unsortedCount === 1 ? '' : 's'}</div>
        </div>`;
    }
    subs.forEach(s => {
      const count = entriesIn(selectedCategoryId, s.id).length;
      const newCount = newCountIn(selectedCategoryId, s.id);
      cardsHtml += `
        <div class="sub-card" data-sub-id="${esc(s.id)}">
          ${newCount > 0 ? `<span class="sub-card-new">${newCount} nueva${newCount === 1 ? '' : 's'}</span>` : ''}
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
    area.innerHTML = subEntries.map(e => renderEntryHtml(e)).join('');
    lazyFetchCovers(subEntries);
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
  }

  const backBtn = document.getElementById('backToSubs');
  if (backBtn) backBtn.addEventListener('click', () => {
    selectedSubcategoryId = null;
    renderEntries();
  });
}

function renderEntryHtml(e) {
  const author = e.createdByName || 'Anonimo';
  const color = getUserColor(e.createdBy);
  const links = (e.links || []);
  // Chips compactos sin URL larga
  const linkChips = links.map(l => {
    const isVideo = l.type === 'video';
    const cls = isVideo ? 'entry-link-chip video' : 'entry-link-chip';
    const icon = isVideo ? '&#127916;' : '&#128279;';
    const label = l.label && l.label.length > 0
      ? l.label
      : (isVideo ? 'Video' : (l.type === 'recurso' ? 'Recurso' : 'Link'));
    return `<span class="${cls}" data-link-open="${esc(l.url)}" title="${esc(l.url)}">${icon} ${esc(label)}</span>`;
  }).join('');
  const convertedBadge = e.status === 'converted'
    ? `<span class="entry-badge success">&#10003; Convertida en tarea</span>`
    : '';
  const descHtml = e.description ? `<div class="entry-desc">${esc(e.description)}</div>` : '';
  // Cover: imagen Open Graph del primer link (cacheada en e.coverImage)
  const cover = e.coverImage;
  const firstUrl = links[0]?.url || '';
  const coverHtml = cover
    ? `<div class="entry-cover" data-link-open="${esc(firstUrl)}" style="background-image:url('${esc(cover)}')"></div>`
    : '';
  return `
    <div class="entry-card ${e.status === 'converted' ? 'converted' : ''}" data-entry-id="${esc(e.id)}">
      ${coverHtml}
      <div class="entry-card-body">
        <div class="entry-card-head">
          <div class="entry-title">${esc(e.title || '(sin titulo)')}</div>
          ${convertedBadge}
        </div>
        ${descHtml}
        ${linkChips ? `<div class="entry-links">${linkChips}</div>` : ''}
        <div class="entry-card-foot">
          <div class="entry-author">Por <span style="color:${color};font-weight:600">${esc(author)}</span> &middot; ${timeAgo(e.createdAt)}</div>
          <div class="entry-actions">
            <button class="btn btn-ghost btn-small" data-edit="${esc(e.id)}" title="Editar">&#9998;</button>
            <button class="btn btn-danger btn-small" data-delete-entry="${esc(e.id)}" title="Eliminar">&#10005;</button>
            <button class="btn btn-primary btn-small" data-take="${esc(e.id)}" title="Tomarla yo (solo o cadena)">&#128587; Tomar</button>
            <button class="btn btn-success btn-small" data-assign="${esc(e.id)}">&#10140; Asignar</button>
          </div>
        </div>
      </div>
    </div>`;
}

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
}

// Tracking de fetches en curso para no repetir
const ogFetchInFlight = new Set();

async function lazyFetchCovers(visibleEntries) {
  for (const entry of visibleEntries) {
    if (entry.coverImage !== undefined) continue; // ya intentado (incluso si es null)
    const links = entry.links || [];
    if (links.length === 0) continue;
    if (ogFetchInFlight.has(entry.id)) continue;
    ogFetchInFlight.add(entry.id);
    const url = links[0].url;
    try {
      const og = await window.api.fetchOgData(url);
      const update = { coverImage: og.image || null };
      await db.collection('depositEntries').doc(entry.id).update(update);
    } catch (e) { /* ignore */ }
    ogFetchInFlight.delete(entry.id);
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
  } else {
    document.getElementById('entryTitleInput').value = '';
    document.getElementById('entryDescInput').value = '';
    // Si estamos en una sub, pre-seleccionarla
    if (selectedSubcategoryId && selectedSubcategoryId !== '__unsorted__') {
      subSel.value = selectedSubcategoryId;
    }
    addLinkRow({ type: 'video', url: '', label: '' });
  }
  document.getElementById('entryModal').classList.add('active');
  setTimeout(() => document.getElementById('entryTitleInput').focus(), 100);
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
        <option value="material"${link.type === 'material' ? ' selected' : ''}>Material</option>
        <option value="recurso"${link.type === 'recurso' ? ' selected' : ''}>Recurso</option>
      </select>
      <button class="remove-link" title="Quitar este link">&times;</button>
    </div>
    <input type="url" class="link-url" placeholder="https://..." value="${esc(link.url || '')}">
    <input type="text" class="link-label" placeholder="Etiqueta o descripcion (opcional)" value="${esc(link.label || '')}">`;
  row.querySelector('.remove-link').addEventListener('click', () => row.remove());
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

  if (editingEntryId) {
    // Editar: cambia campos editables, permite mover entre subcategorias
    const chosenSubId = document.getElementById('entrySubcategorySelect').value;
    const updateData = { title, description, links };
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

  // Tomar solo el primer link de cada tipo para las casillas de la tarea
  const links = assigningEntry.links || [];
  const videoLink = links.find(l => l.type === 'video')?.url;
  const materialLink = links.find(l => l.type === 'material')?.url || links.find(l => l.type === 'recurso')?.url;

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

  // Marcar entrada como convertida
  await db.collection('depositEntries').doc(assigningEntry.id).update({
    status: 'converted',
    convertedAt: firebase.firestore.FieldValue.serverTimestamp(),
    convertedTaskIds: firebase.firestore.FieldValue.arrayUnion(...createdTaskIds)
  });

  document.getElementById('assignModal').classList.remove('active');
  assigningEntry = null;
});

// Toggle vista sidebar vertical/horizontal (un solo boton que alterna)
// Aplicamos estilos inline directamente para no depender del CSS (mas robusto)
const SIDEBAR_MODE_KEY = 'deposit-sidebar-mode';
let currentSidebarMode = 'vertical';

function applySidebarMode(mode) {
  currentSidebarMode = mode;
  const app = document.querySelector('.app');
  const sidebar = document.querySelector('.sidebar');
  const catList = document.getElementById('categoryList');
  if (!app || !sidebar) return;

  if (mode === 'horizontal') {
    app.classList.add('horizontal');
    app.style.flexDirection = 'column';
    sidebar.style.width = '100%';
    sidebar.style.maxHeight = '210px';
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
  } else {
    app.classList.remove('horizontal');
    app.style.flexDirection = '';
    sidebar.style.width = '';
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
  try { localStorage.setItem(SIDEBAR_MODE_KEY, mode); } catch (e) {}
}

window.toggleSidebarMode = function () {
  console.log('[deposit] toggleSidebarMode antes:', currentSidebarMode);
  applySidebarMode(currentSidebarMode === 'horizontal' ? 'vertical' : 'horizontal');
  console.log('[deposit] toggleSidebarMode despues:', currentSidebarMode);
};
try { applySidebarMode(localStorage.getItem(SIDEBAR_MODE_KEY) || 'vertical'); } catch (e) {}

// Window controls
document.getElementById('btnMinimize').addEventListener('click', () => window.api.minimizeWindow());
document.getElementById('btnClose').addEventListener('click', () => window.api.closeWindow());

// ESC closes modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideCategoryModal();
    hideEntryModal();
    document.getElementById('assignModal').classList.remove('active');
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
