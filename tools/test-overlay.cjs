const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../core/store.cjs');
const { Engine } = require('../core/engine.cjs');
const { payload } = require('../core/model.cjs');
const { createServer } = require('../core/server.cjs');
const root = path.resolve(__dirname, '..');

// Read screenshot alpha with the browser's PNG decoder, not DOM visibility alone.
async function pixels(page, png) {
  return page.evaluate(async data => {
    const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
    let visible = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) visible++;
    return { visible, total: image.width * image.height };
  }, png.toString('base64'));
}
(async () => {
  const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-overlay-')));
  const store = new Store(profile); store.saveSettings({ acknowledged: true, audioTarget: 'off' });
  const engine = new Engine(store);
  let server = createServer({ store, engine, root, port: 0 });
  const port = await server.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/overlay#${store.meta('overlayKey')}`);
    await page.waitForTimeout(500);
    assert.equal((await pixels(page, await page.screenshot({ omitBackground: true }))).visible, 0);
    const selectors = { bsod: '.bsod', error_flood: '.error', vignette: '.vignette', text_captcha: '.captcha input', arrow_captcha: '.arrow' };
    for (const effect of store.effects()) {
      const active = payload({ ...effect, duration: 10 }, 'TEST', store.settings());
      engine.enqueue(active);
      await page.locator(selectors[effect.id]).first().waitFor();
      const alpha = await pixels(page, await page.screenshot({ omitBackground: true }));
      assert.ok(alpha.visible > 10000, effect.id + ' is blank');
      if (effect.id.endsWith('captcha')) assert.ok(alpha.visible < alpha.total / 2, effect.id + ' background is opaque');
      if (effect.id === 'text_captcha') assert.equal(await page.locator('input').getAttribute('readonly'), '');
      engine.stop(); await page.waitForFunction(() => document.querySelector('#stage').children.length === 0);
    }
    await new Promise(resolve => { server.server.once('close', resolve); server.close(); });
    await page.waitForTimeout(1000);
    server = createServer({ store, engine, root, port }); await server.listen();
    engine.enqueue(payload({ ...store.effects()[0], duration: 10 }, 'RECONNECT', store.settings()));
    await page.locator('.bsod').waitFor();
    engine.stop();
    // The desktop bridge is mocked: no real overlay or keyboard capture is created.
    for (const id of ['text_captcha', 'arrow_captcha']) {
      const active = payload(store.effects().find(e => e.id === id), 'TEST', store.settings());
      active.startedAt = Date.now(); active.endsAt = Date.now() + 45000;
      const desktop = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await desktop.addInitScript(value => {
        window.completed = null; window.stopped = false;
        window.dudosEffect = { state: async () => value, onState: () => {}, sound: async () => null,
          complete: async id => { window.completed = id; }, stop: async () => { window.stopped = true; } };
      }, active);
      await desktop.goto(`http://127.0.0.1:${port}/overlay`);
      if (id === 'text_captcha') {
        await desktop.locator('input').fill('wrong'); await desktop.locator('input').press('Enter');
        assert.equal(await desktop.evaluate(() => window.completed), null);
        await desktop.locator('input').fill(active.code); await desktop.locator('input').press('Enter');
      } else {
        await desktop.locator('.arrow').first().waitFor();
        for (const arrow of active.arrows) await desktop.keyboard.press(arrow);
      }
      assert.equal(await desktop.evaluate(() => window.completed), active.eventId);
      await desktop.keyboard.press('Escape'); assert.equal(await desktop.evaluate(() => window.stopped), true);
      await desktop.close();
    }
    assert.deepEqual(errors, []);
    console.log('Overlay: 5 nonblank effects, transparent idle/captcha backgrounds, automatic same-URL reconnect, both captcha inputs and Esc verified without desktop activation.');
  } finally { await browser.close(); server.close(); engine.dispose(); store.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
