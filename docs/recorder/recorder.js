// Task Manager — Mobile Recorder (v3.10.0)
// Lee la sesión creada por el desktop, muestra el teleprompter sobre la cámara,
// graba con MediaRecorder, sube a Cloudinary unsigned y escribe la URL al doc
// de sesión. El desktop tiene un listener que ataca el video al entry.

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
// Si la PWA se abre sin session (ej. desde home screen), permitir escanear
// el QR del desktop directamente desde la cámara — bypasses Safari completamente.
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
  // Extraer session ID del URL escaneado
  // Formato esperado: https://...recorder/?session=XXX
  let sid = null;
  try {
    const u = new URL(text);
    sid = u.searchParams.get('session') || u.searchParams.get('s');
  } catch (e) {
    // No es URL — quizá es solo el session ID puro
    if (/^rs_[a-z0-9_]+$/i.test(text)) sid = text;
  }
  if (!sid) {
    setError('QR no reconocido', 'El código escaneado no parece un QR válido de Task Manager. Generá uno nuevo en el desktop.');
    document.getElementById('btnScanQR').style.display = '';
    return;
  }
  // Navegar a la URL con session — recarga la página entera, la PWA mantiene el contexto
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

// ===== Camera + canvas pipeline (v3.10.9) =====
// iOS Safari getUserMedia siempre devuelve el pixel buffer en orientación del
// sensor (landscape para front cam). MediaRecorder graba lo que recibe, sin
// rotation metadata, así que grabar el stream directo da archivo landscape
// aunque el usuario tenga el celular vertical.
//
// Solución: pipeline canvas con rotación manual.
// - <video id="hiddenCam"> recibe el stream landscape.
// - <canvas 1080x1920> se redibuja con requestAnimationFrame, ROTANDO 90° CW
//   si el source es landscape — así el frame queda portrait en el canvas.
// - canvas.captureStream(30) feeds the MediaRecorder.
// - Audio track persistente capturado UNA vez al inicio.
// - Resultado: archivo 1080x1920 (9:16 portrait) garantizado.
//
// Camera swap mid-recording: stop + new segment con la otra cámara (igual que
// v3.10.8 — múltiples clips suben separados al desktop).
let videoStream = null;
let audioStream = null;
let audioTrack = null;
let currentFacing = 'user';
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recordedMime = '';
let recordedSegments = [];
let _pendingSwapAfterStop = null;
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
  // Si está grabando, parar la grabación primero, marcar swap pending. El
  // onstop del recorder hará el cambio de cámara y reiniciará la grabación.
  if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
    _pendingSwapAfterStop = { facing };
    try { mediaRecorder.stop(); } catch (e) { console.warn(e); }
    return;
  }
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
  // Track del último frame dibujado para detectar si el loop se quedó dormido
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
  // Self-healing: si rAF se duerme >1s, reiniciar el loop. iOS Safari a veces
  // pausa rAF en visibilitychange / dialogs y no lo reactiva.
  if (!window._drawHealthCheck) {
    window._drawHealthCheck = setInterval(() => {
      if (!window._lastDrawTs) return;
      const since = Date.now() - window._lastDrawTs;
      if (since > 1500 && document.visibilityState === 'visible') {
        // Loop pausado — reiniciar
        if (drawHandle) cancelAnimationFrame(drawHandle);
        window._lastDrawTs = Date.now();
        drawHandle = requestAnimationFrame(draw);
      }
    }, 1000);
  }
}

// Función pública para forzar reanudación del draw loop
function ensureDrawLoopAlive() {
  const canvas = $('captureCanvas');
  if (!canvas) return;
  // Si el último frame es de hace más de 500ms, kick-start
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

// Canvas pipeline removed in v3.10.8 — see startCamera comments.

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
  // v3.11.19: timer muestra TOTAL acumulado (segmentos previos + segmento actual si está grabando)
  const isRecording = mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused');
  let currentMs = 0;
  if (isRecording && recStart) {
    const now = recPausedAt > 0 ? recPausedAt : Date.now();
    currentMs = Math.max(0, now - recStart - recPausedAccum);
  }
  const total = segmentsTotalMs + currentMs;
  $('timer').textContent = fmtTime(total);
}

