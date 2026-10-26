const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Pinned state always comes from Windows, never from a saved preference.
function createTaskbar({ app, shell, window, name, appId, test = false, native, platform = process.platform, exists = fs.existsSync, mkdir = fs.mkdirSync }) {
  let running;
  const link = path.join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs', name, name + '.lnk');
  const executable = app.getPath('exe');
  const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const result = (state) => ({ state });

  // Never redirect a shortcut belonging to a different installed or portable copy.
  function shortcut() {
    if (!exists(link)) return 'missing';
    try {
      const saved = shell.readShortcutLink(link);
      if (!samePath(saved.target, executable)) return 'differentCopy';
      return saved.appUserModelId === appId ? 'ok' : 'repair';
    } catch { return 'unavailable'; }
  }

  // Only a deliberate pin request may create or repair this app's Start shortcut.
  function prepareShortcut() {
    const state = shortcut();
    if (state === 'differentCopy' || state === 'unavailable') return state;
    if (state === 'ok') return state;
    mkdir(path.dirname(link), { recursive: true });
    const saved = shell.writeShortcutLink(link, state === 'missing' ? 'create' : 'update', {
      target: executable, cwd: path.dirname(executable), appUserModelId: appId,
      description: name, icon: executable, iconIndex: 0
    });
    return saved ? 'ok' : 'unavailable';
  }

  // Keep the UI responsive while WinRT awaits the user's own confirmation.
  async function operation(request) {
    const win = window();
    if (test) return result('testMode');
    if (platform !== 'win32' || !app.isPackaged || !win || win.isDestroyed()) return result('manual');
    if (request && !win.isFocused()) return result('foreground');
    const currentShortcut = request ? prepareShortcut() : shortcut();
    if (currentShortcut === 'differentCopy' || currentShortcut === 'unavailable') return result(currentShortcut);
    try {
      native ||= require('./taskbar-native.node');
      let state = native.begin(request, win.getNativeWindowHandle());
      const deadline = Date.now() + (request ? 120000 : 5000);
      while (state === 'pending') {
        await new Promise(resolve => setTimeout(resolve, 80));
        if (win.isDestroyed() || Date.now() > deadline) { native.cancel(); return result('unavailable'); }
        state = native.poll();
      }
      return result(state);
    } catch { return result('unavailable'); }
  }

  // Coalesce checks and reject duplicate pin clicks while a request is pending.
  function run(request) {
    if (running) return request ? Promise.resolve(result('busy')) : running;
    running = operation(request).finally(() => { running = null; });
    return running;
  }
  return { status: () => run(false), pin: () => run(true) };
}

// Only the app's own top-level renderer can access the two narrow operations.
function attachTaskbar({ ipcMain, win, ...options }) {
  const service = createTaskbar({ ...options, window: () => win });
  const trustedUrl = pathToFileURL(path.join(__dirname, '../ui/index.html')).href;
  for (const [name, method] of [['taskbarStatus', 'status'], ['taskbarPin', 'pin']]) {
    ipcMain.handle('desk:' + name, event => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== trustedUrl)
        throw Error('Untrusted taskbar request');
      return service[method]();
    });
  }
}
module.exports = { createTaskbar, attachTaskbar };
