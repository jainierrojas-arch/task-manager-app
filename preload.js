const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // v3.11.88: plataforma (mac usa custom updater, windows usa el de electron-updater)
  platform: process.platform,

  // v3.11.117: persistir URL firmada a Cloudinary, devuelve URL permanente
  persistCoverUrl: (url) => ipcRenderer.invoke('persist-cover-url', url),

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

  // v3.11.123: navegar Explorer interno a una URL (notificacion desde main)
  onNavigateExplorerTo: (cb) => ipcRenderer.on('navigate-explorer-to', (_, url) => cb(url)),

  // v3.11.130 + v3.11.134: Chrome Real Embed (CDP screencast) + multi-tab
  chromeEmbed: {
    start: (opts) => ipcRenderer.invoke('chrome-embed-start', opts),
    stop: () => ipcRenderer.invoke('chrome-embed-stop'),
    navigate: (url) => ipcRenderer.invoke('chrome-embed-navigate', url),
    back: () => ipcRenderer.invoke('chrome-embed-back'),
    forward: () => ipcRenderer.invoke('chrome-embed-forward'),
    reload: () => ipcRenderer.invoke('chrome-embed-reload'),
    resize: (dims) => ipcRenderer.invoke('chrome-embed-resize', dims),
    // v3.11.136: usamos send (one-way) en vez de invoke para no saturar el IPC con awaits
    sendMouse: (ev) => ipcRenderer.send('chrome-embed-mouse-fast', ev),
    sendWheel: (ev) => ipcRenderer.send('chrome-embed-wheel-fast', ev),
    sendKey: (ev) => ipcRenderer.send('chrome-embed-key-fast', ev),
    status: () => ipcRenderer.invoke('chrome-embed-status'),
    onFrame: (cb) => ipcRenderer.on('chrome-embed-frame', (_, payload) => cb(payload)),
    onUrlChanged: (cb) => ipcRenderer.on('chrome-embed-url-changed', (_, url) => cb(url)),
    // multi-tab
    newTab: (url) => ipcRenderer.invoke('chrome-embed-new-tab', url),
    switchTab: (id) => ipcRenderer.invoke('chrome-embed-switch-tab', id),
    closeTab: (id) => ipcRenderer.invoke('chrome-embed-close-tab', id),
    listTabs: () => ipcRenderer.invoke('chrome-embed-list-tabs'),
    onTabs: (cb) => ipcRenderer.on('chrome-embed-tabs', (_, tabs) => cb(tabs)),
    // downloads
    onDownloadStart: (cb) => ipcRenderer.on('chrome-embed-download-start', (_, info) => cb(info)),
    onDownloadProgress: (cb) => ipcRenderer.on('chrome-embed-download-progress', (_, info) => cb(info)),
    onDownloadComplete: (cb) => ipcRenderer.on('chrome-embed-download-complete', (_, info) => cb(info)),
    onDownloadCancel: (cb) => ipcRenderer.on('chrome-embed-download-cancel', (_, info) => cb(info))
  },

  // v3.11.135: subir archivo local descargado a Cloudinary
  uploadLocalFileToCloudinary: (filePath) => ipcRenderer.invoke('upload-local-file-to-cloudinary', { filePath }),

  // v3.11.157: registrar partition del Explorer (por workspace) para hooks de descarga
  registerExplorerPartition: (partition) => ipcRenderer.invoke('register-explorer-partition', partition),
  // v3.11.158: setear cuál es la partition CURRENT (la del workspace activo)
  setCurrentExplorerPartition: (partition) => ipcRenderer.invoke('set-current-explorer-partition', partition),

  // v3.11.143: descargas del webview Explorer
  onWebviewDownloadStart: (cb) => ipcRenderer.on('webview-download-start', (_, info) => cb(info)),
  onWebviewDownloadProgress: (cb) => ipcRenderer.on('webview-download-progress', (_, info) => cb(info)),
  onWebviewDownloadComplete: (cb) => ipcRenderer.on('webview-download-complete', (_, info) => cb(info)),
  onWebviewDownloadCancel: (cb) => ipcRenderer.on('webview-download-cancel', (_, info) => cb(info)),

  // v3.11.140: Chrome Overlay nativo
  chromeOverlay: {
    start: (opts) => ipcRenderer.invoke('chrome-overlay-start', opts),
    stop: () => ipcRenderer.invoke('chrome-overlay-stop'),
    show: () => ipcRenderer.invoke('chrome-overlay-show'),
    status: () => ipcRenderer.invoke('chrome-overlay-status')
  },

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
  // v3.11.90: traducir texto a español con Groq Llama (usado tras transcripción multi-idioma)
  translateToSpanish: (payload) => ipcRenderer.invoke('translate-to-spanish', payload),
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