let recPausedAccum = 0; // ms acumulados en pausa para que el timer siga siendo realista
let recPausedAt = 0;
// v3.11.19: total grabado a través de TODOS los segmentos (para timer global)
let segmentsTotalMs = 0;
// Flag para distinguir cuando el stop fue manual (continuar) vs final (preview)
let _finishingForPreview = false;

function updateMultiSegmentUI() {
  const undoBtn = document.getElementById('btnUndo');
  const doneBtn = document.getElementById('btnDone');
  const previewBtn = document.getElementById('btnPreviewLast');
  const clipsInd = document.getElementById('clipsIndicator');
  const isRecording = mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused');
  const hasSegments = recordedSegments.length > 0;
  if (undoBtn) undoBtn.style.display = (hasSegments && !isRecording) ? '' : 'none';
  if (doneBtn) doneBtn.style.display = (hasSegments && !isRecording) ? '' : 'none';
  if (previewBtn) previewBtn.style.display = (hasSegments && !isRecording) ? '' : 'none';
  if (clipsInd) {
    if (hasSegments) {
      clipsInd.style.display = 'block';
      clipsInd.textContent = recordedSegments.length + ' CLIP' + (recordedSegments.length === 1 ? '' : 'S');
    } else {
      clipsInd.style.display = 'none';
    }
  }
  renderRecordRing();
}

// Anillo de progreso TikTok-style alrededor del botón rojo. Un arco por clip.
function renderRecordRing() {
  const ring = document.getElementById('recordBtnRing');
  const recBtn = document.getElementById('btnRecord');
  if (!ring || !recBtn) return;
  const N = recordedSegments.length;
  recBtn.classList.toggle('has-segments', N > 0);
  if (N === 0) {
    ring.setAttribute('stroke-dasharray', '0 1000');
    return;
  }
  const radius = 46;
  const circumference = 2 * Math.PI * radius; // ~289
  // Gap angular fijo entre segmentos (en pixels del SVG viewBox)
  const gap = N === 1 ? 0 : 4;
  const segLen = (circumference - N * gap) / N;
  // Pattern: [seg, gap] repite hasta completar circumference. JS necesita
  // listar todos los pares para asegurar que no haya fracción wraparound.
  const pattern = [];
  for (let i = 0; i < N; i++) {
    pattern.push(Math.max(0.5, segLen));
    pattern.push(gap);
  }
  ring.setAttribute('stroke-dasharray', pattern.join(' '));
  ring.setAttribute('stroke-dashoffset', '0');
}

function startRecording() {
  const canvas = $('captureCanvas');
  if (!canvas || !audioTrack) return;
  // v3.11.27: chunks locales por recording (closure) en vez de globales.
  // Antes: si el usuario tapeaba Record (stop) → Record (start) rápido, el
  // segundo startRecording reseteaba recordedChunks=[] ANTES de que el onstop
  // del primer clip procesara la data. El primer clip quedaba con array vacío.
  // Ahora cada recording captura SU PROPIO array vía closure.
  const chunks = [];
  recordedChunks = chunks; // expone globalmente por compatibilidad
  recPausedAccum = 0;
  recPausedAt = 0;
  const mime = pickMime();
  recordedMime = mime || 'video/webm';
  const localMime = recordedMime;
  let localStart = 0;

  // Forzar dimensiones del canvas justo antes — iOS Safari puede evaluar
  // tamaño en este momento.
  if (canvas.width !== TARGET_W || canvas.height !== TARGET_H) {
    canvas.width = TARGET_W;
    canvas.height = TARGET_H;
  }
  // captureStream del canvas — track de video 1080×1920 que MediaRecorder graba.
  // v3.11.23: 60 fps (antes 30) para movimiento más fluido. Si el celular no
  // puede sostenerlo, captureStream baja automáticamente.
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
    // v3.11.23: bitrate 10 Mbps (antes 6) para mejor calidad visual. La cámara
    // nativa del iPhone graba a ~30-100 Mbps; 10 Mbps es lo más alto que
    // MediaRecorder maneja confiablemente sin saturar en celulares modestos.
    mediaRecorder = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: 10_000_000 } : { videoBitsPerSecond: 10_000_000 });
  } catch (e) {
    console.error('[rec] new MediaRecorder failed', e);
    alert('No se pudo iniciar la grabación: ' + e.message);
    return;
  }
  mediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
  mediaRecorder.onstop = async () => {
    // v3.11.27: usar chunks LOCAL (closure) — inmune a startRecording races.
    // Para duración, leer el GLOBAL recPausedAccum y recPausedAt en el momento
    // del stop (antes de que startRecording los pueda resetear).
    const blob = new Blob(chunks, { type: localMime });
    if (blob.size > 0) {
      const endTs = (recPausedAt > 0 ? recPausedAt : Date.now());
      const segmentMs = Math.max(0, endTs - localStart - recPausedAccum);
      recordedSegments.push({ blob, mime: localMime, durationMs: segmentMs });
      segmentsTotalMs += segmentMs;
      recordedBlob = blob;
    }
    if (_pendingSwapAfterStop) {
      const { facing } = _pendingSwapAfterStop;
      _pendingSwapAfterStop = null;
      await _doStartCamera(facing);
      startRecording();
      return;
    }
    if (_finishingForPreview) {
      _finishingForPreview = false;
      showPreview();
    } else {
      updateMultiSegmentUI();
    }
  };
  mediaRecorder.start(1000);
  recStart = Date.now();
  localStart = recStart;
  $('btnRecord').classList.add('recording');
  $('timer').classList.add('active');
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(updateTimer, 250);
  updateMultiSegmentUI();
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
  if (timerHandle) clearInterval(timerHandle);
  // updateMultiSegmentUI corre desde onstop (que ya guardó el segmento)
}

