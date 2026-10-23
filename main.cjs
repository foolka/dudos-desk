const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Tray, Menu, nativeTheme, screen, globalShortcut, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Store, atomic, selectProfile } = require('./core/store.cjs');
const { Engine } = require('./core/engine.cjs');
const { sourceGuard } = require('./core/obs.cjs');
const { createServer, PORT } = require('./core/server.cjs');
const test = process.argv.includes('--test-mode');
const startTray = process.argv.includes('--start-tray');
let startupError;
try { app.setPath('userData', selectProfile(path.join(app.getPath('appData'), 'DudosDesk'), test, process.env.DUDOS_DESK_TEST_DATA)); }
catch (error) { startupError = error; }
app.setAppUserModelId('com.fermionaplay.dudosdesk');
const primary = startupError ? true : app.requestSingleInstanceLock();
if (!primary) app.quit();
const profile = app.getPath('userData');
const editorUrl = pathToFileURL(path.join(__dirname, 'ui/index.html')).href;
const effectUrl = pathToFileURL(path.join(__dirname, 'overlay/index.html')).href;
let win, tray, store, engine, server, port, effectWindow, closing = false, shortcut = false;

function show() { if (win && !win.isDestroyed()) { win.show(); if (win.isMinimized()) win.restore(); win.focus(); } }
function secretLoad() {
  const file = path.join(profile, 'obs.bin');
  if (!fs.existsSync(file)) return '';
  if (!safeStorage.isEncryptionAvailable()) throw Error('secureStorage');
  return safeStorage.decryptString(fs.readFileSync(file));
}
function theme() { nativeTheme.themeSource = store.settings().theme; win?.setBackgroundColor(store.settings().theme === 'dark' ? '#191e21' : '#f4f7f8'); }
function state() {
  return { version: app.getVersion(), effects: store.effects(), settings: store.settings(), runtime: engine.view(),
    overlayUrl: `http://127.0.0.1:${port}/overlay#${store.meta('overlayKey')}`, obsConnected: server.connected(), history: store.history(),
    displays: screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: d.label || `Display ${i + 1}`, width: d.size.width, height: d.size.height })),
    hasPassword: fs.existsSync(path.join(profile, 'obs.bin')), profile, shortcut, test };
}
function secureWindow(window, url) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (target !== url) event.preventDefault(); });
}

