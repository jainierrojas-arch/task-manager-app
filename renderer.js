// ===== STATE =====
let currentUser = null;
let currentUserData = null;
let tasks = [];
let trashTasks = [];
let projects = [];
let teamMembers = [];
let personalTasks = [];
let trashPersonalTasks = [];
let personalProjectsList = []; // proyectos custom del usuario (no incluye 'General')
let currentPersonalProject = 'General';
let lastInteractedProject = null; // {id, name} del ultimo proyecto de equipo tocado por el usuario
let alwaysOnTop = true;
let currentTab = 'main';
let unsubscribeTasks = null;
let unsubscribeProjects = null;
let unsubscribeUsers = null;
let unsubscribePersonal = null;
let unsubscribeNotifQueue = null;
let unsubscribeChat = null;
let unsubscribeDeposit = null;
let depositEntries = [];
let depositLastViewedAt = null;
let reminderTimer = null;
let chatMessages = [];
let chatOpen = false;
let chatLastReadAt = null; // Firestore Timestamp
const CHAT_MESSAGE_LIMIT = 100;
const CHAT_EXTRA_WIDTH = 320;

// Colores por miembro - escogidos para maximo contraste visual entre si
const userColors = [
  '#FF4757', // rojo vivo
  '#1E90FF', // azul vivo
  '#2ED573', // verde vivo
  '#FFA502', // naranja
  '#BE2EDD', // morado
  '#FFD93D', // amarillo
  '#00D2D3', // cyan
  '#FF6348', // coral
  '#70A1FF', // azul cielo
  '#EE5A6F'  // rosa frambuesa
];

// ===== DOM ELEMENTS =====
const el = {
  loginScreen: document.getElementById('loginScreen'),
  appContainer: document.getElementById('appContainer'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginName: document.getElementById('loginName'),
  loginBtn: document.getElementById('loginBtn'),
  loginToggle: document.getElementById('loginToggle'),
  loginError: document.getElementById('loginError'),
  userAvatar: document.getElementById('userAvatar'),
  userName: document.getElementById('userName'),
  userRole: document.getElementById('userRole'),
  logoutBtn: document.getElementById('logoutBtn'),
  taskList: document.getElementById('taskList'),
  myTaskList: document.getElementById('myTaskList'),
  completedList: document.getElementById('completedList'),
  teamList: document.getElementById('teamList'),
  projectSelect: document.getElementById('projectSelect'),
  assignSelect: document.getElementById('assignSelect'),
  taskInput: document.getElementById('taskInput'),
  durationInput: document.getElementById('durationInput'),
  durationUnit: document.getElementById('durationUnit'),
  addTaskBtn: document.getElementById('addTaskBtn'),
  mainBadge: document.getElementById('mainBadge'),
  myBadge: document.getElementById('myBadge'),
  approvalBadge: document.getElementById('approvalBadge'),
  approvalList: document.getElementById('approvalList'),
  personalBadge: document.getElementById('personalBadge'),
  personalList: document.getElementById('personalList'),
  personalCount: document.getElementById('personalCount'),
  reminderInterval: document.getElementById('reminderInterval'),
  saveReminder: document.getElementById('saveReminder'),
  inputArea: document.getElementById('inputArea'),
  telegramToken: document.getElementById('telegramToken'),
  saveTelegram: document.getElementById('saveTelegram'),
  telegramStatus: document.getElementById('telegramStatus'),
  claudeApiKey: document.getElementById('claudeApiKey'),
  saveClaudeKey: document.getElementById('saveClaudeKey'),
  claudeStatus: document.getElementById('claudeStatus'),
  projectModal: document.getElementById('projectModal'),
  projectNameInput: document.getElementById('projectNameInput'),
  newProjectBtn: document.getElementById('newProjectBtn'),
  quickProjectBtn: document.getElementById('quickProjectBtn'),
  confirmProject: document.getElementById('confirmProject'),
  cancelProject: document.getElementById('cancelProject'),
  clearAllCompleted: document.getElementById('clearAllCompleted'),
  projectListSettings: document.getElementById('projectListSettings'),
  btnPin: document.getElementById('btnPin'),
  btnMinimize: document.getElementById('btnMinimize'),
  btnClose: document.getElementById('btnClose'),
  personalProjectsChips: document.getElementById('personalProjectsChips'),
  personalHeaderName: document.getElementById('personalHeaderName'),
  personalProjectRow: document.getElementById('personalProjectRow'),
  personalProjectSelect: document.getElementById('personalProjectSelect'),
  newPersonalProjectBtn: document.getElementById('newPersonalProjectBtn'),
  personalProjectModal: document.getElementById('personalProjectModal'),
  personalProjectNameInput: document.getElementById('personalProjectNameInput'),
  confirmPersonalProject: document.getElementById('confirmPersonalProject'),
  cancelPersonalProject: document.getElementById('cancelPersonalProject'),
  chatToggleBtn: document.getElementById('chatToggleBtn'),
  chatPanel: document.getElementById('chatPanel'),
  chatMessagesEl: document.getElementById('chatMessages'),
  chatInput: document.getElementById('chatInput'),
  chatSendBtn: document.getElementById('chatSendBtn'),
  chatClose: document.getElementById('chatClose'),
  chatUnreadBadge: document.getElementById('chatUnreadBadge'),
  trashList: document.getElementById('trashList'),
  trashBadge: document.getElementById('trashBadge'),
  emptyTrashBtn: document.getElementById('emptyTrashBtn'),
  rememberMe: document.getElementById('rememberMe')
};

// ===== AUTH =====
let isRegistering = false;

// Cargar preferencia de "Mantener sesion" desde localStorage
const REMEMBER_KEY = 'rememberSession';
try {
  const stored = localStorage.getItem(REMEMBER_KEY);
  if (stored !== null && el.rememberMe) el.rememberMe.checked = stored === '1';
} catch (e) {}
if (el.rememberMe) {
  el.rememberMe.addEventListener('change', () => {
    try { localStorage.setItem(REMEMBER_KEY, el.rememberMe.checked ? '1' : '0'); } catch (e) {}
  });
}

// Aplicar persistencia LOCAL (default) o SESSION segun el checkbox.
// IMPORTANTE: NO se llama al iniciar la app, porque puede interferir con la
// sesion ya persistida que Firebase intenta restaurar. Solo se aplica antes
// del signIn cuando el user hace login manual.
async function applyAuthPersistence() {
  if (!firebase.auth.Auth || !firebase.auth.Auth.Persistence) return;
  const remember = el.rememberMe ? el.rememberMe.checked : true;
  const target = remember
    ? firebase.auth.Auth.Persistence.LOCAL
    : firebase.auth.Auth.Persistence.SESSION;
  try { await auth.setPersistence(target); } catch (e) { console.warn('persistence error:', e); }
}

// Auto-rellenar email si lo guardamos en sesiones anteriores
const SAVED_EMAIL_KEY = 'lastLoginEmail';
try {
  const savedEmail = localStorage.getItem(SAVED_EMAIL_KEY);
  if (savedEmail && el.loginEmail) el.loginEmail.value = savedEmail;
} catch (e) {}

el.loginToggle.addEventListener('click', () => {
  isRegistering = !isRegistering;
  el.loginName.style.display = isRegistering ? 'block' : 'none';
  el.loginBtn.textContent = isRegistering ? 'Registrarse' : 'Iniciar Sesion';
  el.loginToggle.innerHTML = isRegistering
    ? 'Ya tienes cuenta? <span>Inicia sesion</span>'
    : 'No tienes cuenta? <span>Registrate</span>';
  hideError();
});

el.loginBtn.addEventListener('click', handleAuth);
el.loginPassword.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleAuth(); });

async function handleAuth() {
  const email = el.loginEmail.value.trim();
  const password = el.loginPassword.value.trim();
  const name = el.loginName.value.trim();

  if (!email || !password) { showError('Ingresa email y contrasena'); return; }
  if (isRegistering && !name) { showError('Ingresa tu nombre'); return; }

  // Aplicar persistencia segun preferencia ANTES de hacer login
  await applyAuthPersistence();
  // Guardar email para auto-rellenar la proxima vez (si la sesion se pierde)
  try {
    if (el.rememberMe && el.rememberMe.checked) {
      localStorage.setItem(SAVED_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(SAVED_EMAIL_KEY);
    }
  } catch (e) {}

  el.loginBtn.disabled = true;
  el.loginBtn.innerHTML = '<span class="loading-spinner"></span>';

  try {
    if (isRegistering) {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await db.collection('users').doc(cred.user.uid).set({
        name: name,
        email: email.toLowerCase(),
        role: 'miembro',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        telegramChatId: ''
      });
    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
  } catch (error) {
    let msg = 'Error desconocido';
    if (error.code === 'auth/user-not-found') msg = 'Usuario no encontrado';
    else if (error.code === 'auth/wrong-password') msg = 'Contrasena incorrecta';
    else if (error.code === 'auth/invalid-credential') msg = 'Email o contrasena incorrectos';
    else if (error.code === 'auth/email-already-in-use') msg = 'Ese email ya esta registrado';
    else if (error.code === 'auth/weak-password') msg = 'La contrasena debe tener al menos 6 caracteres';
    else if (error.code === 'auth/invalid-email') msg = 'Email no valido';
    showError(msg);
  }

  el.loginBtn.disabled = false;
  el.loginBtn.textContent = isRegistering ? 'Registrarse' : 'Iniciar Sesion';
}

function showError(msg) {
  el.loginError.textContent = msg;
  el.loginError.classList.add('visible');
}

function hideError() {
  el.loginError.classList.remove('visible');
}

// Auth state listener
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
      currentUserData = { id: user.uid, ...userDoc.data() };
      if (user.email === 'jainierrojas@gmail.com' && currentUserData.role !== 'admin') {
        await db.collection('users').doc(user.uid).update({ role: 'admin' });
        currentUserData.role = 'admin';
      }
    } else {
      currentUserData = { id: user.uid, name: user.email.split('@')[0], email: user.email, role: 'miembro' };
    }
    showApp();
  } else {
    currentUser = null;
    currentUserData = null;
    showLogin();
  }
});

function showApp() {
  el.loginScreen.classList.add('hidden');
  el.appContainer.classList.add('active');

  el.userAvatar.textContent = currentUserData.name.charAt(0).toUpperCase();
  el.userName.textContent = currentUserData.name;
  el.userRole.textContent = currentUserData.role || 'miembro';

  personalProjectsList = Array.isArray(currentUserData.personalProjects) ? [...currentUserData.personalProjects] : [];
  currentPersonalProject = 'General';
  renderPersonalChips();
  renderPersonalProjectSelect();
  setupProjectInteractionTracking();
  ensureDefaultDepositCategories();

  subscribeToData();
  initTelegramHandlers();
  loadTelegramToken();
  loadClaudeStatus();
  loadReminderInterval();
  loadTabsMode();
  subscribeToNotificationQueue();
}

function showLogin() {
  el.loginScreen.classList.remove('hidden');
  el.appContainer.classList.remove('active');
  if (unsubscribeTasks) unsubscribeTasks();
  if (unsubscribeProjects) unsubscribeProjects();
  if (unsubscribeUsers) unsubscribeUsers();
  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  if (unsubscribeDeposit) { unsubscribeDeposit(); unsubscribeDeposit = null; }
  if (chatOpen) closeChat();
}

el.logoutBtn.addEventListener('click', () => auth.signOut());

const cloudBtn = document.getElementById('cloudBtn');
if (cloudBtn) {
  cloudBtn.addEventListener('click', () => {
    window.api.openExternal('https://drive.google.com/drive/folders/1BuRcSTdiHx07lcUsO9WUe1BoCk81NX2e?usp=sharing');
  });
}

const depositBtn = document.getElementById('depositBtn');
if (depositBtn) {
  depositBtn.addEventListener('click', async () => {
    const isVisible = await window.api.toggleDeposit();
    // Solo actualizar la marca de "ultima visita" cuando se CIERRA el deposito.
    // Asi los globos de "nueva idea" se mantienen visibles mientras estas dentro,
    // y solo se reinician cuando sales y vuelves a entrar.
    if (!isVisible && currentUser) {
      depositLastViewedAt = firebase.firestore.Timestamp.now();
      renderDepositBadge();
      db.collection('users').doc(currentUser.uid).update({
        depositLastViewedAt: depositLastViewedAt
      }).catch(() => {});
    }
  });
}

// ===== FIRESTORE REAL-TIME =====
function subscribeToData() {
  unsubscribeTasks = db.collection('tasks').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
    const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    tasks = all.filter(t => !t.deletedAt);
    trashTasks = all.filter(t => t.deletedAt);
    renderAll();
    renderTrashList();
  });

  unsubscribeProjects = db.collection('projects').orderBy('name').onSnapshot((snapshot) => {
    projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderProjectSelect();
    renderProjectList();
  });

  unsubscribeUsers = db.collection('users').onSnapshot((snapshot) => {
    teamMembers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderAssignSelect();
    renderTeam();
    // Re-renderizar tareas y chat para que los colores asignados por miembro
    // se actualicen cuando teamMembers termina de cargar despues de las tareas
    if (tasks.length > 0) renderAll();
    if (chatOpen) renderChatMessages();
  });

  unsubscribePersonal = db.collection('personalTasks')
    .where('ownerId', '==', currentUser.uid)
    .onSnapshot((snapshot) => {
      const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      personalTasks = all.filter(t => !t.deletedAt);
      trashPersonalTasks = all.filter(t => t.deletedAt);
      renderPersonalList();
      renderTrashList();
    });

  unsubscribeChat = db.collection('chatMessages')
    .orderBy('createdAt', 'desc')
    .limit(CHAT_MESSAGE_LIMIT)
    .onSnapshot((snapshot) => {
      chatMessages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse();
      if (chatOpen) {
        renderChatMessages();
        markChatAsRead();
      }
      renderChatBadge();
    });

  chatLastReadAt = currentUserData.chatLastReadAt || null;

  unsubscribeDeposit = db.collection('depositEntries')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .onSnapshot((snapshot) => {
      depositEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderDepositBadge();
    });

  depositLastViewedAt = currentUserData.depositLastViewedAt || null;
}

function renderDepositBadge() {
  const badge = document.getElementById('depositUnreadBadge');
  if (!badge) return;
  const lastMs = depositLastViewedAt
    ? (depositLastViewedAt.toDate ? depositLastViewedAt.toDate().getTime() : new Date(depositLastViewedAt).getTime())
    : 0;
  const count = depositEntries.filter(e => {
    if (e.createdBy === currentUser.uid) return false;
    if (!e.createdAt) return false;
    const ms = e.createdAt.toDate ? e.createdAt.toDate().getTime() : new Date(e.createdAt).getTime();
    return ms > lastMs;
  }).length;
  if (count <= 0) {
    badge.style.display = 'none';
    return;
  }
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.style.display = 'inline-block';
}

// ===== RENDER =====
// ===== CALENDAR =====
let calCursor = new Date();
let calSelectedDate = null;

function tasksOnDate(date) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const matches = (t) => {
    if (!t.deadline) return false;
    const dd = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    return dd.getFullYear() === y && dd.getMonth() === m && dd.getDate() === d;
  };
  const team = tasks.filter(t => matches(t) && t.status !== 'completed');
  const personal = personalTasks.filter(t => matches(t) && t.status !== 'completed');
  return { team, personal, all: [...team, ...personal] };
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const label = document.getElementById('calMonthLabel');
  if (!grid || !label) return;

  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  label.textContent = calCursor.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const firstOfMonth = new Date(year, month, 1);
  const firstDow = (firstOfMonth.getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayKey = today.toDateString();

  let html = '';
  for (let i = 0; i < firstDow; i++) html += '<div class="calendar-day other-month"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    const key = dt.toDateString();
    const { team, personal, all } = tasksOnDate(dt);
    const classes = ['calendar-day'];
    if (all.length > 0) classes.push('has-tasks');
    if (key === todayKey) classes.push('today');
    if (calSelectedDate && key === calSelectedDate) classes.push('selected');

    html += `<div class="${classes.join(' ')}" onclick="selectCalendarDay('${key}')">`;
    html += `<div class="calendar-day-num">${d}</div>`;
    const preview = [
      ...team.map(t => ({ ...t, _personal: false })),
      ...personal.map(t => ({ ...t, _personal: true }))
    ];
    preview.slice(0, 2).forEach(t => {
      const overdue = !t._personal && (t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline)) < today;
      const cls = t._personal ? 'personal' : (overdue ? 'overdue' : '');
      html += `<div class="calendar-task-dot ${cls}" title="${esc(t.text)}">${esc(t.text.slice(0, 14))}</div>`;
    });
    if (preview.length > 2) html += `<div class="calendar-task-dot">+${preview.length - 2}</div>`;
    html += '</div>';
  }
  grid.innerHTML = html;
  renderCalendarDayList();
}

