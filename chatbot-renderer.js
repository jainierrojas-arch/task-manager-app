// Bot IA — Chatbot Conversaciones (Fase 1)
// Layout estilo Monetízalo OS: lista negocios | lista leads | chat | profile del lead.
// Fase 1: CRUD manual de leads y mensajes. Sin IA real. Sirve como base.
// Fase 2: integrar Groq/Claude para que el bot responda solo.
// Fase 3: webhook real de IG (Cloudflare Worker + ManyChat o Meta Graph).

const _params = new URLSearchParams(location.search);
const WS_ID = _params.get('workspace') || null;
let currentUser = null;
let businesses = [];
let selectedBusinessId = null;
let leads = [];
let selectedLeadId = null;
let messages = [];
let unsubBiz = null;
let unsubLeads = null;
let unsubMessages = null;

const FUNNEL_STAGES = ['bienvenida', 'calificacion', 'propuesta', 'agendado', 'cerrado', 'perdido'];
const FUNNEL_LABELS = {
  bienvenida: 'Bienvenida',
  calificacion: 'Calificación',
  propuesta: 'Propuesta',
  agendado: 'Agendado',
  cerrado: 'Cerrado',
  perdido: 'Perdido'
};

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== AUTH =====
auth.onAuthStateChanged(u => {
  currentUser = u;
  if (u) wireup();
});

function wireup() {
  setupSubtabs();
  subscribeBusinesses();
  document.getElementById('cbAddBusiness').addEventListener('click', addBusiness);
  document.getElementById('cbAddLead').addEventListener('click', addLead);
  document.getElementById('cbSendBtn').addEventListener('click', sendMessage);
  document.getElementById('cbInputMsg').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendMessage();
  });
  document.getElementById('cbConfigSave').addEventListener('click', saveConfig);
  loadConfig();
}

function setupSubtabs() {
  document.querySelectorAll('.cb-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cb-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.cbTab;
      ['conversaciones', 'analitica', 'config'].forEach(t => {
        const el = document.getElementById('cbView-' + t);
        if (el) el.style.display = (t === tab) ? '' : 'none';
      });
    });
  });
}

// ===== BUSINESSES =====
function subscribeBusinesses() {
  if (unsubBiz) { try { unsubBiz(); } catch (e) {} unsubBiz = null; }
  let q = db.collection('chatbotBusinesses');
  if (WS_ID) q = q.where('workspaceId', '==', WS_ID);
  unsubBiz = q.onSnapshot(snap => {
    businesses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBusinesses();
    if (!selectedBusinessId && businesses.length > 0) {
      selectBusiness(businesses[0].id);
    }
  }, err => console.error('[chatbot] businesses error:', err));
}

function renderBusinesses() {
  const el = document.getElementById('cbBusinessList');
  if (!el) return;
  if (businesses.length === 0) {
    el.innerHTML = '<div style="color: var(--text-secondary); font-size: 11px; text-align: center; padding: 14px 8px">Sin negocios. Creá el primero ↑</div>';
    return;
  }
  el.innerHTML = businesses.map(b => `
    <div class="cb-biz-item ${selectedBusinessId === b.id ? 'active' : ''}" data-biz-id="${esc(b.id)}">
      <div class="cb-biz-emoji">${esc(b.emoji || '✨')}</div>
      <div class="cb-biz-info">
        <div class="cb-biz-name">${esc(b.name)}</div>
        <div class="cb-biz-stats">${b._leadCount || 0} leads · ${b._agendados || 0} citas</div>
      </div>
    </div>
  `).join('');
  el.querySelectorAll('[data-biz-id]').forEach(item => {
    item.addEventListener('click', () => selectBusiness(item.dataset.bizId));
  });
}

function selectBusiness(bizId) {
  selectedBusinessId = bizId;
  selectedLeadId = null;
  renderBusinesses();
  subscribeLeads();
  document.getElementById('cbChatHandle').textContent = 'Seleccioná un lead';
  document.getElementById('cbMessages').innerHTML = '<div class="cb-empty">Sin lead seleccionado.<br>Tocá uno de la lista o creá uno nuevo con "Simular lead".</div>';
  document.getElementById('cbInputBar').style.display = 'none';
  document.getElementById('cbProfile').innerHTML = '<div class="cb-empty">Sin info del lead.</div>';
}

