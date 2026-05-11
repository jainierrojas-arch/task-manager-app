// Task Manager — Mobile Recorder (v3.11.36)
// REWRITE TikTok-style: UNA sola MediaRecorder por sesión con pause/resume nativo.
// Antes (v3.11.x): cada tap-stop creaba una NUEVA MediaRecorder, terminábamos con
// múltiples blobs que había que unir con ffmpeg al subir — frágil. Ahora la misma
// MediaRecorder vive desde el primer tap hasta el botón Done — pause/resume entre
// fragmentos. Al final, stop() devuelve UN solo blob ya válido sin concat.
//
// Para "Descartar último fragmento": truncamos chunks[] hasta la marca anterior
// (cluster boundary de WebM). En el peor caso hay un glitch mínimo en el cut
// point; con keyframes forzados por resume() en la mayoría de encoders, queda OK.

const $ = (id) => document.getElementById(id);
const screens = ['screenLoading', 'screenError', 'screenScanner', 'screenRecord', 'screenPreview', 'screenUploading', 'screenDone'];
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

// ===== QR Scanner (v3.11.24) =====
let _scanAnim = null;
let _scanStream = null;

async function startQrScanner() {
  if (typeof jsQR !== 'function') { alert('jsQR no cargó'); return; }
  show('screenScanner');
  const video = document.getElementById('scannerVideo');
  const canvas = document.getElementById('scannerCanvas');
  if (!video || !canvas) return;
  try {
    _scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
    video.srcObject = _scanStream;
    await video.play().catch(() => {});
  } catch (e) {
    setError('No se pudo abrir la cámara', e.message + ' — Pedile a alguien que prenda el desktop y escaneá desde Safari.');
    return;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  function tick() {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
          handleScannedCode(code.data);
          return;
        }
      } catch (e) { console.warn(e); }
    }
    _scanAnim = requestAnimationFrame(tick);
  }
  _scanAnim = requestAnimationFrame(tick);
}

function stopQrScanner() {
  if (_scanAnim) { try { cancelAnimationFrame(_scanAnim); } catch (e) {} _scanAnim = null; }
  if (_scanStream) {
    try { _scanStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    _scanStream = null;
  }
  const video = document.getElementById('scannerVideo');
  if (video) { try { video.pause(); } catch (e) {} video.srcObject = null; }
}

function handleScannedCode(text) {
  stopQrScanner();
  let sid = null;
  try {
    const u = new URL(text);
    sid = u.searchParams.get('session') || u.searchParams.get('s');
  } catch (e) {
    if (/^rs_[a-z0-9_]+$/i.test(text)) sid = text;
  }
  if (!sid) {
    setError('QR no reconocido', 'El código escaneado no parece un QR válido de Task Manager. Generá uno nuevo en el desktop.');
    document.getElementById('btnScanQR').style.display = '';
    return;
  }
  const newUrl = location.pathname + '?session=' + encodeURIComponent(sid);
  location.replace(newUrl);
}

if (!SESSION_ID) {
  setError('Sesión no provista', 'Tocá el botón abajo y apuntá la cámara al QR de tu Task Manager.');
  const btn = document.getElementById('btnScanQR');
  if (btn) {
    btn.style.display = '';
    btn.addEventListener('click', startQrScanner);
  }
  const cancelBtn = document.getElementById('btnScannerCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    stopQrScanner();
    setError('Sesión no provista', 'Tocá el botón abajo y apuntá la cámara al QR de tu Task Manager.');
    if (btn) btn.style.display = '';
  });
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

// ===== Camera + canvas pipeline (v3.10.9 + v3.11.36 swap sin parar recorder) =====
// El MediaRecorder lee del canvas vía captureStream — cambiar de cámara solo
// cambia el srcObject del hidden video. El draw loop sigue dibujando, el
// recorder recibe los nuevos frames sin enterarse del swap. Adiós a la lógica
// _pendingSwapAfterStop que cortaba la grabación.
let videoStream = null;
let audioStream = null;
let audioTrack = null;
let currentFacing = 'user';
let drawHandle = null;
let canvasReady = false;
const TARGET_W = 1080;
const TARGET_H = 1920;

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
  // v3.11.36: ya NO detenemos el MediaRecorder al cambiar de cámara — el canvas
  // pipeline mantiene la continuidad y el recorder no se entera del swap.
  await _doStartCamera(facing);
}

