const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('set-get'),
  save: (patch) => ipcRenderer.send('set-save', patch),
  openNotes: () => ipcRenderer.send('set-open-notes')
});
