// ===== STATE =====
let currentUser = null;
let currentUserData = null;
let tasks = [];
let projects = [];
let teamMembers = [];
let personalTasks = [];
let alwaysOnTop = true;
let currentTab = 'main';
let unsubscribeTasks = null;
let unsubscribeProjects = null;
let unsubscribeUsers = null;
let unsubscribePersonal = null;
let reminderTimer = null;

// User colors for completed tab
const userColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#DDA0DD', '#BB8FCE', '#F0B27A', '#82E0AA', '#F1948A', '#AED6F1'];

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
  btnClose: document.getElementById('btnClose')
};

// ===== AUTH =====
let isRegistering = false;

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

  subscribeToData();
  initTelegramHandlers();
  loadTelegramToken();
  loadClaudeStatus();
  loadReminderInterval();
  loadTabsMode();
}

function showLogin() {
  el.loginScreen.classList.remove('hidden');
  el.appContainer.classList.remove('active');
  if (unsubscribeTasks) unsubscribeTasks();
  if (unsubscribeProjects) unsubscribeProjects();
  if (unsubscribeUsers) unsubscribeUsers();
}

el.logoutBtn.addEventListener('click', () => auth.signOut());

const cloudBtn = document.getElementById('cloudBtn');
if (cloudBtn) {
  cloudBtn.addEventListener('click', () => {
    window.api.openExternal('https://drive.google.com/drive/folders/1BuRcSTdiHx07lcUsO9WUe1BoCk81NX2e?usp=sharing');
  });
}