async function _doStartCamera(facing) {
  try {
    if (videoStream) videoStream.getTracks().forEach(t => t.stop());
    const facingConstraint = facing === 'environment' ? { ideal: 'environment' } : { ideal: 'user' };
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingConstraint,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
    } catch (e1) {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingConstraint }
      });
    }

    const hidden = $('hiddenCam');
    hidden.srcObject = videoStream;
    try { await hidden.play(); } catch (e) {}

    currentFacing = facing;
    const canvas = $('captureCanvas');
    if (canvas) canvas.classList.toggle('mirror', facing === 'user');
    setupDrawLoop();

    const track = videoStream.getVideoTracks()[0];
    if (track) {
      const s = track.getSettings();
      const orient = (s.width || 0) > (s.height || 0) ? 'landscape (rotando 90° CW)' : 'portrait';
      showDebug(`📹 Cam: ${s.width || '?'}×${s.height || '?'} ${orient} → 📦 1080×1920 (9:16)`);
    }
  } catch (e) {
    console.error('[camera] failed', e);
    setError('No se pudo abrir la cámara', e.message + ' — Asegurate de dar permiso en el navegador y abrir desde HTTPS.');
  }
}

function lockCanvas() {
  const canvas = $('captureCanvas');
  if (!canvas) return;
  if (canvas.width !== TARGET_W) canvas.width = TARGET_W;
  if (canvas.height !== TARGET_H) canvas.height = TARGET_H;
}
lockCanvas();

function setupDrawLoop() {
  if (canvasReady) return;
  const canvas = $('captureCanvas');
  const hidden = $('hiddenCam');
  if (!canvas || !hidden) return;
  lockCanvas();
  const ctx = canvas.getContext('2d');
  window._lastDrawTs = Date.now();

  function draw() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') lockCanvas();
    const sw = hidden.videoWidth, sh = hidden.videoHeight;
    if (sw > 0 && sh > 0) {
      const dw = canvas.width, dh = canvas.height;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, dw, dh);
      const sourceLandscape = sw > sh;
      const canvasPortrait = dw < dh;
      if (sourceLandscape && canvasPortrait) {
        ctx.save();
        ctx.translate(dw / 2, dh / 2);
        ctx.rotate(Math.PI / 2);
        const scale = Math.max(dh / sw, dw / sh);
        const w = sw * scale, h = sh * scale;
        ctx.drawImage(hidden, -w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        const scale = Math.max(dw / sw, dh / sh);
        const w = sw * scale, h = sh * scale;
        const x = (dw - w) / 2, y = (dh - h) / 2;
        ctx.drawImage(hidden, x, y, w, h);
      }
    }
    window._lastDrawTs = Date.now();
    drawHandle = requestAnimationFrame(draw);
  }
  drawHandle = requestAnimationFrame(draw);
  canvasReady = true;
  if (!window._drawHealthCheck) {
    window._drawHealthCheck = setInterval(() => {
      if (!window._lastDrawTs) return;
      const since = Date.now() - window._lastDrawTs;
      if (since > 1500 && document.visibilityState === 'visible') {
        if (drawHandle) cancelAnimationFrame(drawHandle);
        window._lastDrawTs = Date.now();
        drawHandle = requestAnimationFrame(draw);
      }
    }, 1000);
  }
}

