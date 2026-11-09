const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const TYPES = {
	'.mp4': ['video', 'video/mp4'], '.webm': ['video', 'video/webm'],
	'.png': ['image', 'image/png'], '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'],
	'.webp': ['image', 'image/webp'], '.gif': ['image', 'image/gif'],
	'.mp3': ['audio', 'audio/mpeg'], '.wav': ['audio', 'audio/wav'], '.ogg': ['audio', 'audio/ogg'],
	'.m4a': ['audio', 'audio/mp4'], '.flac': ['audio', 'audio/flac']
};
const ID = /^media-[a-f0-9-]{36}$/;
const FILE = /^[a-f0-9-]{36}\.(mp4|webm|png|jpe?g|webp|gif|mp3|wav|ogg|m4a|flac)$/;
const motions = ['none', 'fade', 'slide', 'zoom', 'pop'];
const directions = ['center', 'left', 'right', 'top', 'bottom'];

// Keep each custom entry bounded and independent of its former Twitch reward.
function normalizeMedia(id, input) {
	if (!ID.test(id) || !input || !FILE.test(input.file) || !['image', 'video'].includes(TYPES[path.extname(input.file)]?.[0])) throw Error('invalidMedia');
	const title = String(input.title || '').trim();
	if (!title || title.length > 120) throw Error('invalidValue');
	if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw Error('invalidValue');
	const p = { imageSeconds: 5, fit: 'cover', enter: 'pop', enterMs: 250, enterFrom: 'center', exit: 'fade', exitMs: 250, exitTo: 'center', soundVolume: 80, ...input.presentation };
	const number = (value, min, max, integer = false) => {
		if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw Error('invalidValue');
		return value;
	};
	if (!motions.includes(p.enter) || !motions.includes(p.exit) || !directions.includes(p.enterFrom) || !directions.includes(p.exitTo) || !['cover', 'contain'].includes(p.fit)) throw Error('invalidValue');
	if (input.sound && (!FILE.test(input.sound) || TYPES[path.extname(input.sound)]?.[0] !== 'audio')) throw Error('invalidSound');
	return {
		id, kind: 'fullscreen', category: 'normal', title, file: input.file,
		mediaKind: TYPES[path.extname(input.file)][0], enabled: input.enabled !== false,
		weight: number(input.weight ?? 35, 0, 10000, true), volume: number(input.volume ?? 80, 0, 100),
		sound: input.sound || '', duration: 630,
		presentation: { fit: p.fit, imageSeconds: number(p.imageSeconds, .1, 600),
			enter: p.enter, enterMs: number(p.enterMs, 0, 5000, true), enterFrom: p.enterFrom,
			exit: p.exit, exitMs: number(p.exitMs, 0, 5000, true), exitTo: p.exitTo,
			soundVolume: number(p.soundVolume, 0, 100) }
	};
}

// Copy selected files into the profile; never depend on the original user folder.
function copyMedia(root, source, kind = 'visual') {
	const ext = path.extname(source).toLowerCase(), type = TYPES[ext];
	const stat = fs.statSync(source);
	if (!type || (kind === 'audio' ? type[0] !== 'audio' : !['video', 'image'].includes(type[0])) || !stat.isFile() || !stat.size || stat.size > 512 * 1024 * 1024) throw Error('invalidMedia');
	const name = randomUUID() + ext, file = path.join(root, 'media', name);
	fs.copyFileSync(source, file, fs.constants.COPYFILE_EXCL);
	return name;
}

module.exports = { TYPES, ID, FILE, motions, directions, normalizeMedia, copyMedia };
