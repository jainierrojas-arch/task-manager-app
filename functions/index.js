// Cloudflare Pages Function: GET /
// Health check del Worker que sirve los endpoints del chatbot.
// Endpoints disponibles:
//   POST /manychat/inbound  — webhook de ManyChat con DMs entrantes
//   POST /manychat/outbound — la app envía respuesta a ManyChat
//   GET  /                  — health check (este endpoint)

export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    service: 'task-manager-chatbot',
    endpoints: {
      'POST /manychat/inbound?biz=BUSINESS_ID&ws=WORKSPACE_ID': 'recibe webhook de ManyChat con DMs (Body: ManyChat user data + last_input_text)',
      'POST /manychat/outbound': 'envía respuesta a ManyChat (Body: { manychatApiKey, contactId, text })'
    },
    docs: 'https://github.com/jainierrojas-arch/task-manager-app',
    version: '1.0'
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