function renderCalendarDayList() {
  const container = document.getElementById('calendarDayList');
  if (!container) return;
  if (!calSelectedDate) { container.innerHTML = ''; return; }
  const date = new Date(calSelectedDate);
  const { all } = tasksOnDate(date);
  const header = `<div style="padding:8px 12px;font-weight:600;font-size:13px;text-transform:capitalize;display:flex;justify-content:space-between;align-items:center;gap:8px">
    <span>${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    <button class="btn btn-primary btn-small" onclick="openCalTaskModal('${calSelectedDate}')" style="white-space:nowrap">+ Nueva</button>
  </div>`;
  if (all.length === 0) {
    container.innerHTML = header + `<div class="empty-state"><div class="empty-state-text" style="font-size:12px">Sin tareas para este dia</div></div>`;
    return;
  }
  let html = header;
  all.forEach(t => {
    const isPersonal = !t.projectName;
    const color = isPersonal ? '#BB8FCE' : (t.projectColor || '#666');
    const calChip = isPersonal
      ? `<span class="task-assignee" style="background:rgba(187,143,206,0.22);color:#BB8FCE">Personal</span>`
      : assigneeChips(t);
    html += `<div class="task-item" style="border-left-color:${color};margin:4px 12px">
      <div style="flex:1">
        <div class="task-text">${esc(t.text)}</div>
        <div class="task-meta">
          ${calChip}
          <span class="task-tag">${isPersonal ? 'Personal' : esc(t.projectName)}</span>
          ${t.link ? `<span class="task-tag" style="background:rgba(153,102,255,0.2);color:#b794ff;cursor:pointer" onclick="window.api.openExternal('${esc(t.link)}')">🔗 Link</span>` : ''}
        </div>
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

function selectCalendarDay(key) {
  calSelectedDate = key;
  renderCalendar();
}
window.selectCalendarDay = selectCalendarDay;

document.getElementById('calPrev').addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
  renderCalendar();
});
document.getElementById('calToday').addEventListener('click', () => {
  calCursor = new Date();
  calSelectedDate = new Date().toDateString();
  renderCalendar();
});

// ===== TABS VIEW MODE =====
async function loadTabsMode() {
  const multirow = await window.api.getTabsMultirow();
  applyTabsMode(multirow);
}

function applyTabsMode(multirow) {
  const navTabs = document.querySelector('.nav-tabs');
  if (!navTabs) return;
  if (multirow) navTabs.classList.add('multirow');
  else navTabs.classList.remove('multirow');
}

const tabModeBtn = document.getElementById('tabModeBtn');
if (tabModeBtn) {
  tabModeBtn.addEventListener('click', async () => {
    const navTabs = document.querySelector('.nav-tabs');
    const willBe = !navTabs.classList.contains('multirow');
    applyTabsMode(willBe);
    await window.api.setTabsMultirow(willBe);
  });
}

// ===== DEADLINE COUNTDOWN HELPERS =====
function formatTimeRemaining(ms) {
  if (ms < 0) {
    const totalMin = Math.floor(-ms / 60000);
    const d = Math.floor(totalMin / (60 * 24));
    const h = Math.floor((totalMin % (60 * 24)) / 60);
    if (d > 0) return `Vencida hace ${d}d ${h}h`;
    if (h > 0) return `Vencida hace ${h}h`;
    return 'Vencida';
  }
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return '<1m restante';
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h restantes`;
  if (h > 0) return `${h}h ${m}m restantes`;
  return `${m}m restantes`;
}

function deadlineClass(ms) {
  if (ms < 0) return 'deadline-overdue';
  if (ms < 24 * 60 * 60 * 1000) return 'deadline-soon';
  return 'deadline-ok';
}

function deadlineBadgeHtml(deadlineDate) {
  const ts = deadlineDate.getTime();
  const ms = ts - Date.now();
  return `<span class="task-deadline ${deadlineClass(ms)}" data-deadline="${ts}">${formatTimeRemaining(ms)}</span>`;
}

function updateCountdowns() {
  document.querySelectorAll('.task-deadline[data-deadline]').forEach(span => {
    const ts = parseInt(span.dataset.deadline);
    if (!ts) return;
    const ms = ts - Date.now();
    span.textContent = formatTimeRemaining(ms);
    span.classList.remove('deadline-ok', 'deadline-soon', 'deadline-overdue');
    span.classList.add(deadlineClass(ms));
  });
}

setInterval(updateCountdowns, 60 * 1000);

function renderAll() {
  const pending = tasks.filter(t => t.status === 'pending');
  const pendingApproval = tasks.filter(t => t.status === 'pending_approval');
  const completed = tasks.filter(t => t.status === 'completed');
  const myTasks = pending.filter(t => t.assignedTo === currentUser.uid);
  const myPendingApproval = pendingApproval.filter(t => t.assignedTo === currentUser.uid);

  el.mainBadge.textContent = pending.length;
  el.myBadge.textContent = myTasks.length + myPendingApproval.length;
  el.approvalBadge.textContent = pendingApproval.length;

  renderTaskList(el.taskList, pending, 'pending');
  renderTaskList(el.myTaskList, [...myTasks, ...myPendingApproval], 'my-tasks');
  renderTaskList(el.approvalList, pendingApproval, 'approval');
  renderCompletedList(completed.slice(0, 100));
  if (currentTab === 'calendar') renderCalendar();
}

function renderPersonalList() {
  const pending = personalTasks.filter(t => t.status !== 'completed');
  const totalCount = pending.length;
  if (el.personalBadge) el.personalBadge.textContent = totalCount;
  if (currentTab === 'calendar') renderCalendar();

  // Refresca chips con contadores
  renderPersonalChips();

  if (!el.personalList) return;

  const visible = personalTasks.filter(t => personalProjectOf(t) === currentPersonalProject);
  const visiblePending = visible.filter(t => t.status !== 'completed').length;
  if (el.personalCount) el.personalCount.textContent = visiblePending;
  if (el.personalHeaderName) {
    el.personalHeaderName.textContent = currentPersonalProject === 'General'
      ? 'Tareas personales - General'
      : `Proyecto personal: ${currentPersonalProject}`;
  }

  if (visible.length === 0) {
    el.personalList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128246;</div>
        <div class="empty-state-text">No hay tareas en "${esc(currentPersonalProject)}"</div>
        <div class="empty-state-sub">Crea una desde la pestana Nueva (modo personal) o el agente.</div>
      </div>`;
    return;
  }

  const sorted = [...visible].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (b.status === 'completed' && a.status !== 'completed') return -1;
    const at = a.createdAt?.seconds || 0;
    const bt = b.createdAt?.seconds || 0;
    return bt - at;
  });

  let html = '';
  sorted.forEach(task => {
    const completed = task.status === 'completed';
    const color = '#BB8FCE';
    const time = task.createdAt ? formatDate(task.createdAt) : '';
    let deadlineBadge = '';
    if (task.deadline && !completed) {
      const deadlineDate = task.deadline.toDate ? task.deadline.toDate() : new Date(task.deadline);
      deadlineBadge = deadlineBadgeHtml(deadlineDate);
    }

    const checkClass = completed ? 'task-check checked' : 'task-check';
    const onClick = completed ? '' : `onclick="completePersonalTask('${task.id}')"`;
    let linkBadge = '';
    if (task.link) {
      linkBadge = `<span class="task-tag" style="background:rgba(153,102,255,0.2);color:#b794ff;cursor:pointer" onclick="openTaskLink('personalTasks','${task.id}')" title="${esc(task.link)}">🔗 Abrir material</span>`;
    }
    let videoBadge = '';
    if (task.videoLink) {
      videoBadge = `<span class="task-tag" style="background:rgba(255,90,90,0.2);color:#ff8a8a;cursor:pointer" onclick="openTaskVideo('personalTasks','${task.id}')" title="${esc(task.videoLink)}">🎬 Video de referencia</span>`;
    }
    const linkBtn = task.link
      ? `<button class="btn-add-note" onclick="showLinkModal('personalTasks','${task.id}')" title="Editar link">✏️ Link</button>`
      : `<button class="btn-add-note" onclick="showLinkModal('personalTasks','${task.id}')">🔗 + Link</button>`;
    const videoBtn = task.videoLink
      ? `<button class="btn-add-note" onclick="showVideoModal('personalTasks','${task.id}')" title="Editar video">✏️ Video</button>`
      : `<button class="btn-add-note" onclick="showVideoModal('personalTasks','${task.id}')">🎬 + Video</button>`;
    const editBtn = !completed
      ? `<button class="task-delete" onclick="editPersonalTask('${task.id}')" title="Editar" style="color:var(--accent)">&#9998;</button>`
      : '';
    html += `
      <div class="task-item ${completed ? 'completed' : ''}" style="border-left-color:${color}">
        <div class="${checkClass}" ${onClick} title="${completed ? 'Completada' : 'Marcar como terminada'}"></div>
        <div style="flex:1">
          <div class="task-text">${esc(task.text)}</div>
          <div class="task-meta">
            ${deadlineBadge}
            ${linkBadge}
            ${videoBadge}
            <span class="task-tag">${time}</span>
            ${linkBtn}
            ${videoBtn}
          </div>
        </div>
        ${editBtn}
        <button class="task-delete" onclick="deletePersonalTask('${task.id}')" title="Eliminar">&#10005;</button>
      </div>`;
  });
  el.personalList.innerHTML = html;
}

async function addPersonalTask() {
  const text = el.taskInput.value.trim();
  if (!text) { el.taskInput.focus(); return; }
  const amount = parseInt(el.durationInput.value);
  const unit = el.durationUnit.value || 'days';

  const selectedProject = (el.personalProjectSelect && el.personalProjectSelect.value) || currentPersonalProject || 'General';

  const data = {
    text,
    ownerId: currentUser.uid,
    ownerName: currentUserData.name,
    status: 'pending',
    personalProject: selectedProject,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (amount && amount > 0) {
    const deadline = new Date();
    if (unit === 'minutes') deadline.setMinutes(deadline.getMinutes() + amount);
    else if (unit === 'hours') deadline.setHours(deadline.getHours() + amount);
    else deadline.setDate(deadline.getDate() + amount);
    data.deadline = firebase.firestore.Timestamp.fromDate(deadline);
    data.deadlineUnit = unit;
    data.deadlineAmount = amount;
  }
  await db.collection('personalTasks').add(data);
  el.taskInput.value = '';
  el.durationInput.value = '';

  // Si se creo en un proyecto distinto al chip activo, cambiar al chip nuevo
  if (selectedProject !== currentPersonalProject) {
    currentPersonalProject = selectedProject;
    renderPersonalChips();
    renderPersonalList();
  }
}

async function completePersonalTask(taskId) {
  await db.collection('personalTasks').doc(taskId).update({
    status: 'completed',
    completedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function deletePersonalTask(taskId) {
  const task = personalTasks.find(t => t.id === taskId);
  if (!task) return;
  if (!confirm(`Estas seguro que quieres eliminar esta tarea personal?\n\n"${task.text}"\n\nSe enviara a la Papelera. Podras restaurarla desde alli.`)) return;
  await db.collection('personalTasks').doc(taskId).update({
    deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
    deletedBy: currentUser.uid,
    deletedByName: currentUserData.name
  });
}

async function restorePersonalTask(taskId) {
  await db.collection('personalTasks').doc(taskId).update({
    deletedAt: firebase.firestore.FieldValue.delete(),
    deletedBy: firebase.firestore.FieldValue.delete(),
    deletedByName: firebase.firestore.FieldValue.delete()
  });
}
window.restorePersonalTask = restorePersonalTask;

async function permanentlyDeletePersonalTask(taskId) {
  const task = trashPersonalTasks.find(t => t.id === taskId);
  if (!task) return;
  if (!confirm(`Eliminar PERMANENTEMENTE esta tarea personal?\n\n"${task.text}"\n\nEsta accion no se puede deshacer.`)) return;
  await db.collection('personalTasks').doc(taskId).delete();
}
window.permanentlyDeletePersonalTask = permanentlyDeletePersonalTask;

window.completePersonalTask = completePersonalTask;
window.deletePersonalTask = deletePersonalTask;

// ===== PAPELERA =====
function renderTrashList() {
  if (!el.trashList) return;
  // Solo el creador (o admin) ve sus tareas eliminadas en la papelera
  const isAdmin = currentUserData && currentUserData.role === 'admin';
  const myTrashTeam = trashTasks.filter(t => isAdmin || t.createdBy === currentUser.uid || t.deletedBy === currentUser.uid);
  const myTrashPersonal = trashPersonalTasks; // Las personales ya estan filtradas por ownerId
  const total = myTrashTeam.length + myTrashPersonal.length;

  // Badge en tab
  if (el.trashBadge) {
    if (total > 0) {
      el.trashBadge.textContent = total > 99 ? '99+' : String(total);
      el.trashBadge.style.display = 'inline-block';
    } else {
      el.trashBadge.style.display = 'none';
    }
  }

  if (total === 0) {
    el.trashList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128465;</div>
        <div class="empty-state-text">Papelera vacia</div>
        <div class="empty-state-sub">Las tareas eliminadas apareceran aqui y podras restaurarlas</div>
      </div>`;
    return;
  }

  // Combinar y ordenar por fecha de eliminacion (mas recientes primero)
  const combined = [
    ...myTrashTeam.map(t => ({ ...t, _kind: 'team' })),
    ...myTrashPersonal.map(t => ({ ...t, _kind: 'personal' }))
  ].sort((a, b) => {
    const at = a.deletedAt?.seconds || 0;
    const bt = b.deletedAt?.seconds || 0;
    return bt - at;
  });

  let html = '';
  combined.forEach(t => {
    const isPersonal = t._kind === 'personal';
    const color = isPersonal ? '#BB8FCE' : (t.projectColor || '#666');
    const badge = isPersonal
      ? '<span class="task-tag" style="background:rgba(187,143,206,0.2);color:#BB8FCE">Personal</span>'
      : `<span class="task-tag">${esc(t.projectName || 'Sin proyecto')}</span>`;
    const deletedByName = t.deletedByName || 'alguien';
    const deletedTime = t.deletedAt ? timeAgo(t.deletedAt) : '';
    const restoreFn = isPersonal ? 'restorePersonalTask' : 'restoreTask';
    const permFn = isPersonal ? 'permanentlyDeletePersonalTask' : 'permanentlyDeleteTask';
    html += `
      <div class="task-item" style="border-left-color:${color};opacity:0.85">
        <div style="flex:1">
          <div class="task-text">${esc(t.text)}</div>
          <div class="task-meta">
            ${badge}
            <span class="task-tag" style="background:rgba(255,107,107,0.15);color:var(--danger)">Eliminada por ${esc(deletedByName)} &middot; ${deletedTime}</span>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn btn-ghost btn-small" onclick="${restoreFn}('${t.id}')" style="color:var(--success);border-color:var(--success)">&#8635; Restaurar</button>
            <button class="btn btn-ghost btn-small" onclick="${permFn}('${t.id}')" style="color:var(--danger);border-color:var(--danger)">&#10005; Eliminar definitivamente</button>
          </div>
        </div>
      </div>`;
  });
  el.trashList.innerHTML = html;
}

async function emptyTrash() {
  const isAdmin = currentUserData && currentUserData.role === 'admin';
  const myTrashTeam = trashTasks.filter(t => isAdmin || t.createdBy === currentUser.uid || t.deletedBy === currentUser.uid);
  const myTrashPersonal = trashPersonalTasks;
  const total = myTrashTeam.length + myTrashPersonal.length;
  if (total === 0) return;
  if (!confirm(`Vaciar la papelera? Se eliminaran PERMANENTEMENTE ${total} tarea(s). Esto no se puede deshacer.`)) return;
  const batch = db.batch();
  myTrashTeam.forEach(t => batch.delete(db.collection('tasks').doc(t.id)));
  myTrashPersonal.forEach(t => batch.delete(db.collection('personalTasks').doc(t.id)));
  await batch.commit();
}

if (el.emptyTrashBtn) el.emptyTrashBtn.addEventListener('click', emptyTrash);

// ===== PERSONAL PROJECTS =====
function allPersonalProjects() {
  return ['General', ...personalProjectsList];
}

function personalProjectOf(task) {
  return task.personalProject || 'General';
}

function renderPersonalChips() {
  if (!el.personalProjectsChips) return;
  const all = allPersonalProjects();
  if (!all.includes(currentPersonalProject)) currentPersonalProject = 'General';
  let html = '';
  all.forEach(name => {
    const count = personalTasks.filter(t => personalProjectOf(t) === name && t.status !== 'completed').length;
    const active = name === currentPersonalProject ? ' active' : '';
    const removeBtn = name !== 'General'
      ? `<button class="chip-remove" title="Quitar proyecto" onclick="event.stopPropagation(); deletePersonalProject('${esc(name)}')">&#10005;</button>`
      : '';
    html += `<div class="personal-chip${active}" onclick="switchPersonalProject('${esc(name)}')">${esc(name)}${count > 0 ? ` <span style="opacity:0.7">(${count})</span>` : ''}${removeBtn}</div>`;
  });
  html += `<div class="personal-chip add" onclick="showPersonalProjectModal()" title="Nuevo proyecto personal">+ Nuevo</div>`;
  el.personalProjectsChips.innerHTML = html;
}

function renderPersonalProjectSelect() {
  if (!el.personalProjectSelect) return;
  const all = allPersonalProjects();
  el.personalProjectSelect.innerHTML = all.map(n => `<option value="${esc(n)}"${n === currentPersonalProject ? ' selected' : ''}>${esc(n)}</option>`).join('');
}

function switchPersonalProject(name) {
  currentPersonalProject = name;
  renderPersonalChips();
  renderPersonalProjectSelect();
  renderPersonalList();
}
window.switchPersonalProject = switchPersonalProject;

function showPersonalProjectModal() {
  if (!el.personalProjectModal) return;
  el.personalProjectNameInput.value = '';
  el.personalProjectModal.classList.add('active');
  setTimeout(() => el.personalProjectNameInput.focus(), 100);
}
window.showPersonalProjectModal = showPersonalProjectModal;

function hidePersonalProjectModal() {
  if (el.personalProjectModal) el.personalProjectModal.classList.remove('active');
}

async function addPersonalProject(name) {
  name = (name || '').trim();
  if (!name) return;
  if (name.toLowerCase() === 'general') return;
  if (personalProjectsList.includes(name)) { currentPersonalProject = name; renderPersonalChips(); renderPersonalProjectSelect(); renderPersonalList(); return; }
  personalProjectsList.push(name);
  currentPersonalProject = name;
  await db.collection('users').doc(currentUser.uid).update({
    personalProjects: personalProjectsList
  });
  renderPersonalChips();
  renderPersonalProjectSelect();
  renderPersonalList();
}

async function deletePersonalProject(name) {
  if (name === 'General') return;
  const count = personalTasks.filter(t => personalProjectOf(t) === name).length;
  const msg = count > 0
    ? `Quitar el proyecto "${name}"? Las ${count} tarea(s) que tiene pasaran a "General".`
    : `Quitar el proyecto "${name}"?`;
  if (!confirm(msg)) return;
  personalProjectsList = personalProjectsList.filter(p => p !== name);
  if (currentPersonalProject === name) currentPersonalProject = 'General';
  await db.collection('users').doc(currentUser.uid).update({
    personalProjects: personalProjectsList
  });
  if (count > 0) {
    const batch = db.batch();
    personalTasks.filter(t => personalProjectOf(t) === name).forEach(t => {
      batch.update(db.collection('personalTasks').doc(t.id), { personalProject: 'General' });
    });
    await batch.commit();
  }
  renderPersonalChips();
  renderPersonalProjectSelect();
  renderPersonalList();
}
window.deletePersonalProject = deletePersonalProject;

// ===== TASK LINK =====
const linkModal = document.getElementById('linkModal');
const linkInput = document.getElementById('linkInput');
let linkEditing = null; // { collection, taskId }

function openTaskLink(collection, taskId) {
  const t = (collection === 'personalTasks' ? personalTasks : tasks).find(x => x.id === taskId);
  if (t && t.link) window.api.openExternal(t.link);
}
window.openTaskLink = openTaskLink;

function showLinkModal(collection, taskId) {
  const doc = (collection === 'personalTasks' ? personalTasks : tasks).find(t => t.id === taskId);
  linkEditing = { collection, taskId };
  linkInput.value = doc?.link || '';
  document.getElementById('removeLink').style.display = doc?.link ? 'inline-block' : 'none';
  linkModal.classList.add('active');
  setTimeout(() => linkInput.focus(), 100);
}
window.showLinkModal = showLinkModal;

document.getElementById('cancelLink').addEventListener('click', () => {
  linkModal.classList.remove('active');
  linkEditing = null;
});
linkModal.addEventListener('click', (e) => {
  if (e.target === linkModal) { linkModal.classList.remove('active'); linkEditing = null; }
});
linkInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmLink').click();
});
document.getElementById('confirmLink').addEventListener('click', async () => {
  if (!linkEditing) return;
  let url = linkInput.value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!url) return;
  await db.collection(linkEditing.collection).doc(linkEditing.taskId).update({ link: url });
  linkModal.classList.remove('active');
  linkEditing = null;
});
document.getElementById('removeLink').addEventListener('click', async () => {
  if (!linkEditing) return;
  await db.collection(linkEditing.collection).doc(linkEditing.taskId).update({
    link: firebase.firestore.FieldValue.delete()
  });
  linkModal.classList.remove('active');
  linkEditing = null;
});

// ===== VIDEO DE REFERENCIA =====
const videoModal = document.getElementById('videoModal');
const videoInput = document.getElementById('videoInput');
let videoEditing = null; // { collection, taskId }

function openTaskVideo(collection, taskId) {
  const t = (collection === 'personalTasks' ? personalTasks : tasks).find(x => x.id === taskId);
  if (t && t.videoLink) window.api.openExternal(t.videoLink);
}
window.openTaskVideo = openTaskVideo;

function showVideoModal(collection, taskId) {
  const doc = (collection === 'personalTasks' ? personalTasks : tasks).find(t => t.id === taskId);
  videoEditing = { collection, taskId };
  videoInput.value = doc?.videoLink || '';
  document.getElementById('removeVideo').style.display = doc?.videoLink ? 'inline-block' : 'none';
  videoModal.classList.add('active');
  setTimeout(() => videoInput.focus(), 100);
}
window.showVideoModal = showVideoModal;

document.getElementById('cancelVideo').addEventListener('click', () => {
  videoModal.classList.remove('active');
  videoEditing = null;
});
videoModal.addEventListener('click', (e) => {
  if (e.target === videoModal) { videoModal.classList.remove('active'); videoEditing = null; }
});
videoInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmVideo').click();
});
document.getElementById('confirmVideo').addEventListener('click', async () => {
  if (!videoEditing) return;
  let url = videoInput.value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!url) return;
  await db.collection(videoEditing.collection).doc(videoEditing.taskId).update({ videoLink: url });
  videoModal.classList.remove('active');
  videoEditing = null;
});
document.getElementById('removeVideo').addEventListener('click', async () => {
  if (!videoEditing) return;
  await db.collection(videoEditing.collection).doc(videoEditing.taskId).update({
    videoLink: firebase.firestore.FieldValue.delete()
  });
  videoModal.classList.remove('active');
  videoEditing = null;
});

