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

// v3.11.80: modal inline para inputs (Electron iframe puede bloquear prompt())
function showInlineModal(title, fields) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    const fieldsHtml = fields.map((f, i) => `
      <div style="margin-bottom: 12px">
        <label style="display:block;font-size:11px;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;font-weight:600">${esc(f.label)}</label>
        <input type="text" data-field="${i}" placeholder="${esc(f.placeholder || '')}" value="${esc(f.defaultValue || '')}" style="width:100%;padding:10px 12px;background:var(--bg-app);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;box-sizing:border-box">
      </div>
    `).join('');
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;min-width:340px;max-width:90vw">
        <div style="font-size:16px;font-weight:700;margin-bottom:14px">${esc(title)}</div>
        ${fieldsHtml}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
          <button id="_modalCancel" style="padding:8px 14px;background:transparent;color:var(--text-primary);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-weight:600">Cancelar</button>
          <button id="_modalOk" style="padding:8px 14px;background:var(--accent);color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:700">Crear</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const firstInput = overlay.querySelector('input[data-field]');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
    function close(result) {
      try { document.body.removeChild(overlay); } catch (e) {}
      resolve(result);
    }
    overlay.querySelector('#_modalCancel').addEventListener('click', () => close(null));
    overlay.querySelector('#_modalOk').addEventListener('click', () => {
      const values = fields.map((_, i) => overlay.querySelector(`[data-field="${i}"]`).value.trim());
      close(values);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') overlay.querySelector('#_modalOk').click();
        if (e.key === 'Escape') close(null);
      });
    });
  });
}

