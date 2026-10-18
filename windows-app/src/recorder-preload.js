// Exposes a tiny safe API to the hidden recorder window.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('recAPI', {
  onCmd: (fn) => ipcRenderer.on('rec-cmd', (e, msg) => fn(msg)),
  level: (rms) => ipcRenderer.send('rec-level', rms),
  clip: (payload) => ipcRenderer.send('rec-clip', payload),
  chunk: (payload) => ipcRenderer.send('rec-chunk', payload),
  error: (msg) => ipcRenderer.send('rec-error', msg),
  // wake word events
  wakeHeard: (text) => ipcRenderer.send('rec-wake-heard', text),
  wakeClip: (payload) => ipcRenderer.send('rec-wake-clip', payload),
  wakeError: (kind) => ipcRenderer.send('rec-wake-error', kind)
});