function showPreview() {
  const url = URL.createObjectURL(recordedBlob);
  const v = $('recordedPreview');
  v.src = url;
  v.load();
  show('screenPreview');
  const banner = $('dimBanner');
  const N = recordedSegments.length;
  if (banner) {
    if (N > 1) {
      banner.textContent = `📹 ${N} clips · se unirán en un solo video al enviar`;
      banner.classList.remove('bad');
    } else {
      banner.textContent = '⏳ Midiendo dimensiones del archivo...';
    }
  }
  if (typeof _updatePreviewButtons === 'function') _updatePreviewButtons();
  // Diagnóstico: medir dimensiones reales del archivo grabado (solo si es 1 clip).
  let measured = false;
  const measure = () => {
    if (measured || N > 1) return; // si hay multi-clip, no sobreescribir el banner
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return;
    measured = true;
    const ratio = (w / h).toFixed(3);
    const isPortrait916 = Math.abs((w / h) - 0.5625) < 0.01;
    if (banner) {
      banner.textContent = `📁 Archivo: ${w}×${h} ${isPortrait916 ? '✓ 9:16' : '⚠ NO 9:16 (' + ratio + ')'}`;
      banner.classList.toggle('bad', !isPortrait916);
    }
  };
  v.addEventListener('loadedmetadata', measure);
  v.addEventListener('canplay', measure);
  setTimeout(measure, 1500);
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
// ===== Concat multi-clip con ffmpeg.wasm (v3.11.32) =====
// Carga ffmpeg.wasm 0.11.6 dinámicamente cuando hay >1 clips y los une en
// UN solo MP4 antes de subir. Cache forever en el browser después del primer
// load (~25MB initial). Stream-copy (sin re-encode), súper rápido.
let _ffmpegInstance = null;
let _ffmpegLoading = null;

async function loadFFmpeg(onProgress) {
  if (_ffmpegInstance) return _ffmpegInstance;
  if (_ffmpegLoading) return _ffmpegLoading;
  _ffmpegLoading = (async () => {
    // Cargar el wrapper JS via <script>
    if (typeof FFmpeg === 'undefined') {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('No se pudo cargar ffmpeg.wasm'));
        document.head.appendChild(s);
      });
    }
    if (typeof FFmpeg === 'undefined' || !FFmpeg.createFFmpeg) {
      throw new Error('FFmpeg lib no expuso createFFmpeg');
    }
    const ffmpeg = FFmpeg.createFFmpeg({
      corePath: 'https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
      log: false,
      progress: (p) => {
        if (typeof onProgress === 'function') onProgress(Math.round((p.ratio || 0) * 100));
      }
    });
    await ffmpeg.load();
    _ffmpegInstance = ffmpeg;
    return ffmpeg;
  })().catch((e) => {
    _ffmpegLoading = null;
    throw e;
  });
  return _ffmpegLoading;
}

