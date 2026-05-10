// Task Manager — Mobile Recorder (v3.10.0)
// Lee la sesión creada por el desktop, muestra el teleprompter sobre la cámara,
// graba con MediaRecorder, sube a Cloudinary unsigned y escribe la URL al doc
// de sesión. El desktop tiene un listener que ataca el video al entry.

const $ = (id) => document.getElementById(id);
const screens = ['screenLoading', 'screenError', 'screenRecord', 'screenPreview', 'screenUploading', 'screenDone'];
function show(name) {
  screens.forEach(s => $(s).classList.toggle('active', s === name));
}
function setError(title, msg) {
  $('errorTitle').textContent = title;
  $('errorMsg').textContent = msg || '';
  show('screenError');
}

// ===== Read session id from URL =====
const params = new URLSearchParams(location.search);
const SESSION_ID = params.get('session') || params.get('s') || '';

if (!SESSION_ID) {
  setError('Sesión no provista', 'Abrí el QR desde el desktop para empezar.');
  throw new Error('no session id');
}

// ===== Load session =====
let session = null;
let sessionRef = null;
async function loadSession() {
  try {
    sessionRef = window.db.collection('recordingSessions').doc(SESSION_ID);
    const snap = await sessionRef.get();
    if (!snap.exists) {
      setError('Sesión no encontrada', 'El QR puede estar expirado. Generá uno nuevo en el desktop.');
      return false;
    }
    session = snap.data();
    if (session.status === 'completed') {
      setError('Esta sesión ya fue usada', 'Generá un QR nuevo en el desktop para grabar otro video.');
      return false;
    }
    const created = session.createdAt && session.createdAt.toDate ? session.createdAt.toDate() : new Date(0);
    const ageMin = (Date.now() - created.getTime()) / 60000;
    if (ageMin > 60) {
      setError('Sesión expirada', 'El QR vence después de 1 hora. Generá uno nuevo en el desktop.');
      return false;
    }
    return true;
  } catch (e) {
    console.error('[loadSession] failed', e);
    setError('Error de red', 'Revisá tu conexión y volvé a abrir el QR.');
    return false;
  }
}

// ===== Camera + canvas pipeline (v3.10.3) =====
// El recording NO se hace directo del MediaStream de la cámara. En su lugar:
// 1) Tenemos un <video id="hiddenCam"> que recibe el stream de la cámara activa.
// 2) Un <canvas id="captureCanvas"> que se redibuja con requestAnimationFrame
//    copiando el frame actual del video.
// 3) MediaRecorder graba el stream del canvas (canvas.captureStream(30)) +
//    un audioTrack persistente capturado UNA SOLA VEZ al iniciar.
// Esto permite que al cambiar de cámara (front <-> back) la grabación NO se corte:
// solo se reemplaza la fuente del hidden video, el canvas sigue recibiendo frames
// y el audio nunca se interrumpe. Resultado: un solo archivo continuo con ambas tomas.
let videoStream = null;     // cambia al swappear cámara
let audioStream = null;     // persistente toda la sesión
let audioTrack = null;
let currentFacing = 'user';
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recordedMime = '';
let drawHandle = null;
let canvasReady = false;

function pickMime() {
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

async function ensureAudio() {
  if (audioTrack && audioTrack.readyState === 'live') return audioTrack;
  audioStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true }
  });
  audioTrack = audioStream.getAudioTracks()[0];
  return audioTrack;
}

