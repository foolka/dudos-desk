const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dudosEffect', {
  state: () => ipcRenderer.invoke('effect:state'),
  ready: id => ipcRenderer.invoke('effect:ready', id),
  onFocus: handler => ipcRenderer.on('effect:focus', () => handler()),
  progress: value => ipcRenderer.invoke('effect:progress', value),
  complete: id => ipcRenderer.invoke('effect:complete', id),
  stop: () => ipcRenderer.invoke('effect:stop'),
  sound: id => ipcRenderer.invoke('effect:sound', id),
  onState: handler => ipcRenderer.on('effect:state', (_, value) => handler(value))
});
