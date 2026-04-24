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
let defaultCategoriesEnsured = false;

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
  // Fetch completo del user doc en background (no bloquea el render)
  db.collection('users').doc(user.uid).get().then(snap => {
    if (snap.exists) currentUserData = { id: user.uid, ...snap.data() };
  }).catch(() => {});
});

async function ensureDefaultCategories() {
  if (defaultCategoriesEnsured) return;
  defaultCategoriesEnsured = true;
  const defaults = [
    { id: 'reels', name: 'Reels' },
    { id: 'carruseles', name: 'Carruseles' }
  ];
  const existingIds = new Set(categories.map(c => c.id));
  const toCreate = defaults.filter(d => !existingIds.has(d.id));
  await Promise.all(toCreate.map(d => db.collection('depositCategories').doc(d.id).set({
    name: d.name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: currentUser.uid,
    isDefault: true
  })));
}

function subscribeAll() {
  unsubscribers.forEach(u => u());
  unsubscribers = [];

  unsubscribers.push(db.collection('depositCategories').orderBy('name').onSnapshot(snap => {
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!selectedCategoryId && categories.length > 0) selectedCategoryId = categories[0].id;
    renderCategories();
    renderEntries();
    // Seed default categories if missing (fire-and-forget)
    if (!defaultCategoriesEnsured) ensureDefaultCategories().catch(() => {});
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
  if (roots.length === 0) {
    list.innerHTML = '<div style="padding:10px;color:var(--text-dim);font-size:12px">Sin categorias</div>';
    return;
  }
  list.innerHTML = roots.map(c => {
    // Cuenta todas las ideas en esta categoria (incluyendo subs)
    const count = entries.filter(e => e.categoryId === c.id).length;
    const active = c.id === selectedCategoryId ? ' active' : '';
    const canDelete = !c.isDefault;
    return `
      <div class="category-item${active}" data-id="${esc(c.id)}">
        <span class="cat-name">${esc(c.name)}</span>
        <span class="cat-count">${count}</span>
        ${canDelete ? `<button class="cat-delete" data-delete="${esc(c.id)}" title="Eliminar categoria">&#10005;</button>` : ''}
      </div>`;
  }).join('');

  list.querySelectorAll('.category-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.dataset.delete) return;
      selectedCategoryId = el.dataset.id;
      selectedSubcategoryId = null; // al cambiar de categoria, volver a vista de subs
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

document.getElementById('newCategoryBtn').addEventListener('click', () => showCategoryModal());
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
      cardsHtml += `
        <div class="sub-card" data-sub-id="__unsorted__">
          <div class="sub-card-icon">&#128196;</div>
          <div class="sub-card-name">Sin clasificar</div>
          <div class="sub-card-count">${unsortedCount} idea${unsortedCount === 1 ? '' : 's'}</div>
        </div>`;
    }
    subs.forEach(s => {
      const count = entriesIn(selectedCategoryId, s.id).length;
      cardsHtml += `
        <div class="sub-card" data-sub-id="${esc(s.id)}">
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
  if (entryId) {
    const e = entries.find(x => x.id === entryId);
    document.getElementById('entryTitleInput').value = e.title || '';
    document.getElementById('entryDescInput').value = e.description || '';
    (e.links || []).forEach(l => addLinkRow(l));
  } else {
    document.getElementById('entryTitleInput').value = '';
    document.getElementById('entryDescInput').value = '';
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
    // Editar: solo cambia los campos editables, mantiene categoria/subcategoria original
    await db.collection('depositEntries').doc(editingEntryId).update({
      title, description, links
    });
    toast('Idea actualizada');
  } else {
    // Crear: usar la categoria y subcategoria de donde estamos parados
    const data = {
      title, description, links,
      categoryId: selectedCategoryId,
      categoryName: categories.find(c => c.id === selectedCategoryId)?.name || '',
      status: 'idea',
      createdBy: currentUser.uid,
      createdByName: currentUserData.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (selectedSubcategoryId && selectedSubcategoryId !== '__unsorted__') {
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