function getUserColor(userId) {
  const idx = teamMembers.findIndex(m => m.id === userId);
  return userColors[idx >= 0 ? idx % userColors.length : 0];
}

// Rastrea el ultimo proyecto de equipo con el que el usuario interactuo
// para que el agente IA pueda crear tareas alli sin que el usuario lo repita.
function trackInteractedProject(projectId, projectName) {
  if (!projectId) return;
  lastInteractedProject = { id: projectId, name: projectName || '' };
}

function setupProjectInteractionTracking() {
  const containers = [el.taskList, el.myTaskList, el.approvalList, el.completedList];
  containers.forEach(c => {
    if (!c || c._trackedProjectClicks) return;
    c._trackedProjectClicks = true;
    c.addEventListener('click', (e) => {
      const node = e.target.closest('[data-project-id]');
      if (!node) return;
      const id = node.dataset.projectId;
      const name = node.dataset.projectName;
      if (id) trackInteractedProject(id, name);
    }, true);
  });

  if (el.projectSelect && !el.projectSelect._trackedChange) {
    el.projectSelect._trackedChange = true;
    el.projectSelect.addEventListener('change', () => {
      const id = el.projectSelect.value;
      if (!id) return;
      const p = projects.find(x => x.id === id);
      trackInteractedProject(id, p ? p.name : '');
    });
  }
}

function hexToRgba(hex, alpha) {
  const h = (hex || '#666').replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function userChip(userId, name) {
  const c = getUserColor(userId);
  return `<span class="task-assignee" style="background:${hexToRgba(c, 0.32)};color:${c};border:1px solid ${hexToRgba(c, 0.5)}">${esc(name)}</span>`;
}

function assigneeChips(task) {
  const creatorId = task.createdBy;
  const creatorName = task.createdByName;
  const assigneeId = task.assignedTo;
  const assigneeName = task.assignedToName || 'Sin asignar';
  if (!creatorName || creatorId === assigneeId) {
    return userChip(assigneeId, assigneeName);
  }
  return `${userChip(creatorId, creatorName)}<span style="opacity:0.55;margin:0 2px;font-size:11px">→</span>${userChip(assigneeId, assigneeName)}`;
}

function renderTaskList(container, taskList, mode) {
  if (taskList.length === 0) {
    const emptyMessages = {
      'pending': { icon: '&#128221;', text: 'No hay tareas pendientes', sub: 'Agrega una tarea o esperala desde Telegram' },
      'my-tasks': { icon: '&#128100;', text: 'No tienes tareas asignadas', sub: '' },
      'approval': { icon: '&#128270;', text: 'No hay tareas por aprobar', sub: 'Cuando alguien complete una tarea aparecera aqui' }
    };
    const msg = emptyMessages[mode] || emptyMessages['pending'];
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${msg.icon}</div>
        <div class="empty-state-text">${msg.text}</div>
        <div class="empty-state-sub">${msg.sub}</div>
      </div>`;
    return;
  }

  // Group by project
  const grouped = {};
  taskList.forEach(task => {
    const key = task.projectId || 'sin-proyecto';
    if (!grouped[key]) {
      grouped[key] = { name: task.projectName || 'Sin Proyecto', color: task.projectColor || '#666', tasks: [] };
    }
    grouped[key].tasks.push(task);
  });

  const isAdmin = currentUserData && currentUserData.role === 'admin';
  let html = '';

  for (const [projectKey, group] of Object.entries(grouped)) {
    const projectIdAttr = projectKey === 'sin-proyecto' ? '' : projectKey;
    html += `<div class="project-section">
      <div class="project-header" data-project-id="${projectIdAttr}" data-project-name="${esc(group.name)}" style="cursor:pointer" title="Click para que el agente IA use este proyecto por defecto">
        <span class="project-dot" style="background:${group.color}"></span>
        <span class="project-name">${esc(group.name)}</span>
        <span class="project-count">${group.tasks.length}</span>
      </div>`;

    group.tasks.forEach(task => {
      const assignee = task.assignedToName || 'Sin asignar';
      const source = task.source === 'telegram' ? 'Telegram' : 'App';
      const time = timeAgo(task.createdAt);
      const isPendingApproval = task.status === 'pending_approval';

      let statusBadge = '';
      if (isPendingApproval) {
        statusBadge = '<span class="status-pending-approval">Esperando aprobacion</span>';
      }

      // Deadline badge
      let deadlineBadge = '';
      let overdueClass = '';
      if (task.deadline) {
        const deadlineDate = task.deadline.toDate ? task.deadline.toDate() : new Date(task.deadline);
        deadlineBadge = deadlineBadgeHtml(deadlineDate);
        if (deadlineDate.getTime() - Date.now() < 0) overdueClass = 'overdue';
      }

      // Approval buttons (only admin in approval tab, or creator)
      let actionButtons = '';
      if (isPendingApproval && mode === 'approval') {
        if (isAdmin || task.createdBy === currentUser.uid) {
          actionButtons = `
            <div class="approval-buttons">
              <button class="btn-approve" onclick="approveTask('${task.id}')">Aprobar</button>
              <button class="btn-reject" onclick="rejectTask('${task.id}')">Rechazar</button>
            </div>`;
        }
      }

      // Check button: solo asignado/creador/admin pueden marcar terminada
      let checkBtn = '';
      if (isPendingApproval) {
        checkBtn = '<div class="task-check" style="border-color:var(--warning);background:rgba(255,217,61,0.15)" title="Esperando aprobacion"></div>';
      } else if (canComplete(task)) {
        checkBtn = `<div class="task-check" onclick="completeTask('${task.id}')" title="Marcar como terminada"></div>`;
      } else {
        checkBtn = `<div class="task-check" style="cursor:not-allowed;opacity:0.5" title="Solo el asignado o el creador puede marcar terminada"></div>`;
      }

      // Edit and delete buttons (only creator and admin)
      let taskActions = '';
      if (!isPendingApproval && canEdit(task)) {
        taskActions += `<button class="task-delete" onclick="editTask('${task.id}')" title="Editar" style="color:var(--accent)">&#9998;</button>`;
      }
      if (!isPendingApproval && canDelete(task)) {
        taskActions += `<button class="task-delete" onclick="deleteTask('${task.id}')" title="Eliminar">&#10005;</button>`;
      }

      // Subnotes
      const notes = task.notes || [];
      let notesHtml = '';
      if (notes.length > 0) {
        notesHtml = '<div class="task-notes">';
        notes.forEach(n => {
          notesHtml += `<div class="task-note"><span class="note-author">${esc(n.authorName)}:</span> ${esc(n.text)}</div>`;
        });
        notesHtml += '</div>';
      }

      // Add note button (assignee, creator, or admin)
      let addNoteBtn = '';
      const canAddMeta = task.assignedTo === currentUser.uid || task.createdBy === currentUser.uid || isAdmin;
      if (canAddMeta) {
        addNoteBtn = `<button class="btn-add-note" onclick="addNote('${task.id}')">+ Nota</button>`;
      }

      // Link badge + edit
      let linkBadge = '';
      if (task.link) {
        linkBadge = `<span class="task-tag" style="background:rgba(153,102,255,0.2);color:#b794ff;cursor:pointer" onclick="openTaskLink('tasks','${task.id}')" title="${esc(task.link)}">🔗 Abrir material</span>`;
      }
      let linkBtn = '';
      if (canAddMeta) {
        linkBtn = task.link
          ? `<button class="btn-add-note" onclick="showLinkModal('tasks','${task.id}')" title="Editar link">✏️ Link</button>`
          : `<button class="btn-add-note" onclick="showLinkModal('tasks','${task.id}')">🔗 + Link</button>`;
      }

      // Video de referencia badge + edit
      let videoBadge = '';
      if (task.videoLink) {
        videoBadge = `<span class="task-tag" style="background:rgba(255,90,90,0.2);color:#ff8a8a;cursor:pointer" onclick="openTaskVideo('tasks','${task.id}')" title="${esc(task.videoLink)}">🎬 Video de referencia</span>`;
      }
      let videoBtn = '';
      if (canAddMeta) {
        videoBtn = task.videoLink
          ? `<button class="btn-add-note" onclick="showVideoModal('tasks','${task.id}')" title="Editar video">✏️ Video</button>`
          : `<button class="btn-add-note" onclick="showVideoModal('tasks','${task.id}')">🎬 + Video</button>`;
      }

      let blockedBadge = '';
      if (task.dependsOn) {
        const dep = tasks.find(t => t.id === task.dependsOn);
        if (dep && dep.status !== 'completed') {
          const waitName = dep.assignedToName || 'otro';
          const waitText = dep.text.length > 25 ? dep.text.slice(0, 25) + '...' : dep.text;
          blockedBadge = `<span class="task-deadline deadline-soon" title="Esperando que ${esc(waitName)} termine">🔒 Esperando: ${esc(waitText)}</span>`;
        }
      }

      // Chip del trabajo entregado por el asignado
      let submittedBadge = '';
      if (task.submittedLink) {
        submittedBadge = `<span class="task-tag" style="background:rgba(78,205,196,0.2);color:#4ecdc4;cursor:pointer;font-weight:600" onclick="window.api.openExternal('${esc(task.submittedLink)}')" title="${esc(task.submittedLink)}">📎 Ver entregado</span>`;
      }

      // Boton llamativo "Tarea completada" - asignado, creador o admin pueden marcar
      let markDoneBtn = '';
      if (!isPendingApproval && task.status !== 'completed' && canComplete(task)) {
        const label = task.submittedLink ? '✏️ Cambiar entregado' : '✓ Tarea completada';
        markDoneBtn = `<button class="btn-mark-done" onclick="completeTask('${task.id}')" title="Sube el resultado y manda a aprobacion">${label}</button>`;
      }

      html += `
        <div class="task-item ${overdueClass}" data-id="${task.id}" data-project-id="${task.projectId || ''}" data-project-name="${esc(task.projectName || '')}" style="border-left-color:${group.color}">
          ${checkBtn}
          <div style="flex:1">
            <div class="task-text">${esc(task.text)}</div>
            <div class="task-meta">
              ${assigneeChips(task)}
              ${statusBadge}
              ${deadlineBadge}
              ${blockedBadge}
              ${submittedBadge}
              ${linkBadge}
              ${videoBadge}
              <span class="task-tag">${source}</span>
              <span class="task-tag">${time}</span>
              ${addNoteBtn}
              ${linkBtn}
              ${videoBtn}
              ${markDoneBtn}
            </div>
            ${notesHtml}
            ${actionButtons}
          </div>
          ${taskActions}
        </div>`;
    });

    html += '</div>';
  }

  container.innerHTML = html;
}