async function startCamera(facing) {
  try {
    // Liberar el video stream anterior (no tocar audio).
    if (videoStream) videoStream.getTracks().forEach(t => t.stop());
    const facingConstraint = facing === 'environment' ? { ideal: 'environment' } : { ideal: 'user' };
    // Estrategia: pedimos 9:16 lo más fuerte posible. Si el celular no puede dar
    // exactamente esa resolución, igual el canvas 1080x1920 fuerza el output 9:16.
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingConstraint,
          width: { ideal: 1080 },
          height: { ideal: 1920 },
          aspectRatio: { ideal: 0.5625 } // 9/16
        }
      });
    } catch (e1) {
      console.warn('[camera] strict 9:16 failed, fallback', e1.message);
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingConstraint }
      });
    }

    const hidden = $('hiddenCam');
    hidden.srcObject = videoStream;
    try { await hidden.play(); } catch (e) { /* autoplay may already be running */ }

    // applyConstraints: algunos browsers (Safari iOS) ignoran width/height en
    // getUserMedia pero respetan applyConstraints sobre el track. Best effort.
    const track = videoStream.getVideoTracks()[0];
    if (track && track.applyConstraints) {
      try {
        await track.applyConstraints({
          width: { ideal: 1080 },
          height: { ideal: 1920 },
          aspectRatio: { ideal: 0.5625 }
        });
      } catch (e) { console.warn('[camera] applyConstraints failed', e.message); }
    }

    currentFacing = facing;
    const canvas = $('captureCanvas');
    if (canvas) canvas.classList.toggle('mirror', facing === 'user');
    setupDrawLoop();

    // Debug overlay: confirma al usuario que el output es 9:16 y muestra
    // qué le da realmente la cámara (para diagnosticar quejas futuras).
    if (track) {
      const s = track.getSettings();
      showDebug(`📹 Cam: ${s.width || '?'}×${s.height || '?'} → 📦 Output: 1080×1920 (9:16)`);
    }
  } catch (e) {
    console.error('[camera] failed', e);
    setError('No se pudo abrir la cámara', e.message + ' — Asegurate de dar permiso en el navegador y abrir desde HTTPS.');
  }
}

let _debugTimer = null;
function showDebug(text) {
  const el = $('debugOverlay');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  if (_debugTimer) clearTimeout(_debugTimer);
  _debugTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// Canvas size constante para todo el ciclo de vida — se setea en HTML attribute
// y aquí lo verificamos defensivamente. NO se cambia nunca, asegura output 9:16.
const TARGET_W = 1080;
const TARGET_H = 1920;

function lockCanvas() {
  const canvas = $('captureCanvas');
  if (!canvas) return;
  if (canvas.width !== TARGET_W) canvas.width = TARGET_W;
  if (canvas.height !== TARGET_H) canvas.height = TARGET_H;
}
// Lockear ya — antes de que cualquier código toque el canvas.
lockCanvas();

function setupDrawLoop() {
  if (canvasReady) return; // ya corriendo
  const canvas = $('captureCanvas');
  const hidden = $('hiddenCam');
  if (!canvas || !hidden) return;
  lockCanvas();
  const ctx = canvas.getContext('2d');

  function draw() {
    // Defensive: si algo resizeó el canvas (no debería pasar pero por las dudas),
    // lo restauramos. Importante: NO hacer esto durante recording — captureStream
    // se rompe si la dim cambia mid-record.
    if (!mediaRecorder || mediaRecorder.state === 'inactive') lockCanvas();

    const sw = hidden.videoWidth, sh = hidden.videoHeight;
    if (sw > 0 && sh > 0) {
      const dw = canvas.width, dh = canvas.height;

      // Detectar si el source es landscape — eso pasa cuando iOS devuelve el
      // stream rotado (ej: hold portrait pero pixel buffer 1280x720 horizontal).
      // En ese caso, ROTAR 90° CW al dibujar para que la imagen aparezca portrait
      // en el canvas portrait. Sin esta rotación, la cara saldría de costado.
      const sourceLandscape = sw > sh;
      const canvasPortrait = dw < dh;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, dw, dh);

      if (sourceLandscape && canvasPortrait) {
        // Rotar el source 90° CW. Después de rotar, el "ancho" original se
        // convierte en altura visual y viceversa, así que pasamos sh y sw
        // intercambiados a la lógica de cover-fit.
        ctx.save();
        ctx.translate(dw / 2, dh / 2);
        ctx.rotate(Math.PI / 2);
        // Cover-fit con dimensiones efectivas intercambiadas:
        const scale = Math.max(dh / sw, dw / sh);
        const w = sw * scale, h = sh * scale;
        ctx.drawImage(hidden, -w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        // Source y canvas en la misma orientación — cover-fit normal.
        const scale = Math.max(dw / sw, dh / sh);
        const w = sw * scale, h = sh * scale;
        const x = (dw - w) / 2, y = (dh - h) / 2;
        ctx.drawImage(hidden, x, y, w, h);
      }
    }
    drawHandle = requestAnimationFrame(draw);
  }
  drawHandle = requestAnimationFrame(draw);
  canvasReady = true;
}

async function init() {
  show('screenLoading');
  $('loadingText').textContent = 'Conectando sesión...';
  // Auth anónimo opcional — las reglas permiten lectura/escritura del doc de sesión sin auth.
  // Si llega a fallar el getUserMedia bajo http, mostramos error claro.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setError('Navegador no compatible', 'Tu navegador no soporta grabación. Usá Safari (iOS) o Chrome (Android).');
    return;
  }
  const ok = await loadSession();
  if (!ok) return;
  $('loadingText').textContent = 'Pidiendo permiso de micrófono...';
  $('tpText').textContent = session.scriptText || '(Sin guion. Improvisá!)';
  // El audio se captura UNA SOLA VEZ y queda persistente toda la sesión, así el
  // recording no se interrumpe al cambiar de cámara front<->back.
  try {
    await ensureAudio();
  } catch (e) {
    setError('No se pudo abrir el micrófono', e.message);
    return;
  }
  $('loadingText').textContent = 'Pidiendo cámara...';
  await startCamera('user');
  show('screenRecord');
  // Avisar al desktop que el celular está conectado y listo
  reportStatus('connected');
}

