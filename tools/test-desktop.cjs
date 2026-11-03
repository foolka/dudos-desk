const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Exercise the production window factory without showing effects or capturing input.
(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-desktop-')));
  const executablePath = process.env.DUDOS_EXE;
  const app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--test-mode'] } : { args: [root, '--test-mode'] }),
    env: { ...process.env, DUDOS_DESK_TEST_DATA: profile } });
  try {
    await app.firstWindow();
    const result = await app.evaluate(async ({ app, BrowserWindow, screen }) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/main.cjs');
      const assert = require('node:assert/strict');
      const path = require('node:path');
      const { createDesktopWindow } = require(path.join(app.getAppPath(), 'core/desktop-window.cjs'));
      const report = [];
      for (const [index, display] of screen.getAllDisplays().entries()) {
        for (const interactive of [false, true]) {
          const window = createDesktopWindow(BrowserWindow, display, interactive, undefined);
          try {
            assert.equal(window.isVisible(), false);
            assert.equal(window.isFocused(), false);
            assert.deepEqual(window.getBounds(), display.bounds);
            assert.deepEqual(window.getContentBounds(), display.bounds);
            // Preview transport keeps this isolated from engine, audio, Twitch and OBS.
            await window.loadFile(path.join(app.getAppPath(), 'overlay/index.html'), { query: { preview: '1' } });
            for (const id of ['bsod', 'vignette']) {
              const geometry = await window.webContents.executeJavaScript(`(async () => {
                document.documentElement.classList.remove('is-preview');
                window.postMessage({ type: 'preview', active: { id: ${JSON.stringify(id)},
                  eventId: ${JSON.stringify(id)}, language: 'en', volume: 0, audioTarget: 'off', x: 50, y: 50 } }, '*');
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const effect = document.querySelector('.${id}');
                const r = effect?.getBoundingClientRect();
                return { viewport: { width: innerWidth, height: innerHeight },
                  effect: r && { x: r.x, y: r.y, width: r.width, height: r.height } };
              })()`);
              assert.deepEqual(geometry.viewport, { width: display.bounds.width, height: display.bounds.height });
              assert.deepEqual(geometry.effect, { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height });
              // A hidden compositor may submit the painted frame after DOM animation callbacks.
              let capture, size, pixels, painted = false;
              const deadline = Date.now() + 3000;
              do {
                capture = await window.webContents.capturePage();
                size = capture.getSize(); pixels = capture.toBitmap();
                const center = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4 + 3;
                painted = pixels[3] === 255 && (id === 'bsod'
                  ? pixels[0] === 215 && pixels[1] === 120 && pixels[2] === 0
                  : pixels[0] === 0 && pixels[1] === 0 && pixels[2] === 0 && pixels[center] === 0);
                if (!painted) await new Promise(resolve => setTimeout(resolve, 30));
              } while (!painted && Date.now() < deadline);
              assert.ok(painted, id + ' compositor frame was not ready');
              assert.ok(size.width > 0 && size.height > 0);
              assert.equal(pixels.length, size.width * size.height * 4);
              // Every edge must be opaque, including the former bottom taskbar strip.
              const alpha = (x, y) => pixels[(y * size.width + x) * 4 + 3];
              if (id === 'vignette') assert.equal(alpha(Math.floor(size.width / 2), Math.floor(size.height / 2)), 0);
              for (let x = 0; x < size.width; x++) {
                assert.equal(alpha(x, 0), 255, id + ' top edge');
                assert.equal(alpha(x, size.height - 1), 255, id + ' bottom edge');
              }
              for (let y = 0; y < size.height; y++) {
                assert.equal(alpha(0, y), 255, id + ' left edge');
                assert.equal(alpha(size.width - 1, y), 255, id + ' right edge');
              }
              if (process.env.DUDOS_DESKTOP_SCREENSHOTS) {
                require('node:fs').mkdirSync(process.env.DUDOS_DESKTOP_SCREENSHOTS, { recursive: true });
                require('node:fs').writeFileSync(path.join(process.env.DUDOS_DESKTOP_SCREENSHOTS,
                  `display-${index}-${interactive ? 'interactive' : 'passive'}-${id}.png`), capture.toPNG());
              }
              assert.equal(window.isVisible(), false);
              assert.equal(window.isFocused(), false);
              report.push({ display: index, scaleFactor: display.scaleFactor, bounds: window.getBounds(),
                workArea: display.workArea, interactive, effect: id, opaqueEdges: true, visible: false });
            }
          } finally { window.destroy(); }
        }
      }
      return report;
    });
    console.log(JSON.stringify(result, null, 2));
    console.log('Native desktop coverage: full monitor/content bounds and opaque effect edges verified in hidden windows only.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