// Completed list grouped by user with colors
function renderCompletedList(completedTasks) {
  if (completedTasks.length === 0) {
    el.completedList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#127881;</div>
        <div class="empty-state-text">No hay tareas completadas aun</div>
      </div>`;
    return;
  }

  // Group by user
  const groupedByUser = {};
  completedTasks.forEach(task => {
    const key = task.assignedTo || 'unknown';
    if (!groupedByUser[key]) {
      groupedByUser[key] = {
        name: task.assignedToName || 'Desconocido',
        color: getUserColor(key),
        tasks: []
      };
    }
    groupedByUser[key].tasks.push(task);
  });

  let html = '';
  for (const [userId, group] of Object.entries(groupedByUser)) {
    html += `<div class="project-section">
      <div class="project-header" style="border-left:3px solid ${group.color}">
        <div class="team-avatar" style="background:${group.color};width:24px;height:24px;font-size:11px;display:flex;align-items:center;justify-content:center;border-radius:50%;color:white;font-weight:700">${group.name.charAt(0).toUpperCase()}</div>
        <span class="project-name">${esc(group.name)}</span>
        <span class="project-count">${group.tasks.length} completadas</span>
      </div>`;

    group.tasks.forEach(task => {
      const time = task.completedAt ? formatDate(task.completedAt) : '';
      const approver = task.approvedByName ? `Aprobada por ${task.approvedByName}` : '';

      html += `
        <div class="task-item completed" style="border-left-color:${group.color}">
          <div class="task-check"></div>
          <div style="flex:1">
            <div class="task-text">${esc(task.text)}</div>
            <div class="task-meta">
              <span class="task-tag">${esc(task.projectName || '')}</span>
              <span class="task-tag">${time}</span>
              ${approver ? `<span class="task-tag">${esc(approver)}</span>` : ''}
            </div>
          </div>
        </div>`;
    });

    html += '</div>';
  }

  el.completedList.innerHTML = html;
}

function renderProjectSelect() {
  const current = el.projectSelect.value;
  el.projectSelect.innerHTML = '<option value="">Proyecto...</option>';
  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    el.projectSelect.appendChild(opt);
  });
  if (current) el.projectSelect.value = current;
}

function renderAssignSelect() {
  const current = el.assignSelect.value;
  el.assignSelect.innerHTML = '<option value="">Asignar a...</option>';
  teamMembers.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name + (m.id === currentUser.uid ? ' (yo)' : '');
    el.assignSelect.appendChild(opt);
  });
  if (current) el.assignSelect.value = current;
}


function renderTeam() {
  if (teamMembers.length === 0) {
    el.teamList.innerHTML = '<div class="empty-state"><div class="empty-state-text">No hay miembros</div></div>';
    return;
  }

  let html = '';
  teamMembers.forEach((m, i) => {
    const pending = tasks.filter(t => t.assignedTo === m.id && t.status === 'pending').length;
    const waiting = tasks.filter(t => t.assignedTo === m.id && t.status === 'pending_approval').length;
    const done = tasks.filter(t => t.assignedTo === m.id && t.status === 'completed').length;
    const color = userColors[i % userColors.length];
    const linkedHtml = m.telegramChatId
      ? `<span style="color:#4ecdc4">✓ Telegram vinculado</span> <button class="btn btn-ghost" onclick="testTelegramNotif('${m.telegramChatId}','${esc(m.name)}')" style="font-size:10px;padding:2px 8px;margin-left:4px">Probar</button>`
      : '<span style="color:#ff9090" title="Este miembro no recibira notificaciones hasta vincular. Pidele que envie /vincular ' + esc(m.email) + ' al bot">✗ Sin Telegram</span>';

    const roleLabel = m.role === 'admin' ? 'Admin' : 'Miembro';
    const canChangeRole = currentUserData && currentUserData.role === 'admin' && m.id !== currentUser.uid;
    const roleBtn = canChangeRole
      ? `<button class="btn btn-small btn-ghost" onclick="toggleRole('${m.id}', '${m.role}')" style="font-size:10px">${m.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>`
      : '';

    html += `
      <div class="team-member">
        <div class="team-avatar" style="background:${color}">${m.name.charAt(0).toUpperCase()}</div>
        <div class="team-info">
          <div class="team-name">${esc(m.name)} ${m.id === currentUser.uid ? '(tu)' : ''} <span style="font-size:10px;color:${m.role === 'admin' ? 'var(--success)' : 'var(--text-secondary)'}">[${roleLabel}]</span></div>
          <div class="team-email">${esc(m.email)} · ${linkedHtml}</div>
          <div class="team-tasks">${pending} pendientes - ${waiting} por aprobar - ${done} completadas ${roleBtn}</div>
        </div>
      </div>`;
  });

  el.teamList.innerHTML = html;
}

function renderProjectList() {
  if (projects.length === 0) {
    el.projectListSettings.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;text-align:center;padding:12px">No hay proyectos</div>';
    return;
  }

  let html = '';
  projects.forEach(p => {
    const taskCount = tasks.filter(t => t.projectId === p.id && t.status !== 'completed').length;
    html += `
      <div class="project-header" style="margin-bottom:6px">
        <span class="project-dot" style="background:${p.color}"></span>
        <span class="project-name">${esc(p.name)}</span>
        <span class="project-count">${taskCount} pendientes</span>
        <button class="project-action-btn" onclick="deleteProject('${p.id}')" title="Eliminar">&#128465;</button>
      </div>`;
  });

  el.projectListSettings.innerHTML = html;
}

// ===== ACTIONS =====
async function addTask() {
  const text = el.taskInput.value.trim();
  const projectId = el.projectSelect.value;
  const assignTo = el.assignSelect.value;
  const amount = parseInt(el.durationInput.value);
  const unit = el.durationUnit.value || 'days';

  if (!text) { el.taskInput.focus(); return; }
  if (!projectId) {
    el.projectSelect.style.borderColor = 'var(--danger)';
    setTimeout(() => el.projectSelect.style.borderColor = '', 1500);
    return;
  }

  const project = projects.find(p => p.id === projectId);
  const assignee = teamMembers.find(m => m.id === assignTo);

  const taskData = {
    text: text,
    projectId: projectId,
    projectName: project ? project.name : 'Sin Proyecto',
    projectColor: project ? project.color : '#666',
    assignedTo: assignTo || currentUser.uid,
    assignedToName: assignee ? assignee.name : currentUserData.name,
    createdBy: currentUser.uid,
    createdByName: currentUserData.name,
    status: 'pending',
    source: 'app',
    notes: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (amount && amount > 0) {
    const deadline = new Date();
    if (unit === 'minutes') deadline.setMinutes(deadline.getMinutes() + amount);
    else if (unit === 'hours') deadline.setHours(deadline.getHours() + amount);
    else deadline.setDate(deadline.getDate() + amount);
    taskData.deadline = firebase.firestore.Timestamp.fromDate(deadline);
    taskData.deadlineUnit = unit;
    taskData.deadlineAmount = amount;
  }

  await db.collection('tasks').add(taskData);

  el.taskInput.value = '';
  el.durationInput.value = '';

  if (assignee && assignTo !== currentUser.uid) {
    const unitLabel = unit === 'minutes' ? 'minuto(s)' : unit === 'hours' ? 'hora(s)' : 'dia(s)';
    const deadlineMsg = amount && amount > 0 ? `\nPlazo: *${amount} ${unitLabel}*` : '';
    notifyAssignedOrWarn(assignee,
      `Nueva tarea asignada por *${currentUserData.name}*:\n${text}\nProyecto: *${project.name}*${deadlineMsg}`
    );
  }
}

// Submit Task: el asignado entrega el trabajo. Abre modal pidiendo link entregado.
let submittingTaskId = null;
async function completeTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!canComplete(task)) {
    alert('Solo el asignado, el creador de la tarea o el admin pueden marcarla como terminada.');
    return;
  }
  submittingTaskId = taskId;
  document.getElementById('submitTaskTitle').textContent = task.text;
  document.getElementById('submitTaskLinkInput').value = '';
  document.getElementById('submitTaskModal').classList.add('active');
  setTimeout(() => document.getElementById('submitTaskLinkInput').focus(), 100);
}

async function finalizeSubmitTask(taskId, submittedLinkRaw) {
  const taskEl = document.querySelector(`.task-item[data-id="${taskId}"]`);
  if (taskEl) {
    taskEl.classList.add('completing');
    await new Promise(r => setTimeout(r, 300));
  }
  const task = tasks.find(t => t.id === taskId);

  let submittedLink = (submittedLinkRaw || '').trim();
  if (submittedLink && !/^https?:\/\//i.test(submittedLink)) submittedLink = 'https://' + submittedLink;

  const update = {
    status: 'pending_approval',
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    submittedBy: currentUser.uid,
    submittedByName: currentUserData.name
  };
  if (submittedLink) update.submittedLink = submittedLink;
  await db.collection('tasks').doc(taskId).update(update);

  if (task) {
    const notifyIds = teamMembers
      .filter(m => (m.role === 'admin' || m.id === task.createdBy) && m.telegramChatId && m.id !== currentUser.uid)
      .map(m => m.telegramChatId);

    if (notifyIds.length > 0) {
      const linkLine = submittedLink ? `\nMaterial entregado: ${submittedLink}` : '';
      sendTelegramNotifToMany(notifyIds,
        `*${currentUserData.name}* termino una tarea y espera aprobacion:\n${task.text}\nProyecto: *${task.projectName}*${linkLine}`
      );
    }

    const dependents = tasks.filter(t => t.dependsOn === taskId && t.status !== 'completed');
    dependents.forEach(dep => {
      const depAssignee = teamMembers.find(m => m.id === dep.assignedTo);
      if (depAssignee && depAssignee.telegramChatId && depAssignee.id !== currentUser.uid) {
        const linkMsg = task.link ? `\nMaterial: ${task.link}` : '';
        sendTelegramNotif(depAssignee.telegramChatId,
          `*${currentUserData.name}* termino su paso (pendiente de aprobacion del admin).\nPrepara tu parte:\n*${dep.text}*\nProyecto: *${dep.projectName}*${linkMsg}`
        );
      }
    });
  }
}

document.getElementById('submitTaskCancel').addEventListener('click', () => {
  document.getElementById('submitTaskModal').classList.remove('active');
  submittingTaskId = null;
});
document.getElementById('submitTaskConfirm').addEventListener('click', async () => {
  if (!submittingTaskId) return;
  const link = document.getElementById('submitTaskLinkInput').value;
  const taskId = submittingTaskId;
  submittingTaskId = null;
  document.getElementById('submitTaskModal').classList.remove('active');
  await finalizeSubmitTask(taskId, link);
});
document.getElementById('submitTaskLinkInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('submitTaskConfirm').click();
});
document.getElementById('submitTaskModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('submitTaskModal')) {
    document.getElementById('submitTaskModal').classList.remove('active');
    submittingTaskId = null;
  }
});

async function approveTask(taskId) {
  const taskEl = document.querySelector(`.task-item[data-id="${taskId}"]`);
  if (taskEl) {
    taskEl.classList.add('completing');
    await new Promise(r => setTimeout(r, 300));
  }

  const task = tasks.find(t => t.id === taskId);

  await db.collection('tasks').doc(taskId).update({
    status: 'completed',
    completedAt: firebase.firestore.FieldValue.serverTimestamp(),
    approvedBy: currentUser.uid,
    approvedByName: currentUserData.name
  });

  if (task) {
    const assignee = teamMembers.find(m => m.id === task.assignedTo);
    if (assignee && assignee.telegramChatId) {
      sendTelegramNotif(assignee.telegramChatId,
        `Tu tarea fue *aprobada* por *${currentUserData.name}*:\n${task.text}`
      );
    }

    // Notify dependents: tasks that were waiting on this one
    const dependents = tasks.filter(t => t.dependsOn === taskId && t.status !== 'completed');
    dependents.forEach(dep => {
      const depAssignee = teamMembers.find(m => m.id === dep.assignedTo);
      if (depAssignee && depAssignee.telegramChatId) {
        const linkMsg = task.link ? `\n\nMaterial: ${task.link}` : '';
        sendTelegramNotif(depAssignee.telegramChatId,
          `*${task.assignedToName || 'Un miembro'}* termino: ${task.text}\n\nYa puedes empezar tu tarea:\n*${dep.text}*\nProyecto: *${dep.projectName}*${linkMsg}`
        );
      }
    });

    // Si la tarea tiene material entregado, ofrecer archivarla al Deposito
    if (task.submittedLink) {
      showArchiveDepositModal(task);
    }
  }
}

// ===== DEPOSITO: SEED CATEGORIAS DEFAULT =====
async function ensureDefaultDepositCategories() {
  const defaults = [
    { id: 'reels', name: 'Reels' },
    { id: 'carruseles', name: 'Carruseles' },
    { id: 'trabajos-finalizados', name: 'Trabajos Finalizados' }
  ];
  for (const d of defaults) {
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
  }
}

// ===== ARCHIVE TO DEPOSIT (despues de aprobar) =====
let archivingTask = null;
let archiveCategoriesCache = [];

async function showArchiveDepositModal(task) {
  archivingTask = task;
  document.getElementById('archiveTaskPreview').textContent = task.text;
  // Cargar categorias del deposito
  try {
    const snap = await db.collection('depositCategories').orderBy('name').get();
    archiveCategoriesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    archiveCategoriesCache = [];
  }
  const catSel = document.getElementById('archiveCategorySelect');
  const roots = archiveCategoriesCache.filter(c => !c.parentId);
  catSel.innerHTML = '<option value="">-- Elige categoria --</option>' +
    roots.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  // Pre-seleccionar "Trabajos Finalizados" si existe (caso comun)
  if (roots.some(c => c.id === 'trabajos-finalizados')) {
    catSel.value = 'trabajos-finalizados';
    // Cargar sus subcategorias
    const subs = archiveCategoriesCache.filter(c => c.parentId === 'trabajos-finalizados');
    const subSel = document.getElementById('archiveSubcategorySelect');
    subSel.innerHTML = '<option value="">Sin clasificar</option>' +
      subs.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    document.getElementById('archiveSubcategoryRow').style.display = 'block';
  } else {
    document.getElementById('archiveSubcategoryRow').style.display = 'none';
    document.getElementById('archiveSubcategorySelect').innerHTML = '<option value="">Sin clasificar</option>';
  }
  document.getElementById('archiveDepositModal').classList.add('active');
}

document.getElementById('archiveCategorySelect').addEventListener('change', () => {
  const catId = document.getElementById('archiveCategorySelect').value;
  const subRow = document.getElementById('archiveSubcategoryRow');
  if (!catId) { subRow.style.display = 'none'; return; }
  const subs = archiveCategoriesCache.filter(c => c.parentId === catId);
  const sel = document.getElementById('archiveSubcategorySelect');
  sel.innerHTML = '<option value="">Sin clasificar</option>' +
    subs.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  subRow.style.display = 'block';
});

document.getElementById('archiveSkip').addEventListener('click', () => {
  document.getElementById('archiveDepositModal').classList.remove('active');
  archivingTask = null;
});
document.getElementById('archiveDepositModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('archiveDepositModal')) {
    document.getElementById('archiveDepositModal').classList.remove('active');
    archivingTask = null;
  }
});

document.getElementById('archiveConfirm').addEventListener('click', async () => {
  if (!archivingTask) return;
  const catId = document.getElementById('archiveCategorySelect').value;
  if (!catId) {
    document.getElementById('archiveDepositModal').classList.remove('active');
    archivingTask = null;
    return;
  }
  const cat = archiveCategoriesCache.find(c => c.id === catId);
  const subId = document.getElementById('archiveSubcategorySelect').value;
  const sub = subId ? archiveCategoriesCache.find(c => c.id === subId) : null;
  const t = archivingTask;
  const links = [];
  if (t.submittedLink) links.push({ type: 'recurso', url: t.submittedLink, label: 'Trabajo finalizado' });
  if (t.videoLink) links.push({ type: 'video', url: t.videoLink, label: 'Video de referencia' });
  if (t.link) links.push({ type: 'material', url: t.link, label: 'Material original' });
  const data = {
    title: t.text,
    description: `Tarea aprobada de ${t.assignedToName || ''}${t.projectName ? ' en ' + t.projectName : ''}.`,
    links,
    categoryId: catId,
    categoryName: cat ? cat.name : '',
    status: 'idea',
    createdBy: currentUser.uid,
    createdByName: currentUserData.name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    archivedFromTaskId: t.id
  };
  if (sub) {
    data.subcategoryId = sub.id;
    data.subcategoryName = sub.name;
  }
  await db.collection('depositEntries').add(data);
  document.getElementById('archiveDepositModal').classList.remove('active');
  archivingTask = null;
});

async function rejectTask(taskId) {
  const task = tasks.find(t => t.id === taskId);

  await db.collection('tasks').doc(taskId).update({
    status: 'pending',
    rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
    rejectedBy: currentUser.uid,
    rejectedByName: currentUserData.name
  });

  if (task) {
    const assignee = teamMembers.find(m => m.id === task.assignedTo);
    if (assignee && assignee.telegramChatId) {
      sendTelegramNotif(assignee.telegramChatId,
        `Tu tarea fue *rechazada* por *${currentUserData.name}* y volvio a pendientes:\n${task.text}`
      );
    }
  }
}

// Edit task modal (maneja tareas de equipo y personales)
let editingTask = null; // { id, collection }
const editModal = document.getElementById('editModal');
const editTaskInput = document.getElementById('editTaskInput');

document.getElementById('cancelEdit').addEventListener('click', () => {
  editModal.classList.remove('active');
  editingTask = null;
});

document.getElementById('confirmEdit').addEventListener('click', async () => {
  const newText = editTaskInput.value.trim();
  if (editingTask && newText) {
    await db.collection(editingTask.collection).doc(editingTask.id).update({ text: newText });
  }
  editModal.classList.remove('active');
  editingTask = null;
});

editTaskInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmEdit').click();
});

editModal.addEventListener('click', (e) => {
  if (e.target === editModal) { editModal.classList.remove('active'); editingTask = null; }
});

async function editTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !canEdit(task)) return;
  editingTask = { id: taskId, collection: 'tasks' };
  editTaskInput.value = task.text;
  editModal.classList.add('active');
  setTimeout(() => editTaskInput.focus(), 100);
}

async function editPersonalTask(taskId) {
  const task = personalTasks.find(t => t.id === taskId);
  if (!task) return;
  editingTask = { id: taskId, collection: 'personalTasks' };
  editTaskInput.value = task.text;
  editModal.classList.add('active');
  setTimeout(() => editTaskInput.focus(), 100);
}
window.editPersonalTask = editPersonalTask;

// Add note modal
let notingTaskId = null;
const noteModal = document.getElementById('noteModal');
const noteInput = document.getElementById('noteInput');

document.getElementById('cancelNote').addEventListener('click', () => {
  noteModal.classList.remove('active');
  notingTaskId = null;
});

document.getElementById('confirmNote').addEventListener('click', async () => {
  const noteText = noteInput.value.trim();
  if (notingTaskId && noteText) {
    const task = tasks.find(t => t.id === notingTaskId);
    if (task) {
      const notes = task.notes || [];
      notes.push({
        text: noteText,
        authorId: currentUser.uid,
        authorName: currentUserData.name,
        createdAt: new Date().toISOString()
      });
      await db.collection('tasks').doc(notingTaskId).update({ notes: notes });
    }
  }
  noteModal.classList.remove('active');
  noteInput.value = '';
  notingTaskId = null;
});

noteInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmNote').click();
});

noteModal.addEventListener('click', (e) => {
  if (e.target === noteModal) { noteModal.classList.remove('active'); notingTaskId = null; }
});

async function addNote(taskId) {
  notingTaskId = taskId;
  noteInput.value = '';
  noteModal.classList.add('active');
  setTimeout(() => noteInput.focus(), 100);
}

async function toggleRole(userId, currentRole) {
  const newRole = currentRole === 'admin' ? 'miembro' : 'admin';
  await db.collection('users').doc(userId).update({ role: newRole });
}

function canEdit(task) {
  if (!currentUserData) return false;
  if (currentUserData.role === 'admin') return true;
  if (task.createdBy === currentUser.uid) return true;
  return false;
}

function canDelete(task) {
  if (!currentUserData) return false;
  if (currentUserData.role === 'admin') return true;
  if (task.createdBy === currentUser.uid) return true;
  return false;
}

function canComplete(task) {
  if (!currentUserData) return false;
  if (currentUserData.role === 'admin') return true;
  if (task.createdBy === currentUser.uid) return true;
  if (task.assignedTo === currentUser.uid) return true;
  return false;
}

async function deleteTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!canDelete(task)) return;
  if (!confirm(`Estas seguro que quieres eliminar la tarea?\n\n"${task.text}"\n\nSe enviara a la Papelera. Podras restaurarla desde alli.`)) return;
  await db.collection('tasks').doc(taskId).update({
    deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
    deletedBy: currentUser.uid,
    deletedByName: currentUserData.name
  });
}

async function restoreTask(taskId) {
  await db.collection('tasks').doc(taskId).update({
    deletedAt: firebase.firestore.FieldValue.delete(),
    deletedBy: firebase.firestore.FieldValue.delete(),
    deletedByName: firebase.firestore.FieldValue.delete()
  });
}
window.restoreTask = restoreTask;

async function permanentlyDeleteTask(taskId) {
  const task = trashTasks.find(t => t.id === taskId);
  if (!task) return;
  if (!confirm(`Eliminar PERMANENTEMENTE la tarea "${task.text}"?\n\nEsta accion no se puede deshacer.`)) return;
  await db.collection('tasks').doc(taskId).delete();
}
window.permanentlyDeleteTask = permanentlyDeleteTask;

async function deleteProject(projectId) {
  const project = projects.find(p => p.id === projectId);
  const taskCount = tasks.filter(t => t.projectId === projectId && t.status !== 'completed').length;

  if (taskCount > 0 && !confirm(`"${project.name}" tiene ${taskCount} tarea(s). Eliminar todo?`)) return;

  const batch = db.batch();
  batch.delete(db.collection('projects').doc(projectId));
  tasks.filter(t => t.projectId === projectId).forEach(t => {
    batch.delete(db.collection('tasks').doc(t.id));
  });
  await batch.commit();
}

async function createProject() {
  const name = el.projectNameInput.value.trim();
  if (!name) return;

  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#BB8FCE', '#85C1E9', '#F0B27A'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  await db.collection('projects').add({
    name: name,
    color: color,
    createdBy: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  hideProjectModal();
}

// ===== TELEGRAM HANDLERS =====
async function tgLinkUser({ chatId, email }) {
  const snapshot = await db.collection('users').where('email', '==', email).get();
  if (!snapshot.empty) {
    const userDoc = snapshot.docs[0];
    await db.collection('users').doc(userDoc.id).update({ telegramChatId: chatId });
    window.api.sendTelegramMessage(chatId, `Cuenta vinculada a *${userDoc.data().name}*`);
  } else {
    window.api.sendTelegramMessage(chatId, 'Email no encontrado. Registrate primero en la app.');
  }
}

async function tgAddTask({ chatId, projectName, taskText }) {
  const user = teamMembers.find(m => m.telegramChatId === chatId);
  if (!user) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero con /vincular tu@email.com'); return; }

  let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  if (!project) {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];
    const ref = await db.collection('projects').add({
      name: projectName,
      color: colors[Math.floor(Math.random() * colors.length)],
      createdBy: user.id,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    project = { id: ref.id, name: projectName, color: '#4ECDC4' };
  }

  await db.collection('tasks').add({
    text: taskText,
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color || '#4ECDC4',
    assignedTo: user.id,
    assignedToName: user.name,
    createdBy: user.id,
    createdByName: user.name,
    status: 'pending',
    source: 'telegram',
    notes: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  window.api.sendTelegramMessage(chatId, `Tarea agregada a *${project.name}*:\n${taskText}`);
}

async function tgAssignTask({ chatId, projectName, taskText, assignToEmail, dependsOnTaskId, dependsOnTaskText, dependsOnAssigneeName }) {
  const sender = teamMembers.find(m => m.telegramChatId === chatId);
  if (!sender) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }

  const assignee = teamMembers.find(m => m.email === assignToEmail);
  if (!assignee) { window.api.sendTelegramMessage(chatId, `Usuario *${assignToEmail}* no encontrado.`); return; }

  let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  if (!project) {
    const ref = await db.collection('projects').add({
      name: projectName, color: '#45B7D1', createdBy: sender.id,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    project = { id: ref.id, name: projectName, color: '#45B7D1' };
  }

  const taskData = {
    text: taskText, projectId: project.id, projectName: project.name,
    projectColor: project.color || '#45B7D1', assignedTo: assignee.id,
    assignedToName: assignee.name, createdBy: sender.id, createdByName: sender.name,
    status: 'pending', source: 'telegram', notes: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (dependsOnTaskId) {
    taskData.dependsOn = dependsOnTaskId;
    taskData.dependsOnText = dependsOnTaskText || '';
    taskData.dependsOnAssigneeName = dependsOnAssigneeName || '';
  }

  const ref = await db.collection('tasks').add(taskData);

  window.api.sendTelegramMessage(chatId, `Tarea asignada a *${assignee.name}*:\n${taskText}`);
  if (assignee.telegramChatId) {
    const depMsg = dependsOnTaskId ? `\nEn espera de *${dependsOnAssigneeName || 'otro miembro'}*: ${dependsOnTaskText || ''}` : '';
    window.api.sendTelegramMessage(assignee.telegramChatId, `*${sender.name}* te asigno una tarea:\n${taskText}\nProyecto: *${project.name}*${depMsg}`);
  }
  return ref.id;
}

async function tgAssignChain({ chatId, projectName, steps }) {
  const sender = teamMembers.find(m => m.telegramChatId === chatId);
  if (!sender) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }
  if (!Array.isArray(steps) || steps.length === 0) {
    window.api.sendTelegramMessage(chatId, 'No se indicaron pasos de la cadena.');
    return;
  }

  let previousTaskId = null;
  let previousText = null;
  let previousAssigneeName = null;
  const created = [];

  for (const step of steps) {
    const email = step.assign_to_email || step.assignToEmail;
    const text = step.task_text || step.taskText;
    if (!email || !text) continue;
    const id = await tgAssignTask({
      chatId,
      projectName,
      taskText: text,
      assignToEmail: email,
      dependsOnTaskId: previousTaskId,
      dependsOnTaskText: previousText,
      dependsOnAssigneeName: previousAssigneeName
    });
    if (!id) return;
    previousTaskId = id;
    previousText = text;
    const assignee = teamMembers.find(m => m.email === email);
    previousAssigneeName = assignee ? assignee.name : email;
    created.push(`${created.length + 1}. ${previousAssigneeName}: ${text}`);
  }

  window.api.sendTelegramMessage(chatId, `Cadena creada en *${projectName}*:\n${created.join('\n')}`);
}

async function tgGetMyTasks({ chatId }) {
  const user = teamMembers.find(m => m.telegramChatId === chatId);
  if (!user) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }
  const myTasks = tasks.filter(t => t.assignedTo === user.id && t.status !== 'completed');
  if (myTasks.length === 0) { window.api.sendTelegramMessage(chatId, 'No tienes tareas pendientes.'); return; }
  let msg = `*Tus tareas (${myTasks.length}):*\n\n`;
  myTasks.forEach((t, i) => { msg += `${i + 1}. ${t.text} (${t.projectName}) ${t.status === 'pending_approval' ? '[Esperando aprobacion]' : ''}\n`; });
  window.api.sendTelegramMessage(chatId, msg);
}

async function tgGetAllTasks({ chatId }) {
  const pending = tasks.filter(t => t.status !== 'completed');
  if (pending.length === 0) { window.api.sendTelegramMessage(chatId, 'No hay tareas pendientes en el equipo.'); return; }
  let msg = `*Todas las tareas (${pending.length}):*\n\n`;
  pending.forEach((t, i) => { msg += `${i + 1}. ${t.text} -> ${t.assignedToName} (${t.projectName})\n`; });
  window.api.sendTelegramMessage(chatId, msg);
}

async function tgCompleteTask({ chatId, taskIndex }) {
  const user = teamMembers.find(m => m.telegramChatId === chatId);
  if (!user) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }
  const myTasks = tasks.filter(t => t.assignedTo === user.id && t.status === 'pending');
  const idx = taskIndex - 1;
  if (idx < 0 || idx >= myTasks.length) { window.api.sendTelegramMessage(chatId, 'Numero de tarea no valido.'); return; }
  const task = myTasks[idx];
  await db.collection('tasks').doc(task.id).update({
    status: 'pending_approval',
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    submittedBy: user.id, submittedByName: user.name
  });
  window.api.sendTelegramMessage(chatId, `Tarea enviada para aprobacion: *${task.text}*`);
}

async function tgGetProjects({ chatId }) {
  if (projects.length === 0) { window.api.sendTelegramMessage(chatId, 'No hay proyectos.'); return; }
  let msg = '*Proyectos:*\n\n';
  projects.forEach(p => {
    const count = tasks.filter(t => t.projectId === p.id && t.status !== 'completed').length;
    msg += `*${p.name}* - ${count} tarea(s)\n`;
  });
  window.api.sendTelegramMessage(chatId, msg);
}

async function tgGetTeam({ chatId }) {
  if (teamMembers.length === 0) { window.api.sendTelegramMessage(chatId, 'No hay miembros.'); return; }
  let msg = '*Equipo:*\n\n';
  teamMembers.forEach(m => {
    const p = tasks.filter(t => t.assignedTo === m.id && t.status !== 'completed').length;
    msg += `*${m.name}* (${m.email}) - ${p} tareas\n`;
  });
  window.api.sendTelegramMessage(chatId, msg);
}

async function tgNaturalMessage({ chatId, text }) {
  const sender = teamMembers.find(m => m.telegramChatId === chatId);
  if (!sender) {
    window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero con `/vincular tu@email.com`');
    return;
  }

  const myTasks = tasks.filter(t => t.assignedTo === sender.id && t.status === 'pending');
  const myTasksContext = myTasks.length
    ? myTasks.map((t, i) => `${i + 1}. [${t.projectName}] ${t.text}`).join('\n')
    : '(ninguna)';

  const systemPrompt = `Eres el cerebro de un bot de Telegram de gestion de tareas en equipo. Interpreta mensajes en espanol y ejecuta la accion correcta.

Usuario actual: ${sender.name} (${sender.email})

Proyectos existentes: ${projects.map(p => p.name).join(', ') || '(ninguno)'}

Miembros del equipo:
${teamMembers.map(m => `- ${m.name} (${m.email})`).join('\n')}

Tareas pendientes del usuario (numeradas para completar):
${myTasksContext}

Reglas:
- Si menciona a alguien por nombre, busca su email en la lista de miembros y usalo exacto
- Si menciona un proyecto, usa el nombre exacto de la lista; si no existe pero pide crearlo, puedes inventar un nombre
- Una tarea para "mi"/"yo" o sin destinatario claro => add_task
- Una tarea para otra persona => assign_task
- Dos o mas tareas encadenadas ("primero A, despues B", "X tiene que terminar antes de Y") => assign_chain_tasks con los pasos en orden
- Completar "la 1"/"la primera" => complete_task con index 1
- Saludos, preguntas, cosas que no son acciones => reply_message con una respuesta util y amable`;

  const tools = [
    {
      name: 'add_task',
      description: 'Crear una tarea para el usuario actual',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          task_text: { type: 'string' }
        },
        required: ['project_name', 'task_text']
      }
    },
    {
      name: 'assign_task',
      description: 'Crear una tarea y asignarla a otro miembro del equipo',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          task_text: { type: 'string' },
          assign_to_email: { type: 'string' }
        },
        required: ['project_name', 'task_text', 'assign_to_email']
      }
    },
    {
      name: 'assign_chain_tasks',
      description: 'Crear una cadena de tareas dependientes. Cada paso debe terminar antes que el siguiente. Usar cuando haya dos o mas personas que deben trabajar en secuencia.',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          steps: {
            type: 'array',
            description: 'Pasos en orden. Cada paso se ejecuta cuando termina el anterior.',
            items: {
              type: 'object',
              properties: {
                assign_to_email: { type: 'string' },
                task_text: { type: 'string' }
              },
              required: ['assign_to_email', 'task_text']
            }
          }
        },
        required: ['project_name', 'steps']
      }
    },
    {
      name: 'complete_task',
      description: 'Marcar una de las tareas pendientes del usuario como completada (envia a aprobacion)',
      input_schema: {
        type: 'object',
        properties: { task_index: { type: 'integer' } },
        required: ['task_index']
      }
    },
    {
      name: 'list_my_tasks',
      description: 'Listar las tareas del usuario actual',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'list_all_tasks',
      description: 'Listar todas las tareas pendientes del equipo',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'list_projects',
      description: 'Listar los proyectos y cuantas tareas tiene cada uno',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'list_team',
      description: 'Listar los miembros del equipo',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'reply_message',
      description: 'Responder al usuario con un mensaje de texto (saludos, preguntas, cuando no aplica otra accion)',
      input_schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      }
    }
  ];

  const result = await window.api.callClaude({ systemPrompt, userMessage: text, tools });

  if (result.error) {
    const errMsg = result.error === 'no-api-key'
      ? 'La IA no esta configurada. Usa los comandos /nueva, /asignar, /tareas, etc.'
      : `Error llamando a Claude: ${result.error}`;
    window.api.sendTelegramMessage(chatId, errMsg);
    return;
  }

  const input = result.input || {};
  switch (result.tool) {
    case 'add_task':
      await tgAddTask({ chatId, projectName: input.project_name, taskText: input.task_text });
      break;
    case 'assign_task':
      await tgAssignTask({ chatId, projectName: input.project_name, taskText: input.task_text, assignToEmail: input.assign_to_email });
      break;
    case 'assign_chain_tasks':
      await tgAssignChain({ chatId, projectName: input.project_name, steps: input.steps || [] });
      break;
    case 'complete_task':
      await tgCompleteTask({ chatId, taskIndex: input.task_index });
      break;
    case 'list_my_tasks':
      await tgGetMyTasks({ chatId });
      break;
    case 'list_all_tasks':
      await tgGetAllTasks({ chatId });
      break;
    case 'list_projects':
      await tgGetProjects({ chatId });
      break;
    case 'list_team':
      await tgGetTeam({ chatId });
      break;
    case 'reply_message':
      window.api.sendTelegramMessage(chatId, input.text || 'No entendi.');
      break;
    default:
      window.api.sendTelegramMessage(chatId, 'No supe que hacer con eso.');
  }
}

function initTelegramHandlers() {
  window.api.onTelegramLinkUser(tgLinkUser);
  window.api.onTelegramAddTask(tgAddTask);
  window.api.onTelegramAssignTask(tgAssignTask);
  window.api.onTelegramGetMyTasks(tgGetMyTasks);
  window.api.onTelegramGetAllTasks(tgGetAllTasks);
  window.api.onTelegramCompleteTask(tgCompleteTask);
  window.api.onTelegramGetProjects(tgGetProjects);
  window.api.onTelegramGetTeam(tgGetTeam);
  window.api.onTelegramNaturalMessage(tgNaturalMessage);
}

// ===== TELEGRAM SETTINGS =====
async function loadTelegramToken() {
  const token = await window.api.getTelegramToken();
  if (token) { el.telegramToken.value = token; updateTelegramStatus(true); }
}

el.saveTelegram.addEventListener('click', async () => {
  const token = el.telegramToken.value.trim();
  if (!token) return;
  await window.api.setTelegramToken(token);
  updateTelegramStatus(true);
  subscribeToNotificationQueue();
});

function updateTelegramStatus(connected) {
  const dot = el.telegramStatus.querySelector('.status-dot');
  const text = el.telegramStatus.querySelector('span:last-child');
  dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  text.textContent = connected ? 'Bot activo' : 'No conectado';
}

// ===== REMINDERS =====
async function loadReminderInterval() {
  const mins = await window.api.getReminderInterval();
  if (el.reminderInterval) el.reminderInterval.value = String(mins || 0);
  startRemindersTimer(mins);
}

function startRemindersTimer(minutes) {
  if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = null; }
  if (!minutes || minutes <= 0) return;
  reminderTimer = setInterval(sendReminders, minutes * 60 * 1000);
}

async function sendReminders() {
  for (const m of teamMembers) {
    if (!m.telegramChatId) continue;

    const teamPending = tasks.filter(t => {
      if (t.assignedTo !== m.id || t.status !== 'pending') return false;
      if (t.dependsOn) {
        const dep = tasks.find(x => x.id === t.dependsOn);
        if (dep && dep.status !== 'completed') return false;
      }
      return true;
    });

    let personalCount = 0;
    try {
      const snap = await db.collection('personalTasks')
        .where('ownerId', '==', m.id)
        .where('status', '==', 'pending').get();
      personalCount = snap.size;
    } catch (e) { /* ignore rule errors */ }

    if (teamPending.length === 0 && personalCount === 0) continue;

    const lines = [];
    if (teamPending.length > 0) {
      lines.push(`*Tareas del equipo (${teamPending.length})*:`);
      teamPending.slice(0, 10).forEach((t, i) => {
        lines.push(`${i + 1}. ${t.text} (${t.projectName})`);
      });
      if (teamPending.length > 10) lines.push(`...y ${teamPending.length - 10} mas`);
    }
    if (personalCount > 0) {
      lines.push(`${lines.length > 0 ? '\n' : ''}Tienes *${personalCount} personal(es)* pendientes en tu app.`);
    }

    window.api.sendTelegramMessage(m.telegramChatId, `⏰ *Recordatorio*\n\n${lines.join('\n')}`);
  }
}

if (el.saveReminder) {
  el.saveReminder.addEventListener('click', async () => {
    const mins = parseInt(el.reminderInterval.value) || 0;
    await window.api.setReminderInterval(mins);
    startRemindersTimer(mins);
    alert(mins ? `Recordatorios activados cada ${mins} minuto(s)` : 'Recordatorios desactivados');
  });
}

// ===== CLAUDE AI SETTINGS =====
async function loadClaudeStatus() {
  const status = await window.api.getClaudeApiKeyStatus();
  updateClaudeStatus(status);
}

el.saveClaudeKey.addEventListener('click', async () => {
  const key = el.claudeApiKey.value.trim();
  if (!key) return;
  await window.api.setClaudeApiKey(key);
  el.claudeApiKey.value = '';
  await loadClaudeStatus();
});

function updateClaudeStatus(label) {
  const dot = el.claudeStatus.querySelector('.status-dot');
  const text = el.claudeStatus.querySelector('span:last-child');
  const connected = !!label;
  dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  text.textContent = connected ? label : 'No configurada';
}

// ===== UI EVENTS =====
function handleAddClick() {
  if (currentNewMode === 'personal') addPersonalTask();
  else addTask();
}
el.addTaskBtn.addEventListener('click', handleAddClick);
el.taskInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleAddClick(); });

// ===== CHAIN (multi-step) MODAL =====
const chainModal = document.getElementById('chainModal');
const chainStepsContainer = document.getElementById('chainSteps');
const chainProjectSelect = document.getElementById('chainProjectSelect');

document.getElementById('chainBtn').addEventListener('click', openChainModal);
document.getElementById('addChainStep').addEventListener('click', () => addChainStepRow());
document.getElementById('cancelChain').addEventListener('click', closeChainModal);
document.getElementById('confirmChain').addEventListener('click', confirmChain);
chainModal.addEventListener('click', (e) => { if (e.target === chainModal) closeChainModal(); });

function openChainModal() {
  chainProjectSelect.innerHTML = '<option value="">Elige proyecto...</option>';
  projects.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    chainProjectSelect.appendChild(o);
  });
  if (el.projectSelect.value) chainProjectSelect.value = el.projectSelect.value;
  chainStepsContainer.innerHTML = '';
  addChainStepRow();
  addChainStepRow();
  chainModal.classList.add('active');
}

function closeChainModal() {
  chainModal.classList.remove('active');
  chainStepsContainer.innerHTML = '';
}

function addChainStepRow() {
  const row = document.createElement('div');
  row.className = 'chain-step-row';
  row.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)';
  const optionsHtml = teamMembers.map(m => `<option value="${m.id}">${esc(m.name)}${m.id === currentUser.uid ? ' (yo)' : ''}</option>`).join('');
  row.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center">
      <span class="chain-step-num" style="min-width:22px;color:var(--text-dim);font-size:12px;font-weight:600">1.</span>
      <input type="text" class="chain-step-text" placeholder="Descripcion del paso" style="flex:2;margin:0">
      <select class="chain-step-user" style="flex:1;margin:0">
        <option value="">Asignar a...</option>
        ${optionsHtml}
      </select>
      <button class="btn btn-ghost btn-small chain-step-remove" title="Quitar paso" style="color:var(--danger);padding:4px 8px">&times;</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-left:30px">
      <span style="color:var(--text-dim);font-size:11px">Plazo:</span>
      <input type="number" class="chain-step-amount" placeholder="Cantidad" min="1" style="width:90px;padding:8px 12px;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;margin:0">
      <select class="chain-step-unit" style="flex:0 0 110px;margin:0">
        <option value="">Sin plazo</option>
        <option value="minutes">Minutos</option>
        <option value="hours">Horas</option>
        <option value="days">Dias</option>
      </select>
    </div>
  `;
  row.querySelector('.chain-step-remove').addEventListener('click', () => {
    row.remove();
    renumberChainSteps();
  });
  chainStepsContainer.appendChild(row);
  renumberChainSteps();
}

function renumberChainSteps() {
  Array.from(chainStepsContainer.children).forEach((row, i) => {
    const span = row.querySelector('.chain-step-num');
    if (span) span.textContent = (i + 1) + '.';
  });
}

async function confirmChain() {
  const projectId = chainProjectSelect.value;
  if (!projectId) {
    chainProjectSelect.style.borderColor = 'var(--danger)';
    setTimeout(() => chainProjectSelect.style.borderColor = '', 1500);
    return;
  }
  const project = projects.find(p => p.id === projectId);

  const rows = Array.from(chainStepsContainer.children);
  const steps = [];
  for (const row of rows) {
    const text = row.querySelector('.chain-step-text').value.trim();
    const userId = row.querySelector('.chain-step-user').value;
    const amount = parseInt(row.querySelector('.chain-step-amount').value);
    const unit = row.querySelector('.chain-step-unit').value;
    if (!text || !userId) continue;
    let deadlineDate = null;
    if (amount && amount > 0 && unit) {
      deadlineDate = new Date();
      if (unit === 'minutes') deadlineDate.setMinutes(deadlineDate.getMinutes() + amount);
      else if (unit === 'hours') deadlineDate.setHours(deadlineDate.getHours() + amount);
      else deadlineDate.setDate(deadlineDate.getDate() + amount);
    }
    steps.push({ text, userId, deadlineDate });
  }
  if (steps.length < 2) {
    alert('Agrega al menos 2 pasos con texto y miembro asignado.');
    return;
  }

  let previousTaskId = null;
  let previousText = null;
  let previousAssigneeName = null;

  for (const step of steps) {
    const assignee = teamMembers.find(m => m.id === step.userId);
    if (!assignee) continue;

    const taskData = {
      text: step.text,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color || '#666',
      assignedTo: assignee.id,
      assignedToName: assignee.name,
      createdBy: currentUser.uid,
      createdByName: currentUserData.name,
      status: 'pending',
      source: 'app',
      notes: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (previousTaskId) {
      taskData.dependsOn = previousTaskId;
      taskData.dependsOnText = previousText;
      taskData.dependsOnAssigneeName = previousAssigneeName;
    }
    if (step.deadlineDate) {
      taskData.deadline = firebase.firestore.Timestamp.fromDate(step.deadlineDate);
    }

    const ref = await db.collection('tasks').add(taskData);

    if (assignee.id !== currentUser.uid) {
      const depMsg = previousText ? `\nEn espera de *${previousAssigneeName}*: ${previousText}` : '';
      const dlMsg = step.deadlineDate ? `\nPlazo: *${step.deadlineDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}*` : '';
      notifyAssignedOrWarn(assignee,
        `Nueva tarea en cadena (*${currentUserData.name}*):\n${step.text}\nProyecto: *${project.name}*${dlMsg}${depMsg}`
      );
    }

    previousTaskId = ref.id;
    previousText = step.text;
    previousAssigneeName = assignee.name;
  }

  closeChainModal();
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const tabContent = document.getElementById('tab' + capitalize(currentTab));
    if (tabContent) tabContent.classList.add('active');
    if (currentTab === 'calendar') renderCalendar();
  });
});

