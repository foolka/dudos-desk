const { EventEmitter } = require('node:events');
const { choose, payload } = require('./model.cjs');

class Engine extends EventEmitter {
  constructor(store, { guard = async () => ({ decision: 'allow' }), now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    super();
    this.store = store; this.guard = guard; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
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
    try { effect = choose(this.store.effects(), input.category); }
    catch { return { ok: false, decision: 'hold', reason: 'emptyCategory' }; }
    const item = payload(effect, input.user, this.store.settings(), this.now());
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
    this.active = { ...this.queue.shift(), startedAt: this.now() };
    this.active.endsAt = this.active.startedAt + this.active.duration * 1000;
    const id = this.active.eventId;
    this.timer = this.setTimer(() => this.finish(id, 'timeout'), this.active.duration * 1000);
    this.store.log('started', { effect: this.active.id, user: this.active.user });
    this.changed();
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
