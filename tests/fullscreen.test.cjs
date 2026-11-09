const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../core/store.cjs');
const { Engine } = require('../core/engine.cjs');
const { normalizeMedia, copyMedia } = require('../core/fullscreen.cjs');
const { payload, choose } = require('../core/model.cjs');
const { importRewards } = require('../core/reward-import.cjs');
const { createServer, OVERLAY_VERSION } = require('../core/server.cjs');

// Never open a real profile, show a desktop effect or connect to Twitch.
function fixture(t) {
	const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-media-')));
	const store = new Store(root);
	const cleanups = [];
	t.after(() => { for (const cleanup of cleanups) cleanup(); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
	return { root, store, cleanups };
}

test('custom media is normal-category only and validates every per-item setting', () => {
	const id = 'media-' + randomUUID(), file = randomUUID() + '.webm';
	const effect = normalizeMedia(id, { file, title: 'Scare', category: 'strong' });
	assert.equal(effect.category, 'normal'); assert.equal(effect.presentation.imageSeconds, 5);
	assert.equal(effect.sound, '');
	for (const patch of [{ file: '../secret.bin' }, { file: randomUUID() + '.svg' }, { sound: file },
		{ weight: -1 }, { volume: 101 }, { presentation: { imageSeconds: 601 } },
		{ presentation: { enterMs: 5001 } }, { presentation: { enterFrom: 'javascript:' } }])
		assert.throws(() => normalizeMedia(id, { file, title: 'Scare', ...patch }));
	assert.equal(choose([effect], 'normal', () => 0).id, id);
	assert.throws(() => choose([effect], 'strong'));
});

test('profile retains custom media; deletion does not remove files or existing Twitch bindings', t => {
	const { store, root } = fixture(t), source = path.join(root, 'sample.png'); fs.writeFileSync(source, 'image');
	const file = copyMedia(root, source), effect = normalizeMedia('media-' + randomUUID(), { file, title: 'Image' });
	store.setMeta('twitchRewards', { normal: { remoteId: 'keep' } });
	store.saveEffect(effect.id, effect);
	assert.equal(store.effects().length, 8);
	store.removeMedia(effect.id);
	assert.equal(store.effects().length, 7); assert.equal(fs.readFileSync(path.join(root, 'media', file), 'utf8'), 'image');
	assert.deepEqual(store.meta('twitchRewards'), { normal: { remoteId: 'keep' } });
	assert.throws(() => store.removeMedia('bsod'));
});

test('metadata starts one bounded timeline and stale callbacks cannot affect the next effect', t => {
	const { store, cleanups } = fixture(t); let now = 10000;
	const engine = new Engine(store, { now: () => now }); cleanups.push(() => engine.dispose());
	const effect = normalizeMedia('media-' + randomUUID(), { file: randomUUID() + '.webm', title: 'Video' });
	engine.enqueue(payload(effect, 'TEST', store.settings(), now));
	const id = engine.active.eventId;
	assert.equal(engine.active.duration, 20);
	assert.equal(engine.mediaReady('stale', 5), null); assert.equal(engine.mediaReady(id, 601), null);
	now += 2000;
	const active = engine.mediaReady(id, 8);
	assert.equal(active.mediaStartedAt, now); assert.equal(active.endsAt, now + 8250);
	assert.equal(engine.mediaReady(id, 100), null);
	engine.stop(); assert.equal(engine.mediaReady(id, 4), null);
});

test('read-only import copies media and replacement audio, skips duplicates and preserves source', t => {
	const { store, root } = fixture(t), sourceRoot = path.join(root, 'RewardSource');
	fs.mkdirSync(path.join(sourceRoot, 'media'), { recursive: true });
	const db = new DatabaseSync(path.join(sourceRoot, 'rewards.sqlite'));
	db.exec('CREATE TABLE rewards(body TEXT); CREATE TABLE media(body TEXT); PRAGMA user_version=1;');
	const id = randomUUID(), sound = randomUUID();
	for (const [key, ext, content] of [[id, '.png', 'picture'], [sound, '.mp3', 'audio']]) {
		db.prepare('INSERT INTO media VALUES(?)').run(JSON.stringify({ id: key, ext, name: key + ext }));
		fs.writeFileSync(path.join(sourceRoot, 'media', key + ext), content);
	}
	const reward = { title: 'Legacy', kind: 'video', remoteId: 'do-not-import', video: { fullscreen: true },
		items: [{ id, weight: 9, volume: 17, presentation: { soundId: sound, soundVolume: 31, imageSeconds: 7, enter: 'slide', enterFrom: 'right' } }] };
	db.prepare('INSERT INTO rewards VALUES(?)').run(JSON.stringify(reward)); db.close();
	const before = fs.readFileSync(path.join(sourceRoot, 'rewards.sqlite'));
	assert.deepEqual(importRewards(store, [sourceRoot]), { added: 1, skipped: 0, failed: 0 });
	assert.deepEqual(importRewards(store, [sourceRoot]), { added: 0, skipped: 1, failed: 0 });
	const entry = store.effects().find(e => e.kind === 'fullscreen');
	assert.equal(entry.weight, 9); assert.equal(entry.volume, 17); assert.equal(entry.presentation.enterFrom, 'right');
	assert.equal(entry.presentation.imageSeconds, 7); assert.equal(entry.presentation.soundVolume, 31);
	assert.equal(entry.remoteId, undefined); assert.equal(store.meta('twitchRewards'), null);
	assert.equal(fs.readFileSync(path.join(root, 'media', entry.file), 'utf8'), 'picture');
	assert.equal(fs.readFileSync(path.join(root, 'media', entry.sound), 'utf8'), 'audio');
	assert.deepEqual(fs.readFileSync(path.join(sourceRoot, 'rewards.sqlite')), before);
});

test('media endpoint requires the read-only key, supports ranges and rejects old source versions', async t => {
	const { store, root, cleanups } = fixture(t), engine = new Engine(store);
	const file = randomUUID() + '.webm'; fs.writeFileSync(path.join(root, 'media', file), '0123456789');
	const server = createServer({ store, engine, root: path.resolve(__dirname, '..'), port: 0 });
	const port = await server.listen(); cleanups.push(() => { server.close(); engine.dispose(); });
	const url = server.mediaUrl(file);
	assert.equal((await fetch(url.split('?')[0])).status, 403);
	const response = await fetch(url, { headers: { Range: 'bytes=2-4' } });
	assert.equal(response.status, 206); assert.equal(await response.text(), '234');
	assert.equal(response.headers.get('content-range'), 'bytes 2-4/10');
	assert.equal((await fetch(url, { headers: { Range: 'bytes=99-' } })).status, 416);
	const headers = { Authorization: 'Bearer ' + store.meta('overlayKey') };
	assert.equal((await fetch(`http://127.0.0.1:${port}/api/state?version=0.4.0`, { headers })).status, 409);
	assert.equal((await fetch(`http://127.0.0.1:${port}/api/state?version=${OVERLAY_VERSION}`, { headers })).status, 200);
});
