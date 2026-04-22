// ===== STATE =====
let currentUser = null;
let currentUserData = null;
let tasks = [];
let projects = [];
let teamMembers = [];
let alwaysOnTop = true;
let currentTab = 'main';
let unsubscribeTasks = null;
let unsubscribeProjects = null;
let unsubscribeUsers = null;

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
  addTaskBtn: document.getElementById('addTaskBtn'),
  mainBadge: document.getElementById('mainBadge'),
  myBadge: document.getElementById('myBadge'),
  inputArea: document.getElementById('inputArea'),
  telegramToken: document.getElementById('telegramToken'),
  saveTelegram: document.getElementById('saveTelegram'),
  telegramStatus: document.getElementById('telegramStatus'),
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
      // Auto-set first admin
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
}

function showLogin() {
  el.loginScreen.classList.remove('hidden');
  el.appContainer.classList.remove('active');
  if (unsubscribeTasks) unsubscribeTasks();
  if (unsubscribeProjects) unsubscribeProjects();
  if (unsubscribeUsers) unsubscribeUsers();
}

el.logoutBtn.addEventListener('click', () => auth.signOut());

// ===== FIRESTORE REAL-TIME =====
function subscribeToData() {
  // Listen to tasks
  unsubscribeTasks = db.collection('tasks').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
    tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderAll();
  });

  // Listen to projects
  unsubscribeProjects = db.collection('projects').orderBy('name').onSnapshot((snapshot) => {
    projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderProjectSelect();
    renderProjectList();
  });

  // Listen to team members
  unsubscribeUsers = db.collection('users').onSnapshot((snapshot) => {
    teamMembers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderAssignSelect();
    renderTeam();
  });
}

// ===== RENDER =====
function renderAll() {
  const pending = tasks.filter(t => t.status !== 'completed');
  const completed = tasks.filter(t => t.status === 'completed');
  const myTasks = pending.filter(t => t.assignedTo === currentUser.uid);

  el.mainBadge.textContent = pending.length;
  el.myBadge.textContent = myTasks.length;

  renderTaskList(el.taskList, pending, false);
  renderTaskList(el.myTaskList, myTasks, false);
  renderTaskList(el.completedList, completed.slice(0, 50), true);
}