function ensureDrawLoopAlive() {
  const canvas = $('captureCanvas');
  if (!canvas) return;
  const since = window._lastDrawTs ? (Date.now() - window._lastDrawTs) : 9999;
  if (since > 500) {
    if (drawHandle) { try { cancelAnimationFrame(drawHandle); } catch (e) {} }
    canvasReady = false;
    setupDrawLoop();
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

async function init() {
  show('screenLoading');
  $('loadingText').textContent = 'Conectando sesión...';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setError('Navegador no compatible', 'Tu navegador no soporta grabación. Usá Safari (iOS) o Chrome (Android).');
    return;
  }
  const ok = await loadSession();
  if (!ok) return;
  $('loadingText').textContent = 'Pidiendo permiso de micrófono...';
  $('tpText').textContent = session.scriptText || '(Sin guion. Improvisá!)';
  try {
    await ensureAudio();
  } catch (e) {
    setError('No se pudo abrir el micrófono', e.message);
    return;
  }
  $('loadingText').textContent = 'Pidiendo cámara...';
  await startCamera('user');
  show('screenRecord');
  reportStatus('connected');
}

async function reportStatus(status) {
  if (!sessionRef) return;
  try { await sessionRef.update({ status }); }
  catch (e) { console.warn('[reportStatus] failed', status, e.message); }
}

// ===== Recording (v3.11.36 — single MediaRecorder TikTok-style) =====
// UNA sola MediaRecorder vive durante toda la sesión.
//   - Tap rojo (idle)     → start()        ← crea nueva MediaRecorder, comienza grabación
//   - Tap rojo (recording) → pause()        ← guarda marca; misma MediaRecorder sigue viva
//   - Tap rojo (paused)    → resume()       ← continúa hacia el MISMO blob
//   - Botón ✓ Done        → stop()         ← finaliza, onstop construye UN blob válido
//   - Botón ↶ Undo (solo pausado): trunca chunks[] hasta marca anterior
let mediaRecorder = null;
let recordedChunks = [];
let recordedMime = '';
let recordedBlob = null;
// Marca al final de cada fragmento (después de cada pausa/stop): { activeMsAtMark, chunkIdxAtMark }
let pauseMarks = [];
// Tiempo TOTAL acumulado en estado recording (suma de todos los fragmentos activos)
let recAccumActiveMs = 0;
// Timestamp del último start/resume — para calcular tiempo activo actual
let recLastResumeTs = 0;
// Flag para encadenar stop → preview (botón Done)
let _finishingForPreview = false;
// Flag para descarte total (no construir blob al onstop)
let _discardingAll = false;
let timerHandle = null;

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return mm + ':' + ss;
}

function getCurrentActiveMs() {
  let active = recAccumActiveMs;
  if (mediaRecorder && mediaRecorder.state === 'recording' && recLastResumeTs > 0) {
    active += Date.now() - recLastResumeTs;
  }
  return active;
}

function updateTimer() {
  $('timer').textContent = fmtTime(getCurrentActiveMs());
}

function updateMultiSegmentUI() {
  const undoBtn = document.getElementById('btnUndo');
  const doneBtn = document.getElementById('btnDone');
  const previewBtn = document.getElementById('btnPreviewLast');
  const clipsInd = document.getElementById('clipsIndicator');
  const isRecording = mediaRecorder && mediaRecorder.state === 'recording';
  const fragments = pauseMarks.length;
  // Mostrar Undo y Done solo cuando hay fragmentos Y NO estamos recording activo.
  const showSecondary = fragments > 0 && !isRecording;
  if (undoBtn) undoBtn.style.display = showSecondary ? '' : 'none';
  if (doneBtn) doneBtn.style.display = showSecondary ? '' : 'none';
  // En el modelo single-blob el preview de "ver clips individuales" no aplica.
  if (previewBtn) previewBtn.style.display = 'none';
  if (clipsInd) {
    const visibleN = isRecording ? fragments + 1 : fragments;
    if (visibleN > 0) {
      clipsInd.style.display = 'block';
      clipsInd.textContent = visibleN + ' FRAGMENT' + (visibleN === 1 ? 'O' : 'OS');
    } else {
      clipsInd.style.display = 'none';
    }
  }
  renderRecordRing();
}

// Anillo de progreso TikTok-style alrededor del botón rojo: un arco por fragmento finalizado.
function renderRecordRing() {
  const ring = document.getElementById('recordBtnRing');
  const recBtn = document.getElementById('btnRecord');
  if (!ring || !recBtn) return;
  const N = pauseMarks.length;
  recBtn.classList.toggle('has-segments', N > 0);
  if (N === 0) {
    ring.setAttribute('stroke-dasharray', '0 1000');
    return;
  }
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const gap = N === 1 ? 0 : 4;
  const segLen = (circumference - N * gap) / N;
  const pattern = [];
  for (let i = 0; i < N; i++) {
    pattern.push(Math.max(0.5, segLen));
    pattern.push(gap);
  }
  ring.setAttribute('stroke-dasharray', pattern.join(' '));
  ring.setAttribute('stroke-dashoffset', '0');
}

