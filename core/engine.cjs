const { EventEmitter } = require('node:events');
const { choose, payload } = require('./model.cjs');

class Engine extends EventEmitter {
  constructor(store, { guard = async () => ({ decision: 'allow' }), ready = () => true, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    super();
    this.store = store; this.guard = guard; this.ready = ready; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.queue = []; this.active = null; this.timer = null; this.delayed = null; this.epoch = 0; this.chain = Promise.resolve(); this.closed = false; this.pending = 0;
  }
  view() { return { active: this.active, queue: this.queue, delayed: this.delayed && { id: this.delayed.id, at: this.delayed.at }, paused: this.store.settings().paused }; }
  changed() { this.emit('change', this.view()); }
  reason() {
    if (this.closed) return 'closing';
    if (!this.store.settings().acknowledged) return 'acknowledgeFirst';
    if (this.store.settings().paused) return 'paused';
    if (this.queue.length >= 20) return 'queueFull';
    return '';
  }
  // Serialize redemptions, including asynchronous OBS checks and duplicate claims.
  redeem(input) {
    if (this.pending >= 20) return Promise.resolve({ ok: false, decision: 'hold', reason: 'queueFull' });
    const epoch = this.epoch;
    const deadline = this.now() + 10000;
    this.pending++;
    const run = this.chain.then(() => this.accept(input, epoch, deadline)).finally(() => { this.pending--; });
    this.chain = run.catch(() => {});
    return run;
  }
  async accept(input, epoch, deadline) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!input || !['normal', 'strong'].includes(input.category) || !uuid.test(input.rewardId) || !uuid.test(input.redemptionId) || typeof input.user !== 'string' || input.user.length > 60) throw Error('invalidRedemption');
    const key = input.rewardId.toLowerCase() + ':' + input.redemptionId.toLowerCase();
    const seen = this.store.redemption(key);
    if (seen) return { ...seen, duplicate: true };
    if (this.now() >= deadline) return { ok: false, decision: 'hold', reason: 'requestExpired' };
    let reason = this.reason();
    if (reason || epoch !== this.epoch) return { ok: false, decision: 'hold', reason: reason || 'stopped' };
    // Resolve a mode refund even if its scene also hides the OBS mirror.
    if (this.store.settings().guard) {
      const result = await this.guard(this.store.settings());
      if (this.now() >= deadline) return { ok: false, decision: 'hold', reason: 'requestExpired' };
      if (epoch !== this.epoch || this.reason()) return { ok: false, decision: 'hold', reason: this.reason() || 'stopped' };
      if (result.decision !== 'allow') {
        const reply = { ...result, ok: false };
        if (reply.decision === 'refund') this.store.remember(key, reply);
        this.store.log(reply.decision, { reason: reply.reason, user: input.user });
        return reply;
      }
    }
    let effect;
    // Never enqueue an allowed effect until the OBS mirror is ready.
    if (!this.ready()) return { ok: false, decision: 'hold', reason: 'obsNotReady' };
    try { effect = choose(this.store.effects(), input.category); }
    catch { return { ok: false, decision: 'hold', reason: 'emptyCategory' }; }
    const item = { ...payload(effect, input.user, this.store.settings(), this.now()), requiresObs: true };
    const result = { ok: true, decision: 'accepted', eventId: item.eventId, effect: item.id };
    this.store.remember(key, result);
    this.enqueue(item);
    return result;
  }
  enqueue(item) {
    this.queue.push(item);
    this.store.log('queued', { effect: item.id, user: item.user });
    this.pump(); this.changed();
  }
  test(id, delay = 10) {
    const reason = this.reason();
    if (reason) throw Error(reason);
    if (this.delayed) throw Error('testAlreadyScheduled');
    const effect = this.store.effects().find(e => e.id === id);
    if (!effect) throw Error('unknownEffect');
    const item = payload(effect, 'TEST', this.store.settings(), this.now());
    const epoch = this.epoch;
    const timer = this.setTimer(() => {
      this.delayed = null;
      if (epoch === this.epoch && !this.reason()) this.enqueue(item);
      this.changed();
    }, delay * 1000);
    this.delayed = { id, at: this.now() + delay * 1000, timer };
    this.changed();
  }
  pump() {
    if (this.active || !this.queue.length || this.store.settings().paused || this.closed) return;
    if (this.queue[0].requiresObs && !this.ready()) return;
    this.active = { ...this.queue.shift(), startedAt: this.now() };
    if (this.active.kind === 'fullscreen') this.active.duration = 20;
    this.active.endsAt = this.active.startedAt + this.active.duration * 1000;
    if (['text_captcha', 'arrow_captcha'].includes(this.active.id)) {
      this.active.captcha = { text: '', progress: 0, error: false, solved: false };
    }
    const id = this.active.eventId;
    this.timer = this.setTimer(() => this.finish(id, 'timeout'), this.active.duration * 1000);
    this.store.log('started', { effect: this.active.id, user: this.active.user });
    this.changed();
  }
  // Only the trusted desktop renderer starts a shared, bounded media timeline.
  mediaReady(id, seconds) {
    const active = this.active;
    if (!active || active.eventId !== id || active.kind !== 'fullscreen' || active.mediaStartedAt) return null;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) return null;
    const p = active.presentation;
    const duration = active.mediaKind === 'image' ? p.imageSeconds : seconds;
    active.mediaStartedAt = this.now();
    active.duration = duration + (active.mediaKind === 'image' && p.enter !== 'none' ? p.enterMs / 1000 : 0) + (p.exit !== 'none' ? p.exitMs / 1000 : 0);
    active.endsAt = active.mediaStartedAt + active.duration * 1000;
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.finish(id, 'finished'), active.duration * 1000 + 200);
    this.changed();
    return { ...active };
  }
  // Only the trusted desktop window supplies bounded, transient captcha input.
  updateCaptcha(input) {
    const active = this.active;
    if (!active?.captcha || active.captcha.solved || this.now() >= active.endsAt || input?.eventId !== active.eventId) return false;
    let next;
    if (active.id === 'text_captcha') {
      if (typeof input.text !== 'string' || input.text.length > 6 || typeof input.error !== 'boolean') return false;
      next = { text: input.text, progress: 0, error: input.error, solved: false };
    } else {
      if (!Number.isInteger(input.progress) || input.progress < 0 || input.progress > active.arrows.length) return false;
      next = { text: '', progress: input.progress, error: false, solved: false };
    }
    if (JSON.stringify(active.captcha) === JSON.stringify(next)) return true;
    active.captcha = next;
    this.changed();
    return true;
  }
  // Retain the final frame for two OBS polls without extending the effect deadline.
  solveCaptcha(id) {
    const active = this.active;
    if (!active?.captcha || active.eventId !== id || active.captcha.solved || this.now() >= active.endsAt) return false;
    const correct = active.id === 'text_captcha'
      ? active.captcha.text.trim().toUpperCase() === active.code
      : active.captcha.progress === active.arrows.length;
    if (!correct) return false;
    active.captcha.solved = true;
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.finish(id, 'solved'), Math.min(750, active.endsAt - this.now()));
    this.changed();
    return true;
  }
  finish(id, reason = 'finished') {
    if (!this.active || this.active.eventId !== id) return false;
    this.clearTimer(this.timer); this.timer = null;
    this.store.log(reason, { effect: this.active.id, user: this.active.user });
    this.active = null;
    this.changed(); this.pump();
    return true;
  }
  pause(value) {
    this.store.saveSettings({ paused: value });
    if (!value) this.pump();
    this.changed();
  }
  // Invalidate delayed work as well as the visible effect and entire queue.
  stop() {
    this.epoch++;
    this.clearTimer(this.timer); this.timer = null;
    if (this.delayed) this.clearTimer(this.delayed.timer);
    this.delayed = null; this.queue = []; this.active = null;
    this.store.log('stopped'); this.changed();
  }
  dispose() { this.stop(); this.closed = true; }
}
module.exports = { Engine };
