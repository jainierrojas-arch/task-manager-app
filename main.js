const { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu, MenuItem, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Anthropic = require('@anthropic-ai/sdk').default;

// Simple local store for window settings and telegram token
class JsonStore {
  constructor(defaults) {
    this.defaults = defaults;
    this.filePath = null;
    this.data = { ...defaults };
  }

  init() {
    this.filePath = path.join(app.getPath('userData'), 'task-manager-settings.json');
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = { ...this.defaults, ...JSON.parse(raw) };
      }
    } catch (e) {
      this.data = { ...this.defaults };
    }
  }

  get(key) {
    return this.data[key] !== undefined ? this.data[key] : this.defaults[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving settings:', e);
    }
  }
}

const store = new JsonStore({
  windowBounds: { width: 500, height: 750 },
  alwaysOnTop: true,
  opacity: 0.95,
  telegramToken: '',
  claudeApiKey: '',
  reminderIntervalMinutes: 0,
  tabsMultirow: false,
  // URL de webhook de Make.com para programar contenido en redes sociales
  // (Instagram via Graph API). El usuario lo configura en Settings; cuando
  // marca una tarea como "programar", la app envia un POST con los datos del
  // post a este webhook, y Make se encarga de publicar/programar.
  makeWebhookUrl: '',
  // Cloudinary unsigned upload: el usuario configura cloud name + preset una
  // sola vez en Settings. Eso permite subir archivos directos desde la app
  // sin necesidad de API secret (modo unsigned). Las URLs resultantes se
  // pegan automaticamente en el modal de Programar.
  cloudinaryCloudName: '',
  cloudinaryUploadPreset: '',
  // URL de webhook de GoHighLevel para publicar en TikTok via Social Planner.
  // Workflow en GHL: Inbound Webhook -> Create Social Post -> TikTok account.
  // Cuando el usuario marca "TikTok" en el modal Programar, la Cloud Function
  // tambien manda payload aqui (en paralelo al webhook de Make/Instagram).
  ghlTiktokWebhookUrl: ''
});

let mainWindow;
let depositWindow;
let chatWindow;
let telegramBot;
let TelegramBotLib;
let anthropic;

// Conecta el spell-checker nativo de Chromium + menu contextual con sugerencias
// al hacer click derecho sobre una palabra mal escrita en cualquier campo de
// texto. Aplica a TODA la app (main, deposito, chat).
function setupSpellChecker(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.session.setSpellCheckerLanguages(['es', 'en-US']);
  } catch (e) { /* algunos sistemas no soportan dos idiomas, ignoramos */ }
  win.webContents.on('context-menu', (event, params) => {
    const menu = new Menu();
    let added = false;
    // 1) Sugerencias del diccionario para la palabra mal escrita
    for (const suggestion of (params.dictionarySuggestions || [])) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => win.webContents.replaceMisspelling(suggestion)
      }));
      added = true;
    }
    if (params.misspelledWord) {
      if (added) menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: `Agregar "${params.misspelledWord}" al diccionario`,
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }));
      added = true;
    }
    // 2) Acciones de edicion estandar (Cortar/Copiar/Pegar)
    const flags = params.editFlags || {};
    const canEdit = flags.canCut || flags.canCopy || flags.canPaste || flags.canSelectAll;
    if (canEdit) {
      if (added) menu.append(new MenuItem({ type: 'separator' }));
      if (flags.canCut) menu.append(new MenuItem({ role: 'cut', label: 'Cortar' }));
      if (flags.canCopy) menu.append(new MenuItem({ role: 'copy', label: 'Copiar' }));
      if (flags.canPaste) menu.append(new MenuItem({ role: 'paste', label: 'Pegar' }));
      if (flags.canSelectAll) menu.append(new MenuItem({ role: 'selectAll', label: 'Seleccionar todo' }));
      added = true;
    }
    if (added) menu.popup({ window: win });
  });
}

// Modo PRO ciclico: 'off' -> 'full' (deposito+main+chat) -> 'no-chat' (deposito+main) -> 'off'
let proModeState = 'off';
let proModePrevBounds = null;
function isProActive() { return proModeState !== 'off'; }

function computeDepositBounds(width, height) {
  // Deposito siempre prefiere lado IZQUIERDO (matching layout de modo PRO).
  // Si no cabe a la izquierda, intenta derecha. Si tampoco cabe, reposiciona
  // la ventana principal para hacer espacio en lugar de superponer.
  let bounds = { x: 100, y: 100, width, height };
  if (!mainWindow || mainWindow.isDestroyed()) return bounds;
  const mb = mainWindow.getBounds();
  const display = screen.getDisplayMatching(mb) || screen.getPrimaryDisplay();
  const wa = display.workArea;
  const maxH = Math.min(Math.max(600, mb.height), wa.height - 20);
  bounds.height = maxH;
  bounds.width = Math.min(width, wa.width - 40);
  bounds.y = Math.max(wa.y + 10, Math.min(mb.y, wa.y + wa.height - maxH - 10));
  const leftX = mb.x - bounds.width - 4;
  const rightX = mb.x + mb.width + 4;
  if (leftX >= wa.x) {
    bounds.x = leftX;
  } else if (rightX + bounds.width <= wa.x + wa.width) {
    bounds.x = rightX;
  } else {
    // No cabe a los lados: encoger el deposito para que quepa en el espacio
    // a la derecha de la ventana principal. NUNCA empujar la ventana principal —
    // eso causa la sensacion de "barrera invisible" cuando el usuario arrastra
    // main a los bordes (el deposito lo empuja de vuelta).
    bounds.x = rightX;
    bounds.width = Math.max(300, wa.x + wa.width - rightX - 4);
    if (bounds.width < 300) {
      // Ni siquiera asi cabe: anclar a la izquierda del area visible y aceptar
      // overlap parcial con main (el usuario decide si reduce el ancho).
      bounds.x = wa.x;
      bounds.width = Math.min(width, wa.width - 40);
    }
  }
  return bounds;
}

function positionDepositWindow() {
  if (!depositWindow || depositWindow.isDestroyed()) return;
  if (isProActive()) return; // En modo PRO el layout es fijo
  const cur = depositWindow.getBounds();
  const b = computeDepositBounds(cur.width, cur.height);
  depositWindow.setBounds(b);
}

function toggleDepositWindow() {
  // Ventana ya existe -> toggle visible/oculto (evita re-inicializar Firebase)
  if (depositWindow && !depositWindow.isDestroyed()) {
    if (depositWindow.isVisible()) {
      depositWindow.hide();
    } else {
      positionDepositWindow();
      depositWindow.show();
      depositWindow.focus();
    }
    return;
  }
  // Primera vez: crear la ventana con ubicacion calculada
  const b = computeDepositBounds(820, 720);
  depositWindow = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 700, minHeight: 500,
    frame: false, resizable: true, skipTaskbar: false,
    show: false,
    parent: mainWindow || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'deposit-preload.js')
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 },
    backgroundColor: '#1a1b2e'
  });
  depositWindow.loadFile('deposit.html');
  setupSpellChecker(depositWindow);

  // Mostrar cuando este lista. Fallback: si ready-to-show no dispara en 3s,
  // mostrar igual para evitar ventana fantasma (p.ej. Windows con Firebase lento)
  let shown = false;
  const showOnce = () => {
    if (shown || !depositWindow || depositWindow.isDestroyed()) return;
    shown = true;
    depositWindow.show();
    depositWindow.focus();
  };
  depositWindow.once('ready-to-show', showOnce);
  setTimeout(showOnce, 3000);

  depositWindow.webContents.on('did-fail-load', (_, errCode, errDesc, url) => {
    console.error('[deposit] did-fail-load:', errCode, errDesc, url);
  });
  depositWindow.on('closed', () => { depositWindow = null; });

  // Seguir el movimiento de la ventana principal
  if (mainWindow && !mainWindow.isDestroyed()) {
    const follow = () => positionDepositWindow();
    mainWindow.on('move', follow);
    mainWindow.on('resize', follow);
    depositWindow.on('closed', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeListener('move', follow);
        mainWindow.removeListener('resize', follow);
      }
    });
  }
}

function computeChatBounds(width, height) {
  // Chat siempre prefiere lado DERECHO (matching layout de modo PRO).
  let bounds = { x: 100, y: 100, width, height };
  if (!mainWindow || mainWindow.isDestroyed()) return bounds;
  const mb = mainWindow.getBounds();
  const display = screen.getDisplayMatching(mb) || screen.getPrimaryDisplay();
  const wa = display.workArea;
  const maxH = Math.min(Math.max(500, mb.height), wa.height - 20);
  bounds.height = maxH;
  bounds.width = Math.min(width, wa.width - 40);
  bounds.y = Math.max(wa.y + 10, Math.min(mb.y, wa.y + wa.height - maxH - 10));
  const rightX = mb.x + mb.width + 4;
  const leftX = mb.x - bounds.width - 4;
  if (rightX + bounds.width <= wa.x + wa.width) {
    bounds.x = rightX;
  } else if (leftX >= wa.x) {
    bounds.x = leftX;
  } else {
    // No cabe a los lados: encoger el chat para que quepa a la izquierda de
    // la ventana principal. NUNCA empujar main — eso crea "barrera invisible"
    // al arrastrar.
    bounds.x = wa.x;
    bounds.width = Math.max(300, mb.x - wa.x - 4);
    if (bounds.width < 300) {
      // Ni siquiera asi cabe: anclar a la derecha y aceptar overlap parcial.
      bounds.width = Math.min(width, wa.width - 40);
      bounds.x = wa.x + wa.width - bounds.width;
    }
  }
  return bounds;
}

function positionChatWindow() {
  if (!chatWindow || chatWindow.isDestroyed()) return;
  if (isProActive()) return; // En modo PRO el layout es fijo
  const cur = chatWindow.getBounds();
  const b = computeChatBounds(cur.width, cur.height);
  chatWindow.setBounds(b);
}

function toggleChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isVisible()) {
      chatWindow.hide();
    } else {
      positionChatWindow();
      chatWindow.show();
      chatWindow.focus();
    }
    return;
  }
  const b = computeChatBounds(560, 680);
  chatWindow = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 460, minHeight: 480,
    frame: false, resizable: true, skipTaskbar: false,
    show: false,
    parent: mainWindow || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'chat-preload.js')
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 },
    backgroundColor: '#1a1b2e'
  });
  chatWindow.loadFile('chat.html');
  setupSpellChecker(chatWindow);

  let shown = false;
  const showOnce = () => {
    if (shown || !chatWindow || chatWindow.isDestroyed()) return;
    shown = true;
    chatWindow.show();
    chatWindow.focus();
  };
  chatWindow.once('ready-to-show', showOnce);
  setTimeout(showOnce, 3000);

  chatWindow.webContents.on('did-fail-load', (_, errCode, errDesc, url) => {
    console.error('[chat] did-fail-load:', errCode, errDesc, url);
  });
  chatWindow.on('closed', () => { chatWindow = null; });

  if (mainWindow && !mainWindow.isDestroyed()) {
    const follow = () => positionChatWindow();
    mainWindow.on('move', follow);
    mainWindow.on('resize', follow);
    chatWindow.on('closed', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeListener('move', follow);
        mainWindow.removeListener('resize', follow);
      }
    });
  }
}

function applyProModeLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = screen.getDisplayMatching(mainWindow.getBounds()) || screen.getPrimaryDisplay();
  const wa = display.workArea;
  const totalW = wa.width;
  const totalH = wa.height;
  const depositW = Math.floor(totalW * 0.30);
  const chatW = Math.floor(totalW * 0.30);
  const mainW = totalW - depositW - chatW;
  const depositX = wa.x;
  const mainX = wa.x + depositW;
  const chatX = wa.x + depositW + mainW;
  // Bajar minimos temporalmente para que setBounds no sea clampado por minWidth/minHeight
  // (deposit tiene minWidth 700, chat 460, main 420 — en pantallas <2400px se desbordan)
  if (depositWindow && !depositWindow.isDestroyed()) depositWindow.setMinimumSize(200, 200);
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.setMinimumSize(200, 200);
  mainWindow.setMinimumSize(200, 200);
  if (depositWindow && !depositWindow.isDestroyed()) {
    depositWindow.setBounds({ x: depositX, y: wa.y, width: depositW, height: totalH });
    if (!depositWindow.isVisible()) depositWindow.show();
  }
  mainWindow.setBounds({ x: mainX, y: wa.y, width: mainW, height: totalH });
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.setBounds({ x: chatX, y: wa.y, width: chatW, height: totalH });
    if (!chatWindow.isVisible()) chatWindow.show();
  }
}

function sendDepositViewMode(mode, persist) {
  if (!depositWindow || depositWindow.isDestroyed()) return;
  const send = () => {
    if (!depositWindow || depositWindow.isDestroyed()) return;
    depositWindow.webContents.send('deposit-set-view-mode', { mode, persist });
  };
  if (depositWindow.webContents.isLoading()) {
    depositWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function applyProModeNoChatLayout() {
  // Layout 2 ventanas: deposito + principal divididas 50/50 en el ancho total. Chat oculto.
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = screen.getDisplayMatching(mainWindow.getBounds()) || screen.getPrimaryDisplay();
  const wa = display.workArea;
  const totalW = wa.width;
  const totalH = wa.height;
  const depositW = Math.floor(totalW * 0.50);
  const mainW = totalW - depositW;
  const depositX = wa.x;
  const mainX = wa.x + depositW;
  // Bajar minimos temporalmente para evitar clamping en pantallas pequenas
  if (depositWindow && !depositWindow.isDestroyed()) depositWindow.setMinimumSize(200, 200);
  mainWindow.setMinimumSize(200, 200);
  if (depositWindow && !depositWindow.isDestroyed()) {
    depositWindow.setBounds({ x: depositX, y: wa.y, width: depositW, height: totalH });
    if (!depositWindow.isVisible()) depositWindow.show();
  }
  mainWindow.setBounds({ x: mainX, y: wa.y, width: mainW, height: totalH });
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()) {
    chatWindow.hide();
  }
}

function snapshotPrevBoundsIfNeeded() {
  if (proModePrevBounds) return;
  proModePrevBounds = {
    main: mainWindow.getBounds(),
    deposit: depositWindow && !depositWindow.isDestroyed() ? depositWindow.getBounds() : null,
    chat: chatWindow && !chatWindow.isDestroyed() ? chatWindow.getBounds() : null,
    depositWasOpen: !!(depositWindow && !depositWindow.isDestroyed() && depositWindow.isVisible()),
    chatWasOpen: !!(chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible())
  };
}

function enterProModeFull() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  snapshotPrevBoundsIfNeeded();
  proModeState = 'full';
  if (!depositWindow || depositWindow.isDestroyed()) toggleDepositWindow();
  if (!chatWindow || chatWindow.isDestroyed()) toggleChatWindow();
  setTimeout(() => applyProModeLayout(), 200);
  applyProModeLayout();
  // En modo PRO el deposito siempre se muestra en horizontal (sin sobrescribir la preferencia guardada del usuario)
  sendDepositViewMode('horizontal', false);
  setTimeout(() => sendDepositViewMode('horizontal', false), 250);
}

function enterProModeNoChat() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  snapshotPrevBoundsIfNeeded();
  proModeState = 'no-chat';
  if (!depositWindow || depositWindow.isDestroyed()) toggleDepositWindow();
  setTimeout(() => applyProModeNoChatLayout(), 200);
  applyProModeNoChatLayout();
  // En modo PRO el deposito sigue en horizontal aunque no este el chat
  sendDepositViewMode('horizontal', false);
  setTimeout(() => sendDepositViewMode('horizontal', false), 250);
}

// Verifica que un objeto bounds tenga valores validos antes de setBounds
function isValidBounds(b) {
  if (!b || typeof b !== 'object') return false;
  if (typeof b.x !== 'number' || typeof b.y !== 'number') return false;
  if (typeof b.width !== 'number' || typeof b.height !== 'number') return false;
  if (b.width < 100 || b.height < 100) return false;
  return true;
}

function exitProMode() {
  if (proModeState === 'off') return;
  proModeState = 'off';
  proModePrevBounds = null;

  // Modo SIMPLE — minimal y robusto. NO toca la ventana principal (se queda
  // donde este). Solo oculta chat y deposito. Todas las operaciones aisladas
  // en try/catch para que un fallo en una NO afecte a las otras.
  const safe = (label, fn) => {
    try { fn(); } catch (e) { console.error('[exitProMode] ' + label + ':', e); }
  };

  safe('main minSize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setMinimumSize(420, 600);
  });
  safe('deposit minSize', () => {
    if (depositWindow && !depositWindow.isDestroyed()) depositWindow.setMinimumSize(700, 500);
  });
  safe('chat minSize', () => {
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.setMinimumSize(460, 480);
  });

  // Ocultar deposito (siempre)
  safe('hide deposit', () => {
    if (depositWindow && !depositWindow.isDestroyed() && depositWindow.isVisible()) {
      depositWindow.hide();
    }
  });

  // Ocultar chat (siempre)
  safe('hide chat', () => {
    if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()) {
      chatWindow.hide();
    }
  });

  // NO se toca mainWindow — se queda donde este. El usuario puede arrastrarla
  // o redimensionarla a su gusto. Esto evita cualquier crash relacionado con
  // setBounds en algunas configuraciones de Mac.
}

// Ciclo: off -> full (3 ventanas) -> no-chat (2 ventanas) -> off
function toggleProMode() {
  if (proModeState === 'off') {
    enterProModeFull();
  } else if (proModeState === 'full') {
    // Pasar a no-chat: ocultar chat y reacomodar deposito+main
    proModeState = 'no-chat';
    applyProModeNoChatLayout();
  } else {
    exitProMode();
  }
  return proModeState;
}

function initAnthropic() {
  const key = store.get('claudeApiKey');
  anthropic = key ? new Anthropic({ apiKey: key }) : null;
}

function createWindow() {
  const bounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: bounds.width || 500,
    height: bounds.height || 750,
    x: bounds.x,
    y: bounds.y,
    minWidth: 420,
    minHeight: 600,
    alwaysOnTop: store.get('alwaysOnTop'),
    frame: false,
    transparent: false,
    resizable: true,
    skipTaskbar: false,
    opacity: store.get('opacity'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // v3.11.0: habilitar <webview> tag para el Explorador embebido (IG/TikTok)
      webviewTag: true
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 }
  });

  mainWindow.loadFile('index.html');
  setupSpellChecker(mainWindow);

  mainWindow.on('resize', () => {
    if (isProActive()) return;
    store.set('windowBounds', mainWindow.getBounds());
  });

  mainWindow.on('move', () => {
    if (isProActive()) return;
    store.set('windowBounds', mainWindow.getBounds());
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Telegram Bot - communicates with renderer via IPC for Firebase operations
function initTelegram() {
  const token = store.get('telegramToken');
  if (!token) return;

  try {
    if (!TelegramBotLib) {
      TelegramBotLib = require('node-telegram-bot-api');
    }

    if (telegramBot) {
      telegramBot.stopPolling();
    }

    telegramBot = new TelegramBotLib(token, { polling: true });

    telegramBot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      telegramBot.sendMessage(chatId,
        '*Task Manager - Bot de Equipo*\n\n' +
        'Primero vincula tu cuenta:\n' +
        '`/vincular tu@email.com`\n\n' +
        'Comandos:\n' +
        '`/nueva Proyecto | Tarea`\n' +
        '`/asignar Proyecto | Tarea | email`\n' +
        '`/tareas` - Ver tus tareas\n' +
        '`/todas` - Ver todas las tareas del equipo\n' +
        '`/completar [numero]`\n' +
        '`/proyectos` - Ver proyectos\n' +
        '`/equipo` - Ver miembros',
        { parse_mode: 'Markdown' }
      );
    });

    // Link Telegram to user account
    telegramBot.onText(/\/vincular (.+)/, (msg, match) => {
      const chatId = msg.chat.id;
      const email = match[1].trim().toLowerCase();

      if (mainWindow) {
        mainWindow.webContents.send('telegram-link-user', { chatId: chatId.toString(), email });
      }

      telegramBot.sendMessage(chatId, `Vinculando con *${email}*...\nSi la cuenta existe, quedara conectada.`, { parse_mode: 'Markdown' });
    });

    // Add task via Telegram
    telegramBot.onText(/\/nueva (.+)/, (msg, match) => {
      const chatId = msg.chat.id;
      const input = match[1].trim();
      const parts = input.split('|').map(s => s.trim());

      if (parts.length < 2) {
        telegramBot.sendMessage(chatId, 'Formato: `/nueva Proyecto | Tarea`', { parse_mode: 'Markdown' });
        return;
      }

      if (mainWindow) {
        mainWindow.webContents.send('telegram-add-task', {
          chatId: chatId.toString(),
          projectName: parts[0],
          taskText: parts[1]
        });
      }
    });

    // Assign task via Telegram
    telegramBot.onText(/\/asignar (.+)/, (msg, match) => {
      const chatId = msg.chat.id;
      const input = match[1].trim();
      const parts = input.split('|').map(s => s.trim());

      if (parts.length < 3) {
        telegramBot.sendMessage(chatId, 'Formato: `/asignar Proyecto | Tarea | email@usuario`', { parse_mode: 'Markdown' });
        return;
      }

      if (mainWindow) {
        mainWindow.webContents.send('telegram-assign-task', {
          chatId: chatId.toString(),
          projectName: parts[0],
          taskText: parts[1],
          assignToEmail: parts[2].toLowerCase()
        });
      }
    });

    // List user's tasks
    telegramBot.onText(/\/tareas$/, (msg) => {
      const chatId = msg.chat.id;
      if (mainWindow) {
        mainWindow.webContents.send('telegram-get-my-tasks', { chatId: chatId.toString() });
      }
    });

    // List all team tasks
    telegramBot.onText(/\/todas$/, (msg) => {
      const chatId = msg.chat.id;
      if (mainWindow) {
        mainWindow.webContents.send('telegram-get-all-tasks', { chatId: chatId.toString() });
      }
    });

    // Complete task
    telegramBot.onText(/\/completar (\d+)/, (msg, match) => {
      const chatId = msg.chat.id;
      const taskIndex = parseInt(match[1]);

      if (mainWindow) {
        mainWindow.webContents.send('telegram-complete-task', { chatId: chatId.toString(), taskIndex });
      }
    });

    // List projects
    telegramBot.onText(/\/proyectos$/, (msg) => {
      const chatId = msg.chat.id;
      if (mainWindow) {
        mainWindow.webContents.send('telegram-get-projects', { chatId: chatId.toString() });
      }
    });

    // List team
    telegramBot.onText(/\/equipo$/, (msg) => {
      const chatId = msg.chat.id;
      if (mainWindow) {
        mainWindow.webContents.send('telegram-get-team', { chatId: chatId.toString() });
      }
    });

    // Natural-language messages (anything that does NOT start with /)
    telegramBot.on('message', (msg) => {
      const text = (msg.text || '').trim();
      if (!text || text.startsWith('/')) return;
      if (mainWindow) {
        mainWindow.webContents.send('telegram-natural-message', {
          chatId: msg.chat.id.toString(),
          text
        });
      }
    });

    console.log('Telegram bot initialized successfully');
  } catch (error) {
    console.error('Error initializing Telegram bot:', error);
  }
}

