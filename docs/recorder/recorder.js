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

// ===== Camera =====
let stream = null;
let currentFacing = 'user';
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recordedMime = '';

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

async function startCamera(facing) {
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing === 'environment' ? { ideal: 'environment' } : { ideal: 'user' },
        width: { ideal: 1080 },
        height: { ideal: 1920 }
      },
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    const preview = $('preview');
    preview.srcObject = stream;
    preview.classList.toggle('mirror', facing === 'user');
    currentFacing = facing;
  } catch (e) {
    console.error('[camera] failed', e);
    setError('No se pudo abrir la cámara', e.message + ' — Asegurate de dar permiso en el navegador y abrir desde HTTPS.');
  }
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
  $('loadingText').textContent = 'Pidiendo cámara...';
  $('tpText').textContent = session.scriptText || '(Sin guion. Improvisá!)';
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
  if (recStart) $('timer').textContent = fmtTime(Date.now() - recStart);
}

function startRecording() {
  if (!stream) return;
  recordedChunks = [];
  const mime = pickMime();
  recordedMime = mime || 'video/webm';
  try {
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : { videoBitsPerSecond: 6_000_000 });
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
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(updateTimer, 250);
  reportStatus('recording');
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop();
  $('btnRecord').classList.remove('recording');
  $('timer').classList.remove('active');
  if (timerHandle) clearInterval(timerHandle);
}

function showPreview() {
  const url = URL.createObjectURL(recordedBlob);
  const v = $('recordedPreview');
  v.src = url;
  v.load();
  show('screenPreview');
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

const speedSlider = $('speedSlider');
if (speedSlider) {
  speedSlider.addEventListener('input', (e) => setSpeedFromSlider(e.target.value));
  setSpeedFromSlider(0);
}

$('btnRecord').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
  else startRecording();
});
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
$('btnAnother').addEventListener('click', () => {
  setError('Sesión usada', 'Esta sesión ya envió un video. Generá un QR nuevo en el desktop.');
});

init();
