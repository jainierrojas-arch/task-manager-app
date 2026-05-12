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

    const mcRes = await fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subscriber_id: contactId,
        data: {
          version: 'v2',
          content: { messages: [{ type: 'text', text: String(text).slice(0, 1000) }] }
        },
        message_tag: 'ACCOUNT_UPDATE'
      })
    });

    const json = await mcRes.json().catch(() => ({}));
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
