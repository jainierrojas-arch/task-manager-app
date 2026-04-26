const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimizeWindow: () => ipcRenderer.invoke('deposit-minimize'),
  closeWindow: () => ipcRenderer.invoke('deposit-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  fetchOgData: (url) => ipcRenderer.invoke('fetch-og-data', url),
  onSetViewMode: (callback) => ipcRenderer.on('deposit-set-view-mode', (_, payload) => callback(payload)),
  onNavigate: (callback) => ipcRenderer.on('deposit-navigate', (_, payload) => callback(payload)),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (_, theme) => callback(theme))
});
