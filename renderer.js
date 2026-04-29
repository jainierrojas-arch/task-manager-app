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
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await db.collection('users').doc(cred.user.uid).set({
        name: name,
        email: email.toLowerCase(),
        role: 'miembro',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        telegramChatId: ''
      });
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
    } else {
      currentUserData = { id: user.uid, name: user.email.split('@')[0], email: user.email, role: 'miembro' };
    }
    showApp();
  } else {
    currentUser = null;
    currentUserData = null;
    showLogin();
  }
});

function showApp() {
  el.loginScreen.classList.add('hidden');
  el.appContainer.classList.add('active');

  el.userAvatar.textContent = currentUserData.name.charAt(0).toUpperCase();
  el.userName.textContent = currentUserData.name;
  el.userRole.textContent = currentUserData.role || 'miembro';

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
    const snap = await db.collection('config').doc('instagram').get();
    const remote = snap.exists ? (snap.data().makeWebhookUrl || null) : null;
    if (remote === url) return;
    await db.collection('config').doc('instagram').set({
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
  if (unsubscribeTasks) unsubscribeTasks();
  if (unsubscribeProjects) unsubscribeProjects();
  if (unsubscribeUsers) unsubscribeUsers();
  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  if (unsubscribeDeposit) { unsubscribeDeposit(); unsubscribeDeposit = null; }
  if (unsubscribeIdeas) { unsubscribeIdeas(); unsubscribeIdeas = null; }
  if (unsubscribeScheduled) { unsubscribeScheduled(); unsubscribeScheduled = null; scheduledPostsInitialized = false; }
  if (unsubscribeCaptionTpls) { unsubscribeCaptionTpls(); unsubscribeCaptionTpls = null; captionTemplates = []; }
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
}

el.logoutBtn.addEventListener('click', () => auth.signOut());

const cloudBtn = document.getElementById('cloudBtn');
if (cloudBtn) {
  cloudBtn.addEventListener('click', () => {
    window.api.openExternal('https://drive.google.com/drive/folders/1BuRcSTdiHx07lcUsO9WUe1BoCk81NX2e?usp=sharing');
  });
}

const depositBtn = document.getElementById('depositBtn');
if (depositBtn) {
  depositBtn.addEventListener('click', async () => {
    await window.api.toggleDeposit();
    // El badge ya NO se reinicia al cerrar el deposito. Es persistente y cuenta
    // los items pendientes (status !== 'converted') hasta que se asignen como tareas.
  });
}

const referencesBtn = document.getElementById('referencesBtn');
if (referencesBtn) {
  referencesBtn.addEventListener('click', async () => {
    // Abre el deposito y navega automaticamente a la categoria Referencias.
    // El badge ya NO se reinicia al hacer click — es persistente y siempre
    // refleja el total de items en Referencias (mismas reglas que TAREAS).
    if (window.api.toggleDepositWithCategory) {
      await window.api.toggleDepositWithCategory('referencias');
    } else {
      await window.api.toggleDeposit();
    }
  });
}

// ===== FIRESTORE REAL-TIME =====
function subscribeToData() {
  unsubscribeTasks = db.collection('tasks').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
    const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    tasks = all.filter(t => !t.deletedAt);
    trashTasks = all.filter(t => t.deletedAt);
    renderAll();
    renderTrashList();
  });

  unsubscribeProjects = db.collection('projects').orderBy('name').onSnapshot((snapshot) => {
    projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
      const newList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse();
      // Sonido de notificacion al recibir mensaje nuevo de OTRO usuario.
      // Solo suena en main app si la ventana del chat NO esta abierta (cerrada
      // con X). Si la ventana del chat existe (visible u oculta), el sonido lo
      // reproduce el chat-renderer para evitar doble notificacion.
      if (chatNotificationsArmed) {
        const previousIds = new Set(chatMessages.map(m => m.id));
        const newOnes = newList.filter(m => !previousIds.has(m.id));
        // Filtrar mensajes propios — el campo correcto es authorId (no userId)
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
      depositEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
      ideas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
      const newDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
      captionTemplates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
function visibleScheduledPosts() {
  if (!currentUser) return [];
  // Todo el equipo ve todos los posts (programados, borradores, publicados, fallos).
  // La idea: si el admin deja borradores, cualquier miembro puede retomarlos y
  // terminarlos. Programaciones del equipo son visibles para todos para que el
  // calendario sea coherente.
  return scheduledPosts.slice();
}
function renderScheduleListView() {
  const container = document.getElementById('scheduleListView');
  if (!container) return;
  const items = visibleScheduledPosts();
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">&#128241;</div><div class="empty-state-text">No hay posts programados</div><div class="empty-state-sub">Marca una tarea finalizada con &quot;&#128241; Programar&quot; para enviar a tu cuenta de Instagram via Make.com</div></div>`;
    return;
  }
  container.innerHTML = items.map(p => {
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
    const platformLabel = (p.postType || 'post').toUpperCase();
    return `
      <div class="sched-card ${cls}">
        <div class="sched-card-thumb" ${thumb}></div>
        <div class="sched-card-body">
          <div class="sched-card-when">${esc(fmtScheduledDate(p.scheduledAt))} &middot; ${esc(platformLabel)}</div>
          <div class="sched-card-caption">${esc(cap)}</div>
          <div class="sched-card-meta">${scheduleStatusPill(p.status || 'pending')} &middot; por ${esc(p.createdByName || 'Anonimo')}</div>
        </div>
        <div class="sched-card-actions">${editBtn}${cancelBtn}</div>
      </div>`;
  }).join('');
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
  });
  // Boton +Anadir desactivado al llegar al max
  const addBtn = document.getElementById('schedAddCarouselUrl');
  if (addBtn) addBtn.disabled = rows.length >= CAROUSEL_MAX;
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
  count.textContent = `(${lines.length} ${lines.length === 1 ? 'imagen' : 'imagenes'})`;
  thumbs.innerHTML = lines.map((url, i) => {
    const thumbUrl = mediaThumbUrl(url);
    const isVid = isVideoUrl(url);
    const playIcon = isVid ? '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:32px;color:white;text-shadow:0 2px 8px rgba(0,0,0,0.6)">▶</div>' : '';
    if (thumbUrl) {
      return `
      <div style="flex:0 0 auto;width:120px;height:150px;border-radius:6px;overflow:hidden;background:var(--bg-card) center/cover no-repeat;background-image:url('${thumbUrl.replace(/'/g, '%27')}');border:1px solid var(--border);scroll-snap-align:start;position:relative">
        <div style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.7);color:white;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${i + 1}</div>
        ${playIcon}
      </div>`;
    }
    // Video no-Cloudinary: usar video tag inline (preload metadata para 1er frame)
    return `
      <div style="flex:0 0 auto;width:120px;height:150px;border-radius:6px;overflow:hidden;background:var(--bg-card);border:1px solid var(--border);scroll-snap-align:start;position:relative">
        <video src="${url.replace(/"/g, '%22')}" muted preload="metadata" playsinline style="width:100%;height:100%;object-fit:cover"></video>
        <div style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.7);color:white;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${i + 1}</div>
        ${playIcon}
      </div>`;
  }).join('');
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
  editingPostId = id;
  applyScheduleModalLabels();
  modal.classList.add('active');
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
  const payload = {
    platform: 'instagram',
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

  const payload = {
    platform: 'instagram',
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
    if (task.videoLink) {
      videoBadge = `<span class="task-tag" style="background:rgba(255,90,90,0.2);color:#ff8a8a;cursor:pointer" onclick="openTaskVideo('personalTasks','${task.id}')" title="${esc(task.videoLink)}">🎬 Video de referencia</span>`;
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
      if (task.videoLink) {
        videoBadge = `<span class="task-tag" style="background:rgba(255,90,90,0.2);color:#ff8a8a;cursor:pointer" onclick="openTaskVideo('tasks','${task.id}')" title="${esc(task.videoLink)}">🎬 Video de referencia</span>`;
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

      html += `
        <div class="task-item ${overdueClass}" data-id="${task.id}" data-project-id="${task.projectId || ''}" data-project-name="${esc(task.projectName || '')}" style="border-left-color:${group.color}">
          ${checkBtn}
          <div style="flex:1">
            <div class="task-text">${esc(task.text)}</div>
            <div class="task-meta">
              ${assigneeChips(task)}
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

function renderAssignSelect() {
  const current = el.assignSelect.value;
  el.assignSelect.innerHTML = '<option value="">Asignar a...</option>';
  teamMembers.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name + (m.id === currentUser.uid ? ' (yo)' : '');
    el.assignSelect.appendChild(opt);
  });
  if (current) el.assignSelect.value = current;
}


function renderTeam() {
  if (teamMembers.length === 0) {
    el.teamList.innerHTML = '<div class="empty-state"><div class="empty-state-text">No hay miembros</div></div>';
    return;
  }

  let html = '';
  teamMembers.forEach((m, i) => {
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
document.getElementById('submitTaskLinkInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('submitTaskConfirm').click();
});
document.getElementById('submitTaskModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('submitTaskModal')) {
    document.getElementById('submitTaskModal').classList.remove('active');
    submittingTaskId = null;
  }
});

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
  });
});

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
        const snap = await db.collection('config').doc('instagram').get();
        const remote = snap.exists ? snap.data().makeWebhookUrl : null;
        if (remote !== url) {
          await db.collection('config').doc('instagram').set({
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
        await db.collection('config').doc('instagram').set({
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
      await db.collection('config').doc('cloudinary').set({
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
    const snap = await db.collection('config').doc('cloudinary').get();
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
el.btnClose.addEventListener('click', () => window.api.closeWindow());

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
});

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
    try { await window.api.toggleChat(); } catch (e) { console.error(e); }
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
      console.log('[ProMode] click — solicitando toggle...');
      const state = await window.api.toggleProMode();
      const s = typeof state === 'string' ? state : (state ? 'full' : 'off');
      console.log('[ProMode] nuevo estado:', s);
      applyProBtnLabel(s);
    } catch (e) {
      console.error('[ProMode] error:', e);
    }
  });
}