async function concatClipsWithFFmpeg(segments, onPhaseUpdate) {
  if (typeof onPhaseUpdate === 'function') onPhaseUpdate('Cargando ffmpeg...');
  const ffmpeg = await loadFFmpeg();
  const fetchFile = FFmpeg.fetchFile;
  if (typeof onPhaseUpdate === 'function') onPhaseUpdate('Preparando clips...');
  // Determinar extensión del primer clip
  const firstMime = segments[0].mime || '';
  const ext = firstMime.includes('mp4') ? 'mp4' : 'webm';
  for (let i = 0; i < segments.length; i++) {
    const data = await fetchFile(segments[i].blob);
    ffmpeg.FS('writeFile', `clip${i}.${ext}`, data);
  }
  const list = segments.map((_, i) => `file 'clip${i}.${ext}'`).join('\n');
  ffmpeg.FS('writeFile', 'list.txt', new TextEncoder().encode(list));
  if (typeof onPhaseUpdate === 'function') onPhaseUpdate('Uniendo clips...');
  // Stream-copy: no re-encode (porque todos los clips tienen mismo codec/dim)
  await ffmpeg.run('-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', `output.${ext}`);
  const output = ffmpeg.FS('readFile', `output.${ext}`);
  // Cleanup virtual FS
  try {
    for (let i = 0; i < segments.length; i++) ffmpeg.FS('unlink', `clip${i}.${ext}`);
    ffmpeg.FS('unlink', 'list.txt');
    ffmpeg.FS('unlink', `output.${ext}`);
  } catch (_) {}
  return new Blob([output.buffer], { type: firstMime || `video/${ext}` });
}

async function uploadAndCommit() {
  // v3.11.32: si hay multi-clip, unirlos en UN solo video con ffmpeg.wasm
  // antes de subir. Subir UN solo archivo a Cloudinary. Fallback: si ffmpeg
  // falla por cualquier motivo, subir cada clip separado como antes.
  const segments = recordedSegments.length > 0 ? recordedSegments : (recordedBlob ? [{ blob: recordedBlob, mime: recordedMime }] : []);
  if (segments.length === 0) return;
  show('screenUploading');
  $('progressFill').style.width = '0%';
  $('uploadPct').textContent = '0%';
  reportStatus('uploading');
  try {
    let blobToUpload, mimeToUpload, ffmpegUsed = false;
    if (segments.length === 1) {
      blobToUpload = segments[0].blob;
      mimeToUpload = segments[0].mime;
    } else {
      // Multi-clip → intentar concat client-side
      try {
        $('uploadPct').textContent = '🔄 Cargando ffmpeg (primera vez ~25MB)...';
        const merged = await concatClipsWithFFmpeg(segments, (msg) => {
          $('uploadPct').textContent = '🔄 ' + msg;
        });
        blobToUpload = merged;
        mimeToUpload = merged.type || segments[0].mime;
        ffmpegUsed = true;
      } catch (concatErr) {
        // FFmpeg falló — intentar naive Blob concat como segundo fallback
        // (puede funcionar para WebM, raramente para MP4)
        console.warn('[upload] ffmpeg concat failed:', concatErr);
        const errMsg = (concatErr && concatErr.message) || String(concatErr);
        try {
          $('uploadPct').textContent = '⚠ ffmpeg falló — probando concat simple...';
          const naive = new Blob(segments.map(s => s.blob), { type: segments[0].mime });
          blobToUpload = naive;
          mimeToUpload = naive.type || segments[0].mime;
          ffmpegUsed = false;
          showDebug('⚠ ffmpeg falló: ' + errMsg.slice(0, 80) + ' — usando concat simple');
        } catch (naiveErr) {
          // Todo falló — subir solo el último clip + mostrar error visible
          blobToUpload = segments[segments.length - 1].blob;
          mimeToUpload = segments[segments.length - 1].mime;
          showDebug('⚠ Concat falló — solo el último clip subido. Error: ' + errMsg.slice(0, 60));
        }
      }
    }

    $('uploadPct').textContent = 'Subiendo a Cloudinary...';
    const r = await uploadToCloudinaryBlob(blobToUpload, mimeToUpload, (pct) => {
      $('progressFill').style.width = pct + '%';
      $('uploadPct').textContent = pct + '%';
    });

    const updateData = {
      status: 'completed',
      videoUrl: r.secure_url,
      videoBytes: r.bytes || null,
      videoFormat: r.format || null,
      videoDuration: r.duration || null,
      videoWidth: r.width || null,
      videoHeight: r.height || null,
      completedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (ffmpegUsed && segments.length > 1) {
      updateData.mergedFrom = segments.length; // metadata: cuántos clips fueron unidos
    }
    await sessionRef.update(updateData);
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
  // v3.11.19: tap = start segment / stop segment (NO pasa a preview).
  // El usuario debe apretar Done (✓) para terminar y previsualizar.
  if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
    stopRecording();
  } else {
    startRecording();
  }
});