// Crea una NUEVA MediaRecorder y empieza a grabar. Resetea TODO el estado de sesión.
function startRecording() {
  const canvas = $('captureCanvas');
  if (!canvas || !audioTrack) return;
  recordedChunks = [];
  pauseMarks = [];
  recAccumActiveMs = 0;
  recLastResumeTs = 0;
  recordedBlob = null;
  _discardingAll = false;

  const mime = pickMime();
  recordedMime = mime || 'video/webm';

  if (canvas.width !== TARGET_W || canvas.height !== TARGET_H) {
    canvas.width = TARGET_W;
    canvas.height = TARGET_H;
  }
  const canvasStream = canvas.captureStream(60);
  const cTrack = canvasStream.getVideoTracks()[0];
  if (cTrack && cTrack.applyConstraints) {
    cTrack.applyConstraints({ width: { ideal: 1080 }, height: { ideal: 1920 } }).catch(() => {});
  }
  if (cTrack && cTrack.getSettings) {
    const cs = cTrack.getSettings();
    showDebug(`🎬 Grabando track: ${cs.width || '?'}×${cs.height || '?'}`);
  }
  const combined = new MediaStream();
  canvasStream.getVideoTracks().forEach(t => combined.addTrack(t));
  combined.addTrack(audioTrack);
  try {
    mediaRecorder = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: 10_000_000 } : { videoBitsPerSecond: 10_000_000 });
  } catch (e) {
    console.error('[rec] new MediaRecorder failed', e);
    alert('No se pudo iniciar la grabación: ' + e.message);
    return;
  }
  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
  };
  mediaRecorder.onpause = () => {
    // MediaRecorder.pause() emite el último dataavailable ANTES de cambiar a paused,
    // así que cuando este evento corre, chunks[] ya tiene todo el contenido del fragmento.
    pauseMarks.push({ activeMsAtMark: recAccumActiveMs, chunkIdxAtMark: recordedChunks.length });
    updateMultiSegmentUI();
  };
  mediaRecorder.onstop = () => {
    if (recLastResumeTs > 0) {
      recAccumActiveMs += Date.now() - recLastResumeTs;
      recLastResumeTs = 0;
    }
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    if (_discardingAll) {
      _discardingAll = false;
      recordedBlob = null;
      updateMultiSegmentUI();
      return;
    }
    // Stop directo desde recording (sin pause previo): cerrar marca implícita.
    if (pauseMarks.length === 0 || pauseMarks[pauseMarks.length - 1].chunkIdxAtMark < recordedChunks.length) {
      pauseMarks.push({ activeMsAtMark: recAccumActiveMs, chunkIdxAtMark: recordedChunks.length });
    }
    recordedBlob = new Blob(recordedChunks, { type: recordedMime });
    if (_finishingForPreview) {
      _finishingForPreview = false;
      showPreview();
    } else {
      updateMultiSegmentUI();
    }
  };
  mediaRecorder.start(1000);
  recLastResumeTs = Date.now();
  $('btnRecord').classList.add('recording');
  $('timer').classList.remove('paused');
  $('timer').classList.add('active');
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(updateTimer, 200);
  updateMultiSegmentUI();
  reportStatus('recording');
}

// Tap rojo: start / pause / resume según estado.
// v3.11.55: el teleprompter ahora se sincroniza con la grabación — pausa y
// reanuda automáticamente cuando se aprieta el botón rojo.
function recordButtonTap() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    startRecording();
    // Auto-start del teleprompter al empezar a grabar
    if (!tpPlaying) tpPlayPause();
    return;
  }
  if (mediaRecorder.state === 'recording') {
    if (recLastResumeTs > 0) {
      recAccumActiveMs += Date.now() - recLastResumeTs;
      recLastResumeTs = 0;
    }
    try { mediaRecorder.pause(); } catch (e) {
      console.warn('pause unsupported', e);
      try { mediaRecorder.stop(); } catch (_) {}
      return;
    }
    $('btnRecord').classList.remove('recording');
    $('timer').classList.remove('active');
    $('timer').classList.add('paused');
    reportStatus('paused');
    // Pausar teleprompter en sync
    if (tpPlaying) tpPlayPause();
  } else if (mediaRecorder.state === 'paused') {
    try { mediaRecorder.resume(); } catch (e) { console.warn('resume unsupported', e); return; }
    recLastResumeTs = Date.now();
    $('btnRecord').classList.add('recording');
    $('timer').classList.remove('paused');
    $('timer').classList.add('active');
    reportStatus('recording');
    updateMultiSegmentUI();
    // Reanudar teleprompter en sync
    if (!tpPlaying) tpPlayPause();
  }
}