// Nueva tab: toggle Equipo/Personal
let currentNewMode = 'team';
function applyNewMode(mode) {
  currentNewMode = mode;
  const projectRow = el.projectSelect.closest('.input-row');
  const chainBtn = document.getElementById('chainBtn');
  const chainRow = chainBtn ? chainBtn.closest('.input-row') : null;
  const isPersonal = mode === 'personal';
  if (projectRow) projectRow.style.display = isPersonal ? 'none' : 'flex';
  if (chainRow) chainRow.style.display = isPersonal ? 'none' : 'flex';
  if (el.personalProjectRow) el.personalProjectRow.style.display = isPersonal ? 'flex' : 'none';
  if (isPersonal) renderPersonalProjectSelect();
  el.taskInput.placeholder = isPersonal ? 'Nueva tarea personal (solo tu la veras)...' : 'Escribe la tarea...';
  document.querySelectorAll('.new-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.style.background = b.dataset.mode === mode ? 'var(--accent)' : '';
    b.style.color = b.dataset.mode === mode ? 'white' : '';
  });
}
document.querySelectorAll('.new-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => applyNewMode(btn.dataset.mode));
});
applyNewMode('team');

function capitalize(str) {
  return str.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

function showProjectModal() {
  el.projectModal.classList.add('active');
  el.projectNameInput.value = '';
  setTimeout(() => el.projectNameInput.focus(), 100);
}

function hideProjectModal() { el.projectModal.classList.remove('active'); }

el.newProjectBtn.addEventListener('click', showProjectModal);
el.quickProjectBtn.addEventListener('click', showProjectModal);
el.confirmProject.addEventListener('click', createProject);
el.cancelProject.addEventListener('click', hideProjectModal);
el.projectNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') createProject(); });
el.projectModal.addEventListener('click', (e) => { if (e.target === el.projectModal) hideProjectModal(); });

// Personal project modal handlers
if (el.newPersonalProjectBtn) el.newPersonalProjectBtn.addEventListener('click', showPersonalProjectModal);
if (el.confirmPersonalProject) el.confirmPersonalProject.addEventListener('click', async () => {
  const name = el.personalProjectNameInput.value.trim();
  if (!name) { el.personalProjectNameInput.focus(); return; }
  await addPersonalProject(name);
  hidePersonalProjectModal();
});
if (el.cancelPersonalProject) el.cancelPersonalProject.addEventListener('click', hidePersonalProjectModal);
if (el.personalProjectNameInput) el.personalProjectNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') el.confirmPersonalProject.click();
});
if (el.personalProjectModal) el.personalProjectModal.addEventListener('click', (e) => {
  if (e.target === el.personalProjectModal) hidePersonalProjectModal();
});

