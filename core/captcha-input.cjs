const { spawn } = require('node:child_process');

// Both processes enforce the five-second ceiling; a dead child removes its own hook.
class CaptchaInput {
  constructor({ file, spawnImpl = spawn, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, setPulse = setInterval, clearPulse = clearInterval, report = () => {} }) {
    Object.assign(this, { file, spawnImpl, now, setTimer, clearTimer, setPulse, clearPulse, report });
  }
  start(handle, eventId) {
    if (this.job?.eventId === eventId) return;
    this.stop();
    const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
    const job = { eventId };
    this.job = job;
    try {
      job.child = this.spawnImpl(this.file, [String(process.pid), String(hwnd), String(this.now() + 5000)], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      job.child.on('error', () => { if (this.job === job) { this.report('captchaInputUnavailable'); this.stop(eventId); } });
      job.child.on('exit', code => {
        if (this.job !== job) return;
        if (code === 3) this.report('captchaFocusDenied');
        else if (code && code !== 2) this.report('captchaInputUnavailable');
        this.stop(eventId);
      });
      job.child.stdin.on('error', () => this.stop(eventId));
      job.child.stdout.resume();
      const ping = () => { if (!job.child.stdin.destroyed) job.child.stdin.write('ping\n'); };
      ping();
      job.pulse = this.setPulse(ping, 250);
      job.timer = this.setTimer(() => this.stop(eventId), 5000);
      job.pulse.unref?.(); job.timer.unref?.();
    } catch { this.report('captchaInputUnavailable'); this.stop(eventId); }
  }
  stop(eventId) {
    const job = this.job;
    if (!job || (eventId && eventId !== job.eventId)) return;
    this.job = null;
    this.clearTimer(job.timer); this.clearPulse(job.pulse);
    job.child?.stdin.destroy();
    try { job.child?.kill(); } catch {}
  }
}
module.exports = { CaptchaInput };
