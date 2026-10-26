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
    // Compare scaled geometry at both OBS resolutions without desktop activation.
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(viewport);
      for (const id of ['text_captcha', 'arrow_captcha']) {
        let baseHeight;
        for (const scale of [100, 50, 200]) {
          const active = payload({ ...store.effects().find(e => e.id === id), captchaScale: scale }, 'SIZE', store.settings());
          engine.enqueue(active);
          await page.locator('.captcha').waitFor();
          const r = await page.locator('.captcha').boundingBox();
          if (scale === 100) baseHeight = r.height;
          assert.ok(Math.abs(r.width - 820 * scale / 100 * viewport.width / 1920) < 1);
          assert.ok(Math.abs(r.height - baseHeight * scale / 100) < 1);
          assert.ok(Math.abs(r.x + r.width / 2 - viewport.width / 2) < 1);
          assert.ok(Math.abs(r.y + r.height / 2 - viewport.height * .48) < 1);
          assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width && r.y + r.height <= viewport.height);
          const alpha = await pixels(page, await page.screenshot({ omitBackground: true }));
          assert.ok(alpha.visible > 1000 && alpha.visible < alpha.total);
          engine.stop(); await page.waitForFunction(() => document.querySelector('#stage').children.length === 0);
        }
      }
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await new Promise(resolve => { server.server.once('close', resolve); server.close(); });
    await page.waitForTimeout(1000);
    server = createServer({ store, engine, root, port }); await server.listen();
    engine.enqueue(payload({ ...store.effects()[0], duration: 10 }, 'RECONNECT', store.settings()));
    await page.locator('.bsod').waitFor();
    engine.stop();
    // The desktop bridge is mocked: no real overlay or keyboard capture is created.
    for (const id of ['text_captcha', 'arrow_captcha']) {
      const active = payload({ ...store.effects().find(e => e.id === id), captchaScale: id === 'text_captcha' ? 75 : 150 }, 'TEST', store.settings());
      engine.enqueue(active);
      const desktop = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      desktop.on('pageerror', error => errors.push(error.message));
      await desktop.exposeFunction('sendProgress', value => engine.updateCaptcha(value));
      await desktop.exposeFunction('sendComplete', value => engine.solveCaptcha(value));
      await desktop.addInitScript(value => {
        window.completed = null; window.stopped = false; window.readyId = null;
        window.dudosEffect = { state: async () => value, onState: () => {}, sound: async () => null,
          ready: async id => { window.readyId = id; }, onFocus: handler => { window.refocus = handler; },
          progress: value => window.sendProgress(value),
          complete: async id => { const solved = await window.sendComplete(id); if (solved) window.completed = id; return solved; },
          stop: async () => { window.stopped = true; } };
      }, engine.active);
      await desktop.goto(`http://127.0.0.1:${port}/overlay`);
      await desktop.waitForFunction(id => window.readyId === id, active.eventId);
      const focusSelector = id === 'text_captcha' ? '.captcha input' : '.captcha';
      assert.equal(await desktop.locator(focusSelector).evaluate(el => el === document.activeElement), true);
      await desktop.evaluate(() => { document.activeElement.blur(); window.refocus(); });
      assert.equal(await desktop.locator(focusSelector).evaluate(el => el === document.activeElement), true);
      await page.locator('.captcha').waitFor();
      assert.deepEqual(await page.locator('.captcha').boundingBox(), await desktop.locator('.captcha').boundingBox());
      await page.evaluate(() => { window.originalCard = document.querySelector('.captcha'); });
      const startedAt = engine.active.startedAt, endsAt = engine.active.endsAt;
      if (id === 'text_captcha') {
        await desktop.locator('input').fill('Ab23');
        await page.waitForFunction(() => document.querySelector('input')?.value === 'Ab23');
        await desktop.locator('input').press('Backspace');
        await page.waitForFunction(() => document.querySelector('input')?.value === 'Ab2');
        assert.equal(await page.locator('input').getAttribute('readonly'), '');
        await page.locator('input').press('Enter');
        assert.equal(engine.active.captcha.solved, false);
        await desktop.locator('input').fill('wrong'); await desktop.locator('input').press('Enter');
        await page.waitForFunction(() => document.querySelector('.captcha__error')?.textContent.length > 0);
        assert.equal(await page.locator('input').inputValue(), '');
        assert.equal(await desktop.evaluate(() => window.completed), null);
        await desktop.locator('input').fill(active.code.slice(0, 4));
        await page.waitForFunction(() => document.querySelector('.captcha__error')?.textContent === '');
        assert.equal(await page.evaluate(() => window.originalCard === document.querySelector('.captcha')), true);
        await page.reload();
        await page.waitForFunction(value => document.querySelector('input')?.value === value, active.code.slice(0, 4));
        if (process.env.DUDOS_OVERLAY_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.DUDOS_OVERLAY_SCREENSHOTS, 'captcha-text-obs.png'), omitBackground: true });
        await desktop.locator('input').fill(active.code);
        await desktop.locator('input').press('Enter');
        await page.waitForFunction(value => document.querySelector('input')?.value === value, active.code);
      } else {
        await desktop.locator('.arrow').first().waitFor();
        await desktop.keyboard.press(active.arrows[0]);
        await page.waitForFunction(() => document.querySelectorAll('.arrow--done').length === 1);
        const wrong = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].find(key => key !== active.arrows[1]);
        await desktop.keyboard.press(wrong);
        await page.waitForFunction(() => document.querySelectorAll('.arrow--done').length === 0);
        await desktop.keyboard.press(active.arrows[0]);
        await desktop.keyboard.press(active.arrows[1]);
        await page.waitForFunction(() => document.querySelectorAll('.arrow--done').length === 2);
        await page.keyboard.press(active.arrows[2]);
        assert.equal(engine.active.captcha.progress, 2);
        assert.equal(await page.evaluate(() => window.originalCard === document.querySelector('.captcha')), true);
        await page.reload();
        await page.waitForFunction(() => document.querySelectorAll('.arrow--done').length === 2);
        if (process.env.DUDOS_OVERLAY_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.DUDOS_OVERLAY_SCREENSHOTS, 'captcha-arrows-obs.png'), omitBackground: true });
        for (const arrow of active.arrows.slice(2)) await desktop.keyboard.press(arrow);
        await page.waitForFunction(() => document.querySelectorAll('.arrow--done').length === 6);
      }
      await desktop.waitForFunction(() => window.completed !== null);
      assert.equal(await desktop.evaluate(() => window.completed), active.eventId);
      assert.equal(engine.active.startedAt, startedAt); assert.equal(engine.active.endsAt, endsAt);
      assert.equal(engine.active.captcha.solved, true);
      await desktop.keyboard.press('Escape'); assert.equal(await desktop.evaluate(() => window.stopped), true);
      await page.waitForFunction(() => document.querySelector('#stage').children.length === 0);
      assert.equal(engine.active, null);
      await desktop.close();
    }
    assert.deepEqual(errors, []);
    console.log('Overlay: 5 nonblank effects, captcha scale/centering/bounds at 50/100/200% and 1080p/720p, identical desktop and OBS geometry, transparent backgrounds, reconnect, live arrow/text input and errors mirrored to a read-only OBS page, final solved frames and Esc verified without desktop activation.');
  } finally { await browser.close(); server.close(); engine.dispose(); store.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
