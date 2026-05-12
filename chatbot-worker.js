// Cloudflare Worker para recibir webhooks de ManyChat (Instagram DMs) y enviarlos
// a Firestore. La app de Task Manager lo lee en tiempo real, genera respuesta IA
// con Groq, y la escribe de vuelta. Otro endpoint envía la respuesta a ManyChat
// para que llegue al usuario en Instagram.
//
// CÓMO DEPLOYAR (10 minutos, una vez):
// 1. Andá a https://dash.cloudflare.com → registrate (gratis)
// 2. Workers & Pages → Create application → Create Worker
// 3. Nombrá el worker: "task-manager-chatbot" (o como quieras)
// 4. Click "Deploy" (deploya el código default)
// 5. Click "Edit code" → reemplazá TODO el contenido con este archivo
// 6. Click "Save and deploy"
// 7. Tu URL queda algo como: https://task-manager-chatbot.TU-USUARIO.workers.dev
// 8. En ManyChat → tu bot de Instagram → Settings → Webhooks → agregá esa URL
//
// La app de Task Manager se conecta automáticamente cuando publiques el Worker
// y configures la URL en Settings → Bot IA → "URL del webhook".

const FIRESTORE_PROJECT = 'app-de-tareas-e4209';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Health check
    if (method === 'GET' && (path === '/' || path === '/health')) {
      return jsonResponse({ ok: true, service: 'task-manager-chatbot-worker', version: '1.0' });
    }

    // Endpoint POST /manychat/inbound — recibe webhook de ManyChat
    if (method === 'POST' && path === '/manychat/inbound') {
      try {
        const body = await request.json();
        // ManyChat envía estructura: { contact: { id, first_name, ig_username }, last_input_text: "msg", ...}
        // O custom field: ajustá según tu configuración de ManyChat
        const igHandle = (body.contact && body.contact.ig_username) || body.ig_username || body.handle || 'unknown';
        const text = body.last_input_text || body.message || body.text || '';
        const businessId = url.searchParams.get('biz') || body.businessId || env.DEFAULT_BUSINESS_ID || '';
        const workspaceId = url.searchParams.get('ws') || body.workspaceId || env.DEFAULT_WORKSPACE_ID || '';

        if (!text || !igHandle) {
          return jsonResponse({ ok: false, error: 'missing text or handle' }, 400);
        }

        // Escribir en Firestore "webhookInbox" (collection con allow:create:if true)
        const doc = {
          fields: {
            source: { stringValue: 'manychat' },
            handle: { stringValue: '@' + String(igHandle).replace(/^@/, '') },
            text: { stringValue: text },
            businessId: { stringValue: businessId },
            workspaceId: { stringValue: workspaceId },
            manychatContactId: { stringValue: (body.contact && body.contact.id) || '' },
            displayName: { stringValue: (body.contact && body.contact.first_name) || '' },
            receivedAt: { timestampValue: new Date().toISOString() },
            processed: { booleanValue: false }
          }
        };
        const res = await fetch(`${FIRESTORE_BASE}/webhookInbox`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doc)
        });
        if (!res.ok) {
          const errText = await res.text();
          return jsonResponse({ ok: false, error: 'firestore: ' + errText.slice(0, 200) }, 500);
        }
        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ ok: false, error: e.message }, 500);
      }
    }

    // Endpoint POST /manychat/outbound — la app llama acá para enviar mensaje a ManyChat
    // Body: { manychatApiKey, contactId, text }
    if (method === 'POST' && path === '/manychat/outbound') {
      try {
        const body = await request.json();
        const apiKey = body.manychatApiKey || env.MANYCHAT_API_KEY;
        const contactId = body.contactId;
        const text = body.text;
        if (!apiKey || !contactId || !text) {
          return jsonResponse({ ok: false, error: 'missing apiKey, contactId or text' }, 400);
        }
        // ManyChat Send Content API
        const res = await fetch('https://api.manychat.com/fb/sending/sendContent', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            subscriber_id: contactId,
            data: {
              version: 'v2',
              content: { messages: [{ type: 'text', text }] }
            },
            message_tag: 'ACCOUNT_UPDATE'
          })
        });
        const json = await res.json();
        return jsonResponse({ ok: res.ok, status: res.status, response: json });
      } catch (e) {
        return jsonResponse({ ok: false, error: e.message }, 500);
      }
    }

    return jsonResponse({ ok: false, error: 'not found' }, 404);
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
