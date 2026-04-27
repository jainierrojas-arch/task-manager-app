const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimizeWindow: () => ipcRenderer.invoke('chat-minimize'),
  closeWindow: () => ipcRenderer.invoke('chat-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  refreshAllWindows: () => ipcRenderer.invoke('refresh-all-windows'),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (_, theme) => callback(theme))
});
