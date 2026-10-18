const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chat', {
  send: (text) => ipcRenderer.send('chat-send', text),
  close: () => ipcRenderer.send('chat-close'),
  onReply: (fn) => ipcRenderer.on('chat-reply', (e, payload) => fn(payload))
});
