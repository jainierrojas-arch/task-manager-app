// ===== STATE =====
let currentUser = null;
let currentUserData = null;
let teamMembers = [];
let chatMessages = [];        // mensajes del chat general
let allDmMessages = [];       // TODOS los DMs en los que participo (de cualquier conversacion)
let unsubscribers = [];
let presenceRefreshTimer = null;
let chatNotificationsArmed = false; // skip sonido en la primera carga (general)
let dmNotificationsArmed = false;   // skip sonido en la primera carga (DM)
let currentDmTargetId = null; // null = chat general, sino UID del destinatario
// IDs de DM ya leidos (para badges de no-leidos por miembro). Se persiste en
// localStorage para que la cuenta sobreviva recargas.
let dmReadStateBySender = {};
try { dmReadStateBySender = JSON.parse(localStorage.getItem('chat-dm-read-state') || '{}'); } catch (e) {}
function saveDmReadState() {
  try { localStorage.setItem('chat-dm-read-state', JSON.stringify(dmReadStateBySender)); } catch (e) {}
}
// Construye participantIds canonico [a,b] ordenado para la conversacion
function dmParticipantIds(uidA, uidB) {
  return [uidA, uidB].sort();
}

const ONLINE_THRESHOLD_MS = 90 * 1000;
const PRESENCE_REFRESH_MS = 30 * 1000;

// Reproduce un "ding" suave de 2 notas con Web Audio API (sin archivos externos)
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, startOffset, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    };
    playTone(880, 0, 0.18);    // A5
    playTone(1175, 0.10, 0.22); // D6 (perfect fourth) — efecto "ding ding" alegre
  } catch (e) { /* audio context puede no estar disponible, ignorar */ }
}

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
    const isActive = currentDmTargetId === m.id ? ' active' : '';
    const unread = isMe ? 0 : countUnreadDmsFrom(m.id);
    const unreadBadge = unread > 0 ? `<span class="member-unread">${unread > 99 ? '99+' : unread}</span>` : '';
    const clickAttr = isMe ? '' : `data-dm-target="${esc(m.id)}"`;
    const hint = isMe ? '' : ' (click para abrir DM)';
    html += `
      <div class="member-item${isActive}" ${clickAttr} title="${esc(m.name)} - ${titleTxt}${hint}">
        <div class="member-avatar" style="background:${color}">${initial}<span class="online-dot${online ? '' : ' offline'}"></span></div>
        <span class="member-name${online ? '' : ' offline'}">${esc(m.name || '')}${isMe ? ' (tu)' : ''}</span>
        ${unreadBadge}
      </div>`;
  });
  container.innerHTML = html;
  // Click para abrir DM
  container.querySelectorAll('[data-dm-target]').forEach(el => {
    el.addEventListener('click', () => openDm(el.dataset.dmTarget));
  });
}