async function addBusiness() {
  const name = prompt('Nombre del negocio bot:\n(Ej: "Monetízalo", "Mi Agencia", "Cliente X")');
  if (!name || !name.trim()) return;
  const emoji = prompt('Emoji para el negocio (1 caracter):', '✨') || '✨';
  try {
    const data = {
      name: name.trim(),
      emoji: emoji.trim().slice(0, 2),
      workspaceId: WS_ID,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: currentUser ? currentUser.uid : null
    };
    await db.collection('chatbotBusinesses').add(data);
  } catch (e) { alert('Error: ' + e.message); }
}

// ===== LEADS =====
function subscribeLeads() {
  if (unsubLeads) { try { unsubLeads(); } catch (e) {} unsubLeads = null; }
  if (!selectedBusinessId) { leads = []; renderLeads(); return; }
  unsubLeads = db.collection('chatbotLeads')
    .where('businessId', '==', selectedBusinessId)
    .onSnapshot(snap => {
      leads = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const at = (a.lastMessageAt && a.lastMessageAt.toMillis) ? a.lastMessageAt.toMillis() : 0;
          const bt = (b.lastMessageAt && b.lastMessageAt.toMillis) ? b.lastMessageAt.toMillis() : 0;
          return bt - at;
        });
      renderLeads();
    }, err => console.error('[chatbot] leads error:', err));
}

function renderLeads() {
  const el = document.getElementById('cbLeadsList');
  if (!el) return;
  if (leads.length === 0) {
    el.innerHTML = '<div style="color: var(--text-secondary); font-size: 11px; text-align: center; padding: 14px 8px">Sin leads. Creá uno con "Simular lead" ↑</div>';
    return;
  }
  el.innerHTML = leads.map(l => {
    const stage = l.funnelStage || 'bienvenida';
    return `
      <div class="cb-lead-item ${selectedLeadId === l.id ? 'active' : ''}" data-lead-id="${esc(l.id)}">
        <div class="cb-lead-head">
          <div class="cb-lead-handle">${esc(l.handle || l.displayName || 'lead')}</div>
          <div class="cb-stage-badge cb-stage-${stage}">${esc(FUNNEL_LABELS[stage] || stage)}</div>
        </div>
        <div class="cb-lead-preview">${esc(l.lastMessagePreview || 'Sin mensajes todavía')}</div>
      </div>
    `;
  }).join('');
  el.querySelectorAll('[data-lead-id]').forEach(item => {
    item.addEventListener('click', () => selectLead(item.dataset.leadId));
  });
}

function selectLead(leadId) {
  selectedLeadId = leadId;
  renderLeads();
  subscribeMessages();
  const lead = leads.find(l => l.id === leadId);
  if (lead) {
    document.getElementById('cbChatHandle').textContent = lead.handle || lead.displayName || 'lead';
    renderScoreDots(lead.score || 0);
    renderProfile(lead);
    document.getElementById('cbInputBar').style.display = '';
  }
}

function renderScoreDots(score) {
  const el = document.getElementById('cbChatScoreDots');
  if (!el) return;
  const dots = Math.round((score || 0) / 25); // 0-100 → 0-4 dots
  el.innerHTML = Array.from({length: 4}).map((_, i) =>
    `<div class="cb-score-dot ${i < dots ? 'filled' : ''}"></div>`
  ).join('');
}