el.clearAllCompleted.addEventListener('click', async () => {
  const completed = tasks.filter(t => t.status === 'completed');
  if (completed.length === 0) return;
  const batch = db.batch();
  completed.forEach(t => batch.delete(db.collection('tasks').doc(t.id)));
  await batch.commit();
});

el.btnPin.addEventListener('click', async () => {
  alwaysOnTop = await window.api.toggleAlwaysOnTop();
  el.btnPin.classList.toggle('unpinned', !alwaysOnTop);
  el.btnPin.title = alwaysOnTop ? 'Fijada (click para desfijar)' : 'No fijada (click para fijar)';
});

el.btnMinimize.addEventListener('click', () => window.api.minimizeWindow());
el.btnClose.addEventListener('click', () => window.api.closeWindow());

window.api.getAlwaysOnTop().then(v => {
  alwaysOnTop = v;
  el.btnPin.classList.toggle('unpinned', !v);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideProjectModal();
    hidePersonalProjectModal();
    editModal.classList.remove('active');
    noteModal.classList.remove('active');
    linkModal.classList.remove('active');
    videoModal.classList.remove('active');
    document.getElementById('submitTaskModal').classList.remove('active');
    document.getElementById('archiveDepositModal').classList.remove('active');
    submittingTaskId = null;
    archivingTask = null;
  }
});

