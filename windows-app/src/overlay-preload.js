const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bluey', {
  send: (event, payload) => ipcRenderer.send(event, payload),
  on: (channel, fn) => ipcRenderer.on(channel, (e, payload) => fn(payload))
});
