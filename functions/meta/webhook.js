// Cloudflare Pages Function: /meta/webhook
//
// Webhook directo de Meta para recibir DMs de Instagram SIN ManyChat.
//
// FLUJO:
//   GET  /meta/webhook?hub.mode=subscribe&hub.verify_token=X&hub.challenge=Y
//        → Meta verifica que somos los dueños. Devolvemos el challenge si el token matchea.
//   POST /meta/webhook
//        → Meta nos manda DMs entrantes en tiempo real. Procesamos con Groq y respondemos.
//
// ENV VARS necesarias (CF Pages → Settings → Variables and Secrets):
//   META_VERIFY_TOKEN      — string random que vos definís (usado en setup del webhook)
//   META_PAGE_ACCESS_TOKEN — token de la Facebook Page conectada a IG (lo da Meta dev portal)
//   GROQ_API_KEY           — para generar respuestas (ya está)
//   META_BUSINESS_ID       — businessId del chatbot en la app (para guardar leads)
//   META_WORKSPACE_ID      — workspaceId del usuario (para leer config)
//
// SETUP en Meta Developer Portal:
//   App → Products → Messenger / Instagram Messaging
//   Webhooks → Add Callback URL: https://task-manager-app-czv.pages.dev/meta/webhook
//   Verify Token: el mismo que pongas en META_VERIFY_TOKEN
//   Subscribe to fields: messages

const FIRESTORE_PROJECT = 'app-de-tareas-e4209';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;

