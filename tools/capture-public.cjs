const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

// Capture only isolated demo profiles; never sign in or start a desktop effect.
(async () => {
	const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-public-shots-')));
	const app = await electron.launch({ args: [root, '--test-mode'], env: { ...process.env, DUDOS_DESK_TEST_DATA: profile } });
	try {
		const page = await app.firstWindow(); await page.locator('#effect-form').waitFor();
		await page.setViewportSize({ width: 1280, height: 900 });
		for (const [language, locale] of [['ru', 'ru-RU'], ['uk', 'uk-UA'], ['en', 'en-US']]) {
			const output = path.join(root, 'docs/screenshots', locale); fs.mkdirSync(output, { recursive: true });
			await page.locator('#language').selectOption(language);
			await page.waitForFunction(lang => document.documentElement.lang === lang, language);
			for (const [key, id] of [['effects', 'bsod'], ['captcha', 'text_captcha'], ['keyboard', 'invert_wasd'], ['mouse', 'invert_mouse']]) {
				await page.locator('[data-view=effects]').click();
				await page.locator(`[data-effect=${id}]`).click();
				await page.frameLocator('#preview').locator(id === 'bsod' ? '.bsod' : id === 'text_captcha' ? '.captcha' : '.b-input-effect').waitFor();
				await page.locator('#toast').waitFor({ state: 'hidden' });
				assert.equal(await page.locator('.b-header__version').textContent(), 'v0.4.1');
				await page.screenshot({ path: path.join(output, key + '.png') });
			}
			await page.locator('[data-view=rewards]').click();
			await page.screenshot({ path: path.join(output, 'twitch.png') });
			await page.locator('[data-view=connection]').click();
			await page.locator('#source-url').evaluate(el => { el.value = 'http://127.0.0.1:18778/overlay#DEMO-SOURCE'; });
			await page.screenshot({ path: path.join(output, 'obs.png') });
			assert.equal((await page.evaluate(async () => (await window.desk.state()).value)).runtime.active, null);
		}
		console.log('Captured six public screenshots in RU, UK and EN using only a demo profile.');
	} finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
