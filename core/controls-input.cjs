const { spawn } = require('node:child_process');
const { INPUT_EFFECTS } = require('./model.cjs');
const REASONS = new Set(['inputFinished', 'inputFocusLost', 'inputEmergency', 'inputTargetUnavailable', 'inputSendFailed', 'inputUnavailable']);

// Serialize short-lived helpers and allow key-up cleanup before a replacement.
class ControlsInput {
	constructor({ file, spawnImpl = spawn, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, setPulse = setInterval, clearPulse = clearInterval, ended = () => {} }) {
		Object.assign(this, { file, spawnImpl, now, setTimer, clearTimer, setPulse, clearPulse, ended });
		this.epoch = 0; this.pending = Promise.resolve(); this.wanted = null; this.job = null;
	}
	async start(active) {
		if (this.wanted === active.eventId) return;
		const waiting = this.stop();
		const epoch = ++this.epoch;
		this.wanted = active.eventId;
		await waiting;
		if (epoch !== this.epoch) return;
		const remaining = Math.min(120000, active.endsAt - this.now());
		if (!INPUT_EFFECTS.includes(active.id) || !Number.isFinite(remaining) || remaining <= 0) { this.wanted = null; return; }
		const job = { eventId: active.eventId, mode: active.id, reason: 'inputUnavailable', stopping: false, buffer: '' };
		this.job = job;
		try {
			job.child = this.spawnImpl(this.file, [String(process.pid), active.id, String(Math.floor(this.now() + remaining))], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
			job.exited = new Promise(resolve => { job.resolve = resolve; });
			this.pending = job.exited;
			const done = (code, signal) => {
				if (job.done) return;
				job.done = true;
				this.clearTimer(job.timer); this.clearTimer(job.killTimer); this.clearPulse(job.pulse);
				job.child.stdin.destroy();
				if (this.job === job) this.job = null;
				const finish = () => {
					job.resolve();
					if (!job.stopping && this.wanted === job.eventId) { this.wanted = null; this.ended(job.eventId, job.reason); }
				};
				if ((signal || ![0, 2, 3, 4].includes(code)) && job.mode === 'invert_wasd') this.releaseKeys().finally(finish);
				else finish();
			};
			job.child.on('close', done);
			job.child.on('error', () => done(1));
			job.child.stdout.on('data', bytes => {
				job.buffer = (job.buffer + bytes.toString()).slice(-512);
				const lines = job.buffer.split(/\r?\n/); job.buffer = lines.pop();
				for (const line of lines) if (REASONS.has(line)) job.reason = line;
			});
			job.child.stdin.on('error', () => { if (this.job === job) void this.stop(job.eventId); });
			const ping = () => { if (!job.stopping && !job.child.stdin.destroyed) job.child.stdin.write('ping\n'); };
			ping(); job.pulse = this.setPulse(ping, 250);
			job.timer = this.setTimer(() => { if (this.job === job) void this.stop(job.eventId); }, remaining);
			job.pulse.unref?.(); job.timer.unref?.();
		} catch {
			this.job = null; this.wanted = null;
			this.ended(job.eventId, 'inputUnavailable');
		}
	}
	// A helper crash must not leave a synthetic movement key held down.
	releaseKeys() {
		return new Promise(resolve => {
			try {
				const child = this.spawnImpl(this.file, ['--release-keys'], { windowsHide: true, stdio: 'ignore' });
				let timer;
				const finish = () => { this.clearTimer(timer); resolve(); };
				child.once('exit', finish); child.once('error', finish);
				timer = this.setTimer(() => { try { child.kill(); } catch {} finish(); }, 1500);
				timer.unref?.();
			} catch { resolve(); }
		});
	}
	stop(eventId) {
		if (eventId && this.wanted !== eventId) return this.pending;
		this.epoch++; this.wanted = null;
		const job = this.job;
		if (!job) return this.pending;
		this.job = null; job.stopping = true;
		this.clearTimer(job.timer); this.clearPulse(job.pulse);
		job.killTimer = this.setTimer(() => { try { job.child.kill(); } catch {} }, 1500);
		job.killTimer.unref?.();
		try { job.child.stdin.end('stop\n'); } catch { try { job.child.kill(); } catch {} }
		this.pending = job.exited;
		return this.pending;
	}
}
module.exports = { ControlsInput };
