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
let telegramBot;
let TelegramBotLib;
let anthropic;

function computeDepositBounds(width, height) {
  // Devuelve {x, y, width, height} eligiendo la mejor ubicacion dentro del
  // monitor donde esta la ventana principal. Prueba: lado derecho, lado
  // izquierdo, y como fallback centra dentro del area visible.
  let bounds = { x: 100, y: 100, width, height };
  if (!mainWindow || mainWindow.isDestroyed()) return bounds;
  const mb = mainWindow.getBounds();
  const display = screen.getDisplayMatching(mb) || screen.getPrimaryDisplay();
  const wa = display.workArea; // area visible (excluye taskbar/menubar)
  const maxH = Math.min(Math.max(600, mb.height), wa.height - 20);
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
    // No cabe a los lados: centra dentro del area visible
    bounds.x = wa.x + Math.max(0, Math.floor((wa.width - bounds.width) / 2));
  }
  return bounds;
}

function positionDepositWindow() {
  if (!depositWindow || depositWindow.isDestroyed()) return;
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
    store.set('windowBounds', mainWindow.getBounds());
  });

  mainWindow.on('move', () => {
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

  // Fetch Open Graph image / metadata para preview tipo WhatsApp en el deposito
  ipcMain.handle('fetch-og-data', async (_, url) => {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { image: null, title: null, description: null };
    }
    return new Promise((resolve) => {
      const httpLib = require(url.startsWith('https') ? 'https' : 'http');
      let redirectsLeft = 5;
      const fetchUrl = (u) => {
        try {
          const parsed = new URL(u);
          const lib = parsed.protocol === 'https:' ? require('https') : require('http');
          const req = lib.get({
            host: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'es,en;q=0.9'
            }
          }, (res) => {
            // Redireccion
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
            const maxBytes = 250 * 1024;
            res.setEncoding('utf8');
            res.on('data', chunk => {
              html += chunk;
              if (html.length > maxBytes) { res.destroy(); }
            });
            res.on('end', () => {
              const findMeta = (prop) => {
                const re1 = new RegExp(`<meta\\s+(?:property|name)=["']${prop}["']\\s+content=["']([^"']+)["']`, 'i');
                const re2 = new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+(?:property|name)=["']${prop}["']`, 'i');
                const m1 = html.match(re1) || html.match(re2);
                return m1 ? m1[1] : null;
              };
              resolve({
                image: findMeta('og:image') || findMeta('twitter:image'),
                title: findMeta('og:title') || findMeta('twitter:title'),
                description: findMeta('og:description') || findMeta('twitter:description')
              });
            });
            res.on('error', () => resolve({ image: null, title: null, description: null }));
          });
          req.on('error', () => resolve({ image: null, title: null, description: null }));
          req.setTimeout(6000, () => { try { req.destroy(); } catch (_) {} resolve({ image: null, title: null, description: null }); });
        } catch (e) {
          resolve({ image: null, title: null, description: null });
        }
      };
      fetchUrl(url);
    });
  });
  ipcMain.handle('deposit-minimize', () => {
    if (depositWindow) depositWindow.minimize();
  });
  ipcMain.handle('deposit-close', () => {
    if (depositWindow) depositWindow.close();
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
