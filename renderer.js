// ===== STATE =====
let currentUser = null;
let currentUserData = null;
let tasks = [];
let trashTasks = [];
let projects = [];
let teamMembers = [];
let personalTasks = [];
let trashPersonalTasks = [];
let personalProjectsList = []; // proyectos custom del usuario (no incluye 'General')
let currentPersonalProject = 'General';
let lastInteractedProject = null; // {id, name} del ultimo proyecto de equipo tocado por el usuario
let alwaysOnTop = true;
let currentTab = 'main';
let unsubscribeTasks = null;
let unsubscribeProjects = null;
let unsubscribeUsers = null;
let unsubscribePersonal = null;
let unsubscribeNotifQueue = null;
let unsubscribeChat = null;
let chatNotificationsArmed = false; // skip sonido en la primera carga

// ===== TEMA DE INTERFAZ =====
// 3 temas disponibles: 'default' (morado oscuro), 'dark' (negro puro), 'light' (claro).
// Se guarda por usuario en localStorage. Aplicacion en tiempo real.
const THEME_KEY = 'app-theme';
function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'default'; } catch (e) { return 'default'; }
}
function applyTheme(theme) {
  const valid = ['default', 'dark', 'light'];
  if (!valid.includes(theme)) theme = 'default';
  // Aplicar la clase a documentElement (html) Y a body — algunos sistemas
  // (especialmente Windows) parecen dar resultados inconsistentes con solo body.
  document.documentElement.classList.remove('theme-default', 'theme-dark', 'theme-light');
  document.documentElement.classList.add(`theme-${theme}`);
  document.body.classList.remove('theme-default', 'theme-dark', 'theme-light');
  document.body.classList.add(`theme-${theme}`);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  // Marcar el boton activo en settings
  document.querySelectorAll('.theme-option').forEach(btn => {
    if (btn.dataset.theme === theme) {
      btn.style.borderColor = 'var(--accent)';
      btn.style.background = 'rgba(108,99,255,0.1)';
    } else {
      btn.style.borderColor = 'var(--border)';
      btn.style.background = '';
    }
  });
  // Propagar el cambio a las ventanas de chat y deposito (si existen)
  try {
    if (window.api && window.api.broadcastTheme) {
      window.api.broadcastTheme(theme);
    }
  } catch (e) { /* ignore */ }
}
// Aplicar el tema guardado lo antes posible (evita flash de tema incorrecto)
applyTheme(getTheme());
// Wireup de los botones de seleccion de tema (cuando el DOM este listo)
function wireThemeButtons() {
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });
  applyTheme(getTheme()); // refresca el estilo activo
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireThemeButtons);
} else {
  wireThemeButtons();
}

// ===== "QUE HAY NUEVO" — modal de changelog tras actualizar =====
// Mapea version -> { title, features }. CADA vez que publiquemos una nueva
// version DEBE agregarse una entrada aqui — al abrir la app, los usuarios veran
// las novedades de TODAS las versiones publicadas desde la ultima que vieron
// (acumulado, ordenado de mas nueva a mas vieja).
const APP_CHANGELOG = {
  '3.11.83': {
    title: 'Webhook ahora via Cloudflare Pages Functions (auto-deploy desde GitHub)',
    features: [
      '🚀 <strong>Cloudflare Pages Functions en lugar de Worker manual</strong>: como ya tenías tu repo conectado a CF Pages, ahora los endpoints del webhook viven en <code>/functions/manychat/</code> del repo. Cada vez que pusheás a main, CF Pages re-deploya automáticamente. Cero copy/paste manual.',
      '📂 <strong>Reestructura</strong>: Firebase Functions movido de <code>functions/</code> → <code>firebase-functions/</code> (firebase.json actualizado). <code>functions/</code> queda libre para CF Pages.',
      '🔌 <strong>URLs nuevas</strong> (tu domain de Pages):<br>• <code>GET /</code> — health check<br>• <code>POST /manychat/inbound?biz=BIZ_ID&ws=WS_ID</code> — recibe DMs<br>• <code>POST /manychat/outbound</code> — envía respuesta a ManyChat'
    ]
  },
  '3.11.82': {
    title: '📲 Fase 3a — Instagram DMs reales via ManyChat → Cloudflare Worker → App',
    features: [
      '🌐 <strong>Cloudflare Worker creado</strong>: archivo <code>chatbot-worker.js</code> en el repo. Recibe webhooks de ManyChat (DMs de Instagram) y los escribe en Firestore. La app los lee en tiempo real automáticamente.',
      '🎯 <strong>Listener inbox en la app</strong>: cuando llega un DM nuevo, la app lo procesa: busca o crea el lead, agrega el mensaje, marca el inbox doc como procesado. Todo automático.',
      '📋 <strong>Cómo deployar el Worker (10 min, una vez)</strong>:<br>1) Andá a dash.cloudflare.com → registrate gratis<br>2) Workers & Pages → Create application → Create Worker<br>3) Nombrá "task-manager-chatbot" → Deploy<br>4) Edit code → reemplazá todo con el contenido de <code>chatbot-worker.js</code> (lo tenés en el repo del proyecto)<br>5) Save and deploy<br>6) Tu URL queda algo como <code>https://task-manager-chatbot.tu-usuario.workers.dev</code>',
      '🔌 <strong>En ManyChat</strong>: tu flow del bot de IG → al final agregá una acción "External Request" → POST a tu URL del Worker + <code>/manychat/inbound?biz=BUSINESS_ID&ws=WORKSPACE_ID</code>. ManyChat manda los DMs automáticamente.',
      '⚠ <strong>Fase 3b (próxima)</strong>: el bot va a responder solo via Groq + mandar la respuesta de vuelta a ManyChat → Instagram. Por ahora los mensajes llegan a la app, vos respondés manualmente o usás la simulación.',
      '🔐 <strong>IMPORTANTE actualizá Firestore Rules</strong>: agregá la regla <code>webhookInbox</code> que está en el repo (allow create: if true, lectura solo signed-in). Sin eso el Worker no puede escribir.'
    ]
  },
  '3.11.81': {
    title: '🧠 Fase 2 — el bot responde solo con IA real (Groq) usando base de conocimiento',
    features: [
      '🤖 <strong>Bot conectado a Groq</strong>: cuando escribís un mensaje simulando ser el lead, el bot responde solo usando la misma key de Groq que ya tenés configurada. Modelo default: Llama 3.3 70B (rápido, gratis).',
      '📚 <strong>Base de conocimiento del negocio</strong>: nueva sección en "⚙ Configurar bot" donde pegás toda la info del negocio (servicios, precios, FAQs, casos de éxito, horarios, link de Calendly). El bot la usa como contexto en cada respuesta.',
      '⚙ <strong>System prompt + KB + contexto del lead</strong>: el bot recibe en cada turno: tu system prompt, la base de conocimiento, el handle/etapa/score del lead actual, y los últimos 12 mensajes de la conversación. Eso le da memoria de la charla y conocimiento del negocio.',
      '✏️ <strong>Indicador "escribiendo..."</strong> mientras el bot piensa. Latencia típica con Llama 3.3 70B: 1-3 segundos.',
      '🎯 <strong>Cómo probarlo</strong>: 1) Ir a "⚙ Configurar bot" → llenar Base de conocimiento → Guardar. 2) Volver a Conversaciones, crear lead. 3) Escribí "Hola, vi tu reel" → vas a recibir respuesta real del bot adaptada a tu negocio.',
      '⚠ <strong>Próxima Fase 3</strong>: integrar Google Calendar para que el bot consulte disponibilidad real y agende citas cuando el lead lo pida.'
    ]
  },
  '3.11.80': {
    title: 'Fix Bot IA — modal nativo + Firestore rules para chatbot',
    features: [
      '🩹 <strong>Fix "No me crea negocio"</strong>: el botón usaba <code>prompt()</code> del browser, que Electron bloquea dentro de iframes por seguridad. Reemplazado por un modal inline propio (mismo estilo que el resto de la app).',
      '🔐 <strong>Firestore rules agregadas</strong> para las 6 colecciones del chatbot (chatbotBusinesses, chatbotLeads, chatbotMessages, chatbotConfig, chatbotKnowledgeBase, chatbotAppointments). <strong>IMPORTANTE</strong>: tenés que aplicar las nuevas rules manualmente en Firebase Console (te paso los pasos abajo).',
      '✅ <strong>Resultado</strong>: ahora podés crear negocios y leads desde el botón, los datos se guardan en Firestore correctamente. Volvé a probar después de aplicar las rules.'
    ]
  },
  '3.11.79': {
    title: '🧠 Botón "Bot IA" agregado en la sidebar (no en los tabs arriba)',
    features: [
      '🩹 <strong>Fix UI</strong>: la v3.11.78 puso el botón "Bot IA" en la barra de tabs arriba, pero la app usa una sidebar de íconos a la izquierda (donde están Chat, ManyChat, Meet, etc.). Ahora el botón aparece en la sidebar justo después de ManyChat.',
      '🧠 <strong>Para encontrarlo</strong>: sidebar izquierda → ícono 🧠 con label "Bot IA". Click → entra a la interfaz estilo Monetízalo OS.',
      '🛣 <strong>Roadmap completo</strong> después de Fase 1 (esta):<br>• Fase 2: el bot responde con IA real (Groq/Claude) + base de conocimiento del negocio (RAG)<br>• Fase 3: integración con Google Calendar — el bot ve disponibilidad real y agenda<br>• Fase 4: webhook Instagram Graph API para que los DMs reales lleguen automáticamente'
    ]
  },
  '3.11.78': {
    title: '🤖 Bot IA — Fase 1: dashboard chatbot estilo Monetízalo OS',
    features: [
      '🎬 <strong>Nuevo tab "Bot IA"</strong> en la sidebar (al lado de Config). Layout estilo Monetízalo OS: 4 columnas — Negocios | Leads | Chat | Profile.',
      '💬 <strong>Conversaciones</strong>: creás "negocios bot" (ej. "Mi Agencia", "Cliente X"), dentro de cada uno simulás leads de Instagram con sus mensajes. Cada lead tiene funnel stage (Bienvenida → Calificación → Propuesta → Agendado), score 0-100%, y profile editable.',
      '🎯 <strong>Acciones por lead</strong>: 📅 Forzar agendado · ▶ Siguiente etapa · ↶ Reset · 🗑 Eliminar. Funnel checkmarks visuales que se llenan a medida que el lead avanza.',
      '⚙ <strong>Configurar bot</strong>: tercera pestaña dentro del Bot IA con tres campos editables y guardables — system prompt, link de Calendly, modelo IA a usar (Groq Llama 3.3 70B / Llama 3.1 8B / Claude Haiku).',
      '⚠ <strong>Fase 1 honesta</strong>: solo el dashboard + leads/mensajes manuales. Sin IA real todavía (los mensajes "bot" son placeholders). <strong>Fase 2</strong> (próxima): el bot responde solo usando Groq/Claude. <strong>Fase 3</strong>: webhook real de Instagram para que los DMs vivos lleguen acá.',
      '📊 <strong>Datos en Firestore</strong>: <code>chatbotBusinesses</code>, <code>chatbotLeads</code>, <code>chatbotMessages</code>, <code>chatbotConfig</code> — todos scoped al workspace activo.'
    ]
  },
  '3.11.77': {
    title: '👥 Botón "Miembros" en cada workspace — agregá al equipo sin invitaciones',
    features: [
      '🎯 <strong>Nueva acción</strong>: en el selector de workspaces, cada workspace ahora tiene un botón <strong>👥</strong> (junto a renombrar ✎ y eliminar ✕). Click → modal con la lista de miembros actuales + dropdown para agregar cualquiera del equipo.',
      '⚡ <strong>Cómo agregar a los chicos al workspace correcto</strong>:<br>1) Click en el selector de workspace arriba a la izquierda<br>2) Cada workspace tiene tres botones a la derecha: 👥 ✎ ✕<br>3) Click 👥 sobre el workspace donde tenés el contenido (ej. "Agencia")<br>4) En el dropdown "Agregar miembro", elegí a cada miembro del equipo y click "Agregar"<br>5) Listo. Ellos abren su app, click en el selector de workspace, eligen "Agencia" y ven todo.',
      '🗑 <strong>Quitar miembros</strong>: también podés sacar a alguien del workspace con el botón "Quitar" al lado del nombre. Excepto al dueño del workspace (vos).',
      '🚫 <strong>Limitación</strong>: solo el dueño del workspace o un admin puede gestionar miembros. Si no ves el botón 👥, no tenés permisos sobre ese workspace.'
    ]
  },
  '3.11.76': {
    title: 'Fix dropdown migración cuando los workspaces todavía no cargaron',
    features: [
      '🩹 <strong>Bug fix</strong>: el dropdown de migrar workspaces se poblaba a los 1500ms del page load. Si Firebase tarda más en cargar la lista (network lento, primera vez), solo aparecía 1 workspace y no se podía elegir destino. Ahora reintenta cada 2s hasta tener 2+ workspaces visibles, y también se re-puebla al abrir Settings.',
      '💡 <strong>Alternativa más simple (recomendada antes de migrar)</strong>: si el equipo está en otro workspace, invitalos al tuyo en lugar de migrar contenido. Cambiá al workspace correcto → menú workspace → invitar miembros → ellos aceptan → se cambian al workspace tuyo → ya ven todo. Sin migración.'
    ]
  },
  '3.11.75': {
    title: '🔀 Migrar contenido entre workspaces — consolidar al equipo en uno solo',
    features: [
      '🎯 <strong>Solución al "yo subo y los chicos no ven"</strong>: en Settings hay un nuevo panel admin "🔀 Migrar contenido entre workspaces". Elegís un workspace origen y otro destino, le das click, y la app mueve TODO (entries del depósito, categorías, tareas, proyectos, programaciones, mensajes de chat) al destino.',
      '⚙ <strong>Cómo usarlo</strong>:<br>1) Settings → "Migrar contenido entre workspaces"<br>2) Source: el workspace donde estaba el contenido (ej. "Prueba de Cliente")<br>3) Target: el workspace al que querés mover todo (ej. "Agencia")<br>4) Click "Migrar"<br>5) Confirmá (es irreversible)<br>6) Decíles a los chicos que cambien al workspace destino — los ven al toque.',
      '🚀 <strong>Después de la migración</strong>: todos los miembros del equipo eligen el mismo workspace en el selector arriba a la izquierda y ven lo mismo. Para nuevos miembros: marcá ese workspace como "default" desde el menú de workspaces para que entren ahí automáticamente.'
    ]
  },
  '3.11.74': {
    title: 'FIX CRÍTICO: DoH no funcionaba en realidad (TLS SNI roto) — ahora SÍ',
    features: [
      '🐛 <strong>Bug grande encontrado y arreglado</strong>: el DoH (DNS over HTTPS) que agregué en v3.11.71 estaba conectando al IP 1.1.1.1 sin setear el SNI del TLS handshake. El cert de Cloudflare es para <code>cloudflare-dns.com</code>, no para la IP — así que el TLS fallaba silenciosamente y caíamos al DNS del sistema bloqueado. Por eso los chicos en Venezuela seguían viendo ENOTFOUND aunque estuvieran en v3.11.73.',
      '✅ <strong>Fix</strong>: agregué <code>servername</code> explícito en las requests al resolver DoH. Ahora el TLS handshake es correcto. Cloudflare devuelve los IPs reales y la app puede conectarse a snapinsta, fastdl, etc.',
      '🛡 <strong>3 servidores DoH en cascada</strong>: si Cloudflare 1.1.1.1 está bloqueado en la red, intenta Google 8.8.8.8, después Quad9 9.9.9.9. Solo si los tres fallan, cae al DNS del sistema.',
      '🩺 <strong>Más logging</strong>: si por algún motivo todos los DoH fallan, queda registrado en la consola del DevTools para diagnosticar.',
      '🎯 <strong>Resultado esperado</strong>: una vez que los chicos en Venezuela actualicen a v3.11.74, NO necesitan cambiar DNS ni configurar nada. La app resuelve los hostnames bloqueados por su cuenta.'
    ]
  },
  '3.11.73': {
    title: 'Diagnóstico ahora flagea OpenAI como ⚠ amarillo (bloquea VE/CU/IR)',
    features: [
      '⚠ <strong>OpenAI flageado como warning</strong>: el diagnóstico antes mostraba OpenAI configurada como ✓ verde, pero OpenAI bloquea Venezuela, Cuba e Irán por país. Ahora muestra ⚠ amarillo con explicación clara — si el equipo está en alguno de esos países, hay que reemplazar por una key de Groq.',
      '🎨 <strong>Header con conteo + estado</strong>: si hay warnings (no errores), el header dice "6/6 OK · pero con avisos ⚠" en naranja. Si hay errores reales, dice "X/6 OK · revisá los ✗" en rojo. Si todo perfecto, verde.',
      '🩺 <strong>Caso de uso real</strong>: el chico en Venezuela tenía OpenAI configurada → diagnóstico se veía 6/6 ✓ pero la transcripción fallaba. Ahora ese caso aparece como ⚠ con la solución exacta: pegar Groq.'
    ]
  },
  '3.11.72': {
    title: '🩺 Panel de Diagnóstico — cualquier user ve qué le falla en su instalación',
    features: [
      '🎯 <strong>Solución para "a uno le funciona y al otro no"</strong>: en Settings hay un botón "🩺 Ejecutar diagnóstico" que corre 6 tests automáticos y muestra exactamente qué está roto en tu instalación específica. Compartís un screenshot del resultado y sabemos al toque qué arreglar.',
      '📋 <strong>Lo que revisa</strong>:<br>1) Versión de la app (local vs última en GitHub)<br>2) Internet<br>3) API key de transcripción (configurada? Groq o OpenAI?)<br>4) Cloudinary (cloud name + upload preset)<br>5) Workspace activo<br>6) Firebase/Firestore (conexión a la BD)',
      '🛠 <strong>Cada test failed tiene un "fix" sugerido</strong>: si la versión está vieja → "Quit completo y reabrir". Si falta API key → "Settings → OpenAI API Key". Si no hay Cloudinary → "Configurar Cloudinary". Cero adivinanzas.',
      '👥 <strong>Para nuevos miembros del equipo / clientes</strong>: si algo no anda, decíles "Settings → Diagnóstico" y se autoresuelve la mayoría de los problemas comunes sin tener que preguntar.'
    ]
  },
  '3.11.71': {
    title: '🌐 DNS-over-HTTPS interno — la app bypasea los bloqueos DNS de ISP automáticamente',
    features: [
      '🎯 <strong>Fix definitivo y cero-configuración</strong>: la app ahora resuelve DNS por su cuenta usando Cloudflare 1.1.1.1 (vía DoH). Bypasea los bloqueos de DNS del ISP (Venezuela, Cuba, Irán, etc.) sin que el usuario tenga que cambiar nada en su Windows. Si Cloudflare falla, prueba Google 8.8.8.8. Si ambos fallan, fallback al DNS del sistema.',
      '⚡ <strong>Cache de 5 minutos</strong>: cada hostname resuelto se cachea para evitar latencia adicional. Las llamadas siguen siendo rápidas.',
      '🔗 <strong>Activo en TODAS las llamadas HTTP de la app</strong>: scrapers IG (snapinsta/fastdl/snapsave/igram/saveig), scraper TikTok (tikwm), Whisper/Groq API, fetcher de OG images (Microlink/tikwm). Si cualquier ISP bloquea cualquiera de esos dominios, la app lo resuelve sola.',
      '✅ <strong>Para el equipo en Venezuela</strong>: hacé Quit + reabrir. Ya no necesitas tocar el DNS de Windows. La app se encarga internamente.'
    ]
  },
  '3.11.70': {
    title: '5 scrapers en cascada + detección DNS bloqueado por ISP venezolano',
    features: [
      '🌐 <strong>Diagnóstico definitivo</strong>: el ISP venezolano está bloqueando snapinsta.app y saveig.app a nivel DNS (ENOTFOUND). El error final ahora detecta esto explícitamente y da las instrucciones de fix: cambiar el DNS de Windows a Cloudflare 1.1.1.1.',
      '🔁 <strong>5 scrapers en cascada con dominios distintos</strong>: snapinsta → fastdl → <strong>snapsave.app</strong> (nuevo) → <strong>igram.io</strong> (nuevo) → saveig. Más chance que al menos uno no esté bloqueado.',
      '🛠 <strong>Parser de fastdl robusto</strong>: ahora busca recursivamente el URL del video en cualquier estructura de respuesta (URL profundos, arrays anidados). Antes solo miraba estructuras superficiales y daba "respuesta sin URL" si fastdl cambiaba su formato.',
      '💡 <strong>Fix permanente para el equipo en Venezuela</strong>: cambiar DNS a 1.1.1.1 (Cloudflare) o 8.8.8.8 (Google). Pasos: Configuración → Red → tu conexión → Editar DNS → Manual → 1.1.1.1. Eso desbloquea TODOS los dominios bloqueados por el ISP, no solo los scrapers.'
    ]
  },
  '3.11.69': {
    title: 'Mensaje de error mejorado — muestra qué scraper falló para diagnosticar',
    features: [
      '🩺 <strong>Error message claro</strong>: el viejo mensaje "Instagram bloquea descargas anónimas desde 2026..." daba la falsa impresión de que la app estaba en versión vieja. Ahora dice explícitamente "Todos los métodos fallaron" y enumera qué dijo cada scraper individualmente (snapinsta, fastdl, saveig) + el error de yt-dlp como último recurso.',
      '⚡ <strong>Pista de qué hacer</strong>: el mensaje sugiere reintentar en 1-2 minutos (los scrapers públicos a veces tienen rate limit transitorio) o que la URL sea de cuenta privada.',
      '📲 <strong>Si después de v3.11.69 aún ven el error</strong>: significa que efectivamente los 3 scrapers están temporalmente caídos para esa URL. Mandame screenshot del nuevo error con el detalle de cada uno y agrego un cuarto scraper de respaldo.'
    ]
  },
  '3.11.68': {
    title: 'Fix Chrome DPAPI en Windows + cascada de 3 scrapers IG (snapinsta → fastdl → saveig)',
    features: [
      '🔧 <strong>Fix Windows DPAPI error</strong>: Chrome en Windows usa una encriptación nueva (App-Bound Encryption) que yt-dlp no puede decifrar sin tu password de Windows (issue 10927 de yt-dlp). Quité Chrome y Brave de la cascada en Windows — solo Firefox es confiable ahí.',
      '🪟 <strong>En Windows ahora</strong>: la cascada para IG es 1) scrapers públicos (snapinsta/fastdl/saveig sin cookies), 2) yt-dlp con cookies de Firefox. Si no tenés Firefox con IG logueado, la única forma confiable es que los scrapers públicos funcionen.',
      '🔁 <strong>Cascada de 3 scrapers para IG</strong>: si snapinsta falla (caído / rate limit), intenta fastdl.app. Si ese falla, saveig.app. Si todos fallan, ahí cae a yt-dlp. Triple respaldo para minimizar el "scrapers fallaron".',
      '🩺 <strong>Mensaje de error mejorado</strong>: si los 3 scrapers fallan, el error muestra qué dijo cada uno individualmente. Útil para diagnosticar si todos están caídos o si es problema de la URL específica.'
    ]
  },
  '3.11.67': {
    title: 'Logging visible al apretar el botón rojo — diagnóstico del "tap pero no graba"',
    features: [
      '🩺 <strong>Mensajes visibles al tap</strong>: cuando el chico aprieta el botón rojo, ahora aparece un toast en pantalla con:<br>• <code>🔴 Tap red button</code> al click<br>• <code>✓ Grabando</code> si arrancó OK<br>• <code>❌ Sin audio — permisos de micrófono denegados?</code> si no hay mic<br>• <code>❌ Canvas no encontrado</code> si el canvas no existe<br>• <code>❌ MediaRecorder: ...</code> si la API falla<br>Con eso vemos exactamente dónde falla.',
      '🎙 <strong>Auto-reintento de mic</strong>: si el audio track no está vivo al apretar el botón, la app reintenta pedir permisos. Bug común en Android cuando el browser revoca el mic mid-sesión.',
      '🛡 <strong>Library screen escondida al cargar con session</strong>: por las dudas, el init() del recorder ahora explícitamente oculta la pantalla library para que no haya conflicto con la pantalla de grabación.',
      '📲 <strong>Para diagnosticar</strong>: que el chico reinstale la PWA (v31167), escanee QR, intente grabar, y mande screenshot del mensaje rojo/amarillo que aparezca. Ahí sabemos qué arreglar.'
    ]
  },
  '3.11.66': {
    title: 'Thumbnails de TikTok ahora se ven (vía tikwm) + recordatorio para chicos en Windows',
    features: [
      '🎬 <strong>Fix thumbnails TikTok</strong>: el fetcher OG ahora usa <code>tikwm.com</code> para sacar el cover real del video de TikTok (mismo que se ve en la app). Antes Microlink devolvía el logo genérico o nada utilizable.',
      '📲 <strong>Chicos en Windows con errores</strong>: el error de "OpenAI bloqueó por país" y "Instagram bloquea descargas anónimas" son de versiones anteriores. La v3.11.53+ ya usa snapinsta (no requiere cookies) y Groq (no requiere VPN). Tienen que hacer <strong>Quit completo + reabrir</strong> la app para instalar las actualizaciones pendientes. Si después de actualizar siguen con error, mandanos screenshot del status de Settings → OpenAI API Key para verificar que dice "(Groq)".'
    ]
  },
  '3.11.65': {
    title: '📚 Librería local en la PWA — múltiples grabaciones guardadas, elegís cuál grabar',
    features: [
      '🎬 <strong>Cómo funciona</strong>: cada vez que el celular escanea un QR, esa sesión se guarda en la PWA (localStorage). Al abrir el ícono del Home Screen sin un QR, la PWA te muestra todas las sesiones pendientes — tocás una y arrancás a grabar. Después de terminar, te ofrece "📚 Volver a la lista" para grabar la siguiente.',
      '⚡ <strong>Workflow batch</strong>: en el desktop, hacé click en "Grabar desde Celular" en varios entries seguidos (cada uno te muestra su QR). Escaneá los 3-5 QRs uno tras otro con el celu. Después dejás el cel en el gimbal y desde la PWA tocás cuál grabar, en el orden que quieras. Sin volver al desktop entre grabaciones.',
      '🧹 <strong>Auto-limpieza</strong>: cuando una sesión se completa (subida al desktop) se elimina automáticamente de la librería. Sesiones expiradas (>1h sin terminar) también se quitan al cargar.',
      '🗑 <strong>Gestión manual</strong>: cada sesión tiene botón "Quitar" para borrarla individual. Abajo de la lista hay "Limpiar lista" para borrar todo de una.',
      '📷 <strong>Botón "Escanear otro QR"</strong> al fondo de la lista para agregar más sesiones cuando lo necesites.'
    ]
  },
  '3.11.64': {
    title: '⌨️ Space/Enter en la Mac controlan el celu mientras el modal está abierto',
    features: [
      '🎯 <strong>Tip simple que SÍ funciona</strong>: mientras "Grabar desde Celular" está abierto, apretás <strong>Space</strong> o <strong>Enter</strong> en el teclado de la Mac → el celular graba/pausa. El botón "⏯" del panel parpadea morado para confirmar cada press.',
      '🩹 <strong>Por qué esto SÍ y volume keys NO</strong>: macOS pasa las teclas de letras/números/space al app focado normalmente. Las teclas multimedia (VolumeUp/Down) van por una API privada de Apple que Electron no captura. Space es el atajo más universal para "play/pause" en cualquier player. Adoptamos eso.',
      '📐 <strong>Cero conflicto con typing</strong>: si el foco está en un input o textarea (estás escribiendo), Space pasa al input normal. Solo activa el toggle cuando el cursor NO está en un campo de texto.',
      '👋 <strong>Setup workflow</strong>: poné el celu en el gimbal lejos, abrí Task Manager en la Mac, escaneá el QR, dejá la mano sobre el teclado y apretá Space para grabar/pausar mientras hablás. Listo.'
    ]
  },
  '3.11.63': {
    title: 'Fix: tecla Space (y gimbal) bloqueada por el guard de auto-start',
    features: [
      '⌨️ <strong>Tecla Space funciona de nuevo</strong>: el guard de 5s de v3.11.62 estaba bloqueando los disparos por keyboard también, no solo los automáticos. Ahora solo se bloquean fuentes claramente automáticas (mediaSession, volumechange, firestore) durante los primeros 5s. El keyboard (Space/Enter) y el gimbal shortcut son siempre permitidos porque son acciones intencionales del usuario.',
      '✅ <strong>Probá ahora</strong>: en la PWA del celular o con un teclado BT/USB, apretá Space → la grabación debería empezar/pausar al instante.'
    ]
  },
  '3.11.62': {
    title: 'Guard universal contra auto-start + instrucciones de permiso de Accesibilidad',
    features: [
      '🛡 <strong>Guard universal de 5 segundos</strong>: durante los primeros 5s después de cargar el recorder, solo el TAP físico en el botón rojo puede empezar a grabar. MediaSession, volumechange, gimbal shortcut y Firestore commands quedan bloqueados — eso elimina el auto-start fantasma al escanear el QR.',
      '🗑 <strong>Comando viejo ignorado al cargar</strong>: si el doc de sesión tenía un <code>remoteCommand</code> de antes (modal anterior), ahora se ignora — el listener registra el ts inicial y solo procesa comandos con ts MAYOR a ese.',
      '🍎 <strong>Volume keys en Mac requieren permiso de Accesibilidad</strong>: macOS bloquea los media keys (VolumeUp/Down) a nivel sistema antes de pasarlos a apps. Para que <code>globalShortcut</code> de Electron los capture, tenés que dar el permiso:<br>1) Configuración del Sistema → Privacidad y Seguridad → <strong>Accesibilidad</strong>.<br>2) Click en + → buscá "<strong>Task Manager</strong>" en /Applications → agregar.<br>3) Activá el toggle al lado del nombre.<br>4) Cerrá y reabrí la app.<br>5) Después del permiso, probá apretar VolumeUp del remote BT pareado a la Mac.',
      '⚠ <strong>Si aún sin permiso de Accesibilidad no anda</strong>: macOS pone los media keys en una "private API" (IOKit) que Electron no siempre captura. Plan B real: usar el panel de control remoto en la PC con el mouse, o comprar un remote BT con switch Android (manda Enter, no requiere permisos).'
    ]
  },
  '3.11.61': {
    title: '🎮 Gimbal BT remote pareado a la Mac (workaround real para iPhone PWA)',
    features: [
      '💡 <strong>Idea clave</strong>: iOS PWA no puede captar volume keys (Apple lo bloquea). PERO si el remote BT está pareado a la <strong>Mac</strong> en lugar del iPhone, Electron <code>globalShortcut</code> SÍ los captura y reenvía al celular via Firestore. Cero APIs de iOS necesarias.',
      '🔧 <strong>Cómo configurarlo</strong>:<br>1) En el iPhone: andá a Settings → Bluetooth → tocá tu remote → "Olvidar este dispositivo".<br>2) En la Mac: abrí Settings de Bluetooth → poné el remote en modo pairing → pareálo a la Mac.<br>3) Abrí Task Manager → Depósito → entry con guion → "Grabar desde Celular" → escaneá el QR.<br>4) Apretá VolumeUp/Down en el remote — el botón "⏯" del panel remoto en la PC se va a iluminar y el celular va a empezar/pausar la grabación.',
      '⚠ <strong>Trade-off honesto</strong>: mientras el modal "Grabar desde Celular" está abierto, las teclas VolumeUp/VolumeDown de la Mac NO ajustan volumen — están reservadas para el gimbal. Al cerrar el modal, vuelven a funcionar normal. También se libera al cerrar la app.',
      '🎯 <strong>Resultado</strong>: clickeás el remote BT (en tu mano, con el celu en el gimbal lejos) → la Mac escucha → manda comando vía Firestore → celular ejecuta. Latencia 200-400ms. Es la mejor experiencia que se puede lograr sin app nativa.'
    ]
  },
  '3.11.60': {
    title: 'Fix grabación auto-iniciada al escanear QR (MediaSession.play falso)',
    features: [
      '🔧 <strong>Fix crítico</strong>: cuando arrancaba nuestro audio silencioso para captar volume keys, iOS disparaba <code>MediaSession.play</code> action como si el usuario hubiera apretado un botón → la app llamaba <code>recordButtonTap()</code> → grabación arrancaba sola al escanear el QR. Ahora ignoramos esos eventos durante 3.5s después de cada <code>audio.play()</code> programático.',
      '🛡 <strong>Mismo guard cubre auto-resume del watchdog</strong>: cuando iOS pausa nuestro audio y nosotros lo reiniciamos, también se ignora el MediaSession.play falso que se genera ahí.',
      '📲 <strong>Volume keys</strong>: el guard sigue intentando captar el evento via volumechange (con audio de ruido -60dB y DOM). Reinstalá la PWA, triple-tap para abrir debug overlay, apretá tu remote y mandame screenshot de qué aparece.'
    ]
  },
  '3.11.59': {
    title: 'Último intento iOS remote: ruido casi imperceptible (-60dB) en lugar de silencio total',
    features: [
      '🔊 <strong>Cambio clave</strong>: el audio que generamos para captar los volume keys ahora tiene ruido casi imperceptible (-60dB de amplitud) en lugar de samples 100% cero. Hipótesis: iOS detectaba el silencio puro y lo desclasificaba como "no media playing" → ruteaba los volume keys al ringer del sistema. Con ruido sub-audible, iOS debería tratarlo como media activo y rutear el volumen vía media (capturable por la app).',
      '📻 <strong>Audio element en el DOM</strong>: ahora insertamos un <code>&lt;audio&gt;</code> en el DOM (posicionado fuera de pantalla) en lugar de usar <code>new Audio()</code> de JS. Algunos sandboxes de iOS PWA tratan distinto los elementos del DOM.',
      '🛡 <strong>Auto-resume si iOS lo pausa</strong>: cuando el audio se pausa o termina (común cuando MediaRecorder agarra el mic), automáticamente se reinicia. Antes podía quedar muerto y no captar nada.',
      '🩺 <strong>Más debug en el overlay</strong>: ahora vas a ver "audio playing ✓ (noise -60dB)" cuando arranca, "audio.pause" si iOS lo mata, "volumechange → X.XX" si captura el botón. Si no aparece NINGUNO de esos al apretar el remote, iOS PWA bloqueó 100% y no hay forma técnica.',
      '🎯 <strong>Cómo probar</strong>: reinstalá la PWA, abrí recorder, primer tap para activar, triple-tap para ver el debug overlay, apretá el remote. Mandame screenshot.'
    ]
  },
  '3.11.58': {
    title: 'Debug overlay del control remoto — descubrí qué manda tu gimbal',
    features: [
      '🔍 <strong>Modo debug en el recorder</strong>: triple-tap rápido en la pantalla del recorder abre un overlay verde con TODO lo que la app está detectando del remote (keydown, volumechange, MediaSession actions). Apretás el remote y vas a ver al instante si llega algo, qué evento es y qué key code envía. Triple-tap de nuevo lo cierra.',
      '🛡 <strong>Watchdog del audio silencioso</strong>: cada 2 segundos chequea que el audio que captura los volume keys siga playing. Si iOS lo pausó (ocurre cuando MediaRecorder arranca con audio capture), lo reinicia. Antes podía ser que el truco funcionara al principio y se cayera mid-grabación.',
      '🎯 <strong>Cómo usarlo en tu caso</strong>: instalá la PWA nueva → entrá al recorder → triple-tap en la pantalla → ves el debug. Apretá el botón del remote del gimbal. Mirá qué aparece en el log. Si dice algo (volumechange, keydown, MediaSession.play, lo que sea) → mandame screenshot y vemos si lo podemos rutear al record button. Si NO aparece nada → iOS te lo está bloqueando 100%.',
      '⚠ <strong>Honestidad técnica</strong>: en iOS 16+ Apple bloquea cada vez más el truco del volumechange en PWA standalone. Si tu remote SOLO manda volume keys, puede que no haya forma. Si tiene Play/Pause separado (botón pequeño además del shutter), ESO sí funciona vía MediaSession. Muchos remotes BT tienen switch iOS/Android — el modo Android manda Enter/Space y es lo más confiable.'
    ]
  },
  '3.11.57': {
    title: 'Discard auto-pausa + feedback inmediato PC + MediaSession para iPhone remotes',
    features: [
      '✂️ <strong>Descartar último ahora funciona en cualquier estado</strong>: si tocás "Descartar" mientras está grabando, la app pausa primero y después descarta el fragmento. Antes daba la sensación de no responder porque el guard interno bloqueaba la acción mid-recording.',
      '⚡ <strong>Feedback inmediato en los botones de la PC</strong>: cuando hacés click ahora aparece "⏳ Enviando..." durante 800ms. Sabés al instante que el click registró aunque el round-trip a Firestore tarde unos cientos de milisegundos. Adiós a los double/triple clicks por incertidumbre.',
      '🎮 <strong>MediaSession API para Bluetooth remotes en iPhone</strong>: si tu shutter remote tiene botón Play/Pause (no solo el del shutter shutter), iOS Safari lo pasa via MediaSession y ahora la app lo captura. Mucho más confiable que el truco del volumechange (que iOS tiende a bloquear en PWA standalone).',
      '🔊 <strong>Audio silencioso mejorado</strong>: usamos un WAV de 2 segundos generado en runtime en lugar del data URL chiquito de antes. Loop más fiable, captura de volumechange más consistente cuando funciona.',
      '🩹 <strong>Tip para gimbals</strong>: muchos remote BT tienen switch iOS/Android. En iOS mode envían VolumeUp (a veces no llegan). Si tu remote tiene Android mode (manda Enter/Space) o un botón Play/Pause separado, esos son los más confiables. Probá ambos modos.'
    ]
  },
  '3.11.56': {
    title: 'Fix: control remoto PC ahora SÍ controla el celu + truco para volume keys en iPhone',
    features: [
      '🔧 <strong>Fix crítico</strong>: el listener de comandos remotos se registraba ANTES de que <code>sessionRef</code> existiera (cuando cargaba el script), así que los clicks de los botones de la PC no llegaban al celu. Ahora se engancha apenas <code>loadSession()</code> termina.',
      '🎙 <strong>Truco para volume keys en iPhone</strong>: iOS Safari intercepta los volume keys y no los pasa al web app, pero si tenés un audio playing en loop, iOS deja que la app escuche el evento <code>volumechange</code>. La PWA ahora reproduce un audio silencioso (data URL, sin descargar nada) y dispara el botón rojo cuando detecta un cambio de volumen. Resultado: el remote Bluetooth shutter de tu gimbal funciona también en iPhone ahora.',
      '⚠ <strong>Necesita gesture inicial</strong>: el audio arranca después del primer tap en la pantalla del recorder (autoplay policy de iOS). Así que primero pegale un tap en cualquier lado, después podés usar el remote del gimbal para todo.',
      '📲 <strong>Para que el celu cargue el código nuevo</strong>: borrá el ícono actual del PWA, escaneá el QR de nuevo desde Safari y reinstalá. O Settings → Safari → Borrar historial.'
    ]
  },
  '3.11.55': {
    title: 'Control remoto del recorder + teleprompter sincronizado + Bluetooth shutter',
    features: [
      '⏯ <strong>Teleprompter sincronizado con la grabación</strong>: cuando pausás la grabación, el teleprompter también se pausa. Cuando reanudás, vuelve a scrollear. Cuando das Done, se detiene. Antes había que pausar los dos por separado.',
      '📡 <strong>Control remoto desde la PC</strong> mientras el celu está en un gimbal lejos: en el modal de "Grabar desde Celular" hay tres botones nuevos:<br>• <strong>⏯ Grabar/Pausar</strong> — toggle de grabación<br>• <strong>↶ Descartar último</strong> — borra el último fragmento<br>• <strong>✓ Finalizar</strong> — termina y manda al desktop<br>Los comandos viajan por Firestore y el celu los ejecuta en milisegundos.',
      '🎮 <strong>Bluetooth shutter remote del gimbal</strong>: la PWA del celu ahora escucha <code>Space</code>, <code>Enter</code>, <code>MediaPlayPause</code> y <code>VolumeUp/Down</code> como triggers del botón rojo. En Android cualquier shutter remote BT (que mande VolumeUp) controla la grabación. En iPhone Safari iOS roba los volumen keys así que solo va con remotes que manden Enter/Space.',
      '🛠 <strong>Bonus: cómo usarlo en un setup pro</strong>: pone el celu en el gimbal, abrí Transcribir en la PC, conectá el remote BT en el gimbal a tu mano. Tap remote → graba/pausa. O usá los botones de la PC con el mouse. El teleprompter se sincroniza automáticamente.'
    ]
  },
  '3.11.54': {
    title: '"🎬 Video de referencia" al lado de "Grabación" — el editor ve los dos',
    features: [
      '🎬 <strong>Dos botones en la tarea</strong>: si la entry venía del Depósito con un reel de IG/TikTok COMO referencia Y se grabó un video con el celu encima, la tarea ahora muestra <strong>"🎬 Grabación"</strong> (naranja) Y <strong>"🎬 Video de referencia"</strong> (rojo) lado a lado. Click en cada uno abre el video correspondiente. Antes solo aparecía "Grabación" porque <code>videoLink</code> era la misma URL.',
      '🔁 <strong>Flow de asignar arreglado</strong>: cuando asignás una entry con grabación + reel de referencia, ahora <code>task.videoLink</code> es el reel original (no la grabación). La grabación queda solo en <code>task.recordedVideos</code>. Resultado: ambos botones distintos en la tarea.',
      '🩹 <strong>Backfill automático para tareas viejas</strong>: si una tarea tiene <code>videoLink === grabación</code> (assign flow viejo), la app mira la entry original del depósito y saca el reel de referencia de ahí. No requiere reasignar las tareas existentes.',
      '✏️ <strong>"+ Video" sigue funcionando</strong>: si querés agregar/editar manualmente el video de referencia desde una tarea, el botón "+ Video" (o ✏️ Video si ya hay uno) abre el modal para pegar el link.'
    ]
  },
  '3.11.53': {
    title: 'Transcribir SIN LOGINS — scrapers públicos para IG (snapinsta) y TikTok (tikwm)',
    features: [
      '🎯 <strong>Fin del drama de cookies y prompts del llavero</strong>: la app ahora usa scrapers públicos que NO requieren auth en ningún lado: <code>snapinsta.app</code> para Instagram y <code>tikwm.com</code> para TikTok. Cero login, cero prompts, cero setup — para vos, el equipo y cualquier cliente futuro.',
      '🚀 <strong>Cómo funciona ahora</strong>: cuando aprietás Transcribir en un reel de IG/TikTok, la app le manda la URL pública del post al scraper, el scraper devuelve la URL del video, la app la baja y la manda a Groq. Todo automático, todo invisible.',
      '🛡 <strong>Fallback a yt-dlp</strong> si el scraper se cae: si snapinsta o tikwm están temporalmente fuera, yt-dlp es el plan B (con la lógica de cookies anterior). Pero el caso 99% pasa por scrapers.',
      '🗑 <strong>Eliminado completamente el feature "Conectar Instagram"</strong> de Settings (no funcionaba bien y solo confundía). Ya no aparece más esa sección.',
      '⚠ <strong>Notas honestas</strong>: snapinsta y tikwm son servicios no-oficiales que podrían cambiar o caerse sin aviso. Si pasa, integro otros alternativos en minutos. Por ahora son los más estables.'
    ]
  },
  '3.11.52': {
    title: 'Honesto sobre el IG block: usá Chrome real (Mac: prompt UNA vez, Win: silencioso)',
    features: [
      '🤷 <strong>Revelación técnica</strong>: el botón "Conectar Instagram" de v3.11.51 no funciona como esperaba. IG detecta que la ventana embedded de Electron NO es Chrome real (por fingerprint del navegador) y rechaza las cookies que captura. La única forma fiable es leer las cookies del Chrome REAL instalado en la máquina.',
      '🍪 <strong>Chrome es ahora la primera estrategia</strong> para Instagram. En Mac dispara el prompt del llavero UNA vez (click "Permitir Siempre" + password de Mac, queda silencioso PARA SIEMPRE). En Windows: cero prompts, totalmente transparente.',
      '🎥 <strong>TikTok / YouTube no cambian</strong>: la app prueba "sin cookies" primero para esas plataformas (no requieren auth) y solo cae a Chrome si IG es el target.',
      '📝 <strong>Mensaje de error mejorado</strong>: explica el bloqueo de IG de 2026, el prompt en Mac, y qué hacer si le diste Denegar antes (Acceso a Llaveros → eliminar entrada Chrome Safe Storage → reintentar).',
      '👻 <strong>UI de "Conectar IG" oculta</strong> (causaba más confusión que ayuda). Si en el futuro encontramos forma de saltar la bot detection, la vuelvo a habilitar.'
    ]
  },
  '3.11.51': {
    title: '🔌 Conectar Instagram — un admin logueado, todo el workspace transcribe (cero setup para el equipo / clientes)',
    features: [
      '🎯 <strong>Solución profesional para vender la app</strong>: en Settings hay un botón "🔌 Conectar Instagram". El admin (vos) hacés click, se abre una ventana de IG, te logueás UNA vez. La app captura las cookies y las guarda en Firestore por workspace.',
      '👥 <strong>El equipo y los clientes heredan automáticamente</strong>: nadie más tiene que loguearse, configurar nada, ni aprobar prompts del llavero. Al abrir la app en cualquier máquina, las cookies de IG llegan vía Firestore y se usan transparentemente para Transcribir.',
      '🛡 <strong>Recomendación de seguridad</strong>: creá una cuenta de IG aparte (no la personal) y conectála desde la app. Si compartís el workspace con un cliente, ellos usan TU cuenta para transcribir sus reels — no la suya. El cliente nunca ve las credenciales, solo el resultado.',
      '🔄 <strong>Cookies como primera estrategia en yt-dlp</strong>: si el workspace tiene IG conectado, yt-dlp usa esas cookies inmediatamente. Si no, cae al cascade de browsers (Safari/Firefox/Chrome/Brave) como antes — backwards compatible.',
      '🚪 <strong>Botón "Desconectar"</strong>: si querés revocar el acceso del equipo, click y se borra. Las cookies expiran solas también — si IG pide login otra vez, hacés click en "Reconectar".'
    ]
  },
  '3.11.50': {
    title: 'Chrome y Brave de vuelta en la cascada — el prompt del llavero se aprueba UNA vez',
    features: [
      '🔑 <strong>Re-habilitados Chrome y Brave en Mac</strong> como último recurso. Si solo usás esos browsers para IG, la app va a poder leer sus cookies, PERO va a aparecer el prompt del llavero "Permitir Safe Storage".',
      '✅ <strong>INSTRUCCIONES si aparece el prompt</strong>: hacé click en "<strong>PERMITIR SIEMPRE</strong>" + poné tu password de Mac. ES UNA SOLA VEZ — después macOS recuerda y nunca más te lo pregunta. NO le des "Denegar" porque ahí la app no puede leer las cookies y se cae.',
      '📋 <strong>Cascada actualizada</strong>: (1) sin cookies → (2) Safari → (3) Firefox → (4) Chrome (con prompt una vez) → (5) Brave (con prompt una vez). El error final ahora te explica las dos opciones: usar Safari/Firefox, o aceptar el prompt una vez.',
      '🪟 <strong>En Windows</strong>: el prompt no aparece (Windows no encripta con credencial del usuario). La cascada Edge → Chrome → Firefox → Brave es silenciosa.'
    ]
  },
  '3.11.49': {
    title: 'Stop a los prompts del llavero — solo browsers sin keychain en la cascada',
    features: [
      '🚫 <strong>Eliminados Brave y Chrome de la cascada en Mac</strong>. Esos dos guardan cookies encriptadas con clave del llavero, lo que dispara el popup "Permitir Safe Storage" cada vez que pasaba la cascada. En Mac ahora solo prueba Safari y Firefox (sin keychain, silencioso).',
      '🪟 <strong>En Windows</strong>: prueba Edge, Chrome y Firefox (Windows no pide credencial para cookies de browser).',
      '💡 <strong>Si fallan ambos (Safari + Firefox)</strong>: error claro y accionable — "Iniciá sesión en Instagram desde Safari o Firefox, después reintentá". No más cryptic yt-dlp output.'
    ]
  },
  '3.11.48': {
    title: 'Cookies cascade ordenado por fricción — Safari/Edge primero, Chrome al final',
    features: [
      '🔇 <strong>Sin más prompts de "Permitir Chrome Safe Storage"</strong>: en Mac, Safari va primero (no requiere keychain). En Windows, Edge primero. Chrome queda al final porque en Mac pide el password del llavero para descifrar sus cookies.',
      '🎯 Por defecto el caso normal pasa silencioso: usás IG en Safari/Edge → la app lee esas cookies sin pedir nada. Si solo usás Chrome, ahí sí va a aparecer el prompt una vez ("Permitir siempre" + password) y nunca más.'
    ]
  },
  '3.11.47': {
    title: 'Fix Instagram auth en yt-dlp — cookies del browser en cascada (Chrome → Safari/Edge → Firefox)',
    features: [
      '🍪 <strong>Instagram tiró "cookies for authentication"</strong>: yt-dlp ahora requiere cookies de sesión para muchos reels de IG. La app prueba en cascada: (1) sin cookies (TikTok/YouTube/Twitter andan sin), (2) cookies de Chrome, (3) Safari (Mac) o Edge (Windows), (4) Firefox, (5) Brave.',
      '🎯 <strong>Auto-detección inteligente</strong>: si el primer intento falla pero el error NO menciona cookies/auth, no pierde tiempo probando otros browsers — solo cuando hay señales claras (palabras "cookie", "sign in", "authentication", HTTP 403/429).',
      '⚡ <strong>Requisito</strong>: que estés logueado en Instagram en alguno de esos browsers en la máquina donde corre la app. Por defecto la mayoría de la gente lo está en Chrome o Safari/Edge — debería andar sin tocar nada.',
      '🩺 <strong>Error final dice qué estrategia falló</strong>: si todo falla, el mensaje incluye qué estrategia fue la última probada para diagnosticar.'
    ]
  },
  '3.11.46': {
    title: 'Transcripción vía Node https (fix Windows con firewall corporativo)',
    features: [
      '🔧 <strong>Llamada a Whisper/Groq ahora corre en el proceso main (Node) en vez del renderer (Chromium XHR)</strong>. En Windows con firewall corporativo, el XHR del iframe se quedaba colgado silenciosamente sin pasar la request. Node usa el stack de red del OS y suele andar donde Chromium falla.',
      '📦 <strong>Cómo funciona</strong>: el audio se convierte a base64 en el renderer, se manda al main process via IPC, y main hace el POST multipart/form-data con <code>https</code> nativo de Node. El timeout de 150s sigue, los errores son más limpios.',
      '✅ <strong>Para los chicos en Windows</strong>: Quit + reabrir la app para que cargue el nuevo preload. La transcripción debería funcionar igual que en Mac ahora.'
    ]
  },
  '3.11.45': {
    title: 'Modelo Groq cambiado a whisper-large-v3 (estable) + timeout 150s + diagnóstico con tamaño',
    features: [
      '🤖 <strong>Modelo Groq cambiado a <code>whisper-large-v3</code></strong> (antes <code>whisper-large-v3-turbo</code>). El turbo tiene cola en free tier para videos >1min y se quedaba procesando 80-180s. El no-turbo es ligeramente más lento para audios cortos pero MUCHO más confiable para >1min.',
      '⏱ <strong>Timeout 150s</strong> (90s era muy corto para audios largos). El heartbeat ahora muestra "(N segundos)" con el tamaño del audio (KB) para que sepas qué se está enviando y por dónde va.',
      '🩺 <strong>Mensaje de timeout incluye contexto</strong>: cuánto tardó, tamaño del audio, y sugerencia "probá con video más corto o pasá a Deepgram si la red bloquea Groq".'
    ]
  },
  '3.11.44': {
    title: 'FIX CRÍTICO: bug "Assignment to constant variable" rompía toda la transcripción',
    features: [
      '🔥 <strong>Fix urgente</strong>: en v3.11.42 agregué <code>apiKey = ...trim()</code> reasignando una <code>const</code> — JavaScript tira "Assignment to constant variable" y la transcripción fallaba inmediatamente sin haber siquiera intentado llamar al endpoint. Cambiado a <code>let</code>. Probá Transcribir de nuevo después de instalar.',
      'ℹ <strong>Diagnóstico para los chicos en Windows</strong>: si después de actualizar siguen viendo "Groq tardó >90s" o similar, significa que <code>api.groq.com</code> no responde rápido desde su red. Posibles causas: firewall corporativo, DNS lento, o region routing. La key está bien (status dice "Configurado (Groq)").'
    ]
  },
  '3.11.43': {
    title: 'Transcripción timeout 90s + heartbeat con nombre real del provider',
    features: [
      '⏱ <strong>Timeout de Whisper/Groq bajado a 90s</strong> (antes 3min). Si no responde en 90s probablemente la red está bloqueando o algo va muy mal — mejor fallar rápido con error claro en vez de quedar en silencio.',
      '🏷 <strong>Heartbeat dice el provider real</strong>: antes hardcodeaba "Whisper" en el contador aunque usaras Groq. Ahora dice "⏳ Procesando en Groq... (12s)" para que sepas qué endpoint está pegando. Si pasa de 60s, el mensaje advierte "probablemente la red está bloqueando".'
    ]
  },
  '3.11.42': {
    title: 'Trim defensivo en la API key + diagnóstico en el error 403 de OpenAI',
    features: [
      '🔍 <strong>Diagnóstico claro en el error 403</strong>: cuando OpenAI bloquea por país, el error ahora dice EXACTAMENTE qué endpoint usó y con qué prefijo de key. Si la key NO empieza con <code>gsk_</code>, te dice "la actual NO es de Groq" → significa que pegaste mal o que pegaste la de OpenAI.',
      '✂️ <strong>Trim defensivo</strong> de la API key al cargar y al usar — algunos paste copian un espacio o newline al final que rompía <code>startsWith("gsk_")</code> y ruteaba a OpenAI aunque la key fuera de Groq.',
      '🏷 <strong>Status en Settings dice "Configurado (Groq)" o "Configurado (OpenAI)"</strong>: revisalo antes de probar Transcribir — si dice OpenAI y querés Groq, pegá la key correcta (<code>gsk_...</code> de console.groq.com).'
    ]
  },
  '3.11.41': {
    title: 'yt-dlp: timeout 180s + mensajes de error mucho más útiles',
    features: [
      '⏱ <strong>Timeout subido de 90s a 180s</strong>: yt-dlp se cortaba en videos largos o redes lentas (Windows en países con peor conexión). Ahora aguanta 3 minutos.',
      '🩺 <strong>Errores mucho más claros</strong>: antes decía solo "yt-dlp exit 1". Ahora incluye los últimos 400 caracteres del stderr (mensaje real de yt-dlp: rate limit, formato no disponible, video privado, etc), el exit code, y la última línea de actividad del stdout.',
      '🚦 <strong>Timeout se detecta explícitamente</strong>: si yt-dlp tarda más de 180s, el error dice "yt-dlp timeout (180s). El video puede ser muy largo..." en vez de un código cryptico.',
      '🧪 <strong>Cómo diagnosticar mejor</strong>: cuando los chicos vean "Error: yt-dlp falló (exit 1): ...", pasame el mensaje exacto — ahí sabremos si es el video, la red, o algo específico de la plataforma (IG/TikTok).'
    ]
  },
  '3.11.40': {
    title: 'Soporte Groq (alternativa a Whisper para países bloqueados) + yt-dlp más robusto',
    features: [
      '🌎 <strong>OpenAI bloquea por país? Usá Groq</strong>. Los chicos veían "Whisper API 403: Country, region, or territory not supported" porque OpenAI bloquea Venezuela / Cuba / Irán / etc. La app ahora detecta automáticamente si la API key empieza con <code>gsk_</code> (Groq) y rutea al endpoint de Groq (<code>api.groq.com</code>) que NO tiene bloqueo geográfico.',
      '🎁 <strong>Groq es GRATIS</strong> con tier generoso (25,000 segundos de audio por día). Misma calidad (whisper-large-v3-turbo, mejor incluso que whisper-1 de OpenAI). Andá a <code>console.groq.com</code>, creá cuenta, generá API key (empieza con gsk_), pegala en Settings → OpenAI API Key. La app la detecta y cambia el endpoint sola.',
      '🏷 <strong>Status label muestra el provider</strong>: ahora dice "Configurado (OpenAI)" o "Configurado (Groq)" para que sepan qué están usando.',
      '⚠ <strong>Error 403 con mensaje accionable</strong>: si la key de OpenAI sigue ahí pero OpenAI bloquea el país, el error explícitamente dice "pegá una key de Groq" en vez del mensaje críptico.',
      '🎬 <strong>yt-dlp más permisivo en TikTok/IG</strong>: antes daba "Requested format is not available" en algunos videos de TikTok porque pedíamos m4a/mp4/webm específicos. Ahora el fallback chain incluye <code>best[ext=mp4]/best[ext=webm]/best</code> — cualquier formato que tenga audio sirve. También se agregó <code>--max-filesize 25M</code> para no bajar videos gigantes que después Whisper no acepta.'
    ]
  },
  '3.11.39': {
    title: 'Whisper con progreso real + botón "🎬 Grabación" dedicado en tareas',
    features: [
      '📤 <strong>Whisper ya no se cuelga en "Enviando..."</strong>: cambiamos <code>fetch</code> por <code>XMLHttpRequest</code> con upload progress + heartbeat. Ahora ves "Subiendo 47%..." → "Whisper transcribiendo... (12s)" → resultado. Antes Windows se quedaba sin feedback y sin timeout.',
      '⏱ <strong>Timeout de 3 minutos</strong> con mensaje claro: "Whisper tardó >3 min. Reintenta o usá un video más corto." Antes el fetch podía quedarse esperando para siempre.',
      '🛡 <strong>Errores de red explícitos</strong>: si hay firewall/proxy bloqueando api.openai.com, ahora lo dice. Antes te quedabas viendo el spinner sin saber qué pasaba.',
      '🎬 <strong>Botón "🎬 Grabación" en cada tarea</strong>: cuando el video viene del recorder del celular, en la tarea aparece un chip naranja "🎬 Grabación" (al lado o en lugar del "Video de referencia"). Click → abre el video directo en el browser, sin pasar por la edición. Si grabaste más de uno, dice "🎬 Grabación (3)".',
      '🔁 <strong>Propagación automática a tareas ya asignadas</strong>: si grababas DESPUÉS de asignar la entry a alguien, la tarea quedaba sin el botón. Ahora <code>_attachRecordedVideoToEntry</code> también busca tareas con <code>depositEntryId</code> matching y les agrega el video.'
    ]
  },
  '3.11.38': {
    title: 'Transcribir ya funciona en Windows — yt-dlp se auto-descarga, sin instalación manual',
    features: [
      '🪟 <strong>Fix para Windows: Transcribir tiraba "yt-dlp no está instalado. brew install..."</strong>. Brew es macOS-only, los chicos en Windows no podían usar la transcripción de Instagram/TikTok/YouTube.',
      '⬇ <strong>Solución: auto-bootstrap de yt-dlp</strong>. La app ahora baja el binario oficial de GitHub Releases (~12MB en Windows, ~30MB en Mac) la primera vez que apretás Transcribir, y lo cachea en el directorio de la app. Cero instalación manual.',
      '⏱ <strong>Primera vez tarda 30-60s</strong> (descarga + extracción de audio). Después queda cacheado y va en <10s.',
      '🔁 <strong>Fallback ordenado</strong>: si el sistema ya tiene yt-dlp instalado (Mac via brew, Windows via winget/scoop), la app lo usa directo. Sino baja la versión bundled.',
      '⚠ <strong>Error message OS-aware</strong>: si la descarga falla por firewall/red, ahora muestra el comando correcto para cada OS (winget para Windows, brew para Mac).'
    ]
  },
  '3.11.37': {
    title: 'Fix Whisper API key en Windows — no se quedaba guardada por timing del workspace',
    features: [
      '🔑 <strong>Bug fix: API key de OpenAI/Whisper "se perdía" entre sesiones en Windows</strong>. La key SÍ se estaba guardando en Firestore — el problema era que al abrir la app, la lectura corría a los 1500ms fijos, pero en Windows el workspace tarda más en cargar. Al disparar la lectura, <code>currentWorkspaceId</code> aún era null → se leía el doc global vacío en lugar de <code>config/openai_{wsId}</code>.',
      '⏱ <strong>Solución</strong>: ahora la carga espera activamente hasta que el workspace esté listo (hasta 15s) antes de leer la config. También el iframe del depósito (que llama <code>_getOpenaiApiKey</code> para el botón Transcribir) espera lo mismo — por eso el error "Configurá tu API key" aparecía aunque la key estuviera bien guardada.',
      '🔄 <strong>Cambio de workspace recarga la key</strong>: antes <code>switchWorkspace</code> no reseteaba la UI de OpenAI; ahora sí, igual que Cloudinary e Instagram.',
      '✅ <strong>Para los chicos</strong>: una vez que actualicen a 3.11.37, la key ya guardada se va a leer correctamente sin tener que volver a pegarla. Si todavía no la guardaron, peguenla UNA vez en Settings → OpenAI API Key y queda sincronizada para todo el workspace (Mac + Windows leen del mismo lugar en Firestore).'
    ]
  },
  '3.11.36': {
    title: 'Recorder TikTok-real: UNA sola grabación con pause/resume — adiós a la unión de clips',
    features: [
      '🎬 <strong>Rewrite del recorder: una sola MediaRecorder con pause/resume</strong> (como TikTok de verdad). Antes cada tap-stop creaba una grabación nueva y al final había que unirlas con ffmpeg.wasm — frágil y a veces solo guardaba el último clip. Ahora la MISMA grabación se pausa y reanuda; el browser entrega UN solo video válido sin necesidad de concatenar.',
      '⏸ <strong>Cómo funciona</strong>: tap rojo (idle) = empieza a grabar. Tap rojo otra vez = pausa, mantiene los segundos grabados. Tap rojo otra vez = continúa la MISMA grabación. Botón ✓ Done = finaliza y muestra UN video listo para subir o guardar.',
      '↶ <strong>Descartar último fragmento</strong>: visible solo cuando estás pausado. Trunca el contenido del último fragmento manteniendo los anteriores, igual que TikTok ("¿Descartar el último fragmento? Cancelar / Descartar").',
      '🔄 <strong>Cambio de cámara mid-recording sin cortar</strong>: el MediaRecorder lee del canvas vía captureStream, así que cambiar entre front/back ya NO detiene la grabación. Adiós a los cortes raros entre cámaras.',
      '⚡ <strong>Sin ffmpeg.wasm en el camino feliz</strong>: ya no hay que cargar 25MB ni esperar el merge — el archivo sale directo de la MediaRecorder. Upload y "Guardar local" instantáneos con un solo archivo.',
      '⚠ <strong>Refrescá la PWA del celular</strong> para que cargue el código nuevo (Settings → "Borrar caché y datos" o reinstalá el ícono del Home Screen apuntando a /recorder/).'
    ]
  },
  '3.11.35': {
    title: 'Auto-instalador real (sin links manuales) — bypasses macOS signing',
    features: [
      '🚀 <strong>Auto-instalador propio implementado</strong>: cuando la app detecta una versión nueva, ahora DESCARGA el ZIP automáticamente en background y muestra un banner que dice "✅ vX.X.X lista — click para instalar".',
      '⚙ <strong>Cómo funciona</strong>: al click, la app escribe un helper script bash en /tmp, lo lanza detached, y se cierra. El script espera 2s, descomprime el zip, reemplaza /Applications/Task Manager.app, y reabre la app nueva. Todo automático.',
      '🔓 <strong>Bypassea la restricción de firma de macOS</strong>: electron-updater por defecto falla en apps sin firmar. Mi instalador custom no usa Squirrel.Mac — solo unzip + mv + open, que funciona en cualquier app.',
      '📊 <strong>Banner muestra progreso</strong>: "Descargando 45%..." → "Lista — click para instalar" → "Instalando... reabriendo sola".',
      '⚠ <strong>IMPORTANTE</strong>: tu equipo ya tiene esta capacidad pero TIENE que estar en una versión que la incluya. Una vez que pasen a v3.11.35+, todas las futuras updates se aplican con un solo click sin descargas manuales.'
    ]
  },
  '3.11.34': {
    title: 'Auto-update mejorado: diálogo nativo + banner gigante + botón manual',
    features: [
      '🚨 <strong>Banner de update ahora gigante y animado</strong>: gradiente turquesa→violeta con pulse animation. Es imposible ignorarlo. Antes era un strip de 12px que se perdía.',
      '💬 <strong>Diálogo NATIVO cuando la update está lista</strong>: aparece un cuadro de diálogo de macOS con "Instalar ahora" / "Más tarde". Click "Instalar ahora" → app reinicia con la nueva versión.',
      '🔄 <strong>Botón "Buscar actualizaciones ahora"</strong> en Config (al inicio de la pestaña). Forzá el chequeo manual. Te dice si hay update nueva o si estás en la última.',
      '⚠ <strong>Tip importante para el equipo</strong>: cuando cierran la app con ✕ (X), la app NO se quita — solo se esconde y sigue corriendo. Las updates se instalan al hacer <strong>Quit</strong> (Cmd+Q) y reabrir. Recomendales que usen Quit cuando ven el diálogo.',
      '🛡 <strong>Doble sistema</strong>: electron-updater (auto-download + restart) + GitHub API fallback (link de descarga manual). El que funcione primero gana.'
    ]
  },
  '3.11.32': {
    title: 'Unión de clips REAL via ffmpeg.wasm + botón Volver más accesible',
    features: [
      '🎬 <strong>Multi-clip ahora se une en UN solo video</strong> antes de subir, usando <code>ffmpeg.wasm</code> client-side. Stream-copy sin re-encoding (super rápido, ~2-5s para clips cortos).',
      '⏬ <strong>Primera vez carga ~25MB de ffmpeg.wasm</strong> (después queda cacheado en el browser de la PWA). Verás "Cargando ffmpeg..." → "Uniendo clips..." → "Subiendo a Cloudinary..." durante el upload.',
      '👇 <strong>Botón "← Volver a grabar" ahora abajo</strong> en el footer del overlay de clips — full-width, fácil de tocar con el pulgar. Antes estaba arriba a la esquina, difícil de alcanzar.',
      '🛡 <strong>Fallback robusto</strong>: si ffmpeg falla por cualquier motivo (CORS, memoria, red), el recorder igual sube el último clip en lugar de bloquear todo.',
      '📊 <strong>Toast en desktop dice</strong>: "Video agregado al entry (3 clips unidos en uno)" para que sepas cuántos se fusionaron.'
    ]
  },
  '3.11.31': {
    title: 'Fix notificaciones de actualización para el equipo',
    features: [
      '🎉 <strong>Banner de actualización ahora SÍ aparece para todos</strong>: el problema era que mi app no está code-signed (Apple Developer Account cuesta $99/año y aún no se compró), entonces el auto-updater de Electron falla silenciosamente en macOS — ni vos ni los chicos veían el banner.',
      '🔍 <strong>Sistema nuevo</strong>: la app ahora chequea GitHub releases directamente cada 30 minutos (vía API pública). Cuando detecta una versión nueva, muestra el banner turquesa arriba: <em>"🎉 v3.11.32 disponible (tenés v3.11.31) — click para descargar"</em>.',
      '📦 <strong>Click en banner → abre descarga directa</strong>: del archivo <code>.zip</code> del Mac arm64 en la página de releases de GitHub. El usuario lo descarga, descomprime y arrastra el nuevo <code>Task Manager.app</code> a <code>/Applications/</code> (reemplazando el viejo).',
      '⚠ <strong>Importante — pasaje único</strong>: tus chicos están en versiones viejas, NO van a ver este banner hasta que tengan al menos v3.11.31. Pasales el link del release manualmente UNA vez. A partir de ahí, todas las futuras versiones les van a aparecer en el banner solas.',
      '🔗 <strong>Link directo para compartir</strong>: <code>https://github.com/jainierrojas-arch/task-manager-app/releases/latest</code> — ese link siempre apunta a la versión más nueva. Mándales eso y que descarguen el <code>arm64-mac.zip</code>.'
    ]
  },
  '3.11.30': {
    title: 'Botón maximizar + ventana movible (drag desde la titlebar)',
    features: [
      '🟢 <strong>Nuevo botón Maximizar</strong> en la titlebar (al lado de Minimizar y Cerrar). Click → la ventana ocupa toda la pantalla. Click de nuevo → vuelve a su tamaño anterior.',
      '🖱 <strong>Doble click en la titlebar</strong> también maximiza/restaura (igual que las apps nativas de macOS y Windows).',
      '📦 <strong>Mover la ventana</strong>: agarrá la franja gris superior (donde dice "TASK MANAGER - EQUIPO") y arrastrá. Esa zona ya tenía la región de drag definida, así que tomá desde ahí — NO desde el área del contenido.',
      'ℹ <strong>Nota</strong>: cuando la ventana está maximizada, no se puede mover (es estándar en cualquier OS). Doble-click o el botón verde la restaura primero, ahí ya podés moverla.'
    ]
  },
  '3.11.29': {
    title: 'Recorder multi-clip: cada clip como video separado + save local con share múltiple',
    features: [
      '🎬 <strong>Cada clip como video separado en el entry</strong>: en v3.11.25 intenté unir los clips en uno solo vía Cloudinary concat URL, pero no se hidrataba bien y los videos no aparecían. Ahora subo cada clip por separado y los attacho como videos separados al entry — aparecen todos en la sección "🎥 Videos grabados" del entry, con su propio player + delete individual.',
      '💾 <strong>Save local con Web Share múltiple</strong>: antes en iOS solo bajaba el último o el primer clip por limitación del browser. Ahora uso <code>navigator.share({ files: [...] })</code> con TODOS los archivos en un solo share — iOS abre el share sheet una vez con todos los videos y podés "Guardar en Fotos" todos de una.',
      '🔢 <strong>Toast confirma cantidad</strong>: cuando termina el upload el toast dice "3 clips del celular agregados al entry" para que sepas cuántos se procesaron.'
    ]
  },
  '3.11.25': {
    title: 'Recorder multi-clip: video concat via Cloudinary + PWA + scanner QR + calidad bumped',
    features: [
      '🎬 <strong>Clips se UNEN en un solo video</strong>: cuando grabás 3 clips en el celular y le das ✓ Listo, mi código sube cada uno a Cloudinary y construye una URL de "concat transform" que une los 3 en uno solo. El entry en el Depósito termina con UN video que reproduce todos los clips seguidos.',
      '📋 <strong>Preview muestra "Ver todos los clips"</strong>: en la pantalla de preview ahora hay un botón para ver TODOS los clips antes de enviar — podés ver cada uno, eliminar individualmente, y reproducir todos seguidos como playlist.',
      '🎚 <strong>Calidad de grabación mejorada</strong>: bitrate subido de 6 a 10 Mbps + framerate de 30 a 60fps. Más detalle visual y movimiento fluido (más cerca de la cámara nativa del celular).',
      '📱 <strong>PWA install</strong>: el recorder ahora se instala como app en tu home screen (Safari → Compartir → Añadir a pantalla de inicio). Fullscreen real, sin barra de URL, experiencia tipo app nativa.',
      '📷 <strong>Scanner QR integrado en la PWA</strong>: si abrís el recorder desde la home y no hay sesión, podés tocar "Escanear QR" y la PWA usa su propia cámara para leer el QR del desktop — bypasses Safari completamente.',
      '↶ <strong>Undo/Done/Ver buttons</strong>: estilo TikTok/IG: anillo de progreso alrededor del botón rojo (un arco por clip), badge "N CLIPS" arriba del botón, y los botones ↶/✓/👁 aparecen cuando tenés clips guardados.'
    ]
  },
  '3.11.18': {
    title: 'Aislamiento real de workspaces + fix renombrar',
    features: [
      '🔒 <strong>Workspaces ahora completamente aislados</strong>: cada workspace nuevo arranca en BLANCO. Antes el filtro <code>_belongsToWs</code> estaba desactivado y mostraba toda la data en cualquier workspace. Ahora: workspace por defecto ve su data + data legacy (sin workspaceId, dejada antes de la era multi-workspace). Workspace NO-default ve SOLO su propia data.',
      '✏ <strong>Fix renombrar workspaces</strong>: el botón ✎ usaba <code>prompt()</code> nativo que en Electron a veces no aparece. Ahora abre un modal inline con input + botón Guardar/Cancelar.',
      '🆕 <strong>Workspaces nuevos arrancan vacíos</strong>: cuando creás "Cliente Nuevo" desde el dropdown, no ves nada de tu agencia. Cuando creás depósitos/categorías/tareas en ese workspace, quedan tagueadas con su <code>workspaceId</code>. Cambiá entre workspaces y cada uno tiene SU mundo.',
      '⚠ <strong>Importante</strong>: la data que ya creaste en "Mi Agencia" (entries existentes) sigue ahí. Si una entry no tiene <code>workspaceId</code>, la ve solo el workspace por defecto (típicamente Mi Agencia). Las entries que ya tienen <code>workspaceId</code> las ve solo ese workspace.'
    ]
  },
  '3.11.17': {
    title: 'Fix: distinguir reel real vs página de audio (carátula del álbum)',
    features: [
      '🎵 <strong>Bug detectado</strong>: cuando guardabas un reel que usaba audio de otra persona (música), tu URL podía ser <code>instagram.com/reels/audio/CXXXX/</code> — la página del AUDIO, no del reel. La <code>og:image</code> de esa página es la <strong>carátula del álbum/audio</strong>, por eso aparecían portadas raras como "ACIDO III" o "Epic Motivational" en lugar del reel.',
      '🎯 <strong>Fix</strong>: ahora <code>/reels/audio/</code> se trata como página genérica (no específica). Mi código baja al modo "buscar reel visible en pantalla" — encuentra la imagen del reel que estás mirando, hace walk-up del DOM al <code>&lt;a href="/reel/CXXX/"&gt;</code> de ESE reel específico, y desde ahí extrae portada + caption reales.',
      '🚫 <strong>Mismo trato para TikTok</strong>: <code>tiktok.com/music/...</code> y <code>tiktok.com/sound/...</code> también se tratan como genéricos para no agarrar la carátula del audio.',
      '✅ <strong>El walk-up del DOM ahora rechaza explícitamente</strong> <code>/reels/audio/</code> al buscar el <code>&lt;a href&gt;</code> ancestor — fuerza a encontrar un reel real.'
    ]
  },
  '3.11.16': {
    title: 'Fix portada vacía: regex meta más robusto + detección de img menos restrictiva',
    features: [
      '🔍 <strong>Regex de meta tags order-independent</strong>: antes asumía orden específico (property antes que content). Ahora primero matcheo el <code>&lt;meta&gt;</code> tag completo y después extraigo content de adentro — funciona aunque IG ponga los atributos en cualquier orden.',
      '🖼 <strong>Más fallbacks para imagen</strong>: probamos en orden <code>og:image:secure_url</code> → <code>og:image</code> → <code>twitter:image:src</code> → <code>twitter:image</code> → <code>&lt;link rel="image_src"&gt;</code>.',
      '🎨 <strong>Decode de HTML entities en la URL de imagen</strong>: las URLs de IG suelen tener <code>&amp;amp;</code> que rompía el cargado. Ahora se decodifican antes de guardar.',
      '📐 <strong>Detección de imagen del DOM más permisiva</strong>: si no hay imágenes >200x200 visibles, baja el threshold a 100x100. Si igual no hay, toma cualquier imagen visible. Asegura que pageData.image siempre tenga algo cuando hay contenido visual en pantalla.',
      '🛡 <strong>Microlink también triggea</strong> ahora si falta image O description (antes solo si faltaba description).'
    ]
  },
  '3.11.15': {
    title: 'Reels: fetch directo desde el webview autenticado (mejor que Microlink)',
    features: [
      '🔥 <strong>Fetch desde adentro del webview</strong>: cuando guardás un reel desde el feed, mi código ahora hace <code>fetch(reelUrl)</code> directamente desde el webview que está logueado en IG. Como es same-origin, NO hay CORS y como tiene tus cookies de IG, el HTML que devuelve es el del reel REAL (no login wall).',
      '📝 <strong>Caption garantizado</strong>: el HTML del reel tiene el <code>og:description</code> con el caption completo. Lo extraigo con regex y lo guardo como descripción + primera línea como título.',
      '🛡 <strong>Microlink como fallback</strong>: si por algún motivo el fetch directo falla, sigue usando Microlink como respaldo.',
      '🧬 <strong>Mismo flujo para TikTok</strong>: cuando estás navegando TikTok logueado, el fetch funciona igual.',
      '⚡ <strong>Más rápido</strong>: el fetch directo es ~1s, Microlink es 5-10s. Las entries se guardan más rápido cuando estás en el mismo dominio que el reel.'
    ]
  },
  '3.11.14': {
    title: 'Caption de reels — fetcher comparte sesión IG con el Explorer',
    features: [
      '🔐 <strong>OG fetcher ahora usa tu sesión de IG</strong>: el BrowserWindow oculto que extrae meta tags ya no usa una sesión vacía (que veía login wall en IG). Ahora comparte <code>persist:explorer</code> con el Explorer, así que IG lo reconoce como logueado y devuelve el caption real del reel.',
      '📝 <strong>Fallback de caption en el DOM</strong>: si <code>og:description</code> sigue vacío después del fetch, ahora también buscamos el caption en el <code>&lt;h1&gt;</code> del article (donde IG renderiza el caption client-side).',
      '🚀 <strong>Resultado para reels desde feed</strong>: el caption se captura como descripción Y como título de la entry — igual que ya funcionaba para carruseles.',
      '⚠ <strong>Importante</strong>: para que esto funcione, tenés que estar logueado en IG en el Explorer (cookies se comparten via partition).'
    ]
  },
  '3.11.13': {
    title: 'Reels desde feed: detectar reel específico por imagen visible + título desde caption',
    features: [
      '🎯 <strong>Detección de reel cuando NO hay video</strong>: en el feed de IG /explore/, los reels se muestran como <code>&lt;img&gt;</code> hasta que hacés hover (no <code>&lt;video&gt;</code>). Ahora si no hay video visible, mi código encuentra la imagen más grande cerca del centro del viewport, y desde ahí hace walk-up del DOM hasta encontrar <code>&lt;a href="/reel/CXXX/"&gt;</code>.',
      '🖼 <strong>Cover real desde el feed</strong>: con la URL específica detectada, Microlink scrapea el reel correcto y devuelve su portada real (no el collage genérico de IG). Mismo flujo que cuando guardás un reel desde su URL directa.',
      '📝 <strong>Título desde caption más agresivo</strong>: cualquier título genérico (Instagram, TikTok, "(1) Instagram", "Reels", "Explore", etc) ahora se reemplaza con la primera línea del caption del reel — igual que ya funcionaba para carruseles.',
      '🚀 <strong>Resultado</strong>: guardás un reel desde el feed sin abrirlo, y queda como un carrusel: con su portada real, su caption como descripción, y la primera línea del caption como título.'
    ]
  },
  '3.11.12': {
    title: 'Fix freeze al guardar — timeouts + cap de tamaño',
    features: [
      '🛡 <strong>Timeouts en todas las operaciones del webview</strong>: <code>extractPageData</code> 6s, <code>fetchOgData</code> 12s, <code>capturePage</code> 5s. Si alguna tarda más, se aborta sin colgar la app.',
      '📦 <strong>Cap de tamaño en cover image</strong>: si el screenshot del webview supera 600KB en JPEG, se descarta. Antes podía crear docs Firestore de 1MB+ que ralentizaban la UI al renderizar.',
      '🖼 <strong>Screenshot fallback más chico</strong>: ahora 480px de ancho con calidad 60 (antes 720/75) para que el archivo base64 sea liviano y no infle los docs.',
      '🐛 <strong>Si pasa de 700KB el coverImage, se descarta antes de mandar a Firestore</strong> — evita que docs gigantes bloqueen la UI al renderizar la card en Refs/Depósito.'
    ]
  },
  '3.11.11': {
    title: 'Fix dropdowns workspace/usuario + fix portada en feed genérico',
    features: [
      '🐛 <strong>Fix dropdowns no abrían</strong>: el menú de workspace y de usuario en el sidebar no aparecían porque <code>.app-sidebar</code> tiene <code>overflow: hidden</code> que los clipeaba. Ahora se posicionan con <code>position:fixed</code> (calculado por JS al abrir) — aparecen a la derecha del sidebar sin importar el clipping.',
      '🖼 <strong>Fix portada genérica en feed</strong>: cuando estabas en <code>instagram.com/explore/</code> sin abrir un reel específico, Microlink scrapeaba esa página y devolvía la imagen genérica de IG (las 9 fotos collage). Ahora detecto cuando la URL es un feed genérico y SOLO uso la imagen del DOM (el poster del video visible). Microlink solo se llama para URLs específicas con content ID.',
      '⚠ <strong>Aviso "feed genérico"</strong>: si guardás sin tener un reel específico abierto, el toast ahora dice <code>"⚠ feed genérico"</code> — significa que la portada salió del DOM (puede no ser perfecta). Para mejor cover, abrí el reel específico antes de guardar.',
      '🔍 <strong>Regex stricter</strong>: ahora <code>/reel/</code> o <code>/p/</code> sin content ID NO se considera URL específica. Así <code>/reels/</code> (feed) se trata como genérico, no como reel.'
    ]
  },
  '3.11.10': {
    title: 'Workspace + usuario integrados al sidebar — barra superior eliminada',
    features: [
      '⬆ <strong>Top header eliminado</strong>: la barra horizontal con el workspace switcher (Prueba Cliente / Mi Agencia) y el menú de usuario (Jainier ADMIN) DESAPARECIÓ. Toda esa franja de arriba ahora es espacio libre para el contenido.',
      '👈 <strong>Workspace switcher en el sidebar</strong>: el badge "P Prueba Cliente ▾" ahora vive arriba del menú de navegación en el sidebar izquierdo. Click para cambiar de workspace o crear uno nuevo, igual que antes.',
      '👤 <strong>Menú de usuario al fondo del sidebar</strong>: avatar + nombre + rol abajo de Config/Nube. Click → dropdown con Modo PRO, Configuración, Cerrar sesión.',
      '🌐 <strong>Explorer revertido al estilo Chrome</strong>: los controles ya no están en columna izquierda. Ahora son una barra horizontal compacta arriba (toolbar de navegación + bookmark bar con quick links + selectores y botón guardar). El webview vuelve a tener todo el ancho.',
      '📐 <strong>Más espacio vertical</strong>: con el header eliminado, todas las pestañas (Tareas, Depósito, Explorer, etc) ganan ~50px de altura.'
    ]
  },
  '3.11.9': {
    title: 'Explorer multi-pestañas + sidebar lateral + ManyChat embebido',
    features: [
      '🗂 <strong>Pestañas múltiples estilo Chrome</strong>: el Explorador ahora abre varias pestañas independientes a la vez. Click el botón ➕ arriba para nueva pestaña; cerrá con la × en cada tab. Las cookies de IG/TikTok se comparten entre todas (login persiste).',
      '👈 <strong>Toolbar movido a sidebar izquierdo</strong>: los controles (atrás/adelante/recargar, URL bar, Ir, quick links IG/Reels/TikTok/Shorts, selectores Tipo y Categoría, botón Guardar) ahora son una columna vertical de 180px a la izquierda. Liberé toda la zona de arriba — más espacio horizontal y vertical para el browser.',
      '🤖 <strong>ManyChat embebido en la app</strong>: antes abría en browser externo porque ManyChat bloquea iframes. Ahora usa <code>&lt;webview&gt;</code> que NO es un iframe (es un sub-proceso de Chromium aparte) y bypassea la restricción. Click "ManyChat" en el sidebar y se carga adentro de Task Manager con su propio login persistente.',
      '🔄 <strong>Cada pestaña es un webview separado</strong>: cambiar de tab no recarga el contenido — la otra sigue corriendo en background. Podés tener varios reels abiertos y switchear sin perder el estado.'
    ]
  },
  '3.11.8': {
    title: 'Explorer detecta el reel específico que estás viendo (no la página de explore)',
    features: [
      '🎯 <strong>Fix portada genérica</strong>: el bug era que cuando guardabas estando en <code>instagram.com/explore/</code> (el grid de reels), Microlink scrapeaba esa página y devolvía la imagen genérica del explore (las 9 fotos de pulpo/playa/perro/etc).',
      '🔍 <strong>Detección del reel activo</strong>: ahora el explorer escanea el DOM, encuentra el video más visible/grande en pantalla, y sube por el árbol del DOM hasta encontrar un <code>&lt;a href="/reel/..."&gt;</code>. Usa ESA URL específica para Microlink + para el link de la entry.',
      '💪 <strong>Funciona desde el feed</strong>: ya no tenés que abrir cada reel a su página individual antes de guardar — podés estar scrolleando explore, hacer click en el reel que te gusta para que aparezca en pantalla, y guardarlo. La portada y caption salen del reel real, no de la página de explore.',
      '📊 <strong>Toast indica si detectó reel</strong>: si dice <code>"reel detectado"</code> en el toast, significa que mi código encontró el reel específico aunque tu URL en el browser fuera genérica.'
    ]
  },
  '3.11.7': {
    title: 'Explorer: selector manual de tipo + fix screenshot fallback + mejor detección',
    features: [
      '🎚 <strong>Selector manual de tipo</strong>: nuevo dropdown abajo "Tipo: Auto/Video/Carrusel/Material" — si la auto-detección falla, podés forzar el tipo correcto antes de guardar.',
      '🐛 <strong>Fix detección de carrusel falso positivo</strong>: ahora si hay un <code>&lt;video&gt;</code> en el DOM, SIEMPRE se marca como video (no más reels detectados como carruseles por el botón "Next" del feed).',
      '📸 <strong>Fix screenshot fallback</strong>: el data URL del screenshot estaba mal armado (decía "image/jpeg" pero los bytes eran PNG). Ahora usa <code>nativeImage.toJPEG(75)</code> y arma el base64 correctamente, así si Microlink Y la extracción del DOM fallan, al menos queda el screenshot del webview como portada.',
      '📊 <strong>Toast con info de debug</strong>: ahora muestra de dónde salió la portada — <code>microlink</code> (server-side), <code>webview-dom</code> (DOM), <code>screenshot-jpeg</code> (captura). Si dice "✓ video (caption)" sin "portada=...", quiere decir que NINGUNA fuente devolvió imagen — avisame ahí.',
      '🔍 <strong>Auto-reset</strong>: el selector vuelve a "Auto" después de cada guardado.'
    ]
  },
  '3.11.6': {
    title: 'Explorer fix portada + auto-detect carrusel + screenshot fallback',
    features: [
      '🖼 <strong>Fix portada del reel</strong>: ahora corremos en PARALELO Microlink (server-side, ya probado para IG) Y la extracción del DOM del webview. La cover sale del primero que devuelva una imagen — Microlink primero porque es más confiable para reels específicos en IG.',
      '🎬 <strong>Auto-detect carrusel vs video</strong>: si el post es un <code>/p/</code> de IG con múltiples slides (detectado por flechas "Siguiente"/"Next" y dots de paginación), se guarda como tipo <strong>carrusel</strong>. Si es <code>/reel/</code> o <code>/tv/</code>, se guarda como <strong>video</strong>. TikTok/YouTube Shorts también como video.',
      '📸 <strong>Screenshot fallback como último recurso</strong>: si Microlink falla Y el DOM no tiene og:image ni video poster, capturamos directamente la pantalla del webview (lo que estás viendo) y eso queda como portada. JPEG comprimido para no inflar Firestore.',
      '🔍 <strong>Extracción más completa</strong>: probamos meta tags og:image, twitter:image, og:image:secure_url. Si nada, buscamos el <code>&lt;img&gt;</code> más grande dentro del article (heurística para carruseles donde la primera slide es una imagen).',
      '✅ <strong>Toast confirma qué se capturó</strong>: ahora dice "Guardado como reel (con portada + caption)" o "Guardado como carrusel (con portada)" según lo que pudo extraer.'
    ]
  },
  '3.11.5': {
    title: 'Explorer captura portada + caption del reel automáticamente',
    features: [
      '🖼 <strong>Portada del video</strong>: el Explorer ahora extrae la imagen de la página directamente del DOM (og:image meta tag o el poster del &lt;video&gt;) — la cover real del reel/TikTok aparece en la card del Depósito, no más placeholder genérico.',
      '📝 <strong>Caption automático como descripción</strong>: el caption del reel/TikTok se guarda como <code>description</code> en la entry. Cuando programes el contenido más adelante, el caption original ya está pre-cargado para reutilizarlo o adaptarlo.',
      '🏷 <strong>Título inteligente</strong>: si la página tiene un og:title útil, lo usa. Si solo tiene "Instagram"/"TikTok" genérico, agarra la primera línea del caption como título de la entry.',
      '🚀 <strong>Sin login walls</strong>: como leemos los datos directamente del DOM ya renderizado en el webview (donde ya estás logueado en IG/TikTok), no falla por bloqueo de login como pasaba con fetchOgData.',
      '📤 <strong>Caption fluye al programador</strong>: cuando vayás a "Programar" la entry, el modal de scheduling ya recibe el caption original como descripción — listo para reutilizar tal cual o variar con Claude.'
    ]
  },
  '3.11.4': {
    title: 'Explorer: guardar directo en cualquier categoría/subcategoría',
    features: [
      '🗂 <strong>Dropdown jerárquico en el Explorer</strong>: ahora ves todas las categorías Y subcategorías que tenés en el Depósito y Banco de Referencias, organizadas con el mismo orden y agrupación que ves en el Depósito.',
      '🎯 <strong>Guardado directo a la casilla exacta</strong>: si seleccionás una subcategoría específica (ej: "Referencias → Tutoriales"), la entry se crea YA dentro de esa subcategoría — no hay que moverla manualmente después.',
      '📁 <strong>Opción "toda la categoría"</strong>: si la categoría tiene subcategorías pero no te importa cuál, podés guardarla en el padre directamente (sin subcategoría).',
      '🔄 <strong>Sync con workspace</strong>: cuando cambiás de workspace, las categorías del dropdown se recargan automáticamente.'
    ]
  },
  '3.11.3': {
    title: 'Depósito + Refs + Chat ahora son pestañas integradas',
    features: [
      '📦 <strong>Depósito como pestaña</strong>: ya no abre un panel lateral encima de la pantalla — ocupa toda la interfaz como cualquier otra pestaña. Más espacio para ver y gestionar las referencias.',
      '📚 <strong>Banco de Referencias como pestaña</strong>: igual integrado. Click "Refs" en el sidebar y la app entera se transforma en el banco.',
      '💬 <strong>Chat como pestaña</strong>: mismo tratamiento. Más espacio horizontal para ver mensajes y miembros del equipo.',
      '⚡ <strong>Lazy-load</strong>: cada tab se inicializa solo cuando la abrís la primera vez (no todo al arranque).',
      '🔄 <strong>Workspace switching</strong>: al cambiar de workspace, los iframes ya cargados se recargan automáticamente para mostrar la data del nuevo workspace.',
      '🚀 <strong>Modo PRO sigue funcionando</strong>: el split horizontal Depósito + Chat sigue intacto para los que lo usan, ahora coexiste con las pestañas.'
    ]
  },
  '3.11.2': {
    title: 'Fix navegación: webview directo en el renderer principal (sin iframe)',
    features: [
      '🐛 <strong>Fix crítico</strong>: el <code>&lt;webview&gt;</code> tag tenía problemas funcionando dentro de un iframe — por eso la navegación no funcionaba. Ahora el browser embebido vive directamente en el renderer principal de la app.',
      '🌐 <strong>Arquitectura simplificada</strong>: sin iframe intermedio, sin postMessage. Acceso directo a Firestore y al usuario logueado desde el explorador, todo más rápido y robusto.',
      '🚀 <strong>Página inicial</strong>: cambié a Google.com como home (en vez de instagram.com/explore). Desde ahí podés buscar lo que quieras — los quick links 📷 IG / 🎞 Reels / 🎵 TikTok / 📺 Shorts siguen disponibles para ir directo.',
      '✅ <strong>Si la nav sigue fallando</strong>, ahora vas a ver toast rojo con el código de error específico.'
    ]
  },
  '3.11.1': {
    title: 'Explorador embebido como pestaña + fix navegación',
    features: [
      '🪟 <strong>Explorar ahora es una pestaña INTEGRADA</strong>: en lugar del panel lateral que se abría como una ventana, el Explorador ocupa toda la interfaz como cualquier otra pestaña (Tareas, Calendario, etc). Sin ventanas externas — todo dentro de Task Manager.',
      '🐛 <strong>Fix navegación</strong>: ahora <code>loadURL</code> espera al evento <code>dom-ready</code> antes de navegar. Si fallás escribiendo una URL, te avisa con un toast rojo en vez de quedarse colgado en silencio. Las URLs sin <code>https://</code> se completan automáticamente.',
      '⚡ <strong>Lazy-load</strong>: el browser solo arranca cuando tocás "Explorar" la primera vez (ahorra recursos al abrir la app).',
      '📋 <strong>Fallback robusto</strong>: si <code>loadURL</code> falla por algún motivo, intenta con <code>setAttribute(\'src\', ...)</code> automáticamente.'
    ]
  },
  '3.11.0': {
    title: 'Explorador embebido — investigá referencias sin salir de la app',
    features: [
      '🌐 <strong>Nuevo botón "Explorar" en el sidebar</strong>: abre un browser embebido (Electron webview) que navega Instagram, TikTok y YouTube Shorts directamente dentro de Task Manager. Login persistente entre sesiones (cookies).',
      '🚀 <strong>Quick links</strong> en la barra superior: 📷 IG Explore, 🎞 IG Reels, 🎵 TikTok For You, 📺 YouTube Shorts. Un click te lleva a la sección que querés investigar.',
      '⬅➡🔄 <strong>Controles de navegación</strong>: atrás, adelante, recargar y barra de URL editable. Funciona como un browser normal.',
      '💾 <strong>Botón "Guardar URL al Depósito"</strong> abajo: cuando estás en un reel o video que te interesa, click → se crea automáticamente la entry en el Depósito con esa URL. El sistema detecta si es video/material y carga la cover OG en background.',
      '🗂 <strong>Selector de categoría</strong>: antes de guardar, elegí en qué categoría del depósito tirarlo (o dejá "General"). Las categorías se cargan desde Firestore — siempre actualizadas.',
      '✨ <strong>Cero copy/paste manual</strong>: ya no tenés que abrir Safari/Chrome aparte, copiar el link, volver a la app y pegarlo. Todo en un click.'
    ]
  },
  '3.10.5': {
    title: 'Recorder: topbar a la izquierda + guardar en celular',
    features: [
      '👈 <strong>Botones de la barra superior reubicados al costado izquierdo</strong>: cámara/fuente/teleprompter/slider toggle ahora son una columna vertical pegada a la izquierda. Liberé toda la franja superior de la pantalla — más espacio para framing del video.',
      '💾 <strong>Botón "Guardar" en el celular</strong>: en la pantalla de previsualización (después de grabar) hay un botón nuevo para descargar el video al teléfono. En iOS abre el share sheet nativo (Guardar vídeo → Fotos). En Android baja directo a Descargas.',
      '💾 <strong>También podés guardar después de enviar al desktop</strong>: en la pantalla "Video enviado!" hay un botón "💾 Guardar también en el celular" para tener el archivo local además de en Cloudinary.'
    ]
  },
  '3.10.4': {
    title: 'Recorder: fix zoom exagerado + slider colapsable + landscape OK',
    features: [
      '🔍 <strong>Fix del zoom exagerado</strong>: la cámara ya no fuerza 1080×1920 portrait — ahora usa el FOV nativo del celular. El canvas se adapta al tamaño real del stream, así que ves la misma toma que ves en la cámara original del teléfono. Sin recortes, sin zoom forzado.',
      '📐 <strong>Fix orientación landscape/portrait</strong>: si girás el celular antes de grabar, el video sale en la orientación correcta (no más vertical-cuando-horizontal y al revés).',
      '⚡ <strong>Slider de velocidad colapsable</strong>: nuevo botón "⚡" en la barra superior para ocultar/mostrar el slider. En landscape arranca oculto por default — abrilo solo cuando lo necesitás. (Igual que el botón "📝" del guion).',
      '🔒 <strong>Resolución locked durante grabación</strong>: si la cámara cambia de aspect mid-recording, el canvas mantiene la resolución original con cover-fit en vez de redimensionarse (lo que rompería el MediaRecorder).'
    ]
  },
  '3.10.3': {
    title: 'Recorder: front+back en un solo video + landscape thumb-zone',
    features: [
      '🎥 <strong>Cambiá entre cámara frontal y trasera SIN cortar la grabación</strong>: ahora el celular graba a través de un canvas HTML5 (no del MediaStream directo). Tap al 🔄 mid-recording → la fuente del canvas cambia, la grabación sigue. Resultado: <strong>UN SOLO archivo continuo</strong> con escenas de ambas cámaras (front + back).',
      '🎙 <strong>Audio persistente</strong>: el track de mic se captura una sola vez al abrir la app y queda activo toda la sesión, así no hay glitch al cambiar de cámara.',
      '👍 <strong>Botones reordenados en landscape</strong>: cuando sostenés el celular horizontal (selfie con una sola mano), los controles se anclan al costado derecho del dispositivo. <strong>El botón Pausa queda en la esquina inferior derecha</strong> — donde cae naturalmente el pulgar.',
      '🎚 <strong>Slider de velocidad horizontal en landscape</strong>: se reorienta automáticamente para no chocar con la columna de botones de la derecha.',
      '🔧 <strong>Topbar (cámara, fuente, ocultar guion)</strong> también se reorienta a vertical-izquierdo en landscape para liberar la zona del pulgar.'
    ]
  },
  '3.10.2': {
    title: 'Recorder pro: pausa, teleprompter movible/redimensionable y video visible siempre',
    features: [
      '🎥 <strong>Botón "Ver video grabado" en la card del entry</strong>: una vez que grabás desde el celular, aparece un botón naranja al lado de "Ver transcripción". Click → se abre el video de Cloudinary directo.',
      '📂 <strong>Sección Videos grabados en el modal de transcripción</strong>: cada grabación queda con su player + link copiable + botón abrir + 🗑 borrar. Persistente, no se pierde.',
      '🎬 <strong>Editor ve el video automáticamente</strong>: al asignar la tarea, el video grabado se mete como <code>videoLink</code> de la tarea (prioritario sobre el reel de IG de referencia). El editor abre la tarea y ve "🎬 Video de referencia" con tu grabación.',
      '⏸ <strong>Botón Pausar/Reanudar grabación en el celular</strong>: al lado derecho del botón de grabar. Tap pausa el video, tap de nuevo continúa donde lo dejaste. El timer se congela en pausa (no suma tiempo muerto).',
      '✥ <strong>Teleprompter movible</strong>: arrastrá la barra superior del teleprompter para moverlo a cualquier parte de la pantalla del celular.',
      '↘ <strong>Teleprompter redimensionable</strong>: agarrá la esquina inferior derecha y arrastrá para hacerlo más grande/chico. La posición y tamaño se guardan — la próxima vez que abrís el recorder, queda como lo dejaste.',
      '⏱ <strong>Status "pausado"</strong> visible en el desktop cuando el celular está en pausa.'
    ]
  },
  '3.10.1': {
    title: 'Recorder: speed slider + video queda visible en el modal',
    features: [
      '🎚 <strong>Slider de velocidad fino en el celular</strong>: en lugar de los botones +/− (que saltaban mucho), ahora hay un slider vertical en el costado derecho que va de 0 a 50 con curva suave — podés ajustar el autoscroll a la velocidad EXACTA con la que leés.',
      '📍 <strong>Indicador en pantalla</strong>: arriba del slider se ve "▶ 0.45" (o ⏸ si está pausado) para saber a qué velocidad va.',
      '🟢 <strong>Estados en tiempo real</strong>: el desktop ahora muestra "📱 Celular conectado / 🔴 Grabando / 📤 Subiendo / ✓ Recibido" según lo que pasa en el celular.',
      '🎬 <strong>Video queda visible en el modal</strong>: cuando termina la grabación, en lugar de cerrarse, el modal cambia y muestra el video player + link de Cloudinary + botones (📋 Copiar / 🔗 Abrir / 🔄 Grabar otro). El video YA quedó asociado al entry — no hace falta hacer nada más.'
    ]
  },
  '3.10.0': {
    title: 'Grabar desde el celular con teleprompter (QR pairing)',
    features: [
      '📱 <strong>Conectá tu celular al teleprompter del desktop</strong>: en el modal de transcripción → click "🎬 Teleprompter" → aparece un nuevo botón verde "📱 Grabar desde celular".',
      '🔲 <strong>QR + sesión efímera</strong>: el desktop genera un QR; lo escaneás con el celular y abre una web app (jainierrojas-arch.github.io/task-manager-app/recorder/) con el guion ENCIMA del preview de cámara.',
      '🎥 <strong>Grabás leyendo el script</strong>: cámara frontal o trasera, controles de tamaño de fuente y autoscroll, timer en pantalla. Botón gigante para empezar/parar.',
      '☁ <strong>Auto-upload a Cloudinary</strong>: al terminar, el celular sube el video directamente con tu config de Cloudinary (la sesión lleva creds pasadas vía Firestore).',
      '✨ <strong>Aparece solo en el desktop</strong>: el video se attacha automáticamente al entry del que abriste el teleprompter. Listo para asignar al editor.',
      '⚠️ <strong>Importante</strong>: actualizá las Firestore Rules con la versión nueva del repo (firestore.rules) — agrega la colección recordingSessions con permisos públicos limitados al doc de sesión.',
      '🔧 <strong>Requiere Cloudinary configurado</strong>: si no lo tenés, andá a Configuración y pegá tu cloud name + upload preset unsigned.'
    ]
  },
  '3.9.22': {
    title: 'Variación con Tono + Estilo + Eliminar workspace fix',
    features: [
      '🎨 <strong>Selectores de Tono y Estilo</strong> al generar variaciones: dentro del modal de transcripción ahora hay 2 dropdowns para elegir el perfil de la nueva versión.',
      '🎵 <strong>8 tonos disponibles</strong>: Educativo, Energético, Motivacional, Storytelling, Controversial, Casual, Dramático, Neutro.',
      '🎯 <strong>8 estilos / hooks</strong>: Hook + dato impactante, Pregunta provocadora, Lista de pasos, Mito vs realidad, Antes/Después, Caso real, Tutorial directo, Comparativa.',
      '🪝 <strong>Hook viral obligatorio</strong>: el prompt fuerza a Claude a empezar con un gancho de retención de audiencia (los primeros 3s deciden), mantener la idea, cambiar palabras y ángulo, y cerrar con cliffhanger/CTA.',
      '🏷 <strong>Cada variación queda taggeada</strong> con su tono y estilo — visible en la card de la variación.',
      '🗑 <strong>Fix Eliminar workspace</strong>: botones ✎/✕ ahora visibles siempre (antes solo al hover). Firestore Rules actualizadas: el owner también puede eliminar su workspace (antes solo admin).',
      '⚠️ <strong>Importante</strong>: si actualizaste las Firestore Rules antes, andá a Firebase Console → Firestore → Reglas y pegá las nuevas desde firestore.rules en el repo.'
    ]
  },
  '3.9.21': {
    title: 'Botón "Ver transcripción" + Renombrar/Eliminar workspaces',
    features: [
      '🎤 <strong>Botón "Ver transcripción" en cada entry transcrita</strong>: una vez transcrita, en lugar de mostrar la transcripción inline (que era poco usable), aparece un botón turquesa que <strong>abre el modal completo</strong> con todas las opciones: variaciones, teleprompter, copiar, borrar.',
      '✏ <strong>Renombrar workspaces</strong>: en el dropdown del workspace switcher, hover sobre cualquier workspace muestra un ✎ — click para renombrar. Útil si pusiste un nombre temporal.',
      '🗑 <strong>Eliminar workspaces</strong>: junto al ✎ aparece un ✕ rojo (excepto en el workspace default). Click → confirma → se elimina. La data tagged con ese workspace queda en Firestore (no se borra) pero no será visible.',
      '👤 <strong>Permisos</strong>: solo admins o el owner del workspace pueden editar/eliminar.'
    ]
  },
  '3.9.20': {
    title: 'Fix Recrear guion con Claude — handler de texto libre',
    features: [
      '🐛 <strong>Fix</strong>: el botón "Recrear guion con Claude" devolvía vacío porque usaba el handler <code>call-claude</code> que está hecho para el agente IA (force tool use). Agregué un handler nuevo <code>generate-with-claude</code> para texto libre.',
      '✅ Ahora click en ✨ Generar variación con Claude → Sonnet escribe la variación → aparece debajo del original con botones (Teleprompter / Copiar / Borrar).'
    ]
  },
  '3.9.19': {
    title: 'Fix yt-dlp: usar formato nativo (sin necesitar ffmpeg)',
    features: [
      '🐛 <strong>Fix</strong>: yt-dlp fallaba en post-processing porque exigía ffmpeg para convertir a mp3. Solución: descargamos el audio en formato NATIVO (m4a / webm / mp4) según lo que ofrezca cada plataforma. Whisper acepta todos esos formatos directo.',
      '⚡ <strong>Sin dependencias extra</strong>: ya no necesitás instalar ffmpeg. Solo yt-dlp (que ya tenés) y listo.',
      '🎯 Cada video se descarga en su mejor calidad nativa de audio — más rápido + menos errores.'
    ]
  },
  '3.9.18': {
    title: 'Detección de yt-dlp en más rutas (~/.local/bin)',
    features: [
      '🔧 Búsqueda de yt-dlp ampliada: además de Homebrew (/opt/homebrew/bin, /usr/local/bin), ahora detecta yt-dlp en <code>~/.local/bin</code> y <code>~/bin</code> — útil para usuarios que lo instalaron sin Homebrew (descarga directa del binario).',
      '✅ Funciona si lo instalaste con cualquier método: brew, pip, descarga manual.'
    ]
  },
  '3.9.17': {
    title: 'Transcripción IG/TikTok/YouTube via yt-dlp local (más confiable)',
    features: [
      '🚀 <strong>Cobalt → yt-dlp</strong>: Cobalt cambió a auth-only en 2024 (ya no es público gratis). Reemplazado por <strong>yt-dlp</strong> que corre localmente — el estándar para descargar de cualquier red social. Soporta más plataformas que Cobalt.',
      '⚙️ <strong>Pre-requisito UNA SOLA VEZ</strong>: tenés que instalar yt-dlp con un comando en terminal:<br><code>brew install yt-dlp</code><br>(Homebrew, gratis, 30 segundos. En Windows: <code>winget install yt-dlp</code>)',
      '✅ <strong>Después de instalar</strong>: cualquier link de IG/TikTok/YouTube/Twitter/Facebook/Reddit/Vimeo/SoundCloud/Twitch transcribe directo. Sin Cloudinary, sin pasos manuales.',
      '🔍 <strong>Ventajas vs Cobalt</strong>: yt-dlp es más confiable, no tiene rate limits, soporta 1000+ plataformas, se actualiza solo cuando las plataformas cambian.',
      '⚠️ <strong>Si yt-dlp no está instalado</strong>: el modal te avisa con el comando exacto a copiar/pegar.'
    ]
  },
  '3.9.16': {
    title: 'Fix CORS de Cobalt + botón X del modal',
    features: [
      '🐛 <strong>Fix "Failed to fetch"</strong>: el fetch a Cobalt fallaba por CORS desde el renderer (origen file://). Lo movido al main process via IPC — ahora la llamada HTTP corre sin restricciones de browser. La transcripción de IG/TikTok/YouTube debería funcionar.',
      '❌ <strong>Fix botón X del modal</strong>: el botón cerrar no funcionaba porque <code>display:flex</code> inline (que puse para forzar visibilidad) bloqueaba el remove-class. Ahora también resetea el inline style al cerrar.',
      '⚡ Más rápido y robusto — el main process tiene mejor handling de timeouts (20s) y no depende de la red del browser.'
    ]
  },
  '3.9.15': {
    title: 'Transcripción ahora funciona con Instagram / TikTok / YouTube directo',
    features: [
      '🚀 <strong>Cobalt.tools integrado</strong>: cuando le des click a "Transcribir" en una entry con link de Instagram / TikTok / YouTube / Twitter / Vimeo / etc., la app usa Cobalt.tools para extraer la URL directa del audio antes de mandarlo a Whisper. Sin pasar por Cloudinary.',
      '📋 <strong>Plataformas soportadas</strong>: Instagram (reels, posts, stories), TikTok, YouTube (videos, shorts), Twitter/X, Facebook, Reddit, Vimeo, SoundCloud, Twitch.',
      '🔁 <strong>Fallback dual</strong>: si el endpoint principal de Cobalt no responde, prueba con un instance alternativo automáticamente.',
      '⚠️ <strong>Cobalt es servicio público gratuito</strong>: tiene rate limits (~1 request por minuto sostenido). Si transcribís muchos videos seguidos puede saturar — esperar unos segundos y reintentar.',
      '✅ <strong>Cloudinary sigue siendo la opción más confiable</strong> para volumen alto, pero ahora ya NO es obligatorio.'
    ]
  },
  '3.9.14': {
    title: 'Fix Transcribir: detectar URLs no descargables + filename correcto',
    features: [
      '🔍 <strong>Detección estricta de plataformas protegidas</strong>: si el video está en YouTube/Instagram/TikTok/Facebook (incluso CDN URLs como cdninstagram.com), el botón Transcribir NO intenta procesar — muestra error claro pidiendo subir a Cloudinary primero.',
      '📦 <strong>Check de Content-Type</strong>: si el server devuelve HTML (típico cuando el URL no es realmente un archivo), error inmediato en lugar de mandar HTML a Whisper.',
      '📝 <strong>Filename correcto</strong>: el archivo enviado a Whisper ahora tiene extensión que coincide con el Content-Type real (mp4/mov/mp3/wav/webm), así Whisper acepta sin error de formato.',
      '👁 <strong>Status visible del URL</strong>: el modal muestra los primeros 60 caracteres del URL que se está descargando — útil para diagnosticar qué está pasando.',
      '⚠️ <strong>Para tus videos HEYGEN/HIGGSFIELD</strong>: si están en YouTube o sin URL directa de Cloudinary, hay que subir el archivo a Cloudinary primero. La transcripción solo funciona con archivos descargables directos.'
    ]
  },
  '3.9.13': {
    title: 'Fix click Transcribir — event delegation global',
    features: [
      '🐛 <strong>Fix</strong>: el binding del click sobre "Transcribir video" se hacía vía <code>area.querySelectorAll</code> en cada renderEntries. Por algún motivo (timing, re-render, scope), el handler no se enganchaba. Ahora usamos <strong>event delegation a nivel document</strong> — un solo listener global captura clicks en cualquier botón con data-transcribe, sin importar cuándo se renderice.',
      '✅ Click ahora funciona robusto contra re-renders y cambios de DOM.'
    ]
  },
  '3.9.12': {
    title: 'Fix wireup del modal Transcripción',
    features: [
      '🐛 <strong>Fix</strong>: el wireup del modal de transcripción se hacía dentro de DOMContentLoaded, pero deposit-renderer.js corre AL FINAL del body — DOMContentLoaded a veces ya había disparado, entonces los handlers nunca se enganchaban. Ahora detecta el estado del DOM y enganchanncha directo si ya está listo.',
      '🛡 <strong>Safety net</strong>: si el modal no existe en el DOM (caché viejo), aparece un alert claro en vez de fallar silencioso. También fuerzo <code>display: flex</code> inline por si el CSS está cacheado mal.',
      '🔍 <strong>console.log</strong> al click para diagnosticar (revisable en consola).'
    ]
  },
  '3.9.11': {
    title: 'Modal de Transcripción + Teleprompter integrado',
    features: [
      '🎤 <strong>Modal completo al transcribir</strong>: click en "Transcribir video" ahora abre un modal grande dedicado con: guion original, botones de acción y todas las variaciones generadas — todo en un solo lugar.',
      '✨ <strong>Generar variación desde el modal</strong>: botón "Generar variación con Claude" dentro del modal — crea una versión nueva del guion con ángulo distinto. Cada variación queda guardada y se muestra debajo.',
      '🎬 <strong>Teleprompter integrado</strong>: cada guion (original o variación) tiene su propio botón "🎬 Teleprompter" que abre vista full-screen negra con texto grande haciendo scroll automático. Listo para grabar.',
      '⚙️ <strong>Controles del Teleprompter</strong>: ▶ Play/Pausa, ⏮ Inicio, slider de Velocidad (10-200), slider de Tamaño de fuente (20-80px), toggle Espejado (para uso con prompter de cámara). ESC cierra.',
      '📋 <strong>Copiar guion</strong>: cada bloque (original + variaciones) tiene botón Copiar para llevar el texto al portapapeles.',
      '🔄 <strong>Re-transcribir</strong>: botón 🔄 dentro del modal para re-procesar desde cero si la transcripción salió mal.',
      '🗑 <strong>Borrar variaciones individuales</strong> sin tocar las demás.'
    ]
  },
  '3.9.10': {
    title: 'Fix iframe API + botón Meet en sidebar',
    features: [
      '🐛 <strong>Fix click sobre videos en Depósito</strong>: el iframe del Depósito no tenía <code>window.api</code> (no carga preload propio). Ahora hereda automáticamente del parent o usa stubs de fallback. Click en videos abre en browser externo correctamente.',
      '🎤 <strong>Transcribir ya funciona</strong>: el bug del <code>openExternal</code> bloqueaba el flujo de transcripción también. Con el iframe accediendo correctamente al API, el botón Transcribir descarga audio y lo manda a Whisper.',
      '📹 <strong>Botón Meet en sidebar</strong>: nuevo ícono 📹 que abre tu sala de reuniones (<code>https://meet.google.com/wwn-hgjx-czt</code>) en el browser por defecto. Acceso directo desde la app.',
      '🛣 <strong>Próximo</strong>: hacer el link de Meet configurable por workspace desde Settings (ahora está hardcodeado).'
    ]
  },
  '3.9.9': {
    title: '🐛 BUG CRÍTICO ENCONTRADO Y ARREGLADO — Depósito vuelve',
    features: [
      '🚨 <strong>Causa raíz</strong>: en v3.9.0 (cuando agregué la función "Recrear guion") quedó un string multi-línea con comillas simples, que es un SyntaxError silencioso en JavaScript. Esto rompía la ejecución de TODO deposit-renderer.js — por eso el panel quedaba vacío sin mostrar siquiera mis mensajes de debug. El error era invisible porque ocurría antes de que cargara el handler de errores.',
      '✅ <strong>Fix</strong>: convertir el string a usar <code>\\n</code> escapado en lugar de saltos de línea reales. Ahora deposit-renderer.js se ejecuta completo. El Depósito y Refs van a aparecer normalmente.',
      '🔍 <strong>Cómo lo encontré</strong>: corrí <code>node -c</code> sobre el archivo y reportó el error exacto. Lección aprendida: agregar syntax-check al pipeline de build.',
      '🙏 Perdón por las 9 versiones de ida y vuelta antes de detectarlo. El feature de transcripción y reescritura ya están listos también — solo necesitabas que el JS no estuviera roto.'
    ]
  },
  '3.9.8': {
    title: 'Fix orden de funciones + captura global de errores en iframe',
    features: [
      '🐛 <strong>Fix bug v3.9.7</strong>: la función <code>_setDebugBanner</code> estaba definida después de su primera llamada — moverla al inicio del módulo evita ReferenceError silencioso que rompía todo.',
      '🛡 <strong>Captura global de errores</strong> en iframe: agregué <code>window.onerror</code> y <code>unhandledrejection</code> handlers que muestran cualquier error JS en el subtitle del panel. Si algo falla, lo vas a ver en pantalla en lugar de silenciar.',
      '📸 Mandame screenshot del panel del Depósito apenas se instale.'
    ]
  },
  '3.9.7': {
    title: 'Debug visible en el panel del Depósito',
    features: [
      '🔍 <strong>Mensaje de debug arriba</strong> del panel del Depósito mostrando estado: autenticación, # categorías, # entries, errores. Esto me ayuda a diagnosticar de un vistazo qué está fallando sin necesidad de abrir consola.',
      '🚨 <strong>Error handlers</strong> en cada listener de Firestore — si algo falla, vas a ver el error específico en el panel.',
      '📸 Mandame screenshot de lo que dice el panel apenas lo abrás y lo arreglo.'
    ]
  },
  '3.9.6': {
    title: 'Hotfix: Depósito y Refs muestran todo (filtro workspace OFF en iframes)',
    features: [
      '🩹 <strong>Hotfix de emergencia</strong>: el filtro de workspace en los iframes (Depósito, Chat, Refs) estaba escondiendo data legítima. Lo desactivé completamente para que veas TODO tu contenido histórico.',
      '⚠️ <strong>Trade-off temporal</strong>: si tenés varios workspaces, los iframes van a mostrar data de TODOS (no solo el activo). El main window sigue filtrando correctamente — esto solo afecta a los paneles laterales.',
      '🔧 <strong>Solución definitiva</strong>: en una próxima versión voy a refactorear cómo los iframes reciben data — probablemente passing via postMessage desde el padre, así el filtrado es 100% confiable.'
    ]
  },
  '3.9.5': {
    title: 'Fix definitivo Depósito vacío — filosofía permisiva por defecto',
    features: [
      '🔄 <strong>Nueva estrategia de filtro</strong>: el iframe del Depósito y Chat ahora usa 3 estados: <code>unknown</code> (permisivo), <code>default</code> (permisivo), <code>non-default</code> (estricto).',
      '✅ <strong>Cuando hay duda, mostramos todo</strong>: si el iframe no recibe info clara del workspace, asume que sos default y muestra toda la data legacy. Mejor mostrar de más que esconder de menos.',
      '🔍 <strong>Verificación async actualiza el estado</strong>: si el workspace no es realmente default, el iframe lo detecta y aplica filtro estricto. Mientras tanto ya tenés tu data visible.',
      '✅ Después de instalar y reiniciar, el Depósito y Refs van a mostrar todo tu contenido histórico SI O SI.'
    ]
  },
  '3.9.4': {
    title: 'Fix definitivo Depósito vacío — auto-fix workspace default',
    features: [
      '🩹 <strong>Auto-fix del workspace default</strong>: si tu workspace "Mi Agencia" no tenía marcado <code>isDefault: true</code> en Firestore (por venir de versiones anteriores), ahora se marca automáticamente al cargar.',
      '🔍 <strong>Verificación async en iframe</strong>: además, el panel del Depósito y Chat verifican contra Firestore por su cuenta — si descubren que están en el workspace default, re-renderizan mostrando toda la data legacy. Triple seguro.',
      '✅ Después de instalar y reiniciar la app, todo tu contenido histórico (99+ Refs, 6 Depósito) debería aparecer cuando estés en Mi Agencia.'
    ]
  },
  '3.9.3': {
    title: 'Fix crítico: Depósito y Refs vacíos en Mi Agencia',
    features: [
      '🐛 <strong>Bug</strong>: en Mi Agencia (default) el panel del Depósito y Referencias mostraba vacío aunque tu data histórica seguía ahí. Causa: el iframe no detectaba correctamente que estaba en el workspace default y filtraba toda la data legacy sin <code>workspaceId</code>.',
      '✅ <strong>Fix</strong>: ahora el iframe recibe el ID del workspace default explícitamente (no solo un flag), con fallback a "el más viejo si no hay marcado". Triple seguro contra el bug.',
      '🔄 <strong>Recarga forzada del iframe</strong> cuando la URL cambia, así nunca queda con params viejos.',
      '👁 Después de instalar: cerrá Task Manager (Cmd+Q) y abrila de nuevo. El Depósito y Refs en Mi Agencia van a mostrar todo tu contenido histórico.'
    ]
  },
  '3.9.2': {
    title: 'Fix #2: botón Transcribir aparece en TODAS las entries con links',
    features: [
      '🎤 <strong>Botón siempre visible</strong>: en v3.9.0/3.9.1 el botón solo aparecía si la entry tenía links de tipos específicos. Ahora aparece en cualquier entry del Depósito que tenga al menos un link.',
      '🤖 <strong>Detección inteligente al click</strong>: cuando hacés click, la app revisa los links de la entry y decide automáticamente si puede transcribir (Cloudinary, mp4 directo, etc.) o si necesitás bajar/re-subir (Instagram, TikTok, YouTube).',
      '💡 <strong>Resultado</strong>: ahora vas a ver el botón aparecer en Referencias y en cualquier categoría del Depósito que tenga entries con links.'
    ]
  },
  '3.9.1': {
    title: 'Fix: botón Transcribir aparece en más tipos de videos',
    features: [
      '🐛 <strong>Bug fix</strong>: en v3.9.0 el botón "Transcribir" solo aparecía en entries con videos Cloudinary específicos. Ahora aparece en cualquier entry que tenga: link de tipo "Video", URL directa a archivo (.mp4/.mov/.mp3/.wav/etc.), o URL de Cloudinary.',
      '⚠️ <strong>Mensaje claro para plataformas protegidas</strong>: si tenés un link de Instagram/TikTok/YouTube y le das transcribir, te dice claramente que esos no se pueden descargar directos — necesitás bajar el video y subirlo a Cloudinary primero.',
      '🎯 Esto cubre el flujo real: la mayoría de videos en el Depósito ya están en Cloudinary, pero también algunos son URLs directas — ahora ambos casos funcionan.'
    ]
  },
  '3.9.0': {
    title: 'Transcripción de videos + Recreación de guiones con IA',
    features: [
      '🎤 <strong>Botón "Transcribir video"</strong> en cada entry del Depósito que tenga un video Cloudinary. Click → la app extrae el audio (compresión 64kbps via Cloudinary), lo manda a OpenAI Whisper, guarda el texto en la entry. Costo: ~$0.36/hora de video.',
      '✨ <strong>Botón "Recrear guion"</strong>: una vez transcrito, click → Claude reescribe el guion con un ángulo, hook y palabras distintas, manteniendo la idea. Cada variación se guarda — podés generar varias y elegir cuál usar.',
      '📝 <strong>Visualización inline</strong>: la transcripción aparece colapsada (click para expandir) en la card del entry. Las variaciones se muestran abajo con borde violeta.',
      '🔄 <strong>Re-transcribir</strong>: botón para volver a procesar (ej. si el primer intento salió mal o querés actualizar).',
      '🔑 <strong>API key per workspace</strong>: configurás tu OpenAI API key en Settings — se guarda por workspace (cada cliente puede tener la suya o compartir).',
      '⚠️ <strong>Limitaciones</strong>: video debe ser Cloudinary (uses URL transformation para extraer audio). Audio máx ~25MB tras compresión (≈45 min de audio). Para videos más largos, splitting será futuro.',
      '🛣 <strong>Futuro</strong>: agregar prompts custom para la reescritura ("hookea más", "más casual", "para TikTok", etc), exportar como caption listo para programar.'
    ]
  },
  '3.8.4': {
    title: 'Cloud Function workspace-aware — publica con la config del workspace correcto',
    features: [
      '🔧 <strong>Backend completa el círculo</strong>: la Cloud Function que publica posts en Instagram + TikTok ahora lee la config del workspace correcto del post. Si el post lo creaste en "Cliente Pizza", se publica con los webhooks de Cliente Pizza, no los de Mi Agencia.',
      '🛡 <strong>Validación pre-publicación</strong>: si un post está en un workspace SIN webhooks configurados, falla con un mensaje claro en lugar de intentar publicar con la config equivocada.',
      '🔁 <strong>Fallback inteligente</strong>: si el workspace no tiene config propia, usa la global. Esto cubre el caso de posts antiguos sin <code>workspaceId</code> y el workspace default.',
      '✅ <strong>Multi-workspace COMPLETO</strong>: con esta versión cierra el ciclo end-to-end. Cada cliente puede tener su propia agencia separada con sus propios datos, settings y publicaciones automáticas.',
      '⚠️ <strong>Importante</strong>: para que esta versión funcione, deployear la Cloud Function actualizada (yo lo hice por vos en este push).'
    ]
  },
  '3.8.3': {
    title: 'Settings per-workspace — cada cliente, su propio Make/GHL/Cloudinary',
    features: [
      '⚙️ <strong>Cada workspace tiene sus propios settings</strong>: el Make webhook (IG), GHL TikTok webhook y Cloudinary config ahora son por workspace. Cuando estás en "Cliente Pizza", configurás los datos de Cliente Pizza; cuando volvés a "Mi Agencia", aparecen los tuyos.',
      '📦 <strong>Migración automática</strong>: tu config existente del workspace default (Mi Agencia) se copia automáticamente al primer arranque post-update. No tenés que volver a pegar nada.',
      '🔑 <strong>Naming convention</strong>: en Firestore las configs ahora son <code>config/instagram_{wsId}</code> y <code>config/cloudinary_{wsId}</code>. La global <code>config/instagram</code> sigue existiendo como fallback.',
      '⚠️ <strong>Limitación temporal</strong>: la Cloud Function que publica en IG/TikTok todavía lee la config GLOBAL — entonces los posts creados en workspaces NUEVOS van a publicarse usando la config de Mi Agencia. Eso lo arreglamos en <strong>v3.8.4</strong> haciendo el backend workspace-aware.',
      '🛣 <strong>Próximo paso (v3.8.4)</strong>: Cloud Function lee config del workspace correcto al publicar, basado en el workspaceId del post.'
    ]
  },
  '3.8.2': {
    title: 'Fix crítico: Depósito y Chat ahora respetan workspace activo',
    features: [
      '🐛 <strong>Bug fix urgente</strong>: en v3.8.1 al estar en un workspace nuevo (no default) y abrir el panel de Depósito, Chat o Referencias, todavía mostraba la data de "Mi Agencia" porque el filtro en los iframes era demasiado permisivo.',
      '✅ <strong>Fix</strong>: el iframe ahora recibe también el flag <code>isDefault</code> en la URL. Solo el workspace por defecto (Mi Agencia) ve docs sin <code>workspaceId</code> (legacy). Cualquier otro workspace ve únicamente lo suyo.',
      '🔄 También cuando cambiás de workspace mientras un panel está abierto, los iframes se recargan con la nueva URL parametrizada — ya no quedan colgados con el workspace anterior.'
    ]
  },
  '3.8.1': {
    title: 'Multi-workspace REAL — data filtrada por workspace',
    features: [
      '🔒 <strong>Cada workspace ve solo SU data</strong>: ahora cuando cambiás de workspace, las tareas, programación, depósito, ideas, plantillas de captions y chat se filtran automáticamente al workspace activo. Si creás una tarea en "Cliente Pizza", queda dentro de Cliente Pizza — no aparece en Mi Agencia.',
      '✨ <strong>Cero migración manual</strong>: tu data existente (toda creada antes de v3.8.1) sigue viviendo en "Mi Agencia" automáticamente. Cuando estás en el workspace por defecto ves TODO lo de siempre. Cuando creás un workspace nuevo, arranca vacío y se llena con lo que crees ahí.',
      '⚙️ <strong>Auto-inyección de workspaceId</strong>: las 25+ funciones que crean datos (nuevas tareas, posts programados, ideas, depósito, etc.) ahora todas inyectan el workspaceId activo automáticamente. No hay forma de olvidarse.',
      '🪟 <strong>Iframes (chat / depósito) reciben el workspace via URL</strong>: cuando abrís el panel lateral, le pasamos el workspaceId al iframe. Los listeners del chat y depósito filtran por ese workspaceId. Cambiar de workspace recarga los iframes con el nuevo.',
      '🛣 <strong>Próximo paso (v3.8.2)</strong>: settings per-workspace (Make webhook, Cloudinary, GHL, Telegram bot) — para que cada cliente tenga sus propias automatizaciones.',
      '⚠️ <strong>Importante</strong>: la Cloud Function que publica posts en IG/TikTok todavía lee la config global. Eso lo arreglamos en v3.8.3 cuando hagamos el backend workspace-aware.'
    ]
  },
  '3.8.0': {
    title: 'Multi-workspace — Fundación (creación + switcher)',
    features: [
      '🌐 <strong>Workspace switcher funcional</strong>: el badge "Mi Agencia ▾" arriba a la izquierda ahora abre un dropdown con la lista de tus workspaces + botón "+ Nuevo workspace".',
      '🏢 <strong>Crear workspaces nuevos</strong>: click "+ Nuevo workspace" → modal pidiendo nombre → se crea en Firestore y queda listo.',
      '🔄 <strong>Workspace por defecto auto-creado</strong>: la primera vez que abras la app post-update, se crea automáticamente "Mi Agencia" con todos los miembros del equipo. No hace falta migrar nada.',
      '💾 <strong>Persistencia</strong>: tu última selección de workspace se guarda en localStorage — la próxima vez que abras la app vuelve al mismo workspace.',
      '⚠️ <strong>Importante — esto es solo la fundación</strong>: en v3.8.0 el switcher es VISUAL — la data (tareas, depósito, programación, equipo) sigue compartida entre workspaces. Esto es así por diseño para validar el flujo sin riesgo de mover data accidentalmente.',
      '📋 <strong>Próximo paso (v3.8.1)</strong>: filtrado real por workspace — cada workspace ve solo SU data. Va a venir con migración automática que asigna toda tu data actual al workspace "Mi Agencia".',
      '🔐 <strong>IMPORTANTE — actualizar Firestore Rules</strong>: agregamos reglas para la colección /workspaces. Si todavía no actualizaste a las rules de v3.3+, tampoco te van a funcionar éstas. Mirá <code>firestore.rules</code> en el repo.'
    ]
  },
  '3.7.4': {
    title: 'Modo PRO embebido — Depósito + Chat dentro de la ventana',
    features: [
      '🚀 <strong>Modo PRO embebido</strong>: el botón "Modo PRO" del dropdown de usuario ya no abre 3 ventanas separadas — abre el panel lateral en split horizontal con <strong>Depósito arriba y Chat abajo</strong>, todo dentro de la ventana principal. El panel ocupa 50% de la pantalla.',
      '🔄 <strong>Toggle</strong>: click una vez → entra en Modo PRO. Click otra vez → sale. ESC también cierra.',
      '👁 <strong>Mientras estás en Modo PRO</strong>: tareas / programación / lo que sea que estés mirando en el main quedan visibles a la izquierda. Trabajás en paralelo sin perder contexto.',
      '⚡ <strong>Estado preservado</strong>: si salís y volvés a entrar en Modo PRO, el chat y depósito mantienen su scroll/estado.',
      '🛣 <strong>Próximo paso (v3.8.0)</strong>: multi-workspace funcional — switcher real para cambiar entre clientes con datos 100% separados.'
    ]
  },
  '3.7.3': {
    title: 'Chat / Depósito / Referencias dentro de la ventana + ManyChat en sidebar',
    features: [
      '🪟 <strong>Panel lateral embebido</strong>: Chat, Depósito de Ideas y Referencias ahora se abren como un panel deslizante <strong>dentro de la ventana principal</strong>, en vez de como ventanas separadas. Click el ícono del sidebar (o cerrar con ✕ / ESC) para abrir/cerrar.',
      '📐 <strong>3 tamaños del panel</strong>: tras abrir, en el header del panel hay 3 botones (◧ / ◨ / ⬛) para elegir entre ancho normal (540px), medio (720px) o grande (50% de la pantalla). Útil cuando estás trabajando en el depósito y querés más espacio.',
      '🤖 <strong>Botón ManyChat en el sidebar</strong>: nuevo ícono 🤖 que abre <code>app.manychat.com</code> en tu browser por defecto. ManyChat bloquea iframes (X-Frame-Options) así que no se puede embeber, pero queda a un click de distancia.',
      '⌨️ <strong>ESC para cerrar</strong> el panel lateral, igual que cualquier modal moderno.',
      '🔁 <strong>Estado preservado</strong>: si abrís el chat, lo cerrás y volvés a abrir, no recarga el iframe — mantiene tu posición en la conversación. Solo recarga cuando cambiás de panel (chat → depósito por ejemplo).',
      '⚠️ <strong>Limitaciones conocidas</strong>: dentro del iframe, los botones de minimizar/cerrar de la ventana del chat/depósito quedan inertes (usá el ✕ del panel en su lugar). El cambio de tema desde la ventana principal puede no propagar al iframe — si pasa, recargá.',
      '🛣 <strong>Próximo paso (v3.7.4)</strong>: Modo PRO embebido (split layout dentro de la misma ventana sin abrir 3 ventanas separadas).'
    ]
  },
  '3.7.2': {
    title: 'Pulido fino — tipografía, spacing y microinteracciones',
    features: [
      '✍️ <strong>Tipografía Inter</strong> en toda la app — la misma que usan Linear, Notion, Stripe. Le da un look mucho más profesional y limpio.',
      '🎯 <strong>Microinteracciones suaves</strong> en todo lo interactivo: hover, click, transiciones de color y sombras coordinadas. Se siente más "vivo".',
      '🪟 <strong>Modales con backdrop blur</strong>: cuando se abre un modal, el fondo se difumina (estilo iOS / macOS) en vez de quedarse plano.',
      '✨ <strong>Empty states más prolijos</strong>: cuando una pestaña está vacía, ahora muestra un ícono circular con gradiente sutil + animación de entrada en vez del placeholder básico.',
      '🎚 <strong>Scrollbars finitos</strong>: 8px en vez del default del sistema, casi invisibles hasta que pasás el mouse por encima.',
      '💎 <strong>Sombras suaves al hover</strong> en cards de tareas, programaciones e ideas — se sienten como tarjetas físicas levitando ligeramente.',
      '🎨 <strong>Botones con glow</strong> sutil al hover (primario violeta, success turquesa, danger rojo) — refuerza el color de acción.'
    ]
  },
  '3.7.1': {
    title: 'Header refinado: workspace badge + user dropdown',
    features: [
      '🏷 <strong>Workspace badge a la izquierda</strong>: arriba del todo aparece un badge "Mi Agencia" tipo ClickUp/Slack. Por ahora es estático — cuando activemos multi-cliente (Fase 4) este badge se vuelve dropdown para cambiar entre clientes.',
      '👤 <strong>User dropdown a la derecha</strong>: tu nombre + avatar arriba a la derecha. Click → menú con tu info, "Modo PRO", "Configuración", "Cerrar sesión". Más limpio que tener todo eso visible en la barra siempre.',
      '🧹 <strong>User-bar más limpia</strong>: los botones de Chat/Refs/Cloud/Pendientes que estaban en el top quedaron ocultos (ahora viven en el sidebar de Fase 1). La barra de arriba ahora respira.',
      '🎨 <strong>Próximo paso (3.7.2)</strong>: pulido fino de tipografía, spacing en cards, microinteracciones y empty states más prolijos.'
    ]
  },
  '3.7.0': {
    title: 'Sidebar lateral estilo ClickUp — primera fase del rediseño',
    features: [
      '🪧 <strong>Nuevo sidebar lateral izquierdo</strong>: las pestañas horizontales arriba se reemplazaron por una columna vertical de íconos a la izquierda (estilo ClickUp / Linear / Notion). Más profesional, más espacio vertical para el contenido.',
      '🎯 <strong>Toda la navegación en un solo lugar</strong>: Tareas, Mis tareas, Personal, Calendario, Ideas, Programar, Nueva, Aprobar, Hechas, Equipo, Depósito, Referencias, Chat, Nube, Config — todo accesible desde el sidebar con íconos claros.',
      '🏷 <strong>Badges sincronizados</strong>: los contadores de notificaciones (chat sin leer, referencias nuevas, depósito pendiente, etc.) aparecen ahora en el sidebar también.',
      '🔧 <strong>Bajo riesgo</strong>: la lógica interna de las pestañas no se tocó — el sidebar solo dispara los mismos clicks que harías en los tabs viejos. Si algo no anda bien, lo arreglamos rápido.',
      '🎨 <strong>Esto es solo Fase 1</strong>: en próximas versiones (3.7.1, 3.7.2) viene refinamiento del header con workspace badge + dropdown de usuario estilo ClickUp y pulido de tipografía/spacing.'
    ]
  },
  '3.6.1': {
    title: 'Tonalidad de los colores por tipo más fuerte',
    features: [
      '🎨 Subimos la opacidad del fondo de las cards en Programación de 7% a ~20% para que el color del tipo (post/reel/carrusel/story) se aprecie mucho mejor de un vistazo.'
    ]
  },
  '3.6.0': {
    title: 'Drag & drop + colores por tipo en Programación',
    features: [
      '🖱 <strong>Arrastrá y soltá las cards</strong>: chau botones ↑↓ — ahora agarrás cualquier card con el mouse y la soltás donde quieras. Si soltás en la mitad superior de otra card, se inserta arriba; si soltás abajo, se inserta abajo. Una línea morada te muestra exactamente dónde va a caer.',
      '🎨 <strong>Color de fondo según el tipo de post</strong>: cada card ahora tiene un tinte de color según el tipo, para que identifiques al toque qué es cada cosa: <span style="color:#4ecdc4">turquesa</span>=Post, <span style="color:#ff6b6b">rojo</span>=Reel, <span style="color:#a855f7">violeta</span>=Carrusel, <span style="color:#ffd93d">amarillo</span>=Story.',
      '📋 <strong>Leyenda de colores arriba</strong> de la lista para tener referencia visual siempre a mano.',
      '🔄 El orden manual sigue siendo compartido para todo el equipo en tiempo real, igual que antes.'
    ]
  },
  '3.5.0': {
    title: 'Reordenar manualmente las cards de Programación',
    features: [
      '🔼🔽 <strong>Botones ↑ y ↓ en cada card</strong>: ahora podés mover arriba o abajo cada borrador / programación / publicado para organizarlos a tu gusto. Sirve para tener arriba lo más importante o agrupar visualmente lo que necesites, sin importar la fecha.',
      '🌐 <strong>Orden compartido para todo el equipo</strong>: el orden manual se guarda en Firestore, así todos ven la lista en el mismo orden en tiempo real.',
      '↩ <strong>Volver al orden por fecha</strong>: cuando hay orden manual activo aparece un cartel arriba de la lista con un botón "↩ Volver a orden por fecha" para resetear y volver al cronológico de siempre.',
      '⚠️ <strong>Importante</strong>: el orden visual no cambia la <strong>fecha de publicación</strong> — el post se publica cuando esté programado en el calendario, sin importar dónde lo hayas movido en la lista.'
    ]
  },
  '3.4.1': {
    title: 'Fix: modal real para pegar el Recurso ManyChat',
    features: [
      '🐛 <strong>Fix</strong>: en v3.4.0 al darle click al botón "+ Recurso ManyChat" no aparecía nada porque usaba <code>prompt()</code> nativo y Electron lo bloquea silenciosamente. Ahora abre un modal propio con un campo de texto para pegar el link, botón Guardar y botón Quitar (cuando ya hay uno cargado). También se puede confirmar con Enter.',
      '✏ <strong>Editar mejorado</strong>: el ✏ al lado del chip ahora abre el mismo modal con el link actual ya cargado para que lo edites. Botón Quitar a la izquierda para eliminarlo de un click.'
    ]
  },
  '3.4.0': {
    title: 'Recurso ManyChat por programación',
    features: [
      '🔗 <strong>Botón "Recurso ManyChat" en cada borrador / programación</strong>: el que arma el flow de ManyChat (DM automático, comentarios, etc.) puede pegar el link del recurso directo en la card. El siguiente miembro del equipo lo encuentra al toque sin tener que buscar en otra app.',
      '➕ <strong>Cómo se ve</strong>: si la programación NO tiene recurso, aparece un botón <code>+ Recurso ManyChat</code> punteado para pegarlo. Si SÍ tiene, aparece un chip turquesa <code>🔗 Recurso ManyChat</code> que abre el link en el browser con un click. Al lado, un ✏ para editarlo o quitarlo (solo visible para quien tiene permisos de edición).',
      '👁 <strong>También en el preview modal</strong>: cuando le das click al ojo (👁) para ver una programación, se muestra una sección dedicada con el recurso, indicando quién lo agregó.',
      '🔒 <strong>Permisos</strong>: para BORRADORES cualquier miembro puede agregar/editar el recurso (mismo criterio que el resto de campos del borrador). Para programados/publicados solo admin / creador / miembros del multi-task. Cualquiera puede abrir el link, no hace falta permiso especial para eso.'
    ]
  },
  '3.3.1': {
    title: 'Fix: pantalla de espera no se cerraba al ser aprobado',
    features: [
      '🐛 <strong>Fix</strong>: cuando un usuario en estado "pendiente" era aprobado por el admin (o canjeaba un código desde la pantalla de espera), el listener detectaba el cambio pero el overlay "Esperando aprobación" se quedaba pegado encima de la app, dando la sensación de que seguía sin acceso. Ahora el overlay se cierra automáticamente y la persona pasa al app sin tener que reiniciar.'
    ]
  },
  '3.3.0': {
    title: 'Aprobación de nuevos miembros + códigos de invitación',
    features: [
      '🔐 <strong>Aprobación de nuevos miembros</strong>: cuando alguien se registra ahora queda en estado "pendiente". Ve una pantalla de espera explicándole que el admin tiene que aprobar. No accede a la app hasta entonces.',
      '🎟 <strong>Códigos de invitación de un solo uso</strong>: el admin puede generar códigos desde la pestaña Equipo → al darle "Generar código" se crea uno (ej. <code>X7K9MQ</code>) y se copia automáticamente al portapapeles. Quien se registre con ese código entra DIRECTO sin esperar aprobación. Cada código sirve para una sola persona.',
      '👤 <strong>Panel de solicitudes pendientes</strong>: los admins ven en la pestaña Equipo, arriba del todo, las solicitudes con nombre + email + botones <strong>✓ Aprobar</strong> / <strong>✕ Rechazar</strong>. La persona aprobada entra al instante (su pantalla de espera se actualiza sola, sin tener que recargar).',
      '🎫 <strong>Canjear código desde la pantalla de espera</strong>: si alguien se registró sin código y después le pasás uno, lo puede pegar en su pantalla de espera y se activa al toque, sin pasar por aprobación.',
      '🛡 <strong>Backward compatibility total</strong>: los miembros existentes (sin campo <code>status</code>) se consideran activos automáticamente. Nadie pierde acceso. El owner (admin original) siempre queda activo.',
      '⚠ <strong>Requiere actualizar Firestore Security Rules</strong>: agregar permisos para colección <code>inviteCodes</code> y para que los admins puedan editar el <code>status</code> de otros usuarios. Las reglas exactas están en el README de la app.'
    ]
  },
  '3.2.0': {
    title: 'Contador de antigüedad por tarea + reset (admin)',
    features: [
      '⏱ <strong>Contador de tiempo en cada tarea</strong>: cada card de tarea ahora muestra cuánto pasó desde que se asignó (ej. <code>⏱ 5h 23m</code>). Se actualiza automáticamente cada minuto sin recargar.',
      '🟥 <strong>Franja de color que se intensifica con el tiempo</strong>: una barra vertical fina al lado izquierdo del card va pasando de un rojo casi imperceptible a un rojo crítico a medida que pasan las horas. A las <strong>48 horas</strong> queda en rojo crítico permanente con un pulso suave para que sea imposible no verla. El equipo identifica de un vistazo qué tareas están atrasadas.',
      '⟳ <strong>Botón de reset (solo admin)</strong>: pasando el mouse sobre cualquier tarea aparece un ícono ⟳ a la derecha. Click → reinicia el contador a cero y la franja vuelve al color base. Útil cuando una tarea se "renueva" porque cambiaron prioridades o se reasignó implícitamente.',
      '📊 La antigüedad arranca desde <code>assignedAt</code> (cuando se asignó / se reseteó) o desde <code>createdAt</code> como fallback para tareas viejas. No requiere migración: al primer render todas las tareas ya muestran su edad correctamente.'
    ]
  },
  '3.1.1': {
    title: 'Portada automática para videos de Cloudinary en el Depósito',
    features: [
      '🖼️ <strong>Thumbnail automático para videos de Cloudinary</strong>: cuando pegás un link <code>res.cloudinary.com/.../video/upload/...</code> en una idea del Depósito, la card de preview ya muestra la portada del video directamente (primer frame relevante via <code>so_auto</code>). No más ícono morado genérico.',
      '📸 <strong>Cover de la entry y de la tarea</strong>: el thumbnail también queda guardado como cover de la entrada en el Depósito y se propaga a la tarea cuando alguien la asigne — todo automático, sin pasos manuales.',
      '⚡ Sin llamadas extra a la red: el URL del thumbnail se construye por transformación de la URL del video (feature nativa de Cloudinary), instantáneo.'
    ]
  },
  '3.1.0': {
    title: 'TikTok via GoHighLevel: programar en IG + TikTok a la vez',
    features: [
      '🎵 <strong>TikTok integrado via GHL Social Planner</strong>: ahora podés programar contenido en TikTok desde la misma app, sin pagar tools extra. GHL te lo permite con su Social Planner (que ya pagás). Cero TikTok Developer App, cero apps de pago tipo Late.',
      '☑️ <strong>Selector de plataformas en el modal Programar</strong>: arriba del Tipo de post ahora hay 2 checkboxes: 📷 Instagram y 🎵 TikTok. Ambas marcadas por defecto. Tildá solo las que quieras — la app dispara cada webhook correspondiente.',
      '🔗 <strong>Settings: nuevo campo "GHL TikTok Webhook"</strong>: pegá ahí el Inbound Webhook URL de tu Workflow de GHL. Instrucciones paso a paso de cómo configurarlo en GHL están dentro del propio Settings.',
      '🏷️ <strong>Badges IG / TT</strong> en cada card de Programación para ver de un vistazo dónde se publica cada post.',
      '☁️ <strong>Cloud Function actualizada</strong>: ahora dispara los 2 webhooks en paralelo (Make IG + GHL TikTok). Si una plataforma falla y la otra no, el post queda en estado nuevo <code>partial</code> con detalle de cuál falló — la otra ya quedó publicada y no se reintenta.'
    ]
  },
  '3.0.0': {
    title: 'Botón "Ver" en programaciones + reordenar carrusel',
    features: [
      '👁 <strong>Botón "Ver" en cada programación / borrador</strong>: en la pestaña Programación ahora aparece un ícono 👁 en cada card. Click → modal preview con todos los medios cargados (cover + carrusel) numerados en orden, el caption completo, y el estado. Útil para revisar qué tiene un borrador sin tener que abrir el editor completo. Click en cualquier thumbnail → abre el archivo original en el navegador.',
      '✎ <strong>Atajo Editar dentro del preview</strong>: si tienes permiso para editar el borrador / programado, el botón "Editar" abre directamente el modal Programar con todo cargado.',
      '🔢 <strong>Reordenar carrusel: botones ↑/↓</strong>: cada fila de URL en el modal Programar tiene ahora botones ▲▼ a la izquierda. Click → mueve la URL una posición arriba o abajo. La numeración y el preview se actualizan en vivo.',
      '🖱️ <strong>Reordenar carrusel: arrastrar en la galería</strong>: en la previsualización horizontal arriba del modal, ahora puedes arrastrar cualquier miniatura y soltarla sobre otra para reordenar visualmente. El orden se sincroniza con los inputs de abajo automáticamente.',
      '🎯 Funciona para Posts y Carruseles. El orden final que veas es el que se manda a Make → Instagram.'
    ]
  },
  '2.99.9': {
    title: 'Entregar tarea: subir archivo + botón "Enviar y programar"',
    features: [
      '📁 <strong>Subida local en el modal de Entregar</strong>: cuando el asignado le da "✓ Tarea completada", el modal "Entregar trabajo terminado" ahora tiene un botón <strong>📁 Subir archivo</strong> al lado del campo del link. Click → elige imagen/video desde tu Mac → se sube a Cloudinary con barra de progreso → el URL se rellena automáticamente en el campo. Misma experiencia que el modal Programar.',
      '📅 <strong>Botón "Enviar y programar"</strong>: ya no tienes que entregar la tarea, esperar aprobación, y después buscarla para programar. Click este botón verde → se envía para aprobación + se abre el modal Programar con el material ya cargado (URLs, título como caption, portada). Atajo de 1 click para todo el flujo.',
      'ℹ️ El botón "Enviar para aprobación" sigue funcionando igual si solo quieres entregar y dejar que el creador apruebe primero.'
    ]
  },
  '2.99.8': {
    title: 'Programación visible y editable para TODO el equipo',
    features: [
      '👀 <strong>Todos los miembros ven todas las programaciones y borradores</strong>: antes, si tú (admin) programabas un post o dejabas un borrador manualmente, los demás miembros NO lo veían en su pestaña Programación. Solo se compartían los que venían de multi-tareas. Ahora cualquier programación / borrador / publicado / fallo aparece para todo el equipo.',
      '✏️ <strong>Cualquier miembro puede finalizar un borrador</strong>: si dejaste 2 borradores a medias, cualquier miembro del equipo puede abrirlos con ✎, completar lo que falte (caption, URLs, fecha) y darle "Programar ahora". Pueden también eliminarlos con ✕ si ya no aplican.',
      '🛡️ <strong>Programados siguen protegidos</strong>: para evitar accidentes, los posts ya programados (no borradores) solo los puede editar / cancelar el admin, el creador, o miembros de la multi-tarea original. Borradores son colaborativos; programados quedan en quien los lanzó.',
      '🤝 Útil cuando preparas varios posts y quieres que el equipo te ayude a terminarlos sin tener que reasignar cada uno como multi-tarea.'
    ]
  },
  '2.99.7': {
    title: 'Librería de copys con carpetas (templates de captions)',
    features: [
      '📝 <strong>Mis copys guardados</strong>: en el modal Programar, debajo del Caption ahora hay una sección con tus copys guardados. Click en cualquiera → se rellena automáticamente el Caption con ese texto.',
      '📁 <strong>Organizados por carpetas</strong>: cada copy va en una carpeta (ej. "Reels Cinematográficos", "CTAs", "Hooks virales"). Cada carpeta tiene un color automático para distinguirla. Filtro arriba para ver solo una carpeta.',
      '💾 <strong>Botón "Guardar copy"</strong>: cuando escribas un caption bueno, click → modal con nombre + carpeta + texto. Se guarda y aparece como pill abajo lista para reusar.',
      '✎ <strong>Editar y eliminar</strong>: cada pill tiene un ícono ✎ para editar (texto, nombre, mover de carpeta o eliminar). Compartido con el equipo: lo que tú guardas, lo ven todos.',
      '🎨 <strong>Pre-llenado inteligente</strong>: al darle "Guardar copy" mientras tienes texto en el Caption, el modal abre con ese texto ya cargado.',
      '⚙️ Datos: nueva colección Firestore <code>captionTemplates</code> con name + folder + text + usageCount + timestamps.'
    ]
  },
  '2.99.6': {
    title: 'Editar/eliminar borradores y programaciones del equipo',
    features: [
      '✎ <strong>Botón Editar y ✕ Eliminar visibles para más miembros</strong>: cuando una programación o borrador viene de una multi-tarea, ahora TODOS los miembros que participaron pueden editar/eliminar ese post (no solo el que apretó "Programar").',
      '👑 <strong>Admins siempre pueden</strong>: si tienes rol admin, ves los botones ✎ y ✕ en todas las programaciones y borradores del equipo, sin importar quién los creó.',
      '🤝 Útil cuando uno crea el borrador y otro miembro quiere terminarlo o corregirlo.'
    ]
  },
  '2.99.5': {
    title: 'Multi-tarea: botón "Ver entregado" por miembro con color',
    features: [
      '📎 <strong>Un botón por cada miembro que subió entregable</strong>: cuando es multi-tarea, en vez de un solo botón "Ver entregado" ahora aparece un botón por cada miembro. Cada uno con el color de ese miembro (mismo color del chip arriba) para distinguir rápidamente quién subió qué.',
      '🎯 El botón muestra el nombre del miembro + su rol (ej: "📎 Pedro (guion)" / "📎 María (edicion)"). Click → abre el URL específico de esa persona.',
      '✅ Para tareas individuales sigue igual — un solo botón "📎 Ver entregado" verde.'
    ]
  },
  '2.99.4': {
    title: 'Fix: tarea fantasma (notes.forEach is not a function)',
    features: [
      '🐛 <strong>Fix definitivo del bug v2.99.3</strong>: las tareas que se editaron desde v2.93 con texto en el campo "Notas" sobre-escribían un campo array (subnotas con autor) con un string. Al renderizar, <code>string.forEach</code> tiraba error y la tarea desaparecía.',
      '✏️ <strong>Edit modal ahora usa <code>description</code></strong>: el campo "Notas (opcional)" del modal Editar guarda ahora en <code>task.description</code>, dejando intacto el array <code>task.notes</code> para subnotas con autor.',
      '🛡️ <strong>Render compatible con datos legacy</strong>: si una tarea ya tiene <code>notes</code> como string (datos viejos antes de este fix), ahora se renderiza correctamente como nota del creador en lugar de tirar error.',
      '🔍 La try/catch defensiva de v2.99.3 sigue activa por si aparece otro bug raro — ya sirvió para encontrar este.'
    ]
  },
  '2.99.3': {
    title: 'Fix defensivo: lista de tareas no se vacía si una tarea falla',
    features: [
      '🛡️ <strong>Render aislado por tarea</strong>: si una tarea (típicamente una multi-tarea con campo faltante) lanza error al renderizar, ya no rompe la lista entera. La tarea problemática aparece como una card roja con mensaje de error y las otras se renderizan normales.',
      '🔍 <strong>Logging</strong>: errores de render se imprimen en la consola con el ID de la tarea — abre DevTools (Cmd+Opt+I) → Console para ver detalles si una tarea sale roja.'
    ]
  },
  '2.99.2': {
    title: 'Multi-tarea: tipo de contenido (Post/Reel/Story/Carrusel) al subir',
    features: [
      '🎯 <strong>Selector de tipo en el modal "Marcar mi parte"</strong>: ahora cuando un miembro sube su entregable, también puede indicar qué tipo de contenido es (Post / Reel / Story / Carrusel). El último miembro que marque puede cambiarlo. Se guarda en <code>task.postType</code>.',
      '🔁 <strong>Sincronizado con Programar ahora</strong>: cuando le das al botón "📅 Programar ahora" en una multi-tarea lista, el modal Programar ya tiene seleccionado el tipo correcto, no tienes que cambiarlo manualmente. Si no lo eligen, queda en Post por defecto.',
      'ℹ️ Nota: si subes 2+ URLs y dejaste tipo "Post", al programar la heuristica anterior preferia Carrusel. Ahora el valor explícito que elegiste prevalece — confía en lo que el equipo marcó.'
    ]
  },
  '2.99.1': {
    title: 'Multi-tarea: programación visible para TODOS los miembros',
    features: [
      '👥 <strong>Fix visibilidad en Programación</strong>: cuando programas (o guardas como borrador) un post desde una multi-tarea, ahora TODOS los miembros que participaron en la multi-tarea pueden verlo en su pestaña Programación. Antes solo lo veía la persona que apretó "Programar". Ahora la lista de miembros (<code>multiTaskMembers</code>) se guarda en el doc del post para que el filtro los incluya a todos.',
      '🔁 También aplica al estado <strong>borrador</strong> guardado desde multi-tarea — todos los miembros lo ven y pueden retomarlo.'
    ]
  },
  '2.99.0': {
    title: 'Multi-tarea: subir entregables + visibilidad arreglada',
    features: [
      '🐛 <strong>Fix bug v2.98</strong>: las multi-tareas en estado "lista para programar" desaparecían de todas las pestañas. Ahora aparecen correctamente en <strong>Por Aprobar</strong> (con sus 3 botones Programar / Asignar publicador / Borrador) y también en <strong>Mis Tareas</strong> si eres uno de los miembros.',
      '📁 <strong>Modal al marcar tu parte hecha</strong>: cuando le das al botón "✓ Marcar mi parte", ahora se abre un mini-modal donde puedes pegar el URL de tu entregable o subirlo directo desde tu Mac (botón Cloudinary igual que en Programar). También puedes dejar una nota corta para el resto del equipo.',
      '🎬 <strong>URLs acumuladas como carrusel</strong>: cada miembro contribuye su entregable y todas las URLs se acumulan en el campo <code>mediaUrls</code> de la tarea. Cuando le das "📅 Programar ahora", el modal Programar abre con TODAS las URLs ya cargadas como carrusel — el editor sube su video, el guionista pega su link, todo queda listo para programar en 1 click.',
      '👁️ <strong>Visible para los miembros</strong>: el modal te muestra qué URLs ya han subido los otros miembros antes de que tú agregues la tuya. Así sabes si necesitas subir más o si ya está completo.',
      '💾 <strong>Auto-detect tipo</strong>: si la URL termina en .mp4/.mov/.webm, se guarda también como `videoLink`. La primera URL subida se usa como `coverImage` si la tarea no tenía una.'
    ]
  },
  '2.98.0': {
    title: 'Multi-tarea: 3 botones cuando todos completan',
    features: [
      '🎬 <strong>Multi-tarea con flujo final hacia Programación</strong>: cuando todos los miembros marcan su parte como hecha, la tarea pasa al estado <code>multi-ready</code> (lista para programar). En la card aparecen 3 botones grandes:',
      '📅 <strong>Programar ahora</strong>: abre el modal Programar pre-llenado con el caption (título + notas), las URLs (mediaUrls/videoLink/link), e imagen de portada. Al confirmar la programación, la multi-tarea automáticamente se marca como completada y se archiva en Trabajos Finalizados.',
      '👤 <strong>Asignar publicador</strong>: crea una nueva tarea individual de tipo <code>publicador</code> con todos los recursos acumulados, asignada al miembro que elijas. La multi-tarea original se cierra. El publicador recibe notif Telegram. Cuando él programe el contenido, también cierra su tarea.',
      '💾 <strong>Borrador</strong>: guarda el contenido como borrador en la pestaña Programación (sin programar todavía) y archiva la multi-tarea. Lo retomas después desde Programación → Borradores.',
      '✓ <strong>"Marcar mi parte" feedback claro</strong>: el botón ahora dice "✓ Marcar mi parte hecha" mientras estás en multi-tarea. Cuando ya marcaste, queda en gris diciendo "Mi parte ya esta hecha". Telegram avisa a los demás miembros + al creador cuando todos completan.'
    ]
  },
  '2.97.0': {
    title: 'Multi-tarea: asignar a varios miembros simultáneamente',
    features: [
      '👥 <strong>Modo Multi-tarea en el Depósito</strong>: al asignar una idea como tarea, ahora hay 3 modos: <strong>Individual</strong>, <strong>Multi-tarea</strong> (nuevo), y <strong>Cadena multi-paso</strong>. En modo multi seleccionas 2+ miembros con checkbox y opcionalmente describes el rol de cada uno (ej: guion, edicion, animacion).',
      '🔔 <strong>Notificación Telegram a TODOS los miembros</strong>: cuando se asigna una multi-tarea, cada miembro recibe el mensaje con la info de la tarea, sus colaboradores y su rol específico.',
      '✅ <strong>Cada miembro marca SU parte como hecha</strong>: en la card de la tarea aparecen todos los asignados con su estado (⏳ pendiente / ✓ completado). Cada miembro hace click en el botón de completar y marca solamente SU contribución. Recibes notif Telegram cuando otro miembro completa su parte.',
      '🎯 <strong>Tarea queda completa solo cuando TODOS terminan</strong>: hasta que el último miembro marque su parte, la tarea sigue activa. Una vez todos completaron, sale el flujo normal de submit del link entregado y queda lista para aprobación.',
      '🛡️ Multi-tareas no pueden ser completadas por un solo miembro saltándose a los otros — el admin puede forzar si es necesario.'
    ]
  },
  '2.96.0': {
    title: 'Fix data al mover desde papelera + botón Retornar tareas',
    features: [
      '🛠️ <strong>Fix: data completa al mover desde papelera al Depósito</strong>: las tareas eliminadas ya no llegan vacías al Depósito. Ahora se mapean correctamente: <code>text → title</code>, <code>notes → description</code>, <code>link/videoLink → links[]</code>, <code>coverImage</code> se mantiene. Si la tarea venía del Depósito y la editaste, esos cambios también se sincronizan.',
      '↩️ <strong>Botón Retornar en cada tarea asignada</strong>: nuevo botón ↩️ (amarillo) entre Editar y Eliminar. Click → confirma → la tarea se borra y vuelve al Depósito como pendiente para re-asignar.',
      '🔁 Si la tarea vino del Depósito → vuelve a su categoría original. Si NO vino → crea nueva entry con todos los datos.',
      '🔔 <strong>Notificación Telegram al asignado</strong> cuando se retorna su tarea: "↩️ X retornó al Depósito una tarea que tenías asignada: [título]". No aplica si tú mismo eres quien retorna.'
    ]
  },
  '2.95.0': {
    title: 'Mover de papelera a CUALQUIER categoría del Depósito',
    features: [
      '📥 <strong>Mover desde papelera a CUALQUIER categoría del Depósito de Ideas</strong>: el dropdown del modal "Mover a..." ahora tiene 2 secciones — <strong>📥 Depósito de Ideas</strong> (con todas tus categorías: Referencias, Reels, Carruseles y las que hayas creado) y <strong>👥 Proyectos del equipo</strong>.',
      '🔁 <strong>Si la tarea vino del Depósito</strong>, aparece la opción <strong>"↩️ Categoría original (re-asignable)"</strong> arriba — restaura la entry a su categoría original como pendiente. También puedes elegir cualquier OTRA categoría para reorganizar.',
      '✨ <strong>Si la tarea NO vino del Depósito</strong> y eliges una categoría del Depósito, la app crea automáticamente una nueva entry en el Depósito con todos los datos de la tarea (título, link, video, imagen, notas) en la categoría elegida.',
      '📚 <strong>Categoría Referencias</strong> también disponible para enviar tareas eliminadas como material de referencia.'
    ]
  },
  '2.94.0': {
    title: 'Mover de papelera al Depósito + notificación Telegram al borrar',
    features: [
      '📥 <strong>Mover a "Depósito de Ideas"</strong>: si una tarea eliminada vino originalmente del Depósito (creada desde una entry), ahora aparece como primera opción en el dropdown de "Mover a..." en la papelera. Al elegirla, la tarea se borra definitivamente Y la entry del Depósito vuelve a su categoría original como pendiente — lista para volver a asignar a otra persona.',
      '🔔 <strong>Notificación Telegram al asignado cuando se elimina su tarea</strong>: cuando alguien elimina una tarea que tenías asignada, recibes mensaje en Telegram igual que cuando te asignan o aprueban una tarea. Mensaje: "🗑️ X eliminó una tarea que tenías asignada: [título] / Proyecto: Y". No te llega notif si tú mismo eres quien elimina (lógico).'
    ]
  },
  '2.93.0': {
    title: 'Editar tarea completo + Mover desde papelera + thumbnails',
    features: [
      '✎ <strong>Editar tarea ahora muestra TODOS los campos</strong>: el modal Editar (botón ✎) ya no edita solo el título — ahora puedes cambiar también <strong>Link de material</strong>, <strong>Link de video</strong> (separadamente, ya no se duplican), <strong>Imagen de portada</strong> con preview en vivo, y <strong>Notas</strong>. Todo en una sola pantalla.',
      '🗂️ <strong>Botón "Mover a..."</strong> en cada tarea de la papelera: abre un dropdown con todos tus proyectos (equipo o personales según corresponda) y al confirmar restaura la tarea cambiándola al proyecto que elijas. El botón "Restaurar" sigue funcionando para volver al proyecto original.',
      '🖼️ <strong>Thumbnails en la papelera</strong>: cada tarea eliminada muestra una miniatura de su imagen de portada al lado derecho de la card. Si no tiene imagen, sale un icono indicando si era de equipo o personal.',
      '🔓 <strong>Tres botones por tarea en papelera</strong>: 📂 Mover a... / ⟳ Restaurar / ✕ Eliminar definitivamente — cada uno con su color para evitar errores.'
    ]
  },
  '2.92.1': {
    title: 'Fix: caption ahora ocupa el ancho completo del modal',
    features: [
      '📐 <strong>Caption a ancho completo</strong>: en v2.92 el área del caption quedaba pequeña centrada con espacios en blanco a los lados. Ahora ocupa todo el ancho del modal — escribes y ves mucho más texto a la vez.',
      '↔️ <strong>Modal Programar más ancho</strong>: max-width subió de 620px a 820px, así aprovecha mejor las pantallas grandes.'
    ]
  },
  '2.92.0': {
    title: 'Borradores de programación + caption más grande',
    features: [
      '💾 <strong>Botón "Guardar borrador"</strong> en el modal Programar: si subiste imágenes/videos pero todavía no quieres programar el post, dale a este botón. Se guarda con estado <code>borrador</code> en la pestaña Programación y puedes retomarlo después sin re-subir nada.',
      '⚠️ <strong>Aviso al cancelar</strong>: si tenías contenido en el modal y le das Cancelar, ahora la app te pregunta si quieres guardar como borrador antes de cerrar. Así nunca pierdes lo que ya subiste a Cloudinary.',
      '📝 <strong>Borradores en la lista</strong>: aparecen junto a los programados con badge violeta <code>BORRADOR</code> y borde violeta. Click ✎ → editas y le das "Programar ahora" cuando esté listo. Click ✕ → eliminas el borrador.',
      '🔓 <strong>Validación permisiva para borradores</strong>: solo necesitas algo de contenido (caption, URL, o URLs de carrusel). Para programar de verdad sí se exigen todos los campos como antes.',
      '📐 <strong>Caption más grande y resizable</strong>: el área de texto del caption ahora tiene 12 líneas por defecto (en vez de 5) y puedes arrastrar la esquina inferior derecha para hacerla todavía más grande. Se aprecia mucho mejor lo que pegues — útil para captions largos con hashtags.'
    ]
  },
  '2.91.0': {
    title: 'Botón ManyChat + nav más limpio + fix barrera invisible',
    features: [
      '💬 <strong>Botón ManyChat en la titlebar</strong>: arriba al lado del botón de refresh ahora hay un botón <code>ManyChat</code>. Click → abre directo el panel de ManyChat (carpeta CMS) en el navegador.',
      '🧹 <strong>Nav superior más limpio</strong>: los botones <strong>Papelera</strong>, <strong>Equipo</strong> y <strong>FIJAR Ventana</strong> se movieron a la sección "Atajos rápidos" dentro de Configuración. El nav arriba queda solo con las pestañas de uso diario (Tareas, Calendario, Ideas, Programación, etc.).',
      '🗑️ La papelera sigue mostrando el badge con el conteo, ahora visible en el botón dentro de Configuración.',
      '🪟 <strong>Fix bug "barrera invisible" al arrastrar</strong>: cuando tenías el Depósito o Chat abierto y arrastrabas la ventana principal hacia un borde, había un código que la empujaba de regreso (intentando reposicionar las otras ventanas para que no se superpusieran). Eso creaba la sensación de un bloqueo invisible. Ahora la ventana principal se queda donde la pongas — el Depósito/Chat se ajustan a su ancho disponible o aceptan overlap parcial, pero nunca empujan tu ventana.'
    ]
  },
  '2.90.0': {
    title: 'Preview de videos en Reels y Carrusel',
    features: [
      '🎬 <strong>Videos ahora muestran preview</strong>: cuando subes un video para Reel (o lo pegas como URL), el modal Programar muestra el video reproducible — antes solo se veía vacío.',
      '🖼️ <strong>Miniaturas de carrusel inteligentes</strong>: si una casilla del carrusel tiene un video de Cloudinary, la miniatura usa el primer frame del video (jpg). Para videos no-Cloudinary se muestra un mini-player con icono ▶.',
      '📋 <strong>Cards de la pestaña Programación</strong>: los thumbs de posts con video también muestran el primer frame en vez de quedar vacíos.',
      '⚙️ <strong>Truco técnico</strong>: aprovechamos que Cloudinary genera automáticamente jpgs del primer frame de cualquier video con solo cambiar la URL (<code>so_0,w_600</code>). Cero costo extra.'
    ]
  },
  '2.89.0': {
    title: 'Subir archivos directo desde la app (Cloudinary)',
    features: [
      '📁 <strong>Subir archivos locales</strong>: en el modal Programar ahora hay un botón <code>📁 Subir archivo</code> al lado del campo URL. Click → selector de archivos de tu Mac → la app sube el archivo a Cloudinary y rellena la URL automáticamente. No más pasos manuales en cloudinary.com.',
      '🎠 <strong>Carrusel: subir varios</strong>: en carrusel hay un botón <code>📁 Subir varias</code> que abre un selector múltiple — eliges 2-10 archivos a la vez y todas las casillas se llenan solas con sus URLs.',
      '🖼️ <strong>Por casilla también</strong>: cada casilla del carrusel tiene su propio botón 📁 para subir un archivo individual sin afectar las otras.',
      '⚙️ <strong>Setup en Settings (5 min, una sola vez)</strong>: agrega tu <code>Cloud Name</code> + <code>Upload Preset</code> en Configuración. Las instrucciones detalladas están ahí (cómo crear el preset unsigned en Cloudinary).',
      '👥 <strong>Compartido con el equipo</strong>: cuando un admin guarda la config de Cloudinary, se sincroniza a Firestore para que todos los miembros la usen automáticamente al abrir la app.',
      '⚡ <strong>Progreso en vivo</strong>: ves el porcentaje de upload en tiempo real para cada archivo. Si falla, te muestra el error específico (formato no permitido, archivo muy grande, etc.).'
    ]
  },
  '2.88.0': {
    title: 'Programar desde el calendario',
    features: [
      '📅 <strong>Click en cualquier día del calendario</strong> en la pestaña Programación → ahora ves la lista de posts ese día Y un botón <code>➕ Programar este día</code>.',
      '⚡ <strong>Fecha pre-llenada</strong>: al darle click, el modal Programar abre con esa fecha ya cargada. Solo eliges la hora, escribes el caption y la URL — y listo.',
      '🛡️ <strong>Días pasados protegidos</strong>: si haces click en un día anterior a hoy, no aparece el botón (no tiene sentido programar al pasado).',
      '👥 <strong>Encabezado del día</strong>: cuando seleccionas un día verás un mini-header con el nombre del día (ej. "lunes, 5 de mayo") y la lista de posts para ese día debajo.'
    ]
  },
  '2.87.0': {
    title: 'Editar posts programados + Carrusel con casillas separadas',
    features: [
      '✎ <strong>Editar post programado</strong>: nuevo botón ✎ en cada post en estado "programado" (junto al ✕). Click → el modal se abre con todos los datos pre-llenados (fecha, hora, caption, URLs, tipo). Cambias lo que quieras y le das "Actualizar". El post mantiene su ID en Firestore — no se duplica.',
      '🛡️ <strong>Solo editable mientras esté programado</strong>: si la Cloud Function ya lo tomó (estado "publishing", "publicado" o "fallo"), el botón ✎ no aparece — para evitar que edites algo que ya está en proceso o publicado.',
      '🎠 <strong>Carrusel con casillas separadas</strong>: el editor del carrusel ahora tiene una casilla por imagen (numerada 1, 2, 3...) en vez de un único textarea. Visualmente más fácil pegar y editar URLs sin enredarse.',
      '➕ <strong>Botón "Añadir imagen"</strong>: empiezas con 2 casillas fijas (mínimo de Instagram) y vas agregando hasta 10 con el botón "+ Añadir imagen". También puedes quitar casillas con el ✕ (siempre dejas mínimo 2).',
      '🖼️ <strong>Miniatura por casilla</strong>: cuando pegas una URL, aparece una miniatura pequeña a la derecha de esa casilla específica para confirmar que es la imagen correcta. La galería grande de arriba sigue mostrando todas en horizontal.',
      '🔧 Para Make: cero cambios — al guardar, las URLs se siguen mandando como un array <code>mediaUrls</code> y <code>carouselChildren</code> formateados igual que antes.'
    ]
  },
  '2.86.0': {
    title: 'Programación respeta hora exacta + notificaciones',
    features: [
      '⏰ <strong>Fix mayor de programación</strong>: hasta v2.85 los posts se publicaban inmediatamente al programarlos, ignorando la hora elegida. Ahora la app guarda el post en Firestore con <code>status=programado</code> y una Cloud Function corre cada 5 minutos en la nube para disparar el webhook de Make solo cuando llega la hora real. Funciona 24/7 aunque tengas la app cerrada.',
      '✅ <strong>Confirmación de publicación</strong>: cuando Make publica con éxito, la Cloud Function actualiza el documento a <code>status=publicado</code> y verás el cambio en la pestaña Programación en tiempo real (sin recargar).',
      '⚠️ <strong>Estado fallo</strong>: si Make devuelve error, el post pasa a <code>status=failed</code> con el detalle del error visible en la card.',
      '🔔 <strong>Notificaciones nativas del sistema</strong>: cuando tu post se publica recibís alerta del SO (macOS/Windows). Igual si falla — con el motivo. Click en la notificación abre la pestaña Programación. Solo te llegan las notificaciones de TUS posts (admin las recibe todas).',
      '🔧 <strong>Cero cambios para ti</strong>: el escenario de Make sigue exactamente igual, solo que recibe los webhooks a la hora correcta. La app guarda el webhook URL también en Firestore (<code>config/instagram</code>) para que la Cloud Function lo conozca.'
    ]
  },
  '2.85.0': {
    title: 'Carrusel: payload listo para Map mode en Make',
    features: [
      '🎠 <strong>Carrusel funcional en Make</strong>: la app ahora envía un campo <code>carouselChildren</code> con el array ya formateado <code>[{media_type, image_url}, ...]</code>. En Make solo activas "Map" en el campo Children del módulo Carousel y lo mapeas a esta variable — funciona con 2-10 imágenes dinámicas.'
    ]
  },
  '2.84.0': {
    title: 'Modal Programar: galería de carrusel + fix de ventanas',
    features: [
      '🖼️ <strong>Vista previa del carrusel</strong>: cuando el tipo es Carrusel, ves todas las imágenes como una galería horizontal numerada (1, 2, 3...). Se actualiza en vivo mientras pegas/editas las URLs.',
      '📐 <strong>Modal Programar más ancho</strong>: ahora ocupa más espacio (max 620px, 95vw) — el preview se ve grande y los campos cómodos.',
      '🪟 <strong>Fix bug</strong>: cuando programabas desde el Depósito, el modal se abría detrás de la ventana de Depósito. Ahora la ventana principal se trae al frente automáticamente.'
    ]
  },
  '2.83.0': {
    title: 'URLs públicas en la entry — programación 1-click',
    features: [
      '🔗 <strong>Campo "URLs públicas para programar"</strong> al crear/editar una entry del depósito: pega ahí los links de Cloudinary/Imgur de las imágenes o video del contenido a publicar (una URL por línea).',
      '🖼️ La <strong>primera URL se usa como miniatura</strong> de la card en el depósito — verás el contenido real en lugar del thumbnail OG genérico.',
      '⚡ <strong>Programar 1-click</strong>: cuando le des "📷 Programar" a esa entry, las URLs ya quedan pre-llenadas en el modal y la app sugiere automáticamente el tipo (Carrusel si hay 2+ URLs, Post si hay 1). Solo eliges fecha/hora y confirmas.',
      '💡 Esto convierte la entry en un "post listo para publicar" — primero subes a Cloudinary una vez, después solo le das fecha y queda programado en Make → Instagram.'
    ]
  },
  '2.82.0': {
    title: 'Editar ideas + Nueva programación independiente + fix modal',
    features: [
      '🪟 <strong>Fix modal Programar en Windows</strong>: cuando la ventana es chica el modal salía cortado/superpuesto. Ahora tiene altura máxima 90vh con scroll interno — siempre cabe.',
      '✎ <strong>Editar ideas</strong>: nuevo botón ✎ en cada idea propia. Click → el form de arriba se rellena con el contenido actual y el botón cambia a "Guardar cambios". También sale botón "Cancelar" para abortar.',
      '➕ <strong>Botón + Nueva programación</strong> en la pestaña Programación: abre el modal vacío para programar contenido manualmente sin partir de una tarea o entry — pegas caption, URL del medio, fecha y listo.'
    ]
  },
  '2.81.0': {
    title: 'Programación: carrusel + botón en Trabajos Finalizados',
    features: [
      '🎠 <strong>Soporte de Carrusel</strong>: en el modal de programar elige tipo "Carrusel" → aparece un campo para pegar 2-10 URLs (una por línea). La app envía un array <code>mediaUrls</code> a Make, además de <code>mediaUrl1</code>...<code>mediaUrl10</code> para mapeo más fácil.',
      '📦 <strong>Botón Programar en Trabajos Finalizados</strong>: ahora también puedes programar contenido directamente desde una entry del depósito que esté en Trabajos Finalizados — no solo desde Tareas Hechas.',
      '🔗 La data del entry (título, descripción, thumbnail) se pre-rellena en el modal automáticamente. Edita lo que quieras antes de programar.'
    ]
  },
  '2.80.0': {
    title: 'Programación de contenido en Instagram (Make.com)',
    features: [
      '📱 <strong>Nueva pestaña Programación</strong>: vista lista + calendario de los posts programados a Instagram.',
      '🔗 <strong>Webhook de Make.com</strong>: configurable en Configuración. La app envía los datos del post (caption, mediaUrl, fecha) y Make publica/programa en tu Instagram Business automáticamente.',
      '📅 <strong>Botón "Programar" en tareas finalizadas</strong>: abre un modal con fecha/hora, caption editable y preview de la imagen — confirmas y se manda al webhook.',
      '🎯 Soporta Post, Reel y Story (lo eliges en el modal). Cada miembro ve solo sus propios posts programados (admin ve todos).',
      '⚙️ <strong>Setup en Make.com</strong>: Custom Webhook trigger → Instagram for Business → Create Photo Post (mapeas caption/mediaUrl/scheduledAt). Instrucciones detalladas en Configuración.'
    ]
  },
  '2.79.0': {
    title: 'Updates de Windows funcionando otra vez',
    features: [
      '🪟 <strong>Auto-update funcional para Windows</strong>: las versiones 2.75 a 2.78 solo tenían build de Mac porque Wine estaba roto. Ahora los builds de Mac y Windows se hacen automáticamente en los servidores de GitHub (CI) de forma secuencial, así todos los miembros del equipo reciben actualizaciones en cualquier plataforma.'
    ]
  },
  '2.78.0': {
    title: 'Setup de CI para builds cross-platform',
    features: [
      '🛠️ Setup interno: GitHub Actions para builds automáticos. Esta versión solo trajo build de Mac por un detalle del CI; v2.79 ya completa Windows.'
    ]
  },
  '2.77.0': {
    title: 'Nueva pestaña "Ideas" (notas grupales y personales)',
    features: [
      '💡 <strong>Pestaña Ideas</strong> nueva en la barra de navegación: un espacio rápido para anotar ideas como tarjetas tipo nota — sin asignaciones, sin proyectos, solo texto.',
      '👥 <strong>Modo Grupal</strong>: las ideas se comparten con todo el equipo y muestran el nombre del autor en cada tarjeta.',
      '🔒 <strong>Modo Personal</strong>: las ideas que crees aquí solo las ves tú. Borde violeta para distinguirlas visualmente.',
      '⌨️ <strong>Atajos</strong>: Ctrl/Cmd+Enter para guardar la idea rápido. Solo el autor puede eliminar sus propias ideas (botón ✕).'
    ]
  },
  '2.76.0': {
    title: 'Fix definitivo del fetcher de Instagram',
    features: [
      '🛡️ <strong>Validador de URLs</strong>: ahora se rechazan automáticamente URLs `lookaside.instagram.com` (que devuelven HTML, no imagen) en cualquier punto del cascade — antes el BrowserWindow las extraía como último fallback y dejaba la card en negro.',
      '🔍 <strong>BrowserWindow extractor mejorado</strong>: lee el `srcset` del `<img>` para conseguir URLs `scontent.cdninstagram.com` que sí cargan, en vez del `src` (lookaside roto).',
      '🔄 <strong>Migración v6</strong>: re-procesa todas las entries con URLs rotas para que se descarguen los thumbnails reales.'
    ]
  },
  '2.75.0': {
    title: 'Fix definitivo de thumbnails de Instagram',
    features: [
      '🔍 <strong>Causa raíz encontrada</strong>: el scraper Microlink alcanzaba su cuota gratuita diaria (50 req/día) y cuando fallaba caíamos a un endpoint de IG cuya URL (lookaside.instagram.com) redirige al HTML del reel en vez de devolver la imagen — por eso se veía en negro o con el logo de IG.',
      '✅ <strong>Fix</strong>: el extractor del embed ahora lee el atributo srcset (que sí tiene URLs scontent.cdninstagram.com reales que cargan como imagen) en vez del src (lookaside). Esto elimina la dependencia de Microlink para Instagram.',
      '🔄 <strong>Migración automática</strong>: las cards con URLs lookaside o logos genéricos se re-descargan al abrir el depósito.'
    ]
  },
  '2.74.0': {
    title: 'Fix reels en negro tras v2.72',
    features: [
      '🛠️ <strong>Fix reels que se quedaron en negro</strong>: la detección de "fallback" de v2.72 era demasiado agresiva — rechazaba imágenes válidas de Microlink y caía al embed que devuelve URLs que no cargan en el renderer. Volvimos al fetcher original (Microlink primero) que sí muestra el thumbnail.',
      '🔄 <strong>Migración automática</strong>: las cards que quedaron en negro tras v2.72/v2.73 se re-descargan al abrir el depósito.'
    ]
  },
  '2.73.0': {
    title: 'ESC para volver atrás + botón Refresh',
    features: [
      '⏪ <strong>Tecla ESC para navegar atrás</strong> en el depósito: si estás dentro de una subcategoría te lleva a la grilla de subs; si estás en una categoría te lleva a "Todos las categorías". Si tenías un modal abierto, primero lo cierra.',
      '🔄 <strong>Botón de Refresh</strong> en la titlebar (icono ⟳) de las 3 ventanas. Al presionarlo recarga la app principal, depósito y chat. Útil cuando el chat o algún listener se queda colgado y no quieres salir/entrar manualmente.'
    ]
  },
  '2.72.0': {
    title: 'Corrector ortográfico + fix reels con logo de Instagram',
    features: [
      '✏️ <strong>Corrector ortográfico al hacer click derecho</strong>: en cualquier campo de texto (depósito, chat, tareas, configuración) ahora puedes click derecho sobre una palabra mal escrita y verás sugerencias para corregirla. Configurado en español + inglés. También puedes "Agregar al diccionario" palabras que uses seguido.',
      '🖼️ <strong>Fix reels que mostraban el logo de Instagram</strong>: cuando Instagram no exponía el thumbnail real del reel/post, el scraper devolvía el logo genérico de IG como portada. Ahora detectamos ese caso y reintentamos con el endpoint del embed para conseguir la imagen real.',
      '🔄 <strong>Migración automática</strong>: las cards existentes con logo de IG se re-descargan al abrir el depósito.'
    ]
  },
  '2.71.0': {
    title: 'Fix carruseles que aparecían en negro',
    features: [
      '🛠️ <strong>Fix carruseles negros</strong>: el cambio de v2.70 que intentaba traer la imagen original sin recortar terminaba devolviendo URLs de Instagram que no cargaban (tokens firmados que expiran). Volvimos al fetcher anterior que sí funciona — los carruseles vuelven a mostrar su imagen.',
      '🔄 Las cards que quedaron en negro se re-descargan automáticamente al abrir el depósito.'
    ]
  },
  '2.70.0': {
    title: 'Carruseles con imagen original sin recortar',
    features: [
      '🖼️ <strong>Imagen completa de carruseles de Instagram</strong>: ahora la portada se obtiene del endpoint de embed (sin el recorte 1:1 que aplicaba antes el scraper). Vas a ver la primera slide entera, en su orientación nativa.',
      '📐 <strong>Cards de carrusel uniformes 4:5</strong>: todas las cards de carrusel comparten ahora el mismo formato vertical, así la grilla queda alineada y consistente.',
      '🔄 <strong>Migración automática</strong> de carruseles antiguos con cover cuadrada — al abrir el depósito se re-descarga la portada original sin recortar.'
    ]
  },
  '2.69.0': {
    title: 'Notas de versión al abrir la app',
    features: [
      '🆕 <strong>Aviso automático de novedades</strong>: cada vez que publiquemos una nueva versión, al abrir la app verás un resumen con todo lo que cambió desde tu última versión. Si te saltaste varias, las verás todas acumuladas.',
      '🔢 <strong>Detección dinámica de versión</strong>: el aviso ahora se basa en la versión real instalada (antes estaba fija en código y por eso dejó de mostrarse).'
    ]
  },
  '2.68.0': {
    title: 'Layout PRO sin chat 50/50 + redimensionar categorías',
    features: [
      '↕️ <strong>Divisor arrastrable en modo horizontal</strong> del depósito: cuando la barra "TAREAS POR HACER" está horizontal, ahora puedes arrastrar su borde inferior para ajustar la altura a tu gusto. Se recuerda entre sesiones.',
      '🪟 <strong>"PRO SIN CHAT" divide 50/50</strong>: al ocultar el chat, el Depósito y la ventana Principal ocupan exactamente la mitad cada una sobre todo el ancho de la pantalla.'
    ]
  },
  '2.62.0': {
    title: 'Tema personalizable y novedades',
    features: [
      '🎨 <strong>Selector de tema</strong>: ahora puedes elegir entre Morado oscuro, Negro puro o Claro/Blanco. Configuralo desde Configuración → Tema de la interfaz.',
      '✉️ <strong>Mensajes directos</strong> entre miembros del equipo (click en un miembro abre chat privado).',
      '🔔 <strong>Sonido de notificación</strong> al recibir mensajes en chat (general o privado).',
      '🖼️ <strong>Miniatura del link en tareas</strong>: cuando se asigna una entry del depósito, la card de la tarea muestra el thumbnail del video/carrusel/etc.',
      '📚 <strong>Botón Referencias</strong> separado del botón Tareas, con su propio contador de items.',
      '📁 <strong>Botón Mover</strong> en cada entry del depósito para reorganizarlas entre categorías.',
      '🔁 <strong>Botón Reutilizar</strong> en items finalizados (vuelven a Tareas por hacer).',
      '📐 <strong>Sidebar más limpio</strong>: badges alineados en columna, números organizados.'
    ]
  }
};
const WHATS_NEW_SEEN_KEY = 'whats-new-seen-version';

function compareSemver(a, b) {
  const pa = String(a || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

async function maybeShowWhatsNew() {
  // Lee la version real del paquete (no hardcoded)
  let currentVersion = null;
  try { currentVersion = await window.api.getAppVersion(); } catch (e) {}
  if (!currentVersion) return;

  const lastSeen = (() => { try { return localStorage.getItem(WHATS_NEW_SEEN_KEY); } catch (e) { return null; } })();
  // Acumula todas las entradas con version <= currentVersion y > lastSeen
  const versionsToShow = Object.keys(APP_CHANGELOG)
    .filter(v => compareSemver(v, currentVersion) <= 0)
    .filter(v => !lastSeen || compareSemver(v, lastSeen) > 0)
    .sort((a, b) => compareSemver(b, a));

  if (versionsToShow.length === 0) {
    // Nada que mostrar pero igual marcamos esta version como vista para no recalcular
    try { localStorage.setItem(WHATS_NEW_SEEN_KEY, currentVersion); } catch (e) {}
    return;
  }

  const titleEl = document.getElementById('whatsNewTitle');
  const contentEl = document.getElementById('whatsNewContent');
  const modalEl = document.getElementById('whatsNewModal');
  if (!titleEl || !contentEl || !modalEl) return;

  const headerLabel = versionsToShow.length === 1
    ? `v${versionsToShow[0]}`
    : `v${currentVersion} (incluye ${versionsToShow.length} versiones)`;
  titleEl.innerHTML = `🎉 ¡Novedades! — ${headerLabel}`;
  const sectionsHtml = versionsToShow.map(v => {
    const entry = APP_CHANGELOG[v];
    const items = (entry.features || []).map(f => `<li style="margin-bottom:6px">${f}</li>`).join('');
    return `
      <div style="margin-bottom:18px">
        <div style="font-weight:700;color:var(--text-primary);font-size:13px;margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:4px">v${v} — ${entry.title}</div>
        <ul style="padding-left:18px;list-style:disc;margin:0">${items}</ul>
      </div>`;
  }).join('');
  contentEl.innerHTML = sectionsHtml;
  // Guardamos la version actual en el modal para usarla al cerrar
  modalEl.dataset.currentVersion = currentVersion;
  modalEl.classList.add('active');
}

function dismissWhatsNew() {
  const modalEl = document.getElementById('whatsNewModal');
  const v = modalEl && modalEl.dataset.currentVersion;
  if (v) {
    try { localStorage.setItem(WHATS_NEW_SEEN_KEY, v); } catch (e) {}
  }
  if (modalEl) modalEl.classList.remove('active');
}

function wireWhatsNew() {
  const btn = document.getElementById('whatsNewAccept');
  if (btn) btn.addEventListener('click', dismissWhatsNew);
  const modal = document.getElementById('whatsNewModal');
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) dismissWhatsNew(); });
  // Mostrar modal tras un pequeno delay (cuando el resto de la UI esta lista)
  setTimeout(maybeShowWhatsNew, 800);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireWhatsNew);
} else {
  wireWhatsNew();
}

// Reproduce un "ding" suave de 2 notas con Web Audio API (sin archivos externos)
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, startOffset, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    };
    playTone(880, 0, 0.18);
    playTone(1175, 0.10, 0.22);
  } catch (e) { /* audio context puede no estar disponible, ignorar */ }
}
let unsubscribeDeposit = null;
let depositEntries = [];
let unsubscribeIdeas = null;
let ideas = [];
let currentIdeasMode = 'team'; // 'team' | 'personal'
let unsubscribeScheduled = null;
let captionTemplates = [];
let unsubscribeCaptionTpls = null;
let inviteCodes = [];
let unsubscribeInviteCodes = null;
// ===== Multi-workspace (v3.8.0) =====
// currentWorkspaceId: el workspace activo del usuario. workspaces: lista de
// todos los workspaces a los que pertenece. ensureDefaultWorkspace crea
// "Mi Agencia" la primera vez si todavía no existe.
let workspaces = [];
let currentWorkspaceId = null;
let unsubscribeWorkspaces = null;

// ===== v3.8.1: Filtrado por workspace =====
// Cada listener almacena en `_all*` la data CRUDA de Firestore. Las arrays
// públicas (tasks, projects, etc.) son derivadas via filter. Al cambiar de
// workspace, applyWorkspaceFilter() re-deriva todas y re-renderiza.
let _allTasks = [];
let _allProjects = [];
let _allDepositEntries = [];
let _allScheduledPosts = [];
let _allIdeas = [];
let _allChatMessages = [];
let _allCaptionTemplates = [];

const WORKSPACE_SCOPED_COLLECTIONS = new Set([
  'tasks', 'projects', 'depositEntries', 'depositCategories',
  'scheduledPosts', 'chatMessages', 'captionTemplates', 'ideas'
]);

// v3.9.4: si ningún workspace tiene isDefault=true (caso de cuenta migrada
// desde una versión que no lo seteó), marca el más viejo automáticamente.
// Idempotente — solo escribe si realmente falta.
async function autoFixDefaultWorkspaceFlag() {
  if (!workspaces || workspaces.length === 0) return;
  const hasExplicit = workspaces.some(w => w.isDefault === true);
  if (hasExplicit) return;
  const sorted = workspaces.slice().sort((a, b) => {
    const at = (a.createdAt && a.createdAt.toDate) ? a.createdAt.toDate().getTime() : 0;
    const bt = (b.createdAt && b.createdAt.toDate) ? b.createdAt.toDate().getTime() : 0;
    return at - bt;
  });
  if (!sorted[0]) return;
  try {
    await db.collection('workspaces').doc(sorted[0].id).update({ isDefault: true });
    console.log('[ws] auto-fix: marcado isDefault=true en', sorted[0].id, sorted[0].name);
    // Notificar iframes para que recarguen con la nueva info
    setTimeout(() => notifyIframesOfWorkspaceChange(), 500);
  } catch (e) {
    console.warn('[ws] no se pudo marcar default:', e.message);
  }
}

// Determina el workspace ID que actúa como "default" — el que muestra docs legacy
// sin workspaceId. Multiple fallbacks por robustez.
function resolveDefaultWorkspaceId() {
  if (!workspaces || workspaces.length === 0) return null;
  // 1) Workspace explícitamente marcado isDefault=true
  const explicit = workspaces.find(w => w.isDefault === true);
  if (explicit) return explicit.id;
  // 2) Si solo hay 1 workspace, ese es default por defecto
  if (workspaces.length === 1) return workspaces[0].id;
  // 3) El workspace más viejo (asumimos que fue el primero creado)
  const sorted = workspaces.slice().sort((a, b) => {
    const at = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
    const bt = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
    return at - bt;
  });
  return sorted[0] ? sorted[0].id : null;
}

// Devuelve true si el doc pertenece al workspace activo.
// Lógica: si estás en el workspace default, también ves docs SIN workspaceId
// (data legacy pre-v3.8.1). En otros workspaces, solo ves docs tagged.
function belongsToCurrentWs(doc) {
  if (!currentWorkspaceId) return true;
  const defId = resolveDefaultWorkspaceId();
  if (defId && currentWorkspaceId === defId) {
    return !doc.workspaceId || doc.workspaceId === currentWorkspaceId;
  }
  return doc.workspaceId === currentWorkspaceId;
}

// Re-deriva todas las arrays públicas del workspace activo y dispara renders.
// Se llama al hacer switch de workspace y desde cada listener tras update.
function applyWorkspaceFilter() {
  tasks = _allTasks.filter(t => !t.deletedAt).filter(belongsToCurrentWs);
  trashTasks = _allTasks.filter(t => t.deletedAt).filter(belongsToCurrentWs);
  projects = _allProjects.filter(belongsToCurrentWs);
  depositEntries = _allDepositEntries.filter(belongsToCurrentWs);
  scheduledPosts = _allScheduledPosts.filter(belongsToCurrentWs);
  ideas = _allIdeas.filter(belongsToCurrentWs);
  chatMessages = _allChatMessages.filter(belongsToCurrentWs);
  captionTemplates = _allCaptionTemplates.filter(belongsToCurrentWs);
  // Disparar renders relevantes
  try { renderAll(); } catch (e) {}
  try { renderTrashList(); } catch (e) {}
  try { renderProjectSelect(); renderProjectList(); } catch (e) {}
  try { renderDepositBadge(); renderReferencesBadge(); } catch (e) {}
  try { renderSchedule(); } catch (e) {}
  try { renderIdeas(); } catch (e) {}
  try { renderChatBadge(); } catch (e) {}
  try { renderCaptionLibrary(); updateCaptionFolderOptions(); } catch (e) {}
}

// ===== Settings per-workspace (v3.8.3) =====
// Ref a un doc de config scoped al workspace activo. Si no hay workspace,
// fallback al global (compatibilidad con setups anteriores).
// Estrategia: composite key `${name}_${wsId}` en la colección /config global.
// Es más simple que subcolecciones, no requiere cambiar Firestore Rules.
function wsConfigRef(name) {
  if (currentWorkspaceId) {
    return db.collection('config').doc(`${name}_${currentWorkspaceId}`);
  }
  return db.collection('config').doc(name);
}

// Migración: la primera vez que el owner está en el workspace default,
// si existe el doc global config/instagram pero no existe config/instagram_${defaultId},
// copia el contenido para que el workspace default arranque con la config existente.
async function migrateGlobalConfigToDefaultWorkspace() {
  if (!currentUser || !currentUserData) return;
  const def = workspaces.find(w => w.isDefault);
  if (!def) return;
  if (currentWorkspaceId !== def.id) return;
  const isOwner = (currentUser.email || '').toLowerCase() === 'jainierrojas@gmail.com';
  if (!isOwner) return;
  const configsToMigrate = ['instagram', 'cloudinary'];
  for (const name of configsToMigrate) {
    try {
      const wsKey = `${name}_${def.id}`;
      const wsSnap = await db.collection('config').doc(wsKey).get();
      if (wsSnap.exists) continue; // ya migrado
      const globalSnap = await db.collection('config').doc(name).get();
      if (!globalSnap.exists) continue; // nada que migrar
      await db.collection('config').doc(wsKey).set(globalSnap.data());
      console.log(`[migrate] ${name} → ${wsKey}`);
    } catch (e) {
      console.warn(`[migrate] error ${name}:`, e.message);
    }
  }
}

// Monkey-patch db.collection().add() para auto-inyectar workspaceId en los
// documentos nuevos de las colecciones workspace-scoped. Cero cambios en los
// 25+ sitios de .add() existentes.
(function installWorkspaceScopeWrapper() {
  if (!db || !db.collection) return;
  const origCollection = db.collection.bind(db);
  db.collection = function(name) {
    const ref = origCollection(name);
    if (!WORKSPACE_SCOPED_COLLECTIONS.has(name)) return ref;
    const origAdd = ref.add.bind(ref);
    ref.add = function(data) {
      const enriched = (data && currentWorkspaceId && !data.workspaceId)
        ? Object.assign({}, data, { workspaceId: currentWorkspaceId })
        : data;
      return origAdd(enriched);
    };
    return ref;
  };
})();
let editingCaptionTplId = null;
let scheduledPosts = [];
let scheduledPostsInitialized = false; // false en primera carga del snapshot
let currentScheduleView = 'list'; // 'list' | 'calendar'
let schedulingTaskId = null;
let schedCalDate = new Date();
let depositLastViewedAt = null;
let reminderTimer = null;
let presenceTimer = null;
const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 60s
let chatMessages = [];
let chatLastReadAt = null; // Firestore Timestamp
const CHAT_MESSAGE_LIMIT = 100;
const CHAT_EXTRA_WIDTH = 320;

// Colores por miembro - escogidos para maximo contraste visual entre si
const userColors = [
  '#FF4757', // rojo vivo
  '#1E90FF', // azul vivo
  '#2ED573', // verde vivo
  '#FFA502', // naranja
  '#BE2EDD', // morado
  '#FFD93D', // amarillo
  '#00D2D3', // cyan
  '#FF6348', // coral
  '#70A1FF', // azul cielo
  '#EE5A6F'  // rosa frambuesa
];

// ===== DOM ELEMENTS =====
const el = {
  loginScreen: document.getElementById('loginScreen'),
  appContainer: document.getElementById('appContainer'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginName: document.getElementById('loginName'),
  loginBtn: document.getElementById('loginBtn'),
  loginToggle: document.getElementById('loginToggle'),
  loginError: document.getElementById('loginError'),
  userAvatar: document.getElementById('userAvatar'),
  userName: document.getElementById('userName'),
  userRole: document.getElementById('userRole'),
  logoutBtn: document.getElementById('logoutBtn'),
  taskList: document.getElementById('taskList'),
  myTaskList: document.getElementById('myTaskList'),
  completedList: document.getElementById('completedList'),
  teamList: document.getElementById('teamList'),
  projectSelect: document.getElementById('projectSelect'),
  assignSelect: document.getElementById('assignSelect'),
  taskInput: document.getElementById('taskInput'),
  durationInput: document.getElementById('durationInput'),
  durationUnit: document.getElementById('durationUnit'),
  addTaskBtn: document.getElementById('addTaskBtn'),
  mainBadge: document.getElementById('mainBadge'),
  myBadge: document.getElementById('myBadge'),
  approvalBadge: document.getElementById('approvalBadge'),
  approvalList: document.getElementById('approvalList'),
  personalBadge: document.getElementById('personalBadge'),
  personalList: document.getElementById('personalList'),
  personalCount: document.getElementById('personalCount'),
  reminderInterval: document.getElementById('reminderInterval'),
  saveReminder: document.getElementById('saveReminder'),
  inputArea: document.getElementById('inputArea'),
  telegramToken: document.getElementById('telegramToken'),
  saveTelegram: document.getElementById('saveTelegram'),
  telegramStatus: document.getElementById('telegramStatus'),
  claudeApiKey: document.getElementById('claudeApiKey'),
  saveClaudeKey: document.getElementById('saveClaudeKey'),
  claudeStatus: document.getElementById('claudeStatus'),
  projectModal: document.getElementById('projectModal'),
  projectNameInput: document.getElementById('projectNameInput'),
  newProjectBtn: document.getElementById('newProjectBtn'),
  quickProjectBtn: document.getElementById('quickProjectBtn'),
  confirmProject: document.getElementById('confirmProject'),
  cancelProject: document.getElementById('cancelProject'),
  clearAllCompleted: document.getElementById('clearAllCompleted'),
  projectListSettings: document.getElementById('projectListSettings'),
  btnPin: document.getElementById('btnPin'),
  btnMinimize: document.getElementById('btnMinimize'),
  btnMaximize: document.getElementById('btnMaximize'),
  btnClose: document.getElementById('btnClose'),
  personalProjectsChips: document.getElementById('personalProjectsChips'),
  personalHeaderName: document.getElementById('personalHeaderName'),
  personalProjectRow: document.getElementById('personalProjectRow'),
  personalProjectSelect: document.getElementById('personalProjectSelect'),
  newPersonalProjectBtn: document.getElementById('newPersonalProjectBtn'),
  personalProjectModal: document.getElementById('personalProjectModal'),
  personalProjectNameInput: document.getElementById('personalProjectNameInput'),
  confirmPersonalProject: document.getElementById('confirmPersonalProject'),
  cancelPersonalProject: document.getElementById('cancelPersonalProject'),
  chatToggleBtn: document.getElementById('chatToggleBtn'),
  chatUnreadBadge: document.getElementById('chatUnreadBadge'),
  trashList: document.getElementById('trashList'),
  trashBadge: document.getElementById('trashBadge'),
  emptyTrashBtn: document.getElementById('emptyTrashBtn'),
  rememberMe: document.getElementById('rememberMe')
};

// ===== AUTH =====
let isRegistering = false;

// Cargar preferencia de "Mantener sesion" desde localStorage
const REMEMBER_KEY = 'rememberSession';
try {
  const stored = localStorage.getItem(REMEMBER_KEY);
  if (stored !== null && el.rememberMe) el.rememberMe.checked = stored === '1';
} catch (e) {}
if (el.rememberMe) {
  el.rememberMe.addEventListener('change', () => {
    try { localStorage.setItem(REMEMBER_KEY, el.rememberMe.checked ? '1' : '0'); } catch (e) {}
  });
}

// Firebase usa LOCAL persistence por default (sesion sobrevive cierres de app).
// No llamamos setPersistence: causaba que Firebase rechazara el signIn en algunos casos.
// El checkbox "Mantener sesion" sirve solo para guardar el email auto-relleno.

// Auto-rellenar email si lo guardamos en sesiones anteriores
const SAVED_EMAIL_KEY = 'lastLoginEmail';
try {
  const savedEmail = localStorage.getItem(SAVED_EMAIL_KEY);
  if (savedEmail && el.loginEmail) el.loginEmail.value = savedEmail;
} catch (e) {}

el.loginToggle.addEventListener('click', () => {
  isRegistering = !isRegistering;
  el.loginName.style.display = isRegistering ? 'block' : 'none';
  const inviteInput = document.getElementById('loginInviteCode');
  const inviteHint = document.getElementById('loginInviteHint');
  if (inviteInput) inviteInput.style.display = isRegistering ? 'block' : 'none';
  if (inviteHint) inviteHint.style.display = isRegistering ? 'block' : 'none';
  el.loginBtn.textContent = isRegistering ? 'Registrarse' : 'Iniciar Sesion';
  el.loginToggle.innerHTML = isRegistering
    ? 'Ya tienes cuenta? <span>Inicia sesion</span>'
    : 'No tienes cuenta? <span>Registrate</span>';
  hideError();
});

el.loginBtn.addEventListener('click', handleAuth);
el.loginPassword.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleAuth(); });

async function handleAuth() {
  const email = el.loginEmail.value.trim();
  const password = el.loginPassword.value.trim();
  const name = el.loginName.value.trim();

  if (!email || !password) { showError('Ingresa email y contrasena'); return; }
  if (isRegistering && !name) { showError('Ingresa tu nombre'); return; }

  // Guardar email para auto-rellenar la proxima vez (si la sesion se pierde)
  try {
    if (el.rememberMe && el.rememberMe.checked) {
      localStorage.setItem(SAVED_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(SAVED_EMAIL_KEY);
    }
  } catch (e) {}

  el.loginBtn.disabled = true;
  el.loginBtn.innerHTML = '<span class="loading-spinner"></span>';

  try {
    if (isRegistering) {
      // Codigo de invitacion (opcional). Si es valido y no esta usado:
      // status='active' inmediato. Si no hay codigo (o es invalido):
      // status='pending' y la cuenta queda esperando aprobacion del admin.
      const inviteInput = document.getElementById('loginInviteCode');
      const rawCode = inviteInput ? (inviteInput.value || '').trim().toUpperCase() : '';
      let codeOk = false;
      let codeDoc = null;
      if (rawCode) {
        try {
          const snap = await db.collection('inviteCodes').doc(rawCode).get();
          if (snap.exists) {
            const d = snap.data();
            if (!d.usedBy && !d.revokedAt) {
              codeOk = true;
              codeDoc = snap;
            }
          }
        } catch (e) { /* si falla la lectura por rules, codeOk queda false */ }
      }

      const cred = await auth.createUserWithEmailAndPassword(email, password);
      const userPayload = {
        name: name,
        email: email.toLowerCase(),
        role: 'miembro',
        status: codeOk ? 'active' : 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        telegramChatId: ''
      };
      if (codeOk) userPayload.invitedWith = rawCode;
      await db.collection('users').doc(cred.user.uid).set(userPayload);
      if (codeOk && codeDoc) {
        try {
          await codeDoc.ref.update({
            usedBy: cred.user.uid,
            usedByEmail: email.toLowerCase(),
            usedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) { /* no critico */ }
      }
    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
  } catch (error) {
    let msg = 'Error desconocido';
    if (error.code === 'auth/user-not-found') msg = 'Usuario no encontrado';
    else if (error.code === 'auth/wrong-password') msg = 'Contrasena incorrecta';
    else if (error.code === 'auth/invalid-credential') msg = 'Email o contrasena incorrectos';
    else if (error.code === 'auth/email-already-in-use') msg = 'Ese email ya esta registrado';
    else if (error.code === 'auth/weak-password') msg = 'La contrasena debe tener al menos 6 caracteres';
    else if (error.code === 'auth/invalid-email') msg = 'Email no valido';
    showError(msg);
  }

  el.loginBtn.disabled = false;
  el.loginBtn.textContent = isRegistering ? 'Registrarse' : 'Iniciar Sesion';
}

function showError(msg) {
  el.loginError.textContent = msg;
  el.loginError.classList.add('visible');
}

function hideError() {
  el.loginError.classList.remove('visible');
}

// Auth state listener
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
      currentUserData = { id: user.uid, ...userDoc.data() };
      if (user.email === 'jainierrojas@gmail.com' && currentUserData.role !== 'admin') {
        await db.collection('users').doc(user.uid).update({ role: 'admin' });
        currentUserData.role = 'admin';
      }
      // Owner siempre activo. Otros usuarios sin status (legacy) se consideran
      // activos para no romper accesos existentes.
      if (user.email === 'jainierrojas@gmail.com' && currentUserData.status !== 'active') {
        try { await db.collection('users').doc(user.uid).update({ status: 'active' }); } catch (e) {}
        currentUserData.status = 'active';
      }
    } else {
      // Doc no existe (alta a medias). Lo creamos con status='pending' para que
      // el admin pueda aprobarlo.
      const fallback = {
        name: user.email.split('@')[0],
        email: (user.email || '').toLowerCase(),
        role: 'miembro',
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        telegramChatId: ''
      };
      try {
        await db.collection('users').doc(user.uid).set(fallback);
      } catch (e) { /* si falla, currentUserData queda en memoria */ }
      currentUserData = { id: user.uid, ...fallback };
    }
    // Routing: active → app, pending → pantalla de espera, rejected → pantalla
    // de bloqueo. Admin siempre activo.
    const status = currentUserData.status;
    const isAdmin = currentUserData.role === 'admin';
    if (isAdmin || !status || status === 'active') {
      showApp();
    } else if (status === 'pending') {
      showPendingScreen();
    } else if (status === 'rejected') {
      showRejectedScreen();
    } else {
      showApp(); // status desconocido → asumimos OK
    }
  } else {
    currentUser = null;
    currentUserData = null;
    showLogin();
  }
});

function showApp() {
  el.loginScreen.classList.add('hidden');
  el.appContainer.classList.add('active');
  // Esconder overlays de espera/rechazo si quedaron visibles (transiciones
  // pending->active y rejected->active deben limpiar el DOM, no solo activar
  // appContainer encima).
  const ps = document.getElementById('pendingScreen');
  const rs = document.getElementById('rejectedScreen');
  if (ps) ps.style.display = 'none';
  if (rs) rs.style.display = 'none';

  el.userAvatar.textContent = currentUserData.name.charAt(0).toUpperCase();
  el.userName.textContent = currentUserData.name;
  el.userRole.textContent = currentUserData.role || 'miembro';
  syncUserDropdownInfo();
  // Multi-workspace: asegurar default + listener real-time
  ensureDefaultWorkspace().then(() => subscribeWorkspaces());

  personalProjectsList = Array.isArray(currentUserData.personalProjects) ? [...currentUserData.personalProjects] : [];
  currentPersonalProject = 'General';
  renderPersonalChips();
  renderPersonalProjectSelect();
  setupProjectInteractionTracking();
  ensureDefaultDepositCategories();
  startPresenceHeartbeat();

  subscribeToData();
  initTelegramHandlers();
  loadTelegramToken();
  loadClaudeStatus();
  loadReminderInterval();
  loadTabsMode();
  subscribeToNotificationQueue();
  syncMakeWebhookToFirestore();
  syncCloudinaryConfigFromFirestore();
}

// ===== Helpers de preview de medios =====
// Renderiza un preview en un contenedor: si es video, mete un <video>;
// si es imagen, usa background-image. Mantiene el contenedor del CSS.
function renderMediaInto(containerEl, url) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  containerEl.style.backgroundImage = '';
  if (!url) return;
  if (isVideoUrl(url)) {
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.style.width = '100%';
    v.style.height = '100%';
    v.style.objectFit = 'contain';
    containerEl.appendChild(v);
  } else {
    containerEl.style.backgroundImage = `url('${url.replace(/'/g, '%27')}')`;
  }
}
// Detectan si una URL es video y, para Cloudinary, generan un thumbnail
// (primer frame en jpg) usando una transformacion en la URL.
function isVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (/\/video\/upload\//.test(url)) return true; // Cloudinary video
  if (/\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url)) return true;
  return false;
}
// Para Cloudinary videos: transforma la URL para obtener el primer frame
// como jpg (asi se puede usar como background-image normal).
// Ej: .../video/upload/v123/file.mp4 -> .../video/upload/so_0,w_600/v123/file.jpg
function cloudinaryVideoThumb(url) {
  if (!/\/video\/upload\//.test(url)) return null;
  return url
    .replace(/\/video\/upload\//, '/video/upload/so_0,w_600/')
    .replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, '.jpg');
}
// Devuelve una URL apta para usar como background-image. Si es video no-Cloudinary,
// devuelve null y el caller debe renderizar un <video> en su lugar.
function mediaThumbUrl(url) {
  if (!url) return '';
  const videoThumb = cloudinaryVideoThumb(url);
  if (videoThumb) return videoThumb;
  if (isVideoUrl(url)) return ''; // video no-Cloudinary, fallback a video tag
  return url;
}

// ===== Cloudinary unsigned upload =====
// Sube un File a Cloudinary y devuelve la URL publica. Modo unsigned: no
// necesita API secret, solo el cloud_name + upload_preset que el usuario
// configura en Settings.
async function uploadToCloudinary(file, onProgress) {
  const cfg = await window.api.getCloudinaryConfig();
  if (!cfg || !cfg.cloudName || !cfg.uploadPreset) {
    throw new Error('Cloudinary no configurado. Anda a Configuracion y agrega cloud name + upload preset.');
  }
  const isVideo = (file.type || '').startsWith('video');
  const resourceType = isVideo ? 'video' : 'image';
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/${resourceType}/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', cfg.uploadPreset);
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
        if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) {
          resolve({ url: data.secure_url, resourceType, bytes: data.bytes, format: data.format, width: data.width, height: data.height, duration: data.duration });
        } else {
          reject(new Error(data.error && data.error.message ? data.error.message : `HTTP ${xhr.status}`));
        }
      } catch (e) {
        reject(new Error('Respuesta invalida de Cloudinary: ' + e.message));
      }
    };
    xhr.onerror = () => reject(new Error('Error de red al subir a Cloudinary'));
    xhr.send(formData);
  });
}

// Lee la URL del webhook del store local y la sincroniza a Firestore en
// config/instagram para que la Cloud Function la conozca. Idempotente: solo
// escribe si la remota difiere de la local. Se llama tras login.
async function syncMakeWebhookToFirestore() {
  try {
    if (!window.api || !window.api.getMakeWebhook || !db || !currentUser) return;
    const url = await window.api.getMakeWebhook();
    if (!url) return;
    const snap = await wsConfigRef('instagram').get();
    const remote = snap.exists ? (snap.data().makeWebhookUrl || null) : null;
    if (remote === url) return;
    await wsConfigRef('instagram').set({
      makeWebhookUrl: url,
      updatedBy: currentUser.email,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('[sync] Make webhook URL sincronizado a Firestore');
  } catch (e) {
    console.warn('[sync] No se pudo sincronizar webhook a Firestore:', e.message);
  }
}

function showLogin() {
  el.loginScreen.classList.remove('hidden');
  el.appContainer.classList.remove('active');
  const ps = document.getElementById('pendingScreen');
  const rs = document.getElementById('rejectedScreen');
  if (ps) ps.style.display = 'none';
  if (rs) rs.style.display = 'none';
  if (unsubscribeTasks) unsubscribeTasks();
  if (unsubscribeProjects) unsubscribeProjects();
  if (unsubscribeUsers) unsubscribeUsers();
  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  if (unsubscribeDeposit) { unsubscribeDeposit(); unsubscribeDeposit = null; }
  if (unsubscribeIdeas) { unsubscribeIdeas(); unsubscribeIdeas = null; }
  if (unsubscribeScheduled) { unsubscribeScheduled(); unsubscribeScheduled = null; scheduledPostsInitialized = false; }
  if (unsubscribeCaptionTpls) { unsubscribeCaptionTpls(); unsubscribeCaptionTpls = null; captionTemplates = []; }
  if (unsubscribeInviteCodes) { unsubscribeInviteCodes(); unsubscribeInviteCodes = null; inviteCodes = []; }
  if (unsubscribeWorkspaces) { unsubscribeWorkspaces(); unsubscribeWorkspaces = null; workspaces = []; currentWorkspaceId = null; }
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
}

// Pantallas de espera y rechazo (status pending/rejected). Ocultan login y app
// y muestran su propio overlay con opcion de logout.
function showPendingScreen() {
  el.loginScreen.classList.add('hidden');
  el.appContainer.classList.remove('active');
  const ps = document.getElementById('pendingScreen');
  const rs = document.getElementById('rejectedScreen');
  if (ps) ps.style.display = 'flex';
  if (rs) rs.style.display = 'none';
  // Listener: si el admin nos aprueba mientras estamos en esta pantalla,
  // pasamos automaticamente a la app sin tener que recargar.
  if (currentUser && !window._pendingStatusUnsub) {
    window._pendingStatusUnsub = db.collection('users').doc(currentUser.uid)
      .onSnapshot(snap => {
        if (!snap.exists) return;
        const d = snap.data();
        if (d.status === 'active') {
          if (window._pendingStatusUnsub) { window._pendingStatusUnsub(); window._pendingStatusUnsub = null; }
          currentUserData = { id: currentUser.uid, ...d };
          showApp();
        } else if (d.status === 'rejected') {
          if (window._pendingStatusUnsub) { window._pendingStatusUnsub(); window._pendingStatusUnsub = null; }
          currentUserData = { id: currentUser.uid, ...d };
          showRejectedScreen();
        }
      });
  }
}
function showRejectedScreen() {
  el.loginScreen.classList.add('hidden');
  el.appContainer.classList.remove('active');
  const ps = document.getElementById('pendingScreen');
  const rs = document.getElementById('rejectedScreen');
  if (ps) ps.style.display = 'none';
  if (rs) rs.style.display = 'flex';
}

// Wireup de las pantallas pending/rejected
document.addEventListener('DOMContentLoaded', () => {
  const pendingLogout = document.getElementById('pendingLogoutBtn');
  if (pendingLogout) pendingLogout.addEventListener('click', (e) => { e.preventDefault(); auth.signOut(); });
  const rejectedLogout = document.getElementById('rejectedLogoutBtn');
  if (rejectedLogout) rejectedLogout.addEventListener('click', (e) => { e.preventDefault(); auth.signOut(); });
  const redeemBtn = document.getElementById('redeemInviteBtn');
  if (redeemBtn) redeemBtn.addEventListener('click', redeemInviteCode);
});

// Canjear codigo desde la pantalla de espera (alguien que ya esta en pending
// y consigue un codigo despues — lo activa al toque).
async function redeemInviteCode() {
  const input = document.getElementById('pendingInviteCode');
  if (!input || !currentUser) return;
  const code = (input.value || '').trim().toUpperCase();
  if (!code) { alert('Ingresa el codigo de invitacion'); return; }
  try {
    const snap = await db.collection('inviteCodes').doc(code).get();
    if (!snap.exists) { alert('Codigo invalido'); return; }
    const d = snap.data();
    if (d.usedBy) { alert('Ese codigo ya fue usado'); return; }
    if (d.revokedAt) { alert('Ese codigo fue revocado'); return; }
    await db.collection('users').doc(currentUser.uid).update({
      status: 'active',
      invitedWith: code,
      activatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await snap.ref.update({
      usedBy: currentUser.uid,
      usedByEmail: (currentUser.email || '').toLowerCase(),
      usedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // El listener en showPendingScreen detecta el cambio y nos manda a la app.
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

el.logoutBtn.addEventListener('click', () => auth.signOut());

const cloudBtn = document.getElementById('cloudBtn');
if (cloudBtn) {
  cloudBtn.addEventListener('click', () => {
    window.api.openExternal('https://drive.google.com/drive/folders/1BuRcSTdiHx07lcUsO9WUe1BoCk81NX2e?usp=sharing');
  });
}

// ===== Side panel embebido (v3.7.3) =====
// Reemplaza las BrowserWindows separadas (chat, depósito) con un panel
// lateral inline que carga el HTML en un iframe. Se mantiene la lógica
// existente — solo cambia DÓNDE se renderiza.
const SIDE_PANEL_CONFIGS = {
  chat: { title: '💬 Chat del equipo', src: 'chat.html' },
  deposit: { title: '📦 Depósito de Ideas', src: 'deposit.html' },
  references: { title: '📚 Banco de Referencias', src: 'deposit.html?category=referencias' }
};

let _currentSidePanel = null;
function openSidePanel(kind) {
  const cfg = SIDE_PANEL_CONFIGS[kind];
  if (!cfg) return;
  const overlay = document.getElementById('sidePanel');
  const titleEl = document.getElementById('sidePanelTitle');
  const iframe = document.getElementById('sidePanelIframe');
  if (!overlay || !iframe) return;
  // Si es el mismo panel ya abierto, lo cerramos (toggle)
  if (_currentSidePanel === kind && overlay.classList.contains('open')) {
    closeSidePanel();
    return;
  }
  titleEl.textContent = cfg.title;
  // Recargar iframe si cambió de kind o si la URL difiere (ej. cambió workspace)
  const newSrc = buildIframeSrc(cfg.src);
  const currentSrc = iframe.src || '';
  // Comparar normalizando: si solo hay diferencia trivial no recargamos
  const needsReload = iframe.dataset.currentKind !== kind || !currentSrc.endsWith(newSrc.split('://').pop().split('/').pop());
  if (needsReload) {
    iframe.src = newSrc;
    iframe.dataset.currentKind = kind;
  }
  // Quitar split mode (modo PRO) — single panel desde aquí
  overlay.classList.remove('pro-split');
  overlay.classList.add('open');
  _currentSidePanel = kind;
}

function closeSidePanel() {
  const overlay = document.getElementById('sidePanel');
  if (!overlay) return;
  overlay.classList.remove('open', 'pro-split');
  _currentSidePanel = null;
}

// Modo PRO embebido (v3.7.4): split horizontal con depósito arriba + chat abajo
function enterProSplitMode() {
  const overlay = document.getElementById('sidePanel');
  const titleEl = document.getElementById('sidePanelTitle');
  const iframe = document.getElementById('sidePanelIframe');
  const iframe2 = document.getElementById('sidePanelIframeSecondary');
  if (!overlay || !iframe || !iframe2) return;
  titleEl.textContent = '🚀 Modo PRO — Depósito + Chat';
  overlay.classList.remove('size-medium', 'size-large');
  overlay.classList.add('pro-split');
  // Cargar iframes solo si no están en sus URLs correctas (preserva estado al togglear)
  if (iframe.dataset.currentKind !== 'pro-deposit') {
    iframe.src = buildIframeSrc('deposit.html');
    iframe.dataset.currentKind = 'pro-deposit';
  }
  if (iframe2.dataset.currentKind !== 'pro-chat') {
    iframe2.src = buildIframeSrc('chat.html');
    iframe2.dataset.currentKind = 'pro-chat';
  }
  overlay.classList.add('open');
  _currentSidePanel = 'pro';
}

document.addEventListener('DOMContentLoaded', () => {
  // Cerrar panel
  const closeBtn = document.getElementById('sidePanelClose');
  if (closeBtn) closeBtn.addEventListener('click', closeSidePanel);

  // Botones de tamaño
  document.querySelectorAll('[data-panel-size]').forEach(btn => {
    btn.addEventListener('click', () => {
      const overlay = document.getElementById('sidePanel');
      if (!overlay) return;
      overlay.classList.remove('size-medium', 'size-large');
      const size = btn.dataset.panelSize;
      if (size === 'medium') overlay.classList.add('size-medium');
      if (size === 'large') overlay.classList.add('size-large');
    });
  });

  // Items del sidebar con data-side-panel: abren el panel directo
  // (v3.11.9: ManyChat ahora es tab data-go-tab='manychat', no side-panel)
  document.querySelectorAll('.sidebar-item[data-side-panel]').forEach(item => {
    item.addEventListener('click', () => {
      const kind = item.dataset.sidePanel;
      openSidePanel(kind);
    });
  });

  // v3.9.10: botón Meet — abre Google Meet en browser externo (no se puede embeber)
  document.querySelectorAll('.sidebar-item[data-meet-link]').forEach(item => {
    item.addEventListener('click', () => {
      const url = item.dataset.meetLink;
      if (!url) return;
      try { window.api.openExternal(url); }
      catch (e) { window.open(url, '_blank'); }
    });
  });

  // Cerrar con ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _currentSidePanel) closeSidePanel();
  });
});

// v3.11.3: depositBtn y referencesBtn ahora cambian de pestaña en vez de abrir
// panel lateral. Otros entry points (modal "Modo PRO" split, etc) siguen usando
// openSidePanel('deposit') directamente.
function _goToTab(tabName) {
  const t = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
  if (t) t.click();
}

const depositBtn = document.getElementById('depositBtn');
if (depositBtn) {
  depositBtn.addEventListener('click', async () => _goToTab('deposit'));
}

const referencesBtn = document.getElementById('referencesBtn');
if (referencesBtn) {
  referencesBtn.addEventListener('click', async () => _goToTab('references'));
}

// ===== FIRESTORE REAL-TIME =====
function subscribeToData() {
  unsubscribeTasks = db.collection('tasks').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
    _allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    tasks = _allTasks.filter(t => !t.deletedAt).filter(belongsToCurrentWs);
    trashTasks = _allTasks.filter(t => t.deletedAt).filter(belongsToCurrentWs);
    renderAll();
    renderTrashList();
  });

  unsubscribeProjects = db.collection('projects').orderBy('name').onSnapshot((snapshot) => {
    _allProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    projects = _allProjects.filter(belongsToCurrentWs);
    renderProjectSelect();
    renderProjectList();
  });

  unsubscribeUsers = db.collection('users').onSnapshot((snapshot) => {
    teamMembers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const me = teamMembers.find(m => m.id === currentUser.uid);
    if (me) chatLastReadAt = me.chatLastReadAt || null;
    renderAssignSelect();
    renderTeam();
    if (tasks.length > 0) renderAll();
    renderChatBadge();
  });

  // Codigos de invitacion (solo admin los ve / puede tocar)
  if (currentUserData && currentUserData.role === 'admin') {
    unsubscribeInviteCodes = db.collection('inviteCodes').onSnapshot((snapshot) => {
      inviteCodes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderInviteCodes();
    }, (err) => {
      console.warn('[invites] no se pueden leer códigos:', err.message);
    });
  }

  unsubscribePersonal = db.collection('personalTasks')
    .where('ownerId', '==', currentUser.uid)
    .onSnapshot((snapshot) => {
      const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      personalTasks = all.filter(t => !t.deletedAt);
      trashPersonalTasks = all.filter(t => t.deletedAt);
      renderPersonalList();
      renderTrashList();
    });

  unsubscribeChat = db.collection('chatMessages')
    .orderBy('createdAt', 'desc')
    .limit(CHAT_MESSAGE_LIMIT)
    .onSnapshot(async (snapshot) => {
      _allChatMessages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse();
      const newList = _allChatMessages.filter(belongsToCurrentWs);
      // Sonido de notificacion al recibir mensaje nuevo de OTRO usuario.
      if (chatNotificationsArmed) {
        const previousIds = new Set(chatMessages.map(m => m.id));
        const newOnes = newList.filter(m => !previousIds.has(m.id));
        const fromOthers = newOnes.filter(m => m.authorId !== currentUser.uid);
        if (fromOthers.length > 0) {
          try {
            const chatOpen = window.api.isChatWindowOpen ? await window.api.isChatWindowOpen() : false;
            if (!chatOpen) playNotificationSound();
          } catch (e) { /* ignore */ }
        }
      }
      chatMessages = newList;
      chatNotificationsArmed = true;
      renderChatBadge();
    });

  chatLastReadAt = currentUserData.chatLastReadAt || null;

  unsubscribeDeposit = db.collection('depositEntries')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .onSnapshot((snapshot) => {
      _allDepositEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      depositEntries = _allDepositEntries.filter(belongsToCurrentWs);
      renderDepositBadge();
      renderReferencesBadge();
    });

  // Ideas: notas tipo tarjeta. Una sola coleccion para grupales y personales,
  // diferenciadas por isPersonal. Las personales se filtran client-side por
  // authorId === currentUser.uid (las del equipo no se ven).
  unsubscribeIdeas = db.collection('ideas')
    .orderBy('createdAt', 'desc')
    .limit(500)
    .onSnapshot((snapshot) => {
      _allIdeas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      ideas = _allIdeas.filter(belongsToCurrentWs);
      renderIdeas();
    });

  // Posts programados (envios pendientes/completados a Make.com -> Instagram).
  // Solo el creador o admins ven todos los posts; otros ven solo los suyos.
  // En cada snapshot detectamos transiciones de estado para notificar al
  // creador con notificacion nativa del SO cuando se publica o falla.
  unsubscribeScheduled = db.collection('scheduledPosts')
    .orderBy('scheduledAt', 'desc')
    .limit(200)
    .onSnapshot((snapshot) => {
      _allScheduledPosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const newDocs = _allScheduledPosts.filter(belongsToCurrentWs);
      // Comparar estados previos para detectar transiciones a publicado/failed
      const prev = new Map((scheduledPosts || []).map(p => [p.id, p]));
      const isAdmin = currentUserData && currentUserData.role === 'admin';
      // Marca primera carga para no notificar lo viejo al abrir la app
      const firstLoad = !scheduledPostsInitialized;
      newDocs.forEach(p => {
        const old = prev.get(p.id);
        if (!old || firstLoad) return;
        const oldNorm = scheduleStatusNorm(old.status);
        const newNorm = scheduleStatusNorm(p.status);
        if (oldNorm === newNorm) return;
        // Notificar solo al creador (o admin)
        const isOwn = p.createdBy === currentUser.uid;
        if (!isOwn && !isAdmin) return;
        const cap = (p.caption || '').slice(0, 60);
        if (newNorm === 'publicado') {
          notifySchedule('✅ Post publicado en Instagram', cap || 'Tu post salió al aire');
        } else if (newNorm === 'failed') {
          notifySchedule('❌ Falló la publicación', (p.error ? p.error.slice(0, 120) : cap) || 'Revisa la pestaña Programación');
        } else if (newNorm === 'publishing') {
          notifySchedule('🚀 Publicando ahora...', cap || 'Enviando a Make → Instagram');
        }
      });
      scheduledPosts = newDocs;
      scheduledPostsInitialized = true;
      renderSchedule();
    });

  depositLastViewedAt = currentUserData.depositLastViewedAt || null;

  // Libreria de copys/captions: compartida por equipo, ordenada por uso reciente
  if (unsubscribeCaptionTpls) { unsubscribeCaptionTpls(); unsubscribeCaptionTpls = null; }
  unsubscribeCaptionTpls = db.collection('captionTemplates')
    .orderBy('editedAt', 'desc')
    .limit(500)
    .onSnapshot(snap => {
      _allCaptionTemplates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      captionTemplates = _allCaptionTemplates.filter(belongsToCurrentWs);
      renderCaptionLibrary();
      updateCaptionFolderOptions();
    }, err => console.warn('[captionTemplates]', err.message));
}

function renderDepositBadge() {
  const badge = document.getElementById('depositUnreadBadge');
  if (!badge) return;
  // Badge del boton TAREAS — cuenta items PENDIENTES por asignar.
  // EXCLUYE referencias y trabajos-finalizados.
  const count = depositEntries.filter(e =>
    (e.status === 'idea' || !e.status) &&
    e.categoryId !== 'referencias' &&
    e.categoryId !== 'trabajos-finalizados'
  ).length;
  if (count <= 0) {
    badge.style.display = 'none';
    return;
  }
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.style.display = 'inline-block';
}

// Badge del boton REFERENCIAS — cuenta TOTAL de items en categoria referencias
// (mismas reglas que el badge de TAREAS: persistente, suma cuando se agregan,
// resta cuando se mueven a otra categoria).
function renderReferencesBadge() {
  const badge = document.getElementById('referencesUnreadBadge');
  if (!badge) return;
  const count = depositEntries.filter(e => e.categoryId === 'referencias').length;
  if (count <= 0) {
    badge.style.display = 'none';
    return;
  }
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.style.display = 'inline-block';
}

// ===== Ideas (notas tipo tarjeta) =====
function visibleIdeas() {
  if (!currentUser) return [];
  if (currentIdeasMode === 'personal') {
    return ideas.filter(i => i.isPersonal && i.authorId === currentUser.uid);
  }
  return ideas.filter(i => !i.isPersonal);
}

function renderIdeas() {
  const list = document.getElementById('ideasList');
  if (!list) return;
  const items = visibleIdeas();
  // Badge de Ideas: cuenta IDEAS GRUPALES de OTROS desde tu ultima visita.
  // Para simplicidad, badge muestra solo total de ideas grupales no creadas
  // por ti (es discreto, no rojo de notificacion).
  const ideasBadge = document.getElementById('ideasBadge');
  if (ideasBadge) {
    const teamCount = ideas.filter(i => !i.isPersonal && i.authorId !== currentUser.uid).length;
    if (teamCount > 0) {
      ideasBadge.textContent = teamCount > 99 ? '99+' : String(teamCount);
      ideasBadge.style.display = 'inline-block';
    } else {
      ideasBadge.style.display = 'none';
    }
  }

  if (items.length === 0) {
    const emptyMsg = currentIdeasMode === 'personal'
      ? 'Aun no tienes ideas personales. Escribe una arriba — solo tu las veras.'
      : 'Aun no hay ideas del equipo. Anota la primera!';
    list.innerHTML = `<div class="ideas-empty">${emptyMsg}</div>`;
    return;
  }

  list.innerHTML = items.map(idea => {
    const isMine = idea.authorId === currentUser.uid;
    const personalCls = idea.isPersonal ? ' personal' : '';
    const titleHtml = idea.title ? `<div class="idea-card-title">${escHtml(idea.title)}</div>` : '';
    const authorHtml = idea.isPersonal ? '' : `<span class="idea-card-author">Por ${escHtml(idea.authorName || 'Anonimo')}</span>`;
    const editBtn = isMine ? `<button class="idea-card-delete" data-edit-idea="${escHtml(idea.id)}" title="Editar" style="margin-right:4px">&#9998;</button>` : '';
    const deleteBtn = isMine ? `<button class="idea-card-delete" data-delete-idea="${escHtml(idea.id)}" title="Eliminar">&#10005;</button>` : '<span></span>';
    return `
      <div class="idea-card${personalCls}" data-idea-id="${escHtml(idea.id)}">
        ${titleHtml}
        <div class="idea-card-text">${escHtml(idea.text || '')}</div>
        <div class="idea-card-foot">
          <span>${authorHtml}${authorHtml ? ' &middot; ' : ''}${ideaTimeAgo(idea.createdAt)}</span>
          <span style="display:inline-flex;gap:2px">${editBtn}${deleteBtn}</span>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-delete-idea]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteIdea(btn.dataset.deleteIdea);
    });
  });
  list.querySelectorAll('[data-edit-idea]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      startEditIdea(btn.dataset.editIdea);
    });
  });
}

function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function ideaTimeAgo(ts) {
  if (!ts) return 'ahora';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `hace ${days}d`;
  return date.toLocaleDateString('es-ES');
}

// Estado de edicion: null = modo crear nueva, id = modo edicion de esa idea
let editingIdeaId = null;

function startEditIdea(id) {
  const idea = ideas.find(i => i.id === id);
  if (!idea || idea.authorId !== currentUser.uid) return;
  editingIdeaId = id;
  document.getElementById('ideaTitleInput').value = idea.title || '';
  document.getElementById('ideaTextInput').value = idea.text || '';
  document.getElementById('ideaTextInput').focus();
  // Cambiar la etiqueta del boton para indicar modo edicion
  const btn = document.getElementById('addIdeaBtn');
  if (btn) btn.innerHTML = '✎ Guardar cambios';
  // Mostrar boton cancelar
  const cancelBtn = document.getElementById('cancelEditIdeaBtn');
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  // Scroll al form
  document.getElementById('ideaTextInput').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditIdea() {
  editingIdeaId = null;
  document.getElementById('ideaTitleInput').value = '';
  document.getElementById('ideaTextInput').value = '';
  const btn = document.getElementById('addIdeaBtn');
  if (btn) btn.innerHTML = '➕ Agregar idea';
  const cancelBtn = document.getElementById('cancelEditIdeaBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

async function addIdea() {
  if (!currentUser) return;
  const titleInput = document.getElementById('ideaTitleInput');
  const textInput = document.getElementById('ideaTextInput');
  const title = (titleInput.value || '').trim();
  const text = (textInput.value || '').trim();
  if (!text) {
    textInput.focus();
    return;
  }
  // Modo edicion: actualizar la idea existente
  if (editingIdeaId) {
    try {
      await db.collection('ideas').doc(editingIdeaId).update({
        title: title || null,
        text,
        editedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      cancelEditIdea();
    } catch (e) {
      console.error('[ideas] update:', e);
      alert('No se pudo actualizar la idea: ' + e.message);
    }
    return;
  }
  // Modo creacion
  const isPersonal = currentIdeasMode === 'personal';
  try {
    await db.collection('ideas').add({
      title: title || null,
      text,
      isPersonal,
      authorId: currentUser.uid,
      authorName: currentUserData ? (currentUserData.name || currentUser.email) : (currentUser.email || 'Anonimo'),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    titleInput.value = '';
    textInput.value = '';
    textInput.focus();
  } catch (e) {
    console.error('[ideas] add:', e);
    alert('No se pudo guardar la idea: ' + e.message);
  }
}

async function deleteIdea(id) {
  const idea = ideas.find(i => i.id === id);
  if (!idea) return;
  if (idea.authorId !== currentUser.uid) return; // solo el autor puede borrar
  if (!confirm('Eliminar esta idea?')) return;
  try {
    await db.collection('ideas').doc(id).delete();
  } catch (e) {
    console.error('[ideas] delete:', e);
  }
}

function setIdeasMode(mode) {
  currentIdeasMode = mode === 'personal' ? 'personal' : 'team';
  document.querySelectorAll('.ideas-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.ideasMode === currentIdeasMode);
  });
  const textInput = document.getElementById('ideaTextInput');
  if (textInput) {
    textInput.placeholder = currentIdeasMode === 'personal'
      ? 'Idea personal (solo tu la veras)...'
      : 'Idea grupal (visible para todo el equipo)...';
  }
  renderIdeas();
}

// ===== Libreria de copys (captionTemplates) =====
// Coleccion compartida con el equipo: cada doc tiene { name, folder, text,
// usageCount, createdBy, createdAt, editedAt, lastUsedAt }.
// Aparece debajo del caption en el modal Programar como pills clickables.
function getCaptionFolderColor(folder) {
  // Color deterministico desde el nombre de la carpeta
  if (!folder) return '#6c63ff';
  let hash = 0;
  for (let i = 0; i < folder.length; i++) hash = folder.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  // HSL → hex (saturacion media, luminosidad media)
  const h = hue / 360, s = 0.6, l = 0.55;
  const k = n => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}

function renderCaptionLibrary() {
  const list = document.getElementById('schedCaptionLibraryList');
  if (!list) return;
  const filterEl = document.getElementById('schedCaptionFolderFilter');
  const folderFilter = filterEl ? filterEl.value.trim() : '';
  let items = captionTemplates;
  if (folderFilter) items = items.filter(t => (t.folder || 'General') === folderFilter);
  if (items.length === 0) {
    list.innerHTML = '<div style="font-size:11px;color:var(--text-dim);padding:8px;width:100%;text-align:center">' +
      (folderFilter ? `Sin copys en "${esc(folderFilter)}"` : 'Sin copys guardados. Escribe un caption arriba y dale "💾 Guardar copy".') +
      '</div>';
    return;
  }
  list.innerHTML = items.map(t => {
    const folder = t.folder || 'General';
    const c = getCaptionFolderColor(folder);
    const name = t.name || (t.text || '').slice(0, 40);
    return `
      <div class="caption-pill" style="background:${hexToRgba(c, 0.15)};border:1px solid ${hexToRgba(c, 0.4)};color:var(--text-primary)" data-tpl-id="${esc(t.id)}" title="${esc(t.text || '').slice(0, 200)}${(t.text || '').length > 200 ? '...' : ''}">
        <span class="caption-pill-folder" style="background:${hexToRgba(c, 0.3)};color:${c}">${esc(folder)}</span>
        <span class="caption-pill-name">${esc(name)}</span>
        <span class="caption-pill-edit" data-edit-tpl-id="${esc(t.id)}" title="Editar">✎</span>
      </div>`;
  }).join('');
  // Bind clicks
  list.querySelectorAll('[data-tpl-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.dataset.editTplId) {
        e.stopPropagation();
        editCaptionTpl(e.target.dataset.editTplId);
      } else {
        useCaptionTpl(el.dataset.tplId);
      }
    });
  });
}

function updateCaptionFolderOptions() {
  // Filter dropdown del modal Programar
  const filterEl = document.getElementById('schedCaptionFolderFilter');
  // Datalist del modal Editar Copy
  const datalist = document.getElementById('captionTplFolderList');
  const folders = [...new Set(captionTemplates.map(t => t.folder || 'General'))].sort();
  if (filterEl) {
    const currentValue = filterEl.value;
    filterEl.innerHTML = '<option value="">Todas las carpetas</option>' +
      folders.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
    filterEl.value = currentValue;
  }
  if (datalist) {
    datalist.innerHTML = folders.map(f => `<option value="${esc(f)}">`).join('');
  }
}

function useCaptionTpl(id) {
  const tpl = captionTemplates.find(t => t.id === id);
  if (!tpl) return;
  const captionField = document.getElementById('schedCaption');
  if (!captionField) return;
  if (captionField.value.trim() && !confirm('Ya tienes texto en el caption. Reemplazarlo con este copy?')) return;
  captionField.value = tpl.text || '';
  captionField.focus();
  // Incrementar contador de uso
  db.collection('captionTemplates').doc(id).update({
    usageCount: (tpl.usageCount || 0) + 1,
    lastUsedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});
}
window.useCaptionTpl = useCaptionTpl;

function openCaptionTplModalForCreate() {
  editingCaptionTplId = null;
  document.getElementById('captionTemplateModalTitle').innerHTML = '💾 Guardar copy';
  // Pre-llenar con el caption actual del modal Programar (si hay)
  const currentCaption = document.getElementById('schedCaption').value.trim();
  document.getElementById('captionTplName').value = '';
  document.getElementById('captionTplFolder').value = '';
  document.getElementById('captionTplText').value = currentCaption;
  document.getElementById('deleteCaptionTpl').style.display = 'none';
  document.getElementById('captionTemplateModal').classList.add('active');
  setTimeout(() => document.getElementById('captionTplName').focus(), 100);
}

function editCaptionTpl(id) {
  const tpl = captionTemplates.find(t => t.id === id);
  if (!tpl) return;
  editingCaptionTplId = id;
  document.getElementById('captionTemplateModalTitle').innerHTML = '✎ Editar copy';
  document.getElementById('captionTplName').value = tpl.name || '';
  document.getElementById('captionTplFolder').value = tpl.folder || '';
  document.getElementById('captionTplText').value = tpl.text || '';
  document.getElementById('deleteCaptionTpl').style.display = '';
  document.getElementById('captionTemplateModal').classList.add('active');
  setTimeout(() => document.getElementById('captionTplName').focus(), 100);
}
window.editCaptionTpl = editCaptionTpl;

async function saveCaptionTpl() {
  const name = document.getElementById('captionTplName').value.trim();
  const folder = document.getElementById('captionTplFolder').value.trim();
  const text = document.getElementById('captionTplText').value.trim();
  if (!name) { alert('Ponle un nombre corto al copy (lo que aparece en el botón)'); return; }
  if (!text) { alert('El contenido del copy no puede estar vacío'); return; }
  try {
    const data = {
      name,
      folder: folder || 'General',
      text,
      editedAt: firebase.firestore.FieldValue.serverTimestamp(),
      editedBy: currentUser.uid,
      editedByName: currentUserData.name
    };
    if (editingCaptionTplId) {
      await db.collection('captionTemplates').doc(editingCaptionTplId).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.createdBy = currentUser.uid;
      data.createdByName = currentUserData.name;
      data.usageCount = 0;
      await db.collection('captionTemplates').add(data);
    }
  } catch (e) {
    alert('Error: ' + e.message);
    return;
  }
  document.getElementById('captionTemplateModal').classList.remove('active');
  editingCaptionTplId = null;
}

async function deleteCaptionTpl() {
  if (!editingCaptionTplId) return;
  const tpl = captionTemplates.find(t => t.id === editingCaptionTplId);
  if (!tpl) return;
  if (!confirm(`Eliminar el copy "${tpl.name}"?\n\nEsta accion no se puede deshacer.`)) return;
  try {
    await db.collection('captionTemplates').doc(editingCaptionTplId).delete();
  } catch (e) {
    alert('Error: ' + e.message);
    return;
  }
  document.getElementById('captionTemplateModal').classList.remove('active');
  editingCaptionTplId = null;
}

// ===== Programacion de contenido a Instagram (via Make.com webhook) =====
// Estados:
//   programado  - guardado, esperando que llegue scheduledAt (set por la app)
//   publishing  - Cloud Function lo tomo, esta enviando a Make (transitorio)
//   publicado   - Make confirmo publicacion (success)
//   failed      - error en cualquier paso
//   pending/published - legacy, se mapean a programado/publicado

// Notificacion nativa del SO para transiciones de estado de un post.
// En Electron, new Notification() del renderer dispara la notificacion del
// sistema (macOS/Windows/Linux) sin necesidad de permisos extra.
function notifySchedule(title, body) {
  try {
    if (typeof Notification === 'undefined') return;
    const n = new Notification(title, { body, silent: false });
    n.onclick = () => {
      try { window.focus(); } catch (e) {}
      const tab = document.querySelector('.nav-tab[data-tab="schedule"]');
      if (tab) tab.click();
    };
  } catch (e) {
    console.warn('[notify]', e.message);
  }
}
function scheduleStatusNorm(s) {
  if (s === 'draft' || s === 'borrador') return 'draft';
  if (s === 'published' || s === 'publicado') return 'publicado';
  if (s === 'failed') return 'failed';
  if (s === 'publishing') return 'publishing';
  return 'programado';
}
function scheduleStatusPill(s) {
  const norm = scheduleStatusNorm(s);
  if (norm === 'draft') return '<span class="sched-status-pill sched-status-draft">borrador</span>';
  if (norm === 'publicado') return '<span class="sched-status-pill sched-status-published">publicado</span>';
  if (norm === 'failed') return '<span class="sched-status-pill sched-status-failed">fallo</span>';
  if (norm === 'publishing') return '<span class="sched-status-pill sched-status-pending">publicando...</span>';
  return '<span class="sched-status-pill sched-status-pending">programado</span>';
}
function fmtScheduledDate(ts) {
  if (!ts) return 'Sin fecha';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return 'Sin fecha';
  return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
// Renderiza badges para las plataformas a las que se publicara este post.
// Posts legacy sin .platforms se asumen IG-only (no rompemos visual).
function platformBadges(p) {
  const arr = Array.isArray(p.platforms) && p.platforms.length > 0 ? p.platforms : ['instagram'];
  return arr.map(pl => {
    if (pl === 'instagram') return '<span style="font-size:10px;background:rgba(240,148,51,0.15);color:#f09433;padding:1px 6px;border-radius:8px;margin-left:4px">IG</span>';
    if (pl === 'tiktok') return '<span style="font-size:10px;background:rgba(255,71,87,0.15);color:#ff4757;padding:1px 6px;border-radius:8px;margin-left:4px">TT</span>';
    return '';
  }).join('');
}

// ===== Recurso ManyChat por post =====
// Cada post programado/borrador puede tener un link a un "recurso ManyChat":
// el flow del bot que dispara cuando alguien comenta o manda DM. La idea es
// que el creador del recurso pegue el link aca y el publisher lo encuentre
// al instante sin tener que buscar en otra app.
function manychatBadgeHtml(post, canEdit) {
  const url = (post && post.manychatUrl) ? post.manychatUrl.trim() : '';
  if (url) {
    const editIcon = canEdit
      ? `<button class="btn btn-ghost btn-small" data-mc-edit="${esc(post.id)}" title="Editar / quitar recurso ManyChat" style="font-size:10px;padding:1px 5px;margin-left:2px">✏</button>`
      : '';
    return `<button class="task-tag" data-mc-open="${esc(post.id)}" title="Abrir recurso ManyChat: ${esc(url)}" style="background:rgba(78,205,196,0.18);color:#4ecdc4;border:1px solid rgba(78,205,196,0.4);font-weight:600;cursor:pointer">🔗 Recurso ManyChat</button>${editIcon}`;
  }
  if (canEdit) {
    return `<button class="task-tag" data-mc-add="${esc(post.id)}" title="Pegar link del recurso ManyChat" style="background:transparent;color:var(--text-secondary);border:1px dashed var(--border);cursor:pointer">+ Recurso ManyChat</button>`;
  }
  return '';
}

window.openManyChatResource = function(postId) {
  const p = scheduledPosts.find(x => x.id === postId);
  if (!p || !p.manychatUrl) return;
  if (window.api && window.api.openExternal) window.api.openExternal(p.manychatUrl);
  else window.open(p.manychatUrl, '_blank');
};

// Modal real (Electron bloquea prompt() nativo). Maneja tanto agregar como
// editar — la diferencia es si el post ya tenia manychatUrl. El boton Quitar
// solo se muestra cuando hay valor previo.
let _mcCurrentPostId = null;
function openManyChatModal(postId) {
  const p = scheduledPosts.find(x => x.id === postId);
  if (!p) return;
  _mcCurrentPostId = postId;
  const modal = document.getElementById('manychatModal');
  const input = document.getElementById('manychatInput');
  const removeBtn = document.getElementById('manychatRemoveBtn');
  const errEl = document.getElementById('manychatError');
  const addedInfo = document.getElementById('manychatAddedInfo');
  if (!modal || !input) return;
  input.value = p.manychatUrl || '';
  errEl.textContent = '';
  if (p.manychatUrl) {
    removeBtn.style.display = 'inline-flex';
    if (p.manychatAddedByName) {
      addedInfo.textContent = `Agregado originalmente por ${p.manychatAddedByName}`;
      addedInfo.style.display = 'block';
    } else {
      addedInfo.style.display = 'none';
    }
  } else {
    removeBtn.style.display = 'none';
    addedInfo.style.display = 'none';
  }
  modal.classList.add('active');
  setTimeout(() => input.focus(), 50);
}

function closeManyChatModal() {
  const modal = document.getElementById('manychatModal');
  if (modal) modal.classList.remove('active');
  _mcCurrentPostId = null;
}

async function saveManyChatFromModal() {
  if (!_mcCurrentPostId) return;
  const input = document.getElementById('manychatInput');
  const errEl = document.getElementById('manychatError');
  const trimmed = (input.value || '').trim();
  if (!trimmed) { errEl.textContent = 'Pegá un link o usá el botón Quitar.'; return; }
  if (!/^https?:\/\//i.test(trimmed)) { errEl.textContent = 'El link tiene que empezar con http:// o https://'; return; }
  try {
    await db.collection('scheduledPosts').doc(_mcCurrentPostId).update({
      manychatUrl: trimmed,
      manychatAddedBy: currentUser.uid,
      manychatAddedByName: currentUserData.name,
      manychatAddedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeManyChatModal();
  } catch (e) { errEl.textContent = 'No se pudo guardar: ' + e.message; }
}

async function removeManyChatFromModal() {
  if (!_mcCurrentPostId) return;
  if (!confirm('¿Quitar el recurso ManyChat de esta programación?')) return;
  try {
    await db.collection('scheduledPosts').doc(_mcCurrentPostId).update({
      manychatUrl: firebase.firestore.FieldValue.delete()
    });
    closeManyChatModal();
  } catch (e) {
    const errEl = document.getElementById('manychatError');
    if (errEl) errEl.textContent = 'No se pudo quitar: ' + e.message;
  }
}

// Wireup del modal una sola vez al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  const cancel = document.getElementById('manychatCancelBtn');
  const save = document.getElementById('manychatSaveBtn');
  const remove = document.getElementById('manychatRemoveBtn');
  const overlay = document.getElementById('manychatModal');
  const input = document.getElementById('manychatInput');
  if (cancel) cancel.addEventListener('click', closeManyChatModal);
  if (save) save.addEventListener('click', saveManyChatFromModal);
  if (remove) remove.addEventListener('click', removeManyChatFromModal);
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeManyChatModal();
  });
  if (input) input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveManyChatFromModal();
  });
});

// Las dos funciones publicas: agregar y editar abren el mismo modal
// (openManyChatModal detecta automaticamente si hay valor previo).
window.addManyChatResource = function(postId) { openManyChatModal(postId); };
window.editManyChatResource = function(postId) { openManyChatModal(postId); };

function bindManyChatButtons(container) {
  container.querySelectorAll('[data-mc-open]').forEach(b => {
    b.addEventListener('click', (e) => { e.stopPropagation(); openManyChatResource(b.dataset.mcOpen); });
  });
  container.querySelectorAll('[data-mc-edit]').forEach(b => {
    b.addEventListener('click', (e) => { e.stopPropagation(); editManyChatResource(b.dataset.mcEdit); });
  });
  container.querySelectorAll('[data-mc-add]').forEach(b => {
    b.addEventListener('click', (e) => { e.stopPropagation(); addManyChatResource(b.dataset.mcAdd); });
  });
}

function scheduledAtMs(p) {
  if (!p || !p.scheduledAt) return 0;
  try { return p.scheduledAt.toDate ? p.scheduledAt.toDate().getTime() : new Date(p.scheduledAt).getTime(); }
  catch (e) { return 0; }
}

function visibleScheduledPosts() {
  if (!currentUser) return [];
  // Todo el equipo ve todos los posts (programados, borradores, publicados, fallos).
  // Si algun post tiene manualOrder seteado, ordenamos por ese campo (mas bajo = arriba).
  // Items sin manualOrder se ordenan por fecha (mas reciente primero), igual que antes.
  const arr = scheduledPosts.slice();
  const hasManual = arr.some(p => typeof p.manualOrder === 'number');
  if (hasManual) {
    arr.sort((a, b) => {
      const aOrder = typeof a.manualOrder === 'number' ? a.manualOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = typeof b.manualOrder === 'number' ? b.manualOrder : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return scheduledAtMs(b) - scheduledAtMs(a);
    });
  }
  return arr;
}

// Mover una card arriba/abajo en la lista. Si ningun post tiene manualOrder
// seteado todavia, asignamos secuencial a todos primero (snapshot del orden
// visual actual) y despues intercambiamos los dos vecinos.
async function moveScheduledPost(postId, direction) {
  const items = visibleScheduledPosts();
  const idx = items.findIndex(p => p.id === postId);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= items.length) return;
  try {
    const hasManual = items.some(p => typeof p.manualOrder === 'number');
    if (!hasManual) {
      const initBatch = db.batch();
      items.forEach((p, i) => {
        initBatch.update(db.collection('scheduledPosts').doc(p.id), { manualOrder: i });
      });
      await initBatch.commit();
      items.forEach((p, i) => { p.manualOrder = i; }); // sync local
    }
    const a = items[idx];
    const b = items[newIdx];
    const aOrder = (typeof a.manualOrder === 'number') ? a.manualOrder : idx;
    const bOrder = (typeof b.manualOrder === 'number') ? b.manualOrder : newIdx;
    const swapBatch = db.batch();
    swapBatch.update(db.collection('scheduledPosts').doc(a.id), { manualOrder: bOrder });
    swapBatch.update(db.collection('scheduledPosts').doc(b.id), { manualOrder: aOrder });
    await swapBatch.commit();
  } catch (e) { alert('No se pudo mover: ' + e.message); }
}

window.moveSchedUp = function(id) { moveScheduledPost(id, -1); };
window.moveSchedDown = function(id) { moveScheduledPost(id, +1); };

// Drag & drop entre cards de la lista de Programación.
// El usuario arrastra una card y la suelta sobre otra. Dependiendo de si suelta
// en la mitad superior o inferior del target, la card se inserta arriba o abajo.
let _schedDragSrcId = null;
function bindSchedDragAndDrop(container) {
  const cards = container.querySelectorAll('.sched-card[data-sched-id]');
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      _schedDragSrcId = card.dataset.schedId;
      card.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _schedDragSrcId); } catch (err) {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      cards.forEach(c => c.classList.remove('drop-above', 'drop-below'));
      _schedDragSrcId = null;
    });
    card.addEventListener('dragover', (e) => {
      if (!_schedDragSrcId || _schedDragSrcId === card.dataset.schedId) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        card.classList.add('drop-above');
        card.classList.remove('drop-below');
      } else {
        card.classList.add('drop-below');
        card.classList.remove('drop-above');
      }
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drop-above', 'drop-below');
    });
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetId = card.dataset.schedId;
      const srcId = _schedDragSrcId;
      const position = card.classList.contains('drop-above') ? 'above' : 'below';
      cards.forEach(c => c.classList.remove('drop-above', 'drop-below'));
      if (!srcId || srcId === targetId) return;
      await reorderSchedDrop(srcId, targetId, position);
    });
  });
}

async function reorderSchedDrop(srcId, targetId, position) {
  const items = visibleScheduledPosts();
  const srcIdx = items.findIndex(p => p.id === srcId);
  const targetIdx = items.findIndex(p => p.id === targetId);
  if (srcIdx === -1 || targetIdx === -1) return;
  // Reordenar el array localmente
  const reordered = items.slice();
  const [moved] = reordered.splice(srcIdx, 1);
  let insertIdx = reordered.findIndex(p => p.id === targetId);
  if (position === 'below') insertIdx += 1;
  reordered.splice(insertIdx, 0, moved);
  // Reasignar manualOrder secuencial a TODOS los posts (firestore batch)
  try {
    const batch = db.batch();
    reordered.forEach((p, i) => {
      batch.update(db.collection('scheduledPosts').doc(p.id), { manualOrder: i });
    });
    await batch.commit();
  } catch (e) { alert('No se pudo reordenar: ' + e.message); }
}

window.resetSchedManualOrder = async function() {
  const dirty = scheduledPosts.filter(p => typeof p.manualOrder === 'number');
  if (dirty.length === 0) { alert('Ya estás en orden por fecha.'); return; }
  if (!confirm(`¿Volver al orden cronológico por fecha?\nSe va a perder el orden manual actual de ${dirty.length} programación(es).`)) return;
  try {
    const batch = db.batch();
    dirty.forEach(p => {
      batch.update(db.collection('scheduledPosts').doc(p.id), {
        manualOrder: firebase.firestore.FieldValue.delete()
      });
    });
    await batch.commit();
  } catch (e) { alert('Error: ' + e.message); }
};
function renderScheduleListView() {
  const container = document.getElementById('scheduleListView');
  if (!container) return;
  const items = visibleScheduledPosts();
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">&#128241;</div><div class="empty-state-text">No hay posts programados</div><div class="empty-state-sub">Marca una tarea finalizada con &quot;&#128241; Programar&quot; para enviar a tu cuenta de Instagram via Make.com</div></div>`;
    return;
  }
  // Header con leyenda de colores por tipo + boton reset cuando hay orden manual
  const hasManualOrder = scheduledPosts.some(p => typeof p.manualOrder === 'number');
  const legendHtml = `
    <div style="display:flex;align-items:center;gap:14px;font-size:11px;color:var(--text-dim);flex-wrap:wrap">
      <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#4ecdc4;border-radius:2px"></span>Post</span>
      <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#ff6b6b;border-radius:2px"></span>Reel</span>
      <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#a855f7;border-radius:2px"></span>Carrusel</span>
      <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#ffd93d;border-radius:2px"></span>Story</span>
    </div>`;
  const orderHeaderHtml = hasManualOrder
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.25);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;flex-wrap:wrap">
         <span>📋 Orden manual activo · arrastrá las cards para reordenar</span>
         ${legendHtml}
         <button class="btn btn-ghost btn-small" onclick="resetSchedManualOrder()" style="font-size:11px">↩ Volver a orden por fecha</button>
       </div>`
    : `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:8px;font-size:11px;color:var(--text-dim);flex-wrap:wrap">
         <span>💡 Arrastrá cualquier card para reordenarla. Drop entre cards para insertar.</span>
         ${legendHtml}
       </div>`;
  container.innerHTML = orderHeaderHtml + items.map((p) => {
    const norm = scheduleStatusNorm(p.status);
    const cls = norm === 'publicado' ? 'published' : (norm === 'failed' ? 'failed' : (norm === 'draft' ? 'draft' : ''));
    const thumbSrc = p.mediaUrl ? mediaThumbUrl(p.mediaUrl) : '';
    const thumb = thumbSrc ? `style="background-image:url('${esc(thumbSrc)}')"` : (p.mediaUrl && isVideoUrl(p.mediaUrl) ? 'data-video="1"' : '');
    const cap = (p.caption || '').slice(0, 200);
    const isAdminUser = currentUserData && currentUserData.role === 'admin';
    const isMine = p.createdBy === currentUser.uid;
    // Si es post de multi-tarea, todos los miembros que participaron pueden
    // editarlo/eliminarlo. Tambien admins siempre pueden.
    const isMultiMember = Array.isArray(p.multiTaskMembers) && p.multiTaskMembers.includes(currentUser.uid);
    // Para BORRADORES: cualquier miembro del equipo puede editarlos / eliminarlos
    // para colaborar en finalizarlos. Para programados/publicados/fallos
    // mantenemos la regla restrictiva (admin / creador / multi-miembro).
    const canEditPost = (norm === 'draft') ? true : (isAdminUser || isMine || isMultiMember);
    // Editar y cancelar: disponibles para borradores y posts programados
    const editableNorm = (norm === 'programado' || norm === 'draft');
    const editBtn = (canEditPost && editableNorm) ? `<button class="btn btn-ghost btn-small" data-edit-sched="${esc(p.id)}" title="${norm === 'draft' ? 'Editar borrador' : 'Editar'}">&#9998;</button>` : '';
    const cancelBtn = (canEditPost && editableNorm) ? `<button class="btn btn-danger btn-small" data-cancel-sched="${esc(p.id)}" title="${norm === 'draft' ? 'Eliminar borrador' : 'Cancelar'}">&#10005;</button>` : '';
    // Boton "Ver": disponible siempre (incluso publicado/fallo) para revisar
    // qué medios y caption tiene un post sin abrir el editor.
    const viewBtn = `<button class="btn btn-ghost btn-small" data-view-sched="${esc(p.id)}" title="Ver media y caption">&#128065;</button>`;
    const ptype = (p.postType || 'post').toLowerCase();
    const platformLabel = ptype.toUpperCase();
    const mcHtml = manychatBadgeHtml(p, canEditPost);
    return `
      <div class="sched-card ${cls}" draggable="true" data-sched-id="${esc(p.id)}" data-post-type="${esc(ptype)}">
        <div class="sched-card-thumb" ${thumb}></div>
        <div class="sched-card-body">
          <div class="sched-card-when">${esc(fmtScheduledDate(p.scheduledAt))} &middot; ${esc(platformLabel)}</div>
          <div class="sched-card-caption">${esc(cap)}</div>
          <div class="sched-card-meta">${scheduleStatusPill(p.status || 'pending')} &middot; por ${esc(p.createdByName || 'Anonimo')} ${platformBadges(p)} ${mcHtml}</div>
        </div>
        <div class="sched-card-actions">${viewBtn}${editBtn}${cancelBtn}</div>
      </div>`;
  }).join('');
  // Drag & drop: arrastrar cards y soltar arriba/abajo de otra para reordenar
  bindSchedDragAndDrop(container);
  bindManyChatButtons(container);
  container.querySelectorAll('[data-cancel-sched]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelScheduledPost(b.dataset.cancelSched);
    });
  });
  container.querySelectorAll('[data-edit-sched]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      editScheduledPost(b.dataset.editSched);
    });
  });
  container.querySelectorAll('[data-view-sched]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openSchedPreviewModal(b.dataset.viewSched);
    });
  });
}

// Preview modal: ver media (cover + carousel) y caption de un post sin
// entrar al editor. Util para revisar borradores antes de retomarlos.
function openSchedPreviewModal(postId) {
  const p = scheduledPosts.find(x => x.id === postId);
  if (!p) return;
  const modal = document.getElementById('schedPreviewModal');
  const titleEl = document.getElementById('schedPreviewTitle');
  const metaEl = document.getElementById('schedPreviewMeta');
  const mediaEl = document.getElementById('schedPreviewMedia');
  const captionEl = document.getElementById('schedPreviewCaption');
  const editBtn = document.getElementById('schedPreviewEdit');
  if (!modal || !mediaEl) return;

  const norm = scheduleStatusNorm(p.status);
  const platformLabel = (p.postType || 'post').toUpperCase();
  const statusPill = scheduleStatusPill(p.status || 'pending');
  titleEl.innerHTML = `👁 ${norm === 'draft' ? 'Borrador' : platformLabel} &middot; ${statusPill}`;
  metaEl.innerHTML = `${esc(fmtScheduledDate(p.scheduledAt))} &middot; por ${esc(p.createdByName || 'Anonimo')}`;

  const urls = (Array.isArray(p.mediaUrls) && p.mediaUrls.length > 0)
    ? p.mediaUrls
    : (p.mediaUrl ? [p.mediaUrl] : []);
  if (urls.length === 0) {
    mediaEl.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:20px;text-align:center;width:100%">Sin media cargada</div>';
  } else {
    mediaEl.innerHTML = urls.map((url, i) => {
      const thumbUrl = mediaThumbUrl(url);
      const isVid = isVideoUrl(url);
      const playIcon = isVid ? '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:36px;color:white;text-shadow:0 2px 8px rgba(0,0,0,0.7);pointer-events:none">▶</div>' : '';
      const numBadge = `<div style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.75);color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">${i + 1}</div>`;
      const safeUrl = esc(url);
      const inner = thumbUrl
        ? `<div style="width:100%;height:100%;background:url('${esc(thumbUrl)}') center/cover no-repeat"></div>`
        : (isVid ? `<video src="${safeUrl}" muted preload="metadata" playsinline style="width:100%;height:100%;object-fit:cover"></video>` : `<img src="${safeUrl}" style="width:100%;height:100%;object-fit:cover">`);
      return `<a href="${safeUrl}" target="_blank" rel="noopener" style="flex:0 0 auto;width:200px;height:260px;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--bg-card);scroll-snap-align:start;position:relative;text-decoration:none;display:block">${inner}${numBadge}${playIcon}</a>`;
    }).join('');
  }

  captionEl.textContent = p.caption || '(Sin caption)';

  // El botón Editar solo se muestra si el usuario puede editar este post.
  const isAdminUser = currentUserData && currentUserData.role === 'admin';
  const isMine = p.createdBy === currentUser.uid;
  const isMultiMember = Array.isArray(p.multiTaskMembers) && p.multiTaskMembers.includes(currentUser.uid);
  const canEdit = (norm === 'draft') ? true : (isAdminUser || isMine || isMultiMember);

  // Render del slot ManyChat dentro del preview
  const mcEl = document.getElementById('schedPreviewManychat');
  if (mcEl) {
    if (p.manychatUrl) {
      const editIcon = canEdit
        ? `<button class="btn btn-ghost btn-small" data-mc-edit="${esc(p.id)}" title="Editar / quitar recurso ManyChat" style="font-size:11px;padding:2px 8px;margin-left:6px">✏ Editar</button>`
        : '';
      const addedBy = p.manychatAddedByName ? `<div style="font-size:10px;color:var(--text-dim);margin-top:4px">Agregado por ${esc(p.manychatAddedByName)}</div>` : '';
      mcEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;background:rgba(78,205,196,0.1);border:1px solid rgba(78,205,196,0.3);border-radius:8px;padding:10px 12px">
          <button data-mc-open="${esc(p.id)}" style="background:none;border:none;color:#4ecdc4;font-weight:600;font-size:13px;cursor:pointer;text-align:left;flex:1;padding:0">🔗 Abrir recurso ManyChat</button>
          ${editIcon}
        </div>
        ${addedBy}`;
    } else if (canEdit) {
      mcEl.innerHTML = `<button class="btn btn-ghost btn-small" data-mc-add="${esc(p.id)}" style="border:1px dashed var(--border);width:100%;padding:10px">+ Agregar recurso ManyChat</button>`;
    } else {
      mcEl.innerHTML = `<div style="font-size:12px;color:var(--text-dim);font-style:italic">Sin recurso asignado</div>`;
    }
    bindManyChatButtons(mcEl);
  }
  const editableNorm = (norm === 'programado' || norm === 'draft');
  if (canEdit && editableNorm) {
    editBtn.style.display = '';
    editBtn.onclick = () => {
      modal.classList.remove('active');
      editScheduledPost(postId);
    };
  } else {
    editBtn.style.display = 'none';
  }

  modal.classList.add('active');
}
const _schedPreviewClose = document.getElementById('schedPreviewClose');
if (_schedPreviewClose) {
  _schedPreviewClose.addEventListener('click', () => {
    document.getElementById('schedPreviewModal').classList.remove('active');
  });
}
const _schedPreviewModal = document.getElementById('schedPreviewModal');
if (_schedPreviewModal) {
  _schedPreviewModal.addEventListener('click', (e) => {
    if (e.target === _schedPreviewModal) _schedPreviewModal.classList.remove('active');
  });
}
function renderScheduleCalendarView() {
  const grid = document.getElementById('schedCalendarGrid');
  const monthLabel = document.getElementById('schedCalMonthLabel');
  const dayList = document.getElementById('schedCalendarDayList');
  if (!grid || !monthLabel) return;
  const year = schedCalDate.getFullYear();
  const month = schedCalDate.getMonth();
  monthLabel.textContent = schedCalDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstDay.getDay() + 6) % 7; // lunes = 0
  let html = '';
  for (let i = 0; i < offset; i++) html += `<div class="calendar-day other-month"></div>`;
  const items = visibleScheduledPosts();
  for (let d = 1; d <= daysInMonth; d++) {
    const dayPosts = items.filter(p => {
      if (!p.scheduledAt) return false;
      const dt = p.scheduledAt.toDate ? p.scheduledAt.toDate() : new Date(p.scheduledAt);
      return dt.getFullYear() === year && dt.getMonth() === month && dt.getDate() === d;
    });
    const today = new Date();
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const dotsHtml = dayPosts.slice(0, 3).map(p => {
      const n = scheduleStatusNorm(p.status);
      const cls = n === 'publicado' ? '' : (n === 'failed' ? 'overdue' : '');
      const time = (p.scheduledAt && (p.scheduledAt.toDate ? p.scheduledAt.toDate() : new Date(p.scheduledAt))).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      return `<div class="calendar-task-dot ${cls}" style="background:rgba(225,48,108,0.25)">${time} 📷</div>`;
    }).join('');
    const more = dayPosts.length > 3 ? `<div class="calendar-task-dot">+${dayPosts.length - 3}</div>` : '';
    html += `<div class="calendar-day ${isToday ? 'today' : ''} ${dayPosts.length > 0 ? 'has-tasks' : ''}" data-sched-day="${d}"><div class="calendar-day-num">${d}</div>${dotsHtml}${more}</div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('[data-sched-day]').forEach(c => {
    c.addEventListener('click', () => {
      const d = parseInt(c.dataset.schedDay, 10);
      const dayPosts = items.filter(p => {
        if (!p.scheduledAt) return false;
        const dt = p.scheduledAt.toDate ? p.scheduledAt.toDate() : new Date(p.scheduledAt);
        return dt.getFullYear() === year && dt.getMonth() === month && dt.getDate() === d;
      });
      // Determinar si el dia es hoy o futuro (no permitir programar en pasado)
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dayDate = new Date(year, month, d);
      const isPastDay = dayDate < today;
      // Header: dia formateado + boton "+ Programar este dia" (solo si no es pasado)
      const dayLabel = dayDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      const addBtnHtml = isPastDay
        ? ''
        : `<button class="btn btn-primary btn-small" data-add-on-day="${year}-${month}-${d}" style="font-size:11px;padding:4px 10px">&#10133; Programar este dia</button>`;
      const headerHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-card);border-radius:6px;margin-bottom:8px">
          <div style="font-size:12px;font-weight:600;color:var(--text-primary);text-transform:capitalize">${esc(dayLabel)}</div>
          ${addBtnHtml}
        </div>`;
      const cardsHtml = dayPosts.length === 0
        ? '<div style="color:var(--text-dim);font-size:12px;padding:12px;text-align:center">Sin posts ese dia</div>'
        : dayPosts.map(p => {
            const ts = p.mediaUrl ? mediaThumbUrl(p.mediaUrl) : '';
            const thumbStyle = ts ? `style="background-image:url('${esc(ts)}')"` : '';
            return `
            <div class="sched-card ${scheduleStatusNorm(p.status) === 'publicado' ? 'published' : (scheduleStatusNorm(p.status) === 'failed' ? 'failed' : '')}">
              <div class="sched-card-thumb" ${thumbStyle}></div>
              <div class="sched-card-body">
                <div class="sched-card-when">${esc(fmtScheduledDate(p.scheduledAt))}</div>
                <div class="sched-card-caption">${esc((p.caption || '').slice(0, 200))}</div>
                <div class="sched-card-meta">${scheduleStatusPill(p.status || 'pending')}</div>
              </div>
            </div>`;
          }).join('');
      dayList.innerHTML = headerHtml + cardsHtml;
      // Bind boton +Programar este dia
      const addBtn = dayList.querySelector('[data-add-on-day]');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          const [y, m, dd] = addBtn.dataset.addOnDay.split('-').map(n => parseInt(n, 10));
          openScheduleModalForDate(y, m, dd);
        });
      }
    });
  });
}
function renderSchedule() {
  // Badge: cuenta posts pendientes (programados) del usuario
  const badge = document.getElementById('scheduleBadge');
  if (badge) {
    const pending = visibleScheduledPosts().filter(p => scheduleStatusNorm(p.status) === 'programado').length;
    if (pending > 0) { badge.textContent = pending > 99 ? '99+' : String(pending); badge.style.display = 'inline-block'; }
    else { badge.style.display = 'none'; }
  }
  if (currentScheduleView === 'list') renderScheduleListView();
  else renderScheduleCalendarView();
  // Status del webhook config (mostrar arriba a la derecha)
  const status = document.getElementById('scheduleConfigStatus');
  if (status && window.api && window.api.getMakeWebhook) {
    window.api.getMakeWebhook().then(url => {
      status.textContent = url ? '✓ Webhook configurado' : '⚠ Configurar webhook en Configuracion';
      status.style.color = url ? 'var(--success)' : 'var(--warning)';
    });
  }
}

// schedulingContext puede ser:
//   { type: 'task', taskId, ... }       -> programar desde una tarea completada
//   { type: 'entry', entryId, ... }     -> programar desde una entry finalizada del deposito
let schedulingContext = null;
// Si != null, el modal esta editando un post existente en lugar de crear uno nuevo.
// Al confirmar, se hace update en vez de add.
let editingPostId = null;

function applyPostTypeToModal(type) {
  const isCarousel = type === 'carousel';
  document.getElementById('schedSingleUrlRow').style.display = isCarousel ? 'none' : '';
  document.getElementById('schedCarouselUrlsRow').style.display = isCarousel ? '' : 'none';
  // Preview: galeria para carrusel, imagen unica para los demas
  document.getElementById('scheduleCarouselGallery').style.display = isCarousel ? '' : 'none';
  document.getElementById('scheduleMediaPreview').style.display = isCarousel ? 'none' : '';
  if (isCarousel) renderCarouselGallery();
}

// ===== Carrusel: inputs dinamicos (una casilla por imagen, +/- on demand) =====
const CAROUSEL_MIN = 2;
const CAROUSEL_MAX = 10;

// Obtiene todas las URLs ingresadas en las casillas de carrusel (filtradas, no vacias).
function getCarouselUrls() {
  const inputs = document.querySelectorAll('#schedCarouselInputs input[type="url"]');
  return Array.from(inputs).map(i => i.value.trim()).filter(s => s.length > 0);
}

// Re-numera las filas y actualiza miniaturas + estado del boton remove.
function refreshCarouselInputs() {
  const container = document.getElementById('schedCarouselInputs');
  if (!container) return;
  const rows = container.querySelectorAll('.carousel-input-row');
  rows.forEach((row, i) => {
    const num = row.querySelector('.carousel-num');
    const input = row.querySelector('input[type="url"]');
    const thumb = row.querySelector('.carousel-thumb');
    const removeBtn = row.querySelector('.carousel-remove');
    const upBtn = row.querySelector('.carousel-move-up');
    const downBtn = row.querySelector('.carousel-move-down');
    if (num) num.textContent = String(i + 1);
    if (thumb && input) {
      const v = input.value.trim();
      // Para videos de Cloudinary se usa thumb generado (jpg del primer frame).
      // Para videos no-Cloudinary, no hay thumb posible aqui (sale icono play).
      const thumbUrl = mediaThumbUrl(v);
      if (thumbUrl) {
        thumb.style.backgroundImage = `url('${thumbUrl.replace(/'/g, '%27')}')`;
        thumb.innerHTML = '';
      } else if (v && isVideoUrl(v)) {
        thumb.style.backgroundImage = '';
        thumb.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--text-dim)">▶</div>';
      } else {
        thumb.style.backgroundImage = '';
        thumb.innerHTML = '';
      }
    }
    if (removeBtn) removeBtn.disabled = rows.length <= CAROUSEL_MIN;
    if (upBtn) upBtn.disabled = i === 0;
    if (downBtn) downBtn.disabled = i === rows.length - 1;
  });
  // Boton +Anadir desactivado al llegar al max
  const addBtn = document.getElementById('schedAddCarouselUrl');
  if (addBtn) addBtn.disabled = rows.length >= CAROUSEL_MAX;
}

// Mueve una fila del carrusel hacia arriba o abajo en el orden.
function moveCarouselRow(row, direction) {
  const container = document.getElementById('schedCarouselInputs');
  if (!container || !row) return;
  if (direction === 'up') {
    const prev = row.previousElementSibling;
    if (prev) container.insertBefore(row, prev);
  } else {
    const next = row.nextElementSibling;
    if (next) container.insertBefore(next, row);
  }
  refreshCarouselInputs();
  renderCarouselGallery();
}

// Crea una fila de input con miniatura + boton remove + boton upload por fila,
// y la inserta al container.
function addCarouselInputRow(prefillUrl) {
  const container = document.getElementById('schedCarouselInputs');
  if (!container) return;
  const rows = container.querySelectorAll('.carousel-input-row');
  if (rows.length >= CAROUSEL_MAX) return;
  const row = document.createElement('div');
  row.className = 'carousel-input-row';
  row.innerHTML = `
    <div class="carousel-num">1</div>
    <div class="carousel-move-stack">
      <button type="button" class="carousel-move carousel-move-up" title="Mover arriba">&#9650;</button>
      <button type="button" class="carousel-move carousel-move-down" title="Mover abajo">&#9660;</button>
    </div>
    <input type="url" placeholder="https://...jpg" />
    <button type="button" class="carousel-upload" title="Subir archivo">&#128193;</button>
    <input type="file" class="carousel-file-input" accept="image/*,video/*" style="display:none" />
    <div class="carousel-thumb"></div>
    <button type="button" class="carousel-remove" title="Quitar">&#10005;</button>
  `;
  const input = row.querySelector('input[type="url"]');
  const fileInput = row.querySelector('.carousel-file-input');
  const uploadBtn = row.querySelector('.carousel-upload');
  if (prefillUrl) input.value = prefillUrl;
  // Preview live + actualizacion de la galeria al teclear/pegar
  input.addEventListener('input', () => {
    refreshCarouselInputs();
    renderCarouselGallery();
  });
  // Upload de un archivo en esta fila
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const originalTitle = uploadBtn.title;
    uploadBtn.disabled = true;
    uploadBtn.title = 'Subiendo...';
    uploadBtn.innerHTML = '⏳';
    try {
      const result = await uploadToCloudinary(file, (pct) => {
        uploadBtn.title = `Subiendo ${pct}%`;
      });
      input.value = result.url;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
      alert('Error subiendo archivo: ' + e.message);
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.title = originalTitle;
      uploadBtn.innerHTML = '&#128193;';
      fileInput.value = '';
    }
  });
  // Boton remove
  row.querySelector('.carousel-remove').addEventListener('click', () => {
    const all = container.querySelectorAll('.carousel-input-row');
    if (all.length <= CAROUSEL_MIN) return; // siempre minimo 2
    row.remove();
    refreshCarouselInputs();
    renderCarouselGallery();
  });
  // Botones mover arriba / abajo
  row.querySelector('.carousel-move-up').addEventListener('click', () => moveCarouselRow(row, 'up'));
  row.querySelector('.carousel-move-down').addEventListener('click', () => moveCarouselRow(row, 'down'));
  container.appendChild(row);
  refreshCarouselInputs();
}

// Resetea el container con la cantidad minima (2) y rellena con urls dadas.
function resetCarouselInputs(urls) {
  const container = document.getElementById('schedCarouselInputs');
  if (!container) return;
  container.innerHTML = '';
  const arr = Array.isArray(urls) ? urls.slice(0, CAROUSEL_MAX) : [];
  const total = Math.max(CAROUSEL_MIN, arr.length);
  for (let i = 0; i < total; i++) addCarouselInputRow(arr[i] || '');
  renderCarouselGallery();
}

// Render galeria horizontal de previews del carrusel (debajo del header del modal).
// Lee desde los inputs dinamicos.
function renderCarouselGallery() {
  const lines = getCarouselUrls().filter(u => /^https?:\/\//i.test(u));
  const thumbs = document.getElementById('scheduleGalleryThumbs');
  const count = document.getElementById('scheduleGalleryCount');
  if (!thumbs || !count) return;
  if (lines.length === 0) {
    thumbs.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:20px;text-align:center;width:100%">Pega las URLs abajo para ver la vista previa</div>';
    count.textContent = '';
    return;
  }
  count.textContent = `(${lines.length} ${lines.length === 1 ? 'imagen' : 'imagenes'}) — arrastra para reordenar`;
  thumbs.innerHTML = lines.map((url, i) => {
    const thumbUrl = mediaThumbUrl(url);
    const isVid = isVideoUrl(url);
    const playIcon = isVid ? '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:32px;color:white;text-shadow:0 2px 8px rgba(0,0,0,0.6);pointer-events:none">▶</div>' : '';
    const numBadge = `<div style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.7);color:white;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;pointer-events:none">${i + 1}</div>`;
    if (thumbUrl) {
      return `
      <div class="gallery-thumb-drag" draggable="true" data-gallery-idx="${i}" style="flex:0 0 auto;width:120px;height:150px;border-radius:6px;overflow:hidden;background:var(--bg-card) center/cover no-repeat;background-image:url('${thumbUrl.replace(/'/g, '%27')}');border:1px solid var(--border);scroll-snap-align:start;position:relative">
        ${numBadge}
        ${playIcon}
      </div>`;
    }
    // Video no-Cloudinary: usar video tag inline (preload metadata para 1er frame)
    return `
      <div class="gallery-thumb-drag" draggable="true" data-gallery-idx="${i}" style="flex:0 0 auto;width:120px;height:150px;border-radius:6px;overflow:hidden;background:var(--bg-card);border:1px solid var(--border);scroll-snap-align:start;position:relative">
        <video src="${url.replace(/"/g, '%22')}" muted preload="metadata" playsinline style="width:100%;height:100%;object-fit:cover;pointer-events:none"></video>
        ${numBadge}
        ${playIcon}
      </div>`;
  }).join('');
  // Drag-to-reorder: arrastra un thumb sobre otro y se intercambian/insertan.
  // Sincroniza con los inputs para que getCarouselUrls() refleje el nuevo orden.
  let dragSrcIdx = null;
  thumbs.querySelectorAll('[data-gallery-idx]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      dragSrcIdx = parseInt(el.dataset.galleryIdx, 10);
      el.classList.add('gallery-thumb-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(dragSrcIdx)); } catch (_) {}
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('gallery-thumb-dragging');
      thumbs.querySelectorAll('.gallery-thumb-drop-target').forEach(x => x.classList.remove('gallery-thumb-drop-target'));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('gallery-thumb-drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('gallery-thumb-drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('gallery-thumb-drop-target');
      const dstIdx = parseInt(el.dataset.galleryIdx, 10);
      if (dragSrcIdx === null || dragSrcIdx === dstIdx) return;
      reorderCarouselByGalleryDrag(dragSrcIdx, dstIdx);
      dragSrcIdx = null;
    });
  });
}

// Reordena las filas del carrusel cuando se hace drag-and-drop en la galeria
// de previews. La galeria solo muestra URLs validas (filter por https), pero
// las filas pueden tener URLs vacias — saltamos esas para mapear bien.
function reorderCarouselByGalleryDrag(srcIdx, dstIdx) {
  const container = document.getElementById('schedCarouselInputs');
  if (!container) return;
  const rows = Array.from(container.querySelectorAll('.carousel-input-row'));
  const filledRows = rows.filter(r => {
    const v = r.querySelector('input[type="url"]').value.trim();
    return /^https?:\/\//i.test(v);
  });
  const srcRow = filledRows[srcIdx];
  const dstRow = filledRows[dstIdx];
  if (!srcRow || !dstRow) return;
  if (srcIdx < dstIdx) {
    // mover hacia abajo: insertar despues del destino
    if (dstRow.nextSibling) container.insertBefore(srcRow, dstRow.nextSibling);
    else container.appendChild(srcRow);
  } else {
    // mover hacia arriba: insertar antes del destino
    container.insertBefore(srcRow, dstRow);
  }
  refreshCarouselInputs();
  renderCarouselGallery();
}

async function openScheduleModal(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) { toast && toast('Tarea no encontrada', 'error'); return; }
  schedulingContext = {
    type: 'task',
    taskId: task.id,
    title: task.text || '',
    description: task.description || '',
    coverImage: task.coverImage || ''
  };
  await openScheduleModalWithContext();
}

async function openScheduleModalForEntry(entryData) {
  if (!entryData || !entryData.id) return;
  schedulingContext = {
    type: 'entry',
    entryId: entryData.id,
    title: entryData.title || '',
    description: entryData.description || '',
    coverImage: entryData.coverImage || '',
    mediaUrls: Array.isArray(entryData.mediaUrls) ? entryData.mediaUrls : []
  };
  await openScheduleModalWithContext();
}

// Programacion manual (sin task ni entry asociado): el usuario carga todo a mano
async function openScheduleModalManual() {
  schedulingContext = {
    type: 'manual',
    title: '',
    description: '',
    coverImage: ''
  };
  await openScheduleModalWithContext();
}

// Programacion manual con fecha pre-llenada (desde calendario):
// el usuario hace click en un dia y la modal abre con esa fecha ya puesta.
async function openScheduleModalForDate(year, month, day) {
  schedulingContext = {
    type: 'manual',
    title: '',
    description: '',
    coverImage: '',
    presetDate: new Date(year, month, day, 9, 0, 0, 0) // 9am del dia clickeado
  };
  await openScheduleModalWithContext();
}

async function openScheduleModalWithContext() {
  const modal = document.getElementById('scheduleModal');
  if (!modal || !schedulingContext) return;
  let webhookUrl = '';
  try { webhookUrl = await window.api.getMakeWebhook(); } catch (e) {}
  document.getElementById('scheduleNoWebhook').style.display = webhookUrl ? 'none' : 'block';
  // Fecha default: manana 9am, salvo que el contexto traiga una presetDate
  // (se usa cuando programas haciendo click en un dia del calendario)
  const presetDate = schedulingContext.presetDate instanceof Date ? schedulingContext.presetDate : null;
  const future = presetDate || (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })();
  const yyyy = future.getFullYear();
  const mm = String(future.getMonth() + 1).padStart(2, '0');
  const dd = String(future.getDate()).padStart(2, '0');
  const hh = String(future.getHours()).padStart(2, '0');
  const mi = String(future.getMinutes()).padStart(2, '0');
  document.getElementById('schedDate').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('schedTime').value = `${hh}:${mi}`;
  const desc = schedulingContext.description ? `\n\n${schedulingContext.description}` : '';
  document.getElementById('schedCaption').value = `${schedulingContext.title || ''}${desc}`.trim();

  // Pre-llenado de URLs:
  //   - Si la entry tiene mediaUrls (Cloudinary etc.) -> auto-llenar carrusel/single
  //   - Sino, fallback al coverImage del thumbnail
  const presetUrls = Array.isArray(schedulingContext.mediaUrls) ? schedulingContext.mediaUrls : [];
  const fallbackCover = schedulingContext.coverImage || '';
  let suggestedType = 'post';

  if (presetUrls.length >= 2) {
    // 2+ URLs => sugerimos carrusel
    suggestedType = 'carousel';
    document.getElementById('schedMediaUrl').value = presetUrls[0];
    resetCarouselInputs(presetUrls);
  } else if (presetUrls.length === 1) {
    // 1 URL => post (o el usuario puede cambiar a reel/story)
    document.getElementById('schedMediaUrl').value = presetUrls[0];
    resetCarouselInputs([presetUrls[0]]);
  } else if (fallbackCover) {
    document.getElementById('schedMediaUrl').value = fallbackCover;
    resetCarouselInputs([fallbackCover]);
  } else {
    document.getElementById('schedMediaUrl').value = '';
    resetCarouselInputs([]);
  }

  const previewUrl = (presetUrls[0]) || fallbackCover;
  const previewBox = document.getElementById('scheduleMediaPreview');
  const previewImg = document.getElementById('scheduleMediaImg');
  if (previewUrl) {
    previewBox.style.display = 'block';
    renderMediaInto(previewImg, previewUrl);
  } else {
    previewBox.style.display = 'none';
    renderMediaInto(previewImg, '');
  }

  // Si el contexto trae suggestedPostType (viene de multi-tarea), usarlo
  // por encima de la heuristica basada en cantidad de URLs.
  if (schedulingContext.suggestedPostType) {
    suggestedType = schedulingContext.suggestedPostType;
  }
  // Aplicar tipo sugerido
  document.querySelectorAll('input[name="schedPostType"]').forEach(r => { r.checked = r.value === suggestedType; });
  applyPostTypeToModal(suggestedType);
  // Plataformas default: ambas activas en posts nuevos.
  applyPlatformsToModal(['instagram', 'tiktok']);
  // Reset modo edicion (solo openScheduleModalForEdit lo activa)
  editingPostId = null;
  applyScheduleModalLabels();
  modal.classList.add('active');
}

function closeScheduleModal() {
  const m = document.getElementById('scheduleModal');
  if (m) m.classList.remove('active');
  schedulingContext = null;
  editingPostId = null;
}

// Cambia titulo del modal y label del boton confirmar segun crear vs editar
function applyScheduleModalLabels() {
  const titleEl = document.querySelector('#scheduleModal .modal-title');
  const confirmBtn = document.getElementById('schedConfirm');
  let isDraftEdit = false;
  if (editingPostId) {
    const p = scheduledPosts.find(x => x.id === editingPostId);
    isDraftEdit = p && scheduleStatusNorm(p.status) === 'draft';
  }
  if (isDraftEdit) {
    if (titleEl) titleEl.innerHTML = '📝 Editar borrador';
    if (confirmBtn) confirmBtn.innerHTML = '&#128241; Programar ahora';
  } else if (editingPostId) {
    if (titleEl) titleEl.innerHTML = '✎ Editar post programado';
    if (confirmBtn) confirmBtn.innerHTML = '&#128190; Actualizar';
  } else {
    if (titleEl) titleEl.innerHTML = '&#128241; Programar en Instagram';
    if (confirmBtn) confirmBtn.innerHTML = '&#128241; Programar';
  }
}

// Abre el modal para EDITAR un post programado existente (no crea uno nuevo).
async function editScheduledPost(id) {
  const p = scheduledPosts.find(x => x.id === id);
  if (!p) { alert('Post no encontrado'); return; }
  const norm = scheduleStatusNorm(p.status);
  if (norm !== 'programado' && norm !== 'draft') {
    alert('Solo se pueden editar posts en estado "programado" o "borrador". Este ya esta ' + norm + '.');
    return;
  }
  // Construir un schedulingContext desde el post existente
  schedulingContext = {
    type: p.sourceType || 'manual',
    taskId: p.taskId || null,
    entryId: p.entryId || null,
    title: p.taskTitle || '',
    description: '',
    coverImage: p.mediaUrl || '',
    mediaUrls: Array.isArray(p.mediaUrls) ? p.mediaUrls : []
  };
  const modal = document.getElementById('scheduleModal');
  if (!modal) return;
  let webhookUrl = '';
  try { webhookUrl = await window.api.getMakeWebhook(); } catch (e) {}
  document.getElementById('scheduleNoWebhook').style.display = webhookUrl ? 'none' : 'block';
  // Pre-llenar con los valores reales del post. Drafts pueden no tener
  // scheduledAt; usar manana 9am como default en ese caso.
  let dt = null;
  if (p.scheduledAt) {
    dt = p.scheduledAt.toDate ? p.scheduledAt.toDate() : new Date(p.scheduledAt);
    if (isNaN(dt.getTime())) dt = null;
  }
  if (!dt) { dt = new Date(); dt.setDate(dt.getDate() + 1); dt.setHours(9, 0, 0, 0); }
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  document.getElementById('schedDate').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('schedTime').value = `${hh}:${mi}`;
  document.getElementById('schedCaption').value = p.caption || '';
  document.getElementById('schedMediaUrl').value = p.mediaUrl || '';
  resetCarouselInputs(Array.isArray(p.mediaUrls) ? p.mediaUrls : (p.mediaUrl ? [p.mediaUrl] : []));
  // Preview unico (img o video segun sea)
  const previewBox = document.getElementById('scheduleMediaPreview');
  const previewImg = document.getElementById('scheduleMediaImg');
  if (p.mediaUrl) {
    previewBox.style.display = 'block';
    renderMediaInto(previewImg, p.mediaUrl);
  } else {
    previewBox.style.display = 'none';
    renderMediaInto(previewImg, '');
  }
  const ptype = p.postType || 'post';
  document.querySelectorAll('input[name="schedPostType"]').forEach(r => { r.checked = r.value === ptype; });
  applyPostTypeToModal(ptype);
  // Plataformas: si el post tiene platforms guardado, respetarlo. Si no
  // (posts legacy de antes de v3.1), asumir IG only para no cambiar destino.
  applyPlatformsToModal(Array.isArray(p.platforms) && p.platforms.length > 0 ? p.platforms : ['instagram']);
  editingPostId = id;
  applyScheduleModalLabels();
  modal.classList.add('active');
}

// Lee los checkboxes de plataformas del modal Programar y devuelve el array.
// Default: ambas marcadas si el usuario no toco nada (caso edicion legacy).
function getSelectedPlatforms() {
  const ig = document.getElementById('schedPlatformIg');
  const tt = document.getElementById('schedPlatformTt');
  const platforms = [];
  if (ig && ig.checked) platforms.push('instagram');
  if (tt && tt.checked) platforms.push('tiktok');
  return platforms;
}
function applyPlatformsToModal(platforms) {
  const ig = document.getElementById('schedPlatformIg');
  const tt = document.getElementById('schedPlatformTt');
  // Si no se especifico nada (post legacy), default IG only para no romper
  // posts antiguos: la Cloud Function asume IG si platforms esta vacio.
  const arr = Array.isArray(platforms) && platforms.length > 0 ? platforms : ['instagram'];
  if (ig) ig.checked = arr.includes('instagram');
  if (tt) tt.checked = arr.includes('tiktok');
}

// Comprueba si el modal tiene "data significativa" — usado para decidir si al
// cancelar conviene preguntar guardar como borrador.
function scheduleModalHasContent() {
  try {
    const cap = (document.getElementById('schedCaption').value || '').trim();
    const url = (document.getElementById('schedMediaUrl').value || '').trim();
    const carouselUrls = getCarouselUrls();
    return cap.length > 0 || url.length > 0 || carouselUrls.length > 0;
  } catch (e) { return false; }
}

// Guarda el contenido del modal como BORRADOR (status='draft'). Validacion
// permisiva: solo necesita algo de contenido (caption, URL, o URLs carrusel).
// El usuario lo retoma despues sin perder lo subido a Cloudinary.
async function saveScheduleAsDraft() {
  if (!schedulingContext) return false;
  const caption = document.getElementById('schedCaption').value.trim();
  const postType = document.querySelector('input[name="schedPostType"]:checked')?.value || 'post';
  const date = document.getElementById('schedDate').value;
  const time = document.getElementById('schedTime').value;
  // scheduledAt: si el user no llenó fecha/hora, usar mañana 9am como placeholder
  // (el doc igual no se publicara porque tiene status='draft', pero nos asegura
  // que orderBy('scheduledAt') en Firestore no excluya el draft del listado).
  let scheduledAt = null;
  if (date && time) {
    const dt = new Date(`${date}T${time}`);
    if (!isNaN(dt.getTime())) scheduledAt = dt;
  }
  if (!scheduledAt) {
    scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + 1);
    scheduledAt.setHours(9, 0, 0, 0);
  }
  let mediaUrl = '';
  let mediaUrls = null;
  if (postType === 'carousel') {
    const lines = getCarouselUrls();
    if (lines.length > 0) { mediaUrls = lines; mediaUrl = lines[0]; }
  } else {
    mediaUrl = document.getElementById('schedMediaUrl').value.trim();
  }
  if (!caption && !mediaUrl && !mediaUrls) {
    alert('Nada que guardar — agrega al menos un caption o una imagen');
    return false;
  }
  const platforms = getSelectedPlatforms();
  const payload = {
    platform: 'instagram',
    platforms: platforms.length > 0 ? platforms : ['instagram'],
    postType,
    caption,
    mediaUrl,
    scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
    triggeredBy: currentUserData ? currentUserData.name : currentUser.email,
    triggeredByEmail: currentUser.email,
    sourceType: schedulingContext.type,
    taskId: schedulingContext.type === 'task' ? schedulingContext.taskId : null,
    entryId: schedulingContext.type === 'entry' ? schedulingContext.entryId : null,
    taskTitle: schedulingContext.title || ''
  };
  if (mediaUrls) {
    payload.mediaUrls = mediaUrls;
    mediaUrls.forEach((u, i) => { payload[`mediaUrl${i + 1}`] = u; });
    payload.carouselChildren = mediaUrls.map(url => ({ media_type: 'IMAGE', image_url: url }));
  }
  try {
    const docPayload = {
      ...payload,
      scheduledAt: firebase.firestore.Timestamp.fromDate(scheduledAt),
      status: 'draft'
    };
    if (editingPostId) {
      docPayload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      docPayload.updatedBy = currentUser.uid;
      if (!mediaUrls) {
        docPayload.mediaUrls = firebase.firestore.FieldValue.delete();
        docPayload.carouselChildren = firebase.firestore.FieldValue.delete();
        for (let i = 1; i <= 10; i++) {
          docPayload[`mediaUrl${i}`] = firebase.firestore.FieldValue.delete();
        }
      }
      await db.collection('scheduledPosts').doc(editingPostId).update(docPayload);
    } else {
      docPayload.createdBy = currentUser.uid;
      docPayload.createdByName = currentUserData ? currentUserData.name : currentUser.email;
      docPayload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      // Si vino de multi-tarea: guardar miembros para que TODOS lo vean
      if (schedulingContext && schedulingContext.fromMultiTaskId) {
        const multiTask = tasks.find(t => t.id === schedulingContext.fromMultiTaskId);
        if (multiTask && Array.isArray(multiTask.assignedToMulti)) {
          docPayload.multiTaskMembers = multiTask.assignedToMulti;
          docPayload.fromMultiTaskId = schedulingContext.fromMultiTaskId;
        }
      }
      await db.collection('scheduledPosts').add(docPayload);
    }
    return true;
  } catch (e) {
    alert('No se pudo guardar el borrador: ' + e.message);
    return false;
  }
}

async function confirmSchedulePost() {
  if (!schedulingContext) return;
  const date = document.getElementById('schedDate').value;
  const time = document.getElementById('schedTime').value;
  const caption = document.getElementById('schedCaption').value.trim();
  const postType = document.querySelector('input[name="schedPostType"]:checked')?.value || 'post';
  if (!date || !time) { alert('Fecha y hora son obligatorias'); return; }
  if (!caption) { alert('El caption no puede estar vacio'); return; }
  const scheduledAt = new Date(`${date}T${time}`);
  if (scheduledAt < new Date()) { alert('La fecha/hora debe ser en el futuro'); return; }

  // URL handling: carousel manda array (desde inputs dinamicos), otros mandan string
  let mediaUrl = '';
  let mediaUrls = null;
  if (postType === 'carousel') {
    const lines = getCarouselUrls();
    if (lines.length < CAROUSEL_MIN) { alert(`Carrusel requiere minimo ${CAROUSEL_MIN} URLs`); return; }
    if (lines.length > CAROUSEL_MAX) { alert(`Carrusel acepta maximo ${CAROUSEL_MAX} URLs`); return; }
    mediaUrls = lines;
    mediaUrl = lines[0]; // primera como fallback compatible
  } else {
    mediaUrl = document.getElementById('schedMediaUrl').value.trim();
    if (!mediaUrl) { alert('La URL del medio es obligatoria'); return; }
  }

  const platforms = getSelectedPlatforms();
  if (platforms.length === 0) { alert('Tildá al menos una plataforma (Instagram o TikTok)'); return; }
  const payload = {
    platform: 'instagram',
    platforms,
    postType,
    caption,
    mediaUrl,
    scheduledAt: scheduledAt.toISOString(),
    triggeredBy: currentUserData ? currentUserData.name : currentUser.email,
    triggeredByEmail: currentUser.email,
    sourceType: schedulingContext.type, // 'task' o 'entry'
    taskId: schedulingContext.type === 'task' ? schedulingContext.taskId : null,
    entryId: schedulingContext.type === 'entry' ? schedulingContext.entryId : null,
    taskTitle: schedulingContext.title || ''
  };
  if (mediaUrls) {
    payload.mediaUrls = mediaUrls;
    // Individuales mediaUrl1..mediaUrl10 para mapeo simple en Make sin iterator
    mediaUrls.forEach((u, i) => { payload[`mediaUrl${i + 1}`] = u; });
    // Array ya estructurado para Make: cada item con media_type + image_url.
    // En el modulo "Create a Carousel Post" se activa "Map" en Children y se
    // mapea esta variable directamente. Maneja 2-10 URLs dinamico.
    payload.carouselChildren = mediaUrls.map(url => ({
      media_type: 'IMAGE',
      image_url: url
    }));
  }
  // Guardar en Firestore con status=programado.
  // La Cloud Function `publishScheduledPosts` corre cada 5 min, encuentra
  // este doc cuando scheduledAt<=now y dispara el webhook a Make. Despues
  // marca status=publicado o failed segun resultado.
  try {
    if (editingPostId) {
      // Modo edicion: actualiza el doc existente.
      // Limpiamos campos de carrusel viejos si el nuevo postType no es carrusel,
      // para que Make no reciba mediaUrls fantasma del estado anterior.
      const updateData = {
        ...payload,
        scheduledAt: firebase.firestore.Timestamp.fromDate(scheduledAt),
        status: 'programado',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: currentUser.uid
      };
      if (!mediaUrls) {
        // Quitar campos de carrusel del doc para evitar arrastrar data vieja
        updateData.mediaUrls = firebase.firestore.FieldValue.delete();
        updateData.carouselChildren = firebase.firestore.FieldValue.delete();
        for (let i = 1; i <= 10; i++) {
          updateData[`mediaUrl${i}`] = firebase.firestore.FieldValue.delete();
        }
      }
      await db.collection('scheduledPosts').doc(editingPostId).update(updateData);
    } else {
      const newDoc = {
        ...payload,
        scheduledAt: firebase.firestore.Timestamp.fromDate(scheduledAt),
        status: 'programado',
        createdBy: currentUser.uid,
        createdByName: currentUserData ? currentUserData.name : currentUser.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      // Si el post viene de una multi-tarea, guardar la lista de miembros para
      // que TODOS la vean en su pestana Programacion (no solo el creador).
      if (schedulingContext && schedulingContext.fromMultiTaskId) {
        const multiTask = tasks.find(t => t.id === schedulingContext.fromMultiTaskId);
        if (multiTask) {
          if (Array.isArray(multiTask.assignedToMulti)) newDoc.multiTaskMembers = multiTask.assignedToMulti;
          newDoc.fromMultiTaskId = schedulingContext.fromMultiTaskId;
        }
      }
      await db.collection('scheduledPosts').add(newDoc);
    }
  } catch (e) {
    alert('No se pudo guardar en Firestore: ' + e.message);
    return;
  }
  // Si veniamos de una multi-tarea, marcar la tarea original como completada
  // y archivarla en Trabajos Finalizados (cierra el ciclo).
  if (schedulingContext && schedulingContext.fromMultiTaskId) {
    const multiTask = tasks.find(t => t.id === schedulingContext.fromMultiTaskId);
    if (multiTask) {
      try { await finalizeMultiTaskAfterAction(multiTask); } catch (e) { /* ignore */ }
    }
  }
  closeScheduleModal();
  // Cambiar a la pestana Programacion
  const schedTab = document.querySelector('.nav-tab[data-tab="schedule"]');
  if (schedTab) schedTab.click();
}
async function cancelScheduledPost(id) {
  if (!confirm('Cancelar este post programado? Tambien deberias desactivarlo en Make si ya esta agendado.')) return;
  try {
    await db.collection('scheduledPosts').doc(id).delete();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}
function setScheduleView(v) {
  currentScheduleView = v === 'calendar' ? 'calendar' : 'list';
  document.querySelectorAll('.schedule-view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.scheduleView === currentScheduleView);
  });
  document.getElementById('scheduleListView').style.display = currentScheduleView === 'list' ? '' : 'none';
  document.getElementById('scheduleCalendarView').style.display = currentScheduleView === 'calendar' ? '' : 'none';
  renderSchedule();
}

// ===== RENDER =====
// ===== CALENDAR =====
let calCursor = new Date();
let calSelectedDate = null;

function tasksOnDate(date) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const matches = (t) => {
    if (!t.deadline) return false;
    const dd = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    return dd.getFullYear() === y && dd.getMonth() === m && dd.getDate() === d;
  };
  const team = tasks.filter(t => matches(t) && t.status !== 'completed');
  const personal = personalTasks.filter(t => matches(t) && t.status !== 'completed');
  return { team, personal, all: [...team, ...personal] };
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const label = document.getElementById('calMonthLabel');
  if (!grid || !label) return;

  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  label.textContent = calCursor.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const firstOfMonth = new Date(year, month, 1);
  const firstDow = (firstOfMonth.getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayKey = today.toDateString();

  let html = '';
  for (let i = 0; i < firstDow; i++) html += '<div class="calendar-day other-month"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    const key = dt.toDateString();
    const { team, personal, all } = tasksOnDate(dt);
    const classes = ['calendar-day'];
    if (all.length > 0) classes.push('has-tasks');
    if (key === todayKey) classes.push('today');
    if (calSelectedDate && key === calSelectedDate) classes.push('selected');

    html += `<div class="${classes.join(' ')}" onclick="selectCalendarDay('${key}')">`;
    html += `<div class="calendar-day-num">${d}</div>`;
    const preview = [
      ...team.map(t => ({ ...t, _personal: false })),
      ...personal.map(t => ({ ...t, _personal: true }))
    ];
    preview.slice(0, 2).forEach(t => {
      const overdue = !t._personal && (t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline)) < today;
      const cls = t._personal ? 'personal' : (overdue ? 'overdue' : '');
      html += `<div class="calendar-task-dot ${cls}" title="${esc(t.text)}">${esc(t.text.slice(0, 14))}</div>`;
    });
    if (preview.length > 2) html += `<div class="calendar-task-dot">+${preview.length - 2}</div>`;
    html += '</div>';
  }
  grid.innerHTML = html;
  renderCalendarDayList();
}

function renderCalendarDayList() {
  const container = document.getElementById('calendarDayList');
  if (!container) return;
  if (!calSelectedDate) { container.innerHTML = ''; return; }
  const date = new Date(calSelectedDate);
  const { all } = tasksOnDate(date);
  const header = `<div style="padding:8px 12px;font-weight:600;font-size:13px;text-transform:capitalize;display:flex;justify-content:space-between;align-items:center;gap:8px">
    <span>${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    <button class="btn btn-primary btn-small" onclick="openCalTaskModal('${calSelectedDate}')" style="white-space:nowrap">+ Nueva</button>
  </div>`;
  if (all.length === 0) {
    container.innerHTML = header + `<div class="empty-state"><div class="empty-state-text" style="font-size:12px">Sin tareas para este dia</div></div>`;
    return;
  }
  let html = header;
  all.forEach(t => {
    const isPersonal = !t.projectName;
    const color = isPersonal ? '#BB8FCE' : (t.projectColor || '#666');
    const calChip = isPersonal
      ? `<span class="task-assignee" style="background:rgba(187,143,206,0.22);color:#BB8FCE">Personal</span>`
      : assigneeChips(t);
    html += `<div class="task-item" style="border-left-color:${color};margin:4px 12px">
      <div style="flex:1">
        <div class="task-text">${esc(t.text)}</div>
        <div class="task-meta">
          ${calChip}
          <span class="task-tag">${isPersonal ? 'Personal' : esc(t.projectName)}</span>
          ${t.link ? `<span class="task-tag" style="background:rgba(153,102,255,0.2);color:#b794ff;cursor:pointer" onclick="window.api.openExternal('${esc(t.link)}')">🔗 Link</span>` : ''}
        </div>
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

function selectCalendarDay(key) {
  calSelectedDate = key;
  renderCalendar();
}
window.selectCalendarDay = selectCalendarDay;

document.getElementById('calPrev').addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
  renderCalendar();
});
document.getElementById('calToday').addEventListener('click', () => {
  calCursor = new Date();
  calSelectedDate = new Date().toDateString();
  renderCalendar();
});

// ===== TABS VIEW MODE =====
async function loadTabsMode() {
  const multirow = await window.api.getTabsMultirow();
  applyTabsMode(multirow);
}

function applyTabsMode(multirow) {
  const navTabs = document.querySelector('.nav-tabs');
  if (!navTabs) return;
  if (multirow) navTabs.classList.add('multirow');
  else navTabs.classList.remove('multirow');
}

const tabModeBtn = document.getElementById('tabModeBtn');
if (tabModeBtn) {
  tabModeBtn.addEventListener('click', async () => {
    const navTabs = document.querySelector('.nav-tabs');
    const willBe = !navTabs.classList.contains('multirow');
    applyTabsMode(willBe);
    await window.api.setTabsMultirow(willBe);
  });
}

// ===== DEADLINE COUNTDOWN HELPERS =====
function formatTimeRemaining(ms) {
  if (ms < 0) {
    const totalMin = Math.floor(-ms / 60000);
    const d = Math.floor(totalMin / (60 * 24));
    const h = Math.floor((totalMin % (60 * 24)) / 60);
    if (d > 0) return `Vencida hace ${d}d ${h}h`;
    if (h > 0) return `Vencida hace ${h}h`;
    return 'Vencida';
  }
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return '<1m restante';
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h restantes`;
  if (h > 0) return `${h}h ${m}m restantes`;
  return `${m}m restantes`;
}

function deadlineClass(ms) {
  if (ms < 0) return 'deadline-overdue';
  if (ms < 24 * 60 * 60 * 1000) return 'deadline-soon';
  return 'deadline-ok';
}

function deadlineBadgeHtml(deadlineDate) {
  const ts = deadlineDate.getTime();
  const ms = ts - Date.now();
  return `<span class="task-deadline ${deadlineClass(ms)}" data-deadline="${ts}">${formatTimeRemaining(ms)}</span>`;
}

function updateCountdowns() {
  document.querySelectorAll('.task-deadline[data-deadline]').forEach(span => {
    const ts = parseInt(span.dataset.deadline);
    if (!ts) return;
    const ms = ts - Date.now();
    span.textContent = formatTimeRemaining(ms);
    span.classList.remove('deadline-ok', 'deadline-soon', 'deadline-overdue');
    span.classList.add(deadlineClass(ms));
  });
}

setInterval(updateCountdowns, 60 * 1000);

function renderAll() {
  const pending = tasks.filter(t => t.status === 'pending');
  const pendingApproval = tasks.filter(t => t.status === 'pending_approval');
  // Multi-tareas listas para programar (todos los miembros completaron) van
  // tambien a "Por Aprobar" para que alguien decida la accion final.
  const multiReady = tasks.filter(t => t.status === 'multi-ready');
  const approvalCombined = [...pendingApproval, ...multiReady];
  const completed = tasks.filter(t => t.status === 'completed');
  const myTasks = pending.filter(t => t.assignedTo === currentUser.uid);
  const myPendingApproval = pendingApproval.filter(t => t.assignedTo === currentUser.uid);
  // Multi-tareas tambien aparecen en Mis Tareas si el user es uno de los asignados
  const myMultiReady = multiReady.filter(t => Array.isArray(t.assignedToMulti) && t.assignedToMulti.includes(currentUser.uid));

  el.mainBadge.textContent = pending.length;
  el.myBadge.textContent = myTasks.length + myPendingApproval.length + myMultiReady.length;
  el.approvalBadge.textContent = approvalCombined.length;

  renderTaskList(el.taskList, pending, 'pending');
  renderTaskList(el.myTaskList, [...myTasks, ...myPendingApproval, ...myMultiReady], 'my-tasks');
  renderTaskList(el.approvalList, approvalCombined, 'approval');
  renderCompletedList(completed.slice(0, 100));
  if (currentTab === 'calendar') renderCalendar();
}

function renderPersonalList() {
  const pending = personalTasks.filter(t => t.status !== 'completed');
  const totalCount = pending.length;
  if (el.personalBadge) el.personalBadge.textContent = totalCount;
  if (currentTab === 'calendar') renderCalendar();

  // Refresca chips con contadores
  renderPersonalChips();

  if (!el.personalList) return;

  const visible = personalTasks.filter(t => personalProjectOf(t) === currentPersonalProject);
  const visiblePending = visible.filter(t => t.status !== 'completed').length;
  if (el.personalCount) el.personalCount.textContent = visiblePending;
  if (el.personalHeaderName) {
    el.personalHeaderName.textContent = currentPersonalProject === 'General'
      ? 'Tareas personales - General'
      : `Proyecto personal: ${currentPersonalProject}`;
  }

  if (visible.length === 0) {
    el.personalList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128246;</div>
        <div class="empty-state-text">No hay tareas en "${esc(currentPersonalProject)}"</div>
        <div class="empty-state-sub">Crea una desde la pestana Nueva (modo personal) o el agente.</div>
      </div>`;
    return;
  }

  const sorted = [...visible].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (b.status === 'completed' && a.status !== 'completed') return -1;
    const at = a.createdAt?.seconds || 0;
    const bt = b.createdAt?.seconds || 0;
    return bt - at;
  });

  let html = '';
  sorted.forEach(task => {
    const completed = task.status === 'completed';
    const color = '#BB8FCE';
    const time = task.createdAt ? formatDate(task.createdAt) : '';
    let deadlineBadge = '';
    if (task.deadline && !completed) {
      const deadlineDate = task.deadline.toDate ? task.deadline.toDate() : new Date(task.deadline);
      deadlineBadge = deadlineBadgeHtml(deadlineDate);
    }

    const checkClass = completed ? 'task-check checked' : 'task-check';
    const onClick = completed ? '' : `onclick="completePersonalTask('${task.id}')"`;
    let linkBadge = '';
    if (task.link) {
      linkBadge = `<span class="task-tag" style="background:rgba(153,102,255,0.2);color:#b794ff;cursor:pointer" onclick="openTaskLink('personalTasks','${task.id}')" title="${esc(task.link)}">🔗 Abrir material</span>`;
    }
    let videoBadge = '';
    const recVidsP = Array.isArray(task.recordedVideos) ? task.recordedVideos : [];
    const lastRecordedUrlP = recVidsP.length > 0 ? recVidsP[recVidsP.length - 1].url : '';
    if (lastRecordedUrlP) {
      const lbl = recVidsP.length > 1 ? `🎬 Grabación (${recVidsP.length})` : '🎬 Grabación';
      videoBadge += `<span class="task-tag" style="background:rgba(255,128,64,0.22);color:#ff9866;border:1px solid rgba(255,128,64,0.45);cursor:pointer;font-weight:600" onclick="window.api.openExternal('${esc(lastRecordedUrlP)}')" title="Abrir video grabado desde el celular">${lbl}</span>`;
    }
    // v3.11.54: prefer task.videoLink; fallback a entry.links si videoLink == grabación
    let referenceUrlP = '';
    if (task.videoLink && task.videoLink !== lastRecordedUrlP) {
      referenceUrlP = task.videoLink;
    } else if (lastRecordedUrlP && task.depositEntryId && Array.isArray(depositEntries)) {
      const entry = depositEntries.find(e => e.id === task.depositEntryId);
      if (entry && Array.isArray(entry.links)) {
        const ref = entry.links.find(l => l && (l.type === 'video' || l.type === 'carrusel') && l.url && l.url !== lastRecordedUrlP);
        if (ref) referenceUrlP = ref.url;
      }
    }
    if (referenceUrlP) {
      videoBadge += `<span class="task-tag" style="background:rgba(255,90,90,0.2);color:#ff8a8a;cursor:pointer" onclick="window.api.openExternal('${esc(referenceUrlP)}')" title="${esc(referenceUrlP)}">🎬 Video de referencia</span>`;
    }
    const linkBtn = task.link
      ? `<button class="btn-add-note" onclick="showLinkModal('personalTasks','${task.id}')" title="Editar link">✏️ Link</button>`
      : `<button class="btn-add-note" onclick="showLinkModal('personalTasks','${task.id}')">🔗 + Link</button>`;
    const videoBtn = task.videoLink
      ? `<button class="btn-add-note" onclick="showVideoModal('personalTasks','${task.id}')" title="Editar video">✏️ Video</button>`
      : `<button class="btn-add-note" onclick="showVideoModal('personalTasks','${task.id}')">🎬 + Video</button>`;
    const editBtn = !completed
      ? `<button class="task-delete" onclick="editPersonalTask('${task.id}')" title="Editar" style="color:var(--accent)">&#9998;</button>`
      : '';
    html += `
      <div class="task-item ${completed ? 'completed' : ''}" style="border-left-color:${color}">
        <div class="${checkClass}" ${onClick} title="${completed ? 'Completada' : 'Marcar como terminada'}"></div>
        <div style="flex:1">
          <div class="task-text">${esc(task.text)}</div>
          <div class="task-meta">
            ${deadlineBadge}
            ${linkBadge}
            ${videoBadge}
            <span class="task-tag">${time}</span>
            ${linkBtn}
            ${videoBtn}
          </div>
        </div>
        ${editBtn}
        <button class="task-delete" onclick="deletePersonalTask('${task.id}')" title="Eliminar">&#10005;</button>
      </div>`;
  });
  el.personalList.innerHTML = html;
}

async function addPersonalTask() {
  const text = el.taskInput.value.trim();
  if (!text) { el.taskInput.focus(); return; }
  const amount = parseInt(el.durationInput.value);
  const unit = el.durationUnit.value || 'days';

  const selectedProject = (el.personalProjectSelect && el.personalProjectSelect.value) || currentPersonalProject || 'General';

  const data = {
    text,
    ownerId: currentUser.uid,
    ownerName: currentUserData.name,
    status: 'pending',
    personalProject: selectedProject,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (amount && amount > 0) {
    const deadline = new Date();
    if (unit === 'minutes') deadline.setMinutes(deadline.getMinutes() + amount);
    else if (unit === 'hours') deadline.setHours(deadline.getHours() + amount);
    else deadline.setDate(deadline.getDate() + amount);
    data.deadline = firebase.firestore.Timestamp.fromDate(deadline);
    data.deadlineUnit = unit;
    data.deadlineAmount = amount;
  }
  await db.collection('personalTasks').add(data);
  el.taskInput.value = '';
  el.durationInput.value = '';

  // Si se creo en un proyecto distinto al chip activo, cambiar al chip nuevo
  if (selectedProject !== currentPersonalProject) {
    currentPersonalProject = selectedProject;
    renderPersonalChips();
    renderPersonalList();
  }
}

async function completePersonalTask(taskId) {
  await db.collection('personalTasks').doc(taskId).update({
    status: 'completed',
    completedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function deletePersonalTask(taskId) {
  const task = personalTasks.find(t => t.id === taskId);
  if (!task) return;
  if (!confirm(`Estas seguro que quieres eliminar esta tarea personal?\n\n"${task.text}"\n\nSe enviara a la Papelera. Podras restaurarla desde alli.`)) return;
  await db.collection('personalTasks').doc(taskId).update({
    deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
    deletedBy: currentUser.uid,
    deletedByName: currentUserData.name
  });
}

async function restorePersonalTask(taskId) {
  await db.collection('personalTasks').doc(taskId).update({
    deletedAt: firebase.firestore.FieldValue.delete(),
    deletedBy: firebase.firestore.FieldValue.delete(),
    deletedByName: firebase.firestore.FieldValue.delete()
  });
}
window.restorePersonalTask = restorePersonalTask;

async function permanentlyDeletePersonalTask(taskId) {
  const task = trashPersonalTasks.find(t => t.id === taskId);
  if (!task) return;
  if (!confirm(`Eliminar PERMANENTEMENTE esta tarea personal?\n\n"${task.text}"\n\nEsta accion no se puede deshacer.`)) return;
  await db.collection('personalTasks').doc(taskId).delete();
}
window.permanentlyDeletePersonalTask = permanentlyDeletePersonalTask;

window.completePersonalTask = completePersonalTask;
window.deletePersonalTask = deletePersonalTask;

// ===== PAPELERA =====
function renderTrashList() {
  if (!el.trashList) return;
  // Solo el creador (o admin) ve sus tareas eliminadas en la papelera
  const isAdmin = currentUserData && currentUserData.role === 'admin';
  const myTrashTeam = trashTasks.filter(t => isAdmin || t.createdBy === currentUser.uid || t.deletedBy === currentUser.uid);
  const myTrashPersonal = trashPersonalTasks; // Las personales ya estan filtradas por ownerId
  const total = myTrashTeam.length + myTrashPersonal.length;

  // Badge en tab (oculto) + badge en boton de Settings (visible)
  const setBadge = (elBadge) => {
    if (!elBadge) return;
    if (total > 0) {
      elBadge.textContent = total > 99 ? '99+' : String(total);
      elBadge.style.display = 'inline-block';
    } else {
      elBadge.style.display = 'none';
    }
  };
  setBadge(el.trashBadge);
  setBadge(document.getElementById('settingsTrashBadge'));

  if (total === 0) {
    el.trashList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128465;</div>
        <div class="empty-state-text">Papelera vacia</div>
        <div class="empty-state-sub">Las tareas eliminadas apareceran aqui y podras restaurarlas</div>
      </div>`;
    return;
  }

  // Combinar y ordenar por fecha de eliminacion (mas recientes primero)
  const combined = [
    ...myTrashTeam.map(t => ({ ...t, _kind: 'team' })),
    ...myTrashPersonal.map(t => ({ ...t, _kind: 'personal' }))
  ].sort((a, b) => {
    const at = a.deletedAt?.seconds || 0;
    const bt = b.deletedAt?.seconds || 0;
    return bt - at;
  });

  let html = '';
  combined.forEach(t => {
    const isPersonal = t._kind === 'personal';
    const color = isPersonal ? '#BB8FCE' : (t.projectColor || '#666');
    const badge = isPersonal
      ? '<span class="task-tag" style="background:rgba(187,143,206,0.2);color:#BB8FCE">Personal</span>'
      : `<span class="task-tag">${esc(t.projectName || 'Sin proyecto')}</span>`;
    const deletedByName = t.deletedByName || 'alguien';
    const deletedTime = t.deletedAt ? timeAgo(t.deletedAt) : '';
    const restoreFn = isPersonal ? 'restorePersonalTask' : 'restoreTask';
    const permFn = isPersonal ? 'permanentlyDeletePersonalTask' : 'permanentlyDeleteTask';
    const moveFn = isPersonal ? 'openMoveTrashModalPersonal' : 'openMoveTrashModalTeam';
    // Thumbnail derecho: usa coverImage si existe, sino link/videoLink (puede ser imagen)
    const thumbUrl = t.coverImage || '';
    const thumbHtml = thumbUrl
      ? `<div class="trash-thumb" style="background-image:url('${esc(thumbUrl)}')"></div>`
      : `<div class="trash-thumb trash-thumb-empty">${isPersonal ? '&#128246;' : '&#128203;'}</div>`;
    html += `
      <div class="task-item trash-item" style="border-left-color:${color};opacity:0.92;display:flex;gap:10px;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div class="task-text">${esc(t.text)}</div>
          <div class="task-meta">
            ${badge}
            <span class="task-tag" style="background:rgba(255,107,107,0.15);color:var(--danger)">Eliminada por ${esc(deletedByName)} &middot; ${deletedTime}</span>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-small" onclick="${moveFn}('${t.id}')" style="color:var(--accent);border-color:var(--accent)">&#128194; Mover a...</button>
            <button class="btn btn-ghost btn-small" onclick="${restoreFn}('${t.id}')" style="color:var(--success);border-color:var(--success)">&#8635; Restaurar</button>
            <button class="btn btn-ghost btn-small" onclick="${permFn}('${t.id}')" style="color:var(--danger);border-color:var(--danger)">&#10005; Eliminar</button>
          </div>
        </div>
        ${thumbHtml}
      </div>`;
  });
  el.trashList.innerHTML = html;
}

async function emptyTrash() {
  const isAdmin = currentUserData && currentUserData.role === 'admin';
  const myTrashTeam = trashTasks.filter(t => isAdmin || t.createdBy === currentUser.uid || t.deletedBy === currentUser.uid);
  const myTrashPersonal = trashPersonalTasks;
  const total = myTrashTeam.length + myTrashPersonal.length;
  if (total === 0) return;
  if (!confirm(`Vaciar la papelera? Se eliminaran PERMANENTEMENTE ${total} tarea(s). Esto no se puede deshacer.`)) return;
  const batch = db.batch();
  myTrashTeam.forEach(t => batch.delete(db.collection('tasks').doc(t.id)));
  myTrashPersonal.forEach(t => batch.delete(db.collection('personalTasks').doc(t.id)));
  await batch.commit();
}

if (el.emptyTrashBtn) el.emptyTrashBtn.addEventListener('click', emptyTrash);

// ===== PERSONAL PROJECTS =====
function allPersonalProjects() {
  return ['General', ...personalProjectsList];
}

function personalProjectOf(task) {
  return task.personalProject || 'General';
}

function renderPersonalChips() {
  if (!el.personalProjectsChips) return;
  const all = allPersonalProjects();
  if (!all.includes(currentPersonalProject)) currentPersonalProject = 'General';
  let html = '';
  all.forEach(name => {
    const count = personalTasks.filter(t => personalProjectOf(t) === name && t.status !== 'completed').length;
    const active = name === currentPersonalProject ? ' active' : '';
    const removeBtn = name !== 'General'
      ? `<button class="chip-remove" title="Quitar proyecto" onclick="event.stopPropagation(); deletePersonalProject('${esc(name)}')">&#10005;</button>`
      : '';
    html += `<div class="personal-chip${active}" onclick="switchPersonalProject('${esc(name)}')">${esc(name)}${count > 0 ? ` <span style="opacity:0.7">(${count})</span>` : ''}${removeBtn}</div>`;
  });
  html += `<div class="personal-chip add" onclick="showPersonalProjectModal()" title="Nuevo proyecto personal">+ Nuevo</div>`;
  el.personalProjectsChips.innerHTML = html;
}

function renderPersonalProjectSelect() {
  if (!el.personalProjectSelect) return;
  const all = allPersonalProjects();
  el.personalProjectSelect.innerHTML = all.map(n => `<option value="${esc(n)}"${n === currentPersonalProject ? ' selected' : ''}>${esc(n)}</option>`).join('');
}

function switchPersonalProject(name) {
  currentPersonalProject = name;
  renderPersonalChips();
  renderPersonalProjectSelect();
  renderPersonalList();
}
window.switchPersonalProject = switchPersonalProject;

function showPersonalProjectModal() {
  if (!el.personalProjectModal) return;
  el.personalProjectNameInput.value = '';
  el.personalProjectModal.classList.add('active');
  setTimeout(() => el.personalProjectNameInput.focus(), 100);
}
window.showPersonalProjectModal = showPersonalProjectModal;

function hidePersonalProjectModal() {
  if (el.personalProjectModal) el.personalProjectModal.classList.remove('active');
}

async function addPersonalProject(name) {
  name = (name || '').trim();
  if (!name) return;
  if (name.toLowerCase() === 'general') return;
  if (personalProjectsList.includes(name)) { currentPersonalProject = name; renderPersonalChips(); renderPersonalProjectSelect(); renderPersonalList(); return; }
  personalProjectsList.push(name);
  currentPersonalProject = name;
  await db.collection('users').doc(currentUser.uid).update({
    personalProjects: personalProjectsList
  });
  renderPersonalChips();
  renderPersonalProjectSelect();
  renderPersonalList();
}

async function deletePersonalProject(name) {
  if (name === 'General') return;
  const count = personalTasks.filter(t => personalProjectOf(t) === name).length;
  const msg = count > 0
    ? `Quitar el proyecto "${name}"? Las ${count} tarea(s) que tiene pasaran a "General".`
    : `Quitar el proyecto "${name}"?`;
  if (!confirm(msg)) return;
  personalProjectsList = personalProjectsList.filter(p => p !== name);
  if (currentPersonalProject === name) currentPersonalProject = 'General';
  await db.collection('users').doc(currentUser.uid).update({
    personalProjects: personalProjectsList
  });
  if (count > 0) {
    const batch = db.batch();
    personalTasks.filter(t => personalProjectOf(t) === name).forEach(t => {
      batch.update(db.collection('personalTasks').doc(t.id), { personalProject: 'General' });
    });
    await batch.commit();
  }
  renderPersonalChips();
  renderPersonalProjectSelect();
  renderPersonalList();
}
window.deletePersonalProject = deletePersonalProject;

// ===== TASK LINK =====
const linkModal = document.getElementById('linkModal');
const linkInput = document.getElementById('linkInput');
let linkEditing = null; // { collection, taskId }

function openTaskLink(collection, taskId) {
  const t = (collection === 'personalTasks' ? personalTasks : tasks).find(x => x.id === taskId);
  if (t && t.link) window.api.openExternal(t.link);
}
window.openTaskLink = openTaskLink;

function showLinkModal(collection, taskId) {
  const doc = (collection === 'personalTasks' ? personalTasks : tasks).find(t => t.id === taskId);
  linkEditing = { collection, taskId };
  linkInput.value = doc?.link || '';
  document.getElementById('removeLink').style.display = doc?.link ? 'inline-block' : 'none';
  linkModal.classList.add('active');
  setTimeout(() => linkInput.focus(), 100);
}
window.showLinkModal = showLinkModal;

document.getElementById('cancelLink').addEventListener('click', () => {
  linkModal.classList.remove('active');
  linkEditing = null;
});
linkModal.addEventListener('click', (e) => {
  if (e.target === linkModal) { linkModal.classList.remove('active'); linkEditing = null; }
});
linkInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmLink').click();
});
document.getElementById('confirmLink').addEventListener('click', async () => {
  if (!linkEditing) return;
  let url = linkInput.value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!url) return;
  await db.collection(linkEditing.collection).doc(linkEditing.taskId).update({ link: url });
  linkModal.classList.remove('active');
  linkEditing = null;
});
document.getElementById('removeLink').addEventListener('click', async () => {
  if (!linkEditing) return;
  await db.collection(linkEditing.collection).doc(linkEditing.taskId).update({
    link: firebase.firestore.FieldValue.delete()
  });
  linkModal.classList.remove('active');
  linkEditing = null;
});

// ===== VIDEO DE REFERENCIA =====
const videoModal = document.getElementById('videoModal');
const videoInput = document.getElementById('videoInput');
let videoEditing = null; // { collection, taskId }

function openTaskVideo(collection, taskId) {
  const t = (collection === 'personalTasks' ? personalTasks : tasks).find(x => x.id === taskId);
  if (t && t.videoLink) window.api.openExternal(t.videoLink);
}
window.openTaskVideo = openTaskVideo;

function showVideoModal(collection, taskId) {
  const doc = (collection === 'personalTasks' ? personalTasks : tasks).find(t => t.id === taskId);
  videoEditing = { collection, taskId };
  videoInput.value = doc?.videoLink || '';
  document.getElementById('removeVideo').style.display = doc?.videoLink ? 'inline-block' : 'none';
  videoModal.classList.add('active');
  setTimeout(() => videoInput.focus(), 100);
}
window.showVideoModal = showVideoModal;

document.getElementById('cancelVideo').addEventListener('click', () => {
  videoModal.classList.remove('active');
  videoEditing = null;
});
videoModal.addEventListener('click', (e) => {
  if (e.target === videoModal) { videoModal.classList.remove('active'); videoEditing = null; }
});
videoInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmVideo').click();
});
document.getElementById('confirmVideo').addEventListener('click', async () => {
  if (!videoEditing) return;
  let url = videoInput.value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!url) return;
  await db.collection(videoEditing.collection).doc(videoEditing.taskId).update({ videoLink: url });
  videoModal.classList.remove('active');
  videoEditing = null;
});
document.getElementById('removeVideo').addEventListener('click', async () => {
  if (!videoEditing) return;
  await db.collection(videoEditing.collection).doc(videoEditing.taskId).update({
    videoLink: firebase.firestore.FieldValue.delete()
  });
  videoModal.classList.remove('active');
  videoEditing = null;
});

function getUserColor(userId) {
  const idx = teamMembers.findIndex(m => m.id === userId);
  return userColors[idx >= 0 ? idx % userColors.length : 0];
}

// Rastrea el ultimo proyecto de equipo con el que el usuario interactuo
// para que el agente IA pueda crear tareas alli sin que el usuario lo repita.
function trackInteractedProject(projectId, projectName) {
  if (!projectId) return;
  lastInteractedProject = { id: projectId, name: projectName || '' };
}

function setupProjectInteractionTracking() {
  const containers = [el.taskList, el.myTaskList, el.approvalList, el.completedList];
  containers.forEach(c => {
    if (!c || c._trackedProjectClicks) return;
    c._trackedProjectClicks = true;
    c.addEventListener('click', (e) => {
      const node = e.target.closest('[data-project-id]');
      if (!node) return;
      const id = node.dataset.projectId;
      const name = node.dataset.projectName;
      if (id) trackInteractedProject(id, name);
    }, true);
  });

  if (el.projectSelect && !el.projectSelect._trackedChange) {
    el.projectSelect._trackedChange = true;
    el.projectSelect.addEventListener('change', () => {
      const id = el.projectSelect.value;
      if (!id) return;
      const p = projects.find(x => x.id === id);
      trackInteractedProject(id, p ? p.name : '');
    });
  }
}

function hexToRgba(hex, alpha) {
  const h = (hex || '#666').replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function userChip(userId, name) {
  const c = getUserColor(userId);
  return `<span class="task-assignee" style="background:${hexToRgba(c, 0.32)};color:${c};border:1px solid ${hexToRgba(c, 0.5)}">${esc(name)}</span>`;
}

function assigneeChips(task) {
  const creatorId = task.createdBy;
  const creatorName = task.createdByName;
  const assigneeId = task.assignedTo;
  const assigneeName = task.assignedToName || 'Sin asignar';
  // Multi-tarea: mostrar todos los asignados con su estado de completion
  if (task.assignmentType === 'multi' && Array.isArray(task.assignedToMulti)) {
    const completions = task.multiCompletions || {};
    const roles = task.multiRoles || {};
    const chips = task.assignedToMulti.map((id, i) => {
      const name = (task.assignedToMultiNames && task.assignedToMultiNames[i]) || 'Miembro';
      const done = !!completions[id];
      const c = getUserColor(id);
      const roleTxt = roles[id] ? ` <span style="opacity:0.7">(${esc(roles[id])})</span>` : '';
      const checkIcon = done ? '✓ ' : '⏳ ';
      const opacity = done ? 1 : 0.6;
      return `<span class="task-assignee" style="background:${hexToRgba(c, 0.32)};color:${c};border:1px solid ${hexToRgba(c, 0.5)};opacity:${opacity}">${checkIcon}${esc(name)}${roleTxt}</span>`;
    }).join(' ');
    const creatorChip = creatorName ? `${userChip(creatorId, creatorName)}<span style="opacity:0.55;margin:0 2px;font-size:11px">→</span>` : '';
    return `${creatorChip}<span style="display:inline-flex;flex-wrap:wrap;gap:4px">${chips}</span>`;
  }
  if (!creatorName || creatorId === assigneeId) {
    return userChip(assigneeId, assigneeName);
  }
  return `${userChip(creatorId, creatorName)}<span style="opacity:0.55;margin:0 2px;font-size:11px">→</span>${userChip(assigneeId, assigneeName)}`;
}

// ===== Contador de antiguedad por tarea =====
// Cuenta minutos desde que la tarea se asigno (assignedAt) o se creo (createdAt
// como fallback para tareas viejas). El reset (admin only) escribe assignedAt
// con serverTimestamp para arrancar el conteo desde cero.
const AGE_CRITICAL_MIN = 48 * 60; // 48 horas → rojo critico

function getTaskAgeStartMs(task) {
  const t = task.assignedAt || task.createdAt;
  if (!t) return null;
  try { return t.toDate ? t.toDate().getTime() : new Date(t).getTime(); }
  catch (e) { return null; }
}
function ageMinutesFromMs(startMs) {
  if (!startMs) return 0;
  return Math.max(0, Math.floor((Date.now() - startMs) / 60000));
}
function formatAge(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
// Color HSL interpolado de pale red → critical red. Saturacion sube con el
// tiempo para que las tareas viejas se "destaquen" visualmente.
function ageStripColor(mins) {
  const t = Math.min(mins / AGE_CRITICAL_MIN, 1);
  const L = 88 - t * 38;
  const S = 50 + t * 35;
  return `hsl(0, ${S}%, ${L}%)`;
}
function ageBadgeColors(mins) {
  const t = Math.min(mins / AGE_CRITICAL_MIN, 1);
  const bgL = 92 - t * 35;
  const bgS = 45 + t * 40;
  const fgL = t > 0.5 ? 100 : 30; // texto blanco cuando el bg ya es oscuro
  return {
    bg: `hsl(0, ${bgS}%, ${bgL}%)`,
    fg: `hsl(0, 30%, ${fgL}%)`,
    border: `hsl(0, ${bgS + 10}%, ${Math.max(bgL - 15, 30)}%)`
  };
}

// Update in-place: re-pinta strip + badge de cada tarea visible cada 60s
// para que el contador tique sin re-renderizar la lista entera.
function refreshAgeBadges() {
  document.querySelectorAll('.task-item[data-age-start]').forEach(el => {
    const start = parseInt(el.dataset.ageStart);
    if (!start) return;
    const mins = ageMinutesFromMs(start);
    const strip = el.querySelector('.task-age-strip');
    if (strip) {
      strip.style.backgroundColor = ageStripColor(mins);
      strip.classList.toggle('critical', mins >= AGE_CRITICAL_MIN);
    }
    const badge = el.querySelector('.task-age-badge');
    if (badge) {
      const c = ageBadgeColors(mins);
      badge.textContent = `⏱ ${formatAge(mins)}`;
      badge.style.background = c.bg;
      badge.style.color = c.fg;
      badge.style.border = `1px solid ${c.border}`;
    }
  });
}
setInterval(refreshAgeBadges, 60000);

window.resetTaskTimer = async function(taskId) {
  const isAdmin = currentUserData && currentUserData.role === 'admin';
  if (!isAdmin) return;
  if (!confirm('Resetear el contador de antigüedad de esta tarea?\nEl tiempo arrancara desde cero.')) return;
  try {
    await db.collection('tasks').doc(taskId).update({
      assignedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    alert('No se pudo resetear: ' + e.message);
  }
};

function renderTaskList(container, taskList, mode) {
  if (taskList.length === 0) {
    const emptyMessages = {
      'pending': { icon: '&#128221;', text: 'No hay tareas pendientes', sub: 'Agrega una tarea o esperala desde Telegram' },
      'my-tasks': { icon: '&#128100;', text: 'No tienes tareas asignadas', sub: '' },
      'approval': { icon: '&#128270;', text: 'No hay tareas por aprobar', sub: 'Cuando alguien complete una tarea aparecera aqui' }
    };
    const msg = emptyMessages[mode] || emptyMessages['pending'];
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${msg.icon}</div>
        <div class="empty-state-text">${msg.text}</div>
        <div class="empty-state-sub">${msg.sub}</div>
      </div>`;
    return;
  }

  // Group by project
  const grouped = {};
  taskList.forEach(task => {
    const key = task.projectId || 'sin-proyecto';
    if (!grouped[key]) {
      grouped[key] = { name: task.projectName || 'Sin Proyecto', color: task.projectColor || '#666', tasks: [] };
    }
    grouped[key].tasks.push(task);
  });

  const isAdmin = currentUserData && currentUserData.role === 'admin';
  let html = '';

  for (const [projectKey, group] of Object.entries(grouped)) {
    const projectIdAttr = projectKey === 'sin-proyecto' ? '' : projectKey;
    html += `<div class="project-section">
      <div class="project-header" data-project-id="${projectIdAttr}" data-project-name="${esc(group.name)}" style="cursor:pointer" title="Click para que el agente IA use este proyecto por defecto">
        <span class="project-dot" style="background:${group.color}"></span>
        <span class="project-name">${esc(group.name)}</span>
        <span class="project-count">${group.tasks.length}</span>
      </div>`;

    group.tasks.forEach(task => {
      try { // wrap entire task render so una tarea rota no oculta las demas
      const assignee = task.assignedToName || 'Sin asignar';
      const source = task.source === 'telegram' ? 'Telegram' : 'App';
      const time = timeAgo(task.createdAt);
      const isPendingApproval = task.status === 'pending_approval';

      let statusBadge = '';
      if (isPendingApproval) {
        statusBadge = '<span class="status-pending-approval">Esperando aprobacion</span>';
      }

      // Deadline badge
      let deadlineBadge = '';
      let overdueClass = '';
      if (task.deadline) {
        const deadlineDate = task.deadline.toDate ? task.deadline.toDate() : new Date(task.deadline);
        deadlineBadge = deadlineBadgeHtml(deadlineDate);
        if (deadlineDate.getTime() - Date.now() < 0) overdueClass = 'overdue';
      }

      // Approval buttons (only admin in approval tab, or creator)
      let actionButtons = '';
      if (isPendingApproval && mode === 'approval') {
        if (isAdmin || task.createdBy === currentUser.uid) {
          actionButtons = `
            <div class="approval-buttons">
              <button class="btn-approve" onclick="approveTask('${task.id}')">Aprobar</button>
              <button class="btn-reject" onclick="rejectTask('${task.id}')">Rechazar</button>
            </div>`;
        }
      }

      // Check button: solo asignado/creador/admin pueden marcar terminada
      let checkBtn = '';
      if (isPendingApproval) {
        checkBtn = '<div class="task-check" style="border-color:var(--warning);background:rgba(255,217,61,0.15)" title="Esperando aprobacion"></div>';
      } else if (canComplete(task)) {
        checkBtn = `<div class="task-check" onclick="completeTask('${task.id}')" title="Marcar como terminada"></div>`;
      } else {
        checkBtn = `<div class="task-check" style="cursor:not-allowed;opacity:0.5" title="Solo el asignado o el creador puede marcar terminada"></div>`;
      }

      // Edit, retornar (al deposito) y delete buttons (solo creator y admin)
      let taskActions = '';
      // Reset de contador (solo admin, solo en tareas no completadas)
      if (isAdmin && task.status !== 'completed' && !isPendingApproval) {
        taskActions += `<button class="btn-timer-reset" onclick="resetTaskTimer('${task.id}')" title="Resetear contador de antigüedad">&#10227;</button>`;
      }
      if (!isPendingApproval && canEdit(task)) {
        taskActions += `<button class="task-delete" onclick="editTask('${task.id}')" title="Editar" style="color:var(--accent)">&#9998;</button>`;
      }
      if (!isPendingApproval && canDelete(task) && task.status !== 'completed') {
        // Retornar al Deposito de Ideas (re-asignable). Notifica al asignado.
        taskActions += `<button class="task-delete" onclick="returnTaskToDeposit('${task.id}')" title="Retornar al Deposito de Ideas (libera la asignacion)" style="color:#f6c544">&#8617;</button>`;
      }
      if (!isPendingApproval && canDelete(task)) {
        taskActions += `<button class="task-delete" onclick="deleteTask('${task.id}')" title="Eliminar">&#10005;</button>`;
      }

      // Subnotes — pueden ser array (subnotas con autor) o string (descripcion del editar modal).
      // Si es string, lo mostramos como una nota del creador.
      let notesHtml = '';
      const rawNotes = task.notes;
      if (Array.isArray(rawNotes) && rawNotes.length > 0) {
        notesHtml = '<div class="task-notes">';
        rawNotes.forEach(n => {
          notesHtml += `<div class="task-note"><span class="note-author">${esc(n.authorName)}:</span> ${esc(n.text)}</div>`;
        });
        notesHtml += '</div>';
      } else if (typeof rawNotes === 'string' && rawNotes.trim()) {
        notesHtml = `<div class="task-notes"><div class="task-note"><span class="note-author">${esc(task.createdByName || 'Nota')}:</span> ${esc(rawNotes)}</div></div>`;
      }
      // Tambien soportar campo `description` (separado del array notes)
      if (typeof task.description === 'string' && task.description.trim()) {
        notesHtml += `<div class="task-notes"><div class="task-note"><span class="note-author">${esc(task.createdByName || 'Descripcion')}:</span> ${esc(task.description)}</div></div>`;
      }

      // Add note button (assignee, creator, or admin)
      let addNoteBtn = '';
      const canAddMeta = task.assignedTo === currentUser.uid || task.createdBy === currentUser.uid || isAdmin;
      if (canAddMeta) {
        addNoteBtn = `<button class="btn-add-note" onclick="addNote('${task.id}')">+ Nota</button>`;
      }

      // Link badge + edit
      let linkBadge = '';
      if (task.link) {
        linkBadge = `<span class="task-tag" style="background:rgba(153,102,255,0.2);color:#b794ff;cursor:pointer" onclick="openTaskLink('tasks','${task.id}')" title="${esc(task.link)}">🔗 Abrir material</span>`;
      }
      let linkBtn = '';
      if (canAddMeta) {
        linkBtn = task.link
          ? `<button class="btn-add-note" onclick="showLinkModal('tasks','${task.id}')" title="Editar link">✏️ Link</button>`
          : `<button class="btn-add-note" onclick="showLinkModal('tasks','${task.id}')">🔗 + Link</button>`;
      }

      // Video de referencia badge + edit
      let videoBadge = '';
      const recVideos = Array.isArray(task.recordedVideos) ? task.recordedVideos : [];
      const lastRecordedUrl = recVideos.length > 0 ? recVideos[recVideos.length - 1].url : '';
      const recCount = recVideos.length;
      if (lastRecordedUrl) {
        const recLabel = recCount > 1 ? `🎬 Grabación (${recCount})` : '🎬 Grabación';
        videoBadge += `<span class="task-tag" style="background:rgba(255,128,64,0.22);color:#ff9866;border:1px solid rgba(255,128,64,0.45);cursor:pointer;font-weight:600" onclick="window.api.openExternal('${esc(lastRecordedUrl)}')" title="Abrir video grabado desde el celular">${recLabel}</span>`;
      }
      // v3.11.54: resolución del "Video de referencia" — preferimos task.videoLink
      // si difiere de la grabación. Para tareas viejas que tienen videoLink == recording
      // (assign flow anterior), buscamos el link de referencia en la entry original
      // del depósito (deposit entry tiene los links del reel/post de IG).
      let referenceUrl = '';
      if (task.videoLink && task.videoLink !== lastRecordedUrl) {
        referenceUrl = task.videoLink;
      } else if (lastRecordedUrl && task.depositEntryId && Array.isArray(depositEntries)) {
        const entry = depositEntries.find(e => e.id === task.depositEntryId);
        if (entry && Array.isArray(entry.links)) {
          const ref = entry.links.find(l => l && (l.type === 'video' || l.type === 'carrusel') && l.url && l.url !== lastRecordedUrl);
          if (ref) referenceUrl = ref.url;
        }
      }
      if (referenceUrl) {
        videoBadge += `<span class="task-tag" style="background:rgba(255,90,90,0.2);color:#ff8a8a;cursor:pointer" onclick="window.api.openExternal('${esc(referenceUrl)}')" title="${esc(referenceUrl)}">🎬 Video de referencia</span>`;
      }
      let videoBtn = '';
      if (canAddMeta) {
        videoBtn = task.videoLink
          ? `<button class="btn-add-note" onclick="showVideoModal('tasks','${task.id}')" title="Editar video">✏️ Video</button>`
          : `<button class="btn-add-note" onclick="showVideoModal('tasks','${task.id}')">🎬 + Video</button>`;
      }

      let blockedBadge = '';
      if (task.dependsOn) {
        const dep = tasks.find(t => t.id === task.dependsOn);
        if (dep && dep.status !== 'completed') {
          const waitName = dep.assignedToName || 'otro';
          const waitText = dep.text.length > 25 ? dep.text.slice(0, 25) + '...' : dep.text;
          blockedBadge = `<span class="task-deadline deadline-soon" title="Esperando que ${esc(waitName)} termine">🔒 Esperando: ${esc(waitText)}</span>`;
        }
      }

      // Chip del trabajo entregado.
      // Para multi-tareas: un boton por cada miembro que subio entregable,
      // coloreado con su color de usuario para distinguirlos.
      // Para tareas individuales: un solo boton si hay submittedLink.
      let submittedBadge = '';
      if (task.assignmentType === 'multi' && task.multiSubmissions && typeof task.multiSubmissions === 'object') {
        const members = Object.keys(task.multiSubmissions);
        if (members.length > 0) {
          submittedBadge = members.map(memberId => {
            const url = task.multiSubmissions[memberId];
            if (!url) return '';
            const member = teamMembers.find(m => m.id === memberId);
            const memberName = member ? member.name : 'Miembro';
            const c = getUserColor(memberId);
            const role = (task.multiRoles && task.multiRoles[memberId]) || '';
            const roleTxt = role ? ` (${role})` : '';
            return `<span class="task-tag" style="background:${hexToRgba(c, 0.22)};color:${c};border:1px solid ${hexToRgba(c, 0.5)};cursor:pointer;font-weight:600" onclick="window.api.openExternal('${esc(url)}')" title="${esc(memberName)}${esc(roleTxt)} — ${esc(url)}">📎 ${esc(memberName)}${esc(roleTxt)}</span>`;
          }).filter(s => s).join(' ');
        }
      } else if (task.submittedLink) {
        submittedBadge = `<span class="task-tag" style="background:rgba(78,205,196,0.2);color:#4ecdc4;cursor:pointer;font-weight:600" onclick="window.api.openExternal('${esc(task.submittedLink)}')" title="${esc(task.submittedLink)}">📎 Ver entregado</span>`;
      }

      // Boton llamativo "Tarea completada" - asignado, creador o admin pueden marcar
      let markDoneBtn = '';
      if (task.status === 'multi-ready') {
        // Multi-tarea lista: 3 botones de accion final (Programar / Asignar publicador / Borrador)
        markDoneBtn = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;width:100%">
          <button class="btn btn-primary btn-small" onclick="multiTaskSchedule('${task.id}')" title="Abrir modal Programar con la data ya pre-llenada">&#128241; Programar ahora</button>
          <button class="btn btn-ghost btn-small" onclick="multiTaskAssignPublisher('${task.id}')" title="Crear una sub-tarea de tipo Publicador y asignarla a alguien">&#128100; Asignar publicador</button>
          <button class="btn btn-ghost btn-small" onclick="multiTaskSaveDraft('${task.id}')" title="Guardar como borrador en Programacion para retomar despues">&#128190; Borrador</button>
        </div>`;
      } else if (!isPendingApproval && task.status !== 'completed' && canComplete(task)) {
        // Multi-tareas en progreso: boton dice "Marcar mi parte"
        const isMulti = task.assignmentType === 'multi';
        const myDone = isMulti && task.multiCompletions && task.multiCompletions[currentUser.uid];
        let label;
        if (isMulti && !myDone) label = '✓ Marcar mi parte hecha';
        else if (isMulti && myDone) label = '✓ Mi parte ya esta hecha';
        else label = task.submittedLink ? '✏️ Cambiar entregado' : '✓ Tarea completada';
        const disabledAttr = (isMulti && myDone) ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
        markDoneBtn = `<button class="btn-mark-done" onclick="completeTask('${task.id}')" title="${isMulti ? 'Marca solo TU parte' : 'Sube el resultado y manda a aprobacion'}" ${disabledAttr}>${label}</button>`;
      }

      // Preview/portada del link copiado del deposito (se ve en el espacio
      // libre entre el contenido y los botones de accion).
      // Fallback: si la tarea no tiene videoLink/link pero esta vinculada a una
      // entry del deposito (depositEntryId), usar el primer link de la entry.
      // Esto rescata tareas viejas que se crearon con tipo Carrusel cuando la
      // logica de copia de links no contemplaba ese tipo.
      let coverPreview = '';
      let previewUrl = task.videoLink || task.link;
      if (!previewUrl && task.depositEntryId && Array.isArray(depositEntries)) {
        const entry = depositEntries.find(e => e.id === task.depositEntryId);
        if (entry && Array.isArray(entry.links) && entry.links[0]) {
          previewUrl = entry.links[0].url;
        }
      }
      if (task.coverImage && previewUrl) {
        coverPreview = `<div class="task-cover-preview" style="background-image:url('${esc(task.coverImage)}')" onclick="window.api.openExternal('${esc(previewUrl)}')" title="Abrir ${esc(previewUrl)}"></div>`;
      }

      // Strip + badge de antiguedad (solo en tareas no completadas).
      // Se muestra siempre — desde 0min con tono casi-blanco hasta crítico a 48h+.
      let ageStripHtml = '';
      let ageBadgeHtml = '';
      let ageDataAttr = '';
      if (task.status !== 'completed') {
        const startMs = getTaskAgeStartMs(task);
        if (startMs) {
          const mins = ageMinutesFromMs(startMs);
          const stripColor = ageStripColor(mins);
          const isCritical = mins >= AGE_CRITICAL_MIN;
          const c = ageBadgeColors(mins);
          ageStripHtml = `<div class="task-age-strip${isCritical ? ' critical' : ''}" style="background-color:${stripColor}"></div>`;
          ageBadgeHtml = `<span class="task-tag task-age-badge" title="Tiempo desde que se asignó la tarea" style="background:${c.bg};color:${c.fg};border:1px solid ${c.border}">⏱ ${formatAge(mins)}</span>`;
          ageDataAttr = ` data-age-start="${startMs}"`;
        }
      }

      html += `
        <div class="task-item ${overdueClass}" data-id="${task.id}" data-project-id="${task.projectId || ''}" data-project-name="${esc(task.projectName || '')}"${ageDataAttr} style="border-left-color:${group.color}">
          ${ageStripHtml}
          ${checkBtn}
          <div style="flex:1">
            <div class="task-text">${esc(task.text)}</div>
            <div class="task-meta">
              ${assigneeChips(task)}
              ${ageBadgeHtml}
              ${statusBadge}
              ${deadlineBadge}
              ${blockedBadge}
              ${submittedBadge}
              ${linkBadge}
              ${videoBadge}
              <span class="task-tag">${source}</span>
              <span class="task-tag">${time}</span>
              ${addNoteBtn}
              ${linkBtn}
              ${videoBtn}
              ${markDoneBtn}
            </div>
            ${notesHtml}
            ${actionButtons}
          </div>
          ${coverPreview}
          ${taskActions}
        </div>`;
      } catch (e) {
        console.error('[renderTaskList] error rendering task', task && task.id, e);
        html += `<div class="task-item" style="border-left-color:#ff4757;padding:8px"><div style="color:#ff4757;font-size:11px">⚠ Error al renderizar tarea ${esc(task && task.id || 'unknown')} — ${esc(task && task.text || '')}: ${esc(e.message)}</div></div>`;
      }
    });

    html += '</div>';
  }

  container.innerHTML = html;
}

// Completed list grouped by user with colors
function renderCompletedList(completedTasks) {
  if (completedTasks.length === 0) {
    el.completedList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#127881;</div>
        <div class="empty-state-text">No hay tareas completadas aun</div>
      </div>`;
    return;
  }

  // Group by user
  const groupedByUser = {};
  completedTasks.forEach(task => {
    const key = task.assignedTo || 'unknown';
    if (!groupedByUser[key]) {
      groupedByUser[key] = {
        name: task.assignedToName || 'Desconocido',
        color: getUserColor(key),
        tasks: []
      };
    }
    groupedByUser[key].tasks.push(task);
  });

  let html = '';
  for (const [userId, group] of Object.entries(groupedByUser)) {
    html += `<div class="project-section">
      <div class="project-header" style="border-left:3px solid ${group.color}">
        <div class="team-avatar" style="background:${group.color};width:24px;height:24px;font-size:11px;display:flex;align-items:center;justify-content:center;border-radius:50%;color:white;font-weight:700">${group.name.charAt(0).toUpperCase()}</div>
        <span class="project-name">${esc(group.name)}</span>
        <span class="project-count">${group.tasks.length} completadas</span>
      </div>`;

    group.tasks.forEach(task => {
      const time = task.completedAt ? formatDate(task.completedAt) : '';
      const approver = task.approvedByName ? `Aprobada por ${task.approvedByName}` : '';

      html += `
        <div class="task-item completed" style="border-left-color:${group.color}">
          <div class="task-check"></div>
          <div style="flex:1">
            <div class="task-text">${esc(task.text)}</div>
            <div class="task-meta">
              <span class="task-tag">${esc(task.projectName || '')}</span>
              <span class="task-tag">${time}</span>
              ${approver ? `<span class="task-tag">${esc(approver)}</span>` : ''}
            </div>
          </div>
          <button class="btn btn-ghost btn-small" data-schedule-task="${esc(task.id)}" title="Programar en Instagram" style="flex-shrink:0">&#128241; Programar</button>
        </div>`;
    });

    html += '</div>';
  }

  el.completedList.innerHTML = html;
}

function renderProjectSelect() {
  const current = el.projectSelect.value;
  el.projectSelect.innerHTML = '<option value="">Proyecto...</option>';
  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    el.projectSelect.appendChild(opt);
  });
  if (current) el.projectSelect.value = current;
}

// Solo miembros con acceso activo aparecen en selectores y team list. Los
// pending/rejected viven en el panel de aprobaciones (solo admin).
function activeMembers() {
  return teamMembers.filter(m => !m.status || m.status === 'active');
}

function renderAssignSelect() {
  const current = el.assignSelect.value;
  el.assignSelect.innerHTML = '<option value="">Asignar a...</option>';
  activeMembers().forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name + (m.id === currentUser.uid ? ' (yo)' : '');
    el.assignSelect.appendChild(opt);
  });
  if (current) el.assignSelect.value = current;
}


function renderTeam() {
  // Render del panel admin (pending + invites) en cada refresh
  renderPendingRequests();
  renderInviteCodes();

  const visibleMembers = activeMembers();
  if (visibleMembers.length === 0) {
    el.teamList.innerHTML = '<div class="empty-state"><div class="empty-state-text">No hay miembros</div></div>';
    return;
  }

  let html = '';
  visibleMembers.forEach((m, i) => {
    const pending = tasks.filter(t => t.assignedTo === m.id && t.status === 'pending').length;
    const waiting = tasks.filter(t => t.assignedTo === m.id && t.status === 'pending_approval').length;
    const done = tasks.filter(t => t.assignedTo === m.id && t.status === 'completed').length;
    const color = userColors[i % userColors.length];
    const linkedHtml = m.telegramChatId
      ? `<span style="color:#4ecdc4">✓ Telegram vinculado</span> <button class="btn btn-ghost" onclick="testTelegramNotif('${m.telegramChatId}','${esc(m.name)}')" style="font-size:10px;padding:2px 8px;margin-left:4px">Probar</button>`
      : '<span style="color:#ff9090" title="Este miembro no recibira notificaciones hasta vincular. Pidele que envie /vincular ' + esc(m.email) + ' al bot">✗ Sin Telegram</span>';

    const roleLabel = m.role === 'admin' ? 'Admin' : 'Miembro';
    const canChangeRole = currentUserData && currentUserData.role === 'admin' && m.id !== currentUser.uid;
    const roleBtn = canChangeRole
      ? `<button class="btn btn-small btn-ghost" onclick="toggleRole('${m.id}', '${m.role}')" style="font-size:10px">${m.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>`
      : '';

    html += `
      <div class="team-member">
        <div class="team-avatar" style="background:${color}">${m.name.charAt(0).toUpperCase()}</div>
        <div class="team-info">
          <div class="team-name">${esc(m.name)} ${m.id === currentUser.uid ? '(tu)' : ''} <span style="font-size:10px;color:${m.role === 'admin' ? 'var(--success)' : 'var(--text-secondary)'}">[${roleLabel}]</span></div>
          <div class="team-email">${esc(m.email)} · ${linkedHtml}</div>
          <div class="team-tasks">${pending} pendientes - ${waiting} por aprobar - ${done} completadas ${roleBtn}</div>
        </div>
      </div>`;
  });

  el.teamList.innerHTML = html;
}

// ===== Admin: solicitudes pendientes + codigos de invitacion =====
function renderPendingRequests() {
  const section = document.getElementById('adminPendingSection');
  const list = document.getElementById('pendingList');
  const countEl = document.getElementById('pendingCount');
  if (!section || !list) return;
  const isAdmin = currentUserData && currentUserData.role === 'admin';
  if (!isAdmin) { section.style.display = 'none'; return; }
  const pending = teamMembers.filter(m => m.status === 'pending');
  if (countEl) countEl.textContent = pending.length;
  if (pending.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = pending.map(m => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px">
      <div style="flex:1">
        <div style="font-weight:600;font-size:13px">${esc(m.name || '(sin nombre)')}</div>
        <div style="font-size:11px;color:var(--text-secondary)">${esc(m.email || '')}</div>
      </div>
      <button class="btn btn-success btn-small" onclick="approveUser('${m.id}')">✓ Aprobar</button>
      <button class="btn btn-danger btn-small" onclick="rejectUser('${m.id}')">✕ Rechazar</button>
    </div>
  `).join('');
}

window.approveUser = async function(uid) {
  if (!confirm('Aprobar el acceso de este usuario a la app?')) return;
  try {
    await db.collection('users').doc(uid).update({
      status: 'active',
      activatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      activatedBy: currentUser.uid
    });
  } catch (e) { alert('Error: ' + e.message); }
};
window.rejectUser = async function(uid) {
  if (!confirm('Rechazar el acceso de este usuario? No va a poder entrar a la app.')) return;
  try {
    await db.collection('users').doc(uid).update({
      status: 'rejected',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
      rejectedBy: currentUser.uid
    });
  } catch (e) { alert('Error: ' + e.message); }
};

function renderInviteCodes() {
  const section = document.getElementById('adminInvitesSection');
  const list = document.getElementById('invitesList');
  if (!section || !list) return;
  const isAdmin = currentUserData && currentUserData.role === 'admin';
  if (!isAdmin) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  if (inviteCodes.length === 0) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text-dim);text-align:center;padding:8px">No hay códigos generados todavía</div>';
    return;
  }
  // Sort: activos primero, despues usados, despues revocados
  const sorted = inviteCodes.slice().sort((a, b) => {
    const aOrder = a.usedBy ? 2 : (a.revokedAt ? 3 : 1);
    const bOrder = b.usedBy ? 2 : (b.revokedAt ? 3 : 1);
    if (aOrder !== bOrder) return aOrder - bOrder;
    const at = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
    const bt = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
    return bt - at;
  });
  list.innerHTML = sorted.map(c => {
    const isUsed = !!c.usedBy;
    const isRevoked = !!c.revokedAt && !isUsed;
    const isActive = !isUsed && !isRevoked;
    let stateBadge, stateColor;
    if (isUsed) { stateBadge = `Usado por ${esc(c.usedByEmail || '?')}`; stateColor = 'var(--text-dim)'; }
    else if (isRevoked) { stateBadge = 'Revocado'; stateColor = '#ff8a8a'; }
    else { stateBadge = 'Activo'; stateColor = 'var(--success)'; }
    const opacity = isActive ? 1 : 0.55;
    const actionsHtml = isActive
      ? `<button class="btn btn-ghost btn-small" onclick="copyInviteCode('${c.id}')" title="Copiar al portapapeles">📋 Copiar</button>
         <button class="btn btn-danger btn-small" onclick="revokeInviteCode('${c.id}')" title="Revocar">🗑</button>`
      : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(0,0,0,0.15);border-radius:6px;opacity:${opacity}">
        <div style="font-family:monospace;font-weight:700;font-size:14px;letter-spacing:1px;color:var(--accent);min-width:100px">${esc(c.id)}</div>
        <div style="flex:1;font-size:11px;color:${stateColor}">${stateBadge}</div>
        ${actionsHtml}
      </div>`;
  }).join('');
}

window.copyInviteCode = function(code) {
  try {
    navigator.clipboard.writeText(code);
    const btn = event && event.target;
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Copiado';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
  } catch (e) { alert('No se pudo copiar: ' + e.message); }
};

window.revokeInviteCode = async function(code) {
  if (!confirm(`Revocar el codigo ${code}?\nQuien lo tenga ya no va a poder usarlo.`)) return;
  try {
    await db.collection('inviteCodes').doc(code).update({
      revokedAt: firebase.firestore.FieldValue.serverTimestamp(),
      revokedBy: currentUser.uid
    });
  } catch (e) { alert('Error: ' + e.message); }
};

// Genera codigo de 6 chars alfanumericos sin caracteres ambiguos (0,O,I,1,L)
function randomInviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
async function generateNewInviteCode() {
  if (!currentUser) return;
  // Reintentamos hasta 5 veces si por mala suerte el codigo ya existe
  for (let i = 0; i < 5; i++) {
    const code = randomInviteCode();
    try {
      const ref = db.collection('inviteCodes').doc(code);
      const snap = await ref.get();
      if (snap.exists) continue;
      await ref.set({
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentUser.uid,
        createdByName: currentUserData.name,
        usedBy: null,
        revokedAt: null
      });
      // Copiar al portapapeles automaticamente
      try { await navigator.clipboard.writeText(code); } catch (e) {}
      alert(`Código generado: ${code}\n\nYa lo copié al portapapeles. Pasáselo a la persona que querés que entre — sólo se puede usar una vez.`);
      return;
    } catch (e) {
      alert('Error generando código: ' + e.message);
      return;
    }
  }
  alert('No se pudo generar un código único. Intentá otra vez.');
}
// Listener boton generar
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('generateInviteBtn');
  if (btn) btn.addEventListener('click', generateNewInviteCode);
});

function renderProjectList() {
  if (projects.length === 0) {
    el.projectListSettings.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;text-align:center;padding:12px">No hay proyectos</div>';
    return;
  }

  let html = '';
  projects.forEach(p => {
    const taskCount = tasks.filter(t => t.projectId === p.id && t.status !== 'completed').length;
    html += `
      <div class="project-header" style="margin-bottom:6px">
        <span class="project-dot" style="background:${p.color}"></span>
        <span class="project-name">${esc(p.name)}</span>
        <span class="project-count">${taskCount} pendientes</span>
        <button class="project-action-btn" onclick="deleteProject('${p.id}')" title="Eliminar">&#128465;</button>
      </div>`;
  });

  el.projectListSettings.innerHTML = html;
}

// ===== ACTIONS =====
async function addTask() {
  const text = el.taskInput.value.trim();
  const projectId = el.projectSelect.value;
  const assignTo = el.assignSelect.value;
  const amount = parseInt(el.durationInput.value);
  const unit = el.durationUnit.value || 'days';

  if (!text) { el.taskInput.focus(); return; }
  if (!projectId) {
    el.projectSelect.style.borderColor = 'var(--danger)';
    setTimeout(() => el.projectSelect.style.borderColor = '', 1500);
    return;
  }

  const project = projects.find(p => p.id === projectId);
  const assignee = teamMembers.find(m => m.id === assignTo);

  const taskData = {
    text: text,
    projectId: projectId,
    projectName: project ? project.name : 'Sin Proyecto',
    projectColor: project ? project.color : '#666',
    assignedTo: assignTo || currentUser.uid,
    assignedToName: assignee ? assignee.name : currentUserData.name,
    createdBy: currentUser.uid,
    createdByName: currentUserData.name,
    status: 'pending',
    source: 'app',
    notes: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (amount && amount > 0) {
    const deadline = new Date();
    if (unit === 'minutes') deadline.setMinutes(deadline.getMinutes() + amount);
    else if (unit === 'hours') deadline.setHours(deadline.getHours() + amount);
    else deadline.setDate(deadline.getDate() + amount);
    taskData.deadline = firebase.firestore.Timestamp.fromDate(deadline);
    taskData.deadlineUnit = unit;
    taskData.deadlineAmount = amount;
  }

  await db.collection('tasks').add(taskData);

  el.taskInput.value = '';
  el.durationInput.value = '';

  if (assignee && assignTo !== currentUser.uid) {
    const unitLabel = unit === 'minutes' ? 'minuto(s)' : unit === 'hours' ? 'hora(s)' : 'dia(s)';
    const deadlineMsg = amount && amount > 0 ? `\nPlazo: *${amount} ${unitLabel}*` : '';
    notifyAssignedOrWarn(assignee,
      `Nueva tarea asignada por *${currentUserData.name}*:\n${text}\nProyecto: *${project.name}*${deadlineMsg}`
    );
  }
}

// Submit Task: el asignado entrega el trabajo. Abre modal pidiendo link entregado.
let submittingTaskId = null;
async function completeTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!canComplete(task)) {
    alert('Solo el asignado, el creador de la tarea o el admin pueden marcarla como terminada.');
    return;
  }
  // Multi-tarea: cada miembro marca SU parte. Cuando todos completan, sigue
  // el flujo normal (modal de submit link).
  if (task.assignmentType === 'multi') {
    const completions = task.multiCompletions || {};
    const isAssignee = Array.isArray(task.assignedToMulti) && task.assignedToMulti.includes(currentUser.uid);
    if (!isAssignee && currentUserData.role !== 'admin') {
      alert('Solo los miembros asignados a esta multi-tarea pueden marcar partes como hechas.');
      return;
    }
    if (isAssignee && !completions[currentUser.uid]) {
      // Abrir modal de submit (con upload de URL/archivo) en vez de confirm simple
      openMultiSubmitModal(task);
      return;
    }
    // Si todos los demas ya marcaron pero yo no estoy en la lista (admin):
    // permitir transicionar a multi-ready directamente
    const allDone = Array.isArray(task.assignedToMulti)
      && task.assignedToMulti.every(id => completions[id]);
    if (!allDone && currentUserData.role !== 'admin') {
      alert('La tarea queda completa cuando TODOS marquen su parte. Pendientes: ' +
        (task.assignedToMulti || []).filter(id => !completions[id]).map(id => {
          const m = teamMembers.find(x => x.id === id); return m ? m.name : id;
        }).join(', '));
      return;
    }
    // Admin forzando o caso edge: marcar multi-ready
    if (!confirm(`Marcar la multi-tarea como lista para programar?\n\n"${task.text}"\n\nEsto saltara los marcadores individuales pendientes.`)) return;
    await db.collection('tasks').doc(taskId).update({
      status: 'multi-ready',
      multiReadyAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return;
  }
  // Publicador: no requiere aprobacion ni material entregado.
  // Marca directamente como completed y notifica/desbloquea siguientes en cadena.
  if (task.assignmentType === 'publicador') {
    if (!confirm(`Marcar la tarea como publicada y completada?\n\n"${task.text}"\n\nAl ser tipo "Publicador", se cerrara directamente sin pasar por aprobacion.`)) return;
    await finalizeCompletedDirect(task);
    return;
  }
  submittingTaskId = taskId;
  document.getElementById('submitTaskTitle').textContent = task.text;
  document.getElementById('submitTaskLinkInput').value = '';
  const stEl = document.getElementById('submitTaskUploadStatus');
  if (stEl) { stEl.style.display = 'none'; stEl.textContent = ''; stEl.style.color = ''; }
  document.getElementById('submitTaskModal').classList.add('active');
  setTimeout(() => document.getElementById('submitTaskLinkInput').focus(), 100);
}

// Marca la tarea como completed directamente (caso publicador o flujos sin aprobacion)
async function finalizeCompletedDirect(task) {
  const taskEl = document.querySelector(`.task-item[data-id="${task.id}"]`);
  if (taskEl) {
    taskEl.classList.add('completing');
    await new Promise(r => setTimeout(r, 300));
  }
  await db.collection('tasks').doc(task.id).update({
    status: 'completed',
    completedAt: firebase.firestore.FieldValue.serverTimestamp(),
    completedBy: currentUser.uid,
    completedByName: currentUserData.name
  });

  // Sincronizar deposito: si esta tarea vino del deposito, la entry pasa a
  // 'finalized' y se mueve a Trabajos Finalizados.
  await syncDepositOnTaskChange(task, 'complete');

  // Notificar creador
  const creator = teamMembers.find(m => m.id === task.createdBy);
  if (creator && creator.telegramChatId && creator.id !== currentUser.uid) {
    sendTelegramNotif(creator.telegramChatId,
      `*${currentUserData.name}* publico la tarea (cerrada sin aprobacion):\n${task.text}\nProyecto: *${task.projectName}*`
    );
  }
  // Desbloquear siguientes en cadena
  const dependents = tasks.filter(t => t.dependsOn === task.id && t.status !== 'completed');
  dependents.forEach(dep => {
    const depAssignee = teamMembers.find(m => m.id === dep.assignedTo);
    if (depAssignee && depAssignee.telegramChatId && depAssignee.id !== currentUser.uid) {
      const linkMsg = task.link ? `\n\nMaterial: ${task.link}` : '';
      sendTelegramNotif(depAssignee.telegramChatId,
        `*${task.assignedToName || 'Un miembro'}* publico: ${task.text}\n\nYa puedes empezar tu tarea:\n*${dep.text}*\nProyecto: *${dep.projectName}*${linkMsg}`
      );
    }
  });
}

async function finalizeSubmitTask(taskId, submittedLinkRaw) {
  const taskEl = document.querySelector(`.task-item[data-id="${taskId}"]`);
  if (taskEl) {
    taskEl.classList.add('completing');
    await new Promise(r => setTimeout(r, 300));
  }
  const task = tasks.find(t => t.id === taskId);

  let submittedLink = (submittedLinkRaw || '').trim();
  if (submittedLink && !/^https?:\/\//i.test(submittedLink)) submittedLink = 'https://' + submittedLink;

  const update = {
    status: 'pending_approval',
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    submittedBy: currentUser.uid,
    submittedByName: currentUserData.name
  };
  if (submittedLink) update.submittedLink = submittedLink;
  await db.collection('tasks').doc(taskId).update(update);

  if (task) {
    const notifyIds = teamMembers
      .filter(m => (m.role === 'admin' || m.id === task.createdBy) && m.telegramChatId && m.id !== currentUser.uid)
      .map(m => m.telegramChatId);

    if (notifyIds.length > 0) {
      const linkLine = submittedLink ? `\nMaterial entregado: ${submittedLink}` : '';
      sendTelegramNotifToMany(notifyIds,
        `*${currentUserData.name}* termino una tarea y espera aprobacion:\n${task.text}\nProyecto: *${task.projectName}*${linkLine}`
      );
    }

    const dependents = tasks.filter(t => t.dependsOn === taskId && t.status !== 'completed');
    dependents.forEach(dep => {
      const depAssignee = teamMembers.find(m => m.id === dep.assignedTo);
      if (depAssignee && depAssignee.telegramChatId && depAssignee.id !== currentUser.uid) {
        const linkMsg = task.link ? `\nMaterial: ${task.link}` : '';
        sendTelegramNotif(depAssignee.telegramChatId,
          `*${currentUserData.name}* termino su paso (pendiente de aprobacion del admin).\nPrepara tu parte:\n*${dep.text}*\nProyecto: *${dep.projectName}*${linkMsg}`
        );
      }
    });
  }
}

document.getElementById('submitTaskCancel').addEventListener('click', () => {
  document.getElementById('submitTaskModal').classList.remove('active');
  submittingTaskId = null;
});
document.getElementById('submitTaskConfirm').addEventListener('click', async () => {
  if (!submittingTaskId) return;
  const link = document.getElementById('submitTaskLinkInput').value;
  const taskId = submittingTaskId;
  submittingTaskId = null;
  document.getElementById('submitTaskModal').classList.remove('active');
  await finalizeSubmitTask(taskId, link);
});
// "Enviar y programar": entrega para aprobacion y abre el modal Programar
// pre-llenado con el material recien subido. Atajo para no tener que ir a
// buscar la tarea despues.
document.getElementById('submitTaskConfirmSchedule').addEventListener('click', async () => {
  if (!submittingTaskId) return;
  const link = document.getElementById('submitTaskLinkInput').value;
  const taskId = submittingTaskId;
  const task = tasks.find(t => t.id === taskId);
  submittingTaskId = null;
  document.getElementById('submitTaskModal').classList.remove('active');
  await finalizeSubmitTask(taskId, link);
  if (task) {
    // Construir contexto reutilizando la data de la tarea + el link recien
    // entregado (que aun no esta en task porque finalizeSubmitTask actualiza
    // Firestore async). Lo inyectamos manualmente.
    const ctx = buildSchedulingContextFromTask(task);
    if (link && link.trim()) {
      let normLink = link.trim();
      if (!/^https?:\/\//i.test(normLink)) normLink = 'https://' + normLink;
      if (!ctx.mediaUrls.includes(normLink)) ctx.mediaUrls.unshift(normLink);
    }
    schedulingContext = ctx;
    await openScheduleModalWithContext();
  }
});
document.getElementById('submitTaskLinkInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('submitTaskConfirm').click();
});
document.getElementById('submitTaskModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('submitTaskModal')) {
    document.getElementById('submitTaskModal').classList.remove('active');
    submittingTaskId = null;
  }
});

// Upload local a Cloudinary desde el modal "Entregar trabajo terminado".
// Misma logica que multiSubmitUploadBtn: click en el boton abre file input,
// la URL resultante se pega en submitTaskLinkInput.
const submitTaskUploadBtn = document.getElementById('submitTaskUploadBtn');
const submitTaskFileInput = document.getElementById('submitTaskFileInput');
const submitTaskUploadStatus = document.getElementById('submitTaskUploadStatus');
if (submitTaskUploadBtn && submitTaskFileInput) {
  submitTaskUploadBtn.addEventListener('click', () => submitTaskFileInput.click());
  submitTaskFileInput.addEventListener('change', async () => {
    const file = submitTaskFileInput.files && submitTaskFileInput.files[0];
    if (!file) return;
    submitTaskUploadStatus.style.display = 'block';
    submitTaskUploadStatus.style.color = '';
    submitTaskUploadStatus.textContent = `⏳ Subiendo ${file.name}... 0%`;
    submitTaskUploadBtn.disabled = true;
    try {
      const result = await uploadToCloudinary(file, (pct) => {
        submitTaskUploadStatus.textContent = `⏳ Subiendo ${file.name}... ${pct}%`;
      });
      document.getElementById('submitTaskLinkInput').value = result.url;
      submitTaskUploadStatus.textContent = `✅ Subido (${(result.bytes / 1024).toFixed(0)} KB)`;
      setTimeout(() => { submitTaskUploadStatus.style.display = 'none'; }, 3000);
    } catch (e) {
      submitTaskUploadStatus.textContent = `❌ ${e.message}`;
      submitTaskUploadStatus.style.color = 'var(--danger)';
    } finally {
      submitTaskUploadBtn.disabled = false;
      submitTaskFileInput.value = '';
    }
  });
}

async function approveTask(taskId) {
  const taskEl = document.querySelector(`.task-item[data-id="${taskId}"]`);
  if (taskEl) {
    taskEl.classList.add('completing');
    await new Promise(r => setTimeout(r, 300));
  }

  const task = tasks.find(t => t.id === taskId);

  await db.collection('tasks').doc(taskId).update({
    status: 'completed',
    completedAt: firebase.firestore.FieldValue.serverTimestamp(),
    approvedBy: currentUser.uid,
    approvedByName: currentUserData.name
  });

  // Sincronizar deposito al aprobar: la entry pasa a Trabajos Finalizados
  if (task) await syncDepositOnTaskChange(task, 'complete');

  if (task) {
    const assignee = teamMembers.find(m => m.id === task.assignedTo);
    if (assignee && assignee.telegramChatId) {
      sendTelegramNotif(assignee.telegramChatId,
        `Tu tarea fue *aprobada* por *${currentUserData.name}*:\n${task.text}`
      );
    }

    // Notify dependents: tasks that were waiting on this one
    const dependents = tasks.filter(t => t.dependsOn === taskId && t.status !== 'completed');
    dependents.forEach(dep => {
      const depAssignee = teamMembers.find(m => m.id === dep.assignedTo);
      if (depAssignee && depAssignee.telegramChatId) {
        const linkMsg = task.link ? `\n\nMaterial: ${task.link}` : '';
        sendTelegramNotif(depAssignee.telegramChatId,
          `*${task.assignedToName || 'Un miembro'}* termino: ${task.text}\n\nYa puedes empezar tu tarea:\n*${dep.text}*\nProyecto: *${dep.projectName}*${linkMsg}`
        );
      }
    });

    // Si la tarea tiene material entregado, ofrecer archivarla al Deposito
    if (task.submittedLink) {
      showArchiveDepositModal(task);
    }
  }
}

// ===== PRESENCIA (online/offline) =====
async function pulsePresence() {
  if (!currentUser) return;
  try {
    await db.collection('users').doc(currentUser.uid).update({
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { /* ignore */ }
}

function startPresenceHeartbeat() {
  pulsePresence();
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = setInterval(pulsePresence, HEARTBEAT_INTERVAL_MS);
  // Best-effort: marcar offline al cerrar la ventana
  window.addEventListener('beforeunload', () => {
    if (!currentUser) return;
    try {
      db.collection('users').doc(currentUser.uid).update({
        lastSeen: new Date(0) // timestamp viejo => offline
      });
    } catch (e) {}
  });
}

// ===== DEPOSITO: SEED CATEGORIAS DEFAULT =====
async function ensureDefaultDepositCategories() {
  const defaults = [
    { id: 'reels', name: 'Reels' },
    { id: 'carruseles', name: 'Carruseles' },
    { id: 'trabajos-finalizados', name: 'Trabajos Finalizados' }
  ];
  for (const d of defaults) {
    try {
      const ref = db.collection('depositCategories').doc(d.id);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          name: d.name,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: currentUser.uid,
          isDefault: true
        });
      }
    } catch (e) { /* ignore */ }
  }
}

// ===== ARCHIVE TO DEPOSIT (despues de aprobar) =====
let archivingTask = null;
let archiveCategoriesCache = [];

async function showArchiveDepositModal(task) {
  archivingTask = task;
  document.getElementById('archiveTaskPreview').textContent = task.text;
  // Cargar categorias del deposito
  try {
    const snap = await db.collection('depositCategories').orderBy('name').get();
    archiveCategoriesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    archiveCategoriesCache = [];
  }
  const catSel = document.getElementById('archiveCategorySelect');
  const roots = archiveCategoriesCache.filter(c => !c.parentId);
  catSel.innerHTML = '<option value="">-- Elige categoria --</option>' +
    roots.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  // Pre-seleccionar "Trabajos Finalizados" si existe (caso comun)
  if (roots.some(c => c.id === 'trabajos-finalizados')) {
    catSel.value = 'trabajos-finalizados';
    // Cargar sus subcategorias
    const subs = archiveCategoriesCache.filter(c => c.parentId === 'trabajos-finalizados');
    const subSel = document.getElementById('archiveSubcategorySelect');
    subSel.innerHTML = '<option value="">Sin clasificar</option>' +
      subs.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    document.getElementById('archiveSubcategoryRow').style.display = 'block';
  } else {
    document.getElementById('archiveSubcategoryRow').style.display = 'none';
    document.getElementById('archiveSubcategorySelect').innerHTML = '<option value="">Sin clasificar</option>';
  }
  document.getElementById('archiveDepositModal').classList.add('active');
}

document.getElementById('archiveCategorySelect').addEventListener('change', () => {
  const catId = document.getElementById('archiveCategorySelect').value;
  const subRow = document.getElementById('archiveSubcategoryRow');
  if (!catId) { subRow.style.display = 'none'; return; }
  const subs = archiveCategoriesCache.filter(c => c.parentId === catId);
  const sel = document.getElementById('archiveSubcategorySelect');
  sel.innerHTML = '<option value="">Sin clasificar</option>' +
    subs.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  subRow.style.display = 'block';
});

document.getElementById('archiveSkip').addEventListener('click', () => {
  document.getElementById('archiveDepositModal').classList.remove('active');
  archivingTask = null;
});
document.getElementById('archiveDepositModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('archiveDepositModal')) {
    document.getElementById('archiveDepositModal').classList.remove('active');
    archivingTask = null;
  }
});

document.getElementById('archiveConfirm').addEventListener('click', async () => {
  if (!archivingTask) return;
  const catId = document.getElementById('archiveCategorySelect').value;
  if (!catId) {
    document.getElementById('archiveDepositModal').classList.remove('active');
    archivingTask = null;
    return;
  }
  const cat = archiveCategoriesCache.find(c => c.id === catId);
  const subId = document.getElementById('archiveSubcategorySelect').value;
  const sub = subId ? archiveCategoriesCache.find(c => c.id === subId) : null;
  const t = archivingTask;
  const links = [];
  if (t.submittedLink) links.push({ type: 'recurso', url: t.submittedLink, label: 'Trabajo finalizado' });
  if (t.videoLink) links.push({ type: 'video', url: t.videoLink, label: 'Video de referencia' });
  if (t.link) links.push({ type: 'material', url: t.link, label: 'Material original' });
  const data = {
    title: t.text,
    description: `Tarea aprobada de ${t.assignedToName || ''}${t.projectName ? ' en ' + t.projectName : ''}.`,
    links,
    categoryId: catId,
    categoryName: cat ? cat.name : '',
    status: 'idea',
    createdBy: currentUser.uid,
    createdByName: currentUserData.name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    archivedFromTaskId: t.id
  };
  if (sub) {
    data.subcategoryId = sub.id;
    data.subcategoryName = sub.name;
  }
  await db.collection('depositEntries').add(data);
  document.getElementById('archiveDepositModal').classList.remove('active');
  archivingTask = null;
});

async function rejectTask(taskId) {
  const task = tasks.find(t => t.id === taskId);

  await db.collection('tasks').doc(taskId).update({
    status: 'pending',
    rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
    rejectedBy: currentUser.uid,
    rejectedByName: currentUserData.name
  });

  if (task) {
    const assignee = teamMembers.find(m => m.id === task.assignedTo);
    if (assignee && assignee.telegramChatId) {
      sendTelegramNotif(assignee.telegramChatId,
        `Tu tarea fue *rechazada* por *${currentUserData.name}* y volvio a pendientes:\n${task.text}`
      );
    }
  }
}

// Edit task modal (maneja tareas de equipo y personales con TODOS los campos:
// texto, link, videoLink, coverImage, notes)
let editingTask = null; // { id, collection }
const editModal = document.getElementById('editModal');
const editTaskInput = document.getElementById('editTaskInput');
const editTaskLink = document.getElementById('editTaskLink');
const editTaskVideoLink = document.getElementById('editTaskVideoLink');
const editTaskCoverImage = document.getElementById('editTaskCoverImage');
const editTaskCoverPreview = document.getElementById('editTaskCoverPreview');
const editTaskNotes = document.getElementById('editTaskNotes');

function updateEditCoverPreview() {
  if (!editTaskCoverImage || !editTaskCoverPreview) return;
  const url = (editTaskCoverImage.value || '').trim();
  if (url) {
    editTaskCoverPreview.style.display = 'block';
    editTaskCoverPreview.style.height = '140px';
    editTaskCoverPreview.style.backgroundImage = `url('${url.replace(/'/g, '%27')}')`;
  } else {
    editTaskCoverPreview.style.display = 'none';
  }
}
if (editTaskCoverImage) editTaskCoverImage.addEventListener('input', updateEditCoverPreview);

document.getElementById('cancelEdit').addEventListener('click', () => {
  editModal.classList.remove('active');
  editingTask = null;
});

document.getElementById('confirmEdit').addEventListener('click', async () => {
  if (!editingTask) return;
  const newText = editTaskInput.value.trim();
  if (!newText) { alert('El titulo no puede estar vacio'); return; }
  // Set/limpiar campos opcionales: si el input esta vacio, lo borramos del doc
  // (pasamos firebase.firestore.FieldValue.delete()) para mantener el schema limpio.
  const link = (editTaskLink.value || '').trim();
  const videoLink = (editTaskVideoLink.value || '').trim();
  const coverImage = (editTaskCoverImage.value || '').trim();
  const description = (editTaskNotes.value || '').trim();
  // IMPORTANTE: NO tocar el campo `notes` (es el array de subnotas con autor).
  // Usar `description` (string) en su lugar para no romper el render.
  const update = {
    text: newText,
    link: link || firebase.firestore.FieldValue.delete(),
    videoLink: videoLink || firebase.firestore.FieldValue.delete(),
    coverImage: coverImage || firebase.firestore.FieldValue.delete(),
    description: description || firebase.firestore.FieldValue.delete(),
    editedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await db.collection(editingTask.collection).doc(editingTask.id).update(update);
  } catch (e) {
    alert('Error guardando: ' + e.message);
    return;
  }
  editModal.classList.remove('active');
  editingTask = null;
});

editTaskInput.addEventListener('keypress', (e) => {
  // Enter en el campo titulo guarda. En los otros inputs/textarea no, para
  // permitir escribir libremente.
  if (e.key === 'Enter' && e.target === editTaskInput) {
    e.preventDefault();
    document.getElementById('confirmEdit').click();
  }
});

editModal.addEventListener('click', (e) => {
  if (e.target === editModal) { editModal.classList.remove('active'); editingTask = null; }
});

function fillEditModalFromTask(task) {
  editTaskInput.value = task.text || '';
  editTaskLink.value = task.link || '';
  editTaskVideoLink.value = task.videoLink || '';
  editTaskCoverImage.value = task.coverImage || '';
  // notes puede ser array (subnotas) o string (legacy v2.93). Preferimos description.
  if (typeof task.description === 'string') {
    editTaskNotes.value = task.description;
  } else if (typeof task.notes === 'string') {
    editTaskNotes.value = task.notes;
  } else {
    editTaskNotes.value = '';
  }
  updateEditCoverPreview();
}

async function editTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !canEdit(task)) return;
  editingTask = { id: taskId, collection: 'tasks' };
  fillEditModalFromTask(task);
  editModal.classList.add('active');
  setTimeout(() => editTaskInput.focus(), 100);
}

async function editPersonalTask(taskId) {
  const task = personalTasks.find(t => t.id === taskId);
  if (!task) return;
  editingTask = { id: taskId, collection: 'personalTasks' };
  fillEditModalFromTask(task);
  editModal.classList.add('active');
  setTimeout(() => editTaskInput.focus(), 100);
}
window.editPersonalTask = editPersonalTask;

// Add note modal
let notingTaskId = null;
const noteModal = document.getElementById('noteModal');
const noteInput = document.getElementById('noteInput');

document.getElementById('cancelNote').addEventListener('click', () => {
  noteModal.classList.remove('active');
  notingTaskId = null;
});

document.getElementById('confirmNote').addEventListener('click', async () => {
  const noteText = noteInput.value.trim();
  if (notingTaskId && noteText) {
    const task = tasks.find(t => t.id === notingTaskId);
    if (task) {
      const notes = task.notes || [];
      notes.push({
        text: noteText,
        authorId: currentUser.uid,
        authorName: currentUserData.name,
        createdAt: new Date().toISOString()
      });
      await db.collection('tasks').doc(notingTaskId).update({ notes: notes });
    }
  }
  noteModal.classList.remove('active');
  noteInput.value = '';
  notingTaskId = null;
});

noteInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmNote').click();
});

noteModal.addEventListener('click', (e) => {
  if (e.target === noteModal) { noteModal.classList.remove('active'); notingTaskId = null; }
});

async function addNote(taskId) {
  notingTaskId = taskId;
  noteInput.value = '';
  noteModal.classList.add('active');
  setTimeout(() => noteInput.focus(), 100);
}

async function toggleRole(userId, currentRole) {
  const newRole = currentRole === 'admin' ? 'miembro' : 'admin';
  await db.collection('users').doc(userId).update({ role: newRole });
}

function canEdit(task) {
  if (!currentUserData) return false;
  if (currentUserData.role === 'admin') return true;
  if (task.createdBy === currentUser.uid) return true;
  return false;
}

function canDelete(task) {
  if (!currentUserData) return false;
  if (currentUserData.role === 'admin') return true;
  if (task.createdBy === currentUser.uid) return true;
  return false;
}

function canComplete(task) {
  if (!currentUserData) return false;
  if (currentUserData.role === 'admin') return true;
  if (task.createdBy === currentUser.uid) return true;
  if (task.assignedTo === currentUser.uid) return true;
  // Multi-tarea: cualquier miembro asignado puede marcar SU parte
  if (Array.isArray(task.assignedToMulti) && task.assignedToMulti.includes(currentUser.uid)) return true;
  return false;
}

// =====================================================
// Sincronizacion entre tareas y depositEntries
// =====================================================
// Cuando una tarea cambia de estado, hay que mover la depositEntry asociada:
//   - 'complete'      -> status 'finalized', mover a Trabajos Finalizados
//   - 'restore'       -> status 'idea', regresar a categoria original
//   - 're-convert'    -> status 'converted', oculta del deposito (en proceso)
//
// La tarea conoce el deposit entry via taskData.depositEntryId (set en
// deposit-renderer.js al crearse). Si no hay depositEntryId, esta funcion no
// hace nada (la tarea fue creada manualmente, no desde el deposito).
async function syncDepositOnTaskChange(task, action) {
  if (!task || !task.depositEntryId) return;
  try {
    const ref = db.collection('depositEntries').doc(task.depositEntryId);
    if (action === 'complete') {
      // Mover a Trabajos Finalizados / Publicados (subcategoria predeterminada
      // donde caen todas las tareas finalizadas). El usuario puede moverlo a
      // otra subcategoria de TF manualmente despues con el boton de editar.
      await ref.update({
        status: 'finalized',
        finalizedAt: firebase.firestore.FieldValue.serverTimestamp(),
        finalizedTaskId: task.id,
        categoryId: 'trabajos-finalizados',
        categoryName: 'Trabajos Finalizados',
        subcategoryId: 'tf-publicados',
        subcategoryName: 'Publicados'
      });
    } else if (action === 'restore') {
      // Tarea cancelada/eliminada: regresar a categoria original como pendiente
      const snap = await ref.get();
      if (!snap.exists) return;
      const data = snap.data();
      const update = {
        status: 'idea',
        finalizedAt: firebase.firestore.FieldValue.delete(),
        finalizedTaskId: firebase.firestore.FieldValue.delete()
      };
      if (data.originalCategoryId) {
        update.categoryId = data.originalCategoryId;
        update.categoryName = data.originalCategoryName || '';
        if (data.originalSubcategoryId) {
          update.subcategoryId = data.originalSubcategoryId;
          update.subcategoryName = data.originalSubcategoryName || '';
        } else {
          update.subcategoryId = firebase.firestore.FieldValue.delete();
          update.subcategoryName = firebase.firestore.FieldValue.delete();
        }
      }
      await ref.update(update);
    } else if (action === 're-convert') {
      // Tarea restaurada de la papelera: regresa a estado en proceso (oculta)
      await ref.update({
        status: 'converted',
        finalizedAt: firebase.firestore.FieldValue.delete(),
        finalizedTaskId: firebase.firestore.FieldValue.delete()
      });
    }
  } catch (e) {
    console.error('[deposit sync] error', e);
  }
}

// Retornar una tarea asignada al Deposito de Ideas (re-asignable).
// Si vino del deposito: restaura la entry a su categoria original como 'idea'.
// Si no: crea un nuevo entry desde la data de la tarea.
// En ambos casos elimina la tarea y notifica al asignado por Telegram.
async function returnTaskToDeposit(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!canDelete(task)) return;
  const assignee = teamMembers.find(m => m.id === task.assignedTo);
  const assigneeMsg = assignee ? `\n\n${assignee.name} sera notificada por Telegram.` : '';
  const targetMsg = task.depositEntryId
    ? 'Volvera a su categoria original en el Deposito como pendiente para que cualquiera del equipo la pueda re-asignar.'
    : 'Se creara una entry en el Deposito de Ideas con todos los datos de la tarea (titulo, links, imagen, notas) en la categoria que elijas despues.';
  if (!confirm(`Retornar la tarea "${task.text}" al Deposito de Ideas?\n\n${targetMsg}${assigneeMsg}`)) return;

  try {
    if (task.depositEntryId) {
      // Restaura la entry existente y elimina la tarea
      await db.collection('tasks').doc(taskId).delete();
      await syncDepositOnTaskChange(task, 'restore');
    } else {
      // Crear nuevo entry en el Deposito (categoria por defecto: la primera no-finalizada)
      // Usamos la primera categoria del deposito que no sea trabajos-finalizados.
      let catId = '';
      let catName = '';
      try {
        const snap = await db.collection('depositCategories').orderBy('name').get();
        const firstCat = snap.docs.find(d => d.id !== 'trabajos-finalizados' && !d.data().parentId);
        if (firstCat) { catId = firstCat.id; catName = firstCat.data().name || ''; }
      } catch (e) { /* ignore */ }
      const linksArr = [];
      if (task.link) linksArr.push({ type: 'material', url: task.link, label: '' });
      if (task.videoLink) linksArr.push({ type: 'video', url: task.videoLink, label: '' });
      await db.collection('depositEntries').add({
        title: task.text || '',
        description: (typeof task.notes === 'string') ? task.notes : '',
        links: linksArr,
        coverImage: task.coverImage || '',
        status: 'idea',
        categoryId: catId,
        categoryName: catName,
        createdBy: currentUser.uid,
        createdByName: currentUserData.name,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        fromReturnedTaskId: task.id
      });
      await db.collection('tasks').doc(taskId).delete();
    }
  } catch (e) {
    alert('Error retornando la tarea: ' + e.message);
    return;
  }

  // Notificar al asignado (si no es el mismo que retorna)
  try {
    if (task.assignedTo && task.assignedTo !== currentUser.uid && assignee) {
      const projName = task.projectName || 'sin proyecto';
      const msg = `↩️ *${currentUserData.name}* retornó al Depósito una tarea que tenías asignada:\n*${task.text}*\nProyecto: *${projName}*\n\nLa tarea fue removida y la idea quedó disponible para re-asignar.`;
      notifyAssignedOrWarn(assignee, msg);
    }
  } catch (e) { console.warn('[notif return]', e.message); }
}
window.returnTaskToDeposit = returnTaskToDeposit;

// ===== Multi-tarea: modal "Marcar mi parte hecha" =====
let multiSubmitTaskId = null;

function openMultiSubmitModal(task) {
  multiSubmitTaskId = task.id;
  const myRole = (task.multiRoles && task.multiRoles[currentUser.uid]) || '';
  const roleLine = myRole ? ` (${myRole})` : '';
  document.getElementById('multiSubmitTaskInfo').textContent = `${task.text}${roleLine} — proyecto: ${task.projectName || 'sin proyecto'}`;
  document.getElementById('multiSubmitUrl').value = '';
  document.getElementById('multiSubmitNote').value = '';
  document.getElementById('multiSubmitUploadStatus').style.display = 'none';
  // Pre-seleccionar el postType ya guardado en la tarea (default: post)
  const currentPostType = task.postType || 'post';
  document.querySelectorAll('input[name="multiSubmitPostType"]').forEach(r => {
    r.checked = r.value === currentPostType;
  });
  // Mostrar URLs ya subidas por otros miembros (si hay)
  const existing = Array.isArray(task.mediaUrls) ? task.mediaUrls : [];
  const existingEl = document.getElementById('multiSubmitExisting');
  if (existing.length > 0) {
    existingEl.innerHTML = `📎 Ya subido por otros miembros: ${existing.length} URL(s)<br>` +
      existing.map((u, i) => `<a href="#" onclick="window.api.openExternal('${esc(u)}');return false" style="color:var(--accent);text-decoration:underline">[${i + 1}] ${esc(u.slice(0, 80))}${u.length > 80 ? '...' : ''}</a>`).join('<br>');
  } else {
    existingEl.textContent = '';
  }
  document.getElementById('multiSubmitModal').classList.add('active');
  setTimeout(() => document.getElementById('multiSubmitUrl').focus(), 100);
}

document.getElementById('cancelMultiSubmit').addEventListener('click', () => {
  document.getElementById('multiSubmitModal').classList.remove('active');
  multiSubmitTaskId = null;
});
document.getElementById('multiSubmitModal').addEventListener('click', (e) => {
  if (e.target.id === 'multiSubmitModal') {
    document.getElementById('multiSubmitModal').classList.remove('active');
    multiSubmitTaskId = null;
  }
});

// Boton "Subir archivo" en el modal multi-submit (Cloudinary)
const multiSubmitUploadBtn = document.getElementById('multiSubmitUploadBtn');
const multiSubmitFileInput = document.getElementById('multiSubmitFileInput');
const multiSubmitUploadStatus = document.getElementById('multiSubmitUploadStatus');
if (multiSubmitUploadBtn && multiSubmitFileInput) {
  multiSubmitUploadBtn.addEventListener('click', () => multiSubmitFileInput.click());
  multiSubmitFileInput.addEventListener('change', async () => {
    const file = multiSubmitFileInput.files && multiSubmitFileInput.files[0];
    if (!file) return;
    multiSubmitUploadStatus.style.display = 'block';
    multiSubmitUploadStatus.textContent = `⏳ Subiendo ${file.name}... 0%`;
    multiSubmitUploadBtn.disabled = true;
    try {
      const result = await uploadToCloudinary(file, (pct) => {
        multiSubmitUploadStatus.textContent = `⏳ Subiendo ${file.name}... ${pct}%`;
      });
      document.getElementById('multiSubmitUrl').value = result.url;
      multiSubmitUploadStatus.textContent = `✅ Subido (${(result.bytes / 1024).toFixed(0)} KB)`;
      setTimeout(() => { multiSubmitUploadStatus.style.display = 'none'; }, 3000);
    } catch (e) {
      multiSubmitUploadStatus.textContent = `❌ ${e.message}`;
      multiSubmitUploadStatus.style.color = 'var(--danger)';
    } finally {
      multiSubmitUploadBtn.disabled = false;
      multiSubmitFileInput.value = '';
    }
  });
}

document.getElementById('confirmMultiSubmit').addEventListener('click', async () => {
  if (!multiSubmitTaskId) return;
  const task = tasks.find(t => t.id === multiSubmitTaskId);
  if (!task) { multiSubmitTaskId = null; return; }
  const url = document.getElementById('multiSubmitUrl').value.trim();
  const note = document.getElementById('multiSubmitNote').value.trim();
  const chosenPostType = document.querySelector('input[name="multiSubmitPostType"]:checked')?.value || 'post';
  // Acumular URL en task.mediaUrls (si se proporciono)
  const existing = Array.isArray(task.mediaUrls) ? task.mediaUrls : [];
  const newMediaUrls = [...existing];
  if (url) newMediaUrls.push(url);
  // Calcular si todos los miembros completaron
  const completions = task.multiCompletions || {};
  const allOthersDone = Array.isArray(task.assignedToMulti)
    && task.assignedToMulti.every(id => id === currentUser.uid || completions[id]);
  // Acumular nota por miembro en task.multiNotes (objeto)
  const update = {
    [`multiCompletions.${currentUser.uid}`]: true,
    [`multiCompletedAt.${currentUser.uid}`]: firebase.firestore.FieldValue.serverTimestamp(),
    postType: chosenPostType // ultimo en marcar puede cambiarlo
  };
  if (url) {
    update.mediaUrls = newMediaUrls;
    // Tambien actualizamos coverImage/videoLink si todavia no estaban setteados
    if (!task.coverImage) update.coverImage = url;
    if (!task.videoLink && /\.(mp4|mov|webm)(\?.*)?$/i.test(url)) update.videoLink = url;
    update[`multiSubmissions.${currentUser.uid}`] = url;
  }
  if (note) {
    update[`multiNotes.${currentUser.uid}`] = note;
  }
  if (allOthersDone) {
    update.status = 'multi-ready';
    update.multiReadyAt = firebase.firestore.FieldValue.serverTimestamp();
  }
  try {
    await db.collection('tasks').doc(task.id).update(update);
  } catch (e) {
    alert('Error: ' + e.message);
    return;
  }
  // Notificaciones Telegram
  const myRole = (task.multiRoles && task.multiRoles[currentUser.uid]) || '';
  const roleLine = myRole ? ` (rol: ${myRole})` : '';
  const otherIds = (task.assignedToMulti || []).filter(id => id !== currentUser.uid);
  otherIds.forEach(id => {
    const m = teamMembers.find(x => x.id === id);
    if (m && m.telegramChatId) {
      const extra = allOthersDone
        ? `\n\n✅ Todos completaron. La tarea esta lista — abrila en "Por Aprobar" para programar / asignar publicador / dejar borrador.`
        : '';
      const urlLine = url ? `\nEntregable: ${url}` : '';
      sendTelegramNotif(m.telegramChatId, `*${currentUserData.name}*${roleLine} completo su parte de la multi-tarea:\n*${task.text}*\nProyecto: *${task.projectName}*${urlLine}${extra}`);
    }
  });
  if (allOthersDone) {
    const creator = teamMembers.find(m => m.id === task.createdBy);
    if (creator && creator.telegramChatId && creator.id !== currentUser.uid) {
      sendTelegramNotif(creator.telegramChatId,
        `Multi-tarea lista para programar:\n*${task.text}*\nProyecto: *${task.projectName}*\n\nTodos los miembros completaron — abrila en "Por Aprobar".`);
    }
  }
  document.getElementById('multiSubmitModal').classList.remove('active');
  multiSubmitTaskId = null;
});

// ===== Multi-tarea: acciones post-completion =====
// Las multi-tareas en estado 'multi-ready' (todos completaron) tienen 3 botones:
// Programar / Asignar publicador / Borrador. Cada uno cierra el ciclo.
function buildSchedulingContextFromTask(task) {
  // Recopila TODA la data util de la tarea para pre-llenar el modal Programar.
  // Captura prioritaria de URLs: mediaUrls (carrusel), videoLink (editor),
  // link (material). Caption: titulo + notas concatenadas.
  const urls = [];
  if (Array.isArray(task.mediaUrls) && task.mediaUrls.length > 0) {
    task.mediaUrls.forEach(u => { if (u && !urls.includes(u)) urls.push(u); });
  }
  if (task.videoLink && !urls.includes(task.videoLink)) urls.push(task.videoLink);
  if (task.link && !urls.includes(task.link)) urls.push(task.link);
  // Notas: las notas en tasks son array de objetos {authorName, text}.
  // Concatenamos texto para usar como caption.
  let notesText = '';
  if (Array.isArray(task.notes) && task.notes.length > 0) {
    notesText = task.notes.map(n => (n.text || '')).filter(s => s).join('\n');
  } else if (typeof task.notes === 'string') {
    notesText = task.notes;
  }
  const description = notesText;
  return {
    type: 'task',
    taskId: task.id,
    title: task.text || '',
    description,
    coverImage: task.coverImage || '',
    mediaUrls: urls,
    suggestedPostType: task.postType || null // viene de los miembros marcando
  };
}

async function multiTaskSchedule(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  schedulingContext = buildSchedulingContextFromTask(task);
  schedulingContext.fromMultiTaskId = task.id; // marca para cerrar la tarea al programar
  await openScheduleModalWithContext();
}
window.multiTaskSchedule = multiTaskSchedule;

async function multiTaskSaveDraft(taskId) {
  // Guarda la data de la tarea como borrador en scheduledPosts.
  // Marca la tarea como completed y la mueve a Trabajos Finalizados.
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!confirm(`Guardar como BORRADOR en Programacion?\n\n"${task.text}"\n\nLa multi-tarea se marca como completada y se archiva en Trabajos Finalizados. El borrador queda en Programacion para que retomes y termines de programar despues.`)) return;
  schedulingContext = buildSchedulingContextFromTask(task);
  // Pre-poblar campos del modal sin abrirlo, para usar saveScheduleAsDraft
  // Cargar en variables globales temporales:
  // Mejor: simulamos abrir/cerrar el modal con la data pre-cargada.
  await openScheduleModalWithContext();
  // El modal ya esta abierto con todo pre-llenado. Disparamos guardar borrador:
  const ok = await saveScheduleAsDraft();
  if (ok) {
    // Cerrar modal sin preguntar
    closeScheduleModal();
    // Marcar la tarea como completed + mover a Trabajos Finalizados
    await finalizeMultiTaskAfterAction(task);
  }
}
window.multiTaskSaveDraft = multiTaskSaveDraft;

async function multiTaskAssignPublisher(taskId) {
  // Crea una nueva tarea individual tipo 'publicador' con la data acumulada
  // de la multi-tarea, asignada al miembro elegido.
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  // Pedir miembro (prompt simple por ahora — en v2.99 podriamos hacer un modal)
  const memberOptions = teamMembers.map((m, i) => `${i + 1}. ${m.name}`).join('\n');
  const choice = prompt(`Asignar publicador a quien? Escribe el numero:\n\n${memberOptions}`);
  const idx = parseInt(choice, 10) - 1;
  const member = teamMembers[idx];
  if (!member) { alert('Seleccion invalida'); return; }
  if (!confirm(`Crear tarea Publicador para ${member.name}?\n\n"${task.text}"\n\nLa multi-tarea original se marcara como completada y se creara una tarea individual de tipo Publicador con todos los recursos para que ${member.name} programe el contenido.`)) return;
  // Crear la nueva tarea
  try {
    const linksArr = [];
    if (task.link) linksArr.push(task.link);
    if (task.videoLink && !linksArr.includes(task.videoLink)) linksArr.push(task.videoLink);
    const pubTaskData = {
      text: `📅 Programar: ${task.text}`,
      projectId: task.projectId,
      projectName: task.projectName,
      projectColor: task.projectColor,
      assignedTo: member.id,
      assignedToName: member.name,
      assignmentType: 'publicador',
      createdBy: currentUser.uid,
      createdByName: currentUserData.name,
      status: 'pending',
      source: 'multi-task',
      notes: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      fromMultiTaskId: task.id
    };
    if (task.link) pubTaskData.link = task.link;
    if (task.videoLink) pubTaskData.videoLink = task.videoLink;
    if (task.coverImage) pubTaskData.coverImage = task.coverImage;
    if (task.mediaUrls) pubTaskData.mediaUrls = task.mediaUrls;
    if (task.depositEntryId) pubTaskData.depositEntryId = task.depositEntryId;
    await db.collection('tasks').add(pubTaskData);
    // Notificar al publicador
    if (member.telegramChatId && member.id !== currentUser.uid) {
      sendTelegramNotif(member.telegramChatId,
        `*${currentUserData.name}* te asigno una tarea de Publicador:\n*${task.text}*\nProyecto: *${task.projectName}*\n\nTienes los recursos listos — solo programa el contenido.`);
    }
  } catch (e) {
    alert('Error creando tarea publicador: ' + e.message);
    return;
  }
  // Marcar la multi-tarea como completada y archivar
  await finalizeMultiTaskAfterAction(task);
}
window.multiTaskAssignPublisher = multiTaskAssignPublisher;

// Marca la multi-tarea como completed y sincroniza con el deposito.
// Se llama tras programar / asignar publicador / guardar borrador.
async function finalizeMultiTaskAfterAction(task) {
  try {
    await db.collection('tasks').doc(task.id).update({
      status: 'completed',
      completedAt: firebase.firestore.FieldValue.serverTimestamp(),
      completedBy: currentUser.uid,
      completedByName: currentUserData.name
    });
    // Si vino del deposito, mueve la entry a Trabajos Finalizados
    await syncDepositOnTaskChange(task, 'complete');
  } catch (e) {
    console.error('[multi-task finalize]', e);
  }
}

async function deleteTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!canDelete(task)) return;
  if (!confirm(`Estas seguro que quieres eliminar la tarea?\n\n"${task.text}"\n\nSe enviara a la Papelera. Podras restaurarla desde alli.`)) return;
  await db.collection('tasks').doc(taskId).update({
    deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
    deletedBy: currentUser.uid,
    deletedByName: currentUserData.name
  });
  // Si era una tarea creada desde el deposito y NO estaba completa, regresar
  // la entry al deposito (status 'idea' en su categoria original)
  if (task.status !== 'completed') {
    await syncDepositOnTaskChange(task, 'restore');
  }
  // Notificar por Telegram al asignado (si no es el mismo que elimina)
  try {
    if (task.assignedTo && task.assignedTo !== currentUser.uid) {
      const assignee = teamMembers.find(m => m.id === task.assignedTo);
      if (assignee) {
        const projName = task.projectName || 'sin proyecto';
        const msg = `🗑️ *${currentUserData.name}* eliminó una tarea que tenías asignada:\n*${task.text}*\nProyecto: *${projName}*`;
        notifyAssignedOrWarn(assignee, msg);
      }
    }
  } catch (e) { console.warn('[notif delete]', e.message); }
}

// ===== Mover desde papelera (con dropdown de destino) =====
// movingTrashTask incluye fromDeposit=true si la tarea vino del deposito.
// Los valores del select tienen prefijo:
//   project:<id>   - mover a un proyecto (mismo flow que antes)
//   deposit:<catId> - enviar al Deposito de Ideas con esa categoria, status=idea
//   deposit:__original__ - solo si vino del deposito, regresa a su categoria original
let movingTrashTask = null; // { id, kind: 'team'|'personal', fromDeposit?: bool }
async function buildMoveTrashOptions(kind, taskHasDeposit) {
  const select = document.getElementById('moveTrashSelect');
  if (!select) return;
  select.innerHTML = '';
  if (kind === 'team') {
    // Optgroup 1: Deposito de Ideas (con todas las categorias)
    const grpDep = document.createElement('optgroup');
    grpDep.label = '📥 Depósito de Ideas';
    if (taskHasDeposit) {
      const opt = document.createElement('option');
      opt.value = 'deposit:__original__';
      opt.textContent = '↩️ Categoría original (re-asignable)';
      grpDep.appendChild(opt);
    }
    // Categoria especial Referencias
    const refOpt = document.createElement('option');
    refOpt.value = 'deposit:referencias';
    refOpt.textContent = '📚 Referencias';
    grpDep.appendChild(refOpt);
    // Categorias dinamicas desde Firestore (excepto subcategorias y trabajos-finalizados)
    try {
      const snap = await db.collection('depositCategories').orderBy('name').get();
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.parentId) return; // saltar subcategorias
        if (d.id === 'trabajos-finalizados') return; // no enviar a finalizados (ya lo borraste)
        const opt = document.createElement('option');
        opt.value = `deposit:${d.id}`;
        opt.textContent = `📂 ${data.name}`;
        grpDep.appendChild(opt);
      });
    } catch (e) { console.warn('No se cargaron categorias de deposito', e); }
    select.appendChild(grpDep);

    // Optgroup 2: Proyectos del equipo
    const grpProj = document.createElement('optgroup');
    grpProj.label = '👥 Proyectos del equipo';
    const projOpts = [{ value: '', label: 'Sin proyecto' }, ...projects.map(p => ({ value: p.id, label: p.name }))];
    projOpts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = `project:${o.value}`;
      opt.textContent = o.label;
      grpProj.appendChild(opt);
    });
    select.appendChild(grpProj);
  } else {
    // Personales: General + proyectos personales del usuario
    allPersonalProjects().forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
  }
}
function openMoveTrashModalTeam(taskId) {
  const task = trashTasks.find(t => t.id === taskId);
  const fromDeposit = !!(task && task.depositEntryId);
  movingTrashTask = { id: taskId, kind: 'team', fromDeposit };
  buildMoveTrashOptions('team', fromDeposit);
  document.getElementById('moveTrashModal').classList.add('active');
}
function openMoveTrashModalPersonal(taskId) {
  movingTrashTask = { id: taskId, kind: 'personal', fromDeposit: false };
  buildMoveTrashOptions('personal', false);
  document.getElementById('moveTrashModal').classList.add('active');
}
window.openMoveTrashModalTeam = openMoveTrashModalTeam;
window.openMoveTrashModalPersonal = openMoveTrashModalPersonal;

document.getElementById('cancelMoveTrash').addEventListener('click', () => {
  document.getElementById('moveTrashModal').classList.remove('active');
  movingTrashTask = null;
});
document.getElementById('moveTrashModal').addEventListener('click', (e) => {
  if (e.target.id === 'moveTrashModal') {
    document.getElementById('moveTrashModal').classList.remove('active');
    movingTrashTask = null;
  }
});
document.getElementById('confirmMoveTrash').addEventListener('click', async () => {
  if (!movingTrashTask) return;
  const targetValue = document.getElementById('moveTrashSelect').value;
  try {
    const task = trashTasks.find(t => t.id === movingTrashTask.id);
    if (movingTrashTask.kind === 'team' && targetValue === 'deposit:__original__') {
      // Re-asignable a categoria original: borra la tarea + restaura entry existente
      if (!task) throw new Error('Tarea no encontrada');
      await db.collection('tasks').doc(movingTrashTask.id).delete();
      await syncDepositOnTaskChange(task, 'restore');
    } else if (movingTrashTask.kind === 'team' && targetValue.startsWith('deposit:')) {
      // Mover al Deposito en una categoria especifica (no la original).
      // Si la tarea tenia depositEntryId existente, ACTUALIZA ese doc + sincroniza
      // los campos editados de la tarea (link/videoLink/coverImage/notes/text).
      // Si no, CREA un nuevo doc en depositEntries con la data de la tarea
      // mapeada al schema del deposito (title/description/links/coverImage).
      const catId = targetValue.slice('deposit:'.length);
      const isReferencias = catId === 'referencias';
      let catName = isReferencias ? 'Referencias' : '';
      if (!isReferencias) {
        try {
          const cs = await db.collection('depositCategories').doc(catId).get();
          if (cs.exists) catName = cs.data().name || '';
        } catch (e) { /* ignore */ }
      }
      // Construir array de links desde los campos sueltos de la tarea
      const linksArr = [];
      if (task && task.link) linksArr.push({ type: 'material', url: task.link, label: '' });
      if (task && task.videoLink) linksArr.push({ type: 'video', url: task.videoLink, label: '' });
      if (task && task.depositEntryId) {
        // Actualiza el doc existente Y sincroniza campos editables al deposito
        const update = {
          status: 'idea',
          categoryId: catId,
          categoryName: catName,
          subcategoryId: firebase.firestore.FieldValue.delete(),
          subcategoryName: firebase.firestore.FieldValue.delete(),
          finalizedAt: firebase.firestore.FieldValue.delete(),
          finalizedTaskId: firebase.firestore.FieldValue.delete()
        };
        // Sincronizar texto, links, cover y notas desde la tarea editada
        if (task.text) update.title = task.text;
        if (linksArr.length > 0) update.links = linksArr;
        if (task.coverImage) update.coverImage = task.coverImage;
        if (task.notes && typeof task.notes === 'string') update.description = task.notes;
        await db.collection('depositEntries').doc(task.depositEntryId).update(update);
      } else if (task) {
        // Crear nuevo entry en deposito mapeando al schema del deposito
        const entryData = {
          title: task.text || '',
          description: (typeof task.notes === 'string') ? task.notes : '',
          links: linksArr,
          coverImage: task.coverImage || '',
          status: 'idea',
          categoryId: catId,
          categoryName: catName,
          createdBy: currentUser.uid,
          createdByName: currentUserData.name,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          fromTrashedTaskId: task.id
        };
        await db.collection('depositEntries').add(entryData);
      }
      // Borrar la tarea (ya esta en el deposito ahora)
      await db.collection('tasks').doc(movingTrashTask.id).delete();
    } else if (movingTrashTask.kind === 'team' && targetValue.startsWith('project:')) {
      // Restaurar + cambiar projectId
      const projectId = targetValue.slice('project:'.length);
      const project = projects.find(p => p.id === projectId);
      const update = {
        deletedAt: firebase.firestore.FieldValue.delete(),
        deletedBy: firebase.firestore.FieldValue.delete(),
        deletedByName: firebase.firestore.FieldValue.delete(),
        projectId: projectId || firebase.firestore.FieldValue.delete(),
        projectName: project ? project.name : firebase.firestore.FieldValue.delete(),
        projectColor: project ? project.color : firebase.firestore.FieldValue.delete()
      };
      await db.collection('tasks').doc(movingTrashTask.id).update(update);
    } else if (movingTrashTask.kind === 'team') {
      // Backwards compat: si no tiene prefijo, asumir project
      const project = projects.find(p => p.id === targetValue);
      const update = {
        deletedAt: firebase.firestore.FieldValue.delete(),
        deletedBy: firebase.firestore.FieldValue.delete(),
        deletedByName: firebase.firestore.FieldValue.delete(),
        projectId: targetValue || firebase.firestore.FieldValue.delete(),
        projectName: project ? project.name : firebase.firestore.FieldValue.delete(),
        projectColor: project ? project.color : firebase.firestore.FieldValue.delete()
      };
      await db.collection('tasks').doc(movingTrashTask.id).update(update);
    } else {
      // Personal: restaurar + cambiar personalProject
      const update = {
        deletedAt: firebase.firestore.FieldValue.delete(),
        deletedBy: firebase.firestore.FieldValue.delete(),
        deletedByName: firebase.firestore.FieldValue.delete(),
        personalProject: targetValue || 'General'
      };
      await db.collection('personalTasks').doc(movingTrashTask.id).update(update);
    }
  } catch (e) {
    alert('Error moviendo: ' + e.message);
    return;
  }
  document.getElementById('moveTrashModal').classList.remove('active');
  movingTrashTask = null;
});

async function restoreTask(taskId) {
  // Buscar la tarea en la papelera para saber si venia del deposito
  const task = trashTasks.find(t => t.id === taskId) || tasks.find(t => t.id === taskId);
  await db.collection('tasks').doc(taskId).update({
    deletedAt: firebase.firestore.FieldValue.delete(),
    deletedBy: firebase.firestore.FieldValue.delete(),
    deletedByName: firebase.firestore.FieldValue.delete()
  });
  // Restaurar a "en proceso" (oculta del deposito) si la tarea no estaba completa
  if (task && task.status !== 'completed') {
    await syncDepositOnTaskChange(task, 're-convert');
  }
}
window.restoreTask = restoreTask;

async function permanentlyDeleteTask(taskId) {
  const task = trashTasks.find(t => t.id === taskId);
  if (!task) return;
  if (!confirm(`Eliminar PERMANENTEMENTE la tarea "${task.text}"?\n\nEsta accion no se puede deshacer.`)) return;
  await db.collection('tasks').doc(taskId).delete();
  // Si la tarea NO estaba completa, regresar la entry al deposito
  if (task.status !== 'completed') {
    await syncDepositOnTaskChange(task, 'restore');
  }
}
window.permanentlyDeleteTask = permanentlyDeleteTask;

async function deleteProject(projectId) {
  const project = projects.find(p => p.id === projectId);
  const taskCount = tasks.filter(t => t.projectId === projectId && t.status !== 'completed').length;

  if (taskCount > 0 && !confirm(`"${project.name}" tiene ${taskCount} tarea(s). Eliminar todo?`)) return;

  const batch = db.batch();
  batch.delete(db.collection('projects').doc(projectId));
  tasks.filter(t => t.projectId === projectId).forEach(t => {
    batch.delete(db.collection('tasks').doc(t.id));
  });
  await batch.commit();
}

async function createProject() {
  const name = el.projectNameInput.value.trim();
  if (!name) return;

  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#BB8FCE', '#85C1E9', '#F0B27A'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  await db.collection('projects').add({
    name: name,
    color: color,
    createdBy: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  hideProjectModal();
}

// ===== TELEGRAM HANDLERS =====
async function tgLinkUser({ chatId, email }) {
  const snapshot = await db.collection('users').where('email', '==', email).get();
  if (!snapshot.empty) {
    const userDoc = snapshot.docs[0];
    await db.collection('users').doc(userDoc.id).update({ telegramChatId: chatId });
    window.api.sendTelegramMessage(chatId, `Cuenta vinculada a *${userDoc.data().name}*`);
  } else {
    window.api.sendTelegramMessage(chatId, 'Email no encontrado. Registrate primero en la app.');
  }
}

async function tgAddTask({ chatId, projectName, taskText }) {
  const user = teamMembers.find(m => m.telegramChatId === chatId);
  if (!user) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero con /vincular tu@email.com'); return; }

  let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  if (!project) {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];
    const ref = await db.collection('projects').add({
      name: projectName,
      color: colors[Math.floor(Math.random() * colors.length)],
      createdBy: user.id,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    project = { id: ref.id, name: projectName, color: '#4ECDC4' };
  }

  await db.collection('tasks').add({
    text: taskText,
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color || '#4ECDC4',
    assignedTo: user.id,
    assignedToName: user.name,
    createdBy: user.id,
    createdByName: user.name,
    status: 'pending',
    source: 'telegram',
    notes: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  window.api.sendTelegramMessage(chatId, `Tarea agregada a *${project.name}*:\n${taskText}`);
}

async function tgAssignTask({ chatId, projectName, taskText, assignToEmail, dependsOnTaskId, dependsOnTaskText, dependsOnAssigneeName }) {
  const sender = teamMembers.find(m => m.telegramChatId === chatId);
  if (!sender) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }

  const assignee = teamMembers.find(m => m.email === assignToEmail);
  if (!assignee) { window.api.sendTelegramMessage(chatId, `Usuario *${assignToEmail}* no encontrado.`); return; }

  let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  if (!project) {
    const ref = await db.collection('projects').add({
      name: projectName, color: '#45B7D1', createdBy: sender.id,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    project = { id: ref.id, name: projectName, color: '#45B7D1' };
  }

  const taskData = {
    text: taskText, projectId: project.id, projectName: project.name,
    projectColor: project.color || '#45B7D1', assignedTo: assignee.id,
    assignedToName: assignee.name, createdBy: sender.id, createdByName: sender.name,
    status: 'pending', source: 'telegram', notes: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (dependsOnTaskId) {
    taskData.dependsOn = dependsOnTaskId;
    taskData.dependsOnText = dependsOnTaskText || '';
    taskData.dependsOnAssigneeName = dependsOnAssigneeName || '';
  }

  const ref = await db.collection('tasks').add(taskData);

  window.api.sendTelegramMessage(chatId, `Tarea asignada a *${assignee.name}*:\n${taskText}`);
  if (assignee.telegramChatId) {
    const depMsg = dependsOnTaskId ? `\nEn espera de *${dependsOnAssigneeName || 'otro miembro'}*: ${dependsOnTaskText || ''}` : '';
    window.api.sendTelegramMessage(assignee.telegramChatId, `*${sender.name}* te asigno una tarea:\n${taskText}\nProyecto: *${project.name}*${depMsg}`);
  }
  return ref.id;
}

async function tgAssignChain({ chatId, projectName, steps }) {
  const sender = teamMembers.find(m => m.telegramChatId === chatId);
  if (!sender) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }
  if (!Array.isArray(steps) || steps.length === 0) {
    window.api.sendTelegramMessage(chatId, 'No se indicaron pasos de la cadena.');
    return;
  }

  let previousTaskId = null;
  let previousText = null;
  let previousAssigneeName = null;
  const created = [];

  for (const step of steps) {
    const email = step.assign_to_email || step.assignToEmail;
    const text = step.task_text || step.taskText;
    if (!email || !text) continue;
    const id = await tgAssignTask({
      chatId,
      projectName,
      taskText: text,
      assignToEmail: email,
      dependsOnTaskId: previousTaskId,
      dependsOnTaskText: previousText,
      dependsOnAssigneeName: previousAssigneeName
    });
    if (!id) return;
    previousTaskId = id;
    previousText = text;
    const assignee = teamMembers.find(m => m.email === email);
    previousAssigneeName = assignee ? assignee.name : email;
    created.push(`${created.length + 1}. ${previousAssigneeName}: ${text}`);
  }

  window.api.sendTelegramMessage(chatId, `Cadena creada en *${projectName}*:\n${created.join('\n')}`);
}

async function tgGetMyTasks({ chatId }) {
  const user = teamMembers.find(m => m.telegramChatId === chatId);
  if (!user) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }
  const myTasks = tasks.filter(t => t.assignedTo === user.id && t.status !== 'completed');
  if (myTasks.length === 0) { window.api.sendTelegramMessage(chatId, 'No tienes tareas pendientes.'); return; }
  let msg = `*Tus tareas (${myTasks.length}):*\n\n`;
  myTasks.forEach((t, i) => { msg += `${i + 1}. ${t.text} (${t.projectName}) ${t.status === 'pending_approval' ? '[Esperando aprobacion]' : ''}\n`; });
  window.api.sendTelegramMessage(chatId, msg);
}

async function tgGetAllTasks({ chatId }) {
  const pending = tasks.filter(t => t.status !== 'completed');
  if (pending.length === 0) { window.api.sendTelegramMessage(chatId, 'No hay tareas pendientes en el equipo.'); return; }
  let msg = `*Todas las tareas (${pending.length}):*\n\n`;
  pending.forEach((t, i) => { msg += `${i + 1}. ${t.text} -> ${t.assignedToName} (${t.projectName})\n`; });
  window.api.sendTelegramMessage(chatId, msg);
}

async function tgCompleteTask({ chatId, taskIndex }) {
  const user = teamMembers.find(m => m.telegramChatId === chatId);
  if (!user) { window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero.'); return; }
  const myTasks = tasks.filter(t => t.assignedTo === user.id && t.status === 'pending');
  const idx = taskIndex - 1;
  if (idx < 0 || idx >= myTasks.length) { window.api.sendTelegramMessage(chatId, 'Numero de tarea no valido.'); return; }
  const task = myTasks[idx];
  await db.collection('tasks').doc(task.id).update({
    status: 'pending_approval',
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    submittedBy: user.id, submittedByName: user.name
  });
  window.api.sendTelegramMessage(chatId, `Tarea enviada para aprobacion: *${task.text}*`);
}

async function tgGetProjects({ chatId }) {
  if (projects.length === 0) { window.api.sendTelegramMessage(chatId, 'No hay proyectos.'); return; }
  let msg = '*Proyectos:*\n\n';
  projects.forEach(p => {
    const count = tasks.filter(t => t.projectId === p.id && t.status !== 'completed').length;
    msg += `*${p.name}* - ${count} tarea(s)\n`;
  });
  window.api.sendTelegramMessage(chatId, msg);
}

async function tgGetTeam({ chatId }) {
  if (teamMembers.length === 0) { window.api.sendTelegramMessage(chatId, 'No hay miembros.'); return; }
  let msg = '*Equipo:*\n\n';
  teamMembers.forEach(m => {
    const p = tasks.filter(t => t.assignedTo === m.id && t.status !== 'completed').length;
    msg += `*${m.name}* (${m.email}) - ${p} tareas\n`;
  });
  window.api.sendTelegramMessage(chatId, msg);
}

async function tgNaturalMessage({ chatId, text }) {
  const sender = teamMembers.find(m => m.telegramChatId === chatId);
  if (!sender) {
    window.api.sendTelegramMessage(chatId, 'Vincula tu cuenta primero con `/vincular tu@email.com`');
    return;
  }

  const myTasks = tasks.filter(t => t.assignedTo === sender.id && t.status === 'pending');
  const myTasksContext = myTasks.length
    ? myTasks.map((t, i) => `${i + 1}. [${t.projectName}] ${t.text}`).join('\n')
    : '(ninguna)';

  const systemPrompt = `Eres el cerebro de un bot de Telegram de gestion de tareas en equipo. Interpreta mensajes en espanol y ejecuta la accion correcta.

Usuario actual: ${sender.name} (${sender.email})

Proyectos existentes: ${projects.map(p => p.name).join(', ') || '(ninguno)'}

Miembros del equipo:
${teamMembers.map(m => `- ${m.name} (${m.email})`).join('\n')}

Tareas pendientes del usuario (numeradas para completar):
${myTasksContext}

Reglas:
- Si menciona a alguien por nombre, busca su email en la lista de miembros y usalo exacto
- Si menciona un proyecto, usa el nombre exacto de la lista; si no existe pero pide crearlo, puedes inventar un nombre
- Una tarea para "mi"/"yo" o sin destinatario claro => add_task
- Una tarea para otra persona => assign_task
- Dos o mas tareas encadenadas ("primero A, despues B", "X tiene que terminar antes de Y") => assign_chain_tasks con los pasos en orden
- Completar "la 1"/"la primera" => complete_task con index 1
- Saludos, preguntas, cosas que no son acciones => reply_message con una respuesta util y amable`;

  const tools = [
    {
      name: 'add_task',
      description: 'Crear una tarea para el usuario actual',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          task_text: { type: 'string' }
        },
        required: ['project_name', 'task_text']
      }
    },
    {
      name: 'assign_task',
      description: 'Crear una tarea y asignarla a otro miembro del equipo',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          task_text: { type: 'string' },
          assign_to_email: { type: 'string' }
        },
        required: ['project_name', 'task_text', 'assign_to_email']
      }
    },
    {
      name: 'assign_chain_tasks',
      description: 'Crear una cadena de tareas dependientes. Cada paso debe terminar antes que el siguiente. Usar cuando haya dos o mas personas que deben trabajar en secuencia.',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          steps: {
            type: 'array',
            description: 'Pasos en orden. Cada paso se ejecuta cuando termina el anterior.',
            items: {
              type: 'object',
              properties: {
                assign_to_email: { type: 'string' },
                task_text: { type: 'string' }
              },
              required: ['assign_to_email', 'task_text']
            }
          }
        },
        required: ['project_name', 'steps']
      }
    },
    {
      name: 'complete_task',
      description: 'Marcar una de las tareas pendientes del usuario como completada (envia a aprobacion)',
      input_schema: {
        type: 'object',
        properties: { task_index: { type: 'integer' } },
        required: ['task_index']
      }
    },
    {
      name: 'list_my_tasks',
      description: 'Listar las tareas del usuario actual',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'list_all_tasks',
      description: 'Listar todas las tareas pendientes del equipo',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'list_projects',
      description: 'Listar los proyectos y cuantas tareas tiene cada uno',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'list_team',
      description: 'Listar los miembros del equipo',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'reply_message',
      description: 'Responder al usuario con un mensaje de texto (saludos, preguntas, cuando no aplica otra accion)',
      input_schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      }
    }
  ];

  const result = await window.api.callClaude({ systemPrompt, userMessage: text, tools });

  if (result.error) {
    const errMsg = result.error === 'no-api-key'
      ? 'La IA no esta configurada. Usa los comandos /nueva, /asignar, /tareas, etc.'
      : `Error llamando a Claude: ${result.error}`;
    window.api.sendTelegramMessage(chatId, errMsg);
    return;
  }

  const input = result.input || {};
  switch (result.tool) {
    case 'add_task':
      await tgAddTask({ chatId, projectName: input.project_name, taskText: input.task_text });
      break;
    case 'assign_task':
      await tgAssignTask({ chatId, projectName: input.project_name, taskText: input.task_text, assignToEmail: input.assign_to_email });
      break;
    case 'assign_chain_tasks':
      await tgAssignChain({ chatId, projectName: input.project_name, steps: input.steps || [] });
      break;
    case 'complete_task':
      await tgCompleteTask({ chatId, taskIndex: input.task_index });
      break;
    case 'list_my_tasks':
      await tgGetMyTasks({ chatId });
      break;
    case 'list_all_tasks':
      await tgGetAllTasks({ chatId });
      break;
    case 'list_projects':
      await tgGetProjects({ chatId });
      break;
    case 'list_team':
      await tgGetTeam({ chatId });
      break;
    case 'reply_message':
      window.api.sendTelegramMessage(chatId, input.text || 'No entendi.');
      break;
    default:
      window.api.sendTelegramMessage(chatId, 'No supe que hacer con eso.');
  }
}

function initTelegramHandlers() {
  window.api.onTelegramLinkUser(tgLinkUser);
  window.api.onTelegramAddTask(tgAddTask);
  window.api.onTelegramAssignTask(tgAssignTask);
  window.api.onTelegramGetMyTasks(tgGetMyTasks);
  window.api.onTelegramGetAllTasks(tgGetAllTasks);
  window.api.onTelegramCompleteTask(tgCompleteTask);
  window.api.onTelegramGetProjects(tgGetProjects);
  window.api.onTelegramGetTeam(tgGetTeam);
  window.api.onTelegramNaturalMessage(tgNaturalMessage);
}

// ===== TELEGRAM SETTINGS =====
async function loadTelegramToken() {
  const token = await window.api.getTelegramToken();
  if (token) { el.telegramToken.value = token; updateTelegramStatus(true); }
}

el.saveTelegram.addEventListener('click', async () => {
  const token = el.telegramToken.value.trim();
  if (!token) return;
  await window.api.setTelegramToken(token);
  updateTelegramStatus(true);
  subscribeToNotificationQueue();
});

function updateTelegramStatus(connected) {
  const dot = el.telegramStatus.querySelector('.status-dot');
  const text = el.telegramStatus.querySelector('span:last-child');
  dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  text.textContent = connected ? 'Bot activo' : 'No conectado';
}

// ===== REMINDERS =====
async function loadReminderInterval() {
  const mins = await window.api.getReminderInterval();
  if (el.reminderInterval) el.reminderInterval.value = String(mins || 0);
  startRemindersTimer(mins);
}

function startRemindersTimer(minutes) {
  if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = null; }
  if (!minutes || minutes <= 0) return;
  reminderTimer = setInterval(sendReminders, minutes * 60 * 1000);
}

async function sendReminders() {
  for (const m of teamMembers) {
    if (!m.telegramChatId) continue;

    const teamPending = tasks.filter(t => {
      if (t.assignedTo !== m.id || t.status !== 'pending') return false;
      if (t.dependsOn) {
        const dep = tasks.find(x => x.id === t.dependsOn);
        if (dep && dep.status !== 'completed') return false;
      }
      return true;
    });

    let personalCount = 0;
    try {
      const snap = await db.collection('personalTasks')
        .where('ownerId', '==', m.id)
        .where('status', '==', 'pending').get();
      personalCount = snap.size;
    } catch (e) { /* ignore rule errors */ }

    if (teamPending.length === 0 && personalCount === 0) continue;

    const lines = [];
    if (teamPending.length > 0) {
      lines.push(`*Tareas del equipo (${teamPending.length})*:`);
      teamPending.slice(0, 10).forEach((t, i) => {
        lines.push(`${i + 1}. ${t.text} (${t.projectName})`);
      });
      if (teamPending.length > 10) lines.push(`...y ${teamPending.length - 10} mas`);
    }
    if (personalCount > 0) {
      lines.push(`${lines.length > 0 ? '\n' : ''}Tienes *${personalCount} personal(es)* pendientes en tu app.`);
    }

    window.api.sendTelegramMessage(m.telegramChatId, `⏰ *Recordatorio*\n\n${lines.join('\n')}`);
  }
}

if (el.saveReminder) {
  el.saveReminder.addEventListener('click', async () => {
    const mins = parseInt(el.reminderInterval.value) || 0;
    await window.api.setReminderInterval(mins);
    startRemindersTimer(mins);
    alert(mins ? `Recordatorios activados cada ${mins} minuto(s)` : 'Recordatorios desactivados');
  });
}

// ===== CLAUDE AI SETTINGS =====
async function loadClaudeStatus() {
  const status = await window.api.getClaudeApiKeyStatus();
  updateClaudeStatus(status);
}

el.saveClaudeKey.addEventListener('click', async () => {
  const key = el.claudeApiKey.value.trim();
  if (!key) return;
  await window.api.setClaudeApiKey(key);
  el.claudeApiKey.value = '';
  await loadClaudeStatus();
});

function updateClaudeStatus(label) {
  const dot = el.claudeStatus.querySelector('.status-dot');
  const text = el.claudeStatus.querySelector('span:last-child');
  const connected = !!label;
  dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  text.textContent = connected ? label : 'No configurada';
}

// ===== UI EVENTS =====
function handleAddClick() {
  if (currentNewMode === 'personal') addPersonalTask();
  else addTask();
}
el.addTaskBtn.addEventListener('click', handleAddClick);
el.taskInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleAddClick(); });

// ===== CHAIN (multi-step) MODAL =====
const chainModal = document.getElementById('chainModal');
const chainStepsContainer = document.getElementById('chainSteps');
const chainProjectSelect = document.getElementById('chainProjectSelect');

document.getElementById('chainBtn').addEventListener('click', openChainModal);
document.getElementById('addChainStep').addEventListener('click', () => addChainStepRow());
document.getElementById('cancelChain').addEventListener('click', closeChainModal);
document.getElementById('confirmChain').addEventListener('click', confirmChain);
chainModal.addEventListener('click', (e) => { if (e.target === chainModal) closeChainModal(); });

function openChainModal() {
  chainProjectSelect.innerHTML = '<option value="">Elige proyecto...</option>';
  projects.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    chainProjectSelect.appendChild(o);
  });
  if (el.projectSelect.value) chainProjectSelect.value = el.projectSelect.value;
  chainStepsContainer.innerHTML = '';
  addChainStepRow();
  addChainStepRow();
  chainModal.classList.add('active');
}

function closeChainModal() {
  chainModal.classList.remove('active');
  chainStepsContainer.innerHTML = '';
}

function addChainStepRow() {
  const row = document.createElement('div');
  row.className = 'chain-step-row';
  row.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)';
  const optionsHtml = teamMembers.map(m => `<option value="${m.id}">${esc(m.name)}${m.id === currentUser.uid ? ' (yo)' : ''}</option>`).join('');
  row.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center">
      <span class="chain-step-num" style="min-width:22px;color:var(--text-dim);font-size:12px;font-weight:600">1.</span>
      <input type="text" class="chain-step-text" placeholder="Descripcion del paso" style="flex:2;margin:0">
      <select class="chain-step-user" style="flex:1;margin:0">
        <option value="">Asignar a...</option>
        ${optionsHtml}
      </select>
      <button class="btn btn-ghost btn-small chain-step-remove" title="Quitar paso" style="color:var(--danger);padding:4px 8px">&times;</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-left:30px;flex-wrap:wrap">
      <span style="color:var(--text-dim);font-size:11px">Tipo:</span>
      <select class="chain-step-type" style="flex:0 0 130px;margin:0" title="Publicador no requiere aprobacion">
        <option value="editor">Editor</option>
        <option value="publicador">Publicador</option>
        <option value="investigador">Investigador</option>
        <option value="corrector">Corrector</option>
      </select>
      <span style="color:var(--text-dim);font-size:11px">Plazo:</span>
      <input type="number" class="chain-step-amount" placeholder="Cantidad" min="1" style="width:90px;padding:8px 12px;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;margin:0">
      <select class="chain-step-unit" style="flex:0 0 110px;margin:0">
        <option value="">Sin plazo</option>
        <option value="minutes">Minutos</option>
        <option value="hours">Horas</option>
        <option value="days">Dias</option>
      </select>
    </div>
  `;
  row.querySelector('.chain-step-remove').addEventListener('click', () => {
    row.remove();
    renumberChainSteps();
  });
  chainStepsContainer.appendChild(row);
  renumberChainSteps();
}

function renumberChainSteps() {
  Array.from(chainStepsContainer.children).forEach((row, i) => {
    const span = row.querySelector('.chain-step-num');
    if (span) span.textContent = (i + 1) + '.';
  });
}

async function confirmChain() {
  const projectId = chainProjectSelect.value;
  if (!projectId) {
    chainProjectSelect.style.borderColor = 'var(--danger)';
    setTimeout(() => chainProjectSelect.style.borderColor = '', 1500);
    return;
  }
  const project = projects.find(p => p.id === projectId);

  const rows = Array.from(chainStepsContainer.children);
  const steps = [];
  for (const row of rows) {
    const text = row.querySelector('.chain-step-text').value.trim();
    const userId = row.querySelector('.chain-step-user').value;
    const amount = parseInt(row.querySelector('.chain-step-amount').value);
    const unit = row.querySelector('.chain-step-unit').value;
    const type = row.querySelector('.chain-step-type')?.value || 'editor';
    if (!text || !userId) continue;
    let deadlineDate = null;
    if (amount && amount > 0 && unit) {
      deadlineDate = new Date();
      if (unit === 'minutes') deadlineDate.setMinutes(deadlineDate.getMinutes() + amount);
      else if (unit === 'hours') deadlineDate.setHours(deadlineDate.getHours() + amount);
      else deadlineDate.setDate(deadlineDate.getDate() + amount);
    }
    steps.push({ text, userId, deadlineDate, type });
  }
  if (steps.length < 2) {
    alert('Agrega al menos 2 pasos con texto y miembro asignado.');
    return;
  }

  let previousTaskId = null;
  let previousText = null;
  let previousAssigneeName = null;

  for (const step of steps) {
    const assignee = teamMembers.find(m => m.id === step.userId);
    if (!assignee) continue;

    const taskData = {
      text: step.text,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color || '#666',
      assignedTo: assignee.id,
      assignedToName: assignee.name,
      createdBy: currentUser.uid,
      createdByName: currentUserData.name,
      status: 'pending',
      source: 'app',
      assignmentType: step.type || 'editor',
      notes: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (previousTaskId) {
      taskData.dependsOn = previousTaskId;
      taskData.dependsOnText = previousText;
      taskData.dependsOnAssigneeName = previousAssigneeName;
    }
    if (step.deadlineDate) {
      taskData.deadline = firebase.firestore.Timestamp.fromDate(step.deadlineDate);
    }

    const ref = await db.collection('tasks').add(taskData);

    if (assignee.id !== currentUser.uid) {
      const depMsg = previousText ? `\nEn espera de *${previousAssigneeName}*: ${previousText}` : '';
      const dlMsg = step.deadlineDate ? `\nPlazo: *${step.deadlineDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}*` : '';
      notifyAssignedOrWarn(assignee,
        `Nueva tarea en cadena (*${currentUserData.name}*):\n${step.text}\nProyecto: *${project.name}*${dlMsg}${depMsg}`
      );
    }

    previousTaskId = ref.id;
    previousText = step.text;
    previousAssigneeName = assignee.name;
  }

  closeChainModal();
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const tabContent = document.getElementById('tab' + capitalize(currentTab));
    if (tabContent) tabContent.classList.add('active');
    if (currentTab === 'calendar') renderCalendar();
    if (currentTab === 'ideas') renderIdeas();
    if (currentTab === 'schedule') renderSchedule();
    if (currentTab === 'explorer') {
      // v3.11.2: el webview del explorer está embebido directamente en index.html
      // (no en iframe). Solo cargamos las categorías la primera vez.
      if (typeof window._explorerLoadCategories === 'function') window._explorerLoadCategories();
    }
    // v3.11.3: lazy-load de iframes para Depósito / Refs / Chat — antes eran
    // paneles laterales, ahora son tabs integrados.
    if (currentTab === 'deposit') {
      const ifr = document.getElementById('depositTabIframe');
      if (ifr && ifr.dataset.loaded !== '1') {
        ifr.src = buildIframeSrc('deposit.html');
        ifr.dataset.loaded = '1';
      }
    }
    if (currentTab === 'references') {
      const ifr = document.getElementById('referencesTabIframe');
      if (ifr && ifr.dataset.loaded !== '1') {
        ifr.src = buildIframeSrc('deposit.html?category=referencias');
        ifr.dataset.loaded = '1';
      }
    }
    if (currentTab === 'chatbot') {
      const ifr = document.getElementById('chatbotTabIframe');
      if (ifr && ifr.dataset.loaded !== '1') {
        ifr.src = buildIframeSrc('chatbot.html');
        ifr.dataset.loaded = '1';
      }
    }
    if (currentTab === 'chat') {
      const ifr = document.getElementById('chatTabIframe');
      if (ifr && ifr.dataset.loaded !== '1') {
        ifr.src = buildIframeSrc('chat.html');
        ifr.dataset.loaded = '1';
      }
    }
    if (currentTab === 'manychat') {
      // v3.11.9: ManyChat ahora embebido vía <webview> (bypasses iframe X-Frame-Options)
      if (typeof window._setupManyChat === 'function') window._setupManyChat();
    }
    syncSidebarActive();
  });
});

// ===== Sidebar lateral (v3.7.0): items disparan clicks en tabs/botones existentes
// y mantienen su estado activo + badges sincronizados con la nav-tab original.
function syncSidebarActive() {
  const activeTab = document.querySelector('.nav-tab.active');
  const activeKey = activeTab ? activeTab.dataset.tab : null;
  document.querySelectorAll('.sidebar-item[data-go-tab]').forEach(item => {
    item.classList.toggle('active', item.dataset.goTab === activeKey);
  });
}

function syncSidebarBadges() {
  // Mapa: badgeId del sidebar → badgeId del nav-tab original
  const map = {
    sbBadgeMain: 'mainBadge',
    sbBadgeMy: 'myBadge',
    sbBadgePersonal: 'personalBadge',
    sbBadgeIdeas: 'ideasBadge',
    sbBadgeSchedule: 'scheduleBadge',
    sbBadgeApproval: 'approvalBadge',
    sbBadgeChat: 'chatUnreadBadge',
    sbBadgeRefs: 'referencesUnreadBadge',
    sbBadgeDeposit: 'depositUnreadBadge'
  };
  Object.entries(map).forEach(([sbId, srcId]) => {
    const sb = document.getElementById(sbId);
    const src = document.getElementById(srcId);
    if (!sb) return;
    if (!src) { sb.style.display = 'none'; return; }
    const visible = window.getComputedStyle(src).display !== 'none' && (src.textContent || '').trim() !== '';
    if (visible) {
      sb.textContent = src.textContent;
      sb.style.display = 'flex';
    } else {
      sb.style.display = 'none';
    }
  });
}

document.querySelectorAll('.sidebar-item[data-go-tab]').forEach(item => {
  item.addEventListener('click', () => {
    const targetTab = document.querySelector(`.nav-tab[data-tab="${item.dataset.goTab}"]`);
    if (targetTab) targetTab.click();
  });
});
document.querySelectorAll('.sidebar-item[data-go-button]').forEach(item => {
  item.addEventListener('click', () => {
    const btn = document.getElementById(item.dataset.goButton);
    if (btn) btn.click();
  });
});

// ===== Multi-workspace (v3.8.0) — fundación =====
// 1) Asegurar workspace por defecto al primer arranque del owner
// 2) Listener real-time de la colección /workspaces
// 3) Switcher dropdown (workspace badge) que muestra todos los workspaces +
//    botón "Nuevo workspace"
// El switching todavía es VISUAL — los listeners de tareas/proyectos/etc no
// filtran por workspaceId hasta v3.8.1. Esto es para validar el flujo sin
// riesgo de perder data existente.
async function ensureDefaultWorkspace() {
  if (!currentUser || !currentUserData) return;
  // Solo el owner crea el workspace por defecto. Otros miembros lo heredan
  // cuando el admin los suma. El owner es la cuenta jainierrojas@gmail.com.
  const isOwner = (currentUser.email || '').toLowerCase() === 'jainierrojas@gmail.com';
  if (!isOwner) return;
  try {
    const snap = await db.collection('workspaces').limit(1).get();
    if (!snap.empty) return; // ya hay al menos un workspace
    // Crear "Mi Agencia" — todos los users existentes son miembros
    const usersSnap = await db.collection('users').get();
    const memberIds = usersSnap.docs.map(d => d.id);
    await db.collection('workspaces').add({
      name: 'Mi Agencia',
      ownerId: currentUser.uid,
      members: memberIds,
      color: '#4ecdc4',
      emoji: 'A',
      isDefault: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('[workspaces] default workspace creado');
  } catch (e) {
    console.warn('[workspaces] no se pudo crear default:', e.message);
  }
}

function subscribeWorkspaces() {
  if (unsubscribeWorkspaces) { unsubscribeWorkspaces(); unsubscribeWorkspaces = null; }
  unsubscribeWorkspaces = db.collection('workspaces').onSnapshot((snapshot) => {
    workspaces = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(w => Array.isArray(w.members) && w.members.includes(currentUser.uid));
    // Asignar workspace activo si todavía no hay uno
    if (!currentWorkspaceId && workspaces.length > 0) {
      const stored = localStorage.getItem('currentWorkspaceId');
      const found = workspaces.find(w => w.id === stored);
      currentWorkspaceId = found ? found.id : (workspaces.find(w => w.isDefault) || workspaces[0]).id;
      try { localStorage.setItem('currentWorkspaceId', currentWorkspaceId); } catch (e) {}
    }
    renderWorkspaceSwitcher();
    // v3.8.3: migrar config global → workspace default (idempotente)
    migrateGlobalConfigToDefaultWorkspace().catch(() => {});
    // v3.9.4: auto-marcar workspace más viejo como isDefault si ninguno lo tiene
    autoFixDefaultWorkspaceFlag().catch(() => {});
  }, (err) => {
    console.warn('[workspaces] error de listener:', err.message);
  });
}

function renderWorkspaceSwitcher() {
  const nameEl = document.getElementById('workspaceName');
  const emojiEl = document.getElementById('workspaceEmoji');
  const listEl = document.getElementById('workspaceDropdownList');
  const current = workspaces.find(w => w.id === currentWorkspaceId);
  if (current) {
    if (nameEl) nameEl.textContent = current.name || 'Workspace';
    if (emojiEl) {
      emojiEl.textContent = current.emoji || (current.name || 'W').charAt(0).toUpperCase();
      if (current.color) emojiEl.style.background = `linear-gradient(135deg, ${current.color}, ${current.color})`;
    }
  } else {
    if (nameEl) nameEl.textContent = 'Mi Agencia';
    if (emojiEl) emojiEl.textContent = 'A';
  }
  if (!listEl) return;
  if (workspaces.length === 0) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:8px;text-align:center">No tenés workspaces — creá uno</div>';
    return;
  }
  const isAdmin = currentUserData && currentUserData.role === 'admin';
  listEl.innerHTML = workspaces.map(w => {
    const isActive = w.id === currentWorkspaceId;
    const initial = (w.emoji || (w.name || 'W').charAt(0)).toUpperCase();
    const color = w.color || '#6c63ff';
    const canManage = isAdmin || w.ownerId === currentUser.uid;
    // v3.11.77: nuevo botón 👥 para gestionar miembros del workspace
    const membersBtn = canManage
      ? `<button class="ws-action-btn" data-ws-members="${esc(w.id)}" title="Gestionar miembros del workspace">👥</button>`
      : '';
    const editBtn = canManage
      ? `<button class="ws-action-btn" data-ws-rename="${esc(w.id)}" title="Renombrar workspace">✎</button>`
      : '';
    const delBtn = (canManage && !w.isDefault && workspaces.length > 1)
      ? `<button class="ws-action-btn" data-ws-delete="${esc(w.id)}" title="Eliminar workspace" style="color:var(--danger)">✕</button>`
      : '';
    return `
      <div class="workspace-dropdown-row ${isActive ? 'active' : ''}" data-ws-row="${esc(w.id)}">
        <button class="workspace-dropdown-item" data-ws-id="${esc(w.id)}">
          <span class="ws-emoji" style="background:linear-gradient(135deg,${color},${color})">${esc(initial)}</span>
          <span class="ws-name-text" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.name || 'Workspace')}</span>
          ${isActive ? '<span class="ws-check">✓</span>' : ''}
        </button>
        <div class="ws-actions" style="display:flex;gap:2px">${membersBtn}${editBtn}${delBtn}</div>
      </div>`;
  }).join('');
  listEl.querySelectorAll('[data-ws-id]').forEach(item => {
    item.addEventListener('click', () => switchWorkspace(item.dataset.wsId));
  });
  listEl.querySelectorAll('[data-ws-rename]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); renameWorkspace(btn.dataset.wsRename); });
  });
  listEl.querySelectorAll('[data-ws-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteWorkspace(btn.dataset.wsDelete); });
  });
  listEl.querySelectorAll('[data-ws-members]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openWorkspaceMembersModal(btn.dataset.wsMembers); });
  });
}

// v3.11.77: gestión de miembros del workspace — el admin agrega/quita usuarios
async function openWorkspaceMembersModal(workspaceId) {
  closeWorkspaceDropdown();
  const w = workspaces.find(x => x.id === workspaceId);
  if (!w) return;
  // Cargar lista actual de usuarios
  let allUsers = [];
  try {
    const snap = await db.collection('users').get();
    allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    alert('No se pudo cargar la lista de usuarios: ' + e.message);
    return;
  }
  const currentMembers = Array.isArray(w.members) ? w.members.slice() : [];
  const ownerId = w.ownerId || null;

  function render() {
    const memberRows = currentMembers.map(uid => {
      const u = allUsers.find(x => x.id === uid);
      const name = (u && (u.name || u.email)) || uid.slice(0, 10) + '...';
      const isOwner = uid === ownerId;
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-card);border-radius:6px;border:1px solid var(--border);margin-bottom:4px">
          <div style="flex:1;font-size:13px">${esc(name)}${isOwner ? ' <span style="color:#4ecdc4;font-size:10px">(dueño)</span>' : ''}</div>
          ${isOwner ? '' : `<button data-remove-uid="${esc(uid)}" style="background:transparent;color:#ff6b6b;border:1px solid rgba(255,107,107,0.3);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer">Quitar</button>`}
        </div>
      `;
    }).join('') || '<div style="color:#888;text-align:center;padding:12px">Sin miembros</div>';

    const nonMembers = allUsers.filter(u => !currentMembers.includes(u.id));
    const addOptions = nonMembers.map(u => `<option value="${esc(u.id)}">${esc(u.name || u.email)} (${esc(u.email || '')})</option>`).join('');
    return `
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Workspace: <strong style="color:var(--text-primary)">${esc(w.name)}</strong></div>
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Miembros actuales (${currentMembers.length})</div>
      <div style="max-height:200px;overflow-y:auto;margin-bottom:12px">${memberRows}</div>
      ${nonMembers.length > 0 ? `
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Agregar miembro</div>
      <div style="display:flex;gap:6px">
        <select id="_addMemberSelect" style="flex:1;padding:8px;border-radius:6px;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border)">${addOptions}</select>
        <button id="_addMemberBtn" style="background:var(--accent,#4ecdc4);color:#0a0c10;border:0;padding:8px 14px;border-radius:6px;font-weight:700;cursor:pointer">Agregar</button>
      </div>
      ` : '<div style="font-size:12px;color:#888;text-align:center;padding:8px">Todos los usuarios ya son miembros 🎉</div>'}
    `;
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;min-width:360px;max-width:90vw;max-height:80vh;overflow-y:auto">
      <div style="font-size:15px;font-weight:700;margin-bottom:14px;color:var(--text-primary)">👥 Gestionar miembros</div>
      <div id="_membersBody">${render()}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button id="_membersClose" style="background:transparent;color:var(--text-primary);border:1px solid var(--border);padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:600">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function rerenderBody() {
    const body = overlay.querySelector('#_membersBody');
    if (body) body.innerHTML = render();
    wireup();
  }
  function wireup() {
    overlay.querySelectorAll('[data-remove-uid]').forEach(b => {
      b.addEventListener('click', async () => {
        const uid = b.getAttribute('data-remove-uid');
        const idx = currentMembers.indexOf(uid);
        if (idx >= 0) currentMembers.splice(idx, 1);
        try {
          await db.collection('workspaces').doc(workspaceId).update({ members: currentMembers });
        } catch (e) { alert('Error: ' + e.message); }
        rerenderBody();
      });
    });
    const addBtn = overlay.querySelector('#_addMemberBtn');
    const addSel = overlay.querySelector('#_addMemberSelect');
    if (addBtn && addSel) {
      addBtn.addEventListener('click', async () => {
        const uid = addSel.value;
        if (!uid || currentMembers.includes(uid)) return;
        currentMembers.push(uid);
        try {
          await db.collection('workspaces').doc(workspaceId).update({ members: currentMembers });
        } catch (e) { alert('Error: ' + e.message); }
        rerenderBody();
      });
    }
  }
  wireup();

  overlay.querySelector('#_membersClose').addEventListener('click', () => {
    document.body.removeChild(overlay);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });
}

window.renameWorkspace = async function(workspaceId) {
  const w = workspaces.find(x => x.id === workspaceId);
  if (!w) return;
  // v3.11.18: prompt() en Electron con webPreferences ciertos puede no funcionar.
  // Reemplazamos con un modal inline simple y robusto.
  closeWorkspaceDropdown();
  const newName = await _showInlineInput('Renombrar workspace', 'Nuevo nombre:', w.name || '');
  if (newName === null) return;
  const trimmed = (newName || '').trim();
  if (!trimmed || trimmed === w.name) return;
  try {
    const newEmoji = trimmed.charAt(0).toUpperCase();
    await db.collection('workspaces').doc(workspaceId).update({
      name: trimmed,
      emoji: newEmoji
    });
  } catch (e) { alert('No se pudo renombrar: ' + e.message); }
};

// Modal inline reusable para inputs simples (reemplaza prompt() nativo)
function _showInlineInput(title, label, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--bg-card,#1a1d24);border:1px solid var(--border,rgba(255,255,255,0.08));border-radius:12px;padding:20px;min-width:320px;max-width:90vw;box-shadow:0 12px 40px rgba(0,0,0,0.5)">
        <div style="font-size:14px;font-weight:700;margin-bottom:6px;color:var(--text-primary,#f5f7fa)">${title}</div>
        <div style="font-size:11px;color:var(--text-secondary,#9aa3b2);margin-bottom:10px">${label}</div>
        <input type="text" id="_inlineInput" style="width:100%;padding:8px 10px;background:var(--bg-card,#20242c);border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:8px;color:var(--text-primary,#f5f7fa);font-family:inherit;font-size:13px" />
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button id="_inlineCancel" style="padding:7px 12px;background:transparent;color:var(--text-primary,#f5f7fa);border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">Cancelar</button>
          <button id="_inlineOk" style="padding:7px 12px;background:var(--accent,#4ecdc4);color:#0a0c10;border:0;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;font-family:inherit">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#_inlineInput');
    input.value = defaultValue || '';
    setTimeout(() => { input.focus(); input.select(); }, 50);
    const close = (val) => { try { document.body.removeChild(overlay); } catch (e) {} resolve(val); };
    overlay.querySelector('#_inlineCancel').addEventListener('click', () => close(null));
    overlay.querySelector('#_inlineOk').addEventListener('click', () => close(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value);
      else if (e.key === 'Escape') close(null);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  });
}

window.deleteWorkspace = async function(workspaceId) {
  const w = workspaces.find(x => x.id === workspaceId);
  if (!w) return;
  if (w.isDefault) { alert('El workspace por defecto no se puede eliminar.'); return; }
  if (workspaces.length === 1) { alert('No podés eliminar el único workspace que queda.'); return; }
  if (!confirm(`¿Eliminar el workspace "${w.name}"?\n\nLa data tagged con este workspace queda en Firestore pero no será visible. Esta acción no es reversible desde la UI.`)) return;
  try {
    await db.collection('workspaces').doc(workspaceId).delete();
    if (currentWorkspaceId === workspaceId) {
      // Cambiar al default o al primer disponible
      const def = workspaces.find(x => x.isDefault) || workspaces.find(x => x.id !== workspaceId);
      if (def) {
        currentWorkspaceId = def.id;
        try { localStorage.setItem('currentWorkspaceId', def.id); } catch (e) {}
        applyWorkspaceFilter();
        notifyIframesOfWorkspaceChange();
      }
    }
  } catch (e) { alert('No se pudo eliminar: ' + e.message); }
}

function switchWorkspace(workspaceId) {
  if (!workspaceId || workspaceId === currentWorkspaceId) {
    closeWorkspaceDropdown();
    return;
  }
  currentWorkspaceId = workspaceId;
  try { localStorage.setItem('currentWorkspaceId', workspaceId); } catch (e) {}
  renderWorkspaceSwitcher();
  closeWorkspaceDropdown();
  // v3.8.1: re-derivar arrays públicas y re-renderizar todo con el nuevo workspace
  applyWorkspaceFilter();
  // Notificar a iframes activos del cambio (chat / depósito) para que filtren
  notifyIframesOfWorkspaceChange();
  // v3.11.37: recargar config scoped al workspace (OpenAI key)
  if (typeof reloadOpenaiKeyOnWorkspaceChange === 'function') {
    reloadOpenaiKeyOnWorkspaceChange().catch(() => {});
  }
  console.log('[workspaces] switched to', workspaceId);
}

// Construye URL del iframe inyectando workspace + defaultWs (id del workspace default).
// El iframe usa esto para saber cuál es su workspace y cuál es el default.
function buildIframeSrc(baseSrc) {
  if (!baseSrc || baseSrc.startsWith('http')) return baseSrc;
  if (!currentWorkspaceId) return baseSrc;
  const defId = resolveDefaultWorkspaceId();
  const sep = baseSrc.includes('?') ? '&' : '?';
  let src = `${baseSrc}${sep}workspace=${encodeURIComponent(currentWorkspaceId)}`;
  if (defId) src += `&defaultWs=${encodeURIComponent(defId)}`;
  if (defId && currentWorkspaceId === defId) src += '&isDefault=1'; // backward compat
  return src;
}

// Comunica el cambio de workspace a los iframes activos (panel lateral)
// para que apliquen su propio filtro localmente.
function notifyIframesOfWorkspaceChange() {
  try {
    const iframe = document.getElementById('sidePanelIframe');
    const iframe2 = document.getElementById('sidePanelIframeSecondary');
    [iframe, iframe2].forEach(f => {
      if (!f || !f.dataset.currentKind) return;
      const kind = f.dataset.currentKind;
      let baseSrc;
      if (kind === 'pro-deposit' || kind === 'deposit') baseSrc = 'deposit.html';
      else if (kind === 'pro-chat' || kind === 'chat') baseSrc = 'chat.html';
      else if (kind === 'references') baseSrc = 'deposit.html?category=referencias';
      else return;
      f.src = buildIframeSrc(baseSrc);
    });
    // v3.11.3: también recargar los iframes embebidos como tabs
    const tabIframes = [
      { id: 'depositTabIframe', baseSrc: 'deposit.html' },
      { id: 'referencesTabIframe', baseSrc: 'deposit.html?category=referencias' },
      { id: 'chatTabIframe', baseSrc: 'chat.html' }
    ];
    tabIframes.forEach(({ id, baseSrc }) => {
      const f = document.getElementById(id);
      if (f && f.dataset.loaded === '1') f.src = buildIframeSrc(baseSrc);
    });
    // v3.11.4: recargar categorías del Explorer al cambiar workspace
    if (typeof window._explorerReloadCategories === 'function') {
      window._explorerReloadCategories();
    }
  } catch (e) { /* ignore */ }
}

function openWorkspaceDropdown() {
  const menu = document.getElementById('workspaceDropdownMenu');
  if (menu) menu.classList.add('open');
}
function closeWorkspaceDropdown() {
  const menu = document.getElementById('workspaceDropdownMenu');
  if (menu) menu.classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {
  // Toggle del badge
  const badge = document.getElementById('workspaceBadge');
  const menu = document.getElementById('workspaceDropdownMenu');
  if (badge && menu) {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('open');
      if (isOpen) {
        menu.classList.remove('open');
        return;
      }
      // v3.11.11: posicionar el menu como fixed para evitar el clipping del
      // overflow:hidden del sidebar. Anchor a la derecha del badge.
      const r = badge.getBoundingClientRect();
      menu.classList.add('open');
      menu.style.left = (r.right + 6) + 'px';
      menu.style.top = r.top + 'px';
      menu.style.right = 'auto';
      menu.style.bottom = 'auto';
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== badge && !badge.contains(e.target)) closeWorkspaceDropdown();
    });
  }

  // Modal nuevo workspace
  const newBtn = document.getElementById('newWorkspaceBtn');
  const newModal = document.getElementById('newWorkspaceModal');
  const newInput = document.getElementById('newWorkspaceName');
  const newErr = document.getElementById('newWorkspaceError');
  const cancelBtn = document.getElementById('cancelNewWorkspace');
  const confirmBtn = document.getElementById('confirmNewWorkspace');

  if (newBtn) newBtn.addEventListener('click', () => {
    closeWorkspaceDropdown();
    if (newModal) newModal.classList.add('active');
    if (newInput) { newInput.value = ''; setTimeout(() => newInput.focus(), 50); }
    if (newErr) newErr.textContent = '';
  });
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    if (newModal) newModal.classList.remove('active');
  });
  if (newModal) newModal.addEventListener('click', (e) => {
    if (e.target === newModal) newModal.classList.remove('active');
  });
  const submitNew = async () => {
    const name = (newInput.value || '').trim();
    if (!name) { newErr.textContent = 'Ingresá un nombre'; return; }
    if (name.length < 2) { newErr.textContent = 'Nombre demasiado corto'; return; }
    try {
      const ref = await db.collection('workspaces').add({
        name,
        ownerId: currentUser.uid,
        members: [currentUser.uid],
        color: '#6c63ff',
        emoji: name.charAt(0).toUpperCase(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      newModal.classList.remove('active');
      // Cambiar al workspace nuevo automáticamente
      currentWorkspaceId = ref.id;
      try { localStorage.setItem('currentWorkspaceId', ref.id); } catch (e) {}
    } catch (e) {
      newErr.textContent = 'Error: ' + e.message;
    }
  };
  if (confirmBtn) confirmBtn.addEventListener('click', submitNew);
  if (newInput) newInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitNew();
  });
});

// ===== User dropdown (v3.7.1): abrir/cerrar, items que disparan acciones existentes
function setupUserDropdown() {
  const toggle = document.getElementById('userDropdownToggle');
  const menu = document.getElementById('userDropdownMenu');
  if (!toggle || !menu) return;
  let isOpen = false;
  const close = () => { menu.classList.remove('open'); isOpen = false; };
  // v3.11.11: posicionar el menú como fixed (anchor a la derecha del toggle,
  // crece hacia ARRIBA porque el toggle está al final del sidebar).
  const open = () => {
    menu.classList.add('open');
    isOpen = true;
    const r = toggle.getBoundingClientRect();
    const menuHeight = 280; // estimación; el menu puede ser scrollable
    menu.style.left = (r.right + 6) + 'px';
    menu.style.top = Math.max(8, r.bottom - menuHeight) + 'px';
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
  };
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen ? close() : open();
  });
  document.addEventListener('click', (e) => {
    if (isOpen && !menu.contains(e.target) && !toggle.contains(e.target)) close();
  });
  // Items con data-go-tab dentro del dropdown
  menu.querySelectorAll('[data-go-tab]').forEach(item => {
    item.addEventListener('click', () => {
      close();
      const t = document.querySelector(`.nav-tab[data-tab="${item.dataset.goTab}"]`);
      if (t) t.click();
    });
  });
  // Modo PRO y Logout: clickean los botones legacy escondidos (mantienen su lógica)
  const proItem = document.getElementById('dropdownProMode');
  if (proItem) proItem.addEventListener('click', () => {
    close();
    const btn = document.getElementById('proModeBtn');
    if (btn) btn.click();
  });
  const logoutItem = document.getElementById('dropdownLogout');
  if (logoutItem) logoutItem.addEventListener('click', () => {
    close();
    const btn = document.getElementById('logoutBtn');
    if (btn) btn.click();
  });
}
document.addEventListener('DOMContentLoaded', setupUserDropdown);

// Sincroniza datos del usuario al avatar grande del dropdown + email
function syncUserDropdownInfo() {
  const nameBig = document.getElementById('userNameBig');
  const avatarBig = document.getElementById('userAvatarBig');
  const emailEl = document.getElementById('userEmailDropdown');
  if (currentUserData) {
    if (nameBig) nameBig.textContent = currentUserData.name || 'Usuario';
    if (avatarBig) avatarBig.textContent = (currentUserData.name || 'U').charAt(0).toUpperCase();
    if (emailEl) emailEl.textContent = currentUserData.email || '';
  }
}

// Mirror badges en cada repaint relevante. Reusamos un MutationObserver sobre
// los badges originales para que cualquier cambio se propague sin que tengamos
// que llamar manualmente desde cada función de render.
function setupSidebarBadgeMirror() {
  const sourceIds = ['mainBadge', 'myBadge', 'personalBadge', 'ideasBadge', 'scheduleBadge', 'approvalBadge', 'chatUnreadBadge', 'referencesUnreadBadge', 'depositUnreadBadge'];
  sourceIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const obs = new MutationObserver(() => syncSidebarBadges());
    obs.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  });
  // Primer sync al cargar
  syncSidebarBadges();
  syncSidebarActive();
}
document.addEventListener('DOMContentLoaded', setupSidebarBadgeMirror);
// También intentar después de un breve delay por si los IDs aún no existían al DOMContentLoaded
setTimeout(setupSidebarBadgeMirror, 1000);

// ===== Programacion: handlers de UI =====
document.querySelectorAll('.schedule-view-btn[data-schedule-view]').forEach(b => {
  b.addEventListener('click', () => setScheduleView(b.dataset.scheduleView));
});
const newScheduleBtnEl = document.getElementById('newScheduleBtn');
if (newScheduleBtnEl) newScheduleBtnEl.addEventListener('click', openScheduleModalManual);
const schedCancelBtn = document.getElementById('schedCancel');
if (schedCancelBtn) {
  schedCancelBtn.addEventListener('click', async () => {
    // Si hay contenido y NO estamos editando un draft (donde "cancelar" mantiene el doc),
    // preguntar si el usuario quiere guardar antes de cerrar para no perder lo subido.
    const isEditingDraft = editingPostId && (() => {
      const p = scheduledPosts.find(x => x.id === editingPostId);
      return p && scheduleStatusNorm(p.status) === 'draft';
    })();
    if (!isEditingDraft && scheduleModalHasContent()) {
      const choice = confirm('Tienes contenido sin guardar. ¿Guardar como borrador antes de cerrar?\n\nOK = Guardar borrador y cerrar\nCancelar = Cerrar sin guardar (pierdes lo no programado)');
      if (choice) {
        const ok = await saveScheduleAsDraft();
        if (!ok) return; // si fallo, no cerrar
      }
    }
    closeScheduleModal();
  });
}
const schedConfirmBtn = document.getElementById('schedConfirm');
if (schedConfirmBtn) schedConfirmBtn.addEventListener('click', confirmSchedulePost);
const schedSaveDraftBtn = document.getElementById('schedSaveDraft');
if (schedSaveDraftBtn) {
  schedSaveDraftBtn.addEventListener('click', async () => {
    schedSaveDraftBtn.disabled = true;
    const original = schedSaveDraftBtn.innerHTML;
    schedSaveDraftBtn.innerHTML = '⏳ Guardando...';
    try {
      const ok = await saveScheduleAsDraft();
      if (ok) {
        closeScheduleModal();
        const schedTab = document.querySelector('.nav-tab[data-tab="schedule"]');
        if (schedTab) schedTab.click();
      }
    } finally {
      schedSaveDraftBtn.disabled = false;
      schedSaveDraftBtn.innerHTML = original;
    }
  });
}
const schedModal = document.getElementById('scheduleModal');
if (schedModal) schedModal.addEventListener('click', (e) => { if (e.target === schedModal) closeScheduleModal(); });

// Libreria de copys: filtro carpeta + boton guardar copy actual
const schedCaptionFolderFilter = document.getElementById('schedCaptionFolderFilter');
if (schedCaptionFolderFilter) {
  schedCaptionFolderFilter.addEventListener('change', () => renderCaptionLibrary());
}
const schedSaveCaptionBtn = document.getElementById('schedSaveCaptionBtn');
if (schedSaveCaptionBtn) {
  schedSaveCaptionBtn.addEventListener('click', () => openCaptionTplModalForCreate());
}
// Modal crear/editar copy
document.getElementById('cancelCaptionTpl').addEventListener('click', () => {
  document.getElementById('captionTemplateModal').classList.remove('active');
  editingCaptionTplId = null;
});
document.getElementById('captionTemplateModal').addEventListener('click', (e) => {
  if (e.target.id === 'captionTemplateModal') {
    document.getElementById('captionTemplateModal').classList.remove('active');
    editingCaptionTplId = null;
  }
});
document.getElementById('confirmCaptionTpl').addEventListener('click', saveCaptionTpl);
document.getElementById('deleteCaptionTpl').addEventListener('click', deleteCaptionTpl);
const schedMediaUrlInput = document.getElementById('schedMediaUrl');
if (schedMediaUrlInput) {
  schedMediaUrlInput.addEventListener('input', () => {
    const url = schedMediaUrlInput.value.trim();
    const previewBox = document.getElementById('scheduleMediaPreview');
    const previewImg = document.getElementById('scheduleMediaImg');
    if (url) {
      previewBox.style.display = 'block';
      renderMediaInto(previewImg, url);
    } else {
      previewBox.style.display = 'none';
      renderMediaInto(previewImg, '');
    }
  });
}
// Cambio de tipo de post: mostrar/ocultar campos segun corresponda
document.querySelectorAll('input[name="schedPostType"]').forEach(r => {
  r.addEventListener('change', (e) => applyPostTypeToModal(e.target.value));
});
// Boton +Anadir imagen: agrega una nueva fila al final
const schedAddCarouselBtn = document.getElementById('schedAddCarouselUrl');
if (schedAddCarouselBtn) {
  schedAddCarouselBtn.addEventListener('click', () => {
    addCarouselInputRow('');
    renderCarouselGallery();
  });
}

// Listener IPC: el deposito pide programar una entry → abrir modal pre-llenado
if (window.api && window.api.onScheduleFromEntry) {
  window.api.onScheduleFromEntry((data) => {
    openScheduleModalForEntry(data);
  });
}
// Calendar nav
const schedPrev = document.getElementById('schedCalPrev');
if (schedPrev) schedPrev.addEventListener('click', () => { schedCalDate.setMonth(schedCalDate.getMonth() - 1); renderSchedule(); });
const schedNext = document.getElementById('schedCalNext');
if (schedNext) schedNext.addEventListener('click', () => { schedCalDate.setMonth(schedCalDate.getMonth() + 1); renderSchedule(); });
const schedToday = document.getElementById('schedCalToday');
if (schedToday) schedToday.addEventListener('click', () => { schedCalDate = new Date(); renderSchedule(); });

// Click delegado: boton "Programar" en la lista de tareas completadas
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-schedule-task]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  openScheduleModal(btn.dataset.scheduleTask);
});

// Settings: webhook de Make
const makeWebhookInput = document.getElementById('makeWebhookInput');
const saveMakeWebhookBtn = document.getElementById('saveMakeWebhook');
const testMakeWebhookBtn = document.getElementById('testMakeWebhook');
const makeStatusEl = document.getElementById('makeStatus');
function setMakeStatus(connected, msg) {
  if (!makeStatusEl) return;
  const dot = makeStatusEl.querySelector('.status-dot');
  const text = makeStatusEl.querySelector('span:last-child');
  if (dot) { dot.classList.toggle('connected', !!connected); dot.classList.toggle('disconnected', !connected); }
  if (text) text.textContent = msg;
}
if (window.api && window.api.getMakeWebhook && makeWebhookInput) {
  window.api.getMakeWebhook().then(async url => {
    makeWebhookInput.value = url || '';
    setMakeStatus(!!url, url ? 'Configurado' : 'No configurado');
    // Sync a Firestore (config/instagram) si la Cloud Function aun no lo conoce.
    // Asi v2.86.0 levanta sin necesidad de que el usuario reabra Settings.
    if (url && db && currentUser) {
      try {
        const snap = await wsConfigRef('instagram').get();
        const remote = snap.exists ? snap.data().makeWebhookUrl : null;
        if (remote !== url) {
          await wsConfigRef('instagram').set({
            makeWebhookUrl: url,
            updatedBy: currentUser.email,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      } catch (e) { /* ignorar, no es critico */ }
    }
  });
}
if (saveMakeWebhookBtn) {
  saveMakeWebhookBtn.addEventListener('click', async () => {
    const url = makeWebhookInput.value.trim();
    const result = await window.api.setMakeWebhook(url);
    if (result && result.ok) {
      // Tambien guardar en Firestore para que la Cloud Function lo use
      try {
        await wsConfigRef('instagram').set({
          makeWebhookUrl: url,
          updatedBy: currentUser ? currentUser.email : null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) {
        console.warn('No se pudo guardar webhook en Firestore:', e.message);
      }
      setMakeStatus(!!url, url ? 'Configurado' : 'No configurado');
      alert('Webhook guardado');
    } else {
      alert('Error: ' + (result && result.error));
    }
  });
}
// ===== GHL TikTok webhook: cargar al abrir Settings, guardar + sync a Firestore =====
const ghlTiktokWebhookInput = document.getElementById('ghlTiktokWebhookInput');
const saveGhlTiktokWebhookBtn = document.getElementById('saveGhlTiktokWebhook');
const ghlTiktokStatusEl = document.getElementById('ghlTiktokStatus');
function setGhlTiktokStatus(connected, msg) {
  if (!ghlTiktokStatusEl) return;
  const dot = ghlTiktokStatusEl.querySelector('.status-dot');
  const text = ghlTiktokStatusEl.querySelector('span:last-child');
  if (dot) { dot.classList.toggle('connected', !!connected); dot.classList.toggle('disconnected', !connected); }
  if (text) text.textContent = msg;
}
if (window.api && window.api.getGhlTiktokWebhook && ghlTiktokWebhookInput) {
  window.api.getGhlTiktokWebhook().then(async url => {
    ghlTiktokWebhookInput.value = url || '';
    setGhlTiktokStatus(!!url, url ? 'Configurado' : 'No configurado');
    // Sync a Firestore (config/instagram, mismo doc) para que la Cloud Function
    // tenga la URL sin esperar al proximo guardado manual.
    if (url && db && currentUser) {
      try {
        const snap = await wsConfigRef('instagram').get();
        const remote = snap.exists ? snap.data().ghlTiktokWebhookUrl : null;
        if (remote !== url) {
          await wsConfigRef('instagram').set({
            ghlTiktokWebhookUrl: url,
            updatedBy: currentUser.email,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      } catch (e) { /* no critico */ }
    }
  });
}
if (saveGhlTiktokWebhookBtn) {
  saveGhlTiktokWebhookBtn.addEventListener('click', async () => {
    const url = ghlTiktokWebhookInput.value.trim();
    const result = await window.api.setGhlTiktokWebhook(url);
    if (result && result.ok) {
      try {
        await wsConfigRef('instagram').set({
          ghlTiktokWebhookUrl: url,
          updatedBy: currentUser ? currentUser.email : null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) {
        console.warn('No se pudo guardar GHL webhook en Firestore:', e.message);
      }
      setGhlTiktokStatus(!!url, url ? 'Configurado' : 'No configurado');
      alert('Webhook GHL TikTok guardado');
    } else {
      alert('Error: ' + (result && result.error));
    }
  });
}

// ===== Cloudinary config: cargar al abrir Settings, guardar al click, sync Firestore =====
const cloudinaryCloudNameInput = document.getElementById('cloudinaryCloudName');
const cloudinaryUploadPresetInput = document.getElementById('cloudinaryUploadPreset');
const saveCloudinaryConfigBtn = document.getElementById('saveCloudinaryConfig');
const cloudinaryStatusEl = document.getElementById('cloudinaryStatus');
function setCloudinaryStatus(connected, msg) {
  if (!cloudinaryStatusEl) return;
  const dot = cloudinaryStatusEl.querySelector('.status-dot');
  const text = cloudinaryStatusEl.querySelector('span:last-child');
  if (dot) { dot.classList.toggle('connected', !!connected); dot.classList.toggle('disconnected', !connected); }
  if (text) text.textContent = msg;
}
if (window.api && window.api.getCloudinaryConfig && cloudinaryCloudNameInput) {
  window.api.getCloudinaryConfig().then(cfg => {
    if (cfg && cfg.cloudName) cloudinaryCloudNameInput.value = cfg.cloudName;
    if (cfg && cfg.uploadPreset) cloudinaryUploadPresetInput.value = cfg.uploadPreset;
    const ok = !!(cfg && cfg.cloudName && cfg.uploadPreset);
    setCloudinaryStatus(ok, ok ? 'Configurado' : 'No configurado');
  });
}
if (saveCloudinaryConfigBtn) {
  saveCloudinaryConfigBtn.addEventListener('click', async () => {
    const cloudName = (cloudinaryCloudNameInput.value || '').trim();
    const uploadPreset = (cloudinaryUploadPresetInput.value || '').trim();
    if (!cloudName || !uploadPreset) { alert('Cloud name y Upload preset son obligatorios'); return; }
    const result = await window.api.setCloudinaryConfig({ cloudName, uploadPreset });
    if (!result || !result.ok) { alert('Error: ' + (result && result.error)); return; }
    // Sync a Firestore para que el equipo lo herede
    try {
      await wsConfigRef('cloudinary').set({
        cloudName,
        uploadPreset,
        updatedBy: currentUser ? currentUser.email : null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) { console.warn('No se pudo sincronizar Cloudinary config a Firestore:', e.message); }
    setCloudinaryStatus(true, 'Configurado');
    alert('Cloudinary configurado');
  });
}

// Sync de Firestore -> local store al login (analogo al de Make webhook).
// Si Firestore tiene config y el local no, se copia local. Asi cualquier
// miembro del equipo hereda automaticamente la cuenta de Cloudinary.
async function syncCloudinaryConfigFromFirestore() {
  try {
    if (!window.api || !window.api.getCloudinaryConfig || !db || !currentUser) return;
    const local = await window.api.getCloudinaryConfig();
    const snap = await wsConfigRef('cloudinary').get();
    if (!snap.exists) return;
    const remote = snap.data();
    const remoteCloudName = (remote && remote.cloudName) || '';
    const remoteUploadPreset = (remote && remote.uploadPreset) || '';
    if (!remoteCloudName || !remoteUploadPreset) return;
    // Si local esta vacio o difiere, actualizar local
    if (local.cloudName !== remoteCloudName || local.uploadPreset !== remoteUploadPreset) {
      await window.api.setCloudinaryConfig({ cloudName: remoteCloudName, uploadPreset: remoteUploadPreset });
      if (cloudinaryCloudNameInput) cloudinaryCloudNameInput.value = remoteCloudName;
      if (cloudinaryUploadPresetInput) cloudinaryUploadPresetInput.value = remoteUploadPreset;
      setCloudinaryStatus(true, 'Configurado');
      console.log('[sync] Cloudinary config sincronizado desde Firestore');
    }
  } catch (e) {
    console.warn('[sync] No se pudo leer Cloudinary config de Firestore:', e.message);
  }
}

// ===== OpenAI API key (v3.9.0): para transcripción de videos via Whisper =====
const openaiApiKeyInput = document.getElementById('openaiApiKey');
const saveOpenaiKeyBtn = document.getElementById('saveOpenaiKey');
const openaiStatusEl = document.getElementById('openaiStatus');

function setOpenaiStatus(connected, label) {
  if (!openaiStatusEl) return;
  const dot = openaiStatusEl.querySelector('.status-dot');
  const text = openaiStatusEl.querySelector('span:last-child');
  if (dot) dot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
  if (text) text.textContent = label;
}

// v3.11.37: en Windows el workspace tarda más en cargar — esperar hasta que
// currentWorkspaceId esté seteado antes de leer config/openai_{wsId}. Sin esto,
// la key se lee del doc global vacío y la UI muestra "No configurado" aunque
// Firestore la tenga guardada.
async function _waitForWorkspaceReady(maxMs = 15000) {
  if (currentWorkspaceId) return true;
  const start = Date.now();
  while (!currentWorkspaceId && (Date.now() - start) < maxMs) {
    await new Promise(r => setTimeout(r, 250));
  }
  return !!currentWorkspaceId;
}

async function loadOpenaiKey() {
  try {
    setOpenaiStatus(false, 'Cargando...');
    await _waitForWorkspaceReady();
    if (!currentWorkspaceId) { setOpenaiStatus(false, 'No hay workspace activo'); return; }
    const snap = await wsConfigRef('openai').get();
    if (!snap.exists) { setOpenaiStatus(false, 'No configurado'); return; }
    const rawKey = (snap.data() || {}).apiKey || '';
    const key = rawKey.trim(); // v3.11.42: trim defensivo
    if (key && openaiApiKeyInput) {
      openaiApiKeyInput.value = key.slice(0, 7) + '...' + key.slice(-4); // máscara
      openaiApiKeyInput.dataset.realKey = key;
      // v3.11.40: identificar provider (OpenAI vs Groq) en el label
      const providerLabel = key.startsWith('gsk_') ? 'Groq' : 'OpenAI';
      setOpenaiStatus(true, 'Configurado (' + providerLabel + ')');
    } else {
      setOpenaiStatus(false, 'No configurado');
    }
  } catch (e) {
    setOpenaiStatus(false, 'Error: ' + e.message);
  }
}
if (saveOpenaiKeyBtn) {
  saveOpenaiKeyBtn.addEventListener('click', async () => {
    const value = (openaiApiKeyInput.value || '').trim();
    if (!value || value.includes('...')) { alert('Pegá una API key nueva.'); return; }
    // v3.11.40: aceptar OpenAI (sk-...) o Groq (gsk_...) — Groq es alternativa
    // para países bloqueados por OpenAI, mismo API, gratis.
    const isOpenAI = value.startsWith('sk-');
    const isGroq = value.startsWith('gsk_');
    if (!isOpenAI && !isGroq) {
      alert('La API key debe empezar con sk- (OpenAI) o gsk_ (Groq).\n\nSi OpenAI te bloquea por país, andá a console.groq.com (gratis) y pegá la key de ahí.');
      return;
    }
    try {
      await wsConfigRef('openai').set({
        apiKey: value,
        provider: isGroq ? 'groq' : 'openai',
        updatedBy: currentUser.email,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      openaiApiKeyInput.dataset.realKey = value;
      openaiApiKeyInput.value = value.slice(0, 7) + '...' + value.slice(-4);
      setOpenaiStatus(true, 'Configurado (' + (isGroq ? 'Groq' : 'OpenAI') + ')');
      alert((isGroq ? 'Groq' : 'OpenAI') + ' API key guardada para este workspace.');
    } catch (e) { alert('Error: ' + e.message); }
  });
}
// Al cambiar de workspace, recargar la key
async function reloadOpenaiKeyOnWorkspaceChange() {
  if (openaiApiKeyInput) {
    openaiApiKeyInput.value = '';
    delete openaiApiKeyInput.dataset.realKey;
  }
  await loadOpenaiKey();
}

// Helper público para que el iframe del depósito acceda a la API key.
// v3.11.37: esperar workspace ready — en Windows el iframe llamaba antes de
// que currentWorkspaceId estuviera seteado y devolvía null → modal mostraba
// "Configurá tu OpenAI API key" aunque Firestore la tuviera guardada.
// v3.11.42: trim defensivo — keys pegadas con espacios/newlines rompían
// startsWith('gsk_') y ruteaban a OpenAI por error.
window._getOpenaiApiKey = async function() {
  try {
    await _waitForWorkspaceReady();
    if (!currentWorkspaceId) return null;
    const snap = await wsConfigRef('openai').get();
    if (!snap.exists) return null;
    const raw = (snap.data() || {}).apiKey || null;
    return raw ? raw.trim() : null;
  } catch (e) { return null; }
};

// v3.11.37: cargar la API key apenas el workspace esté listo (en lugar de un
// setTimeout fijo de 1500ms que en Windows lento se ejecutaba antes de tiempo).
loadOpenaiKey();

// v3.11.53: feature "Conectar Instagram" removido — ahora la app usa scrapers
// públicos (snapinsta / tikwm) que no requieren auth ni setup.

// ===== Botones de upload en el modal Programar =====
const schedUploadSingleBtn = document.getElementById('schedUploadSingleBtn');
const schedSingleFileInput = document.getElementById('schedSingleFileInput');
const schedSingleUploadStatus = document.getElementById('schedSingleUploadStatus');
if (schedUploadSingleBtn && schedSingleFileInput) {
  schedUploadSingleBtn.addEventListener('click', () => schedSingleFileInput.click());
  schedSingleFileInput.addEventListener('change', async () => {
    const file = schedSingleFileInput.files && schedSingleFileInput.files[0];
    if (!file) return;
    schedSingleUploadStatus.style.display = 'block';
    schedSingleUploadStatus.textContent = `⏳ Subiendo ${file.name}... 0%`;
    schedUploadSingleBtn.disabled = true;
    try {
      const result = await uploadToCloudinary(file, (pct) => {
        schedSingleUploadStatus.textContent = `⏳ Subiendo ${file.name}... ${pct}%`;
      });
      document.getElementById('schedMediaUrl').value = result.url;
      // Trigger input event para que el preview se actualice
      document.getElementById('schedMediaUrl').dispatchEvent(new Event('input', { bubbles: true }));
      schedSingleUploadStatus.textContent = `✅ Subido (${(result.bytes / 1024).toFixed(0)} KB)`;
      setTimeout(() => { schedSingleUploadStatus.style.display = 'none'; }, 3000);
    } catch (e) {
      schedSingleUploadStatus.textContent = `❌ Error: ${e.message}`;
      schedSingleUploadStatus.style.color = 'var(--danger)';
    } finally {
      schedUploadSingleBtn.disabled = false;
      schedSingleFileInput.value = ''; // permite volver a elegir el mismo archivo
    }
  });
}
const schedUploadMultiBtn = document.getElementById('schedUploadMultiBtn');
const schedMultiFileInput = document.getElementById('schedMultiFileInput');
const schedCarouselUploadStatus = document.getElementById('schedCarouselUploadStatus');
if (schedUploadMultiBtn && schedMultiFileInput) {
  schedUploadMultiBtn.addEventListener('click', () => schedMultiFileInput.click());
  schedMultiFileInput.addEventListener('change', async () => {
    const files = Array.from(schedMultiFileInput.files || []);
    if (files.length === 0) return;
    if (files.length > CAROUSEL_MAX) {
      alert(`Maximo ${CAROUSEL_MAX} archivos por carrusel`);
      return;
    }
    schedCarouselUploadStatus.style.display = 'block';
    schedCarouselUploadStatus.style.color = '';
    schedUploadMultiBtn.disabled = true;
    const urls = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      schedCarouselUploadStatus.textContent = `⏳ Subiendo ${i + 1}/${files.length}: ${f.name}... 0%`;
      try {
        const result = await uploadToCloudinary(f, (pct) => {
          schedCarouselUploadStatus.textContent = `⏳ Subiendo ${i + 1}/${files.length}: ${f.name}... ${pct}%`;
        });
        urls.push(result.url);
      } catch (e) {
        schedCarouselUploadStatus.textContent = `❌ ${f.name}: ${e.message}`;
        schedCarouselUploadStatus.style.color = 'var(--danger)';
        schedUploadMultiBtn.disabled = false;
        schedMultiFileInput.value = '';
        return;
      }
    }
    // Llenar todas las casillas de carrusel con las URLs subidas
    resetCarouselInputs(urls);
    schedCarouselUploadStatus.textContent = `✅ ${urls.length} archivos subidos`;
    setTimeout(() => { schedCarouselUploadStatus.style.display = 'none'; }, 3000);
    schedUploadMultiBtn.disabled = false;
    schedMultiFileInput.value = '';
  });
}

if (testMakeWebhookBtn) {
  testMakeWebhookBtn.addEventListener('click', async () => {
    testMakeWebhookBtn.disabled = true;
    testMakeWebhookBtn.textContent = '⏳ Enviando...';
    try {
      const result = await window.api.sendToMakeWebhook({
        test: true,
        platform: 'instagram',
        postType: 'post',
        caption: 'Test desde Task Manager',
        mediaUrl: 'https://placehold.co/1080x1080.jpg',
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        triggeredBy: currentUserData ? currentUserData.name : 'tester'
      });
      if (result && result.ok) {
        alert(`✓ Webhook respondio OK (HTTP ${result.status}). Revisa en Make.com que el escenario se ejecutó.`);
        setMakeStatus(true, 'Conectado');
      } else {
        alert('Webhook fallo: ' + ((result && result.error) || 'desconocido'));
        setMakeStatus(false, 'Error');
      }
    } finally {
      testMakeWebhookBtn.disabled = false;
      testMakeWebhookBtn.innerHTML = '&#128293; Probar webhook';
    }
  });
}

// ESC cierra el modal de programacion
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const m = document.getElementById('scheduleModal');
    if (m && m.classList.contains('active')) closeScheduleModal();
  }
});

// ===== Ideas: handlers de UI =====
document.querySelectorAll('.ideas-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => setIdeasMode(btn.dataset.ideasMode));
});
const addIdeaBtn = document.getElementById('addIdeaBtn');
if (addIdeaBtn) addIdeaBtn.addEventListener('click', addIdea);
const cancelEditIdeaBtnEl = document.getElementById('cancelEditIdeaBtn');
if (cancelEditIdeaBtnEl) cancelEditIdeaBtnEl.addEventListener('click', cancelEditIdea);
const ideaTextInputEl = document.getElementById('ideaTextInput');
if (ideaTextInputEl) {
  ideaTextInputEl.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+Enter envia, Enter solo hace nueva linea
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addIdea();
    }
  });
}
const ideaTitleInputEl = document.getElementById('ideaTitleInput');
if (ideaTitleInputEl) {
  ideaTitleInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('ideaTextInput').focus(); }
  });
}

// Nueva tab: toggle Equipo/Personal
let currentNewMode = 'team';
function applyNewMode(mode) {
  currentNewMode = mode;
  const projectRow = el.projectSelect.closest('.input-row');
  const chainBtn = document.getElementById('chainBtn');
  const chainRow = chainBtn ? chainBtn.closest('.input-row') : null;
  const isPersonal = mode === 'personal';
  if (projectRow) projectRow.style.display = isPersonal ? 'none' : 'flex';
  if (chainRow) chainRow.style.display = isPersonal ? 'none' : 'flex';
  if (el.personalProjectRow) el.personalProjectRow.style.display = isPersonal ? 'flex' : 'none';
  if (isPersonal) renderPersonalProjectSelect();
  el.taskInput.placeholder = isPersonal ? 'Nueva tarea personal (solo tu la veras)...' : 'Escribe la tarea...';
  document.querySelectorAll('.new-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.style.background = b.dataset.mode === mode ? 'var(--accent)' : '';
    b.style.color = b.dataset.mode === mode ? 'white' : '';
  });
}
document.querySelectorAll('.new-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => applyNewMode(btn.dataset.mode));
});
applyNewMode('team');

function capitalize(str) {
  return str.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

function showProjectModal() {
  el.projectModal.classList.add('active');
  el.projectNameInput.value = '';
  setTimeout(() => el.projectNameInput.focus(), 100);
}

function hideProjectModal() { el.projectModal.classList.remove('active'); }

el.newProjectBtn.addEventListener('click', showProjectModal);
el.quickProjectBtn.addEventListener('click', showProjectModal);
el.confirmProject.addEventListener('click', createProject);
el.cancelProject.addEventListener('click', hideProjectModal);
el.projectNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') createProject(); });
el.projectModal.addEventListener('click', (e) => { if (e.target === el.projectModal) hideProjectModal(); });

// Personal project modal handlers
if (el.newPersonalProjectBtn) el.newPersonalProjectBtn.addEventListener('click', showPersonalProjectModal);
if (el.confirmPersonalProject) el.confirmPersonalProject.addEventListener('click', async () => {
  const name = el.personalProjectNameInput.value.trim();
  if (!name) { el.personalProjectNameInput.focus(); return; }
  await addPersonalProject(name);
  hidePersonalProjectModal();
});
if (el.cancelPersonalProject) el.cancelPersonalProject.addEventListener('click', hidePersonalProjectModal);
if (el.personalProjectNameInput) el.personalProjectNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') el.confirmPersonalProject.click();
});
if (el.personalProjectModal) el.personalProjectModal.addEventListener('click', (e) => {
  if (e.target === el.personalProjectModal) hidePersonalProjectModal();
});

el.clearAllCompleted.addEventListener('click', async () => {
  const completed = tasks.filter(t => t.status === 'completed');
  if (completed.length === 0) return;
  const batch = db.batch();
  completed.forEach(t => batch.delete(db.collection('tasks').doc(t.id)));
  await batch.commit();
});

el.btnPin.addEventListener('click', async () => {
  alwaysOnTop = await window.api.toggleAlwaysOnTop();
  el.btnPin.classList.toggle('unpinned', !alwaysOnTop);
  el.btnPin.title = alwaysOnTop ? 'Fijada (click para desfijar)' : 'No fijada (click para fijar)';
});

el.btnMinimize.addEventListener('click', () => window.api.minimizeWindow());
if (el.btnMaximize) el.btnMaximize.addEventListener('click', () => {
  if (window.api && window.api.maximizeWindow) window.api.maximizeWindow();
});
el.btnClose.addEventListener('click', () => window.api.closeWindow());
// v3.11.30: doble-click en la titlebar = maximizar/restaurar (UX nativa de macOS/Windows)
document.querySelector('.titlebar')?.addEventListener('dblclick', (e) => {
  // Solo si el target ES la titlebar (no un botón adentro)
  if (e.target.closest('.titlebar-btn') || e.target.closest('button')) return;
  if (window.api && window.api.maximizeWindow) window.api.maximizeWindow();
});

// Refresh: recarga las 3 ventanas (main, deposito, chat). Util cuando el chat
// o algun listener se queda colgado y no quieres salir/entrar manualmente.
const btnRefreshAll = document.getElementById('btnRefreshAll');
if (btnRefreshAll) {
  btnRefreshAll.addEventListener('mouseenter', () => { btnRefreshAll.style.color = 'var(--accent)'; });
  btnRefreshAll.addEventListener('mouseleave', () => { btnRefreshAll.style.color = 'var(--text-secondary)'; });
  btnRefreshAll.addEventListener('click', () => {
    btnRefreshAll.style.transition = 'transform 0.6s';
    btnRefreshAll.style.transform = 'rotate(360deg)';
    setTimeout(() => { try { window.api.refreshAllWindows(); } catch (e) { location.reload(); } }, 200);
  });
}

// Atajos rapidos en Configuracion: Papelera, Equipo, Fijar ventana
// (movidos del nav-tabs arriba para liberar espacio)
const settingsGoTrash = document.getElementById('settingsGoTrash');
const settingsGoTeam = document.getElementById('settingsGoTeam');
const settingsTogglePin = document.getElementById('settingsTogglePin');
const settingsPinIcon = document.getElementById('settingsPinIcon');
const settingsPinLabel = document.getElementById('settingsPinLabel');
const settingsTrashBadge = document.getElementById('settingsTrashBadge');
function switchToTab(tabName) {
  const tab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
  if (tab) tab.click();
}
if (settingsGoTrash) settingsGoTrash.addEventListener('click', () => switchToTab('trash'));
if (settingsGoTeam) settingsGoTeam.addEventListener('click', () => switchToTab('team'));
if (settingsTogglePin) {
  settingsTogglePin.addEventListener('click', async () => {
    alwaysOnTop = await window.api.toggleAlwaysOnTop();
    if (el.btnPin) el.btnPin.classList.toggle('unpinned', !alwaysOnTop);
    refreshSettingsPinUi();
  });
}
function refreshSettingsPinUi() {
  if (!settingsPinIcon || !settingsPinLabel) return;
  if (alwaysOnTop) {
    settingsPinIcon.innerHTML = '&#128205;';
    settingsPinLabel.textContent = 'Fijada — click para desfijar';
    settingsTogglePin.style.borderColor = 'var(--accent)';
    settingsTogglePin.style.color = 'var(--accent)';
  } else {
    settingsPinIcon.innerHTML = '&#128205;';
    settingsPinLabel.textContent = 'Fijar ventana';
    settingsTogglePin.style.borderColor = '';
    settingsTogglePin.style.color = '';
  }
}

// Boton ManyChat — abre el panel de ManyChat en el navegador del sistema
const btnManyChat = document.getElementById('btnManyChat');
if (btnManyChat) {
  btnManyChat.addEventListener('mouseenter', () => {
    btnManyChat.style.background = 'var(--accent)';
    btnManyChat.style.color = '#fff';
    btnManyChat.style.borderColor = 'var(--accent)';
  });
  btnManyChat.addEventListener('mouseleave', () => {
    btnManyChat.style.background = 'transparent';
    btnManyChat.style.color = 'var(--text-secondary)';
    btnManyChat.style.borderColor = 'var(--border)';
  });
  btnManyChat.addEventListener('click', () => {
    if (window.api && window.api.openExternal) {
      window.api.openExternal('https://app.manychat.com/fb3090869/cms?path=/&field=modified&order=desc');
    }
  });
}

window.api.getAlwaysOnTop().then(v => {
  alwaysOnTop = v;
  if (el.btnPin) el.btnPin.classList.toggle('unpinned', !v);
  refreshSettingsPinUi();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideProjectModal();
    hidePersonalProjectModal();
    editModal.classList.remove('active');
    noteModal.classList.remove('active');
    linkModal.classList.remove('active');
    videoModal.classList.remove('active');
    document.getElementById('submitTaskModal').classList.remove('active');
    document.getElementById('archiveDepositModal').classList.remove('active');
    submittingTaskId = null;
    archivingTask = null;
  }
});

// ===== AUTO UPDATE =====
const updateBanner = document.getElementById('updateBanner');
const updateText = document.getElementById('updateText');

window.api.onUpdateStatus(({ status, version, percent }) => {
  updateBanner.style.display = 'block';
  if (status === 'downloading') {
    updateText.textContent = `Descargando v${version}...`;
    updateBanner.style.background = '#ffd93d';
    updateBanner.style.cursor = 'default';
    updateBanner.onclick = null;
  } else if (status === 'progress') {
    updateText.textContent = `Descargando actualizacion... ${percent}%`;
  } else if (status === 'ready') {
    updateText.textContent = `v${version} lista - Click para actualizar`;
    updateBanner.style.background = '#4ecdc4';
    updateBanner.style.cursor = 'pointer';
    updateBanner.onclick = () => window.api.installUpdate();
  }
});

window.api.getAppVersion().then(v => {
  const versionEl = document.querySelector('.settings-panel');
  if (versionEl) {
    const div = document.createElement('div');
    div.style.cssText = 'text-align:center;font-size:11px;color:var(--text-secondary);margin-top:20px';
    div.textContent = 'Task Manager v' + v;
    versionEl.appendChild(div);
  }
  // v3.11.31: fallback GitHub API checker (en caso de que electron-updater falle)
  startManualUpdateChecker(v);
  // v3.11.34: botón "Buscar actualizaciones" en Config
  const checkBtn = document.getElementById('settingsCheckUpdates');
  const checkStatus = document.getElementById('settingsUpdateStatus');
  if (checkBtn && checkStatus) {
    checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true;
      checkBtn.textContent = '⏳ Buscando...';
      checkStatus.textContent = '';
      try {
        // Probar primero electron-updater
        let foundUpdate = false;
        if (window.api && window.api.checkForUpdates) {
          const r = await window.api.checkForUpdates();
          if (r && r.ok && r.hasUpdate) {
            foundUpdate = true;
            checkStatus.style.color = 'var(--accent)';
            checkStatus.textContent = `✓ v${r.version} disponible — descargando...`;
          }
        }
        // Sino, chequear GitHub API directo
        if (!foundUpdate) {
          const latest = await checkLatestRelease();
          if (latest && latest.version && compareSemver(latest.version, v) > 0) {
            foundUpdate = true;
            showManualUpdateBanner(latest, v);
            checkStatus.style.color = 'var(--accent)';
            checkStatus.textContent = `✓ v${latest.version} disponible — revisá el banner turquesa arriba`;
          }
        }
        if (!foundUpdate) {
          checkStatus.style.color = 'var(--text-secondary)';
          checkStatus.textContent = `✓ Estás en la última versión (v${v})`;
        }
      } catch (e) {
        checkStatus.style.color = 'var(--danger)';
        checkStatus.textContent = '⚠ Error al chequear: ' + e.message;
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = '🔄 Buscar actualizaciones ahora';
      }
    });
  }
});

function compareSemver(a, b) {
  // Compara "3.11.30" vs "3.11.31" → 0 igual, 1 si a>b, -1 si a<b
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

async function checkLatestRelease() {
  try {
    const res = await fetch('https://api.github.com/repos/jainierrojas-arch/task-manager-app/releases/latest', {
      headers: { 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.tag_name) return null;
    const ver = String(data.tag_name).replace(/^v/, '');
    // Buscar el asset .zip para Mac arm64 (lo que estamos publicando)
    const assets = Array.isArray(data.assets) ? data.assets : [];
    // Prefer arm64 zip, fallback a cualquier zip mac
    let asset = assets.find(a => /arm64.*mac\.zip$/i.test(a.name)) ||
                assets.find(a => /mac\.zip$/i.test(a.name)) ||
                assets.find(a => /\.zip$/i.test(a.name));
    return {
      version: ver,
      htmlUrl: data.html_url, // página de release
      downloadUrl: asset ? asset.browser_download_url : null,
      body: data.body || ''
    };
  } catch (e) {
    console.warn('[updateChecker] fetch failed', e);
    return null;
  }
}

async function startManualUpdateChecker(currentVersion) {
  // Check inmediato + cada 30 min
  const tryCheck = async () => {
    const latest = await checkLatestRelease();
    if (!latest || !latest.version) return;
    if (compareSemver(latest.version, currentVersion) <= 0) return; // ya estás al día
    showManualUpdateBanner(latest, currentVersion);
  };
  tryCheck();
  setInterval(tryCheck, 30 * 60 * 1000);
}

let _customUpdateState = 'idle'; // idle | downloading | ready | installing
function showManualUpdateBanner(latest, currentVersion) {
  const banner = document.getElementById('updateBanner');
  const text = document.getElementById('updateText');
  if (!banner || !text) return;
  banner.style.display = 'block';
  banner.style.cursor = 'pointer';
  // v3.11.35: si tenemos downloadUrl Y el handler IPC custom, descargar e
  // instalar AUTOMÁTICAMENTE sin que el usuario tenga que ir a GitHub.
  if (latest.downloadUrl && window.api && window.api.customDownloadUpdate) {
    if (_customUpdateState === 'idle') {
      _customUpdateState = 'downloading';
      text.textContent = `⬇ Descargando v${latest.version}... 0%`;
      banner.onclick = null; // no clickeable mientras descarga
      // Escuchar progreso
      window.api.onCustomUpdateProgress(({ pct, version }) => {
        if (version !== latest.version) return;
        text.textContent = `⬇ Descargando v${latest.version}... ${pct}%`;
      });
      window.api.onCustomUpdateReady(({ version }) => {
        if (version !== latest.version) return;
        _customUpdateState = 'ready';
        text.textContent = `✅ v${latest.version} lista — click para instalar y reabrir`;
        banner.style.cursor = 'pointer';
        banner.onclick = async () => {
          if (_customUpdateState === 'installing') return;
          _customUpdateState = 'installing';
          text.textContent = `⏳ Instalando v${latest.version}... la app se va a reabrir sola`;
          banner.onclick = null;
          try {
            await window.api.customInstallUpdate();
          } catch (e) {
            text.textContent = `⚠ Error: ${e.message}`;
            _customUpdateState = 'ready'; // permitir reintentar
          }
        };
      });
      // Iniciar descarga
      window.api.customDownloadUpdate({ url: latest.downloadUrl, version: latest.version })
        .then((result) => {
          if (!result || !result.ok) {
            _customUpdateState = 'idle';
            text.textContent = `⚠ Error descargando: ${result && result.error || 'desconocido'} — click para abrir página`;
            banner.onclick = () => {
              const url = latest.downloadUrl || latest.htmlUrl;
              if (window.api && window.api.openExternal) window.api.openExternal(url);
            };
          }
        })
        .catch((e) => {
          _customUpdateState = 'idle';
          text.textContent = `⚠ Error: ${e.message} — click para abrir página`;
          banner.onclick = () => {
            const url = latest.downloadUrl || latest.htmlUrl;
            if (window.api && window.api.openExternal) window.api.openExternal(url);
          };
        });
    }
    return;
  }
  // Fallback: solo abrir el browser con el link (cuando la API custom no está)
  text.textContent = `🎉 v${latest.version} disponible (tenés v${currentVersion}) — click para descargar`;
  banner.onclick = () => {
    const url = latest.downloadUrl || latest.htmlUrl;
    if (url && window.api && window.api.openExternal) {
      window.api.openExternal(url);
    } else if (url) {
      window.open(url, '_blank');
    }
  };
}

// ===== UTILITIES =====
function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'ahora';
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)}h`;
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ===== TELEGRAM NOTIFICATION QUEUE (Firebase-based) =====
// Cualquier instancia (tenga o no el bot) puede encolar notificaciones.
// La instancia admin (con bot activo) las procesa y las envia.
async function sendTelegramNotif(chatId, message) {
  if (!chatId || !message) return;
  try {
    const localToken = await window.api.getTelegramToken();
    if (localToken) {
      // Mi app tiene bot local: envio directo (mas rapido)
      window.api.sendTelegramMessage(chatId, message);
      return;
    }
  } catch (e) { /* fallthrough a queue */ }
  // Sin bot local: encolar en Firebase para que otra instancia la procese
  try {
    await db.collection('notifications').add({
      chatId: String(chatId),
      message,
      status: 'pending',
      createdBy: currentUser ? currentUser.uid : 'unknown',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error('Failed to queue telegram notification:', e);
  }
}

async function sendTelegramNotifToMany(chatIds, message) {
  if (!Array.isArray(chatIds)) return;
  for (const id of chatIds) await sendTelegramNotif(id, message);
}

async function subscribeToNotificationQueue() {
  if (unsubscribeNotifQueue) { unsubscribeNotifQueue(); unsubscribeNotifQueue = null; }
  const token = await window.api.getTelegramToken();
  if (!token) return; // Solo la instancia con bot procesa la cola
  unsubscribeNotifQueue = db.collection('notifications')
    .where('status', '==', 'pending')
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type !== 'added') return;
        const { chatId, message } = change.doc.data();
        if (!chatId || !message) {
          change.doc.ref.delete().catch(() => {});
          return;
        }
        window.api.sendTelegramMessage(chatId, message);
        // Dar 1s para que salga y borrar
        setTimeout(() => change.doc.ref.delete().catch(() => {}), 1500);
      });
    });
}

// ===== TOAST =====
function showToast(msg, type = 'success', durationMs = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; }, durationMs);
  setTimeout(() => t.remove(), durationMs + 400);
}

function notifyAssignedOrWarn(assignee, message) {
  if (!assignee || assignee.id === currentUser.uid) return;
  if (assignee.telegramChatId) {
    sendTelegramNotif(assignee.telegramChatId, message);
    showToast(`✓ Notificado a ${assignee.name} (chat ${assignee.telegramChatId})`, 'success');
  } else {
    showToast(`⚠️ ${assignee.name} no tiene Telegram vinculado — no recibira la notif`, 'warn', 5000);
  }
}

async function testTelegramNotif(chatId, name) {
  await sendTelegramNotif(chatId, `Prueba: mensaje de test a ${name}. Si lees esto, el bot puede enviarte notificaciones.`);
  showToast(`✓ Prueba enviada a ${name} (chat ${chatId})`, 'success');
}
window.testTelegramNotif = testTelegramNotif;

window.api.onTelegramSendError(({ chatId, error }) => {
  showToast(`❌ Telegram fallo: ${error} (chat ${chatId})`, 'warn', 8000);
});

// ===== AI DISPATCH (IN-APP AGENT) =====
function parseDeadlineIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) d.setHours(23, 59, 0, 0);
  return d;
}

function deadlineLabel(d) {
  if (!d) return '';
  return ' para el ' + d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

async function aiCreateTask({ projectName, taskText, deadlineIso }) {
  let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  if (!project) {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];
    const ref = await db.collection('projects').add({
      name: projectName,
      color: colors[Math.floor(Math.random() * colors.length)],
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    project = { id: ref.id, name: projectName, color: '#4ECDC4' };
  }
  const data = {
    text: taskText,
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color || '#4ECDC4',
    assignedTo: currentUser.uid,
    assignedToName: currentUserData.name,
    createdBy: currentUser.uid,
    createdByName: currentUserData.name,
    status: 'pending',
    source: 'ai',
    notes: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const dl = parseDeadlineIso(deadlineIso);
  if (dl) data.deadline = firebase.firestore.Timestamp.fromDate(dl);
  await db.collection('tasks').add(data);
  return `✓ Tarea creada en ${project.name}: ${taskText}${deadlineLabel(dl)}`;
}

async function aiAssignTaskInternal({ projectName, taskText, assignToEmail, deadlineIso, dependsOnTaskId, dependsOnTaskText, dependsOnAssigneeName }) {
  const assignee = teamMembers.find(m => m.email === assignToEmail);
  if (!assignee) return { success: false, message: `Usuario ${assignToEmail} no esta en el equipo.` };

  let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  if (!project) {
    const ref = await db.collection('projects').add({
      name: projectName, color: '#45B7D1', createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    project = { id: ref.id, name: projectName, color: '#45B7D1' };
  }

  const taskData = {
    text: taskText, projectId: project.id, projectName: project.name,
    projectColor: project.color || '#45B7D1', assignedTo: assignee.id,
    assignedToName: assignee.name, createdBy: currentUser.uid, createdByName: currentUserData.name,
    status: 'pending', source: 'ai', notes: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const dl = parseDeadlineIso(deadlineIso);
  if (dl) taskData.deadline = firebase.firestore.Timestamp.fromDate(dl);
  if (dependsOnTaskId) {
    taskData.dependsOn = dependsOnTaskId;
    taskData.dependsOnText = dependsOnTaskText || '';
    taskData.dependsOnAssigneeName = dependsOnAssigneeName || '';
  }
  const ref = await db.collection('tasks').add(taskData);

  if (assignee.id !== currentUser.uid) {
    const depMsg = dependsOnTaskId ? `\nEn espera de *${dependsOnAssigneeName || 'otro'}*: ${dependsOnTaskText || ''}` : '';
    const dlMsg = dl ? `\nPlazo: *${dl.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}*` : '';
    notifyAssignedOrWarn(assignee,
      `*${currentUserData.name}* te asigno una tarea:\n${taskText}\nProyecto: *${project.name}*${dlMsg}${depMsg}`);
  }
  return { success: true, taskId: ref.id, assigneeName: assignee.name, projectName: project.name, deadline: dl };
}

async function aiAssignTask(input) {
  const r = await aiAssignTaskInternal(input);
  if (!r.success) return `✗ ${r.message}`;
  return `✓ Tarea asignada a ${r.assigneeName} en ${r.projectName}: ${input.taskText}${deadlineLabel(r.deadline)}`;
}

async function aiAssignChain({ projectName, steps }) {
  if (!Array.isArray(steps) || steps.length < 2) return '✗ Una cadena necesita al menos 2 pasos.';
  let prev = { id: null, text: null, name: null };
  const created = [];
  for (const s of steps) {
    const r = await aiAssignTaskInternal({
      projectName, taskText: s.task_text, assignToEmail: s.assign_to_email,
      deadlineIso: s.deadline_iso,
      dependsOnTaskId: prev.id, dependsOnTaskText: prev.text, dependsOnAssigneeName: prev.name
    });
    if (!r.success) return `✗ ${r.message}`;
    prev = { id: r.taskId, text: s.task_text, name: r.assigneeName };
    created.push(`${created.length + 1}. ${r.assigneeName}: ${s.task_text}${deadlineLabel(r.deadline)}`);
  }
  return `✓ Cadena creada en ${projectName}:\n${created.join('\n')}`;
}

async function aiCreatePersonalTask({ task_text, deadline_iso }) {
  const data = {
    text: task_text,
    ownerId: currentUser.uid,
    ownerName: currentUserData.name,
    status: 'pending',
    source: 'ai',
    personalProject: currentPersonalProject || 'General',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const dl = parseDeadlineIso(deadline_iso);
  if (dl) data.deadline = firebase.firestore.Timestamp.fromDate(dl);
  await db.collection('personalTasks').add(data);
  return `✓ Tarea personal creada en "${data.personalProject}": ${task_text}${deadlineLabel(dl)}`;
}

const aiHistory = [];
let lastAiUserMsg = null;
let lastAiResult = null;

function renderAIHistory() {
  const container = document.getElementById('aiHistory');
  if (!container) return;
  if (aiHistory.length === 0) { container.innerHTML = ''; return; }
  const recent = aiHistory.slice(0, 2);
  container.innerHTML = recent.map((h, i) => {
    const opacity = i === 0 ? 0.75 : 0.45;
    const resultColor = h.type === 'error' ? '#ff9090' : '#7fc3b9';
    const shortResult = (h.result || '').replace(/\n/g, ' ');
    return `<div onclick="reuseAIHistory(${i})" title="Click para reusar" style="font-size:10px;line-height:1.4;padding:2px 0;opacity:${opacity};cursor:pointer">
      <div style="color:var(--text-dim);font-style:italic">→ ${esc(h.user)}</div>
      <div style="color:${resultColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(shortResult)}</div>
    </div>`;
  }).join('');
}

function reuseAIHistory(index) {
  const h = aiHistory[index];
  if (!h) return;
  const input = document.getElementById('aiInput');
  if (input) { input.value = h.user; input.focus(); }
}
window.reuseAIHistory = reuseAIHistory;

function openAIHistoryModal() {
  const list = document.getElementById('aiHistoryList');
  if (!list) return;
  if (aiHistory.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);padding:16px;font-size:12px;text-align:center">Aun no hay historial.</div>';
  } else {
    list.innerHTML = aiHistory.map((h, i) => {
      const color = h.type === 'error' ? '#ff9090' : '#7fc3b9';
      return `<div onclick="reuseAIHistoryFromModal(${i})" title="Click para reusar en el input" style="padding:8px 10px;margin-bottom:6px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;line-height:1.4;transition:background 0.15s" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
        <div style="color:var(--text-dim);font-style:italic;margin-bottom:4px">→ ${esc(h.user)}</div>
        <div style="color:${color};white-space:pre-wrap">${esc(h.result || '')}</div>
      </div>`;
    }).join('');
  }
  document.getElementById('aiHistoryModal').classList.add('active');
}

function reuseAIHistoryFromModal(index) {
  reuseAIHistory(index);
  document.getElementById('aiHistoryModal').classList.remove('active');
}
window.reuseAIHistoryFromModal = reuseAIHistoryFromModal;

const aiHistoryBtn = document.getElementById('aiHistoryBtn');
if (aiHistoryBtn) aiHistoryBtn.addEventListener('click', openAIHistoryModal);
const closeAiHistoryBtn = document.getElementById('closeAiHistory');
if (closeAiHistoryBtn) closeAiHistoryBtn.addEventListener('click', () => {
  document.getElementById('aiHistoryModal').classList.remove('active');
});
const aiHistoryClearBtn = document.getElementById('aiHistoryClear');
if (aiHistoryClearBtn) aiHistoryClearBtn.addEventListener('click', () => {
  if (!confirm('Borrar todo el historial del agente?')) return;
  aiHistory.length = 0;
  renderAIHistory();
  openAIHistoryModal();
});
const aiHistoryModal = document.getElementById('aiHistoryModal');
if (aiHistoryModal) aiHistoryModal.addEventListener('click', (e) => {
  if (e.target === aiHistoryModal) aiHistoryModal.classList.remove('active');
});

function showAIResult(text, type = 'info') {
  const out = document.getElementById('aiResult');
  if (!out) return;
  out.style.display = 'block';
  out.textContent = text;
  out.style.color = type === 'error' ? '#ff6b6b' : type === 'success' ? '#4ecdc4' : 'var(--text-secondary)';
  if (type !== 'info') {
    lastAiResult = text;
    lastAiResultType = type;
  }
}

let lastAiResultType = 'info';

async function aiDispatch(text) {
  // Mover el resultado anterior al historial antes de procesar uno nuevo
  if (lastAiUserMsg && lastAiResult) {
    aiHistory.unshift({ user: lastAiUserMsg, result: lastAiResult, type: lastAiResultType });
    if (aiHistory.length > 10) aiHistory.pop();
    renderAIHistory();
  }
  lastAiUserMsg = text;
  lastAiResult = null;

  showAIResult('Pensando...', 'info');

  const myTasks = tasks.filter(t => t.assignedTo === currentUser.uid && t.status === 'pending');
  const myTasksContext = myTasks.length
    ? myTasks.map((t, i) => `${i + 1}. [${t.projectName}] ${t.text}`).join('\n')
    : '(ninguna)';

  const now = new Date();
  const isoNow = now.toISOString();
  const humanNow = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Contexto donde esta parado el usuario - para resolver "agregame X" sin mencionar proyecto
  const tabLabels = {
    main: 'Tareas del equipo', 'my-tasks': 'Mis tareas', approval: 'Por aprobar',
    completed: 'Hechas', personal: 'Personal', calendar: 'Calendario',
    team: 'Equipo', new: 'Nueva', settings: 'Config'
  };
  const contextLines = [`Pestana actual: ${tabLabels[currentTab] || currentTab}`];
  if (currentTab === 'personal') {
    contextLines.push(`Proyecto personal activo: "${currentPersonalProject}"`);
  } else if (lastInteractedProject && lastInteractedProject.name) {
    contextLines.push(`Ultimo proyecto de equipo que el usuario toco: "${lastInteractedProject.name}"`);
  }
  const contextBlock = contextLines.join('\n');

  const systemPrompt = `Eres un asistente de gestion de tareas en una app de equipo. Interpreta el mensaje del usuario y ejecuta la accion correcta usando las tools.

Fecha y hora actual: ${humanNow} (${isoNow})

Usuario actual: ${currentUserData.name} (${currentUserData.email})

Contexto de la app ahora mismo:
${contextBlock}

Proyectos existentes: ${projects.map(p => p.name).join(', ') || '(ninguno)'}

Miembros del equipo:
${teamMembers.map(m => `- ${m.name} (${m.email})`).join('\n')}

Reglas:
- Menciona alguien por nombre => busca su email exacto de la lista
- Proyecto => nombre exacto de la lista. Si no existe pero quiere crearlo, inventa uno coherente.
- Tarea para yo/mi/mi cuenta => add_task (asignada al usuario actual)
- Tarea personal/privada/para mi sola => add_personal_task
- Tarea para otro miembro => assign_task
- 2 o mas tareas en secuencia ("primero A, despues B") => assign_chain_tasks
- Saludos, preguntas, cosas que no son acciones => reply_message

CONTEXTO IMPLICITO (muy importante):
- Si el usuario dice "agregame X", "agrega X", "nueva tarea X" SIN mencionar proyecto ni a quien, usa el contexto de arriba:
  * Pestana "Personal" => add_personal_task (el proyecto personal activo ya se aplica automaticamente, NO lo pongas en task_text)
  * Pestana "Tareas del equipo" / "Mis tareas" / "Por aprobar" + hay "Ultimo proyecto de equipo" => add_task usando ese project_name
  * Si no hay contexto suficiente (ej. pestana Calendario o no hay ultimo proyecto tocado) => reply_message pidiendo al usuario el proyecto
- Si el usuario SI menciona explicitamente proyecto o persona, ignora el contexto y usa lo que dijo.

Deadlines (plazos):
- Si el usuario menciona una fecha/dia ("para el viernes", "en 3 dias", "el 30 de abril", "mañana", "hoy a las 5pm"), calcula la fecha correspondiente basandote en la fecha actual y pasala en deadline_iso (formato ISO 8601, ej: "2026-04-25T23:59:00").
- Si no menciona fecha, NO pongas deadline_iso.
- "Mañana" => el dia siguiente. "El viernes" => proximo viernes (si hoy ya paso el viernes, el siguiente).
- Si dice "hoy" incluye la hora mencionada; si no especifica hora usa 23:59.`;

  const tools = [
    {
      name: 'add_task',
      description: 'Crear tarea del equipo asignada al usuario actual',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          task_text: { type: 'string' },
          deadline_iso: { type: 'string', description: 'Fecha limite en ISO 8601 (opcional)' }
        },
        required: ['project_name', 'task_text']
      }
    },
    {
      name: 'assign_task',
      description: 'Crear tarea y asignarla a otro miembro',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          task_text: { type: 'string' },
          assign_to_email: { type: 'string' },
          deadline_iso: { type: 'string', description: 'Fecha limite en ISO 8601 (opcional)' }
        },
        required: ['project_name', 'task_text', 'assign_to_email']
      }
    },
    {
      name: 'assign_chain_tasks',
      description: 'Crear cadena de tareas en secuencia (una empieza cuando la anterior termina)',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                assign_to_email: { type: 'string' },
                task_text: { type: 'string' },
                deadline_iso: { type: 'string', description: 'Fecha limite de ESTE paso (opcional)' }
              },
              required: ['assign_to_email', 'task_text']
            }
          }
        },
        required: ['project_name', 'steps']
      }
    },
    {
      name: 'add_personal_task',
      description: 'Crear tarea personal privada (solo la ve el usuario actual)',
      input_schema: {
        type: 'object',
        properties: {
          task_text: { type: 'string' },
          deadline_iso: { type: 'string', description: 'Fecha limite en ISO 8601 (opcional)' }
        },
        required: ['task_text']
      }
    },
    {
      name: 'reply_message',
      description: 'Responder con un mensaje de texto cuando no aplica ninguna otra accion',
      input_schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      }
    }
  ];

  const result = await window.api.callClaude({ systemPrompt, userMessage: text, tools });
  if (result.error) {
    const msg = result.error === 'no-api-key'
      ? 'La IA no esta configurada. Ve a Config → Claude AI y pega tu API key.'
      : `Error: ${result.error}`;
    showAIResult(msg, 'error');
    return;
  }

  const input = result.input || {};
  try {
    let msg;
    switch (result.tool) {
      case 'add_task':
        msg = await aiCreateTask({ projectName: input.project_name, taskText: input.task_text, deadlineIso: input.deadline_iso });
        break;
      case 'assign_task':
        msg = await aiAssignTask({ projectName: input.project_name, taskText: input.task_text, assignToEmail: input.assign_to_email, deadlineIso: input.deadline_iso });
        break;
      case 'assign_chain_tasks':
        msg = await aiAssignChain({ projectName: input.project_name, steps: input.steps || [] });
        break;
      case 'add_personal_task':
        msg = await aiCreatePersonalTask({ task_text: input.task_text, deadline_iso: input.deadline_iso });
        break;
      case 'reply_message':
        msg = input.text || 'Listo.';
        break;
      default:
        msg = 'No entendi la accion.';
    }
    showAIResult(msg, msg.startsWith('✗') ? 'error' : 'success');
  } catch (e) {
    showAIResult('Error: ' + e.message, 'error');
  }
}

const aiInputEl = document.getElementById('aiInput');
const aiSendEl = document.getElementById('aiSendBtn');
async function handleAISend() {
  const txt = aiInputEl.value.trim();
  if (!txt) return;
  aiInputEl.value = '';
  await aiDispatch(txt);
}
if (aiSendEl) aiSendEl.addEventListener('click', handleAISend);
if (aiInputEl) aiInputEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleAISend(); });

// ===== CALENDAR TASK MODAL =====
let calTaskSelectedDate = null;
let calTaskCurrentMode = 'team';

function openCalTaskModal(dateStr) {
  calTaskSelectedDate = dateStr;
  const modal = document.getElementById('calendarTaskModal');
  const d = new Date(dateStr);
  document.getElementById('calendarTaskDate').textContent = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  const projSel = document.getElementById('calTaskProject');
  projSel.innerHTML = '<option value="">Proyecto...</option>';
  projects.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    projSel.appendChild(o);
  });
  const assnSel = document.getElementById('calTaskAssign');
  assnSel.innerHTML = '<option value="">Asignar a...</option>';
  teamMembers.forEach(m => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name + (m.id === currentUser.uid ? ' (yo)' : '');
    assnSel.appendChild(o);
  });
  document.getElementById('calTaskInput').value = '';
  applyCalTaskMode('team');
  modal.classList.add('active');
  setTimeout(() => document.getElementById('calTaskInput').focus(), 100);
}
window.openCalTaskModal = openCalTaskModal;

function applyCalTaskMode(mode) {
  calTaskCurrentMode = mode;
  document.querySelectorAll('.cal-task-mode-btn').forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('active', active);
    b.style.background = active ? 'var(--accent)' : '';
    b.style.color = active ? 'white' : '';
  });
  document.getElementById('calTaskTeamFields').style.display = mode === 'personal' ? 'none' : 'block';
}

document.querySelectorAll('.cal-task-mode-btn').forEach(b => {
  b.addEventListener('click', () => applyCalTaskMode(b.dataset.mode));
});

document.getElementById('calTaskCancel').addEventListener('click', () => {
  document.getElementById('calendarTaskModal').classList.remove('active');
});
document.getElementById('calendarTaskModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('calendarTaskModal')) {
    document.getElementById('calendarTaskModal').classList.remove('active');
  }
});
document.getElementById('calTaskInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('calTaskConfirm').click();
});

document.getElementById('calTaskConfirm').addEventListener('click', async () => {
  const text = document.getElementById('calTaskInput').value.trim();
  if (!text || !calTaskSelectedDate) return;

  const deadline = new Date(calTaskSelectedDate);
  deadline.setHours(23, 59, 0, 0);

  if (calTaskCurrentMode === 'personal') {
    await db.collection('personalTasks').add({
      text,
      ownerId: currentUser.uid,
      ownerName: currentUserData.name,
      status: 'pending',
      source: 'calendar',
      personalProject: currentPersonalProject || 'General',
      deadline: firebase.firestore.Timestamp.fromDate(deadline),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    const projectId = document.getElementById('calTaskProject').value;
    if (!projectId) {
      document.getElementById('calTaskProject').style.borderColor = 'var(--danger)';
      setTimeout(() => document.getElementById('calTaskProject').style.borderColor = '', 1500);
      return;
    }
    const assignTo = document.getElementById('calTaskAssign').value;
    const project = projects.find(p => p.id === projectId);
    const assignee = teamMembers.find(m => m.id === assignTo);
    await db.collection('tasks').add({
      text,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color || '#666',
      assignedTo: assignTo || currentUser.uid,
      assignedToName: assignee ? assignee.name : currentUserData.name,
      createdBy: currentUser.uid,
      createdByName: currentUserData.name,
      status: 'pending',
      source: 'calendar',
      notes: [],
      deadline: firebase.firestore.Timestamp.fromDate(deadline),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (assignee && assignTo !== currentUser.uid) {
      notifyAssignedOrWarn(assignee,
        `Nueva tarea asignada por *${currentUserData.name}* para *${deadline.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}*:\n${text}\nProyecto: *${project.name}*`);
    }
  }
  document.getElementById('calendarTaskModal').classList.remove('active');
});

// ===== CHAT BADGE (mensajes no leidos en boton de barra superior) =====
function chatTimestampToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return new Date(ts);
}

function countUnreadChat() {
  if (!chatLastReadAt && chatMessages.length === 0) return 0;
  const lastReadMs = chatLastReadAt ? (chatLastReadAt.toDate ? chatLastReadAt.toDate().getTime() : new Date(chatLastReadAt).getTime()) : 0;
  return chatMessages.filter(m => {
    if (m.authorId === currentUser.uid) return false;
    const ms = chatTimestampToDate(m.createdAt);
    return ms && ms.getTime() > lastReadMs;
  }).length;
}

function renderChatBadge() {
  if (!el.chatUnreadBadge) return;
  const n = countUnreadChat();
  if (n <= 0) {
    el.chatUnreadBadge.style.display = 'none';
    return;
  }
  el.chatUnreadBadge.textContent = n > 99 ? '99+' : String(n);
  el.chatUnreadBadge.style.display = 'inline-flex';
}

if (el.chatToggleBtn) {
  el.chatToggleBtn.addEventListener('click', async () => {
    // v3.11.3: cambia a la pestaña Chat (en vez del panel lateral). El modo
    // PRO split aún usa openSidePanel('chat') directamente.
    _goToTab('chat');
  });
}

const proModeBtn = document.getElementById('proModeBtn');
if (proModeBtn) {
  // El boton SIEMPRE muestra el siguiente modo al que se va a cambiar al hacer click.
  // Asi el usuario sabe a donde lo va a llevar el siguiente click:
  //   off       -> click pasa a 'full'      -> boton mostraba "PRO 3 VENTANAS" (proxima accion)
  //   full      -> click pasa a 'no-chat'   -> boton mostraba "PRO SIN CHAT"   (proxima accion)
  //   no-chat   -> click pasa a 'off'       -> boton mostraba "SALIR PRO"      (proxima accion)
  function applyProBtnLabel(currentState) {
    if (currentState === 'off') {
      // proxima accion: activar Pro 3 ventanas
      proModeBtn.style.background = 'linear-gradient(135deg,#2ed573,#1aaf4a)';
      proModeBtn.innerHTML = '&#128202; PRO 3 VENTANAS';
    } else if (currentState === 'full') {
      // proxima accion: pasar a Sin Chat
      proModeBtn.style.background = 'linear-gradient(135deg,#1e90ff,#4a6cf7)';
      proModeBtn.innerHTML = '&#128203; PRO SIN CHAT';
    } else {
      // currentState === 'no-chat', proxima accion: pasar a PRINCIPAL (solo main)
      proModeBtn.style.background = 'linear-gradient(135deg,#ff9966,#ff5e62)';
      proModeBtn.innerHTML = '&#9881; PRINCIPAL';
    }
  }
  // Inicializar etiqueta con el estado off (proxima accion: PRO 3 VENTANAS)
  applyProBtnLabel('off');

  proModeBtn.addEventListener('click', async () => {
    try {
      // v3.7.4: Modo PRO embebido — abre el side panel en split (depósito arriba + chat abajo)
      // dentro de la misma ventana en lugar de abrir 3 BrowserWindows separadas.
      const overlay = document.getElementById('sidePanel');
      const isPro = overlay && overlay.classList.contains('pro-split') && overlay.classList.contains('open');
      if (isPro) {
        // Salir de Modo PRO
        overlay.classList.remove('pro-split', 'open');
        _currentSidePanel = null;
        applyProBtnLabel('off');
      } else {
        // Entrar en Modo PRO: split panel con 2 iframes
        enterProSplitMode();
        applyProBtnLabel('full');
      }
      return;
    } catch (e) {
      console.error('[ProMode] error:', e);
    }
  });
}

// ===== v3.11.72: Panel de Diagnóstico =====
// Cualquier user lo ejecuta y ve exactamente qué falla en su instalación.
async function runFullDiagnostics(resultEl) {
  resultEl.innerHTML = '<div style="color:#888">⏳ Ejecutando tests...</div>';
  const tests = [];
  const log = (test) => {
    tests.push(test);
    renderDiagnostics(resultEl, tests);
  };

  // Test 1: Versión de la app
  let localVer = '?';
  try { localVer = await window.api.getAppVersion(); } catch (e) {}
  let latestVer = null;
  try {
    const latest = await checkLatestRelease();
    if (latest && latest.version) latestVer = latest.version;
  } catch (e) {}
  const versionOk = latestVer ? compareSemver(localVer, latestVer) >= 0 : true;
  log({
    name: 'Versión de la app',
    ok: versionOk,
    detail: `Local: v${localVer}` + (latestVer ? ` · Última: v${latestVer}` : ''),
    fix: versionOk ? null : 'Quit completo (Cmd+Q / cerrar X) y reabrir la app. El auto-update se instala al cerrar.'
  });

  // Test 2: Internet
  log({
    name: 'Internet',
    ok: navigator.onLine,
    detail: navigator.onLine ? 'Conectado' : 'Sin conexión',
    fix: navigator.onLine ? null : 'Revisá tu conexión a internet'
  });

  // Test 3: API key transcripción
  let keyState = { ok: false, provider: 'sin configurar' };
  try {
    await _waitForWorkspaceReady();
    if (currentWorkspaceId) {
      const snap = await wsConfigRef('openai').get();
      if (snap.exists) {
        const key = ((snap.data() || {}).apiKey || '').trim();
        if (key.startsWith('gsk_')) keyState = { ok: true, provider: 'Groq', preview: key.slice(0, 8) + '...' };
        else if (key.startsWith('sk-')) keyState = { ok: true, provider: 'OpenAI', preview: key.slice(0, 7) + '...' };
        else if (key) keyState = { ok: false, provider: 'formato inválido' };
      }
    }
  } catch (e) {}
  // v3.11.73: flag OpenAI como warning porque bloquea VE/CU/IR. Groq sin bloqueo = ✓ verde.
  const isOpenAiKey = keyState.ok && keyState.provider === 'OpenAI';
  log({
    name: 'API key transcripción',
    ok: keyState.ok && !isOpenAiKey,
    warning: isOpenAiKey,
    detail: keyState.ok ? `${keyState.provider} (${keyState.preview})` : keyState.provider,
    fix: !keyState.ok
      ? 'Settings → OpenAI API Key → pegá una key de Groq (gsk_...) — console.groq.com es gratis'
      : (isOpenAiKey
          ? '⚠ OpenAI bloquea Venezuela / Cuba / Irán por país. Si tu equipo está en alguno de esos países, reemplazala por una key de Groq (console.groq.com es gratis). Si todos están en USA/Europa, podés ignorar este aviso.'
          : null)
  });

  // Test 4: Cloudinary
  let cloudOk = false;
  try {
    const cfg = await window.api.getCloudinaryConfig();
    cloudOk = !!(cfg && cfg.cloudName && cfg.uploadPreset);
  } catch (e) {}
  log({
    name: 'Cloudinary (uploads de video)',
    ok: cloudOk,
    detail: cloudOk ? 'Configurado' : 'No configurado',
    fix: cloudOk ? null : 'Settings → Cloudinary → cloud name + upload preset'
  });

  // Test 5: Workspace
  log({
    name: 'Workspace activo',
    ok: !!currentWorkspaceId,
    detail: currentWorkspaceId ? currentWorkspaceId.slice(0, 12) + '...' : 'sin workspace',
    fix: currentWorkspaceId ? null : 'Click en el selector de workspace arriba a la izquierda'
  });

  // Test 6: Firebase / Firestore
  let fbOk = false;
  try {
    if (db) {
      await db.collection('users').limit(1).get();
      fbOk = true;
    }
  } catch (e) {}
  log({
    name: 'Firebase / Firestore',
    ok: fbOk,
    detail: fbOk ? 'Conectado' : 'Sin acceso',
    fix: fbOk ? null : 'Verificar conexión a internet y permisos de Firestore'
  });

  // Final
  return tests;
}

function renderDiagnostics(el, tests) {
  const total = tests.length;
  const passed = tests.filter(t => t.ok).length;
  const hasWarnings = tests.some(t => t.warning);
  let headerColor = '#4ecdc4', headerTxt = `${passed}/${total} OK`;
  if (passed < total) { headerColor = '#ff6b6b'; headerTxt = `${passed}/${total} OK · revisá los ✗`; }
  else if (hasWarnings) { headerColor = '#ff9866'; headerTxt = `${passed}/${total} OK · pero con avisos ⚠`; }
  el.innerHTML = `
    <div style="font-weight:700;color:${headerColor};margin-bottom:10px">${headerTxt}</div>
    ${tests.map(t => {
      let bg, border, icon;
      if (t.ok) { bg = 'rgba(78,205,196,0.08)'; border = 'rgba(78,205,196,0.3)'; icon = '✓'; }
      else if (t.warning) { bg = 'rgba(255,152,102,0.08)'; border = 'rgba(255,152,102,0.4)'; icon = '⚠'; }
      else { bg = 'rgba(255,107,107,0.1)'; border = 'rgba(255,107,107,0.3)'; icon = '✗'; }
      return `
      <div style="display:flex;flex-direction:column;gap:2px;padding:8px;border-radius:6px;background:${bg};border:1px solid ${border};margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">${icon}</span><strong>${t.name}</strong></div>
        <div style="font-size:11px;color:var(--text-secondary)">${t.detail}</div>
        ${t.fix ? `<div style="font-size:11px;color:#ff9866;margin-top:4px">→ ${t.fix}</div>` : ''}
      </div>
    `;
    }).join('')}
  `;
}

// ===== v3.11.75: Migrar contenido entre workspaces (admin) =====
// Consolidar workspaces — mueve todas las entries, categorías, tareas, proyectos
// y programaciones de un workspace a otro. Para resolver "yo subo y los chicos
// no ven" cuando están en workspaces distintos.
const WS_SCOPED_COLLECTIONS_MIGRATE = ['depositEntries', 'depositCategories', 'tasks', 'projects', 'scheduledPosts', 'chatMessages', 'captionTemplates', 'ideas'];

function populateMigrateWsDropdowns() {
  const sourceSel = document.getElementById('migrateSourceWs');
  const targetSel = document.getElementById('migrateTargetWs');
  if (!sourceSel || !targetSel || !Array.isArray(workspaces)) return;
  const options = workspaces.map(w =>
    `<option value="${esc(w.id)}">${esc(w.name)}${w.id === currentWorkspaceId ? ' (actual)' : ''}</option>`
  ).join('');
  sourceSel.innerHTML = options;
  targetSel.innerHTML = options;
  // Default: source = primer otro, target = actual
  if (currentWorkspaceId) targetSel.value = currentWorkspaceId;
  const otherWs = workspaces.find(w => w.id !== currentWorkspaceId);
  if (otherWs) sourceSel.value = otherWs.id;
}

async function migrateWorkspaceContent(sourceId, targetId, statusEl) {
  if (sourceId === targetId) {
    statusEl.innerHTML = '<div style="color:#ff6b6b">El workspace origen y destino son el mismo.</div>';
    return;
  }
  const counts = {};
  for (const coll of WS_SCOPED_COLLECTIONS_MIGRATE) {
    try {
      statusEl.innerHTML = '<div style="color:#888">⏳ Migrando ' + coll + '...</div>';
      // Query con workspaceId = source. También docs SIN workspaceId si source es el default.
      const snap = await db.collection(coll).where('workspaceId', '==', sourceId).get();
      // En Firestore batch máx 500 ops; chunkear
      const docs = snap.docs;
      let updated = 0;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        const chunk = docs.slice(i, i + 400);
        chunk.forEach(d => batch.update(d.ref, { workspaceId: targetId }));
        await batch.commit();
        updated += chunk.length;
      }
      counts[coll] = updated;
    } catch (e) {
      console.warn('[migrate]', coll, 'failed:', e.message);
      counts[coll] = 'error: ' + e.message;
    }
  }
  const summary = Object.entries(counts)
    .map(([k, v]) => '<div>' + k + ': <strong>' + v + '</strong></div>')
    .join('');
  statusEl.innerHTML = '<div style="color:#4ecdc4;font-weight:700;margin-bottom:6px">✓ Migración completa</div>' + summary +
    '<div style="margin-top:8px;color:var(--text-secondary)">Decíles a los chicos que cambien al workspace destino para ver el contenido.</div>';
}

const migrateBtn = document.getElementById('migrateWsBtn');
const migrateSourceSel = document.getElementById('migrateSourceWs');
const migrateTargetSel = document.getElementById('migrateTargetWs');
const migrateResultEl = document.getElementById('migrateWsResult');
if (migrateBtn && migrateSourceSel && migrateTargetSel && migrateResultEl) {
  // v3.11.76: poblar dropdowns reactivamente — cuando cargan los workspaces,
  // cuando se hace click en migración, y con polling cada 2s mientras hay
  // menos de 2 workspaces visibles (en caso de network lento).
  let _migrateRetryCount = 0;
  function ensureMigrateDropdownsPopulated() {
    populateMigrateWsDropdowns();
    if ((workspaces || []).length < 2 && _migrateRetryCount < 10) {
      _migrateRetryCount++;
      setTimeout(ensureMigrateDropdownsPopulated, 2000);
    }
  }
  setTimeout(ensureMigrateDropdownsPopulated, 1500);
  // Re-poblar cada vez que el panel de Settings se hace visible
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-tab="settings"]')) {
      setTimeout(populateMigrateWsDropdowns, 200);
    }
  });
  migrateBtn.addEventListener('click', async () => {
    const sourceId = migrateSourceSel.value;
    const targetId = migrateTargetSel.value;
    if (!sourceId || !targetId) {
      alert('Seleccioná workspace origen y destino primero.');
      return;
    }
    if (sourceId === targetId) {
      alert('El origen y destino son el mismo workspace.');
      return;
    }
    const sourceName = (workspaces.find(w => w.id === sourceId) || {}).name || sourceId;
    const targetName = (workspaces.find(w => w.id === targetId) || {}).name || targetId;
    if (!confirm(`Mover TODO el contenido de "${sourceName}" a "${targetName}"?\n\nIncluye entries del depósito, categorías, tareas, proyectos, programaciones y más. Esto es IRREVERSIBLE (los docs quedan etiquetados como workspace destino).`)) return;
    migrateBtn.disabled = true;
    migrateBtn.textContent = '⏳ Migrando...';
    try { await migrateWorkspaceContent(sourceId, targetId, migrateResultEl); }
    catch (e) { migrateResultEl.innerHTML = '<div style="color:#ff6b6b">Error: ' + e.message + '</div>'; }
    migrateBtn.disabled = false;
    migrateBtn.textContent = 'Migrar todo el contenido';
  });
}

const _runDiagBtn = document.getElementById('runDiagnosticsBtn');
const _diagResultEl = document.getElementById('diagnosticsResult');
if (_runDiagBtn && _diagResultEl) {
  _runDiagBtn.addEventListener('click', async () => {
    _runDiagBtn.disabled = true;
    _runDiagBtn.textContent = '⏳ Ejecutando...';
    try {
      await runFullDiagnostics(_diagResultEl);
    } catch (e) {
      _diagResultEl.innerHTML = '<div style="color:#ff6b6b">Error: ' + e.message + '</div>';
    }
    _runDiagBtn.disabled = false;
    _runDiagBtn.textContent = 'Ejecutar diagnóstico de nuevo';
  });
}
