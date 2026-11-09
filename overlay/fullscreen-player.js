(() => {
	// Shared desktop/OBS timeline; late sources seek instead of starting from zero.
	function mount(container, initial, options = {}) {
		let active = initial, stopped = false, loaded = false, started = false, animation;
		const p = active.presentation, image = active.mediaKind === 'image';
		const frame = document.createElement('div'); frame.className = 'b-fullscreen';
		const media = document.createElement(image ? 'img' : 'video'); media.className = 'b-fullscreen__media';
		const replacement = active.soundUrl ? document.createElement('audio') : null;
		const audible = !options.preview && active.audioTarget !== 'off' && (options.desktop ? active.audioTarget !== 'obs' : active.audioTarget !== 'local');
		media.style.objectFit = p.fit; frame.append(media);
		if (image) media.alt = '';
		else { media.preload = 'auto'; media.playsInline = true; media.volume = active.volume / 100; media.muted = !!replacement || !audible; }
		if (replacement) { replacement.preload = 'auto'; replacement.volume = p.soundVolume / 100; replacement.muted = !audible; frame.append(replacement); }
		frame.style.visibility = 'hidden'; container.append(frame);
		const timers = new Set();
		const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
		const cancel = id => { clearTimeout(id); timers.delete(id); };
		let duration = image ? p.imageSeconds : 0, mediaReady = false, soundReady = !replacement;
		const loadTimeout = later(fail, 20000);

		// Own all media resources so stale loads cannot revive a stopped scare.
		function stop() {
			if (stopped) return;
			stopped = true; timers.forEach(clearTimeout); timers.clear(); animation?.cancel();
			for (const el of [media, replacement].filter(Boolean)) {
				el.onload = el.onerror = el.onloadedmetadata = el.onended = null;
				if (el !== media || !image) el.pause();
				el.removeAttribute('src');
				if (el !== media || !image) el.load();
			}
			frame.remove();
		}
		function fail() { if (!stopped) { stop(); options.failed?.(active.eventId); } }
		function frames(name, direction, leaving) {
			const offset = { center: 'translate(0,0)', left: 'translateX(-110%)', right: 'translateX(110%)', top: 'translateY(-110%)', bottom: 'translateY(110%)' }[direction];
			const rest = { opacity: 1, transform: 'translate(0,0) scale(1)' };
			const from = name === 'slide' ? { opacity: 1, transform: direction === 'center' ? 'scale(0)' : offset }
				: { opacity: 0, transform: name === 'fade' ? rest.transform : `${offset} scale(.05)` };
			const values = name === 'pop' ? [from, { opacity: 1, transform: 'scale(1.06)' }, rest] : [from, rest];
			return leaving ? values.reverse() : values;
		}
		function motion(leaving, elapsed = 0) {
			animation?.cancel();
			let name = leaving ? p.exit : p.enter, ms = leaving ? p.exitMs : p.enterMs;
			if (name === 'none' || !ms) return;
			if (matchMedia('(prefers-reduced-motion: reduce)').matches) { name = 'fade'; ms = Math.min(ms, 150); }
			animation = frame.animate(frames(name, leaving ? p.exitTo : p.enterFrom, leaving), { duration: ms, easing: leaving ? 'ease-in' : 'ease-out', fill: 'both' });
			animation.currentTime = Math.min(ms, elapsed);
		}
		function start() {
			if (stopped || started || !loaded || !active.mediaStartedAt) return;
			started = true;
			const elapsed = Math.max(0, Date.now() - active.mediaStartedAt);
			if (Date.now() >= active.endsAt) { stop(); return; }
			frame.style.visibility = 'visible'; motion(false, elapsed);
			const plays = [];
			if (!image && elapsed < duration * 1000) { media.currentTime = Math.min(elapsed / 1000, Math.max(0, duration - .01)); plays.push(media.play()); }
			if (replacement && elapsed < replacement.duration * 1000) { replacement.currentTime = elapsed / 1000; plays.push(replacement.play()); }
			Promise.all(plays).catch(fail);
			const exitAt = active.endsAt - (p.exit === 'none' ? 0 : p.exitMs);
			later(() => motion(true, Math.max(0, Date.now() - exitAt)), Math.max(0, exitAt - Date.now()));
			later(stop, Math.max(0, active.endsAt - Date.now()));
		}
		async function ready() {
			if (stopped || loaded || !mediaReady || !soundReady) return;
			loaded = true; cancel(loadTimeout);
			if (options.preview) {
				active = { ...active, mediaStartedAt: Date.now(), endsAt: Date.now() + duration * 1000 + (image && p.enter !== 'none' ? p.enterMs : 0) + (p.exit !== 'none' ? p.exitMs : 0) };
			} else if (options.desktop) {
				try { const next = await options.ready({ eventId: active.eventId, seconds: duration }); if (!next) return fail(); active = next; }
				catch { return fail(); }
			}
			start();
		}
		media.onerror = fail;
		if (image) media.onload = () => { if (!media.naturalWidth || !media.naturalHeight) return fail(); mediaReady = true; void ready(); };
		else media.onloadedmetadata = () => { duration = media.duration; if (!Number.isFinite(duration) || duration <= 0 || duration > 600) return fail(); mediaReady = true; void ready(); };
		if (replacement) {
			replacement.onerror = fail;
			replacement.onloadedmetadata = () => { if (!Number.isFinite(replacement.duration) || replacement.duration <= 0 || replacement.duration > 600) return fail(); soundReady = true; void ready(); };
		}
		media.src = active.mediaUrl;
		if (replacement) replacement.src = active.soundUrl;
		return { stop, update: value => { active = value; start(); }, frame, media, replacement };
	}
	window.DudosFullscreen = { mount };
})();