// Passive windows do not request focus; captchas intentionally receive input.
async function syncDesktop() {
  if (test || closing) return;
  const active = engine.active;
  if (effectWindow && !effectWindow.isDestroyed()) { effectWindow.destroy(); effectWindow = null; }
  if (!active) return;
  const interactive = active.id.endsWith('captcha');
  const display = screen.getAllDisplays().find(d => String(d.id) === store.settings().displayId) || screen.getPrimaryDisplay();
  const window = new BrowserWindow({ ...display.bounds, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, focusable: interactive, alwaysOnTop: true, hasShadow: false, title: 'Dudos Desk Effect',
    webPreferences: { preload: path.join(__dirname, 'effect-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', focusOnNavigation: interactive } });
  effectWindow = window;
  secureWindow(window, effectUrl);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setIgnoreMouseEvents(!interactive);
  window.webContents.once('render-process-gone', () => { if (engine.active?.eventId === active.eventId) engine.finish(active.eventId, 'renderFailed'); });
  window.once('unresponsive', () => { if (engine.active?.eventId === active.eventId) engine.finish(active.eventId, 'renderFailed'); });
  try {
    await window.loadURL(effectUrl);
    if (window.isDestroyed()) return;
    if (engine.active?.eventId !== active.eventId || closing) { window.destroy(); return; }
    if (interactive) { window.show(); window.focus(); } else window.showInactive();
  } catch { if (engine.active?.eventId === active.eventId) engine.finish(active.eventId, 'renderFailed'); }
}

app.on('second-instance', show);
app.whenReady().then(async () => {
  if (!primary) return;
  if (startupError) throw startupError;
  store = new Store(profile); store.backup();
  engine = new Engine(store, { guard: settings => sourceGuard(settings, secretLoad()) });
  server = createServer({ store, engine, root: __dirname, port: test ? 0 : PORT });
  port = await server.listen();
  win = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 680, title: 'Dudos Desk', show: false,
    icon: path.join(__dirname, 'assets/icon.ico'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  secureWindow(win, editorUrl);
  win.on('closed', () => { if (!closing) app.quit(); });
  win.webContents.session.setPermissionRequestHandler((_, __, cb) => cb(false));
  let lastEvent = null;
  engine.on('change', value => {
    const id = value.active?.eventId || null;
    if (id !== lastEvent) { lastEvent = id; void syncDesktop(); }
  });
  const actions = {
    state,
    saveEffect: ({ id, effect }) => store.saveEffect(id, effect),
    settings: input => { const result = store.saveSettings(input); theme(); return result; },
    pause: value => engine.pause(value === true),
    stop: () => engine.stop(),
    test: id => engine.test(id, 10),
    sound: async id => {
      if (!store.effects().some(e => e.id === id)) throw Error('unknownEffect');
      const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a'] }] });
      if (result.canceled) return null;
      const source = result.filePaths[0], ext = path.extname(source).toLowerCase();
      if (!['.wav', '.mp3', '.ogg', '.flac', '.m4a'].includes(ext) || fs.statSync(source).size > 20 * 1024 * 1024) throw Error('invalidSound');
      const name = randomUUID() + ext;
      atomic(path.join(profile, 'media', name), fs.readFileSync(source));
      return name;
    },
    password: input => {
      if (typeof input !== 'string' || input.length > 500) throw Error('invalidValue');
      if (!safeStorage.isEncryptionAvailable()) throw Error('secureStorage');
      atomic(path.join(profile, 'obs.bin'), safeStorage.encryptString(input));
    },
    checkGuard: async () => {
      if (!store.settings().pcSources.length) throw Error('pcSourceRequired');
      return sourceGuard(store.settings(), secretLoad());
    },
    copyUrl: () => clipboard.writeText(state().overlayUrl),
    copyScript: category => {
      if (!['normal', 'strong'].includes(category)) throw Error('invalidValue');
      let script = fs.readFileSync(path.join(__dirname, 'integration/StreamerBot.cs'), 'utf8');
      script = script.replace('__DUDOS_KEY__', store.meta('botKey')).replace('__DUDOS_CATEGORY__', category).replace('__DUDOS_PORT__', String(port));
      clipboard.writeText(script);
    },
    backup: () => { store.backup(); },
    openProfile: () => shell.openPath(profile),
    guide: () => shell.openPath(app.isPackaged ? path.join(path.dirname(app.getPath('exe')), 'README.md') : path.join(__dirname, 'README.md')),
    tray: () => win.hide()
  };
  for (const [name, fn] of Object.entries(actions)) ipcMain.handle('desk:' + name, async (event, input) => {
    if (closing || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== editorUrl) throw Error('untrustedFrame');
    try { return { ok: true, value: await fn(input) }; }
    catch (error) { return { ok: false, error: error.code === 'EACCES' ? 'fileAccess' : error.message }; }
  });
  const effectActions = {
    state: () => engine.active,
    complete: id => { if (engine.active?.id.endsWith('captcha')) engine.finish(id, 'solved'); },
    stop: () => engine.stop(),
    sound: id => {
      if (engine.active?.eventId !== id || !engine.active.sound) return null;
      return fs.readFileSync(path.join(profile, 'media', engine.active.sound));
    }
  };
  for (const [name, fn] of Object.entries(effectActions)) ipcMain.handle('effect:' + name, (event, input) => {
    if (closing || !effectWindow || effectWindow.isDestroyed() || event.sender !== effectWindow.webContents || event.senderFrame !== effectWindow.webContents.mainFrame || event.senderFrame.url !== effectUrl) throw Error('untrustedFrame');
    return fn(input);
  });
  tray = new Tray(path.join(__dirname, 'assets/icon.png'));
  tray.setToolTip('Dudos Desk');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Dudos Desk', click: show },
    { label: 'STOP', click: () => engine.stop() },
    { type: 'separator' },
    { label: 'Exit / Выход / Вийти', click: () => app.quit() }
  ]));
  tray.on('double-click', show);
  if (!test) shortcut = globalShortcut.register('CommandOrControl+Shift+F12', () => engine.stop());
  await win.loadURL(editorUrl); theme(); if (!test && !startTray) win.show();
}).catch(async error => {
  if (store) { try { store.log('startupFailed', { code: error.code || 'startup' }); } catch {} }
  const message = ['EADDRINUSE', 'EACCES'].includes(error.code)
    ? `Порт ${PORT} занят или заблокирован Windows. Закрой вторую копию Dudos Desk и проверь порт. / Port ${PORT} is busy or blocked.`
    : `Не удалось открыть Dudos Desk (${error.message}). Сохранённые данные не заменены. / Saved data was not replaced.`;
  if (!test) await dialog.showMessageBox({ type: 'info', title: 'Dudos Desk', message, buttons: ['OK'] });
  else console.error('Startup failed:', error.message);
  app.quit();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (closing) return; closing = true;
  globalShortcut.unregisterAll();
  try { engine?.dispose(); } catch {}
  if (effectWindow && !effectWindow.isDestroyed()) effectWindow.destroy();
  server?.close(); tray?.destroy();
  try { store?.close(); } catch {}
});
