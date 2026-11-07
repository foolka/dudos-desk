const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../core/store.cjs');

test('adding strong input effects preserves every existing profile row and media file', () => {
	const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-input-migration-')));
	let store = new Store(root);
	store.saveSettings({ language: 'uk', theme: 'dark', acknowledged: true });
	store.saveEffect('arrow_captcha', { duration: 73, weight: 19, captchaScale: 125, volume: 0, enabled: false });
	store.setMeta('rewards', { strong: { remoteId: 'retained-reward', cost: 105 } });
	store.remember('reward:purchase', { decision: 'accepted' }); store.log('retained', { user: 'Fixture' });
	fs.writeFileSync(path.join(root, 'media', 'fixture.wav'), 'unchanged media');
	fs.writeFileSync(path.join(root, 'auth.bin'), 'opaque fixture');
	store.db.prepare('DELETE FROM effects WHERE id IN (?, ?)').run('invert_wasd', 'invert_mouse');
	const oldRows = store.db.prepare('SELECT * FROM effects ORDER BY id').all();
	const oldMeta = store.db.prepare('SELECT * FROM meta ORDER BY key').all();
	const history = store.history();
	const marker = fs.readFileSync(path.join(root, 'profile-identity.json'), 'utf8');
	const backupsBefore = fs.readdirSync(path.join(root, 'backups')).length;
	store.close(); store = new Store(root);
	try {
		assert.equal(store.effects().length, 7);
		assert.deepEqual(store.db.prepare('SELECT * FROM effects WHERE id NOT IN (?, ?) ORDER BY id').all('invert_wasd', 'invert_mouse'), oldRows);
		assert.deepEqual(store.db.prepare('SELECT * FROM meta ORDER BY key').all(), oldMeta);
		assert.deepEqual(store.history(), history);
		assert.equal(store.redemption('reward:purchase').decision, 'accepted');
		assert.equal(fs.readFileSync(path.join(root, 'profile-identity.json'), 'utf8'), marker);
		assert.equal(fs.readFileSync(path.join(root, 'media', 'fixture.wav'), 'utf8'), 'unchanged media');
		assert.equal(fs.readFileSync(path.join(root, 'auth.bin'), 'utf8'), 'opaque fixture');
		const backups = fs.readdirSync(path.join(root, 'backups')).sort();
		assert.equal(backups.length, backupsBefore + 1);
		const backup = new DatabaseSync(path.join(root, 'backups', backups.at(-1)), { readOnly: true });
		assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM effects').get().n, 5); backup.close();
		for (const id of ['invert_wasd', 'invert_mouse']) {
			const effect = store.effects().find(e => e.id === id);
			assert.equal(effect.category, 'strong'); assert.equal(effect.duration, 20);
		}
		store.saveEffect('invert_wasd', { duration: 28, weight: 2, enabled: false });
		const beforeRestart = fs.readdirSync(path.join(root, 'backups')).length;
		store.close(); store = new Store(root);
		assert.equal(store.effects().find(e => e.id === 'invert_wasd').duration, 28);
		assert.equal(store.effects().find(e => e.id === 'invert_wasd').enabled, false);
		assert.equal(fs.readdirSync(path.join(root, 'backups')).length, beforeRestart);
	} finally { store.close(); }
});