// ============================================================
// GET: verificación inicial del webhook
// ============================================================
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const expectedToken = context.env && context.env.META_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expectedToken) {
    // Meta espera que devolvamos el challenge como texto plano
    return new Response(challenge, { status: 200 });
  }

  // Health check si se llama sin params de verificación
  if (!mode && !token && !challenge) {
    return new Response(JSON.stringify({
      ok: true,
      service: 'meta/webhook',
      configured: !!expectedToken,
      hint: 'Use POST con un payload de Meta o GET con hub.mode=subscribe&hub.verify_token=...&hub.challenge=...'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response('Forbidden — verify token mismatch', { status: 403 });
}

// ============================================================
// POST: DMs entrantes de Meta
// ============================================================
export async function onRequestPost(context) {
  const env = context.env || {};
  const pageAccessToken = env.META_PAGE_ACCESS_TOKEN;
  const groqKey = env.GROQ_API_KEY;
  const businessId = env.META_BUSINESS_ID;
  const workspaceId = env.META_WORKSPACE_ID;

  // SIEMPRE devolvemos 200 a Meta (sino lo reintentan y nos saturan).
  // Procesamos async pero devolvemos OK inmediatamente.
  try {
    const body = await context.request.json();

    // Meta envía un array de "entries" — puede haber varios mensajes en un solo webhook
    if (body.object !== 'instagram') {
      return jsonOk({ ok: true, note: 'not an instagram event' });
    }

    const entries = body.entry || [];
    for (const entry of entries) {
      const messaging = entry.messaging || entry.standby || [];
      for (const event of messaging) {
        // Filtrar: ignorar nuestros propios mensajes (echo) y eventos sin texto
        if (event.message && event.message.is_echo) continue;
        if (!event.message || !event.message.text) continue;
        // No procesar mensajes muy viejos (más de 5 min, posiblemente backfill)
        const ts = event.timestamp || Date.now();
        if (Date.now() - ts > 5 * 60 * 1000) continue;

        const senderId = event.sender && event.sender.id;
        const messageId = event.message.mid;
        const userText = event.message.text;
        if (!senderId || !userText) continue;

        // Procesar este DM (no awaitamos para responder rápido a Meta,
        // pero CF Workers exigen await dentro del request lifecycle)
        await processDm({
          senderId, messageId, userText,
          businessId, workspaceId, groqKey, pageAccessToken
        });
      }
    }

    return jsonOk({ ok: true, processed: true });
  } catch (e) {
    console.error('[meta/webhook] fatal', e);
    // Devolvemos 200 igual para que Meta no reintente
    return jsonOk({ ok: true, error: e.message });
  }
}

// ============================================================
// Procesar un DM: lead/mensaje → Groq → guardar bot msg → enviar a IG
// ============================================================
async function processDm({ senderId, messageId, userText, businessId, workspaceId, groqKey, pageAccessToken }) {
  // 1) Deduplicar: si ya procesamos este messageId, no lo repetimos
  const seen = await fsGetDoc(`metaProcessedMsgs/${messageId}`);
  if (seen) {
    console.log('[meta] message already processed:', messageId);
    return;
  }
  // Marcar como procesado YA (antes de llamar Groq) para evitar duplicados si Meta reenvía
  await fsCreateDocWithId('metaProcessedMsgs', messageId, {
    processedAt: { timestampValue: new Date().toISOString() }
  });

  // 2) Leer config + business
  const config = await fsGetDoc(`chatbotConfig/${workspaceId || '_'}`);
  const business = await fsGetDoc(`chatbotBusinesses/${businessId}`);

  // 3) Buscar/crear lead (handle = "ig:<senderId>" porque no tenemos username sin extra API call)
  const handle = 'ig:' + senderId;
  let leadId = await findLeadId(businessId, workspaceId, handle);
  if (!leadId) {
    leadId = await fsCreateDoc('chatbotLeads', {
      handle: { stringValue: handle },
      displayName: { stringValue: '' },
      businessId: { stringValue: businessId },
      workspaceId: { stringValue: workspaceId },
      manychatContactId: { stringValue: senderId },
      funnelStage: { stringValue: 'bienvenida' },
      score: { integerValue: '0' },
      canal: { stringValue: 'instagram' },
      source: { stringValue: 'meta-direct' },
      createdAt: { timestampValue: new Date().toISOString() },
      lastMessageAt: { timestampValue: new Date().toISOString() },
      lastMessagePreview: { stringValue: userText.slice(0, 80) }
    });
  } else {
    await fsUpdateDoc(`chatbotLeads/${leadId}`, {
      lastMessageAt: { timestampValue: new Date().toISOString() },
      lastMessagePreview: { stringValue: userText.slice(0, 80) },
      manychatContactId: { stringValue: senderId }
    }, ['lastMessageAt', 'lastMessagePreview', 'manychatContactId']);
  }

  // 4) Guardar mensaje del usuario
  await fsCreateDoc('chatbotMessages', {
    leadId: { stringValue: leadId },
    businessId: { stringValue: businessId || '' },
    workspaceId: { stringValue: workspaceId || '' },
    text: { stringValue: userText },
    fromLead: { booleanValue: true },
    source: { stringValue: 'meta-direct' },
    metaMessageId: { stringValue: messageId },
    timestamp: { timestampValue: new Date().toISOString() }
  });

  if (!groqKey || !pageAccessToken) {
    console.warn('[meta] falta GROQ_API_KEY o META_PAGE_ACCESS_TOKEN');
    return;
  }

  // 5) Cargar últimos 12 mensajes para contexto
  const recentMessages = await listLeadMessages(leadId, 12);

  // 6) Llamar a Groq
  const sysPrompt = buildSystemPrompt(config, business);
  const apiMessages = [
    { role: 'system', content: sysPrompt },
    ...recentMessages.map(m => ({ role: m.fromLead ? 'user' : 'assistant', content: m.text || '' }))
      .filter(m => m.content && !m.content.startsWith('⚠'))
  ];

  let botText = 'Gracias por escribir. En un momento te respondo.';
  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + groqKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: (config && config.model) || 'llama-3.3-70b-versatile',
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 300
      })
    });
    if (groqRes.ok) {
      const data = await groqRes.json();
      const t = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
      if (t) botText = t;
    } else {
      const err = await groqRes.text().catch(() => '');
      console.error('[meta] Groq error', groqRes.status, err.slice(0, 200));
    }
  } catch (e) {
    console.error('[meta] Groq call failed', e);
  }

  // 7) Guardar respuesta del bot
  await fsCreateDoc('chatbotMessages', {
    leadId: { stringValue: leadId },
    businessId: { stringValue: businessId || '' },
    workspaceId: { stringValue: workspaceId || '' },
    text: { stringValue: botText },
    fromLead: { booleanValue: false },
    source: { stringValue: 'meta-direct' },
    timestamp: { timestampValue: new Date().toISOString() }
  });
  await fsUpdateDoc(`chatbotLeads/${leadId}`, {
    lastMessageAt: { timestampValue: new Date().toISOString() },
    lastMessagePreview: { stringValue: botText.slice(0, 80) }
  }, ['lastMessageAt', 'lastMessagePreview']);

  // 8) Enviar respuesta a Instagram via Meta Graph API
  await sendInstagramMessage({ pageAccessToken, recipientId: senderId, text: botText });
}

