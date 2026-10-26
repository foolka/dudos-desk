const { contextBridge, ipcRenderer } = require('electron');
const names = ['state', 'saveEffect', 'settings', 'pause', 'stop', 'test', 'sound', 'password', 'checkGuard', 'copyUrl', 'backup', 'openProfile', 'guide', 'tray', 'login', 'cancelLogin', 'openLogin', 'logout', 'saveReward', 'publishReward', 'deleteReward', 'waitForObs', 'obsAuto', 'obsSetup'];
names.push('taskbarStatus', 'taskbarPin');
contextBridge.exposeInMainWorld('desk', Object.fromEntries(names.map(name => [name, input => ipcRenderer.invoke('desk:' + name, input)])));
