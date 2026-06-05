const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mtb', {
  getState: () => ipcRenderer.invoke('mtb:getState'),
  start: () => ipcRenderer.invoke('mtb:start'),
  stop: () => ipcRenderer.invoke('mtb:stop'),
  save: (s) => ipcRenderer.invoke('mtb:save', s),
  openQr: () => ipcRenderer.invoke('mtb:openQr'),
  openProjects: () => ipcRenderer.invoke('mtb:openProjects'),
  openExternal: (url) => ipcRenderer.invoke('mtb:openExternal', url),
  onState: (cb) => ipcRenderer.on('mtb:state', (_e, s) => cb(s)),
});
