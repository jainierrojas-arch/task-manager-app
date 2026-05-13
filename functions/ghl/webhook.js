// Cloudflare Pages Function: POST /ghl/webhook
//
// Recibe webhooks de GoHighLevel (Workflows) y los refleja en Firestore para
// que aparezcan en el dashboard del Task Manager (Bot IA → Conversaciones).
//
// GHL hace TODO el trabajo del bot (responde DMs de IG con AI, agenda en
// calendario, mantiene conversación). Este endpoint solo recibe los eventos
// importantes y los guarda en nuestra DB para visualización centralizada.
//
// URL del webhook (configurar en GHL Workflow → Action Custom Webhook):
//   https://task-manager-app-czv.pages.dev/ghl/webhook?biz=BUSINESS_ID&ws=WORKSPACE_ID
//
// EVENTOS SOPORTADOS (todos son optional — el endpoint detecta cuál llegó):
//   - Contact Created      → crea lead en chatbotLeads
//   - Appointment Booked   → crea appointment en chatbotAppointments + tag al lead
//   - Tag Added            → actualiza funnelStage del lead
//   - Conversation Message → guarda mensaje en chatbotMessages (opcional)
//
// CONFIGURAR EN GHL:
//   1) Automations → Workflows → New Workflow.
//   2) Trigger: "Contact Created" (filtro: source = Instagram).
//   3) Action: "Webhook" (Custom Webhook).
//      Method: POST
//      URL: la de arriba con tus IDs.
//      Body (JSON):
//      {
//        "event": "contact_created",
//        "contact": {
//          "id": "{{contact.id}}",
//          "first_name": "{{contact.first_name}}",
//          "last_name": "{{contact.last_name}}",
//          "phone": "{{contact.phone}}",
//          "email": "{{contact.email}}",
//          "ig_username": "{{contact.instagram_username}}",
//          "source": "{{contact.source}}",
//          "tags": "{{contact.tags}}"
//        }
//      }
//   4) Repetir para "Appointment Booked" con event = "appointment_booked".

const FIRESTORE_PROJECT = 'app-de-tareas-e4209';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;

export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  const businessId = url.searchParams.get('biz') || '';
  const workspaceId = url.searchParams.get('ws') || '';

  try {
    const body = await context.request.json();

    // GHL puede mandar varios formatos. Detectamos cuál llegó.
    const event = body.event || body.type || detectEvent(body);
    const contact = body.contact || body.contactData || body;

    if (event === 'contact_created' || event === 'ContactCreate' || event === 'lead') {
      await handleContactCreated({ contact, businessId, workspaceId });
    } else if (event === 'appointment_booked' || event === 'AppointmentBooked' || event === 'AppointmentCreate') {
      await handleAppointmentBooked({ body, businessId, workspaceId });
    } else if (event === 'tag_added' || event === 'ContactTagUpdate') {
      await handleTagAdded({ contact, businessId, workspaceId });
    } else if (event === 'message' || event === 'InboundMessage' || event === 'OutboundMessage') {
      await handleMessage({ body, event, businessId, workspaceId });
    } else {
      // Evento desconocido — guardamos en webhookInbox para diagnóstico
      await fsCreateDoc('webhookInbox', {
        source: { stringValue: 'ghl' },
        unknownEvent: { stringValue: event || 'unknown' },
        rawBody: { stringValue: JSON.stringify(body).slice(0, 4000) },
        businessId: { stringValue: businessId },
        workspaceId: { stringValue: workspaceId },
        receivedAt: { timestampValue: new Date().toISOString() },
        processed: { booleanValue: false }
      });
    }

    return jsonOk({ ok: true, event });
  } catch (e) {
    console.error('[ghl/webhook] error', e);
    return jsonOk({ ok: false, error: e.message });
  }
}

export async function onRequestGet() {
  return jsonOk({
    ok: true,
    service: 'task-manager ghl/webhook',
    events: ['contact_created', 'appointment_booked', 'tag_added', 'message'],
    setup: 'GHL Workflow → Custom Webhook → POST to this URL with ?biz=...&ws=...'
  });
}

// ====================================================
// HANDLERS
// ====================================================
async function handleContactCreated({ contact, businessId, workspaceId }) {
  if (!contact) return;
  const handle = contact.ig_username
    ? '@' + String(contact.ig_username).replace(/^@/, '')
    : 'ghl:' + (contact.id || Date.now());
  const displayName = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim()
    || contact.name || contact.full_name || '';

  // Evitar duplicados: buscar si ya existe un lead con este ghlContactId
  const existingId = await findLeadByGhlId(contact.id);
  if (existingId) return;

  await fsCreateDoc('chatbotLeads', {
    handle: { stringValue: handle },
    displayName: { stringValue: displayName },
    businessId: { stringValue: businessId },
    workspaceId: { stringValue: workspaceId },
    ghlContactId: { stringValue: String(contact.id || '') },
    phone: { stringValue: String(contact.phone || '') },
    email: { stringValue: String(contact.email || '') },
    funnelStage: { stringValue: 'bienvenida' },
    score: { integerValue: '0' },
    canal: { stringValue: String(contact.source || 'instagram') },
    source: { stringValue: 'ghl' },
    tags: { stringValue: Array.isArray(contact.tags) ? contact.tags.join(', ') : String(contact.tags || '') },
    createdAt: { timestampValue: new Date().toISOString() },
    lastMessageAt: { timestampValue: new Date().toISOString() },
    lastMessagePreview: { stringValue: 'Lead creado en GHL' }
  });
}