function renderTaskList(container, taskList, isCompleted) {
  if (taskList.length === 0) {
    const icon = isCompleted ? '&#127881;' : '&#128221;';
    const text = isCompleted ? 'No hay tareas completadas aun' : 'No hay tareas pendientes';
    const sub = isCompleted ? '' : 'Agrega una tarea o esperala desde Telegram';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icon}</div>
        <div class="empty-state-text">${text}</div>
        <div class="empty-state-sub">${sub}</div>
      </div>`;
    return;
  }

  // Group by project
  const grouped = {};
  taskList.forEach(task => {
    const key = task.projectId || 'sin-proyecto';
    if (!grouped[key]) {
      grouped[key] = {
        name: task.projectName || 'Sin Proyecto',
        color: task.projectColor || '#666',
        tasks: []
      };
    }
    grouped[key].tasks.push(task);
  });

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
      const time = task.status === 'completed' && task.completedAt
        ? formatDate(task.completedAt)
        : timeAgo(task.createdAt);

      html += `
        <div class="task-item ${isCompleted ? 'completed' : ''}" data-id="${task.id}" style="border-left-color:${group.color}">
          ${isCompleted ? '<div class="task-check"></div>' : `<div class="task-check" onclick="completeTask('${task.id}')" title="Completar"></div>`}
          <div style="flex:1">
            <div class="task-text">${esc(task.text)}</div>
            <div class="task-meta">
              <span class="task-assignee">${esc(assignee)}</span>
              <span class="task-tag">${source}</span>
              <span class="task-tag">${time}</span>
            </div>
          </div>
          ${!isCompleted && canDelete(task) ? `<button class="task-delete" onclick="deleteTask('${task.id}')" title="Eliminar">&#10005;</button>` : ''}
        </div>`;
    });

    html += '</div>';
  }

  container.innerHTML = html;
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

  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#DDA0DD', '#BB8FCE', '#F0B27A'];
  let html = '';
  teamMembers.forEach((m, i) => {
    const pending = tasks.filter(t => t.assignedTo === m.id && t.status !== 'completed').length;
    const done = tasks.filter(t => t.assignedTo === m.id && t.status === 'completed').length;
    const color = colors[i % colors.length];
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
          <div class="team-tasks">${pending} pendientes - ${done} completadas ${roleBtn}</div>
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

  if (!text) { el.taskInput.focus(); return; }
  if (!projectId) {
    el.projectSelect.style.borderColor = 'var(--danger)';
    setTimeout(() => el.projectSelect.style.borderColor = '', 1500);
    return;
  }

  const project = projects.find(p => p.id === projectId);
  const assignee = teamMembers.find(m => m.id === assignTo);

  await db.collection('tasks').add({
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
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  el.taskInput.value = '';

  // Notify via Telegram
  if (assignee && assignee.telegramChatId && assignTo !== currentUser.uid) {
    window.api.sendTelegramMessage(assignee.telegramChatId,
      `Nueva tarea asignada por *${currentUserData.name}*:\n${text}\nProyecto: *${project.name}*`
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
    status: 'completed',
    completedAt: firebase.firestore.FieldValue.serverTimestamp(),
    completedBy: currentUser.uid,
    completedByName: currentUserData.name
  });

  // Notify team via Telegram
  if (task) {
    const chatIds = teamMembers
      .filter(m => m.telegramChatId && m.id !== currentUser.uid)
      .map(m => m.telegramChatId);

    if (chatIds.length > 0) {
      window.api.notifyAllTelegram(chatIds,
        `Tarea completada por *${currentUserData.name}*:\n${task.text}`
      );
    }
  }
}

async function toggleRole(userId, currentRole) {
  const newRole = currentRole === 'admin' ? 'miembro' : 'admin';
  await db.collection('users').doc(userId).update({ role: newRole });
}

function canDelete(task) {
  if (!currentUserData) return false;
  // Admin puede eliminar cualquier tarea
  if (currentUserData.role === 'admin') return true;
  // El creador de la tarea puede eliminarla
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

  // Delete project and its tasks
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
function initTelegramHandlers() {
  window.api.onTelegramLinkUser(async ({ chatId, email }) => {
    const snapshot = await db.collection('users').where('email', '==', email).get();
    if (!snapshot.empty) {
      const userDoc = snapshot.docs[0];
      await db.collection('users').doc(userDoc.id).update({ telegramChatId: chatId });
      window.api.sendTelegramMessage(chatId, `Cuenta vinculada a *${userDoc.data().name}*`);
    } else {
      window.api.sendTelegramMessage(chatId, 'Email no encontrado. Registrate primero en la app.');
    }
  });

  window.api.onTelegramAddTask(async ({ chatId, projectName, taskText }) => {
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
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    window.api.sendTelegramMessage(chatId, `Tarea agregada a *${project.name}*:\n${taskText}`);
  });

  window.api.onTelegramAssignTask(async ({ chatId, projectName, taskText, assignToEmail }) => {
    const sender = teamMembers.find(m => m.telegramChatId === chatId);
    if (!sender) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }

    const assignee = teamMembers.find(m => m.email === assignToEmail);
    if (!assignee) { window.api.sendTelegramMessage(chatId, `Usuario *${assignToEmail}* no encontrado.`); return; }

    let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
    if (!project) {
      const ref = await db.collection('projects').add({
        name: projectName,
        color: '#45B7D1',
        createdBy: sender.id,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      project = { id: ref.id, name: projectName, color: '#45B7D1' };
    }

    await db.collection('tasks').add({
      text: taskText,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color || '#45B7D1',
      assignedTo: assignee.id,
      assignedToName: assignee.name,
      createdBy: sender.id,
      createdByName: sender.name,
      status: 'pending',
      source: 'telegram',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    window.api.sendTelegramMessage(chatId, `Tarea asignada a *${assignee.name}*:\n${taskText}`);
    if (assignee.telegramChatId) {
      window.api.sendTelegramMessage(assignee.telegramChatId, `*${sender.name}* te asigno una tarea:\n${taskText}\nProyecto: *${project.name}*`);
    }
  });

  window.api.onTelegramGetMyTasks(async ({ chatId }) => {
    const user = teamMembers.find(m => m.telegramChatId === chatId);
    if (!user) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }

    const myTasks = tasks.filter(t => t.assignedTo === user.id && t.status !== 'completed');
    if (myTasks.length === 0) {
      window.api.sendTelegramMessage(chatId, 'No tienes tareas pendientes.');
      return;
    }

    let msg = `*Tus tareas (${myTasks.length}):*\n\n`;
    myTasks.forEach((t, i) => { msg += `${i + 1}. ${t.text} (${t.projectName})\n`; });
    window.api.sendTelegramMessage(chatId, msg);
  });

  window.api.onTelegramGetAllTasks(async ({ chatId }) => {
    const pending = tasks.filter(t => t.status !== 'completed');
    if (pending.length === 0) {
      window.api.sendTelegramMessage(chatId, 'No hay tareas pendientes en el equipo.');
      return;
    }

    let msg = `*Todas las tareas (${pending.length}):*\n\n`;
    pending.forEach((t, i) => { msg += `${i + 1}. ${t.text} -> ${t.assignedToName} (${t.projectName})\n`; });
    window.api.sendTelegramMessage(chatId, msg);
  });

  window.api.onTelegramCompleteTask(async ({ chatId, taskIndex }) => {
    const user = teamMembers.find(m => m.telegramChatId === chatId);
    if (!user) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }

    const myTasks = tasks.filter(t => t.assignedTo === user.id && t.status !== 'completed');
    const idx = taskIndex - 1;

    if (idx < 0 || idx >= myTasks.length) {
      window.api.sendTelegramMessage(chatId, 'Numero de tarea no valido. Usa /tareas para ver la lista.');
      return;
    }

    const task = myTasks[idx];
    await db.collection('tasks').doc(task.id).update({
      status: 'completed',
      completedAt: firebase.firestore.FieldValue.serverTimestamp(),
      completedBy: user.id,
      completedByName: user.name
    });

    window.api.sendTelegramMessage(chatId, `Tarea completada: *${task.text}*`);
  });

  window.api.onTelegramGetProjects(async ({ chatId }) => {
    if (projects.length === 0) {
      window.api.sendTelegramMessage(chatId, 'No hay proyectos.');
      return;
    }

    let msg = '*Proyectos:*\n\n';
    projects.forEach(p => {
      const count = tasks.filter(t => t.projectId === p.id && t.status !== 'completed').length;
      msg += `*${p.name}* - ${count} tarea(s)\n`;
    });
    window.api.sendTelegramMessage(chatId, msg);
  });

  window.api.onTelegramGetTeam(async ({ chatId }) => {
    if (teamMembers.length === 0) {
      window.api.sendTelegramMessage(chatId, 'No hay miembros.');
      return;
    }

    let msg = '*Equipo:*\n\n';
    teamMembers.forEach(m => {
      const pending = tasks.filter(t => t.assignedTo === m.id && t.status !== 'completed').length;
      const tg = m.telegramChatId ? 'vinculado' : 'sin vincular';
      msg += `*${m.name}* (${m.email}) - ${pending} tareas - TG: ${tg}\n`;
    });
    window.api.sendTelegramMessage(chatId, msg);
  });
}

// ===== TELEGRAM SETTINGS =====
async function loadTelegramToken() {
  const token = await window.api.getTelegramToken();
  if (token) {
    el.telegramToken.value = token;
    updateTelegramStatus(true);
  }
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

// ===== UI EVENTS =====
el.addTaskBtn.addEventListener('click', addTask);
el.taskInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addTask(); });

// Tab navigation
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;

    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const tabContent = document.getElementById('tab' + capitalize(currentTab));
    if (tabContent) tabContent.classList.add('active');

    const showInput = (currentTab === 'main' || currentTab === 'my-tasks');
    el.inputArea.style.display = showInput ? 'block' : 'none';
  });
});

function capitalize(str) {
  return str.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

// Project modal
function showProjectModal() {
  el.projectModal.classList.add('active');
  el.projectNameInput.value = '';
  setTimeout(() => el.projectNameInput.focus(), 100);
}

function hideProjectModal() {
  el.projectModal.classList.remove('active');
}

el.newProjectBtn.addEventListener('click', showProjectModal);
el.quickProjectBtn.addEventListener('click', showProjectModal);
el.confirmProject.addEventListener('click', createProject);
el.cancelProject.addEventListener('click', hideProjectModal);
el.projectNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') createProject(); });
el.projectModal.addEventListener('click', (e) => { if (e.target === el.projectModal) hideProjectModal(); });

// Clear completed
el.clearAllCompleted.addEventListener('click', async () => {
  const completed = tasks.filter(t => t.status === 'completed');
  if (completed.length === 0) return;

  const batch = db.batch();
  completed.forEach(t => batch.delete(db.collection('tasks').doc(t.id)));
  await batch.commit();
});

// Window controls
el.btnPin.addEventListener('click', async () => {
  alwaysOnTop = await window.api.toggleAlwaysOnTop();
  el.btnPin.classList.toggle('unpinned', !alwaysOnTop);
  el.btnPin.title = alwaysOnTop ? 'Fijada (click para desfijar)' : 'No fijada (click para fijar)';
});

el.btnMinimize.addEventListener('click', () => window.api.minimizeWindow());
el.btnClose.addEventListener('click', () => window.api.closeWindow());

// Init pin state
window.api.getAlwaysOnTop().then(v => {
  alwaysOnTop = v;
  el.btnPin.classList.toggle('unpinned', !v);
});

// Escape closes modal
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideProjectModal(); });

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

// Show version in settings
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
