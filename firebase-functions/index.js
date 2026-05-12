const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Lee URLs de webhook. v3.8.4: workspace-aware.
// Primero intenta config/instagram_{workspaceId} (per-workspace settings,
// introducido en v3.8.3). Si no existe, fallback a config/instagram global
// (posts pre-multi-workspace o workspaces sin config propio).
async function getWebhookUrls(workspaceId) {
  const tryDoc = async (docId) => {
    const snap = await db.collection('config').doc(docId).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return {
      make: data.makeWebhookUrl || null,
      ghlTiktok: data.ghlTiktokWebhookUrl || null
    };
  };
  if (workspaceId) {
    const wsConfig = await tryDoc(`instagram_${workspaceId}`);
    if (wsConfig && (wsConfig.make || wsConfig.ghlTiktok)) return wsConfig;
  }
  return (await tryDoc('instagram')) || { make: null, ghlTiktok: null };
}

// Construye el payload exacto que cada webhook espera. Mantiene los campos
// historicos (mediaUrl, mediaUrls, carouselChildren) para no romper el escenario
// de Make existente. GHL recibe el mismo payload — la diferencia es el destino.
function buildWebhookPayload(doc, scheduledPostId) {
  const d = doc.data();
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
    platforms: Array.isArray(d.platforms) ? d.platforms : ['instagram'],
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
// (status=programado y scheduledAt<=now), llama a los webhooks correspondientes
// segun platforms[], y marca como publicado / failed / partialFailure.
exports.publishScheduledPosts = onSchedule({
  schedule: 'every 5 minutes',
  timeZone: 'America/Argentina/Buenos_Aires',
  region: 'us-central1',
  retryCount: 0
}, async (event) => {
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
    // Lock optimista para evitar doble disparo si la funcion corre dos veces.
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

    const data = doc.data();
    const platforms = Array.isArray(data.platforms) && data.platforms.length > 0
      ? data.platforms
      : ['instagram']; // legacy: posts sin platforms van a IG por default
    const payload = buildWebhookPayload(doc, doc.id);

    // v3.8.4: leer URLs del workspace del post (cada workspace tiene sus
    // propios webhooks). Fallback a config global si el workspace no tiene.
    const urls = await getWebhookUrls(data.workspaceId);
    if (!urls.make && !urls.ghlTiktok) {
      await ref.update({
        status: 'failed',
        error: `Workspace ${data.workspaceId || '(global)'} no tiene webhooks configurados`,
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      logger.error(`Fallo ${doc.id}: workspace sin webhooks (${data.workspaceId || 'global'})`);
      continue;
    }

    // Disparar en paralelo a las plataformas que correspondan.
    const tasks = [];
    if (platforms.includes('instagram') && urls.make) {
      tasks.push(postToWebhook(urls.make, payload).then(r => ({ platform: 'instagram', ...r })));
    }
    if (platforms.includes('tiktok') && urls.ghlTiktok) {
      tasks.push(postToWebhook(urls.ghlTiktok, payload).then(r => ({ platform: 'tiktok', ...r })));
    }
    if (tasks.length === 0) {
      await ref.update({
        status: 'failed',
        error: 'Plataformas seleccionadas pero ningun webhook configurado',
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      logger.error(`Fallo ${doc.id}: sin webhook para ${platforms.join(',')}`);
      continue;
    }

    let results;
    try {
      results = await Promise.all(tasks);
    } catch (e) {
      await ref.update({
        status: 'failed',
        error: e.message,
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      logger.error(`Error ${doc.id}: ${e.message}`);
      continue;
    }

    const allOk = results.every(r => r.ok);
    const anyOk = results.some(r => r.ok);
    if (allOk) {
      await ref.update({
        status: 'publicado',
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        publishedPlatforms: results.map(r => r.platform),
        webhookResponses: results.map(r => ({ platform: r.platform, status: r.status }))
      });
      logger.info(`Publicado ${doc.id} en ${results.map(r => r.platform).join('+')}`);
    } else if (anyOk) {
      const succeeded = results.filter(r => r.ok).map(r => r.platform);
      const failed = results.filter(r => !r.ok);
      await ref.update({
        status: 'partial',
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        publishedPlatforms: succeeded,
        failedPlatforms: failed.map(r => r.platform),
        error: failed.map(r => `${r.platform}: HTTP ${r.status} ${(r.body || '').slice(0, 200)}`).join(' | '),
        webhookResponses: results.map(r => ({ platform: r.platform, status: r.status, ok: r.ok }))
      });
      logger.warn(`Parcial ${doc.id}: OK=${succeeded.join(',')} FALLO=${failed.map(r => r.platform).join(',')}`);
    } else {
      const errMsg = results.map(r => `${r.platform}: HTTP ${r.status} ${(r.body || '').slice(0, 200)}`).join(' | ');
      await ref.update({
        status: 'failed',
        error: errMsg,
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        webhookResponses: results.map(r => ({ platform: r.platform, status: r.status, ok: r.ok }))
      });
      logger.error(`Fallo total ${doc.id}: ${errMsg}`);
    }
  }
});
