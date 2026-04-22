const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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
  reminderIntervalMinutes: 0
});

let mainWindow;
let telegramBot;
let TelegramBotLib;
let anthropic;

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
  if (telegramBot && chatId) {
    telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }
});

// IPC: Notify all linked Telegram users
ipcMain.on('telegram-notify-all', (_, { chatIds, message }) => {
  if (telegramBot && chatIds) {
    chatIds.forEach(chatId => {
      telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
  }
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
