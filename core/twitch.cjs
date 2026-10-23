const { loadSdk } = require('./twitch-auth.cjs');
const CATEGORIES = ['normal', 'strong'];

// Zero disables a Twitch limit; identifiers belong to the saved binding, not form input.
function rewardFields(category, input = {}) {
  if (!CATEGORIES.includes(category)) throw Error('invalidValue');
  const title = String(input.title ?? (category === 'normal' ? 'Dudos' : 'Dudos Plus')).trim();
  const prompt = String(input.prompt ?? '').trim();
  if (!title || title.length > 45 || prompt.length > 200) throw Error('invalidValue');
  const result = { category, title, prompt, color: input.color ?? '#B83A5D', enabled: input.enabled !== false, paused: input.paused === true };
  if (!/^#[0-9a-f]{6}$/i.test(result.color)) throw Error('invalidValue');
  for (const [key, fallback, min, max] of [['cost', category === 'normal' ? 100 : 300, 1, 1000000000], ['cooldown', 0, 0, 604800], ['perStream', 0, 0, 1000000], ['perUser', 0, 0, 1000000]]) {
    const value = Number(input[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('invalidValue');
    result[key] = value;
  }
  return result;
}

function twitchFields(r, creating = false) {
  return { title: r.title, prompt: r.prompt, cost: r.cost, background_color: r.color, is_enabled: r.enabled,
    is_user_input_required: false, should_redemptions_skip_request_queue: false,
    is_max_per_stream_enabled: r.perStream > 0, max_per_stream: r.perStream || 1,
    is_max_per_user_per_stream_enabled: r.perUser > 0, max_per_user_per_stream: r.perUser || 1,
    is_global_cooldown_enabled: r.cooldown > 0, global_cooldown_seconds: r.cooldown || 1,
    ...(!creating ? { is_paused: r.paused } : {}) };
}

class Twitch {
  constructor({ auth, store, engine, sdk = loadSdk, fetchImpl = fetch, changed = () => {} }) {
    Object.assign(this, { auth, store, engine, sdk, fetchImpl, changed });
    this.epoch = 0; this.status = 'signed_out'; this.inflight = new Map(); this.writes = new Set();
    this.onRetry = () => this.reconnect();
    auth.on('retry', this.onRetry);
  }
  account() { return this.auth.saved?.user.id || ''; }
  client() { return this.auth.saved?.clientId || ''; }
  owns(r) { return !!this.account() && r.account === this.account() && r.clientId === this.client(); }
  rewards() { const saved = this.store.meta('twitchRewards') || {}; return CATEGORIES.map(c => ({ ...rewardFields(c), ...saved[c] })); }
  view() { return { status: this.status, rewards: this.rewards(), pending: Object.keys(this.store.meta('twitchSettlements') || {}).length }; }
  put(r) { this.store.setMeta('twitchRewards', { ...(this.store.meta('twitchRewards') || {}), [r.category]: r }); this.changed(); }
  save(category, input) {
    const existing = this.rewards().find(r => r.category === category);
    if (this.writes.has(category) || existing?.sync === 'creating') throw Error('rewardBusy');
    const next = { ...existing, ...rewardFields(category, input) };
    this.store.backup(); this.put(next); return next;
  }
  async request(method, endpoint, params = {}, body) {
    const account = this.account(), client = this.client();
    if (!account || this.closed) throw Error('loginRequired');
    const provider = await this.auth.getProvider();
    let token = await provider.getAccessTokenForUser(account, ['channel:manage:redemptions']);
    const valid = () => { if (this.closed || account !== this.account() || client !== this.client()) throw Error('accountChanged'); };
    const send = access => {
      valid();
      return this.fetchImpl('https://api.twitch.tv/helix/' + endpoint + '?' + new URLSearchParams({ broadcaster_id: account, ...params }), {
        method, headers: { 'Client-Id': client, Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000)
      });
    };
    let response = await send(token.accessToken);
    if (response.status === 401) { token = await provider.refreshAccessTokenForUser(account); response = await send(token.accessToken); }
    valid();
    if (!response.ok) throw Object.assign(Error(response.status === 403 ? 'twitchDenied' : response.status === 429 ? 'twitchRateLimit' : 'twitchRequestFailed'), { status: response.status });
    const result = response.status === 204 ? {} : await response.json(); valid(); return result;
  }
  async publish(category) {
    if (this.writes.has(category)) throw Error('rewardBusy');
    this.writes.add(category);
    try {
      let r = this.rewards().find(r => r.category === category);
      if (!r) throw Error('invalidValue');
      if (!this.account()) throw Error('loginRequired');
      if (r.remoteId) {
        if (!this.owns(r)) throw Error('accountChanged');
        await this.request('PATCH', 'channel_points/custom_rewards', { id: r.remoteId }, twitchFields(r));
        this.put({ ...r, sync: 'synced' }); return;
      }
      const list = (await this.request('GET', 'channel_points/custom_rewards', { only_manageable_rewards: 'true' })).data;
      if (r.sync === 'creating') {
        if (!this.owns(r)) throw Error('accountChanged');
        const recovered = list.find(x => x.title === r.createTitle && !r.knownIds.includes(x.id));
        if (recovered) {
          r = { ...r, remoteId: recovered.id, sync: 'pending' }; this.put(r);
          await this.request('PATCH', 'channel_points/custom_rewards', { id: r.remoteId }, twitchFields(r));
          this.put({ ...r, sync: 'synced' }); return;
        }
      } else {
        if (list.some(x => x.title.toLowerCase() === r.title.toLowerCase())) throw Error('rewardTitleExists');
        r = { ...r, account: this.account(), clientId: this.client(), sync: 'creating', createTitle: r.title, knownIds: list.map(x => x.id) };
        this.store.backup(); this.put(r);
      }
      try {
        const result = await this.request('POST', 'channel_points/custom_rewards', {}, twitchFields(r, true));
        r = { ...r, remoteId: result.data[0].id, sync: 'synced' }; this.put(r);
        if (r.paused) await this.request('PATCH', 'channel_points/custom_rewards', { id: r.remoteId }, { is_paused: true });
      } catch (error) {
        if (!r.remoteId && error.status && error.status < 500) this.put({ ...r, sync: 'draft' });
        throw error;
      }
    } finally { this.writes.delete(category); }
  }
  async remove(category) {
    if (this.writes.has(category)) throw Error('rewardBusy');
    this.writes.add(category);
    try {
      const r = this.rewards().find(r => r.category === category);
      if (!r?.remoteId || !this.owns(r)) throw Error('accountChanged');
      const pending = await this.request('GET', 'channel_points/custom_rewards/redemptions', { reward_id: r.remoteId, status: 'UNFULFILLED', first: '1' });
      if (pending.data.length) throw Error('rewardHasPending');
      await this.request('DELETE', 'channel_points/custom_rewards', { id: r.remoteId });
      this.put(rewardFields(category, r));
    } finally { this.writes.delete(category); }
  }
  receive(event) {
    if (event.account !== this.account() || String(event.status).toLowerCase() !== 'unfulfilled') return Promise.resolve();
    const reward = this.rewards().find(r => r.remoteId === event.rewardId && this.owns(r));
    if (!reward) return Promise.resolve();
    const key = event.account + ':' + event.id;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const epoch = this.epoch;
    const run = (async () => {
      const result = await this.engine.redeem({ category: reward.category, rewardId: reward.remoteId, redemptionId: event.id, user: event.user });
      if (epoch !== this.epoch || !this.owns(reward)) return;
      if (!['accepted', 'refund'].includes(result.decision)) { this.status = result.reason; this.changed(); return; }
      const settlement = { account: reward.account, clientId: reward.clientId, rewardId: reward.remoteId, id: event.id, desired: result.decision === 'accepted' ? 'FULFILLED' : 'CANCELED' };
      this.store.setMeta('twitchSettlements', { ...(this.store.meta('twitchSettlements') || {}), [key]: settlement });
      await this.settle(key, settlement);
    })().catch(() => { this.status = 'twitchRetry'; this.changed(); }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run); return run;
  }
  async settle(key, job) {
    if (!this.owns(job)) return;
    const existing = await this.request('GET', 'channel_points/custom_rewards/redemptions', { reward_id: job.rewardId, id: job.id });
    const status = existing.data[0]?.status;
    if (!status) throw Error('twitchRequestFailed');
    if (status === 'UNFULFILLED') await this.request('PATCH', 'channel_points/custom_rewards/redemptions', { reward_id: job.rewardId, id: job.id }, { status: job.desired });
    const pending = this.store.meta('twitchSettlements') || {}; delete pending[key]; this.store.setMeta('twitchSettlements', pending);
  }
  async tick() {
    if (this.busy || !this.account() || this.closed) return;
    const epoch = this.epoch; this.busy = true;
    try {
      await this.auth.validate();
      for (const r of this.rewards().filter(r => r.remoteId && this.owns(r))) {
        let after = '';
        for (let page = 0; page < 10 && epoch === this.epoch; page++) {
          const result = await this.request('GET', 'channel_points/custom_rewards/redemptions', { reward_id: r.remoteId, status: 'UNFULFILLED', first: '50', sort: 'OLDEST', ...(after ? { after } : {}) });
          if (epoch !== this.epoch) return;
          for (const e of result.data) await this.receive({ account: r.account, id: e.id, rewardId: r.remoteId, user: e.user_name, status: e.status });
          after = result.pagination?.cursor; if (!after) break;
        }
      }
      for (const [key, job] of Object.entries(this.store.meta('twitchSettlements') || {}).slice(0, 40)) {
        if (epoch !== this.epoch) return;
        if (this.inflight.has(key)) continue;
        await this.settle(key, job);
      }
    } catch { if (epoch === this.epoch) { this.status = 'twitchRetry'; this.changed(); } }
    finally { this.busy = false; }
  }
  async connect() {
    this.stop(); const epoch = this.epoch;
    if (!this.account() || this.closed) return;
    this.status = 'twitchConnecting'; this.changed();
    try {
      const sdk = await this.sdk(), authProvider = await this.auth.getProvider();
      if (epoch !== this.epoch) return;
      const listener = this.listener = new sdk.EventSubWsListener({ apiClient: new sdk.ApiClient({ authProvider }), logger: { minLevel: 'error' } });
      listener.onChannelRedemptionAdd(this.account(), e => { if (epoch === this.epoch) void this.receive({ account: e.broadcasterId, id: e.id, rewardId: e.rewardId, user: e.userDisplayName, status: e.status }); });
      listener.onSubscriptionCreateSuccess(() => { if (epoch === this.epoch) { this.status = 'twitchConnected'; this.changed(); } });
      listener.onSubscriptionCreateFailure(() => { if (epoch === this.epoch) this.reconnect(); });
      listener.onUserSocketDisconnect(() => { if (epoch === this.epoch) { this.status = 'twitchRetry'; this.changed(); } });
      listener.onUserSocketConnect(() => { if (epoch === this.epoch) { this.status = 'twitchConnected'; this.changed(); } });
      listener.onRevoke(() => { if (epoch === this.epoch) { this.auth.invalidate('reauthRequired'); this.stop(); } });
      listener.start(); this.timer = setInterval(() => void this.tick(), 15000); this.timer.unref(); void this.tick();
    } catch { if (epoch === this.epoch) this.reconnect(); }
  }
  reconnect() { this.stop(); this.status = 'twitchRetry'; this.changed(); if (!this.auth.invalid && !this.closed) { this.retry = setTimeout(() => void this.connect(), 15000); this.retry.unref(); } }
  stop() { this.epoch++; clearInterval(this.timer); clearTimeout(this.retry); this.listener?.stop(); this.listener = null; this.status = 'signed_out'; }
  close() { this.closed = true; this.stop(); this.auth.off('retry', this.onRetry); }
}
module.exports = { Twitch, rewardFields, twitchFields };
