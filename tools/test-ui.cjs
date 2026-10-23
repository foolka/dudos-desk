const { _electron: electron, chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-ui-'));
const output = path.join(root, 'docs/screenshots'); fs.mkdirSync(output, { recursive: true });
let app, page, browser;
const errors = [];

async function launch() {
  const executablePath = process.env.DUDOS_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--test-mode'] } : { args: [root, '--test-mode'] }), env: { ...process.env, DUDOS_DESK_TEST_DATA: profile } });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.locator('#effect-form').waitFor();
  await page.setViewportSize({ width: 1280, height: 820 });
}
async function action(name) { await page.locator(`[data-action="${name}"]`).first().click(); }
async function state() { return page.evaluate(async () => (await window.desk.state()).value); }

(async () => {
  try {
    await launch();
    assert.equal((await state()).effects.length, 5);
    assert.equal((await state()).settings.acknowledged, false);
    await action('test'); await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Сначала'));
    assert.equal((await state()).runtime.delayed, null);
    await page.frameLocator('#preview').locator('.bsod').waitFor();
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, 'effects-light.png') });
    await page.locator('[data-field=duration]').fill('17');
    await page.locator('[data-field=weight]').fill('12');
    await page.locator('[data-field=volume]').fill('0');
    await page.locator('#effect-form button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Сохранено');
    assert.equal((await state()).effects[0].duration, 17);
    await page.locator('#acknowledge').click({ noWaitAfter: true });
    await page.waitForFunction(() => !document.querySelector('#acknowledge'));
    await action('test'); assert.ok((await state()).runtime.delayed);
    await action('stop'); assert.equal((await state()).runtime.delayed, null);
    await action('pause'); assert.equal((await state()).runtime.paused, true);
    await action('pause'); assert.equal((await state()).runtime.paused, false);
    await page.locator('[data-effect=arrow_captcha]').click();
    await page.frameLocator('#preview').locator('.arrow').first().waitFor();
    await action('theme'); await page.frameLocator('#preview').locator('.arrow').first().waitFor();
    await page.screenshot({ path: path.join(output, 'effects-dark.png') });
    for (const language of ['uk', 'en', 'ru']) {
      await page.locator('#language').selectOption(language);
      await page.waitForFunction(value => document.documentElement.lang === value, language);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.locator('[data-effect=error_flood]').click();
    await page.frameLocator('#preview').locator('.error').first().waitFor();
    await page.locator('[data-field=errorCount]').fill('10');
    await page.locator('#effect-form button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Сохранено');
    await page.locator('[data-view=connection]').click();
    const before = await state();
    await page.locator('#audio-target').selectOption('off');
    await action('theme');
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.locator('#source-url').evaluate(el => { el.value = 'http://127.0.0.1:18778/overlay#PRIVATE-KEY'; });
    await page.screenshot({ path: path.join(output, 'connection.png') });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const source = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await source.goto(before.overlayUrl);
    await page.waitForFunction(async () => (await window.desk.state()).value.obsConnected);
    const overlayKey = before.overlayUrl.split('#')[1];
    const sourceBase = before.overlayUrl.split('/overlay')[0];
    const sourceState = await source.evaluate(async key => (await fetch('/api/state', { headers: { Authorization: 'Bearer ' + key } })).json(), overlayKey);
    assert.equal(sourceState.active, null);
    assert.equal(await source.locator('#stage > *').count(), 0);
    await page.setViewportSize({ width: 960, height: 720 });
    const y = await page.locator('.b-header').evaluate(el => el.getBoundingClientRect().y);
    await page.locator('#main').evaluate(el => el.scrollTop = 9999);
    assert.equal(await page.locator('.b-header').evaluate(el => el.getBoundingClientRect().y), y);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await app.close(); app = null;
    await launch();
    const after = await state();
    assert.equal(after.effects[0].duration, 17); assert.equal(after.effects[0].weight, 12); assert.equal(after.effects[0].volume, 0);
    assert.equal(after.settings.audioTarget, 'off'); assert.equal(after.settings.acknowledged, true);
    assert.equal(after.overlayUrl.split('#')[1], overlayKey);
    // Test-mode ports are ephemeral; a production source keeps the fixed port.
    await source.goto(after.overlayUrl);
    await page.waitForFunction(async () => (await window.desk.state()).value.obsConnected);
    assert.notEqual(sourceBase, '');
    assert.deepEqual(errors, []);
    console.log('UI: three languages, two themes, all editable values, preview, safe delayed test cancellation, pause, stable profile/key, OBS polling, fixed header verified.');
  } finally { if (browser) await browser.close(); if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
