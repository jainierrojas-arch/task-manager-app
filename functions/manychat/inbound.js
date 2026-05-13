// Cloudflare Pages Function: POST /manychat/inbound
//
// FLUJO COMPLETO (el bot responde DENTRO del flow de ManyChat — sin problemas
// de message_tag ni ventana 24h):
//
// 1. ManyChat dispara un External Request a este endpoint cuando llega un DM.
// 2. Acá: leemos config del negocio + Groq API key del workspace desde Firestore.
// 3. Guardamos el lead + mensaje del usuario en Firestore (para que la app los vea).
// 4. Llamamos a Groq con system prompt + base de conocimiento + últimos mensajes.
// 5. Guardamos la respuesta del bot también en Firestore.
// 6. Devolvemos { bot_text } en el response.
// 7. ManyChat lee bot_text y lo manda como mensaje al usuario en IG (dentro del flow).
//
// URL: https://TU-DOMAIN.pages.dev/manychat/inbound?biz=BUSINESS_ID&ws=WORKSPACE_ID
//
// Body de ManyChat External Request:
// {
//   "contact": { "id": "{{user.id}}", "first_name": "{{user.first_name}}", "ig_username": "{{user.ig_username}}" },
//   "last_input_text": "{{last_input_text}}"
// }

const FIRESTORE_PROJECT = 'app-de-tareas-e4209';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;
const FALLBACK_MSG = 'Gracias por escribir. En un momento te respondo.';

export async function onRequestPost(context) {
  const { request } = context;
  const url = new URL(request.url);

  try {
    const body = await request.json();
    const igHandle = (body.contact && body.contact.ig_username) || body.ig_username || body.handle || 'unknown';
    const userText = body.last_input_text || body.message || body.text || '';
    const businessId = url.searchParams.get('biz') || body.businessId || '';
    const workspaceId = url.searchParams.get('ws') || body.workspaceId || '';
    const contactId = String((body.contact && body.contact.id) || '');
    const firstName = String((body.contact && body.contact.first_name) || '');

    if (!userText || !igHandle || !businessId) {
      return jsonResp({
        bot_text: FALLBACK_MSG,
        debug: { error: 'missing required fields', got: { igHandle, userText: !!userText, businessId } }
      }, 200);
    }

    const handle = '@' + String(igHandle).replace(/^@/, '');

    // 1) Leer config del workspace (system prompt, KB, modelo, calendly)
    const config = await fsGetDoc(`chatbotConfig/${workspaceId || '_'}`);
    const business = await fsGetDoc(`chatbotBusinesses/${businessId}`);

    // 2) Groq API key — desde CF Pages env var (más seguro que en Firestore).
    // Setear en Cloudflare Pages → Settings → Environment variables → GROQ_API_KEY.
    let groqApiKey = (context.env && context.env.GROQ_API_KEY) || null;
    // Fallback: si no hay env var, intentamos leer de Firestore (requiere rules abiertas).
    if (!groqApiKey && workspaceId) {
      const groqDoc = await fsGetDoc(`config/openai_${workspaceId}`);
      groqApiKey = (groqDoc && groqDoc.apiKey) ? String(groqDoc.apiKey).trim() : null;
    }

    // 3) Buscar lead existente o crear nuevo
    let leadId = await findLeadId(businessId, workspaceId, handle);
    if (!leadId) {
      leadId = await fsCreateDoc('chatbotLeads', {
        handle: { stringValue: handle },
        displayName: { stringValue: firstName },
        businessId: { stringValue: businessId },
        workspaceId: { stringValue: workspaceId },
        manychatContactId: { stringValue: contactId },
        funnelStage: { stringValue: 'bienvenida' },
        score: { integerValue: '0' },
        canal: { stringValue: 'instagram' },
        createdAt: { timestampValue: new Date().toISOString() },
        lastMessageAt: { timestampValue: new Date().toISOString() },
        lastMessagePreview: { stringValue: userText.slice(0, 80) }
      });
    } else {
      // actualizar lastMessageAt + manychatContactId si no estaba
      await fsUpdateDoc(`chatbotLeads/${leadId}`, {
        lastMessageAt: { timestampValue: new Date().toISOString() },
        lastMessagePreview: { stringValue: userText.slice(0, 80) },
        manychatContactId: { stringValue: contactId }
      }, ['lastMessageAt', 'lastMessagePreview', 'manychatContactId']);
    }

    // 4) Guardar mensaje del usuario en chatbotMessages
    await fsCreateDoc('chatbotMessages', {
      leadId: { stringValue: leadId },
      businessId: { stringValue: businessId },
      workspaceId: { stringValue: workspaceId },
      text: { stringValue: userText },
      fromLead: { booleanValue: true },
      source: { stringValue: 'manychat' },
      timestamp: { timestampValue: new Date().toISOString() }
    });

    // 5) Si falta Groq key, devolver un mensaje fallback (ManyChat aún manda algo)
    if (!groqApiKey) {
      return jsonResp({
        bot_text: FALLBACK_MSG,
        debug: { error: 'sin Groq API key — configurala en la app (Settings → OpenAI API Key)' }
      }, 200);
    }

    // 6) Leer últimos 12 mensajes del lead para contexto
    const recentMessages = await listLeadMessages(leadId, 12);

    // 7) Llamar Groq
    const sysPrompt = buildSystemPrompt(config, business, firstName);
    const apiMessages = [
      { role: 'system', content: sysPrompt },
      ...recentMessages.map(m => ({ role: m.fromLead ? 'user' : 'assistant', content: m.text || '' }))
        .filter(m => m.content && !m.content.startsWith('⚠'))
    ];

    let botText = FALLBACK_MSG;
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + groqApiKey, 'Content-Type': 'application/json' },
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
        const errTxt = await groqRes.text().catch(() => '');
        console.error('[inbound] Groq error', groqRes.status, errTxt.slice(0, 200));
      }
    } catch (e) {
      console.error('[inbound] Groq call failed', e);
    }

    // 8) Guardar respuesta del bot en chatbotMessages
    await fsCreateDoc('chatbotMessages', {
      leadId: { stringValue: leadId },
      businessId: { stringValue: businessId },
      workspaceId: { stringValue: workspaceId },
      text: { stringValue: botText },
      fromLead: { booleanValue: false },
      timestamp: { timestampValue: new Date().toISOString() }
    });
    await fsUpdateDoc(`chatbotLeads/${leadId}`, {
      lastMessageAt: { timestampValue: new Date().toISOString() },
      lastMessagePreview: { stringValue: botText.slice(0, 80) }
    }, ['lastMessageAt', 'lastMessagePreview']);

    // 9) Devolver bot_text a ManyChat para que lo mande dentro del flow
    return jsonResp({
      bot_text: botText,
      version: 'v2',
      content: { messages: [{ type: 'text', text: botText }] }
    }, 200);
  } catch (e) {
    console.error('[inbound] fatal error', e);
    return jsonResp({ bot_text: FALLBACK_MSG, error: e.message }, 200);
  }
}

