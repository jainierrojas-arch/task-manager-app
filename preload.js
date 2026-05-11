const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
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
  // v3.9.20: generación de texto libre (no force tool use)
  generateWithClaude: (payload) => ipcRenderer.invoke('generate-with-claude', payload),

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
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  customDownloadUpdate: ({ url, version }) => ipcRenderer.invoke('custom-download-update', { url, version }),
  customInstallUpdate: () => ipcRenderer.invoke('custom-install-update'),
  onCustomUpdateProgress: (callback) => ipcRenderer.on('custom-update-progress', (_, data) => callback(data)),
  onCustomUpdateReady: (callback) => ipcRenderer.on('custom-update-ready', (_, data) => callback(data)),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  refreshAllWindows: () => ipcRenderer.invoke('refresh-all-windows'),

  // Make.com webhook para programacion de contenido en Instagram
  getMakeWebhook: () => ipcRenderer.invoke('get-make-webhook'),
  setMakeWebhook: (url) => ipcRenderer.invoke('set-make-webhook', url),
  sendToMakeWebhook: (payload) => ipcRenderer.invoke('send-to-make-webhook', payload),
  // v3.9.17: descarga audio via yt-dlp local (Cobalt cambió a auth-only)
  extractAudioViaYtDlp: (url) => ipcRenderer.invoke('extract-audio-via-ytdlp', url),
  // v3.11.46: llamada a Whisper/Groq desde Node (más confiable en Windows con firewalls corporativos)
  callTranscriptionApi: (payload) => ipcRenderer.invoke('call-transcription-api', payload),
  // v3.11.51: conexión a Instagram desde Settings (admin) → comparte cookies con todo el workspace
  connectInstagram: () => ipcRenderer.invoke('connect-instagram'),
  saveInstagramCookies: (cookies) => ipcRenderer.invoke('save-instagram-cookies', cookies),
  hasInstagramCookiesFile: () => ipcRenderer.invoke('has-instagram-cookies-file'),
  // v3.11.61: captura de gimbal BT remote pareado a la Mac — VolumeUp/Down disparan toggle
  registerGimbalShortcuts: () => ipcRenderer.invoke('register-gimbal-shortcuts'),
  unregisterGimbalShortcuts: () => ipcRenderer.invoke('unregister-gimbal-shortcuts'),
  onGimbalShortcut: (cb) => ipcRenderer.on('gimbal-shortcut-pressed', () => cb()),
  // Cloudinary unsigned upload config (para subir archivos directos desde la app)
  getCloudinaryConfig: () => ipcRenderer.invoke('get-cloudinary-config'),
  setCloudinaryConfig: (cfg) => ipcRenderer.invoke('set-cloudinary-config', cfg),
  // GHL TikTok webhook (Social Planner)
  getGhlTiktokWebhook: () => ipcRenderer.invoke('get-ghl-tiktok-webhook'),
  setGhlTiktokWebhook: (url) => ipcRenderer.invoke('set-ghl-tiktok-webhook', url),
  // El deposito puede pedir abrir el modal de programacion con datos pre-llenados
  onScheduleFromEntry: (callback) => ipcRenderer.on('schedule-from-entry', (_, data) => callback(data)),

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
