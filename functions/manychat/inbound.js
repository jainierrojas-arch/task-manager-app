// Cloudflare Pages Function: POST /manychat/inbound
// Recibe webhook de ManyChat (Instagram DMs) y los escribe en Firestore.
// Se deploya automáticamente cada vez que se pushea a la rama main de GitHub.
//
// URL final: https://TU-DOMAIN.pages.dev/manychat/inbound?biz=XXX&ws=YYY
//
// En ManyChat → External Request → POST a esta URL con body:
// {
//   "contact": { "id": "{{user.id}}", "first_name": "{{user.first_name}}", "ig_username": "{{user.ig_username}}" },
//   "last_input_text": "{{last_input}}"
// }

const FIRESTORE_PROJECT = 'app-de-tareas-e4209';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;

export async function onRequestPost(context) {
  const { request } = context;
  const url = new URL(request.url);

  try {
    const body = await request.json();
    // ManyChat puede mandar la data en formatos distintos según cómo configures
    // el External Request. Soportamos varios.
    const igHandle = (body.contact && body.contact.ig_username) || body.ig_username || body.handle || 'unknown';
    const text = body.last_input_text || body.message || body.text || '';
    const businessId = url.searchParams.get('biz') || body.businessId || '';
    const workspaceId = url.searchParams.get('ws') || body.workspaceId || '';

    if (!text || !igHandle || !businessId) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'missing required fields',
        got: { igHandle, text: text ? '(present)' : '(missing)', businessId }
      }, null, 2), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const doc = {
      fields: {
        source: { stringValue: 'manychat' },
        handle: { stringValue: '@' + String(igHandle).replace(/^@/, '') },
        text: { stringValue: String(text).slice(0, 4000) },
        businessId: { stringValue: businessId },
        workspaceId: { stringValue: workspaceId },
        manychatContactId: { stringValue: String((body.contact && body.contact.id) || '') },
        displayName: { stringValue: String((body.contact && body.contact.first_name) || '') },
        receivedAt: { timestampValue: new Date().toISOString() },
        processed: { booleanValue: false }
      }
    };

    const fsRes = await fetch(`${FIRESTORE_BASE}/webhookInbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    });

    if (!fsRes.ok) {
      const errText = await fsRes.text();
      return new Response(JSON.stringify({
        ok: false,
        error: 'firestore write failed',
        firestoreStatus: fsRes.status,
        firestoreError: errText.slice(0, 500)
      }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: true, msg: 'received and queued' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    service: 'task-manager-chatbot inbound',
    method: 'use POST with ManyChat webhook payload'
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