export async function onRequestGet() {
  return jsonResp({
    ok: true,
    service: 'task-manager-chatbot inbound',
    method: 'POST with ManyChat External Request payload',
    returns: '{ bot_text: "..." } → ManyChat usa bot_text como variable y lo manda'
  });
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function buildSystemPrompt(config, business, firstName) {
  let s = (config && (config.systemPrompt || '').trim()) ||
    `Sos el chatbot de Instagram de ${(business && business.name) || 'el negocio'}. Tu objetivo es calificar leads y agendar llamadas.`;
  if (config && config.knowledgeBase) {
    s += '\n\n===== BASE DE CONOCIMIENTO DEL NEGOCIO =====\n' + config.knowledgeBase;
  }
  if (config && config.calendlyLink) {
    s += '\n\nLINK DE CALENDLY PARA AGENDAR: ' + config.calendlyLink;
  }
  s += '\n\n===== INSTRUCCIONES DE ESTILO =====\n' +
    'Respondé en español natural, frases cortas, una pregunta por vez. Sin emojis excesivos. ' +
    'Sin saludar de nuevo si ya hubo intercambio. ' +
    'NUNCA menciones el @username de la persona ni su handle de Instagram en tus respuestas. ' +
    (firstName
      ? `Si tenés que llamarla por su nombre, usá "${firstName}" — sin el @.`
      : 'Si no sabés el nombre, no inventes uno, simplemente no la nombres.');
  return s;
}

// ===== FIRESTORE REST HELPERS =====
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

async function fsUpdateDoc(path, fields, updateMask) {
  const params = updateMask.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const res = await fetch(`${FIRESTORE_BASE}/${path}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.warn('[fsUpdate] failed', res.status, t.slice(0, 200));
  }
}

async function findLeadId(businessId, workspaceId, handle) {
  // Firestore structured query: leads donde businessId == X AND handle == Y
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'chatbotLeads' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'businessId' }, op: 'EQUAL', value: { stringValue: businessId } } },
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
  return msgs.reverse(); // cronológico
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
    else if (v.arrayValue !== undefined) obj[k] = (v.arrayValue.values || []).map(x => unwrapFields({ x }).x);
  }
  return obj;
}