// Reporta cambios de estado al doc de sesión para que el desktop muestre feedback
// en tiempo real. Best-effort: si falla por reglas o red, no bloquea el flujo.
async function reportStatus(status) {
  if (!sessionRef) return;
  try { await sessionRef.update({ status }); }
  catch (e) { console.warn('[reportStatus] failed', status, e.message); }
}

// ===== Recording =====
let timerHandle = null;
let recStart = 0;
function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return mm + ':' + ss;
}
function updateTimer() {
  if (!recStart) return;
  // Si está pausado, congelar el timer en el momento de la pausa.
  const now = recPausedAt > 0 ? recPausedAt : Date.now();
  $('timer').textContent = fmtTime(now - recStart - recPausedAccum);
}

let recPausedAccum = 0; // ms acumulados en pausa para que el timer siga siendo realista
let recPausedAt = 0;

function startRecording() {
  const canvas = $('captureCanvas');
  if (!canvas || !audioTrack) return;
  recordedChunks = [];
  recPausedAccum = 0;
  recPausedAt = 0;
  const mime = pickMime();
  recordedMime = mime || 'video/webm';

  // Forzar dimensiones del canvas justo antes de captureStream — algunas
  // versiones de iOS Safari evalúan el tamaño del canvas en este momento
  // exacto, no antes ni después.
  if (canvas.width !== TARGET_W || canvas.height !== TARGET_H) {
    canvas.width = TARGET_W;
    canvas.height = TARGET_H;
  }
  console.log(`[rec] pre-capture canvas: ${canvas.width}x${canvas.height}`);

  // Combinar el stream del canvas (video continuo aunque cambie la cámara) con el
  // audio track persistente. NUNCA reasignar el audioTrack durante la sesión.
  const canvasStream = canvas.captureStream(30);
  const cTrack = canvasStream.getVideoTracks()[0];
  if (cTrack && cTrack.getSettings) {
    const cs = cTrack.getSettings();
    console.log('[rec] canvas track getSettings():', cs);
    showDebug(`🎬 Track: ${cs.width || '?'}×${cs.height || '?'} | Canvas: ${canvas.width}×${canvas.height}`);
  }
  const combined = new MediaStream();
  canvasStream.getVideoTracks().forEach(t => combined.addTrack(t));
  combined.addTrack(audioTrack);
  try {
    mediaRecorder = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : { videoBitsPerSecond: 6_000_000 });
  } catch (e) {
    console.error('[rec] new MediaRecorder failed', e);
    alert('No se pudo iniciar la grabación: ' + e.message);
    return;
  }
  mediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data); };
  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(recordedChunks, { type: recordedMime });
    showPreview();
  };
  mediaRecorder.start(1000);
  recStart = Date.now();
  $('btnRecord').classList.add('recording');
  $('timer').classList.add('active');
  $('btnPauseRec').style.display = '';
  $('btnPauseRec').textContent = '⏸';
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(updateTimer, 250);
  reportStatus('recording');
}