$('btnUndo').addEventListener('click', () => {
  // v3.11.20: SIN confirm() — confirm() en iOS Safari pausa el rAF del canvas
  // y a veces no se reanuda, congelando la cámara. Pop instantáneo.
  if (recordedSegments.length === 0) return;
  const removed = recordedSegments.pop();
  if (removed && typeof removed.durationMs === 'number') {
    segmentsTotalMs = Math.max(0, segmentsTotalMs - removed.durationMs);
  }
  updateTimer();
  updateMultiSegmentUI();
  // Defensive: reanudar el draw loop por si quedó pausado por algún motivo
  ensureDrawLoopAlive();
  showDebug('↶ Clip eliminado · ' + recordedSegments.length + ' restante' + (recordedSegments.length === 1 ? '' : 's'));
});

$('btnDone').addEventListener('click', () => {
  // Si está grabando, marcar para preview en el onstop. Sino, ir directo.
  if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
    _finishingForPreview = true;
    stopRecording();
  } else if (recordedSegments.length > 0) {
    showPreview();
  }
});

// ===== Quick preview overlay con lista de clips (v3.11.22) =====
// Permite ver cada clip individualmente, eliminar selectivamente, y reproducir
// todos seguidos (playlist). Estilo Instagram/TikTok native camera.
let _qpCurrentIdx = -1;     // índice del clip actualmente reproduciéndose
let _qpPlaylistMode = false; // true = reproducir todos seguidos
let _qpPlaylistIdx = 0;

function _qpRevokeObjectUrl(video) {
  if (video && video.dataset.objectUrl) {
    try { URL.revokeObjectURL(video.dataset.objectUrl); } catch (e) {}
    delete video.dataset.objectUrl;
  }
}

function renderQuickPreviewClips() {
  const container = $('quickPreviewClips');
  if (!container) return;
  const N = recordedSegments.length;
  if (N === 0) {
    container.innerHTML = '<div style="text-align:center;color:#666;padding:20px">Sin clips</div>';
    return;
  }
  container.innerHTML = recordedSegments.map((s, i) => {
    const sec = Math.round((s.durationMs || 0) / 1000);
    const playing = (i === _qpCurrentIdx) ? ' playing' : '';
    return `
      <div class="qp-clip${playing}" data-clip-idx="${i}">
        <div class="qp-clip-num">${i + 1}</div>
        <div class="qp-clip-info">
          <div class="qp-clip-title">Clip ${i + 1}</div>
          <div class="qp-clip-dur">${sec}s</div>
        </div>
        <button class="qp-clip-btn play" data-qp-play="${i}" title="Reproducir">▶</button>
        <button class="qp-clip-btn del" data-qp-del="${i}" title="Eliminar este clip">🗑</button>
      </div>
    `;
  }).join('');
  container.querySelectorAll('[data-qp-play]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); qpPlayClip(parseInt(btn.dataset.qpPlay, 10)); });
  });
  container.querySelectorAll('[data-qp-del]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); qpDeleteClip(parseInt(btn.dataset.qpDel, 10)); });
  });
}

