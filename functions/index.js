const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Lee la URL del webhook de Make desde el doc config/instagram en Firestore.
// La app la guarda ahi cuando el usuario la configura en Settings.
async function getMakeWebhookUrl() {
  const snap = await db.collection('config').doc('instagram').get();
  if (!snap.exists) return null;
  const data = snap.data();
  return (data && data.makeWebhookUrl) || null;
}

// Construye el payload exacto que Make espera (igual al que la app enviaba antes).
function buildWebhookPayload(doc, scheduledPostId) {
  const d = doc.data();
  // scheduledAt puede ser Timestamp; lo serializamos a ISO igual que antes.
  let scheduledAtIso = null;
  try {
    if (d.scheduledAt && typeof d.scheduledAt.toDate === 'function') {
      scheduledAtIso = d.scheduledAt.toDate().toISOString();
    } else if (typeof d.scheduledAt === 'string') {
      scheduledAtIso = d.scheduledAt;
    }
  } catch (e) { scheduledAtIso = null; }

  const payload = {
    platform: d.platform || 'instagram',
    postType: d.postType || 'post',
    caption: d.caption || '',
    mediaUrl: d.mediaUrl || '',
    scheduledAt: scheduledAtIso,
    triggeredBy: d.triggeredBy || '',
    triggeredByEmail: d.triggeredByEmail || '',
    sourceType: d.sourceType || null,
    taskId: d.taskId || null,
    entryId: d.entryId || null,
    taskTitle: d.taskTitle || '',
    scheduledPostId
  };
  if (Array.isArray(d.mediaUrls) && d.mediaUrls.length > 0) {
    payload.mediaUrls = d.mediaUrls;
    d.mediaUrls.forEach((u, i) => { payload[`mediaUrl${i + 1}`] = u; });
    payload.carouselChildren = d.mediaUrls.map(url => ({
      media_type: 'IMAGE',
      image_url: url
    }));
  }
  return payload;
}

async function postToWebhook(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body: text };
}

// Corre cada 5 minutos. Lee Firestore, encuentra posts cuya hora ya llego
// (status=programado y scheduledAt<=now), llama al webhook de Make y marca
// como publicado o failed segun el resultado.
exports.publishScheduledPosts = onSchedule({
  schedule: 'every 5 minutes',
  timeZone: 'America/Argentina/Buenos_Aires',
  region: 'us-central1',
  retryCount: 0
}, async (event) => {
  const webhookUrl = await getMakeWebhookUrl();
  if (!webhookUrl) {
    logger.warn('No hay makeWebhookUrl configurado en config/instagram. Skip.');
    return;
  }

  const now = admin.firestore.Timestamp.now();
  const snap = await db.collection('scheduledPosts')
    .where('status', '==', 'programado')
    .where('scheduledAt', '<=', now)
    .limit(20)
    .get();

  if (snap.empty) {
    logger.info('No hay posts programados pendientes.');
    return;
  }

  logger.info(`Procesando ${snap.size} post(s) programado(s)`);

  for (const doc of snap.docs) {
    const ref = doc.ref;
    // Lock optimista: marcamos publishing antes de llamar a Make para evitar
    // doble disparo si la funcion corre dos veces por algun motivo.
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        if (!fresh.exists) throw new Error('doc gone');
        if (fresh.data().status !== 'programado') throw new Error('status changed');
        tx.update(ref, {
          status: 'publishing',
          publishingStartedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    } catch (e) {
      logger.info(`Skip ${doc.id}: ${e.message}`);
      continue;
    }

    const payload = buildWebhookPayload(doc, doc.id);
    try {
      const result = await postToWebhook(webhookUrl, payload);
      if (result.ok) {
        await ref.update({
          status: 'publicado',
          publishedAt: admin.firestore.FieldValue.serverTimestamp(),
          webhookResponseStatus: result.status
        });
        logger.info(`Publicado ${doc.id}`);
      } else {
        await ref.update({
          status: 'failed',
          error: `HTTP ${result.status}: ${result.body.slice(0, 500)}`,
          failedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        logger.error(`Fallo ${doc.id}: HTTP ${result.status}`);
      }
    } catch (e) {
      await ref.update({
        status: 'failed',
        error: e.message,
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      logger.error(`Error ${doc.id}: ${e.message}`);
    }
  }
});
