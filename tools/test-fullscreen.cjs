const { chromium, _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Store } = require('../core/store.cjs');
const { Engine } = require('../core/engine.cjs');
const { payload } = require('../core/model.cjs');
const { normalizeMedia, copyMedia } = require('../core/fullscreen.cjs');
const { createServer } = require('../core/server.cjs');
const root = path.resolve(__dirname, '..');
const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-full-ui-')));
const out = process.env.DUDOS_UI_SCREENSHOTS || path.join(root, 'test-results/fullscreen');
fs.mkdirSync(out, { recursive: true });
const store = new Store(profile); store.saveSettings({ acknowledged: false, audioTarget: 'obs' });
const engine = new Engine(store), server = createServer({ store, engine, root, port: 0 });
let browser, app;
const errors = [];
const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });

// Only headless pages and an isolated editor are opened; no desktop effects or hooks.
(async () => {
	const video = path.join(profile, 'video.webm'), picture = path.join(profile, 'image.png'), sound = path.join(profile, 'sound.wav');
	const alphaVideo = path.join(profile, 'alpha.webm');
	ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=20', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=4', '-t', '4', '-c:v', 'libvpx-vp9', '-c:a', 'libopus', video]);
	const rgba = Buffer.alloc(64 * 64 * 4);
	for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) {
		const i = (y * 64 + x) * 4;
		rgba[i] = 25; rgba[i + 1] = 186; rgba[i + 2] = 137; rgba[i + 3] = x >= 24 && x < 40 && y >= 24 && y < 40 ? 255 : 128;
	}
	for (const [file, frames] of [[picture, 1], [alphaVideo, 80]]) {
		execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '64x64', '-framerate', '20', '-i', 'pipe:0',
			...(frames === 1 ? ['-frames:v', '1'] : ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-lossless', '1']), file], { windowsHide: true, input: Buffer.concat(Array(frames).fill(rgba)) });
	}
	ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=6', sound]);
	const soundFile = copyMedia(profile, sound, 'audio');
	const effects = [
		normalizeMedia('media-' + randomUUID(), { title: 'Video with replacement audio', file: copyMedia(profile, video), sound: soundFile, volume: 41, presentation: { enter: 'slide', enterFrom: 'left', enterMs: 150, exitMs: 150, soundVolume: 27 } }),
		normalizeMedia('media-' + randomUUID(), { title: 'Transparent surround', file: copyMedia(profile, picture), presentation: { fit: 'contain', imageSeconds: 2, enterMs: 100, exitMs: 100 } }),
		normalizeMedia('media-' + randomUUID(), { title: 'Alpha WebM', file: copyMedia(profile, alphaVideo), presentation: { fit: 'contain', enterMs: 0, exitMs: 100 } })
	];
	for (const effect of effects) store.saveEffect(effect.id, effect);
	const port = await server.listen();
	browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
	const obs = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	obs.on('pageerror', error => errors.push(error.message));
	await obs.goto(`http://127.0.0.1:${port}/overlay#${store.meta('overlayKey')}`);
	for (const effect of effects) {
		engine.enqueue(payload(effect, 'TEST', store.settings()));
		const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		desktop.on('pageerror', error => errors.push(error.message));
		await desktop.exposeFunction('mediaReady', value => server.present(engine.mediaReady(value.eventId, value.seconds)));
		await desktop.exposeFunction('mediaFailed', id => engine.finish(id, 'renderFailed'));
		await desktop.addInitScript(active => {
			window.dudosEffect = { state: async () => active, onState: callback => { window.updateEffect = callback; },
				mediaReady: value => window.mediaReady(value), mediaFailed: id => window.mediaFailed(id) };
		}, server.present(engine.active));
		await desktop.goto(`http://127.0.0.1:${port}/overlay`);
		await desktop.locator('.b-fullscreen').waitFor({ state: 'visible' });
		await obs.locator('.b-fullscreen').waitFor({ state: 'visible' });
		await obs.waitForTimeout(250);
		assert.deepEqual(await obs.locator('.b-fullscreen').boundingBox(), { x: 0, y: 0, width: 1280, height: 720 });
		if (effect.sound) {
			assert.equal(await obs.locator('video').evaluate(el => el.muted), true);
			assert.equal(await obs.locator('audio').evaluate(el => el.muted), false);
			assert.equal(await obs.locator('audio').evaluate(el => el.volume), .27);
			assert.equal(await desktop.locator('audio').evaluate(el => el.muted), true);
			await obs.evaluate(() => { window.original = document.querySelector('video'); });
			await obs.waitForTimeout(500);
			assert.equal(await obs.evaluate(() => window.original === document.querySelector('video')), true);
			await obs.reload();
			await obs.waitForFunction(() => document.querySelector('video')?.currentTime > .5);
			assert.ok(Math.abs(await obs.locator('video').evaluate(el => el.currentTime) - await desktop.locator('video').evaluate(el => el.currentTime)) < .7);
		} else {
			assert.equal(await obs.locator('audio').count(), 0);
			const png = await obs.screenshot({ omitBackground: true, path: path.join(out, 'fullscreen-obs.png') });
			const alpha = await obs.evaluate(async data => {
				const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
				const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
				const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
				return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(640, 360, 1, 1).data[3], ctx.getImageData(530, 360, 1, 1).data[3], ctx.getImageData(350, 360, 1, 1).data[3]];
			}, png.toString('base64'));
			assert.equal(alpha[0], 0); assert.equal(alpha[1], 255); assert.equal(alpha[3], 0);
			assert.ok(alpha[2] >= 120 && alpha[2] <= 136, 'soft alpha is preserved: ' + alpha);
		}
		engine.stop(); await desktop.evaluate(() => window.updateEffect(null));
		await obs.waitForFunction(() => !document.querySelector('.b-fullscreen'));
		assert.equal(await desktop.locator('video, audio, .b-fullscreen').count(), 0);
		await desktop.close();
	}
	// Native video sound is preserved when no replacement was selected.
	engine.enqueue(payload({ ...effects[0], sound: '' }, 'DEFAULT AUDIO', store.settings()));
	engine.mediaReady(engine.active.eventId, 4);
	await obs.locator('video').waitFor({ state: 'visible' });
	assert.equal(await obs.locator('video').evaluate(el => el.muted), false);
	assert.equal(await obs.locator('video').evaluate(el => el.volume), .41);
	assert.equal(await obs.locator('audio').count(), 0);
	engine.stop(); await browser.close(); browser = null; server.close(); engine.dispose(); store.close();
	const env = { ...process.env, DUDOS_DESK_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
	const executablePath = process.env.DUDOS_EXE;
	app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--test-mode', '--mute-audio'] } : { args: [root, '--test-mode', '--mute-audio'] }), env });
	const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
	await page.locator(`[data-effect="${effects[1].id}"]`).click();
	await page.frameLocator('#preview').locator('.b-fullscreen').waitFor({ state: 'visible' });
	await page.locator('[data-presentation="imageSeconds"]').fill('7');
	await page.locator('[data-presentation="enterFrom"]').selectOption('right');
	await page.locator('#effect-form button[type=submit]').click();
	await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Сохранено');
	const saved = (await page.evaluate(() => window.desk.state())).value.effects.find(e => e.id === effects[1].id);
	assert.equal(saved.presentation.imageSeconds, 7); assert.equal(saved.presentation.enterFrom, 'right');
	for (const width of [900, 1280, 1920]) {
		await page.setViewportSize({ width, height: 1000 });
		for (const language of ['ru', 'uk', 'en']) {
			await page.locator('#language').selectOption(language);
			await page.waitForFunction(value => document.documentElement.lang === value, language);
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		}
	}
	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.locator('#language').selectOption('ru');
	for (const theme of ['light', 'dark']) {
		if ((await page.evaluate(() => window.desk.state())).value.settings.theme !== theme) await page.locator('[data-action=theme]').click();
		await page.locator('[data-action=replay]').click();
		await page.frameLocator('#preview').locator('.b-fullscreen').waitFor({ state: 'visible' });
		await page.waitForTimeout(350);
		await page.screenshot({ path: path.join(out, 'fullscreen-editor-' + theme + '.png') });
	}
	assert.deepEqual(errors, []);
	console.log('Fullscreen: synchronized monitor/OBS, late seek, replacement/default audio, transparent surround, cleanup and editable RU/UK/EN light/dark UI verified. No real effects activated.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
	await app?.close(); await browser?.close();
	try { server.close(); engine.dispose(); store.close(); } catch {}
});
