const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),

  // Telegram settings
  getTelegramToken: () => ipcRenderer.invoke('get-telegram-token'),
  setTelegramToken: (token) => ipcRenderer.invoke('set-telegram-token', token),

  // Telegram messaging (renderer -> main -> Telegram)
  sendTelegramMessage: (chatId, message) => ipcRenderer.send('telegram-send-message', { chatId, message }),
  notifyAllTelegram: (chatIds, message) => ipcRenderer.send('telegram-notify-all', { chatIds, message }),

  // Telegram events (main -> renderer)
  onTelegramLinkUser: (callback) => ipcRenderer.on('telegram-link-user', (_, data) => callback(data)),
  onTelegramAddTask: (callback) => ipcRenderer.on('telegram-add-task', (_, data) => callback(data)),
  onTelegramAssignTask: (callback) => ipcRenderer.on('telegram-assign-task', (_, data) => callback(data)),
  onTelegramGetMyTasks: (callback) => ipcRenderer.on('telegram-get-my-tasks', (_, data) => callback(data)),
  onTelegramGetAllTasks: (callback) => ipcRenderer.on('telegram-get-all-tasks', (_, data) => callback(data)),
  onTelegramCompleteTask: (callback) => ipcRenderer.on('telegram-complete-task', (_, data) => callback(data)),
  onTelegramGetProjects: (callback) => ipcRenderer.on('telegram-get-projects', (_, data) => callback(data)),
  onTelegramGetTeam: (callback) => ipcRenderer.on('telegram-get-team', (_, data) => callback(data)),
  onTelegramNaturalMessage: (callback) => ipcRenderer.on('telegram-natural-message', (_, data) => callback(data)),
  onTelegramSendError: (callback) => ipcRenderer.on('telegram-send-error', (_, data) => callback(data)),

  // Claude API
  getClaudeApiKeyStatus: () => ipcRenderer.invoke('get-claude-api-key-status'),
  setClaudeApiKey: (key) => ipcRenderer.invoke('set-claude-api-key', key),
  callClaude: (payload) => ipcRenderer.invoke('call-claude', payload),

  // Reminders
  getReminderInterval: () => ipcRenderer.invoke('get-reminder-interval'),
  setReminderInterval: (minutes) => ipcRenderer.invoke('set-reminder-interval', minutes),

  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Tabs view mode
  getTabsMultirow: () => ipcRenderer.invoke('get-tabs-multirow'),
  setTabsMultirow: (v) => ipcRenderer.invoke('set-tabs-multirow', v),

  // Auto-update
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_, data) => callback(data)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  refreshAllWindows: () => ipcRenderer.invoke('refresh-all-windows'),

  // Chat externo (ventana separada)
  toggleChat: () => ipcRenderer.invoke('toggle-chat-window'),
  isChatWindowOpen: () => ipcRenderer.invoke('is-chat-window-open'),

  // Deposito de ideas
  toggleDeposit: () => ipcRenderer.invoke('toggle-deposit-window'),
  toggleDepositWithCategory: (categoryId) => ipcRenderer.invoke('toggle-deposit-with-category', categoryId),

  // Modo PRO: las 3 ventanas en mosaico
  toggleProMode: () => ipcRenderer.invoke('toggle-pro-mode'),
  // Tema: broadcast a las otras ventanas
  broadcastTheme: (theme) => ipcRenderer.invoke('broadcast-theme', theme)
});
