const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimizeWindow: () => ipcRenderer.invoke('deposit-minimize'),
  closeWindow: () => ipcRenderer.invoke('deposit-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  fetchOgData: (url) => ipcRenderer.invoke('fetch-og-data', url),
  refreshAllWindows: () => ipcRenderer.invoke('refresh-all-windows'),
  // Programar una entry del deposito: envia data al main window que abre el modal
  openScheduleFromEntry: (data) => ipcRenderer.invoke('open-schedule-from-entry', data),
  onSetViewMode: (callback) => ipcRenderer.on('deposit-set-view-mode', (_, payload) => callback(payload)),
  onNavigate: (callback) => ipcRenderer.on('deposit-navigate', (_, payload) => callback(payload)),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (_, theme) => callback(theme)),
  // v3.11.46: yt-dlp + transcription también disponibles desde la ventana separada
  extractAudioViaYtDlp: (url) => ipcRenderer.invoke('extract-audio-via-ytdlp', url),
  callTranscriptionApi: (payload) => ipcRenderer.invoke('call-transcription-api', payload),
  // v3.11.90: traducir transcripción a español si idioma original ≠ es
  translateToSpanish: (payload) => ipcRenderer.invoke('translate-to-spanish', payload),
  // v3.11.61: captura del gimbal BT remote pareado a la Mac (VolumeUp/Down → toggle)
  registerGimbalShortcuts: () => ipcRenderer.invoke('register-gimbal-shortcuts'),
  unregisterGimbalShortcuts: () => ipcRenderer.invoke('unregister-gimbal-shortcuts'),
  onGimbalShortcut: (cb) => ipcRenderer.on('gimbal-shortcut-pressed', () => cb())
});
