const { _electron: electron, chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const name = require('../package.json').name;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), name + '-taskbar-'));
const output = path.join(root, 'test-results/taskbar');
const settings = {
  'alert-desk': '[data-tab="connection"]',
  'command-desk': '#nav [data-view="connection"]',
  'dudos-desk': '[data-view="connection"]',
  'reward-desk': '[data-tab="settings"]',
  'shoutout-desk': '[data-view="settings"]'
};
fs.mkdirSync(output, { recursive: true });

// Exercise the actual settings page with an isolated, disconnected profile.
(async () => {
  let app, browser;
  const errors = [];
  try {
    const env = { ...process.env, [name.replaceAll('-', '_').toUpperCase() + '_TEST_DATA']: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    const flag = name === 'shoutout-desk' ? '--smoke-test' : '--test-mode';
    app = await electron.launch({
      ...(process.env.DESK_TEST_EXE ? { executablePath: process.env.DESK_TEST_EXE, args: [flag] } : { args: [root, flag] }), env
    });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.locator(settings[name]).click();
    const block = page.locator('desk-taskbar');
    await block.waitFor();
    assert.deepEqual(await page.evaluate(() => window.desk.taskbarStatus()), { state: 'testMode' });
    if (process.env.DESK_TEST_EXE) {
      const nativeStatus = await app.evaluate(async ({ app, BrowserWindow }) => {
        const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/main.cjs');
        const native = load('./core/taskbar-native.node');
        let status = native.begin(false, BrowserWindow.getAllWindows()[0].getNativeWindowHandle());
        const deadline = Date.now() + 5000;
        while (status === 'pending' && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 80));
          status = native.poll();
        }
        if (status === 'pending') native.cancel();
        return status;
      });
      assert.ok(['pinned', 'notPinned', 'manual'].includes(nativeStatus), 'Packaged native read: ' + nativeStatus);
      console.log('Read-only Windows status:', nativeStatus);
    }
    await page.waitForFunction(() => document.querySelector('desk-taskbar')?.state === 'testMode');
    assert.equal(await block.locator('.b-taskbar__button').isDisabled(), true);
    for (const language of ['ru', 'uk', 'en']) {
      await page.evaluate(lang => { document.documentElement.lang = lang; }, language);
      await block.locator('.b-taskbar__refresh').click();
      await block.screenshot({ path: path.join(output, language + '.png') });
    }
    await page.setViewportSize({ width: 780, height: 720 });
    await block.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'settings.png') });
    assert.equal(await block.evaluate(el => el.getBoundingClientRect().right <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await app.close(); app = null;

    // A mocked browser checks explicit-click consent states, never Windows itself.
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const fixture = await browser.newPage({ viewport: { width: 320, height: 600 } });
    await fixture.setContent('<html lang="ru"><body><desk-taskbar></desk-taskbar></body></html>');
    await fixture.evaluate(() => {
      window.pinCalls = 0;
      window.desk = { taskbarStatus: async () => ({ state: 'notPinned' }), taskbarPin: () => {
        window.pinCalls++;
        return new Promise(resolve => { window.finishPin = resolve; });
      } };
    });
    await fixture.addStyleTag({ path: path.join(root, name === 'dudos-desk' ? 'ui/styles/blocks/_taskbar.scss' : 'ui/taskbar.css') });
    await fixture.addScriptTag({ path: path.join(root, 'ui/taskbar.js') });
    await fixture.waitForFunction(() => document.querySelector('desk-taskbar').state === 'notPinned');
    assert.equal(await fixture.evaluate(() => window.pinCalls), 0);
    const pin = fixture.locator('.b-taskbar__button');
    await pin.click();
    assert.equal(await pin.isDisabled(), true);
    assert.equal(await fixture.evaluate(() => window.pinCalls), 1);
    await fixture.evaluate(() => window.finishPin({ state: 'cancelled' }));
    await fixture.waitForFunction(() => document.querySelector('desk-taskbar').state === 'cancelled');
    assert.equal(await pin.isEnabled(), true);
    await pin.click();
    await fixture.evaluate(() => window.finishPin({ state: 'pinned' }));
    await fixture.waitForFunction(() => document.querySelector('desk-taskbar').state === 'pinned');
    assert.equal(await pin.textContent(), 'Закреплено');
    assert.equal(await pin.isDisabled(), true);
    assert.equal(await fixture.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(name + ': taskbar UI, languages, narrow layout and consent states passed');
  } catch (error) {
    console.error('Renderer errors:', errors);
    if (app) {
      const page = await app.firstWindow();
      console.error(await page.evaluate(() => ({ url: location.href, desk: typeof window.desk, text: document.body.innerText })));
      await page.screenshot({ path: path.join(output, 'failure.png') });
    }
    throw error;
  } finally {
    if (app) await app.close();
    if (browser) await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