function qpPlayClip(idx, playlistMode) {
  const seg = recordedSegments[idx];
  if (!seg || !seg.blob) return;
  const video = $('quickPreviewVideo');
  if (!video) return;
  _qpRevokeObjectUrl(video);
  const url = URL.createObjectURL(seg.blob);
  video.src = url;
  video.dataset.objectUrl = url;
  _qpCurrentIdx = idx;
  _qpPlaylistMode = !!playlistMode;
  if (_qpPlaylistMode) _qpPlaylistIdx = idx;
  // Info
  const info = $('quickPreviewInfo');
  if (info) {
    const sec = Math.round((seg.durationMs || 0) / 1000);
    info.textContent = `Reproduciendo clip ${idx + 1} de ${recordedSegments.length} · ${sec}s${_qpPlaylistMode ? ' · modo playlist' : ''}`;
  }
  video.onended = () => {
    if (_qpPlaylistMode) {
      const next = _qpPlaylistIdx + 1;
      if (next < recordedSegments.length) qpPlayClip(next, true);
      else { _qpPlaylistMode = false; _qpCurrentIdx = -1; renderQuickPreviewClips(); }
    } else {
      _qpCurrentIdx = -1;
      renderQuickPreviewClips();
    }
  };
  renderQuickPreviewClips();
  setTimeout(() => video.play().catch(() => {}), 50);
}

function qpDeleteClip(idx) {
  if (idx < 0 || idx >= recordedSegments.length) return;
  const removed = recordedSegments.splice(idx, 1)[0];
  if (removed && typeof removed.durationMs === 'number') {
    segmentsTotalMs = Math.max(0, segmentsTotalMs - removed.durationMs);
  }
  // Si estábamos reproduciendo el clip eliminado, parar
  if (_qpCurrentIdx === idx) {
    const video = $('quickPreviewVideo');
    if (video) { try { video.pause(); } catch (e) {} _qpRevokeObjectUrl(video); video.src = ''; }
    _qpCurrentIdx = -1;
    _qpPlaylistMode = false;
  } else if (_qpCurrentIdx > idx) {
    _qpCurrentIdx -= 1;
  }
  updateTimer();
  renderQuickPreviewClips();
  updateMultiSegmentUI();
  // Si no quedan clips, cerrar el overlay
  if (recordedSegments.length === 0) {
    qpClose();
  }
}

function qpOpen() {
  if (recordedSegments.length === 0) return;
  const overlay = $('quickPreview');
  if (!overlay) return;
  _qpCurrentIdx = -1;
  _qpPlaylistMode = false;
  overlay.style.display = 'flex';
  const info = $('quickPreviewInfo');
  if (info) info.textContent = `${recordedSegments.length} clip${recordedSegments.length === 1 ? '' : 's'} grabado${recordedSegments.length === 1 ? '' : 's'} · tap ▶ para ver`;
  // Por defecto cargar el último clip pero NO reproducir auto
  const last = recordedSegments[recordedSegments.length - 1];
  const video = $('quickPreviewVideo');
  if (video && last) {
    _qpRevokeObjectUrl(video);
    const url = URL.createObjectURL(last.blob);
    video.src = url;
    video.dataset.objectUrl = url;
  }
  renderQuickPreviewClips();
}

function qpClose() {
  const overlay = $('quickPreview');
  const video = $('quickPreviewVideo');
  if (video) {
    try { video.pause(); } catch (e) {}
    _qpRevokeObjectUrl(video);
    video.src = '';
  }
  _qpCurrentIdx = -1;
  _qpPlaylistMode = false;
  if (overlay) overlay.style.display = 'none';
  ensureDrawLoopAlive();
}

$('btnPreviewLast').addEventListener('click', qpOpen);
$('quickPreviewClose').addEventListener('click', qpClose);
$('quickPreviewPlayAll').addEventListener('click', () => {
  if (recordedSegments.length === 0) return;
  qpPlayClip(0, true);
});

$('btnPlayPause').addEventListener('click', tpPlayPause);

$('btnCancel').addEventListener('click', () => {
  const isRecording = mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused');
  const hasClips = recordedSegments.length > 0;
  if (isRecording || hasClips) {
    if (!confirm('Cancelar TODA la grabación? Se eliminarán todos los clips.')) return;
    if (isRecording) {
      _finishingForPreview = false;
      try { mediaRecorder.stop(); } catch (e) {}
    }
    recordedSegments = [];
    segmentsTotalMs = 0;
    recordedBlob = null;
    if ($('timer')) $('timer').textContent = '00:00';
    updateMultiSegmentUI();
  }
  show('screenRecord');
});

