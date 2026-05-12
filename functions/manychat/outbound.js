// Cloudflare Pages Function: POST /manychat/outbound
// La app de Task Manager llama acá para enviar la respuesta del bot al usuario
// de Instagram via ManyChat API.
//
// Body esperado:
// {
//   "manychatApiKey": "...",      // Bearer token de ManyChat
//   "contactId": "...",           // ID del subscriber/contact en ManyChat
//   "text": "..."                 // mensaje a enviar
// }
//
// ManyChat API: https://api.manychat.com/fb/sending/sendContent

export async function onRequestPost(context) {
  const { request } = context;
  try {
    const body = await request.json();
    const apiKey = body.manychatApiKey;
    const contactId = body.contactId;
    const text = body.text;

    if (!apiKey || !contactId || !text) {
      return jsonResp({ ok: false, error: 'missing apiKey, contactId or text' }, 400);
    }

    // Helper: formatea el detalle de error de ManyChat para que sea legible
    // en el mensaje system de la app (concatena status + message + details).
    const fmtError = (resp) => {
      if (!resp) return 'sin respuesta';
      const parts = [];
      if (resp.message) parts.push(resp.message);
      if (resp.details) parts.push('details: ' + JSON.stringify(resp.details));
      if (resp.errors) parts.push('errors: ' + JSON.stringify(resp.errors));
      if (parts.length === 0) parts.push(JSON.stringify(resp).slice(0, 300));
      return parts.join(' | ');
    };

    // ManyChat API: intentamos 3 variantes hasta dar con la que acepta.
    // Variante 1: sendContent sin tag (correcto dentro de ventana 24h IG).
    // Variante 2: sendContent con HUMAN_AGENT (fuera de ventana en IG).
    // Variante 3: sendContent con ACCOUNT_UPDATE (fallback histórico).
    const buildPayload = (extraTag) => ({
      subscriber_id: contactId,
      data: {
        version: 'v2',
        content: {
          messages: [{ type: 'text', text: String(text).slice(0, 1000) }]
        }
      },
      ...(extraTag ? { message_tag: extraTag } : {})
    });

    const callMc = (body) => fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const attempts = [
      { tag: null, label: 'sin message_tag' },
      { tag: 'HUMAN_AGENT', label: 'HUMAN_AGENT' },
      { tag: 'ACCOUNT_UPDATE', label: 'ACCOUNT_UPDATE' }
    ];
    const tried = [];
    for (const att of attempts) {
      const mcRes = await callMc(buildPayload(att.tag));
      const json = await mcRes.json().catch(() => ({}));
      tried.push({ label: att.label, status: mcRes.status, response: json });
      if (mcRes.ok && json.status !== 'error') {
        return jsonResp({ ok: true, status: mcRes.status, response: json, usedTag: att.tag }, 200);
      }
    }
    // Si todas las variantes fallaron, devolvemos el error de la primera (más informativo)
    // pero incluimos todos los intentos para diagnóstico completo.
    const first = tried[0];
    return jsonResp({
      ok: false,
      status: first.status,
      response: {
        status: first.response && first.response.status,
        message: fmtError(first.response)
      },
      allAttempts: tried
    }, 500);
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestGet() {
  return jsonResp({
    ok: true,
    service: 'task-manager-chatbot outbound',
    method: 'POST with { manychatApiKey, contactId, text }'
  });
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
