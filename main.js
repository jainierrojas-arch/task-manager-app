const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
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
  tabsMultirow: false
});

let mainWindow;
let depositWindow;
let chatWindow;
let telegramBot;
let TelegramBotLib;
let anthropic;

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
    // No cabe en ningun lado: anclar deposito a la izquierda del area visible
    // y empujar la ventana principal a la derecha para que no se superpongan.
    bounds.x = wa.x;
    const newMainX = wa.x + bounds.width + 4;
    const maxMainX = wa.x + wa.width - mb.width;
    mainWindow.setBounds({ x: Math.min(newMainX, maxMainX), y: mb.y, width: mb.width, height: mb.height });
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
    // No cabe a los lados: anclar chat a la derecha y empujar la ventana
    // principal a la izquierda para evitar superposicion.
    bounds.x = wa.x + wa.width - bounds.width;
    const newMainX = bounds.x - mb.width - 4;
    mainWindow.setBounds({ x: Math.max(wa.x, newMainX), y: mb.y, width: mb.width, height: mb.height });
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
  // Layout 2 ventanas: deposito a la izquierda, main ocupa el resto. Chat oculto.
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = screen.getDisplayMatching(mainWindow.getBounds()) || screen.getPrimaryDisplay();
  const wa = display.workArea;
  const totalW = wa.width;
  const totalH = wa.height;
  const depositW = Math.floor(totalW * 0.30);
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

function exitProMode() {
  if (proModeState === 'off') return;
  proModeState = 'off';
  if (!proModePrevBounds) return;
  // Restaurar minimos originales antes de reposicionar (mismos valores que en createWindow / toggleXxxWindow)
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setMinimumSize(420, 600);
  if (depositWindow && !depositWindow.isDestroyed()) depositWindow.setMinimumSize(700, 500);
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.setMinimumSize(460, 480);
  if (mainWindow && !mainWindow.isDestroyed() && proModePrevBounds.main) {
    mainWindow.setBounds(proModePrevBounds.main);
  }
  if (depositWindow && !depositWindow.isDestroyed()) {
    if (proModePrevBounds.deposit) depositWindow.setBounds(proModePrevBounds.deposit);
    if (!proModePrevBounds.depositWasOpen) depositWindow.hide();
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (proModePrevBounds.chat) chatWindow.setBounds(proModePrevBounds.chat);
    if (!proModePrevBounds.chatWasOpen) chatWindow.hide();
  }
  proModePrevBounds = null;
  sendDepositViewMode('restore', false);
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
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 }
  });

  mainWindow.loadFile('index.html');

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
              // Para Instagram embed: el thumbnail viene como <img class="EmbeddedMediaImage" src="...">
              let embedImg = null;
              const embedMatch = html.match(/<img[^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]+src=["']([^"']+)["']/i)
                || html.match(/<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["']/i);
              if (embedMatch) embedImg = embedMatch[1];
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
            partition: 'persist:og-fetcher'
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
                  const embedded = document.querySelector('img.EmbeddedMediaImage, img[src*="cdninstagram"], video[poster]');
                  if (embedded) img = embedded.getAttribute('src') || embedded.getAttribute('poster');
                }
                return {
                  image: img,
                  title: get('meta[property="og:title"]') || get('meta[name="twitter:title"]') || document.title,
                  description: get('meta[property="og:description"]') || get('meta[name="twitter:description"]')
                };
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

    // Cascada de intentos: el primero que devuelva imagen gana.
    if (needsMicrolink) {
      // Intento 1: Microlink con la URL original (con prerender JS)
      const ml = await fetchOgViaMicrolink(url);
      if (ml && ml.image) return ml;

      // Intento 2: Microlink con la URL del embed publico de Instagram
      // (los carruseles a veces solo exponen og:image en /embed/captioned/)
      const igMatch = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
      if (igMatch) {
        const embedUrl = `https://www.instagram.com/p/${igMatch[1]}/embed/captioned/`;
        const mlEmbed = await fetchOgViaMicrolink(embedUrl);
        if (mlEmbed && mlEmbed.image) return mlEmbed;
        // Intento 3: HTTP directo del embed
        const embedHttp = await fetchOgViaHttp(embedUrl);
        if (embedHttp && embedHttp.image) return embedHttp;
        // Intento 4: BrowserWindow del embed (renderiza JS local)
        try {
          const browserEmbed = await fetchOgViaBrowser(embedUrl);
          if (browserEmbed && browserEmbed.image) return browserEmbed;
        } catch (_) {}
      }
    }

    // Sitios normales: HTTP simple con UA de Facebook bot
    let result = await fetchOgViaHttp(url);
    if (result && result.image) return result;

    // Ultimo recurso: BrowserWindow oculto con Chromium real
    try {
      const browserResult = await fetchOgViaBrowser(url);
      if (browserResult && browserResult.image) {
        return { ...result, ...browserResult };
      }
    } catch (_) {}

    // Ultimo intento: Microlink para sitios no-sociales
    if (!needsMicrolink) {
      const ml = await fetchOgViaMicrolink(url);
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
    }
  });

  autoUpdater.on('error', (err) => {
    console.log('Update error:', err.message);
  });

  // Check for updates every 30 minutes
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 30 * 60 * 1000);
}

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