// Llamado desde el botón Done (✓). Detiene definitivamente y va al preview.
function finishRecording() {
  if (!mediaRecorder) {
    if (recordedBlob && recordedBlob.size > 0) showPreview();
    return;
  }
  if (mediaRecorder.state === 'inactive') {
    if (recordedBlob && recordedBlob.size > 0) showPreview();
    return;
  }
  _finishingForPreview = true;
  if (mediaRecorder.state === 'recording' && recLastResumeTs > 0) {
    recAccumActiveMs += Date.now() - recLastResumeTs;
    recLastResumeTs = 0;
  }
  try { mediaRecorder.stop(); } catch (e) { console.warn('stop failed', e); _finishingForPreview = false; }
  $('btnRecord').classList.remove('recording');
  $('timer').classList.remove('active');
  $('timer').classList.remove('paused');
  // v3.11.55: pausar teleprompter al finalizar
  if (tpPlaying) tpPlayPause();
}

// Descarta el último fragmento. v3.11.57: si estamos grabando, pausa primero
// y después descarta. Antes salía silenciosamente cuando se llamaba durante
// grabación — el control remoto de la PC daba la sensación de que no respondía.
function discardLastFragment() {
  if (pauseMarks.length === 0 && (!mediaRecorder || mediaRecorder.state === 'inactive')) return;
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Pausar primero, después descartar (en el próximo tick)
    recordButtonTap();
    setTimeout(() => discardLastFragment(), 350);
    return;
  }
  if (pauseMarks.length === 0) return;

  pauseMarks.pop();
  const restoreTo = pauseMarks.length > 0
    ? pauseMarks[pauseMarks.length - 1]
    : { activeMsAtMark: 0, chunkIdxAtMark: 0 };
  // Trunca chunks hasta la marca anterior — el contenido del fragmento descartado
  // queda fuera del blob final. WebM tolera cortar entre clusters (la mayoría
  // de los browsers alinea cluster boundaries con los timeslice ticks).
  recordedChunks.length = restoreTo.chunkIdxAtMark;
  recAccumActiveMs = restoreTo.activeMsAtMark;

  if (pauseMarks.length === 0 && mediaRecorder && mediaRecorder.state === 'paused') {
    // No queda nada — soltar la MediaRecorder, el próximo tap creará una limpia.
    _discardingAll = true;
    try { mediaRecorder.stop(); } catch (e) {}
  }
  $('timer').textContent = fmtTime(recAccumActiveMs);
  updateMultiSegmentUI();
  ensureDrawLoopAlive();
  const left = pauseMarks.length;
  showDebug('↶ Fragmento descartado · ' + left + ' restante' + (left === 1 ? '' : 's'));
}

function showPreview() {
  if (!recordedBlob || recordedBlob.size === 0) {
    setError('No hay video', 'La grabación quedó vacía. Volvé a grabar.');
    return;
  }
  const url = URL.createObjectURL(recordedBlob);
  const v = $('recordedPreview');
  v.src = url;
  v.load();
  show('screenPreview');
  const banner = $('dimBanner');
  const n = pauseMarks.length;
  if (banner) {
    if (n > 1) banner.textContent = `📹 1 video · ${n} fragmentos · ${fmtTime(recAccumActiveMs)}`;
    else banner.textContent = '⏳ Midiendo dimensiones del archivo...';
    banner.classList.remove('bad');
  }
  let measured = false;
  const measure = () => {
    if (measured) return;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return;
    measured = true;
    const ratio = (w / h).toFixed(3);
    const isPortrait916 = Math.abs((w / h) - 0.5625) < 0.01;
    if (banner) {
      banner.textContent = `📁 Archivo: ${w}×${h} ${isPortrait916 ? '✓ 9:16' : '⚠ NO 9:16 (' + ratio + ')'} · ${fmtTime(recAccumActiveMs)}`;
      banner.classList.toggle('bad', !isPortrait916);
    }
  };
  v.addEventListener('loadedmetadata', measure);
  v.addEventListener('canplay', measure);
  setTimeout(measure, 1500);
}