// IPC: Send message to Telegram from renderer
ipcMain.on('telegram-send-message', (_, { chatId, message }) => {
  if (!telegramBot || !chatId) {
    const err = !telegramBot ? 'Bot no esta activo (token vacio)' : 'chatId vacio';
    console.warn('[telegram] cannot send', err);
    if (mainWindow) mainWindow.webContents.send('telegram-send-error', { chatId, error: err });
    return;
  }
  telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' })
    .catch(err => {
      console.warn('[telegram] Markdown failed, retry plain:', err.message);
      telegramBot.sendMessage(chatId, message)
        .catch(err2 => {
          console.error('[telegram] send failed:', err2.message, 'chatId:', chatId);
          if (mainWindow) mainWindow.webContents.send('telegram-send-error', { chatId, error: err2.message });
        });
    });
});

// IPC: Notify all linked Telegram users
ipcMain.on('telegram-notify-all', (_, { chatIds, message }) => {
  if (!telegramBot || !chatIds) return;
  chatIds.forEach(chatId => {
    telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' })
      .catch(err => {
        console.warn('[telegram] notify-all failed with Markdown, retrying plain:', err.message);
        telegramBot.sendMessage(chatId, message)
          .catch(err2 => console.error('[telegram] notify-all failed completely:', err2.message));
      });
  });
});

