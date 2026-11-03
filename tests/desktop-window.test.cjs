const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDesktopWindow } = require('../core/desktop-window.cjs');

// Simulate Windows constructor clamping without creating desktop effects.
function fixture(display, interactive) {
  class Window {
    constructor(options) { this.options = options; this.bounds = { ...display.workArea }; this.calls = []; }
    setBounds(value) { this.bounds = { ...value }; this.calls.push('bounds'); }
    setAlwaysOnTop(...args) { this.top = args; this.calls.push('top'); }
    setIgnoreMouseEvents(value) { this.ignoreMouse = value; this.calls.push('mouse'); }
  }
  return createDesktopWindow(Window, display, interactive, '/test/effect-preload.cjs');
}

for (const [side, workArea] of Object.entries({
  bottom: { x: -1920, y: 0, width: 1920, height: 1032 },
  top: { x: -1920, y: 48, width: 1920, height: 1032 },
  left: { x: -1872, y: 0, width: 1872, height: 1080 },
  right: { x: -1920, y: 0, width: 1872, height: 1080 }
})) {
  test(`desktop covers the full monitor with a ${side} taskbar and scaled/negative coordinates`, () => {
    const display = { bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea, scaleFactor: 1.5 };
    for (const interactive of [false, true]) {
      const window = fixture(display, interactive);
      assert.deepEqual(window.bounds, display.bounds);
      assert.deepEqual(window.calls, ['bounds', 'top', 'mouse']);
      assert.deepEqual(window.top, [true, 'screen-saver']);
      assert.equal(window.options.show, false);
      assert.equal(window.options.focusable, interactive);
      assert.equal(window.options.webPreferences.focusOnNavigation, interactive);
      assert.equal(window.ignoreMouse, !interactive);
      assert.equal(window.options.skipTaskbar, true);
      assert.equal(window.options.resizable, false);
      assert.equal(window.options.webPreferences.sandbox, true);
      assert.equal(window.options.webPreferences.contextIsolation, true);
      assert.equal(window.options.webPreferences.nodeIntegration, false);
    }
  });
}