// ===== Teleprompter auto-scroll =====
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
  if (tpPlaying && tpSpeed <= 0) {
    const slider = $('speedSlider');
    if (slider) { slider.value = '6'; setSpeedFromSlider(6); }
    else tpSpeed = 0.3;
  }
  setSpeedFromSlider($('speedSlider') ? $('speedSlider').value : 0);
  if (tpPlaying) {
    tpRaf = requestAnimationFrame(tpStep);
  } else if (tpRaf) cancelAnimationFrame(tpRaf);
}

// ===== Upload (v3.11.36 — UN solo blob, sin concat ni ffmpeg) =====
async function uploadAndCommit() {
  if (!recordedBlob || recordedBlob.size === 0) {
    if (recordedChunks.length > 0) {
      recordedBlob = new Blob(recordedChunks, { type: recordedMime });
    } else {
      return;
    }
  }
  show('screenUploading');
  $('progressFill').style.width = '0%';
  $('uploadPct').textContent = '0%';
  reportStatus('uploading');
  try {
    $('uploadPct').textContent = 'Subiendo a Cloudinary...';
    const r = await uploadToCloudinaryBlob(recordedBlob, recordedMime, (pct) => {
      $('progressFill').style.width = pct + '%';
      $('uploadPct').textContent = pct + '%';
    });
    await sessionRef.update({
      status: 'completed',
      videoUrl: r.secure_url,
      videoBytes: r.bytes || null,
      videoFormat: r.format || null,
      videoDuration: r.duration || null,
      videoWidth: r.width || null,
      videoHeight: r.height || null,
      completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    show('screenDone');
  } catch (e) {
    console.error('[upload] failed', e);
    setError('Error al subir', e.message);
  }
}

async function uploadToCloudinaryBlob(blob, mime, onProgress) {
  const cloudName = session.cloudName;
  const uploadPreset = session.uploadPreset;
  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary no configurado en el desktop. Andá a Configuración y agregá cloud name + upload preset.');
  }
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/video/upload`;
  const ext = (mime || '').includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: mime || 'video/webm' });
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', uploadPreset);
  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) resolve(data);
        else reject(new Error(data.error && data.error.message ? data.error.message : `HTTP ${xhr.status}`));
      } catch (e) { reject(new Error('Respuesta inválida de Cloudinary')); }
    };
    xhr.onerror = () => reject(new Error('Error de red al subir'));
    xhr.send(fd);
  });
}

// ===== Save locally (v3.11.36 — un solo archivo) =====
async function saveLocally(btn) {
  if (!recordedBlob || recordedBlob.size === 0) {
    if (recordedChunks.length > 0) {
      recordedBlob = new Blob(recordedChunks, { type: recordedMime });
    } else {
      alert('No hay video para guardar');
      return;
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mime = recordedMime || 'video/webm';
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([recordedBlob], `taskmgr-${stamp}.${ext}`, { type: mime });
  if (btn) btn.disabled = true;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      if (btn) btn.textContent = '⏳ Compartiendo...';
      await navigator.share({ files: [file], title: file.name, text: 'Video grabado' });
      if (btn) btn.textContent = '✓ Guardado';
    } else {
      if (btn) btn.textContent = '⏳ Descargando...';
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = file.name; a.style.display = 'none';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      if (btn) btn.textContent = '✓ Descargado';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      if (btn) btn.textContent = '💾 Guardar';
    } else {
      console.warn('[saveLocally] failed', e);
      if (btn) btn.textContent = '⚠ Error';
    }
  }
  if (btn) {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = '💾 Guardar'; }, 2200);
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

function applyLandscapeDefaults() {
  const isLandscape = window.matchMedia('(orientation: landscape)').matches;
  const speed = $('speedCtl');
  if (speed && isLandscape) speed.classList.add('hidden');
}
applyLandscapeDefaults();
window.matchMedia('(orientation: landscape)').addEventListener('change', applyLandscapeDefaults);

$('btnRecord').addEventListener('click', recordButtonTap);
$('btnUndo').addEventListener('click', discardLastFragment);
$('btnDone').addEventListener('click', finishRecording);
$('btnPlayPause').addEventListener('click', tpPlayPause);

// ===== v3.11.55: control por teclado / Bluetooth shutter remote =====
// Muchos gimbals y selfie sticks emiten Space, Enter o VolumeUp como botón
// shutter. La PWA escucha esos keys y dispara el record button para que
// puedas controlar grabar/pausar desde el remoto bluetooth en tu mano.
// Nota: iOS Safari intercepta volume keys a nivel sistema y NO los pasa al
// web app — en iPhone solo va a andar el botón "shutter" del remote si emite
// Enter o Space (algunos remotes tienen esa opción). En Android casi todos
// funcionan.
document.addEventListener('keydown', (e) => {
  // Solo cuando estamos en pantalla de grabación o preview
  if (!$('screenRecord').classList.contains('active')) return;
  // Ignorar si el foco está en un input/textarea (no robar typing)
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const k = e.key || '';
  const c = e.code || '';
  const triggers = [' ', 'Enter', 'MediaPlayPause', 'AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown', 'MediaPlay', 'MediaPause'];
  if (triggers.includes(k) || c === 'Space' || c === 'Enter') {
    e.preventDefault();
    recordButtonTap();
  }
});

// ===== v3.11.56: control remoto desde la PC vía Firestore =====
// Esto se registra DESPUÉS de que loadSession() asigna sessionRef. Antes el
// listener se enganchaba al cargar el script cuando sessionRef todavía era null.
let _lastRemoteCmdTs = 0;
function setupRemoteCommandListener() {
  if (!sessionRef) { console.warn('[remote] sessionRef null, skipping listener'); return; }
  sessionRef.onSnapshot((snap) => {
    if (!snap.exists) return;
    const data = snap.data() || {};
    const cmd = data.remoteCommand;
    if (!cmd || !cmd.ts || cmd.ts <= _lastRemoteCmdTs) return;
    _lastRemoteCmdTs = cmd.ts;
    const action = cmd.action;
    console.log('[remote] cmd received:', action);
    showDebug('📡 Control remoto PC: ' + action);
    if (action === 'toggle') recordButtonTap();
    else if (action === 'done') finishRecording();
    else if (action === 'discard') discardLastFragment();
  }, (err) => console.warn('[remote] snapshot error', err.message));
  console.log('[remote] listener wired up');
}
// Engancharlo apenas tengamos sessionRef. Como init() es async, esperamos un
// loop a que loadSession lo asigne.
(async function awaitSessionThenWire() {
  for (let i = 0; i < 30 && !sessionRef; i++) {
    await new Promise(r => setTimeout(r, 500));
  }
  setupRemoteCommandListener();
})();

// ===== v3.11.57: captura de botones de remote Bluetooth en iPhone =====
// Tres caminos en paralelo porque iOS varía mucho según versión y modelo:
//   1) MediaSession API — el remote envía play/pause/next/previous → setActionHandler los captura.
//      Funciona MUCHO mejor en iOS si el remote tiene botón de Play/Pause (no solo shutter).
//   2) Silent audio loop + volumechange — el viejo truco para "robar" los volume keys del shutter.
//   3) Keydown global — para teclados BT que mandan Space/Enter.
(function setupIosRemoteControl() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  // (1) MediaSession — funciona en iOS Safari + PWA standalone con audio playing.
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => recordButtonTap());
      navigator.mediaSession.setActionHandler('pause', () => recordButtonTap());
      navigator.mediaSession.setActionHandler('previoustrack', () => discardLastFragment());
      navigator.mediaSession.setActionHandler('nexttrack', () => finishRecording());
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Task Manager Recorder',
        artist: 'Grabando con teleprompter',
        album: 'Control remoto activo'
      });
    } catch (e) { console.warn('[mediaSession] setup failed', e.message); }
  }

  // (2) Silent audio loop para volumechange. Generamos un WAV de 2 segundos
  // proper (no data URL chiquito que iOS a veces no loopea).
  function makeSilentWavUrl(seconds) {
    const sampleRate = 8000;
    const numSamples = sampleRate * seconds;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    function ws(off, s) { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    ws(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ws(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  }
  let _audioEl = null;
  let _lastVol = -1;
  let _lastVolTs = 0;
  function setupSilentAudio() {
    if (!isIos) return;
    if (_audioEl) return;
    try {
      _audioEl = new Audio(makeSilentWavUrl(2));
      _audioEl.loop = true;
      _audioEl.volume = 0.5;
      _audioEl.play().catch(e => console.warn('[ios-vol] play blocked:', e.message));
      _lastVol = 0.5;
      _audioEl.addEventListener('volumechange', () => {
        const now = Date.now();
        if (now - _lastVolTs < 250) return;
        _lastVolTs = now;
        const cur = _audioEl.volume;
        if (Math.abs(cur - _lastVol) > 0.01) {
          recordButtonTap();
          _audioEl.volume = 0.5;
          _lastVol = 0.5;
        }
      });
    } catch (e) { console.warn('[ios-vol] setup failed', e.message); }
  }

  // Necesita gesture (autoplay policy). Engancho tanto touch como click para el primer tap.
  function onFirstGesture() {
    setupMediaSession();
    setupSilentAudio();
    showDebug('🎮 Control remoto activado');
  }
  document.addEventListener('touchend', onFirstGesture, { once: true });
  document.addEventListener('click', onFirstGesture, { once: true });
})();

$('btnCancel').addEventListener('click', () => {
  const isActive = mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused');
  const hasContent = recordedChunks.length > 0 || pauseMarks.length > 0;
  if (isActive || hasContent) {
    if (!confirm('Cancelar TODA la grabación? Se eliminará todo.')) return;
    if (isActive) {
      _discardingAll = true;
      try { mediaRecorder.stop(); } catch (e) {}
    }
    recordedChunks = [];
    pauseMarks = [];
    recAccumActiveMs = 0;
    recLastResumeTs = 0;
    recordedBlob = null;
    if ($('timer')) $('timer').textContent = '00:00';
    updateMultiSegmentUI();
  }
  show('screenRecord');
});

$('btnRetake').addEventListener('click', () => {
  recordedBlob = null;
  recordedChunks = [];
  pauseMarks = [];
  recAccumActiveMs = 0;
  recLastResumeTs = 0;
  if ($('timer')) $('timer').textContent = '00:00';
  ensureDrawLoopAlive();
  updateMultiSegmentUI();
  show('screenRecord');
});

// v3.11.36: el flujo multi-clip preview ya no aplica — botones y overlay quedan ocultos.
const _btnViewClips = document.getElementById('btnViewClips');
if (_btnViewClips) _btnViewClips.style.display = 'none';
const _btnPreviewLast = document.getElementById('btnPreviewLast');
if (_btnPreviewLast) _btnPreviewLast.style.display = 'none';

// Stub para cerrar el overlay legacy quickPreview si llegaran a abrirlo de algún lado.
function qpClose() {
  const overlay = $('quickPreview');
  if (overlay) overlay.style.display = 'none';
  ensureDrawLoopAlive();
}
const _qpCloseBtn = document.getElementById('quickPreviewClose');
if (_qpCloseBtn) _qpCloseBtn.addEventListener('click', qpClose);
const _qpPlayAll = document.getElementById('quickPreviewPlayAll');
if (_qpPlayAll) _qpPlayAll.addEventListener('click', qpClose);

$('btnUpload').addEventListener('click', uploadAndCommit);
$('btnSaveLocal').addEventListener('click', () => saveLocally($('btnSaveLocal')));
$('btnSaveLocalAfter').addEventListener('click', () => saveLocally($('btnSaveLocalAfter')));
$('btnAnother').addEventListener('click', () => {
  setError('Sesión usada', 'Esta sesión ya envió un video. Generá un QR nuevo en el desktop.');
});

// ===== Draggable + resizable teleprompter =====
(function setupTeleprompterTransform() {
  const tp = $('teleprompter');
  const drag = $('tpDragHandle');
  const resize = $('tpResizeHandle');
  if (!tp || !drag || !resize) return;

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