async function sendInstagramMessage({ pageAccessToken, recipientId, text }) {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: String(text).slice(0, 1000) },
        messaging_type: 'RESPONSE'
      })
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      console.error('[meta] send failed', res.status, errTxt.slice(0, 300));
    } else {
      console.log('[meta] sent to', recipientId);
    }
  } catch (e) {
    console.error('[meta] send error', e);
  }
}

function buildSystemPrompt(config, business) {
  let s = (config && (config.systemPrompt || '').trim()) ||
    `Sos el chatbot de Instagram de ${(business && business.name) || 'el negocio'}. Tu objetivo es calificar leads y agendar llamadas.`;
  if (config && config.knowledgeBase) {
    s += '\n\n===== BASE DE CONOCIMIENTO DEL NEGOCIO =====\n' + config.knowledgeBase;
  }
  if (config && config.calendlyLink) {
    s += '\n\nLINK DE CALENDLY PARA AGENDAR: ' + config.calendlyLink;
  }
  s += '\n\n===== INSTRUCCIONES DE ESTILO — IMPORTANTE =====\n' +
    'Sos una PERSONA real chateando por Instagram, NO un chatbot. Olvidate de sonar profesional o vendedor. ' +
    'Hablá como si fueras vos, una persona común, en un DM casual. Tono argentino/latino, relajado, cercano.\n\n' +
    'REGLAS:\n' +
    '- Frases cortas. 1 o 2 oraciones por mensaje, MÁXIMO.\n' +
    '- A veces respondé en una sola palabra si encaja ("Buenísimo", "Re que sí", "Obvio", "Dale").\n' +
    '- NO hagas preguntas de cuestionario una atrás de la otra. Conversá.\n' +
    '- Si el usuario te tira un small talk ("¿qué tal?", "¿cómo vas?"), respondele como charla casual ("Acá todo bien, ¿vos?"), NO con una pregunta de calificación.\n' +
    '- Usá vocabulario coloquial: "dale", "buenísimo", "tranqui", "obvio", "re-mil", "posta".\n' +
    '- Evitá frases vendedor-bot: "¿tienes algún proyecto?", "estoy aquí para ayudarte", "gracias por contactarnos".\n' +
    '- SIN emojis excesivos. Como mucho uno cada 3-4 mensajes.\n' +
    '- Si ya saludaste antes en la conversación, NO vuelvas a saludar.\n' +
    '- NUNCA menciones el @username ni handles de Instagram.\n\n' +
    'Cuando el lead muestra interés real (pregunta precios, agendar, etc.), ahí sí guialo al calendly. ' +
    'Antes de eso, solo conversá como si fueras un humano contestando un DM.';
  return s;
}

// ============================================================
// Helpers genéricos
// ============================================================
function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function fsGetDoc(path) {
  const res = await fetch(`${FIRESTORE_BASE}/${path}`);
  if (!res.ok) return null;
  const data = await res.json();
  return unwrapFields(data.fields || {});
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

async function fsCreateDocWithId(collection, id, fields) {
  await fetch(`${FIRESTORE_BASE}/${collection}?documentId=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
}

async function fsUpdateDoc(path, fields, updateMask) {
  const params = updateMask.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  await fetch(`${FIRESTORE_BASE}/${path}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
}

async function findLeadId(businessId, workspaceId, handle) {
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'chatbotLeads' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'businessId' }, op: 'EQUAL', value: { stringValue: businessId || '' } } },
            { fieldFilter: { field: { fieldPath: 'handle' }, op: 'EQUAL', value: { stringValue: handle } } }
          ]
        }
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
    if (row.document && row.document.name) {
      return row.document.name.split('/').pop();
    }
  }
  return null;
}

async function listLeadMessages(leadId, limit) {
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'chatbotMessages' }],
      where: {
        fieldFilter: { field: { fieldPath: 'leadId' }, op: 'EQUAL', value: { stringValue: leadId } }
      },
      orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
      limit
    }
  };
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  });
  if (!res.ok) return [];
  const arr = await res.json();
  const msgs = [];
  for (const row of arr) {
    if (row.document && row.document.fields) {
      msgs.push(unwrapFields(row.document.fields));
    }
  }
  return msgs.reverse();
}

function unwrapFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v.stringValue !== undefined) obj[k] = v.stringValue;
    else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
    else if (v.integerValue !== undefined) obj[k] = parseInt(v.integerValue, 10);
    else if (v.doubleValue !== undefined) obj[k] = v.doubleValue;
    else if (v.timestampValue !== undefined) obj[k] = v.timestampValue;
    else if (v.mapValue !== undefined) obj[k] = unwrapFields(v.mapValue.fields || {});
  }
  return obj;
}