function pauseOrResumeRecording() {
  if (!mediaRecorder) return;
  if (mediaRecorder.state === 'recording') {
    try { mediaRecorder.pause(); } catch (e) { console.warn('pause unsupported', e); return; }
    recPausedAt = Date.now();
    $('btnPauseRec').textContent = '▶';
    $('btnRecord').classList.remove('recording');
    $('timer').classList.remove('active');
    $('timer').classList.add('paused');
    reportStatus('paused');
  } else if (mediaRecorder.state === 'paused') {
    try { mediaRecorder.resume(); } catch (e) { console.warn('resume unsupported', e); return; }
    if (recPausedAt) recPausedAccum += Date.now() - recPausedAt;
    recPausedAt = 0;
    $('btnPauseRec').textContent = '⏸';
    $('btnRecord').classList.add('recording');
    $('timer').classList.remove('paused');
    $('timer').classList.add('active');
    reportStatus('recording');
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  if (mediaRecorder.state === 'paused' && recPausedAt > 0) {
    recPausedAccum += Date.now() - recPausedAt;
    recPausedAt = 0;
  }
  mediaRecorder.stop();
  $('btnRecord').classList.remove('recording');
  $('timer').classList.remove('active');
  $('timer').classList.remove('paused');
  $('btnPauseRec').style.display = 'none';
  if (timerHandle) clearInterval(timerHandle);
}

function showPreview() {
  const url = URL.createObjectURL(recordedBlob);
  const v = $('recordedPreview');
  v.src = url;
  v.load();
  show('screenPreview');
  // Diagnóstico: medir dimensiones reales del archivo grabado
  v.addEventListener('loadedmetadata', () => {
    const w = v.videoWidth, h = v.videoHeight;
    const ratio = (w / h).toFixed(3);
    const isPortrait916 = w === 1080 && h === 1920;
    console.log(`[rec] file dimensions: ${w}x${h} ratio=${ratio}`);
    showDebug(`📁 Archivo: ${w}×${h} ${isPortrait916 ? '✓ 9:16' : '⚠ NO 9:16'}`);
  }, { once: true });
}

// ===== Teleprompter auto-scroll =====
// Slider 0..50 → px/frame en una curva suave. 0 = parado (botón Play arranca en 0.3).
// Mapping: sliderValue/50 elevado a 1.5 * 2 = max ~2px/frame ≈ scroll lento natural.
let tpSpeed = 0;
let tpPlaying = false;
let tpRaf = null;
let tpAccum = 0;
function tpStep() {
  if (!tpPlaying) return;
  const wrap = $('tpText');
  if (wrap) {
    tpAccum += tpSpeed;
    if (tpAccum >= 1) {
      const pixels = Math.floor(tpAccum);
      wrap.scrollTop += pixels;
      tpAccum -= pixels;
    }
  }
  tpRaf = requestAnimationFrame(tpStep);
}
function setSpeedFromSlider(rawValue) {
  // raw 0..50 → speed 0..2.5 px/frame, con curva suave para que los valores bajos sean MUY lentos
  const v = Math.max(0, Math.min(50, parseInt(rawValue, 10) || 0));
  if (v === 0) tpSpeed = 0;
  else tpSpeed = Math.pow(v / 50, 1.4) * 2.5;
  const lbl = $('speedLabel');
  if (lbl) {
    if (v === 0) lbl.textContent = '⏸ 0';
    else lbl.textContent = (tpPlaying ? '▶ ' : '⏸ ') + tpSpeed.toFixed(2);
  }
}
function tpPlayPause() {
  tpPlaying = !tpPlaying;
  $('btnPlayPause').textContent = tpPlaying ? '⏸' : '▶';
  // Si el slider está en 0 cuando dan play, ponerlo en un valor mínimo audible
  if (tpPlaying && tpSpeed <= 0) {
    const slider = $('speedSlider');
    if (slider) { slider.value = '6'; setSpeedFromSlider(6); }
    else tpSpeed = 0.3;
  }
  // Refrescar label con el ▶/⏸
  setSpeedFromSlider($('speedSlider') ? $('speedSlider').value : 0);
  if (tpPlaying) {
    tpRaf = requestAnimationFrame(tpStep);
  } else if (tpRaf) cancelAnimationFrame(tpRaf);
}

// ===== Cloudinary upload =====
async function uploadToCloudinary(blob) {
  const cloudName = session.cloudName;
  const uploadPreset = session.uploadPreset;
  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary no configurado en el desktop. Andá a Configuración y agregá cloud name + upload preset.');
  }
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/video/upload`;
  const ext = recordedMime.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: recordedMime });
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', uploadPreset);
  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        $('progressFill').style.width = pct + '%';
        $('uploadPct').textContent = pct + '%';
      }
    });
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) {
          resolve(data);
        } else {
          reject(new Error(data.error && data.error.message ? data.error.message : `HTTP ${xhr.status}`));
        }
      } catch (e) {
        reject(new Error('Respuesta inválida de Cloudinary'));
      }
    };
    xhr.onerror = () => reject(new Error('Error de red al subir'));
    xhr.send(fd);
  });
}

async function uploadAndCommit() {
  if (!recordedBlob) return;
  show('screenUploading');
  $('progressFill').style.width = '0%';
  $('uploadPct').textContent = '0%';
  reportStatus('uploading');
  try {
    const result = await uploadToCloudinary(recordedBlob);
    await sessionRef.update({
      status: 'completed',
      videoUrl: result.secure_url,
      videoBytes: result.bytes || null,
      videoFormat: result.format || null,
      videoDuration: result.duration || null,
      videoWidth: result.width || null,
      videoHeight: result.height || null,
      completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    show('screenDone');
  } catch (e) {
    console.error('[upload] failed', e);
    setError('Error al subir', e.message);
  }
}

// ===== Wireup =====
$('btnSwapCam').addEventListener('click', () => startCamera(currentFacing === 'user' ? 'environment' : 'user'));

let fontSize = 28;
$('btnFontUp').addEventListener('click', () => {
  fontSize = Math.min(72, fontSize + 4);
  $('tpText').style.fontSize = fontSize + 'px';
});
$('btnFontDown').addEventListener('click', () => {
  fontSize = Math.max(14, fontSize - 4);
  $('tpText').style.fontSize = fontSize + 'px';
});
$('btnTpToggle').addEventListener('click', () => {
  $('teleprompter').classList.toggle('hidden');
});
$('btnSpeedToggle').addEventListener('click', () => {
  $('speedCtl').classList.toggle('hidden');
});

const speedSlider = $('speedSlider');
if (speedSlider) {
  speedSlider.addEventListener('input', (e) => setSpeedFromSlider(e.target.value));
  setSpeedFromSlider(0);
}

// En landscape arrancar con el slider oculto — el usuario lo abre con ⚡ si lo necesita.
function applyLandscapeDefaults() {
  const isLandscape = window.matchMedia('(orientation: landscape)').matches;
  const speed = $('speedCtl');
  if (speed && isLandscape) speed.classList.add('hidden');
}
applyLandscapeDefaults();
window.matchMedia('(orientation: landscape)').addEventListener('change', applyLandscapeDefaults);

$('btnRecord').addEventListener('click', () => {
  if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) stopRecording();
  else startRecording();
});
$('btnPauseRec').addEventListener('click', pauseOrResumeRecording);
$('btnPlayPause').addEventListener('click', tpPlayPause);
$('btnCancel').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    if (!confirm('Cancelar la grabación?')) return;
    stopRecording();
    recordedBlob = null;
  }
  // volver a inicio
  show('screenRecord');
});

$('btnRetake').addEventListener('click', () => {
  recordedBlob = null;
  show('screenRecord');
});
$('btnUpload').addEventListener('click', uploadAndCommit);
$('btnSaveLocal').addEventListener('click', () => saveLocally($('btnSaveLocal')));
$('btnSaveLocalAfter').addEventListener('click', () => saveLocally($('btnSaveLocalAfter')));

// Guarda el video en el celular del usuario. En iOS Safari (donde el download
// directo a veces NO funciona porque iOS abre el video en lugar de bajarlo),
// usamos la Web Share API para que el usuario tenga el botón nativo "Guardar
// vídeo" en la hoja de compartir del sistema. En Android Chrome y desktop,
// el <a download> funciona y baja directo a la carpeta de descargas.
async function saveLocally(btn) {
  if (!recordedBlob) {
    alert('No hay video para guardar');
    return;
  }
  const ext = recordedMime.includes('mp4') ? 'mp4' : 'webm';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `taskmgr-${stamp}.${ext}`;
  const file = new File([recordedBlob], filename, { type: recordedMime });

  // 1) Web Share API con file (iOS 15+ y Android Chrome): saca el share sheet
  //    nativo donde el usuario elige "Guardar vídeo" → va a Fotos / Galería.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Abriendo...'; }
      await navigator.share({ files: [file], title: 'Video grabado', text: 'Video del Task Manager Recorder' });
      if (btn) { btn.textContent = '✓ Compartido'; setTimeout(() => { btn.textContent = '💾 Guardar'; btn.disabled = false; }, 1800); }
      return;
    } catch (e) {
      // Usuario canceló el share — caer al download tradicional.
      if (e && e.name !== 'AbortError') console.warn('[saveLocally] share failed', e);
      if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar'; }
    }
  }

  // 2) Fallback: <a download> — funciona en Android Chrome, desktop, etc.
  try {
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (btn) { btn.textContent = '✓ Descargado'; setTimeout(() => { btn.textContent = '💾 Guardar'; }, 1800); }
  } catch (e) {
    console.error('[saveLocally] download failed', e);
    alert('No se pudo guardar el archivo: ' + e.message);
  }
}
$('btnAnother').addEventListener('click', () => {
  setError('Sesión usada', 'Esta sesión ya envió un video. Generá un QR nuevo en el desktop.');
});

// ===== Draggable + resizable teleprompter =====
// Pointer events para que funcione tanto con touch (celular) como mouse (debug en desktop).
// Posición/tamaño persistidos en localStorage para que el usuario configure UNA vez.
(function setupTeleprompterTransform() {
  const tp = $('teleprompter');
  const drag = $('tpDragHandle');
  const resize = $('tpResizeHandle');
  if (!tp || !drag || !resize) return;

  // Restaurar transformación previa
  try {
    const saved = JSON.parse(localStorage.getItem('tpTransform') || 'null');
    if (saved && typeof saved === 'object') applyTransform(saved);
  } catch (e) {}

  function applyTransform(t) {
    if (typeof t.left === 'number') tp.style.left = t.left + 'px';
    if (typeof t.top === 'number') tp.style.top = t.top + 'px';
    if (typeof t.width === 'number') { tp.style.width = t.width + 'px'; }
    if (typeof t.height === 'number') { tp.style.height = t.height + 'px'; }
  }
  function persist() {
    const r = tp.getBoundingClientRect();
    localStorage.setItem('tpTransform', JSON.stringify({
      left: Math.round(r.left), top: Math.round(r.top),
      width: Math.round(r.width), height: Math.round(r.height)
    }));
  }

  // ---- Drag ----
  let dragState = null;
  function onDragStart(ev) {
    const pt = ev.touches ? ev.touches[0] : ev;
    const r = tp.getBoundingClientRect();
    dragState = { dx: pt.clientX - r.left, dy: pt.clientY - r.top, w: r.width, h: r.height };
    ev.preventDefault();
  }
  function onDragMove(ev) {
    if (!dragState) return;
    const pt = ev.touches ? ev.touches[0] : ev;
    let x = pt.clientX - dragState.dx;
    let y = pt.clientY - dragState.dy;
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 80;
    x = Math.max(-dragState.w + 80, Math.min(maxX, x));
    y = Math.max(0, Math.min(maxY, y));
    tp.style.left = x + 'px';
    tp.style.top = y + 'px';
    ev.preventDefault();
  }
  function onDragEnd() {
    if (!dragState) return;
    dragState = null;
    persist();
  }
  drag.addEventListener('touchstart', onDragStart, { passive: false });
  drag.addEventListener('touchmove', onDragMove, { passive: false });
  drag.addEventListener('touchend', onDragEnd);
  drag.addEventListener('mousedown', (e) => {
    onDragStart(e);
    const mv = (ev) => onDragMove(ev);
    const up = () => { onDragEnd(); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });

  // ---- Resize ----
  let resizeState = null;
  function onResizeStart(ev) {
    const pt = ev.touches ? ev.touches[0] : ev;
    const r = tp.getBoundingClientRect();
    resizeState = { startX: pt.clientX, startY: pt.clientY, w: r.width, h: r.height };
    ev.preventDefault();
    ev.stopPropagation();
  }
  function onResizeMove(ev) {
    if (!resizeState) return;
    const pt = ev.touches ? ev.touches[0] : ev;
    const dx = pt.clientX - resizeState.startX;
    const dy = pt.clientY - resizeState.startY;
    const newW = Math.max(180, Math.min(window.innerWidth - 8, resizeState.w + dx));
    const newH = Math.max(140, Math.min(window.innerHeight - 8, resizeState.h + dy));
    tp.style.width = newW + 'px';
    tp.style.height = newH + 'px';
    ev.preventDefault();
  }
  function onResizeEnd() {
    if (!resizeState) return;
    resizeState = null;
    persist();
  }
  resize.addEventListener('touchstart', onResizeStart, { passive: false });
  resize.addEventListener('touchmove', onResizeMove, { passive: false });
  resize.addEventListener('touchend', onResizeEnd);
  resize.addEventListener('mousedown', (e) => {
    onResizeStart(e);
    const mv = (ev) => onResizeMove(ev);
    const up = () => { onResizeEnd(); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
})();

init();
