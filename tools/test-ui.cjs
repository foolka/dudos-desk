const { _electron: electron, chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-ui-')));
const output = process.env.DUDOS_UI_SCREENSHOTS || path.join(root, 'docs/screenshots'); fs.mkdirSync(output, { recursive: true });
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

// Exercise the real range input and wait for its live iframe preview.
async function captchaSize(value) {
  await page.locator('[data-field=captchaScale]').fill(String(value));
  await page.waitForFunction(size => document.querySelector('#captcha-size-value').textContent === size + '%', value);
  const card = page.frameLocator('#preview').locator('.captcha');
  await card.waitFor();
  await page.waitForFunction(size => document.querySelector('#preview').contentDocument.querySelector('.captcha')?.style.getPropertyValue('--captcha-scale') === String(size / 100), value);
  // The iframe resize event follows the outer window layout asynchronously.
  await page.waitForFunction(size => {
    const frame = document.querySelector('#preview').contentWindow;
    const rect = frame.document.querySelector('.captcha')?.getBoundingClientRect();
    return rect && Math.abs(rect.width - 820 * size / 100 * frame.innerWidth / 1920) < 1;
  }, value);
  const geometry = await card.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.ok(Math.abs(geometry.width - 820 * value / 100 * geometry.viewportWidth / 1920) < 1, JSON.stringify({ value, ...geometry }));
  assert.ok(geometry.x >= 0 && geometry.y >= 0);
  assert.ok(geometry.x + geometry.width <= geometry.viewportWidth && geometry.y + geometry.height <= geometry.viewportHeight);
}

(async () => {
  try {
    await launch();
    assert.equal((await state()).effects.length, 7);
    assert.equal((await state()).settings.acknowledged, false);
    assert.equal(await page.locator('[data-field=captchaScale]').count(), 0);
    assert.match(await page.locator('#runtime').textContent(), /Ожидание источника OBS/);
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
    for (const [id, savedSize] of [['text_captcha', 75], ['arrow_captcha', 150]]) {
      await page.locator(`[data-effect=${id}]`).click();
      assert.equal(await page.locator('[data-field=captchaScale]').inputValue(), '100');
      for (const width of [900, 1280, 1920]) {
        await page.setViewportSize({ width, height: width === 900 ? 680 : 900 });
        for (const size of [50, 100, 200]) await captchaSize(size);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.setViewportSize({ width: 1280, height: 820 });
      await captchaSize(savedSize);
      await action('theme');
      await page.frameLocator('#preview').locator('.captcha').waitFor();
      assert.equal(await page.locator('[data-field=captchaScale]').inputValue(), String(savedSize));
      await captchaSize(savedSize);
      await page.locator('[data-field=captchaScale]').press('ArrowRight');
      assert.equal(await page.locator('[data-field=captchaScale]').inputValue(), String(savedSize + 5));
      await captchaSize(savedSize);
      await page.locator('#effect-form button[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Сохранено');
      assert.equal((await state()).effects.find(e => e.id === id).captchaScale, savedSize);
      await page.frameLocator('#preview').locator('.captcha').waitFor();
      await page.screenshot({ path: path.join(output, id + '-size.png') });
    }
    for (const id of ['invert_wasd', 'invert_mouse']) {
      await page.locator(`[data-effect=${id}]`).click();
      assert.equal(await page.locator('[data-field=duration]').inputValue(), '20');
      assert.equal(await page.locator('[data-field=category]').inputValue(), 'strong');
      await page.frameLocator('#preview').locator('.b-input-effect').waitFor();
      assert.equal(await page.locator('[data-field=captchaScale]').count(), 0);
      for (const language of ['uk', 'en', 'ru']) {
        await page.locator('#language').selectOption(language);
        await page.waitForFunction(value => document.documentElement.lang === value, language);
        await page.frameLocator('#preview').locator('.b-input-effect').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.locator('[data-field=duration]').fill('25');
      await page.locator('#effect-form button[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Сохранено');
      assert.equal((await state()).effects.find(e => e.id === id).duration, 25);
      await page.locator('#toast').waitFor({ state: 'hidden' });
      await page.screenshot({ path: path.join(output, id + '.png') });
    }
    await page.locator('[data-effect=error_flood]').click();
    await page.frameLocator('#preview').locator('.error').first().waitFor();
    await page.locator('[data-field=errorCount]').fill('10');
    await page.locator('#effect-form button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Сохранено');
    await page.locator('[data-view=rewards]').click();
    assert.equal(await page.locator('[data-reward-form]').count(), 2);
    const reward = page.locator('[data-reward-form=normal]');
    for (const name of ['perStream', 'perUser', 'cooldown']) assert.equal(await reward.locator(`[data-reward-field=${name}]`).inputValue(), '0');
    await reward.locator('[data-reward-field=title]').fill('Test reward');
    await reward.locator('[data-reward-field=cost]').fill('250');
    await page.waitForTimeout(1100);
    assert.equal(await reward.locator('[data-reward-field=title]').inputValue(), 'Test reward');
    await reward.locator('button[type=submit]').click();
    assert.equal((await state()).twitch.rewards[0].cost, 250);
    assert.equal((await state()).twitch.rewards[0].cooldown, 0);
    assert.equal((await state()).twitch.rewards[0].remoteId, undefined);
    await page.setViewportSize({ width: 900, height: 680 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, 'rewards.png') });
    await page.locator('[data-view=connection]').click();
    for (const language of ['uk', 'en', 'ru']) {
      await page.locator('#language').selectOption(language);
      await page.waitForFunction(value => document.documentElement.lang === value, language);
      assert.ok((await page.locator('.b-notice--inline strong').textContent()).length > 20);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    const before = await state();
    await page.locator('#audio-target').selectOption('off');
    await action('theme');
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.locator('#source-url').evaluate(el => { el.value = 'http://127.0.0.1:18778/overlay#PRIVATE-KEY'; });
    await page.screenshot({ path: path.join(output, 'connection.png') });
    await page.locator('#pc-sources').fill('Game');
    await page.locator('#guard-enabled').check();
    await page.locator('#guard-form button[type=submit]').click();
    assert.equal((await state()).settings.guard, true);
    assert.deepEqual((await state()).settings.pcSources, ['Game']);
    await page.locator('.b-notice--inline').evaluate(el => el.closest('section').scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(output, 'game-guard.png') });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const source = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await source.goto(before.overlayUrl);
    await page.waitForFunction(async () => (await window.desk.state()).value.obsConnected);
    await page.waitForFunction(() => document.querySelector('#runtime').textContent.startsWith('Готов ·'));
    const overlayKey = before.overlayUrl.split('#')[1];
    const sourceBase = before.overlayUrl.split('/overlay')[0];
    const sourceState = await source.evaluate(async key => (await fetch('/api/state?version=0.4.0', { headers: { Authorization: 'Bearer ' + key } })).json(), overlayKey);
    assert.equal(sourceState.active, null);
    assert.equal(await source.locator('#stage > *').count(), 0);
    await source.goto('about:blank');
    await page.waitForFunction(() => document.querySelector('#runtime').textContent.includes('Ожидание источника OBS'));
    await source.goto(before.overlayUrl);
    await page.waitForFunction(() => document.querySelector('#runtime').textContent.startsWith('Готов ·'));
    await page.setViewportSize({ width: 960, height: 720 });
    const y = await page.locator('.b-header').evaluate(el => el.getBoundingClientRect().y);
    await page.locator('#main').evaluate(el => el.scrollTop = 9999);
    assert.equal(await page.locator('.b-header').evaluate(el => el.getBoundingClientRect().y), y);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await app.close(); app = null;
    await launch();
    const after = await state();
    assert.equal(after.effects[0].duration, 17); assert.equal(after.effects[0].weight, 12); assert.equal(after.effects[0].volume, 0);
    assert.equal(after.effects.find(e => e.id === 'text_captcha').captchaScale, 75);
    assert.equal(after.effects.find(e => e.id === 'arrow_captcha').captchaScale, 150);
    for (const id of ['invert_wasd', 'invert_mouse']) assert.equal(after.effects.find(e => e.id === id).duration, 25);
    assert.equal(after.settings.audioTarget, 'off'); assert.equal(after.settings.acknowledged, true);
    assert.equal(after.settings.guard, true); assert.deepEqual(after.settings.pcSources, ['Game']);
    assert.equal(after.overlayUrl.split('#')[1], overlayKey);
    assert.equal(after.twitch.rewards[0].title, 'Test reward');
    assert.equal(after.twitch.rewards[0].cost, 250);
    // Test-mode ports are ephemeral; a production source keeps the fixed port.
    await source.goto(after.overlayUrl);
    await page.waitForFunction(async () => (await window.desk.state()).value.obsConnected);
    assert.notEqual(sourceBase, '');
    assert.deepEqual(errors, []);
    console.log('UI: three languages, two themes, captcha sizes 50-200%, live preview at 900/1280/1920px, independent saved sizes after restart, all editable values, safe delayed test cancellation, pause, stable profile/key, OBS polling, fixed header verified.');
  } finally { if (browser) await browser.close(); if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