// Cuenta DMs recibidos de un usuario que aun no fueron leidos por mi
function countUnreadDmsFrom(senderId) {
  if (!currentUser) return 0;
  const lastReadMs = dmReadStateBySender[senderId] || 0;
  return allDmMessages.filter(m => {
    if (m.authorId !== senderId) return false;
    if (m.recipientId !== currentUser.uid) return false;
    const ms = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().getTime() : 0;
    return ms > lastReadMs;
  }).length;
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

// Devuelve los mensajes a renderizar segun el modo actual (general o DM)
function getActiveMessages() {
  if (!currentDmTargetId) return chatMessages;
  if (!currentUser) return [];
  return allDmMessages.filter(m => {
    return (m.authorId === currentUser.uid && m.recipientId === currentDmTargetId) ||
           (m.authorId === currentDmTargetId && m.recipientId === currentUser.uid);
  });
}

function openDm(targetId) {
  if (!targetId || targetId === currentUser?.uid) return;
  currentDmTargetId = targetId;
  // Marcar todos los DMs recibidos de este usuario como leidos
  dmReadStateBySender[targetId] = Date.now();
  saveDmReadState();
  // Actualizar UI
  updateChatModeBar();
  renderedIds.clear();
  lastDayKey = null;
  renderMessages();
  renderMembers();
  document.getElementById('chatInput').focus();
}

function returnToGeneralChat() {
  currentDmTargetId = null;
  updateChatModeBar();
  renderedIds.clear();
  lastDayKey = null;
  renderMessages();
  renderMembers();
}

function updateChatModeBar() {
  const bar = document.getElementById('chatModeBar');
  const title = document.getElementById('chatModeTitle');
  if (!bar || !title) return;
  if (currentDmTargetId) {
    const member = teamMembers.find(m => m.id === currentDmTargetId);
    const name = member ? member.name : 'Usuario';
    bar.classList.add('dm');
    title.innerHTML = `&#128172; Privado con <span class="dm-target">${esc(name)}</span>`;
  } else {
    bar.classList.remove('dm');
    title.innerHTML = '&#128172; Chat general del equipo';
  }
}

function renderMessages() {
  const container = document.getElementById('messagesArea');
  if (!container) return;
  const activeMessages = getActiveMessages();
  if (!activeMessages.length) {
    const emptySub = currentDmTargetId
      ? 'Escribe el primer mensaje privado'
      : 'Se el primero en escribir';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128172;</div>
        <div class="empty-state-text">Sin mensajes todavia</div>
        <div class="empty-state-sub">${emptySub}</div>
      </div>`;
    renderedIds.clear();
    lastDayKey = null;
    return;
  }
  const newOnes = activeMessages.filter(m => !renderedIds.has(m.id));
  const existing = activeMessages.filter(m => renderedIds.has(m.id));
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
  activeMessages.forEach(m => {
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
    if (currentDmTargetId) {
      // Mensaje privado
      const targetMember = teamMembers.find(m => m.id === currentDmTargetId);
      await db.collection('directMessages').add({
        text,
        authorId: currentUser.uid,
        authorName: currentUserData.name,
        recipientId: currentDmTargetId,
        recipientName: targetMember ? targetMember.name : 'Usuario',
        participantIds: dmParticipantIds(currentUser.uid, currentDmTargetId),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Chat general
      await db.collection('chatMessages').add({
        text,
        authorId: currentUser.uid,
        authorName: currentUserData.name,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
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

  // Chat messages — chat general
  const unsubChat = db.collection('chatMessages')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .onSnapshot((snap) => {
      const newList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse();
      if (chatNotificationsArmed) {
        const previousIds = new Set(chatMessages.map(m => m.id));
        const newOnes = newList.filter(m => !previousIds.has(m.id));
        const fromOthers = newOnes.filter(m => m.authorId !== currentUser.uid);
        if (fromOthers.length > 0) playNotificationSound();
      }
      chatMessages = newList;
      chatNotificationsArmed = true;
      if (!currentDmTargetId) renderMessages();
      markChatAsRead();
    });
  unsubscribers.push(unsubChat);

  // Direct messages — mensajes privados (todos los DMs en los que participo).
  // NOTA: array-contains + orderBy requiere indice compuesto en Firestore. Para
  // evitar tener que crearlo manualmente, ordenamos del lado del cliente.
  const unsubDm = db.collection('directMessages')
    .where('participantIds', 'array-contains', currentUser.uid)
    .limit(500)
    .onSnapshot((snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Ordenar ascendente por createdAt (mensajes pendientes sin timestamp van al final)
      docs.sort((a, b) => {
        const aMs = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : Number.MAX_SAFE_INTEGER;
        const bMs = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : Number.MAX_SAFE_INTEGER;
        return aMs - bMs;
      });
      const newList = docs;
      if (dmNotificationsArmed) {
        const previousIds = new Set(allDmMessages.map(m => m.id));
        const newOnes = newList.filter(m => !previousIds.has(m.id));
        const fromOthers = newOnes.filter(m => m.authorId !== currentUser.uid);
        if (fromOthers.length > 0) playNotificationSound();
      }
      allDmMessages = newList;
      dmNotificationsArmed = true;
      // Si estoy viendo un DM con el remitente, marcar como leido
      if (currentDmTargetId) {
        dmReadStateBySender[currentDmTargetId] = Date.now();
        saveDmReadState();
        renderMessages();
      }
      renderMembers(); // re-renderiza badges de no-leidos
    }, (err) => {
      console.error('Error suscribiendo a DMs:', err);
    });
  unsubscribers.push(unsubDm);
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
const backBtn = document.getElementById('backToGeneralBtn');
if (backBtn) backBtn.addEventListener('click', returnToGeneralChat);

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

const MEETING_ROOM_URL = 'https://meet.google.com/gbv-prvk-mfn';
document.getElementById('btnMeetingRoom').addEventListener('click', () => {
  if (window.api && window.api.openExternal) {
    window.api.openExternal(MEETING_ROOM_URL);
  } else {
    window.open(MEETING_ROOM_URL, '_blank');
  }
});

// Cleanup timers if window is closed
window.addEventListener('beforeunload', () => {
  if (presenceRefreshTimer) clearInterval(presenceRefreshTimer);
  unsubscribers.forEach(fn => { try { fn(); } catch (e) {} });
});