// ===== AUTO UPDATE =====
const updateBanner = document.getElementById('updateBanner');
const updateText = document.getElementById('updateText');

window.api.onUpdateStatus(({ status, version, percent }) => {
  updateBanner.style.display = 'block';
  if (status === 'downloading') {
    updateText.textContent = `Descargando v${version}...`;
    updateBanner.style.background = '#ffd93d';
    updateBanner.style.cursor = 'default';
    updateBanner.onclick = null;
  } else if (status === 'progress') {
    updateText.textContent = `Descargando actualizacion... ${percent}%`;
  } else if (status === 'ready') {
    updateText.textContent = `v${version} lista - Click para actualizar`;
    updateBanner.style.background = '#4ecdc4';
    updateBanner.style.cursor = 'pointer';
    updateBanner.onclick = () => window.api.installUpdate();
  }
});

window.api.getAppVersion().then(v => {
  const versionEl = document.querySelector('.settings-panel');
  if (versionEl) {
    const div = document.createElement('div');
    div.style.cssText = 'text-align:center;font-size:11px;color:var(--text-secondary);margin-top:20px';
    div.textContent = 'Task Manager v' + v;
    versionEl.appendChild(div);
  }
});

// ===== UTILITIES =====
function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'ahora';
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)}h`;
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ===== TELEGRAM NOTIFICATION QUEUE (Firebase-based) =====
// Cualquier instancia (tenga o no el bot) puede encolar notificaciones.
// La instancia admin (con bot activo) las procesa y las envia.
async function sendTelegramNotif(chatId, message) {
  if (!chatId || !message) return;
  try {
    const localToken = await window.api.getTelegramToken();
    if (localToken) {
      // Mi app tiene bot local: envio directo (mas rapido)
      window.api.sendTelegramMessage(chatId, message);
      return;
    }
  } catch (e) { /* fallthrough a queue */ }
  // Sin bot local: encolar en Firebase para que otra instancia la procese
  try {
    await db.collection('notifications').add({
      chatId: String(chatId),
      message,
      status: 'pending',
      createdBy: currentUser ? currentUser.uid : 'unknown',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error('Failed to queue telegram notification:', e);
  }
}

async function sendTelegramNotifToMany(chatIds, message) {
  if (!Array.isArray(chatIds)) return;
  for (const id of chatIds) await sendTelegramNotif(id, message);
}

async function subscribeToNotificationQueue() {
  if (unsubscribeNotifQueue) { unsubscribeNotifQueue(); unsubscribeNotifQueue = null; }
  const token = await window.api.getTelegramToken();
  if (!token) return; // Solo la instancia con bot procesa la cola
  unsubscribeNotifQueue = db.collection('notifications')
    .where('status', '==', 'pending')
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type !== 'added') return;
        const { chatId, message } = change.doc.data();
        if (!chatId || !message) {
          change.doc.ref.delete().catch(() => {});
          return;
        }
        window.api.sendTelegramMessage(chatId, message);
        // Dar 1s para que salga y borrar
        setTimeout(() => change.doc.ref.delete().catch(() => {}), 1500);
      });
    });
}

// ===== TOAST =====
function showToast(msg, type = 'success', durationMs = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; }, durationMs);
  setTimeout(() => t.remove(), durationMs + 400);
}

function notifyAssignedOrWarn(assignee, message) {
  if (!assignee || assignee.id === currentUser.uid) return;
  if (assignee.telegramChatId) {
    sendTelegramNotif(assignee.telegramChatId, message);
    showToast(`✓ Notificado a ${assignee.name} (chat ${assignee.telegramChatId})`, 'success');
  } else {
    showToast(`⚠️ ${assignee.name} no tiene Telegram vinculado — no recibira la notif`, 'warn', 5000);
  }
}

async function testTelegramNotif(chatId, name) {
  await sendTelegramNotif(chatId, `Prueba: mensaje de test a ${name}. Si lees esto, el bot puede enviarte notificaciones.`);
  showToast(`✓ Prueba enviada a ${name} (chat ${chatId})`, 'success');
}
window.testTelegramNotif = testTelegramNotif;

window.api.onTelegramSendError(({ chatId, error }) => {
  showToast(`❌ Telegram fallo: ${error} (chat ${chatId})`, 'warn', 8000);
});

// ===== AI DISPATCH (IN-APP AGENT) =====
function parseDeadlineIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) d.setHours(23, 59, 0, 0);
  return d;
}

function deadlineLabel(d) {
  if (!d) return '';
  return ' para el ' + d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

async function aiCreateTask({ projectName, taskText, deadlineIso }) {
  let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  if (!project) {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];
    const ref = await db.collection('projects').add({
      name: projectName,
      color: colors[Math.floor(Math.random() * colors.length)],
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    project = { id: ref.id, name: projectName, color: '#4ECDC4' };
  }
  const data = {
    text: taskText,
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color || '#4ECDC4',
    assignedTo: currentUser.uid,
    assignedToName: currentUserData.name,
    createdBy: currentUser.uid,
    createdByName: currentUserData.name,
    status: 'pending',
    source: 'ai',
    notes: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const dl = parseDeadlineIso(deadlineIso);
  if (dl) data.deadline = firebase.firestore.Timestamp.fromDate(dl);
  await db.collection('tasks').add(data);
  return `✓ Tarea creada en ${project.name}: ${taskText}${deadlineLabel(dl)}`;
}

async function aiAssignTaskInternal({ projectName, taskText, assignToEmail, deadlineIso, dependsOnTaskId, dependsOnTaskText, dependsOnAssigneeName }) {
  const assignee = teamMembers.find(m => m.email === assignToEmail);
  if (!assignee) return { success: false, message: `Usuario ${assignToEmail} no esta en el equipo.` };

  let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  if (!project) {
    const ref = await db.collection('projects').add({
      name: projectName, color: '#45B7D1', createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    project = { id: ref.id, name: projectName, color: '#45B7D1' };
  }

  const taskData = {
    text: taskText, projectId: project.id, projectName: project.name,
    projectColor: project.color || '#45B7D1', assignedTo: assignee.id,
    assignedToName: assignee.name, createdBy: currentUser.uid, createdByName: currentUserData.name,
    status: 'pending', source: 'ai', notes: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const dl = parseDeadlineIso(deadlineIso);
  if (dl) taskData.deadline = firebase.firestore.Timestamp.fromDate(dl);
  if (dependsOnTaskId) {
    taskData.dependsOn = dependsOnTaskId;
    taskData.dependsOnText = dependsOnTaskText || '';
    taskData.dependsOnAssigneeName = dependsOnAssigneeName || '';
  }
  const ref = await db.collection('tasks').add(taskData);

  if (assignee.id !== currentUser.uid) {
    const depMsg = dependsOnTaskId ? `\nEn espera de *${dependsOnAssigneeName || 'otro'}*: ${dependsOnTaskText || ''}` : '';
    const dlMsg = dl ? `\nPlazo: *${dl.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}*` : '';
    notifyAssignedOrWarn(assignee,
      `*${currentUserData.name}* te asigno una tarea:\n${taskText}\nProyecto: *${project.name}*${dlMsg}${depMsg}`);
  }
  return { success: true, taskId: ref.id, assigneeName: assignee.name, projectName: project.name, deadline: dl };
}

async function aiAssignTask(input) {
  const r = await aiAssignTaskInternal(input);
  if (!r.success) return `✗ ${r.message}`;
  return `✓ Tarea asignada a ${r.assigneeName} en ${r.projectName}: ${input.taskText}${deadlineLabel(r.deadline)}`;
}

async function aiAssignChain({ projectName, steps }) {
  if (!Array.isArray(steps) || steps.length < 2) return '✗ Una cadena necesita al menos 2 pasos.';
  let prev = { id: null, text: null, name: null };
  const created = [];
  for (const s of steps) {
    const r = await aiAssignTaskInternal({
      projectName, taskText: s.task_text, assignToEmail: s.assign_to_email,
      deadlineIso: s.deadline_iso,
      dependsOnTaskId: prev.id, dependsOnTaskText: prev.text, dependsOnAssigneeName: prev.name
    });
    if (!r.success) return `✗ ${r.message}`;
    prev = { id: r.taskId, text: s.task_text, name: r.assigneeName };
    created.push(`${created.length + 1}. ${r.assigneeName}: ${s.task_text}${deadlineLabel(r.deadline)}`);
  }
  return `✓ Cadena creada en ${projectName}:\n${created.join('\n')}`;
}

async function aiCreatePersonalTask({ task_text, deadline_iso }) {
  const data = {
    text: task_text,
    ownerId: currentUser.uid,
    ownerName: currentUserData.name,
    status: 'pending',
    source: 'ai',
    personalProject: currentPersonalProject || 'General',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const dl = parseDeadlineIso(deadline_iso);
  if (dl) data.deadline = firebase.firestore.Timestamp.fromDate(dl);
  await db.collection('personalTasks').add(data);
  return `✓ Tarea personal creada en "${data.personalProject}": ${task_text}${deadlineLabel(dl)}`;
}

const aiHistory = [];
let lastAiUserMsg = null;
let lastAiResult = null;

function renderAIHistory() {
  const container = document.getElementById('aiHistory');
  if (!container) return;
  if (aiHistory.length === 0) { container.innerHTML = ''; return; }
  const recent = aiHistory.slice(0, 2);
  container.innerHTML = recent.map((h, i) => {
    const opacity = i === 0 ? 0.75 : 0.45;
    const resultColor = h.type === 'error' ? '#ff9090' : '#7fc3b9';
    const shortResult = (h.result || '').replace(/\n/g, ' ');
    return `<div onclick="reuseAIHistory(${i})" title="Click para reusar" style="font-size:10px;line-height:1.4;padding:2px 0;opacity:${opacity};cursor:pointer">
      <div style="color:var(--text-dim);font-style:italic">→ ${esc(h.user)}</div>
      <div style="color:${resultColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(shortResult)}</div>
    </div>`;
  }).join('');
}

function reuseAIHistory(index) {
  const h = aiHistory[index];
  if (!h) return;
  const input = document.getElementById('aiInput');
  if (input) { input.value = h.user; input.focus(); }
}
window.reuseAIHistory = reuseAIHistory;

function openAIHistoryModal() {
  const list = document.getElementById('aiHistoryList');
  if (!list) return;
  if (aiHistory.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);padding:16px;font-size:12px;text-align:center">Aun no hay historial.</div>';
  } else {
    list.innerHTML = aiHistory.map((h, i) => {
      const color = h.type === 'error' ? '#ff9090' : '#7fc3b9';
      return `<div onclick="reuseAIHistoryFromModal(${i})" title="Click para reusar en el input" style="padding:8px 10px;margin-bottom:6px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;line-height:1.4;transition:background 0.15s" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
        <div style="color:var(--text-dim);font-style:italic;margin-bottom:4px">→ ${esc(h.user)}</div>
        <div style="color:${color};white-space:pre-wrap">${esc(h.result || '')}</div>
      </div>`;
    }).join('');
  }
  document.getElementById('aiHistoryModal').classList.add('active');
}

function reuseAIHistoryFromModal(index) {
  reuseAIHistory(index);
  document.getElementById('aiHistoryModal').classList.remove('active');
}
window.reuseAIHistoryFromModal = reuseAIHistoryFromModal;

const aiHistoryBtn = document.getElementById('aiHistoryBtn');
if (aiHistoryBtn) aiHistoryBtn.addEventListener('click', openAIHistoryModal);
const closeAiHistoryBtn = document.getElementById('closeAiHistory');
if (closeAiHistoryBtn) closeAiHistoryBtn.addEventListener('click', () => {
  document.getElementById('aiHistoryModal').classList.remove('active');
});
const aiHistoryClearBtn = document.getElementById('aiHistoryClear');
if (aiHistoryClearBtn) aiHistoryClearBtn.addEventListener('click', () => {
  if (!confirm('Borrar todo el historial del agente?')) return;
  aiHistory.length = 0;
  renderAIHistory();
  openAIHistoryModal();
});
const aiHistoryModal = document.getElementById('aiHistoryModal');
if (aiHistoryModal) aiHistoryModal.addEventListener('click', (e) => {
  if (e.target === aiHistoryModal) aiHistoryModal.classList.remove('active');
});

function showAIResult(text, type = 'info') {
  const out = document.getElementById('aiResult');
  if (!out) return;
  out.style.display = 'block';
  out.textContent = text;
  out.style.color = type === 'error' ? '#ff6b6b' : type === 'success' ? '#4ecdc4' : 'var(--text-secondary)';
  if (type !== 'info') {
    lastAiResult = text;
    lastAiResultType = type;
  }
}

let lastAiResultType = 'info';

async function aiDispatch(text) {
  // Mover el resultado anterior al historial antes de procesar uno nuevo
  if (lastAiUserMsg && lastAiResult) {
    aiHistory.unshift({ user: lastAiUserMsg, result: lastAiResult, type: lastAiResultType });
    if (aiHistory.length > 10) aiHistory.pop();
    renderAIHistory();
  }
  lastAiUserMsg = text;
  lastAiResult = null;

  showAIResult('Pensando...', 'info');

  const myTasks = tasks.filter(t => t.assignedTo === currentUser.uid && t.status === 'pending');
  const myTasksContext = myTasks.length
    ? myTasks.map((t, i) => `${i + 1}. [${t.projectName}] ${t.text}`).join('\n')
    : '(ninguna)';

  const now = new Date();
  const isoNow = now.toISOString();
  const humanNow = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Contexto donde esta parado el usuario - para resolver "agregame X" sin mencionar proyecto
  const tabLabels = {
    main: 'Tareas del equipo', 'my-tasks': 'Mis tareas', approval: 'Por aprobar',
    completed: 'Hechas', personal: 'Personal', calendar: 'Calendario',
    team: 'Equipo', new: 'Nueva', settings: 'Config'
  };
  const contextLines = [`Pestana actual: ${tabLabels[currentTab] || currentTab}`];
  if (currentTab === 'personal') {
    contextLines.push(`Proyecto personal activo: "${currentPersonalProject}"`);
  } else if (lastInteractedProject && lastInteractedProject.name) {
    contextLines.push(`Ultimo proyecto de equipo que el usuario toco: "${lastInteractedProject.name}"`);
  }
  const contextBlock = contextLines.join('\n');

  const systemPrompt = `Eres un asistente de gestion de tareas en una app de equipo. Interpreta el mensaje del usuario y ejecuta la accion correcta usando las tools.