async function addBusiness() {
  const values = await showInlineModal('Nuevo negocio bot', [
    { label: 'Nombre del negocio', placeholder: 'Ej: Monetízalo, Mi Agencia, Cliente X' },
    { label: 'Emoji', placeholder: '✨', defaultValue: '✨' }
  ]);
  if (!values || !values[0]) return;
  try {
    const data = {
      name: values[0],
      emoji: (values[1] || '✨').slice(0, 2),
      workspaceId: WS_ID,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: currentUser ? currentUser.uid : null
    };
    await db.collection('chatbotBusinesses').add(data);
  } catch (e) { alert('Error al crear negocio: ' + e.message); }
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
  const values = await showInlineModal('Simular lead nuevo', [
    { label: 'Handle de Instagram (sin @)', placeholder: 'Ej: maria_coach, jorge_digital' }
  ]);
  if (!values || !values[0]) return;
  const handle = values[0];
  try {
    const data = {
      businessId: selectedBusinessId,
      workspaceId: WS_ID,
      handle: '@' + handle.replace(/^@/, ''),
      displayName: handle,
      funnelStage: 'bienvenida',
      score: 0,
      canal: 'instagram',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessagePreview: ''
    };
    const ref = await db.collection('chatbotLeads').add(data);
    selectLead(ref.id);
  } catch (e) { alert('Error al crear lead: ' + e.message); }
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

// v3.11.81: Fase 2 — el bot responde con IA real (Groq) usando system prompt +
// base de conocimiento + historial de la conversación. La API key viene de la
// config de workspace (config/openai_{wsId}) que ya tenés configurada.
async function getWorkspaceApiKey() {
  if (!WS_ID) return null;
  try {
    const snap = await db.collection('config').doc('openai_' + WS_ID).get();
    if (!snap.exists) return null;
    const raw = (snap.data() || {}).apiKey || null;
    return raw ? raw.trim() : null;
  } catch (e) { return null; }
}

async function generateBotResponse() {
  if (!selectedLeadId || !selectedBusinessId) throw new Error('Sin lead o negocio activo');
  // 1. API key
  const apiKey = await getWorkspaceApiKey();
  if (!apiKey) throw new Error('Configurá una API key en Settings → OpenAI API Key (pegá tu key de Groq que empieza con gsk_)');

  // 2. Config del bot (system prompt, KB, modelo)
  let config = {};
  try {
    const cfgSnap = await db.collection('chatbotConfig').doc(WS_ID).get();
    if (cfgSnap.exists) config = cfgSnap.data();
  } catch (e) {}

  const systemPrompt = (config.systemPrompt || '').trim();
  const knowledgeBase = (config.knowledgeBase || '').trim();
  const calendlyLink = (config.calendlyLink || '').trim();
  const model = config.model || 'llama-3.3-70b-versatile';

  // 3. Lead context
  const lead = leads.find(l => l.id === selectedLeadId) || {};
  const business = businesses.find(b => b.id === selectedBusinessId) || {};

  // 4. Build system message: prompt + KB + context
  let fullSystem = systemPrompt || `Sos un chatbot de Instagram de ${business.name || 'el negocio'}. Tu objetivo es calificar leads y agendar llamadas.`;
  if (knowledgeBase) {
    fullSystem += '\n\n===== BASE DE CONOCIMIENTO DEL NEGOCIO =====\n' + knowledgeBase;
  }
  if (calendlyLink) {
    fullSystem += '\n\nLINK DE CALENDLY PARA AGENDAR: ' + calendlyLink;
  }
  fullSystem += '\n\n===== CONTEXTO DEL LEAD ACTUAL =====\n' +
    `Handle: ${lead.handle || 'desconocido'}\n` +
    `Etapa del funnel: ${FUNNEL_LABELS[lead.funnelStage || 'bienvenida']}\n` +
    `Score: ${lead.score || 0}/100\n` +
    `Canal: ${lead.canal || 'instagram'}\n\n` +
    'IMPORTANTE: respondé en español natural y cercano (Argentina/Latam), frases cortas, una pregunta por vez. Sin emojis excesivos (máx 1-2 por mensaje). Sin saludarte de nuevo si ya hubo intercambio. Sin dar info externa al negocio. Si no sabés algo: "Te lo paso al instante con un humano".';

  // 5. Build messages: system + historial reciente (últimos 12)
  const recent = messages.slice(-12);
  const apiMessages = [
    { role: 'system', content: fullSystem },
    ...recent.map(m => ({
      role: m.fromLead ? 'user' : 'assistant',
      content: m.text || ''
    })).filter(m => m.content)
  ];

  // 6. Llamar a Groq
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: apiMessages,
      temperature: 0.7,
      max_tokens: 350
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq API ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const responseText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  return responseText.trim();
}

async function sendMessage() {
  if (!selectedLeadId) return;
  const input = document.getElementById('cbInputMsg');
  const text = (input.value || '').trim();
  if (!text) return;
  input.value = '';

  // 1. Guardar el mensaje del lead
  try {
    await db.collection('chatbotMessages').add({
      leadId: selectedLeadId,
      businessId: selectedBusinessId,
      workspaceId: WS_ID,
      text,
      fromLead: true,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chatbotLeads').doc(selectedLeadId).update({
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessagePreview: text.slice(0, 80)
    });
  } catch (e) { alert('Error guardando mensaje: ' + e.message); return; }

  // 2. Mostrar indicador "escribiendo..."
  showTypingIndicator();

  // 3. Generar respuesta con Groq
  try {
    const botText = await generateBotResponse();
    hideTypingIndicator();
    if (botText) {
      await db.collection('chatbotMessages').add({
        leadId: selectedLeadId,
        businessId: selectedBusinessId,
        workspaceId: WS_ID,
        text: botText,
        fromLead: false,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
      await db.collection('chatbotLeads').doc(selectedLeadId).update({
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastMessagePreview: botText.slice(0, 80)
      });
    }
  } catch (e) {
    hideTypingIndicator();
    // Guardar el error como mensaje del sistema para que sea visible
    try {
      await db.collection('chatbotMessages').add({
        leadId: selectedLeadId,
        businessId: selectedBusinessId,
        workspaceId: WS_ID,
        text: '⚠ Error del bot: ' + e.message,
        fromLead: false,
        system: true,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (_) {}
  }
}

function showTypingIndicator() {
  const el = document.getElementById('cbMessages');
  if (!el) return;
  if (document.getElementById('_typingIndicator')) return;
  const div = document.createElement('div');
  div.id = '_typingIndicator';
  div.className = 'cb-msg from-bot';
  div.style.opacity = '0.6';
  div.style.fontStyle = 'italic';
  div.textContent = '✏️ escribiendo...';
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}
function hideTypingIndicator() {
  const ind = document.getElementById('_typingIndicator');
  if (ind && ind.parentNode) ind.parentNode.removeChild(ind);
}

// ===== CONFIG =====
async function loadConfig() {
  if (!WS_ID) return;
  try {
    const snap = await db.collection('chatbotConfig').doc(WS_ID).get();
    if (snap.exists) {
      const d = snap.data();
      if (d.systemPrompt) document.getElementById('cbConfigPrompt').value = d.systemPrompt;
      if (d.knowledgeBase) document.getElementById('cbConfigKnowledge').value = d.knowledgeBase;
      if (d.calendlyLink) document.getElementById('cbConfigCalendly').value = d.calendlyLink;
      if (d.model) document.getElementById('cbConfigModel').value = d.model;
    }
  } catch (e) { console.warn('[chatbot] config load failed:', e.message); }
}

async function saveConfig() {
  if (!WS_ID) { alert('Sin workspace activo'); return; }
  const systemPrompt = document.getElementById('cbConfigPrompt').value.trim();
  const knowledgeBase = document.getElementById('cbConfigKnowledge').value.trim();
  const calendlyLink = document.getElementById('cbConfigCalendly').value.trim();
  const model = document.getElementById('cbConfigModel').value;
  try {
    await db.collection('chatbotConfig').doc(WS_ID).set({
      systemPrompt, knowledgeBase, calendlyLink, model,
      workspaceId: WS_ID,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    const btn = document.getElementById('cbConfigSave');
    btn.textContent = '✓ Guardado';
    setTimeout(() => { btn.textContent = '💾 Guardar config'; }, 1500);
  } catch (e) { alert('Error: ' + e.message); }
}
