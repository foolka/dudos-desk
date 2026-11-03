// Create the same hidden surface for passive effects and interactive captchas.
function createDesktopWindow(BrowserWindow, display, interactive, preload) {
  const window = new BrowserWindow({ ...display.bounds, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, focusable: interactive, alwaysOnTop: true, hasShadow: false, title: 'Dudos Desk Effect',
    webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required', focusOnNavigation: interactive } });
  // Windows clamps initial bounds to the work area. Restore the full monitor in DIP.
  window.setBounds(display.bounds);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setIgnoreMouseEvents(!interactive);
  return window;
}

module.exports = { createDesktopWindow };