$('btnRetake').addEventListener('click', () => {
  // v3.11.19: retake = empezar de cero. Eliminar TODOS los clips.
  recordedBlob = null;
  recordedSegments = [];
  segmentsTotalMs = 0;
  if ($('timer')) $('timer').textContent = '00:00';
  updateMultiSegmentUI();
  show('screenRecord');
});

// v3.11.25: en el preview, mostrar/ocultar botón "Ver todos" si hay multi-clips
function _updatePreviewButtons() {
  const btn = document.getElementById('btnViewClips');
  if (btn) btn.style.display = (recordedSegments.length > 1) ? '' : 'none';
}
const _btnViewClips = document.getElementById('btnViewClips');
if (_btnViewClips) _btnViewClips.addEventListener('click', () => qpOpen());
$('btnUpload').addEventListener('click', uploadAndCommit);
$('btnSaveLocal').addEventListener('click', () => saveLocally($('btnSaveLocal')));
$('btnSaveLocalAfter').addEventListener('click', () => saveLocally($('btnSaveLocalAfter')));

// Guarda el video en el celular del usuario. En iOS Safari (donde el download
// directo a veces NO funciona porque iOS abre el video en lugar de bajarlo),
// usamos la Web Share API para que el usuario tenga el botón nativo "Guardar
// vídeo" en la hoja de compartir del sistema. En Android Chrome y desktop,
// el <a download> funciona y baja directo a la carpeta de descargas.
async function saveLocally(btn) {
  // v3.11.29: en iOS los <a download> en cascada solo bajan UNO (browser bloquea
  // popups). Usar Web Share API con TODOS los archivos en UN solo share — iOS
  // abre el share sheet y permite "Guardar en Fotos" todo de una.
  const segments = recordedSegments.length > 0 ? recordedSegments : (recordedBlob ? [{ blob: recordedBlob, mime: recordedMime }] : []);
  if (segments.length === 0) {
    alert('No hay video para guardar');
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const N = segments.length;
  const files = segments.map((s, i) => {
    const mime = s.mime || 'video/webm';
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const suffix = N > 1 ? `-clip${i + 1}of${N}` : '';
    return new File([s.blob], `taskmgr-${stamp}${suffix}.${ext}`, { type: mime });
  });

  // v3.11.33: en iOS, share múltiple ARCHIVOS en UN share a veces solo guarda
  // el último cuando el usuario tap "Save Video" desde la share sheet. Solución:
  // SECUENCIAL — un share por clip, el usuario confirma cada uno y van todos a Fotos.
  if (btn) { btn.disabled = true; }
  let savedCount = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (btn) btn.textContent = `⏳ ${i + 1}/${N}...`;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: file.name, text: `Clip ${i + 1} de ${N}` });
        savedCount++;
      } else {
        // Android/Desktop: <a download>
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url; a.download = file.name; a.style.display = 'none';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        savedCount++;
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (e) {
      // User canceló este clip — preguntar si quiere seguir con los demás
      if (e && e.name === 'AbortError') {
        if (i < files.length - 1) {
          const cont = confirm(`Cancelaste el clip ${i + 1}. ¿Querés seguir con los ${files.length - i - 1} restantes?`);
          if (!cont) break;
        }
      } else {
        console.warn('[saveLocally] share/download failed for', file.name, e);
      }
    }
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = savedCount === N ? `✓ ${N} guardado${N > 1 ? 's' : ''}` : `${savedCount}/${N} guardados`;
    setTimeout(() => { btn.textContent = '💾 Guardar'; }, 2200);
  }
}

async function saveSingleBlob(blob, mime, idx, total, btn) {
  const ext = (mime || '').includes('mp4') ? 'mp4' : 'webm';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = total > 1 ? `-clip${idx}of${total}` : '';
  const filename = `taskmgr-${stamp}${suffix}.${ext}`;
  const file = new File([blob], filename, { type: mime || 'video/webm' });

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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (btn && total === 1) { btn.textContent = '✓ Descargado'; setTimeout(() => { btn.textContent = '💾 Guardar'; }, 1800); }
  } catch (e) {
    console.error('[saveLocally] download failed', e);
    if (total === 1) alert('No se pudo guardar el archivo: ' + e.message);
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
