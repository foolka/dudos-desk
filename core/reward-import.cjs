const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomUUID } = require('node:crypto');
const { TYPES, normalizeMedia, copyMedia } = require('./fullscreen.cjs');

// Read only the media catalog and saved rewards, never tokens or Twitch bindings.
function readSource(root) {
	const file = path.join(root, 'rewards.sqlite');
	if (!fs.existsSync(file)) return [];
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		if (db.prepare('PRAGMA user_version').get().user_version !== 1) throw Error('profileVersion');
		const media = new Map(db.prepare('SELECT body FROM media').all().map(row => {
			const value = JSON.parse(row.body); return [value.id, value];
		}));
		const resolve = (id, audio = false) => {
			const m = media.get(id);
			if (!m || !/^[a-f0-9-]{36}$/.test(m.id) || !TYPES[m.ext] || (audio ? TYPES[m.ext][0] !== 'audio' : !['image', 'video'].includes(TYPES[m.ext][0]))) throw Error('invalidMedia');
			const source = path.join(root, 'media', m.id + m.ext);
			const parent = fs.realpathSync(path.join(root, 'media'));
			if (path.dirname(fs.realpathSync(source)).toLowerCase() !== parent.toLowerCase()) throw Error('invalidMedia');
			return { source, name: m.name || m.id };
		};
		const entries = [];
		for (const row of db.prepare('SELECT body FROM rewards').all()) {
			const reward = JSON.parse(row.body);
			if (reward.kind !== 'video' || reward.video?.fullscreen !== true) continue;
			for (const item of reward.items || []) {
				if (entries.length >= 500) throw Error('tooManyMedia');
				try {
					const main = resolve(item.id), sound = item.presentation?.soundId ? resolve(item.presentation.soundId, true) : null;
					const effect = normalizeMedia('media-' + randomUUID(), {
						title: `${reward.title}: ${main.name}`.slice(0, 120), file: path.basename(main.source),
						weight: item.weight, volume: item.volume, presentation: item.presentation,
						sound: sound ? path.basename(sound.source) : ''
					});
					const digest = createHash('sha256');
					for (const source of [main.source, sound?.source].filter(Boolean)) {
						if (fs.statSync(source).size > 512 * 1024 * 1024) throw Error('invalidMedia');
						const fd = fs.openSync(source, 'r'), block = Buffer.alloc(1024 * 1024);
						try { let size; while ((size = fs.readSync(fd, block)) > 0) digest.update(block.subarray(0, size)); }
						finally { fs.closeSync(fd); }
					}
					digest.update(JSON.stringify({ title: effect.title, weight: effect.weight, volume: effect.volume, presentation: effect.presentation }));
					entries.push({ effect, source: main.source, sound: sound?.source, fingerprint: digest.digest('hex') });
				} catch { entries.push({ error: 'invalidMedia', title: String(reward.title).slice(0, 120) }); }
			}
		}
		return entries;
	} finally { db.close(); }
}

// Commit independent copies atomically; retrying an import never adds duplicates.
function importRewards(store, roots) {
	const entries = roots.flatMap(readSource), known = store.meta('fullscreenImports') || {};
	const result = { added: 0, skipped: 0, failed: entries.filter(e => e.error).length };
	const copies = [], additions = [];
	const existing = store.effects().filter(effect => effect.kind === 'fullscreen').length;
	try {
		for (const entry of entries.filter(e => !e.error)) {
			if (known[entry.fingerprint]) { result.skipped++; continue; }
			if (existing + additions.length >= 500) throw Error('tooManyMedia');
			const file = copyMedia(store.root, entry.source); copies.push(file);
			const sound = entry.sound ? copyMedia(store.root, entry.sound, 'audio') : '';
			if (sound) copies.push(sound);
			const effect = normalizeMedia(entry.effect.id, { ...entry.effect, file, sound });
			additions.push(effect); known[entry.fingerprint] = effect.id;
		}
		if (additions.length) {
			store.backup(); store.db.exec('BEGIN IMMEDIATE');
			try {
				for (const effect of additions) store.writeEffect(effect);
				store.setMeta('fullscreenImports', known);
				store.db.exec('COMMIT');
			} catch (error) { store.db.exec('ROLLBACK'); throw error; }
		}
		result.added = additions.length;
		return result;
	} catch (error) {
		for (const name of copies) fs.unlinkSync(path.join(store.root, 'media', name));
		throw error;
	}
}
module.exports = { readSource, importRewards };
