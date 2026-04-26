const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimizeWindow: () => ipcRenderer.invoke('chat-minimize'),
  closeWindow: () => ipcRenderer.invoke('chat-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (_, theme) => callback(theme))
});
