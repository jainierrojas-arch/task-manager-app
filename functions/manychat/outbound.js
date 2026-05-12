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

    // v3.11.86: dentro de la ventana 24h no se necesita message_tag.
    // Si ManyChat rechaza por estar fuera de ventana, reintentamos con HUMAN_AGENT
    // (válido para Instagram).
    const payload = (extraTag) => ({
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

    let mcRes = await callMc(payload(null));
    let json = await mcRes.json().catch(() => ({}));

    // Si ManyChat devuelve error de message_tag/ventana, reintentamos con HUMAN_AGENT
    const errStr = JSON.stringify(json).toLowerCase();
    const needsTag = !mcRes.ok || json.status === 'error' ||
      errStr.includes('message_tag') || errStr.includes('outside') ||
      errStr.includes('24') || errStr.includes('window');
    if (needsTag) {
      const retry = await callMc(payload('HUMAN_AGENT'));
      const retryJson = await retry.json().catch(() => ({}));
      if (retry.ok && retryJson.status !== 'error') {
        return jsonResp({ ok: true, status: retry.status, response: retryJson, retriedWithTag: 'HUMAN_AGENT' }, 200);
      }
      return jsonResp({
        ok: false,
        status: retry.status,
        response: retryJson,
        firstAttempt: { status: mcRes.status, response: json },
        retriedWithTag: 'HUMAN_AGENT'
      }, retry.status || 500);
    }

    return jsonResp({ ok: mcRes.ok, status: mcRes.status, response: json }, mcRes.ok ? 200 : 500);
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