// ===== FIRESTORE REAL-TIME =====
function subscribeToData() {
  unsubscribeTasks = db.collection('tasks').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
    tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderAll();
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
  });

  unsubscribePersonal = db.collection('personalTasks')
    .where('ownerId', '==', currentUser.uid)
    .onSnapshot((snapshot) => {
      personalTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderPersonalList();
    });
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
    html += `<div class="task-item" style="border-left-color:${color};margin:4px 12px">
      <div style="flex:1">
        <div class="task-text">${esc(t.text)}</div>
        <div class="task-meta">
          <span class="task-assignee">${isPersonal ? 'Personal' : esc(t.assignedToName || '')}</span>
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
  const count = pending.length;
  if (el.personalBadge) el.personalBadge.textContent = count;
  if (el.personalCount) el.personalCount.textContent = count;
  if (currentTab === 'calendar') renderCalendar();

  if (!el.personalList) return;
  if (personalTasks.length === 0) {
    el.personalList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128246;</div>
        <div class="empty-state-text">No tienes tareas personales</div>
        <div class="empty-state-sub">Escribe abajo para agregar una. Solo tu las veras.</div>
      </div>`;
    return;
  }

  const sorted = [...personalTasks].sort((a, b) => {
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
    const linkBtn = task.link
      ? `<button class="btn-add-note" onclick="showLinkModal('personalTasks','${task.id}')" title="Editar link">✏️ Link</button>`
      : `<button class="btn-add-note" onclick="showLinkModal('personalTasks','${task.id}')">🔗 + Link</button>`;
    html += `
      <div class="task-item ${completed ? 'completed' : ''}" style="border-left-color:${color}">
        <div class="${checkClass}" ${onClick} title="${completed ? 'Completada' : 'Marcar como terminada'}"></div>
        <div style="flex:1">
          <div class="task-text">${esc(task.text)}</div>
          <div class="task-meta">
            ${deadlineBadge}
            ${linkBadge}
            <span class="task-tag">${time}</span>
            ${linkBtn}
          </div>
        </div>
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

  const data = {
    text,
    ownerId: currentUser.uid,
    ownerName: currentUserData.name,
    status: 'pending',
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
}

async function completePersonalTask(taskId) {
  await db.collection('personalTasks').doc(taskId).update({
    status: 'completed',
    completedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function deletePersonalTask(taskId) {
  if (!confirm('Eliminar esta tarea personal?')) return;
  await db.collection('personalTasks').doc(taskId).delete();
}

window.completePersonalTask = completePersonalTask;
window.deletePersonalTask = deletePersonalTask;

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

function getUserColor(userId) {
  const idx = teamMembers.findIndex(m => m.id === userId);
  return userColors[idx >= 0 ? idx % userColors.length : 0];
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

  for (const [, group] of Object.entries(grouped)) {
    html += `<div class="project-section">
      <div class="project-header">
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

      // Check button
      let checkBtn = '';
      if (isPendingApproval) {
        checkBtn = '<div class="task-check" style="border-color:var(--warning);background:rgba(255,217,61,0.15)"></div>';
      } else {
        checkBtn = `<div class="task-check" onclick="completeTask('${task.id}')" title="Marcar como terminada"></div>`;
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

      let blockedBadge = '';
      if (task.dependsOn) {
        const dep = tasks.find(t => t.id === task.dependsOn);
        if (dep && dep.status !== 'completed') {
          const waitName = dep.assignedToName || 'otro';
          const waitText = dep.text.length > 25 ? dep.text.slice(0, 25) + '...' : dep.text;
          blockedBadge = `<span class="task-deadline deadline-soon" title="Esperando que ${esc(waitName)} termine">🔒 Esperando: ${esc(waitText)}</span>`;
        }
      }

      html += `
        <div class="task-item ${overdueClass}" data-id="${task.id}" style="border-left-color:${group.color}">
          ${checkBtn}
          <div style="flex:1">
            <div class="task-text">${esc(task.text)}</div>
            <div class="task-meta">
              <span class="task-assignee">${esc(assignee)}</span>
              ${statusBadge}
              ${deadlineBadge}
              ${blockedBadge}
              ${linkBadge}
              <span class="task-tag">${source}</span>
              <span class="task-tag">${time}</span>
              ${addNoteBtn}
              ${linkBtn}
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
    const linked = m.telegramChatId ? 'Telegram vinculado' : 'Sin Telegram';

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
          <div class="team-email">${esc(m.email)} - ${linked}</div>
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

  if (assignee && assignee.telegramChatId && assignTo !== currentUser.uid) {
    const unitLabel = unit === 'minutes' ? 'minuto(s)' : unit === 'hours' ? 'hora(s)' : 'dia(s)';
    const deadlineMsg = amount && amount > 0 ? `\nPlazo: *${amount} ${unitLabel}*` : '';
    window.api.sendTelegramMessage(assignee.telegramChatId,
      `Nueva tarea asignada por *${currentUserData.name}*:\n${text}\nProyecto: *${project.name}*${deadlineMsg}`
    );
  }
}

async function completeTask(taskId) {
  const taskEl = document.querySelector(`.task-item[data-id="${taskId}"]`);
  if (taskEl) {
    taskEl.classList.add('completing');
    await new Promise(r => setTimeout(r, 300));
  }

  const task = tasks.find(t => t.id === taskId);

  await db.collection('tasks').doc(taskId).update({
    status: 'pending_approval',
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    submittedBy: currentUser.uid,
    submittedByName: currentUserData.name
  });

  if (task) {
    // Notify creator and admins
    const notifyIds = teamMembers
      .filter(m => (m.role === 'admin' || m.id === task.createdBy) && m.telegramChatId && m.id !== currentUser.uid)
      .map(m => m.telegramChatId);

    if (notifyIds.length > 0) {
      window.api.notifyAllTelegram(notifyIds,
        `*${currentUserData.name}* termino una tarea y espera aprobacion:\n${task.text}\nProyecto: *${task.projectName}*`
      );
    }
  }
}

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
      window.api.sendTelegramMessage(assignee.telegramChatId,
        `Tu tarea fue *aprobada* por *${currentUserData.name}*:\n${task.text}`
      );
    }

    // Notify dependents: tasks that were waiting on this one
    const dependents = tasks.filter(t => t.dependsOn === taskId && t.status !== 'completed');
    dependents.forEach(dep => {
      const depAssignee = teamMembers.find(m => m.id === dep.assignedTo);
      if (depAssignee && depAssignee.telegramChatId) {
        const linkMsg = task.link ? `\n\nMaterial: ${task.link}` : '';
        window.api.sendTelegramMessage(depAssignee.telegramChatId,
          `*${task.assignedToName || 'Un miembro'}* termino: ${task.text}\n\nYa puedes empezar tu tarea:\n*${dep.text}*\nProyecto: *${dep.projectName}*${linkMsg}`
        );
      }
    });
  }
}

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
      window.api.sendTelegramMessage(assignee.telegramChatId,
        `Tu tarea fue *rechazada* por *${currentUserData.name}* y volvio a pendientes:\n${task.text}`
      );
    }
  }
}

// Edit task modal
let editingTaskId = null;
const editModal = document.getElementById('editModal');
const editTaskInput = document.getElementById('editTaskInput');

document.getElementById('cancelEdit').addEventListener('click', () => {
  editModal.classList.remove('active');
  editingTaskId = null;
});

document.getElementById('confirmEdit').addEventListener('click', async () => {
  const newText = editTaskInput.value.trim();
  if (editingTaskId && newText) {
    await db.collection('tasks').doc(editingTaskId).update({ text: newText });
  }
  editModal.classList.remove('active');
  editingTaskId = null;
});

editTaskInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmEdit').click();
});

editModal.addEventListener('click', (e) => {
  if (e.target === editModal) { editModal.classList.remove('active'); editingTaskId = null; }
});

async function editTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !canEdit(task)) return;
  editingTaskId = taskId;
  editTaskInput.value = task.text;
  editModal.classList.add('active');
  setTimeout(() => editTaskInput.focus(), 100);
}

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

async function deleteTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (task && !canDelete(task)) return;
  await db.collection('tasks').doc(taskId).delete();
}

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

    if (assignee.telegramChatId && assignee.id !== currentUser.uid) {
      const depMsg = previousText ? `\nEn espera de *${previousAssigneeName}*: ${previousText}` : '';
      const dlMsg = step.deadlineDate ? `\nPlazo: *${step.deadlineDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}*` : '';
      window.api.sendTelegramMessage(assignee.telegramChatId,
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
    editModal.classList.remove('active');
    noteModal.classList.remove('active');
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

  if (assignee.telegramChatId && assignee.id !== currentUser.uid) {
    const depMsg = dependsOnTaskId ? `\nEn espera de *${dependsOnAssigneeName || 'otro'}*: ${dependsOnTaskText || ''}` : '';
    const dlMsg = dl ? `\nPlazo: *${dl.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}*` : '';
    window.api.sendTelegramMessage(assignee.telegramChatId,
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
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const dl = parseDeadlineIso(deadline_iso);
  if (dl) data.deadline = firebase.firestore.Timestamp.fromDate(dl);
  await db.collection('personalTasks').add(data);
  return `✓ Tarea personal creada: ${task_text}${deadlineLabel(dl)}`;
}

function showAIResult(text, type = 'info') {
  const out = document.getElementById('aiResult');
  if (!out) return;
  out.style.display = 'block';
  out.textContent = text;
  out.style.color = type === 'error' ? '#ff6b6b' : type === 'success' ? '#4ecdc4' : 'var(--text-secondary)';
}

async function aiDispatch(text) {
  showAIResult('Pensando...', 'info');

  const myTasks = tasks.filter(t => t.assignedTo === currentUser.uid && t.status === 'pending');
  const myTasksContext = myTasks.length
    ? myTasks.map((t, i) => `${i + 1}. [${t.projectName}] ${t.text}`).join('\n')
    : '(ninguna)';

  const now = new Date();
  const isoNow = now.toISOString();
  const humanNow = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const systemPrompt = `Eres un asistente de gestion de tareas en una app de equipo. Interpreta el mensaje del usuario y ejecuta la accion correcta usando las tools.

Fecha y hora actual: ${humanNow} (${isoNow})

Usuario actual: ${currentUserData.name} (${currentUserData.email})

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
    if (assignee && assignee.telegramChatId && assignTo !== currentUser.uid) {
      window.api.sendTelegramMessage(assignee.telegramChatId,
        `Nueva tarea asignada por *${currentUserData.name}* para *${deadline.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}*:\n${text}\nProyecto: *${project.name}*`);
    }
  }
  document.getElementById('calendarTaskModal').classList.remove('active');
});
