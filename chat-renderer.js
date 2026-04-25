// ===== STATE =====
let currentUser = null;
let currentUserData = null;
let teamMembers = [];
let chatMessages = [];
let unsubscribers = [];
let presenceRefreshTimer = null;

const ONLINE_THRESHOLD_MS = 90 * 1000;
const PRESENCE_REFRESH_MS = 30 * 1000;

const userColors = [
  '#FF4757', '#1E90FF', '#2ED573', '#FFA502', '#BE2EDD',
  '#FFD93D', '#00D2D3', '#FF6348', '#70A1FF', '#EE5A6F'
];

function esc(text) {
  if (text == null) return '';
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function getUserColor(userId) {
  if (!userId) return userColors[0];
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return userColors[h % userColors.length];
}

function isOnline(member) {
  if (!member || !member.lastSeen) return false;
  const last = member.lastSeen.toDate ? member.lastSeen.toDate().getTime() : new Date(member.lastSeen).getTime();
  return (Date.now() - last) < ONLINE_THRESHOLD_MS;
}

function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return new Date(ts);
}

function formatTime(ts) {
  const d = tsToDate(ts);
  if (!d) return '';
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function dayLabel(date) {
  if (!date) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ===== MEMBERS =====
function renderMembers() {
  const container = document.getElementById('membersList');
  if (!container) return;
  if (!teamMembers.length) {
    container.innerHTML = '<div style="font-size:11px;color:var(--text-secondary);padding:8px;text-align:center">Sin miembros</div>';
    return;
  }
  const sorted = [...teamMembers].sort((a, b) => {
    if (currentUser && a.id === currentUser.uid) return -1;
    if (currentUser && b.id === currentUser.uid) return 1;
    const ao = isOnline(a) ? 0 : 1;
    const bo = isOnline(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (a.name || '').localeCompare(b.name || '');
  });
  let html = '';
  sorted.forEach(m => {
    const color = getUserColor(m.id);
    const online = isOnline(m);
    const isMe = currentUser && m.id === currentUser.uid;
    const initial = (m.name || '?').charAt(0).toUpperCase();
    const titleTxt = online ? 'En linea' : 'Desconectado';
    html += `
      <div class="member-item" title="${esc(m.name)} - ${titleTxt}">
        <div class="member-avatar" style="background:${color}">${initial}<span class="online-dot${online ? '' : ' offline'}"></span></div>
        <span class="member-name${online ? '' : ' offline'}">${esc(m.name || '')}${isMe ? ' (tu)' : ''}</span>
      </div>`;
  });
  container.innerHTML = html;
}

// ===== MESSAGES =====
const renderedIds = new Set();
let lastDayKey = null;

function messageHtml(m) {
  const own = currentUser && m.authorId === currentUser.uid;
  const color = getUserColor(m.authorId);
  const initial = (m.authorName || '?').charAt(0).toUpperCase();
  const time = formatTime(m.createdAt);
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

function renderMessages() {
  const container = document.getElementById('messagesArea');
  if (!container) return;
  if (!chatMessages.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128172;</div>
        <div class="empty-state-text">Sin mensajes todavia</div>
        <div class="empty-state-sub">Se el primero en escribir</div>
      </div>`;
    renderedIds.clear();
    lastDayKey = null;
    return;
  }
  const newOnes = chatMessages.filter(m => !renderedIds.has(m.id));
  const existing = chatMessages.filter(m => renderedIds.has(m.id));
  const allExistingStillThere = existing.length === renderedIds.size;
  if (renderedIds.size > 0 && newOnes.length > 0 && allExistingStillThere) {
    let html = '';
    newOnes.forEach(m => {
      const d = tsToDate(m.createdAt);
      const key = d ? d.toDateString() : 'pending';
      if (key !== lastDayKey) {
        html += `<div class="chat-day-divider">${d ? dayLabel(d) : 'Enviando...'}</div>`;
        lastDayKey = key;
      }
      html += messageHtml(m);
      renderedIds.add(m.id);
    });
    container.insertAdjacentHTML('beforeend', html);
    container.scrollTop = container.scrollHeight;
    return;
  }
  renderedIds.clear();
  lastDayKey = null;
  let html = '';
  chatMessages.forEach(m => {
    const d = tsToDate(m.createdAt);
    const key = d ? d.toDateString() : 'pending';
    if (key !== lastDayKey) {
      html += `<div class="chat-day-divider">${d ? dayLabel(d) : 'Enviando...'}</div>`;
      lastDayKey = key;
    }
    html += messageHtml(m);
    renderedIds.add(m.id);
  });
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

async function markChatAsRead() {
  if (!currentUser) return;
  try {
    await db.collection('users').doc(currentUser.uid).update({
      chatLastReadAt: firebase.firestore.Timestamp.now()
    });
  } catch (e) { /* ignore */ }
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await db.collection('chatMessages').add({
      text,
      authorId: currentUser.uid,
      authorName: currentUserData.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error('Error enviando chat:', e);
    input.value = text;
  }
}

// ===== SUBSCRIPTIONS =====
function subscribeAll() {
  unsubscribers.forEach(fn => { try { fn(); } catch (e) {} });
  unsubscribers = [];

  // Users
  const unsubUsers = db.collection('users').onSnapshot((snap) => {
    teamMembers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderMembers();
  });
  unsubscribers.push(unsubUsers);

  // Chat messages
  const unsubChat = db.collection('chatMessages')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .onSnapshot((snap) => {
      chatMessages = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse();
      renderMessages();
      markChatAsRead();
    });
  unsubscribers.push(unsubChat);
}

// ===== AUTH =====
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    document.getElementById('messagesArea').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128274;</div>
        <div class="empty-state-text">No has iniciado sesion</div>
        <div class="empty-state-sub">Inicia sesion en la app principal y vuelve a abrir el chat</div>
      </div>`;
    return;
  }
  currentUser = user;
  currentUserData = { id: user.uid, name: user.email.split('@')[0], email: user.email };
  // Fetch user doc para obtener nombre real
  try {
    const doc = await db.collection('users').doc(user.uid).get();
    if (doc.exists) {
      currentUserData = { id: user.uid, ...doc.data() };
    }
  } catch (e) { /* ignore */ }
  subscribeAll();
  // Re-render miembros cada 30s para reflejar transicion a offline
  if (presenceRefreshTimer) clearInterval(presenceRefreshTimer);
  presenceRefreshTimer = setInterval(() => {
    try { renderMembers(); } catch (e) {}
  }, PRESENCE_REFRESH_MS);
});

// ===== UI WIRING =====
document.getElementById('chatSendBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
document.getElementById('btnMinimize').addEventListener('click', () => {
  if (window.api && window.api.minimizeWindow) window.api.minimizeWindow();
});
document.getElementById('btnClose').addEventListener('click', () => {
  if (window.api && window.api.closeWindow) window.api.closeWindow();
});

// Cleanup timers if window is closed
window.addEventListener('beforeunload', () => {
  if (presenceRefreshTimer) clearInterval(presenceRefreshTimer);
  unsubscribers.forEach(fn => { try { fn(); } catch (e) {} });
});