function renderProfile(lead) {
  const el = document.getElementById('cbProfile');
  if (!el) return;
  const stage = lead.funnelStage || 'bienvenida';
  const score = lead.score || 0;
  el.innerHTML = `
    <div class="cb-profile-block">
      <h4>LEAD</h4>
      <div style="font-size: 15px; font-weight: 700; margin-bottom: 4px">${esc(lead.handle || lead.displayName)}</div>
      <div style="font-size: 12px; color: var(--text-secondary)">${esc(FUNNEL_LABELS[stage] || stage)}</div>
      <div style="font-size: 11px; color: var(--text-secondary); margin-top: 8px">Score: <strong>${score}%</strong></div>
      <div class="cb-score-bar"><div class="cb-score-fill" style="width: ${score}%"></div></div>
    </div>
    <div class="cb-profile-block">
      <h4>ACCIONES</h4>
      <button class="cb-action-btn primary" id="cbForceAgendado">📅 Forzar agendado</button>
      <button class="cb-action-btn" id="cbAdvanceStage">▶ Siguiente etapa</button>
      <button class="cb-action-btn" id="cbResetStage">↶ Reset</button>
      <button class="cb-action-btn" id="cbDeleteLead" style="color: #ff6b6b">🗑 Eliminar lead</button>
    </div>
    <div class="cb-profile-block">
      <h4>FUNNEL</h4>
      ${['bienvenida', 'calificacion', 'propuesta', 'agendado'].map(s => {
        const idx = FUNNEL_STAGES.indexOf(s);
        const curIdx = FUNNEL_STAGES.indexOf(stage);
        const done = curIdx >= idx;
        return `<div class="cb-funnel-step ${done ? 'done' : ''}">
          <span class="cb-funnel-check">${done ? '✓' : '○'}</span>
          <span class="cb-stage-badge cb-stage-${s}">${FUNNEL_LABELS[s]}</span>
        </div>`;
      }).join('')}
    </div>
    ${lead.dolor ? `<div class="cb-profile-block"><h4>DOLOR</h4><div style="font-size: 12px">${esc(lead.dolor)}</div></div>` : ''}
    ${lead.objecion ? `<div class="cb-profile-block"><h4>OBJECIÓN</h4><div style="font-size: 12px">${esc(lead.objecion)}</div></div>` : ''}
  `;
  document.getElementById('cbForceAgendado').addEventListener('click', () => updateLeadStage('agendado'));
  document.getElementById('cbAdvanceStage').addEventListener('click', advanceStage);
  document.getElementById('cbResetStage').addEventListener('click', () => updateLeadStage('bienvenida'));
  document.getElementById('cbDeleteLead').addEventListener('click', deleteLead);
}

async function addLead() {
  if (!selectedBusinessId) { alert('Elegí un negocio primero (o creá uno)'); return; }
  const handle = prompt('Handle del lead (sin @):\n(Ej: maria_coach, jorge_digital)');
  if (!handle || !handle.trim()) return;
  try {
    const data = {
      businessId: selectedBusinessId,
      workspaceId: WS_ID,
      handle: '@' + handle.trim().replace(/^@/, ''),
      displayName: handle.trim(),
      funnelStage: 'bienvenida',
      score: 0,
      canal: 'instagram',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessagePreview: ''
    };
    const ref = await db.collection('chatbotLeads').add(data);
    selectLead(ref.id);
  } catch (e) { alert('Error: ' + e.message); }
}

