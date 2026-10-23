const { contextBridge, ipcRenderer } = require('electron');
const names = ['state', 'saveEffect', 'settings', 'pause', 'stop', 'test', 'sound', 'password', 'checkGuard', 'copyUrl', 'copyScript', 'backup', 'openProfile', 'guide', 'tray'];
contextBridge.exposeInMainWorld('desk', Object.fromEntries(names.map(name => [name, input => ipcRenderer.invoke('desk:' + name, input)])));