async function handleAppointmentBooked({ body, businessId, workspaceId }) {
  const apt = body.appointment || body;
  const contact = body.contact || apt.contact || {};
  const ghlContactId = contact.id || apt.contact_id || apt.contactId;

  // Resolver leadId desde ghlContactId si existe; si no, crear lead nuevo
  let leadId = ghlContactId ? await findLeadByGhlId(ghlContactId) : null;
  if (!leadId && ghlContactId) {
    await handleContactCreated({ contact: { ...contact, id: ghlContactId }, businessId, workspaceId });
    leadId = await findLeadByGhlId(ghlContactId);
  }

  await fsCreateDoc('chatbotAppointments', {
    leadId: { stringValue: leadId || '' },
    businessId: { stringValue: businessId },
    workspaceId: { stringValue: workspaceId },
    ghlAppointmentId: { stringValue: String(apt.id || '') },
    ghlContactId: { stringValue: String(ghlContactId || '') },
    title: { stringValue: String(apt.title || apt.calendar_name || 'Cita agendada') },
    startTime: { timestampValue: toIso(apt.startTime || apt.start_time || apt.appointmentStartTime) || new Date().toISOString() },
    endTime: { timestampValue: toIso(apt.endTime || apt.end_time || apt.appointmentEndTime) || new Date().toISOString() },
    status: { stringValue: String(apt.appointmentStatus || apt.status || 'scheduled') },
    source: { stringValue: 'ghl' },
    createdAt: { timestampValue: new Date().toISOString() }
  });

  if (leadId) {
    await fsUpdateDoc(`chatbotLeads/${leadId}`, {
      funnelStage: { stringValue: 'agendado' },
      lastMessageAt: { timestampValue: new Date().toISOString() },
      lastMessagePreview: { stringValue: '📅 Cita agendada' }
    }, ['funnelStage', 'lastMessageAt', 'lastMessagePreview']);
  }
}

async function handleTagAdded({ contact, businessId, workspaceId }) {
  if (!contact || !contact.id) return;
  const leadId = await findLeadByGhlId(contact.id);
  if (!leadId) return;

  // Mapear tags GHL → funnelStage del Task Manager
  const tagsStr = Array.isArray(contact.tags) ? contact.tags.join(',').toLowerCase() : String(contact.tags || '').toLowerCase();
  let funnelStage = null;
  if (tagsStr.includes('agendado')) funnelStage = 'agendado';
  else if (tagsStr.includes('propuesta')) funnelStage = 'propuesta';
  else if (tagsStr.includes('calificado')) funnelStage = 'calificacion';
  else if (tagsStr.includes('descartado')) funnelStage = 'descartado';

  const update = {
    tags: { stringValue: tagsStr },
    lastMessageAt: { timestampValue: new Date().toISOString() }
  };
  const fields = ['tags', 'lastMessageAt'];
  if (funnelStage) {
    update.funnelStage = { stringValue: funnelStage };
    fields.push('funnelStage');
  }
  await fsUpdateDoc(`chatbotLeads/${leadId}`, update, fields);
}

async function handleMessage({ body, event, businessId, workspaceId }) {
  const msg = body.message || body;
  const ghlContactId = body.contact_id || (body.contact && body.contact.id) || msg.contactId;
  if (!ghlContactId) return;

  let leadId = await findLeadByGhlId(ghlContactId);
  if (!leadId) {
    // Si no existe el lead, lo creamos minimalmente
    await handleContactCreated({
      contact: { id: ghlContactId, first_name: body.contact_name || '' },
      businessId, workspaceId
    });
    leadId = await findLeadByGhlId(ghlContactId);
  }
  if (!leadId) return;

  const fromLead = event === 'InboundMessage' || event === 'message_inbound' || msg.direction === 'inbound';
  const text = msg.body || msg.text || msg.message || '';
  if (!text) return;

  await fsCreateDoc('chatbotMessages', {
    leadId: { stringValue: leadId },
    businessId: { stringValue: businessId },
    workspaceId: { stringValue: workspaceId },
    text: { stringValue: text },
    fromLead: { booleanValue: !!fromLead },
    source: { stringValue: 'ghl' },
    ghlMessageId: { stringValue: String(msg.id || '') },
    timestamp: { timestampValue: new Date().toISOString() }
  });
  await fsUpdateDoc(`chatbotLeads/${leadId}`, {
    lastMessageAt: { timestampValue: new Date().toISOString() },
    lastMessagePreview: { stringValue: text.slice(0, 80) }
  }, ['lastMessageAt', 'lastMessagePreview']);
}

// ====================================================
// HELPERS
// ====================================================
function detectEvent(body) {
  if (body.appointmentStartTime || body.startTime || body.appointment) return 'appointment_booked';
  if (body.tags && body.id && body.first_name) return 'contact_created';
  if (body.body || body.message) return 'message';
  return null;
}

function toIso(v) {
  if (!v) return null;
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch (_) { return null; }
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function findLeadByGhlId(ghlContactId) {
  if (!ghlContactId) return null;
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'chatbotLeads' }],
      where: {
        fieldFilter: { field: { fieldPath: 'ghlContactId' }, op: 'EQUAL', value: { stringValue: String(ghlContactId) } }
      },
      limit: 1
    }
  };
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  });
  if (!res.ok) return null;
  const arr = await res.json();
  for (const row of arr) {
    if (row.document && row.document.name) return row.document.name.split('/').pop();
  }
  return null;
}

async function fsCreateDoc(collection, fields) {
  const res = await fetch(`${FIRESTORE_BASE}/${collection}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  const data = await res.json();
  if (!data.name) throw new Error('firestore create failed: ' + JSON.stringify(data).slice(0, 200));
  return data.name.split('/').pop();
}

async function fsUpdateDoc(path, fields, updateMask) {
  const params = updateMask.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  await fetch(`${FIRESTORE_BASE}/${path}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
}