async function updateLeadStage(stage) {
  if (!selectedLeadId) return;
  try {
    await db.collection('chatbotLeads').doc(selectedLeadId).update({
      funnelStage: stage,
      ...(stage === 'agendado' ? { score: 100 } : {}),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { alert('Error: ' + e.message); }
}

async function advanceStage() {
  if (!selectedLeadId) return;
  const lead = leads.find(l => l.id === selectedLeadId);
  if (!lead) return;
  const curIdx = FUNNEL_STAGES.indexOf(lead.funnelStage || 'bienvenida');
  const next = FUNNEL_STAGES[Math.min(curIdx + 1, 3)];
  const newScore = Math.min(100, (lead.score || 0) + 25);
  try {
    await db.collection('chatbotLeads').doc(selectedLeadId).update({
      funnelStage: next,
      score: newScore,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { alert('Error: ' + e.message); }
}

async function deleteLead() {
  if (!selectedLeadId) return;
  if (!confirm('Eliminar este lead y todos sus mensajes?')) return;
  try {
    // Borrar mensajes primero
    const msgsSnap = await db.collection('chatbotMessages').where('leadId', '==', selectedLeadId).get();
    const batch = db.batch();
    msgsSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(db.collection('chatbotLeads').doc(selectedLeadId));
    await batch.commit();
    selectedLeadId = null;
    document.getElementById('cbChatHandle').textContent = 'Seleccioná un lead';
    document.getElementById('cbMessages').innerHTML = '<div class="cb-empty">Lead eliminado.</div>';
    document.getElementById('cbProfile').innerHTML = '<div class="cb-empty">Sin info del lead.</div>';
    document.getElementById('cbInputBar').style.display = 'none';
  } catch (e) { alert('Error: ' + e.message); }
}

// ===== MESSAGES =====
function subscribeMessages() {
  if (unsubMessages) { try { unsubMessages(); } catch (e) {} unsubMessages = null; }
  if (!selectedLeadId) { messages = []; renderMessages(); return; }
  unsubMessages = db.collection('chatbotMessages')
    .where('leadId', '==', selectedLeadId)
    .onSnapshot(snap => {
      messages = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const at = (a.timestamp && a.timestamp.toMillis) ? a.timestamp.toMillis() : 0;
          const bt = (b.timestamp && b.timestamp.toMillis) ? b.timestamp.toMillis() : 0;
          return at - bt;
        });
      renderMessages();
    }, err => console.error('[chatbot] messages error:', err));
}

function renderMessages() {
  const el = document.getElementById('cbMessages');
  if (!el) return;
  if (messages.length === 0) {
    el.innerHTML = '<div class="cb-empty">Sin mensajes. Escribí abajo para simular un mensaje del lead.</div>';
    return;
  }
  el.innerHTML = messages.map(m => {
    if (m.system) {
      return `<div class="cb-msg system">${esc(m.text)}</div>`;
    }
    const cls = m.fromLead ? 'from-lead' : 'from-bot';
    return `<div class="cb-msg ${cls}">${esc(m.text)}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function sendMessage() {
  if (!selectedLeadId) return;
  const input = document.getElementById('cbInputMsg');
  const text = (input.value || '').trim();
  if (!text) return;
  input.value = '';
  try {
    await db.collection('chatbotMessages').add({
      leadId: selectedLeadId,
      businessId: selectedBusinessId,
      workspaceId: WS_ID,
      text,
      fromLead: true, // simulamos un mensaje DEL lead
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chatbotLeads').doc(selectedLeadId).update({
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessagePreview: text.slice(0, 80)
    });
    // FASE 2: acá llamaremos a Groq/Claude para generar la respuesta del bot.
    // Por ahora simulamos: si el lead manda algo, el "bot" responde con un placeholder.
    setTimeout(async () => {
      try {
        await db.collection('chatbotMessages').add({
          leadId: selectedLeadId,
          businessId: selectedBusinessId,
          workspaceId: WS_ID,
          text: '(IA real en Fase 2 — por ahora respuestas manuales)',
          fromLead: false,
          system: true,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {}
    }, 600);
  } catch (e) { alert('Error: ' + e.message); }
}

// ===== CONFIG =====
async function loadConfig() {
  if (!WS_ID) return;
  try {
    const snap = await db.collection('chatbotConfig').doc(WS_ID).get();
    if (snap.exists) {
      const d = snap.data();
      if (d.systemPrompt) document.getElementById('cbConfigPrompt').value = d.systemPrompt;
      if (d.calendlyLink) document.getElementById('cbConfigCalendly').value = d.calendlyLink;
      if (d.model) document.getElementById('cbConfigModel').value = d.model;
    }
  } catch (e) { console.warn('[chatbot] config load failed:', e.message); }
}

async function saveConfig() {
  if (!WS_ID) { alert('Sin workspace activo'); return; }
  const systemPrompt = document.getElementById('cbConfigPrompt').value.trim();
  const calendlyLink = document.getElementById('cbConfigCalendly').value.trim();
  const model = document.getElementById('cbConfigModel').value;
  try {
    await db.collection('chatbotConfig').doc(WS_ID).set({
      systemPrompt, calendlyLink, model,
      workspaceId: WS_ID,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    const btn = document.getElementById('cbConfigSave');
    btn.textContent = '✓ Guardado';
    setTimeout(() => { btn.textContent = '💾 Guardar config'; }, 1500);
  } catch (e) { alert('Error: ' + e.message); }
}