Fecha y hora actual: ${humanNow} (${isoNow})

Usuario actual: ${currentUserData.name} (${currentUserData.email})

Contexto de la app ahora mismo:
${contextBlock}

Proyectos existentes: ${projects.map(p => p.name).join(', ') || '(ninguno)'}

Miembros del equipo:
${teamMembers.map(m => `- ${m.name} (${m.email})`).join('\n')}

Reglas:
- Menciona alguien por nombre => busca su email exacto de la lista
- Proyecto => nombre exacto de la lista. Si no existe pero quiere crearlo, inventa uno coherente.
- Tarea para yo/mi/mi cuenta => add_task (asignada al usuario actual)
- Tarea personal/privada/para mi sola => add_personal_task
- Tarea para otro miembro => assign_task
- 2 o mas tareas en secuencia ("primero A, despues B") => assign_chain_tasks
- Saludos, preguntas, cosas que no son acciones => reply_message

CONTEXTO IMPLICITO (muy importante):
- Si el usuario dice "agregame X", "agrega X", "nueva tarea X" SIN mencionar proyecto ni a quien, usa el contexto de arriba:
  * Pestana "Personal" => add_personal_task (el proyecto personal activo ya se aplica automaticamente, NO lo pongas en task_text)
  * Pestana "Tareas del equipo" / "Mis tareas" / "Por aprobar" + hay "Ultimo proyecto de equipo" => add_task usando ese project_name
  * Si no hay contexto suficiente (ej. pestana Calendario o no hay ultimo proyecto tocado) => reply_message pidiendo al usuario el proyecto
- Si el usuario SI menciona explicitamente proyecto o persona, ignora el contexto y usa lo que dijo.

Deadlines (plazos):
- Si el usuario menciona una fecha/dia ("para el viernes", "en 3 dias", "el 30 de abril", "mañana", "hoy a las 5pm"), calcula la fecha correspondiente basandote en la fecha actual y pasala en deadline_iso (formato ISO 8601, ej: "2026-04-25T23:59:00").
- Si no menciona fecha, NO pongas deadline_iso.
- "Mañana" => el dia siguiente. "El viernes" => proximo viernes (si hoy ya paso el viernes, el siguiente).
- Si dice "hoy" incluye la hora mencionada; si no especifica hora usa 23:59.`;

  const tools = [
    {
      name: 'add_task',
      description: 'Crear tarea del equipo asignada al usuario actual',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          task_text: { type: 'string' },
          deadline_iso: { type: 'string', description: 'Fecha limite en ISO 8601 (opcional)' }
        },
        required: ['project_name', 'task_text']
      }
    },
    {
      name: 'assign_task',
      description: 'Crear tarea y asignarla a otro miembro',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          task_text: { type: 'string' },
          assign_to_email: { type: 'string' },
          deadline_iso: { type: 'string', description: 'Fecha limite en ISO 8601 (opcional)' }
        },
        required: ['project_name', 'task_text', 'assign_to_email']
      }
    },
    {
      name: 'assign_chain_tasks',
      description: 'Crear cadena de tareas en secuencia (una empieza cuando la anterior termina)',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                assign_to_email: { type: 'string' },
                task_text: { type: 'string' },
                deadline_iso: { type: 'string', description: 'Fecha limite de ESTE paso (opcional)' }
              },
              required: ['assign_to_email', 'task_text']
            }
          }
        },
        required: ['project_name', 'steps']
      }
    },
    {
      name: 'add_personal_task',
      description: 'Crear tarea personal privada (solo la ve el usuario actual)',
      input_schema: {
        type: 'object',
        properties: {
          task_text: { type: 'string' },
          deadline_iso: { type: 'string', description: 'Fecha limite en ISO 8601 (opcional)' }
        },
        required: ['task_text']
      }
    },
    {
      name: 'reply_message',
      description: 'Responder con un mensaje de texto cuando no aplica ninguna otra accion',
      input_schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      }
    }
  ];

  const result = await window.api.callClaude({ systemPrompt, userMessage: text, tools });
  if (result.error) {
    const msg = result.error === 'no-api-key'
      ? 'La IA no esta configurada. Ve a Config → Claude AI y pega tu API key.'
      : `Error: ${result.error}`;
    showAIResult(msg, 'error');
    return;
  }

  const input = result.input || {};
  try {
    let msg;
    switch (result.tool) {
      case 'add_task':
        msg = await aiCreateTask({ projectName: input.project_name, taskText: input.task_text, deadlineIso: input.deadline_iso });
        break;
      case 'assign_task':
        msg = await aiAssignTask({ projectName: input.project_name, taskText: input.task_text, assignToEmail: input.assign_to_email, deadlineIso: input.deadline_iso });
        break;
      case 'assign_chain_tasks':
        msg = await aiAssignChain({ projectName: input.project_name, steps: input.steps || [] });
        break;
      case 'add_personal_task':
        msg = await aiCreatePersonalTask({ task_text: input.task_text, deadline_iso: input.deadline_iso });
        break;
      case 'reply_message':
        msg = input.text || 'Listo.';
        break;
      default:
        msg = 'No entendi la accion.';
    }
    showAIResult(msg, msg.startsWith('✗') ? 'error' : 'success');
  } catch (e) {
    showAIResult('Error: ' + e.message, 'error');
  }
}

const aiInputEl = document.getElementById('aiInput');
const aiSendEl = document.getElementById('aiSendBtn');
async function handleAISend() {
  const txt = aiInputEl.value.trim();
  if (!txt) return;
  aiInputEl.value = '';
  await aiDispatch(txt);
}
if (aiSendEl) aiSendEl.addEventListener('click', handleAISend);
if (aiInputEl) aiInputEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleAISend(); });

// ===== CALENDAR TASK MODAL =====
let calTaskSelectedDate = null;
let calTaskCurrentMode = 'team';

function openCalTaskModal(dateStr) {
  calTaskSelectedDate = dateStr;
  const modal = document.getElementById('calendarTaskModal');
  const d = new Date(dateStr);
  document.getElementById('calendarTaskDate').textContent = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  const projSel = document.getElementById('calTaskProject');
  projSel.innerHTML = '<option value="">Proyecto...</option>';
  projects.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    projSel.appendChild(o);
  });
  const assnSel = document.getElementById('calTaskAssign');
  assnSel.innerHTML = '<option value="">Asignar a...</option>';
  teamMembers.forEach(m => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name + (m.id === currentUser.uid ? ' (yo)' : '');
    assnSel.appendChild(o);
  });
  document.getElementById('calTaskInput').value = '';
  applyCalTaskMode('team');
  modal.classList.add('active');
  setTimeout(() => document.getElementById('calTaskInput').focus(), 100);
}
window.openCalTaskModal = openCalTaskModal;

function applyCalTaskMode(mode) {
  calTaskCurrentMode = mode;
  document.querySelectorAll('.cal-task-mode-btn').forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('active', active);
    b.style.background = active ? 'var(--accent)' : '';
    b.style.color = active ? 'white' : '';
  });
  document.getElementById('calTaskTeamFields').style.display = mode === 'personal' ? 'none' : 'block';
}

document.querySelectorAll('.cal-task-mode-btn').forEach(b => {
  b.addEventListener('click', () => applyCalTaskMode(b.dataset.mode));
});

document.getElementById('calTaskCancel').addEventListener('click', () => {
  document.getElementById('calendarTaskModal').classList.remove('active');
});
document.getElementById('calendarTaskModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('calendarTaskModal')) {
    document.getElementById('calendarTaskModal').classList.remove('active');
  }
});
document.getElementById('calTaskInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('calTaskConfirm').click();
});

document.getElementById('calTaskConfirm').addEventListener('click', async () => {
  const text = document.getElementById('calTaskInput').value.trim();
  if (!text || !calTaskSelectedDate) return;

  const deadline = new Date(calTaskSelectedDate);
  deadline.setHours(23, 59, 0, 0);

  if (calTaskCurrentMode === 'personal') {
    await db.collection('personalTasks').add({
      text,
      ownerId: currentUser.uid,
      ownerName: currentUserData.name,
      status: 'pending',
      source: 'calendar',
      personalProject: currentPersonalProject || 'General',
      deadline: firebase.firestore.Timestamp.fromDate(deadline),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    const projectId = document.getElementById('calTaskProject').value;
    if (!projectId) {
      document.getElementById('calTaskProject').style.borderColor = 'var(--danger)';
      setTimeout(() => document.getElementById('calTaskProject').style.borderColor = '', 1500);
      return;
    }
    const assignTo = document.getElementById('calTaskAssign').value;
    const project = projects.find(p => p.id === projectId);
    const assignee = teamMembers.find(m => m.id === assignTo);
    await db.collection('tasks').add({
      text,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color || '#666',
      assignedTo: assignTo || currentUser.uid,
      assignedToName: assignee ? assignee.name : currentUserData.name,
      createdBy: currentUser.uid,
      createdByName: currentUserData.name,
      status: 'pending',
      source: 'calendar',
      notes: [],
      deadline: firebase.firestore.Timestamp.fromDate(deadline),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (assignee && assignTo !== currentUser.uid) {
      notifyAssignedOrWarn(assignee,
        `Nueva tarea asignada por *${currentUserData.name}* para *${deadline.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}*:\n${text}\nProyecto: *${project.name}*`);
    }
  }
  document.getElementById('calendarTaskModal').classList.remove('active');
});

// ===== CHAT GRUPAL =====
function chatTimestampToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return new Date(ts);
}

function formatChatTime(ts) {
  const d = chatTimestampToDate(ts);
  if (!d) return '';
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function chatDayLabel(date) {
  if (!date) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - d) / (24 * 3600 * 1000));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Trackeo de mensajes ya renderizados en el DOM para append-only y evitar flicker
const renderedChatIds = new Set();
let lastChatDayKey = null;

function chatMessageHtml(m) {
  const own = m.authorId === currentUser.uid;
  const color = getUserColor(m.authorId);
  const initial = (m.authorName || '?').charAt(0).toUpperCase();
  const time = formatChatTime(m.createdAt);
  const author = own ? 'Tu' : esc(m.authorName || 'Usuario');
  return `
    <div class="chat-msg ${own ? 'own' : ''}" data-msg-id="${esc(m.id)}">
      <div class="chat-msg-avatar" style="background:${color}">${initial}</div>
      <div class="chat-msg-body">
        <div class="chat-msg-meta">
          <span class="chat-msg-author" style="color:${color}">${author}</span>
          <span>${time}</span>
        </div>
        <div class="chat-msg-text">${esc(m.text)}</div>
      </div>
    </div>`;
}

function renderChatMessages() {
  const container = el.chatMessagesEl;
  if (!container) return;
  if (chatMessages.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px 12px">
        <div class="empty-state-icon" style="font-size:32px">&#128172;</div>
        <div class="empty-state-text" style="font-size:12px">Sin mensajes todavia</div>
        <div class="empty-state-sub" style="font-size:11px">Se el primero en escribir</div>
      </div>`;
    renderedChatIds.clear();
    lastChatDayKey = null;
    return;
  }

  // Append-only: si todos los mensajes existentes ya estan en el DOM,
  // solo agregamos los nuevos al final (evita flicker del re-render completo)
  const newMessages = chatMessages.filter(m => !renderedChatIds.has(m.id));
  const existingMessages = chatMessages.filter(m => renderedChatIds.has(m.id));
  const allExistingStillThere = existingMessages.length === renderedChatIds.size;

  if (renderedChatIds.size > 0 && newMessages.length > 0 && allExistingStillThere) {
    let html = '';
    newMessages.forEach(m => {
      const d = chatTimestampToDate(m.createdAt);
      const dayKey = d ? d.toDateString() : 'pending';
      if (dayKey !== lastChatDayKey) {
        html += `<div class="chat-day-divider">${d ? chatDayLabel(d) : 'Enviando...'}</div>`;
        lastChatDayKey = dayKey;
      }
      html += chatMessageHtml(m);
      renderedChatIds.add(m.id);
    });
    container.insertAdjacentHTML('beforeend', html);
    container.scrollTop = container.scrollHeight;
    return;
  }

  // Re-render completo (primer render o cambios en mensajes existentes)
  renderedChatIds.clear();
  lastChatDayKey = null;
  let html = '';
  chatMessages.forEach(m => {
    const d = chatTimestampToDate(m.createdAt);
    const dayKey = d ? d.toDateString() : 'pending';
    if (dayKey !== lastChatDayKey) {
      html += `<div class="chat-day-divider">${d ? chatDayLabel(d) : 'Enviando...'}</div>`;
      lastChatDayKey = dayKey;
    }
    html += chatMessageHtml(m);
    renderedChatIds.add(m.id);
  });
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

function countUnreadChat() {
  if (!chatLastReadAt && chatMessages.length === 0) return 0;
  const lastReadMs = chatLastReadAt ? (chatLastReadAt.toDate ? chatLastReadAt.toDate().getTime() : new Date(chatLastReadAt).getTime()) : 0;
  return chatMessages.filter(m => {
    if (m.authorId === currentUser.uid) return false;
    const ms = chatTimestampToDate(m.createdAt);
    return ms && ms.getTime() > lastReadMs;
  }).length;
}

function renderChatBadge() {
  if (!el.chatUnreadBadge) return;
  const n = countUnreadChat();
  if (n <= 0 || chatOpen) {
    el.chatUnreadBadge.style.display = 'none';
    return;
  }
  el.chatUnreadBadge.textContent = n > 99 ? '99+' : String(n);
  el.chatUnreadBadge.style.display = 'inline-flex';
}

async function markChatAsRead() {
  if (!currentUser) return;
  const now = firebase.firestore.Timestamp.now();
  chatLastReadAt = now;
  try {
    await db.collection('users').doc(currentUser.uid).update({ chatLastReadAt: now });
  } catch (e) { /* ignore */ }
  renderChatBadge();
}

async function openChat() {
  if (chatOpen) return;
  chatOpen = true;
  try { await window.api.chatExpandWindow(CHAT_EXTRA_WIDTH); } catch (e) { /* ignore */ }
  el.chatPanel.classList.add('open');
  el.chatToggleBtn.classList.add('active');
  // Forzar re-render limpio al abrir (asegura dia divisores correctos y scroll al final)
  renderedChatIds.clear();
  lastChatDayKey = null;
  renderChatMessages();
  markChatAsRead();
  setTimeout(() => el.chatInput && el.chatInput.focus(), 200);
}

async function closeChat() {
  if (!chatOpen) return;
  chatOpen = false;
  el.chatPanel.classList.remove('open');
  el.chatToggleBtn.classList.remove('active');
  try { await window.api.chatCollapseWindow(); } catch (e) { /* ignore */ }
  renderChatBadge();
}

async function sendChatMessage() {
  if (!el.chatInput) return;
  const text = el.chatInput.value.trim();
  if (!text) return;
  el.chatInput.value = '';
  try {
    await db.collection('chatMessages').add({
      text,
      authorId: currentUser.uid,
      authorName: currentUserData.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error('Error enviando chat:', e);
    el.chatInput.value = text;
  }
}

if (el.chatToggleBtn) {
  el.chatToggleBtn.addEventListener('click', () => {
    if (chatOpen) closeChat(); else openChat();
  });
}
if (el.chatClose) el.chatClose.addEventListener('click', closeChat);
if (el.chatSendBtn) el.chatSendBtn.addEventListener('click', sendChatMessage);
if (el.chatInput) {
  el.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
}