function registerIpcHandlers() {
  ipcMain.handle('get-telegram-token', () => store.get('telegramToken'));
  ipcMain.handle('get-always-on-top', () => store.get('alwaysOnTop'));

  ipcMain.handle('set-telegram-token', (_, token) => {
    store.set('telegramToken', token);
    initTelegram();
    return true;
  });

  ipcMain.handle('get-claude-api-key-status', () => {
    const k = store.get('claudeApiKey');
    return k ? `Configurada (...${k.slice(-6)})` : '';
  });

  // Make.com webhook (programacion de contenido en Instagram via Make)
  ipcMain.handle('get-make-webhook', () => store.get('makeWebhookUrl') || '');
  ipcMain.handle('set-make-webhook', (_, url) => {
    const clean = String(url || '').trim();
    if (clean && !/^https?:\/\//i.test(clean)) {
      return { ok: false, error: 'La URL debe empezar con http:// o https://' };
    }
    store.set('makeWebhookUrl', clean);
    return { ok: true };
  });
  // v3.11.51: conexión a Instagram dentro de la app — abre ventana de login,
  // captura cookies de la sesión y las guarda. Compartibles vía Firestore para
  // que TODO el equipo herede la conexión sin pasos individuales.
  ipcMain.handle('connect-instagram', async () => {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 480,
        height: 720,
        title: 'Conectar Instagram',
        autoHideMenuBar: true,
        webPreferences: {
          partition: 'persist:tm-instagram',
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false
        }
      });
      let resolved = false;
      async function tryCapture(navUrl) {
        if (resolved) return;
        if (!navUrl || navUrl.includes('/accounts/login') || navUrl.includes('/accounts/signup')) return;
        if (!navUrl.includes('instagram.com')) return;
        try {
          const sess = win.webContents.session;
          const cookies = await sess.cookies.get({ domain: '.instagram.com' });
          const sessionCookie = cookies.find(c => c.name === 'sessionid' && c.value);
          if (!sessionCookie) return; // todavía no logueado
          resolved = true;
          const userId = (cookies.find(c => c.name === 'ds_user_id') || {}).value || null;
          try { win.close(); } catch (_) {}
          resolve({ ok: true, cookies, userId });
        } catch (e) {
          resolved = true;
          try { win.close(); } catch (_) {}
          resolve({ ok: false, error: 'No se pudieron leer las cookies: ' + e.message });
        }
      }
      win.webContents.on('did-navigate', (_, u) => tryCapture(u));
      win.webContents.on('did-navigate-in-page', (_, u) => tryCapture(u));
      win.on('closed', () => {
        if (!resolved) {
          resolved = true;
          resolve({ ok: false, error: 'Ventana cerrada antes de loguearte. Volvé a intentar e iniciá sesión.' });
        }
      });
      win.loadURL('https://www.instagram.com/accounts/login/');
    });
  });

  // Helper: convertir array de cookies Electron a formato Netscape (yt-dlp lo lee)
  function cookiesToNetscape(cookieList) {
    let txt = '# Netscape HTTP Cookie File\n# Generated by Task Manager\n\n';
    for (const c of (cookieList || [])) {
      if (!c || !c.name) continue;
      const domain = c.domain && c.domain.startsWith('.') ? c.domain : ('.' + (c.domain || 'instagram.com'));
      const cpath = c.path || '/';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expires = c.expirationDate ? Math.floor(c.expirationDate) : 0;
      txt += [domain, 'TRUE', cpath, secure, expires, c.name, c.value].join('\t') + '\n';
    }
    return txt;
  }

  // Guarda cookies al disco (userData/instagram-cookies.txt) para yt-dlp.
  ipcMain.handle('save-instagram-cookies', async (_, cookieList) => {
    try {
      const p = path.join(app.getPath('userData'), 'instagram-cookies.txt');
      if (!cookieList || !cookieList.length) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
        return { ok: true, deleted: true };
      }
      const txt = cookiesToNetscape(cookieList);
      fs.writeFileSync(p, txt, 'utf-8');
      return { ok: true, path: p, count: cookieList.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Devuelve true/false si el cookie file local existe.
  ipcMain.handle('has-instagram-cookies-file', async () => {
    try {
      const p = path.join(app.getPath('userData'), 'instagram-cookies.txt');
      return fs.existsSync(p);
    } catch (_) { return false; }
  });

  // v3.11.61: captura de gimbal BT remote pareado a la Mac (no al iPhone).
  // El remote envía VolumeUp/VolumeDown cuando se pulsa. Electron globalShortcut
  // los intercepta y reenvía a renderer → renderer manda comando al celular
  // via Firestore → celular ejecuta. Cero dependencia de iOS PWA APIs.
  let _gimbalRegistered = false;
  ipcMain.handle('register-gimbal-shortcuts', async () => {
    if (_gimbalRegistered) return { ok: true, alreadyRegistered: true };
    function emit() {
      const wins = BrowserWindow.getAllWindows();
      wins.forEach(w => { try { w.webContents.send('gimbal-shortcut-pressed'); } catch (_) {} });
    }
    const okUp = globalShortcut.register('VolumeUp', emit);
    const okDown = globalShortcut.register('VolumeDown', emit);
    // Algunos remotes / teclados envían MediaPlayPause como botón shutter
    const okMedia = globalShortcut.register('MediaPlayPause', emit);
    _gimbalRegistered = true;
    return { ok: true, registered: { volumeUp: okUp, volumeDown: okDown, mediaPlayPause: okMedia } };
  });
  ipcMain.handle('unregister-gimbal-shortcuts', async () => {
    try {
      globalShortcut.unregister('VolumeUp');
      globalShortcut.unregister('VolumeDown');
      globalShortcut.unregister('MediaPlayPause');
    } catch (e) { console.warn('[gimbal] unregister failed', e.message); }
    _gimbalRegistered = false;
    return { ok: true };
  });
  // Cleanup al cerrar la app
  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch (_) {}
  });

  // v3.11.46: llamada a Whisper/Groq desde el proceso main (Node https) en vez
  // del XHR del renderer. En Windows con firewall corporativo, Chromium fetch
  // se cuelga silenciosamente; Node usa el stack OS-nativo y suele andar.
  ipcMain.handle('call-transcription-api', async (_, { apiKey, audioBase64, mimeType, filename, isGroq }) => {
    if (!apiKey || !audioBase64) return { ok: false, error: 'apiKey o audio vacío' };
    const httpsLib = require('https');
    const url = require('url');
    const audioBuf = Buffer.from(audioBase64, 'base64');
    const endpoint = isGroq
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions';
    const modelName = isGroq ? 'whisper-large-v3' : 'whisper-1';
    // Construir multipart/form-data manualmente
    const boundary = '----TMformbnd' + Date.now() + Math.random().toString(36).slice(2);
    const parts = [];
    function pushTextField(name, value) {
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + '\r\n'));
    }
    function pushFileField(name, fileName, mime, buf) {
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"; filename="' + fileName + '"\r\nContent-Type: ' + mime + '\r\n\r\n'));
      parts.push(buf);
      parts.push(Buffer.from('\r\n'));
    }
    pushTextField('model', modelName);
    pushTextField('language', 'es');
    pushFileField('file', filename || 'audio.mp4', mimeType || 'audio/mpeg', audioBuf);
    parts.push(Buffer.from('--' + boundary + '--\r\n'));
    const body = Buffer.concat(parts);
    const parsed = url.parse(endpoint);
    return await new Promise((resolve) => {
      const req = httpsLib.request({
        method: 'POST',
        hostname: parsed.hostname,
        port: 443,
        path: parsed.path,
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': body.length
        },
        timeout: 150000,
        lookup: dohLookup // v3.11.71: DoH bypass para ISP que bloquean api.openai.com / api.groq.com
      }, (res) => {
        let chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const txt = Buffer.concat(chunks).toString('utf-8');
          try {
            const data = JSON.parse(txt || '{}');
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ ok: true, text: (data.text || '').trim() });
            } else {
              const errMsg = (data.error && data.error.message) || ('HTTP ' + res.statusCode);
              resolve({ ok: false, status: res.statusCode, error: errMsg.slice(0, 500) });
            }
          } catch (e) {
            resolve({ ok: false, status: res.statusCode, error: 'Respuesta inválida: ' + txt.slice(0, 200) });
          }
        });
      });
      req.on('timeout', () => { try { req.destroy(); } catch (_) {} resolve({ ok: false, error: 'Timeout 150s — la red está bloqueando o el provider está lento' }); });
      req.on('error', (e) => { resolve({ ok: false, error: 'Error de red: ' + e.message + ' (' + (e.code || '?') + ')' }); });
      req.write(body);
      req.end();
    });
  });

  // v3.11.38: auto-download de yt-dlp si no está instalado en el sistema.
  // Antes requeríamos `brew install yt-dlp` manualmente — para Windows no hay
  // brew y el equipo no podía transcribir. Ahora la app descarga el binario
  // oficial de yt-dlp GitHub releases (~12MB win / ~30MB mac) a userData/
  // la primera vez y queda cacheado.
  async function ensureYtDlpBundled() {
    const httpsLib = require('https');
    const userDataDir = app.getPath('userData');
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const binName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
    const binPath = path.join(userDataDir, binName);
    if (fs.existsSync(binPath)) {
      try { const st = fs.statSync(binPath); if (st.size > 100000) return binPath; } catch (_) {}
    }
    // Descargar de GitHub releases — URL por plataforma
    const downloadUrl = isWin
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : isMac
        ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
        : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
    console.log('[yt-dlp] Descargando binario:', downloadUrl);
    // Avisar al renderer (para que muestre status)
    try {
      const wins = BrowserWindow.getAllWindows();
      wins.forEach(w => { try { w.webContents.send('ytdlp-download-start'); } catch (_) {} });
    } catch (_) {}
    await new Promise((resolve, reject) => {
      const tmpPath = binPath + '.tmp';
      const file = fs.createWriteStream(tmpPath);
      function get(url, redirectsLeft) {
        httpsLib.get(url, (res) => {
          // Seguir redirect (GitHub releases redirige a CDN)
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirectsLeft <= 0) return reject(new Error('Demasiados redirects'));
            res.resume();
            return get(res.headers.location, redirectsLeft - 1);
          }
          if (res.statusCode !== 200) {
            return reject(new Error('HTTP ' + res.statusCode + ' bajando yt-dlp'));
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => {
            try { fs.renameSync(tmpPath, binPath); } catch (e) { return reject(e); }
            // Permisos +x en Mac/Linux
            if (!isWin) { try { fs.chmodSync(binPath, 0o755); } catch (_) {} }
            resolve();
          }));
        }).on('error', (e) => {
          try { fs.unlinkSync(tmpPath); } catch (_) {}
          reject(e);
        });
      }
      get(downloadUrl, 5);
    });
    console.log('[yt-dlp] Descargado en:', binPath);
    return binPath;
  }

  // v3.11.71: DNS-over-HTTPS resolver para bypasear bloqueos de ISP.
  // Algunos ISPs (especialmente en Venezuela / Cuba / Irán) bloquean dominios
  // de scrapers a nivel DNS. Cloudflare 1.1.1.1 expone un endpoint DoH al que
  // se llega vía IP directa (no requiere DNS del ISP), así obtenemos el IP
  // real del scraper aunque el ISP lo tenga bloqueado.
  // Estrategia: intentamos Cloudflare 1.1.1.1 → si falla, Google 8.8.8.8 →
  // si falla, dns.lookup del sistema como último recurso.
  const _dohCache = new Map(); // hostname → { ip, expires }
  // v3.11.74: FIX TLS — el SNI tiene que ser el hostname del DNS server, no el IP.
  // Sin esto, el certificado TLS de Cloudflare/Google no matcheaba y la conexión fallaba
  // silenciosamente → caíamos a dns.lookup del sistema → ENOTFOUND.
  const DOH_SERVERS = {
    '1.1.1.1': 'cloudflare-dns.com',
    '8.8.8.8': 'dns.google',
    '9.9.9.9': 'dns.quad9.net'
  };
  function dohResolveOnce(dohHost, hostname) {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const req = https.request({
        host: dohHost,
        port: 443,
        path: '/dns-query?name=' + encodeURIComponent(hostname) + '&type=A',
        method: 'GET',
        servername: DOH_SERVERS[dohHost] || dohHost, // FIX TLS SNI
        headers: { 'Accept': 'application/dns-json', 'User-Agent': 'TaskManager', 'Host': DOH_SERVERS[dohHost] || dohHost },
        timeout: 4000
      }, (res) => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            const a = json.Answer && json.Answer.find(x => x.type === 1);
            if (a && a.data) return resolve(a.data);
            reject(new Error('no A record'));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { try { req.destroy(); } catch (_) {} reject(new Error('timeout')); });
      req.end();
    });
  }
  function dohLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    // Cache hits primero (TTL 5 min)
    const cached = _dohCache.get(hostname);
    if (cached && cached.expires > Date.now()) {
      return callback(null, cached.ip, 4);
    }
    // v3.11.74: cascada de 3 servidores DoH. Si todos fallan, dns.lookup del sistema.
    dohResolveOnce('1.1.1.1', hostname)
      .catch(e => { console.log('[doh] cloudflare failed:', e.message); return dohResolveOnce('8.8.8.8', hostname); })
      .catch(e => { console.log('[doh] google failed:', e.message); return dohResolveOnce('9.9.9.9', hostname); })
      .then(ip => {
        console.log('[doh] resolved', hostname, '→', ip);
        _dohCache.set(hostname, { ip, expires: Date.now() + 5 * 60 * 1000 });
        callback(null, ip, 4);
      })
      .catch(e => {
        console.warn('[doh] all DoH failed, falling back to system DNS:', e.message);
        require('dns').lookup(hostname, options, callback);
      });
  }

  // v3.11.53 + v3.11.71: helpers HTTP con DoH activado (bypassea ISP DNS blocks).
  function httpsGetBuffer(targetUrl, headers, redirectsLeft) {
    if (typeof redirectsLeft !== 'number') redirectsLeft = 6;
    const url = require('url');
    const https = require('https');
    const http = require('http');
    const parsed = url.parse(targetUrl);
    const lib = parsed.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = lib.request({
        method: 'GET',
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.path,
        headers: Object.assign({
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        }, headers || {}),
        lookup: dohLookup // v3.11.71: bypass ISP DNS via Cloudflare/Google DoH
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error('Demasiados redirects'));
          res.resume();
          httpsGetBuffer(res.headers.location, headers, redirectsLeft - 1).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ buf: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout 60s')); });
      req.end();
    });
  }
  function httpsPostString(targetUrl, body, headers) {
    const url = require('url');
    const https = require('https');
    const parsed = url.parse(targetUrl);
    return new Promise((resolve, reject) => {
      const req = https.request({
        method: 'POST',
        hostname: parsed.hostname,
        port: 443,
        path: parsed.path,
        headers: Object.assign({
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Content-Length': Buffer.byteLength(body)
        }, headers || {}),
        lookup: dohLookup // v3.11.71: bypass ISP DNS via Cloudflare/Google DoH
      }, (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf-8') }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout 30s')); });
      req.write(body);
      req.end();
    });
  }

  // Snapinsta: scraper público para Instagram. Devuelve URL del video.
  async function scrapeIgViaSnapinsta(igUrl) {
    const body = 'q=' + encodeURIComponent(igUrl) + '&t=media&lang=en';
    const res = await httpsPostString('https://snapinsta.app/api/ajaxSearch', body, {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': 'https://snapinsta.app',
      'Referer': 'https://snapinsta.app/',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': '*/*'
    });
    if (res.status !== 200) throw new Error('snapinsta HTTP ' + res.status);
    let json;
    try { json = JSON.parse(res.text); }
    catch (_) { throw new Error('snapinsta no devolvió JSON'); }
    if (json.status !== 'ok' || !json.data) throw new Error('snapinsta sin data: ' + (json.mess || 'desconocido'));
    const html = String(json.data);
    // Buscar la URL del video — primero la versión sin marca de agua / mp4
    const patterns = [
      /href="([^"]+\.mp4[^"]*)"[^>]*>\s*<[^>]*>(?:[^<]*)?Download\s*Video/i,
      /href="([^"]+\.mp4[^"]*)"/i,
      /data-href="([^"]+\.mp4[^"]*)"/i,
      /<a[^>]+href="([^"]+)"[^>]*>\s*Download/i
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1]) {
        return m[1].replace(/&amp;/g, '&').replace(/\\\//g, '/');
      }
    }
    throw new Error('snapinsta: no encontré URL del video en la respuesta');
  }

  // v3.11.68 + v3.11.70: scraper alternativo para IG — fastdl.app con parser más robusto
  async function scrapeIgViaFastdl(igUrl) {
    const body = 'url=' + encodeURIComponent(igUrl);
    const res = await httpsPostString('https://fastdl.app/api/convert', body, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://fastdl.app',
      'Referer': 'https://fastdl.app/',
      'Accept': 'application/json'
    });
    if (res.status !== 200) throw new Error('fastdl HTTP ' + res.status);
    let json;
    try { json = JSON.parse(res.text); }
    catch (_) { throw new Error('fastdl no devolvió JSON'); }
    // Recorrer recursivamente buscando una URL .mp4
    function findVideoUrl(obj, depth) {
      if (depth > 5 || !obj) return null;
      if (typeof obj === 'string') {
        if (/\.mp4/i.test(obj) && /^https?:\/\//.test(obj)) return obj;
        return null;
      }
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const r = findVideoUrl(item, depth + 1);
          if (r) return r;
        }
        return null;
      }
      if (typeof obj === 'object') {
        const priority = ['url', 'src', 'dlUrl', 'mp4', 'video_url', 'videoUrl'];
        for (const k of priority) {
          if (obj[k]) {
            const r = findVideoUrl(obj[k], depth + 1);
            if (r) return r;
          }
        }
        for (const k of Object.keys(obj)) {
          if (priority.includes(k)) continue;
          const r = findVideoUrl(obj[k], depth + 1);
          if (r) return r;
        }
      }
      return null;
    }
    const url = findVideoUrl(json, 0);
    if (url) return url;
    throw new Error('fastdl: respuesta sin URL de video');
  }

  // v3.11.70: scraper alternativo #3 — snapsave.app (dominio distinto, menos chance de DNS block)
  async function scrapeIgViaSnapsave(igUrl) {
    const body = 'url=' + encodeURIComponent(igUrl) + '&action=post';
    const res = await httpsPostString('https://snapsave.app/action.php', body, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://snapsave.app',
      'Referer': 'https://snapsave.app/',
      'Accept': '*/*'
    });
    if (res.status !== 200) throw new Error('snapsave HTTP ' + res.status);
    const html = res.text;
    const m = html.match(/href="([^"]+\.mp4[^"]*)"/i);
    if (m && m[1]) return m[1].replace(/&amp;/g, '&').replace(/\\\//g, '/');
    throw new Error('snapsave: no encontré URL en respuesta');
  }

  // v3.11.70: scraper alternativo #4 — igram.io (dominio distinto)
  async function scrapeIgViaIgram(igUrl) {
    const body = JSON.stringify({ url: igUrl, ts: Date.now() });
    const res = await httpsPostString('https://api.igram.io/api/convert', body, {
      'Content-Type': 'application/json',
      'Origin': 'https://igram.io',
      'Referer': 'https://igram.io/',
      'Accept': 'application/json'
    });
    if (res.status !== 200) throw new Error('igram HTTP ' + res.status);
    let json;
    try { json = JSON.parse(res.text); } catch (_) { throw new Error('igram no devolvió JSON'); }
    // igram a veces devuelve { url: [{ url, ... }] }
    const u = (json.url && Array.isArray(json.url) && json.url[0] && json.url[0].url) ||
              (json.data && json.data.url) || json.video_url;
    if (u) return u;
    throw new Error('igram: respuesta sin URL');
  }

  // v3.11.68: scraper alternativo #2 — saveig.app fallback
  async function scrapeIgViaSaveig(igUrl) {
    const body = 'url=' + encodeURIComponent(igUrl);
    const res = await httpsPostString('https://saveig.app/api/ajaxSearch', body, {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': 'https://saveig.app',
      'Referer': 'https://saveig.app/en',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': '*/*'
    });
    if (res.status !== 200) throw new Error('saveig HTTP ' + res.status);
    let json;
    try { json = JSON.parse(res.text); }
    catch (_) { throw new Error('saveig no devolvió JSON'); }
    if (json.status !== 'ok' || !json.data) throw new Error('saveig sin data');
    const html = String(json.data);
    const m = html.match(/href="([^"]+\.mp4[^"]*)"/i);
    if (m && m[1]) return m[1].replace(/&amp;/g, '&').replace(/\\\//g, '/');
    throw new Error('saveig: no encontré URL en el HTML');
  }

  // tikwm: scraper público para TikTok. GET JSON con URL del video directa.
  async function scrapeTiktokViaTikwm(ttUrl) {
    const fetchUrl = 'https://www.tikwm.com/api/?url=' + encodeURIComponent(ttUrl);
    const result = await httpsGetBuffer(fetchUrl, { 'Accept': 'application/json' });
    let json;
    try { json = JSON.parse(result.buf.toString('utf-8')); }
    catch (_) { throw new Error('tikwm no devolvió JSON'); }
    if (json.code !== 0 || !json.data) throw new Error('tikwm error: ' + (json.msg || 'desconocido'));
    const videoUrl = json.data.hdplay || json.data.play || json.data.wmplay;
    if (!videoUrl) throw new Error('tikwm: no encontré URL del video');
    return videoUrl;
  }

  // v3.11.68: wrapper con cascada de scrapers — si el primero falla, prueba el siguiente.
  async function tryPublicScraper(platformUrl) {
    let videoUrl = null;
    let provider = '';
    const errors = [];
    if (/instagram\.com/i.test(platformUrl)) {
      // v3.11.70: 5 scrapers en cascada con dominios distintos para minimizar bloqueos DNS
      const igScrapers = [
        { name: 'snapinsta', fn: scrapeIgViaSnapinsta },
        { name: 'fastdl', fn: scrapeIgViaFastdl },
        { name: 'snapsave', fn: scrapeIgViaSnapsave },
        { name: 'igram', fn: scrapeIgViaIgram },
        { name: 'saveig', fn: scrapeIgViaSaveig }
      ];
      for (const s of igScrapers) {
        try {
          videoUrl = await s.fn(platformUrl);
          if (videoUrl) { provider = s.name; break; }
        } catch (e) {
          errors.push(s.name + ': ' + e.message);
          console.warn('[scraper]', s.name, 'failed:', e.message);
        }
      }
    } else if (/tiktok\.com/i.test(platformUrl)) {
      try {
        provider = 'tikwm';
        videoUrl = await scrapeTiktokViaTikwm(platformUrl);
      } catch (e) {
        errors.push('tikwm: ' + e.message);
      }
    } else {
      return { ok: false, skip: true };
    }
    if (!videoUrl) {
      return { ok: false, error: 'Scrapers fallaron: ' + errors.join(' | '), skip: false };
    }
    // Descargar el video desde la URL del scraper. Whisper acepta mp4 con audio incluido.
    try {
      const dl = await httpsGetBuffer(videoUrl);
      const buf = dl.buf;
      if (buf.length > 25 * 1024 * 1024) {
        return { ok: false, error: 'Audio/video > 25MB (límite de Whisper). Probá un video más corto.' };
      }
      if (buf.length < 5000) {
        return { ok: false, error: provider + ': descarga muy chica (' + buf.length + ' bytes), URL inválida' };
      }
      // Inferir extensión y MIME a partir del content-type o de la URL
      let ext = 'mp4';
      let mimeType = 'video/mp4';
      const ct = (dl.contentType || '').toLowerCase();
      if (ct.includes('webm')) { ext = 'webm'; mimeType = 'video/webm'; }
      else if (ct.includes('mpeg') || ct.includes('mp3')) { ext = 'mp3'; mimeType = 'audio/mpeg'; }
      else if (ct.includes('mp4') || ct.includes('video')) { ext = 'mp4'; mimeType = 'video/mp4'; }
      return { ok: true, data: buf.toString('base64'), mimeType, ext, size: buf.length, provider };
    } catch (e) {
      return { ok: false, error: provider + ' descarga: ' + e.message };
    }
  }

  // v3.9.17 + v3.11.38 + v3.11.53: extract-audio-via-ytdlp.
  // Estrategia: primero scraper público (no requiere auth, ni cookies, ni prompts).
  // Si la plataforma no es IG/TikTok o el scraper falla, cae a yt-dlp como antes.
  ipcMain.handle('extract-audio-via-ytdlp', async (_, platformUrl) => {
    if (!platformUrl) return { ok: false, error: 'URL vacía' };

    // v3.11.53: scraper público primero — funciona sin auth para IG y TikTok.
    const scraperRes = await tryPublicScraper(platformUrl);
    if (scraperRes && scraperRes.ok) {
      return scraperRes;
    }
    // Si el scraper se saltó (otra plataforma) o falló, intentamos yt-dlp.
    console.log('[extract] scraper resultado:', scraperRes && scraperRes.error ? scraperRes.error : 'skip', '→ cae a yt-dlp');

    const os = require('os');
    const { spawn } = require('child_process');
    const tempBasePath = path.join(os.tmpdir(), `tm-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const tempPath = tempBasePath + '.%(ext)s';

    // Si no hay nada en el sistema, auto-bootstrap descarga el binario oficial.
    // Esto ocurre la primera vez en cualquier máquina (incluido Windows sin brew).
    let bundledPath = null;
    try { bundledPath = await ensureYtDlpBundled(); }
    catch (bootErr) {
      console.warn('[yt-dlp] auto-bootstrap falló:', bootErr.message);
    }

    // Buscar yt-dlp: primero el bundleado, luego PATHs comunes del sistema.
    const home = os.homedir();
    const ytdlpPaths = [];
    if (bundledPath && fs.existsSync(bundledPath)) ytdlpPaths.push(bundledPath);
    ytdlpPaths.push(
      path.join(home, '.local/bin/yt-dlp'),
      '/opt/homebrew/bin/yt-dlp',
      '/usr/local/bin/yt-dlp',
      path.join(home, 'bin/yt-dlp'),
      'yt-dlp',
      'yt-dlp.exe'
    );

    // Encontrar binario que efectivamente exista. Para los path absolutos
    // chequeamos fs.existsSync; "yt-dlp"/"yt-dlp.exe" se prueban a ejecutar.
    function resolveBinary() {
      for (const p of ytdlpPaths) {
        if (p.includes('/') || p.includes('\\')) {
          if (fs.existsSync(p)) return p;
        } else {
          // Path-relativo: lo asumimos disponible vía PATH y dejamos que spawn falle si no.
          return p;
        }
      }
      return null;
    }
    const ytdlpBin = resolveBinary();
    if (!ytdlpBin) {
      return { ok: false, error: 'yt-dlp no instalado', errorCode: 'NOT_INSTALLED' };
    }

    // v3.11.47: ejecuta yt-dlp UNA vez con args dados y devuelve {ok, file, stderr, stdoutLast, code}.
    // Permite re-llamar con estrategias distintas (cookies de chrome, safari, etc).
    function runYtDlp(extraArgs, label) {
      return new Promise((resolve) => {
        const baseArgs = [
          '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[ext=webm]/bestaudio/best[ext=mp4]/best[ext=webm]/best',
          '-o', tempPath,
          '--no-playlist',
          '--no-warnings',
          '--no-progress',
          '--no-check-certificate',
          '--max-filesize', '25M'
        ];
        const args = baseArgs.concat(extraArgs || []).concat([platformUrl]);
        let proc;
        try { proc = spawn(ytdlpBin, args); }
        catch (e) { return resolve({ ok: false, error: 'spawn falló: ' + e.message }); }
        let stderr = '';
        let stdoutLast = '';
        let timedOut = false;
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        if (proc.stdout) proc.stdout.on('data', (d) => { stdoutLast = d.toString().slice(-200); });
        proc.on('error', (e) => { resolve({ ok: false, error: e.message, errorCode: e.code === 'ENOENT' ? 'NOT_INSTALLED' : null }); });
        proc.on('close', (code) => {
          const candidates = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(path.basename(tempBasePath)));
          if (code === 0 && candidates.length > 0) {
            resolve({ ok: true, fileName: candidates[0] });
          } else {
            for (const c of candidates) {
              try { fs.unlinkSync(path.join(os.tmpdir(), c)); } catch (_) {}
            }
            resolve({ ok: false, code, stderr: stderr.slice(-400), stdoutLast: stdoutLast.slice(-200), timedOut, label });
          }
        });
        setTimeout(() => { try { timedOut = true; proc.kill(); } catch (_) {} }, 180000);
      });
    }

    // v3.11.52: cascade simplificado. IG bot detection (2026) rechaza cookies
    // que no provengan del browser donde el usuario realmente se logueó. Solo
    // `--cookies-from-browser` (Chrome/Edge/etc reales) funciona confiable.
    // Las cookies de la app (Electron BrowserWindow) son rechazadas por IG.
    // Orden: para Instagram, browsers que SEGURO funcionan primero. Para no-IG
    // (TikTok/YouTube), 'sin cookies' va al frente porque la mayoría andan así.
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const isInstagram = /instagram\.com/i.test(platformUrl);
    const strategies = [];
    // v3.11.68: en Windows, Chrome/Brave/Edge tienen DPAPI encryption nueva que
    // yt-dlp no puede decifrar (issue 10927). Solo usar Firefox que es la única
    // confiable. En Mac, el orden anterior se mantiene.
    if (isInstagram) {
      if (isWin) {
        // Solo Firefox confiable en Windows (DPAPI rompe Chrome/Edge/Brave)
        strategies.push({ label: 'cookies de firefox', args: ['--cookies-from-browser', 'firefox'] });
      } else {
        // Mac/Linux: cascade completa
        strategies.push({ label: 'cookies de chrome', args: ['--cookies-from-browser', 'chrome'] });
        strategies.push({ label: 'cookies de brave', args: ['--cookies-from-browser', 'brave'] });
        strategies.push({ label: 'cookies de firefox', args: ['--cookies-from-browser', 'firefox'] });
      }
    } else {
      // TikTok / YouTube / etc — la mayoría no requieren cookies.
      strategies.push({ label: 'sin cookies', args: [] });
      if (isWin) {
        strategies.push({ label: 'cookies de firefox', args: ['--cookies-from-browser', 'firefox'] });
      } else {
        strategies.push({ label: 'cookies de chrome', args: ['--cookies-from-browser', 'chrome'] });
        strategies.push({ label: 'cookies de firefox', args: ['--cookies-from-browser', 'firefox'] });
      }
    }

    let lastFail = null;
    for (const strat of strategies) {
      const res = await runYtDlp(strat.args, strat.label);
      if (res.ok) {
        // ÉXITO — leer archivo y devolver
        const filePath = path.join(os.tmpdir(), res.fileName);
        try {
          const buf = fs.readFileSync(filePath);
          fs.unlinkSync(filePath);
          if (buf.length > 25 * 1024 * 1024) {
            return { ok: false, error: 'Audio muy grande (>25MB) — video demasiado largo para Whisper' };
          }
          const ext = path.extname(res.fileName).slice(1).toLowerCase();
          const mimeMap = { m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/opus' };
          const mimeType = mimeMap[ext] || 'application/octet-stream';
          return { ok: true, data: buf.toString('base64'), mimeType, ext, size: buf.length, strategy: strat.label };
        } catch (e) {
          return { ok: false, error: 'Error leyendo audio: ' + e.message };
        }
      }
      lastFail = res;
      // Si el error NO es de cookies/auth, no tiene sentido reintentar con cookies
      // de otros browsers — el reintento es solo cuando hay señales claras de auth needed.
      const needsCookies = /cookie|sign[- ]in|log[- ]?in required|authentication|403|429|gate/i.test(res.stderr || '');
      if (!needsCookies) break;
      // Si el strategy actual ya intentó cookies y falló porque el browser no está instalado,
      // probamos el siguiente (sigue loop).
    }

    // Todas las estrategias fallaron
    let errMsg;
    const r = lastFail || {};
    const looksLikeIgAuth = /cookie|sign[- ]in|log[- ]?in required|authentication|403/i.test(r.stderr || '');
    if (r.timedOut) {
      errMsg = 'yt-dlp timeout (180s). El video puede ser muy largo o la red está lenta. ';
      errMsg += 'Última actividad: ' + ((r.stdoutLast || '').trim() || 'sin output').slice(-150);
      if (r.stderr) errMsg += ' | stderr: ' + r.stderr.trim().slice(-150);
    } else if (looksLikeIgAuth && /instagram/i.test(platformUrl)) {
      // v3.11.70: detectar errores ENOTFOUND (DNS bloqueado por ISP/VPN) y dar instrucción concreta
      const scraperErrTxt = (scraperRes && scraperRes.error) ? scraperRes.error : 'desconocido';
      const dnsBlocked = /ENOTFOUND|EAI_AGAIN|EHOSTUNREACH/i.test(scraperErrTxt);
      if (dnsBlocked) {
        errMsg = '🚫 Tu ISP/VPN está bloqueando los servidores de descarga (DNS ENOTFOUND).\n\n' +
          'SOLUCIÓN (5 min, una vez):\n' +
          '1) Windows: Configuración → Red e Internet → tu conexión (Wi-Fi o Ethernet) → "Editar" asignación de servidor DNS.\n' +
          '2) Manual → IPv4 → DNS preferido: 1.1.1.1, DNS alternativo: 1.0.0.1 (Cloudflare).\n' +
          '3) Guardar y reintentar Transcribir.\n\n' +
          'Detalle técnico: ' + scraperErrTxt.slice(-150);
      } else {
        errMsg = 'No se pudo descargar el video. Todos los métodos fallaron:\n\n' +
          'Scrapers (snapinsta/fastdl/snapsave/igram/saveig): ' + scraperErrTxt.slice(-200) + '\n\n' +
          'yt-dlp (' + (r.label || '?') + '): ' + ((r.stderr || '').slice(-150).trim() || 'sin detalles') + '\n\n' +
          'Reintentá en 1-2 minutos (algunos scrapers tienen rate limit transitorio).';
      }
    } else {
      const stderrTrim = (r.stderr || '').trim();
      errMsg = stderrTrim
        ? 'yt-dlp falló (exit ' + r.code + ', estrategia: ' + (r.label || '?') + '): ' + stderrTrim
        : 'yt-dlp exit ' + r.code + ' sin output (estrategia: ' + (r.label || '?') + '). Última actividad: ' + ((r.stdoutLast || '').trim() || 'ninguna');
    }
    return { ok: false, error: errMsg };
  });

  ipcMain.handle('send-to-make-webhook', async (_, payload) => {
    const url = store.get('makeWebhookUrl');
    if (!url) return { ok: false, error: 'Webhook URL no configurada' };
    try {
      const https = require('https');
      const http = require('http');
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const body = JSON.stringify(payload || {});
      return await new Promise((resolve) => {
        const req = lib.request({
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'User-Agent': 'TaskManager/1.0'
          }
        }, (res) => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            const ok = res.statusCode >= 200 && res.statusCode < 300;
            resolve({ ok, status: res.statusCode, body: data.slice(0, 500) });
          });
        });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.setTimeout(15000, () => { try { req.destroy(); } catch (_) {} resolve({ ok: false, error: 'Timeout (15s)' }); });
        req.write(body);
        req.end();
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // GHL TikTok webhook: igual que Make pero para Social Planner de
  // GoHighLevel. La Cloud Function lee este URL desde config/instagram (mismo
  // doc para no proliferar config docs) y lo llama si el post tiene
  // platforms incluyendo "tiktok".
  ipcMain.handle('get-ghl-tiktok-webhook', () => store.get('ghlTiktokWebhookUrl') || '');
  ipcMain.handle('set-ghl-tiktok-webhook', (_, url) => {
    const clean = String(url || '').trim();
    if (clean && !/^https?:\/\//i.test(clean)) {
      return { ok: false, error: 'La URL debe empezar con http:// o https://' };
    }
    store.set('ghlTiktokWebhookUrl', clean);
    return { ok: true };
  });

  // Cloudinary config: cloud name + upload preset (modo unsigned).
  // Se usa para subir archivos directos desde el modal Programar.
  ipcMain.handle('get-cloudinary-config', () => ({
    cloudName: store.get('cloudinaryCloudName') || '',
    uploadPreset: store.get('cloudinaryUploadPreset') || ''
  }));
  ipcMain.handle('set-cloudinary-config', (_, cfg) => {
    if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'Config invalida' };
    const cloudName = String(cfg.cloudName || '').trim();
    const uploadPreset = String(cfg.uploadPreset || '').trim();
    store.set('cloudinaryCloudName', cloudName);
    store.set('cloudinaryUploadPreset', uploadPreset);
    return { ok: true };
  });

  ipcMain.handle('get-reminder-interval', () => store.get('reminderIntervalMinutes') || 0);
  ipcMain.handle('set-reminder-interval', (_, minutes) => {
    store.set('reminderIntervalMinutes', Number(minutes) || 0);
    return true;
  });

  ipcMain.handle('get-tabs-multirow', () => !!store.get('tabsMultirow'));
  ipcMain.handle('set-tabs-multirow', (_, v) => {
    store.set('tabsMultirow', !!v);
    return !!v;
  });

  ipcMain.handle('open-external', (_, url) => {
    if (typeof url !== 'string') return false;
    if (!/^https?:\/\//i.test(url)) return false;
    shell.openExternal(url);
    return true;
  });

  ipcMain.handle('set-claude-api-key', (_, key) => {
    store.set('claudeApiKey', key);
    initAnthropic();
    return true;
  });

  // v3.9.20: handler de generación de texto libre con Claude (para reescribir
  // guiones, captions, etc). Diferente de call-claude que fuerza tool_use.
  ipcMain.handle('generate-with-claude', async (_, { prompt, model, maxTokens }) => {
    if (!anthropic) return { ok: false, error: 'no-api-key' };
    try {
      const response = await anthropic.messages.create({
        model: model || 'claude-sonnet-4-6',
        max_tokens: maxTokens || 2000,
        messages: [{ role: 'user', content: prompt }]
      });
      const textBlock = response.content.find(b => b.type === 'text');
      return { ok: true, text: (textBlock && textBlock.text) ? textBlock.text : '' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('call-claude', async (_, { systemPrompt, userMessage, tools }) => {
    if (!anthropic) return { error: 'no-api-key' };
    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: userMessage }]
      });
      const toolUse = response.content.find(b => b.type === 'tool_use');
      if (toolUse) return { tool: toolUse.name, input: toolUse.input };
      const textBlock = response.content.find(b => b.type === 'text');
      return { tool: 'reply_message', input: { text: textBlock?.text || 'No entendi tu mensaje.' } };
    } catch (error) {
      console.error('Claude API error:', error.message);
      return { error: error.message };
    }
  });

  ipcMain.handle('toggle-always-on-top', () => {
    const current = store.get('alwaysOnTop');
    store.set('alwaysOnTop', !current);
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(!current);
    }
    return !current;
  });

  ipcMain.handle('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
  });

  // v3.11.30: maximize/restore toggle
  ipcMain.handle('maximize-window', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    } else {
      mainWindow.maximize();
      return true;
    }
  });

  ipcMain.handle('close-window', () => {
    if (mainWindow) mainWindow.hide();
  });

  // Chat lateral: expande ventana al abrir, la colapsa al cerrar
  let preChatWidth = null;
  ipcMain.handle('chat-expand-window', (_, extraWidth) => {
    if (!mainWindow) return false;
    const add = Number(extraWidth) || 320;
    const b = mainWindow.getBounds();
    preChatWidth = b.width;
    mainWindow.setBounds({ x: b.x, y: b.y, width: b.width + add, height: b.height }, true);
    return true;
  });
  ipcMain.handle('chat-collapse-window', () => {
    if (!mainWindow || preChatWidth == null) return false;
    const b = mainWindow.getBounds();
    mainWindow.setBounds({ x: b.x, y: b.y, width: preChatWidth, height: b.height }, true);
    preChatWidth = null;
    return true;
  });

  // Deposito: toggle. Devuelve true si quedo visible, false si se oculto/cerro.
  ipcMain.handle('toggle-deposit-window', () => {
    toggleDepositWindow();
    return !!(depositWindow && !depositWindow.isDestroyed() && depositWindow.isVisible());
  });

  // ===== Open Graph fetcher =====
  // Estrategia en cascada para extraer imagen real del primer frame de un link:
  //   1) HTTP simple con User-Agent de Facebook bot (rapido, ~95% de sitios)
  //   2) Para Instagram: probar /embed/captioned/ que es publico y NO requiere login
  //   3) BrowserWindow oculto con Chromium real (carga JS, maneja redirecciones de login)
  function fetchOgViaHttp(url, userAgent) {
    return new Promise((resolve) => {
      let redirectsLeft = 5;
      const ua = userAgent || 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
      const fetchUrl = (u) => {
        try {
          const parsed = new URL(u);
          const lib = parsed.protocol === 'https:' ? require('https') : require('http');
          const req = lib.get({
            host: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            headers: {
              'User-Agent': ua,
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'es,en;q=0.9'
            }
          }, (res) => {
            if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307) && res.headers.location && redirectsLeft > 0) {
              redirectsLeft--;
              const next = new URL(res.headers.location, u).href;
              res.resume();
              return fetchUrl(next);
            }
            if (res.statusCode !== 200) {
              res.resume();
              return resolve({ image: null, title: null, description: null });
            }
            let html = '';
            const maxBytes = 400 * 1024;
            res.setEncoding('utf8');
            res.on('data', chunk => {
              html += chunk;
              if (html.length > maxBytes) { res.destroy(); }
            });
            res.on('end', () => {
              const findMeta = (prop) => {
                const re1 = new RegExp(`<meta\\s+(?:property|name)=["']${prop}["']\\s+content=["']([^"']+)["']`, 'i');
                const re2 = new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+(?:property|name)=["']${prop}["']`, 'i');
                const m = html.match(re1) || html.match(re2);
                return m ? m[1] : null;
              };
              // Para Instagram embed: el thumbnail real esta en el SRCSET del
              // <img class="EmbeddedMediaImage">. El src apunta a lookaside.instagram
              // que devuelve un 302 al HTML del reel (NO a una imagen) — por eso
              // si lo usamos directo el background-image queda vacio. El srcset
              // en cambio trae URLs scontent.cdninstagram.com que sí cargan como
              // imagen. Formato srcset: "url1 640w, url2 750w, url3 1080w".
              const decodeHtmlEntities = (s) => {
                if (!s) return s;
                return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
                  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
                  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
              };
              let embedImg = null;
              const srcsetMatch = html.match(/<img[^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]*srcset=["']([^"']+)["']/i)
                || html.match(/<img[^>]+srcset=["']([^"']+)["'][^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["']/i);
              if (srcsetMatch) {
                // Tomar la 1ra URL del srcset (resolucion mas baja, suele ser 640w)
                const firstEntry = srcsetMatch[1].split(',')[0].trim();
                const firstUrl = firstEntry.split(/\s+/)[0];
                if (firstUrl) embedImg = decodeHtmlEntities(firstUrl);
              }
              // Fallback: cualquier URL scontent.cdninstagram.com en el HTML
              if (!embedImg) {
                const sm = html.match(/(https:\/\/scontent[^"\s]+\.(?:jpg|webp))/i);
                if (sm) embedImg = decodeHtmlEntities(sm[1]);
              }
              // Ultimo: el src del EmbeddedMediaImage (probablemente lookaside,
              // que NO carga como imagen pero al menos no es null)
              if (!embedImg) {
                const embedMatch = html.match(/<img[^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]+src=["']([^"']+)["']/i)
                  || html.match(/<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["']/i);
                if (embedMatch) embedImg = decodeHtmlEntities(embedMatch[1]);
              }
              resolve({
                image: findMeta('og:image') || findMeta('twitter:image') || embedImg,
                title: findMeta('og:title') || findMeta('twitter:title'),
                description: findMeta('og:description') || findMeta('twitter:description')
              });
            });
            res.on('error', () => resolve({ image: null, title: null, description: null }));
          });
          req.on('error', () => resolve({ image: null, title: null, description: null }));
          req.setTimeout(7000, () => { try { req.destroy(); } catch (_) {} resolve({ image: null, title: null, description: null }); });
        } catch (e) {
          resolve({ image: null, title: null, description: null });
        }
      };
      fetchUrl(url);
    });
  }

  function fetchOgViaMicrolink(url) {
    // microlink.io renderiza la pagina con un navegador real server-side.
    // Free tier: 100 requests/dia por IP. Maneja Instagram/TikTok/sitios JS-heavy
    // que bloquean scraping desde el cliente. Es el truco que usan apps tipo
    // WhatsApp/Slack/Discord (con sus propios servicios o el mismo microlink).
    return new Promise((resolve) => {
      try {
        const https = require('https');
        // prerender=auto fuerza render de JavaScript en el lado servidor de Microlink.
        // Es necesario para Instagram carruseles, TikTok y otros sitios JS-heavy.
        const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&audio=false&video=false&iframe=false&prerender=auto&meta=true`;
        const parsed = new URL(apiUrl);
        const req = https.get({
          host: parsed.hostname,
          path: parsed.pathname + parsed.search,
          headers: { 'User-Agent': 'TaskManager/1.0' }
        }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return resolve({ image: null, title: null, description: null });
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', c => { body += c; if (body.length > 500 * 1024) res.destroy(); });
          res.on('end', () => {
            try {
              const json = JSON.parse(body);
              if (json && json.status === 'success' && json.data) {
                const d = json.data;
                const imgObj = d.image || d.logo || null;
                resolve({
                  image: (imgObj && imgObj.url) || null,
                  imageWidth: (imgObj && imgObj.width) || null,
                  imageHeight: (imgObj && imgObj.height) || null,
                  title: d.title || null,
                  description: d.description || null
                });
              } else {
                resolve({ image: null, title: null, description: null });
              }
            } catch (e) { resolve({ image: null, title: null, description: null }); }
          });
          res.on('error', () => resolve({ image: null, title: null, description: null }));
        });
        req.on('error', () => resolve({ image: null, title: null, description: null }));
        req.setTimeout(10000, () => { try { req.destroy(); } catch (_) {} resolve({ image: null, title: null, description: null }); });
      } catch (e) {
        resolve({ image: null, title: null, description: null });
      }
    });
  }

  function fetchOgViaBrowser(url) {
    // Carga la pagina en un BrowserWindow oculto y extrae meta tags despues de que JS haya corrido.
    return new Promise((resolve) => {
      let win = null;
      let done = false;
      const cleanup = () => { try { if (win && !win.isDestroyed()) win.close(); } catch (_) {} };
      const finish = (data) => {
        if (done) return; done = true;
        cleanup();
        resolve(data || { image: null, title: null, description: null });
      };
      try {
        win = new BrowserWindow({
          show: false,
          width: 1280,
          height: 900,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            // v3.11.14: usar el mismo partition que el Explorer para tener
            // las cookies del usuario (logueado en IG). Sin esto, IG mostraba
            // login wall al fetcher y devolvía og:description vacía.
            partition: 'persist:explorer'
          }
        });
        const timeout = setTimeout(() => finish(null), 7000);
        const extract = async () => {
          try {
            const data = await win.webContents.executeJavaScript(`
              (() => {
                const get = (sel) => { const el = document.querySelector(sel); return el ? el.getAttribute('content') : null; };
                let img = get('meta[property="og:image"]') || get('meta[name="twitter:image"]');
                if (!img) {
                  // Para embed de Instagram: el thumbnail real esta en el SRCSET
                  // del <img class="EmbeddedMediaImage">. El src apunta a
                  // lookaside.instagram.com que es un 302 al HTML, NO una imagen.
                  const embImg = document.querySelector('img.EmbeddedMediaImage');
                  if (embImg) {
                    const srcset = embImg.getAttribute('srcset');
                    if (srcset) {
                      const firstEntry = srcset.split(',')[0].trim();
                      img = firstEntry.split(/\\s+/)[0];
                    }
                    if (!img) {
                      const src = embImg.getAttribute('src');
                      if (src && !src.includes('lookaside.instagram.com')) img = src;
                    }
                  }
                }
                if (!img) {
                  const embedded = document.querySelector('img[src*="scontent"][src*="cdninstagram"], video[poster]');
                  if (embedded) img = embedded.getAttribute('src') || embedded.getAttribute('poster');
                }
                let title = get('meta[property="og:title"]') || get('meta[name="twitter:title"]') || document.title;
                let description = get('meta[property="og:description"]') || get('meta[name="twitter:description"]');
                // v3.11.14: si og:description está vacío (ej. IG reel logueado pero
                // los meta tags no se actualizaron client-side), buscar el caption
                // en el DOM directo. IG suele ponerlo en h1 dentro de article.
                if (!description) {
                  try {
                    const h1 = document.querySelector('article h1') || document.querySelector('h1');
                    if (h1 && h1.textContent && h1.textContent.trim().length > 0) {
                      description = h1.textContent.trim().slice(0, 2000);
                    }
                  } catch (_) {}
                }
                return { image: img, title, description };
              })()
            `, true);
            clearTimeout(timeout);
            finish(data);
          } catch (e) {
            clearTimeout(timeout);
            finish(null);
          }
        };
        win.webContents.once('did-finish-load', () => setTimeout(extract, 800));
        win.webContents.once('did-fail-load', () => { clearTimeout(timeout); finish(null); });
        win.loadURL(url, {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }).catch(() => { finish(null); });
      } catch (e) {
        finish(null);
      }
    });
  }

  ipcMain.handle('fetch-og-data', async (_, url) => {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { image: null, title: null, description: null };
    }
    const isInstagram = /instagram\.com\/(?:p|reel|reels|tv)\//.test(url);
    const isTiktok = /tiktok\.com\//.test(url);
    const isFacebook = /facebook\.com\//.test(url) || /fb\.com\//.test(url);
    const needsMicrolink = isInstagram || isTiktok || isFacebook;

    // Filtra URLs que NO cargan como imagen en el renderer (devuelven HTML, 302,
    // etc.). Si un fetcher las devuelve, las anulamos y seguimos en cascada.
    const sanitize = (result) => {
      if (!result) return result;
      const img = result.image;
      if (img && typeof img === 'string') {
        const lc = img.toLowerCase();
        // lookaside.instagram.com/seo/google_widget redirige al HTML del reel
        if (lc.includes('lookaside.instagram.com')) {
          return { ...result, image: null };
        }
      }
      return result;
    };

    // v3.11.66: para TikTok usamos tikwm primero — devuelve `cover` que es el
    // thumbnail real del video (mismo que se ve en TikTok). Microlink para
    // TikTok suele devolver el logo genérico o nada utilizable.
    if (isTiktok) {
      try {
        const fetchUrl = 'https://www.tikwm.com/api/?url=' + encodeURIComponent(url);
        const tkRes = await httpsGetBuffer(fetchUrl, { 'Accept': 'application/json' });
        const tkJson = JSON.parse(tkRes.buf.toString('utf-8'));
        if (tkJson && tkJson.code === 0 && tkJson.data) {
          const cover = tkJson.data.origin_cover || tkJson.data.cover || tkJson.data.ai_dynamic_cover;
          if (cover) {
            return sanitize({
              image: cover,
              title: tkJson.data.title || null,
              description: (tkJson.data.author && tkJson.data.author.nickname) ? '@' + tkJson.data.author.unique_id : null
            });
          }
        }
      } catch (e) { console.warn('[og-fetch] tikwm failed:', e.message); }
      // Si tikwm no devolvió, cae a Microlink abajo (needsMicrolink)
    }

    // Cascada de intentos: el primero que devuelva imagen gana.
    // PREFERIMOS Microlink porque proxea las imagenes a su CDN (URLs estables
    // que cargan en el renderer). Los HTTP/Browser embeds devuelven URLs de
    // cdninstagram.com con tokens firmados que NO cargan en Electron — solo
    // los usamos como ultimo recurso si Microlink falla del todo. Si todo
    // devuelve el logo generico de Instagram, lo aceptamos (mejor algo que nada).
    if (needsMicrolink) {
      const ml = sanitize(await fetchOgViaMicrolink(url));
      if (ml && ml.image) return ml;

      // Fallback: embed publico de Instagram (los carruseles a veces solo
      // exponen og:image en /embed/captioned/)
      const igMatch = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
      if (igMatch) {
        const embedUrl = `https://www.instagram.com/p/${igMatch[1]}/embed/captioned/`;
        const mlEmbed = sanitize(await fetchOgViaMicrolink(embedUrl));
        if (mlEmbed && mlEmbed.image) return mlEmbed;
        const embedHttp = sanitize(await fetchOgViaHttp(embedUrl));
        if (embedHttp && embedHttp.image) return embedHttp;
        try {
          const browserEmbed = sanitize(await fetchOgViaBrowser(embedUrl));
          if (browserEmbed && browserEmbed.image) return browserEmbed;
        } catch (_) {}
      }
    }

    // Sitios normales: HTTP simple con UA de Facebook bot
    let result = sanitize(await fetchOgViaHttp(url));
    if (result && result.image) return result;

    // Ultimo recurso: BrowserWindow oculto con Chromium real
    try {
      const browserResult = sanitize(await fetchOgViaBrowser(url));
      if (browserResult && browserResult.image) {
        return { ...result, ...browserResult };
      }
    } catch (_) {}

    // Ultimo intento: Microlink para sitios no-sociales
    if (!needsMicrolink) {
      const ml = sanitize(await fetchOgViaMicrolink(url));
      if (ml && ml.image) return ml;
    }

    return result;
  });
  ipcMain.handle('deposit-minimize', () => {
    if (depositWindow) depositWindow.minimize();
  });
  ipcMain.handle('deposit-close', () => {
    if (depositWindow) depositWindow.close();
  });

  // Chat: ventana externa
  ipcMain.handle('toggle-chat-window', () => {
    toggleChatWindow();
    return !!(chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible());
  });
  ipcMain.handle('chat-minimize', () => {
    if (chatWindow) chatWindow.minimize();
  });
  ipcMain.handle('chat-close', () => {
    if (chatWindow) chatWindow.close();
  });
  // Abre/cierra deposito y navega automaticamente a una categoria especifica.
  // Usado por el boton "Referencias" del main app para abrir el deposito ya
  // posicionado en la categoria Referencias.
  ipcMain.handle('toggle-deposit-with-category', (_, categoryId) => {
    const wasOpen = !!(depositWindow && !depositWindow.isDestroyed() && depositWindow.isVisible());
    if (!wasOpen) toggleDepositWindow();
    // Esperar un poquito a que la ventana este lista, luego enviar mensaje
    const sendNavigate = () => {
      if (!depositWindow || depositWindow.isDestroyed()) return;
      depositWindow.webContents.send('deposit-navigate', { categoryId });
    };
    if (depositWindow && depositWindow.webContents.isLoading()) {
      depositWindow.webContents.once('did-finish-load', sendNavigate);
    } else {
      sendNavigate();
    }
    setTimeout(sendNavigate, 300); // re-enviar por si acaso
    return !!(depositWindow && !depositWindow.isDestroyed() && depositWindow.isVisible());
  });
  // Para coordinar el sonido de notificacion: el main app solo lo reproduce
  // si la ventana del chat NO existe (cerrada con X). Si existe (visible u
  // oculta), el chat-renderer lo reproduce en su lugar para evitar doble sonido.
  ipcMain.handle('is-chat-window-open', () => {
    return !!(chatWindow && !chatWindow.isDestroyed());
  });
  // Cambio de tema en main app — propaga a chat y deposito para que las 3
  // ventanas se vean con el mismo tema simultaneamente.
  ipcMain.handle('broadcast-theme', (_, theme) => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      try { chatWindow.webContents.send('theme-changed', theme); } catch (e) {}
    }
    if (depositWindow && !depositWindow.isDestroyed()) {
      try { depositWindow.webContents.send('theme-changed', theme); } catch (e) {}
    }
  });

  // Modo PRO: las 3 ventanas en mosaico ocupando la pantalla
  ipcMain.handle('toggle-pro-mode', () => {
    return toggleProMode();
  });
}

// ===== AUTO UPDATER =====
function initAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'downloading',
        version: info.version
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('App is up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'progress',
        percent: Math.round(progress.percent)
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'ready',
        version: info.version
      });
      // v3.11.34: diálogo nativo prominente — no se puede ignorar como el banner
      try {
        const choice = require('electron').dialog.showMessageBoxSync(mainWindow, {
          type: 'info',
          title: 'Actualización disponible',
          message: `Task Manager v${info.version} está lista para instalar`,
          detail: 'La nueva versión ya está descargada. Para aplicarla, la app va a cerrarse y reabrirse automáticamente.',
          buttons: ['Instalar ahora', 'Más tarde'],
          defaultId: 0,
          cancelId: 1
        });
        if (choice === 0) {
          autoUpdater.quitAndInstall();
        }
      } catch (e) { console.warn('[updater] dialog failed', e); }
    }
  });

  autoUpdater.on('error', (err) => {
    console.log('Update error:', err.message);
    // v3.11.34: enviar también al renderer para mostrar banner de error
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'error',
        error: err.message
      });
    }
  });

  // Check for updates every 30 minutes
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 30 * 60 * 1000);
}

// ===== Custom updater (v3.11.35) =====
// Bypasses la restricción de firma de macOS de electron-updater. Descarga el
// ZIP de GitHub releases manualmente, descomprime con `unzip`, reemplaza la
// app en /Applications con un helper script, y reabre.
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

let _pendingUpdateZipPath = null;
let _pendingUpdateVersion = null;

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      // GitHub usa redirects para los release assets
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, destPath, onProgress).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const file = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0 && typeof onProgress === 'function') {
          onProgress(Math.round((downloaded / total) * 100), downloaded, total);
        }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(() => resolve(destPath)); });
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(new Error('Download timeout')); });
  });
}

ipcMain.handle('custom-download-update', async (_, { url, version }) => {
  try {
    // v3.11.88: el custom updater es solo para macOS — usa /bin/bash, unzip, etc.
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'Custom updater is macOS-only; use electron-updater on this platform' };
    }
    if (!url || !version) return { ok: false, error: 'url y version requeridos' };
    const tmpDir = path.join(os.tmpdir(), 'taskmgr-update');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (_) {}
    const zipPath = path.join(tmpDir, `taskmgr-${version}.zip`);
    // Limpieza de descarga previa
    try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch (_) {}
    await downloadFile(url, zipPath, (pct) => {
      if (mainWindow) mainWindow.webContents.send('custom-update-progress', { pct, version });
    });
    _pendingUpdateZipPath = zipPath;
    _pendingUpdateVersion = version;
    if (mainWindow) mainWindow.webContents.send('custom-update-ready', { version });
    return { ok: true, path: zipPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('custom-install-update', async () => {
  // v3.11.88: bloquear en non-mac — los comandos /bin/bash, unzip, mv son unix-only.
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'Custom updater is macOS-only; use electron-updater on this platform' };
  }
  if (!_pendingUpdateZipPath || !fs.existsSync(_pendingUpdateZipPath)) {
    return { ok: false, error: 'No hay update descargada' };
  }
  const currentAppPath = app.getAppPath().replace(/\/Contents\/Resources\/app(\.asar)?$/, '');
  // currentAppPath debería ser tipo /Applications/Task Manager.app
  // Escribir helper script que se ejecuta después de que la app cierre
  const helperScriptPath = path.join(os.tmpdir(), `taskmgr-installer-${Date.now()}.sh`);
  const escapedZip = _pendingUpdateZipPath.replace(/"/g, '\\"');
  const escapedApp = currentAppPath.replace(/"/g, '\\"');
  const helperScript = `#!/bin/bash
set -e
sleep 2
TMPDIR=$(mktemp -d /tmp/taskmgr-extract.XXXXXX)
echo "Extracting to $TMPDIR..."
/usr/bin/unzip -q -o "${escapedZip}" -d "$TMPDIR"
NEW_APP=$(find "$TMPDIR" -maxdepth 2 -name "*.app" | head -1)
if [ -z "$NEW_APP" ]; then
  echo "ERROR: No .app found in zip" >&2
  exit 1
fi
echo "Replacing ${escapedApp}..."
/bin/rm -rf "${escapedApp}"
/bin/mv "$NEW_APP" "${escapedApp}"
/usr/bin/xattr -dr com.apple.quarantine "${escapedApp}" 2>/dev/null || true
echo "Opening new app..."
/usr/bin/open "${escapedApp}"
/bin/rm -rf "$TMPDIR"
/bin/rm -f "${escapedZip}"
`;
  fs.writeFileSync(helperScriptPath, helperScript, { mode: 0o755 });
  // Lanzar el script detached para que sobreviva al quit de la app
  spawn('/bin/bash', [helperScriptPath], { detached: true, stdio: 'ignore' }).unref();
  // Quit la app — el script se ejecuta y reabre la nueva versión
  setTimeout(() => { app.quit(); }, 200);
  return { ok: true };
});

// v3.11.34: handler para chequeo manual desde el botón en Config
ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      ok: true,
      hasUpdate: result && result.updateInfo && result.updateInfo.version !== app.getVersion(),
      version: result && result.updateInfo ? result.updateInfo.version : null
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(() => {
  store.init();
  registerIpcHandlers();
  createWindow();
  initTelegram();
  initAnthropic();
  initAutoUpdater();

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // El deposito quiere programar una entry finalizada: forwardear data al main
  // window y traerla al frente del z-order. Como depositWindow tiene parent
  // mainWindow, focus() solo NO basta — usamos truco de alwaysOnTop temporal
  // para forzar a la principal sobre la del deposito.
  ipcMain.handle('open-schedule-from-entry', (_, data) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'mainWindow no disponible' };
    try {
      mainWindow.show();
      const wasAlwaysOnTop = mainWindow.isAlwaysOnTop();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.focus();
      mainWindow.moveTop && mainWindow.moveTop();
      mainWindow.webContents.send('schedule-from-entry', data || {});
      // Restaurar el estado original tras un instante (suficiente para que el modal aparezca arriba)
      setTimeout(() => {
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(wasAlwaysOnTop); } catch (_) {}
      }, 250);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Refrescar todas las ventanas abiertas (equivale a un Cmd+R en cada una).
  // Util cuando el chat o algun listener de Firebase se queda colgado y el
  // usuario no quiere salir/entrar manualmente.
  ipcMain.handle('refresh-all-windows', () => {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); } catch (_) {}
    try { if (depositWindow && !depositWindow.isDestroyed()) depositWindow.webContents.reload(); } catch (_) {}
    try { if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.reload(); } catch (_) {}
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (telegramBot) {
    telegramBot.stopPolling();
  }
});
