const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dudosEffect', {
  state: () => ipcRenderer.invoke('effect:state'),
  complete: id => ipcRenderer.invoke('effect:complete', id),
  stop: () => ipcRenderer.invoke('effect:stop'),
  sound: id => ipcRenderer.invoke('effect:sound', id),
  onState: handler => ipcRenderer.on('effect:state', (_, value) => handler(value))
});
